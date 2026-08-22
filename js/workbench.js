/* ════════════════════════════════════════════════════
   SESSION COVERAGE WORKBENCH
   Session-matching (gate thresholds, bidirectional match
   finding), the E_raw progression timeline, the comparable-
   sessions table, and the FB/Duration chart that hosts all
   of it — including its MET-color gradient and per-target
   ring highlighting.
════════════════════════════════════════════════════ */

// Distance-based match score for a single axis: 100 when candidate exactly
// equals target, decreasing as it diverges in either direction. Target=0
// with candidate=0 is treated as a perfect match (both genuinely absent);
// target=0 with candidate>0 is treated as a complete mismatch, since the
// ratio is undefined and the two sessions plainly differ on that axis.
function axisMatchScore(targetVal, candidateVal) {
  if (targetVal === 0) return candidateVal === 0 ? 100 : 0;
  const ratio = candidateVal / targetVal * 100;
  return Math.max(0, 100 - Math.abs(ratio - 100));
}

// Defaults for Session Match's four gates — user-adjustable (see
// getSessionMatchSettings/saveSessionMatchSettings below), since the
// "right" threshold is a function of how much history exists, not a
// fixed truth. These starting values were validated against a real,
// ~47-session history before being set as defaults.
const SESSION_MATCH_DEFAULTS = {
  fbMaxGap: 6,        // fixed absolute FB points — recalibrated against real post-migration data (final v3 eccentric-work design: wd always pure concentric, mc_mech unchanged). New FB range 31-190 vs original 29-165, proportionally scaled threshold 5.8, rounded to 6.
  durationMin: 75,    // % similarity (min/max*100)
  workPerRepMin: 68,  // % similarity (min/max*100) — replaces the old Movement Bias gate (biasMin) entirely; see getSessionWorkPerRep()'s comment for why.
  mechShareMin: 70    // % similarity (min/max*100) — a real, ~50-point gap separates genuine mismatches (43-48%) from everything else (75%+) in validated data, so this sits comfortably in that gap; see getSessionMechShare()'s comment for why this is a distinct gate from work/rep, not a duplicate of it.
};

function getSessionMatchSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('wod-session-match-settings') || '{}');
    return {
      fbMaxGap: Number.isFinite(stored.fbMaxGap) ? stored.fbMaxGap : SESSION_MATCH_DEFAULTS.fbMaxGap,
      durationMin: Number.isFinite(stored.durationMin) ? stored.durationMin : SESSION_MATCH_DEFAULTS.durationMin,
      workPerRepMin: Number.isFinite(stored.workPerRepMin) ? stored.workPerRepMin : SESSION_MATCH_DEFAULTS.workPerRepMin,
      mechShareMin: Number.isFinite(stored.mechShareMin) ? stored.mechShareMin : SESSION_MATCH_DEFAULTS.mechShareMin
    };
  } catch (e) {
    return { ...SESSION_MATCH_DEFAULTS };
  }
}

function saveSessionMatchSettings(settings) {
  const current = getSessionMatchSettings();
  const merged = { ...current, ...settings };
  localStorage.setItem('wod-session-match-settings', JSON.stringify(merged));
  return merged;
}

// Finds the best comparable prior session for a target, using a two-stage
// gate validated against real data: Selection (Force Bias + Duration,
// independently thresholded) determines which candidates are even
// considered, then work/rep (independently thresholded) determines
// whether the candidate used genuinely comparable loading per rep, not
// just similar overall load character and duration. A candidate must
// clear both to be returned — this deliberately can return no match at
// all, which is the honest answer when nothing in the athlete's history
// is genuinely comparable yet.
//
// Energy System was a third stage here until it was removed entirely —
// classifying it by fixed movement type rather than actual session
// duration/pacing was never physiologically accurate (a Deadlift is
// tagged phosphagen regardless of whether it's a single heavy rep or 150
// reps for time), and there was no reliable way to fix it without genuine
// rest-tracking data the app doesn't currently capture.
//
// Movement Bias (energyProfile.biasPct) filled this third-gate role
// before this change — it's been replaced with work/rep for the same
// underlying reason Energy System was removed: Movement Bias classifies
// by each movement's fixed MASTER_DB tag, not by how it was actually
// performed (a light Bench Press session still reads as "Strength").
// work/rep looks at the session's actual loading instead. Validated
// against a real ~47-session history: it correctly separated real
// session pairs that passed FB+Duration but used meaningfully different
// loading per rep (e.g. a heavy Deadlift-based session vs. a lighter
// kettlebell complex at matching FB and duration).
//
// FB uses a fixed absolute gap (default: within 6 points), not a
// range-relative percentage. A range-relative threshold silently changes
// meaning any time FB's underlying scale shifts — exactly what happened
// when FB was reformulated to exclude Overhead and Aerobic, which required
// a full re-derivation of what "90%" even meant in absolute terms. A fixed
// gap has no such dependency and needs no recalibration going forward.
//
// All three thresholds are user-adjustable (getSessionMatchSettings) —
// the right threshold is a function of how much history exists, not a
// fixed truth, and should loosen or tighten as an athlete logs more data.
// Shared per-candidate gate evaluation, used by both findAllSessionMatches
// (past-only, existing callers throughout the app) and
// findAllSessionMatchesBidirectional (the Workbench's past+future
// matcher) — the four gates themselves are identical either way; only
// which candidates get considered differs between the two callers.
function _evaluateSessionMatchGates(targetEntry, c, gates, targetFb, targetDur, targetWpr, targetMechShare) {
  const cFb = parseFloat(c.fb);
  const cDur = parseFloat(c.duration_sec);
  const fbGap = Math.abs(cFb - targetFb);
  const durSim = Math.min(cDur, targetDur) / Math.max(cDur, targetDur) * 100;
  if (fbGap > gates.fbMaxGap || durSim < gates.durationMin) return null;
  // Display percentage: how close the full FB values are to each other,
  // proportionally — same shape as durSim. A gap that's small relative
  // to the gate but large relative to a low FB value (e.g. a 2-point
  // gap on a session with FB=28) was showing as a misleadingly harsh
  // score (57%) under the old gap-vs-threshold formula, even though the
  // sessions are genuinely quite close. The gate itself is unaffected —
  // it still passes or fails purely on the fixed-point gap above.
  const fbSim = Math.min(cFb, targetFb) / Math.max(cFb, targetFb) * 100;

  const cWpr = getSessionWorkPerRep(c);
  if (cWpr == null) return null;

  // Symmetric min/max ratio, matching Duration's gate (durSim above) —
  // NOT axisMatchScore(), which is asymmetric (swapping which session
  // is "target" vs "candidate" changes the result, e.g. 53% one way vs
  // 68% the other for the same pair) and would make this gate's
  // pass/fail outcome depend on an arbitrary ordering rather than
  // genuine similarity. This is also the exact formula validated
  // against real session data before this gate was built.
  const wprSim = Math.min(targetWpr, cWpr) / Math.max(targetWpr, cWpr) * 100;
  if (wprSim < gates.workPerRepMin) return null;

  const cMechShare = getSessionMechShare(c);
  if (cMechShare == null) return null;
  const mechShareSim = Math.min(targetMechShare, cMechShare) / Math.max(targetMechShare, cMechShare) * 100;
  if (mechShareSim < gates.mechShareMin) return null;

  const selectionScore = (fbSim + durSim + wprSim + mechShareSim) / 4;
  return { session: c, fbSim, fbGap, durSim, wprSim, mechShareSim, selectionScore };
}

// Bi-directional variant for the Session Coverage Workbench — considers
// candidates on EITHER side of the target in time, not just prior
// sessions, so efficiency progression can be traced both backward (how
// did I get here) and forward (how did this session's approach evolve
// afterward). Shares the exact same four gates as findAllSessionMatches
// via _evaluateSessionMatchGates — the only difference is which
// candidates are considered at all, not how they're judged once
// considered. findAllSessionMatches itself is untouched and keeps its
// past-only behavior for its existing callers throughout the app.
function findAllSessionMatchesBidirectional(targetEntry, history) {
  const gates = getSessionMatchSettings();
  const allValid = history.filter(w => w.fb && parseFloat(w.fb) > 0 && w.duration_sec != null && w.date);
  if (allValid.length < 2) return { matches: [], reason: 'insufficient_history' };

  const targetFb = parseFloat(targetEntry.fb);
  const targetDur = parseFloat(targetEntry.duration_sec);
  const targetTime = new Date(targetEntry.date).getTime();
  const targetWpr = getSessionWorkPerRep(targetEntry);
  if (targetWpr == null) return { matches: [], reason: 'target_missing_profile' };
  const targetMechShare = getSessionMechShare(targetEntry);
  if (targetMechShare == null) return { matches: [], reason: 'target_missing_profile' };

  const candidates = allValid.filter(w => w.date !== targetEntry.date);
  if (!candidates.length) return { matches: [], reason: 'insufficient_history' };

  const passing = [];
  candidates.forEach(c => {
    const result = _evaluateSessionMatchGates(targetEntry, c, gates, targetFb, targetDur, targetWpr, targetMechShare);
    if (result) {
      result.direction = new Date(c.date).getTime() < targetTime ? 'past' : 'future';
      passing.push(result);
    }
  });

  passing.sort((a, b) => new Date(a.session.date) - new Date(b.session.date));
  return { matches: passing, reason: passing.length ? null : 'no_comparable_session' };
}

// Match count for every session in history against every other session,
// at the CURRENT global thresholds — powers the Coverage Cloud's node
// styling (glow/size scaled by match count). Deliberately a separate,
// lighter pass rather than calling findAllSessionMatchesBidirectional
// once per session: that function does extra work (sorting, building
// full match objects with all four gate scores) this only needs a count
// from. O(n²) either way given the matching itself is inherently
// pairwise, but this skips work no caller here needs.
function getSessionMatchCountMap(history) {
  const gates = getSessionMatchSettings();
  const allValid = history.filter(w => w.fb && parseFloat(w.fb) > 0 && w.duration_sec != null && w.date);
  const counts = new Map();
  allValid.forEach(entry => {
    const wpr = getSessionWorkPerRep(entry);
    const mechShare = getSessionMechShare(entry);
    if (wpr == null || mechShare == null) { counts.set(entry.date, 0); return; }
    const fb = parseFloat(entry.fb);
    const dur = parseFloat(entry.duration_sec);
    let n = 0;
    allValid.forEach(c => {
      if (c.date === entry.date) return;
      if (_evaluateSessionMatchGates(entry, c, gates, fb, dur, wpr, mechShare)) n++;
    });
    counts.set(entry.date, n);
  });
  return counts;
}


