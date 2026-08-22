/* ════════════════════════════════════════════════════
   PROFILE SCREEN — live stats
════════════════════════════════════════════════════ */
function calcVO2maxHR() {
  const hrmax  = parseInt(document.getElementById('global-hrmax')?.value)  || 0;
  const hrrest = parseInt(document.getElementById('global-hrrest')?.value) || 0;
  if (!hrmax || !hrrest) { showToast(t('aerobic.hr.missing'), 'error'); return; }
  if (hrrest >= hrmax)   { showToast(t('aerobic.hr.invalid'), 'error'); return; }
  const vo2 = Math.round(15 * (hrmax / hrrest));
  if (vo2 < 10 || vo2 > 90) { showToast(t('toast.out.of.range'), 'error'); return; }
  setVO2maxValue(vo2, 'Heart Rate (Uth-Sørensen)');
}

function calcVO2maxCooper() {
  const dist = parseFloat(document.getElementById('global-cooper')?.value) || 0;
  if (!dist || dist < 100) { showToast(t('aerobic.cooper.label') + '?', 'error'); return; }
  const vo2 = Math.round((dist - 504.9) / 44.73);
  if (vo2 < 10 || vo2 > 90) { showToast(t('toast.out.of.range'), 'error'); return; }
  setVO2maxValue(vo2, 'Cooper Test');
}

function calcVO2maxRow() {
  const totalSec = parseFloat(document.getElementById('pr-row2k')?.value) || 0;
  if (!totalSec) { showToast(t('aerobic.row.no.pr'), 'error'); return; }
  // Average 500m split
  const splitSec = totalSec / 4;
  // Concept2 watts: W = 2.8 / (split_sec/500)^3
  const watts = 2.8 / Math.pow(splitSec / 500, 3);
  const weight = parseFloat(document.getElementById('global-w')?.value) || 75;
  // Hagerman et al formula: VO2max (ml/kg/min) = (0.01141*W + 0.435) / weight * 1000
  const vo2 = Math.round((0.01141 * watts + 0.435) / weight * 1000);
  if (vo2 < 10 || vo2 > 90) { showToast(t('toast.out.of.range'), 'error'); return; }
  setVO2maxValue(vo2, '2km Row');
}

let _vo2method = localStorage.getItem('wod-vo2method') || '';

function setVO2maxValue(vo2, method) {
  _vo2method = method;
  localStorage.setItem('wod-vo2method', method); // persist method across reloads
  const el   = document.getElementById('global-vo2max');
  const disp = document.getElementById('prof-vo2max-val');
  const est  = document.getElementById('vo2max-estimated');
  if (el)   el.value = vo2;
  if (disp) disp.textContent = vo2 + ' ml/kg/min';
  if (est) {
    est.textContent = `✅ ${t('aerobic.calc.result')} ${vo2} ml/kg/min (${t('aerobic.calc.method')} ${method})`;
    est.style.color = 'var(--success)';
  }
  saveProfile(); autoSave();
  showToast(`✅ VO₂max: ${vo2} ml/kg/min (${method})`);
}

function updateVO2maxEstimate() {
  const vo2 = parseInt(document.getElementById('global-vo2max')?.value)||0;
  const hrmax = parseInt(document.getElementById('global-hrmax')?.value)||0;
  const hrrest = parseInt(document.getElementById('global-hrrest')?.value)||0;
  const el = document.getElementById('vo2max-estimated');
  if (!el) return;
  if (vo2 > 0) {
    const methodStr = _vo2method ? ` (${t('aerobic.calc.method')} ${_vo2method})` : '';
    el.textContent = `✅ ${t('aerobic.calc.result')} ${vo2} ml/kg/min${methodStr}`;
    el.style.color = 'var(--success)';
  } else if (hrmax > 0 && hrrest > 0) {
    const estimated = Math.round(15 * (hrmax / hrrest));
    el.textContent = `✅ ${t('aerobic.calc.result')} ${estimated} ml/kg/min (${t('aerobic.calc.method')} Uth-Sørensen)`;
    el.style.color = 'var(--success)';
  } else {
    // Show population estimate as fallback nudge
    const vo2Est = getEffectiveVO2max();
    if (vo2Est?.estimated) {
      el.textContent = `~ ${vo2Est.value} ml/kg/min (${t('hl.estimated')}) — ${t('aerobic.set.for.accuracy')}`;
      el.style.color = 'var(--label)';
    } else {
      el.textContent = '';
    }
  }
}

function getEffectiveVO2max() {
  const vo2 = parseInt(document.getElementById('global-vo2max')?.value)||0;
  const hrmax = parseInt(document.getElementById('global-hrmax')?.value)||0;
  const hrrest = parseInt(document.getElementById('global-hrrest')?.value)||0;
  if (vo2 > 0) return { value: vo2, estimated: false };
  if (hrmax > 0 && hrrest > 0) return { value: Math.round(15 * (hrmax / hrrest)), estimated: false };

  // Population-based fallback from age, gender and experience level
  const age    = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const exp    = document.getElementById('global-exp')?.value || 'intermediate';

  // Population average VO2max by age and gender (ACSM reference values)
  const maleBase = age < 30 ? 48 : age < 40 ? 45 : age < 50 ? 42 : age < 60 ? 38 : 34;
  const femBase  = age < 30 ? 42 : age < 40 ? 39 : age < 50 ? 36 : age < 60 ? 33 : 29;
  const base = gender === 'female' ? femBase : maleBase;

  // Fitness level multiplier
  const mult = exp === 'beginner' ? 0.85 : exp === 'advanced' ? 1.15 : exp === 'elite' ? 1.35 : 1.0;

  return { value: Math.round(base * mult), estimated: true };
}

// RPE needs to specifically ask about cardiovascular effort, not general
// difficulty — "how did that feel?" was ambiguous enough that heavy
// strength sessions were rating near-max RPE from load/difficulty alone,
// inflating their contribution to Overhead and CTL/ATL despite not being
// cardiovascularly maximal. Anchoring against the athlete's own VO2max
// effort maps directly onto the formula itself (relIntensity = RPE/10,
// then x VO2max) — but only when a real test/HR-based VO2max exists, since
// a population-estimated VO2max has no actual remembered session to
// anchor against.
function _getRpeSubtitle() {
  const vo2Result = getEffectiveVO2max();
  return vo2Result.estimated ? t('result.rpe.sub.generic') : t('result.rpe.sub.tested');
}

function getEffectiveVO2maxValue() {
  const result = getEffectiveVO2max();
  return result ? result.value : null;
}

function _hlCard(label, value, sub, color) {
  return `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:var(--glass-shadow);padding:14px 10px;border-radius:14px;text-align:center;">
    <div style="font-size:.58rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">${label}</div>
    <div style="font-size:1.5rem;font-weight:900;line-height:1;letter-spacing:-.02em;color:${color||'var(--text)'};">${value}</div>
    <div style="font-size:.62rem;font-weight:700;margin-top:5px;color:var(--label);line-height:1.3;">${sub}</div>
  </div>`;
}

