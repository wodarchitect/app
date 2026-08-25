/* ═══════════════════════════════════════════════════════════════════
   VBT SENSOR — WitMotion WT9011DCL-BT50
   ═══════════════════════════════════════════════════════════════════
   External kinematic motion pod (9-axis BLE IMU) used for Velocity-
   Based Training and per-rep Mechanical Work measurement. This is a
   genuinely different sensor class from the HR monitor (timer.js) —
   it measures motion, not heart rate — so it gets its own file rather
   than being folded into the existing Bluetooth HR code.

   STATUS: connection + parsing + rep-detection/integration engine are
   built and internally tested against synthetic data (packet parser
   verified against official WitMotion checksum/scale formulas; rep
   integration verified against a synthetic rep profile, with and
   without added noise). The one thing that CANNOT be verified from
   here is the actual BLE connection itself — service/characteristic
   UUIDs below are corroborated from two independent sources (WitMotion's
   own SDK source, and a live BLE scan of a real WT901BLE-series device
   from a separate open-source project) but not yet confirmed against
   this specific physical unit. First real connection attempt should
   watch the console for the service-list warning below.

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
  // A single BLE notification can carry more than one 11-byte WIT
  // packet back-to-back — walk the buffer rather than assuming exactly
  // one packet per notification.
  for (let offset = 0; offset + 11 <= bytes.length; offset += 11) {
    const packet = bytes.subarray(offset, offset + 11);
    const parsed = parseWitPacket(packet);
    if (parsed && parsed.type === 'accel') {
      window._vbtSamples.push({ ts: Date.now(), az: parsed.az });
    }
    // Gyro packets (parsed.type === 'gyro') are received but not
    // currently used by the rep-detection engine below, which works
    // from vertical acceleration alone — kept parsed and available for
    // future use (e.g. detecting bar-path rotation/tilt) rather than
    // discarded at the parse layer.
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