function findAllSessionMatches(targetEntry, history) {
  const gates = getSessionMatchSettings();
  const allValid = history.filter(w => w.fb && parseFloat(w.fb) > 0 && w.duration_sec != null);
  if (allValid.length < 2) return { matches: [], reason: 'insufficient_history' };

  const targetFb = parseFloat(targetEntry.fb);
  const targetDur = parseFloat(targetEntry.duration_sec);
  const targetTime = new Date(targetEntry.date).getTime();
  const targetWpr = getSessionWorkPerRep(targetEntry);
  if (targetWpr == null) return { matches: [], reason: 'target_missing_profile' };
  const targetMechShare = getSessionMechShare(targetEntry);
  if (targetMechShare == null) return { matches: [], reason: 'target_missing_profile' };

  const candidates = allValid.filter(w => w.date !== targetEntry.date && new Date(w.date).getTime() < targetTime);
  if (!candidates.length) return { matches: [], reason: 'insufficient_history' };

  const passing = [];
  candidates.forEach(c => {
    const result = _evaluateSessionMatchGates(targetEntry, c, gates, targetFb, targetDur, targetWpr, targetMechShare);
    if (result) passing.push(result);
  });

  passing.sort((a, b) => b.selectionScore - a.selectionScore);
  return { matches: passing, reason: passing.length ? null : 'no_comparable_session' };
}

// Directional ratio for display (candidate/target*100). Returns null when
// target is 0 — the ratio is undefined there, so that axis is excluded from
// the chart rather than plotted as a misleading number (same handling
// validated for PP triplet's near-zero-denominator axes).
function _matchDisplayRatio(t, c) {
  if (t === 0) return null;
  return c / t * 100;
}

const SESSION_MATCH_COLORS = ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#e34948', '#008300'];
let _sessionMatchCharts = {};

function _destroySessionMatchCharts() {
  Object.values(_sessionMatchCharts).forEach(c => c && c.destroy());
  _sessionMatchCharts = {};
}

function _buildMatchChart(canvasId, labels, targetVals, candidateSeries, maxVal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const plottableIdx = labels.map((_, i) => targetVals[i] !== null);
  const plotLabels = labels.filter((_, i) => plottableIdx[i]);
  const plotTarget = targetVals.filter((_, i) => plottableIdx[i]);
  const useBar = plotLabels.length <= 2;

  const targetDs = { label: 'Target', data: plotTarget, borderColor: '#2a78d6', backgroundColor: useBar ? '#2a78d6' : 'rgba(42,120,214,0.06)', borderWidth: 2, borderDash: useBar ? [] : [4,3], pointRadius: 0, borderRadius: useBar ? 3 : 0 };
  const candDs = candidateSeries.map(s => {
    const vals = s.vals.filter((_, i) => plottableIdx[i]).map(v => v === null ? 0 : v);
    return useBar
      ? { label: s.name, data: s.on ? vals : vals.map(() => 0), backgroundColor: s.color, borderRadius: 3 }
      : { label: s.name, data: s.on ? vals : vals.map(() => null), borderColor: s.color, backgroundColor: s.color + '20', borderWidth: 2, pointRadius: 3, hidden: !s.on };
  });

  return new Chart(canvas, {
    type: useBar ? 'bar' : 'radar',
    data: { labels: plotLabels, datasets: [targetDs, ...candDs] },
    options: useBar ? {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { title: { display: true, text: '% of target' }, grid: { color: 'rgba(137,135,129,0.15)' } } },
      plugins: { legend: { display: false } }
    } : {
      responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
      scales: { r: { min: 0, max: maxVal, ticks: { display: false }, angleLines: { color: 'rgba(137,135,129,0.25)' }, grid: { color: 'rgba(137,135,129,0.25)' }, pointLabels: { font: { size: 11 } } } },
      plugins: { legend: { display: false } }
    }
  });
}

// Builds the collapsible threshold-settings panel shown above Session
// Match's results — shown in both the "no matches" and normal display
// paths, since loosening a threshold is exactly what someone would want
// to do when no match was found. Changing any value immediately re-runs
// the match (cheap to recompute) rather than requiring a separate
// "apply" step.
function _buildMatchSettingsHtml(targetEntry) {
  const s = getSessionMatchSettings();
  const entryId = targetEntry._matchSettingsId || (targetEntry._matchSettingsId = 'ms' + Math.random().toString(36).slice(2));
  window._matchSettingsTargets = window._matchSettingsTargets || {};
  window._matchSettingsTargets[entryId] = targetEntry;
  // Preserves open/closed state across re-renders — without this, every
  // threshold adjustment rebuilds the whole section from scratch and the
  // panel would re-collapse each time, forcing a re-expand to adjust a
  // second value.
  const isOpen = !!window._matchSettingsOpen;
  // Ranges chosen for reasonable drum length: FB gap rarely needs to
  // exceed ~30 points in practice; the two similarity settings are
  // naturally 1-100%.
  const fbGapValues = Array.from({length: 30}, (_, i) => i + 1);
  const pctValues = Array.from({length: 100}, (_, i) => i + 1);
  return `
    <div class="accordion-section" style="margin-bottom:10px;">
      <div class="accordion-header match-settings-toggle" data-entry-id="${entryId}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--label);">
        <span>⚙️ ${t('match.settings.title')}</span>
        <span class="match-settings-chevron" style="transition:transform .15s;${isOpen ? 'transform:rotate(180deg);' : ''}">▾</span>
      </div>
      <div class="match-settings-body" data-entry-id="${entryId}" style="display:${isOpen ? '' : 'none'};padding:6px 10px 10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.fb')}</label>
            ${makePicker('match-setting-input', s.fbMaxGap, fbGapValues, 'FB gap (points)', `data-key="fbMaxGap" data-entry-id="${entryId}"`)}
          </div>
          <div>
            <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.duration')}</label>
            ${makePicker('match-setting-input', s.durationMin, pctValues, 'session length similarity %', `data-key="durationMin" data-entry-id="${entryId}"`)}
          </div>
          <div>
            <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.workperrep')}</label>
            ${makePicker('match-setting-input', s.workPerRepMin, pctValues, 'work per rep similarity %', `data-key="workPerRepMin" data-entry-id="${entryId}"`)}
          </div>
          <div>
            <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.mechshare')}</label>
            ${makePicker('match-setting-input', s.mechShareMin, pctValues, 'mechanical share similarity %', `data-key="mechShareMin" data-entry-id="${entryId}"`)}
          </div>
        </div>
        </div>
        <div style="font-size:.65rem;color:var(--label);margin-top:6px;line-height:1.5;">${t('match.settings.desc')}</div>
      </div>
    </div>`;
}