function renderProfileHighlights(idx) {
  const el = document.getElementById('profile-highlights');
  if (!el) return;

  if (idx === 0) {
    // Athlete tab — height, weight, BMI, goal
    const h = parseFloat(document.getElementById('global-h')?.value) || 0;
    const w = parseFloat(document.getElementById('global-w')?.value) || 0;
    const bmi = h > 0 ? (w / ((h/100)**2)).toFixed(1) : '—';
    const goal = document.getElementById('global-goal')?.value || '';
    const goalMap = {allround:t('goal.opt.allround').replace(/^\S+\s/,'')||'All-Round',conditioning:t('goal.opt.conditioning').replace(/^\S+\s/,'')||'Conditioning',strength:t('goal.opt.strength').replace(/^\S+\s/,'')||'Strength',weightloss:t('goal.opt.weightloss').replace(/^\S+\s/,'')||'Weight Loss',performance:t('goal.opt.competition').replace(/^\S+\s/,'')||'Performance',endurance:t('goal.opt.endurance').replace(/^\S+\s/,'')||'Endurance'};
    const exp = document.getElementById('global-exp')?.value || '';
    const expMap = {beginner:t('exp.beginner').replace(/^\S+\s/,'')||'Beginner',intermediate:t('exp.intermediate').replace(/^\S+\s/,'')||'Intermediate',advanced:t('exp.advanced').replace(/^\S+\s/,'')||'Advanced',elite:t('exp.elite').replace(/^\S+\s/,'')||'Elite'};
    const bmiCat = bmi !== '—' ? (bmi < 18.5 ? t('hl.underweight') : bmi < 25 ? t('hl.normal') : bmi < 30 ? t('hl.overweight') : t('hl.obese')) : '—';
    const vo2Result = getEffectiveVO2max();
    const vo2Ath = vo2Result?.value || null;
    const vo2Est = vo2Result?.estimated || false;
    el.innerHTML =
      _hlCard(t('hl.height'), h ? h + ' cm' : '—', t('hl.standing'), '#60A5FA') +
      _hlCard(t('hl.weight'), w ? w + ' kg' : '—', t('hl.body.mass'), '#22C55E') +
      _hlCard(t('hl.bmi'), bmi, bmiCat, '#F59E0B') +
      _hlCard(t('hl.vo2max'), vo2Ath ? (vo2Est ? '~' : '') + vo2Ath : '—', vo2Ath ? (vo2Est ? t('hl.estimated') : t('hl.ml.kg.min')) : t('hl.not.set'), '#A78BFA');

  } else if (idx === 1) {
    // Read PRs from localStorage directly (not DOM) for reliability
    const _prs = JSON.parse(localStorage.getItem('wod-prs') || '{}');

    // ── Per-category rotation ──
    // Each category cycles independently, index stored in localStorage
    function nextCatIdx(key, len) {
      if (len <= 1) return 0;
      const idx = (parseInt(localStorage.getItem(key) || '0') + 1) % len;
      localStorage.setItem(key, idx);
      return idx;
    }

    // ── Category 1: Best WOD ──
    const benchmarks = Object.keys(CLASSIC_WODS);
    const hist = getHistory();
    const benchEntries = [];
    benchmarks.forEach(name => {
      const match = hist.filter(w => w.label && w.label.toLowerCase().includes(name.toLowerCase()));
      if (match.length) {
        const w0 = match[0];
        let res = t('hist.completed') || 'Completed';
        const b0r = w0.blocks?.[0]?.result;
        if (b0r && (b0r.m > 0 || b0r.s > 0)) res = `${b0r.m||0}:${String(b0r.s||0).padStart(2,'0')}`;
        else if (b0r?.r > 0) res = `${b0r.r} ${t('hist.rounds')||'rds'}`;
        else { const tm = w0.detail?.match(/Time[:\s]+(\d+):(\d+)/i); if (tm) res = `${tm[1]}:${tm[2]}`; }
        benchEntries.push({value: name, sub: res});
      }
    });
    const benchIdx = nextCatIdx('wod_hl_bench', benchEntries.length);
    const benchCard = benchEntries.length > 0
      ? _hlCard(t('hl.best.wod'), benchEntries[benchIdx].value, benchEntries[benchIdx].sub, '#FF6B35')
      : _hlCard(t('hl.best.wod'), '—', t('hl.no.benchmarks'), '#FF6B35');

    // ── Category 2: Strength 1RM ──
    const strengthPrs = [
      {id:'pr-bsq', l:'Back Squat', color:'#A78BFA'},
      {id:'pr-dl',  l:'Deadlift',   color:'#A78BFA'},
      {id:'pr-snatch', l:'Snatch',  color:'#EF4444'},
      {id:'pr-cnj', l:'C&J',        color:'#EF4444'},
      {id:'pr-press', l:'Press',    color:'#F59E0B'},
      {id:'pr-bench', l:'Bench',    color:'#F59E0B'},
    ];
    const strengthEntries = strengthPrs.filter(p => parseInt(_prs[p.id]||0) > 0)
      .map(p => ({value: `${parseInt(_prs[p.id])} kg`, sub: p.l, color: p.color}));
    const strengthIdx = nextCatIdx('wod_hl_strength', strengthEntries.length);
    const strengthCard = strengthEntries.length > 0
      ? _hlCard(t('hl.top.1rm'), strengthEntries[strengthIdx].value, strengthEntries[strengthIdx].sub, strengthEntries[strengthIdx].color)
      : _hlCard(t('hl.top.1rm'), '—', t('hl.no.prs'), '#A78BFA');

    // ── Category 3: Avg W/kg ──
    const _perfHist = getHistory();
    const _perfSixWk = Date.now() - 42*24*60*60*1000;
    const _perfRecent = _perfHist.filter(w => w.date && new Date(w.date) >= _perfSixWk);
    const _pdVals = _perfRecent.filter(w => w.pd && parseFloat(w.pd) > 0).map(w => parseFloat(w.pd));
    const _avgPd = _pdVals.length ? (_pdVals.reduce((a,b)=>a+b,0)/_pdVals.length).toFixed(1) : null;
    const vo2Card = _avgPd
      ? _hlCard(t('hl.avg.wkg'), _avgPd, t('hl.6wk.sessions'), _avgPd ? getPDColor(_avgPd) : 'var(--label)')
      : _hlCard(t('hl.avg.wkg'), '—', t('hl.save.workouts'), 'var(--label)');

    // ── Category 4: Cardio PR ──
    const cardioPrs = [
      {id:'pr-run400', l: t('pr.run400')||'400m Run',    color:'#22C55E', isTime:true},
      {id:'pr-run5k',  l: t('pr.run5k')||'5k Run',       color:'#22C55E', isTime:true},
      {id:'pr-row500', l: t('pr.row500')||'500m Row',     color:'#2DD4BF', isTime:true},
      {id:'pr-row2k',  l: t('pr.row2k')||'2k Row',        color:'#2DD4BF', isTime:true},
      {id:'pr-ski500', l: t('pr.ski500')||'500m Ski Erg', color:'#60A5FA', isTime:true},
      {id:'pr-bike',   l: t('pr.bike')||'Assault Bike',   color:'#F59E0B', isTime:false},
      {id:'pr-du',     l: t('pr.double.unders')||'Double Unders', color:'#A78BFA', isTime:false},
    ];
    const cardioEntries = cardioPrs.filter(c => parseInt(_prs[c.id]||0) > 0).map(c => {
      const v = parseInt(_prs[c.id]);
      const valStr = c.isTime
        ? `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`
        : c.id === 'pr-du' ? `${v} reps/min` : `${v} cal/min`;
      return {value: valStr, sub: c.l, color: c.color};
    });
    const cardioIdx = nextCatIdx('wod_hl_cardio', cardioEntries.length);
    const cardioCard = cardioEntries.length > 0
      ? _hlCard(t('hl.cardio.pr'), cardioEntries[cardioIdx].value, cardioEntries[cardioIdx].sub, cardioEntries[cardioIdx].color)
      : _hlCard(t('hl.cardio.pr'), '—', t('hl.no.cardio.prs'), '#22C55E');

    el.innerHTML = benchCard + strengthCard + vo2Card + cardioCard;

  } else {
    // Custom tab — movement pattern, sessions, avg W/kg
    const hist = getHistory();
    const sixWeeksAgo = Date.now() - 42*24*60*60*1000;
    const recent = hist.filter(w => w.date && new Date(w.date) >= sixWeeksAgo);
    const pdVals = recent.filter(w=>w.pd).map(w=>parseFloat(w.pd));
    const avgPd = pdVals.length ? (pdVals.reduce((a,b)=>a+b,0)/pdVals.length).toFixed(1) : '—';
    let patternLabel = '—', patternColor = 'var(--label)';
    // Count dominant pattern across recent sessions
    const patternCounts = {};
    recent.forEach(w => {
      const pp = w.patternProfile;
      if (!pp) return;
      // Try dominantPattern first
      const dp = pp.dominantPattern;
      if (dp && dp !== 'unknown') {
        patternCounts[dp] = (patternCounts[dp] || 0) + 1;
      } else if (pp.patternPct && typeof pp.patternPct === 'object') {
        // Fall back to highest patternPct value
        const maxKey = Object.entries(pp.patternPct)
          .sort((a,b) => b[1]-a[1])[0]?.[0];
        if (maxKey) patternCounts[maxKey] = (patternCounts[maxKey] || 0) + 1;
      }
    });
    const totalPatternCount = Object.values(patternCounts).reduce((a,b)=>a+b,0);
    if (totalPatternCount > 0) {
      const dom = Object.entries(patternCounts).sort((a,b)=>b[1]-a[1])[0][0];
      const patternMeta = getPATTERNMETA();
      patternLabel = patternMeta[dom]?.label || dom;
      patternColor = patternMeta[dom]?.color || 'var(--label)';
    }
    // Consistency % — same formula as calendar: training days / 42 days
    const _allHist = getHistory();
    let _consistencyStr = '—', _consistencySub = t('hl.save.workouts'), _consistencyColor = 'var(--label)';
    if (_allHist.length > 0) {
      const _sixWeeksAgo2 = Date.now() - 42*24*60*60*1000;
      const _trainingDays = new Set(
        _allHist.filter(w => w.date && new Date(w.date) >= _sixWeeksAgo2)
                .map(w => localDateStr(new Date(w.date)))
      ).size;
      const _pct = Math.round(_trainingDays / 42 * 100);
      _consistencyStr = `${_pct}%`;
      _consistencySub = `${_trainingDays} ${_lang === 'es' ? 'días' : 'days'} / 42`;
      _consistencyColor = _pct >= 70 ? '#22C55E' : _pct >= 40 ? '#F59E0B' : '#EF4444';
    }

    el.innerHTML =
      _hlCard(t('pattern.dominant'), patternLabel || '—', recent.length >= 2 ? t('hl.6wk.pattern') : t('hl.save.workouts'), patternColor) +
      _hlCard(t('hl.sessions'), recent.length || '—', t('hl.6wk.total'), '#60A5FA') +
      _hlCard(t('hl.consistency'), _consistencyStr, _consistencySub, _consistencyColor);
  }
}

function switchProfileTab(idx) {
  document.querySelectorAll('.profile-tab').forEach((t,i) => t.classList.toggle('active', i===idx));
  document.querySelectorAll('.profile-tab-content').forEach((c,i) => c.classList.toggle('active', i===idx));
  localStorage.setItem('wod_profile_tab', idx);
  renderProfileHighlights(idx);
}

function updateProfileStats() {
  const h = parseFloat(document.getElementById('global-h').value) || 0;
  const w = parseFloat(document.getElementById('global-w').value) || 0;
  const bmi = h > 0 ? (w / ((h / 100) ** 2)).toFixed(1) : '—';
  const bmiEl = document.getElementById('stat-bmi');
  if (bmiEl) bmiEl.innerText = bmi;
  const htEl = document.getElementById('stat-height');
  if (htEl) htEl.innerText = h ? h + ' cm' : '—';
  const wtEl = document.getElementById('stat-weight');
  if (wtEl) wtEl.innerText = w ? w + ' kg' : '—';

  // VO2max
  const vo2Res = getEffectiveVO2max();
  const vo2El = document.getElementById('stat-vo2max');
  if (vo2El) vo2El.innerText = vo2Res?.value ? (vo2Res.estimated ? '~' + vo2Res.value : vo2Res.value) + ' ml' : '—';

  // 6-week stats from history
  const hist = getHistory();
  const sixWeeksAgo = Date.now() - 42*24*60*60*1000;
  const recent = hist.filter(w2 => w2.date && new Date(w2.date) >= sixWeeksAgo);
  const sessEl = document.getElementById('stat-sessions');
  if (sessEl) sessEl.innerText = recent.length || '—';

  // Avg W/kg
  const pdVals = recent.filter(w2 => w2.pd).map(w2 => parseFloat(w2.pd));
  const avgPd = pdVals.length ? (pdVals.reduce((a,b)=>a+b,0)/pdVals.length).toFixed(1) : '—';
  const pdEl = document.getElementById('stat-avg-pd');
  if (pdEl) pdEl.innerText = avgPd;

  // Trend — compare last 3 vs previous 3
  const trendEl = document.getElementById('stat-trend-pill');
  if (trendEl && pdVals.length >= 4) {
    const half = Math.floor(pdVals.length / 2);
    const recent3 = pdVals.slice(-half).reduce((a,b)=>a+b,0)/half;
    const prev3   = pdVals.slice(0,half).reduce((a,b)=>a+b,0)/half;
    const diff = recent3 - prev3;
    if (diff > 0.1)       { trendEl.textContent = '↑ Improving';   trendEl.style.color='#22C55E'; trendEl.style.borderColor='rgba(34,197,94,.3)'; }
    else if (diff < -0.1) { trendEl.textContent = '↓ Declining';   trendEl.style.color='#EF4444'; trendEl.style.borderColor='rgba(239,68,68,.3)'; }
    else                  { trendEl.textContent = '→ Maintaining'; trendEl.style.color='#F59E0B'; trendEl.style.borderColor='rgba(245,158,11,.3)'; }
  } else if (trendEl) { trendEl.textContent = '— Trend'; trendEl.style.color='var(--label)'; }

  // Identity header card
  const displayName = document.getElementById('global-display-name')?.value?.trim();
  const expVal = document.getElementById('global-exp')?.value || '';
  const goalVal = document.getElementById('global-goal')?.value || '';
  const expLabels = {beginner:t('exp.beginner').replace(/^\S+\s/,'')||'Beginner',intermediate:t('exp.intermediate').replace(/^\S+\s/,'')||'Intermediate',advanced:t('exp.advanced').replace(/^\S+\s/,'')||'Advanced',elite:t('exp.elite').replace(/^\S+\s/,'')||'Elite'};
  const expColors = {beginner:'#22C55E',intermediate:'#3B82F6',advanced:'#FF6B35',elite:'#EF4444'};
  const goalLabels = {allround:t('goal.opt.allround').replace(/^\S+\s/,'')||'All-Round',conditioning:t('goal.opt.conditioning').replace(/^\S+\s/,'')||'Conditioning',strength:t('goal.opt.strength').replace(/^\S+\s/,'')||'Strength',weightloss:t('goal.opt.weightloss').replace(/^\S+\s/,'')||'Weight Loss',performance:t('goal.opt.performance').replace(/^\S+\s/,'')||'Performance',endurance:t('goal.opt.endurance').replace(/^\S+\s/,'')||'Endurance'};
  const expColor = expColors[expVal] || '#FF6B35';
  const nameHero = document.getElementById('profile-display-name-hero');
  const avatar = document.getElementById('profile-avatar');
  const expBadge = document.getElementById('profile-exp-badge');
  const goalBadge = document.getElementById('profile-goal-badge');
  const ageBadge = document.getElementById('profile-age-badge');
  const blob = document.getElementById('profile-card-blob');
  if (nameHero) nameHero.textContent = displayName || t('section.athlete');
  if (avatar) {
    avatar.textContent = displayName ? displayName.charAt(0).toUpperCase() : '🏋️';
    avatar.style.borderColor = expColor;
    avatar.style.color = expColor;
    avatar.style.background = expColor + '22';
    avatar.style.boxShadow = `0 0 0 4px ${expColor}18`;
  }
  if (blob) blob.style.background = expColor + '20';
  if (expBadge) { expBadge.textContent = expLabels[expVal] || '—'; expBadge.style.color = expColor; expBadge.style.background = expColor + '18'; expBadge.style.borderColor = expColor + '44'; }
  if (goalBadge) goalBadge.textContent = goalLabels[goalVal] || '—';
  if (ageBadge) {
    const hh = getHistory();
    if (hh.length > 0 && hh[hh.length-1].date) {
      const days = Math.floor((Date.now() - new Date(hh[hh.length-1].date)) / (1000*60*60*24));
      const years = Math.floor(days/365), months = Math.floor(days/30);
      const isES = _lang === 'es';
      const ageStr = years >= 1
        ? (isES ? `${years}a ${months%12}m` : `${years}y ${months%12}m`)
        : days >= 60
          ? (isES ? `${months}m` : `${months}mo`)
          : `${days}d`;
      ageBadge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:3px;"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>${ageStr}`;
      ageBadge.style.display = '';
    }
  }

  // Legacy flip card display name
  const nameEl = document.getElementById('flip-display-name');
  if (nameEl) nameEl.textContent = displayName || '';
  updateGoalRec();
  renderProfileHighlights(parseInt(localStorage.getItem('wod_profile_tab') || '0'));
}

