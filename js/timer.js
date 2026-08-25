/* ════════════════════════════════════════════════════
   TIMER
   The live timer runtime: HR monitor connection, wake lock,
   the countdown/round engine, cardio toggle system, watch
   controls, and timer-screen UI (ring, overlay, settings panel).
════════════════════════════════════════════════════ */

// Standard Bluetooth Heart Rate Service (GATT UUID 0x180D) / Heart Rate
// Measurement characteristic (0x2A37) — not vendor-specific, works with
// any BLE chest strap that broadcasts the standard profile, which
// includes Decathlon's Kalenji/Domyos straps.
let _hrDevice = null;
let _hrReconnecting = false;
window._hrSamples = []; // { ts, bpm } — accumulates for the whole session; also the raw data the future %HRR/RPE work needs per interval
window._hrBlockStartMs = null; // wall-clock time the current block began, for per-block avg/max

function _hrLog(msg) { console.log('[HR]', msg); } // console only now that the connection is confirmed reliable post-reinstall — devtools if something needs debugging later

function _hrParseValue(dataView) {
  // Standard Heart Rate Measurement format: flags byte, then either a
  // UINT8 or UINT16 HR value depending on flags bit 0.
  const flags = dataView.getUint8(0);
  const is16bit = (flags & 0x01) === 1;
  return is16bit ? dataView.getUint16(1, /*littleEndian=*/true) : dataView.getUint8(1);
}

function _hrUpdateStatusIndicator(connected) {
  const dot = document.getElementById('hr-status-dot');
  const text = document.getElementById('hr-status-text');
  if (dot) dot.style.background = connected ? '#22C55E' : '#6B7280';
  if (text) text.innerText = connected ? 'HR monitor: connected' : 'HR monitor: not connected — tap to connect';
}
function _hrStatusTap() {
  if (_hrDevice && _hrDevice.gatt.connected) return; // already connected — no need to re-prompt
  _hrTestConnect();
}

function _hrStatsForRange(startMs, endMs) {
  const samples = window._hrSamples.filter(s => s.ts >= startMs && s.ts <= endMs);
  if (!samples.length) return null;
  const bpms = samples.map(s => s.bpm);
  return { avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length), max: Math.max(...bpms) };
}
function _hrUpdateStatsDisplay() {
  const statsEl = document.getElementById('hr-card-stats');
  if (!statsEl || !window._hrSamples.length) return;
  statsEl.style.display = '';

  const sessionStats = _hrStatsForRange(0, Date.now());
  const sessionEl = document.getElementById('hr-stat-session');
  if (sessionEl && sessionStats) sessionEl.innerText = `avg ${sessionStats.avg} · max ${sessionStats.max}`;

  const blockStats = window._hrBlockStartMs ? _hrStatsForRange(window._hrBlockStartMs, Date.now()) : null;
  const blockEl = document.getElementById('hr-stat-block');
  const blockNumEl = document.getElementById('hr-stat-block-num');
  if (blockNumEl) blockNumEl.innerText = (activeBlockIdx || 0) + 1;
  if (blockEl && blockStats) blockEl.innerText = `avg ${blockStats.avg} · max ${blockStats.max}`;

  // Per-movement — one line per (block, movement type), combining all
  // toggle cycles of that type within the block into one average, same
  // grouping _buildBlockSegments() actually uses at save time. Was
  // previously one line per individual toggle cycle (e.g. 5 separate DU
  // lines for 5 rounds) — didn't match what actually gets saved/
  // calculated, which unions same-type intervals within a block.
  const movementsEl = document.getElementById('hr-stat-movements');
  if (movementsEl && window._cardioIntervals.length) {
    const grouped = {}; // "blockIdx:movement" -> [intervals]
    window._cardioIntervals.forEach(iv => {
      const key = `${iv.blockIdx}:${iv.movement}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(iv);
    });
    movementsEl.innerHTML = Object.entries(grouped).map(([key, intervals]) => {
      const [blockIdx, movement] = key.split(':');
      let samples = [];
      intervals.forEach(iv => { samples = samples.concat(window._hrSamples.filter(s => s.ts >= iv.startMs && s.ts <= iv.endMs)); });
      if (!samples.length) return '';
      const bpms = samples.map(s => s.bpm);
      const avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
      const max = Math.max(...bpms);
      const totalDurationSec = intervals.reduce((sum, iv) => sum + iv.durationSec, 0);
      return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:.62rem;"><span>${movement.toUpperCase()} (block ${parseInt(blockIdx) + 1}, ${intervals.length}x, ${totalDurationSec.toFixed(0)}s)</span><span>avg ${avg} · max ${max}</span></div>`;
    }).join('');
  }
}

async function _hrSubscribe(device) {
  const gattServer = await device.gatt.connect();
  _hrLog('GATT connected');
  const service = await gattServer.getPrimaryService('heart_rate');
  const characteristic = await service.getCharacteristic('heart_rate_measurement');
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    const hr = _hrParseValue(event.target.value);
    const valEl = document.getElementById('hr-card-value');
    if (valEl) valEl.innerText = hr;
    window._hrSamples.push({ ts: Date.now(), bpm: hr });
    _hrUpdateStatsDisplay();
  });
}
// Web Bluetooth GATT connections don't survive the phone locking or the
// tab/app being backgrounded — a real Android/Chrome platform
// limitation, not fixable at the app level. What IS fixable: reconnecting
// automatically instead of requiring a fresh device picker every time.
// Tries the in-memory device reference first (works if the JS context
// survived backgrounding). navigator.bluetooth.getDevices() as a further
// fallback is NOT available on this device/Chrome build (confirmed —
// the flag it depends on isn't exposed), so a full reload always needs
// a manual reconnect tap; that's an accepted, working fallback.
async function _hrTryReconnect() {
  if (_hrReconnecting || !_hrDevice) return;
  _hrReconnecting = true;
  _hrLog(`Reconnect: attempting GATT connect to ${_hrDevice.name || '(unnamed)'}…`);
  try {
    await _hrSubscribe(_hrDevice);
    _hrUpdateStatusIndicator(true);
    const btn = document.getElementById('hr-card-btn');
    if (btn) btn.style.display = 'none';
    _hrLog('Reconnected successfully');
  } catch (err) {
    _hrUpdateStatusIndicator(false);
    _hrLog(`Reconnect FAILED: ${err.name} — ${err.message}`);
  }
  _hrReconnecting = false;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _hrDevice && !_hrDevice.gatt.connected) {
    _hrTryReconnect();
  }
});
async function _hrTestConnect() {
  if (!navigator.bluetooth) {
    _hrLog('Web Bluetooth not available — needs Chrome on Android or desktop.');
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    _hrDevice = device;
    _hrLog(`Device selected: ${device.name || '(unnamed)'}`);
    device.addEventListener('gattserverdisconnected', () => {
      _hrUpdateStatusIndicator(false);
      const btn = document.getElementById('hr-card-btn');
      if (btn) btn.style.display = '';
      _hrLog('Disconnected — attempting reconnect');
      _hrTryReconnect();
    });

    await _hrSubscribe(device);
    _hrUpdateStatusIndicator(true);
    const btn = document.getElementById('hr-card-btn');
    if (btn) btn.style.display = 'none';
    _hrLog(`Connected to ${device.name || 'device'}`);
  } catch (err) {
    if (err.name !== 'NotFoundError') _hrLog(`ERROR: ${err.name} — ${err.message}`); // NotFoundError = picker cancelled, not worth logging as an error
  }
}

/* ════════════════════════════════════════════════════
   TIMER ENGINE
════════════════════════════════════════════════════ */
let activeBlockIdx = -1, isRunning = false, isPaused = false;

// Warn before closing/navigating away when timer is active
window.addEventListener('beforeunload', (e) => {
  if (isRunning && !sessionEnded) {
    e.preventDefault();
    e.returnValue = '';
  }
});
let timerItv, blockSec = 0, totalSessionSec = 0;
let _activeTemplateName = '';
let _pendingHistoryEntry = null;
let amrapFullTime = 0, sessionEnded = false;
let tabataRound = 1, tabataTotalRounds = 8, tabataPhase = 'work';
let emomRound = 0, emomTotalRounds = 0;
let voiceEnabled = localStorage.getItem('wod-voice-enabled') !== '0';
let countingDown = false;  // true during the 10-second countdown

