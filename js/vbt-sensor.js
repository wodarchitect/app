/* ═══════════════════════════════════════════════════════════════════
   VBT SENSOR — WitMotion WT9011DCL-BT50
   ═══════════════════════════════════════════════════════════════════
   External kinematic motion pod (9-axis BLE IMU) used for Velocity-
   Based Training and per-rep Mechanical Work measurement. This is a
   genuinely different sensor class from the HR monitor (timer.js) —
   it measures motion, not heart rate — so it gets its own file rather
   than being folded into the existing Bluetooth HR code.

   STATUS: connection confirmed working against the real physical unit
   (WT901BLE67) — but the device sends a completely different packet
   format than originally assumed. The 11-byte-per-type 0x51/0x52
   packets this file was built around (verified only against synthetic
   data, since no real device existed to test against yet) turned out
   not to be what this unit actually sends. Every real notification is
   a 20-byte 0x61 "combined" packet (Accel+Gyro+Angle bundled together,
   no checksum byte at all) — confirmed against WitMotion's own official
   documentation (WT9011DCL-BT5.0 manual + WT901BLECL datasheet, cross-
   checked against a third-party open-source SDK implementation) and
   then verified again directly against this unit's actual captured
   bytes, which decoded to a physically sensible ~1g Z-axis reading with
   the sensor sitting still. Original 0x51/0x52 parsing kept in place
   as a fallback for older WitMotion firmware/config that might still
   emit that format, dispatched by packet type rather than assumed.

   NOT YET VERIFIED: rep-detection/ZUPT-integration engine (still only
   tested against synthetic data) and gyro/angle scaling under real
   motion (accel/angle confirmed correct at rest; gyro fields read zero
   at rest as expected, but haven't yet seen real rotational movement to
   confirm the ±2000°/s scale end-to-end).

   NOT YET WIRED IN: this module does not yet feed calculateGlobalPhysics
   or get saved to history — that's gated on confirming with the athlete
   whether sensor-measured Mechanical Work should REPLACE the existing
   PR/ROM-estimate-based calculation for tracked reps, or run as a
   separate supplementary metric. Both are architecturally straightforward
   from here; which one determines how deep this needs to go into
   physics-core.js and history.js's save flow.
   ═══════════════════════════════════════════════════════════════════ */

// ── BLE UUIDs ──
// Corroborated from two independent sources: WitMotion's own Android
// SDK source (cited verbatim in a GitHub issue against their public
// WitBluetooth_BWT901BLE5_0 repo) and a live BLE scan of an actual
// WT901BLE-series device's advertised services from a separate
// open-source project — both land on the identical service UUID. Note
// the non-standard base: WitMotion uses ...9a34fb, NOT the Bluetooth
// SIG-standard ...9b34fb suffix — an easy transcription trap.
//
// WitMotion's own product line is NOT uniform on this — a different
// device family (BWT901CL) uses entirely different UUIDs (standard
// 0x1800/0x1801/0x180a plus a distinct custom service) — so these are
// specifically the WT901BLE-naming-convention devices, which the
// WT9011DCL-BT50 is, but this is still first-connection-verify
// territory, not "guaranteed for every WitMotion product."
const VBT_SERVICE_UUID = '0000ffe5-0000-1000-8000-00805f9a34fb';
const VBT_NOTIFY_CHAR_UUID = '0000ffe4-0000-1000-8000-00805f9a34fb';
const VBT_WRITE_CHAR_UUID = '0000ffe9-0000-1000-8000-00805f9a34fb';

window._vbtDevice = null;
window._vbtServer = null;
window._vbtNotifyChar = null;
window._vbtConnected = false;
window._vbtSamples = []; // { ts, az } — vertical accel stream for the current rep-tracking session, cleared per session same as _hrSamples
window._vbtSessionWorkKJ = 0; // accumulated SENSOR-measured mechanical work for the current live session — the authoritative eRaw numerator when > 0, checked directly by physics-core.js's live eRaw banner
window._vbtSessionRepCount = 0; // how many reps the pod actually tracked this session — saved alongside the work total so a session with partial coverage (pod only on for some sets) is distinguishable from full coverage later

