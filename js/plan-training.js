/* ════════════════════════════════════════════════════
   PLAN TRAINING
   _planSessions: [{id, templateId, name, date, blocks,
     restDuration, simResults: [{r,x,m,s}], pd, wd, mc, fb}]
════════════════════════════════════════════════════ */
let _planSessions = [];
let _planChart = null;

function openPlanPanel() {
  const screen = document.getElementById('screen-analytics');
  screen.scrollTop = 0;
  screen.style.overflow = 'hidden';
  document.getElementById('plan-panel').classList.add('open');
  renderPlanPanel();
}

function closePlanPanel() {
  document.getElementById('plan-panel').classList.remove('open');
  document.getElementById('screen-analytics').style.overflow = '';
}

let _planSelectedTplId = null;
let _planSelectedTpl   = null;
let _planTemplates     = null;

function addPlanSession() {
  const templates = getTemplates();
  if (!templates.length) { showToast(t('toast.save.template')); return; }
  _planSelectedTplId = null;
  _planSelectedTpl = null;
  _planTemplates = templates;

  // Reset template picker
  document.getElementById('plan-tpl-val').textContent = t('plan.select.template');
  document.getElementById('plan-tpl-desc').textContent = '';

  // Set default date to tomorrow
  const tomorrow = new Date(Date.now() + 86400000);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth()+1).padStart(2,'0');
  const dd = String(tomorrow.getDate()).padStart(2,'0');
  const dateInp = document.getElementById('plan-date-input');
  if (dateInp) dateInp.value = `${yyyy}-${mm}-${dd}`;

  document.getElementById('planSessionModal').classList.add('open');
}