/* ════════════════════════════════════════════════════
   WAKE LOCK — keeps screen on during active workout
════════════════════════════════════════════════════ */
let _wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;  // not supported
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch(e) {
    // Wake Lock denied (battery saver mode etc.) — fail silently
  }
}

function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release().catch(() => {});
    _wakeLock = null;
  }
}

// Re-acquire if tab becomes visible again (wake lock releases on tab hide)
let _lastRenderedDate = new Date().toDateString();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (isRunning && !sessionEnded && !isPaused) acquireWakeLock();
    // Re-render Training Load if the date has changed (e.g. overnight)
    const today = new Date().toDateString();
    if (today !== _lastRenderedDate) {
      _lastRenderedDate = today;
      if (currentTab === 3) { renderTrainingLoad(); }
    }
  }
});
let lastRoundStartSec = 0; // elapsed seconds at the start of the current round
let _roundSplits = []; // array of {round, splitSec, cumSec} per block
let isResting = false;     // true during between-block rest period

function getRestDuration() {
  return parseInt(document.getElementById('rest-duration-sec')?.value || '0') || 0;
}

function openRestPicker() {
  const opts = [
    { val: '0', label: t('timer.no.rest.label') },
    { val: '10', label: '10 sec' },
    { val: '20', label: '20 sec' },
    { val: '30', label: '30 sec' },
    { val: '40', label: '40 sec' },
    { val: '50', label: '50 sec' },
    { val: '60', label: '1 min' },
    { val: '75', label: '1:15 min' },
    { val: '90', label: '1:30 min' },
    { val: '105', label: '1:45 min' },
    { val: '120', label: '2 min' },
    { val: '150', label: '2:30 min' },
    { val: '180', label: '3 min' },
    { val: '210', label: '3:30 min' },
    { val: '240', label: '4 min' },
    { val: '270', label: '4:30 min' },
    { val: '300', label: '5 min' },
    { val: '360', label: '6 min' },
    { val: '420', label: '7 min' },
    { val: '480', label: '8 min' },
    { val: '540', label: '9 min' },
    { val: '600', label: '10 min' },
  ];
  const cur = document.getElementById('rest-duration-sec')?.value || '0';
  const overlay = document.getElementById('pickerOverlay');
  const drum    = document.getElementById('pickerDrum');
  const label   = document.getElementById('pickerLabel');
  label.textContent = t('rest.between.blocks');
  overlay._profField = null;
  overlay._restPicker = true;
  buildOptDrum(drum, opts, cur, 'rest');
  overlay._trigger = document.getElementById('rest-duration-trigger');
  overlay._trigger.classList.add('open');
  overlay.classList.add('open');
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('wod-voice-enabled', voiceEnabled ? '1' : '0');
  document.querySelectorAll('#voiceToggleBtn').forEach(btn => btn.classList.toggle('voice-on', voiceEnabled));
  document.querySelectorAll('#voiceToggleLabel').forEach(label => {
    label.textContent = voiceEnabled ? t('timer.voice.on') : t('timer.voice.off');
  });
}

function updateTimerRing(progress, phase) {
  const CIRC = 276.5;
  const ring = document.getElementById('timerRingFill');
  if (!ring) return;
  ring.style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, progress)));
  ring.classList.remove('ring-rest', 'ring-danger', 'ring-block-rest');
  if (phase === 'rest')       { ring.classList.add('ring-rest');       ring.setAttribute('stroke','url(#ringGradRest)'); }
  else if (phase === 'danger'){ ring.classList.add('ring-danger');     ring.setAttribute('stroke','url(#ringGradDanger)'); }
  else if (phase === 'block-rest') { ring.classList.add('ring-block-rest'); ring.setAttribute('stroke','url(#ringGradRest)'); }
  else                        { ring.setAttribute('stroke','url(#ringGradActive)'); }
}

/* Show/hide play/pause overlay and timer digits */
function updateTimerOverlay() {
  const play  = document.getElementById('timerPlayBtn');
  const pause = document.getElementById('timerPauseIcon');
  const disp  = document.getElementById('timerDisplay');
  if (!play || !pause || !disp) return;

  if (!isRunning || sessionEnded) {
    // IDLE: show play, hide pause, hide digits
    play.classList.remove('hidden');
    pause.classList.remove('visible');
    disp.classList.add('timer-hidden');
  } else if (isPaused) {
    // PAUSED: show pause icon, hide play, show digits
    play.classList.add('hidden');
    pause.classList.add('visible');
    disp.classList.remove('timer-hidden');
  } else {
    // RUNNING: no overlay, show digits
    play.classList.add('hidden');
    pause.classList.remove('visible');
    disp.classList.remove('timer-hidden');
  }
}

/* Swipe bar — two modes both swiping left→right:
   'finish'    (blue)   → triggers finishCurrentBlock()
   'skip-rest' (orange) → triggers skipRest() / startCountdown() */
var swipeMode = 'finish'; // 'finish' | 'skip-rest'

function setSwipeMode(mode) {
  swipeMode = mode;
  const wrap  = document.getElementById('swipeFinishWrap');
  const label = document.getElementById('swipeFinishLabel');
  const thumb = document.getElementById('swipeFinishThumb');
  const arr   = document.getElementById('swipeArrow');
  if (!wrap || !label || !thumb) return;
  wrap.classList.remove('mode-skip-rest', 'mode-reset');
  if (mode === 'reset') {
    // Thumb stays at right, arrow points left, red styling
    const thr = wrap.offsetWidth - thumb.offsetWidth - 8;
    thumb.style.transition = 'left .35s cubic-bezier(.4,0,.2,1)';
    thumb.style.left = (4 + thr) + 'px';
    if (arr) arr.style.transform = 'rotate(180deg)';
    wrap.classList.add('mode-reset');
    label.textContent = '← Swipe to Reset';
  } else {
    // Thumb returns to left, arrow points right
    thumb.style.transition = 'left .3s cubic-bezier(.4,0,.2,1)';
    thumb.style.left = '4px';
    if (arr) arr.style.transform = '';
    if (mode === 'skip-rest') {
      wrap.classList.add('mode-skip-rest');
    } else {
      label.textContent = t('timer.swipe.finish');
    }
  }
  wrap.style.background = '';
  label.style.opacity = '';
  wrap.classList.remove('triggered');
}