/* Save body metrics (height/weight/gender) to localStorage */
function saveBodyMetrics() {
  localStorage.setItem('wod-body', JSON.stringify({
    h: document.getElementById('global-h')?.value || '175',
      measurements: getMeasurements(),
    w: document.getElementById('global-w')?.value || '75',
    g: document.getElementById('global-gender')?.value || 'male',
  }));
  // Debounced auto-save to Supabase
  clearTimeout(_saveProfileTimer);
  _saveProfileTimer = setTimeout(() => {
    if (typeof sbSaveProfile === 'function') sbSaveProfile();
  }, 2000);
}

function loadBodyMetrics() {
  try {
    const b = JSON.parse(localStorage.getItem('wod-body') || '{}');
    if (b.h) document.getElementById('global-h').value = b.h;
    if (b.measurements) { localStorage.setItem('wod_athlete_measurements', JSON.stringify(b.measurements)); loadMeasurements(); }
    if (b.cardio_prs) {
      const cp = b.cardio_prs;
      if (cp.run400) document.getElementById('pr-run400').value = cp.run400;
      if (cp.run5k)  document.getElementById('pr-run5k').value  = cp.run5k;
      if (cp.row500) document.getElementById('pr-row500').value = cp.row500;
      if (cp.row2k)  document.getElementById('pr-row2k').value  = cp.row2k;
      if (cp.ski500) document.getElementById('pr-ski500').value = cp.ski500;
      if (cp.bike)   document.getElementById('pr-bike').value = cp.bike;
      if (cp.du)     document.getElementById('pr-du').value = cp.du;
      loadPRs();
    }
    if (b.w) document.getElementById('global-w').value = b.w;
    if (b.g) document.getElementById('global-gender').value = b.g;
  } catch(e) {}
}

/* Save extra profile fields to localStorage */
let _saveProfileTimer = null;
function saveProfile() {
  localStorage.setItem('wod_profile_updated_at', new Date().toISOString());
  const p = {
    age:     document.getElementById('global-age')?.value    || '',
    exp:     document.getElementById('global-exp')?.value    || '',
    goal:    document.getElementById('global-goal')?.value   || '',
    vo2max:       document.getElementById('global-vo2max')?.value       || '',
    vo2method:    _vo2method || '',
    hrmax:        document.getElementById('global-hrmax')?.value  ?? '',
    hrrest:       document.getElementById('global-hrrest')?.value ?? '',
    cooper:       document.getElementById('global-cooper')?.value       || '',
    displayName:  document.getElementById('global-display-name')?.value || '',
    voiceName:    localStorage.getItem('wod-voice-name') || '',
  };
  localStorage.setItem('wod-profile-extra', JSON.stringify(p));
  // Debounced auto-save to Supabase — waits 2s after last change before pushing
  clearTimeout(_saveProfileTimer);
  _saveProfileTimer = setTimeout(() => {
    if (typeof sbSaveProfile === 'function') sbSaveProfile();
  }, 2000);
}

/* Load extra profile fields */
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('wod-profile-extra') || '{}');
    if (p.age  && document.getElementById('global-age'))  document.getElementById('global-age').value  = p.age;
    if (p.exp  && document.getElementById('global-exp'))  document.getElementById('global-exp').value  = p.exp;
    if (p.goal && document.getElementById('global-goal')) document.getElementById('global-goal').value = p.goal;
    if (p.vo2max) {
      document.getElementById('global-vo2max').value = p.vo2max;
      document.getElementById('prof-vo2max-val').textContent = p.vo2max + ' ml/kg/min';
      if (p.vo2method) {
        _vo2method = p.vo2method;
        localStorage.setItem('wod-vo2method', p.vo2method); // keep in sync
      }
    }
    if (p.hrmax  !== undefined && p.hrmax  !== '') { document.getElementById('global-hrmax').value  = p.hrmax;  document.getElementById('prof-hrmax-val').textContent  = (p.hrmax||0)  + ' bpm'; }
    if (p.hrrest !== undefined && p.hrrest !== '') { document.getElementById('global-hrrest').value = p.hrrest; document.getElementById('prof-hrrest-val').textContent = (p.hrrest||0) + ' bpm'; }
    if (p.cooper) { const e=document.getElementById('global-cooper'); if(e) e.value=p.cooper; const v=document.getElementById('prof-cooper-val'); if(v) v.textContent=p.cooper+' m'; }
    if (p.displayName) { document.getElementById('global-display-name').value = p.displayName; }
    if (p.voiceName) { localStorage.setItem('wod-voice-name', p.voiceName); populateVoiceSelector(); }
    updateVO2maxEstimate();
    updateProfileStats();
  } catch(e) {}
  // refreshProfileDisplays is called after onload, not here, to avoid timing issues
  updateGoalRec();
}

/* Goal recommendation text */
function updateGoalRec() {
  const el = document.getElementById('goal-rec');
  if (!el) return;
  const goal = document.getElementById('global-goal')?.value || 'conditioning';
  const exp  = document.getElementById('global-exp')?.value  || 'intermediate';
  const recs_en = {
    conditioning: { icon:'❤️', title:'General Conditioning', text:'Mix of strength, gymnastics and monostructural work. Aim for 3–5 sessions/week with balanced intensity.' },
    strength:     { icon:'🏋️', title:'Strength & Power',      text:'Prioritise heavy barbell days. Keep metcon short and intense. 2–3 strength sessions + 1–2 conditioning.' },
    weightloss:   { icon:'🔥', title:'Fat Loss',               text:'High work-density WODs, AMRAPs and EMOM formats. Keep rest short. 4–5 sessions/week with solid nutrition.' },
    endurance:    { icon:'🏃', title:'Endurance Base',          text:'Long aerobic pieces: rows, runs, cyclical monostructural work. Supplement with 1–2 strength sessions.' },
    competition:  { icon:'🏆', title:'Competition Prep',        text:'Periodised: skill, strength, and sport-specific conditioning. Recovery and sleep are critical variables.' },
    rehab:        { icon:'🩺', title:'Rehab / Low Impact',      text:'Focus on form, range of motion and aerobic base. Avoid high-impact or heavy loading until cleared.' },
  };
  const recs_es = {
    conditioning: { icon:'❤️', title:'Acondicionamiento General', text:'Mezcla de fuerza, gimnasia y trabajo monostructural. Apunta a 3–5 sesiones/semana con intensidad equilibrada.' },
    strength:     { icon:'🏋️', title:'Fuerza y Potencia',         text:'Prioriza días de barra pesada. Mantén el metcon corto e intenso. 2–3 sesiones de fuerza + 1–2 de acondicionamiento.' },
    weightloss:   { icon:'🔥', title:'Pérdida de Grasa',           text:'WODs de alta densidad de trabajo, AMRAPs y formatos EMOM. Mantén el descanso corto. 4–5 sesiones/semana con buena nutrición.' },
    endurance:    { icon:'🏃', title:'Base de Resistencia',        text:'Piezas aeróbicas largas: remos, carreras, trabajo monostructural cíclico. Complementa con 1–2 sesiones de fuerza.' },
    competition:  { icon:'🏆', title:'Preparación para Competición',text:'Periodizado: habilidad, fuerza y acondicionamiento específico del deporte. La recuperación y el sueño son variables críticas.' },
    rehab:        { icon:'🩺', title:'Rehabilitación / Bajo Impacto',text:'Enfócate en la forma, el rango de movimiento y la base aeróbica. Evita cargas de alto impacto o pesadas hasta tener autorización.' },
  };
  const recs = _lang === 'es' ? recs_es : recs_en;
  const r = recs[goal] || recs.conditioning;
  el.innerHTML = `<strong>${r.icon} ${r.title}:</strong> ${r.text}`;
}

/* Save / load Personal Records */
function savePRs() {
  const ids=['pr-bsq','pr-dl','pr-cnj','pr-snatch','pr-press','pr-bench','pr-run400','pr-run5k','pr-row500','pr-row2k','pr-ski500','pr-bike','pr-du'];
  const prs={};
  ids.forEach(id => { const el=document.getElementById(id); if(el) prs[id]=el.value; });
  localStorage.setItem('wod-prs', JSON.stringify(prs));
  // Debounced auto-save to Supabase
  clearTimeout(_saveProfileTimer);
  _saveProfileTimer = setTimeout(() => {
    if (typeof sbSaveProfile === 'function') sbSaveProfile();
  }, 2000);
}

function loadPRs() {
  try {
    const prs=JSON.parse(localStorage.getItem('wod-prs')||'{}');
    Object.entries(prs).forEach(([id,val]) => { const el=document.getElementById(id); if(el) el.value=val; });
    ['bsq','dl','cnj','snatch','press','bench'].forEach(k => {
      const val=document.getElementById('pr-'+k)?.value;
      const disp=document.getElementById('pp-'+k+'-val');
      if(disp) disp.textContent=(!val||val==='0')?'—':val+' kg';
    });
    // Cardio PRs
    ['run400','run5k','row500','row2k','ski500'].forEach(k => {
      const val=parseInt(document.getElementById('pr-'+k)?.value)||0;
      const disp=document.getElementById('pp-'+k+'-val');
      if(disp) disp.textContent = val>0 ? fmtSecs(val) : '—';
    });
    ['bike','du'].forEach(k => {
      const val=parseInt(document.getElementById('pr-'+k)?.value)||0;
      const disp=document.getElementById('pp-'+k+'-val');
      const unit = k==='bike' ? ' cal/min' : ' reps/min';
      if(disp) disp.textContent = val>0 ? val+unit : '—';
    });
  } catch(e) {}
  renderBenchmarkPRs();
}

function fmtSecs(s) {
  return Math.floor(s/60)+':'+(s%60).toString().padStart(2,'0');
}

// Cardio PR picker — time based (mm:ss) for run/row/ski
function openCardioPRPicker(prId, trigger) {
  const cur = parseInt(document.getElementById(prId)?.value) || 0;
  const ranges = {
    'pr-run400': { min:45,  max:300  },
    'pr-run5k':  { min:600, max:3600 },
    'pr-row500': { min:45,  max:300  },
    'pr-row2k':  { min:300, max:1200 },
    'pr-ski500': { min:45,  max:300  },
  };
  const r = ranges[prId] || { min:45, max:900 };
  const vals = [0, ...Array.from({length: r.max - r.min + 1}, (_,i) => i + r.min)];
  _pickerTarget = document.getElementById(prId);
  _pickerValues = vals;
  _pickerCallback = (val) => {
    document.getElementById(prId).value = val;
    const dispId = 'pp-' + prId.replace('pr-','') + '-val';
    const disp = document.getElementById(dispId);
    if (disp) disp.textContent = val === 0 ? '—' : fmtSecs(val);
    savePRs();
  };
  const label = trigger.dataset.label || 'Time';
  document.getElementById('pickerLabel').textContent = label;
  const drum = document.getElementById('pickerDrum');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  vals.forEach(v => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v === cur ? ' selected' : '');
    item.textContent = v === 0 ? '—' : fmtSecs(v);
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const defaultVal = cur >= r.min ? cur : Math.round((r.min + r.max) / 4);
  const idx = cur === 0 ? 0 : (cur >= r.min ? vals.indexOf(cur) : vals.indexOf(defaultVal));
  drum.scrollTop = (idx >= 0 ? idx : 0) * 44;
  drum.onscroll = () => { clearTimeout(_pickerScrollTimeout); _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80); };
  const overlay = document.getElementById('pickerOverlay');
  overlay._trigger = trigger;
  overlay._profField = null;
  overlay.classList.add('open');
}


