/* ════════════════════════════════════════════════════
   HISTORY
   Core persistence (getHistory/saveHistory), the RPE
   modal, the full save-to-history orchestration flow,
   filter/sort/calendar UI, and the history list, detail
   modal, and edit flow.
════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════
   HISTORY — localStorage persistence
════════════════════════════════════════════════════ */
const HIST_KEY = 'wod_architect_history';
function getHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch(e) { return []; } }

// Color-code intensity (W/kg) relative to recent 6-week history
function getPDColor(pd) {
  if (!pd || isNaN(parseFloat(pd))) return 'var(--text)';
  const val = parseFloat(pd);
  const hist = getHistory();
  const sixWeeksAgo = Date.now() - 42*24*60*60*1000;
  // Compute Total Power fresh from each session rather than reading the
  // stored pd field directly — that field is an inconsistent mix of
  // mechanical-only (older sessions) and Total Power (sessions saved after
  // today's fix), which would otherwise produce meaningless percentiles.
  const recent = hist.filter(w => w.date && new Date(w.date) >= sixWeeksAgo)
                     .map(w => { const p = getSessionPower(w); return p ? p.total : 0; }).filter(v => v > 0);
  if (recent.length < 3) {
    // Fallback to fixed thresholds if not enough history — rescaled for
    // Total Power (roughly 4-5x the old mechanical-only scale in practice).
    return val >= 8.0 ? '#EF4444' : val >= 5.0 ? '#F59E0B' : '#22C55E';
  }
  const sorted = [...recent].sort((a,b) => a-b);
  const p33 = sorted[Math.floor(sorted.length * 0.33)];
  const p66 = sorted[Math.floor(sorted.length * 0.66)];
  return val >= p66 ? '#EF4444' : val >= p33 ? '#F59E0B' : '#22C55E';
}
function saveHistory(arr) { localStorage.setItem(HIST_KEY, JSON.stringify(arr)); }

/* ════════════════════════════════════════════════════
   RPE — Rate of Perceived Exertion
   Scale: 1 (rest) → 10 (absolute maximum)
   Stored per entry as entry.rpe (integer 1-10)
   Modifies Training Load: pd_adjusted = pd * (rpe/7)
   so a hard session counts more than an easy one.
════════════════════════════════════════════════════ */
const RPE_LABELS = {
  1: 'Very Easy — barely moving',
  2: 'Easy — comfortable pace',
  3: 'Light — could hold a conversation',
  4: 'Moderate-Light — slightly breathing hard',
  5: 'Moderate — aware of the effort',
  6: 'Moderate-Hard — challenging but controlled',
  7: 'Hard — difficult to speak in sentences',
  8: 'Very Hard — only a few words possible',
  9: 'Extremely Hard — near maximum',
  10: 'Maximum — absolute all-out effort'
};

const RPE_COLORS = {
  1:'#9CA3AF', 2:'#9CA3AF', 3:'#22C55E', 4:'#22C55E',
  5:'#3B82F6', 6:'#3B82F6', 7:'#F59E0B', 8:'#F59E0B',
  9:'#EF4444', 10:'#EF4444'
};

let _rpePendingCallback = null;

function showRPEModal(callback) {
  _rpePendingCallback = callback;
  const slider = document.getElementById('rpe-slider');
  if (slider) slider.value = 5;
  updateRPEDisplay(5);
  document.getElementById('rpe-overlay').classList.add('open');
}

function updateRPEDisplay(val) {
  val = parseInt(val);
  const disp  = document.getElementById('rpe-display');
  const label = document.getElementById('rpe-label-text');
  const color = RPE_COLORS[val] || '#9CA3AF';
  if (disp)  { disp.innerText = val; disp.style.color = color; }
  if (label) { label.innerText = RPE_LABELS[val] || ''; label.style.color = color; }
}

function confirmRPE() {
  const val = parseInt(document.getElementById('rpe-slider')?.value || 5);
  document.getElementById('rpe-overlay').classList.remove('open');
  if (_rpePendingCallback) { _rpePendingCallback(val); _rpePendingCallback = null; }
}

function dismissRPE() {
  document.getElementById('rpe-overlay').classList.remove('open');
  if (_rpePendingCallback) { _rpePendingCallback(null); _rpePendingCallback = null; }
}

function getRPEColor(rpe) { return RPE_COLORS[rpe] || '#9CA3AF'; }

function saveModularToHistory() {
  let lines = [], aggSumTime = 0;

  document.querySelectorAll('.wod-block').forEach((b, i) => {
    const mode = b.querySelector('.b-mode').value.toUpperCase();
    const r = b.querySelector('.res-r').value || '0';
    const x = b.querySelector('.res-x').value || '0';
    const m = b.querySelector('.res-m').value || '0';
    const s = b.querySelector('.res-s').value || '0';
    const e = b.querySelector('.res-emom').value || '0';
    // For fixed-duration modes use block config time, not result fields
    let blockTimeSec;
    if (mode === 'AMRAP') {
      blockTimeSec = (parseInt(b.querySelector('.b-dur')?.value)||0)*60;
    } else if (mode === 'EMOM') {
      blockTimeSec = (parseInt(b.querySelector('.b-total-int')?.value)||0) * (parseInt(b.querySelector('.b-int')?.value)||60);
    } else if (mode === 'TABATA') {
      const tabR = parseInt(b.querySelector('.b-tab-r')?.value)||8;
      blockTimeSec = tabR * 30;
    } else {
      blockTimeSec = (parseInt(m)||0)*60 + (parseInt(s)||0);
    }
    aggSumTime += blockTimeSec;

    let intent = (mode==='FORTIME') ? `${b.querySelector('.b-cap').value}m ${t('mode.cap')} / ${b.querySelector('.b-target').value} ${t('mode.rounds.short')}`
               : (mode==='AMRAP')   ? `${b.querySelector('.b-dur').value}m AMRAP`
               : (mode==='EMOM')    ? `${b.querySelector('.b-total-int').value} × ${b.querySelector('.b-int').value}s EMOM`
               :                      `${b.querySelector('.b-tab-r').value} Rounds Tabata`;

    // Classic WOD name if active
    const cwodAcc = b.querySelector('.classic-accordion');
    const cn = cwodAcc?.classList.contains('open') ? b.querySelector('.cwod-select')?.value : null;
    const cnStr = cn ? ` ★ ${cn}` : '';

    // Ladder scheme
    const ladderSeqD = getLadderSequence(b);
    const ladderStrD = ladderSeqD ? ladderSeqD.join('-') : null;
    const ladderIntentStr = ladderStrD ? ` [${ladderStrD}]` : '';

    lines.push(`Block ${i+1} (${mode}) · ${intent}${cnStr}${ladderIntentStr}`);

    // One line per movement
    b.querySelectorAll('.movement-block').forEach(mv => {
      const name = mv.querySelector('.m-search')?.value || '—';
      if (!name || name === '—') return;
      const repsRaw = parseFloat(mv.querySelector('.m-reps')?.value) || 0;
      const wt      = mv.querySelector('.m-wt')?.value   || '0';
      const wtLabel = wt == 0 ? 'BW' : wt + ' kg';
      let repStr;
      if (mode === 'TABATA') {
        repStr = wtLabel;
      } else if (repsRaw === 999) {
        const entered = parseFloat(mv.querySelector('.m-reps')?.dataset.maxRepsEntered) || 0;
        repStr = `Max reps (${entered > 0 ? entered + ' achieved' : 'not entered'}) @ ${wtLabel}`;
      } else if (ladderStrD) {
        repStr = `${ladderStrD} @ ${wtLabel}`;
      } else {
        repStr = `${repsRaw} reps @ ${wtLabel}`;
      }
      lines.push(`  ${name} | ${repStr}`);
    });

    // EMOM penalty line
    const emomEnabled = b.querySelector('.emom-accordion')?.classList.contains('penalty-on');
    if (emomEnabled) {
      const eKey = b.querySelector('.int-key')?.value || 'Penalty';
      const eWt  = b.querySelector('.int-wt')?.value  || '0';
      const eRps = b.querySelector('.int-reps')?.value || '0';
      const eSec = b.querySelector('.int-sec')?.value  || '60';
      const isBW = b.querySelector('.int-wt')?.disabled || MASTER_DB[eKey]?.type === 'bw';
      const eWtL = isBW ? 'BW' : (parseFloat(eWt) > 0 ? eWt + ' kg' : '0 kg');
      lines.push(`  ⚡ EMOM Penalty: ${eKey} | ${eRps} reps @ ${eWtL} every ${eSec}s → ${e} total reps`);
    }

    // Result line
    const timeStr = mode === 'AMRAP'
      ? `${b.querySelector('.b-dur')?.value || '0'}:00`
      : mode === 'EMOM'
        ? (() => { const emomSec = (parseInt(b.querySelector('.b-total-int')?.value)||0)*(parseInt(b.querySelector('.b-int')?.value)||60); return `${Math.floor(emomSec/60)}:${(emomSec%60).toString().padStart(2,'0')}`; })()
        : `${m}:${(s||'0').padStart(2,'0')}`;
    const resultStr = mode === 'TABATA'
      ? `${t('audit.total.reps')}: ${x}`
      : `${t('audit.result')}: ${r} ${t('audit.rounds')} + ${x} ${t('audit.extra')} | ${t('audit.time')}: ${timeStr}`;
    lines.push(`  ${resultStr}`);
  });

  // pd is simply whatever's already correctly displayed on resPD — no
  // separate calculation needed. This used to route through a different,
  // mc_mech-based formula (window._lastMechKcal), which had two real
  // problems: it used mc_mech's eccentric-multiplied, efficiency-adjusted
  // value rather than the true, pure wd-based Power established
  // elsewhere, and it read window._lastDurationSec/window._lastBodyweight
  // before those were actually set for this calculation (they're
  // assigned later in this same function) — so it was silently using
  // stale values left over from whatever calculation ran previously.
  // Total Power is computed fresh via getSessionPower() everywhere it's
  // actually displayed, so this stored field mattered less than its
  // complexity suggested — reading the display directly removes both
  // bugs at once.
  const pd=document.getElementById('resPD').innerText, wd=document.getElementById('resWD').dataset.precise || document.getElementById('resWD').innerText;
  const mc=document.getElementById('resMC').innerText, fb=document.getElementById('resFB').innerText;
  const restSecSave = (window._timerRestCompleted && window._actualRestUsed > 0)
    ? window._actualRestUsed
    : parseInt(document.querySelector('.res-rest-card .res-rest')?.value || document.getElementById('rest-duration-sec')?.value) || 0;
  const blockCount = document.querySelectorAll('.wod-block').length;
  const restGaps = Math.max(0, blockCount - 1);
  // restSecSave is now total rest (not per gap) when timer was used
  const totalRestSec = (window._timerRestCompleted && window._actualRestUsed > 0)
    ? restSecSave
    : restSecSave * restGaps;
  if (totalRestSec > 0 && restGaps > 0) {
    const restMin = Math.floor(totalRestSec/60), restRemSec = totalRestSec%60;
    const restLabel = restMin > 0 ? `${restMin}:${restRemSec.toString().padStart(2,'0')}` : `${totalRestSec}s`;
    lines.push(`⏸ ${t('res.total.rest')}: ${restLabel}`);
    aggSumTime += totalRestSec;
  }
  const aggStr = `${Math.floor(aggSumTime/60)}:${(aggSumTime%60).toString().padStart(2,'0')}`;
  lines.push(`${t('audit.agg.time')}: ${aggStr}`);
  // Physics stored in separate entry fields — not duplicated in detail text

  const detail = lines.join('\n');

  // Pre-compute these before any early return
  const _blocksSnap = serializeBlocksForTemplate();
  const _restSnap = String(document.querySelector('.res-rest-card .res-rest')?.value || document.getElementById('rest-duration-sec')?.value || '0');
  const td = parseFloat(document.getElementById('resTD')?.innerText) || null;
  const rlRaw = parseFloat(document.getElementById('resRL')?.innerText);
  const rl = isNaN(rlRaw) ? null : rlRaw;

  // Always show name modal — pre-fill with template/benchmark name if available
  let autoLabel = _activeTemplateName || '';
  if (!autoLabel) {
    // Check open accordion first, then fall back to any cwod-select with a value
    const firstCwodOpen = document.querySelector('.classic-accordion.open');
    if (firstCwodOpen) {
      const sel = firstCwodOpen.querySelector('.cwod-select');
      if (sel?.value) autoLabel = sel.value;
    }
    if (!autoLabel) {
      document.querySelectorAll('.cwod-select').forEach(sel => {
        if (!autoLabel && sel.value) autoLabel = sel.value;
      });
    }
  }
  _pendingHistoryEntry = { pd, wd, mc, fb, td, rl, detail, _blocksSnap, _restSnap, fbVersion: 5,
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION, rlVersion: RL_TARGET_VERSION,
    durationV2Version: DURATION_V2_TARGET_VERSION, bwCorrectionVersion: BW_CORRECTION_TARGET_VERSION,
    bwWorkPctVersion: BW_WORK_PCT_TARGET_VERSION, overheadRefVersion: OVERHEAD_REF_TARGET_VERSION,
    mc_mech: window._lastMechKcal    != null ? window._lastMechKcal    : null,
    mc_aero: window._lastCardioKcal  != null ? window._lastCardioKcal  : null,
    mc_overhead: window._lastOverheadKcal != null ? window._lastOverheadKcal : null,
    duration_sec: window._lastDurationSec != null ? window._lastDurationSec : null,
    bw: window._lastBodyweight != null ? window._lastBodyweight : null,
    vo2max_used: window._lastVo2max != null ? window._lastVo2max : null,
    bw_work_pct: window._lastBodyweightWorkPct != null ? window._lastBodyweightWorkPct : null };
  const inp = document.getElementById('wodNameInput');
  if (inp) inp.value = autoLabel;
  document.getElementById('wodNameModal')?.classList.add('open');
  setTimeout(() => { inp?.focus(); if (!autoLabel) inp?.select(); }, 300);
}