// ── Connection ──
// Deliberately verbose on failure — this is the one piece that can't
// be verified without the physical device, so if the primary UUID
// guess is wrong for this specific unit, the console needs to show
// exactly what the device actually advertised rather than a bare
// "connection failed."
async function vbtConnect() {
  if (!navigator.bluetooth) {
    console.error('[VBT] Web Bluetooth not available in this browser.');
    return false;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [VBT_SERVICE_UUID] }],
      optionalServices: [VBT_SERVICE_UUID]
    });
    window._vbtDevice = device;
    device.addEventListener('gattserverdisconnected', vbtOnDisconnected);

    const server = await device.gatt.connect();
    window._vbtServer = server;

    const service = await server.getPrimaryService(VBT_SERVICE_UUID);
    const notifyChar = await service.getCharacteristic(VBT_NOTIFY_CHAR_UUID);
    window._vbtNotifyChar = notifyChar;

    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', vbtHandlePacketEvent);

    window._vbtConnected = true;
    console.log('[VBT] Connected:', device.name || '(unnamed device)');
    return true;
  } catch (e) {
    console.error('[VBT] Connection failed:', e);
    // Diagnostic fallback — if the primary UUID filter above ever
    // rejects a real WT9011DCL because this unit's firmware differs,
    // this dumps every service the device actually advertises, which
    // is the fastest way to find the real UUID rather than guessing
    // again from documentation.
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [VBT_SERVICE_UUID] });
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();
      console.warn('[VBT] Fallback scan — actual advertised services on this device:', services.map(s => s.uuid));
    } catch (e2) {
      console.error('[VBT] Fallback scan also failed:', e2);
    }
    return false;
  }
}

function vbtOnDisconnected() {
  window._vbtConnected = false;
  console.log('[VBT] Disconnected.');
}

async function vbtDisconnect() {
  if (window._vbtDevice?.gatt?.connected) window._vbtDevice.gatt.disconnect();
  window._vbtConnected = false;
}

function vbtHandlePacketEvent(event) {
  const bytes = new Uint8Array(event.target.value.buffer);
  // 0x61 combined packets (confirmed against this specific device's real
  // notifications: every one is 20 bytes, header 55 61) are a completely
  // different shape from the 11-byte-per-type 0x51/0x52 packets this
  // parser was originally built around — 20 isn't a multiple of 11, so
  // walking the buffer in 11-byte strides read misaligned garbage from
  // the very first byte, which is exactly why every packet was failing
  // checksum: not corrupted data, a wrong stride. Detect the type byte
  // first and dispatch to the matching stride/parser rather than
  // assuming one fixed packet shape for the whole buffer.
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0x55) { offset++; continue; } // resync on stray bytes
    const type = bytes[offset + 1];
    if (type === 0x61) {
      if (offset + 20 > bytes.length) break; // partial packet, wait for more data next notification
      const parsed = parseWitCombinedPacket(bytes.subarray(offset, offset + 20));
      if (parsed) window._vbtSamples.push({ ts: Date.now(), az: parsed.az });
      offset += 20;
    } else {
      if (offset + 11 > bytes.length) break;
      const parsed = parseWitPacket(bytes.subarray(offset, offset + 11));
      if (parsed && parsed.type === 'accel') {
        window._vbtSamples.push({ ts: Date.now(), az: parsed.az });
      }
      // Gyro packets (parsed.type === 'gyro') are received but not
      // currently used by the rep-detection engine below, which works
      // from vertical acceleration alone — kept parsed and available for
      // future use (e.g. detecting bar-path rotation/tilt) rather than
      // discarded at the parse layer.
      offset += 11;
    }
  }
}

// ── Packet parser ──
// Byte-exact against WitMotion's own official SDK documentation
// (WIT Standard Communication Protocol / BLE 5.0 Protocol / "Mobile
// APP data analysis" reference implementation) — verified against
// synthetic known-value packets before ever touching real hardware:
// checksum validation, signed int16 little-endian decoding, and the
// ±16g / ±2000°/s full-scale conversion factors all confirmed correct
// against hand-computed expected values.
function parseWitPacket(bytes) {
  if (bytes.length !== 11 || bytes[0] !== 0x55) return null;
  const type = bytes[1];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += bytes[i];
  if ((sum & 0xFF) !== bytes[10]) return { error: 'checksum_mismatch' };

  const readInt16 = (lo, hi) => { const u = (hi << 8) | lo; return u >= 32768 ? u - 65536 : u; };
  const raw = [
    readInt16(bytes[2], bytes[3]),
    readInt16(bytes[4], bytes[5]),
    readInt16(bytes[6], bytes[7]),
    readInt16(bytes[8], bytes[9])
  ];

  if (type === 0x51) {
    // ±16g full scale — WitMotion's standard range for this product line.
    return {
      type: 'accel',
      ax: raw[0] / 32768 * 16 * 9.8,
      ay: raw[1] / 32768 * 16 * 9.8,
      az: raw[2] / 32768 * 16 * 9.8
    };
  }
  if (type === 0x52) {
    // ±2000°/s full scale.
    return {
      type: 'gyro',
      wx: raw[0] / 32768 * 2000,
      wy: raw[1] / 32768 * 2000,
      wz: raw[2] / 32768 * 2000
    };
  }
  return { type: 'unknown_' + type.toString(16) };
}