(function() {
  let startX = 0, currentX = 0, dragging = false, threshold = 0;

  function getThreshold() {
    const wrap  = document.getElementById('swipeFinishWrap');
    const thumb = document.getElementById('swipeFinishThumb');
    if (!wrap || !thumb) return 0;
    return wrap.offsetWidth - thumb.offsetWidth - 8;
  }

  function isSwipeActive() {
    if (swipeMode === 'finish')    return isRunning && !isPaused && !isResting;
    if (swipeMode === 'skip-rest') return isResting;  // works paused or running
    if (swipeMode === 'reset')     return sessionEnded;
    return false;
  }

  function initSwipe() {
    const wrap  = document.getElementById('swipeFinishWrap');
    const thumb = document.getElementById('swipeFinishThumb');
    if (!wrap || !thumb) return;
    threshold = getThreshold();

    function onStart(e) {
      if (!isSwipeActive()) return;
      dragging = true;
      threshold = getThreshold();
      // Reset mode: thumb starts at right and drags left
      currentX = swipeMode === 'reset' ? threshold : 0;
      startX = (e.touches ? e.touches[0].clientX : e.clientX);
      thumb.style.transition = 'none';
      const label = document.getElementById('swipeFinishLabel');
      if (label) label.style.opacity = '0';
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const delta = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
      if (swipeMode === 'reset') {
        currentX = Math.max(0, Math.min(threshold + delta, threshold));
        thumb.style.left = (4 + currentX) + 'px';
        const pct = 1 - (currentX / threshold);
        wrap.style.background = `rgba(239,68,68,${0.08 + pct * 0.28})`;
      } else {
        currentX = Math.max(0, Math.min(delta, threshold));
        thumb.style.left = (4 + currentX) + 'px';
        const pct = currentX / threshold;
        if (swipeMode === 'skip-rest') {
          wrap.style.background = `rgba(245,158,11,${0.10 + pct * 0.30})`;
        } else {
          wrap.style.background = `rgba(59,130,246,${0.08 + pct * 0.28})`;
        }
      }
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      if (swipeMode === 'reset') {
        // Reset: thumb starts right, drags left — trigger at 15% remaining
        if (currentX <= threshold * 0.15) {
          wrap.classList.add('triggered');
          thumb.style.transition = 'left .15s ease';
          thumb.style.left = '4px';
          setTimeout(() => { fullInitialReset(); }, 220);
        } else {
          snapBack();
        }
      } else if (currentX >= threshold * 0.85) {
        wrap.classList.add('triggered');
        thumb.style.transition = 'left .15s ease';
        thumb.style.left = (4 + threshold) + 'px';
        if (swipeMode === 'skip-rest') {
          setTimeout(() => {
            if (_restItv) {
              // Calculate actual rest used before clearing
              const restSec = getRestDuration();
              const restEl = document.querySelector('.res-rest');
              if (restEl) {
                const restRemaining = parseInt(document.getElementById('timerDisplay')?.innerText?.replace(':','') || '0');
                // actual = programmed - remaining displayed
                const dispEl = document.getElementById('timerDisplay');
                const dispVal = dispEl?.innerText || '0:00';
                const parts = dispVal.split(':');
                const remainSec = parts.length === 2 ? parseInt(parts[0])*60 + parseInt(parts[1]) : parseInt(parts[0]);
                _actualRestUsed += restSec - remainSec;
              }
              clearInterval(_restItv); _restItv = null;
            }
            window._actualRestUsed = _actualRestUsed;
            window._timerRestCompleted = true;
            if (window._currentRestStartMs) {
              window._restTimeWindows.push({ afterBlockIdx: activeBlockIdx, startMs: window._currentRestStartMs, endMs: Date.now() });
              window._currentRestStartMs = null;
            }
            isResting = false;
            setSwipeMode('finish');
            speak(t('timer.skipping.rest'));
            if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
            initBlock();
          }, 200);
        } else {
          setTimeout(() => { finishCurrentBlock(); }, 220);
        }
      } else {
        snapBack();
      }
    }

    function snapBack() {
      thumb.style.transition = 'left .28s cubic-bezier(.4,0,.2,1)';
      thumb.style.left = swipeMode === 'reset' ? (4 + threshold) + 'px' : '4px';
      wrap.style.background = '';
      const label = document.getElementById('swipeFinishLabel');
      if (label) label.style.opacity = '';
    }

    thumb.addEventListener('mousedown',  onStart);
    thumb.addEventListener('touchstart', onStart, {passive:false});
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('mouseup',  onEnd);
    document.addEventListener('touchend', onEnd);
    window.addEventListener('resize', () => { threshold = getThreshold(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwipe);
  } else {
    setTimeout(initSwipe, 100);
  }
})();

/* Tap inside the ring:
   - Idle: start timer
   - Running: pause (show pause icon)
   - Paused: resume (hide pause icon) */
function timerRingTapped() {
  if (sessionEnded) return;
  toggleTimer();
}

/* Update block cap/duration shown above ring */
function updateTimerBlockInfo() {
  const el = document.getElementById('timerBlockInfo');
  if (!el) return;
  const blocks = document.querySelectorAll('.wod-block');
  const bEl = blocks[activeBlockIdx >= 0 ? activeBlockIdx : 0];
  if (!bEl) { el.textContent = ''; return; }
  const mode = bEl.querySelector('.b-mode').value;
  let info = '';
  if (mode === 'fortime') {
    const cap = bEl.querySelector('.b-cap')?.value || '?';
    info = `${t('block.time.cap')}: ${cap} min`;
  } else if (mode === 'amrap') {
    const dur = bEl.querySelector('.b-dur')?.value || '?';
    info = `Duration: ${dur} min AMRAP`;
  } else if (mode === 'emom') {
    const total = bEl.querySelector('.b-total-int')?.value || '?';
    const intv  = bEl.querySelector('.b-int')?.value || '?';
    info = `EMOM: ${total} × ${intv}s`;
  } else if (mode === 'exmom') {
    const total = bEl.querySelector('.b-total-int')?.value || '?';
    const intv  = bEl.querySelector('.b-int')?.value || '?';
    const n = bEl.querySelectorAll('.movement-block').length || 'X';
    info = `E${n}MOM: ${total} × ${intv}s`;
  } else if (mode === 'tabata') {
    const rnds = bEl.querySelector('.b-tab-r')?.value || '?';
    info = `Tabata: ${rnds} rounds`;
  }
  // Add block count and rest info when multi-block
  if (blocks.length > 1) {
    const restSec = parseInt(document.getElementById('rest-duration-sec')?.value) || 0;
    const restLabel = restSec > 0
      ? (restSec >= 60 ? `${Math.floor(restSec/60)}:${String(restSec%60).padStart(2,'0')} rest` : `${restSec}s rest`)
      : '';
    const blockLabel = `Block ${(activeBlockIdx >= 0 ? activeBlockIdx : 0) + 1}/${blocks.length}`;
    info = [blockLabel, info, restLabel].filter(Boolean).join(' · ');
  }
  el.textContent = info;
}

function updateActiveWodBlock() {
  document.querySelectorAll('#timerWodContent .timer-wod-block').forEach((el, i) => {
    el.classList.toggle('active-wod-block', i === activeBlockIdx);
  });
}

// For EXMOM: highlight the active station in the timer overview
function updateActiveWodBlockExmom(bEl, stationIdx) {
  const timerBlocks = document.querySelectorAll('#timerWodContent .timer-wod-block');
  const activeBlock = timerBlocks[activeBlockIdx];
  if (!activeBlock) return;
  // Highlight the current station row
  activeBlock.querySelectorAll('[data-station]').forEach((el, i) => {
    el.style.background = i === stationIdx ? 'rgba(245,158,11,.15)' : '';
    el.style.borderLeft = i === stationIdx ? '3px solid #F59E0B' : '3px solid transparent';
    el.style.paddingLeft = '8px';
  });
}

function toggleTimer() {
  getAudioCtx(); // ensure AudioContext is created and resumed on this user gesture
  if (currentTab !== 2) switchTab(2);
  if (!isRunning && !sessionEnded) {
    isRunning = true; activeBlockIdx = 0;
    _roundSplits = []; // reset splits for new session
    window._lastRoundTapUndo = null; // clear any stale undo from a prior session
    const _undoBtnReset = document.getElementById('roundFabUndo');
    if (_undoBtnReset) _undoBtnReset.style.display = 'none';
    window._actualRestUsed = 0;
    window._timerRestCompleted = false;
    _cardioResetIntervals();
    _cardioDetectMovements();
    _watchControlStart();
    window._hrSamples = [];
    if (typeof vbtResetSession === 'function') vbtResetSession(); // same reset point as HR — new session never inherits prior VBT accumulation
    window._hrBlockStartMs = Date.now();
    window._blockTimeWindows = []; // [{blockIdx, startMs, endMs}] — built as blocks transition, closed off at session end. Used at save time to attribute HR samples to the correct block.
    window._restTimeWindows = []; // [{afterBlockIdx, startMs, endMs}] — only populated when a rest countdown genuinely runs live (see the rest-countdown code); real wall-clock timestamps, same as block windows, not derived from any duration estimate.
    acquireWakeLock();
    updateTimerBlockInfo();
    startCountdown();
  } else if (sessionEnded) {
    // do nothing — must reset first
  } else {
    isPaused = !isPaused;
  }
  updateTimerOverlay();
}

let _restItv = null;  // exposed so skipRest() can cancel it
let _actualRestUsed = 0; // actual rest seconds used in last rest period
let _timerRestCompleted = false; // true if timer has actually run a rest this session
window._actualRestUsed = 0;
window._timerRestCompleted = false;

function startRestCountdown(sec) {
  isResting = true;
  isPaused = false;
  let remaining = sec;
  let elapsed = 0;
  window._currentRestStartMs = Date.now(); // real wall-clock start — window-scoped since the skip handler (swipe gesture) lives in a different function and needs this too
  const disp   = document.getElementById('timerDisplay');
  const info   = document.getElementById('roundInfo');
  const banner = document.getElementById('emomNextBanner');
  const play  = document.getElementById('timerPlayBtn');
  const pause = document.getElementById('timerPauseIcon');
  if (play)  play.classList.add('hidden');
  if (pause) pause.classList.remove('visible');
  disp.classList.remove('timer-hidden');
  disp.className = '';
  if (info) info.innerText = 'REST';
  if (banner) { banner.textContent = ''; banner.classList.remove('pulsing'); }
  document.getElementById('emomProgress')?.classList.add('hidden-el');
  updateTimerRing(1, 'block-rest');
  const m0 = Math.floor(remaining/60), s0 = remaining%60;
  disp.innerText = `${String(m0).padStart(2,'0')}:${String(s0).padStart(2,'0')}`;
  speak(t('timer.rest'));

  // Smooth ring animation using rAF
  let lastTs = null;
  let ringProgress = 1;
  const CIRC = 276.5;
  const ringEl = document.getElementById('timerRingFill');
  function animateRing(ts) {
    if (!isResting) return;
    if (isPaused) { lastTs = null; requestAnimationFrame(animateRing); return; }
    if (lastTs !== null) {
      const dt = (ts - lastTs) / 1000;
      ringProgress = Math.max(0, ringProgress - dt / sec);
      if (ringEl) ringEl.style.strokeDashoffset = CIRC * (1 - ringProgress);
    }
    lastTs = ts;
    if (ringProgress > 0) requestAnimationFrame(animateRing);
  }
  requestAnimationFrame(animateRing);

  _restItv = setInterval(() => {
    if (isPaused) return;
    remaining--;
    elapsed++;
    const m = Math.floor(remaining/60), s = remaining%60;
    disp.innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (remaining <= 3 && remaining > 0) playAlarm(2000, .3);
    if (remaining <= 0) {
      clearInterval(_restItv); _restItv = null;
      isResting = false;
      _actualRestUsed += elapsed;
      window._actualRestUsed = _actualRestUsed;
      window._timerRestCompleted = true;
      if (window._currentRestStartMs) {
        window._restTimeWindows.push({ afterBlockIdx: activeBlockIdx, startMs: window._currentRestStartMs, endMs: Date.now() });
        window._currentRestStartMs = null;
      }
      setSwipeMode('finish');
      speak(t('timer.get.ready'));
      // No countdown for blocks after the first
      initBlock();
    }
  }, 1000);
}

function startCountdown() {
  countingDown = true;
  isPaused = false;  // ensure clean state
  let cd = 10;
  const disp = document.getElementById('timerDisplay');
  // Hide play button immediately, show countdown digits
  const play = document.getElementById('timerPlayBtn');
  if (play) play.classList.add('hidden');
  const pause = document.getElementById('timerPauseIcon');
  if (pause) pause.classList.remove('visible');
  // Show first number immediately — prevents 00:00 flash
  disp.classList.remove('timer-hidden');
  disp.innerText = cd; disp.className = 'countdown-red';
  cd--;
  const itv = setInterval(() => {
    if (isPaused) return;
    disp.innerText = cd; disp.className = 'countdown-red';
    if (cd <= 3 && cd > 0) playAlarm(2000, .4);
    if (cd === 1) {
      clearInterval(itv);
      setTimeout(() => {
        playAlarm(2500, .8);
        disp.innerText = 'GO'; disp.className = 'active-green';
        speakWhenReady("Let's go");
        setTimeout(initBlock, 1500);
      }, 1000);
    }
    cd--;
  }, 1000);
}

function initBlock() {
  countingDown = false;
  isPaused = false;  // ensure not paused when block starts
  lastRoundStartSec = 0;
  // Don't reset splits — accumulate across blocks, tagged with block number
  // _roundSplits entries will have block: activeBlockIdx+1
  const all = document.querySelectorAll('.wod-block');
  if (!all[activeBlockIdx]) {
    isRunning = false;
    speak(t('timer.workout.complete'));
    updateTimerOverlay(); return;
  }
  all.forEach(b => b.classList.remove('active-block'));
  const bEl = all[activeBlockIdx]; bEl.classList.add('active-block');
  const mode = bEl.querySelector('.b-mode').value;
  document.getElementById('liveVal').innerText = '0';

  if (mode === 'tabata') {
    tabataRound = 1;
    tabataTotalRounds = parseInt(bEl.querySelector('.b-tab-r').value) || 8;
    tabataPhase = 'work';
    blockSec = parseInt(bEl.querySelector('.b-work').value) || 20;
    document.getElementById('liveTracker').classList.add('hidden-el');
    document.getElementById('emomProgress').classList.add('hidden-el');
    document.getElementById('roundInfo').innerText = `BLOCK ${activeBlockIdx+1} — TABATA | ROUND 1/${tabataTotalRounds} WORK`;
    speak('Round 1, Work');
  } else if (mode === 'emom' || mode === 'exmom') {
    emomRound = 1;
    emomTotalRounds = parseInt(bEl.querySelector('.b-total-int').value) || 15;
    blockSec = parseInt(bEl.querySelector('.b-int').value) || 60;
    document.getElementById('liveTracker').classList.remove('hidden-el');
    document.getElementById('emomProgress').classList.remove('hidden-el');
    document.getElementById('emomProgress').innerText = `${mode === 'exmom' ? t('exmom.interval') : 'INTERVAL'} 1 / ${emomTotalRounds}`;
    if (mode === 'exmom') {
      const stationCount = bEl.querySelectorAll('.movement-block').length || 1;
      const stationIdx = ((emomRound - 1) % stationCount);
      document.getElementById('roundInfo').innerText = `E${stationCount}MOM · ${t('exmom.station')} ${stationIdx + 1} · 1/${emomTotalRounds}`;
      updateActiveWodBlockExmom(bEl, stationIdx);
    } else {
      document.getElementById('roundInfo').innerText = `BLOCK ${activeBlockIdx+1} — EMOM`;
    }
    speak('Interval 1');
  } else {
    if (mode === 'amrap') { blockSec = parseInt(bEl.querySelector('.b-dur').value) * 60; amrapFullTime = blockSec; }
    else if (mode === 'fortime') blockSec = 0;
    document.getElementById('liveTracker').classList.remove('hidden-el');
    document.getElementById('emomProgress').classList.add('hidden-el');
  }
  updateActiveWodBlock();
  updateTimerBlockInfo();
  updateTimerOverlay();
  // Show/hide round FAB
  const fab = document.getElementById('roundFab');
  if (fab) fab.classList.toggle('visible', mode !== 'tabata');
  // Reset round FAB number
  const fabNum = document.getElementById('roundFabNum');
  if (fabNum) fabNum.textContent = '0';
  runEngine();
}

function runEngine() {
  // rAF-based timer engine — frame-accurate ring + drift-free 1s ticks
  let _lastTickTime = performance.now();
  let _lastSecond = blockSec;
  let _rafRunning = true;

  if (timerItv?.cancel) timerItv.cancel(); else clearInterval(timerItv);
  timerItv = { cancel: () => { _rafRunning = false; } };

  function _engineFrame(now) {
    if (!_rafRunning) return;
    requestAnimationFrame(_engineFrame);
    if (isPaused) { _lastTickTime = now; return; }

    const bEl = document.querySelectorAll('.wod-block')[activeBlockIdx];
    if (!bEl) { _rafRunning = false; return; }
    const mode = bEl.querySelector('.b-mode').value;

    const elapsed = now - _lastTickTime;

    // ── TABATA (second-accurate) ──
    if (mode === 'tabata') {
      if (elapsed >= 1000) {
        _lastTickTime = now - (elapsed % 1000);
        blockSec--;
        totalSessionSec++;
        const ws = parseInt(bEl.querySelector('.b-work').value) || 20;
        const rs = parseInt(bEl.querySelector('.b-rest').value) || 10;
        const hr = Math.ceil(tabataTotalRounds / 2);
        if (blockSec === 3 || blockSec === 2 || blockSec === 1) playAlarm(2000, .4);
        if (blockSec <= 0) {
          if (tabataPhase === 'work') {
            tabataPhase = 'rest'; blockSec = rs; playAlarm(1800, .5);
            _lastTickTime = now; // reset elapsed on phase change
            speak(tabataRound === hr ? 'Halfway, Rest' : 'Rest');
          } else {
            tabataRound++;
            if (tabataRound > tabataTotalRounds) { _rafRunning = false; finishCurrentBlock(); return; }
            tabataPhase = 'work'; blockSec = ws; playAlarm(2500, .6);
            _lastTickTime = now; // reset elapsed on phase change
            speak(tabataRound === Math.ceil(tabataTotalRounds/2)+1 ? `Last half, Round ${tabataRound}, Work` : `Round ${tabataRound}, Work`);
          }
        }
        const m = Math.floor(blockSec/60), s = blockSec%60;
        document.getElementById('timerDisplay').innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        document.getElementById('timerDisplay').className = tabataPhase === 'rest' ? 'countdown-red' : '';
        document.getElementById('roundInfo').innerText = `BLOCK ${activeBlockIdx+1} — TABATA | ROUND ${tabataRound}/${tabataTotalRounds} ${tabataPhase.toUpperCase()}`;
      }
      // Smooth ring every frame — use corrected elapsed after possible phase reset
      const phaseLen = tabataPhase === 'work' ? (parseInt(bEl.querySelector('.b-work').value)||20) : (parseInt(bEl.querySelector('.b-rest').value)||10);
      const correctedElapsed = now - _lastTickTime;
      const smoothSec = Math.max(0, blockSec - (correctedElapsed % 1000) / 1000);
      updateTimerRing(Math.max(0, Math.min(1, smoothSec / phaseLen)), tabataPhase === 'rest' ? 'rest' : (blockSec <= 3 ? 'danger' : ''));
      return;
    }

    // ── FORTIME / AMRAP / EMOM ──
    if (elapsed >= 1000) {
      _lastTickTime = now - (elapsed % 1000);
      totalSessionSec++;
      if (mode === 'fortime') blockSec++; else blockSec--;
      if (mode !== 'emom') document.getElementById('emomProgress').classList.add('hidden-el');
      if (mode === 'exmom') document.getElementById('emomProgress').classList.remove('hidden-el');

      // EMOM / EXMOM interval cycling
      if ((mode === 'emom' || mode === 'exmom') && blockSec <= 0) {
        if (emomRound >= emomTotalRounds) { _rafRunning = false; finishCurrentBlock(); return; }
        const intLen = parseInt(bEl.querySelector('.b-int').value) || 60;
        const lr = document.getElementById('timerLastRound');
        if (lr) lr.textContent = `✓ ${mode === 'exmom' ? t('exmom.interval') : 'Interval'} ${emomRound} complete`;
        emomRound++;
        blockSec = intLen;
        lastRoundStartSec = 0;
        _lastTickTime = now;
        playAlarm(2500, .4);
        const isLast = emomRound === emomTotalRounds;
        const isHalf = emomRound === Math.ceil(emomTotalRounds / 2);
        if (mode === 'exmom') {
          const stationCount = bEl.querySelectorAll('.movement-block').length || 1;
          const stationIdx = ((emomRound - 1) % stationCount);
          document.getElementById('emomProgress').innerText = `${t('exmom.interval')} ${emomRound} / ${emomTotalRounds}`;
          document.getElementById('roundInfo').innerText = `E${stationCount}MOM · ${t('exmom.station')} ${stationIdx + 1} · ${emomRound}/${emomTotalRounds}`;
          updateActiveWodBlockExmom(bEl, stationIdx);
          speak(isLast ? `Last interval, station ${stationIdx+1}` : isHalf ? `Halfway, station ${stationIdx+1}` : `Interval ${emomRound}, station ${stationIdx+1}`);
        } else {
          document.getElementById('emomProgress').innerText = `INTERVAL ${emomRound} / ${emomTotalRounds}`;
          speak(isLast ? `Last interval, interval ${emomRound}` : isHalf ? `Halfway, interval ${emomRound}` : `Interval ${emomRound}`);
        }
      }

      // AMRAP halfway
      if (mode === 'amrap' && blockSec === Math.floor(amrapFullTime / 2)) speak(t('timer.halfway'));
      // AMRAP last 10 seconds
      if ((mode === 'amrap' || mode === 'emom' || mode === 'exmom') && blockSec > 0 && blockSec <= 10) {
        playAlarm(2000, .3);
        if (blockSec === 10) speak('Ten seconds');
      }
      // ForTime halfway
      const capSec = (parseInt(bEl.querySelector('.b-cap').value)||15)*60;
      if (mode === 'fortime' && blockSec === Math.floor(capSec / 2)) speak(t('timer.halfway'));
      // ForTime last 10 seconds
      if (mode === 'fortime' && blockSec >= capSec - 10 && blockSec <= capSec) playAlarm(2000, .3);

      // EMOM Interruptor
      if (bEl.querySelector('.emom-accordion')?.classList.contains('open') && blockSec > 0 && totalSessionSec % parseInt(bEl.querySelector('.int-sec').value || 60) === 0) {
        const ef = bEl.querySelector('.res-emom');
        ef.value = parseInt(ef.value || 0) + parseInt(bEl.querySelector('.int-reps').value || 0);
        speak('Interruption'); playAlarm(2500, .6);
      }

      const m = Math.floor(Math.abs(blockSec)/60), s = Math.abs(blockSec)%60;
      document.getElementById('timerDisplay').innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      document.getElementById('timerDisplay').className = '';
      if (mode !== 'exmom') {
        document.getElementById('roundInfo').innerText = `BLOCK ${activeBlockIdx+1} — ${mode.toUpperCase()}`;
      }

      // EMOM/EXMOM next-interval banner
      if (mode === 'emom' || mode === 'exmom') {
        const banner = document.getElementById('emomNextBanner');
        if (banner && blockSec > 0 && blockSec <= 10) {
          banner.textContent = `Next interval in ${blockSec}s`;
          banner.classList.add('pulsing');
        } else if (banner) { banner.textContent = ''; banner.classList.remove('pulsing'); }
      }

      if (mode !== 'fortime' && mode !== 'emom' && mode !== 'exmom' && blockSec <= 0) { _rafRunning = false; finishCurrentBlock(); return; }
      if (mode === 'fortime' && blockSec >= capSec) { _rafRunning = false; finishCurrentBlock(capSec); return; }
    }

    // ── Smooth ring update every frame ──
    const intLen = parseInt(bEl.querySelector('.b-int')?.value) || 60;
    const capSec = mode === 'fortime' ? (parseInt(bEl.querySelector('.b-cap').value)||15)*60
                 : mode === 'amrap'   ? amrapFullTime
                 : (mode === 'emom' || mode === 'exmom') ? intLen : Math.max(1, blockSec);
    // Use corrected elapsed (accounts for phase resets)
    const correctedElapsed2 = now - _lastTickTime;
    const fracElapsed = (correctedElapsed2 % 1000) / 1000;
    let smoothSec;
    if (mode === 'fortime') {
      smoothSec = blockSec + fracElapsed;
    } else {
      smoothSec = Math.max(0, blockSec - fracElapsed);
    }
    const progress = mode === 'fortime'
      ? Math.min(1, Math.max(0, smoothSec / capSec))
      : Math.max(0, Math.min(1, smoothSec / capSec));
    const isDanger = (mode === 'fortime' && smoothSec >= capSec - 10)
                  || (mode !== 'fortime' && smoothSec > 0 && smoothSec <= 10);
    updateTimerRing(progress, isDanger ? 'danger' : '');
  }

  requestAnimationFrame(_engineFrame);
}

// capDurationSec: optional — see the _blockTimeWindows.push() comment
// below for why this exists (clamps a capped FORTIME block's recorded
// end time to the actual cap boundary rather than whenever this
// function happens to run).
function finishCurrentBlock(capDurationSec) {
  const bEl = document.querySelectorAll('.wod-block')[activeBlockIdx];
  if (bEl) {
    const mode = bEl.querySelector('.b-mode').value;
    // Always use actual elapsed timer time regardless of modality
    let elapsedSec;
    if (mode === 'fortime') {
      elapsedSec = Math.abs(blockSec);
    } else if (mode === 'amrap') {
      elapsedSec = amrapFullTime - blockSec;
    } else {
      // EMOM and Tabata: use totalSessionSec — counts every second from start
      elapsedSec = totalSessionSec;
    }
    bEl.querySelector('.res-m').value = Math.floor(elapsedSec / 60);
    bEl.querySelector('.res-s').value = elapsedSec % 60;
    // Mark as timer-set so autoPopulateResultTime doesn't overwrite with cap time
    const rm = bEl.querySelector('.res-m');
    const rs = bEl.querySelector('.res-s');
    if (rm) rm.dataset.userSet = '1';
    if (rs) rs.dataset.userSet = '1';
    // Sync picker trigger displays in the detail panel if open
    syncResultPickerDisplays(bEl);
    autoSave();
  }
  if (timerItv?.cancel) timerItv.cancel(); else if (timerItv?.cancel) timerItv.cancel(); else clearInterval(timerItv);
  const _finishedBlockIdx = activeBlockIdx;
  // capDurationSec, when passed (currently only the FORTIME cap-hit
  // path above does), clamps this block's recorded end time to exactly
  // startMs + capDurationSec — not whenever this line of code actually
  // executes. Date.now() alone drifts from the real cap boundary
  // whenever there's any delay between the cap being crossed and this
  // running — a backgrounded tab/locked screen throttles the
  // requestAnimationFrame loop that detects the cap, so that delay can
  // be real seconds, not just a frame or two. Without this, a block
  // scored as an exact 15:00 cap could get 15:37 of segment data
  // (HR/cardio-toggle time) attributed to it — genuinely more seconds
  // of tracked data than the scored block ever contained. Manual/early
  // finishes (every other call site) pass nothing and keep the real
  // Date.now(), since that IS the correct end time when the athlete
  // actually decided to stop.
  const _endMs = capDurationSec != null
    ? Math.min(Date.now(), window._hrBlockStartMs + capDurationSec * 1000)
    : Date.now();
  window._blockTimeWindows.push({ blockIdx: _finishedBlockIdx, startMs: window._hrBlockStartMs, endMs: _endMs });
  activeBlockIdx++;
  window._hrBlockStartMs = Date.now();
  // The undo above is scoped to a specific blockIdx and refuses to act
  // once activeBlockIdx has moved on (see undoLastRoundTap), but the
  // button itself would otherwise stay visibly shown into the next
  // block if the athlete never tapped it — hide it explicitly here.
  window._lastRoundTapUndo = null;
  const _undoBtnFinish = document.getElementById('roundFabUndo');
  if (_undoBtnFinish) _undoBtnFinish.style.display = 'none';
  const lr = document.getElementById('timerLastRound'); if (lr) lr.textContent = '';
  if (document.querySelectorAll('.wod-block')[activeBlockIdx]) {
    const restSec = getRestDuration();
    if (restSec > 0) {
      setSwipeMode('skip-rest');
      startRestCountdown(restSec);
    } else {
      setSwipeMode('finish');
      startCountdown();
    }
  } else { isRunning = false; sessionEnded = true; releaseWakeLock(); speak('Finish'); _watchControlStop();
    const fab2 = document.getElementById('roundFab'); if (fab2) fab2.classList.remove('visible');
    setSwipeMode('reset');
    renderTimerResults();
  }
  updateTimerOverlay();
}

let _lastRepTapMs = 0;
// ══ Per-movement cardio interval capture (Run/Row/DU) ══
// Real start/stop timing per movement instead of PR-pace estimation.
// window._cardioIntervals accumulates {movement, blockIdx, startMs, endMs,
// durationSec} records for the current session; reset at the start of
// each new timer session. Not yet wired into the overhead/HR calculation
// — that's the next step, once real interval data exists to test against.
window._cardioIntervals = [];
window._cardioActiveStart = {}; // { run: startMs, row: startMs, du: startMs }

function _cardioResetIntervals() {
  window._cardioIntervals = [];
  window._cardioActiveStart = {};
  try { localStorage.removeItem(CARDIO_INTERVALS_KEY); } catch (e) {}
  ['run', 'row', 'du', 'ski', 'bike'].forEach(type => {
    const btn = document.getElementById(type === 'row' ? 'cardio-toggle-row-btn' : `cardio-toggle-${type}`);
    if (btn) btn.classList.remove('active');
  });
  const logEl = document.getElementById('cardio-interval-log');
  if (logEl) logEl.innerHTML = '';
}

// Shows only the toggle buttons for cardio movements actually present in
// this session's blocks — no Row button for a session with no rowing.
function _cardioDetectMovements() {
  const present = { run: false, row: false, du: false, ski: false, bike: false };
  document.querySelectorAll('.wod-block').forEach(block => {
    block.querySelectorAll('.movement-block').forEach(mv => {
      const key = mv.querySelector('input[type="hidden"]')?.value;
      const cardioType = key ? MASTER_DB[key]?.cardio : null;
      if (cardioType && cardioType in present) present[cardioType] = true;
    });
  });
  const runBtn = document.getElementById('cardio-toggle-run');
  const rowBtn = document.getElementById('cardio-toggle-row-btn');
  const duBtn = document.getElementById('cardio-toggle-du');
  const skiBtn = document.getElementById('cardio-toggle-ski');
  const bikeBtn = document.getElementById('cardio-toggle-bike');
  const container = document.getElementById('cardio-toggle-row');
  const logEl = document.getElementById('cardio-interval-log');
  const anyPresent = present.run || present.row || present.du || present.ski || present.bike;
  if (runBtn) runBtn.style.display = present.run ? '' : 'none';
  if (rowBtn) rowBtn.style.display = present.row ? '' : 'none';
  if (duBtn) duBtn.style.display = present.du ? '' : 'none';
  if (skiBtn) skiBtn.style.display = present.ski ? '' : 'none';
  if (bikeBtn) bikeBtn.style.display = present.bike ? '' : 'none';
  if (container) container.style.display = anyPresent ? 'flex' : 'none';
  if (logEl) logEl.style.display = anyPresent ? '' : 'none';
}

const CARDIO_INTERVALS_KEY = 'wod_cardio_intervals_inprogress';

function _cardioToggle(type) {
  const btnId = type === 'row' ? 'cardio-toggle-row-btn' : `cardio-toggle-${type}`;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const logEl = document.getElementById('cardio-interval-log');
  if (window._cardioActiveStart[type]) {
    // Deactivate — record the completed interval
    const startMs = window._cardioActiveStart[type];
    const endMs = Date.now();
    const durationSec = (endMs - startMs) / 1000;
    window._cardioIntervals.push({ movement: type, blockIdx: activeBlockIdx, startMs, endMs, durationSec });
    delete window._cardioActiveStart[type];
    btn.classList.remove('active');
    if (logEl) logEl.innerHTML = `${type.toUpperCase()}: ${durationSec.toFixed(1)}s (block ${activeBlockIdx})<br>` + logEl.innerHTML;
    if (typeof _hrUpdateStatsDisplay === 'function') _hrUpdateStatsDisplay();
  } else {
    // Activate — but first deactivate any OTHER cardio type that's
    // currently active. You can't physically run and row at the same
    // time, so these must be mutually exclusive, same reasoning as the
    // round-counter auto-deactivating whichever one is active.
    Object.keys(window._cardioActiveStart).forEach(otherType => {
      if (otherType !== type) _cardioToggle(otherType);
    });
    window._cardioActiveStart[type] = Date.now();
    btn.classList.add('active');
    if (logEl) logEl.innerHTML = `${type.toUpperCase()}: started…<br>` + logEl.innerHTML;
  }
  // Persist immediately — a reload (confirmed to happen readily when
  // backgrounding this app) previously wiped this array completely,
  // since it only ever lived in memory. Captured intervals now survive
  // even though the running Timer session itself still doesn't (see the
  // separate, larger gap in saveWorkoutState()/restoreWorkoutState()).
  try {
    localStorage.setItem(CARDIO_INTERVALS_KEY, JSON.stringify({
      intervals: window._cardioIntervals,
      activeStart: window._cardioActiveStart,
      savedAt: Date.now()
    }));
  } catch (e) {}
}

// Called once on page load. Doesn't attempt to resume a live session —
// that would need the Timer's own running state (isRunning, elapsed
// time, active block) to also survive a reload, which it currently
// doesn't. What this DOES do: recover any intervals that were captured
// before an unexpected reload, so they're not silently lost, and make
// their existence visible rather than assuming they're gone.
function _cardioRecoverInterrupted() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(CARDIO_INTERVALS_KEY) || 'null'); } catch (e) { return; }
  if (!saved || !saved.intervals || !saved.intervals.length) return;
  const ageMin = ((Date.now() - saved.savedAt) / 60000).toFixed(1);
  _hrLog(`Recovered ${saved.intervals.length} cardio interval(s) from ${ageMin} min ago (interrupted session) — Timer itself did not resume, but this data was not lost.`);
  window._recoveredCardioIntervals = saved.intervals; // kept separate from the new session's own array, not auto-merged
}
window.addEventListener('load', _cardioRecoverInterrupted);