function _finishSaveToHistory(wodLabel, pd, wd, mc, fb, td, rl, detail, _blocksSnap, _restSnap) {
  const entry = {
    date: localISOString(),
    pd, wd, mc, fb, fbVersion: 5,
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION, rlVersion: RL_TARGET_VERSION,
    durationV2Version: DURATION_V2_TARGET_VERSION, bwCorrectionVersion: BW_CORRECTION_TARGET_VERSION,
    bwWorkPctVersion: BW_WORK_PCT_TARGET_VERSION, overheadRefVersion: OVERHEAD_REF_TARGET_VERSION,
    ...(td !== null && { td }),
    ...(rl !== null && { rl }),
    label: wodLabel,
    detail,
    blocks: _blocksSnap,
    restDuration: _restSnap,
    duration_sec: window._lastDurationSec != null ? window._lastDurationSec : null,
    bw: window._lastBodyweight != null ? window._lastBodyweight : null,
    vo2max_used: window._lastVo2max != null ? window._lastVo2max : null,
    bw_work_pct: window._lastBodyweightWorkPct != null ? window._lastBodyweightWorkPct : null,
    powerVersion: 1,
    // A freshly-saved session is already computed with the current,
    // up-to-date formula for all three of these — stamping them here
    // (rather than leaving them unset) stops the corresponding migration
    // buttons from incorrectly reappearing every time a new session is
    // saved, as if the session were old data still needing correction.
    eccentricVersion: ECCENTRIC_WORK_TARGET_VERSION,
    cardioExmomFixVersion: CARDIO_EXMOM_FIX_TARGET_VERSION,
    powerFixVersion: POWER_FIX_TARGET_VERSION,
    emomDurationVersion: EMOM_DURATION_TARGET_VERSION,
    pdStoredVersion: PD_STORED_TARGET_VERSION,
    patternProfile: _lastPatternProfile || { patternPct: {}, dominantPattern: "unknown" },
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION
  };

  // RPE was already collected as part of result entry (required, read
  // per block, then duration-weighted-averaged by calculateGlobalPhysics()
  // into window._lastComputedRPE) — no post-save prompt needed anymore.
  // blockRpe is the raw per-block array, saved now even though nothing
  // reads it yet — it's what Phase 2 (real per-block overhead) will use;
  // historical sessions saved before this change won't have it.
  const rpe = window._lastComputedRPE || null;
  entry.rpe = rpe;
  entry.blockRpe = window._lastBlockRpeList || null;
  // Elevation gain — same freeze-at-Calculate, reuse-at-Save pattern
  // as blockRpe just above. An empty object (no blocks had elevation
  // entered) is stored as null, not {} — consistent with how blockRpe
  // itself is null rather than an empty array when nothing was set.
  entry.blockElevationGain = (window._lastBlockElevationGain && Object.keys(window._lastBlockElevationGain).length) ? window._lastBlockElevationGain : null;
  // blockSegments — real per-segment HR data where captured (cardio
  // toggle + connected strap), falling back to whole-block HR or manual
  // RPE per _buildBlockSegments(). Reuses whatever was frozen into
  // window._lastBlockSegments at Calculate time (physics-core.js),
  // rather than calling _buildAllBlockSegments() fresh here — that used
  // to be a second, independent call, so any HR samples streaming in
  // between Calculate and Save (even during a brief cool-down) could
  // make this produce different segment data than what Calculate
  // already showed, silently shifting Overall/Work/Running/DU
  // Efficiency between what was displayed live and what got saved. Same
  // bug, same fix, as the avgHR/maxHR freeze just below — this field
  // just didn't exist yet when that fix was made. Falls back to a fresh
  // call only if nothing was frozen (e.g. Calculate was never run this
  // session for some reason), same defensive pattern as the HR reuse.
  try { entry.blockSegments = window._lastBlockSegments !== undefined ? window._lastBlockSegments : _buildAllBlockSegments(); } catch (e) { entry.blockSegments = null; }
  try { entry.restSegments = _buildRestSegments(); } catch (e) { entry.restSegments = null; }
  try {
    // Reuses whatever was frozen into window._lastSessionHR at
    // Calculate time (physics-core.js), rather than calling
    // _hrStatsForRange(0, Date.now()) fresh here — that used to be a
    // second, independent call with its own later Date.now(), so any
    // gap between Calculate and Save let more HR samples stream in and
    // shift the average, meaning what got saved didn't always match
    // what was shown. Falls back to a fresh call only if the frozen
    // value was never set at all (e.g. a session saved without ever
    // hitting Calculate through the normal flow).
    const sessionHR = window._lastSessionHR !== undefined ? window._lastSessionHR : _hrStatsForRange(0, Date.now());
    entry.avgHR = sessionHR ? sessionHR.avg : null;
    entry.maxHR = sessionHR ? sessionHR.max : null;
  } catch (e) { entry.avgHR = null; entry.maxHR = null; }
  try { entry.cardioIntervalSummary = _buildCardioIntervalSummary(); } catch (e) { entry.cardioIntervalSummary = null; }
  // VBT pod (WitMotion) — sensor-measured mechanical work, saved
  // alongside entry.wd (the existing PR/ROM estimate, untouched) rather
  // than replacing it: entry.wd stays the fallback and the baseline for
  // spotting ROM drift/sensor calibration issues over time, while
  // entry.vbt_work_kj becomes the authoritative eRaw numerator when
  // present (see getEngineScoreERaw). Must be set before
  // _updateERawForEntry() below, which reads these fields to decide
  // which source to use.
  entry.vbtUsed = (window._vbtSessionRepCount || 0) > 0;
  entry.vbt_work_kj = entry.vbtUsed ? window._vbtSessionWorkKJ : null;
  entry.vbt_rep_count = entry.vbtUsed ? window._vbtSessionRepCount : null;
  _updateERawForEntry(entry);
  // Session Signature radar — computed and saved right here, at the
  // moment of save, using the exact same computeRadarValuesForSession()
  // + getRadarMaxes() normalization the "Update Session Signatures to
  // New Axes" repair button uses. Previously entry.radar was NEVER set
  // at save time anywhere in the app — the only place that ever wrote
  // it was that repair function — so every single new session relied
  // on someone noticing and re-running the repair button after the
  // fact, and the button would inevitably reappear after every save
  // since the just-saved session always failed its own up-to-date
  // check. This closes that gap at the source; the repair button still
  // exists for genuinely old, pre-existing sessions saved before this
  // fix, but a session saved from here on shouldn't ever need it.
  try {
    const _radarRaw = computeRadarValuesForSession(entry);
    const _radarMaxes = getRadarMaxes();
    entry.radar = {
      pd: Math.min(1, Math.max(0, _radarRaw.pd / _radarMaxes.pd)),
      wd: Math.min(1, Math.max(0, _radarRaw.wd / _radarMaxes.wd)),
      cvIntensity: Math.min(1, Math.max(0, _radarRaw.cvIntensity / _radarMaxes.cvIntensity)),
      fb: Math.min(1, Math.max(0, _radarRaw.fb / _radarMaxes.fb)),
      internalLoad: Math.min(1, Math.max(0, _radarRaw.internalLoad / _radarMaxes.internalLoad)),
      td: Math.min(1, Math.max(0, _radarRaw.td / _radarMaxes.td)),
      _normalised: true,
      _v: 3
    };
  } catch (e) { console.error('[radar save] computeRadarValuesForSession/getRadarMaxes threw — entry.radar left null:', e); entry.radar = null; }
  {
    const hist = getHistory();
    hist.unshift(entry);
    if (hist.length > 50) hist.pop();
    saveHistory(hist);
    // Cache unlock date when 5th qualifying session is saved
    const qualHist = hist.filter(w => w.pd && parseFloat(w.pd) > 0);
    if (qualHist.length === BM_PERSONAL_MIN + 1 && !localStorage.getItem('wod_profile_unlocked_at')) {
      localStorage.setItem('wod_profile_unlocked_at', entry.date);
    }
    detectBenchmarkPR(entry);
    renderBenchmarkPRs();
    // Trigger coaching insight regeneration only if refresh conditions are met
    setTimeout(() => {
      const hist2 = getHistory();
      const cacheKey = 'wod-insight-cache-' + (_lang==='es'?'es':'en') + '-' + (document.getElementById('global-goal')?.value||'general');
      const cached = _insightCache || JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (hist2.length === INSIGHT_MIN_SESSIONS && !localStorage.getItem('wod-insight-unlocked')) {
        localStorage.setItem('wod-insight-unlocked', '1');
        const msg = _lang === 'es'
          ? '🤖 Tu Análisis de Coaching está listo — ve a Analíticas'
          : '🤖 Your Coaching Insight is ready — tap Analytics to view';
        showToast(msg, 'info');
        // Extend the toast to 5 seconds for this important notification
        const toast = document.getElementById('wod-toast');
        if (toast) {
          clearTimeout(toast._timeout);
          toast._timeout = setTimeout(() => { toast.style.opacity='0'; setTimeout(()=>toast.remove(),300); }, 5000);
        }
      }
      if (_insightRefreshDue(cached, hist2)) generateCoachingInsight();
      else if (currentTab === 3) _renderInsightResult(cached, hist2);
    }, 500);
    showToast('✅ Saved: ' + wodLabel + (rpe ? ' · RPE ' + rpe : ''));
    if (currentTab === 4) renderHistory();
    // Auto-push to Supabase
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return;
        sbPushHistoryEntry(entry, session.user.id, sbInst).catch(() => {
          queueUpload('history', entry);
          console.log('[sync] History queued for later upload');
        });
      });
    }
  }
}

/* ════════════════════════════════════════════════════
   HISTORY SCREEN
════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════
   HISTORY FILTER + SORT
════════════════════════════════════════════════════ */
const _histFilter = { date:'all', pd:'all', wd:'all', mc:'all', td:'all', rl:'all', fb:'all', rpe:'all', modality:'all', movement:'', cwod:'' };
let _histSortField = 'date', _histSortAsc = false;

function toggleHistFilter() {
  document.getElementById('hist-filter-bar')?.classList.toggle('open');
}

function showFilterAutocomplete(input, type) {
  const q = input.value.toLowerCase().trim();
  const acId = input.id + '-ac';
  let ac = document.getElementById(acId);
  if (!ac) return;

  let matches = [];
  if (type === 'movement') {
    matches = Object.keys(MASTER_DB).filter(k => !q || k.toLowerCase().includes(q)).slice(0, 40);
  } else if (type === 'cwod') {
    matches = Object.keys(CLASSIC_WODS).filter(k => !q || k.toLowerCase().includes(q)).slice(0, 40);
  }

  if (!matches.length || (!q && matches.length > 20)) {
    ac.style.display = 'none';
    return;
  }

  // Move to body to escape overflow:hidden on accordion
  if (ac.parentElement !== document.body) {
    ac._origParent = ac.parentElement;
    document.body.appendChild(ac);
  }

  // Position fixed under input
  const rect = input.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 4;
  const spaceAbove = rect.top - 4;
  ac.style.position   = 'fixed';
  ac.style.width      = rect.width + 'px';
  ac.style.left       = rect.left + 'px';
  ac.style.zIndex     = '99999';
  ac.style.background = 'var(--surface)';
  ac.style.border     = '1px solid var(--border)';
  ac.style.borderRadius = '8px';
  ac.style.boxShadow  = '0 6px 20px rgba(0,0,0,.3)';
  ac.style.overflowY  = 'auto';
  if (spaceBelow >= 120 || spaceBelow >= spaceAbove) {
    ac.style.top    = (rect.bottom + 4) + 'px';
    ac.style.bottom = '';
    ac.style.maxHeight = Math.max(80, Math.min(spaceBelow, 220)) + 'px';
  } else {
    ac.style.top    = '';
    ac.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    ac.style.maxHeight = Math.max(80, Math.min(spaceAbove, 220)) + 'px';
  }

  ac.innerHTML = matches.map(m =>
    `<div class="search-item" onmousedown="selectFilterAutocomplete('${input.id}','${m.replace(/'/g,"\\'")}','${type}')">${m}</div>`
  ).join('');
  ac.style.display = 'block';

  // Reposition on scroll so dropdown follows input
  if (!input._acScrollHandler) {
    input._acScrollHandler = () => {
      if (ac.style.display === 'none') return;
      const r = input.getBoundingClientRect();
      // If input scrolled off screen, hide dropdown
      if (r.bottom < 0 || r.top > window.innerHeight) {
        hideFilterAutocomplete(acId);
        return;
      }
      const sb = window.innerHeight - r.bottom - 4;
      const sa = r.top - 4;
      ac.style.left  = r.left + 'px';
      ac.style.width = r.width + 'px';
      if (sb >= 120 || sb >= sa) {
        ac.style.top    = (r.bottom + 4) + 'px';
        ac.style.bottom = '';
        ac.style.maxHeight = Math.max(80, Math.min(sb, 220)) + 'px';
      } else {
        ac.style.top    = '';
        ac.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        ac.style.maxHeight = Math.max(80, Math.min(sa, 220)) + 'px';
      }
    };
    document.addEventListener('scroll', input._acScrollHandler, true);
  }
}

function hideFilterAutocomplete(acId) {
  const ac = document.getElementById(acId);
  if (!ac) return;
  ac.style.display = 'none';
  // Remove scroll listener
  const input = document.getElementById(acId.replace('-ac', ''));
  if (input?._acScrollHandler) {
    document.removeEventListener('scroll', input._acScrollHandler, true);
    input._acScrollHandler = null;
  }
  // Move back to original parent
  if (ac._origParent && ac.parentElement === document.body) {
    ac._origParent.appendChild(ac);
    ac._origParent = null;
  }
}

function selectFilterAutocomplete(inputId, value, type) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = value;
  hideFilterAutocomplete(inputId + '-ac');
  if (type === 'movement') { _histFilter.movement = value; }
  else if (type === 'cwod') { _histFilter.cwod = value; }
  applyHistFilter();
}

function selectChip(group, el) {
  document.querySelectorAll(`#chips-${group} .hist-chip`).forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _histFilter[group] = el.dataset.val;
  applyHistFilter();
}

function toggleHistSortDir() {
  _histSortAsc = !_histSortAsc;
  const btn = document.getElementById('hist-sort-dir');
  if (btn) btn.textContent = _histSortAsc ? '\u2191' : '\u2193';
  applyHistFilter();
}

function clearHistFilters() {
  Object.keys(_histFilter).forEach(k => _histFilter[k] = k === 'movement' || k === 'cwod' ? '' : 'all');
  document.querySelectorAll('.hist-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.val === 'all');
  });
  const mi = document.getElementById('hist-filter-movement');
  const ci = document.getElementById('hist-filter-cwod');
  if (mi) mi.value = '';
  if (ci) ci.value = '';
  _histSortField = 'date'; _histSortAsc = false;
  const sf = document.getElementById('hist-sort-field');
  if (sf) sf.value = 'date';
  const sd = document.getElementById('hist-sort-dir');
  if (sd) sd.textContent = '\u2193';
  applyHistFilter();
}