function openPlanTemplatePicker() {
  const templates = _planTemplates || getTemplates();
  if (!templates.length) return;
  const ml = {fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata', exmom:'EXMOM'};
  const overlay = document.getElementById('pickerOverlay');
  const drum    = document.getElementById('pickerDrum');
  document.getElementById('pickerLabel').textContent = t('custom.template.label');
  drum.innerHTML = '<div class="picker-drum-pad"></div>';
  const curIdx = templates.findIndex(t => t.id === _planSelectedTplId);
  templates.forEach((tpl, i) => {
    const modes = [...new Set((tpl.blocks||[]).map(b => ml[b.mode]||b.mode))].join('+');
    const item = document.createElement('div');
    item.className = 'picker-item' + (i === curIdx ? ' selected' : '');
    item.textContent = tpl.name + (modes ? ' · ' + modes : '');
    item.dataset.tplIdx = i;
    drum.appendChild(item);
  });
  drum.insertAdjacentHTML('beforeend', '<div class="picker-drum-pad"></div>');
  drum.scrollTop = Math.max(0, curIdx) * 44;
  drum.onscroll = () => { clearTimeout(_pickerScrollTimeout); _pickerScrollTimeout = setTimeout(() => updateDrumSelection(drum), 80); };
  overlay._planTemplatePicker = true;
  overlay._planTemplates = templates;
  overlay._profField = null;
  overlay._restPicker = null;
  overlay._voicePicker = null;
  overlay._customCallback = null;
  overlay.classList.add('open');
}

function selectPlanTemplate(tplId) {
  // Legacy — kept for compatibility but not used by new picker
  _planSelectedTplId = tplId;
  _planSelectedTpl = (_planTemplates || getTemplates()).find(t => t.id === tplId) || null;
}

function closePlanSessionModal() {
  document.getElementById('planSessionModal').classList.remove('open');
  _planSelectedTplId = null;
  _planSelectedTpl   = null;
  _planTemplates     = null;
}

function confirmAddPlanSession() {
  const tpl = _planSelectedTpl;
  const dateStr = document.getElementById('plan-date-input')?.value;
  if (!tpl) { showToast(t('toast.select.template')); return; }
  if (!dateStr) { showToast(t('toast.select.date')); return; }
  closePlanSessionModal();
  const session = {
    id: 'plan_' + Date.now(),
    templateId: tpl.id,
    name: tpl.name,
    date: dateStr,
    blocks: tpl.blocks || [],
    restDuration: parseInt(tpl.restDuration) || 0,
    simResults: (tpl.blocks || []).map(b => {
      const mode = (b.mode || 'fortime').toLowerCase();
      let defaultM = 5, defaultS = 0;
      if (mode === 'fortime') {
        defaultM = parseInt(b.cap) || 15;
      } else if (mode === 'amrap') {
        defaultM = parseInt(b.dur) || 10;
      } else if (mode === 'emom' || mode === 'exmom') {
        const totalSec = (parseInt(b.totalInt) || 15) * (parseInt(b.int) || 60);
        defaultM = Math.floor(totalSec / 60);
        defaultS = totalSec % 60;
      } else if (mode === 'tabata') {
        const totalSec = (parseInt(b.tabR) || 8) * ((parseInt(b.work) || 20) + (parseInt(b.rest) || 10));
        defaultM = Math.floor(totalSec / 60);
        defaultS = totalSec % 60;
      }
      return { r: parseInt(b.target) || 1, x: 0, m: defaultM, s: defaultS };
    }),
    pd: null, wd: null, mc: null, fb: null
  };
  _planSessions.push(session);
  _planSessions.sort((a,b) => a.date.localeCompare(b.date));
  // Ensure plan panel is open and screen is locked
  document.getElementById('plan-panel').classList.add('open');
  document.getElementById('screen-analytics').style.overflow = 'hidden';
  renderPlanPanel();
  // Scroll to top after modal animation settles
  setTimeout(() => {
    const panel = document.getElementById('plan-panel');
    if (panel) panel.scrollTop = 0;
  }, 300);
}

function removePlanSession(id) {
  _planSessions = _planSessions.filter(s => s.id !== id);
  renderPlanPanel();
  renderProjectedRecovery();
}

function simulatePlanSession(id) {
  const session = _planSessions.find(s => s.id === id);
  if (!session) return;
  const bw = parseFloat(document.getElementById('global-w')?.value) || 75;
  const h  = parseFloat(document.getElementById('global-h')?.value) / 100 || 1.75;
  let tw = 0, tt = 0, tas = 0, twMechCost = 0;
  let rmMax = 0;
  let tdTotal = 0, tdReps = 0;

  session.blocks.forEach((bd, i) => {
    const sim = session.simResults[i] || {r:1, x:0, m:5, s:0};
    const mode = bd.mode || 'fortime';
    let bM = parseInt(sim.m) || 0;
    let bS = parseInt(sim.s) || 0;
    if (mode === 'amrap') { bM = parseInt(bd.dur) || 10; bS = 0; }
    else if (mode === 'emom') {
      const ts = (parseInt(bd.int)||60) * (parseInt(bd.totalInt)||15);
      bM = Math.floor(ts/60); bS = ts%60;
    } else if (mode === 'tabata') {
      const ts = (parseInt(bd.tabR)||8) * ((parseInt(bd.work)||20)+(parseInt(bd.rest)||10));
      bM = Math.floor(ts/60); bS = ts%60;
    }
    tas += bM*60 + bS;

    const r = mode === 'emom' ? (parseInt(bd.totalInt) || 15)
            : mode === 'tabata' ? (parseInt(bd.tabR) || 8)
            : (parseInt(sim.r) || 0);
    const x = parseInt(sim.x) || 0;
    const movements = bd.movements || [];

    // Build rep ladder sequence from serialized block data
    const ladderType  = bd.ladderType  || 'fixed';
    const ladderStart = parseInt(bd.ladderStart) || 0;
    const ladderInc   = parseInt(bd.ladderInc)   || 0;
    const goalRounds  = parseInt(bd.target) || r;
    let repSeqPlan = null;
    if (ladderType !== 'fixed' && ladderStart > 0 && r > 0) {
      repSeqPlan = [];
      const half = Math.ceil(r / 2);
      for (let i = 0; i < r; i++) {
        if (ladderType === 'ascending')   repSeqPlan.push(Math.max(1, ladderStart + ladderInc * i));
        else if (ladderType === 'descending') repSeqPlan.push(Math.max(1, ladderStart - ladderInc * i));
        else if (ladderType === 'pyramid') {
          repSeqPlan.push(i < half ? Math.max(1, ladderStart + ladderInc * i)
                                   : Math.max(1, ladderStart + ladderInc * (r - i - 1)));
        } else if (ladderType === 'valley') {
          repSeqPlan.push(i < half ? Math.max(1, ladderStart - ladderInc * i)
                                   : Math.max(1, ladderStart - ladderInc * (r - i - 1)));
        }
      }
    }

    let ep = x;
    movements.forEach((mv, mvIdxPlanWork) => {
      const p = MASTER_DB[mv.name]; if (!p) return;
      const baseWt  = parseFloat(mv.kg)   || 0;
      const pres    = parseFloat(mv.reps) || 0;

      // Build weight ladder sequence from serialized movement data
      const wtType  = mv.wtLadderType || 'fixed';
      const wtInc   = parseFloat(mv.wtLadderInc) || 5;
      let wtSeqPlan = null;
      if (wtType !== 'fixed' && baseWt > 0 && r > 0) {
        wtSeqPlan = [];
        const half = Math.ceil(r / 2);
        for (let i = 0; i < r; i++) {
          if (wtType === 'ascending')   wtSeqPlan.push(Math.max(0, Math.round((baseWt + wtInc * i) * 10) / 10));
          else if (wtType === 'descending') wtSeqPlan.push(Math.max(0, Math.round((baseWt - wtInc * i) * 10) / 10));
          else if (wtType === 'pyramid') {
            wtSeqPlan.push(i < half ? Math.max(0, Math.round((baseWt + wtInc * i) * 10) / 10)
                                    : Math.max(0, Math.round((baseWt + wtInc * (r - i - 1)) * 10) / 10));
          } else if (wtType === 'valley') {
            wtSeqPlan.push(i < half ? Math.max(0, Math.round((baseWt - wtInc * i) * 10) / 10)
                                    : Math.max(0, Math.round((baseWt - wtInc * (r - i - 1)) * 10) / 10));
          }
        }
      }

      let reps, work = 0, tt_mv = 0, mechCost_mv = 0;

      // Eccentric logic — mirrors reconstructMechanicalWork(). wd is now
      // ALWAYS pure concentric (x1), for every movement unconditionally —
      // supersedes the earlier cyclical=x2 rule. mc_mech: cyclical always
      // full credit (x7/6); one-directional reads the per-movement-instance
      // controlled-descent toggle, defaulting to true (full credit) if unset.
      const workMultiplier = 1;
      const mcMechEligible = !p.oneDir || mv.controlledDescent !== false;
      const mechCostMultiplier = mcMechEligible ? (7/6) : 1;
      // Personalized bodyweight-CoM ROM doesn't vary by round/weight —
      // computed once here rather than per round below. When available,
      // its own massFraction replaces p.bw entirely (see
      // getPersonalizedBodyweightROM's doc comment).
      const bwPersonalPlan = getPersonalizedBodyweightROM(mv.name || '', h);

      if (mode === 'tabata') {
        reps = x;
        const barPathRom = getAthleteROM(mv.name || '', p, h);
        const bwRom = bwPersonalPlan ? bwPersonalPlan.rom : barPathRom;
        const bwMassFrac = bwPersonalPlan ? bwPersonalPlan.massFraction : p.bw;
        const concentric = ((baseWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;
        work = concentric * workMultiplier;
        mechCost_mv = concentric * mechCostMultiplier;
        tt_mv = baseWt * reps;
      } else if (wtSeqPlan) {
        // Weight ladder — calculate per round
        const barPathRom = getAthleteROM(mv.name || '', p, h);
        const bwRom = bwPersonalPlan ? bwPersonalPlan.rom : barPathRom;
        const bwMassFrac = bwPersonalPlan ? bwPersonalPlan.massFraction : p.bw;
        reps = 0;
        for (let ri = 0; ri < r; ri++) {
          const roundWt   = wtSeqPlan[ri] || baseWt;
          const roundReps = repSeqPlan ? (repSeqPlan[ri] || pres) : pres;
          const concentricRound = ((roundWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * roundReps) / 1000;
          work   += concentricRound * workMultiplier;
          mechCost_mv += concentricRound * mechCostMultiplier;
          tt_mv  += roundWt * roundReps;
          reps   += roundReps;
        }
        // Extra reps at last round weight
        if (x > 0 && r > 0) {
          const lastWt = wtSeqPlan[r - 1] || baseWt;
          const concentricExtra = ((lastWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * x) / 1000;
          work  += concentricExtra * workMultiplier;
          mechCost_mv += concentricExtra * mechCostMultiplier;
          tt_mv += lastWt * x;
          reps  += x;
        }
      } else if (repSeqPlan) {
        // Rep ladder only, fixed weight
        const barPathRom = getAthleteROM(mv.name || '', p, h);
        const bwRom = bwPersonalPlan ? bwPersonalPlan.rom : barPathRom;
        const bwMassFrac = bwPersonalPlan ? bwPersonalPlan.massFraction : p.bw;
        reps = repSeqPlan.reduce((a, b) => a + b, 0);
        const concentric = ((baseWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;
        work  = concentric * workMultiplier;
        mechCost_mv = concentric * mechCostMultiplier;
        tt_mv = baseWt * reps;
      } else if (mode === 'exmom') {
        // Was previously missing entirely — fell through to the generic
        // "base = pres * r" case below, using the raw round count with no
        // station-count division at all. Same underlying bug category as
        // the cardio-specific one found and fixed for real logged
        // sessions, but this one is in Plan Training's OWN main work
        // calculation (affecting every movement in a planned exmom
        // session, not just cardio) — real logged history was never
        // affected, since the live flow already handled this correctly.
        const stationCount = movements.length || 1;
        const stationRounds = Math.floor(r / stationCount) + (mvIdxPlanWork < (r % stationCount) ? 1 : 0);
        reps = pres * Math.max(1, stationRounds);
        const barPathRom = getAthleteROM(mv.name || '', p, h);
        const bwRom = bwPersonalPlan ? bwPersonalPlan.rom : barPathRom;
        const bwMassFrac = bwPersonalPlan ? bwPersonalPlan.massFraction : p.bw;
        const concentric = ((baseWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;
        work  = concentric * workMultiplier;
        mechCost_mv = concentric * mechCostMultiplier;
        tt_mv = baseWt * reps;
      } else {
        // Fixed reps and weight
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
        const barPathRom = getAthleteROM(mv.name || '', p, h);
        const bwRom = bwPersonalPlan ? bwPersonalPlan.rom : barPathRom;
        const bwMassFrac = bwPersonalPlan ? bwPersonalPlan.massFraction : p.bw;
        const concentric = ((baseWt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;
        work  = concentric * workMultiplier;
        mechCost_mv = concentric * mechCostMultiplier;
        tt_mv = baseWt * reps;
      }

      if (reps <= 0) return;
      if (!p.cardio) { tw += work; tt += tt_mv; }
      if (!p.cardio) twMechCost += mechCost_mv; // cardio's own mc_aero path handles its cost separately
      const rmPct = get1RMPercent(mv.name, wtSeqPlan ? Math.max(...wtSeqPlan) : baseWt);
      if (rmPct !== null && rmPct > rmMax) rmMax = rmPct;
      if (p.cx && reps > 0) { tdTotal += p.cx * reps; tdReps += reps; }
    });
  });

  // Add rest between blocks
  const gaps = session.blocks.length - 1;
  if (gaps > 0) tas += session.restDuration * gaps;

  if (tas <= 0 || tw <= 0) { showToast(t('toast.enter.results')); return; }
  const sessionPD = ((tw * 1000) / (tas || 1) / bw);
  session.pd = sessionPD.toFixed(2);
  session.wd = tw.toFixed(2);
  // planMechKcal derives from twMechCost, NOT tw — the two diverge for
  // one-directional movements once eccentric work is added (or not),
  // exactly the same reasoning as the live flow's twMechCost split.
  const planMechKcal = Math.round((twMechCost / 4.184) / 0.22);

  // ── Cardio energy (mc_aero) from plan movements ──────────────────────
  // Mirrors getCardioEnergy() but works from plan session data (not DOM).
  // Computed BEFORE overhead now, since overhead needs to subtract it —
  // this ordering was the source of a real, separate bug: overhead was
  // previously computed without ever subtracting cardio at all.
  const run400  = parseInt(document.getElementById('pr-run400')?.value)||0;
  const run5k   = parseInt(document.getElementById('pr-run5k')?.value)||0;
  const row500  = parseInt(document.getElementById('pr-row500')?.value)||0;
  const row2k   = parseInt(document.getElementById('pr-row2k')?.value)||0;
  const ski500  = parseInt(document.getElementById('pr-ski500')?.value)||0;
  const duRPM   = parseFloat(document.getElementById('pr-du')?.value)||0;
  const age     = parseInt(document.getElementById('global-age')?.value)||30;
  const gender  = document.getElementById('global-gender')?.value||'male';
  const ageFactor    = Math.max(0.60, 1 - Math.max(0, (age-25)*0.01));
  const genderFactor = gender==='female' ? 0.92 : 1.0;
  const metFactor    = ageFactor * genderFactor;
  const riegelSecs   = (refSecs, refDist, targetDist) => refSecs ? refSecs * Math.pow(targetDist/refDist, 1.06) : null;
  const estimateRunSecs = distM => {
    if (distM <= 600) return riegelSecs(run400||90, 400, distM) || (distM/400*(run400||90));
    if (run5k)  return riegelSecs(run5k, 5000, distM);
    if (run400) return distM * (run400/400) * 2.2;
    return distM * 0.30;
  };
  const estimateRowSecs = distM => {
    if (distM < 800) return riegelSecs(row500||120, 500, distM) || (distM/500*(row500||120));
    if (row2k)  return riegelSecs(row2k, 2000, distM);
    if (row500) return distM * (row500/500) * 1.25;
    return distM * 0.26;
  };

  let planCardioKcal = 0;
  session.blocks.forEach((bd, bi) => {
    const simRes = session.simResults[bi] || {r:1, x:0, m:0, s:0};
    const rounds = simRes.r || 1;
    const bdMode = bd.mode || 'fortime';
    const bdStationCount = (bd.movements||[]).length || 1;
    (bd.movements||[]).forEach((mv, mvIdxPlan) => {
      const p = MASTER_DB[mv.name]; if (!p || !p.cardio) return;
      const presReps = parseFloat(mv.reps)||0; if (presReps <= 0) return;
      // exmom: each round is one station visit, not one full pass through
      // every movement — same fix as getCardioEnergy(), same underlying bug
      // (was using raw round count directly, producing ~4x too much
      // distance/kcal for multi-station exmom blocks).
      let effRoundsPlan = rounds;
      if (bdMode === 'exmom') {
        effRoundsPlan = Math.floor(rounds / bdStationCount) + (mvIdxPlan < (rounds % bdStationCount) ? 1 : 0);
      }
      const totalReps = presReps * effRoundsPlan;
      const distM = totalReps * p.cardioRef;
      let secs = null;
      if (p.cardio === 'run') secs = estimateRunSecs(distM);
      else if (p.cardio === 'row') secs = estimateRowSecs(distM);
      else if (p.cardio === 'ski') secs = ski500 ? riegelSecs(ski500, 500, distM) : null;
      else if (p.cardio === 'bike') { planCardioKcal += totalReps * p.cardioRef * metFactor; return; }
      else if (p.cardio === 'du') secs = duRPM > 0 ? (totalReps * p.cardioRef / duRPM) * 60 : null;
      if (secs) planCardioKcal += p.met * bw * (secs/3600) * metFactor;
    });
  });

  // Aerobic overhead — same RPE-driven formula as calculateGlobalPhysics.
  // Uses predicted RPE (session.predictedRpe, set via the slider on this
  // plan card) instead of an actual, experienced RPE, since this session
  // hasn't happened yet — but the formula itself is now identical to real
  // logged sessions, so both flows share one consistent calculation
  // instead of Plan Training running its own separate, ceiling-based
  // estimate.
  const vo2maxRes = getEffectiveVO2max();
  const vo2max = vo2maxRes?.value || null;
  const predictedRpe = session.predictedRpe || 5;
  let planOverheadKcal = 0;
  if (vo2max && tas > 0) {
    const relIntensity  = Math.min(1.0, predictedRpe / 10);
    const vo2Session    = relIntensity * vo2max;
    const met           = vo2Session / 3.5;
    const timeHours     = tas / 3600;
    const totalMetEst   = met * bw * timeHours * ageFactor * genderFactor;
    planOverheadKcal    = Math.max(0, Math.round(totalMetEst - planMechKcal - planCardioKcal));
  }
  session.mc          = (planMechKcal + planOverheadKcal + planCardioKcal).toFixed(0);
  session.mc_mech     = planMechKcal;
  session.mc_overhead = planOverheadKcal;
  session.mc_aero = planCardioKcal > 0 ? Math.round(planCardioKcal) : null;
  // pd stays mechanical-only (set earlier in this function from sessionPD) —
  // Total Power is computed fresh via getSessionPower() everywhere it's
  // displayed, so this field keeps one consistent, stable meaning.
  // FB is mechanical-only, same formula as calculateGlobalPhysics — tonnage
  // over loaded mechanical work, excluding both Aerobic and Overhead.
  session.fb = (tt/(tw||1)).toFixed(0);
  session.rl = Math.round(rmMax);
  session.td = tdReps > 0 ? (tdTotal / tdReps).toFixed(1) : '—';

  // Store peak movement name and pattern for neural projection
  let planPeakRL = 0, planPeakName = '', planPeakPattern = '';
  session.blocks.forEach(bd => {
    (bd.movements||[]).forEach(mv => {
      const rmPct = get1RMPercent(mv.name, mv.kg||0);
      if (rmPct !== null && rmPct > planPeakRL) {
        planPeakRL = rmPct;
        planPeakName = mv.name || '';
        planPeakPattern = getMovementPattern ? getMovementPattern(mv.name||'') : '';
      }
    });
  });
  session.peakName    = planPeakName;
  session.peakPattern = planPeakPattern;

  // Update physics row in card without re-rendering inputs
  const card = document.getElementById('card_'+id);
  if (card) {
    let physRow = card.querySelector('.plan-session-physics');
    if (!physRow) {
      physRow = document.createElement('div');
      physRow.className = 'plan-session-physics';
      physRow.style.marginBottom = '8px';
      card.querySelector('.plan-session-header').insertAdjacentElement('afterend', physRow);
    }
    physRow.innerHTML = `
      <div class="plan-session-metric"><div class="plan-session-metric-val">${session.pd}</div><div class="plan-session-metric-lbl">W/kg</div></div>
      <div class="plan-session-metric"><div class="plan-session-metric-val">${session.wd}</div><div class="plan-session-metric-lbl">kJ</div></div>
      <div class="plan-session-metric"><div class="plan-session-metric-val">${session.mc}</div><div class="plan-session-metric-lbl">kcal</div></div>
      <div class="plan-session-metric"><div class="plan-session-metric-val">${session.fb}</div><div class="plan-session-metric-lbl">Bias</div></div>
      ${session.rl > 0 ? `<div class="plan-session-metric"><div class="plan-session-metric-val">${session.rl}%</div><div class="plan-session-metric-lbl">RL</div></div>` : ''}
      <div class="plan-session-metric"><div class="plan-session-metric-val">${session.td}</div><div class="plan-session-metric-lbl">TD</div></div>`;
  }
  renderProjectedChart();
  renderProjectedRecovery();
  showToast(t('toast.session.simulated'));
}

function renderPlanPanel() {
  const listEl = document.getElementById('plan-session-list');
  const emptyEl = document.getElementById('plan-empty');
  const chartSec = document.getElementById('plan-chart-section');
  const addBtn = document.getElementById('plan-add-btn');
  if (!listEl) return;

  // Persist any current input values into sim before re-rendering
  _planSessions.forEach((s, si) => {
    (s.blocks||[]).forEach((b, i) => {
      const sim = s.simResults[i]; if (!sim) return;
      const r = document.getElementById('inp_ps_r_'+si+'_'+i);
      const x = document.getElementById('inp_ps_x_'+si+'_'+i);
      const m = document.getElementById('inp_ps_m_'+si+'_'+i);
      const sv = document.getElementById('inp_ps_s_'+si+'_'+i);
      if (r) sim.r = parseInt(r.value)||sim.r;
      if (x) sim.x = parseInt(x.value)||sim.x;
      if (m) sim.m = parseInt(m.value)||sim.m;
      if (sv) sim.s = parseInt(sv.value)||sim.s;
    });
  });

  if (!_planSessions.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    if (chartSec) chartSec.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (addBtn) addBtn.style.display = '';

  const ml = {fortime:'For Time', amrap:'AMRAP', emom:'EMOM', tabata:'Tabata'};
  listEl.innerHTML = _planSessions.map((s, si) => {
    const blockSummary = (s.blocks||[]).map(b => ml[b.mode]||b.mode).join(' + ');
    const simBlocks = (s.blocks||[]).map((b, i) => {
      const sim = s.simResults[i] || {r:1, x:0, m:5, s:0};
      const mode = b.mode || 'fortime';
      const isForTime = mode === 'fortime';
      const isAmrap = mode === 'amrap';
      const isEmom = mode === 'emom';
      const isFixed = mode === 'tabata'; // only tabata has truly fixed results
      let modeSummary = '';
      if (mode==='amrap') modeSummary = b.dur+'m · Target: '+b.target+' rounds';
      else if (mode==='fortime') modeSummary = b.cap+'m cap · '+b.target+' rounds';
      else if (mode==='emom') modeSummary = b.totalInt+'\xd7'+b.int+'s';
      else if (mode==='tabata') modeSummary = b.tabR+' rounds '+b.work+'s/'+b.rest+'s';
      const mvLines = (b.movements||[]).map(mv => {
        const wtType = mv.wtLadderType || 'fixed';
        const wtInc  = parseFloat(mv.wtLadderInc) || 5;
        const baseWt = parseFloat(mv.kg) || 0;
        const rounds = parseInt(sim.r) || parseInt(b.target) || 1;
        let wtDesc = baseWt > 0 ? ' @ '+mv.kg+' kg' : '';
        if (wtType !== 'fixed' && baseWt > 0 && rounds > 0) {
          const half = Math.ceil(rounds / 2);
          const wts = [];
          for (let i = 0; i < rounds; i++) {
            if (wtType === 'ascending')   wts.push(Math.round((baseWt + wtInc * i) * 10)/10);
            else if (wtType === 'descending') wts.push(Math.round((baseWt - wtInc * i) * 10)/10);
            else if (wtType === 'pyramid') wts.push(i < half ? Math.round((baseWt + wtInc * i)*10)/10 : Math.round((baseWt + wtInc*(rounds-i-1))*10)/10);
            else if (wtType === 'valley')  wts.push(i < half ? Math.round((baseWt - wtInc * i)*10)/10 : Math.round((baseWt - wtInc*(rounds-i-1))*10)/10);
          }
          wtDesc = ' @ ' + wts.join('→') + ' kg';
        }
        // Rep description — handle block ladder and per-movement rep schemes
        const blockLadder = b.ladderType || 'fixed';
        let repsDesc = mv.reps + ' reps';
        if (mv.repsOverride === '1' || mv.repsOverride === 1) {
          const repsScheme = mv.repsScheme || 'fixed';
          const repsInc = parseInt(mv.repsInc) || 0;
          const baseReps = parseInt(mv.reps) || 0;
          if (repsScheme !== 'fixed' && repsInc > 0 && rounds > 1) {
            const endReps = repsScheme === 'ascending'
              ? baseReps + repsInc * (rounds - 1)
              : baseReps - repsInc * (rounds - 1);
            const arrow = repsScheme === 'ascending' ? '↑' : '↓';
            repsDesc = baseReps + arrow + endReps + ' reps';
          }
        } else if (blockLadder !== 'fixed' && rounds > 1) {
          const ladderStart = parseInt(b.ladderStart) || parseInt(mv.reps) || 1;
          const ladderInc   = parseInt(b.ladderInc)   || 1;
          const half = Math.ceil(rounds / 2);
          const repsList = [];
          for (let ri = 0; ri < rounds; ri++) {
            if (blockLadder === 'ascending')   repsList.push(ladderStart + ladderInc * ri);
            else if (blockLadder === 'descending') repsList.push(ladderStart - ladderInc * ri);
            else if (blockLadder === 'pyramid') repsList.push(ri < half ? ladderStart + ladderInc * ri : ladderStart + ladderInc * (rounds - ri - 1));
            else if (blockLadder === 'valley')  repsList.push(ri < half ? ladderStart - ladderInc * ri : ladderStart - ladderInc * (rounds - ri - 1));
          }
          repsDesc = repsList.join('→') + ' reps';
        }
        return `<div style="font-size:.68rem;color:var(--label);padding:1px 0;">${mv.name} &mdash; ${repsDesc}${wtDesc}</div>`;
      }).join('');
      const rid = 'ps_r_'+si+'_'+i;
      const xid = 'ps_x_'+si+'_'+i;
      const mid = 'ps_m_'+si+'_'+i;
      const sid2= 'ps_s_'+si+'_'+i;
      const inp = (id,val,valsArr,lbl) => {
        // makePicker uses first param as class — also add explicit id via extraAttrs
        const html2 = makePicker(id, val, valsArr, lbl, `id="inp_${id}"`);
        return `<div class="field-stack"><label style="font-size:.65rem;">${lbl}</label>${html2}</div>`;
      };
      return `<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
        <div style="font-size:.7rem;font-weight:900;color:var(--brand);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Block ${i+1} &mdash; ${ml[mode]||mode} &middot; ${modeSummary}</div>
        ${mvLines?`<div style="margin-bottom:8px;padding:5px 8px;background:var(--surface);border-radius:6px;">${mvLines}</div>`:''}
        <div style="display:grid;grid-template-columns:${(isFixed)?'1fr':'1fr 1fr'};gap:8px;">
          ${!isFixed ? inp(rid, sim.r, VALS.rounds, t('result.rounds.done')) : ''}
          ${(isAmrap||isForTime) ? inp(xid, sim.x, VALS.reps, 'Extra Reps') : ''}
          ${isForTime? inp(mid, sim.m, VALS.finMin, 'Final Time — Minutes') + inp(sid2, sim.s, VALS.finSec, 'Final Time — Seconds') : ''}
        </div>
      </div>`;
    }).join('');

    const physicsRow = s.pd !== null
      ? `<div class="plan-session-physics" style="margin-bottom:8px;">
          <div class="plan-session-metric"><div class="plan-session-metric-val">${s.pd}</div><div class="plan-session-metric-lbl">W/kg</div></div>
          <div class="plan-session-metric"><div class="plan-session-metric-val">${s.wd}</div><div class="plan-session-metric-lbl">kJ</div></div>
          <div class="plan-session-metric"><div class="plan-session-metric-val">${s.mc}</div><div class="plan-session-metric-lbl">kcal</div></div>
          <div class="plan-session-metric"><div class="plan-session-metric-val">${s.fb}</div><div class="plan-session-metric-lbl">Bias</div></div>
          ${s.rl > 0 ? `<div class="plan-session-metric"><div class="plan-session-metric-val">${s.rl}%</div><div class="plan-session-metric-lbl">RL</div></div>` : ''}
          <div class="plan-session-metric"><div class="plan-session-metric-val">${s.td||'—'}</div><div class="plan-session-metric-lbl">TD</div></div>
        </div>` : '';

    return `<div class="plan-session-card" id="card_${s.id}">
      <div class="plan-session-header">
        <div>
          <div class="plan-session-name">${s.name}</div>
          <div class="plan-session-meta">${s.date} &middot; ${blockSummary}</div>
        </div>
        <button onclick="removePlanSession('${s.id}')" style="background:none;border:none;color:var(--danger);font-size:1rem;cursor:pointer;">&#x2715;</button>
      </div>
      ${physicsRow}
      <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:.68rem;font-weight:900;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Estimated Results</div>
        ${simBlocks}
        <div style="margin-top:10px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <span style="font-size:.68rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;">${t('plan.rpe.title')}</span>
            <span id="plan_rpe_val_${si}" style="font-size:.9rem;font-weight:900;color:${RPE_COLORS[s.predictedRpe||5]||'#9CA3AF'};">${s.predictedRpe||5}</span>
          </div>
          <div style="font-size:.62rem;color:var(--label);margin-bottom:6px;">${t('plan.rpe.sub')}</div>
          <input type="range" id="inp_ps_rpe_${si}" min="1" max="10" value="${s.predictedRpe||5}" style="width:100%;"
            oninput="_updatePlanRpeDisplay(${si},this.value)">
        </div>
        <button class="btn btn-primary" onclick="collectAndSimulate(${si},'${s.id}')" style="width:100%;margin-top:4px;font-size:.76rem;">&#x26a1; Calculate</button>
      </div>
    </div>`;
  }).join('');
  // Wire plan pickers using si (session index) + block index
  _planSessions.forEach((s, si) => {
    (s.blocks||[]).forEach((b, i) => {
      const sim = s.simResults[i];
      const mode = b.mode||'fortime';
      [
        {id:'ps_r_'+si+'_'+i, key:'r'},
        {id:'ps_x_'+si+'_'+i, key:'x'},
        {id:'ps_m_'+si+'_'+i, key:'m'},
        {id:'ps_s_'+si+'_'+i, key:'s'},
      ].forEach(({id, key}) => {
        const inp2 = document.getElementById('inp_'+id);
        if (!inp2) return;
        const trig = inp2.closest('.picker-trigger');
        if (!trig) return;
        trig.onclick = function() {
          openPickerWithCallback(this, (val) => {
            sim[key] = val;
            inp2.value = val;
            this.querySelector('.picker-trigger-val').textContent = formatPickerVal(val, trig.dataset.label);
          });
        };
      });
    });
  });
  renderProjectedChart();
}

function _updatePlanRpeDisplay(si, val) {
  val = parseInt(val);
  const session = _planSessions[si];
  if (session) session.predictedRpe = val;
  const disp = document.getElementById('plan_rpe_val_' + si);
  if (disp) { disp.innerText = val; disp.style.color = RPE_COLORS[val] || '#9CA3AF'; }
}

function collectAndSimulate(si, id) {
  const session = _planSessions.find(s => s.id === id);
  if (!session) return;
  (session.blocks||[]).forEach((b,i) => {
    const sim = session.simResults[i]; if (!sim) return;
    const r = document.getElementById('inp_ps_r_'+si+'_'+i);
    const x = document.getElementById('inp_ps_x_'+si+'_'+i);
    const m = document.getElementById('inp_ps_m_'+si+'_'+i);
    const s = document.getElementById('inp_ps_s_'+si+'_'+i);
    if (r) sim.r = parseInt(r.value)||1;
    if (x) sim.x = parseInt(x.value)||0;
    if (m) sim.m = parseInt(m.value)||0;
    if (s) sim.s = parseInt(s.value)||0;
  });
  simulatePlanSession(id);
}

function renderProjectedRecovery() {
  const simulated = _planSessions.filter(s => s.pd !== null);
  const recEl = document.getElementById('plan-projected-recovery');
  if (!recEl) return;
  if (!simulated.length) { recEl.style.display = 'none'; return; }
  recEl.style.display = '';

  const now = Date.now();
  const lastSession = simulated[simulated.length - 1];
  const lastDate = new Date(lastSession.date + 'T12:00:00');
  const lastMs = lastDate.getTime();

  // ── Projected Neural ────────────────────────────────────────────────────
  // Find all planned sessions with RL ≥ 70% — group by pattern
  const neuralMap = {};
  simulated.forEach(s => {
    const rl = parseFloat(s.rl) || 0;
    if (rl < 70 || !s.peakPattern) return;
    const sessionMs = new Date(s.date + 'T12:00:00').getTime();
    const baseH = rl >= 90 ? 72 : rl >= 75 ? 48 : 36;
    const readyAt = sessionMs + baseH * 3600000;
    if (!neuralMap[s.peakPattern] || readyAt > neuralMap[s.peakPattern].readyAt) {
      neuralMap[s.peakPattern] = { readyAt, peakName: s.peakName, rl };
    }
  });

  const neuralEl = document.getElementById('plan-projected-neural');
  if (neuralEl) {
    // Show patterns still recovering at plan end date, not patterns recovering now
    const active = Object.entries(neuralMap).filter(([,v]) => v.readyAt > lastMs);
    if (active.length > 0) {
      neuralEl.innerHTML = active.map(([pattern, {readyAt, peakName}]) => {
        const remainH = Math.ceil((readyAt - lastMs) / 3600000);
        const color = remainH > 48 ? '#EF4444' : '#F59E0B';
        const readyDate = new Date(readyAt);
        const readyStr = fmtDate(readyDate,{weekday:'short',day:'numeric',month:'short'})
                       + ' ' + t('hist.modal.at') + ' ' + fmtTime(readyDate,{hour:'2-digit',minute:'2-digit'});
        // Progress bar: 0% since this is a future planned session window
        const pct = 0;
        return `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-left:3px solid ${color};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
          <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--label);margin-bottom:4px;">📅 ${t('rec.neural.title')} — ${t('plan.projected')}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:.75rem;font-weight:800;color:${color};">⏱️ ${peakName ? peakName + ' · ' : ''}${getPatternLabel(pattern)}</div>
            <div style="font-size:.8rem;font-weight:900;color:${color};">${remainH}h remaining</div>
          </div>
          <div style="background:rgba(128,128,128,.2);border-radius:4px;height:4px;margin-bottom:6px;overflow:hidden;">
            <div style="background:${color};height:100%;width:${pct.toFixed(0)}%;border-radius:4px;"></div>
          </div>
          <div style="font-size:.7rem;color:var(--label);">Ready: <strong style="color:var(--text);">${readyStr}</strong></div>
        </div>`;
      }).join('');
    } else {
      neuralEl.innerHTML = '';
    }
  }

  // ── Projected Structural ────────────────────────────────────────────────
  // Variable half-life based on mc_mech intensity (kcal/min/kg) — matches getStructuralFatigue
  const halfLifeDaysProjFn = mc_int => {
    if (mc_int > 0.06)  return 3;
    if (mc_int > 0.04)  return 2;
    if (mc_int > 0.025) return 1.5;
    if (mc_int > 0.01)  return 1;
    return 0.5;
  };
  // Start from current RAW structural fatigue (not normalised %)
  const currentStruct = getStructuralFatigue();
  let projFatigue = currentStruct ? currentStruct.rawFatigue : 0;
  const maxLoad = currentStruct ? (currentStruct.calibML || currentStruct.maxLoad) : 1;

  // Decay current fatigue to end of plan date using avg 48h half-life for projection
  const K48proj = Math.pow(0.5, 1/2);
  const daysCurrentToEnd = (lastMs - now) / 86400000;
  projFatigue = projFatigue * Math.pow(K48proj, daysCurrentToEnd);

  // Add planned sessions' structural load using mc_mech model
  const currentBwProj = parseFloat(document.getElementById('global-w')?.value) || 75;
  simulated.forEach(s => {
    const sessionMs = new Date(s.date + 'T12:00:00').getTime();
    const daysToEnd = Math.max(0, (lastMs - sessionMs) / 86400000);
    const bw      = parseFloat(s.bw)      || currentBwProj;
    const mc_mech = parseFloat(s.mc_mech) || 0;
    if (mc_mech <= 0) return;
    const dur = (s.simResults||[]).reduce((t,r) => t + (r.m||0) + (r.s||0)/60, 0) || 15;
    const intensity = mc_mech / dur / bw;
    const structLoad = (mc_mech / bw) * 1000;
    const Kproj = Math.pow(0.5, 1 / halfLifeDaysProjFn(intensity));
    projFatigue += structLoad * Math.pow(Kproj, daysToEnd);
  });

  // Normalise using same reference as current
  const hist = getHistory();
  const projFatPct = Math.min(100, Math.round((projFatigue / maxLoad) * 100));
  const projCharged = 100 - projFatPct;
  const projStatus = projCharged >= 60 ? 'ready' : projCharged >= 40 ? 'moderate' : projCharged >= 20 ? 'fatigued' : 'overreached';
  const structColor = projStatus === 'ready' ? '#22C55E' : projStatus === 'moderate' ? '#F59E0B' : '#EF4444';

  const structEl = document.getElementById('plan-projected-structural');
  if (structEl) {
    const segments = 10;
    const filledSegs = Math.round((projCharged / 100) * segments);
    const batterySegs = Array.from({length:segments}, (_,i) => {
      const filled = i < filledSegs;
      return '<div style="flex:1;height:14px;border-radius:2px;background:'+(filled?structColor:'rgba(128,128,128,0.15)')+';margin-right:'+(i<segments-1?'2px':'0')+'px;"></div>';
    }).join('');

    structEl.innerHTML = `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-left:3px solid ${structColor};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--label);">📅 ${t('rec.structural.label')} — ${t('plan.projected')}</div>
        <div style="font-size:.8rem;font-weight:900;color:${structColor};">${projCharged}% ${t('rec.charged')}</div>
      </div>
      <div style="display:flex;gap:3px;margin-bottom:6px;">${batterySegs}</div>
      <div style="font-size:.7rem;color:var(--label);">${t('rec.'+projStatus)}</div>
    </div>`;
  }

  // ── Projected Recovery Lights ───────────────────────────────────────────
  const lightsEl = document.getElementById('plan-projected-lights');
  if (lightsEl) {
    // Aerobic — add simulated sessions to history and recalculate
    // This matches exactly what calcTrainingLoad produces after saving
    const simulatedAsHistory = simulated.map(s => ({
      date: s.date,
      mc:          s.mc,
      mc_aero:     s.mc_aero,
      mc_overhead: s.mc_overhead,
      mc_mech:     s.mc_mech,
      wd:          s.wd,
      pd:          s.pd,
      bw:          s.bw || currentBwProj,
      // Copy simResults into blocks[].result so getSessionDuration reads correct duration
      blocks: (s.blocks||[]).map((b, i) => ({
        ...b,
        result: s.simResults?.[i] ? { m: s.simResults[i].m||0, s: s.simResults[i].s||0 } : null
      })),
      simResults: s.simResults
    }));
    const projTlResult = calcTrainingLoad([...hist, ...simulatedAsHistory]);
    let projCTL = projTlResult ? projTlResult.ctl : 0;
    let projATL = projTlResult ? projTlResult.atl : 0;
    const projRatio = projCTL > 0 ? projATL / projCTL : 1;
    const RED='#EF4444',AMBER='#F59E0B',GREEN='#22C55E',DIM='rgba(128,128,128,0.15)';

    // Use getTrainingStatus for projected state — same blended thresholds as main Analytics view
    const projTl = {
      ctl: projCTL, atl: projATL, tsb: projRatio,
      tsbHistory: projTlResult ? projTlResult.tsbHistory : [],
      sessionCount: hist.filter(w => w.pd && parseFloat(w.pd) > 0).length
    };
    const projTlGoal = document.getElementById('global-goal')?.value || 'conditioning';
    const projStatus_tsb = getTrainingStatus(projTl, projTlGoal);
    const projTsbStatus = projStatus_tsb.status;

    // Map five TSB states to three-light
    const tsbToLight = { overreaching:'fatigued', fatigued:'moderate', neutral:'ready', peaking:'ready', detraining:'moderate' };
    const aerobicStatus = tsbToLight[projTsbStatus] || 'ready';
    const aerobicStateLabel = t('tsb.' + projTsbStatus);
    const aerobicLabelColor = aerobicStatus==='fatigued'?RED:aerobicStatus==='moderate'?AMBER:GREEN;
    const neuralMaxRemaining = Object.values(neuralMap).reduce((max, v) => {
      const h = Math.ceil((v.readyAt - lastMs) / 3600000);
      return h > max ? h : max;
    }, 0);
    const neuralStatus = neuralMaxRemaining > 48 ? 'fatigued' : neuralMaxRemaining > 0 ? 'moderate' : 'ready';
    const structStatus = projStatus;
    const nC = neuralStatus==='fatigued'?RED:neuralStatus==='moderate'?AMBER:GREEN;
    const sC = structStatus==='overreached'?RED:structStatus==='fatigued'?RED:structStatus==='moderate'?AMBER:GREEN;

    const dot=(c,active)=>'<div style="width:18px;height:18px;border-radius:50%;background:'+(active?c:DIM)+';margin:0 auto 4px;'+(active?'box-shadow:0 0 10px '+c+',0 0 20px '+c+'55;':'')+'"></div>';
    const isDetraining = projTsbStatus === 'detraining';
    const isPeaking = projTsbStatus === 'peaking';
    const aerobicHTML = '<div style="text-align:center;">'
      + (isDetraining
          ? '<div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div class="tl-dot-detraining" style="width:18px;height:18px;border-radius:50%;background:#22C55E;box-shadow:0 0 8px #22C55E88;margin:0 auto 4px;"></div><div style="height:6px;"></div>'
          : isPeaking
          ? '<div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div class="tl-dot-peaking" style="width:18px;height:18px;border-radius:50%;background:rgba(128,128,128,0.15);margin:0 auto 4px;"></div><div style="height:6px;"></div>'
          : dot(RED,aerobicStatus==='fatigued')+dot(AMBER,aerobicStatus==='moderate')+dot(GREEN,aerobicStatus==='ready')+'<div style="height:6px;"></div>')
      + '<div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.aerobic')+'</div>'
      + '<div style="font-size:.66rem;color:'+aerobicLabelColor+';font-weight:600;">'+aerobicStateLabel+'</div></div>';
    // Neural: multi-state — green if any pattern clear, amber pulse if any ≤48h, red pulse if any >48h
    const ALL_PATTERNS_KEYS_P = ['pattern.squat','pattern.hinge','pattern.push','pattern.pull','pattern.olympic'];
    const safeNeuralMapP = neuralMap || {};
    const neuralHasGreenP = ALL_PATTERNS_KEYS_P.some(p => !safeNeuralMapP[p] || safeNeuralMapP[p].readyAt <= lastMs);
    const neuralHasAmberP = Object.values(safeNeuralMapP).some(v => v.readyAt > lastMs && (v.readyAt - lastMs) <= 48*3600000);
    const neuralHasRedP   = Object.values(safeNeuralMapP).some(v => v.readyAt > lastMs && (v.readyAt - lastMs) > 48*3600000);
    const neuralDotsHtmlP = (neuralHasRedP   ? '<div class="tl-dot-red-pulse" style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>'     : dot(RED,false))
      + (neuralHasAmberP ? '<div class="tl-dot-amber-pulse" style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>' : dot(AMBER,false))
      + dot(GREEN, neuralHasGreenP);
    const neuralLabelColorP = neuralHasRedP ? RED : neuralHasAmberP ? AMBER : GREEN;
    const neuralStateLabelP = neuralHasRedP ? t('rec.fatigued') : neuralHasAmberP ? t('rec.moderate') : t('rec.ready');
    const neuralHTMLP = '<div style="text-align:center;">'+neuralDotsHtmlP+'<div style="height:6px;"></div><div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.neural')+'</div><div style="font-size:.66rem;color:'+neuralLabelColorP+';font-weight:600;">'+neuralStateLabelP+'</div></div>';

    // Structural: single status, red/black pulse for overreached
    const isOverreachedP = structStatus === 'overreached';
    const sAcP = isOverreachedP ? RED : structStatus==='fatigued' ? RED : structStatus==='moderate' ? AMBER : GREEN;
    const sDotsP = isOverreachedP
      ? '<div class="tl-dot-overreached" style="width:18px;height:18px;border-radius:50%;background:'+RED+';box-shadow:0 0 8px '+RED+'88;margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>'
      : dot(RED,structStatus==='fatigued')+dot(AMBER,structStatus==='moderate')+dot(GREEN,structStatus==='ready');
    const sLabelP = isOverreachedP ? t('rec.overreached') : t('rec.'+structStatus);
    const structuralHTMLP = '<div style="text-align:center;">'+sDotsP+'<div style="height:6px;"></div><div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.structural')+'</div><div style="font-size:.66rem;color:'+sAcP+';font-weight:600;">'+sLabelP+'</div></div>';

    const nonAerobic = neuralHTMLP + structuralHTMLP;

    // Per-component recs
    const recAerobic = t('rec.aerobic.' + projTsbStatus);
    const ALL_PATTERNS_REC = ['pattern.squat','pattern.hinge','pattern.push','pattern.pull','pattern.olympic'];
    const redPatternsP = [], amberPatternsP = [], greenPatternsP = [];
    ALL_PATTERNS_REC.forEach(p => {
      const v = neuralMap[p];
      if (!v || v.readyAt <= lastMs) { greenPatternsP.push(p); return; }
      const remainH = Math.ceil((v.readyAt - lastMs) / 3600000);
      if (remainH > 48) redPatternsP.push({ p, remainH }); else amberPatternsP.push({ p, remainH });
    });
    const neuralRowsP = [];
    if (!redPatternsP.length && !amberPatternsP.length) {
      neuralRowsP.push({ color: GREEN, text: t('rec.neural.ready') });
    } else {
      if (redPatternsP.length) {
        const maxH = Math.max(...redPatternsP.map(x => x.remainH));
        const labels = redPatternsP.map(x => getPatternLabel(x.p)).join(', ');
        neuralRowsP.push({ color: RED, text: t('rec.neural.avoid') + ' ' + labels + ' · ' + t('rec.neural.fully.ready') + ' ' + maxH + 'h' });
      }
      if (amberPatternsP.length) {
        const maxH = Math.max(...amberPatternsP.map(x => x.remainH));
        const labels = amberPatternsP.map(x => getPatternLabel(x.p)).join(', ');
        neuralRowsP.push({ color: AMBER, text: t('rec.neural.light.ok') + ' ' + labels + ' ' + t('rec.neural.light.ok.now') + ' · ' + t('rec.neural.fully.ready') + ' ' + maxH + 'h' });
      }
      if (greenPatternsP.length) {
        const labels = greenPatternsP.map(getPatternLabel).join(', ');
        neuralRowsP.push({ color: GREEN, text: labels + ' — ' + t('rec.ready') });
      }
    }
    const structCharged = currentStruct ? currentStruct.charged : 0;
    const recStructural = structStatus==='ready' ? t('rec.structural.ready')
      : structStatus==='moderate' ? t('rec.lights.struct.amber').replace('{pct}', structCharged)
      : structStatus==='overreached' ? t('rec.lights.struct.overreached')
      : t('rec.lights.struct.red');

    lightsEl.innerHTML = `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px;">
      <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--label);margin-bottom:12px;">📅 ${t('rec.summary.title')} — ${t('plan.projected')}</div>
      <div style="display:flex;align-items:flex-start;justify-content:space-around;padding:8px 0;margin-bottom:10px;">${aerobicHTML+nonAerobic}</div>
      <div style="height:1px;background:rgba(255,255,255,.06);margin-bottom:10px;"></div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
        <div style="font-size:.72rem;font-weight:800;min-width:72px;padding-top:1px;flex-shrink:0;color:${aerobicLabelColor};">${t('rec.aerobic')}</div>
        <div style="font-size:.73rem;color:var(--text);line-height:1.5;">${recAerobic}</div>
      </div>
      ${neuralRowsP.map(row => `
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
        <div style="font-size:.72rem;font-weight:800;min-width:72px;padding-top:1px;flex-shrink:0;color:${row.color};">${t('rec.neural')}</div>
        <div style="font-size:.73rem;color:var(--text);line-height:1.5;">${row.text}</div>
      </div>`).join('')}
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:.72rem;font-weight:800;min-width:72px;padding-top:1px;flex-shrink:0;color:${sC};">${t('rec.structural')}</div>
        <div style="font-size:.73rem;color:var(--text);line-height:1.5;">${recStructural}</div>
      </div>
    </div>`;
  }
}

function renderProjectedChart() {
  const chartSec = document.getElementById('plan-chart-section');
  const simulated = _planSessions.filter(s => s.pd !== null);
  if (!simulated.length) { if (chartSec) chartSec.style.display = 'none'; return; }
  if (chartSec) chartSec.style.display = '';
  const currentBwProj = parseFloat(document.getElementById('global-w')?.value) || 75;

  // Build combined history + projected data using calcTrainingLoad for consistency
  const history = getHistory();
  const tl = calcTrainingLoad(history);
  if (!tl) return;

  // Add simulated sessions to history for accurate CTL/ATL projection
  const simulatedAsHistory = simulated.map(s => ({
    date:        s.date,
    mc:          s.mc,
    mc_aero:     s.mc_aero,
    mc_overhead: s.mc_overhead,
    mc_mech:     s.mc_mech,
    wd:          s.wd,
    pd:          s.pd,
    bw:          s.bw || currentBwProj,
    blocks:      (s.blocks||[]).map((b,i) => ({
      ...b,
      result: s.simResults?.[i] ? { m: s.simResults[i].m||0, s: s.simResults[i].s||0 } : null
    })),
    simResults:  s.simResults
  }));
  const tlWithSim = calcTrainingLoad([...history, ...simulatedAsHistory]) || tl;

  // Start from current CTL/ATL (without sim) for chart — show both historical and projected
  let ctl = tl.ctl, atl = tl.atl;
  const kCTL = 1-Math.exp(-1/42), kATL = 1-Math.exp(-1/7);

  // Build future day map from plan sessions — for chart projection line
  const futureMap = {};
  simulated.forEach(s => {
    const parts = s.date.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const bw          = parseFloat(s.bw)          || currentBwProj;
    const mc_overhead = parseFloat(s.mc_overhead) || 0;
    const mc_aero     = parseFloat(s.mc_aero)     || 0;
    const mc          = parseFloat(s.mc)           || 0;
    const kj          = parseFloat(s.wd)           || 0;
    const aerobic = mc_overhead > 0 || mc_aero > 0
      ? (mc_aero + mc_overhead)
      : mc > 0 ? mc : 0;
    const load = aerobic > 0 ? (aerobic / bw) * 1000 : kj > 0 ? (kj / bw) * 1000 : (parseFloat(s.pd)||0) * 1000;
    futureMap[k] = (futureMap[k]||0) + load;
  });

  // Project forward from today to last plan date
  const today = new Date(); today.setHours(0,0,0,0);
  const lp = simulated[simulated.length-1].date.split('-');
  const lastDate = new Date(parseInt(lp[0]), parseInt(lp[1])-1, parseInt(lp[2]));
  lastDate.setHours(0,0,0,0);
  const projDays = Math.round((lastDate - today)/86400000) + 1;

  const projData = [];
  const baseDayIndex = tl.lastDayIndex || 0;
  for (let i = 0; i <= projDays; i++) {
    const d = new Date(today); d.setDate(today.getDate()+i);
    const k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const load = futureMap[k] || 0;
    ctl = ctl + kCTL*(load-ctl); atl = atl + kATL*(load-atl);
    projData.push({date:k, ctl:+ctl.toFixed(1), atl:+atl.toFixed(1), tsb:ctl>0?+(atl/ctl).toFixed(2):1});
  }

  // Combine historical + projected for chart
  const histData = tl.chartData;
  const allLabels = [...histData.map(d=>d.date), ...projData.map(d=>d.date)];
  const histLen = histData.length;

  const isDark = document.body.classList.contains('dark');
  const gc = isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.05)', lc = isDark?'#9CA3AF':'#6B7280';

  // Summary cards — runs regardless of chart canvas availability
  const endTl = projData[projData.length-1];
  if (endTl) {
    // Use calcTrainingLoad with simulated sessions for accurate CTL/ATL/Form
    const endTlObj = {
      ctl: tlWithSim.ctl, atl: tlWithSim.atl, tsb: tlWithSim.tsb,
      tsbHistory: tlWithSim.tsbHistory || [],
      sessionCount: history.filter(w => w.pd && parseFloat(w.pd) > 0).length
    };
    const endTlStatus = getTrainingStatus(endTlObj, document.getElementById('global-goal')?.value || 'conditioning');
    const tsbCol = endTlStatus.color;
    const endCtl = Math.round(tlWithSim.ctl);
    const endAtl = Math.round(tlWithSim.atl);
    const endTsb = (+tlWithSim.tsb).toFixed(1);
    const cards = document.getElementById('plan-summary-cards');
    if (cards) cards.innerHTML = `
      <div class="plan-proj-card" style="border-color:#3B82F640;">
        <div class="plan-proj-lbl">Fitness</div>
        <div class="plan-proj-val" style="color:#3B82F6;">${endCtl}</div>
        <div style="font-size:.6rem;color:var(--label);">CTL</div>
      </div>
      <div class="plan-proj-card" style="border-color:#F59E0B40;">
        <div class="plan-proj-lbl">Fatigue</div>
        <div class="plan-proj-val" style="color:#F59E0B;">${endAtl}</div>
        <div style="font-size:.6rem;color:var(--label);">ATL</div>
      </div>
      <div class="plan-proj-card" style="border-color:${tsbCol}40;">
        <div class="plan-proj-lbl">Form</div>
        <div class="plan-proj-val" style="color:${tsbCol};">${endTsb}</div>
        <div style="font-size:.6rem;color:var(--label);">TSB</div>
      </div>`;
    const txt = document.getElementById('plan-summary-text');
    if (txt) {
      const change = endCtl - tl.ctl;
      const sign = change >= 0 ? '+' : '';
      const tsbState = endTlStatus.status === 'overreaching' ? '🔴 Overreaching at end of plan — add a rest day.'
        : endTlStatus.status === 'fatigued' ? '🟠 Fatigued at end of plan — consider reducing the last session.'
        : endTlStatus.status === 'detraining' ? '💚 Detraining risk — consider adding a session.'
        : endTlStatus.status === 'peaking' ? '🟢 Peaking at end of plan — good time for a max effort.'
        : '🟢 Balanced at end of plan — ready to train.';
      txt.innerHTML = `At the end of your plan (${simulated[simulated.length-1].date}):<br><br>
        Fitness ${sign}${change} from today's ${tl.ctl}.<br>
        ${tsbState}`;
    }
  }

  requestAnimationFrame(() => {
    const canvas = document.getElementById('chart-plan-load'); if (!canvas) return;
    if (_planChart) { try { _planChart.destroy(); } catch(e){} }

    const fmtLabel = d => { const dt=new Date(d); return (dt.getMonth()+1)+'/'+dt.getDate(); };

    _planChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: allLabels.map(fmtLabel),
        datasets: [
          // Historical — solid
          {label:'CTL', data:[...histData.map(d=>d.ctl), ...Array(projData.length).fill(null)], borderColor:'#3B82F6', borderWidth:2, pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y'},
          {label:'ATL', data:[...histData.map(d=>d.atl), ...Array(projData.length).fill(null)], borderColor:'#F59E0B', borderWidth:2, pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y'},
          {label:'TSB', data:[...histData.map(d=>d.tsb), ...Array(projData.length).fill(null)], borderColor:'#22C55E', borderWidth:1.5, pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y2'},
          // Bridge point — connect history to projection
          {label:'CTL proj', data:[...Array(histLen-1).fill(null), histData[histLen-1]?.ctl, ...projData.map(d=>d.ctl)], borderColor:'#3B82F6', borderWidth:2, borderDash:[6,4], pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y'},
          {label:'ATL proj', data:[...Array(histLen-1).fill(null), histData[histLen-1]?.atl, ...projData.map(d=>d.atl)], borderColor:'#F59E0B', borderWidth:2, borderDash:[6,4], pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y'},
          {label:'TSB proj', data:[...Array(histLen-1).fill(null), histData[histLen-1]?.tsb, ...projData.map(d=>d.tsb)], borderColor:'#22C55E', borderWidth:1.5, borderDash:[4,3,1,3], pointRadius:0, tension:0.4, spanGaps:false, yAxisID:'y2'},
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{
          x:{grid:{color:gc},ticks:{color:lc,font:{size:9},maxTicksLimit:8}},
          y:{grid:{color:gc},ticks:{color:lc,font:{size:9}},position:'left'},
          y2:{grid:{display:false},border:{display:false},ticks:{color:'#22C55E99',font:{size:9}},position:'right',min:0,max:3}
        }
      }
    });

  });
}