// Global Threshold Controls for the Session Coverage Workbench — adapted
// from _buildMatchSettingsHtml above (same 4 gates, same picker UI,
// same getSessionMatchSettings/saveSessionMatchSettings storage), but
// always-visible rather than collapsible (this IS the Workbench's
// primary control, not a secondary settings panel), and not tied to
// any specific target session — adjusting a threshold here refreshes
// the whole Coverage Cloud's node styling globally.
function _buildWorkbenchControlsHtml() {
  const s = getSessionMatchSettings();
  const fbGapValues = Array.from({length: 30}, (_, i) => i + 1);
  const pctValues = Array.from({length: 100}, (_, i) => i + 1);
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div>
        <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.fb')}</label>
        ${makePicker('workbench-setting-input', s.fbMaxGap, fbGapValues, 'FB gap (points)', `data-key="fbMaxGap"`)}
      </div>
      <div>
        <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.duration')}</label>
        ${makePicker('workbench-setting-input', s.durationMin, pctValues, 'session length similarity %', `data-key="durationMin"`)}
      </div>
      <div>
        <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.workperrep')}</label>
        ${makePicker('workbench-setting-input', s.workPerRepMin, pctValues, 'work per rep similarity %', `data-key="workPerRepMin"`)}
      </div>
      <div>
        <label style="font-size:.68rem;color:var(--label);display:block;margin-bottom:3px;">${t('match.settings.mechshare')}</label>
        ${makePicker('workbench-setting-input', s.mechShareMin, pctValues, 'mechanical share similarity %', `data-key="mechShareMin"`)}
      </div>
    </div>
    <div style="font-size:.65rem;color:var(--label);margin-top:6px;line-height:1.5;">${t('match.settings.desc')}</div>`;
}

// Wires the Workbench's threshold pickers — same openPickerWithCallback
// pattern as _wireMatchSettings, but saves settings and re-renders the
// Coverage Cloud (global) instead of one session's match section.
function _wireWorkbenchControls() {
  const container = document.getElementById('workbench-controls');
  if (!container) return;
  container.querySelectorAll('.picker-trigger').forEach(trigger => {
    const inp = trigger.querySelector('.workbench-setting-input');
    if (!inp) return;
    trigger.onclick = () => {
      const key = inp.dataset.key;
      openPickerWithCallback(trigger, (val) => {
        inp.value = val;
        const displayEl = trigger.querySelector('.picker-trigger-val');
        if (displayEl) displayEl.textContent = formatPickerVal(val, trigger.dataset.label);
        saveSessionMatchSettings({ [key]: val });
        // Always refresh the chart's base grey-vs-highlighted tier,
        // even with nothing selected yet — a threshold change affects
        // which sessions have ANY match, independent of whether a
        // specific target/point is currently pinned.
        _refreshWorkbenchMatchState(getHistory());
        chartInstances.fbduration_fs?.update();
        // Then refresh whatever's currently showing match-count-dependent
        // detail: the insight card (if a point is selected) and the
        // Workbench's own target (if one is pinned) — both depend on
        // gate thresholds too.
        if (window._fbdSelectedPoint) _updateFbDurationInsightCard(window._fbdSelectedPoint);
        if (window._workbenchTarget) _selectWorkbenchTarget(window._workbenchTarget);
      });
    };
  });
}

// Wires the 4 independent FB/Duration min/max pickers that replaced the
// old preset-bucket dropdowns — each just triggers _fbDurationFsUpdate()
// on change, exactly like the dropdowns' onchange did, just per-bound
// instead of per-preset-pair.
function _wireFbDurationRangePickers() {
  const wrap = document.getElementById('chart-fs-canvas-wrap');
  if (!wrap) return;
  ['fbd-fs-fbmin', 'fbd-fs-fbmax', 'fbd-fs-durmin', 'fbd-fs-durmax'].forEach(cls => {
    const inp = wrap.querySelector('.' + cls);
    if (!inp) return;
    const trigger = inp.closest('.picker-trigger');
    if (!trigger) return;
    trigger.onclick = () => {
      openPickerWithCallback(trigger, (val) => {
        inp.value = val;
        const displayEl = trigger.querySelector('.picker-trigger-val');
        if (displayEl) displayEl.textContent = formatPickerVal(val, trigger.dataset.label);
        _fbDurationFsUpdate();
      });
    };
  });
}

function _selectWorkbenchTarget(entry) {
  window._workbenchTarget = entry;
  _refreshWorkbenchMatchState(getHistory());
  // Lightweight update, not a full renderFbDurationChart rebuild — a
  // rebuild would reset window._fbdSelectedPoint (see
  // renderFbDurationChart's own comment on why), which would silently
  // undo the very selection this highlighting is meant to show.
  const fsChart = chartInstances.fbduration_fs;
  if (fsChart) fsChart.update();
  renderErawTimelineChart(entry);
  renderWorkbenchMatchTable(entry);
}

// E_raw Progression Timeline — X=Date, Y=E_raw, per spec. Uses the
// bi-directional matcher (past AND future sessions relative to the
// target) so the line traces efficiency progression in both
// directions, not just how the athlete got to this session. Recomputes
// eRaw fresh via getEngineScoreERaw for every matched session rather
// than reading the newly-added entry.eRaw field directly — that field
// is only populated going forward from tonight, so recomputing is what
// makes the timeline work across the athlete's full existing history,
// not just sessions saved after this feature shipped.
function renderErawTimelineChart(targetEntry) {
  const canvas = document.getElementById('chart-eraw-timeline');
  const section = document.getElementById('workbench-timeline-section');
  const targetEl = document.getElementById('workbench-timeline-target');
  if (!canvas || !section) return;
  if (chartInstances.erawTimeline) { try { chartInstances.erawTimeline.destroy(); } catch(e) {} }

  const hist = getHistory();
  const { matches } = findAllSessionMatchesBidirectional(targetEntry, hist);

  if (!matches.length) {
    section.style.display = 'none';
    return;
  }

  const targetResult = getEngineScoreERaw(targetEntry);
  if (!targetResult) {
    section.style.display = '';
    if (targetEl) targetEl.textContent = t('workbench.timeline.no.target.eraw') || 'E_raw not computable for this session';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Build one point per matched session (+ the target itself), each with
  // its own recomputed eRaw — sessions where eRaw genuinely isn't
  // computable (missing cardio data, etc.) are dropped rather than
  // plotted as a fabricated zero.
  const rows = matches.map(m => {
    const r = getEngineScoreERaw(m.session);
    if (!r) return null;
    return { date: (m.session.date || '').slice(0, 10), eRaw: r.eRaw, label: m.session.label || 'Session', isTarget: false, direction: m.direction };
  }).filter(Boolean);
  rows.push({ date: (targetEntry.date || '').slice(0, 10), eRaw: targetResult.eRaw, label: targetEntry.label || 'Session', isTarget: true, direction: 'target' });
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));

  section.style.display = '';
  if (targetEl) targetEl.textContent = `${t('workbench.timeline.vs') || 'vs'} ${targetEntry.label || 'Target'} (${rows.length - 1} ${rows.length - 1 === 1 ? t('workbench.timeline.match') || 'match' : t('workbench.timeline.matches') || 'matches'})`;

  const isDark = document.body.classList.contains('dark');
  const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  const lc = isDark ? '#9CA3AF' : '#6B7280';

  chartInstances.erawTimeline = new Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map(r => r.date),
      datasets: [{
        data: rows.map(r => r.eRaw),
        borderColor: '#FF6B35',
        backgroundColor: rows.map(r => r.isTarget ? '#FFFFFF' : '#FF6B35'),
        pointBorderColor: rows.map(r => r.isTarget ? '#FF6B35' : '#FF6B35'),
        pointBorderWidth: rows.map(r => r.isTarget ? 3 : 1),
        pointRadius: rows.map(r => r.isTarget ? 8 : 4),
        pointStyle: rows.map(r => r.isTarget ? 'star' : 'circle'),
        tension: 0.15,
        fill: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { color: gc }, ticks: { color: lc, font: { size: 9 } } },
        y: { title: { display: true, text: 'E_raw', color: lc, font: { size: 10 } }, grid: { color: gc }, ticks: { color: lc } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const r = rows[ctx.dataIndex];
          return `${r.label}${r.isTarget ? ' (Target)' : ` (${r.direction})`}: E_raw=${r.eRaw.toFixed(3)}`;
        } } }
      }
    }
  });
}

// Comparable Sessions Table — pinned target row + every matched session
// (past and future), per spec's exact column set. Delta vs Target is
// E_raw-based (% difference from the target's own E_raw), since that's
// the metric this whole comparison exists to trace.
function renderWorkbenchMatchTable(targetEntry) {
  const container = document.getElementById('workbench-match-table');
  if (!container) return;

  const hist = getHistory();
  const { matches } = findAllSessionMatchesBidirectional(targetEntry, hist);
  const targetResult = getEngineScoreERaw(targetEntry);
  const targetEraw = targetResult ? targetResult.eRaw : null;

  const fmtMinSec = (sec) => {
    const s = Math.round(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const buildRow = (entry, isTarget, direction) => {
    const wpr = getSessionWorkPerRep(entry);
    const mechShare = getSessionMechShare(entry);
    const r = getEngineScoreERaw(entry);
    const eRaw = r ? r.eRaw : null;
    const delta = (!isTarget && eRaw != null && targetEraw) ? ((eRaw - targetEraw) / targetEraw * 100) : null;
    return `<tr style="${isTarget ? 'background:var(--glass-inner);font-weight:700;' : ''}">
      <td style="padding:6px 8px;white-space:nowrap;">${isTarget ? '🎯 ' : ''}${entry.label || 'Session'}</td>
      <td style="padding:6px 8px;white-space:nowrap;">${(entry.date || '').slice(0, 10)}</td>
      <td style="padding:6px 8px;text-align:right;">${entry.fb != null ? Math.round(parseFloat(entry.fb)) : '—'}</td>
      <td style="padding:6px 8px;text-align:right;">${fmtMinSec(entry.duration_sec)}</td>
      <td style="padding:6px 8px;text-align:right;">${wpr != null ? wpr.toFixed(2) : '—'}</td>
      <td style="padding:6px 8px;text-align:right;">${mechShare != null ? Math.round(mechShare) + '%' : '—'}</td>
      <td style="padding:6px 8px;text-align:right;">${eRaw != null ? eRaw.toFixed(3) : '—'}</td>
      <td style="padding:6px 8px;text-align:right;${delta != null ? (delta >= 0 ? 'color:#22C55E;' : 'color:#EF4444;') : ''}">${isTarget ? '—' : (delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—')}</td>
    </tr>`;
  };

  // All rows — target included — sorted together by date, rather than
  // always pinning the target first regardless of where its date
  // actually falls chronologically among the matches.
  const allRows = [
    { entry: targetEntry, isTarget: true, direction: 'target' },
    ...matches.map(m => ({ entry: m.session, isTarget: false, direction: m.direction }))
  ].sort((a, b) => new Date(a.entry.date) - new Date(b.entry.date));
  const rowsHtml = allRows.map(r => buildRow(r.entry, r.isTarget, r.direction)).join('');

  container.innerHTML = `
    <div style="font-size:.68rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${t('workbench.table.title') || 'Comparable Sessions'}</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:.72rem;color:var(--text);">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--label);font-size:.65rem;text-transform:uppercase;letter-spacing:.04em;">
            <th style="padding:6px 8px;text-align:left;">${t('workbench.table.session') || 'Session'}</th>
            <th style="padding:6px 8px;text-align:left;">${t('workbench.table.date') || 'Date'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.fb') || 'FB'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.duration') || 'Duration'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.workrep') || 'Work/Rep'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.mechshare') || 'Mech Share'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.eraw') || 'E_raw'}</th>
            <th style="padding:6px 8px;text-align:right;">${t('workbench.table.delta') || 'Δ vs Target'}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}


// Wires up the settings panel's toggle and pickers — called once after the
// panel HTML is inserted into the DOM.
function _wireMatchSettings(section) {
  section.querySelectorAll('.match-settings-toggle').forEach(header => {
    header.onclick = () => {
      const entryId = header.dataset.entryId;
      const body = section.querySelector(`.match-settings-body[data-entry-id="${entryId}"]`);
      const chevron = header.querySelector('.match-settings-chevron');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      window._matchSettingsOpen = !isOpen;
    };
  });
  // makePicker() bakes in onclick="openPicker(this)" by default — this
  // JS-set .onclick overrides that HTML attribute (same property, later
  // assignment wins), routing to openPickerWithCallback() instead. That's
  // needed because the standard picker flow just sets the hidden input's
  // .value directly with no change/input event fired, which wouldn't
  // trigger anything downstream — a callback lets this save + re-render
  // immediately without depending on an event that never fires.
  section.querySelectorAll('.picker-trigger').forEach(trigger => {
    const inp = trigger.querySelector('.match-setting-input');
    if (!inp) return;
    trigger.onclick = () => {
      if (trigger.dataset.disabled === '1') return;
      openPickerWithCallback(trigger, (val) => {
        inp.value = val;
        trigger.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, trigger.dataset.label);
        const entryId = inp.dataset.entryId;
        const key = inp.dataset.key;
        saveSessionMatchSettings({ [key]: val });
        const targetEntry = window._matchSettingsTargets?.[entryId];
        if (targetEntry) renderSessionMatchSection(targetEntry);
      });
    };
  });
}