function applyHistFilter() {
  _histSortField = document.getElementById('hist-sort-field')?.value || 'date';
  updateHistActiveBadges();
  renderHistory();
}

function updateHistActiveBadges() {
  const wrap = document.getElementById('hist-active-badges');
  if (!wrap) return;
  const labels = {
    date:    { all:'', '7':'7d', '30':'30d', '90':'3m' },
    pd:      { all:'', low:'Int:Low', mod:'Int:Mod', high:'Int:High' },
    wd:      { all:'', low:'TW:Light', mod:'TW:Mod', high:'TW:Heavy' },
    mc:      { all:'', light:'MC:Light', mod:'MC:Mod', high:'MC:High' },
    td:      { all:'', basic:'TD:Basic', mod:'TD:Mod', adv:'TD:Adv' },
    rl:      { all:'', light:'RL:Light', mod:'RL:Mod', heavy:'RL:Heavy' },
    fb:      { all:'', metabolic:'Metabolic', mixed:'Mixed', strength:'Strength', maxstr:'Max Str.' },
    rpe:     { all:'', easy:'RPE Easy', mod:'RPE Mod', hard:'RPE Hard' },
    modality:{ all:'', fortime:'For Time', amrap:'AMRAP', emom:'EMOM', exmom:'EXMOM', tabata:'Tabata' },
  };
  const badges = Object.entries(_histFilter)
    .filter(([k,v]) => k !== 'movement' && k !== 'cwod' && v !== 'all')
    .map(([k,v]) => `<div class="hist-active-badge">${labels[k]?.[v]||v} <span onclick="clearGroup('${k}')">&#x2715;</span></div>`);
  if (_histFilter.movement) badges.push(`<div class="hist-active-badge">Move: ${_histFilter.movement} <span onclick="clearGroup('movement')">&#x2715;</span></div>`);
  if (_histFilter.cwod)     badges.push(`<div class="hist-active-badge">WOD: ${_histFilter.cwod} <span onclick="clearGroup('cwod')">&#x2715;</span></div>`);
  wrap.innerHTML = badges.join('');
}

function clearGroup(group) {
  _histFilter[group] = group === 'movement' || group === 'cwod' ? '' : 'all';
  if (group === 'movement') { const el = document.getElementById('hist-filter-movement'); if (el) el.value = ''; }
  if (group === 'cwod')     { const el = document.getElementById('hist-filter-cwod');     if (el) el.value = ''; }
  document.querySelectorAll(`#chips-${group} .hist-chip`).forEach(c => {
    c.classList.toggle('active', c.dataset.val === 'all');
  });
  applyHistFilter();
}

function getFilteredHistory() {
  // Tag each entry with its original index before any filtering/sorting
  let hist = getHistory().map((w, i) => ({ ...w, _origIdx: i }));
  const now = Date.now();

  // ── Dynamic ranges based on athlete's own history percentiles ──
  const allPD = hist.map(w => parseFloat(w.pd)||0).filter(v => v > 0).sort((a,b)=>a-b);
  const allWD = hist.map(w => parseFloat(w.wd)||0).filter(v => v > 0).sort((a,b)=>a-b);
  const allMC = hist.map(w => parseFloat(w.mc)||0).filter(v => v > 0).sort((a,b)=>a-b);
  const pct = (arr, p) => arr[Math.floor(arr.length * p)] ?? 0;
  const pdLow = pct(allPD, 0.33), pdHigh = pct(allPD, 0.67);
  const wdLow = pct(allWD, 0.33), wdHigh = pct(allWD, 0.67);
  const mcLow = pct(allMC, 0.33), mcHigh = pct(allMC, 0.67);

  if (_histFilter.date !== 'all') {
    const days = parseInt(_histFilter.date);
    hist = hist.filter(w => (now - new Date(w.date).getTime()) <= days * 86400000);
  }
  if (_histFilter.pd !== 'all') {
    hist = hist.filter(w => {
      const v = parseFloat(w.pd)||0;
      if (_histFilter.pd === 'low')  return v <= pdLow;
      if (_histFilter.pd === 'mod')  return v > pdLow && v <= pdHigh;
      if (_histFilter.pd === 'high') return v > pdHigh;
      return true;
    });
  }
  if (_histFilter.wd !== 'all') {
    hist = hist.filter(w => {
      const v = parseFloat(w.wd)||0;
      if (_histFilter.wd === 'low')  return v <= wdLow;
      if (_histFilter.wd === 'mod')  return v > wdLow && v <= wdHigh;
      if (_histFilter.wd === 'high') return v > wdHigh;
      return true;
    });
  }
  if (_histFilter.mc !== 'all') {
    hist = hist.filter(w => {
      const v = parseFloat(w.mc)||0;
      if (_histFilter.mc === 'light') return v <= mcLow;
      if (_histFilter.mc === 'mod')   return v > mcLow && v <= mcHigh;
      if (_histFilter.mc === 'high')  return v > mcHigh;
      return true;
    });
  }
  if (_histFilter.td !== 'all') {
    hist = hist.filter(w => {
      if (!w.td) return false;
      const v = parseFloat(w.td)||0;
      if (_histFilter.td === 'basic') return v < 2;
      if (_histFilter.td === 'mod')   return v >= 2 && v < 3;
      if (_histFilter.td === 'adv')   return v >= 3;
      return true;
    });
  }
  if (_histFilter.rl !== 'all') {
    hist = hist.filter(w => {
      if (!w.rl) return false;
      const v = parseFloat(w.rl)||0;
      if (_histFilter.rl === 'light') return v < 40;
      if (_histFilter.rl === 'mod')   return v >= 40 && v < 65;
      if (_histFilter.rl === 'heavy') return v >= 65;
      return true;
    });
  }
  if (_histFilter.fb !== 'all') {
    hist = hist.filter(w => {
      const v = parseFloat(w.fb)||0;
      if (_histFilter.fb === 'metabolic') return v < 22;
      if (_histFilter.fb === 'mixed')     return v >= 22 && v < 35;
      if (_histFilter.fb === 'strength')  return v >= 35 && v < 49;
      if (_histFilter.fb === 'maxstr')    return v >= 49;
      return true;
    });
  }
  if (_histFilter.rpe !== 'all') {
    hist = hist.filter(w => {
      const v = parseInt(w.rpe)||0;
      if (_histFilter.rpe === 'easy') return v >= 1 && v <= 4;
      if (_histFilter.rpe === 'mod')  return v >= 5 && v <= 7;
      if (_histFilter.rpe === 'hard') return v >= 8 && v <= 10;
      return true;
    });
  }
  if (_histFilter.modality !== 'all') {
    hist = hist.filter(w => {
      const blocks = w.blocks || [];
      return blocks.some(b => (b.mode || '').toLowerCase() === _histFilter.modality);
    });
  }
  if (_histFilter.movement) {
    const mvSearch = _histFilter.movement.toLowerCase();
    hist = hist.filter(w => {
      const blocks = w.blocks || [];
      return blocks.some(b =>
        (b.movements || []).some(mv => (mv.name || '').toLowerCase().includes(mvSearch))
      );
    });
  }
  if (_histFilter.cwod) {
    const cwodSearch = _histFilter.cwod.toLowerCase();
    hist = hist.filter(w => {
      const blocks = w.blocks || [];
      return blocks.some(b => (b.cwod || '').toLowerCase().includes(cwodSearch));
    });
  }
  hist = [...hist].sort((a, b) => {
    let va, vb;
    if (_histSortField === 'date')     { va = new Date(a.date).getTime(); vb = new Date(b.date).getTime(); }
    else if (_histSortField === 'rpe') { va = parseInt(a.rpe)||0;         vb = parseInt(b.rpe)||0; }
    else if (_histSortField === 'pd')  { va = getSessionPower(a)?.total ?? (parseFloat(a.pd)||0); vb = getSessionPower(b)?.total ?? (parseFloat(b.pd)||0); }
    else                               { va = parseFloat(a[_histSortField])||0; vb = parseFloat(b[_histSortField])||0; }
    return _histSortAsc ? va - vb : vb - va;
  });
  return hist;
}

/* ════════════════════════════════════════════════════
   HISTORY CALENDAR VIEW
════════════════════════════════════════════════════ */
let _histView = 'cal';
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calSelectedDate = null;

function setHistView(view) {
  _histView = view;
  const listBtn = document.getElementById('hist-view-list');
  const calBtn  = document.getElementById('hist-view-cal');
  const calWrap = document.getElementById('hist-calendar-wrap');
  const filterBar = document.getElementById('hist-filter-bar');
  const resultCount = document.getElementById('hist-result-count');

  if (view === 'cal') {
    listBtn.style.background = 'transparent';
    listBtn.style.color = 'var(--label)';
    listBtn.style.borderColor = 'var(--border)';
    calBtn.style.background = 'var(--brand)';
    calBtn.style.color = 'white';
    calBtn.style.borderColor = 'var(--brand)';
    calWrap.style.display = 'block';
    if (filterBar) filterBar.style.display = 'none';
    if (resultCount) resultCount.style.display = 'none';
    _calYear = new Date().getFullYear();
    _calMonth = new Date().getMonth();
    _calSelectedDate = null;
    renderCalendar();
    renderHistory(); // show all in list below
  } else {
    listBtn.style.background = 'var(--brand)';
    listBtn.style.color = 'white';
    listBtn.style.borderColor = 'var(--brand)';
    calBtn.style.background = 'transparent';
    calBtn.style.color = 'var(--label)';
    calBtn.style.borderColor = 'var(--border)';
    calWrap.style.display = 'none';
    if (filterBar) filterBar.style.display = '';
    if (resultCount) resultCount.style.display = '';
    _calSelectedDate = null;
    renderHistory();
  }
}