// ── Combined packet parser (0x61) ──
// Confirmed against real device output — every notification from this
// specific unit (WT901BLE67) came back as 20 bytes with header 55 61,
// not the separate 11-byte 0x51/0x52 packets this file originally
// assumed. Verified against WitMotion's own official documentation
// (WT9011DCL-BT5.0 instruction manual AND the WT901BLECL datasheet,
// two independent official sources, plus a third-party open-source SDK
// implementation for cross-check) before writing this, not guessed from
// the byte layout alone: "Flag = 0x61, Data content: 18Byte is
// Acceleration, Angular velocity, Angle" — 2-byte header (0x55, 0x61)
// + 9 × int16 (18 bytes) = 20 bytes total, low byte first, high byte
// last, in the fixed order Accel XYZ, Gyro XYZ, Angle XYZ. Critically,
// this format carries NO checksum byte at all — the old parser's
// checksum check (built for the 0x51/0x52 format, which does have one)
// was being run against pure data bytes for this format, which is the
// direct cause of the "every packet fails checksum" symptom — there
// was never a checksum to validate here in the first place.
// Accel/Gyro scales match the existing 0x51/0x52 parser exactly (same
// underlying sensor, just different packet bundling). Angle scale
// (±180° full scale) confirmed directly from WitMotion's own published
// formula: "Roll angle X=((RollH<<8)|RollL)/32768*180(°)".
function parseWitCombinedPacket(bytes) {
  if (bytes.length !== 20 || bytes[0] !== 0x55 || bytes[1] !== 0x61) return null;
  const readInt16 = (lo, hi) => { const u = (hi << 8) | lo; return u >= 32768 ? u - 65536 : u; };
  const raw = [];
  for (let i = 0; i < 9; i++) {
    const base = 2 + i * 2;
    raw.push(readInt16(bytes[base], bytes[base + 1]));
  }
  return {
    type: 'combined',
    ax: raw[0] / 32768 * 16 * 9.8,
    ay: raw[1] / 32768 * 16 * 9.8,
    az: raw[2] / 32768 * 16 * 9.8,
    wx: raw[3] / 32768 * 2000,
    wy: raw[4] / 32768 * 2000,
    wz: raw[5] / 32768 * 2000,
    roll:  raw[6] / 32768 * 180,
    pitch: raw[7] / 32768 * 180,
    yaw:   raw[8] / 32768 * 180
  };
}

// ── Rep detection + ZUPT double-integration ──
// Zero-Velocity-Update correction is the actual mechanism that keeps
// double-integrated displacement usable at all — raw double integration
// of any real (noisy, biased) accelerometer signal drifts without
// bound over more than a second or two. The correction: whenever the
// pod is genuinely stationary, velocity is known to be exactly zero,
// so snapping it there resets accumulated error before it compounds.
//
// The trigger MUST be acceleration MAGNITUDE near baseline sustained
// for a minimum duration — NOT signal variance. An earlier draft of
// this used variance, which failed testing: a smooth, controlled
// barbell drive phase has LOW variance too (roughly constant
// acceleration, not fluctuating), so a variance-only trigger
// incorrectly zeroed velocity mid-rep and silently destroyed the
// displacement calculation. Caught via synthetic testing before this
// ever reached real data — magnitude+duration doesn't have that
// failure mode, and the minimum-duration requirement doubles as the
// "lockout pause duration" segmentation signal the design already
// needed.
const VBT_SAMPLE_HZ = 50; // pod configured to this rate; DT below assumes it
const VBT_DT = 1 / VBT_SAMPLE_HZ;
const VBT_STATIONARY_MAG_THRESHOLD = 0.4; // m/s² — near-zero accel, gravity-component already assumed removed upstream
const VBT_STATIONARY_MIN_FRAMES = 5; // ~100ms at 50Hz — real pause, not a momentary blip

