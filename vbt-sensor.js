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
window._vbtSamples = []; // { ts, az, ax, ay, wx, wy, wz, roll, pitch, yaw } — full accel+gyro+angle stream for the current rep-tracking session, cleared per session same as _hrSamples. ax/ay/wx/wy/wz added for modality classification (running vs mechanical work) — az/roll/pitch/yaw alone couldn't distinguish cadence/swing pattern from rep pattern.
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
  const incoming = new Uint8Array(event.target.value.buffer);
  // Diagnostics: raw per-notification length, kept regardless of
  // whether fragmentation turns out to be the actual explanation for
  // anything, so this is checkable directly next time rather than
  // inferred. Capped to avoid unbounded growth over a long session.
  if (!window._vbtNotificationLengths) window._vbtNotificationLengths = [];
  window._vbtNotificationLengths.push(incoming.length);
  if (window._vbtNotificationLengths.length > 5000) window._vbtNotificationLengths.shift();

  // Carry over any leftover bytes from a packet that was split across
  // the PREVIOUS notification boundary — this was a real, previously-
  // unhandled gap: every notification used to be treated as a fresh,
  // standalone buffer with no memory of a prior partial packet, so a
  // packet split across two notifications would have its trailing
  // fragment silently discarded, potentially misaligning parsing for
  // everything that followed until the resync logic below happened to
  // find a real 0x55 header again (which could briefly misinterpret
  // ordinary data bytes as a fake one). Not confirmed as the actual
  // cause of any specific anomaly — genuinely don't know yet — but a
  // real gap regardless, worth closing rather than leaving in place
  // while investigating.
  let bytes;
  if (window._vbtLeftoverBytes && window._vbtLeftoverBytes.length > 0) {
    bytes = new Uint8Array(window._vbtLeftoverBytes.length + incoming.length);
    bytes.set(window._vbtLeftoverBytes, 0);
    bytes.set(incoming, window._vbtLeftoverBytes.length);
  } else {
    bytes = incoming;
  }
  window._vbtLeftoverBytes = null;

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
  let resyncSkips = 0; // diagnostic: how many stray bytes got skipped this call
  while (offset < bytes.length) {
    if (bytes[offset] !== 0x55) { offset++; resyncSkips++; continue; } // resync on stray bytes
    const type = bytes[offset + 1];
    if (type === 0x61) {
      if (offset + 20 > bytes.length) { window._vbtLeftoverBytes = bytes.slice(offset); break; } // partial packet — carried into next notification instead of discarded
      const parsed = parseWitCombinedPacket(bytes.subarray(offset, offset + 20));
      // roll/pitch/yaw captured alongside az specifically to diagnose a
      // real, unresolved question: whether the device's own orientation
      // estimate (what gravity compensation is built on) can diverge
      // during sustained, rapid wrist rotation — e.g. running — and
      // stay diverged afterward, rather than re-settling once motion
      // stops. A real capture showed extreme az values persisting
      // through what should have been genuinely quiet rest periods
      // between blocks, with no way to tell from az alone whether that
      // was a diverged orientation estimate or something else. This
      // makes that checkable directly next time: a diverged estimate
      // should show roll/pitch stuck away from a resting baseline (or
      // drifting without settling) through the same quiet periods,
      // whereas correctly-behaving orientation would return close to
      // whatever it read before the vigorous motion started.
      if (parsed) window._vbtSamples.push({
        ts: Date.now(),
        az: parsed.az, ax: parsed.ax, ay: parsed.ay,
        wx: parsed.wx, wy: parsed.wy, wz: parsed.wz,
        roll: parsed.roll, pitch: parsed.pitch, yaw: parsed.yaw
      });
      offset += 20;
    } else {
      if (offset + 11 > bytes.length) { window._vbtLeftoverBytes = bytes.slice(offset); break; } // partial packet — carried into next notification instead of discarded
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
  // Diagnostic: how many stray bytes this call had to skip before
  // finding a valid header — a sustained non-zero rate here (as opposed
  // to the rare, occasional skip) would be real evidence of ongoing
  // misalignment, which the leftover-bytes fix above should now prevent
  // going forward but is worth being able to see directly rather than
  // assume fixed.
  if (resyncSkips > 0) {
    if (!window._vbtResyncSkipLog) window._vbtResyncSkipLog = [];
    window._vbtResyncSkipLog.push({ ts: Date.now(), skips: resyncSkips });
    if (window._vbtResyncSkipLog.length > 500) window._vbtResyncSkipLog.shift();
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
  // samples: [{ ts, az, ax, ay, wx, wy, wz, roll, pitch, yaw }] — as accumulated in window._vbtSamples
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
  // Trailing rep at the very end of the stream: unlike a rep still in
  // motion when the stream ends (dropped below, since its numbers would
  // be an undercount, not a real measurement), a rep that had ALREADY
  // completed its lockout pause when the stream ends is a genuine,
  // finished rep — the pause itself is what confirms completion, and
  // nothing about a subsequent sample (or the lack of one) changes that.
  // Real-world importance: this is exactly the shape every set's last
  // rep takes — rep, pause, sensor goes still, recording stops — so
  // without this check, the mid-stream boundary logic above (which only
  // closes a rep when motion resumes AFTER a pause) would silently drop
  // the final rep of every set. Confirmed directly: a captured sequence
  // ending in a real, sustained pause reported one fewer rep than the
  // same sequence with one extra sample appended after that pause.
  if (stationaryStreak >= VBT_STATIONARY_MIN_FRAMES && inRep && currentRep.length > VBT_STATIONARY_MIN_FRAMES) {
    reps.push({
      azSamples: currentRep.map(x => x.az),
      lockoutPauseSec: +(pauseFrames * VBT_DT).toFixed(2)
    });
  }
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
  window._vbtNotificationLengths = [];
  window._vbtResyncSkipLog = [];
  window._vbtLeftoverBytes = null;
}

// ── Live test panel (diagnostic tool, not a permanent feature) ──
// Purpose: visually confirm rep detection works on real hardware before
// committing to any permanent UI placement or wiring this into saved
// history. Deliberately opened via console (openVbtTestPanel()) rather
// than a nav button — this is for validating against real equipment
// next, not a finished feature yet.
//
// Reuses vbtSegmentReps/vbtIntegrateRep exactly as validated against
// real captured data (including the just-fixed trailing-rep bug) —
// this panel adds no new detection logic of its own, just polls the
// existing window._vbtSamples buffer and re-runs the same functions
// already proven correct, so a bug found here would be a UI bug, not a
// re-litigation of the detection logic itself.
let _vbtPanelInterval = null;
let _vbtPanelLastRepCount = 0;

function openVbtTestPanel() {
  if (document.getElementById('vbt-test-panel')) return; // already open

  const panel = document.createElement('div');
  panel.id = 'vbt-test-panel';
  panel.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';
  panel.innerHTML = `
    <div style="width:100%;max-width:420px;background:linear-gradient(135deg, rgba(255,107,0,.12) 0%, rgba(22,27,38,.97) 100%);border-left:4px solid #FF6B00;border-radius:12px;padding:24px;font-family:inherit;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span style="font-size:.75rem;font-weight:800;color:#FF6B00;text-transform:uppercase;letter-spacing:.05em;">VBT Sensor Test</span>
        <button id="vbt-panel-close" style="background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;padding:4px 8px;">✕</button>
      </div>

      <div id="vbt-panel-status" style="font-size:.8rem;color:#888;margin-bottom:16px;">Not connected</div>

      <div style="display:flex;gap:8px;margin-bottom:20px;">
        <button id="vbt-panel-connect" style="flex:1;background:#FF6B00;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;cursor:pointer;">Connect</button>
        <button id="vbt-panel-reset" style="flex:1;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px;font-weight:700;cursor:pointer;">Reset Count</button>
      </div>

      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:.65rem;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Reps Detected</div>
        <div id="vbt-panel-repcount" style="font-size:3.5rem;font-weight:900;color:#fff;line-height:1;">0</div>
      </div>

      <div id="vbt-panel-lastrep" style="font-size:.78rem;color:#ccc;text-align:center;margin-bottom:16px;min-height:1.2em;"></div>

      <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:12px;">
        <div style="font-size:.65rem;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Live az (m/s²)</div>
        <div id="vbt-panel-liveaz" style="font-size:1.3rem;font-weight:700;color:#FF6B00;font-family:monospace;">—</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('vbt-panel-close').addEventListener('click', closeVbtTestPanel);
  document.getElementById('vbt-panel-connect').addEventListener('click', async () => {
    const statusEl = document.getElementById('vbt-panel-status');
    statusEl.textContent = 'Connecting…';
    const ok = await vbtConnect();
    statusEl.textContent = ok ? `Connected: ${window._vbtDevice?.name || '(unnamed device)'}` : 'Connection failed — check console';
    statusEl.style.color = ok ? '#4ADE80' : '#EF4444';
  });
  document.getElementById('vbt-panel-reset').addEventListener('click', () => {
    vbtResetSession();
    _vbtPanelLastRepCount = 0;
    document.getElementById('vbt-panel-repcount').textContent = '0';
    document.getElementById('vbt-panel-lastrep').textContent = '';
  });

  _vbtPanelLastRepCount = 0;
  _vbtPanelInterval = setInterval(_vbtPanelTick, 150);
}

function _vbtPanelTick() {
  const panel = document.getElementById('vbt-test-panel');
  if (!panel) { clearInterval(_vbtPanelInterval); return; } // panel closed elsewhere — stop polling

  const liveAzEl = document.getElementById('vbt-panel-liveaz');
  const last = window._vbtSamples[window._vbtSamples.length - 1];
  if (liveAzEl && last) liveAzEl.textContent = last.az.toFixed(2);

  // Re-detect against the full buffer every tick — simple and correct
  // for a short test session; not optimized for long-running capture,
  // since this is a diagnostic tool, not the final integration.
  const reps = vbtSegmentReps(window._vbtSamples);
  if (reps.length > _vbtPanelLastRepCount) {
    const newest = reps[reps.length - 1];
    const stats = vbtIntegrateRep(newest.azSamples);
    document.getElementById('vbt-panel-repcount').textContent = reps.length;
    document.getElementById('vbt-panel-lastrep').textContent =
      `Last rep: ${stats.displacementM.toFixed(2)}m displacement, ${stats.peakVelocityMs.toFixed(2)} m/s peak velocity`;
    _vbtPanelLastRepCount = reps.length;
  }
}

function closeVbtTestPanel() {
  if (_vbtPanelInterval) { clearInterval(_vbtPanelInterval); _vbtPanelInterval = null; }
  const panel = document.getElementById('vbt-test-panel');
  if (panel) panel.remove();
}

// ── Test-session capture export (On-Phone Debug Viewer integration) ──
// Purpose: get raw VBT samples + real ground-truth movement timing off
// the phone without console access, reusing the existing debug panel
// (index.html's #debug-output textarea + Copy button, built for
// blockSegments/mc_* inspection) rather than building new UI or
// touching profile.js at all — this just adds two more buttons wired
// to functions defined here.
//
// Deliberately snapshot-on-demand (a "Save" button tap), not automatic/
// continuous — window._vbtSamples is otherwise pure in-memory state
// that would vanish on navigation or reload, so this is the bridge that
// makes a test session's data survive long enough to get off the phone.
// Ground truth reused from what already exists for other purposes,
// not reinvented: window._cardioIntervals (the real run-toggle
// start/end, exactly as an athlete would use it normally) and
// window._blockTimeWindows (real per-block start/end, already built
// for HR-sample attribution) — so a session with running as its own
// cardio-toggle interval and push-ups/air-squats as separate blocks
// needs no new UI interaction at all beyond using the app normally.
const VBT_CAPTURE_KEY = 'wod_vbt_test_capture';

// Storage is limited to a few MB per app (browser quota, shared with
// history, drafts and everything else). A long or 50 Hz capture can
// exceed it; the write is then rejected and the PREVIOUS capture stays
// under the same key — which is exactly how "Show" ended up displaying
// the old session after a failed Save. So: try the full capture, then a
// compact form (numbers rounded, bulky diagnostic lists replaced by
// summaries), and if storage still refuses, keep the capture in memory
// (window._vbtPendingCapture) so Show can display it directly. The
// result is written into the debug box so it can't be missed like a toast.
function _vbtRoundSamples(samples) {
  const r = (v, d) => (typeof v === 'number' ? +v.toFixed(d) : v);
  return samples.map(s => ({
    ts: s.ts, az: r(s.az, 3), ax: r(s.ax, 3), ay: r(s.ay, 3),
    wx: r(s.wx, 1), wy: r(s.wy, 1), wz: r(s.wz, 1),
    roll: r(s.roll, 2), pitch: r(s.pitch, 2), yaw: r(s.yaw, 2)
  }));
}

function _vbtStorageReport() {
  let total = 0; const sizes = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), len = (localStorage.getItem(k) || '').length + k.length;
      total += len; sizes.push([k, len]);
    }
  } catch (e) {}
  sizes.sort((a, b) => b[1] - a[1]);
  return { totalKB: Math.round(total / 1024), top: sizes.slice(0, 4).map(([k, n]) => `${k}=${Math.round(n / 1024)}KB`).join(', ') };
}

function vbtSaveCapture() {
  const out = document.getElementById('debug-output');
  const say = msg => { if (out) out.value = msg; };
  const samples = window._vbtSamples || [];
  const lens = window._vbtNotificationLengths || [];
  const skips = window._vbtResyncSkipLog || [];
  const base = {
    savedAt: new Date().toISOString(),
    cardioIntervals: window._cardioIntervals || [],
    blockTimeWindows: window._blockTimeWindows || []
  };
  const attempts = [
    { label: 'full', capture: { ...base, samples, notificationLengths: lens, resyncSkipLog: skips } },
    // Same data, smaller: rounded numbers; diagnostics reduced to what they were for.
    { label: 'compact', capture: { ...base, compact: true, samples: _vbtRoundSamples(samples),
        notificationLengthsSummary: { count: lens.length, distinct: [...new Set(lens)] },
        resyncSkipCount: skips.length, resyncSkipLog: skips.slice(0, 20) } }
  ];
  let lastErr = null;
  for (const at of attempts) {
    let json;
    try { json = JSON.stringify(at.capture); } catch (e) { lastErr = e; continue; }
    try {
      localStorage.setItem(VBT_CAPTURE_KEY, json);
      window._vbtPendingCapture = null;
      say(`SAVED (${at.label}) at ${new Date().toLocaleTimeString()} — ${samples.length} samples, ${(json.length / 1024).toFixed(0)} KB. Now tap Show VBT Capture.`);
      return true;
    } catch (e) { lastErr = e; }
  }
  // Storage refused both forms. Keep the capture in memory so Show can
  // still display it; it is lost if the app is closed or reloaded first.
  window._vbtPendingCapture = attempts[1].capture;
  const rep = _vbtStorageReport();
  const compactKB = (() => { try { return Math.round(JSON.stringify(attempts[1].capture).length / 1024); } catch (e) { return '?'; } })();
  console.error('[VBT] Capture save failed:', lastErr);
  say(`SAVE FAILED — ${lastErr ? lastErr.name + ': ' + lastErr.message : 'unknown error'}\n` +
      `Samples in memory: ${samples.length}. Compact capture ≈ ${compactKB} KB. App storage already used ≈ ${rep.totalKB} KB (largest: ${rep.top}).\n` +
      `The capture is held in memory — tap Show VBT Capture now (before closing the app) and copy it.`);
  return false;
}

function _debugShowVbtCapture() {
  const out = document.getElementById('debug-output');
  if (!out) return;
  // A capture that storage refused is shown directly from memory.
  if (window._vbtPendingCapture) {
    try { out.value = JSON.stringify(window._vbtPendingCapture); return; } catch (e) {}
  }
  const raw = localStorage.getItem(VBT_CAPTURE_KEY);
  if (!raw) { out.value = 'No VBT capture saved yet — tap "Save VBT Capture" after a test session first.'; return; }
  out.value = raw;
}

// ── Movement-class windows: REST / RUN / WORK ──
// Rule-based classifier validated on captures 2-8 (single athlete, right
// forearm, 10 and 50 Hz). 6 s windows, 3 s step, per window:
//   REST: |a| std < 0.3 m/s2 AND gyro RMS < 15 deg/s
//   RUN : dominant |a| frequency 2.3-3.1 Hz AND |a| std > 3 AND gyro RMS > 100
//   WORK: anything else (mechanical work, walking, transitions)
// A RUN window must have an adjacent RUN window: a real run sustains the
// pattern, whereas a single isolated match was a false positive (one
// burpee window in capture 8). Verified on all five captures: run
// windows inside run intervals 224 -> 224, false RUN windows away from
// any run 1 -> 0.
// Time axis is uniform (index / measured rate): at 50 Hz two BLE packets
// share one Date.now() timestamp, so raw ts is not a usable sample clock.
// Nothing in the app calls this yet — it is the tested building block.
const VBT_CLASS_WIN_SEC = 6, VBT_CLASS_STEP_SEC = 3;

function _vbtWindowFeatures(az, gm, fs) {
  const N = az.length;
  let mean = 0; for (let i = 0; i < N; i++) mean += az[i]; mean /= N;
  let varSum = 0; for (let i = 0; i < N; i++) varSum += (az[i] - mean) * (az[i] - mean);
  const std = Math.sqrt(varSum / N);
  let g2 = 0; for (let i = 0; i < N; i++) g2 += gm[i] * gm[i];
  const gyroRms = Math.sqrt(g2 / N);
  // Dominant frequency: Hann-windowed DFT at the bin centres k*fs/N,
  // searched over 0.4 Hz .. min(fs/2, 12 Hz) (same bins as a standard rfft).
  const fMax = fs < 12 ? fs / 2 : 12;
  const xw = new Float64Array(N);
  for (let i = 0; i < N; i++) xw[i] = (az[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  let bestP = -1, dom = 0;
  for (let k = 1; k <= Math.floor(N / 2); k++) {
    const f = k * fs / N;
    if (f <= 0.4 || f >= fMax) continue;
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / N;
    for (let i = 0; i < N; i++) { re += xw[i] * Math.cos(w * i); im -= xw[i] * Math.sin(w * i); }
    const P = re * re + im * im;
    if (P > bestP) { bestP = P; dom = f; }
  }
  return { dom, std, gyroRms };
}

function vbtClassifyWindows(samples) {
  const n = samples ? samples.length : 0;
  if (n < 2) return [];
  const durSec = (samples[n - 1].ts - samples[0].ts) / 1000;
  if (!(durSec > 0)) return [];
  const fs = (n - 1) / durSec;
  const am = new Float64Array(n), gm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    am[i] = Math.hypot(s.ax || 0, s.ay || 0, s.az || 0);
    gm[i] = Math.hypot(s.wx || 0, s.wy || 0, s.wz || 0);
  }
  const W = VBT_CLASS_WIN_SEC, S = VBT_CLASS_STEP_SEC;
  const rows = [];
  for (let st = 0; st < durSec - W; st += S) {
    const i0 = Math.ceil(st * fs - 1e-9), i1 = Math.ceil((st + W) * fs - 1e-9);
    if (i1 - i0 < W * fs * 0.8) continue;
    const { dom, std, gyroRms } = _vbtWindowFeatures(am.subarray(i0, i1), gm.subarray(i0, i1), fs);
    let raw = 'WORK';
    if (std < 0.3 && gyroRms < 15) raw = 'REST';
    else if (dom >= 2.3 && dom <= 3.1 && std > 3 && gyroRms > 100) raw = 'RUN';
    rows.push({ startSec: +st.toFixed(2), rawLabel: raw, dom: +dom.toFixed(2), std: +std.toFixed(2), gyroRms: +gyroRms.toFixed(1) });
  }
  rows.forEach((r, i) => {
    const neighbourRun = (i > 0 && rows[i - 1].rawLabel === 'RUN') || (i + 1 < rows.length && rows[i + 1].rawLabel === 'RUN');
    r.label = r.rawLabel === 'RUN' && !neighbourRun ? 'WORK' : r.rawLabel;
  });
  return rows;
}

// Debug-viewer button: prints the REST / RUN / WORK timeline for the most
// recent capture — the live samples if the sensor has any, otherwise the
// capture held in memory or saved in storage. Shows merged segments (not
// every window) plus, where the capture has them, the run-toggle and
// block windows for comparison.
function _debugClassifyCapture() {
  const out = document.getElementById('debug-output');
  if (!out) return;
  let cap = null, source = '';
  if (window._vbtSamples && window._vbtSamples.length > 1) {
    cap = { samples: window._vbtSamples, cardioIntervals: window._cardioIntervals || [], blockTimeWindows: window._blockTimeWindows || [] };
    source = 'live samples';
  } else if (window._vbtPendingCapture) {
    cap = window._vbtPendingCapture; source = 'capture held in memory';
  } else {
    try { cap = JSON.parse(localStorage.getItem(VBT_CAPTURE_KEY)); source = 'saved capture'; } catch (e) {}
  }
  if (!cap || !cap.samples || cap.samples.length < 2) {
    out.value = 'No VBT samples to classify — connect the sensor and record a session, or tap Save VBT Capture first.';
    return;
  }
  const samples = cap.samples, t0 = samples[0].ts;
  const durSec = (samples[samples.length - 1].ts - t0) / 1000;
  const rows = vbtClassifyWindows(samples);
  if (!rows.length) { out.value = `Capture too short to classify (${durSec.toFixed(1)} s).`; return; }
  const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const W = VBT_CLASS_WIN_SEC;
  // Windows overlap (6 s long, 3 s apart), so each one is drawn as its own
  // middle 3 s — that keeps the segments contiguous, never overlapping.
  const segs = [];
  rows.forEach(r => {
    const a = r.startSec + (W - VBT_CLASS_STEP_SEC) / 2, b = a + VBT_CLASS_STEP_SEC;
    const last = segs[segs.length - 1];
    if (last && last.label === r.label) { last.end = b; last.n++; }
    else segs.push({ label: r.label, start: a, end: b, n: 1 });
  });
  const totals = {};
  rows.forEach(r => { totals[r.label] = (totals[r.label] || 0) + 1; });
  const lines = [];
  lines.push(`Source: ${source} · ${samples.length} samples · ${mmss(durSec)} · ${(samples.length / durSec).toFixed(1)} Hz`);
  lines.push(`Windows (6 s, step 3 s): ${rows.length} — ` + Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', '));
  lines.push('');
  lines.push('TIMELINE (merged windows)');
  segs.forEach(s => lines.push(`${mmss(s.start)}–${mmss(s.end)}  ${s.label}  (${s.n} win)`));
  const rel = ms => (ms - t0) / 1000;
  const runIv = (cap.cardioIntervals || []);
  if (runIv.length) {
    lines.push('');
    lines.push('RUN-TOGGLE / CARDIO INTERVALS');
    runIv.forEach(c => {
      const a = rel(c.startMs), b = rel(c.endMs);
      const inside = rows.filter(r => r.startSec >= a + 1 && r.startSec + W <= b - 1);
      const runCnt = inside.filter(r => r.label === 'RUN').length;
      lines.push(`${c.movement || 'cardio'}: ${mmss(a)}–${mmss(b)}  windows inside ${inside.length}, RUN ${runCnt}`);
    });
  }
  const bw = cap.blockTimeWindows || [];
  if (bw.length) {
    lines.push('');
    lines.push('BLOCK WINDOWS (app timer)');
    bw.forEach(b => lines.push(`block ${b.blockIdx + 1}: ${mmss(rel(b.startMs))}–${mmss(rel(b.endMs))}`));
  }
  out.value = lines.join('\n');
}

// Thin UI wrapper around vbtConnect() for the On-Phone Debug Viewer's
// Connect button — the underlying vbtConnect() itself is unchanged and
// still returns a plain boolean; this just adds the "Connecting…" /
// success / failure toast feedback a button tap needs, which a raw
// async function call from an inline onclick can't cleanly show on its
// own. This is the ONLY way to reach vbtConnect() at all without
// console access — openVbtTestPanel() (built earlier for live rep-count
// testing) still requires calling it from console first, so it doesn't
// help on a phone with no console either; this bypasses that panel
// entirely rather than routing through it.
async function vbtConnectFromUI() {
  showToast('Connecting to sensor…', 'info');
  const ok = await vbtConnect();
  if (ok) {
    showToast(`Connected: ${window._vbtDevice?.name || '(unnamed device)'}`, 'success');
  } else {
    showToast('Connection failed — check console or retry', 'error');
  }
}

// ── Persistent connection status badge (On-Phone Debug Viewer) ──
// Separate from the toast vbtConnectFromUI() already shows on a tap —
// a toast fades after 3 seconds and says nothing once it's gone; this
// gives ongoing, at-a-glance visibility into whether the sensor is
// STILL connected, including cases the toast never covers at all: an
// unexpected mid-session disconnect (walking out of range, low
// battery) with no button ever pressed to trigger a toast in the first
// place. Polls window._vbtConnected rather than hooking directly into
// vbtOnDisconnected/vbtConnect — same lightweight pattern already used
// for the live rep-count panel elsewhere in this file, and avoids
// touching either of those two working, already-tested functions to
// add this.
function _vbtStatusBadgeTick() {
  const dot = document.getElementById('vbt-status-dot');
  const text = document.getElementById('vbt-status-text');
  if (!dot || !text) return; // debug panel not in the DOM right now — fine, just skip this tick
  if (window._vbtConnected) {
    dot.style.background = '#4ADE80';
    text.textContent = `Connected: ${window._vbtDevice?.name || '(unnamed device)'}`;
  } else {
    dot.style.background = '#666';
    text.textContent = 'Not connected';
  }
}
setInterval(_vbtStatusBadgeTick, 1000);