const BM_PR_KEY='wod_benchmark_prs';
function getBenchmarkPRs() { try{return JSON.parse(localStorage.getItem(BM_PR_KEY))||{};}catch(e){return {};} }
function saveBenchmarkPRs(data) { try{localStorage.setItem(BM_PR_KEY,JSON.stringify(data));}catch(e){} }

function rebuildBenchmarkPRs() {
  // Wipe and rebuild entirely from current history
  localStorage.removeItem(BM_PR_KEY);
  getHistory().forEach(entry => detectBenchmarkPR(entry));
  renderBenchmarkPRs();
}

function detectBenchmarkPR(entry) {
  if (!entry?.label) return;
  const wod=CLASSIC_WODS[entry.label]; if(!wod) return;
  const detail=entry.detail||'';
  let value=null, displayVal='', isForTime=false;
  if (wod.maxReps) {
    const m=detail.match(/Total Reps:\s*(\d+)/); if(m){value=parseInt(m[1]); displayVal=value+' reps';}
  } else if (wod.mode==='amrap') {
    const m=detail.match(/Result:\s*(\d+)\s*rounds?\s*\+\s*(\d+)/i);
    if(m){const r=parseInt(m[1]),x=parseInt(m[2]); value=r*1000+x; displayVal=r+' rds + '+x;}
  } else {
    isForTime=true;
    const m=detail.match(/Time:\s*(\d+):(\d{2})/);
    if(m){const mins=parseInt(m[1]),secs=parseInt(m[2]); value=mins*60+secs; displayVal=mins+':'+String(secs).padStart(2,'0');}
  }
  if (value===null) return;
  const allPRs=getBenchmarkPRs();
  if (!allPRs[entry.label]) allPRs[entry.label]=[];
  const existing=allPRs[entry.label];
  if (existing.some(e=>e.date===entry.date)) return;
  existing.push({date:entry.date, value, displayVal, isForTime, isAMRAP:wod.mode==='amrap'&&!wod.maxReps, isMaxReps:!!wod.maxReps});
  existing.sort((a,b)=>new Date(b.date)-new Date(a.date));
  allPRs[entry.label]=existing.slice(0,20);
  saveBenchmarkPRs(allPRs);
  const best=getBestPRValue(existing, isForTime);
  if (existing.length===1||value===best) showToast('🏆 New PR: '+entry.label+' '+displayVal+'!');
}

function getBestPRValue(entries, isForTime) {
  if (!entries.length) return null;
  return isForTime ? Math.min(...entries.map(e=>e.value)) : Math.max(...entries.map(e=>e.value));
}

/* ════════════════════════════════════════════════════
   CUSTOM MOVEMENTS
   Stored as array of {key, name, baseKey, cx, type, rm}
   Merged into MASTER_DB at load and on save
════════════════════════════════════════════════════ */
const CUSTOM_MOV_KEY = 'wod_custom_movements';

function getCustomMovements() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_MOV_KEY)) || []; } catch(e) { return []; }
}
function saveCustomMovements(arr) {
  try { localStorage.setItem(CUSTOM_MOV_KEY, JSON.stringify(arr)); } catch(e) {}
  mergeCustomMovements();
}

/* ════════════════════════════════════════════════════
   ATHLETE BODY MEASUREMENTS
   Precise ROM calculations from individual measurements
   Falls back to height/1.75 scaling when not provided
════════════════════════════════════════════════════ */