// Runs the ZUPT-corrected double integration over one rep's worth of
// vertical acceleration samples (gravity-component already removed —
// see note below) and returns per-rep kinematics. Does NOT itself
// segment where one rep starts/ends; that's vbtSegmentReps below, which
// calls this once per detected rep window.
function vbtIntegrateRep(azSamples) {
  let v = 0, d = 0, peakV = 0, stationaryStreak = 0;
  const trace = [];
  azSamples.forEach(az => {
    v += az * VBT_DT;
    d += v * VBT_DT;
    if (Math.abs(v) > Math.abs(peakV)) peakV = v;
    if (Math.abs(az) < VBT_STATIONARY_MAG_THRESHOLD) {
      stationaryStreak++;
      if (stationaryStreak >= VBT_STATIONARY_MIN_FRAMES) v = 0;
    } else {
      stationaryStreak = 0;
    }
    trace.push({ v, d });
  });
  const finalDisplacement = trace.length ? trace[trace.length - 1].d : 0;
  // Mean concentric velocity — same convention VBT devices commonly
  // report: displacement over the concentric window's own duration,
  // not instantaneous samples averaged (which would overweight the
  // slower start/end of the movement).
  const concentricDurationSec = azSamples.length * VBT_DT;
  const meanConcentricVelocity = concentricDurationSec > 0 ? Math.abs(finalDisplacement) / concentricDurationSec : 0;
  return {
    displacementM: +finalDisplacement.toFixed(3),
    peakVelocityMs: +Math.abs(peakV).toFixed(3),
    meanConcentricVelocityMs: +meanConcentricVelocity.toFixed(3),
    durationSec: +concentricDurationSec.toFixed(2)
  };
}

// Segments a raw vertical-acceleration stream into individual reps
// using the same stationary-magnitude signal as the ZUPT correction
// above — a rep boundary is wherever a sustained stationary period
// (lockout pause, or the pause at the bottom of a controlled-descent
// lift) sits between two non-stationary (moving) windows. Returns an
// array of { azSamples, lockoutPauseSec } per detected rep.
function vbtSegmentReps(samples) {
  // samples: [{ ts, az }] — as accumulated in window._vbtSamples
  const reps = [];
  let currentRep = [];
  let stationaryStreak = 0;
  let pauseFrames = 0;
  let inRep = false;

  samples.forEach((s, i) => {
    const stationary = Math.abs(s.az) < VBT_STATIONARY_MAG_THRESHOLD;
    if (stationary) {
      stationaryStreak++;
      if (inRep) pauseFrames++;
    } else {
      if (stationaryStreak >= VBT_STATIONARY_MIN_FRAMES && inRep && currentRep.length > VBT_STATIONARY_MIN_FRAMES) {
        // Sustained pause after real movement — rep boundary.
        reps.push({
          azSamples: currentRep.map(x => x.az),
          lockoutPauseSec: +(pauseFrames * VBT_DT).toFixed(2)
        });
        currentRep = [];
        pauseFrames = 0;
      }
      inRep = true;
      stationaryStreak = 0;
    }
    if (inRep) currentRep.push(s);
  });
  // Trailing partial rep (still in motion when the sample stream ends)
  // is deliberately dropped, not force-closed — an incomplete rep's
  // displacement/velocity numbers would be an undercount, not a real
  // measurement, and reporting a fabricated partial value would be
  // worse than reporting nothing for it.
  return reps;
}

// ── Mechanical Work per rep ──
// Same mgh (mass × gravity × height) convention this app's existing
// mechanical-work calculation already uses for barbell movements — the
// difference here is the height/displacement comes from a REAL
// measurement (double-integrated from the pod) instead of an assumed
// range-of-motion tied to the movement's PR/rep-scheme entry. Given a
// rep's measured displacement and the loaded mass, this is a drop-in
// replacement for that one input, not a different formula.
function vbtRepMechanicalWork(massKg, displacementM) {
  const workJ = massKg * 9.81 * Math.abs(displacementM);
  return { workJ: +workJ.toFixed(1), workKJ: +(workJ / 1000).toFixed(3) };
}

// Adds one completed rep's sensor-measured mechanical work to the
// running session total (window._vbtSessionWorkKJ), which
// physics-core.js's live eRaw banner reads directly and prefers over
// the PR/ROM estimate whenever it's > 0. Call this once per detected
// rep (see vbtSegmentReps) with the load actually on the bar for that
// rep — NOT wired to a "current movement's weight" source yet, since
// that requires the live timer's own movement/set-tracking state,
// which needs its own investigation once the pod is in hand and a
// real session can be run against it rather than guessed at blind.
function vbtRecordRepWork(massKg, displacementM) {
  const { workKJ } = vbtRepMechanicalWork(massKg, displacementM);
  window._vbtSessionWorkKJ = +(window._vbtSessionWorkKJ + workKJ).toFixed(3);
  window._vbtSessionRepCount += 1;
  return workKJ;
}

// Resets session-level VBT accumulation — mirrors the pattern
// window._hrSamples reset follows in timer.js (called at the same
// point a new live session actually starts), so a new session never
// inherits the previous one's accumulated work total.
function vbtResetSession() {
  window._vbtSamples = [];
  window._vbtSessionWorkKJ = 0;
  window._vbtSessionRepCount = 0;
}