function renderCalendar() {
  const wrap = document.getElementById('hist-calendar-wrap');
  if (!wrap) return;
  const hist = getHistory();
  const today = new Date();

  // Build a map of date → session count
  const dateMap = {};
  hist.forEach(w => {
    const d = w.date ? localDateStr(new Date(w.date)) : '';
    if (d) dateMap[d] = (dateMap[d] || 0) + 1;
  });

  // Month stats
  const monthKey = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}`;
  const monthDays = Object.keys(dateMap).filter(d => d.startsWith(monthKey));
  const monthSessions = monthDays.reduce((a, d) => a + dateMap[d], 0);
  const monthWorkDays = monthDays.length;
  const daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
  const _isViewingCurrentMonth = (_calYear === today.getFullYear() && _calMonth === today.getMonth());
  const daysElapsed = _isViewingCurrentMonth ? today.getDate() : daysInMonth;
  const restDays = daysElapsed - monthWorkDays;

  // Day names
  const dows = t('cal.days').split(',');
  const months = t('cal.months').split(',');

  // First day of month (adjusted: Monday = 0)
  let firstDay = new Date(_calYear, _calMonth, 1).getDay();
  firstDay = (firstDay + 6) % 7; // convert Sunday=0 to Monday=0

  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  let daysHtml = dows.map(d => `<div class="hist-cal-dow">${d}</div>`).join('');

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const dateStr = isCurrentMonth
      ? `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`
      : '';
    const count = dateStr ? (dateMap[dateStr] || 0) : 0;
    const isToday = dateStr === localDateStr(today);
    const isSelected = dateStr === _calSelectedDate;
    const hasSession = count > 0;

    let classes = 'hist-cal-day';
    if (!isCurrentMonth) classes += ' other-month';
    if (hasSession) classes += ' has-session';
    if (isToday) classes += ' today';
    if (isSelected) classes += ' selected';

    const dots = hasSession
      ? `<div class="hist-cal-dot-wrap">${count > 1
          ? `<div class="hist-cal-dot multi"></div><div class="hist-cal-dot multi"></div>`
          : `<div class="hist-cal-dot"></div>`}</div>`
      : '<div class="hist-cal-dot-wrap"></div>';

    const onclick = hasSession && dateStr
      ? `onclick="selectCalDay('${dateStr}')"`
      : '';

    daysHtml += `<div class="${classes}" ${onclick}>
      <span class="hist-cal-dn">${isCurrentMonth ? dayNum : ''}</span>
      ${dots}
    </div>`;
  }

  wrap.innerHTML = `
    <div class="hist-cal">
      <div class="hist-cal-nav">
        <button onclick="navCal(-1)">‹</button>
        <span class="hist-cal-month">${months[_calMonth]} ${_calYear}</span>
        <button onclick="navCal(1)">›</button>
      </div>
      <div class="hist-cal-grid">${daysHtml}</div>
      <div class="hist-cal-stats">
        <div class="hist-cal-stat">
          <div class="hist-cal-stat-val">${monthSessions}</div>
          <div class="hist-cal-stat-lbl">${t('hist.cal.sessions')}</div>
        </div>
        <div class="hist-cal-stat">
          <div class="hist-cal-stat-val">${monthWorkDays}</div>
          <div class="hist-cal-stat-lbl">${t('hist.cal.training')}</div>
        </div>
        <div class="hist-cal-stat">
          <div class="hist-cal-stat-val">${restDays}</div>
          <div class="hist-cal-stat-lbl">${t('hist.cal.rest')}</div>
        </div>
        <div class="hist-cal-stat">
          <div class="hist-cal-stat-val">${monthWorkDays ? Math.round(monthWorkDays/daysElapsed*100) : 0}%</div>
          <div class="hist-cal-stat-lbl">${t('hist.cal.consistency')}</div>
        </div>
      </div>
      ${_calSelectedDate ? `<div style="font-size:.72rem;color:var(--brand);font-weight:800;margin-top:8px;text-align:center;">▼ Showing sessions for ${_calSelectedDate}</div>` : ''}
    </div>`;
}

function navCal(dir) {
  _calMonth += dir;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  _calSelectedDate = null;
  renderCalendar();
  renderHistory();
}

function selectCalDay(dateStr) {
  _calSelectedDate = _calSelectedDate === dateStr ? null : dateStr;
  renderCalendar();
  renderHistory();
  // Scroll to list
  setTimeout(() => {
    const list = document.getElementById('history-list');
    if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function renderHistory() {
  const allHist = getHistory();
  const el = document.getElementById('history-list');
  const countEl = document.getElementById('hist-result-count');



  // Show migration button if any sessions are missing split data
  const migrateBtn = document.getElementById('history-migrate-btn');
  if (migrateBtn) {
    const needsMigration = allHist.some(w => w.mc && parseFloat(w.mc) > 0 && w.mc_mech == null);
    migrateBtn.style.display = needsMigration ? '' : 'none';
  }

  // Show migration button if any sessions still use the original (mechanical-work-based) Force Bias formula
  const migrateFbBtn = document.getElementById('history-migrate-fb-btn');
  if (migrateFbBtn) {
    const needsFbMigration = allHist.some(w => w.fb && parseFloat(w.fb) > 0 && Number(w.fbVersion) < 2);
    migrateFbBtn.style.display = needsFbMigration ? '' : 'none';
  }

  // Show migration button if any sessions still use the full-metabolic-cost
  // Force Bias formula (fbVersion 2), instead of the current mechanical-only one
  const migrateFbReformBtn = document.getElementById('history-migrate-fbreform-btn');
  if (migrateFbReformBtn) {
    const needsFbReform = allHist.some(w => w.fb && parseFloat(w.fb) > 0 && Number(w.fbVersion) < 3);
    migrateFbReformBtn.style.display = needsFbReform ? '' : 'none';
  }

  // Show migration button if any sessions still have FB computed via
  // back-derivation from an already-rounded value (fbVersion 3), instead of
  // recomputed directly from raw tonnage
  const migrateFbPrecisionBtn = document.getElementById('history-migrate-fbprecision-btn');
  if (migrateFbPrecisionBtn) {
    const needsFbPrecision = allHist.some(w => w.blocks && w.blocks.length && Number(w.fbVersion) < 4);
    migrateFbPrecisionBtn.style.display = needsFbPrecision ? '' : 'none';
  }

  // Show migration button if any sessions still have FB computed via
  // mc_mech (the metabolic-cost-equivalent) instead of raw mechanical work
  const migrateFbMechWorkBtn = document.getElementById('history-migrate-fbmechwork-btn');
  if (migrateFbMechWorkBtn) {
    const needsFbMechWork = allHist.some(w => w.blocks && w.blocks.length && Number(w.fbVersion) !== 5);
    migrateFbMechWorkBtn.style.display = needsFbMechWork ? '' : 'none';
  }

  // Show migration button if any sessions still don't include eccentric work
  const migrateEccentricBtn = document.getElementById('history-migrate-eccentric-btn');
  if (migrateEccentricBtn) {
    const needsEccentric = allHist.some(w => w.blocks && w.blocks.length && Number(w.eccentricVersion) !== ECCENTRIC_WORK_TARGET_VERSION);
    migrateEccentricBtn.style.display = needsEccentric ? '' : 'none';
  }

  // Show migration button if any sessions have a cardio movement (Run
  // specifically, or an exmom block with any cardio) still using the
  // pre-fix mc_aero calculation
  const migrateCardioExmomBtn = document.getElementById('history-migrate-cardioexmom-btn');
  if (migrateCardioExmomBtn) {
    const needsCardioExmomFix = allHist.some(w =>
      (w.blocks || []).some(b => (b.movements || []).some(mv => MASTER_DB[mv.name]?.cardio))
      && Number(w.cardioExmomFixVersion) !== CARDIO_EXMOM_FIX_TARGET_VERSION);
    migrateCardioExmomBtn.style.display = needsCardioExmomFix ? '' : 'none';
  }

  const repairRadarAxisBtn = document.getElementById('history-repair-radaraxis-btn');
  if (repairRadarAxisBtn) {
    repairRadarAxisBtn.style.display = allHist.some(w =>
      sessionHasRadar(w) && (!w.radar || !w.radar._normalised || (w.radar._v || 0) < 3)
    ) ? '' : 'none';
  }


  // Show migration button if any sessions have an emom/exmom block still
  // using the planned config duration instead of the actual Timer-tracked
  // elapsed time
  const migrateEmomDurationBtn = document.getElementById('history-migrate-emomduration-btn');
  if (migrateEmomDurationBtn) {
    const needsEmomDuration = allHist.some(w =>
      (w.blocks || []).some(b => b.mode === 'emom' || b.mode === 'exmom')
      && w.duration_sec != null
      && Number(w.emomDurationVersion) !== EMOM_DURATION_TARGET_VERSION);
    migrateEmomDurationBtn.style.display = needsEmomDuration ? '' : 'none';
  }

  // Show migration button if any sessions have a stored pd that's
  // mathematically inconsistent with their own wd/duration_sec/bw — a
  // real bug where pd was saved from stale globals rather than the
  // current calculation
  const migratePdStoredBtn = document.getElementById('history-migrate-pdstored-btn');
  if (migratePdStoredBtn) {
    const needsPdStored = allHist.some(w => Number(w.pdStoredVersion) !== PD_STORED_TARGET_VERSION);
    migratePdStoredBtn.style.display = needsPdStored ? '' : 'none';
  }

  // Show migration button if any sessions are missing duration/bodyweight for Power calculations
  const migratePowerBtn = document.getElementById('history-migrate-power-btn');
  if (migratePowerBtn) {
    const needsPowerMigration = allHist.some(w => Number(w.powerVersion) !== 1 && (w.duration_sec == null || w.bw == null));
    migratePowerBtn.style.display = needsPowerMigration ? '' : 'none';
  }

  // Show migration button if any sessions have overhead computed with a different VO2max than currently set
  const migrateVo2maxBtn = document.getElementById('history-migrate-vo2max-btn');
  if (migrateVo2maxBtn) {
    const currentVo2max = parseFloat(document.getElementById('global-vo2max')?.value) || null;
    const needsVo2maxMigration = currentVo2max && allHist.some(w =>
      parseFloat(w.mc_overhead) > 0 && Number(w.vo2max_used) !== Number(currentVo2max) && Number(w.vo2maxAttempted) !== Number(currentVo2max)
    );
    migrateVo2maxBtn.style.display = needsVo2maxMigration ? '' : 'none';
  }

  // Show migration button if any sessions are missing movement pattern data
  const migratePPBtn = document.getElementById('history-migrate-patternprofile-btn');
  if (migratePPBtn) {
    const needsPPMigration = allHist.some(w => {
      if (!w.blocks || !w.blocks.length) return false;
      return Number(w.patternProfileVersion) !== PATTERN_PROFILE_TARGET_VERSION;
    });
    migratePPBtn.style.display = needsPPMigration ? '' : 'none';
  }

  // Show migration button if any sessions still use the old RL calculation
  // (which allowed kettlebell/dumbbell/bodyweight movements to map to a
  // barbell 1RM reference)
  const migrateRLBtn = document.getElementById('history-migrate-rl-btn');
  if (migrateRLBtn) {
    const needsRLMigration = allHist.some(w => {
      if (!w.blocks || !w.blocks.length) return false;
      return Number(w.rlVersion) !== RL_TARGET_VERSION;
    });
    migrateRLBtn.style.display = needsRLMigration ? '' : 'none';
  }

  // Show migration button if any sessions have a duration mismatch against
  // their own detail's Aggregate Time (from the unreliable cap-based
  // fallback used when result/roundSplits were both missing)
  const migrateDurBtn = document.getElementById('history-migrate-duration-btn');
  if (migrateDurBtn) {
    const needsDurMigration = allHist.some(w => Number(w.durationV2Version) !== DURATION_V2_TARGET_VERSION);
    migrateDurBtn.style.display = needsDurMigration ? '' : 'none';
  }

  // Show migration button if any pre-June-9 sessions still use the
  // unverified 83kg bodyweight estimate instead of the known 80kg
  const migrateBwCorrectionBtn = document.getElementById('history-migrate-bwcorrection-btn');
  if (migrateBwCorrectionBtn) {
    const needsBwCorrection = allHist.some(w => Number(w.bwCorrectionVersion) !== BW_CORRECTION_TARGET_VERSION);
    migrateBwCorrectionBtn.style.display = needsBwCorrection ? '' : 'none';
  }

  // Show migration button if any sessions are missing Bodyweight Work %
  const migrateBwWorkPctBtn = document.getElementById('history-migrate-bwworkpct-btn');
  if (migrateBwWorkPctBtn) {
    const needsBwWorkPct = allHist.some(w => w.blocks && w.blocks.length && Number(w.bwWorkPctVersion) !== BW_WORK_PCT_TARGET_VERSION);
    migrateBwWorkPctBtn.style.display = needsBwWorkPct ? '' : 'none';
  }

  // Show migration button if any sessions still have Power computed via
  // the old, inflated mc_mech-based formula (v1) or without excluding
  // cardio time from the denominator (v2, see migratePowerFix)
  const migratePowerFixBtn = document.getElementById('history-migrate-powerfix-btn');
  if (migratePowerFixBtn) {
    const needsPowerFix = allHist.some(w => w.wd && Number(w.powerFixVersion) !== POWER_FIX_TARGET_VERSION);
    migratePowerFixBtn.style.display = needsPowerFix ? '' : 'none';
  }

  // Show migration button if any sessions still use the old, unstable
  // rolling-window overhead reference
  const migrateOverheadRefBtn = document.getElementById('history-migrate-overheadref-btn');
  if (migrateOverheadRefBtn) {
    const needsOverheadRefMigration = allHist.some(w => Number(w.overheadRefVersion) !== OVERHEAD_REF_TARGET_VERSION);
    migrateOverheadRefBtn.style.display = needsOverheadRefMigration ? '' : 'none';
  }

  if (!allHist.length) {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="history-empty">
      <div style="margin-bottom:16px;opacity:.9;"><svg width="110" height="90" viewBox="0 0 110 90" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Calendar body -->
  <rect x="10" y="18" width="90" height="68" rx="10" fill="var(--accent)" opacity=".12"/>
  <rect x="10" y="18" width="90" height="68" rx="10" stroke="var(--accent)" stroke-width="1.5" opacity=".3"/>
  <!-- Header bar -->
  <rect x="10" y="18" width="90" height="22" rx="10" fill="var(--accent)" opacity=".25"/>
  <rect x="10" y="28" width="90" height="12" fill="var(--accent)" opacity=".25"/>
  <!-- Calendar rings -->
  <rect x="32" y="10" width="5" height="16" rx="2.5" fill="var(--accent)" opacity=".6"/>
  <rect x="73" y="10" width="5" height="16" rx="2.5" fill="var(--accent)" opacity=".6"/>
  <!-- Trend line -->
  <polyline points="22,72 38,62 55,66 72,52 88,44" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
  <circle cx="22" cy="72" r="3" fill="var(--accent)" opacity=".6"/>
  <circle cx="38" cy="62" r="3" fill="var(--accent)" opacity=".6"/>
  <circle cx="55" cy="66" r="3" fill="var(--accent)" opacity=".6"/>
  <circle cx="72" cy="52" r="3" fill="var(--accent)" opacity=".6"/>
  <circle cx="88" cy="44" r="4" fill="var(--accent)" opacity=".9"/>
</svg></div>
      <div style="font-size:.95rem;font-weight:900;color:var(--text);margin-bottom:8px;">${t('empty.history')}</div>
      <p style="font-size:.78rem;line-height:1.7;margin-bottom:20px;max-width:260px;margin-left:auto;margin-right:auto;">${t('hist.empty.msg')}</p>
      <button class="btn btn-primary" onclick="switchTab(1)" style="width:100%;max-width:240px;">
        ${t('empty.history.cta')}
      </button>
    </div>`;
    return;
  }

  const filtered = getFilteredHistory();

  // In calendar view, further filter by selected date or current month
  let displayHist = filtered;
  if (_histView === 'cal') {
    if (_calSelectedDate) {
      displayHist = filtered.filter(w => localDateStr(new Date(w.date||'')) === _calSelectedDate);
    } else {
      // Was comparing the raw UTC ISO string's prefix directly against the
      // month key — a real timezone bug: a session saved late evening in a
      // negative-UTC-offset timezone (e.g. Chile, UTC-4) can have a UTC
      // date that's already the next day/month, even though it's still the
      // prior day/month locally. Converting to the local date string first
      // (matching the day-selected branch right above) fixes this —
      // sessions now group by the month they actually happened in for the
      // athlete, not whatever month UTC happened to be at that moment.
      const monthKey = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}`;
      displayHist = filtered.filter(w => localDateStr(new Date(w.date||'')).startsWith(monthKey));
    }
  }

  if (countEl) {
    if (_histView === 'cal') {
      const n = displayHist.length;
      countEl.textContent = _calSelectedDate
        ? t(n === 1 ? 'hist.sessions.date' : 'hist.sessions.dates').replace('{n}', n).replace('{d}', _calSelectedDate)
        : t(n === 1 ? 'hist.sessions.month' : 'hist.sessions.months').replace('{n}', n);
      countEl.style.display = 'block';
    } else {
      const isFiltered = Object.values(_histFilter).some(v => v !== 'all');
      countEl.textContent = isFiltered
        ? t('hist.sessions.filter').replace('{n}', filtered.length).replace('{t}', allHist.length)
        : t(allHist.length === 1 ? 'hist.sessions.total' : 'hist.sessions.totals').replace('{n}', allHist.length);
    }
  }

  // ── 6-week summary (list view only) ──
  const sixWeekSummaryEl = document.getElementById('history-sixweek-summary');
  if (sixWeekSummaryEl) {
    if (_histView !== 'cal') {
      const sixWeeksAgo = new Date(Date.now() - 42*24*60*60*1000);
      const sixWeekSessions = allHist.filter(w => w.date && new Date(w.date) >= sixWeeksAgo);
      const trainingDays = new Set(sixWeekSessions.map(w => localDateStr(new Date(w.date)))).size;
      const restDays = 42 - trainingDays;
      const consistency = Math.round(trainingDays / 42 * 100);
      sixWeekSummaryEl.style.display = '';
      sixWeekSummaryEl.innerHTML = `
        <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--label);margin-bottom:8px;">${t('hist.sixweek.title')}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 6px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:var(--brand);">${sixWeekSessions.length}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('hist.sixweek.sessions')}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 6px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:var(--success);">${trainingDays}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('hist.sixweek.training')}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 6px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:var(--label);">${restDays}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('hist.sixweek.rest')}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 6px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:${consistency >= 70 ? 'var(--success)' : consistency >= 40 ? 'var(--brand)' : 'var(--label)'};">${consistency}%</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('hist.sixweek.consist')}</div>
          </div>
        </div>`;
    } else {
      sixWeekSummaryEl.style.display = 'none';
    }
  }

  if (!displayHist.length) {
    el.innerHTML = `<div class="history-empty">
      <div class="icon">\uD83D\uDD0D</div>
      <div style="font-size:.9rem;font-weight:900;color:var(--text);margin-bottom:8px;">${t('hist.no.sessions.filter')}</div>
      <p style="font-size:.78rem;color:var(--label);margin-bottom:14px;">${t('hist.no.sessions.filter.sub')}</p>
      <button class="btn" onclick="clearHistFilters()" style="background:var(--surface2);color:var(--label);border:1px solid var(--border);font-size:.76rem;">${t('hist.clear.filters')}</button>
    </div>`;
    return;
  }

  el.innerHTML = displayHist.map((w) => {
    const i = w._origIdx;
    const d = new Date(w.date);
    const dateStr = fmtDate(d, {day:'2-digit',month:'short',year:'numeric'});
    const timeStr = fmtTime(d, {hour:'2-digit',minute:'2-digit'});

    // Detect ALL modalities from blocks or detail string
    const modalityColors = {
      fortime: { border: '#FF6B35', bg: 'rgba(255,107,53,.08)', label: 'FOR TIME', color: '#FF6B35' },
      amrap:   { border: '#3B82F6', bg: 'rgba(59,130,246,.08)', label: 'AMRAP',    color: '#3B82F6' },
      emom:    { border: '#22C55E', bg: 'rgba(34,197,94,.08)',  label: 'EMOM',     color: '#22C55E' },
      tabata:  { border: '#F59E0B', bg: 'rgba(245,158,11,.08)', label: 'TABATA',   color: '#F59E0B' },
    };
    // Build modality pills from blocks if available, else from detail string
    let modalityPills = '';
    let borderColor = '#FF6B35';
    if (w.blocks && w.blocks.length) {
      const modes = w.blocks.map(b => (b.mode || 'fortime').toLowerCase());
      borderColor = modalityColors[modes[0]]?.border || '#FF6B35';
      modalityPills = modes.map(m => {
        const mc2 = modalityColors[m] || modalityColors.fortime;
        return `<span style="font-size:.58rem;font-weight:800;color:${mc2.color};background:${mc2.bg};border:1px solid ${mc2.border}44;border-radius:4px;padding:1px 6px;letter-spacing:.06em;white-space:nowrap;">${mc2.label}</span>`;
      }).join('');
    } else {
      const detail = (w.detail || '').toUpperCase();
      const modality = detail.includes('(EMOM)') ? 'emom' : detail.includes('(AMRAP)') ? 'amrap' : detail.includes('(TABATA)') ? 'tabata' : 'fortime';
      const mc2 = modalityColors[modality];
      borderColor = mc2.border;
      modalityPills = `<span style="font-size:.58rem;font-weight:800;color:${mc2.color};background:${mc2.bg};border:1px solid ${mc2.border}44;border-radius:4px;padding:1px 6px;letter-spacing:.06em;">${mc2.label}</span>`;
    }
    const rpePill = w.rpe ? `<span class="rpe-badge" style="background:${getRPEColor(w.rpe)}22;color:${getRPEColor(w.rpe)};border:1px solid ${getRPEColor(w.rpe)}44;">RPE ${w.rpe}/10</span>` : '';
    // Same 6 physics results, same order, as the live flow and the
    // History Modal: Power, Cardio Intensity, Work, MC, FB, RL merged
    // with TD. Cardio Intensity shows '—' rather than being omitted
    // when there's no cardio data, since this is a fixed 6-slot grid —
    // an omitted tile would misalign every other tile after it.
    const cvResultCard = getSessionCVEndurance(w);

    return `<div class="history-card" onclick="openHistoryModal(${i})" style="border-left:3px solid ${borderColor};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div class="history-wod-name" style="margin-bottom:2px;">${w.label}</div>
          <div class="history-date" style="margin-bottom:6px;">${dateStr} · ${timeStr}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">${modalityPills}${rpePill}</div>
        </div>
        <button class="delete-btn" onclick="event.stopPropagation();deleteHistory(${i})" title="Delete" style="margin-left:8px;flex-shrink:0;">🗑</button>
      </div>
      <div class="history-metrics" style="margin-top:10px;">
        <div class="history-metric"><div class="history-metric-val" style="color:${getPDColor(getSessionPower(w)?.total || w.pd)}">${(getSessionPower(w)?.total != null ? getSessionPower(w).total.toFixed(2) : w.pd)}</div><div class="history-metric-label">W/kg</div></div>
        <div class="history-metric"><div class="history-metric-val">${cvResultCard ? cvResultCard.met.toFixed(1) : '—'}</div><div class="history-metric-label">MET</div></div>
        <div class="history-metric"><div class="history-metric-val">${(parseFloat(w.wd)||0).toFixed(1)}</div><div class="history-metric-label">kJ</div></div>
        <div class="history-metric"><div class="history-metric-val">${cvResultCard ? Math.round(cvResultCard.metMinutes) : '—'}</div><div class="history-metric-label">MET-MIN</div></div>
        <div class="history-metric"><div class="history-metric-val">${w.fb}</div><div class="history-metric-label">${t('hist.card.bias')}</div></div>
        <div class="history-metric"><div class="history-metric-val">${w.td != null ? w.td + '/5' : '—'}</div><div class="history-metric-label">${t('hist.card.td')}${w.rl !== undefined && w.rl !== null ? ` · ${t('hist.card.rl')} ${w.rl}%` : ''}</div></div>
      </div>
    </div>`;
  }).join('');
}

async function deleteHistory(idx) {
  const ok = await showConfirm(t('confirm.delete.workout'));
  if (!ok) return;
  const h = getHistory();
  const deleted = h[idx];
  h.splice(idx, 1); saveHistory(h);
  // Auto-delete from Supabase
  if (deleted?.date) {
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return;
        sbInst.from('workouts').delete().eq('date', deleted.date).eq('user_id', session.user.id)
          .then(({ error }) => {
            if (error) { queueDelete('history', deleted.date); console.log('[sync] History delete queued'); }
            else { console.log('[sync] History entry deleted from cloud'); }
          });
      });
    }
  }
  // Clear profile unlock cache if history drops below threshold
  const qualCount = h.filter(w => w.pd && parseFloat(w.pd) > 0).length;
  if (qualCount <= BM_PERSONAL_MIN) localStorage.removeItem('wod_profile_unlocked_at');
  renderHistory();
  rebuildBenchmarkPRs();
  if (currentTab === 3) renderAnalytics();
}


/* History detail modal */
function buildHistoryOverviewTable(w) {
  const blocks = w.blocks || [];
  if (!blocks.length) return null;

  const hc = 'var(--label)';
  const tc = 'var(--text)';
  const rb = 'border-top:1px solid rgba(0,0,0,.05);';
  let html = '';
  // Real pace/cadence/cal-min per (block, cardio type), keyed the same
  // way the live Audit Trail derives it — see getHistoryCardioPaceMap
  // in physics-reconstruction.js. Empty object (not shown) for entries
  // with no real toggle-recorded cardio data.
  const _paceMap = (typeof getHistoryCardioPaceMap === 'function') ? getHistoryCardioPaceMap(w) : {};

  blocks.forEach((b, bi) => {
    const mode = (b.mode || 'fortime').toUpperCase();
    const movements = (b.movements || []).filter(mv => mv.name && mv.name.trim());
    if (!movements.length) return;

    // Block header: mode-specific config. Each mode stores its own set of
    // fields (cap/target for FORTIME, dur for AMRAP, totalInt/int for
    // EMOM/EXMOM, tabR for TABATA) — serializeBlocksForTemplate() saves
    // ALL fields with hardcoded defaults regardless of mode, so reading
    // b.cap/b.target unconditionally (old behavior) showed stale defaults
    // (e.g. "15m cap · 5 rounds") on AMRAP blocks that never used them.
    const headerParts = [mode];
    if (mode === 'FORTIME') {
      if (b.cap) headerParts.push(`${b.cap}m cap`);
      const goalRounds = parseInt(b.target || b.rounds) || 0;
      if (goalRounds) headerParts.push(`${goalRounds} ${t('mode.rounds.short')}`);
    } else if (mode === 'AMRAP') {
      if (b.dur) headerParts.push(`${b.dur}m`);
    } else if (mode === 'EMOM' || mode === 'EXMOM') {
      if (b.totalInt && b.int) headerParts.push(`${b.totalInt} × ${b.int}s`);
    } else if (mode === 'TABATA') {
      if (b.tabR) headerParts.push(`${b.tabR} rounds`);
    }
    const headerPartsStr = headerParts.join(' · ');
    html += `<div style="font-size:.72rem;font-weight:900;color:var(--brand);text-transform:uppercase;letter-spacing:.04em;margin:${bi>0?'10px':0} 0 4px;">${t('builder.block.n')} ${bi+1} — ${headerPartsStr}</div>`;

    // EXMOM — show stations
    if (mode === 'EXMOM') {
      movements.forEach((mv, si) => {
        const kg = parseFloat(mv.kg) || 0;
        const kgStr = kg === 0 ? 'BW' : kg === 999 ? 'Max kg' : kg + 'kg';
        html += `<div style="font-size:.75rem;color:var(--label);padding:2px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--accent);font-weight:800;">${t('exmom.station')} ${si+1}:</span> ${mv.reps} ${mv.name} @ ${kgStr}
        </div>`;
      });
      // Show result time for EXMOM — fall through to result display below
    } else {

    // Reconstruct rep sequence
    const ladderType = b.ladderType || 'fixed';
    let repSeq = null;
    if (ladderType !== 'fixed') {
      const fakeBlock = { querySelector: (cls) => {
        if (cls === '.b-ladder-type')  return { value: ladderType };
        if (cls === '.b-ladder-start') return { value: b.ladderStart || 5 };
        if (cls === '.b-ladder-inc')   return { value: b.ladderInc || 1 };
        if (cls === '.b-target')       return { value: b.target || b.rounds || 5 };
        return null;
      }};
      repSeq = getLadderSequence(fakeBlock);
    }
    const rounds = repSeq ? repSeq.length : (parseInt(b.target || b.rounds) || 1);

    // Reconstruct weight sequences
    const wtSeqs = movements.map(mv => {
      const wtType = mv.wtLadderType || 'fixed';
      if (wtType === 'fixed') return null;
      const start = parseFloat(mv.kg) || 0;
      const inc   = parseFloat(mv.wtLadderInc) || 5;
      const seq = [];
      if (wtType === 'ascending')  for (let i=0;i<rounds;i++) seq.push(Math.max(0,Math.round((start+inc*i)*10)/10));
      if (wtType === 'descending') for (let i=0;i<rounds;i++) seq.push(Math.max(0,Math.round((start-inc*i)*10)/10));
      if (wtType === 'pyramid') { const h=Math.ceil(rounds/2); for(let i=0;i<h;i++) seq.push(Math.max(0,Math.round((start+inc*i)*10)/10)); for(let i=h-2;i>=0;i--) seq.push(Math.max(0,Math.round((start+inc*i)*10)/10)); }
      if (wtType === 'valley')   { const h=Math.ceil(rounds/2); for(let i=0;i<h;i++) seq.push(Math.max(0,Math.round((start-inc*i)*10)/10)); for(let i=h-2;i>=0;i--) seq.push(Math.max(0,Math.round((start-inc*i)*10)/10)); }
      return seq.length ? seq : null;
    });

    // Reconstruct rep override sequences per movement
    const repOverrideSeqs = movements.map(mv => {
      if (mv.repsOverride !== '1' && mv.repsOverride !== 1) return null;
      const scheme = mv.repsScheme || 'fixed';
      const start  = parseInt(mv.reps) || 0;
      const inc    = parseInt(mv.repsInc) || 5;
      if (scheme === 'fixed') return 'fixed';
      const seq = [];
      if (scheme === 'ascending')  { for(let i=0;i<rounds;i++) seq.push(Math.max(1,start+inc*i)); }
      else if (scheme === 'descending') { for(let i=0;i<rounds;i++) seq.push(Math.max(1,start-inc*i)); }
      else if (scheme === 'pyramid') { const h=Math.ceil(rounds/2); for(let i=0;i<h;i++) seq.push(Math.max(1,start+inc*i)); for(let i=h-2;i>=0;i--) seq.push(Math.max(1,start+inc*i)); }
      else if (scheme === 'valley')   { const h=Math.ceil(rounds/2); for(let i=0;i<h;i++) seq.push(Math.max(1,start-inc*i)); for(let i=h-2;i>=0;i--) seq.push(Math.max(1,start-inc*i)); }
      return seq.length ? seq : null;
    });

    const hasRepOverride = repOverrideSeqs.some(s => s !== null);
    const hasVariation = repSeq || wtSeqs.some(s => s !== null) || hasRepOverride;

    if (!hasVariation || mode === 'TABATA') {
      html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:0 0;align-items:baseline;">`;
      html += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-right:10px;">Reps</span>`;
      html += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-left:10px;">${t('block.movement')}</span>`;
      const useAbbrHist = hasVariation && movements.length >= 3;
      movements.forEach((mv, mvi) => {
        const kg = parseFloat(mv.kg) || 0;
        const kgStr = kg > 0 ? ` @ ${kg}kg` : '';
        const r = parseFloat(mv.reps) || 0;
        const rStr = r === 999 ? 'Max' : `${r}×`;
        const abbr = useAbbrHist ? getMovAbbr(mv.name, false) : null;
        const dispName = abbr || getMovShort(mv.name);
        const ovSeq = repOverrideSeqs[mvi];
        let ovTag = '';
        if (ovSeq !== null) {
          const ovScheme = mv.repsScheme || 'fixed';
          if (ovSeq === 'fixed') { ovTag = ` <span style="color:var(--brand);font-weight:900;">(×${r})</span>`; }
          else if (Array.isArray(ovSeq)) {
            const arrow = ovScheme==='descending'?'↓':ovScheme==='ascending'?'↑':ovScheme==='pyramid'?'△':'▽';
            const inc = parseInt(mv.repsInc)||5;
            ovTag = ` <span style="color:var(--brand);font-weight:900;">(${ovSeq[0]}→${ovSeq[ovSeq.length-1]} ${arrow}${inc})</span>`;
          }
        }
        // Real pace/cadence/cal-min — only appended for cardio movements
        // that actually have real toggle-recorded data for this block
        // (never an estimate, per getHistoryCardioPaceMap).
        const _cardioType = MASTER_DB[mv.name]?.cardio;
        const _paceStr = _cardioType ? _paceMap[`${bi}_${_cardioType}`] : null;
        const _paceTag = _paceStr ? ` <span style="color:var(--label);">· ${_paceStr}</span>` : '';
        html += `<span style="font-size:.73rem;font-weight:700;color:${hc};${rb}padding:2px 10px 2px 0;">${rStr}</span>`;
        html += `<span style="font-size:.73rem;color:${tc};${rb}padding:2px 0 2px 10px;">${dispName}${kgStr}${ovTag}${_paceTag}</span>`;
      });
      html += '</div>';
    } else {
      const cols = `auto auto ${movements.map(() => '1fr').join(' ')}`;
      html += `<div style="display:grid;grid-template-columns:${cols};gap:0 0;align-items:baseline;">`;
      html += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-right:8px;">${t('rd.label')}s</span>`;
      html += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-left:10px;">Reps</span>`;
      movements.forEach((mv, mi) => {
        html += `<span style="font-size:.62rem;font-weight:900;color:${hc};text-transform:uppercase;padding-bottom:3px;padding-left:10px;">${t('block.movement')} ${mi+1}</span>`;
      });
      const useAbbrHist = movements.length >= 3;
      for (let ri = 0; ri < rounds; ri++) {
        const r = repSeq ? repSeq[ri] : (parseFloat(movements[0]?.reps) || 0);
        html += `<span style="font-size:.73rem;font-weight:900;color:${hc};${rb}padding:2px 8px 2px 0;">${ri+1}</span>`;
        html += `<span style="font-size:.73rem;font-weight:700;color:${hc};${rb}padding:2px 0 2px 10px;">${r === 999 ? 'Max' : r+'×'}</span>`;
        movements.forEach((mv, mi) => {
          const kgSeq = wtSeqs[mi];
          const kgRaw = kgSeq ? (kgSeq[ri] || 0) : (parseFloat(mv.kg) || 0);
          const kgStr = kgRaw > 0 ? ` @ ${kgRaw}kg` : '';
          const abbr = getMovAbbr(mv.name);
          const dispName = abbr || getMovShort(mv.name);
          let ovStr = '';
          const ovSeq = repOverrideSeqs[mi];
          if (ovSeq !== null) {
            const ovReps = ovSeq === 'fixed' ? (parseInt(mv.reps)||0) : (Array.isArray(ovSeq) ? (ovSeq[ri]||0) : 0);
            ovStr = ` <span style="color:var(--brand);font-weight:900;">(×${ovReps})</span>`;
          }
          html += `<span style="font-size:.73rem;color:${tc};${rb}padding:2px 0 2px 10px;">${dispName}${kgStr}${ovStr}</span>`;
        });
      }
      html += '</div>';
      // Abbreviation legend
      const histLegend = movements.map(mv => {
        const a = useAbbrHist ? getMovAbbr(mv.name, false) : null;
        const s = getMovShort(mv.name);
        const d = a || s;
        return d !== mv.name ? `${d} = ${mv.name}` : null;
      }).filter(Boolean);
      if (histLegend.length) html += `<div style="font-size:.6rem;color:${hc};margin-top:5px;line-height:1.6;opacity:.75;">${histLegend.join(' · ')}</div>`;
    }
    } // end else (non-EXMOM)

    // Result line — from saved result data (new entries) or parsed from detail (old entries)
    let res = b.result;
    if (!res || (res.r === 0 && res.x === 0 && res.m === 0)) {
      // Parse from detail text — split into per-block sections by '---'
      const sections = (w.detail || '').split('---');
      const section = sections[bi] || '';
      // Match: "Result: 5 rounds + 2 extra | Time: 07:30"
      // or translated: "Resultado: 5 rondas + 0 extra | Tiempo: 07:30"
      const rm = section.match(/(?:Result|Resultado):\s*(\d+)\s+\w+\s*\+\s*(\d+)/i);
      const tm = section.match(/(?:Time|Tiempo):\s*(\d+):(\d+)/i);
      if (rm || tm) {
        res = {
          r: rm ? parseInt(rm[1]) : 0,
          x: rm ? parseInt(rm[2]) : 0,
          m: tm ? parseInt(tm[1]) : 0,
          s: tm ? parseInt(tm[2]) : 0
        };
      }
    }
    if (res && (res.r > 0 || res.x > 0 || res.m > 0)) {
      const timeStr = `${String(res.m||0).padStart(2,'0')}:${String(res.s||0).padStart(2,'0')}`;
      html += `<div style="font-size:.73rem;font-weight:700;color:var(--brand);margin-top:5px;">${t('audit.result')}: ${timeStr} · ${res.r||0}${t('audit.rounds').charAt(0).toUpperCase()} + ${res.x||0}${t('audit.extra').charAt(0).toUpperCase()}</div>`;
    }
  });
  // Aggregate time for multi-block workouts
  if (blocks.length > 1) {
    let totalSec = 0, hasTime = false;
    blocks.forEach(b => {
      if (b.result && (b.result.m > 0 || b.result.s > 0)) {
        totalSec += (b.result.m || 0) * 60 + (b.result.s || 0);
        hasTime = true;
      }
    });
    const restSec = parseInt(w.restDuration || 0) ||
      (() => {
        // New format: total rest
        const m = (w.detail||'').match(/⏸ Total Rest Used:\s*(\d+):(\d+)/i);
        if (m) return parseInt(m[1])*60 + parseInt(m[2]);
        const m1s = (w.detail||'').match(/⏸ Total Rest Used:\s*(\d+)s/i);
        if (m1s) return parseInt(m1s[1]);
        // Old format: per-gap × gaps
        const m2 = (w.detail||'').match(/⏸ Rest between blocks:\s*(\d+):(\d+)/i);
        if (m2) return parseInt(m2[1])*60 + parseInt(m2[2]);
        const m2s = (w.detail||'').match(/⏸ Rest between blocks:\s*(\d+)s/i);
        if (m2s) return parseInt(m2s[1]);
        return 0;
      })();
    if (restSec > 0) {
      // restDuration is now total rest (new) or per-gap (old entries)
      const isOldFormat = !!(w.detail||'').match(/⏸ Rest between blocks:/i);
      const totalRestSec = isOldFormat ? restSec * (blocks.length - 1) : restSec;
      totalSec += totalRestSec;
      const rMin = Math.floor(totalRestSec/60), rSec = totalRestSec%60;
      const totalLabel = rMin > 0 ? `${rMin}:${rSec.toString().padStart(2,'0')}` : `${totalRestSec}s`;
      html += `<div style="font-size:.73rem;color:var(--accent);margin-top:6px;">⏸ ${t('res.total.rest')}: ${totalLabel}</div>`;
    }
    // Fallback: parse from detail text for old entries
    if (!hasTime) {
      const aggMatch = (w.detail || '').match(/(?:Aggregate Time|Tiempo Agregado|Tiempo Total):\s*(\d+):(\d+)/i);
      if (aggMatch) { totalSec = parseInt(aggMatch[1]) * 60 + parseInt(aggMatch[2]); hasTime = true; }
    }
    if (hasTime && totalSec > 0) {
      const am = Math.floor(totalSec / 60), as2 = totalSec % 60;
      html += `<div style="font-size:.74rem;font-weight:800;color:var(--brand);margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">⏱ ${t('audit.agg.time')}: ${String(am).padStart(2,'0')}:${String(as2).padStart(2,'0')}</div>`;
    }
  }

  return html || null;
}