var _sigFlipLock = false;
function _sigFlip(el) {
  if (_sigFlipLock) return;
  el.classList.toggle('flipped');
}
function _sigFlipTouch(el, e) {
  e.preventDefault();
  e.stopPropagation();
  _sigFlipLock = true;
  el.classList.toggle('flipped');
  setTimeout(() => { _sigFlipLock = false; }, 400);
}
function _buildSigFlip(radar, color, w) {
  try {
    const container = document.getElementById('sig-radar-container');
    if (!container) { console.error('sig-radar-container NOT FOUND'); return; }

  // ── FRONT: use existing working radar SVG function with labels ──
  const isDark = document.body.classList.contains('dark');
  const keys = RADAR_AXIS_KEYS;
  const migratedRadar = radar._normalised ? migrateRadarNormalization(radar) : radar;
  const vals = keys.map(k => {
    if (migratedRadar._normalised) return Math.min(1, Math.max(0, migratedRadar[k]||0));
    const maxes = getRadarMaxes();
    return Math.min(1, Math.max(0, (migratedRadar[k]||0) / maxes[k]));
  });
  const labels = getRadarAxisLabels();
  const sz = 220, padding = 55, N = 6;
  const svgW = sz + padding * 2, svgH = sz + 20;
  const cx = svgW/2, cy = svgH/2, R = sz * 0.28, labelR = sz * 0.44;
  const angle = i => (Math.PI*2*i/N) - Math.PI/2;
  const pt = (i,r) => [cx + r*Math.cos(angle(i)), cy + r*Math.sin(angle(i))];
  const gridStroke = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const labelCol   = isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.72)';
  let gridSVG = '';
  [0.33,0.66,1].forEach(f => {
    const pts = Array.from({length:N},(_,i)=>pt(i,R*f)).map(p=>p.join(',')).join(' ');
    gridSVG += `<polygon points="${pts}" fill="none" stroke="${gridStroke}" stroke-width="1"/>`;
  });
  const axesSVG = Array.from({length:N},(_,i)=>{
    const p=pt(i,R);
    return `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="${gridStroke}" stroke-width="1"/>`;
  }).join('');
  const dataPts = vals.map((v,i)=>pt(i,R*v).map(x=>x.toFixed(1)).join(',')).join(' ');
  const dots = vals.map((v,i)=>{const p=pt(i,R*v);return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${color}"/>`;}).join('');
  const lblSVG = labels.map((lbl,i)=>{
    const lx=cx+labelR*Math.cos(angle(i)), ly=cy+labelR*Math.sin(angle(i));
    const anchor=lx<cx-5?'end':lx>cx+5?'start':'middle';
    return lbl.split('\n').map((line,j)=>`<text x="${lx.toFixed(1)}" y="${(ly-6+j*13).toFixed(1)}" text-anchor="${anchor}" fill="${labelCol}" font-size="11" font-family="sans-serif" font-weight="600">${line}</text>`).join('');
  }).join('');
  const frontHTML = `<div style="text-align:center;padding:8px 0;">
    <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-width:${svgW}px;display:block;margin:0 auto;">
      ${gridSVG}${axesSVG}
      <polygon points="${dataPts}" fill="${color}33" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${lblSVG}
    </svg>
    <div style="font-size:.65rem;color:var(--label);margin-top:4px;">${t('flip.hint')}</div>
  </div>`;

  // ── BACK: 6-week comparison ──
  const sixWeeksAgoStr = new Date(Date.now()-42*24*60*60*1000).toISOString().slice(0,10);
  const recentHist = getHistory().filter(h=>h.date&&h.date.slice(0,10)>=sixWeeksAgoStr&&h.pd);
  const avg = computeRadarAverage(recentHist);
  const avgOf = key => avg[key] > 0 ? avg[key] : null;
  const wVals = computeRadarValuesForSession(w);
  const radarLabels = getRadarAxisLabels();
  const axisUnits = { pd: 'W/kg', cvIntensity: '', wd: 'kJ', internalLoad: '', fb: '', td: '' };
  const metrics = RADAR_AXIS_KEYS.map((key, i) => ({
    key, label: radarLabels[i].replace('\n', ' '), unit: axisUnits[key], val: wVals[key]
  }));
  const rows = metrics.map(m=>{
    const avg=avgOf(m.key);
    if(!avg||!m.val) return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span style="font-size:.75rem;color:var(--label);">${m.label}</span><span style="font-size:.75rem;color:var(--label);">—</span></div>`;
    const pct=Math.round((m.val-avg)/avg*100);
    const arrow=pct>=5?'↑':pct<=-5?'↓':'→';
    const clr=pct>=5?'#22C55E':pct<=-5?'#EF4444':'var(--label)';
    const fmt=(v,u)=>u==='%'?v.toFixed(1)+'%':u==='W/kg'?v.toFixed(1)+' W/kg':Math.round(v)+(u?' '+u:'');
    const avgFmt=fmt(avg,m.unit);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:.75rem;color:var(--label);flex:1;">${m.label}</span>
      <span style="font-size:.75rem;font-weight:700;color:var(--text);margin:0 8px;">${fmt(m.val,m.unit)}</span>
      <span style="font-size:.75rem;font-weight:800;color:${clr};min-width:40px;text-align:right;">${arrow} ${Math.abs(pct)}%</span>
    </div>`;
  }).join('');
  const backHTML = `<div style="padding:10px 12px;">
    <div style="font-size:.7rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">${t('hist.modal.signature')}</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.6;margin-bottom:10px;padding:8px 10px;background:var(--glass-inner);border-radius:8px;">
      ${t('flip.normalised')} (${recentHist.length} ${recentHist.length === 1 ? t('flip.session') : t('flip.sessions')}).
    </div>
    ${rows}
    <div style="display:flex;gap:14px;margin-top:10px;font-size:.65rem;color:var(--label);">
      <span><span style="color:#22C55E;font-weight:800;">↑</span> &gt;5% ${t('flip.above')}</span>
      <span><span style="color:#EF4444;font-weight:800;">↓</span> &gt;5% ${t('flip.below')}</span>
      <span>→ ${t('flip.within')}</span>
    </div>
    <div style="font-size:.65rem;color:var(--label);margin-top:10px;text-align:center;">${t('flip.hint')}</div>
  </div>`;

  // ── Build DOM directly ──
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'cursor:pointer;user-select:none;-webkit-user-select:none;';
  const front = document.createElement('div');
  front.innerHTML = frontHTML;
  const back = document.createElement('div');
  back.style.borderRadius = '10px';
  back.style.border = '1px solid var(--border)';
  back.style.background = 'var(--surface)';
  back.style.display = 'none';
  back.innerHTML = backHTML;
  wrap.appendChild(front);
  wrap.appendChild(back);
  container.appendChild(wrap);

  let _sigShowing = true;
  wrap.addEventListener('click', function(e) {
    e.stopPropagation();
    _sigShowing = !_sigShowing;
    front.style.display = _sigShowing ? '' : 'none';
    back.style.display  = _sigShowing ? 'none' : 'block';
  });
  } catch(err) { console.error('_buildSigFlip error:', err); }
}
var MEAS_KEY = 'wod_athlete_measurements';
var _MEAS_IMGS = {
  male:   {
    dark:  'https://viugoqrrodrhkkdnlbqf.supabase.co/storage/v1/object/public/assests/Precise%20Measurements%20Male%20Dark%20mode.png',
    light: 'https://viugoqrrodrhkkdnlbqf.supabase.co/storage/v1/object/public/assests/Precise%20Measurements%20Male%20light%20mode.png'
  },
  female: {
    dark:  'https://viugoqrrodrhkkdnlbqf.supabase.co/storage/v1/object/public/assests/Precise%20Measurements%20Female%20Dark%20mode.png',
    light: 'https://viugoqrrodrhkkdnlbqf.supabase.co/storage/v1/object/public/assests/Precise%20Measurements%20Female%20light%20mode.png'
  }
};
function _measUpdateImg() {
  const gender = document.getElementById('global-gender')?.value || 'male';
  const theme = document.body.classList.contains('dark') ? 'dark' : 'light';
  const src = (_MEAS_IMGS[gender] || _MEAS_IMGS.male)[theme];
  const img = document.getElementById('meas-guide-img');
  if (img) img.src = src;
}
function getMeasurements() {
  try { return JSON.parse(localStorage.getItem(MEAS_KEY)) || {}; } catch(e) { return {}; }
}

function saveMeasurements() {
  const m = {
    knuckle: parseFloat(document.getElementById('meas-knuckle')?.value) || null,
    knee:    parseFloat(document.getElementById('meas-knee')?.value) || null,
    hip:     parseFloat(document.getElementById('meas-hip')?.value) || null,
    rack:    parseFloat(document.getElementById('meas-rack')?.value) || null,
    reach:   parseFloat(document.getElementById('meas-reach')?.value) || null,
    bench:   parseFloat(document.getElementById('meas-bench')?.value) || null,
  };
  localStorage.setItem(MEAS_KEY, JSON.stringify(m));
  const count = Object.values(m).filter(v => v !== null).length;
  const statusEl = document.getElementById('meas-status');
  if (statusEl) {
    statusEl.textContent = count === 6
      ? t('meas.all.set')
      : count > 0
        ? t('meas.partial').replace('{n}', count)
        : '';
  }
}

function loadMeasurements() {
  const m = getMeasurements();
  const fields = ['knuckle','knee','hip','rack','reach','bench'];
  fields.forEach(f => {
    const val = m[f];
    const inp = document.getElementById('meas-' + f);
    const disp = document.getElementById('meas-' + f + '-val');
    if (inp && val) inp.value = val;
    if (disp) disp.textContent = val ? val + ' cm' : '— cm';
  });
  saveMeasurements(); // update status
  _measUpdateImg();
}

// de Leva (1996) segment data: [mass_fraction, CoM_position_fraction_from_proximal_end]
// Verified against the actual paper (Table 4) earlier tonight — NOT the raw
// 1955 Dempster cadaver data, which de Leva's later regression corrected.
const DE_LEVA_SEGMENTS = {
  male:   { shank: [0.0433, 0.4459], thigh: [0.1416, 0.4095], trunk: [0.4346, 0.4486],
            upper_arm: [0.0271, 0.5772], forearm: [0.0162, 0.4574], hand: [0.0061, 0.7900] },
  female: { shank: [0.0481, 0.4416], thigh: [0.1478, 0.3612], trunk: [0.4257, 0.4151],
            upper_arm: [0.0255, 0.5754], forearm: [0.0138, 0.4559], hand: [0.0056, 0.7474] },
};

// Personalized whole-body CoM displacement for the BODYWEIGHT portion of
// mechanical work — separate from getAthleteROM()'s bar-path distance,
// which remains correct for the EXTERNAL WEIGHT portion (a barbell on the
// back/shoulders travels a different distance than the whole-body CoM
// average does). Only covers squat-pattern and Deadlift so far — the two
// movement families actually validated tonight via real kinematic
// modeling (forward kinematics for squats, inverse kinematics solving for
// hip position at Deadlift setup).
//
// Returns { rom, massFraction } — NOT just a distance — since the internal
// CoM calculation already mass-weights across the included segments
// (shank+thigh+trunk, ~62% of body mass), and that mass fraction must
// travel with the rom value it was derived from. Using it alongside the
// old, unrelated p.bw constant (a flat, unvalidated guess for a different
// concept) would double-count/misrepresent mass — callers must use
// massFraction INSTEAD OF p.bw when this returns non-null, not alongside it.
// Returns null for anything else, so callers fall back to the existing
// getAthleteROM()+p.bw combination unchanged.
function getPersonalizedBodyweightROM(movName, hMetres) {
  const m = getMeasurements();
  if (!m.knee || !m.hip) return null;
  const gender = (document.getElementById('global-gender')?.value === 'female') ? 'female' : 'male';
  const seg = DE_LEVA_SEGMENTS[gender];
  const knee_h = m.knee / 100, hip_h = m.hip / 100;
  const name = movName.toLowerCase();

  // ── Squat pattern: forward kinematics, population-average joint angles
  // (ankle ~42°, knee ~140° flexion, hip ~130° flexion at full depth —
  // researched and validated earlier tonight) applied to the athlete's
  // own segment lengths ──
  if (name.includes('squat') && !name.includes('lunge') && !name.includes('split')) {
    const shank_len = knee_h; // approx, ankle at 0
    const thigh_len = hip_h - knee_h;
    const trunk_len = (m.rack ? m.rack/100 : hMetres * 0.55*1.75/1.75) - hip_h; // shoulder proxy via rack
    const deg = d => d * Math.PI / 180;
    const comAt = (ankleDeg, kneeDeg, hipDeg) => {
      const shankA = deg(ankleDeg);
      const thighA = shankA - deg(kneeDeg);
      const trunkA = thighA + deg(hipDeg);
      const kneeY = shank_len * Math.cos(shankA);
      const hipY  = kneeY + thigh_len * Math.cos(thighA);
      const shankCom = seg.shank[1] * shank_len * Math.cos(shankA);
      const thighCom = kneeY + seg.thigh[1] * thigh_len * Math.cos(thighA);
      const trunkCom = hipY + seg.trunk[1] * trunk_len * Math.cos(trunkA);
      const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
      return (seg.shank[0]*shankCom + seg.thigh[0]*thighCom + seg.trunk[0]*trunkCom) / totalMass;
    };
    const top = comAt(0, 0, 0);
    const bottom = comAt(42, 140, 130);
    const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
    return { rom: top - bottom, massFraction: totalMass }; // positive CoM drop = effective bodyweight ROM
  }

  // ── Romanian Deadlift / Good Morning: hip-hinge from standing, forward
  // kinematics reusing the same structure as the squat model above, but
  // with real, sourced joint angles rather than population-average
  // estimates — Lee et al. 2018 (J Exerc Sci Fit, PMC6323186), Table 3,
  // directly measured RDL kinematics: ankle ~0° dorsiflexion (90.47°
  // anatomical = ~0° from neutral, confirming the shank stays vertical —
  // the same assumption the Deadlift model already used), knee 33.86°
  // flexion, hip 79.97° flexion. Both movements share this kinematic
  // pattern — only the load's position on the body differs (RDL: held in
  // hands; Good Morning: racked on back), which doesn't affect the
  // bodyweight-CoM calculation itself. ──
  if (name.includes('romanian') || name.includes('rdl') || name.includes('good morning')) {
    const shank_len = knee_h;
    const thigh_len = hip_h - knee_h;
    const trunk_len = (m.rack ? m.rack/100 : hMetres * 0.55) - hip_h;
    const deg = d => d * Math.PI / 180;
    const comAt = (ankleDeg, kneeDeg, hipDeg) => {
      const shankA = deg(ankleDeg);
      const thighA = shankA - deg(kneeDeg);
      const trunkA = thighA + deg(hipDeg);
      const kneeY = shank_len * Math.cos(shankA);
      const hipY  = kneeY + thigh_len * Math.cos(thighA);
      const shankCom = seg.shank[1] * shank_len * Math.cos(shankA);
      const thighCom = kneeY + seg.thigh[1] * thigh_len * Math.cos(thighA);
      const trunkCom = hipY + seg.trunk[1] * trunk_len * Math.cos(trunkA);
      const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
      return (seg.shank[0]*shankCom + seg.thigh[0]*thighCom + seg.trunk[0]*trunkCom) / totalMass;
    };
    const top = comAt(0, 0, 0);
    const bottom = comAt(0, 33.86, 79.97);
    const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
    return { rom: top - bottom, massFraction: totalMass };
  }

  // ── Lunge / Front-rack Lunge (standard lunge geometry, back foot on the
  // ground — Bulgarian Split Squat excluded, its elevated back foot is a
  // genuinely different geometry): asymmetric front/back leg positions
  // break the left-right symmetry every other model here relies on, so a
  // single shared hip-position solve (like Deadlift/RDL) would be
  // over-constrained. Resolved by computing each leg's height contribution
  // independently rather than solving one hip position that must satisfy
  // both legs' full 2D geometry simultaneously — valid because CoM only
  // needs each segment's HEIGHT, not its full spatial position. Front leg
  // (weight-bearing) directly establishes hip height: thigh horizontal +
  // knee ~90° means the thigh contributes zero additional height, so hip
  // height = front knee height. Back leg's known endpoint (knee ~5cm off
  // the ground) then connects to that SAME hip height via simple linear
  // interpolation along the known span — no separate angle-solve needed.
  // Trunk moves straight up/down (both sourced from real, specific
  // positional descriptions — Advanced Human Performance: "4 joint angles
  // ~90°, front femur and back tibia parallel to floor, back knee a
  // couple inches from ground, torso moves straight up and down"). ──
  if ((name.includes('lunge')) && !name.includes('bulgarian')) {
    const shank_len = knee_h;
    const thigh_len = hip_h - knee_h;
    const trunk_len = (m.rack ? m.rack/100 : hMetres * 0.55) - hip_h;
    const halfShankMass = seg.shank[0] / 2, halfThighMass = seg.thigh[0] / 2;

    // Standing (lockout): symmetric, both legs identical
    const shankComStand = shank_len * (1 - seg.shank[1]);
    const thighComStand = knee_h + thigh_len * seg.thigh[1];
    const trunkComStand = hip_h + trunk_len * (1 - seg.trunk[1]);
    const totalMass = 2*halfShankMass + 2*halfThighMass + seg.trunk[0];
    const comStanding = (2*halfShankMass*shankComStand + 2*halfThighMass*thighComStand + seg.trunk[0]*trunkComStand) / totalMass;

    // Bottom of lunge
    const frontKneeH = shank_len;       // shin vertical, unchanged from standing
    const frontHipH = frontKneeH;       // thigh horizontal contributes zero height
    const frontShankCom = frontKneeH * (1 - seg.shank[1]);
    const frontThighCom = frontKneeH;   // horizontal thigh -> CoM at knee height
    const backKneeH = 0.05;             // "a couple inches from the ground"
    const backShankCom = backKneeH;     // horizontal shin, minimal height variation
    const backThighCom = backKneeH + (frontHipH - backKneeH) * seg.thigh[1];
    const trunkComBottom = frontHipH + trunk_len * (1 - seg.trunk[1]);
    const comBottom = (halfShankMass*frontShankCom + halfThighMass*frontThighCom +
                        halfShankMass*backShankCom + halfThighMass*backThighCom +
                        seg.trunk[0]*trunkComBottom) / totalMass;

    return { rom: comStanding - comBottom, massFraction: totalMass };
  }

  // ── Thruster: squat portion (front-rack squat, reuses the exact same
  // kinematic model above) plus a press-portion contribution from the
  // arms rising from rack to overhead lockout. Quantified rather than
  // assumed negligible — the press contributes ~14% of the combined
  // bodyweight work for typical proportions, not small enough to ignore.
  // Squat and press are SEQUENTIAL phases of one rep, not simultaneous,
  // so their work contributions are summed (mass x displacement each),
  // then re-expressed as one combined {rom, massFraction} pair so the
  // product still matches the properly-summed total. ──
  if (name.includes('thruster')) {
    if (!m.rack || !m.reach) return null;
    const shank_len = knee_h;
    const thigh_len = hip_h - knee_h;
    const shoulder_h = m.rack / 100;
    const trunk_len = shoulder_h - hip_h;
    const deg = d => d * Math.PI / 180;
    const comAt = (ankleDeg, kneeDeg, hipDeg) => {
      const shankA = deg(ankleDeg);
      const thighA = shankA - deg(kneeDeg);
      const trunkA = thighA + deg(hipDeg);
      const kneeY = shank_len * Math.cos(shankA);
      const hipY  = kneeY + thigh_len * Math.cos(thighA);
      const shankCom = seg.shank[1] * shank_len * Math.cos(shankA);
      const thighCom = kneeY + seg.thigh[1] * thigh_len * Math.cos(thighA);
      const trunkCom = hipY + seg.trunk[1] * trunk_len * Math.cos(trunkA);
      const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
      return (seg.shank[0]*shankCom + seg.thigh[0]*thighCom + seg.trunk[0]*trunkCom) / totalMass;
    };
    const squatMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
    const squatRom = comAt(0, 0, 0) - comAt(42, 140, 130);
    const squatWorkEquiv = squatMass * squatRom;

    // Press portion: arm mass rising from shoulder/rack height to overhead
    // reach — both directly measured, not literature-derived.
    const armMassFrac = 2 * (seg.upper_arm[0] + seg.forearm[0] + seg.hand[0]);
    const pressRise = (m.reach / 100) - shoulder_h;
    const pressWorkEquiv = armMassFrac * pressRise;

    const combinedWorkEquiv = squatWorkEquiv + pressWorkEquiv;
    const combinedMassFraction = squatMass + armMassFrac;
    const effectiveRom = combinedWorkEquiv / combinedMassFraction;
    return { rom: effectiveRom, massFraction: combinedMassFraction };
  }

  // ── Sumo Deadlift: same inverse-kinematics approach as conventional
  // Deadlift, but accounting for the genuine 3D geometry of a wide stance
  // — the thigh's true length is fixed (measured), but part of it is
  // "used up" going laterally (from the wide-set knee back to the
  // centered hip/bar), leaving less length available for the sagittal
  // (forward/vertical) plane. This directly explains — rather than just
  // assumes — the "more horizontal thigh at lift-off" finding in the
  // research (Escamilla et al. 2000, via Duke Scholars): a shorter
  // effective sagittal thigh reach forces the hip to sit closer to knee
  // height, which is exactly what "more horizontal thigh" describes.
  // Stance width (70cm +-11cm) is from the same source; not the athlete's
  // own measurement, since the app doesn't currently collect stance width.
  if (name.includes('deadlift') && name.includes('sumo')) {
    if (!m.knuckle || !m.rack) return null;
    const knuckle_h = m.knuckle/100, shoulder_h = m.rack/100;
    const torso_len = shoulder_h - hip_h;
    const thigh_len_3d = hip_h - knee_h;
    const arm_len = shoulder_h - knuckle_h, barR = 0.225;
    const sumoStanceWidth = 0.70; // m, Escamilla et al. 2000
    const lateralOffset = sumoStanceWidth / 2;
    // Effective sagittal-plane thigh reach, reduced by the lateral
    // component the true 3D thigh length must also cover
    const thigh_len = Math.sqrt(Math.max(0, thigh_len_3d**2 - lateralOffset**2));

    const comHeight = (shoulderY, hipXY, kneeY) => {
      const shankCom = kneeY * (1 - seg.shank[1]);
      const thighCom = kneeY + (hipXY[1]-kneeY) * seg.thigh[1];
      const trunkCom = hipXY[1] + (shoulderY-hipXY[1]) * (1-seg.trunk[1]);
      const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
      return (seg.shank[0]*shankCom + seg.thigh[0]*thighCom + seg.trunk[0]*trunkCom) / totalMass;
    };

    const comLockout = comHeight(shoulder_h, [0, hip_h], knee_h);
    const shoulderSetupY = barR + arm_len;
    const sx = 0, sy = shoulderSetupY, kx = 0, ky = knee_h;
    const d = Math.sqrt((sx-kx)**2 + (sy-ky)**2);
    if (d > torso_len + thigh_len || d < Math.abs(torso_len - thigh_len)) return null;
    const a = (torso_len**2 - thigh_len**2 + d**2) / (2*d);
    const h = Math.sqrt(Math.max(0, torso_len**2 - a**2));
    const xm = sx + a*(kx-sx)/d, ym = sy + a*(ky-sy)/d;
    const x1 = xm + h*(ky-sy)/d, y1 = ym - h*(kx-sx)/d;
    const x2 = xm - h*(ky-sy)/d, y2 = ym + h*(kx-sx)/d;
    const hipSetup = (x1 < x2) ? [x1,y1] : [x2,y2];

    const comSetup = comHeight(shoulderSetupY, hipSetup, knee_h);
    const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
    return { rom: comLockout - comSetup, massFraction: totalMass };
  }

  // ── Deadlift: inverse kinematics solving for hip position at setup,
  // given the shoulder position (geometrically derived — arms vertical
  // to the bar, no external angle needed) and an assumed knee position
  // (minimal forward shift, well-established conventional-deadlift
  // technique, not requiring a specific sourced angle) ──
  if (name.includes('deadlift') && !name.includes('romanian') && !name.includes('rdl') && !name.includes('sumo')) {
    if (!m.knuckle || !m.rack) return null;
    const knuckle_h = m.knuckle/100, shoulder_h = m.rack/100;
    const torso_len = shoulder_h - hip_h, thigh_len = hip_h - knee_h;
    const arm_len = shoulder_h - knuckle_h, barR = 0.225;

    const comHeight = (shoulderY, hipXY, kneeY) => {
      const shankCom = kneeY * (1 - seg.shank[1]);
      const thighCom = kneeY + (hipXY[1]-kneeY) * seg.thigh[1];
      const trunkCom = hipXY[1] + (shoulderY-hipXY[1]) * (1-seg.trunk[1]);
      const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
      return (seg.shank[0]*shankCom + seg.thigh[0]*thighCom + seg.trunk[0]*trunkCom) / totalMass;
    };

    // Lockout: everything vertical at measured heights
    const comLockout = comHeight(shoulder_h, [0, hip_h], knee_h);

    // Setup: shoulder derived geometrically, knee assumed near-static,
    // hip solved via 2-circle intersection (torso_len from shoulder,
    // thigh_len from knee)
    const shoulderSetupY = barR + arm_len;
    const sx = 0, sy = shoulderSetupY, kx = 0, ky = knee_h;
    const d = Math.sqrt((sx-kx)**2 + (sy-ky)**2);
    if (d > torso_len + thigh_len || d < Math.abs(torso_len - thigh_len)) return null; // no valid geometric solution
    const a = (torso_len**2 - thigh_len**2 + d**2) / (2*d);
    const h = Math.sqrt(Math.max(0, torso_len**2 - a**2));
    const xm = sx + a*(kx-sx)/d, ym = sy + a*(ky-sy)/d;
    const x1 = xm + h*(ky-sy)/d, y1 = ym - h*(kx-sx)/d;
    const x2 = xm - h*(ky-sy)/d, y2 = ym + h*(kx-sx)/d;
    const hipSetup = (x1 < x2) ? [x1,y1] : [x2,y2]; // pick the "hips back" solution

    const comSetup = comHeight(shoulderSetupY, hipSetup, knee_h);
    const totalMass = seg.shank[0] + seg.thigh[0] + seg.trunk[0];
    return { rom: comLockout - comSetup, massFraction: totalMass };
  }

  return null; // not yet covered — caller falls back to existing ROM
}
// Uses athlete measurements if available, falls back to p.dist * (h/1.75)
function getAthleteROM(movName, p, hMetres) {
  const m = getMeasurements();
  const PLATE_H = 0.225; // standard 45lb plate radius in metres

  // Convert cm to metres
  const knuckle = m.knuckle ? m.knuckle/100 : null;
  const knee    = m.knee    ? m.knee/100    : null;
  const hip     = m.hip     ? m.hip/100     : null;
  const rack    = m.rack    ? m.rack/100    : null;
  const reach   = m.reach   ? m.reach/100  : null;

  const name = movName.toLowerCase();

  // ── Deadlift pattern — knuckle height minus plate height ──
  if (knuckle && (name.includes('deadlift') || name === 'sumo deadlift high pull')) {
    return knuckle - PLATE_H;
  }

  // ── Clean pull — same as deadlift ──
  if (knuckle && (name.includes('clean') && !name.includes('hang') && !name.includes('jerk') && !name.includes('thruster'))) {
    return knuckle - PLATE_H;
  }

  // ── Hang clean — hip to rack ──
  if (rack && hip && name.includes('hang') && name.includes('clean') && !name.includes('jerk')) {
    return rack - hip;  // hang clean: hip to front rack position
  }

  // ── KB/DB Snatch — reach to hip (starts from swing, not floor) ──
  if (reach && hip && (name.includes('snatch') && !name.includes('hang') && !name.includes('balance')) &&
      (name.includes('kettlebell') || name.includes('dumbbell') || name.includes('kb') || name.includes('db'))) {
    return reach - hip;
  }

  // ── Barbell Snatch / Power Snatch — reach to floor ──
  if (reach && (name.includes('snatch') && !name.includes('hang') && !name.includes('balance'))) {
    return reach - PLATE_H;
  }

  // ── Hang snatch — reach to hip ──
  if (reach && hip && name.includes('hang') && name.includes('snatch')) {
    return reach - hip;
  }

  // ── Clean & Jerk / C&J ──
  if (knuckle && reach && (name.includes('clean and jerk') || name.includes('clean & jerk'))) {
    const jerkROM = rack ? (reach - rack) : (hMetres * 0.19);
    return (knuckle - PLATE_H) + jerkROM;
  }

  // ── Press / Push Press / Jerk (not bench) ──
  if (reach && rack && (name.includes('press') || name.includes('jerk')) && !name.includes('clean') && !name.includes('snatch') && !name.includes('bench')) {
    return reach - rack;
  }

  // ── Squat — hip minus knee ──
  if (hip && knee && (name.includes('squat') || name.includes('lunge') || name.includes('split squat'))) {
    return hip - knee;
  }

  // ── Thruster — squat + press ──
  if (hip && knee && reach && rack && name.includes('thruster')) {
    return (hip - knee) + (reach - rack);
  }

  // ── Bench press / Push-up variants / DB Bench Press — use personal measurement if set ──
  if (name.includes('bench') || name === 'push-up' || name === 'knee push-up' || name === 'ring push-up') {
    const m = getMeasurements();
    if (m.bench) return m.bench / 100;
    return rack ? rack * 0.24 : 0.25;  // fallback
  }

  // ── Box Jump / Box Step-up — gender specific height ──
  if (name.includes('box jump') || name.includes('box step')) {
    const gender = document.getElementById('global-gender')?.value || 'male';
    return gender === 'female' ? 0.37 : 0.44; // 20" female, 24" male (CoM rise)
  }

  // Fallback — use dist * height scaling (guard against null p)
  if (!p || p.dist == null) return 0.3 * (hMetres / 1.75);
  return p.dist * (hMetres / 1.75);
}

function mergeCustomMovements() {
  // Remove previously merged custom movements
  Object.keys(MASTER_DB).forEach(k => { if (MASTER_DB[k]._custom) delete MASTER_DB[k]; });
  // Merge in current custom movements — skip any that now exist as built-ins
  getCustomMovements().forEach(cm => {
    if (MASTER_DB[cm.name] && !MASTER_DB[cm.name]._custom) return; // built-in now exists
    const base = MASTER_DB[cm.baseKey];
    if (!base) return;
    MASTER_DB[cm.name] = {
      bw:     base.bw,
      dist:   base.dist,
      bias:   base.bias,
      cx:     cm.cx,
      type:   cm.type,
      ...(cm.rm && cm.rm !== 'none' ? { rm: cm.rm } : {}),
      _custom: true,
      _baseKey: cm.baseKey,
    };
  });
}

// State for modal
let _cmovCx = 2, _cmovType = 'barbell', _cmovRm = 'none', _cmovEditKey = null;

function openCustomMovModal(editKey) {
  _cmovEditKey = editKey || null;
  _cmovCx = 2; _cmovType = 'barbell'; _cmovRm = 'none';

  document.getElementById('customMovModalTitle').textContent = editKey ? t('custom.edit') : t('custom.add');
  document.getElementById('cmov-name').value = '';
  document.getElementById('cmov-base-search').value = '';
  document.getElementById('cmov-base-key').value = '';
  document.getElementById('cmov-edit-key').value = editKey || '';
  document.getElementById('cmov-base-selected').style.display = 'none';
  document.getElementById('cmov-base-results').style.display = 'none';

  if (editKey) {
    const cm = getCustomMovements().find(c => c.key === editKey);
    if (cm) {
      document.getElementById('cmov-name').value = cm.name;
      document.getElementById('cmov-base-search').value = cm.baseKey;
      document.getElementById('cmov-base-key').value = cm.baseKey;
      document.getElementById('cmov-base-selected').textContent = cm.baseKey;
      document.getElementById('cmov-base-selected').style.display = '';
      _cmovCx = cm.cx; _cmovType = cm.type; _cmovRm = cm.rm || 'none';
    }
  }

  updateCmovButtons();
  document.getElementById('customMovModal').classList.add('open');
}

function closeCustomMovModal() {
  document.getElementById('customMovModal').classList.remove('open');
  document.getElementById('cmov-base-results').style.display = 'none';
}

function updateCmovButtons() {
  [1,2,3,4,5].forEach(n => {
    const btn = document.getElementById('cmov-cx-'+n);
    if (btn) { btn.style.background = n === _cmovCx ? 'var(--brand)' : ''; btn.style.color = n === _cmovCx ? 'white' : ''; }
  });
  ['barbell','dumbbell','kb','bw'].forEach(t => {
    const btn = document.getElementById('cmov-type-'+t);
    if (btn) { btn.style.background = t === _cmovType ? 'var(--brand)' : ''; btn.style.color = t === _cmovType ? 'white' : ''; }
  });
  ['none','BSQ','DL','C&J','SN','PRE','BP'].forEach(r => {
    const btn = document.getElementById('cmov-rm-'+r);
    if (btn) { btn.style.background = r === _cmovRm ? 'var(--brand)' : ''; btn.style.color = r === _cmovRm ? 'white' : ''; }
  });
}

function selectCmovCx(n) { _cmovCx = n; updateCmovButtons(); }
function selectCmovType(t) { _cmovType = t; updateCmovButtons(); }
function selectCmovRm(r) { _cmovRm = r; updateCmovButtons(); }

function handleCustomMovSearch(input) {
  const q = input.value.toLowerCase();
  const resultsEl = document.getElementById('cmov-base-results');
  resultsEl.innerHTML = '';
  if (!q) { resultsEl.style.display = 'none'; return; }
  const matches = Object.keys(MASTER_DB).filter(k => !MASTER_DB[k]._custom && k.toLowerCase().includes(q)).slice(0, 12);
  if (!matches.length) { resultsEl.style.display = 'none'; return; }
  matches.forEach(m => {
    const d = document.createElement('div');
    d.className = 'search-item'; d.textContent = m;
    d.onmousedown = (e) => {
      e.preventDefault();
      input.value = m;
      document.getElementById('cmov-base-key').value = m;
      const sel = document.getElementById('cmov-base-selected');
      sel.textContent = m + ' — bw:' + MASTER_DB[m].bw + ' dist:' + MASTER_DB[m].dist + 'm cx:' + MASTER_DB[m].cx;
      sel.style.display = '';
      resultsEl.style.display = 'none';
      // Auto-inherit type and cx from base
      _cmovType = MASTER_DB[m].type || 'barbell';
      _cmovCx = MASTER_DB[m].cx || 2;
      updateCmovButtons();
    };
    resultsEl.appendChild(d);
  });
  resultsEl.style.display = 'block';
}

function saveCustomMov() {
  const name = document.getElementById('cmov-name').value.trim();
  const baseKey = document.getElementById('cmov-base-key').value;
  if (!name) { showToast(t('toast.enter.movement')); return; }
  if (!baseKey || !MASTER_DB[baseKey]) { showToast(t('toast.select.base')); return; }
  if (MASTER_DB[name] && !MASTER_DB[name]._custom) { showToast(t('toast.name.conflict')); return; }

  const customs = getCustomMovements();
  const editKey = document.getElementById('cmov-edit-key').value;
  const entry = { key: editKey || 'cmov_' + Date.now(), name, baseKey, cx: _cmovCx, type: _cmovType, rm: _cmovRm };

  if (editKey) {
    const idx = customs.findIndex(c => c.key === editKey);
    if (idx !== -1) customs[idx] = entry; else customs.push(entry);
  } else {
    customs.push(entry);
  }

  saveCustomMovements(customs);
  renderCustomMovements();
  closeCustomMovModal();
  showToast(t('toast.custom.saved') + ': ' + name);
}

function deleteCustomMov(key) {
  const cm = getCustomMovements().find(c => c.key === key);
  if (!cm) return;
  if (!confirm('Delete "' + cm.name + '"? It will be removed from the movement library.')) return;
  saveCustomMovements(getCustomMovements().filter(c => c.key !== key));
  // Remove from MASTER_DB immediately
  delete MASTER_DB[cm.name];
  renderCustomMovements();
  showToast(t('toast.custom.deleted') + ': ' + cm.name);
}

function renderCustomMovements() {
  const el = document.getElementById('custom-movements-list');
  if (!el) return;
  const customs = getCustomMovements();
  if (!customs.length) {
    el.innerHTML = `<p style="font-size:.74rem;color:var(--label);font-style:italic;margin-bottom:12px;">${t('custom.none.yet')}</p>`;
    return;
  }
  el.innerHTML = customs.map(cm => {
    const cxLabels = ['', t('cx.basic'), t('cx.moderate'), t('cx.skilled'), t('cx.advanced'), t('cx.elite')];
    return `<div class="custom-mov-card">
      <div style="flex:1;min-width:0;">
        <div class="custom-mov-name">${cm.name}</div>
        <div class="custom-mov-base">Based on: ${cm.baseKey} &middot; ${cm.type}${cm.rm && cm.rm!=='none'?' &middot; '+cm.rm+' 1RM':''}</div>
      </div>
      <div class="custom-mov-cx">cx ${cm.cx} &middot; ${cxLabels[cm.cx]}</div>
      <div class="custom-mov-btns">
        <button class="custom-mov-btn" onclick="openCustomMovModal('${cm.key}')"><span data-i18n="btn.edit">Edit</span></button>
        <button class="custom-mov-btn del" onclick="deleteCustomMov('${cm.key}')">Del</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderBenchmarkPRs() {
  const container=document.getElementById('benchmark-pr-section'); if(!container) return;
  const allPRs=getBenchmarkPRs();
  const wodNames=Object.keys(allPRs).filter(n=>allPRs[n].length>0);
  if (!wodNames.length) { container.innerHTML=`<div style="font-size:.75rem;color:var(--label);font-style:italic;padding:8px 0;">${t('benchmark.intro')}</div>`; return; }
  container.innerHTML='';
  wodNames.forEach(wodName => {
    const entries=allPRs[wodName]; if(!entries.length) return;
    const isForTime=entries[0].isForTime;
    const bestVal=getBestPRValue(entries, isForTime);
    const prEntry=entries.find(e=>e.value===bestVal);
    const prDate=prEntry?fmtDate(new Date(prEntry.date),{day:'2-digit',month:'short',year:'numeric'}):'';
    const card=document.createElement('div'); card.className='bm-pr-card';
    const wod=CLASSIC_WODS[wodName];
    const ml={fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata'};
    card.innerHTML=`
      <div class="bm-pr-card-header">
        <span class="bm-pr-name">${wodName}</span>
        <span class="bm-pr-badge">🏆 ${prEntry?.displayVal||'—'}</span>
      </div>
      <div class="bm-pr-meta">${ml[wod?.mode]||''} &middot; PR ${prDate} &middot; ${entries.length} attempt${entries.length!==1?'s':''}</div>
      <div class="bm-pr-history">${entries.slice(0,5).map(e=>{
        const isPR=e.value===bestVal;
        const d=fmtDate(new Date(e.date),{day:'2-digit',month:'short'});
        return `<div class="bm-pr-history-row"><span class="bm-pr-history-date">${d}</span><span class="bm-pr-history-val${isPR?' is-pr':''}">${e.displayVal}${isPR?' 🏆':''}</span></div>`;
      }).join('')}</div>
      ${entries.length>=2?`<div class="bm-pr-chart-wrap"><canvas id="bm-chart-${wodName.replace(/\s/g,'_')}"></canvas></div>`:''}`;
    container.appendChild(card);
    if (entries.length>=2) {
      requestAnimationFrame(()=>{
        const canvas=document.getElementById('bm-chart-'+wodName.replace(/\s/g,'_')); if(!canvas) return;
        // Destroy existing chart instance if any
        const existingChart = Chart.getChart(canvas);
        if (existingChart) existingChart.destroy();
        const sorted=[...entries].sort((a,b)=>new Date(a.date)-new Date(b.date));
        const isDark=document.body.classList.contains('dark');
        const gc=isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.05)', lc=isDark?'#9CA3AF':'#6B7280';
        new Chart(canvas, {
          type:'line',
          data:{labels:sorted.map(e=>{const d=new Date(e.date);return(d.getMonth()+1)+'/'+d.getDate();}),
            datasets:[{data:sorted.map(e=>isForTime?e.value:e.value/1000),
              borderColor:'#FF6B35', backgroundColor:'rgba(255,107,53,.1)', fill:true, borderWidth:2,
              pointRadius:4, pointBackgroundColor:sorted.map(e=>e.value===bestVal?'#FF6B35':'#9CA3AF'), tension:0.3}]},
          options:{responsive:true, maintainAspectRatio:false,
            plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>sorted[ctx.dataIndex].displayVal}}},
            scales:{
              x:{grid:{color:gc},ticks:{color:lc,font:{size:9}}},
              y:{grid:{color:gc}, reverse:isForTime,
                ticks:{color:lc,font:{size:9}, callback:v=>isForTime?Math.floor(v/60)+':'+String(v%60).padStart(2,'0'):v.toFixed(1)}}}}
        });
      });
    }
  });
}

/* ════════════════════════════════════════════════════
   PROFILE FIELD PICKERS
   Separate picker system for profile fields:
   - Numeric: height (100-250cm), weight (30-200kg), age (10-80)
   - Text-option: gender, experience, goal
   - PR kg: 0-300kg with "—" for zero
════════════════════════════════════════════════════ */

function getProfileOpts() {
  return {
    gender: [
      { val:'male',   label:t('gender.male') },
      { val:'female', label:t('gender.female') },
    ],
    exp: [
      { val:'beginner',     label:t('exp.beginner') },
      { val:'intermediate', label:t('exp.intermediate') },
      { val:'advanced',     label:t('exp.advanced') },
      { val:'elite',        label:t('exp.elite') },
    ],
    goal: [
      { val:'conditioning', label:t('goal.opt.conditioning') },
      { val:'strength',     label:t('goal.opt.strength') },
      { val:'allround',     label:t('goal.opt.allround') },
      { val:'weightloss',   label:t('goal.opt.weightloss') },
      { val:'endurance',    label:t('goal.opt.endurance') },
      { val:'competition',  label:t('goal.opt.competition') },
      { val:'rehab',        label:t('goal.opt.rehab') },
    ],
  };
}

let _profPickerField = null;   // 'height'|'weight'|'age'|'gender'|'exp'|'goal'
let _profPickerNumVals = [];   // for numeric pickers
let _profPickerOptVals = [];   // for option pickers

function openProfilePicker(field) {
  _profPickerField = field;
  const overlay = document.getElementById('pickerOverlay');
  const drum = document.getElementById('pickerDrum');
  const label = document.getElementById('pickerLabel');

  if (field === 'height') {
    label.textContent = t('picker.height');
    const cur = parseInt(document.getElementById('global-h').value) || 175;
    _profPickerNumVals = Array.from({length:151}, (_,i) => i+100); // 100–250
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-h').value = val;
      document.getElementById('prof-h-val').textContent = val + ' cm';
      updateProfileStats(); saveProfile(); saveBodyMetrics(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v + ' cm');
  } else if (field === 'weight') {
    label.textContent = t('picker.weight');
    const cur = parseInt(document.getElementById('global-w').value) || 75;
    _profPickerNumVals = Array.from({length:171}, (_,i) => i+30); // 30–200
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-w').value = val;
      document.getElementById('prof-w-val').textContent = val + ' kg';
      updateProfileStats(); saveProfile(); saveBodyMetrics(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v + ' kg');
  } else if (field === 'age') {
    label.textContent = t('picker.age');
    const cur = parseInt(document.getElementById('global-age').value) || 30;
    _profPickerNumVals = Array.from({length:71}, (_,i) => i+10); // 10–80
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-age').value = val;
      document.getElementById('prof-age-val').textContent = val;
      saveProfile(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => String(v));
  } else if (['meas-knuckle','meas-knee','meas-hip','meas-rack','meas-reach','meas-bench'].includes(field)) {
    const configs = {
      'meas-knuckle': { label:'Knuckle height (cm)', min:50,  max:100, hint:'Arms relaxed, floor to middle knuckle' },
      'meas-knee':    { label:'Knee height (cm)',    min:30,  max:80,  hint:'Floor to centre of kneecap' },
      'meas-hip':     { label:'Hip crest (cm)',      min:70,  max:130, hint:'Floor to top of hip bone' },
      'meas-rack':    { label:'Rack height (cm)',    min:100, max:180, hint:'Floor to collarbone / front rack' },
      'meas-reach':   { label:'Overhead reach (cm)', min:150, max:260, hint:'Floor to fingertip overhead' },
      'meas-bench':   { label:'Bench Press ROM (cm)', min:15,  max:70,  hint:'Lying flat, chest to bar at lockout' },
    };
    const cfg = configs[field];
    label.textContent = cfg.label;
    const cur = parseInt(document.getElementById(field)?.value) || Math.round((cfg.min + cfg.max) / 2);
    _profPickerNumVals = Array.from({length: cfg.max - cfg.min + 1}, (_,i) => i + cfg.min);
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      const inp = document.getElementById(field);
      if (inp) inp.value = val;
      const dispEl = document.getElementById(field + '-val');
      if (dispEl) dispEl.textContent = val + ' cm';
      saveMeasurements();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v + ' cm');
  } else if (field === 'scale-pct-scaled' || field === 'scale-pct-found') {
    const isScaled = field === 'scale-pct-scaled';
    label.textContent = isScaled ? t('picker.scaled.pct') : t('picker.found.pct');
    const elId = isScaled ? 'global-scale-pct-scaled' : 'global-scale-pct-found';
    const valId = isScaled ? 'prof-scale-pct-scaled-val' : 'prof-scale-pct-found-val';
    const cur = parseInt(document.getElementById(elId)?.value) || (isScaled ? 75 : 50);
    _profPickerNumVals = Array.from({length:19}, (_,i) => (i+1)*5); // 5% to 95%
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById(elId).value = val;
      document.getElementById(valId).textContent = val + '%';
      const config = getBoxScalingConfig();
      config[isScaled ? '_scaledPct' : '_foundPct'] = val;
      localStorage.setItem('wod_box_scaling_config', JSON.stringify(config));
      localStorage.setItem('wod_profile_updated_at', new Date().toISOString());
      const sb = getSB();
      if (sb) sb.auth.getUser().then(({ data: { user } }) => {
        if (user) sb.from('profiles').upsert({ id: user.id, scaling_config: config, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      });
      showToast(`${isScaled ? 'Scaled' : 'Foundations'} load set to ${val}%`);
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v + '%');
  } else if (field === 'scale-rep-scaled' || field === 'scale-rep-found') {
    const isScaled = field === 'scale-rep-scaled';
    label.textContent = isScaled ? t('picker.scaled.rep.pct') : t('picker.found.rep.pct');
    const elId = isScaled ? 'global-scale-rep-scaled' : 'global-scale-rep-found';
    const valId = isScaled ? 'prof-scale-rep-scaled-val' : 'prof-scale-rep-found-val';
    const cur = parseInt(document.getElementById(elId)?.value) || 100;
    _profPickerNumVals = Array.from({length:20}, (_,i) => (i+1)*5); // 5% to 100%
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById(elId).value = val;
      document.getElementById(valId).textContent = val + '%';
      const config = getBoxScalingConfig();
      config[isScaled ? '_scaledRepPct' : '_foundRepPct'] = val;
      // Always persist both rep pct values so neither is ever undefined
      if (!config._scaledRepPct) config._scaledRepPct = parseInt(document.getElementById('global-scale-rep-scaled')?.value) || 100;
      if (!config._foundRepPct)  config._foundRepPct  = parseInt(document.getElementById('global-scale-rep-found')?.value)  || 100;
      localStorage.setItem('wod_box_scaling_config', JSON.stringify(config));
      localStorage.setItem('wod_profile_updated_at', new Date().toISOString());
      const sb = getSB();
      if (sb) sb.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          sb.from('profiles').upsert({ id: user.id, scaling_config: config, updated_at: new Date().toISOString() }, { onConflict: 'id' })
            .then(({ error }) => {
              if (error) console.error('[scaling] Supabase push failed:', error.message);
            });
        }
      });
      showToast(`${isScaled ? 'Scaled' : 'Foundations'} rep scale set to ${val}%`);
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v + '%');
  } else if (field === 'vo2max') {
    label.textContent = 'VO₂max (ml/kg/min)';
    const cur = parseInt(document.getElementById('global-vo2max').value) || 0;
    _profPickerNumVals = [0, ...Array.from({length:80}, (_,i) => i+20)]; // 0, 20–99
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      const previousVo2max = cur;
      document.getElementById('global-vo2max').value = val;
      document.getElementById('prof-vo2max-val').textContent = val === 0 ? '— ml/kg/min' : val + ' ml/kg/min';
      if (val > 0) {
        _vo2method = 'Manual entry';
        localStorage.setItem('wod-vo2method', 'Manual entry');
      } else {
        _vo2method = '';
        localStorage.setItem('wod-vo2method', '');
      }
      updateVO2maxEstimate(); saveProfile(); autoSave();
      // Only a genuine manual change from one real value to a different real
      // value needs the Correction-vs-Real-change decision — not clearing to
      // 0 (falling back to population/HR estimate), and not the very first
      // time a value is set (nothing to reconcile against yet).
      if (val > 0 && previousVo2max > 0 && val !== previousVo2max) {
        showVo2maxChangeModal(previousVo2max, val);
      }
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v === 0 ? '—' : v + ' ml/kg/min');
  } else if (field === 'hrmax') {
    label.textContent = t('picker.hrmax');
    const cur = parseInt(document.getElementById('global-hrmax').value) || 0;
    _profPickerNumVals = [0, ...Array.from({length:121}, (_,i) => i+120)]; // 0, 120–240
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-hrmax').value = val;
      document.getElementById('prof-hrmax-val').textContent = val === 0 ? '— bpm' : val + ' bpm';
      updateVO2maxEstimate(); saveProfile(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v === 0 ? '—' : v + ' bpm');
  } else if (field === 'hrrest') {
    label.textContent = t('picker.hrrest');
    const cur = parseInt(document.getElementById('global-hrrest').value) || 0;
    _profPickerNumVals = [0, ...Array.from({length:71}, (_,i) => i+30)]; // 0, 30–100
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-hrrest').value = val;
      document.getElementById('prof-hrrest-val').textContent = val === 0 ? '— bpm' : val + ' bpm';
      updateVO2maxEstimate(); saveProfile(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v === 0 ? '—' : v + ' bpm');
  } else if (field === 'cooper') {
    label.textContent = t('aerobic.cooper.label');
    const cur = parseInt(document.getElementById('global-cooper')?.value) || 0;
    _profPickerNumVals = [0, ...Array.from({length:201}, (_,i) => 1200+(i*10))]; // 0, 1200–3200m
    _pickerValues = _profPickerNumVals;
    _profPickerOptVals = [];
    _pickerCallback = (val) => {
      document.getElementById('global-cooper').value = val;
      document.getElementById('prof-cooper-val').textContent = val === 0 ? '— m' : val + ' m';
      saveProfile(); autoSave();
    };
    buildNumDrum(drum, _profPickerNumVals, cur, v => v === 0 ? '—' : v + ' m');
  } else {
    const opts = getProfileOpts()[field];
    label.textContent = field === 'gender' ? t('picker.gender') : field === 'exp' ? t('picker.exp') : t('picker.goal');
    const curVal = document.getElementById('global-' + (field === 'exp' ? 'exp' : field)).value;
    _profPickerOptVals = opts;
    _pickerValues = [];
    _pickerCallback = null; // handled separately
    buildOptDrum(drum, opts, curVal, field);
  }

  // Open overlay
  overlay._trigger = null;
  overlay._profField = field;
  overlay.classList.add('open');
}

function buildNumDrum(drum, vals, cur, fmt) {
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  vals.forEach(v => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v === cur ? ' selected' : '');
    item.textContent = fmt(v);
    item.dataset.numval = v;
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const idx = vals.indexOf(cur);
  drum.scrollTop = (idx >= 0 ? idx : 0) * 44;
  drum.onscroll = () => {
    clearTimeout(_pickerScrollTimeout);
    _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80);
  };
}

function buildOptDrum(drum, opts, curVal, field) {
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  opts.forEach((o, i) => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (o.val === curVal ? ' selected' : '');
    item.textContent = o.label;
    item.dataset.optval = o.val;
    item.dataset.optidx = i;
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const idx = opts.findIndex(o => o.val === curVal);
  drum.scrollTop = (idx >= 0 ? idx : 0) * 44;
  drum.onscroll = () => {
    clearTimeout(_pickerScrollTimeout);
    _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80);
  };
}



/* PR kg picker */
function openPRPicker(prId, trigger) {
  const cur = parseInt(document.getElementById(prId)?.value) || 0;
  // Custom ranges for cardio PRs
  let vals, unit;
  if (prId === 'pr-bike') {
    vals = [0, ...Array.from({length:60}, (_,i) => i+1)]; // —, 1–60 cal/min
    unit = ' cal/min';
  } else if (prId === 'pr-du') {
    vals = [0, ...Array.from({length:251}, (_,i) => i+50)]; // —, 50–300 reps/min
    unit = ' reps/min';
  } else {
    vals = [0, ...Array.from({length:300}, (_,i) => i+1)]; // 0–300 kg
    unit = ' kg';
  }
  _pickerTarget = document.getElementById(prId);
  _pickerValues = vals;
  _pickerCallback = (val) => {
    document.getElementById(prId).value = val;
    const dispId = 'pp-' + prId.replace('pr-','') + '-val';
    const disp = document.getElementById(dispId);
    if (disp) disp.textContent = val === 0 ? '—' : val + unit;
    savePRs();
  };
  const label = trigger.dataset.label || 'Weight (kg)';
  document.getElementById('pickerLabel').textContent = label;
  const drum = document.getElementById('pickerDrum');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  vals.forEach(v => {
    const item = document.createElement('div');
    item.className = 'picker-item' + (v === cur ? ' selected' : '');
    item.textContent = v === 0 ? '—' : v + unit;
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  const idx = vals.indexOf(cur);
  drum.scrollTop = (idx >= 0 ? idx : 0) * 44;
  drum.onscroll = () => { clearTimeout(_pickerScrollTimeout); _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80); };
  const overlay = document.getElementById('pickerOverlay');
  overlay._trigger = trigger;
  overlay._profField = null;
  overlay.classList.add('open');
}

/* Update profile picker display values (called after restore) */
function refreshProfileDisplays() {
  const h = document.getElementById('global-h')?.value || '175';
  const w = document.getElementById('global-w')?.value || '75';
  const age = document.getElementById('global-age')?.value || '30';
  const genderVal = document.getElementById('global-gender')?.value || 'male';
  const expVal = document.getElementById('global-exp')?.value || 'intermediate';
  const goalVal = document.getElementById('global-goal')?.value || 'conditioning';

  const el = id => document.getElementById(id);
  if (el('prof-h-val')) el('prof-h-val').textContent = h + ' cm';
  if (el('prof-w-val')) el('prof-w-val').textContent = w + ' kg';
  if (el('prof-age-val')) el('prof-age-val').textContent = age;

  const gLabel = getProfileOpts().gender.find(o => o.val === genderVal)?.label || genderVal;
  if (el('prof-gender-val')) el('prof-gender-val').textContent = gLabel;
  _measUpdateImg();

  const eLabel = getProfileOpts().exp.find(o => o.val === expVal)?.label || expVal;
  if (el('prof-exp-val')) el('prof-exp-val').textContent = eLabel;

  const goLabel = getProfileOpts().goal.find(o => o.val === goalVal)?.label || goalVal;
  if (el('prof-goal-val')) el('prof-goal-val').textContent = goLabel;
}