// Closes out any still-active cardio toggle at the exact moment a round
// is logged — a forgotten stop-tap shouldn't bleed into whatever comes
// next in the round.
function _cardioAutoDeactivateAll() {
  Object.keys(window._cardioActiveStart).forEach(type => _cardioToggle(type));
}

// ══ Watch round-count control (Garmin Music Controls → Media Session) ══
// A watch's Play/Pause buttons send standard Bluetooth AVRCP media
// commands to whatever app currently holds "media focus" on the phone.
// A silent, looping audio element (see #watch-control-audio) held
// playing for the session's duration claims that focus, and the Media
// Session API lets this page receive the button presses. Both Play and
// Pause map to the same round-log action, since AVRCP just toggles
// play/pause state and a press in either direction should register.
//
// This previously failed silently with no way to confirm whether the
// page ever actually held focus at all before Spotify took over on a
// button press — that ambiguity made the earlier test result
// unverifiable. #watch-control-status now shows explicitly whether the
// audio is actually playing and whether Media Session registered
// successfully, checked a moment after starting (not just assumed).
function _watchControlStart() {
  const statusEl = document.getElementById('watch-control-status');
  if (statusEl) statusEl.style.display = '';
  const audio = document.getElementById('watch-control-audio');
  if (!audio) { if (statusEl) statusEl.innerHTML = '❌ Watch control: audio element missing'; return; }
  if (!('mediaSession' in navigator)) {
    if (statusEl) statusEl.innerHTML = '❌ Watch control: Media Session API not supported in this browser';
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'WOD Architect — Timer Running',
    artist: 'Press Play/Pause on your watch to log a round'
  });
  navigator.mediaSession.playbackState = 'playing';
  navigator.mediaSession.setActionHandler('play', () => { incrementLiveRep(); navigator.mediaSession.playbackState = 'playing'; _watchControlLogPress(); });
  navigator.mediaSession.setActionHandler('pause', () => { incrementLiveRep(); navigator.mediaSession.playbackState = 'playing'; _watchControlLogPress(); });

  const playPromise = audio.play();
  if (statusEl) statusEl.innerHTML = '🔄 Watch control: starting…';
  Promise.resolve(playPromise).then(() => {
    // Verify a moment later, not immediately — some browsers report
    // success before playback state has actually settled.
    setTimeout(() => {
      if (!statusEl) return;
      if (audio.paused) {
        statusEl.innerHTML = '⚠️ Watch control: audio reports playing but is paused — focus may not be held. Check your phone\'s lock screen media widget: does it show "WOD Architect"?';
      } else {
        statusEl.innerHTML = '✅ Audio playing locally (6s clip, past Chrome\'s 5s minimum for real OS focus). This does NOT by itself confirm Android granted system-level focus — check your notification shade or lock screen for a media widget showing "WOD Architect" before testing the watch.';
      }
    }, 500);
  }).catch(err => {
    if (statusEl) statusEl.innerHTML = `❌ Watch control: audio.play() failed — ${err.name}: ${err.message}`;
  });
}
function _watchControlLogPress() {
  const statusEl = document.getElementById('watch-control-status');
  if (statusEl) statusEl.innerHTML = `✅ Watch button press received at ${new Date().toLocaleTimeString()} — round logged`;
}
function _watchControlStop() {
  const audio = document.getElementById('watch-control-audio');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.playbackState = 'none';
  }
  const statusEl = document.getElementById('watch-control-status');
  if (statusEl) statusEl.style.display = 'none';
}