function renderSessionMatchSection(targetEntry) {
  const section = document.getElementById('session-match-section');
  if (!section) return;
  _destroySessionMatchCharts();

  const { matches, reason } = findAllSessionMatches(targetEntry, getHistory());

  if (!matches.length) {
    section.style.display = '';
    section.innerHTML = `
      ${_buildMatchSettingsHtml(targetEntry)}
      <div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);border-radius:var(--radius);padding:16px;text-align:center;">
        <div style="font-size:.82rem;font-weight:800;color:var(--text);margin-bottom:6px;">${t('match.none.title')}</div>
        <div style="font-size:.75rem;color:var(--label);line-height:1.6;">${t('match.none.desc')}</div>
      </div>`;
    _wireMatchSettings(section);
    return;
  }

  section.style.display = '';
  const PERF_LABELS_ARR = ['Average Power'];

  const targetWpr = getSessionWorkPerRep(targetEntry) || 0;
  const targetMechShare = getSessionMechShare(targetEntry) || 0;
  const tPower = getSessionPower(targetEntry) || { mech: 0, aero: 0, overhead: 0, total: 0 };

  const sessions = matches.map((m, i) => {
    const c = m.session;
    const cWpr = getSessionWorkPerRep(c) || 0;
    const cMechShare = getSessionMechShare(c) || 0;
    const cPower = getSessionPower(c) || { mech: 0, aero: 0, overhead: 0, total: 0 };
    return {
      name: c.label || 'Session', color: SESSION_MATCH_COLORS[i % SESSION_MATCH_COLORS.length], on: true,
      selection: m.selectionScore, workPerRepPct: m.wprSim, mechSharePct: m.mechShareSim,
      // Raw gate values for the Comparable Sessions table — shows what's
      // actually being compared (FB, Duration, work/rep, mech share)
      // alongside the Target row, rather than only a combined percentage.
      fb: parseFloat(c.fb) || 0,
      durationSec: parseFloat(c.duration_sec) || 0,
      workPerRep: cWpr,
      workPerRepRaw: [cWpr],
      mechShare: cMechShare,
      // Average Power is now a single axis (mech only) — Aerobic was
      // removed as a sibling "Power" metric entirely, not just
      // deduplicated with Total. mech is genuine Force x Distance / Time
      // physics power; aero is a metabolic-cost RATE (kcal/time converted
      // to W/kg units) — a fundamentally different kind of quantity that
      // only ever shared units with mech by coincidence of the conversion,
      // never by measuring the same thing. It's still a real, useful
      // number — just never framed as "Power" anywhere in the app now.
      perfVals: [_matchDisplayRatio(tPower.mech,cPower.mech)],
      perfPct: axisMatchScore(tPower.mech,cPower.mech),
      mechPowerDelta: tPower.mech > 0 ? ((cPower.mech - tPower.mech) / tPower.mech * 100) : null,
      powerRaw: [cPower.mech, cPower.aero, cPower.overhead],
      overheadPower: cPower.overhead,
      rl: c.rl != null ? parseFloat(c.rl) : null, mc: c.mc, td: c.td,
      bwWorkPct: c.bw_work_pct != null ? parseFloat(c.bw_work_pct) : null,
      // VO2max-retest signal: internal diagnostic, not a "Power" display —
      // built on the genuine mathematical relationship in
      // overheadKcal = totalMetEstimate - mc_mech - mc_aero (see the
      // overhead calculation this mirrors): given a fixed RPE/VO2max/
      // time-derived total, Overhead's share is forced to shrink by
      // exactly the amount mc_mech+mc_aero grows. That relationship only
      // holds for the actual terms in that equation — mc_mech and
      // mc_aero, both raw kcal totals for the whole session — not for
      // tPower.mech, which is wd-derived and doesn't appear in the
      // overhead equation at all. Using tPower.mech here (an earlier
      // version of this code) broke the very relationship the signal
      // depends on, mixing a pure-physics rate with a metabolic-cost
      // total under one label.
      vo2maxRetestSignal: (() => {
        const tRpe = parseFloat(targetEntry.rpe);
        const cRpe = parseFloat(c.rpe);
        if (!tRpe || !cRpe || tRpe > cRpe) return false; // target must be same-or-lower RPE than the candidate
        const tMechAero = (parseFloat(targetEntry.mc_mech) || 0) + (parseFloat(targetEntry.mc_aero) || 0);
        const cMechAero = (parseFloat(c.mc_mech) || 0) + (parseFloat(c.mc_aero) || 0);
        if (!cMechAero) return false;
        return (tMechAero - cMechAero) / cMechAero >= 0.25;
      })()
    };
  });

  const targetPerfVals = [tPower.mech].map(v => v > 0 ? 100 : null);

  const _fmtMinSec = (sec) => {
    const s = Math.round(sec || 0);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  };

  const comparableTable = () => {
    const targetRow = `<tr style="border-bottom:1px solid var(--glass-border);">
      <td style="padding:5px 4px;"></td>
      <td style="padding:5px 4px;font-weight:800;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:#2a78d6;display:inline-block;margin-right:5px;"></span>${t('match.target')}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetEntry.fb != null ? Math.round(parseFloat(targetEntry.fb)) : '—'}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${_fmtMinSec(targetEntry.duration_sec)}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetWpr.toFixed(2)}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetMechShare.toFixed(0)}%</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">—</td></tr>`;
    const rows = sessions.map((s, i) => `<tr style="border-bottom:1px solid var(--glass-border);opacity:${s.on?1:0.35};">
      <td style="padding:5px 4px;">
        <label style="display:flex;align-items:center;cursor:pointer;">
          <input type="checkbox" checked data-idx="${i}" class="match-toggle" style="position:absolute;opacity:0;width:0;height:0;">
          <span class="match-toggle-box" style="width:16px;height:16px;border-radius:4px;border:1.5px solid ${s.color};background:${s.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><polyline points="4,13 9,18 20,6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </label>
      </td>
      <td style="padding:5px 4px;color:var(--text);">${s.name}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--label);">${Math.round(s.fb)}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--label);">${_fmtMinSec(s.durationSec)}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.workPerRep.toFixed(2)}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.mechShare.toFixed(0)}%</td>
      <td style="text-align:right;padding:5px 4px;color:var(--label);font-weight:700;">${s.selection.toFixed(0)}%</td></tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:.7rem;"><thead><tr style="border-bottom:1px solid var(--glass-border);">
      <th></th>
      <th style="text-align:left;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.session')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.fb')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.duration')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.workperrep')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.mechshare')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.matchpct')}</th>
      </tr></thead><tbody>${targetRow}${rows}</tbody></table>`;
  };

  const perfLegendHtml = () => sessions.map(s => {
    const d = s.mechPowerDelta;
    const deltaLabel = d == null ? '—' : `${d>=0?'+':''}${d.toFixed(0)}% ${t('match.mech.power')}`;
    const deltaColor = d == null ? 'var(--text)' : (d>=0 ? '#e34948' : '#3266ad');
    return `
    <div style="display:flex;align-items:center;gap:6px;font-size:.72rem;color:var(--label);margin-bottom:3px;">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;flex-shrink:0;"></span>
      <span style="flex:1;">${s.name}</span>
      <span style="font-weight:700;color:${deltaColor};">${deltaLabel}</span>
    </div>`;
  }).join('');

  const detailTable = (headers, rawKey, targetRaw) => {
    let rows = `<tr style="border-bottom:1px solid var(--glass-border);"><td style="padding:5px 4px;font-weight:800;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:#2a78d6;display:inline-block;margin-right:5px;"></span>${t('match.target')}</td>
      ${targetRaw.map(v => `<td style="text-align:right;padding:5px 4px;color:var(--text);">${v.toFixed(1)}%</td>`).join('')}</tr>`;
    sessions.forEach(s => {
      rows += `<tr style="border-bottom:1px solid var(--glass-border);opacity:${s.on?1:0.35};">
        <td style="padding:5px 4px;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block;margin-right:5px;"></span>${s.name}</td>
        ${s[rawKey].map(v => `<td style="text-align:right;padding:5px 4px;color:var(--label);">${v.toFixed(1)}%</td>`).join('')}</tr>`;
    });
    return `<table style="width:100%;border-collapse:collapse;font-size:.7rem;"><thead><tr style="border-bottom:1px solid var(--glass-border);">
      <th style="text-align:left;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.session')}</th>
      ${headers.map(h => `<th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${h}</th>`).join('')}
      </tr></thead><tbody>${rows}</tbody></table>`;
  };

  const powerTable = () => {
    const targetPowerRow = [tPower.mech];
    let rows = `<tr style="border-bottom:1px solid var(--glass-border);"><td style="padding:5px 4px;font-weight:800;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:#2a78d6;display:inline-block;margin-right:5px;"></span>${t('match.target')}</td>
      ${targetPowerRow.map(v=>`<td style="text-align:right;padding:5px 4px;color:var(--text);">${v.toFixed(2)} W/kg</td>`).join('')}</tr>`;
    sessions.forEach(s => {
      const rowVals = [s.powerRaw[0]]; // mech only — aero/overhead (indices 1,2) intentionally excluded, no longer framed as Power
      rows += `<tr style="border-bottom:1px solid var(--glass-border);opacity:${s.on?1:0.35};">
        <td style="padding:5px 4px;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block;margin-right:5px;"></span>${s.name}</td>
        ${rowVals.map((v,i) => {
          const tv = targetPowerRow[i];
          const delta = tv > 0 ? ((v-tv)/tv*100) : null;
          const deltaStr = delta != null ? `<br><span style="font-size:.62rem;color:${delta>=0?'#e34948':'#3266ad'};">${delta>=0?'+':''}${delta.toFixed(0)}%</span>` : '';
          return `<td style="text-align:right;padding:5px 4px;color:var(--label);">${v.toFixed(2)} W/kg${deltaStr}</td>`;
        }).join('')}</tr>`;
    });
    return `<table style="width:100%;border-collapse:collapse;font-size:.7rem;"><thead><tr style="border-bottom:1px solid var(--glass-border);">
      <th style="text-align:left;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.session')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.mech')}</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  };

  const vo2SuggestCard = () => {
    if (!sessions.some(s => s.on && s.vo2maxRetestSignal)) return '';
    return `<div style="${cardStyle}border-color:#eda100;">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:1rem;line-height:1;">💡</span>
        <div>
          <div style="font-size:.72rem;font-weight:800;color:#eda100;margin-bottom:3px;">${t('match.vo2suggest.title')}</div>
          <div style="font-size:.7rem;color:var(--label);line-height:1.4;">${t('match.vo2suggest.body')}</div>
        </div>
      </div>
    </div>`;
  };

  const contextTable = () => {
    let rows = `<tr style="border-bottom:1px solid var(--glass-border);"><td style="padding:5px 4px;font-weight:800;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:#2a78d6;display:inline-block;margin-right:5px;"></span>${t('match.target')}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetEntry.rl != null ? parseFloat(targetEntry.rl)+'%' : '—'}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetEntry.mc||'—'}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetEntry.td != null ? parseFloat(targetEntry.td).toFixed(1) : '—'}</td>
      <td style="text-align:right;padding:5px 4px;color:var(--text);">${targetEntry.bw_work_pct != null ? parseFloat(targetEntry.bw_work_pct)+'%' : '—'}</td></tr>`;
    sessions.forEach(s => {
      rows += `<tr style="border-bottom:1px solid var(--glass-border);opacity:${s.on?1:0.35};">
        <td style="padding:5px 4px;color:var(--text);"><span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block;margin-right:5px;"></span>${s.name}</td>
        <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.rl != null ? s.rl+'%' : '—'}</td>
        <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.mc||'—'}</td>
        <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.td != null ? parseFloat(s.td).toFixed(1) : '—'}</td>
        <td style="text-align:right;padding:5px 4px;color:var(--label);">${s.bwWorkPct != null ? s.bwWorkPct+'%' : '—'}</td></tr>`;
    });
    return `<table style="width:100%;border-collapse:collapse;font-size:.7rem;"><thead><tr style="border-bottom:1px solid var(--glass-border);">
      <th style="text-align:left;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.session')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.rl')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.mc')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.td')}</th>
      <th style="text-align:right;padding:5px 4px;color:var(--label);font-weight:400;">${t('match.bwworkpct')}</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  };

  const cardStyle = 'background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:var(--radius);padding:14px;margin-bottom:12px;';
  section.innerHTML = `
    ${_buildMatchSettingsHtml(targetEntry)}
    <div style="${cardStyle}">
      <div style="font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--label);margin-bottom:10px;">${t('match.comparable')}</div>
      <div id="match-toggles">${comparableTable()}</div>
    </div>
    <div style="${cardStyle}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:.72rem;font-weight:800;color:var(--text);">${t('match.performance')}</span>
        <button class="match-flip-btn" data-card="perf" style="font-size:.68rem;background:transparent;border:1px solid var(--glass-border);border-radius:6px;padding:3px 8px;color:var(--label);cursor:pointer;">${t('match.detail')}</button>
      </div>
      <div id="perfFront"><div style="position:relative;width:100%;height:280px;"><canvas id="matchRadarPerf"></canvas></div><div id="perfLegend" style="margin-top:8px;">${perfLegendHtml()}</div></div>
      <div id="perfBack" style="display:none;">${powerTable()}</div>
    </div>
    <div id="vo2SuggestWrap">${vo2SuggestCard()}</div>
    <div style="${cardStyle}">
      <div style="font-size:.72rem;font-weight:800;color:var(--text);margin-bottom:10px;">${t('match.context')}</div>
      <div id="contextTableWrap">${contextTable()}</div>
    </div>`;

  function draw() {
    _destroySessionMatchCharts();
    _sessionMatchCharts.perf = _buildMatchChart('matchRadarPerf', PERF_LABELS_ARR, targetPerfVals, sessions.map(s => ({ name: s.name, color: s.color, on: s.on, vals: s.perfVals })), 230);
  }
  draw();
  _wireMatchSettings(section);

  section.querySelectorAll('.match-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      sessions[+e.target.dataset.idx].on = e.target.checked;
      const box = e.target.nextElementSibling;
      if (box) box.style.opacity = e.target.checked ? '1' : '0.25';
      const row = e.target.closest('tr');
      if (row) row.style.opacity = e.target.checked ? '1' : '0.35';
      draw();
      section.querySelector('#perfLegend').innerHTML = perfLegendHtml();
      section.querySelector('#perfBack').innerHTML = powerTable();
      section.querySelector('#vo2SuggestWrap').innerHTML = vo2SuggestCard();
      section.querySelector('#contextTableWrap').innerHTML = contextTable();
    });
  });
  section.querySelectorAll('.match-flip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.dataset.card;
      const front = section.querySelector('#' + card + 'Front');
      const back = section.querySelector('#' + card + 'Back');
      const showingFront = front.style.display !== 'none';
      front.style.display = showingFront ? 'none' : '';
      back.style.display = showingFront ? '' : 'none';
      btn.textContent = showingFront ? t('match.back') : t('match.detail');
    });
  });
}