function openHistoryModal(idx) {
  const w = getHistory()[idx]; if (!w) return;
  const d = new Date(w.date);
  const dateStr = fmtDate(d, {day:'2-digit',month:'short',year:'numeric'});
  const timeStr = fmtTime(d, {hour:'2-digit',minute:'2-digit'});
  const cvResult = getSessionCVEndurance(w); // computed once here, referenced in the grid below — not recomputed per tile

  // Derive modality colour for radar border
  const detail = (w.detail||'').toUpperCase();
  const modality = detail.includes('(EMOM)') ? 'emom' : detail.includes('(AMRAP)') ? 'amrap' : detail.includes('(TABATA)') ? 'tabata' : 'fortime';
  const modalityColors = {
    fortime: { border:'#FF6B35', bg:'rgba(255,107,53,.06)', label:'FOR TIME', color:'#FF6B35' },
    amrap:   { border:'#3B82F6', bg:'rgba(59,130,246,.06)', label:'AMRAP',    color:'#3B82F6' },
    emom:    { border:'#22C55E', bg:'rgba(34,197,94,.06)',  label:'EMOM',     color:'#22C55E' },
    tabata:  { border:'#F59E0B', bg:'rgba(245,158,11,.06)', label:'TABATA',   color:'#F59E0B' },
  };
  const mc = modalityColors[modality];

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-title">${w.label}</div>
    <div class="modal-subtitle">${dateStr} ${t('hist.modal.at')} ${timeStr}${w.rpe ? ` &nbsp;&middot;&nbsp; <span style="color:${getRPEColor(w.rpe)};font-weight:900;">RPE ${w.rpe}/10</span>` : ''}</div>
    ${(() => {
      // Sparkline — find previous attempts at same WOD label
      const attempts = getHistory().filter(e => e.label === w.label && e.pd).slice(0,6).reverse();
      if (attempts.length < 2) return '';
      const vals = attempts.map(e => parseFloat(e.pd)||0);
      const max = Math.max(...vals), min = Math.min(...vals);
      const range = max - min || 1;
      const W = 240, H = 48, pad = 6;
      const pts = vals.map((v,i) => {
        const x = pad + (i / (vals.length-1)) * (W - pad*2);
        const y = H - pad - ((v - min) / range) * (H - pad*2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const trend = vals[vals.length-1] >= vals[0] ? '#22C55E' : '#EF4444';
      return `<div style="background:var(--surface2);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <div style="font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:var(--label);margin-bottom:6px;">${t('hist.modal.intensity.trend').replace('{n}', attempts.length)}</div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:48px;display:block;">
          <polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          ${vals.map((v,i) => {
            const x = pad + (i / (vals.length-1)) * (W - pad*2);
            const y = H - pad - ((v - min) / range) * (H - pad*2);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${trend}"/>`;
          }).join('')}
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:.62rem;color:var(--label);margin-top:2px;">
          <span>${attempts[0].pd} W/kg</span><span>${attempts[attempts.length-1].pd} W/kg \u2190 today</span>
        </div>
      </div>`;
    })()}
    ${w.radar && sessionHasRadar(w) ? `<div class="modal-section" id="sig-section">
      <div class="modal-section-title">${t('hist.modal.sig.static')} <span style="font-size:.65rem;color:var(--label);font-weight:400;">${t('flip.hint')}</span></div>
      <div id="sig-radar-container"></div>
    </div>` : ''}
    <div class="modal-section">
      <div class="modal-section-title">${t('hist.modal.phys.static')}</div>
      ${(() => {
        // Rebuilt to match the live calculation flow's 6-card set,
        // order, content, and actual CSS (.metric-card/.unit/
        // .metric-val/.metric-unit — same classes the live #results
        // cards use, from styles.css) exactly. Layout follows Michael's
        // mockup: Cardio Intensity and Metabolic Cost split into a
        // left value column + right detail column. No benchmark bars
        // by design — dropped after the first pass.
        const pdVal = getSessionPower(w)?.total != null ? getSessionPower(w).total : parseFloat(w.pd) || 0;
        const wdVal = parseFloat(w.wd) || 0;
        const mcVal = parseFloat(w.mc) || 0;
        const fbVal = parseFloat(w.fb) || 0;
        const rlVal = (w.rl !== undefined && w.rl !== null) ? w.rl : 0;
        const tdVal = w.td ?? null;
        // Real Karvonen %HRR — (session avg HR − resting HR) / (HR max
        // − resting HR) — whenever the session has a real measured
        // avgHR AND the profile's Resting HR / HR Max fields are both
        // set. This is the SAME formula physics-core.js already uses
        // per-segment for the overhead calculation (see
        // _computeBlockOverheadAndCV), just applied to the session's
        // whole-session avgHR instead of one segment's. Falls back to
        // the pace/MET-derived estimate (reversing the MET formula
        // against VO2max) only when real HR data isn't available,
        // clearly labeled "(est.)" so it's never mistaken for measured.
        const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
        const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;
        let hrrDisplay = null; // { pct, isReal }
        if (w.avgHR != null && hrRestVal && hrMaxVal && hrMaxVal > hrRestVal) {
          const realPct = Math.max(0, Math.min(100, (w.avgHR - hrRestVal) / (hrMaxVal - hrRestVal) * 100));
          hrrDisplay = { pct: Math.round(realPct), isReal: true };
        } else if (cvResult && w.vo2max_used) {
          const estPct = Math.max(0, Math.min(100, (cvResult.met * 3.5 / w.vo2max_used) * 100));
          hrrDisplay = { pct: Math.round(estPct), isReal: false };
        }
        let rlContext = null;
        try { rlContext = (typeof reconstructRL === 'function') ? reconstructRL(w, null, true) : null; } catch (e) {}
        // Legend item — colored dot, muted label, bold value — matching
        // the segmented bar directly above it in the Session Data card.
        const dotRow = (color, label, value) => `<div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span><span style="color:var(--label);">${label} <span style="color:var(--text);font-weight:700;">${value}</span></span></div>`;
        const mcRows = [];
        const mcMechVal = w.mc_mech != null ? w.mc_mech : 0;
        const mcAeroVal = w.mc_aero || 0;
        const mcOverVal = w.mc_overhead || 0;
        if (w.mc_mech != null) mcRows.push(dotRow('#FF6B35', 'Mech', `${w.mc_mech} kcal`));
        if (w.mc_aero) mcRows.push(dotRow('#22C55E', 'Aero', `${w.mc_aero} kcal`));
        if (w.mc_overhead) mcRows.push(dotRow('#3B82F6', 'Over (est.)', `${w.mc_overhead} kcal`));
        // Bar segment widths — only meaningful when there's a genuine
        // total to divide by; collapses to an empty track otherwise
        // rather than showing a misleading proportion.
        const mcBarTotal = mcMechVal + mcAeroVal + mcOverVal;
        const mcMechPct = mcBarTotal > 0 ? (mcMechVal / mcBarTotal) * 100 : 0;
        const mcAeroPct = mcBarTotal > 0 ? (mcAeroVal / mcBarTotal) * 100 : 0;
        const mcOverPct = mcBarTotal > 0 ? (mcOverVal / mcBarTotal) * 100 : 0;

        // Scoped to just these History Modal cards via inline style —
        // .metric-card's orange left-accent box-shadow is shared with
        // the live flow's own cards, which weren't asked to change.
        const noAccent = 'box-shadow:none;';
        // eRaw banner — computed fresh via getERawDisplay (physics-
        // reconstruction.js), which itself calls getEngineScoreERaw and
        // maps its modality (MIXED/LOCO_RUN/LOCO_DU) to the right unit
        // label and plain-English sentence. Not read from a frozen
        // saved value — same "recompute fresh" convention the rest of
        // this modal's physics cards already follow, so this can never
        // drift from what Table 2 in the Workbench shows for the same
        // session.
        let eRawDisplay = null;
        try { eRawDisplay = (typeof getERawDisplay === 'function') ? getERawDisplay(w) : null; } catch (e) {}

        // Segmented breakdown — Work/Running/DU Efficiency, each over
        // only its own segment's MET-minutes (getSegmentedEfficiency),
        // distinct from Overall Efficiency's whole-session denominator
        // above (eRawDisplay). Computed regardless of Overall's
        // modality, since a session can genuinely have a computable
        // segmented breakdown even where Overall itself couldn't be —
        // and vice versa (e.g. a whole-block RPE fallback with cardio
        // movements: Overall still works from the total, but the
        // mechanical-specific split can't be attributed, see
        // getMechanicalSegmentMetMinutes's own reasoning).
        let segmented = { workEff: null, runEff: null, duEff: null, cycleEff: null };
        if (typeof getSegmentedEfficiency === 'function') {
          try { segmented = getSegmentedEfficiency(w); } catch (e) {}
        }
        const anySegmented = segmented.workEff != null || segmented.runEff != null || segmented.duEff != null || segmented.cycleEff != null;

        // Segmented-breakdown inner content built once, reused two ways
        // below — appended inside the Overall Efficiency card (one
        // unified card, the original look) when both exist, or wrapped
        // in its own standalone card when eRawDisplay alone is missing
        // (getEngineScoreERaw failed but getSegmentedEfficiency still
        // could — see that function's own comment on why this can
        // happen). Two independent top-level cards regardless of case
        // was a real visual regression from splitting them apart to fix
        // the null-eRawDisplay case — this restores "one card when both
        // are present" while keeping the fallback intact.
        const segmentedInner = anySegmented ? `${segmented.workEff != null ? `<div style="font-size:.78rem;color:var(--label);">${t('result.workeff.title') || 'Work'}: <strong style="color:var(--text);">${segmented.workEff.toFixed(2)} kJ / MET-min</strong> <span style="color:var(--label);">(${Math.round(segmented.workMetMin)} MET-min)</span>${segmented.workIsEstimate ? ' (est.)' : ''}</div>` : ''}
            ${segmented.runEff != null ? `<div style="font-size:.78rem;color:var(--label);">${t('hist.modal.runeraw.title') || 'Running'}: <strong style="color:var(--text);">${segmented.runEff.toFixed(1)} m / MET-min</strong> <span style="color:var(--label);">(${Math.round(segmented.runMetMin)} MET-min)</span>${segmented.runIsEstimate ? ' (est.)' : ''}</div>` : ''}
            ${segmented.duEff != null ? `<div style="font-size:.78rem;color:var(--label);">${t('hist.modal.dueraw.title') || 'DU'}: <strong style="color:var(--text);">${segmented.duEff.toFixed(1)} reps / MET-min</strong> <span style="color:var(--label);">(${Math.round(segmented.duMetMin)} MET-min)</span>${segmented.duIsEstimate ? ' (est.)' : ''}</div>` : ''}
            ${segmented.cycleEff != null ? `<div style="font-size:.78rem;color:var(--label);">${t('hist.modal.cycleeraw.title') || 'Cycling'}: <strong style="color:var(--text);">${segmented.cycleEff.toFixed(1)} m / MET-min</strong> <span style="color:var(--label);">(${Math.round(segmented.cycleMetMin)} MET-min)</span>${segmented.cycleIsEstimate ? ' (est.)' : ''}</div>` : ''}` : '';

        return `${eRawDisplay ? `<div class="metric-card" style="margin-bottom:20px;background:linear-gradient(135deg, rgba(255,107,0,.12) 0%, rgba(22,27,38,.95) 100%);border-left:4px solid #FF6B00;box-shadow:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="unit" style="margin-bottom:0;">${t('hist.modal.eraw.title') || 'Overall Efficiency'}</span>
            <span style="font-size:.6rem;font-weight:800;color:var(--label);background:rgba(255,255,255,.06);border:1px solid var(--glass-border);border-radius:20px;padding:3px 10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;">${eRawDisplay.unitLabel === 'kJ / MET-min' ? 'Work / Strain' : eRawDisplay.unitLabel === 'm / MET-min' ? 'Distance / Strain' : 'Reps / Strain'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:8px;flex-wrap:wrap;">
            <div style="display:flex;align-items:baseline;gap:6px;min-width:0;">
              <span style="font-size:2.5rem;font-weight:900;color:var(--text);line-height:1;letter-spacing:-.02em;">${eRawDisplay.value.toFixed(2)}</span>
              <span class="metric-unit">${eRawDisplay.unitLabel}</span>
            </div>
            <div style="font-size:.72rem;color:var(--text);text-align:right;max-width:240px;line-height:1.4;">${eRawDisplay.sentence}</div>
          </div>
          ${anySegmented ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--glass-border);">
            <div style="font-size:.6rem;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">${t('result.segmented.breakdown') || 'Segmented Breakdown'}</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${segmentedInner}
            </div>
          </div>` : ''}
        </div>` : (anySegmented ? `<div class="metric-card" style="margin-bottom:20px;background:linear-gradient(135deg, rgba(255,107,0,.12) 0%, rgba(22,27,38,.95) 100%);border-left:4px solid #FF6B00;box-shadow:none;">
          <div style="font-size:.6rem;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">${t('result.segmented.breakdown') || 'Segmented Breakdown'}</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${segmentedInner}
          </div>
        </div>` : '')}
        <div class="grid-2" style="gap:10px;">
          <div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.total.power')}</span>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span class="metric-val" style="color:${getPDColor(pdVal)}">${pdVal.toFixed(2)}</span>
              <span class="metric-unit">W/kg</span>
            </div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('hist.modal.metric.pd.caption') || 'Average work rate relative to bodyweight — how fast, not how much'}</div>
          </div>
          ${cvResult ? `<div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.aero.power')}</span>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span class="metric-val">${cvResult.met.toFixed(1)}</span>
              <span class="metric-unit">MET</span>
            </div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('result.cvintensity.caption') || 'How hard your cardiovascular system worked, time-weighted across the whole session.'}</div>
          </div>` : ''}
          <div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.total.work')}</span>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span class="metric-val">${wdVal.toFixed(1)}</span>
              <span class="metric-unit">kJ</span>
            </div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('hist.modal.metric.wd.caption') || 'Total physical work performed — reps × weight × distance, summed'}</div>
          </div>
          <div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.cardio.strain')}</span>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span class="metric-val">${cvResult ? Math.round(cvResult.metMinutes) : 0}</span>
              <span class="metric-unit">MET-min</span>
            </div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('result.cardiostrain.caption') || 'Total accumulated metabolic volume — cardio intensity carried across the whole session\'s duration, not just the average.'}</div>
          </div>
          <div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.force.bias2')}</span>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span class="metric-val">${fbVal.toFixed(0)}</span>
              <span class="metric-unit">kg/kJ</span>
            </div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('hist.modal.metric.fb.caption') || 'Load moved per unit of work — higher means heavier, slower reps'}</div>
          </div>
          <div class="metric-card" style="${noAccent}">
            <span class="unit">${t('result.tech.demand')}</span>
            <div class="metric-val" style="color:#00E676;">${tdVal != null ? tdVal + ' / 5' : '—'}</div>
            <div style="font-size:.64rem;color:var(--label);margin-top:6px;line-height:1.4;">${t('result.techdemand.caption') || 'Rep-weighted average skill complexity across all movements completed.'}</div>
          </div>
        </div>
        <div class="metric-card" style="margin-top:10px;background:linear-gradient(135deg, rgba(255,107,0,.12) 0%, rgba(22,27,38,.95) 100%);border-left:4px solid #FF6B00;box-shadow:none;">
          <span class="unit" style="margin-bottom:10px;">${t('result.sessiondata.title') || 'Session Data'}</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:6px;">
            ${(w.avgHR != null || hrrDisplay) ? `<div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M12 21s-7-4.5-9.5-9C1 8.5 2.5 5 6 5c2 0 3.5 1.5 4 2.5.5-1 2-2.5 4-2.5 3.5 0 5 3.5 3.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>
                <span style="font-size:.6rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;">${t('result.sessiondata.hr') || 'Heart Rate'}</span>
              </div>
              ${w.avgHR != null ? `<div style="font-size:1rem;font-weight:800;color:var(--text);line-height:1;">
                ${w.avgHR}<span style="font-size:.68rem;color:var(--label);font-weight:600;"> / ${w.maxHR ?? '—'} bpm</span>
              </div>` : ''}
              ${hrrDisplay ? `<div style="font-size:.7rem;color:var(--label);margin-top:6px;">${hrrDisplay.pct}% HRR${hrrDisplay.isReal ? '' : ' (est.)'}</div>` : ''}
              ${hrrDisplay && !hrrDisplay.isReal ? `<div style="font-size:.6rem;color:var(--label);margin-top:5px;line-height:1.4;">${t('aero.power.estimated')}</div>` : ''}
            </div>` : ''}
            <div style="grid-column:${(w.avgHR != null || hrrDisplay) ? '2' : '1 / -1'};">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M4 8v8M2 10v4M22 10v4M20 8v8M8 12h8"/></svg>
                <span style="font-size:.6rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;">${t('result.sessiondata.rl') || 'Relative Load'}</span>
              </div>
              <div style="font-size:1rem;font-weight:800;color:var(--text);line-height:1;">
                ${rlVal}<span style="font-size:.68rem;color:var(--label);font-weight:600;"> %1RM</span>
              </div>
              ${rlContext?.movementName ? `<div style="font-size:.7rem;color:var(--label);margin-top:6px;">${rlContext.movementName}</div>` : ''}
            </div>
            <div style="grid-column:1/-1;padding-top:14px;border-top:1px solid var(--glass-border);">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-2-1-3-1-3s2 1 2 4a5 5 0 0 1-10 0c0-5 4-6 4-10z"/></svg>
                <span style="font-size:.6rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;">${t('result.sessiondata.mc') || 'Metabolic Cost'}</span>
              </div>
              <div style="font-size:1rem;font-weight:800;color:var(--text);line-height:1;">
                ${mcVal.toFixed(0)}<span style="font-size:.68rem;color:var(--label);font-weight:600;"> kcal</span>
              </div>
              <div style="display:flex;width:100%;height:8px;border-radius:20px;overflow:hidden;background:var(--glass-inner);margin-top:10px;">
                <div style="background:#FF6B35;height:100%;width:${mcMechPct}%;"></div>
                <div style="background:#22C55E;height:100%;width:${mcAeroPct}%;"></div>
                <div style="background:#3B82F6;height:100%;width:${mcOverPct}%;"></div>
              </div>
              ${mcRows.length ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;">${mcRows.join('')}</div>` : ''}
            </div>
          </div>
        </div>`;
      })()}
    </div>
    <div class="modal-section">
      <div class="modal-section-title">${t('hist.modal.log.static')}</div>

      ${w.roundSplits && w.roundSplits.length > 1 ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:.68rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">⏱ Round Splits</div>
        ${(() => {
          // Group by block
          const blocks = {};
          w.roundSplits.forEach(s => {
            const b = s.block || 1;
            if (!blocks[b]) blocks[b] = [];
            blocks[b].push(s);
          });
          const blockKeys = Object.keys(blocks).map(Number).sort((a,b)=>a-b);
          const multiBlock = blockKeys.length > 1;
          return blockKeys.map(bk => {
            const splits = blocks[bk];
            const avgSplit = splits.reduce((a,s)=>a+s.splitSec,0)/splits.length;
            const rows = splits.map((s, idx) => {
              const sm = Math.floor(s.splitSec/60), ss = s.splitSec%60;
              const cm = Math.floor(s.cumSec/60), cs = s.cumSec%60;
              const splitStr = String(sm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
              const cumStr   = String(cm).padStart(2,'0')+':'+String(cs).padStart(2,'0');
              const color = s.splitSec <= avgSplit*0.97 ? '#22C55E' : s.splitSec >= avgSplit*1.03 ? '#EF4444' : 'var(--text)';
              const bg = idx%2===0 ? 'var(--surface2)' : 'transparent';
              return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:5px 6px;background:${bg};border-radius:4px;">
                <div style="font-size:.75rem;font-weight:700;color:var(--label);">R${s.round}</div>
                <div style="font-size:.75rem;font-weight:800;color:${color};">${splitStr}</div>
                <div style="font-size:.75rem;color:var(--label);">${cumStr}</div>
              </div>`;
            }).join('');
            const avgM = Math.floor(avgSplit/60), avgS = Math.round(avgSplit%60);
            return `${multiBlock ? `<div style="font-size:.68rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.04em;margin:6px 0 4px;">Block ${bk}</div>` : ''}
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:4px;">
              <div style="font-size:.65rem;font-weight:800;color:var(--label);text-transform:uppercase;">Round</div>
              <div style="font-size:.65rem;font-weight:800;color:var(--label);text-transform:uppercase;">Split</div>
              <div style="font-size:.65rem;font-weight:800;color:var(--label);text-transform:uppercase;">Cumulative</div>
            </div>
            ${rows}
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:5px 6px;border-top:1px solid var(--border);margin-top:4px;">
              <div style="font-size:.68rem;font-weight:800;color:var(--label);">AVG</div>
              <div style="font-size:.68rem;font-weight:800;color:var(--text);">${String(avgM).padStart(2,'0')}:${String(avgS).padStart(2,'0')}</div>
              <div></div>
            </div>`;
          }).join('');
        })()}
      </div>` : ''}
      ${(() => {
        const tableHtml = buildHistoryOverviewTable(w);
        if (tableHtml) {
          return `<div style="font-size:.8rem;line-height:1.7;background:var(--surface2);border-radius:8px;padding:10px 12px;">${tableHtml}</div>`;
        }
        // Fallback: old detail text for entries without blocks data
        const d = w.detail || '—';
        const lines = d.includes('\n') ? d.split('\n') : d.split('|');
        return `<div class="modal-detail-text">${lines.map(line => {
          const t2 = line.trim();
          if (!t2) return '';
          if (!line.startsWith('  ') && !line.startsWith('---') && t2 !== '—') return `<div style="font-weight:800;color:var(--brand);margin-top:6px;">${t2}</div>`;
          if (t2.startsWith('⚡')) return `<div style="color:#F59E0B;padding-left:8px;">${t2}</div>`;
          if (t2 === '---') return '';
          return `<div style="padding-left:8px;">${t2}</div>`;
        }).join('')}</div>`;
      })()}
    </div>`;

  // Movement pattern section in modal
  if (w.patternProfile) {
    // Safely parse — patternProfile may be an object (local) or a JSON string (cloud restore)
    let pp = w.patternProfile;
    if (typeof pp === 'string') { try { pp = JSON.parse(pp); } catch(e) { pp = null; } }

    const PATTERN_META = getPATTERNMETA();

    const hasPatternData = pp && Object.keys(pp.patternPct || {}).length > 0;

    const dominantLine = pp && pp.dominantPattern && pp.dominantPattern !== 'unknown'
      ? `<div style="font-size:.8rem;font-weight:700;color:var(--text);margin-bottom:10px;">
           ${PATTERN_META[pp.dominantPattern]?.label || pp.dominantPattern}-${t('energy.dominant.end')}
         </div>`
      : '';

    const patternTags = hasPatternData
      ? `<div style="margin-top:8px;">
          ${Object.entries(pp.patternPct).sort((a,b)=>b[1]-a[1]).map(([k,v]) =>
            `<div style="margin-bottom:5px;">
               <div style="display:flex;justify-content:space-between;font-size:.7rem;font-weight:700;color:var(--label);margin-bottom:2px;">
                 <span>${PATTERN_META[k]?.label || k}</span><span>${(v*100).toFixed(1)}%</span>
               </div>
               <div style="height:5px;background:var(--surface2);border-radius:3px;overflow:hidden;">
                 <div style="height:100%;width:${(v*100).toFixed(1)}%;background:${PATTERN_META[k]?.color||'var(--brand)'};border-radius:3px;"></div>
               </div>
             </div>`).join('')}
         </div>`
      : '';

    const noDataMsg = !hasPatternData
      ? `<div style="font-size:.75rem;color:var(--label);font-style:italic;">
           Movement pattern not calculated for this session. Run Calculate Physics to capture it next time.
         </div>`
      : '';

    document.getElementById('modalContent').innerHTML += `
      <div class="modal-section">
        <div class="modal-section-title">${t('hist.modal.energy.static')}</div>
        ${dominantLine}${patternTags}${noDataMsg}
      </div>`;
  }

  const hasBlocks = !!(w.blocks && w.blocks.length);

  // ── Prilepin / Strength Recovery section ──
  const wFb = parseFloat(w.fb)||0;
  // Use peak RL from getRecoveryFromEntry instead of Force Bias gate
  const rec = getRecoveryFromEntry(w);
  if (rec) {
      document.getElementById('modalContent').innerHTML += `
        <div class="modal-section" style="margin-top:12px;">
          <div class="modal-section-title">${t('hist.modal.recovery')}</div>
          <div style="background:${rec.color}10;border:1px solid ${rec.color}33;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
            <div style="font-size:.78rem;font-weight:800;color:${rec.color};margin-bottom:6px;">⏱️ ${rec.label} recovery recommended</div>
            <div style="font-size:.72rem;color:var(--label);line-height:1.65;">
              Peak load: <strong style="color:var(--text);">${rec.peakKg}kg — ${rec.rl}% of 1RM${rec.hasPRData ? '' : ' (avg)'}</strong><br>
              Reps at peak: <strong style="color:var(--text);">${rec.peakReps}</strong>${rec.peakName ? ` (${rec.peakName})` : ''}<br>
              Base recovery: <strong style="color:var(--text);">${rec.hours - (rec.peakReps >= 7 ? 24 : rec.peakReps >= 4 ? 12 : 0)}h</strong>
              ${rec.peakReps >= 4 ? ` + <strong style="color:var(--text);">${rec.peakReps >= 7 ? 24 : 12}h</strong> for volume at peak load` : ''}
            </div>
          </div>
          <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:8px;">
            <span style="font-size:1rem;">💡</span>
            <div>
              <span style="font-size:.74rem;color:var(--text);font-weight:600;">${rec.rec}</span>
              <div style="font-size:.7rem;color:var(--label);margin-top:2px;">Ready to train again: <strong style="color:var(--text);">${(() => {
                const d = new Date(w.date);
                d.setHours(d.getHours() + rec.hours);
                return fmtDate(d, {weekday:'short', day:'numeric', month:'short'}) + ' ' + t('hist.modal.at') + ' ' + fmtTime(d, {hour:'2-digit', minute:'2-digit'});
              })()}</strong></div>
            </div>
          </div>
        </div>`;
  }

  document.getElementById('modalContent').innerHTML += `
    ${hasBlocks ? `<button class="btn btn-primary" onclick="loadHistoryToBuilder(${idx})" style="width:100%;margin-top:16px;margin-bottom:8px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="display:block;flex-shrink:0;"><polyline points="9,18 15,12 9,6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>${t('hist.load.builder')}</button>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:${hasBlocks?'0':'16px'};">
      <button class="btn" onclick="editHistoryEntry(${idx})" style="background:var(--surface2);color:var(--text);border:1.5px solid var(--border);">${t('hist.modal.edit')}</button>
      <button class="btn" onclick="deleteHistory(${idx});closeHistoryModal()" style="background:rgba(239,68,68,.1);color:var(--danger);border:1.5px solid rgba(239,68,68,.3);">${t('hist.modal.delete')}</button>
    </div>`;
  document.getElementById('historyModal').classList.add('open');
  // Build sig flip card after modal is fully rendered
  if (w.radar && sessionHasRadar(w)) {
    const modality = (w.blocks?.[0]?.mode||'fortime');
    const modalityColors = {
      fortime: { border:'#FF6B35' }, amrap: { border:'#22C55E' },
      emom:    { border:'#60A5FA' }, tabata:{ border:'#F59E0B' },
    };
    const color = (modalityColors[modality]||modalityColors.fortime).border;
    const tryBuild = (attempts) => {
      const c = document.getElementById('sig-radar-container');
      if (c) {
        _buildSigFlip(w.radar, color, w);
      } else if (attempts > 0) {
        setTimeout(() => tryBuild(attempts - 1), 100);
      }
    };
    setTimeout(() => tryBuild(5), 100);
  }
}

function loadHistoryToBuilder(idx) {
  const w = getHistory()[idx]; if (!w || !w.blocks) return;
  if (!confirm('Load "' + w.label + '" to Builder? Your current blocks will be replaced.')) return;
  closeHistoryModal();
  // Restore rest duration
  const re = document.getElementById('rest-duration-sec'), rd = document.getElementById('rest-duration-val');
  if (re && w.restDuration) {
    re.value = w.restDuration;
    const rl = {'0':t('timer.no.rest.label'),'30':'30 sec','60':'1 min','90':'1:30 min','120':'2 min','180':'3 min','300':'5 min'};
    if (rd) rd.textContent = rl[w.restDuration] || w.restDuration + 's';
    localStorage.setItem('wod_rest_duration', w.restDuration);
  }
  restoreBlocksFromTemplate(w.blocks);
  switchTab(1);
  showToast(t('toast.loaded.builder') + ': ' + w.label);
}

function closeHistoryModal(e) {
  if (!e || e.target === document.getElementById('historyModal') || e.currentTarget === document.querySelector('.modal-close')) {
    document.getElementById('historyModal').classList.remove('open');
  }
}

function editHistoryEntry(idx) {
  const hist=getHistory(), w=hist[idx]; if(!w) return;
  const d=new Date(w.date), pad=n=>String(n).padStart(2,'0');
  const ldt=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const is=`width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.82rem;font-family:inherit;margin-bottom:10px;`;
  document.getElementById('modalContent').innerHTML=`
    <div class="modal-title" data-i18n="history.edit.entry">Edit Entry</div>
    <div class="modal-subtitle">Changes are saved and synced automatically.</div>
    <div style="margin-top:14px;">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;" data-i18n="box.workout.name">Workout Name</label>
      <input type="text" id="edit-label" value="${(w.label||'').replace(/"/g,'&quot;')}" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;"><span data-i18n="block.date.time"></span></label>
      <input type="datetime-local" id="edit-date" value="${ldt}" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;"><span data-i18n="phys.intensity"></span> pd</label>
      <input type="number" id="edit-pd" value="${w.pd||0}" step="0.01" min="0" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;"><span data-i18n="phys.total.work"></span> wd</label>
      <input type="number" id="edit-wd" value="${(parseFloat(w.wd)||0).toFixed(2)}" step="0.01" min="0" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;"><span data-i18n="phys.met.cost"></span> mc</label>
      <input type="number" id="edit-mc" value="${w.mc||0}" step="0.1" min="0" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;"><span data-i18n="phys.force.bias"></span> fb</label>
      <input type="number" id="edit-fb" value="${w.fb||0}" step="0.01" min="0" style="${is}">
      <label style="font-size:.72rem;font-weight:700;color:var(--text);display:block;margin-bottom:4px;" data-i18n="label.rpe">RPE (1–10)</label>
      <input type="number" id="edit-rpe" value="${w.rpe||''}" min="1" max="10" step="1" placeholder="optional" style="${is}margin-bottom:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn" onclick="saveHistoryEdit(${idx})" style="background:var(--success);color:white;">&#10003; Save</button>
        <button class="btn" onclick="openHistoryModal(${idx})" style="background:var(--surface2);color:var(--label);border:1px solid var(--border);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="display:block;flex-shrink:0;"><polyline points="15,18 9,12 15,6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Cancel</button>
      </div>
    </div>`;
}

function saveHistoryEdit(idx) {
  const hist=getHistory(), w=hist[idx]; if(!w) return;
  const newLabel=document.getElementById('edit-label')?.value.trim()||w.label;
  const rawDate=document.getElementById('edit-date')?.value;
  let newDate = w.date;
  if (rawDate) {
    // datetime-local gives YYYY-MM-DDTHH:MM in local time — convert to UTC ISO string
    const localDate = new Date(rawDate);
    newDate = !isNaN(localDate) ? localDate.toISOString() : w.date;
  }
  if (!newDate||isNaN(new Date(newDate))) { showToast('Invalid date','error'); return; }
  const newRPE = document.getElementById('edit-rpe')?.value;
  const rpeVal = newRPE ? parseInt(newRPE) : (w.rpe || undefined);
  // Spread all existing fields (preserves radar, mc_mech, mc_aero, mc_overhead etc.)
  const updatedEntry = {...w, label:newLabel, date:newDate,
    pd:document.getElementById('edit-pd')?.value||w.pd,
    wd:document.getElementById('edit-wd')?.value||w.wd,
    mc:document.getElementById('edit-mc')?.value||w.mc,
    fb:document.getElementById('edit-fb')?.value||w.fb,
    rpe:rpeVal};
  hist[idx] = updatedEntry;
  saveHistory(hist);
  // Auto-push to Supabase
  const sbInst = getSB();
  if (sbInst) {
    sbInst.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const uid = session.user.id;
      try {
        // If date changed, delete old entry first
        if (new Date(w.date).toISOString() !== new Date(newDate).toISOString()) {
          const { error: delErr } = await sbInst.from('workouts')
            .delete().eq('date', w.date).eq('user_id', uid);
          if (delErr) console.warn('[sync] Delete old entry failed:', delErr);
          // Also try deleting by UTC normalised date in case format differs
          const oldUTC = new Date(w.date).toISOString();
          if (oldUTC !== w.date) {
            await sbInst.from('workouts').delete().eq('date', oldUTC).eq('user_id', uid);
          }
        }
        // Push updated entry
        await sbPushHistoryEntry(updatedEntry, uid, sbInst);
        console.log('[sync] History entry updated in cloud');
      } catch(e) {
        console.warn('[sync] History edit push failed:', e);
        queueUpload('history', updatedEntry);
        showToast('⚠️ Saved locally — cloud sync pending', 'warning');
      }
    });
  }
  // Clear unlock cache since dates may have changed — recalculates on next access
  localStorage.removeItem('wod_profile_unlocked_at');
  rebuildBenchmarkPRs();
  renderHistory();
  if (currentTab===3) { renderAnalytics(); renderTrainingLoad(); }
  showToast(t('toast.entry.updated'));
  closeHistoryModal();
}
const BM_PERSONAL_MIN = 5;

function localISOString() {
  // Store as UTC ISO string — consistent across devices and matches Supabase storage
  // Display layer converts to local time using toLocaleTimeString()
  return new Date().toISOString();
}

function getProfileUnlockedAt() {
  // Returns the ISO date string of the 5th qualifying session, or null
  const cached = localStorage.getItem('wod_profile_unlocked_at');
  if (cached) return cached;
  // Calculate retroactively — find 5th oldest qualifying session
  const hist = getHistory().filter(w => w.pd && parseFloat(w.pd) > 0);
  if (hist.length <= BM_PERSONAL_MIN) return null;
  const sorted = [...hist].sort((a,b) => new Date(a.date) - new Date(b.date));
  const unlockDate = sorted[BM_PERSONAL_MIN].date; // 6th session (index 5)
  localStorage.setItem('wod_profile_unlocked_at', unlockDate);
  return unlockDate;
}

function sessionHasRadar(w) {
  // Session should show radar only if saved on or after profile unlock date
  const unlockDate = getProfileUnlockedAt();
  if (!unlockDate) return false;
  return new Date(w.date) >= new Date(unlockDate);
}

function hasEnoughHistory() {
  return getHistory().filter(w => w.pd && parseFloat(w.pd) > 0).length >= BM_PERSONAL_MIN;
}

function historyProgressMsg() {
  const n = getHistory().filter(w => w.pd && parseFloat(w.pd) > 0).length;
  return `<div style="text-align:center;padding:20px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin:12px 0;">
    <div style="font-size:1.4rem;margin-bottom:8px;">📊</div>
    <div style="font-size:.78rem;font-weight:800;color:var(--text);margin-bottom:6px;">Personal Profile Unlocks at 5 Sessions</div>
    <div style="font-size:.72rem;color:var(--label);margin-bottom:12px;">Complete ${BM_PERSONAL_MIN - n} more session${BM_PERSONAL_MIN - n === 1 ? '' : 's'} to unlock your personal performance bands, session signature radar and training profile.</div>
    <div style="background:var(--surface2);border-radius:4px;height:6px;overflow:hidden;">
      <div style="background:var(--brand);height:100%;width:${Math.round(n/BM_PERSONAL_MIN*100)}%;border-radius:4px;transition:width .3s;"></div>
    </div>
    <div style="font-size:.68rem;color:var(--label);margin-top:6px;">${n} of ${BM_PERSONAL_MIN} sessions</div>
  </div>`;
}