function incrementLiveRep() {
  if (!isRunning || isPaused) return;
  const now = Date.now();
  if (now - _lastRepTapMs < 800) return; // debounce — ignore taps within 800ms
  _lastRepTapMs = now;
  // Snapshot for undo — captured before anything below changes, and
  // scoped to this specific block (activeBlockIdx) so a stale undo
  // can't accidentally apply after the block has already changed.
  // One-shot: only the single most recent tap can be undone, not a
  // full history of taps.
  window._lastRoundTapUndo = {
    blockIdx: activeBlockIdx,
    prevLiveVal: document.getElementById('liveVal')?.innerText,
    prevLastRoundStartSec: lastRoundStartSec
  };
  const undoBtn = document.getElementById('roundFabUndo');
  if (undoBtn) undoBtn.style.display = 'flex';
  _cardioAutoDeactivateAll();
  const v = document.getElementById('liveVal');
  v.innerText = parseInt(v.innerText) + 1;
  const bEl = document.querySelectorAll('.wod-block')[activeBlockIdx];
  if (bEl) { bEl.querySelector('.res-r').value = v.innerText; syncResultPickerDisplays(bEl); autoSave(); }
  // Update FAB number + flash
  const fabNum = document.getElementById('roundFabNum');
  const fab = document.getElementById('roundFab');
  if (fabNum) fabNum.textContent = v.innerText;
  if (fab) { fab.style.transform = 'translate(50%,50%) scale(1.18)'; setTimeout(() => { fab.style.transform = 'translate(50%,50%)'; }, 150); }
  // Record round duration (elapsed since last round tap)
  const bElR = document.querySelectorAll('.wod-block')[activeBlockIdx];
  const modeR = bElR?.querySelector('.b-mode')?.value || 'amrap';
  // Calculate elapsed seconds at this moment
  const bElR2 = document.querySelectorAll('.wod-block')[activeBlockIdx];
  const intLen = modeR === 'emom' ? (parseInt(bElR2?.querySelector('.b-int')?.value) || 60) : 0;
  const elapsedNow = modeR === 'fortime' ? blockSec
                   : (modeR === 'emom' || modeR === 'exmom') ? (intLen - blockSec)
                   : (amrapFullTime - blockSec);
  const roundDurSec = elapsedNow - lastRoundStartSec;
  lastRoundStartSec = elapsedNow;
  const rd = Math.abs(roundDurSec);
  const rm = Math.floor(rd / 60), rs2 = rd % 60;
  const lr = document.getElementById('timerLastRound');
  if (lr) lr.textContent = `Last round: ${String(rm).padStart(2,'0')}:${String(rs2).padStart(2,'0')}`;
  // Store split
  const roundNum = parseInt(document.getElementById('liveVal')?.innerText) || 1;
  _roundSplits.push({ block: activeBlockIdx + 1, round: roundNum, splitSec: Math.abs(roundDurSec), cumSec: Math.abs(elapsedNow) });
  // Auto-stop when prescribed rounds reached (ForTime blocks only)
  if (modeR === 'fortime' && bElR) {
    const repSeq = getLadderSequence(bElR);
    const targetR = repSeq ? repSeq.length : (parseInt(bElR.querySelector('.b-target')?.value) || 0);
    if (targetR > 0 && roundNum >= targetR) {
      setTimeout(() => finishCurrentBlock(), 150); // brief delay so the round flash completes
    }
  }
}