// Heat-scale color for CV Intensity (MET) — blue (low) -> yellow ->
// red (high), using colors already established elsewhere in this app's
// palette. Fixed range (3-12 MET) rather than dynamically rescaled per
// filtered view, so a given color always means the same absolute
// intensity regardless of which sessions happen to be in view — a
// dynamic per-view scale would make the same session look "high
// intensity" in one filtered view and "low intensity" in another,
// which would defeat the point of a color legend at all.
// HSL-to-RGB conversion, needed since canvas/CSS colors are RGB but
// interpolating hue directly (not R/G/B channels separately) is what
// avoids the muddy-midpoint problem below.
function _hslToRgb(h, s, l) {
  h = h / 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, tt) => {
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1/6) return p + (q - p) * 6 * tt;
      if (tt < 1/2) return q;
      if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

// Interpolating R/G/B channels independently between blue and yellow
// (nearly opposite hues) produces a washed-out, low-saturation
// gray-green at the midpoint — verified: MET 5 previously rendered as
// RGB(137,152,140), visually reading as pale/white rather than any
// clear color. Since real session METs cluster in exactly that 5-7
// range, MOST dots were landing in this muddy zone, not just a few —
// this was the actual cause of "most dots look white."
// Interpolating HUE directly instead (the short path from blue through
// green to yellow, then yellow to red) keeps saturation and lightness
// constant throughout, so there's no RGB-mixing step that can produce
// gray — verified numerically before implementing: MET 5 now renders
// as a clear, vibrant teal/green, not a washed-out blend.
function _fbDurationMetColor(met) {
  if (met == null) return '#6B7280'; // no computable CV Intensity for this session — neutral gray, not a fabricated color
  const clamped = Math.max(3, Math.min(12, met));
  const frac = (clamped - 3) / 9;
  let h;
  if (frac < 0.5) {
    h = 210 - (frac / 0.5) * (210 - 50);
  } else {
    h = 50 - ((frac - 0.5) / 0.5) * 50;
  }
  const [r, g, b] = _hslToRgb(h, 0.85, 0.55);
  // Hex output, not rgb(...) — the calling code appends a hex-alpha
  // suffix (+'ee', +'cc', etc, same convention used throughout this
  // codebase) which is only valid on hex strings. Appending it to an
  // rgb(...) function string (e.g. "rgb(97,238,43)ee") produces
  // invalid CSS that browsers silently reject, falling back to a
  // default color — this was the actual, entire cause of dots
  // appearing white/pale with only their border rendering correctly.
  // This bug predates the HSL fix; the original RGB-interpolation
  // version had the identical flaw, never caught because only the
  // color MATH was verified, not the final string sent to canvas.
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Fixed grid boundaries for the gap-coverage overlay — deliberately the
// SAME bins as the existing Force Bias / Duration filter dropdowns
// above the chart, not invented separately, so a highlighted empty
// cell corresponds exactly to a real, selectable filter range rather
// than an arbitrary boundary the user has no way to act on.
const FBD_DUR_BINS = [[0,10],[10,15],[15,20],[20,999]];
const FBD_FB_BINS = [[0,50],[50,100],[100,150],[150,999]];

// Hand-defined reference zones — NOT derived from any real periodization
// or program-block system, since nothing like that exists anywhere in
// this app. These are reasonable, commonly-cited training-zone ranges
// or, honest naming reflects that they're a manually-selected reference
// overlay, not an automatic "your current program block" feature.
const FBD_TARGET_ZONES = {
  maximal_power:     { durMin: 1,  durMax: 8,  fbMin: 120, fbMax: 999, label: 'Maximal Power / Neural Demand' },
  heavy_metcon:      { durMin: 8,  durMax: 15, fbMin: 100, fbMax: 160, label: 'Heavy Metcon / Loaded Capacity' },
  strength_endurance:{ durMin: 15, durMax: 30, fbMin: 50,  fbMax: 100, label: 'Strength Endurance' },
  // fbMin lowered from 20 to 0 — a genuinely zero-loaded-work session
  // (pure cardio, no barbell at all) is the most prototypical example
  // of these two categories, not an edge case outside them. Confirmed
  // against real data: both of this athlete's actual FB=0 sessions
  // (a 35min run, a 20.8min bodyweight metcon) fall within
  // aerobic_base's duration window and were being silently excluded
  // from it purely because the lower FB bound was set too high.
  aerobic_base:      { durMin: 20, durMax: 999, fbMin: 0, fbMax: 50,  label: 'Monostructural Aerobic Base' },
  anaerobic_sprint:  { durMin: 2,  durMax: 8,  fbMin: 0,  fbMax: 50,  label: 'Anaerobic Sprint / Speed Capacity' }
};

// Whether a point falls inside a given zone's Duration/Force-Bias
// bounds. durMax/fbMax of 999 means "or higher" (matches how the zone
// definitions themselves encode an open-ended upper bound).
function _fbdPointInZone(p, zone) {
  if (!zone) return true;
  const durOk = p.x >= zone.durMin && (zone.durMax >= 999 || p.x < zone.durMax);
  const fbOk = p.y >= zone.fbMin && (zone.fbMax >= 999 || p.y < zone.fbMax);
  return durOk && fbOk;
}

// Applies an opacity multiplier to a #rrggbb hex color, returning
// #rrggbbaa. Used to dim out-of-zone points to 20% rather than hiding
// them outright — still visible as context, just visually secondary.
function _fbdHexWithOpacity(hex, opacity) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return hex + alpha.toString(16).padStart(2, '0');
}

// Refreshes the Workbench's match-status cache used by the FB/Duration
// chart's color callbacks. Deliberately window-level rather than a
// local variable inside renderFbDurationChart: selecting a target only
// triggers a lightweight chart.update() (see _selectWorkbenchTarget),
// not a full rebuild — a full rebuild would wipe window._fbdSelectedPoint,
// undoing the very selection the update is meant to reflect. Callable
// independently from target selection and threshold changes alike, so
// the color callbacks always read current state regardless of which
// one of those triggered the refresh.
function _refreshWorkbenchMatchState(hist) {
  const validForMatching = hist.filter(w => w.fb != null && !isNaN(parseFloat(w.fb)) && w.duration_sec != null && w.date);
  window._fbdMatchCounts = getSessionMatchCountMap(validForMatching);
  window._fbdTargetMatchDates = null;
  if (window._workbenchTarget) {
    const { matches } = findAllSessionMatchesBidirectional(window._workbenchTarget, validForMatching);
    window._fbdTargetMatchDates = new Set(matches.map(m => m.session.date));
  }
}