// Undoes exactly the one most recent incrementLiveRep() tap — round
// count, FAB display, and the split log entry it added. One-shot: the
// undo button hides itself after use, and window._lastRoundTapUndo is
// cleared, so it can't be pressed twice for the same tap or reused
// after a different round has since been logged.
//
// Does NOT reverse a block auto-finish that tap may have triggered
// (see incrementLiveRep's auto-stop check right above) — if the
// mistaken tap happened to be the block's last prescribed round, the
// block may already be finished by the time this runs. Resuming an
// already-finished block is a much larger, riskier change than
// correcting a round count, and isn't what this handles; the existing
// Edit Entry flow in the History Modal is the way to fix a result
// after the fact in that case.
function undoLastRoundTap() {
  const u = window._lastRoundTapUndo;
  if (!u || u.blockIdx !== activeBlockIdx) return; // nothing to undo, or the block has since changed
  const v = document.getElementById('liveVal');
  if (v) v.innerText = u.prevLiveVal;
  lastRoundStartSec = u.prevLastRoundStartSec;
  const bEl = document.querySelectorAll('.wod-block')[activeBlockIdx];
  if (bEl) { bEl.querySelector('.res-r').value = u.prevLiveVal; syncResultPickerDisplays(bEl); autoSave(); }
  const fabNum = document.getElementById('roundFabNum');
  if (fabNum) fabNum.textContent = u.prevLiveVal;
  // Remove the split entry this specific tap added — always the last
  // one pushed for this block, since undo only ever targets the single
  // most recent tap.
  if (_roundSplits.length && _roundSplits[_roundSplits.length - 1].block === activeBlockIdx + 1) {
    _roundSplits.pop();
  }
  const lr = document.getElementById('timerLastRound');
  if (lr) lr.textContent = '';
  window._lastRoundTapUndo = null;
  const undoBtn = document.getElementById('roundFabUndo');
  if (undoBtn) undoBtn.style.display = 'none';
}

/* Sync result picker trigger labels in detail panel to match hidden block values */
function syncResultPickerDisplays(bEl) {
  if (!bEl || _openBlockId !== bEl.id) return;
  const body = document.getElementById('block-detail-body');
  if (!body) return;
  // For each result field, find the matching trigger in the detail panel and update its label
  [["res-r",t('result.rounds.done')],["res-x",t('builder.extra.reps')],["res-m",t('result.final.time')+' — '+t('cal.days').split(',')[0]],["res-s",t('result.final.time')+' — sec'],["res-emom",'EMOM Penalty Total']].forEach(([cls, label]) => {
    const srcVal = bEl.querySelector('.' + cls)?.value;
    if (srcVal === undefined) return;
    const trigger = body.querySelector(`.picker-trigger[data-label="${label}"]`);
    if (trigger) {
      trigger.querySelector('.picker-trigger-val').textContent = formatPickerVal(parseFloat(srcVal)||0, label);
      const inp = trigger.querySelector('input[type="number"]');
      if (inp) inp.value = srcVal;
    }
  });
}

// ── Timer Settings toggle ──

function toggleTimerSettings() {
  const panel = document.getElementById('timer-settings-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isHidden ? 'block' : 'none';
}
/* ════════════════════════════════════════════════════
   AUDIO — speech + alarm tones
════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

let _voicePitch = parseFloat(localStorage.getItem('wod-voice-pitch') || '1.0');
let _voiceRate  = parseFloat(localStorage.getItem('wod-voice-rate')  || '1.0');

function adjustVoice(param, delta) {
  if (param === 'pitch') {
    _voicePitch = Math.round(Math.max(0.5, Math.min(2.0, _voicePitch + delta)) * 10) / 10;
    localStorage.setItem('wod-voice-pitch', _voicePitch);
    const el = document.getElementById('voicePitchVal');
    if (el) el.textContent = _voicePitch.toFixed(1);
  } else {
    _voiceRate = Math.round(Math.max(0.5, Math.min(2.0, _voiceRate + delta)) * 10) / 10;
    localStorage.setItem('wod-voice-rate', _voiceRate);
    const el = document.getElementById('voiceRateVal');
    if (el) el.textContent = _voiceRate.toFixed(1);
  }
  // Preview with new settings
  speak(t('timer.countdown'));
}

// iOS audio unlock — create and resume AudioContext on first user interaction
function unlockAudio() {
  getAudioCtx(); // creates and resumes in one call
  // Also unlock speech synthesis on iOS with a silent utterance
  if (window.speechSynthesis) {
    const silent = new SpeechSynthesisUtterance('');
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  }
  document.removeEventListener('touchstart', unlockAudio);
  document.removeEventListener('touchend', unlockAudio);
  document.removeEventListener('click', unlockAudio);
}
document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
document.addEventListener('touchend',   unlockAudio, { once: true, passive: true });
document.addEventListener('click',      unlockAudio, { once: true, passive: true });

function speak(t) {
  if (!voiceEnabled) return;
  window.speechSynthesis.cancel();
  const m = new SpeechSynthesisUtterance(t);
  const vs = window.speechSynthesis.getVoices();
  const selectedName = localStorage.getItem('wod-voice-name') || '';
  const appLang = localStorage.getItem('wod-lang') || 'en';
  let voice = null;
  // Use saved voice if set
  if (selectedName) voice = vs.find(v => v.name === selectedName);
  if (!voice) {
    if (appLang === 'es') {
      // Prefer Spanish voice
      voice = vs.find(v => v.lang.startsWith('es') && /female|woman|paulina|mónica|jorge|juan/i.test(v.name))
            || vs.find(v => v.lang.startsWith('es'));
    }
    // Fall back to English voice
    if (!voice) {
      voice = vs.find(v => v.lang.startsWith('en') && /female|woman|samantha|karen|victoria|zira|susan|fiona|moira|tessa/i.test(v.name))
            || vs.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('male'));
    }
  }
  if (voice) { m.voice = voice; m.lang = voice.lang; }
  else { m.lang = appLang === 'es' ? 'es-ES' : 'en-US'; }
  m.pitch  = _voicePitch;
  m.rate   = _voiceRate;
  window.speechSynthesis.speak(m);
}

function populateVoiceSelector() {
  const vs = window.speechSynthesis.getVoices();
  const saved = localStorage.getItem('wod-voice-name') || '';
  const label = document.getElementById('voiceSelectLabel');
  if (label && saved) {
    const v = vs.find(v => v.name === saved);
    if (v) label.textContent = v.name.split(' ')[0]; // show first word only
  }
}

function openVoicePicker() {
  const vs = window.speechSynthesis.getVoices();
  const appLang = localStorage.getItem('wod-lang') || 'en';
  const langPrefix = appLang === 'es' ? 'es' : 'en';
  const langVoices = [{name:'', lang:''}].concat(vs.filter(v => v.lang.startsWith(langPrefix)));
  const saved = localStorage.getItem('wod-voice-name') || '';
  const curIdx = langVoices.findIndex(v => v.name === saved) || 0;

  const overlay = document.getElementById('pickerOverlay');
  overlay._voicePicker = true;
  overlay._voiceValues = langVoices.map(v => v.name);
  overlay._customCallback = (idx) => {
    const val = overlay._voiceValues[idx] || '';
    localStorage.setItem('wod-voice-name', val);
    const label = document.getElementById('voiceSelectLabel');
    if (label) label.textContent = val ? val.split(' ')[0] : t('voice.default');
    overlay._voicePicker = false;
    overlay._voiceValues = null;
    // Preview the voice
    if (val) setTimeout(() => speak(t('timer.countdown')), 100);
  };

  document.getElementById('pickerLabel').textContent = t('voice.select');
  const drum = document.getElementById('pickerDrum');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  langVoices.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v.name === saved ? ' selected' : '');
    item.dataset.optval = i;
    item.textContent = v.name ? `${v.name} (${v.lang})` : t('voice.default');
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  drum.scrollTop = Math.max(0, curIdx) * 44;
  drum.onscroll = () => { clearTimeout(_pickerScrollTimeout); _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80); };

  overlay._trigger = document.getElementById('voiceSelectBtn');
  overlay._profField = null;
  overlay.classList.add('open');
}

function saveVoicePreference() {
  const sel = document.getElementById('voiceSelect');
  if (sel) localStorage.setItem('wod-voice-name', sel.value);
}
function speakWhenReady(t) {
  if (window.speechSynthesis.getVoices().length > 0) { speak(t); return; }
  window.speechSynthesis.onvoiceschanged = () => { populateVoiceSelector(); speak(t); window.speechSynthesis.onvoiceschanged = null; };
}
function playAlarm(freq, dur) {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') { ctx.resume().then(() => playAlarm(freq, dur)); return; }
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, ctx.currentTime);
  g.gain.setValueAtTime(0.1, ctx.currentTime);
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + dur);
}