function renderFbDurationChart(canvasId, filters) {
  canvasId = canvasId || 'chart-fbduration';
  filters = filters || {};
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const instKey = canvasId === 'chart-fbduration' ? 'fbduration' : 'fbduration_fs';
  const isFullscreen = canvasId !== 'chart-fbduration';
  if (chartInstances[instKey]) { try { chartInstances[instKey].destroy(); } catch(e) {} }

  // Any rebuild here creates brand-new point objects (fresh .map() call
  // below), so a selection made against the PREVIOUS points array can
  // never match anything in the new one — true whether the rebuild was
  // triggered by the window/FB/duration filters, the gaps toggle, or a
  // target zone change. Clearing both here, once, at the single place
  // all of those paths funnel through, means every trigger is covered
  // uniformly rather than needing the same fix repeated in each handler.
  if (isFullscreen) {
    window._fbdSelectedPoint = null;
    const card = document.getElementById('fbd-insight-card');
    if (card) card.style.display = 'none';
  }

  const hist = getHistory();
  const cutoff = (!filters.window || filters.window === 'all') ? null : new Date(Date.now() - parseInt(filters.window) * 24 * 60 * 60 * 1000);
  const fbRange = filters.fbRange; // [min, max] or null
  const durRange = filters.durRange; // [min, max] or null

  const points = hist
    // FB=0 is legitimate, real data (confirmed on the scatter chart
    // earlier tonight: only 2 sessions in this history have it, genuine
    // "no loaded work" sessions) — not excluded the way missing data
    // is. `w.fb &&` alone would ALSO reject 0 (falsy in JS), so this
    // checks `!= null` (rejects only undefined/null) plus an explicit
    // NaN check (rejects empty-string/garbage values that != null
    // would let through but parseFloat can't use), rather than relying
    // on fb's own truthiness.
    .filter(w => w.fb != null && !isNaN(parseFloat(w.fb)) && w.duration_sec)
    .filter(w => !cutoff || new Date(w.date) >= cutoff)
    .map(w => {
      const cv = getSessionCVEndurance(w);
      return {
        x: +(parseFloat(w.duration_sec) / 60).toFixed(1),
        y: parseFloat(w.fb),
        label: w.label || 'Session',
        date: (w.date || '').slice(0, 10),
        met: cv ? cv.met : null,
        entry: w // direct reference — findAllSessionMatches needs the real entry, not a re-lookup by date/label that could be ambiguous
      };
    })
    .filter(p => !fbRange || (p.y >= fbRange[0] && p.y < fbRange[1]))
    .filter(p => !durRange || (p.x >= durRange[0] && p.x < durRange[1]));

  // Workbench match-status — see _refreshWorkbenchMatchState for why
  // this is window-cached rather than a local variable computed here:
  // selecting a target only needs a lightweight chart .update() (a full
  // rebuild would wipe the selection that update is meant to show), so
  // the color callbacks below must read live, independently-refreshable
  // state rather than a value frozen at the last full render.
  if (isFullscreen) _refreshWorkbenchMatchState(hist);

  const isDark = document.body.classList.contains('dark');
  const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  const lc = isDark ? '#9CA3AF' : '#6B7280';

  if (!points.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Gap-coverage overlay — only in fullscreen, matching the established
  // convention of keeping the compact card simple and putting richer
  // analysis in the expanded view. Counts points per fixed grid cell;
  // any cell with zero points gets a subtle highlight.
  const gapGridPlugin = {
    id: 'fbdGapGrid',
    beforeDraw(chart) {
      if (!isFullscreen || !window._fbdShowGaps) return;
      const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
      if (!x || !y) return;
      ctx.save();
      FBD_DUR_BINS.forEach(([dMin, dMax]) => {
        FBD_FB_BINS.forEach(([fMin, fMax]) => {
          const count = points.filter(p => p.x >= dMin && p.x < dMax && p.y >= fMin && p.y < fMax).length;
          if (count > 0) return;
          const px1 = Math.max(left, x.getPixelForValue(dMin));
          const px2 = dMax >= 999 ? right : Math.min(right, x.getPixelForValue(dMax));
          const py1 = Math.max(top, y.getPixelForValue(fMax >= 999 ? y.max : fMax));
          const py2 = Math.min(bottom, y.getPixelForValue(fMin));
          if (px2 <= px1 || py2 <= py1) return;
          ctx.fillStyle = 'rgba(239,68,68,0.06)';
          ctx.fillRect(px1, py1, px2 - px1, py2 - py1);
          ctx.strokeStyle = 'rgba(239,68,68,0.15)';
          ctx.setLineDash([3,3]);
          ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);
          ctx.setLineDash([]);
        });
      });
      ctx.restore();
    }
  };

  // Target zone overlay — only in fullscreen. See FBD_TARGET_ZONES'
  // own comment for why these are hand-defined reference ranges, not
  // an automatic program-block feature.
  const targetZonePlugin = {
    id: 'fbdTargetZone',
    beforeDraw(chart) {
      if (!isFullscreen || !window._fbdActiveZone) return;
      const zone = FBD_TARGET_ZONES[window._fbdActiveZone];
      if (!zone) return;
      const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
      if (!x || !y) return;
      const px1 = Math.max(left, x.getPixelForValue(zone.durMin));
      const px2 = zone.durMax >= 999 ? right : Math.min(right, x.getPixelForValue(zone.durMax));
      const py1 = Math.max(top, y.getPixelForValue(zone.fbMax >= 999 ? y.max : zone.fbMax));
      const py2 = Math.min(bottom, y.getPixelForValue(zone.fbMin));
      if (px2 <= px1 || py2 <= py1) return;
      ctx.save();
      ctx.fillStyle = 'rgba(96,165,250,0.10)';
      ctx.fillRect(px1, py1, px2 - px1, py2 - py1);
      ctx.strokeStyle = 'rgba(96,165,250,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5,3]);
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);
      ctx.setLineDash([]);
      ctx.font = '700 10px sans-serif';
      ctx.fillStyle = 'rgba(96,165,250,0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(zone.label, px1 + 4, py1 + 12);
      ctx.restore();
    }
  };

  // Glow drawn BEHIND the selected point (beforeDatasetsDraw, not
  // after) so it sits underneath Chart.js's own normal point rendering
  // rather than duplicating a second circle on top of it. Selection is
  // tracked by direct object reference (window._fbdSelectedPoint === p),
  // same principle as the entry reference used for Session Match —
  // matching by date/label string would risk two different sessions
  // sharing values and both lighting up.
  const selectedGlowPlugin = {
    id: 'fbdSelectedGlow',
    beforeDatasetsDraw(chart) {
      if (!window._fbdSelectedPoint) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;
      const idx = points.indexOf(window._fbdSelectedPoint);
      if (idx < 0 || !meta.data[idx]) return;
      const el = meta.data[idx];
      const ctx = chart.ctx;
      // Crisp ring at a fixed radius, no blur — a blurred shadow has no
      // hard edge, so in a dense cluster its diffuse glow can visually
      // wash over neighboring dots that aren't actually selected. A
      // stroked ring has a precise boundary and can't bleed onto
      // anything outside it, regardless of how tightly other points are
      // clustered nearby.
      ctx.save();
      ctx.beginPath();
      ctx.arc(el.x, el.y, 13, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,107,53,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  };

  const cfg = {
    type: 'scatter',
    data: { datasets: [{
      label: 'sessions',
      data: points,
      // Bumped from 'cc' (80%) to 'ee' (~93%) opacity, and base radius
      // from 5 to 6 — makes the MET gradient's color differences more
      // immediately scannable without needing to hover each point.
      // Selected point (set on tap, see onClick below) renders in
      // brand orange at a larger radius, same visual language as the
      // scatter and totalwork charts' current-session highlights
      // earlier tonight, not a new, different treatment invented here.
      backgroundColor: ctx => {
        const p = ctx.raw;
        // White, not orange — orange sits inside the MET gradient's own
        // high end (verified: ~75% intensity produces RGB(237,124,38),
        // nearly identical to the orange used here originally), so a
        // genuinely high-MET UNselected point could look selected too.
        // White appears nowhere in the blue-yellow-red spectrum, so
        // there's no value of MET that can collide with it.
        if (p && window._fbdSelectedPoint === p) return '#FFFFFF';
        // Workbench match-status — sessions with zero matches at the
        // current gate thresholds render muted grey regardless of MET,
        // per explicit direction. Sessions with matches keep their MET
        // hue; which ones are the current target's OWN matches is now
        // signaled by the ring (borderColor/borderWidth below), not by
        // fill opacity alone — opacity differences were too subtle to
        // read at a glance, especially with several points clustered
        // close together, which was the original complaint.
        if (window._fbdMatchCounts && p) {
          const n = window._fbdMatchCounts.get(p.entry?.date) || 0;
          if (n === 0) {
            const zone = window._fbdActiveZone ? FBD_TARGET_ZONES[window._fbdActiveZone] : null;
            const opacity = (zone && !_fbdPointInZone(p, zone)) ? 0.15 : 0.35;
            const greyBase = document.body.classList.contains('dark') ? '156,163,175' : '107,114,128';
            return `rgba(${greyBase},${opacity})`;
          }
        }
        const baseHex = p ? _fbDurationMetColor(p.met) : _fbDurationMetColor(null);
        // Zone dimming — selection always wins (a point you explicitly
        // tapped stays fully visible regardless of zone state); outside
        // an active zone's bounds, opacity drops to 20% rather than
        // hiding the point outright, so it's still visible as context.
        const zone = window._fbdActiveZone ? FBD_TARGET_ZONES[window._fbdActiveZone] : null;
        let opacity = (zone && p && !_fbdPointInZone(p, zone)) ? 0.2 : 0.93;
        // Sessions that have matches, just not with the currently-
        // selected target, still get reduced fill opacity — they don't
        // get the orange ring below (that's reserved for the target's
        // own matches), so this remains the only visual difference for
        // this specific tier.
        if (window._fbdTargetMatchDates && p && !window._fbdTargetMatchDates.has(p.entry?.date) && p.entry?.date !== window._workbenchTarget?.date) {
          opacity = Math.min(opacity, 0.4);
        }
        return _fbdHexWithOpacity(baseHex, opacity);
      },
      borderColor: ctx => {
        const p = ctx.raw;
        // Orange ring — shared by the target itself AND its own
        // matches, so the fill (white for the target, MET-color for
        // matches) is what actually distinguishes them from each
        // other; the ring itself just means "part of this comparison."
        if (p && window._fbdSelectedPoint === p) return '#FF6B35';
        if (window._fbdTargetMatchDates && p && window._fbdTargetMatchDates.has(p.entry?.date)) return '#FF6B35';
        if (window._fbdMatchCounts && p) {
          const n = window._fbdMatchCounts.get(p.entry?.date) || 0;
          if (n === 0) {
            const zone = window._fbdActiveZone ? FBD_TARGET_ZONES[window._fbdActiveZone] : null;
            const opacity = (zone && !_fbdPointInZone(p, zone)) ? 0.15 : 0.35;
            const greyBase = document.body.classList.contains('dark') ? '156,163,175' : '107,114,128';
            return `rgba(${greyBase},${opacity})`;
          }
        }
        const baseHex = p ? _fbDurationMetColor(p.met) : _fbDurationMetColor(null);
        const zone = window._fbdActiveZone ? FBD_TARGET_ZONES[window._fbdActiveZone] : null;
        let opacity = (zone && p && !_fbdPointInZone(p, zone)) ? 0.2 : 1;
        if (window._fbdTargetMatchDates && p && !window._fbdTargetMatchDates.has(p.entry?.date) && p.entry?.date !== window._workbenchTarget?.date) {
          opacity = Math.min(opacity, 0.4);
        }
        return _fbdHexWithOpacity(baseHex, opacity);
      },
      borderWidth: ctx => {
        const p = ctx.raw;
        if (p && window._fbdSelectedPoint === p) return 3;
        if (window._fbdTargetMatchDates && p && window._fbdTargetMatchDates.has(p.entry?.date)) return 3;
        return 1;
      },
      pointRadius: ctx => (ctx.raw && window._fbdSelectedPoint === ctx.raw) ? 9 : 6,
      pointHoverRadius: ctx => (ctx.raw && window._fbdSelectedPoint === ctx.raw) ? 10 : 8
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: t('chart.fbduration.x'), color: lc, font: { size: 10 } }, grid: { color: gc }, ticks: { color: lc }, min: durRange ? durRange[0] : undefined, max: (durRange && durRange[1] < 999) ? durRange[1] : undefined },
        y: { title: { display: true, text: t('chart.fbduration.y'), color: lc, font: { size: 10 } }, grid: { color: gc }, ticks: { color: lc }, min: fbRange ? fbRange[0] : undefined, max: (fbRange && fbRange[1] < 999) ? fbRange[1] : undefined }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw.label} (${ctx.raw.date}): FB=${ctx.raw.y}, ${ctx.raw.x}min${ctx.raw.met != null ? `, ${ctx.raw.met.toFixed(1)} MET` : ''}` } }
      },
      onClick: isFullscreen ? (evt, elements) => {
        if (!elements.length) return;
        const point = points[elements[0].index];
        window._fbdSelectedPoint = point;
        _updateFbDurationInsightCard(point);
        chartInstances[instKey]?.update();
      } : undefined
    },
    plugins: [gapGridPlugin, targetZonePlugin, selectedGlowPlugin]
  };

  chartInstances[instKey] = new Chart(canvas, cfg);
  if (isFullscreen) window._fbdCurrentPoints = points; // reused by the zone-compliance card update, not re-filtered separately
}

function openFbDurationFullscreen() {
  const fs = document.getElementById('chart-fullscreen');
  document.getElementById('chart-fs-title').textContent = t('chart.fbduration');
  fs.classList.add('open');
  // Same shared hide-all used by openChartFullscreen() — this function
  // has its own separate rendering path and never had access to that
  // logic before, which is exactly why the Movement Pattern legend
  // table was leaking through into this chart's view.
  _hideAllChartSpecificUI();
  window._fbdShowGaps = false;
  window._fbdActiveZone = null;
  window._fbdSelectedPoint = null;
  window._workbenchTarget = null;

  const wrap = document.getElementById('chart-fs-canvas-wrap');
  wrap.style.display = '';
  wrap.style.height = 'auto';
  wrap.style.flexDirection = '';
  wrap.style.alignItems = '';
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 20px 0;">
      <select id="fbd-fs-window" onchange="_fbDurationFsUpdate()" style="flex:1;min-width:100px;font-size:.72rem;background:var(--surface2);color:var(--label);border:1px solid var(--glass-border);border-radius:8px;padding:6px 8px;">
        <option value="7">${t('chart.window.week')}</option>
        <option value="30">${t('chart.window.month')}</option>
        <option value="182">${t('chart.window.6month')}</option>
        <option value="365">${t('chart.window.year')}</option>
        <option value="all" selected>${t('chart.window.all')}</option>
      </select>
      <div style="flex:1;min-width:100px;">${makePicker('fbd-fs-fbmin', 0, Array.from({length: 41}, (_, i) => i*5), 'FB min')}</div>
      <div style="flex:1;min-width:100px;">${makePicker('fbd-fs-fbmax', 999, [...Array.from({length: 41}, (_, i) => i*5), 999], 'FB max')}</div>
      <div style="flex:1;min-width:100px;">${makePicker('fbd-fs-durmin', 0, Array.from({length: 61}, (_, i) => i), 'Duration min')}</div>
      <div style="flex:1;min-width:100px;">${makePicker('fbd-fs-durmax', 999, [...Array.from({length: 61}, (_, i) => i), 999], 'Duration max')}</div>
    </div>
    <div style="position:relative;height:340px;padding:12px 20px 0;"><canvas id="chart-fbduration-fs"></canvas></div>
    <div style="display:flex;align-items:center;gap:8px;padding:10px 20px 0;">
      <span style="font-size:.65rem;color:var(--label);">${t('chart.fbduration.met.low') || 'Low MET'}</span>
      <div style="flex:1;height:8px;border-radius:4px;background:linear-gradient(to right, rgb(43,140,238), rgb(43,238,162), rgb(97,238,43), rgb(238,205,43), rgb(238,151,43), rgb(238,97,43), rgb(238,43,43));"></div>
      <span style="font-size:.65rem;color:var(--label);">${t('chart.fbduration.met.high') || 'High MET'}</span>
    </div>
    <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:10px 20px 0;">
      <button id="fbd-fs-gaps-toggle" onclick="_fbDurationToggleGaps()" style="flex:1;min-width:120px;height:34px;margin:0;box-sizing:border-box;padding:0 8px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text);font-size:.72rem;font-weight:700;">${t('chart.fbduration.showgaps') || 'Show Gaps'}</button>
      <select id="fbd-fs-zone" onchange="_fbDurationZoneChange()" style="flex:1;min-width:140px;height:34px;min-height:34px;margin:0;box-sizing:border-box;font-size:.72rem;font-weight:700;background:var(--surface2) url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236B7280%22 stroke-width=%222%22><polyline points=%226,9 12,15 18,9%22/></svg>') no-repeat right 8px center;background-size:14px;-webkit-appearance:none;appearance:none;color:var(--label);border:1px solid var(--glass-border);border-radius:8px;padding:0 28px 0 8px;">
        <option value="">${t('chart.fbduration.zone.none') || 'No Target Zone'}</option>
        <option value="maximal_power">${t('chart.fbduration.zone.mp') || 'Maximal Power'}</option>
        <option value="heavy_metcon">${t('chart.fbduration.zone.hm') || 'Heavy Metcon'}</option>
        <option value="strength_endurance">${t('chart.fbduration.zone.se') || 'Strength Endurance'}</option>
        <option value="aerobic_base">${t('chart.fbduration.zone.ab') || 'Aerobic Base'}</option>
        <option value="anaerobic_sprint">${t('chart.fbduration.zone.as') || 'Anaerobic Sprint'}</option>
      </select>
    </div>
    <div id="fbd-insight-card" style="display:none;margin:10px 20px 0;padding:12px 14px;background:var(--card-bg);border:1px solid var(--glass-border);border-radius:10px;">
      <div id="fbd-insight-title" style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:8px;">—</div>
      <div id="fbd-insight-metrics" style="font-size:.7rem;color:var(--label);margin-bottom:8px;"></div>
      <div id="fbd-insight-match" style="font-size:.7rem;color:var(--label);padding-top:8px;border-top:1px solid var(--glass-border);"></div>
    </div>
    <div style="margin:16px 20px 0;padding-top:14px;border-top:1px solid var(--glass-border);">
      <div style="font-size:.68rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${t('workbench.controls.title') || 'Gate Thresholds (FB Gap | Duration % | Work/Rep % | Mech %)'}</div>
      <div id="workbench-controls"></div>
      <div id="workbench-timeline-section" style="display:none;margin-top:16px;">
        <div style="font-size:.68rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">${t('workbench.timeline.title') || 'Efficiency Progression (E_raw)'}</div>
        <div style="font-size:.72rem;color:var(--label);margin-bottom:6px;line-height:1.5;">${t('workbench.timeline.subtitle') || 'Matched Twins Timeline'}</div>
        <div id="workbench-timeline-target" style="font-size:.65rem;color:var(--label);margin-bottom:6px;"></div>
        <div style="position:relative;height:220px;"><canvas id="chart-eraw-timeline"></canvas></div>
        <div id="workbench-match-table" style="margin-top:12px;"></div>
      </div>
    </div>`;

  const expEl = document.getElementById('chart-fs-explanation');
  if (expEl) {
    expEl.style.padding = '16px 20px 32px';
    // Collapsed by default — the MET gradient legend, gap/zone toggles,
    // and persistent card now carry most of what this text explains,
    // so the full write-up stays available on demand rather than
    // consuming fixed scroll space on every open.
    expEl.innerHTML = `<details><summary style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;cursor:pointer;">${t('chart.how.to.read')}</summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
        <div style="background:var(--glass-inner);border-left:3px solid var(--brand);border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:3px;">${t('chart.fbduration.explain.axes.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.axes')}</div>
        </div>
        <div style="background:var(--glass-inner);border-left:3px solid #9CA3AF;border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:#9CA3AF;margin-bottom:3px;">${t('chart.fbduration.explain.gaps.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.gaps')}</div>
        </div>
        <div style="background:var(--glass-inner);border-left:3px solid #3B82F6;border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">${t('chart.fbduration.explain.zones.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.zones')}</div>
        </div>
        <div style="background:var(--glass-inner);border-left:3px solid #22C55E;border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">${t('chart.fbduration.explain.gates.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.gates')}</div>
        </div>
        <div style="background:var(--glass-inner);border-left:3px solid #FF6B35;border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:3px;">${t('chart.fbduration.explain.highlight.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.highlight')}</div>
        </div>
        <div style="background:var(--glass-inner);border-left:3px solid #F59E0B;border-radius:8px;padding:10px 12px;">
          <div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">${t('chart.fbduration.explain.progression.title')}</div>
          <div style="font-size:.76rem;color:var(--label);line-height:1.55;">${t('chart.fbduration.explain.progression')}</div>
        </div>
      </div>
    </details>`;
  }

  _fbDurationFsUpdate();
  _wireFbDurationRangePickers();

  // Session Coverage Workbench controls — the timeline/table stay
  // empty/hidden until a point is tapped (see _updateFbDurationInsightCard,
  // which drives _selectWorkbenchTarget).
  const workbenchControlsEl = document.getElementById('workbench-controls');
  if (workbenchControlsEl) {
    workbenchControlsEl.innerHTML = _buildWorkbenchControlsHtml();
    _wireWorkbenchControls();
  }
}

function openPowerScatterFullscreen() {
  const fs = document.getElementById('chart-fullscreen');
  document.getElementById('chart-fs-title').textContent = `${t('chart.powerscatter.x')} / ${t('chart.powerscatter.y')}`;
  fs.classList.add('open');
  _hideAllChartSpecificUI();
  window._psSelectedPoint = null;

  const wrap = document.getElementById('chart-fs-canvas-wrap');
  wrap.style.display = '';
  wrap.style.height = 'auto';
  wrap.style.flexDirection = '';
  wrap.style.alignItems = '';
  wrap.innerHTML = `
    <div style="position:relative;height:340px;padding:12px 20px 0;"><canvas id="chart-power-scatter-fs"></canvas></div>
    <div id="ps-insight-card" style="display:none;margin:10px 20px 0;padding:12px 14px;background:var(--card-bg);border:1px solid var(--glass-border);border-radius:10px;">
      <div id="ps-insight-title" style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:8px;">—</div>
      <div id="ps-insight-metrics" style="font-size:.7rem;color:var(--label);margin-bottom:8px;"></div>
      <div id="ps-insight-delta" style="font-size:.7rem;color:var(--label);"></div>
      <div id="ps-insight-classification" style="display:none;font-size:.7rem;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid var(--glass-border);"></div>
    </div>`;

  const expEl = document.getElementById('chart-fs-explanation');
  if (expEl) {
    expEl.style.padding = '16px 20px 32px';
    expEl.innerHTML = `<details><summary style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;cursor:pointer;">${t('chart.how.to.read')}</summary>
      <p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-top:12px;">${t('chart.powerscatter.explain') || ''}</p></details>`;
  }

  renderPowerScatterChart('chart-power-scatter-fs');
}

function _fbDurationFsUpdate() {
  const windowVal = document.getElementById('fbd-fs-window')?.value || 'all';
  const fbMin = parseFloat(document.querySelector('.fbd-fs-fbmin')?.value) || 0;
  const fbMax = parseFloat(document.querySelector('.fbd-fs-fbmax')?.value);
  const durMin = parseFloat(document.querySelector('.fbd-fs-durmin')?.value) || 0;
  const durMax = parseFloat(document.querySelector('.fbd-fs-durmax')?.value);
  // A max of 0/no-selection or the 999 sentinel both mean "no upper
  // bound" — only treat the range as filtered when the athlete has
  // actually narrowed at least one bound away from its full default.
  const fbRange = (fbMin > 0 || (fbMax && fbMax < 999)) ? [fbMin, (fbMax && fbMax < 999) ? fbMax : 999] : null;
  const durRange = (durMin > 0 || (durMax && durMax < 999)) ? [durMin, (durMax && durMax < 999) ? durMax : 999] : null;
  renderFbDurationChart('chart-fbduration-fs', { window: windowVal, fbRange, durRange });
}

function _fbDurationToggleGaps() {
  window._fbdShowGaps = !window._fbdShowGaps;
  const btn = document.getElementById('fbd-fs-gaps-toggle');
  if (btn) {
    btn.style.background = window._fbdShowGaps ? 'var(--brand)' : 'var(--card-bg)';
    btn.style.color = window._fbdShowGaps ? '#fff' : 'var(--text)';
  }
  // Mutually exclusive with Target Zone — both overlays active at once
  // created real visual noise (overlapping red/blue boxes). Turning
  // gaps on clears any active zone, in both state and the dropdown
  // itself, so the control never shows a zone that isn't actually
  // rendering.
  if (window._fbdShowGaps) {
    window._fbdActiveZone = null;
    const zoneSel = document.getElementById('fbd-fs-zone');
    if (zoneSel) zoneSel.value = '';
  }
  _fbDurationFsUpdate();
}

function _fbDurationZoneChange() {
  const sel = document.getElementById('fbd-fs-zone');
  window._fbdActiveZone = sel?.value || null;
  // Mutually exclusive with Show Gaps — selecting a real zone turns
  // gaps off, in both state and the toggle button's own styling.
  if (window._fbdActiveZone) {
    window._fbdShowGaps = false;
    const btn = document.getElementById('fbd-fs-gaps-toggle');
    if (btn) { btn.style.background = 'var(--card-bg)'; btn.style.color = 'var(--text)'; }
  }
  _fbDurationFsUpdate();
  // Called after the rebuild (not before) — renderFbDurationChart()
  // clears the card as part of every rebuild, so populating it before
  // that call would just have it immediately wiped.
  _updateFbDurationZoneCard();
}

// Zone compliance card — session count and % of overall (currently
// filtered) training volume that falls inside the active zone's
// bounds, plus a gap warning when zero sessions qualify. Reuses
// window._fbdCurrentPoints (the exact same filtered set the chart
// itself is rendering) rather than re-deriving the filter separately.
function _updateFbDurationZoneCard() {
  const card = document.getElementById('fbd-insight-card');
  if (!card) return;
  const zoneKey = window._fbdActiveZone;
  if (!zoneKey) return; // no zone active — leave whatever the tap-driven card state already is alone
  const zone = FBD_TARGET_ZONES[zoneKey];
  if (!zone) return;
  const allPoints = window._fbdCurrentPoints || [];
  const inZonePoints = allPoints.filter(p => _fbdPointInZone(p, zone));
  const total = allPoints.length;
  const pct = total > 0 ? Math.round((inZonePoints.length / total) * 100) : 0;

  card.style.display = '';
  const durLabel = zone.durMax >= 999 ? `${zone.durMin}+ min` : `${zone.durMin}–${zone.durMax} min`;
  const fbLabel = zone.fbMax >= 999 ? `${zone.fbMin}+ FB` : `${zone.fbMin}–${zone.fbMax} FB`;
  document.getElementById('fbd-insight-title').textContent = `${zone.label} — ${durLabel} @ ${fbLabel}`;

  const metricsEl = document.getElementById('fbd-insight-metrics');
  const matchEl = document.getElementById('fbd-insight-match');
  if (inZonePoints.length === 0) {
    metricsEl.innerHTML = `<strong style="color:var(--text);">0</strong> ${t('chart.fbduration.zone.sessions') || 'sessions'} | 0% ${t('chart.fbduration.zone.coverage') || 'coverage'}`;
    matchEl.textContent = `${zone.label} ${t('chart.fbduration.zone.gap') || 'Gap'} — ${t('chart.fbduration.zone.gap.msg') || 'Zero sessions logged in this domain.'}`;
  } else {
    metricsEl.innerHTML = `<strong style="color:var(--text);">${inZonePoints.length}</strong> ${t('chart.fbduration.zone.sessions') || 'sessions'} | <strong style="color:var(--text);">${pct}%</strong> ${t('chart.fbduration.zone.coverage') || 'coverage'}`;
    matchEl.textContent = '';
  }
}


// Shared by both the persistent card's efficiency delta and the dot
// color-coding below — one calculation, not the same logic written
// twice in two places that could drift apart. Finds the frontier's own
// value at a given Power level: the highest-Power frontier point still
// <= pointX, matching the stepped-before semantics the chart itself
// draws (frontier holds each point's Load until Power reaches the
// next one).
function _psFindFrontierAtPower(pointX, frontierPoints) {
  let frontierAtPower = null;
  for (const fp of frontierPoints || []) {
    if (fp.x <= pointX) frontierAtPower = fp; else break; // frontierPoints sorted ascending by x
  }
  return frontierAtPower;
}

// Returns 0-100+ (a point ON the frontier is exactly 100 by
// definition, forced explicitly rather than relying on the y/y
// division landing on precisely 100 due to floating point), or null
// when there's no frontier value at this Power level to compare
// against at all (Power below every frontier point).
function _psFrontierPct(point, frontierPoints) {
  if ((frontierPoints || []).includes(point)) return 100; // reference equality — frontierPoints shares object references with the full point set
  const frontierAtPower = _psFindFrontierAtPower(point.x, frontierPoints);
  if (!frontierAtPower || frontierAtPower.y <= 0) return null;
  return Math.round((point.y / frontierAtPower.y) * 100);
}

// Persistent inspector card for the Mechanical Power / Internal Load
// chart. Efficiency delta compares the tapped session's Load against
// the frontier's OWN value at that same Power level — found by walking
// the frontier (sorted ascending by Power) for the highest-Power point
// still <= the tapped session's Power, matching the stepped-before
// semantics the chart itself draws (the frontier holds each point's
// Load until Power reaches the next one). If the tapped session's
// Power is below every frontier point, there's no meaningful frontier
// value to compare against yet, so no delta is shown rather than a
// fabricated one.
function _updatePowerScatterInsightCard(point, allPoints, frontierPoints) {
  const card = document.getElementById('ps-insight-card');
  if (!card || !point) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';

  document.getElementById('ps-insight-title').textContent = `${point.label} — ${point.date}`;
  document.getElementById('ps-insight-metrics').innerHTML =
    `<strong style="color:var(--text);">${point.x}</strong> W/kg | <strong style="color:var(--text);">${point.y}</strong> MET-min${point.allReal ? '' : ' (est.)'}`;

  const deltaEl = document.getElementById('ps-insight-delta');
  const pct = _psFrontierPct(point, frontierPoints);
  if (pct != null) {
    deltaEl.textContent = `${pct}% ${t('chart.powerscatter.ofFrontier') || 'of Historical Frontier Output'}`;
  } else {
    deltaEl.textContent = '';
  }

  const classEl = document.getElementById('ps-insight-classification');
  const isFrontier = (frontierPoints || []).includes(point);
  if (isFrontier) {
    classEl.style.display = '';
    classEl.textContent = t('chart.powerscatter.frontierpr') || 'Peak Aerobic Power PR — on the Engine Frontier';
    classEl.style.color = '#F5C518';
  } else {
    classEl.style.display = 'none';
  }
}

// Persistent inspector card — reuses findAllSessionMatches(), the same
// real "Session Match" pipeline already used elsewhere in the app,
// rather than building a separate matching system for this card alone.
function _updateFbDurationInsightCard(point) {
  const card = document.getElementById('fbd-insight-card');
  if (!card || !point) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('fbd-insight-title').textContent = `${point.label} — ${point.date}`;
  document.getElementById('fbd-insight-metrics').innerHTML =
    `Force Bias: <strong style="color:var(--text);">${Math.round(point.y)}</strong> | ` +
    `${Math.round(point.x)} min ${t('chart.fbduration.duration') || 'Duration'}` +
    (point.met != null ? ` | <strong style="color:var(--text);">${point.met.toFixed(1)} MET</strong>` : '');

  const matchEl = document.getElementById('fbd-insight-match');
  if (typeof findAllSessionMatchesBidirectional === 'function' && point.entry) {
    try {
      const { matches } = findAllSessionMatchesBidirectional(point.entry, getHistory());
      const n = matches ? matches.length : 0;
      matchEl.textContent = n > 0
        ? `${n} ${n === 1 ? (t('chart.fbduration.match.one') || 'comparable session found') : (t('chart.fbduration.match.many') || 'comparable sessions found')}`
        : (t('match.none.title') || 'No comparable sessions found');
      // Drives the Workbench's E_raw Timeline + Comparable Sessions
      // Table below — always selects, even with zero matches, so the
      // chart's ring state correctly clears rather than staying stuck
      // on whichever session was previously selected. The zero-matches
      // case is handled downstream (renderErawTimelineChart hides its
      // own section when there's nothing to show).
      _selectWorkbenchTarget(point.entry);
    } catch (e) {
      matchEl.textContent = '';
    }
  } else {
    matchEl.textContent = '';
  }
}
