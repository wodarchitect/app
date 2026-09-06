/* ════════════════════════════════════════════════════
   ANALYTICS
   Chart.js chart rendering (Power Scatter, radar, E1RM,
   insight cards), training load / recovery status
   (Banister model, structural fatigue), the 6-week
   Session Signature radar, and the fullscreen chart modal.
════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════
   ANALYTICS SCREEN — Chart.js charts
════════════════════════════════════════════════════ */
let chartInstances = {};

// ── Rounded bar plugin for Chart.js 4 ──
// Draws all bar segments with rounded corners on all four sides
const roundedBarPlugin = {
  id: 'roundedBars',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'bar') return;
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach(bar => {
        const r = 4;
        const { x, y, base, width } = bar.getProps(['x','y','base','width'], true);
        const left   = x - width / 2;
        const right  = x + width / 2;
        const top    = Math.min(y, base);
        const bottom = Math.max(y, base);
        const h = bottom - top;
        const w = right - left;
        if (h <= 0 || w <= 0) return;
        const rad = Math.min(r, h / 2, w / 2);
        ctx.save();
        ctx.fillStyle = bar.options.backgroundColor;
        ctx.beginPath();
        ctx.moveTo(left + rad, top);
        ctx.lineTo(right - rad, top);
        ctx.quadraticCurveTo(right, top, right, top + rad);
        ctx.lineTo(right, bottom - rad);
        ctx.quadraticCurveTo(right, bottom, right - rad, bottom);
        ctx.lineTo(left + rad, bottom);
        ctx.quadraticCurveTo(left, bottom, left, bottom - rad);
        ctx.lineTo(left, top + rad);
        ctx.quadraticCurveTo(left, top, left + rad, top);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    });
  }
};
if (typeof Chart !== 'undefined') Chart.register(roundedBarPlugin);
let _fsChartInstance = null;  // fullscreen chart
let _fsChartData = null;      // saved config for fullscreen re-render

function destroyCharts() {
  // Preserve biasPie — it lives on the analytics screen and is only
  // rebuilt by renderMovementPatternProfile (called after Calculate Physics).
  // Destroying it here means it never comes back when switching tabs.
  Object.entries(chartInstances).forEach(([key, c]) => {
    if (key === 'biasPie' || key === 'trainingLoad') return;
    try { c.destroy(); } catch(e) {}
    delete chartInstances[key];
  });
}

function calcTrainingLoad(history) {
  if (!history.length) return null;
  const sorted = [...history].filter(w => w.date && (w.pd || w.wd || w.mc)).sort((a,b) => new Date(a.date)-new Date(b.date));
  if (!sorted.length) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const currentBw = parseFloat(document.getElementById('global-w')?.value) || 75;

  // ── Per-session duration: actual from blocks.result, fallback derived from wd/pd ──
  function getSessionDuration(w) {
    // Plan sessions: simResults has user-entered timing — takes priority over blocks[].result
    // which may contain stale cap/default values
    const fromSim = (w.simResults||[]).reduce((s,r) => s + (r.m||0) + (r.s||0)/60, 0);
    if (fromSim > 0) return fromSim;
    // Saved sessions: use actual timer result stored in blocks[].result
    const actual = (w.blocks||[]).reduce((s,b) => s + (b.result ? (b.result.m||0) + (b.result.s||0)/60 : 0), 0);
    if (actual > 0) return actual;
    const pd = parseFloat(w.pd)||0, wd = parseFloat(w.wd)||0, bw = parseFloat(w.bw)||currentBw;
    return pd > 0 && wd > 0 ? (wd*1000)/(pd*bw*60) : 0;
  }

  // ── Group by day: separate cardio (mc_aero), mixed (mc_overhead) ──────
  const dayMap = {};
  sorted.forEach(w => {
    const d = new Date(w.date); d.setHours(0,0,0,0);
    const k = localDateStr(d);
    const bw          = parseFloat(w.bw)          || currentBw;
    const mc_aero     = parseFloat(w.mc_aero)     || 0;
    const mc_overhead = parseFloat(w.mc_overhead) || 0;
    const mc          = parseFloat(w.mc)           || 0;
    const dur = getSessionDuration(w);
    if (!dayMap[k]) dayMap[k] = {
      cardioLoad:0, cardioInt:0, hasCardio:false,
      mixedLoad:0,  mixedInt:0,  hasMixed:false
    };
    const dm = dayMap[k];
    // Cardio aerobic: mc_aero
    if (mc_aero > 0) {
      dm.cardioLoad += (mc_aero / bw) * 1000;
      dm.cardioInt  += dur > 0 ? mc_aero / dur / bw : 0;
      dm.hasCardio   = true;
    }
    // Mixed aerobic: mc_overhead
    if (mc_overhead > 0) {
      dm.mixedLoad += (mc_overhead / bw) * 1000;
      dm.mixedInt  += dur > 0 ? mc_overhead / dur / bw : 0;
      dm.hasMixed   = true;
    }
    // Legacy fallback: sessions without mc use wd-based load in mixed bucket
    if (mc === 0 && mc_aero === 0 && mc_overhead === 0) {
      const kj = parseFloat(w.wd) || 0;
      const pd = parseFloat(w.pd) || 0;
      const legacyLoad = kj > 0 ? (kj/bw)*1000 : pd*1000;
      dm.mixedLoad += legacyLoad;
      dm.mixedInt  += dur > 0 && legacyLoad > 0 ? legacyLoad / dur / 1000 : 0;
      dm.hasMixed   = true;
    }
  });

  const kCTL = 1-Math.exp(-1/42), kATL = 1-Math.exp(-1/7);
  // Seed CTL and ATL from average training day load ÷ 2
  // This gives Form ≈ 1.0 on the first session and converges to true CTL as history grows
  // Requires minimum 5 training days — chart hidden below this threshold
  const trainingDayLoads = Object.values(dayMap);
  const avgTrainingDayLoad = trainingDayLoads.length > 0
    ? trainingDayLoads.reduce((s,v) => s + v.cardioLoad + v.mixedLoad, 0) / trainingDayLoads.length
    : 0;
  const CTL_SEED = trainingDayLoads.length >= 5 ? Math.round(avgTrainingDayLoad / 2) : 0;
  let ctl = CTL_SEED, atl = CTL_SEED;
  const firstDate = new Date(sorted[0].date); firstDate.setHours(0,0,0,0);
  const days = Math.round((today - firstDate) / 86400000) + 1;
  const chartData = [], fullChartData = [], tsbHistory = [];

  // Separate rolling intensity histories — 28-day window, min 5 sessions each
  const cardioIntHistory = [], mixedIntHistory = [];
  const MIN_SESSIONS = 5, WINDOW_DAYS = 28;

  for (let i = 0; i <= days; i++) {
    const d = new Date(firstDate); d.setDate(firstDate.getDate() + i);
    const k = localDateStr(d);
    const dm = dayMap[k];
    let load = 0;
    if (dm) {
      let cardioAmp = 1, mixedAmp = 1;
      // Cardio intensity amplifier (mc_aero / duration / bw)
      if (dm.hasCardio && dm.cardioInt > 0) {
        const ws = i - WINDOW_DAYS;
        const rel = cardioIntHistory.filter(h => h.i > ws && h.i < i);
        if (rel.length >= MIN_SESSIONS) {
          const avg = rel.reduce((s,h)=>s+h.v,0) / rel.length;
          if (avg > 0) cardioAmp = dm.cardioInt / avg;
        }
        cardioIntHistory.push({i, v: dm.cardioInt});
      }
      // Mixed intensity amplifier (mc_overhead / duration / bw)
      if (dm.hasMixed && dm.mixedInt > 0) {
        const ws = i - WINDOW_DAYS;
        const rel = mixedIntHistory.filter(h => h.i > ws && h.i < i);
        if (rel.length >= MIN_SESSIONS) {
          const avg = rel.reduce((s,h)=>s+h.v,0) / rel.length;
          if (avg > 0) mixedAmp = dm.mixedInt / avg;
        }
        mixedIntHistory.push({i, v: dm.mixedInt});
      }
      load = dm.cardioLoad * cardioAmp + dm.mixedLoad * mixedAmp;
    }
    ctl = ctl + kCTL * (load - ctl);
    atl = atl + kATL * (load - atl);
    const ratio = ctl > 0 ? atl/ctl : 1;
    // fullChartData carries every day back to the athlete's very first
    // recorded session — chartData (last 42 days only) stays exactly as
    // it was, still used for the compact inline card. Only the
    // fullscreen chart uses fullChartData, so panning/zooming there can
    // actually reveal history beyond the initial 6-week view instead of
    // panning into empty space past the end of a truncated dataset.
    fullChartData.push({date:k, ctl:+ctl.toFixed(1), atl:+atl.toFixed(1), tsb:+ratio.toFixed(2)});
    if (i >= days-42) chartData.push({date:k, ctl:+ctl.toFixed(1), atl:+atl.toFixed(1), tsb:+ratio.toFixed(2)});
    tsbHistory.push(+ratio.toFixed(2));
  }
  const finalRatio = ctl > 0 ? +(atl/ctl).toFixed(1) : 1.0;
  return {ctl:+ctl.toFixed(0), atl:+atl.toFixed(0), tsb:finalRatio, chartData, fullChartData, tsbHistory, lastDayIndex:days, firstDateStr:localDateStr(firstDate), trainingDayCount:trainingDayLoads.length};
}

function getTrainingStatus(tl, goal) {
  const {ctl, atl, tsb} = tl;

  // ── Fixed ATL/CTL ratio thresholds ───────────────────────────────────
  // Scale-invariant: works at any CTL magnitude
  const thOver = 2.0;   // overreaching
  const thFat  = 1.4;   // fatigued/neutral boundary
  const thPeak = 0.8;   // neutral/peaking boundary
  const thDet  = 0.4;   // peaking/detraining boundary

  const ratio = ctl > 0 ? atl / ctl : 1;

  // ── Classify state ────────────────────────────────────────────────────
  let status, title, desc, color;
  if      (ratio > thOver) { status='overreaching'; title=t('tsb.overreaching'); color='#EF4444'; desc=t('tsb.overreaching.desc'); }
  else if (ratio > thFat)  { status='fatigued';     title=t('tsb.fatigued');     color='#F59E0B'; desc=t('tsb.fatigued.desc'); }
  else if (ratio < thDet)  { status='detraining';   title=t('tsb.detraining');   color='#F59E0B'; desc=t('tsb.detraining.desc'); }
  else if (ratio < thPeak) { status='peaking';      title=t('tsb.peaking');      color='#22C55E'; desc=t('tsb.peaking.desc'); }
  else                     { status='neutral';       title=t('tsb.neutral');      color='#22C55E'; desc=t('tsb.neutral.desc'); }

  // ── Traffic light dot HTML (single source of truth) ──────────────────
  const dotStyle = (status === 'detraining' || status === 'peaking')
    ? `width:18px;height:18px;border-radius:50%;background:#22C55E;box-shadow:0 0 10px #22C55E88;`
    : `width:18px;height:18px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color}88;`;
  const dotClass = status === 'detraining' ? ' tl-dot-detraining' : status === 'peaking' ? ' tl-dot-peaking' : '';
  const dotHTML = `<div class="tl-dot${dotClass}" style="${dotStyle}"></div>`;

  // ── Aerobic state rec — purely cardiovascular, no goal context ───────
  const rec = t('rec.aerobic.' + status);

  // ── Days to neutral form ─────────────────────────────────────────────
  // Estimate days until ATL/CTL ratio drops below thFat (1.4) via 7-day ATL decay
  let daysToOptimal = null;
  if (ratio > thFat && ctl > 0) {
    const kATL = 1 - Math.exp(-1/7);
    let simAtl = atl;
    for (let d = 1; d <= 21; d++) {
      simAtl = simAtl * (1 - kATL); // no new load
      if (simAtl / ctl < thFat) { daysToOptimal = d; break; }
    }
  }

  return {status, title, desc, color, rec, daysToOptimal, dotHTML};
}

function renderTrainingLoad() {
  const container=document.getElementById('training-load-section'); if(!container) return;
  const history=getHistory();
  if (!history.length) { container.innerHTML=`<div style="text-align:center;padding:20px;color:var(--label);font-size:.8rem;">${t('analytics.save.min')}</div>`; return; }
  const tl=calcTrainingLoad(history); if(!tl) { container.innerHTML=`<div style="text-align:center;padding:20px;color:var(--label);font-size:.8rem;">${t('analytics.not.enough')}</div>`; return; }
  const goal=document.getElementById('global-goal')?.value||'conditioning';
  tl.sessionCount = history.filter(w => w.pd && parseFloat(w.pd) > 0).length;
  const status=getTrainingStatus(tl, goal);
  const isDark=document.body.classList.contains('dark');
  const _atlCtlRatio = tl.ctl > 0 ? tl.atl / tl.ctl : 1;
  const tsbColor = _atlCtlRatio > 2.0 ? '#EF4444' : _atlCtlRatio > 1.4 ? '#F59E0B' : _atlCtlRatio < 0.4 ? '#F59E0B' : '#22C55E';
  container.innerHTML=`
    <div class="card" style="padding:12px;margin-bottom:14px;cursor:pointer;" onclick="openChartFullscreen(this.dataset.title, 'banister')" data-title="${t('rec.aerobic.title')} — ${t('tl.trend')}">
      <div style="font-size:.7rem;font-weight:800;color:var(--label);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">${t('rec.aerobic.title')} — ${t('tl.trend')}</div>
      <div class="tl-chart-wrap"><canvas id="chart-training-load"></canvas></div>
      <div style="display:flex;gap:14px;margin-top:8px;justify-content:center;">
        <span style="font-size:.65rem;font-weight:700;color:#3B82F6;">&#9644; ${t('tl.fitness')} (CTL)</span>
        <span style="font-size:.65rem;font-weight:700;color:#F59E0B;">&#9644; ${t('tl.fatigue')} (ATL)</span>
        <span style="font-size:.65rem;font-weight:700;color:#22C55E;">&#9644; ${t('tl.form')} (TSB)</span>
      </div>
      <div class="chart-flip-hint">${t('tl.tap.info')}</div>
    </div>
    <div class="grid-3" style="margin-bottom:12px;">
      <div class="tl-card" style="border-color:#3B82F640;">
        <div class="tl-card-label">${t('tl.fitness')}</div>
        <div class="tl-card-val" style="color:#3B82F6;">${tl.ctl}</div>
        <div class="tl-card-sub">CTL &middot; kcal/kg &middot; 42d</div>
      </div>
      <div class="tl-card" style="border-color:#F59E0B40;">
        <div class="tl-card-label">${t('tl.fatigue')}</div>
        <div class="tl-card-val" style="color:#F59E0B;">${tl.atl}</div>
        <div class="tl-card-sub">ATL &middot; kcal/kg &middot; 7d</div>
      </div>
      <div class="tl-card" style="border-color:${tsbColor}40;">
        <div class="tl-card-label">${t('tl.form')}</div>
        <div class="tl-card-val" style="color:${tsbColor};">${tl.tsb}</div>
        <div class="tl-card-sub">TSB</div>
      </div>
    </div>
    ${(() => {
      const firstDate = new Date(tl.firstDateStr);
      const weeksOfHistory = (Date.now() - firstDate.getTime()) / (7 * 86400000);
      const trainingDays = tl.trainingDayCount || 0;
      // Hide chart entirely until 5 training days saved
      if (trainingDays < 5) {
        return `<div style="text-align:center;padding:20px 12px;color:var(--label);font-size:.75rem;">
          ${t('tl.phase1.days').replace('{n}', 5 - trainingDays)}
        </div>`;
      }
      // Burn-in note for first 12 weeks
      if (weeksOfHistory < 12) {
        const weeksStr = Math.floor(weeksOfHistory);
        return `<div style="font-size:.68rem;color:var(--muted);text-align:center;margin-bottom:10px;padding:6px 10px;background:var(--surface2);border-radius:6px;">
          ⚡ ${t('tl.burnin.note').replace('{n}', weeksStr).replace('{total}', 12)}
        </div>`;
      }
      return '';
    })()}`;
  requestAnimationFrame(() => {
    const canvas=document.getElementById('chart-training-load'); if(!canvas) return;
    if (chartInstances.trainingLoad) { try{chartInstances.trainingLoad.destroy();}catch(e){} }
    const cd=tl.chartData;
    _fsChartData = _fsChartData || {};
    _fsChartData.banister = { chartData: cd, fullChartData: tl.fullChartData, ctl: tl.ctl, atl: tl.atl, tsb: tl.tsb, tsbColor };
    const gc=isDark?'rgba(255,255,255,.1)':'rgba(0,0,0,.08)', lc=isDark?'#9CA3AF':'#6B7280', gc2=isDark?'rgba(255,255,255,.08)':'rgba(0,0,0,.07)';
    chartInstances.trainingLoad=new Chart(canvas, {
      type:'line', data:{labels:cd.map(d=>{const dt=new Date(d.date);return (dt.getMonth()+1)+'/'+dt.getDate();}),
        datasets:[
          {label:'CTL', data:cd.map(d=>d.ctl), borderColor:'#3B82F6', backgroundColor:(ctx)=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,ctx.chart.height);g.addColorStop(0,'#3B82F655');g.addColorStop(1,'#3B82F600');return g;}, fill:true, borderWidth:3, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y'},
          {label:'ATL', data:cd.map(d=>d.atl), borderColor:'#F59E0B', backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y'},
          {label:'TSB', data:cd.map(d=>d.tsb), borderColor:'#22C55E', backgroundColor:'transparent', borderWidth:2, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y2'}
        ]},
      options:{responsive:true, maintainAspectRatio:false, animation:{duration:600,easing:'easeOutQuart'}, plugins:{legend:{display:false}},
        scales:{
          x:{grid:{color:gc2,drawBorder:false},border:{display:false},ticks:{color:lc,font:{size:9},maxTicksLimit:7}},
          y:{grid:{color:gc2,drawBorder:false},border:{display:false},ticks:{color:lc,font:{size:9}},position:'left',title:{display:true,text:t('tl.fitness')+' / '+t('tl.fatigue'),color:lc,font:{size:8}}},
          y2:{grid:{display:false},border:{display:false},ticks:{color:'#22C55E99',font:{size:9}},position:'right',min:0,max:3,title:{display:true,text:t('tl.form'),color:'#22C55E99',font:{size:8}}}
        }}
    });
  });
}

function renderAnalyticsEmptyState() {
  const hasBlocks  = document.querySelectorAll('.wod-block').length > 0;
  const hasHistory = getHistory().length > 0;
  const showEmpty  = !hasBlocks && !hasHistory;
  const emptyEl    = document.getElementById('analytics-empty-state');
  const mainEl     = document.getElementById('analytics-main-content');
  if (emptyEl) emptyEl.style.display = showEmpty ? 'block' : 'none';
  if (mainEl)  mainEl.style.display  = showEmpty ? 'none'  : '';
}

// FB vs Duration — deliberately reads ALL history via getHistory(), not the
// 6-week-locked `rawData` used by the rest of the Performance Charts grid,
// since the whole point is seeing where training coverage has gaps across
// the athlete's full history, not just a recent slice of it. Reusable
// across the small card preview (no filters) and the fullscreen view
// (time/FB/duration filters), so both stay visually consistent.
// Scatter of every session's Mechanical Power (x) against Cardiovascular
// Endurance (y) — CrossFit's Power and Cardiovascular/Respiratory
// Endurance GPP skills, both as mass-independent intensity rates, so
// position reflects genuine training emphasis, not body size. A pure-
// strength session pins near the x-axis (little/no aerobic content —
// see getSessionCVEndurance for what "little" means here), a pure-
// conditioning session pins to the y-axis (no loaded movements,
// Mechanical Power is legitimately 0 by definition — see the DU/Run/Row
// investigation), and a genuinely mixed session lands somewhere between.
//
// Points are visually distinguished by whether their Cardiovascular
// Endurance came from fully real/reconstructable data or included any
// PR-pace estimate / unreconstructable overhead (see
// getSessionCVEndurance's allReal flag) — filled circles for real,
// hollow/dimmer for estimated, since presenting both identically would
// overstate how reliable the estimated ones are.
function renderPowerScatterChart(canvasId) {
  canvasId = canvasId || 'chart-power-scatter';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const isFullscreen = canvasId !== 'chart-power-scatter';
  // Was a single fixed key (chartInstances.powerScatter) regardless of
  // which canvas — meaning if the compact card's instance and a
  // fullscreen instance ever existed at the same time, one would
  // silently destroy the other's reference. Parameterized to match the
  // same instKey pattern already used for the fbduration chart.
  const instKey = isFullscreen ? 'powerScatter_fs' : 'powerScatter';
  if (chartInstances[instKey]) { try { chartInstances[instKey].destroy(); } catch(e) {} }

  const hist = getHistory();
  const allPoints = hist
    .map(w => {
      const mech = getSessionPower(w);
      const aero = getSessionCVEndurance(w);
      // Require BOTH axes to have real data — a session with mechanical
      // work but no reconstructable CV data (the vast majority of
      // history, since overhead reconstruction needs entry.blockRpe,
      // only present on sessions logged after the per-block RPE redesign)
      // was previously falling through with y:0, a fabricated "measured
      // zero" standing in for "not measured." Same philosophy as the
      // live card: absent data is excluded, not shown as zero.
      // metMinutes specifically checked (not just !aero) since it's a
      // newer addition than aero.met itself — guards against any future
      // path that returns a valid aero object without it.
      if (!mech || !aero || !aero.metMinutes) return null;
      return {
        x: +mech.total.toFixed(2),
        y: +aero.metMinutes.toFixed(1),
        allReal: aero.allReal,
        label: w.label || 'Session',
        date: (w.date || '').slice(0, 10),
        category: getSessionCategory(w),
        // Needed by the insight grid's Efficiency at Load column —
        // eRaw isn't derivable from x/y alone (it needs the entry's own
        // mechanical work in kJ, not the W/kg power value plotted
        // here), so the original entry has to come along for
        // getERawDisplay() to call on both the tapped point and
        // whichever frontier point anchors its comparison.
        entry: w
      };
    })
    .filter(Boolean);

  // Category filter chips — window._psActiveCategories persists across
  // re-renders (theme switch, zoom reset, tab revisit) so a chosen
  // filter combination survives until the athlete explicitly changes
  // it. Defaults to all six selected — filtering is opt-in, never a
  // silent default that hides sessions the athlete didn't ask to hide.
  // Named `points` (not `filteredPoints`) deliberately — every line
  // below this already refers to `points`, and renaming this single
  // binding means the whole rest of the function (chart data, frontier
  // envelope, default selection, insight card) automatically operates
  // on the filtered set with no other line needing to change.
  if (!window._psActiveCategories) {
    window._psActiveCategories = new Set(['metcon', 'strength', 'run_uphill', 'cycle_uphill', 'erg_cardio', 'pure_cardio']);
  }
  const points = allPoints.filter(p => window._psActiveCategories.has(p.category));

  const isDark = document.body.classList.contains('dark');
  const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  const lc = isDark ? '#9CA3AF' : '#6B7280';
  const brand = '#FF6B35';

  // Every session from the most recent calendar day — not selection
  // state, always on, compact card included, same as the halo the
  // Intensity vs Force Bias chart already shows unconditionally. Points
  // keep their own frontier-tier fill/border color here (unlike that
  // chart's simple two-color scheme) — the tier color is a genuinely
  // meaningful signal on this specific chart, and a flat orange
  // override would destroy it; the halo layers on top instead of
  // replacing it.
  // localDateStr (local-timezone Date methods), not p.date's own UTC
  // slice — a session logged late at night in a timezone behind UTC can
  // have a UTC-equivalent date that's already rolled to the next day,
  // splitting what's actually the same local training day across two
  // different UTC dates. Matches the same localDateStr approach the
  // Intensity vs Force Bias chart already uses correctly for this exact
  // grouping.
  const latestDay = points.length ? points.reduce((max, p) => {
    const d = localDateStr(new Date(p.entry.date));
    return d > max ? d : max;
  }, localDateStr(new Date(points[0].entry.date))) : null;
  const latestDayPoints = latestDay ? points.filter(p => localDateStr(new Date(p.entry.date)) === latestDay) : [];

  if (!points.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Pareto frontier — sessions not dominated by any other session (no
  // other session beat them on BOTH Power and Load at once). This is
  // the closest real analogue to the "optimal trade-off" curve from the
  // original inspiration slide — but built from your own actual best
  // sessions, not a theoretical physiological ceiling. A session is on
  // the frontier if no other session has equal-or-greater Power AND
  // equal-or-greater Load; sorting by Power descending and tracking the
  // running max Load found so far identifies exactly these points in
  // one pass. Verified against synthetic data before shipping.
  const frontierPoints = [];
  {
    const sortedDesc = [...points].sort((a, b) => b.x - a.x || b.y - a.y);
    let maxY = -Infinity;
    sortedDesc.forEach(p => {
      if (p.y > maxY) { frontierPoints.push(p); maxY = p.y; }
    });
    frontierPoints.sort((a, b) => a.x - b.x);
  }

  // Fill color = %-to-frontier tier: gold (on frontier), orange
  // (85-99%, near-peak), muted blue-gray (<85%, sub-maximal/recovery/
  // technical work) — or a session with no meaningful frontier
  // comparison (Power below every frontier point) defaults to the
  // lowest tier, same "no data, don't fabricate a number" logic used
  // throughout tonight.
  function _psTierColor(pct) {
    if (pct == null) return '#6B8CAE';
    if (pct >= 100) return '#F5C518';
    if (pct >= 85) return '#FF8C42';
    return '#6B8CAE';
  }

  const selectedGlowPlugin = {
    id: 'powerScatterSelectedGlow',
    beforeDatasetsDraw(chart) {
      if (!isFullscreen || !window._psSelectedPoints || !window._psSelectedPoints.length) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;
      const ctx = chart.ctx;
      window._psSelectedPoints.forEach(sel => {
        const idx = points.indexOf(sel);
        if (idx < 0 || !meta.data[idx]) return;
        const el = meta.data[idx];
        // Same crisp, fixed-radius ring used on the Force Bias vs Duration
        // chart — a blurred glow has no hard edge and can visually bleed
        // onto nearby unselected points in dense clusters (confirmed real
        // issue there earlier tonight); a stroked ring can't. Drawn once
        // per selected point — the default selection is every session
        // from the most recent training day, which can be more than one.
        ctx.save();
        ctx.beginPath();
        ctx.arc(el.x, el.y, 13, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,107,53,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      });
    }
  };

  const cfg = {
    type: 'scatter',
    data: { datasets: [
      {
        label: 'sessions',
        data: points,
        backgroundColor: ctx => {
          const p = ctx.raw;
          if (isFullscreen && p && window._psSelectedPoints && window._psSelectedPoints.includes(p)) return '#FFFFFF';
          if (!p) return _fbdHexWithOpacity('#6B8CAE', 0.8);
          const pct = _psFrontierPct(p, frontierPoints);
          return _fbdHexWithOpacity(_psTierColor(pct), p.allReal ? 0.8 : 0.5);
        },
        // Real/estimated distinction moved to border, not fill — fill
        // now carries the %-to-frontier tier instead, and both signals
        // trying to use the same channel was exactly the collision
        // flagged before building this. Full-opacity border for real
        // data, lower-opacity for estimated — same tier color either
        // way, just a fainter outline when the underlying data included
        // an estimate.
        borderColor: ctx => {
          const p = ctx.raw;
          if (isFullscreen && p && window._psSelectedPoints && window._psSelectedPoints.includes(p)) return '#FF6B35';
          if (!p) return _fbdHexWithOpacity('#6B8CAE', 0.6);
          const pct = _psFrontierPct(p, frontierPoints);
          return _fbdHexWithOpacity(_psTierColor(pct), p.allReal ? 1 : 0.5);
        },
        borderWidth: ctx => (isFullscreen && ctx.raw && window._psSelectedPoints && window._psSelectedPoints.includes(ctx.raw)) ? 3 : 1.5,
        pointRadius: ctx => {
          const p = ctx.raw;
          if (isFullscreen && p && window._psSelectedPoints && window._psSelectedPoints.includes(p)) return 9;
          return p && p.allReal ? 5 : 4;
        },
        pointHoverRadius: 7
      },
      ...(frontierPoints.length >= 2 ? [{
        type: 'line',
        label: t('chart.powerscatter.frontier.legend') || 'Engine Frontier (Historical Peak Envelope)',
        data: frontierPoints,
        borderColor: '#F5C518', // gold — echoing the original slide's yellow frontier curve
        backgroundColor: '#F5C518',
        borderWidth: 2,
        stepped: 'before', // staircase: holds each frontier session's Load until Power reaches the next frontier session — correctly shows "best Load achieved at this Power or higher", not a smoothed curve between them
        pointRadius: 5,
        pointBackgroundColor: '#F5C518',
        pointBorderColor: isDark ? '#111827' : '#fff',
        pointBorderWidth: 1.5,
        pointHoverRadius: 7,
        fill: false,
        order: -1 // drawn on top of everything
      }] : [])
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: t('chart.powerscatter.x'), color: lc, font: { size: 10 } }, grid: { color: gc }, ticks: { color: lc }, min: 0 },
        y: { title: { display: true, text: t('chart.powerscatter.y'), color: lc, font: { size: 10 } }, grid: { color: gc }, ticks: { color: lc }, min: 0 }
      },
      plugins: {
        // Legend shown ONLY when the frontier line exists, and filtered
        // to show ONLY the frontier's own entry — not the regular
        // session dots, which don't need a legend label and would just
        // add clutter. This directly addresses the "unlabeled frontier"
        // friction point: previously nothing on screen explained what
        // the gold staircase meant at all.
        legend: frontierPoints.length >= 2 ? {
          display: true, position: 'top',
          labels: { color: lc, font: { size: 10 }, boxWidth: 20,
            filter: item => item.text && item.text !== 'sessions'
          }
        } : { display: false },
        tooltip: {
          callbacks: { label: ctx => `${ctx.raw.label} (${ctx.raw.date}): Mech=${ctx.raw.x} W/kg, Load=${ctx.raw.y} MET-min${ctx.raw.allReal ? '' : ' (est.)'}` }
        },
        // Pinch/pan/wheel — fullscreen only, same custom handlers
        // already proven on the Workbench's FB/Duration chart, reused
        // directly since they're generic (parameterized by canvas +
        // instKey, not hardcoded to that one chart). wheel.enabled
        // stays off for the same reason as everywhere else this
        // pattern's used: the plugin's own wheel handling can't tell a
        // trackpad swipe from a pinch.
        zoom: isFullscreen ? {
          pan: { enabled: true, mode: 'xy' },
          zoom: { pinch: { enabled: true }, wheel: { enabled: false }, mode: 'xy' }
        } : undefined
      },
      onClick: isFullscreen ? (evt, elements) => {
        if (!elements.length) return;
        const el = elements[0];
        // Only dataset 0 (session dots) is selectable — tapping a
        // frontier line vertex uses the same point object anyway, since
        // frontierPoints shares object references with points.
        const point = cfg.data.datasets[el.datasetIndex].data[el.index];
        if (!point || typeof point.x !== 'number') return;
        // A manual tap always selects just that one point — the
        // multi-select default (every session from the most recent
        // training day) only applies before the athlete has picked
        // anything specific.
        window._psSelectedPoints = [point];
        _updatePowerScatterInsightCard(point, points, frontierPoints);
        chartInstances[instKey]?.update();
      } : undefined
    },
    plugins: [selectedGlowPlugin, {
      id: 'powerScatterLatestDayHalo',
      afterDatasetsDraw(chart) {
        if (!latestDayPoints.length) return;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data) return;
        const ctx = chart.ctx;
        ctx.save();
        latestDayPoints.forEach(p => {
          const idx = points.indexOf(p);
          if (idx < 0 || !meta.data[idx]) return;
          const el = meta.data[idx];
          ctx.beginPath();
          ctx.arc(el.x, el.y, 16, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,107,53,0.4)';
          ctx.lineWidth = 6;
          ctx.stroke();
        });
        ctx.restore();
      }
    }]
  };

  chartInstances[instKey] = new Chart(canvas, cfg);
  if (isFullscreen) {
    window._psCurrentPoints = points;
    window._psCurrentFrontier = frontierPoints;
    // Default selection — every session from the most recent TRAINING
    // DAY, not just a single most-recent session: a training day can
    // have more than one session (e.g. a strength session and a
    // conditioning session), and all of them should be highlighted
    // together, matching what "last sessions" actually meant here.
    // Same precedent the Intensity vs Force Bias chart already
    // established for showing a default at all — extended to a group
    // rather than one point. The insight card still shows just one
    // session's detail, since it's a single-session view — the latest
    // one BY FULL TIMESTAMP among that day's sessions, not an arbitrary
    // pick, so it's deterministic.
    if (points.length) {
      const latestDate = points.reduce((max, p) => {
        const d = localDateStr(new Date(p.entry.date));
        return d > max ? d : max;
      }, localDateStr(new Date(points[0].entry.date)));
      const latestDayPoints = points.filter(p => localDateStr(new Date(p.entry.date)) === latestDate);
      window._psSelectedPoints = latestDayPoints;
      const insightTarget = latestDayPoints.reduce((a, b) => new Date(a.entry.date) > new Date(b.entry.date) ? a : b);
      _updatePowerScatterInsightCard(insightTarget, points, frontierPoints);
      // Chart.js's initial render already happened synchronously inside
      // new Chart() above, before _psSelectedPoints was set — without
      // an explicit update() here, the rings wouldn't actually appear
      // until the next unrelated redraw.
      chartInstances[instKey].update();
    }
    // Stashed after creation (not before — need the auto-computed
    // initial min/max, since neither axis has a hardcoded max) so
    // _powerScatterResetZoom() can restore exactly this without relying
    // on chartjs-plugin-zoom's own resetZoom(), which doesn't reliably
    // track state set by the manual wheel/touch handlers below — same
    // issue found and fixed for the Banister chart.
    const _chart = chartInstances[instKey];
    _chart._psInitialRange = {
      xMin: _chart.scales.x.min, xMax: _chart.scales.x.max,
      yMin: _chart.scales.y.min, yMax: _chart.scales.y.max
    };
    _fbDurationWireTrackpadPan(canvas, instKey);
    _fbDurationWireTouchGestures(canvas, instKey);
  }
}


function renderAnalytics() {
  destroyCharts();
  renderAnalyticsEmptyState();
  renderTrainingLoad();
  renderRecoveryStatus();
  // Re-render pattern pie if a profile was calculated this session
  if (_lastPatternProfile) renderMovementPatternProfile(_lastPatternProfile);
  // Render coaching insight — back to per-language + goal cache keying
  // (reverted from a goal-only bilingual scheme — see
  // generateCoachingInsight's own comment for why).
  const currentInsightLang = _lang === 'es' ? 'es' : 'en';
  const currentGoal = document.getElementById('global-goal')?.value || 'general';
  const cacheKey = 'wod-insight-cache-' + currentInsightLang + '-' + currentGoal;
  const cached = (_insightCache?.lang === currentInsightLang && _insightCache?.goal === currentGoal ? _insightCache : null) || JSON.parse(localStorage.getItem(cacheKey) || 'null');
  const cachedLangMatch = cached?.lang === currentInsightLang && cached?.goal === currentGoal;
  const hist = getHistory();
  if (hist.length < INSIGHT_MIN_SESSIONS) {
    _renderInsightUnlock(hist.length);
  } else if (cached && cachedLangMatch && !_insightRefreshDue(cached, hist)) {
    _renderInsightResult(cached, hist);
  } else if (cached && cachedLangMatch && _insightRefreshDue(cached, hist)) {
    _renderInsightResult(cached, hist); // show cached but with refresh button
  } else {
    _renderInsightLoading();
    generateCoachingInsight();
  }
  const el = document.getElementById('analytics-content');
  if (hist.length < 2) {
    el.innerHTML = `<div class="analytics-empty"><div style="margin-bottom:12px;opacity:.85;"><svg width="110" height="80" viewBox="0 0 110 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Bars -->
  <rect x="12" y="50" width="16" height="22" rx="4" fill="var(--brand)" opacity=".4"/>
  <rect x="34" y="35" width="16" height="37" rx="4" fill="var(--brand)" opacity=".6"/>
  <rect x="56" y="20" width="16" height="52" rx="4" fill="var(--brand)" opacity=".8"/>
  <rect x="78" y="28" width="16" height="44" rx="4" fill="#22C55E" opacity=".8"/>
  <!-- X axis -->
  <line x1="8" y1="74" x2="102" y2="74" stroke="var(--label)" stroke-width="1.5" opacity=".3" stroke-linecap="round"/>
  <!-- Trend arrow -->
  <polyline points="15,58 36,45 58,30 86,20" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".4" stroke-dasharray="4 3"/>
</svg></div><p>${t('analytics.charts.min')}</p></div>`;
    return;
  }

  const isDark = document.body.classList.contains('dark');
  const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  const lc = isDark ? '#9CA3AF' : '#6B7280';
  const brand='#FF6B35', accent='#3B82F6', success='#22C55E';

  // Last 6 weeks only — compare date strings directly to avoid timezone issues
  const sixWeeksAgoStr = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
  const rawData = [...hist]
    .filter(w => {
      if (!w.date) return false;
      return w.date.slice(0,10) >= sixWeeksAgoStr;
    })
    .sort((a, b) => (a.date||'').localeCompare(b.date||''));

  // Scatter chart excludes pure cardio (fb=0) — no structural load to plot
  const scatterData = rawData.filter(w => (parseFloat(w.fb)||0) > 0);
  if (!rawData.length) {
    el.innerHTML = `<div class="analytics-empty"><div style="margin-bottom:12px;opacity:.85;"><svg width="110" height="80" viewBox="0 0 110 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Bars -->
  <rect x="12" y="50" width="16" height="22" rx="4" fill="var(--brand)" opacity=".4"/>
  <rect x="34" y="35" width="16" height="37" rx="4" fill="var(--brand)" opacity=".6"/>
  <rect x="56" y="20" width="16" height="52" rx="4" fill="var(--brand)" opacity=".8"/>
  <rect x="78" y="28" width="16" height="44" rx="4" fill="#22C55E" opacity=".8"/>
  <!-- X axis -->
  <line x1="8" y1="74" x2="102" y2="74" stroke="var(--label)" stroke-width="1.5" opacity=".3" stroke-linecap="round"/>
  <!-- Trend arrow -->
  <polyline points="15,58 36,45 58,30 86,20" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".4" stroke-dasharray="4 3"/>
</svg></div><p>${t('analytics.charts.min')}</p></div>`;
    return;
  }

  // Aggregate multiple sessions on the same day
  const dayMap = {};
  rawData.forEach(w => {
    const day = localDateStr(new Date(w.date||''));
    if (!dayMap[day]) {
      dayMap[day] = { date: day, pd: 0, wd: 0, mc: 0, mc_mech: null, mc_aero: null, mc_overhead: null, fb: 0, rl: 0, td: 0, count: 0 };
    }
    const d = dayMap[day];
    d.wd += parseFloat(w.wd)||0;
    d.mc += parseFloat(w.mc)||0;
    if (w.mc_mech != null) { d.mc_mech = (d.mc_mech||0) + (w.mc_mech||0); }
    if (w.mc_aero != null) { d.mc_aero = (d.mc_aero||0) + (w.mc_aero||0); }
    if (w.mc_overhead != null) { d.mc_overhead = (d.mc_overhead||0) + (w.mc_overhead||0); }
    const powerValStatic = (() => { const p = getSessionPower(w); return p ? p.total : (parseFloat(w.pd)||0); })();
    d.pd = Math.max(d.pd, powerValStatic);
    d.fb = Math.max(d.fb, parseFloat(w.fb)||0);
    d.rl = Math.max(d.rl, parseFloat(w.rl)||0);
    d.td = Math.max(d.td, parseFloat(w.td)||0);
    d.count++;
  });
  const data = Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date));

  const labels = data.map(w => {
    const d = new Date(w.date + 'T12:00:00');
    return (d.getMonth()+1) + '/' + d.getDate();
  });

  // ── Weekly kcal aggregation ──
  const weekMap = {};
  rawData.forEach(w => {
    const d = new Date(w.date.slice(0,10) + 'T12:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const wk = monday.toISOString().slice(0,10);
    if (!weekMap[wk]) weekMap[wk] = { date: wk, wd: 0, mc: 0, mc_mech: null, mc_aero: null, mc_overhead: null, sessionCount: 0 };
    const wkd = weekMap[wk];
    wkd.sessionCount += 1;
    const wdW = parseFloat(w.wd) || 0;
    if (wdW > 0) wkd.wd += wdW;
    const mcVal = parseFloat(w.mc)||0;
    wkd.mc += mcVal;
    if (w.mc_mech != null) {
      // Session has split data — use individual components
      wkd.mc_mech     = (wkd.mc_mech||0) + (w.mc_mech||0);
      if (w.mc_aero     != null) wkd.mc_aero     = (wkd.mc_aero||0)     + (w.mc_aero||0);
      if (w.mc_overhead != null) wkd.mc_overhead = (wkd.mc_overhead||0) + (w.mc_overhead||0);
    } else if (mcVal > 0) {
      // Legacy session — add total mc to mc_mech bucket so it shows on split chart
      wkd.mc_mech = (wkd.mc_mech||0) + mcVal;
    }
  });
  const weeks = Object.values(weekMap).sort((a,b) => a.date.localeCompare(b.date));
  const weekLabels = weeks.map(w => {
    const d = new Date(w.date + 'T12:00:00');
    return 'W' + (d.getMonth()+1) + '/' + d.getDate();
  });

  const gc2 = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)';
  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: gc2, drawBorder: false }, border: { display: false },
           ticks: { color: lc, font: { size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: gc2, drawBorder: false }, border: { display: false },
           ticks: { color: lc, font: { size: 10 } } }
    }
  };

  const scatterLastIdx = scatterData.length - 1;
  // Highlight ALL sessions from the most recent calendar day (not just the
  // single last array entry) — a day with multiple sessions should show a
  // halo on each of them, not just whichever happened to be logged last.
  const scatterLatestDay = scatterData.length ? localDateStr(new Date(scatterData[scatterLastIdx].date||'')) : null;
  const scatterHistorySrc = scatterData.filter(w => localDateStr(new Date(w.date||'')) !== scatterLatestDay);
  const scatterLatestSrc  = scatterData.filter(w => localDateStr(new Date(w.date||'')) === scatterLatestDay);
  // Bubble radius scaled from total mechanical work (kJ) — sqrt scaling keeps
  // bubble *area* (not radius) roughly proportional to work, so a session with
  // 3x the work doesn't look 9x bigger. Distinguishes e.g. a heavy low-volume
  // strength set from a high-volume metcon that land at a similar bias/intensity.
  const MIN_R = 5, MAX_R = 18;
  const scatterWdSqrt = scatterData.map(w => Math.sqrt(Math.max(0, parseFloat(w.wd)||0)));
  const wdSqrtMin = scatterWdSqrt.length ? Math.min(...scatterWdSqrt) : 0;
  const wdSqrtMax = scatterWdSqrt.length ? Math.max(...scatterWdSqrt) : 0;
  const radiusForWd = wd => {
    const sq = Math.sqrt(Math.max(0, parseFloat(wd)||0));
    if (wdSqrtMax === wdSqrtMin) return (MIN_R + MAX_R) / 2;
    return MIN_R + (sq - wdSqrtMin) / (wdSqrtMax - wdSqrtMin) * (MAX_R - MIN_R);
  };
  // Force Bias, recomputed fresh via reconstructMechanicalWork (same
  // approach as tonight's Engine Score work) rather than trusting the
  // stored entry.fb field, which drifted across several formula versions
  // earlier tonight. FB=0 is legitimate, real data (confirmed: only 2
  // actual sessions in your history have no loaded work at all) — it's
  // NOT excluded the way missing/uncomputable data is. Only entries
  // where FB itself can't be computed at all (no blocks, no bw) are
  // dropped.
  // Force Bias, recomputed fresh via reconstructMechanicalWork (same
  // approach as tonight's Engine Score work) rather than trusting the
  // stored entry.fb field, which drifted across several formula versions
  // earlier tonight. FB=0 is legitimate, real data (confirmed: only 2
  // actual sessions in your history have no loaded work at all) — it's
  // NOT excluded the way missing/uncomputable data is. Only entries
  // where FB itself can't be computed at all (no blocks, no bw) are
  // dropped.
  const forceBiasFor = w => {
    if (!w.blocks || !w.blocks.length || w.bw == null) return null;
    const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
    const { tonnage, workKJ } = reconstructMechanicalWork(w, parseFloat(w.bw), hMetres);
    return workKJ > 0 ? tonnage / workKJ : 0; // workKJ==0 (pure cardio) -> FB=0, a real value, not an error
  };
  // Computed once per session (fb + full CV result together), not
  // separately for filtering/mapping/coloring — avoids calling the
  // underlying reconstruction functions repeatedly for no reason, and
  // lets allReal travel with each point directly rather than needing a
  // second parallel array kept in sync by index.
  const scatterHistoryComputed = scatterHistorySrc
    .map(w => ({ w, fb: forceBiasFor(w), cv: getSessionCVEndurance(w) }))
    .filter(item => item.fb != null && item.cv != null);
  const scatterLatestComputed = scatterLatestSrc
    .map(w => ({ w, fb: forceBiasFor(w), cv: getSessionCVEndurance(w) }))
    .filter(item => item.fb != null && item.cv != null);
  const scatterPrevData = scatterHistoryComputed.map(item => ({
    x: item.fb, y: item.cv.met, r: radiusForWd(item.w.wd), wd: parseFloat(item.w.wd) || 0,
    label: item.w.label, allReal: item.cv.allReal, date: (item.w.date || '').slice(0, 10)
  }));
  const scatterLatestPt = scatterLatestComputed.map(item => ({
    x: item.fb, y: item.cv.met, r: radiusForWd(item.w.wd), wd: parseFloat(item.w.wd) || 0,
    label: item.w.label, allReal: item.cv.allReal, date: (item.w.date || '').slice(0, 10)
  }));

  const scatterCfg = {
    type: 'bubble',
    data: { datasets: [
      {
        label: 'history',
        data: scatterPrevData,
        // Filled vs. outline, same blue hue throughout — not a two-tier
        // color scheme. With consistent HR strap use, sessions without
        // real per-block heart rate (allReal: false) will become the
        // rare exception, not an ongoing split — a strong faded/vibrant
        // contrast was the wrong weight for that. Filled = real HR
        // drove this session's Y-position. Outline-only (transparent
        // fill) = built from an old flat RPE guess, still fully visible
        // and clearly on the chart, just visually lighter without
        // reading as a second, lesser category of data.
        backgroundColor: ctx => ctx.raw?.allReal
          ? (isDark ? 'rgba(96,165,250,0.75)' : 'rgba(59,130,246,0.7)')
          : 'transparent',
        borderColor: isDark ? 'rgba(96,165,250,0.9)' : 'rgba(59,130,246,0.85)',
        hoverRadius: ctx => (ctx.raw?.r || 7) + 2, borderWidth: 1.5
      },
      {
        label: 'latest',
        data: scatterLatestPt,
        backgroundColor: '#FF6B35',
        borderColor: '#FF6B35',
        hoverRadius: ctx => (ctx.raw?.r || 9) + 2,
        borderWidth: 2,
        // Glow drawn by the latestGlowPlugin below — this is a genuinely
        // separate visual channel from the history dataset's fill/
        // outline (data quality) signal, not a replacement for it. Two
        // different questions (which session is current vs. which
        // sessions have real HR data) get two different, non-competing
        // visual treatments instead of overloading one.
      }
    ]},
    options: { ...baseOpts, plugins: { ...baseOpts.plugins, tooltip: { callbacks: { label: ctx => `${ctx.raw.label||'WOD'}: FB ${Math.round(ctx.raw.x||0)}, ${(ctx.raw.y||0).toFixed(1)} MET, ${Math.round(ctx.raw.wd||0)} kJ` } } }, scales: { ...baseOpts.scales, x: { ...baseOpts.scales.x, title: { display: true, text: t('scatter.x.axis'), color: lc, font: { size: 10 } } }, y: { ...baseOpts.scales.y, title: { display: true, text: t('scatter.y.axis'), color: lc, font: { size: 10 } } } } },
    plugins: [{
      id: 'latestHalo',
      afterDatasetsDraw(chart) {
        if (!scatterLatestPt.length) return;
        const ds = chart.getDatasetMeta(1);
        if (!ds || !ds.data || !ds.data.length) return;
        const { ctx } = chart;
        ctx.save();
        ds.data.forEach((pt, i) => {
          const haloR = (scatterLatestPt[i]?.r || 9) + 7;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, haloR, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,107,53,0.4)';
          ctx.lineWidth = 6;
          ctx.stroke();
        });
        ctx.restore();
      }
    }]
  };
  // ── Average values for annotation lines ──
  const wdVals = data.map(w => parseFloat(w.wd)||0).filter(v => v > 0);
  const mcVals = data.map(w => parseFloat(w.mc)||0).filter(v => v > 0);
  const avgWd = wdVals.length ? Math.round(wdVals.reduce((a,b) => a+b,0) / wdVals.length) : 0;
  const avgMc = mcVals.length ? Math.round(mcVals.reduce((a,b) => a+b,0) / mcVals.length) : 0;

  const avgLinePlugin = (avgVal, color, labelText) => ({
    id: 'avgLine_' + avgVal,
    afterDraw(chart) {
      const { ctx, chartArea: { left, right }, scales: { y } } = chart;
      if (!y || !avgVal) return;
      const yPos = y.getPixelForValue(avgVal);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '600 10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(labelText || `avg ${avgVal}`, right - 4, yPos - 4);
      ctx.restore();
    }
  });

  // Per-session kJ data mapped to week labels for the line overlay
  const sessionKjByWeek = {};
  rawData.forEach(w => {
    const d = new Date(w.date.slice(0,10) + 'T12:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const wk = monday.toISOString().slice(0,10);
    if (!sessionKjByWeek[wk]) sessionKjByWeek[wk] = [];
    sessionKjByWeek[wk].push(parseFloat(w.wd)||0);
  });
  const weeklyTotalKj = weeks.map(w => Math.round(w.wd||0));
  const avgWeeklyKj = weeklyTotalKj.length ? Math.round(weeklyTotalKj.reduce((a,b)=>a+b,0) / weeklyTotalKj.length) : 0;
  const weekDateList = weeks.map(w => w.date);

  // Three-tier weekly color classification — used consistently by the
  // bar fill, the bar gradient plugin, AND the persistent card's %-vs-
  // average text, so none of them can disagree about the same week.
  // Below-average alone no longer means red: a genuinely planned lighter
  // week (deload, taper, recovery) still reads as a neutral/muted color,
  // not an alarming one. Only a week falling below HALF the average —
  // a real, large shortfall — gets flagged red.
  //   >= avg           -> green  (above average)
  //   >= 50% of avg     -> muted (below average, but not dramatically so)
  //   < 50% of avg      -> red   (genuinely large shortfall)
  function getWeeklyColorTier(weekKj) {
    if (avgWeeklyKj <= 0) return 'muted'; // no real average to compare against yet
    if (weekKj >= avgWeeklyKj) return 'green';
    if (weekKj >= avgWeeklyKj * 0.5) return 'muted';
    return 'red';
  }
  const weeklyColorTiers = weeklyTotalKj.map(getWeeklyColorTier);

  // Individual session kJ — same day stacked, different days spread side by side
  const sessionsByWeek = {};
  rawData.filter(w => parseFloat(w.wd) > 0).forEach(w => {
    const d = new Date(w.date.slice(0,10) + 'T12:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const wk = monday.toISOString().slice(0,10);
    if (!sessionsByWeek[wk]) sessionsByWeek[wk] = {};
    const dateKey = w.date.slice(0,10);
    if (!sessionsByWeek[wk][dateKey]) sessionsByWeek[wk][dateKey] = [];
    sessionsByWeek[wk][dateKey].push({ kj: Math.round(parseFloat(w.wd)||0), date: dateKey, label: w.label||'' });
  });
  // Sessions grouped by week then by day for side-by-side positioning
  const allSessionsFlat = [];
  weekDateList.forEach((wkDate, wkIdx) => {
    const dayMap = sessionsByWeek[wkDate] || {};
    const dayKeys = Object.keys(dayMap).sort();
    dayKeys.forEach((dk) => {
      const sessions = dayMap[dk];
      sessions.forEach(s => {
        allSessionsFlat.push({ x: wkIdx, y: s.kj, date: dk, label: s.label });
      });
    });
  });
  const sessionScatterPts = allSessionsFlat;

  // Bar colours: solid colour top fading to transparent quickly (gradient)
  const tierFillColors = { green: '#22C55Eaa', muted: '#6B8CAEaa', red: '#EF4444aa' };
  const tierBorderColors = { green: '#22C55E', muted: '#6B8CAE', red: '#EF4444' };
  const barColors = weeklyColorTiers.map(tier => tierFillColors[tier]);
  const barBorders = weeklyColorTiers.map(tier => tierBorderColors[tier]);
  const barGradientAndDotsPlugin = {
    id: 'barGradientAndDots',
    beforeDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;
      meta.data.forEach((bar, i) => {
        const top    = bar.y;
        const bottom = bar.base !== undefined ? bar.base : bar.y;
        if (Math.abs(bottom - top) < 1) return;
        const col = tierBorderColors[weeklyColorTiers[i]];
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0,   col + 'ee');
        g.addColorStop(1,   col + '00');
        bar.options.backgroundColor = g;
      });
    },
    afterDraw(chart) {
      const { ctx, scales } = chart;
      const xCat = scales['xCat'];
      const yScale = scales['y'];
      if (!xCat || !yScale) return;
      ctx.save();
      const dotsByWeek = {};
      sessionScatterPts.forEach(pt => {
        const wkIdx = Math.round(pt.x);
        if (!dotsByWeek[wkIdx]) dotsByWeek[wkIdx] = [];
        dotsByWeek[wkIdx].push(pt);
      });
      const barWidth = xCat.width / weekLabels.length;
      // 7 Mon-Sun sub-columns spanning most of the bar's width, with a
      // small margin on each side so Monday/Sunday dots don't sit right
      // on the bar's edge.
      const colMargin = barWidth * 0.1;
      const usableWidth = barWidth - colMargin * 2;
      const colWidth = usableWidth / 7;
      // Rebuilt fresh on every draw — the persistent card's dot-tap
      // handler reads from this for manual hit-detection, since these
      // dots are hand-drawn canvas shapes, not a real Chart.js dataset
      // Chart.js's own click system can see.
      window._totalworkDotPositions = [];
      Object.entries(dotsByWeek).forEach(([wkIdx, pts]) => {
        const wkInt = parseInt(wkIdx);
        if (wkInt < 0 || wkInt >= weekLabels.length) return;
        const barCx = xCat.getPixelForValue(weekLabels[wkInt]);
        const barLeft = barCx - barWidth / 2 + colMargin;
        // Group by actual day-of-week (Monday=0...Sunday=6, matching
        // this app's Monday-first week convention used everywhere else)
        // using each point's real date — previously ignored entirely in
        // favor of a count-based even spread with zero connection to
        // which day a session actually happened.
        const byDay = {};
        pts.forEach(pt => {
          const d = new Date(pt.date + 'T12:00:00');
          const dayIdx = (d.getDay() + 6) % 7;
          if (!byDay[dayIdx]) byDay[dayIdx] = [];
          byDay[dayIdx].push(pt);
        });
        Object.entries(byDay).forEach(([dayIdx, dayPts]) => {
          const di = parseInt(dayIdx);
          const colCx = barLeft + colWidth * (di + 0.5);
          const n = dayPts.length;
          const jitter = Math.min(colWidth * 0.3, 8);
          dayPts.forEach((pt, i) => {
            const jOffset = n === 1 ? 0 : -jitter + (jitter * 2 / (n - 1)) * i;
            const px = colCx + jOffset;
            const py = yScale.getPixelForValue(pt.y);
            // Selection check — matches on date+label+y together, since
            // that's what the tap handler stores. A dot matching the
            // currently-selected session (set on tap, cleared on a
            // bar-only tap or default view) renders larger with an
            // orange glow, same visual language as the scatter chart's
            // current-session highlight — "this is the one the card
            // below is currently describing."
            const sel = window._totalworkSelectedDot;
            const isSelected = sel && sel.date === pt.date && sel.label === pt.label && sel.y === pt.y;
            if (isSelected) {
              ctx.save();
              ctx.shadowColor = 'rgba(255,107,53,0.9)';
              ctx.shadowBlur = 10;
              ctx.beginPath();
              ctx.arc(px, py, 7, 0, Math.PI * 2);
              ctx.fillStyle = '#FF6B35';
              ctx.fill();
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.restore();
            } else {
              ctx.beginPath();
              ctx.arc(px, py, 5, 0, Math.PI * 2);
              ctx.fillStyle = '#93C5FD';
              ctx.fill();
              ctx.strokeStyle = '#1D4ED8';
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
            window._totalworkDotPositions.push({ px, py, r: isSelected ? 7 : 5, pt });
          });
        });
      });
      ctx.restore();
    }
  };

  // Linear trend line across weeks (least squares)
  const tN = weeklyTotalKj.length;
  const tMeanX = (tN - 1) / 2;
  const tMeanY = weeklyTotalKj.reduce((a,b) => a+b,0) / tN;
  const tNum = weeklyTotalKj.reduce((s,v,i) => s + (i - tMeanX)*(v - tMeanY), 0);
  const tDen = weeklyTotalKj.reduce((s,_,i) => s + (i - tMeanX)**2, 0);
  const tSlope = tDen !== 0 ? tNum / tDen : 0;
  const tIntercept = tMeanY - tSlope * tMeanX;
  const trendData = weeklyTotalKj.map((_,i) => Math.round(tIntercept + tSlope * i));
  const trendColor = tSlope >= 0 ? '#22C55E' : '#EF4444';
  // Consolidated trend indicator (replaces the separate drawn trend
  // line) — % change is the regression's own implied movement from
  // week 1 to the final week, i.e. what the trend line itself was
  // visually representing, not a noisier week-to-week actual comparison.
  const trendStart = trendData[0];
  const trendEnd = trendData[trendData.length - 1];
  const trendPct = (tN > 1 && trendStart > 0) ? Math.round(((trendEnd - trendStart) / trendStart) * 100 * 10) / 10 : null;

  const totalworkCfg = {
    type: 'bar',
    data: { labels: weekLabels, datasets: [
      {
        type: 'bar',
        label: '',
        data: weeklyTotalKj,
        backgroundColor: barColors,
        borderColor: barBorders,
        borderWidth: 1,
        borderSkipped: 'bottom',
        borderRadius: 4,
        xAxisID: 'xCat',
        yAxisID: 'y',
        order: 2
      }
    ]},
    options: { ...baseOpts,
      plugins: { ...baseOpts.plugins,
        legend: { display: false },
        tooltip: { callbacks: {
          label: v => `Weekly total: ${v.raw} kJ`
        }}
      },
      scales: {
        xCat: { type: 'category', grid: { color: gc }, ticks: { color: lc, font: { size: 10 } } },
        y: { grid: { color: gc }, ticks: { color: lc, font: { size: 10 } }, beginAtZero: true }
      }
    },
    plugins: [ barGradientAndDotsPlugin, avgLinePlugin(avgWeeklyKj, accent+'cc', `6-wk avg ${avgWeeklyKj} kJ/wk`) ],
    // Feeds the persistent insight card — one entry per week, same
    // index/order as weekLabels. sessionCount sums across every day in
    // that week's sessionsByWeek map, since a week can have sessions on
    // multiple different days.
    weeklyInsightData: weekLabels.map((label, i) => {
      const weekDate = weekDateList[i];
      const dayMap = sessionsByWeek[weekDate] || {};
      const sessionCount = Object.values(dayMap).reduce((sum, arr) => sum + arr.length, 0);
      return {
        weekLabel: label,
        totalKj: weeklyTotalKj[i],
        avgKj: avgWeeklyKj,
        pctVsAvg: avgWeeklyKj > 0 ? Math.round(((weeklyTotalKj[i] - avgWeeklyKj) / avgWeeklyKj) * 100) : null,
        sessionCount,
        colorTier: weeklyColorTiers[i]
      };
    }),
    // Consolidated trend indicator data, for the fullscreen header —
    // the compact card's header uses these same three values directly
    // via closure since it's built in this same scope, but the
    // fullscreen modal renders later, in a separate function call, so
    // this needs to travel with the config instead.
    trendPct, avgWeeklyKj, trendDirection: tSlope >= 0 ? 'up' : 'down'
  };

  // hasSplit: true if any week has split data
  const hasSplit = weeks.some(w => w.mc_mech != null) || (window._lastMechKcal != null);
  const hasOverhead = weeks.some(w => w.mc_overhead != null) ||
    (window._lastOverheadKcal != null && window._lastOverheadKcal > 0);
  const mechData     = weeks.map(w => w.mc_mech     != null ? Math.round(w.mc_mech)     : 0);
  const aeroData     = weeks.map(w => w.mc_aero     != null ? Math.round(w.mc_aero)     : 0);
  const overheadData = weeks.map(w => w.mc_overhead != null ? Math.round(w.mc_overhead) : 0);
  const legacyData   = weeks.map(w => w.mc_mech == null ? Math.round(w.mc||0) : 0);
  const avgMcWeekly  = weeks.length ? Math.round(weeks.reduce((s,w) => s+(w.mc||0), 0) / weeks.length) : 0;
  // Full, high-opacity colors when unfocused/all-visible; dimmed when a
  // DIFFERENT segment has focus. Kept as constants so the focus-toggle
  // logic can reference the same base colors consistently.
  const kcalFullAlpha = 'cc', kcalDimAlpha = '2a';
  const splitDatasets = [
    { data: mechData,     backgroundColor: brand+kcalFullAlpha,   borderColor: brand,    borderWidth: 1, borderSkipped: false, label: t('sys.mech.legend'), stack: 'mc' },
    { data: aeroData,     backgroundColor: success+kcalFullAlpha, borderColor: success,  borderWidth: 1, borderSkipped: false, label: t('sys.aero.legend'),    stack: 'mc' },
    ...(hasOverhead ? [{ data: overheadData, backgroundColor: '#3B82F6'+kcalFullAlpha, borderColor: '#3B82F6', borderWidth: 1, label: t('sys.aero.overhead'), stack: 'mc' }] : []),
    { data: legacyData,   backgroundColor: '#6B7280'+kcalFullAlpha,  borderColor: '#6B7280', borderWidth: 1, borderSkipped: false, label: 'Total (no split)', stack: 'mc' }
  ];
  // Key takeaway — dominant energy source classification, shared logic
  // used both by the card's per-week takeaway and could be reused
  // elsewhere later. Requires a real margin (15+ points) over the
  // second-highest AND a real share (45%+) before calling something
  // "dominant" — a near-even 34/33/33 split shouldn't get labeled as
  // if one component clearly drove the week.
  function getKcalTakeaway(mech, aero, overhead) {
    const total = mech + aero + overhead;
    if (total <= 0) return null;
    const mechPct = mech/total*100, aeroPct = aero/total*100, overheadPct = overhead/total*100;
    const sorted = [mechPct, aeroPct, overheadPct].sort((a,b) => b-a);
    if (sorted[0] < 45 || (sorted[0] - sorted[1]) < 15) return { key: 'balanced', text: t('kcal.takeaway.balanced') || 'Balanced Energy Mix' };
    if (sorted[0] === mechPct) return { key: 'mech', text: t('kcal.takeaway.mech') || 'Strength-Dominant Week' };
    if (sorted[0] === overheadPct) return { key: 'overhead', text: t('kcal.takeaway.overhead') || 'High Aerobic Overhead — Metcon Heavy Week' };
    return { key: 'aero', text: t('kcal.takeaway.aero') || 'Aerobic-Dominant Week' };
  }
  const kcalWeeklyInsightData = weekLabels.map((label, i) => {
    const total = weeks[i]?.mc || 0;
    return {
      weekLabel: label,
      totalKcal: Math.round(total),
      avgKcal: avgMcWeekly,
      pctVsAvg: avgMcWeekly > 0 ? Math.round(((total - avgMcWeekly) / avgMcWeekly) * 100) : null,
      sessionCount: weeks[i]?.sessionCount || 0,
      mech: mechData[i] + legacyData[i], aero: aeroData[i], overhead: overheadData[i],
      takeaway: getKcalTakeaway(mechData[i] + legacyData[i], aeroData[i], overheadData[i])
    };
  });
  const kcalCfg = {
    type: 'bar',
    data: { labels: weekLabels, datasets: hasSplit ? splitDatasets : [
      { data: weeks.map(w => Math.round(w.mc||0)), backgroundColor: success+kcalFullAlpha, borderColor: success, borderWidth: 1, borderRadius: 4, borderSkipped: false, label: 'kcal', stack: 'mc' }
    ]},
    options: { ...baseOpts,
      scales: { ...baseOpts.scales,
        x: { ...baseOpts.scales.x, stacked: true },
        y: { ...baseOpts.scales.y, stacked: true }
      },
      plugins: { ...baseOpts.plugins,
        legend: hasSplit ? { display: true, labels: { color: lc, font:{ size:10 }, boxWidth:14, padding:8,
          filter: item => !(item.text === 'Total (no split)' && legacyData.every(v => v === 0))
        }} : { display: false },
        tooltip: { callbacks: { label: v => `${v.dataset.label}: ${Math.round(v.raw)} kcal` } }
      }
    },
    // Baseline line kept, but with an empty label — the on-canvas text
    // used the exact same green as the Aerobic segment, meaning the
    // label could render directly on top of a same-colored bar with
    // zero contrast. Moved to a header subtitle instead (see the
    // compact card's HTML and the fullscreen rendering block below),
    // where it renders as plain readable text regardless of bar colors.
    plugins: [ avgLinePlugin(avgMcWeekly, success+'88', '') ],
    weeklyInsightData: kcalWeeklyInsightData,
    avgMcWeekly,
    kcalFullAlpha, kcalDimAlpha
  };

  // ── 6-Week Training Profile Radar ──
  // Uses rawData (real session entries), NOT data (the synthetic
  // per-day aggregate objects built above for the bar/scatter charts).
  // dayMap entries have no w.blocks, w.rpe, or any raw HR/RPE data at
  // all — getSessionCVEndurance() inside computeRadarValuesForSession
  // silently fails on them every time, which meant Cardio Intensity and
  // Cardio Strain were always exactly zero on this chart, regardless of
  // real training data, producing a visibly smaller/collapsed shape
  // than the session signature's overlay (which correctly uses real
  // entries via the same helper).
  const radarAvg = computeRadarAverage(rawData);

  el.innerHTML = `
    <div class="chart-card" onclick="openPowerScatterFullscreen()">
      <div class="chart-title">${t('chart.powerscatter.x')} / ${t('chart.powerscatter.y')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div class="chart-container"><canvas id="chart-power-scatter"></canvas></div>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.totalwork'), 'totalwork')">
      <div class="chart-title">${t('chart.totalwork')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div style="font-size:.68rem;color:var(--label);margin-top:-4px;margin-bottom:6px;">
        6-Wk Avg: ${avgWeeklyKj} kJ/wk${trendPct != null ? ` <span style="color:${tSlope >= 0 ? '#22C55E' : '#EF4444'};font-weight:700;">${tSlope >= 0 ? '↑' : '↓'} ${Math.abs(trendPct)}%</span>` : ''}
      </div>
      <div class="chart-container"><canvas id="chart-totalwork"></canvas></div>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.kcal'), 'kcal')">
      <div class="chart-title">${t('chart.kcal')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div style="font-size:.68rem;color:var(--label);margin-top:-4px;margin-bottom:6px;">6-Wk Avg: ${avgMcWeekly} kcal/wk</div>
      <div class="chart-container"><canvas id="chart-kcal"></canvas></div>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.peakload'), 'peakload')">
      <div class="chart-title">${t('chart.peakload')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div class="chart-container"><canvas id="chart-peakload"></canvas></div>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.scatter'), 'scatter')">
      <div class="chart-title">${t('chart.scatter')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div class="chart-container"><canvas id="chart-scatter"></canvas></div>
    </div>
    <div class="chart-card" onclick="openFbDurationFullscreen()">
      <div class="chart-title">${t('chart.fbduration')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div class="chart-container"><canvas id="chart-fbduration"></canvas></div>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.radar'), 'profile')">
      <div class="chart-title">${t('chart.radar')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <canvas id="chart-profile" style="width:100%;display:block;margin:0 auto;"></canvas>
    </div>
    <div class="chart-card" onclick="openChartFullscreen(t('chart.movbias'), 'movbias')">
      <div class="chart-title">${t('chart.movbias')} <span class="chart-expand-hint">${t('chart.expand')}</span></div>
      <div class="chart-container"><canvas id="chart-movbias"></canvas></div>
    </div>`;

  chartInstances.scatter = new Chart(document.getElementById('chart-scatter'), scatterCfg);
  renderFbDurationChart();
  renderPowerScatterChart();
  // ── Movement Pattern weekly aggregation ──
  const PATTERN_META_6WK = getPATTERNMETA();
  const patternKeys6wk = Object.keys(PATTERN_META_6WK);
  const movPatternWeekMap = {};
  rawData.forEach(w => {
    const d = new Date(w.date.slice(0,10) + 'T12:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const wk = monday.toISOString().slice(0,10);
    if (!movPatternWeekMap[wk]) {
      movPatternWeekMap[wk] = { date: wk };
      patternKeys6wk.forEach(k => { movPatternWeekMap[wk][k] = 0; });
    }
    const wkd = movPatternWeekMap[wk];
    // Use mc (metabolic cost) as weight — correctly captures cardio sessions
    // where wd≈0 but mc_aero is high (e.g. 5k run)
    const mc = parseFloat(w.mc) || parseFloat(w.wd) || 0;
    let pp = w.patternProfile;
    if (typeof pp === 'string') { try { pp = JSON.parse(pp); } catch(e) { pp = null; } }
    const pct = pp?.patternPct;
    if (pct && mc > 0) {
      patternKeys6wk.forEach(k => { wkd[k] += (pct[k] || 0) * mc; });
    }
  });
  const movPatternWeeks = Object.values(movPatternWeekMap).sort((a,b) => a.date.localeCompare(b.date));
  const movBiasLabels = movPatternWeeks.map(w => {
    const d = new Date(w.date + 'T12:00:00');
    return 'W' + (d.getMonth()+1) + '/' + d.getDate();
  });

  // 6-week movement pattern totals for donut
  const totalPatternByKey = {};
  patternKeys6wk.forEach(k => { totalPatternByKey[k] = movPatternWeeks.reduce((s,w) => s + w[k], 0); });
  const totalPatternSum = Object.values(totalPatternByKey).reduce((a,b) => a+b, 0);
  const patternPct6ByKey = {};
  patternKeys6wk.forEach(k => { patternPct6ByKey[k] = totalPatternSum > 0 ? Math.round(totalPatternByKey[k] / totalPatternSum * 100) : 0; });
  // Only chart patterns that actually appear across the window — with 9
  // categories, most 6-week windows won't touch all of them, and an empty
  // slice adds nothing.
  const chartedPatternKeys = patternKeys6wk.filter(k => patternPct6ByKey[k] > 0);

  // Real per-pattern session counts and top exercises — built fresh by
  // walking raw movement data directly, since neither exists anywhere
  // else. The previous center display showed rawData.length (total
  // sessions across ALL patterns) regardless of which pattern was
  // dominant — a real inaccuracy, not just a missing feature, since a
  // dynamic per-pattern inspector needs the tapped pattern's own count,
  // not the whole window's.
  const patternSessionSets = {};
  const patternExerciseCounts = {};
  patternKeys6wk.forEach(k => { patternSessionSets[k] = new Set(); patternExerciseCounts[k] = {}; });
  rawData.forEach((w, idx) => {
    const seenThisSession = new Set();
    (w.blocks || []).forEach(block => {
      (block.movements || []).forEach(mv => {
        const patKey = getMovementPattern(mv.name);
        if (!patKey || !patternExerciseCounts[patKey]) return;
        patternExerciseCounts[patKey][mv.name] = (patternExerciseCounts[patKey][mv.name] || 0) + 1;
        seenThisSession.add(patKey);
      });
    });
    seenThisSession.forEach(k => patternSessionSets[k].add(idx));
  });
  const patternSessionCounts = {};
  const patternTopExercises = {};
  patternKeys6wk.forEach(k => {
    patternSessionCounts[k] = patternSessionSets[k].size;
    patternTopExercises[k] = Object.entries(patternExerciseCounts[k])
      .sort((a,b) => b[1]-a[1]).slice(0,3).map(([name]) => name);
  });
  // Average weekly kcal contribution per pattern — same totalPatternByKey
  // already computed above, just divided across the actual number of
  // charted weeks rather than re-deriving it a second way.
  const patternAvgKcalByKey = {};
  patternKeys6wk.forEach(k => { patternAvgKcalByKey[k] = movPatternWeeks.length ? Math.round(totalPatternByKey[k] / movPatternWeeks.length) : 0; });

  const donutScales = { x: { display: false }, y: { display: false } };
  const sessionCount6 = rawData.length;

  // Static biomechanical focus descriptions — not derived from data,
  // one accurate line per pattern for the persistent card.
  const PATTERN_ICONS = {
    'pattern.squat': '🦵', 'pattern.hinge': '🏋️', 'pattern.push': '👐', 'pattern.pull': '🪢',
    'pattern.olympic': '⚡', 'pattern.core': '🎯', 'pattern.carry': '🎒', 'pattern.handstand': '🤸',
    'pattern.monostructural': '🏃'
  };
  const PATTERN_BIOMECH_FOCUS = {
    'pattern.squat': t('pattern.squat.biomech') || 'Knee-Dominant Lower Body',
    'pattern.hinge': t('pattern.hinge.biomech') || 'Hip-Dominant Posterior Chain',
    'pattern.push': t('pattern.push.biomech') || 'Upper Body Pressing',
    'pattern.pull': t('pattern.pull.biomech') || 'Upper Body Pulling',
    'pattern.olympic': t('pattern.olympic.biomech') || 'Full-Body Triple Extension',
    'pattern.core': t('pattern.core.biomech') || 'Trunk Stability & Flexion',
    'pattern.carry': t('pattern.carry.biomech') || 'Loaded Grip & Trunk Stability',
    'pattern.handstand': t('pattern.handstand.biomech') || 'Shoulder Stability & Balance',
    'pattern.monostructural': t('pattern.monostructural.biomech') || 'Cyclical Cardiovascular'
  };
  // Push/Pull balance alert — only these two have a natural opposite to
  // compare against; every other pattern (Squat, Olympic, Core, etc.)
  // has no obvious complementary pair, so this stays specific to the
  // one relationship where it actually means something.
  function getPushPullBalance() {
    const pushPct = patternPct6ByKey['pattern.push'] || 0;
    const pullPct = patternPct6ByKey['pattern.pull'] || 0;
    if (pushPct <= 0 || pullPct <= 0) return null;
    const ratio = pushPct / pullPct;
    const ratioText = ratio >= 1 ? `${ratio.toFixed(1)}:1` : `1:${(1/ratio).toFixed(1)}`;
    let key = 'balanced';
    if (ratio > 1.25) key = 'push_dominant';
    else if (ratio < 0.8) key = 'pull_dominant';
    const labels = {
      balanced: t('movbias.balance.balanced') || 'Well Balanced',
      push_dominant: t('movbias.balance.pushdom') || 'Push-Dominant — consider more pulling volume',
      pull_dominant: t('movbias.balance.pulldom') || 'Pull-Dominant — consider more pushing volume'
    };
    return `${t('movbias.balance.label') || 'Push vs Pull Ratio'}: ${ratioText} — ${labels[key]}`;
  }
  const pushPullBalanceAlert = getPushPullBalance();

  const movbiasCfg = {
    type: 'doughnut',
    data: { labels: chartedPatternKeys.map(k => PATTERN_META_6WK[k].label),
      datasets: [{ data: chartedPatternKeys.map(k => patternPct6ByKey[k]),
        backgroundColor: chartedPatternKeys.map(k => PATTERN_META_6WK[k].color + 'cc'),
        borderColor:     chartedPatternKeys.map(k => PATTERN_META_6WK[k].color),
        borderWidth: 2, hoverOffset: 8
      }]
    },
    options: { ...baseOpts,
      cutout: '68%',
      scales: donutScales,
      plugins: { ...baseOpts.plugins,
        // Compact card keeps the simple built-in legend, unchanged —
        // the fullscreen-specific config below is where the custom
        // vertical table replaces it, not here. Splitting into two
        // config objects (not one shared/mutated one) mirrors the same
        // peakCfg/peakCfgFullscreen approach already used for Peak Load.
        legend: { display: true, position: 'bottom', labels: { color: lc, font: { size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: { callbacks: { label: v => `${v.label}: ${v.raw}%` } }
      }
    },
    plugins: [{
      id: 'patternCenter',
      afterDraw(chart) {
        const { ctx, chartArea: { left, top, right, bottom } } = chart;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const vals = chartedPatternKeys.map(k => ({ key: k, label: PATTERN_META_6WK[k].label, v: patternPct6ByKey[k] }));
        if (!vals.length) return;
        const dominant = vals.reduce((a,b) => b.v > a.v ? b : a, vals[0]);
        const realSessionCount = patternSessionCounts[dominant.key] || 0;
        const lineH = 17;
        const totalH = lineH * 2;
        const startY = cy - totalH / 2 + 6;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = lc;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(dominant.label, cx, startY);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`${dominant.v}%`, cx, startY + lineH);
        ctx.font = '10px sans-serif';
        ctx.globalAlpha = 0.6;
        ctx.fillText(`${realSessionCount} ${realSessionCount === 1 ? 'session' : 'sessions'}`, cx, startY + lineH * 2);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }]
  };

  // Separate fullscreen-specific config — legend disabled (replaced by
  // the custom vertical table), center plugin responds to a focused-
  // pattern state set by tapping a slice or a legend-table row.
  const movbiasCfgFullscreen = {
    ...movbiasCfg,
    data: JSON.parse(JSON.stringify(movbiasCfg.data)),
    options: { ...movbiasCfg.options,
      plugins: { ...movbiasCfg.options.plugins,
        legend: { display: false },
        tooltip: movbiasCfg.options.plugins.tooltip
      }
    },
    plugins: [{
      id: 'patternCenterFocusable',
      afterDraw(chart) {
        const { ctx, chartArea: { left, top, right, bottom } } = chart;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const vals = chartedPatternKeys.map(k => ({ key: k, label: PATTERN_META_6WK[k].label, v: patternPct6ByKey[k] }));
        if (!vals.length) return;
        const focusedKey = window._movbiasFocusedKey;
        const shown = focusedKey ? vals.find(v => v.key === focusedKey) : null;
        const display = shown || vals.reduce((a,b) => b.v > a.v ? b : a, vals[0]);
        const realSessionCount = patternSessionCounts[display.key] || 0;
        const lineH = 17;
        const totalH = lineH * 2;
        const startY = cy - totalH / 2 + 6;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = lc;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(display.label, cx, startY);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`${display.v}%`, cx, startY + lineH);
        ctx.font = '10px sans-serif';
        ctx.globalAlpha = 0.6;
        ctx.fillText(`${realSessionCount} ${realSessionCount === 1 ? 'session' : 'sessions'}`, cx, startY + lineH * 2);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }],
    chartedPatternKeys, patternPct6ByKey, patternSessionCounts, patternTopExercises,
    patternAvgKcalByKey, PATTERN_ICONS, PATTERN_BIOMECH_FOCUS, pushPullBalanceAlert,
    patternMetaSnapshot: Object.fromEntries(chartedPatternKeys.map(k => [k, { label: PATTERN_META_6WK[k].label, color: PATTERN_META_6WK[k].color }]))
  };

  chartInstances.totalwork = new Chart(document.getElementById('chart-totalwork'), totalworkCfg);
  chartInstances.movbias = new Chart(document.getElementById('chart-movbias'), movbiasCfg);
  chartInstances.kcal    = new Chart(document.getElementById('chart-kcal'),    kcalCfg);

  // Render 6-week profile radar — always render if data available
  render6WeekRadar(document.getElementById('chart-profile'), radarAvg);

  // ── Weekly Peak Load trend chart ──
  // Bars: peak RL for sessions >= 70% (strength sessions only)
  // Line: average RL across ALL sessions with 1RM data that week
  //
  // Extracted into its own function (not left inline) so the fullscreen
  // view's Movement Pattern filter can rebuild this chart with a
  // different pattern on demand, without needing to re-run the whole
  // Analytics screen. patternFilter=null (the default, used here for
  // the in-page card) preserves the exact original all-movements
  // behavior — reads the stored w.rl field directly, no recomputation
  // needed. A specific pattern key forces a fresh per-session
  // reconstruction via reconstructRL(w, patternFilter), since the
  // stored w.rl is always the all-patterns peak and can't answer a
  // pattern-scoped question.
  //
  // showTonnageFooter (default false): the compact in-page card and the
  // fullscreen view's config both come from this same function, and
  // Chart.js tooltips work on both regardless of canvas size — an
  // earlier version of this assumed the compact card had no tooltip
  // interaction at all, which was simply wrong. Defaulting this to
  // false and only passing true for the fullscreen-specific config
  // keeps Heavy Tonnage out of the compact card's tooltip, as intended.
  function buildPeakLoadChartConfig(patternFilter = null, showTonnageFooter = false) {
    const allHistPeak = getHistory();
    const sixWeeksAgoPeak = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000);

    const peakWeekMap = {};
    allHistPeak.filter(w => w.date && new Date(w.date) >= sixWeeksAgoPeak).forEach(w => {
      // Always recomputed fresh, with context (movement + weight),
      // rather than reading the stored w.rl field for the no-filter
      // case as before — that field carries the same potential formula-
      // drift risk already found in entry.fb earlier tonight, and using
      // it here would mean sessionPeakRL and its own movement context
      // could come from two different computations that might disagree.
      // One call, one source of truth for both.
      const rlContext = reconstructRL(w, patternFilter, true);
      const sessionPeakRL = rlContext.rl;
      if (!sessionPeakRL) return;

      const d = new Date(w.date);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const wk = localDateStr(monday);
      if (!peakWeekMap[wk]) peakWeekMap[wk] = { peak: 0, truePeak: 0, avgSum: 0, avgCount: 0, heavyTonnage: 0, peakMovement: null, peakWeight: null };
      if (sessionPeakRL >= 70 && sessionPeakRL > peakWeekMap[wk].peak)
        peakWeekMap[wk].peak = sessionPeakRL;
      // truePeak — unrestricted by the 70% threshold, unlike peak above.
      // The insight card should show the real peak RL for whichever week
      // is selected even if it never crossed 70%, not just show nothing
      // for a lighter week — the bars staying threshold-gated is correct
      // for the chart itself, but the card is meant to answer "what
      // happened this week," not just "was this a heavy week."
      if (sessionPeakRL > peakWeekMap[wk].truePeak) {
        peakWeekMap[wk].truePeak = sessionPeakRL;
        // Movement context updates ALONGSIDE truePeak, from the exact
        // same rlContext object — can't end up describing a different
        // session's peak than the number being shown.
        peakWeekMap[wk].peakMovement = rlContext.movementName;
        peakWeekMap[wk].peakWeight = rlContext.weight;
      }
      peakWeekMap[wk].avgSum   += sessionPeakRL;
      peakWeekMap[wk].avgCount += 1;
      // Heavy Tonnage — same patternFilter as everything else here, so
      // selecting "Squat" shows squat-only tonnage, not the whole
      // session's. Only worth computing for sessions that already
      // cleared the sessionPeakRL check above (cheap early-out — a
      // session with no qualifying RL at all can't have any heavy-
      // tonnage sets either).
      peakWeekMap[wk].heavyTonnage += reconstructHeavyTonnage(w, patternFilter, 70);
    });

    const peakWeekKeys = Object.keys(peakWeekMap).sort();
    const peakLabels   = peakWeekKeys.map(k => {
      const d = new Date(k + 'T12:00:00');
      return (d.getMonth()+1) + '/' + d.getDate();
    });
    const peakBarData  = peakWeekKeys.map(k => peakWeekMap[k].peak > 0 ? Math.round(peakWeekMap[k].peak * 10) / 10 : null);
    const peakAvgData  = peakWeekKeys.map(k => {
      const d = peakWeekMap[k];
      return d.avgCount > 0 ? Math.round((d.avgSum / d.avgCount) * 10) / 10 : null;
    });
    const peakHeavyTonnageData = peakWeekKeys.map(k => Math.round(peakWeekMap[k].heavyTonnage));
    // Feeds the persistent insight card — one entry per week, in the
    // same order/index as every other array here, so a bar's click
    // index maps directly to its insight data with no separate lookup.
    const weeklyInsightData = peakWeekKeys.map((k, i) => ({
      weekLabel: peakLabels[i],
      truePeakRL: Math.round(peakWeekMap[k].truePeak * 10) / 10,
      heavyTonnage: peakHeavyTonnageData[i],
      peakMovement: peakWeekMap[k].peakMovement,
      peakWeight: peakWeekMap[k].peakWeight
    }));

    const red    = '#EF4444';
    const yMax   = Math.ceil((Math.max(...peakBarData.filter(v=>v!=null), ...peakAvgData.filter(v=>v!=null), 100) + 5) / 10) * 10;

    const threshold70Plugin = {
      id: 'threshold70',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right }, scales: { y } } = chart;
        const yPos = y.getPixelForValue(70);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255,107,53,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, yPos);
        ctx.lineTo(right, yPos);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 10px sans-serif';
        ctx.fillStyle = 'rgba(255,107,53,0.8)';
        ctx.textAlign = 'right';
        ctx.fillText(t('peak.threshold'), right - 4, yPos - 4);
        ctx.restore();
      }
    };

    return {
      type: 'bar',
      data: { labels: peakLabels, datasets: [
        {
          type: 'bar',
          data: peakBarData,
          backgroundColor: peakBarData.map(v =>
            v == null ? 'transparent' :
            v >= 90 ? 'rgba(239,68,68,0.5)' :
            v >= 75 ? 'rgba(245,158,11,0.5)' :
                      'rgba(34,197,94,0.5)'
          ),
          borderColor: peakBarData.map(v =>
            v == null ? 'transparent' :
            v >= 90 ? 'rgba(239,68,68,0.8)' :
            v >= 75 ? 'rgba(245,158,11,0.8)' :
                      'rgba(34,197,94,0.8)'
          ),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
          label: t('peak.bars.label'),
          order: 2
        },
        {
          type: 'line',
          data: peakAvgData,
          borderColor: red,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          tension: 0.3,
          pointBackgroundColor: peakAvgData.map(v => v == null ? 'transparent' : red),
          pointBorderColor: peakAvgData.map(v => v == null ? 'transparent' : 'white'),
          pointBorderWidth: 1.5,
          pointRadius: 5,
          spanGaps: true,
          label: t('peak.line.label'),
          order: 1
        }
      ]},
      options: { ...baseOpts,
        onClick: (evt, elements) => {
          if (!elements.length) return;
          if (typeof window._onPeakLoadBarClick === 'function') window._onPeakLoadBarClick(elements[0].index, weeklyInsightData);
        },
        scales: { ...baseOpts.scales,
          x: { ...baseOpts.scales.x, stacked: false },
          y: { ...baseOpts.scales.y, min: 0, max: yMax,
            ticks: { ...baseOpts.scales.y.ticks, callback: v => v + '%' }
          }
        },
        plugins: { ...baseOpts.plugins,
          legend: { display: true, labels: { color: lc, font:{ size:10 }, padding:8,
            boxWidth: 0, boxHeight: 0,
            generateLabels: chart => chart.data.datasets.map((ds, i) => ({
              text: ds.label,
              fillStyle: 'transparent',
              strokeStyle: 'transparent',
              fontColor: lc,
              lineWidth: 0,
              hidden: false,
              datasetIndex: i
            }))
          } },
          tooltip: { callbacks: {
            label: v => v.dataset.label + ': ' + (v.raw != null ? v.raw + t('peak.pct.1rm') : '—')
            // Heavy Tonnage footer removed — the persistent insight card
            // (built alongside this) now shows Peak RL + Heavy Tonnage
            // together, more prominently and without needing a hover/
            // tap-and-hold gesture, so keeping both would be redundant.
          }}
        }
      },
      plugins: [ threshold70Plugin, avgLinePlugin(100, 'rgba(239,68,68,.4)', t('peak.1rm.line')) ],
      _peakWeekKeysLength: peakWeekKeys.length, // stashed for the caller's empty-state check below, without recomputing
      weeklyInsightData // consumed by the persistent insight card via options.onClick above
    };
  }

  const peakCfg = buildPeakLoadChartConfig(null);
  // Separate config for the fullscreen snapshot — same data (no filter
  // yet, matching the compact card), but with the tonnage footer
  // enabled. Building this as its own call rather than reusing peakCfg
  // is what actually keeps Heavy Tonnage out of the compact card: they
  // need to be genuinely different objects, not the same one shared
  // between two contexts that want different tooltip behavior.
  const peakCfgFullscreen = buildPeakLoadChartConfig(null, true);
  // Exposed globally so the fullscreen view's Movement Pattern dropdown
  // can rebuild this chart with a different filter on demand —
  // openChartFullscreen() is a separate top-level function and can't
  // otherwise reach a function nested inside renderAnalytics(). Same
  // "snapshot taken once, reused later" tradeoff the existing
  // _fsChartData.peakload re-render already has (closes over baseOpts/lc
  // as of whenever renderAnalytics() last ran) — not a new staleness
  // risk, just applying the same existing pattern to a second case.
  window.buildPeakLoadChartConfig = buildPeakLoadChartConfig;
  const peakWeekKeys = { length: peakCfg._peakWeekKeysLength }; // preserves the exact original variable name/shape for the empty-state check just below, unchanged

  const peakCanvas = document.getElementById('chart-peakload');
  if (peakCanvas) {
    if (peakWeekKeys.length > 0) {
      chartInstances.peakload = new Chart(peakCanvas, peakCfg);
    } else {
      peakCanvas.closest('.chart-card').innerHTML += `<div style="text-align:center;font-size:.78rem;color:var(--label);padding:20px 0;">${t('peak.no.sessions')}</div>`;
    }
  }

  // ── e1RM Trend chart (fullscreen tab, alongside Weekly Peak Load) ──
  // Full history, not the 6-week window everything else uses — strength
  // trends need a real timescale to show anything meaningful in. One
  // point per session where the selected movement was actually trained
  // within the rep cutoff (see reconstructE1RM) — sessions where it
  // wasn't contribute nothing, not a gap filled with an assumed value.
  function buildE1RMChartConfig(movementName) {
    const hist = getHistory()
      .filter(w => w.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels = [];
    const dataVals = [];
    const fullDates = [];
    hist.forEach(w => {
      const e1rm = reconstructE1RM(w, movementName);
      if (e1rm == null) return;
      const d = new Date(w.date);
      labels.push((d.getMonth()+1) + '/' + d.getDate());
      dataVals.push(e1rm);
      fullDates.push((d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear());
    });

    const blue = '#60A5FA';
    return {
      type: 'line',
      data: { labels, datasets: [{
        label: movementName,
        data: dataVals,
        borderColor: blue,
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        tension: 0.25,
        pointBackgroundColor: blue,
        pointBorderColor: 'white',
        pointBorderWidth: 1.5,
        pointRadius: 5,
        pointHoverRadius: 7,
        spanGaps: true
      }]},
      options: { ...baseOpts,
        scales: {
          x: { ...baseOpts.scales.x, grid: { color: gc }, ticks: { color: lc } },
          y: { ...baseOpts.scales.y, ticks: { ...baseOpts.scales.y.ticks, callback: v => v + ' kg' } }
        },
        plugins: { ...baseOpts.plugins,
          legend: { display: false },
          tooltip: { callbacks: {
            title: items => fullDates[items[0]?.dataIndex] || '',
            label: v => `${movementName}: ${v.raw} kg e1RM`
          }}
        }
      },
      _pointCount: dataVals.length
    };
  }
  window.buildE1RMChartConfig = buildE1RMChartConfig;
  window.getTrainedE1RMMovements = getTrainedE1RMMovements;

  // Store configs for fullscreen re-render
  _fsChartData = Object.assign(_fsChartData || {}, { scatter: scatterCfg, totalwork: totalworkCfg, movbias: movbiasCfgFullscreen, kcal: kcalCfg, profileAvg: radarAvg, peakload: peakCfgFullscreen });
}

function getStrengthThreshold() {
  // Use 67th percentile of all-time Force Bias as strength-dominant threshold
  const hist = getHistory();
  const fbVals = hist.map(w => parseFloat(w.fb)||0).filter(v => v > 0).sort((a,b) => a-b);
  if (fbVals.length < 5) return 50; // fallback if insufficient data
  return fbVals[Math.floor(fbVals.length * 0.67)];
}

function getRecoveryFromEntry(w) {
  // Recovery model based on ACTUAL peak load (kg / movement 1RM)
  // Only applies to strength-dominant sessions with blocks stored
  let blocks;
  try { blocks = typeof w.blocks === 'string' ? JSON.parse(w.blocks) : w.blocks; } catch(e) { return null; }
  if (!blocks?.length) return null;

  // Get completed rounds from detail string
  const detailRoundsMatch = (w.detail||'').match(/Result: (\d+) rounds/);
  const completedRounds = detailRoundsMatch ? parseInt(detailRoundsMatch[1])||1 : 1;

  // Find peak RL by looking up each movement's 1RM
  let peakRL = 0, peakKg = 0, peakReps = 0, peakName = '';
  blocks.forEach(b => {
    const completedRoundsBlock = b.result?.r || completedRounds;
    const goalRoundsBlock = parseInt(b.target) || completedRoundsBlock;
    (b.movements||[]).forEach(mv => {
      const baseKg = parseFloat(mv.kg)||0;
      const rawReps = parseFloat(mv.reps)||0;
      const isMaxReps = rawReps >= 999;
      if (baseKg <= 0) return;
      const prKey = RM_MAP[mv.name] || RM_MAP[mv.name?.split(' (')[0]];
      if (!prKey) return;
      const oneRM = parseFloat(document.getElementById(prKey)?.value) || 0;
      if (!oneRM) return;

      // Find peak weight — for weight ladders scan all completed rounds
      let peakKgMv = baseKg;
      let peakRoundIdxMv = -1;
      const wtLadderTypeMv = mv.wtLadderType || 'fixed';
      if (wtLadderTypeMv !== 'fixed') {
        const inc = parseFloat(mv.wtLadderInc) || 5;
        const completedR = Math.min(completedRoundsBlock, goalRoundsBlock);
        for (let ri = 0; ri < completedR; ri++) {
          let roundWt = baseKg;
          if (wtLadderTypeMv === 'ascending')  roundWt = Math.round((baseKg + inc * ri) * 10) / 10;
          else if (wtLadderTypeMv === 'descending') roundWt = Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10);
          else if (wtLadderTypeMv === 'pyramid') {
            const half = Math.ceil(completedR / 2);
            roundWt = ri < half ? Math.round((baseKg + inc * ri) * 10) / 10 : Math.round((baseKg + inc * (completedR - ri - 1)) * 10) / 10;
          } else if (wtLadderTypeMv === 'valley') {
            const half = Math.ceil(completedR / 2);
            roundWt = ri < half ? Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10) : Math.max(0, Math.round((baseKg - inc * (completedR - ri - 1)) * 10) / 10);
          }
          if (roundWt > peakKgMv) { peakKgMv = roundWt; peakRoundIdxMv = ri; }
        }
      }

      const rl = (peakKgMv / oneRM) * 100;
      if (rl > peakRL) {
        peakRL = rl;
        peakKg = peakKgMv;
        peakName = mv.name || '';
        // Reps at peak: for max reps use entered; for weight ladder use reps at that round; else fixed × rounds
        if (isMaxReps) {
          peakReps = parseFloat(mv.maxRepsEntered)||0;
        } else if (peakRoundIdxMv >= 0 && b.ladderType && b.ladderType !== 'fixed') {
          // Block has a rep ladder — get reps at the round with peak weight
          const repStart = parseInt(b.ladderStart) || rawReps;
          const repInc   = parseInt(b.ladderInc)   || 0;
          const ladderT  = b.ladderType;
          const half = Math.ceil(completedRoundsBlock / 2);
          if (ladderT === 'descending')  peakReps = Math.max(1, repStart - repInc * peakRoundIdxMv);
          else if (ladderT === 'ascending') peakReps = repStart + repInc * peakRoundIdxMv;
          else if (ladderT === 'pyramid') peakReps = peakRoundIdxMv < half ? repStart + repInc * peakRoundIdxMv : repStart + repInc * (completedRoundsBlock - peakRoundIdxMv - 1);
          else if (ladderT === 'valley')  peakReps = peakRoundIdxMv < half ? Math.max(1, repStart - repInc * peakRoundIdxMv) : Math.max(1, repStart - repInc * (completedRoundsBlock - peakRoundIdxMv - 1));
          else peakReps = rawReps;
        } else if (wtLadderTypeMv !== 'fixed' && peakRoundIdxMv >= 0) {
          // Weight ladder but no rep ladder — fixed reps per round
          peakReps = rawReps;
        } else {
          peakReps = rawReps;
        }
      }
    });
  });

  // Only trigger recovery when a specific movement with matched 1RM was found
  // and the load is genuinely heavy (≥70% of 1RM)
  if (!peakRL || peakRL < 70) return null;
  const effectiveRL = peakRL;
  const hasPRData = true;

  // Base recovery from peak RL
  let baseHours;
  if      (effectiveRL >= 90) baseHours = 72;
  else if (effectiveRL >= 75) baseHours = 48;
  else if (effectiveRL >= 55) baseHours = 36;
  else                        baseHours = 24;

  // Volume addition at peak load
  let addHours = 0;
  if      (peakReps >= 7) addHours = 24;
  else if (peakReps >= 4) addHours = 12;

  const totalHours = baseHours + addHours;

  return {
    peakKg, peakReps, peakName,
    rl: Math.round(effectiveRL),
    hasPRData,
    hours: totalHours,
    label: totalHours + 'h',
    color: totalHours >= 72 ? '#EF4444' : totalHours >= 48 ? '#F59E0B' : '#22C55E',
    rec: `Allow ${totalHours}h before next heavy ${peakName ? peakName.toLowerCase() + ' / ' : ''}${getPatternLabel(getMovementPattern(peakName))} session`
  };
}

function getMovementPattern(name) {
  // Hyphens normalized to spaces before matching — the previous version
  // checked for "double under" (space) while the actual stored name is
  // "Double-under" (hyphen), so double-unders and single-unders were
  // never actually being excluded as cardio despite the exclusion clearly
  // being intended. Normalizing once here, rather than special-casing
  // that one pair, also protects every other keyword check below from
  // the same class of mismatch.
  const n = (name||'').toLowerCase().replace(/-/g, ' ');
  // Monostructural — cyclical, single-modality cardio movements. Named
  // "monostructural" rather than "cardio" for consistency with every
  // other category here describing movement structure/mechanics (how the
  // body moves), not physiological effect — the same framing "hinge" or
  // "push" use, not a category jump to describe what it trains. Also the
  // standard CrossFit-methodology term for this exact grouping.
  if (n.includes('run') || n.includes('ski erg') || n.includes('bike erg')
   || n.includes('assault bike') || n.includes('echo bike') || n.includes('air bike')
   || n.includes('swim') || n.includes('jump rope') || n.includes('double under')
   || n.includes('single under') || n.includes('per 100m') || n.includes('per km')
   || n.includes('cal row') || n.includes('row (cal') || n.includes('row (per')
   ) return 'pattern.monostructural';
  if (n.includes('squat') || n.includes('lunge')
   || n.includes('wall ball') || n.includes('slam ball')
   // Thruster is a front squat directly into a push press with no pause
   // — classified by its first, load-bearing phase, same principle
   // already applied to Wall Ball/Slam Ball (squat-to-throw). Box Jump/
   // Box Step-up are cleanly knee/hip-dominant lower-body movements
   // (explosive or controlled), with no upper-body component muddying
   // the classification the way Burpee's does — but "Burpee Box
   // Jump-over" contains "box jump" too, and needs to fall through to
   // the burpee->push check below instead, not get caught here first.
   || n.includes('thruster')
   || ((n.includes('box jump') || n.includes('box step')) && !n.includes('burpee'))) return 'pattern.squat';
  // Kettlebell Swing, the GHD extension family, and Kettlebell Windmill
  // are hip-hinge movements, but were falling through to the catch-all —
  // the original keyword check only looked for "deadlift"/"rdl"/"good
  // morning". Barbell Hip Thrust is the same hip-extension pattern as
  // the GHD extension family, just loaded differently.
  if (n.includes('deadlift') || n.includes('rdl') || n.includes('good morning')
   || n.includes('kettlebell swing') || n.includes('extension')
   || n.includes('hip thrust') || n.includes('windmill')) return 'pattern.hinge';
  // Dip/Ring Dip are pressing movements but "dip" alone wasn't checked.
  // Burpee (and its Box Jump-over/Inverted variants) and Wall Walk both
  // have a genuine, load-bearing pressing component — Burpee's push-up
  // is typically the limiting element of the movement, and Wall Walk is
  // a dynamic, weight-bearing shoulder press-type effort as the feet
  // walk up the wall, unlike a static handstand hold (see pattern.handstand
  // below) — so both are grouped with Push-up/HSPU here rather than
  // treated as balance/skill work.
  //
  // "jerk" explicitly excluded here — Push Jerk contains "push" and was
  // being caught by this check before ever reaching the olympic check
  // below, despite the olympic check's own comment clearly intending
  // "jerk" to land there. Push Press has no such conflict (no "jerk" in
  // the name) and is unaffected, still correctly classified as push.
  if ((n.includes('press') || n.includes('push') || n === 'dip' || n.includes('ring dip')
   || n.includes('burpee') || n.includes('wall walk')) && !n.includes('jerk')) return 'pattern.push';
  // Muscle-ups are fundamentally a pulling movement (the pull-up phase
  // that defines the skill), and rope climbs are a vertical grip-pull —
  // neither contains "pull"/"row"/"chin" so both were falling through.
  if (n.includes('row') || n.includes('pull') || n.includes('chin')
   || n.includes('muscle up') || n.includes('rope climb')) return 'pattern.pull';
  // Sandbag Over Shoulder is an explosive, ground-to-shoulder movement —
  // same fundamental character as a Clean, just with a sandbag instead
  // of a barbell.
  if (n.includes('clean') || n.includes('snatch') || n.includes('jerk')
   || n.includes('sandbag over shoulder')) return 'pattern.olympic';
  // Core: direct trunk flexion/anti-extension work — doesn't belong under
  // any of the four limb-dominant patterns above. Turkish Get-up is
  // multi-phase (hinge, press, lunge all appear in one rep), but what
  // actually makes it hard — and what it's genuinely training — is
  // maintaining core stability under a dynamic, shifting base of support
  // throughout, not any single one of those individually low-load phases.
  if (n.includes('sit up') || n.includes('toes to bar') || n.includes('toes to rings')
   || n.includes('knees to elbows') || n.includes('l sit')
   || n.includes('turkish get up')) return 'pattern.core';
  // Carry: sustained loaded posture and grip — a genuinely different
  // demand than a "move through range" rep pattern.
  if (n.includes('carry') || n.includes('farmers') || n.includes("farmer's")) return 'pattern.carry';
  // Handstand/Handstand Walk get their own category rather than being
  // folded into an existing one — static balance/positional skill work,
  // with no rep-through-range pattern at all, isn't the same kind of
  // thing any of the limb-dominant or core/carry categories are
  // measuring. (Handstand Push-up is already caught by pattern.push
  // above, since it contains "push" — this only catches the plain hold
  // and the walk.)
  if (n.includes('handstand')) return 'pattern.handstand';
  return 'pattern.strength';
}
// Translate pattern key to display string
function getPatternLabel(key) {
  return t(key) || key;
}


function getRecTime(rl) {
  if (rl >= 90) return '72h recovery recommended before next heavy session';
  if (rl >= 75) return '48h recovery recommended before next heavy session';
  if (rl >= 55) return '24–36h recovery recommended';
  return null;
}

function getSessionReps(w) {
  // Extract total reps from history entry detail string
  if (!w.blocks) return 0;
  let total = 0;
  try {
    const blocks = JSON.parse(w.blocks);
    blocks.forEach(b => {
      const rounds = parseInt(b.resR) || 1;
      (b.movements || []).forEach(mv => {
        const reps = parseFloat(mv.reps) || 0;
        if (reps < 999) total += reps * rounds;
      });
    });
  } catch(e) {}
  return total;
}

// ── Structural Fatigue Model ─────────────────────────────────────────────
// Tracks cumulative Force Bias decay over 48h time constant
// Only activates with 10+ sessions (Phase 2+)
function getStructuralFatigue() {
  const hist = getHistory();
  if (!hist.length) return null;
  const now = Date.now();
  const currentBw = parseFloat(document.getElementById('global-w')?.value) || 75;

  // ── Variable half-life based on mc_mech intensity (kcal/min/kg) ───────
  const halfLifeDays = mc_mech_int => {
    if (mc_mech_int > 0.06)  return 3;    // 72h — heavy barbell dominant
    if (mc_mech_int > 0.04)  return 2;    // 48h — strength biased
    if (mc_mech_int > 0.025) return 1.5;  // 36h — moderate barbell
    if (mc_mech_int > 0.01)  return 1;    // 24h — light barbell / mixed
    return 0.5;                            // 12h — minimal structural load
  };

  // ── Per-session duration ───────────────────────────────────────────────
  function getSessionDuration(w) {
    // Plan sessions: simResults has user-entered timing — takes priority over blocks[].result
    // which may contain stale cap/default values
    const fromSim = (w.simResults||[]).reduce((s,r) => s + (r.m||0) + (r.s||0)/60, 0);
    if (fromSim > 0) return fromSim;
    // Saved sessions: use actual timer result stored in blocks[].result
    const actual = (w.blocks||[]).reduce((s,b) => s + (b.result ? (b.result.m||0) + (b.result.s||0)/60 : 0), 0);
    if (actual > 0) return actual;
    const pd = parseFloat(w.pd)||0, wd = parseFloat(w.wd)||0, bw = parseFloat(w.bw)||currentBw;
    return pd > 0 && wd > 0 ? (wd*1000)/(pd*bw*60) : 0;
  }

  const sorted = [...hist].filter(w => w.date).sort((a,b) => new Date(a.date)-new Date(b.date));
  if (!sorted.length) return null;

  // ── Group into training days ───────────────────────────────────────────
  const dayMap = {};
  sorted.forEach(w => {
    const d = w.date.slice(0,10);
    if (!dayMap[d]) dayMap[d] = { date:d, totalStruct:0, totalStructInt:0, wkgSum:0, wkgCount:0 };
    const bw       = parseFloat(w.bw) || currentBw;
    const mc_mech  = parseFloat(w.mc_mech) || 0;
    const fb       = parseFloat(w.fb) || 0;
    const dur      = getSessionDuration(w);
    const structLoad = (mc_mech / bw) * 1000;
    dayMap[d].totalStruct    += structLoad;
    dayMap[d].totalStructInt += (mc_mech > 0 && dur > 0) ? mc_mech / dur / bw : 0;
    if (fb > 0 && parseFloat(w.pd) > 0) {
      dayMap[d].wkgSum   += parseFloat(w.pd);
      dayMap[d].wkgCount += 1;
    }
  });
  const trainingDays = Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date));

  // ── MaxLoad: best consecutive training block with decay ───────────────
  let currentBlock = [], lastDayDate = null;
  let maxLoad = 0, batteryActive = false;

  trainingDays.forEach(day => {
    if (lastDayDate) {
      const daysSinceLast = (new Date(day.date) - new Date(lastDayDate)) / 86400000;
      if (maxLoad > 0) {
        const w = Math.floor(daysSinceLast / 7);
        if (w >= 8) { maxLoad = 0; batteryActive = false; }
        else if (w >= 4) maxLoad = +(maxLoad * 0.95 * 0.95 * Math.pow(0.90, w-3)).toFixed(2);
        else if (w === 3) maxLoad = +(maxLoad * 0.95 * 0.95).toFixed(2);
        else if (w === 2) maxLoad = +(maxLoad * 0.95).toFixed(2);
      }
      if (daysSinceLast > 1) currentBlock = [];
    }
    currentBlock.push(day);
    const blockTotal = currentBlock.reduce((s,d) => s + d.totalStruct, 0);
    if (currentBlock.length >= 2) {
      batteryActive = true;
      if (blockTotal > maxLoad) maxLoad = +blockTotal.toFixed(2);
    }
    lastDayDate = day.date;
  });

  if (!batteryActive || maxLoad <= 0) return null;

  // ── Structural CTL/ATL with mc_mech intensity amplifier ──────────────
  const kCTLs = 1 - Math.exp(-1/28);
  const kATLs = 1 - Math.exp(-1/14); // 14-day window — less reactive to single-day spikes, better for chronic overload detection
  let ctl = 0, atl = 0;
  const firstSessionDate = new Date(sorted[0].date); firstSessionDate.setHours(0,0,0,0);
  const startMs = firstSessionDate.getTime();
  const structIntHistory = [];
  const MIN_SESSIONS = 5, WINDOW_DAYS = 28;
  let dayIdx = 0;

  for (let ms = startMs; ms <= now; ms += 86400000) {
    const ds = new Date(ms).toISOString().slice(0,10);
    const day = dayMap[ds];
    let dayLoad = 0;
    if (day && day.totalStruct > 0) {
      let structAmp = 1;
      if (day.totalStructInt > 0) {
        const ws = dayIdx - WINDOW_DAYS;
        const rel = structIntHistory.filter(h => h.i > ws && h.i < dayIdx);
        if (rel.length >= MIN_SESSIONS) {
          const avg = rel.reduce((s,h)=>s+h.v,0) / rel.length;
          if (avg > 0) structAmp = day.totalStructInt / avg;
        }
        structIntHistory.push({i: dayIdx, v: day.totalStructInt});
      }
      dayLoad = day.totalStruct * structAmp;
    }
    atl = atl + kATLs * (dayLoad - atl);
    ctl = ctl + kCTLs * (dayLoad - ctl);
    dayIdx++;
  }

  const structForm = ctl > 0 ? atl / ctl : 1;

  // ── Form calibration — experience-level specific thresholds ──────────
  const weeksOfHistory = (now - startMs) / (7 * 86400000);
  const expLevel = document.getElementById('global-exp')?.value || 'intermediate';
  const calibWeeks    = { beginner:9,  intermediate:12, advanced:14, elite:17 }[expLevel] || 12;
  const calibSessions = { beginner:18, intermediate:24, advanced:35, elite:51 }[expLevel] || 24;
  const calibrationActive = weeksOfHistory >= calibWeeks && sorted.length >= calibSessions;

  function formFactor(form) {
    if (form <= 1.0) return 1.05;
    if (form <= 1.4) return 1.0;
    if (form >= 2.0) return 0.70;
    return 1.0 - ((form - 1.4) / 0.6) * 0.30;
  }
  const ff = calibrationActive ? formFactor(structForm) : 1.0;
  const calibratedMaxLoad = +(maxLoad * ff).toFixed(2);

  // ── Compute current fatigue with variable half-life per session ────────
  let fatigue = 0;
  const sessionContributions = [];
  sorted.forEach(w => {
    const bw      = parseFloat(w.bw)      || currentBw;
    const mc_mech = parseFloat(w.mc_mech) || 0;
    if (mc_mech <= 0) return;
    const daysAgo = (now - new Date(w.date).getTime()) / 86400000;
    if (daysAgo > 56) return;
    const dur = getSessionDuration(w);
    const intensity = dur > 0 ? mc_mech / dur / bw : 0.03;
    const K = Math.pow(0.5, 1 / halfLifeDays(intensity));
    const structLoad = (mc_mech / bw) * 1000;
    const remaining = structLoad * Math.pow(K, daysAgo);
    fatigue += remaining;
    if (daysAgo <= 21 && remaining > 1) {
      sessionContributions.push({
        date: w.date,
        label: w.label || w.date.slice(5),
        structLoad: +structLoad.toFixed(0),
        remaining: +remaining.toFixed(0),
        daysAgo: +daysAgo.toFixed(1)
      });
    }
  });
  // Sort by date ascending, keep last 8
  sessionContributions.sort((a,b) => a.date.localeCompare(b.date));
  if (sessionContributions.length > 8) sessionContributions.splice(0, sessionContributions.length - 8);

  const pct = Math.min(100, Math.round((fatigue / calibratedMaxLoad) * 100));
  const charged = 100 - pct;
  const status = charged >= 60 ? 'ready'
               : charged >= 40 ? 'moderate'
               : charged >= 20 ? 'fatigued'
               : 'overreached';

  // ── Recovery time estimates ───────────────────────────────────────────
  // Project future calibratedMaxLoad dynamically — as fatigue decays, structForm
  // normalises, formFactor improves, and calibratedMaxLoad increases
  function futureCalibML(futFatigue) {
    if (!calibrationActive) return calibratedMaxLoad;
    // Estimate future structForm from future fatigue
    // structForm ≈ ATL/CTL — as ATL decays, Form moves toward CTL baseline
    // Simple approximation: scale current structForm by ratio of future/current fatigue
    const fatigueRatio = fatigue > 0 ? Math.min(1, futFatigue / fatigue) : 0;
    const futStructForm = 1 + (structForm - 1) * fatigueRatio;
    // Apply same formFactor thresholds
    let futFF;
    if (futStructForm <= 1.0) futFF = 1.05;
    else if (futStructForm <= 1.4) futFF = 1.0;
    else if (futStructForm >= 2.0) futFF = 0.70;
    else futFF = 1.0 - ((futStructForm - 1.4) / 0.6) * 0.30;
    return +(maxLoad * futFF).toFixed(2);
  }

  const recoveryEstimate = {};
  if (charged < 40) {
    for (let h = 1; h <= 240; h++) {
      const futureNow = now + h * 3600000;
      let futFatigue = 0;
      sorted.forEach(w => {
        const bw      = parseFloat(w.bw)      || currentBw;
        const mc_mech = parseFloat(w.mc_mech) || 0;
        if (mc_mech <= 0) return;
        const daysAgo = (futureNow - new Date(w.date).getTime()) / 86400000;
        if (daysAgo > 56) return;
        const dur = getSessionDuration(w);
        const intensity = dur > 0 ? mc_mech / dur / bw : 0.03;
        const K = Math.pow(0.5, 1 / halfLifeDays(intensity));
        futFatigue += ((mc_mech/bw)*1000) * Math.pow(K, daysAgo);
      });
      const futCalibML = futureCalibML(futFatigue);
      const futPct = Math.min(100, Math.round(futFatigue / futCalibML * 100));
      const futCharged = 100 - futPct;
      if (!recoveryEstimate.to40 && futCharged >= 40) recoveryEstimate.to40 = h + 'h';
      if (!recoveryEstimate.to60 && futCharged >= 60) { recoveryEstimate.to60 = h + 'h'; break; }
    }
  } else if (charged < 60) {
    for (let h = 1; h <= 240; h++) {
      const futureNow = now + h * 3600000;
      let futFatigue = 0;
      sorted.forEach(w => {
        const bw      = parseFloat(w.bw)      || currentBw;
        const mc_mech = parseFloat(w.mc_mech) || 0;
        if (mc_mech <= 0) return;
        const daysAgo = (futureNow - new Date(w.date).getTime()) / 86400000;
        if (daysAgo > 56) return;
        const dur = getSessionDuration(w);
        const intensity = dur > 0 ? mc_mech / dur / bw : 0.03;
        const K = Math.pow(0.5, 1 / halfLifeDays(intensity));
        futFatigue += ((mc_mech/bw)*1000) * Math.pow(K, daysAgo);
      });
      const futCalibML = futureCalibML(futFatigue);
      const futPct = Math.min(100, Math.round(futFatigue / futCalibML * 100));
      if (100 - futPct >= 60) { recoveryEstimate.to60 = h + 'h'; break; }
    }
  }

  return {
    charged,
    status,
    maxLoad:   +maxLoad.toFixed(2),
    calibML:   +calibratedMaxLoad.toFixed(2),
    rawFatigue: +fatigue.toFixed(3),
    recoveryEstimate,
    structForm: +structForm.toFixed(2),
    formFactor: +ff.toFixed(2),
    calibrationActive,
    ctl: +ctl.toFixed(3),
    atl: +atl.toFixed(3),
    sessionContributions
  };
}

// ── Three-light recovery summary ──────────────────────────────────────────
function renderRecoveryLights(aerobicForm, neuralActive, structural, banisterStatus, banisterColor, banisterEmoji, patternMap, ctlNow, daysToOptimal, aerobicRec) {
  const now = Date.now();
  const RED_C = '#EF4444', AMBER_C = '#F59E0B', GREEN_C = '#22C55E';
  const el = document.getElementById('recovery-lights-card');
  if (!el) return;
  const hist = getHistory();
  if (hist.length < 5) {
    el.innerHTML = `<div style="text-align:center;padding:12px;color:var(--label);font-size:.75rem;">${t('rec.phase1')}</div>`;
    return;
  }

  // Aerobic state — single source of truth from getTrainingStatus() via banStatus
  // Map five TSB states to three-light ready/moderate/fatigued
  const tsbToLight = { overreaching:'fatigued', fatigued:'moderate', neutral:'ready', peaking:'ready', detraining:'moderate' };
  const aerobicStatus = banisterStatus ? (tsbToLight[banisterStatus] || 'ready') : 'ready';
  // Neural state — red if any pattern active, amber if close
  const neuralStatus = neuralActive > 48 ? 'fatigued' : neuralActive > 0 ? 'moderate' : 'ready';
  // Structural state
  const structStatus = structural ? structural.status : 'ready';

  const colorMap = { ready:'#22C55E', moderate:'#F59E0B', fatigued:'#EF4444', overreached:'#EF4444' };
  const aC = colorMap[aerobicStatus] || '#22C55E';
  const nC = colorMap[neuralStatus]  || '#22C55E';
  const sC = colorMap[structStatus]  || '#22C55E';

  // ── Per-component recommendations ────────────────────────────────────
  // Aerobic rec — goal-specific from getTrainingStatus
  const recAerobic = aerobicRec || (aerobicStatus === 'ready' ? t('rec.lights.all.green') : t('rec.lights.aerobic.amber'));

  // Neural rec — one separate labeled row per state present (red/amber/green)
  const safePatternMap = patternMap || {};
  const ALL_PATTERNS = ['pattern.squat','pattern.hinge','pattern.push','pattern.pull','pattern.olympic'];
  const redPatterns   = [];
  const amberPatterns = [];
  const greenPatterns = [];
  ALL_PATTERNS.forEach(p => {
    const v = safePatternMap[p];
    if (!v || v.synthetic || v.readyAt <= now) { greenPatterns.push(p); return; }
    const remainH = Math.ceil((v.readyAt - now) / 3600000);
    if (remainH > 48) redPatterns.push({ p, remainH }); else amberPatterns.push({ p, remainH });
  });
  const neuralRows = [];
  if (!redPatterns.length && !amberPatterns.length) {
    neuralRows.push({ color: GREEN_C, text: t('rec.neural.ready') });
  } else {
    if (redPatterns.length) {
      const maxH = Math.max(...redPatterns.map(x => x.remainH));
      const labels = redPatterns.map(x => getPatternLabel(x.p)).join(', ');
      neuralRows.push({ color: RED_C, text: t('rec.neural.avoid') + ' ' + labels + ' · ' + t('rec.neural.fully.ready') + ' ' + maxH + 'h' });
    }
    if (amberPatterns.length) {
      const maxH = Math.max(...amberPatterns.map(x => x.remainH));
      const labels = amberPatterns.map(x => getPatternLabel(x.p)).join(', ');
      neuralRows.push({ color: AMBER_C, text: t('rec.neural.light.ok') + ' ' + labels + ' ' + t('rec.neural.light.ok.now') + ' · ' + t('rec.neural.fully.ready') + ' ' + maxH + 'h' });
    }
    if (greenPatterns.length) {
      const labels = greenPatterns.map(getPatternLabel).join(', ');
      neuralRows.push({ color: GREEN_C, text: labels + ' — ' + t('rec.ready') });
    }
  }

  // Structural rec
  const recStructural = structStatus === 'ready'       ? t('rec.structural.ready')
                      : structStatus === 'moderate'    ? t('rec.lights.struct.amber').replace('{pct}', structural?.charged || 0)
                      : structStatus === 'overreached' ? t('rec.lights.struct.overreached')
                      : t('rec.lights.struct.red');

  // Days to optimal — append to aerobic rec if present
  const recAerobicFull = recAerobic + (daysToOptimal ? ' ⏰ ~' + daysToOptimal + ' ' + t('tsb.days.optimal') : '');

  el.innerHTML = `
    <div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px;">
      <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--label);margin-bottom:12px;">${t('rec.summary.title')}</div>
      ${(()=>{
        const RED='#EF4444',AMBER='#F59E0B',GREEN='#22C55E',DIM='rgba(128,128,128,0.15)';
        const isDetraining = banisterStatus === 'detraining';
        const isPeaking = banisterStatus === 'peaking';
        // Aerobic label shows TSB state name, not generic ready/moderate/fatigued
        const aerobicStateLabel = banisterStatus ? t('tsb.' + banisterStatus) : t('rec.' + aerobicStatus);
        const aerobicLabelColor = aerobicStatus==='fatigued'?RED:aerobicStatus==='moderate'?AMBER:GREEN;
        const dot=(c,active)=>'<div style="width:18px;height:18px;border-radius:50%;background:'+(active?c:DIM)+';margin:0 auto 4px;'+(active?'box-shadow:0 0 10px '+c+',0 0 20px '+c+'55;':'')+'"></div>';
        const aerobicHTML = '<div style="text-align:center;">'
          + (isDetraining
              ? '<div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div class="tl-dot-detraining" style="width:18px;height:18px;border-radius:50%;background:#22C55E;box-shadow:0 0 8px #22C55E88;margin:0 auto 4px;"></div><div style="height:6px;"></div>'
              : isPeaking
              ? '<div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div class="tl-dot-peaking" style="width:18px;height:18px;border-radius:50%;background:rgba(128,128,128,0.15);margin:0 auto 4px;"></div><div style="height:6px;"></div>'
              : dot(RED,aerobicStatus==='fatigued')+dot(AMBER,aerobicStatus==='moderate')+dot(GREEN,aerobicStatus==='ready')+'<div style="height:6px;"></div>')
          + '<div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.aerobic')+'</div>'
          + '<div style="font-size:.66rem;color:'+aerobicLabelColor+';font-weight:600;">'+aerobicStateLabel+'</div></div>';

        // Neural: can show multiple simultaneous states (green/amber/red) since each
        // movement pattern recovers independently. Green = at least one of the 5 patterns
        // is clear (either never stressed, or its recovery window has passed).
        const ALL_PATTERNS_KEYS = ['pattern.squat','pattern.hinge','pattern.push','pattern.pull','pattern.olympic'];
        const safePatternMapDots = patternMap || {};
        const neuralHasGreen = ALL_PATTERNS_KEYS.some(p => !safePatternMapDots[p] || safePatternMapDots[p].readyAt <= now);
        const neuralHasAmber = Object.values(safePatternMapDots).some(v => v.readyAt > now && (v.readyAt - now) <= 48*3600000);
        const neuralHasRed   = Object.values(safePatternMapDots).some(v => v.readyAt > now && (v.readyAt - now) > 48*3600000);
        const neuralDotsHtml = (neuralHasRed   ? '<div class="tl-dot-red-pulse" style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>'     : dot(RED,false))
          + (neuralHasAmber ? '<div class="tl-dot-amber-pulse" style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>' : dot(AMBER,false))
          + dot(GREEN, neuralHasGreen);
        const neuralLabelColor = neuralHasRed ? RED : neuralHasAmber ? AMBER : GREEN;
        const neuralStateLabel = neuralHasRed ? t('rec.fatigued') : neuralHasAmber ? t('rec.moderate') : t('rec.ready');
        const neuralHTML = '<div style="text-align:center;">'+neuralDotsHtml+'<div style="height:6px;"></div><div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.neural')+'</div><div style="font-size:.66rem;color:'+neuralLabelColor+';font-weight:600;">'+neuralStateLabel+'</div></div>';

        // Structural: single status, with red/black pulse for overreached
        const isOverreached = structStatus === 'overreached';
        const sAc = isOverreached ? RED : structStatus==='fatigued' ? RED : structStatus==='moderate' ? AMBER : GREEN;
        const sDots = isOverreached
          ? '<div class="tl-dot-overreached" style="width:18px;height:18px;border-radius:50%;background:'+RED+';box-shadow:0 0 8px '+RED+'88;margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div><div style="width:18px;height:18px;border-radius:50%;background:'+DIM+';margin:0 auto 4px;"></div>'
          : dot(RED,structStatus==='fatigued')+dot(AMBER,structStatus==='moderate')+dot(GREEN,structStatus==='ready');
        const sLabel = isOverreached ? t('rec.overreached') : t('rec.'+structStatus);
        const structuralHTML = '<div style="text-align:center;">'+sDots+'<div style="height:6px;"></div><div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:2px;">'+t('rec.structural')+'</div><div style="font-size:.66rem;color:'+sAc+';font-weight:600;">'+sLabel+'</div></div>';

        const nonAerobic = neuralHTML + structuralHTML;
        return '<div style="display:flex;align-items:flex-start;justify-content:space-around;padding:12px 0;margin-bottom:10px;">'+aerobicHTML+nonAerobic+'</div>';
      })()}
      <div style="height:1px;background:rgba(255,255,255,.06);margin-bottom:10px;"></div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
        <div style="font-size:.72rem;font-weight:800;min-width:72px;padding-top:1px;flex-shrink:0;color:${aC};">${t('rec.aerobic')}</div>
        <div style="font-size:.73rem;color:var(--text);line-height:1.5;">${recAerobicFull}</div>
      </div>
      ${neuralRows.map(row => `
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

// ── Structural fatigue card ───────────────────────────────────────────────
function renderStructuralCard(structural) {
  const el = document.getElementById('structural-fatigue-card');
  if (!el) return;
  if (!structural) { el.innerHTML = ''; return; }
  const { charged, status, recoveryEstimate, formFactor, calibrationActive, structForm } = structural;
  const color = status === 'ready'       ? '#22C55E'
              : status === 'moderate'    ? '#F59E0B'
              : '#EF4444'; // fatigued and overreached both red
  const segments = 10;
  const filledSegs = Math.round((charged / 100) * segments);
  const batterySegs = Array.from({length:segments}, (_,i) => {
    const filled = i < filledSegs;
    return `<div style="flex:1;height:14px;border-radius:2px;background:${filled ? color : 'rgba(128,128,128,0.15)'};margin-right:${i<segments-1?'2px':'0'};transition:background .3s;"></div>`;
  }).join('');

  // Form calibration message
  let calibHtml = '';
  if (calibrationActive && formFactor !== undefined) {
    const pct = Math.round(Math.abs((formFactor - 1) * 100));
    if (formFactor > 1.0) {
      // Underloading — positive message
      calibHtml = `<div style="font-size:.68rem;color:#22C55E;margin-top:5px;">
        ${t('rec.struct.calib.under').replace('{pct}', pct)}
      </div>`;
    } else if (formFactor < 1.0 && formFactor >= 0.90) {
      // Mild overloading
      calibHtml = `<div style="font-size:.68rem;color:#F59E0B;margin-top:5px;">
        ${t('rec.struct.calib.mild').replace('{pct}', pct)}
      </div>`;
    } else if (formFactor < 0.90 && formFactor > 0.70) {
      // Moderate overloading
      calibHtml = `<div style="font-size:.68rem;color:#EF4444;margin-top:5px;">
        ${t('rec.struct.calib.moderate').replace('{pct}', pct)}
      </div>`;
    } else if (formFactor <= 0.70) {
      // Hard cap — chronic overloading
      calibHtml = `<div style="font-size:.68rem;color:#EF4444;margin-top:5px;">
        ${t('rec.struct.calib.chronic').replace('{pct}', pct)}
      </div>`;
    }
    // FF = 1.0 (balanced zone): no message — calibration invisible
  } else if (calibrationActive === false) {
    // Still in burn-in period
    calibHtml = `<div style="font-size:.68rem;color:var(--muted);margin-top:5px;">${t('rec.struct.calib.burnin')}</div>`;
  }

  // Recovery time estimate display
  let recoveryHtml = '';
  if (recoveryEstimate) {
    const lines = [];
    if (recoveryEstimate.to40) lines.push(`<span style="color:var(--label);">${recoveryEstimate.to40} → 40% (${t('rec.struct.reduced.load')})</span>`);
    if (recoveryEstimate.to60) lines.push(`<span style="color:var(--label);">${recoveryEstimate.to60} → 60% (${t('rec.struct.ready')})</span>`);
    if (lines.length) {
      recoveryHtml = `<div style="font-size:.68rem;margin-top:6px;display:flex;flex-direction:column;gap:2px;">
        ${lines.join('')}
      </div>`;
    }
  }

  // Recommendation text
  const recText = status === 'ready'       ? t('rec.structural.ready')
                : status === 'moderate'    ? t('rec.lights.struct.amber').replace('{pct}', structural?.charged || 0)
                : status === 'fatigued'    ? t('rec.lights.struct.red')
                : t('rec.lights.struct.overreached');

  // Store for fullscreen expanded view
  _fsChartData = _fsChartData || {};
  _fsChartData.structural = { charged, status, color, batterySegs, maxLoad: structural.maxLoad, calibML: structural.calibML, formFactor: structural.formFactor, calibrationActive: structural.calibrationActive, structForm: structural.structForm, recoveryEstimate, calibHtml, recText, rawFatigue: structural.rawFatigue, ctl: structural.ctl, atl: structural.atl, sessionContributions: structural.sessionContributions || [] };

  el.innerHTML = `
    <div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-left:3px solid ${color};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;cursor:pointer;" onclick="openChartFullscreen(t('rec.structural.label'), 'structural')">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--label);">${t('rec.structural.label')}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="font-size:.8rem;font-weight:900;color:${color};">${charged}% ${t('rec.charged')}</div>
          <div style="font-size:.6rem;color:var(--muted);opacity:.6;">ⓘ</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <div style="display:flex;flex:1;gap:3px;">${batterySegs}</div>
      </div>
      <div style="font-size:.7rem;color:var(--label);">${recText}</div>
      ${calibHtml}
      ${recoveryHtml}
      <div style="font-size:.62rem;color:var(--muted);text-align:right;margin-top:6px;opacity:.5;">${t('tap.for.info') || 'Tap for details'}</div>
    </div>`;
}

function renderRecoveryStatus() {
  const section = document.getElementById('recovery-status-section');
  const cards   = document.getElementById('recovery-status-cards');
  if (!section || !cards) return;

  const hist = getHistory();
  const now  = Date.now();

  // Show intro/learn-more section only once at least one session is saved
  const introEl = document.getElementById('analytics-intro-section');
  if (introEl) introEl.style.display = hist.length > 0 ? '' : 'none';

  const threshold = getStrengthThreshold();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Collect active recovery windows — one per movement pattern (keep the most recent)
  const patternMap = {};
  hist.forEach(w => {
    if (!w.date) return;
    const sessionTime = new Date(w.date).getTime();
    if (sessionTime < sevenDaysAgo) return;
    // Use getRecoveryFromEntry to check peak RL — activates if peak RL >= 70%
    const rec = getRecoveryFromEntry(w);
    if (!rec) return;
    const readyAt = sessionTime + rec.hours * 3600000;
    if (readyAt <= now) return; // already recovered
    const pattern = getMovementPattern(rec.peakName);
    // Keep the one that requires the longest remaining wait
    if (!patternMap[pattern] || readyAt > patternMap[pattern].readyAt) {
      patternMap[pattern] = { rec, readyAt, sessionDate: w.date, label: w.label };
    }
  });

  const active = Object.entries(patternMap);
  // Get structural fatigue
  const structural = getStructuralFatigue();
  // Get aerobic Form from Banister using the same function as the chart
  const tlNowRec = typeof calcTrainingLoad === 'function' ? calcTrainingLoad(hist) : null;
  const aerobicForm = tlNowRec ? tlNowRec.tsb : 0;
  // Get worst neural remaining hours
  const neuralMaxH = active.length ? Math.max(...active.map(([,{readyAt}])=>Math.ceil((readyAt-now)/3600000))) : 0;

  // Always show section if we have any data
  const hasAnything = active.length > 0 || structural || hist.length >= 5;
  if (!hasAnything) { section.style.display = 'none'; return; }
  section.style.display = '';

  // Neural cards
  if (active.length > 0) {
    cards.innerHTML = active.map(([pattern, {rec, readyAt, label, sessionDate, synthetic}]) => {
      const remainMs  = readyAt - now;
      const remainH   = Math.ceil(remainMs / 3600000);
      const readyDate = new Date(readyAt);
      const readyStr  = fmtDate(readyDate, {weekday:'short',day:'numeric',month:'short'})
                      + ' ' + t('hist.modal.at') + ' ' + fmtTime(readyDate, {hour:'2-digit',minute:'2-digit'});
      const sessionMs = readyAt - rec.hours * 3600000;
      const totalWindowMs = readyAt - sessionMs;
      const pct = Math.max(0, Math.min(100, ((totalWindowMs - remainMs) / totalWindowMs) * 100));
      const color     = remainH > 48 ? '#EF4444' : '#F59E0B';
      return `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-left:3px solid ${color};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
        <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--label);margin-bottom:4px;">${t('rec.neural.title')}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:.75rem;font-weight:800;color:${color};">⏱️ ${rec.peakName ? rec.peakName + ' · ' : ''}${getPatternLabel(pattern)}</div>
          <div style="font-size:.8rem;font-weight:900;color:${color};">${remainH}h remaining</div>
        </div>
        <div style="background:rgba(128,128,128,.2);border-radius:4px;height:4px;margin-bottom:6px;overflow:hidden;">
          <div style="background:${color};height:100%;width:${pct.toFixed(0)}%;border-radius:4px;transition:width .3s;"></div>
        </div>
        <div style="font-size:.7rem;color:var(--label);">${sessionDate ? 'Ready: <strong style="color:var(--text);">'+readyStr+'</strong>' + (label ? ' &nbsp;·&nbsp; '+label : '') : '<em>Caution — component pattern recovering</em>'}</div>
      </div>`;
    }).join('');
  } else {
    cards.innerHTML = '';
  }

  // Structural fatigue card
  renderStructuralCard(structural);

  // Three-light summary — pass banister status for combined recommendation
  const tlStatus = typeof calcTrainingLoad === 'function' ? calcTrainingLoad(hist) : null;
  const tlGoal = document.getElementById('global-goal')?.value||'conditioning';
  if (tlStatus) tlStatus.sessionCount = hist.filter(w => w.pd && parseFloat(w.pd) > 0).length;
  const banStatus = tlStatus ? getTrainingStatus(tlStatus, tlGoal) : null;
  renderRecoveryLights(aerobicForm, neuralMaxH, structural,
    banStatus?.status, banStatus?.color, banStatus?.dotHTML, patternMap, tlNowRec?.ctl || 0, banStatus?.daysToOptimal != null ? banStatus.daysToOptimal : null, banStatus?.rec || null);
}

// Computes radar averages (pd/wd/mc/fb/rl/td) for rolling 6-week windows
// over the last 12 weeks, shifted by 1 week each, oldest to newest.
// Returns array of {startDate, endDate, avg, n} — n = session count in window.
function getRollingRadarWindows(history) {
  // Use local date strings to avoid UTC timezone offset issues
  const dayStr = ms => localDateStr(new Date(ms));
  // Parses a "YYYY-MM-DD" string as LOCAL midnight, not UTC midnight.
  // new Date("YYYY-MM-DD") parses date-only strings as UTC per the ISO
  // 8601 spec — for any negative-offset timezone (Chile included),
  // subtracting days from that UTC instant and converting back via
  // local accessors (as dayStr/localDateStr does) loses a day on every
  // round-trip, since UTC midnight is already the previous evening
  // locally. Confirmed this exact mechanism reproduces the reported
  // 8-day-instead-of-7 step between windows precisely. new Date(y,
  // m-1, d) — separate numeric arguments, not a string — is
  // interpreted as local time by the Date constructor, which is what
  // avoids the round-trip entirely.
  const parseLocalDateStr = str => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayMs = Date.now();
  const DAY = 24*60*60*1000;

  const lastWindowStartStr = dayStr(todayMs - 42*DAY);
  const maxLookbackStr = dayStr(todayMs - 12*7*DAY);

  const sessions = history
    .filter(w => w.date && localDateStr(new Date(w.date)) >= maxLookbackStr)
    .map(w => ({ ...w, _ds: localDateStr(new Date(w.date)) }));

  if (!sessions.length) return [];

  const sorted = [...sessions].sort((a,b) => a._ds.localeCompare(b._ds));
  const earliestStr = sorted[0]._ds;

  // Build window start date-strings by stepping back from lastWindowStartStr
  // by 1 week, stopping once we'd go earlier than the athlete's first
  // session-day or the 12-week cap.
  const starts = [lastWindowStartStr];
  while (true) {
    const prevMs = parseLocalDateStr(starts[0]).getTime() - 7*DAY;
    const prevStr = dayStr(prevMs);
    if (prevStr < earliestStr && starts[0] > earliestStr) break;
    if (prevStr < maxLookbackStr) break;
    starts.unshift(prevStr);
  }

  // Averages each window over the REAL session entries falling inside
  // it, via the same computeRadarAverage() helper every other radar
  // consumer uses — not a synthetic per-day aggregate, which had no raw
  // HR/RPE/block data at all and silently produced 0 for Cardio
  // Intensity and Cardio Strain at every single frame. This also fixes
  // a second bug: the old aggregation additionally never migrated off
  // the pre-axis-change mc/rl schema, so those two axes weren't just
  // wrong here — they were entirely undefined.
  const windows = starts.map(wsStr => {
    const wsMs = parseLocalDateStr(wsStr).getTime();
    const weStr = dayStr(wsMs + 43*DAY);
    const sessionsInWindow = sessions.filter(w => w._ds >= wsStr && w._ds < weStr);
    return {
      startDate: parseLocalDateStr(wsStr),
      endDate: new Date(parseLocalDateStr(weStr).getTime() - DAY),
      avg: computeRadarAverage(sessionsInWindow),
      n: sessionsInWindow.length
    };
  });

  // Add a final window matching the static radar exactly (last 42 days to today)
  // so the animation ends without a jump
  const todayStr = dayStr(todayMs);
  const finalWindowStart = dayStr(todayMs - 42*DAY);
  const finalSessions = sessions.filter(w => w._ds >= finalWindowStart && w._ds <= todayStr);
  const finalAvg = computeRadarAverage(finalSessions);
  const lastExisting = windows[windows.length - 1];
  // Only add if meaningfully different from last window
  if (lastExisting && Math.abs(finalAvg.td - lastExisting.avg.td) > 0.01) {
    windows.push({
      startDate: parseLocalDateStr(finalWindowStart),
      endDate: parseLocalDateStr(todayStr),
      avg: finalAvg,
      n: finalSessions.length
    });
  }

  return windows;
}

// Canonical 6-axis definition, shared by every radar consumer (live
// session signature, 6-week profile, history modal flip card, and the
// live session's own flip-back comparison table) — computed once here
// rather than duplicated as 4 slightly-different 'avgOf' functions that
// could silently drift apart from each other over time.
const RADAR_AXIS_KEYS = ['pd', 'cvIntensity', 'wd', 'internalLoad', 'fb', 'td']; // clockwise: Mechanical Power, Cardio Intensity, Mechanical Work, Cardio Strain, Force Bias, Technical Demand

// Single source of truth for the 6 axis names, in RADAR_AXIS_KEYS order.
// Used by every radar consumer — front (SVG/canvas, needs the \n for
// two-line labels) and back (text comparison tables, which strip the \n)
// alike — specifically so a front/back naming mismatch (like "Cardio
// Intensity" on the front vs "CV Intensity (MET)" on the back) can't
// happen again from two places drifting out of sync.
function getRadarAxisLabels() {
  const isES = _lang === 'es';
  return isES
    ? ['Potencia\nMecánica', 'Intensidad\nCardio', 'Trabajo\nMecánico', 'Esfuerzo\nCardio', 'Sesgo de\nFuerza', 'Demanda\nTécnica']
    : ['Mechanical\nPower', 'Cardio\nIntensity', 'Mechanical\nWork', 'Cardio\nStrain', 'Force\nBias', 'Technical\nDemand'];
}

// Raw (un-normalized) 6-axis values for one session. pd uses
// getSessionPower() (recomputed fresh) to match the pre-existing
// pattern; cvIntensity/internalLoad come from getSessionCVEndurance()
// since neither is a stored field — everything else reads the entry's
// own stored value directly.
function computeRadarValuesForSession(w) {
  const power = getSessionPower(w);
  const cv = getSessionCVEndurance(w);
  return {
    pd: power ? power.total : (parseFloat(w.pd) || 0),
    wd: parseFloat(w.wd) || 0,
    cvIntensity: cv ? cv.met : 0,
    fb: parseFloat(w.fb) || 0,
    internalLoad: cv ? cv.metMinutes : 0,
    td: parseFloat(w.td) || 0
  };
}

// Averages the 6 axes across a set of sessions. Each axis's average
// excludes that axis's own zero/uncomputable entries rather than
// counting them as 0 — a session with no computable CV Intensity
// shouldn't drag the cvIntensity average toward 0 while still counting
// normally for pd/wd/fb/td.
function computeRadarAverage(sessions) {
  const sums = {}, counts = {};
  RADAR_AXIS_KEYS.forEach(k => { sums[k] = 0; counts[k] = 0; });
  sessions.forEach(w => {
    const vals = computeRadarValuesForSession(w);
    RADAR_AXIS_KEYS.forEach(k => {
      if (vals[k] > 0) { sums[k] += vals[k]; counts[k]++; }
    });
  });
  const avg = {};
  RADAR_AXIS_KEYS.forEach(k => { avg[k] = counts[k] ? sums[k] / counts[k] : 0; });
  return avg;
}

function getRadarMaxes() {
  return {
    pd: getEffectiveBands('totalpower')?.max || 3.5,
    wd: getEffectiveBands('wd')?.max || 200,
    cvIntensity: 12, // MET — matches the realistic ceiling already established for the fbduration chart's gradient
    fb: getEffectiveBands('fb')?.max || 200,
    internalLoad: 200, // MET-min — a longer, sustained session at moderate-high intensity
    td: 5
  };
}

function normalizeRadarAvg(avg, maxes) {
  const keys = RADAR_AXIS_KEYS;
  const m = maxes || getRadarMaxes();
  return keys.map(k => Math.min(1, Math.max(0, (avg[k]||0) / m[k])));
}

// Migrates a stored, pre-normalized radar object saved before the personal-
// bands 20% headroom was removed. Old values for pd/wd/mc/fb were divided
// by (personal_max * 1.2); multiplying by 1.2 and reclamping approximates
// what they'd be under the current (no-headroom) formula. rl/td were always
// fixed-scale and are unaffected. No-op for radars already on version 2+.
function migrateRadarNormalization(radar) {
  if (!radar || !radar._normalised || radar._v >= 2) return radar;
  const fixed = { ...radar };
  ['pd','wd','mc','fb'].forEach(k => {
    if (typeof fixed[k] === 'number') fixed[k] = Math.min(1, Math.max(0, fixed[k] * 1.2));
  });
  return fixed;
}

// Draws one radar frame onto a canvas given pre-normalized 0-1 values.
// Canvas pixel size must already be set (see render6WeekRadar / animation setup).
function drawRadarFrame(canvas, values, color) {
  if (!canvas) return;
  const N = 6;
  const dpr = window.devicePixelRatio || 1;
  const canvasW = canvas.width / dpr, canvasH = canvas.height / dpr;
  const size = Math.min(canvasW - 100, 260);
  const cx = canvasW/2, cy = canvasH/2;
  const R = size * 0.28;
  const labelR = size * 0.44;
  const ctx = canvas.getContext('2d');
  const isDark = document.body.classList.contains('dark');
  const gridCol = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
  const labelCol = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
  const brandCol = color || '#22C55E';
  const labels = getRadarAxisLabels();

  ctx.clearRect(0, 0, canvasW, canvasH);
  const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;
  const pt = (i, r) => ({ x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) });

  // Grid rings
  [0.25, 0.5, 0.75, 1].forEach(frac => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = pt(i, R * frac);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = gridCol; ctx.lineWidth = 1; ctx.stroke();
  });

  // Axes
  for (let i = 0; i < N; i++) {
    const p = pt(i, R);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = gridCol; ctx.lineWidth = 1; ctx.stroke();
  }

  // Filled polygon
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const p = pt(i, R * values[i]);
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = brandCol + '2e'; ctx.fill(); // ~18% alpha
  ctx.strokeStyle = brandCol; ctx.lineWidth = 2;
  ctx.shadowColor = brandCol; ctx.shadowBlur = 10; ctx.stroke();
  ctx.shadowBlur = 0;

  // Dots
  for (let i = 0; i < N; i++) {
    const p = pt(i, R * values[i]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = brandCol; ctx.shadowColor = brandCol; ctx.shadowBlur = 8;
    ctx.fill(); ctx.shadowBlur = 0;
  }

  // Labels — align based on position around circle
  ctx.font = `700 ${Math.max(9, size * 0.047)}px -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = labelCol;
  for (let i = 0; i < N; i++) {
    const p = pt(i, labelR);
    const cosA = Math.cos(angle(i));
    ctx.textAlign = cosA > 0.3 ? 'left' : cosA < -0.3 ? 'right' : 'center';
    const lines = labels[i].split('\n');
    const lineH = size * 0.055;
    lines.forEach((line, li) => {
      ctx.fillText(line, p.x, p.y + (li - (lines.length-1)/2) * lineH);
    });
  }
}

function render6WeekRadar(canvas, avg) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const containerW = canvas.offsetWidth || 260;
  const padding = 50;
  const size = Math.min(containerW - padding * 2, 260);
  const canvasW = containerW;
  const canvasH = size + 100;
  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.marginLeft = 'auto';
  canvas.style.marginRight = 'auto';
  canvas.style.display = 'block';
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const values = normalizeRadarAvg(avg);
  drawRadarFrame(canvas, values, '#22C55E');
}

// Global state for the 12-week radar trend animation
let _radarAnimWindows = null;
let _radarAnimRunning = false;

function formatRadarWindowLabel(win) {
  const isES = _lang === 'es';
  const fmt = d => {
    const months = isES
      ? ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
      : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  };
  return `${fmt(win.startDate)} – ${fmt(win.endDate)}`;
}

// Animates the 6-week radar through rolling 6-week windows over the last
// 12 weeks, one frame per window, interpolating smoothly between them.
// On completion, reverts to the current static radar.
function playRadarAnimation() {
  if (_radarAnimRunning) return;
  const windows = _radarAnimWindows;
  if (!windows || windows.length < 2) return;
  const canvas = document.getElementById('chart-fs-canvas');
  const label = document.getElementById('radar-anim-label');
  const btn = document.getElementById('radar-anim-play');
  if (!canvas) return;

  _radarAnimRunning = true;
  if (btn) btn.disabled = true;

  const maxes = getRadarMaxes();
  const frames = windows.map(w => normalizeRadarAvg(w.avg, maxes));
  const FRAME_MS = 800; // time per window-to-window transition
  const totalTransitions = frames.length - 1;
  const totalMs = totalTransitions * FRAME_MS;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalMs);
    const frameFloat = t * totalTransitions;
    const i = Math.max(0, Math.min(totalTransitions - 1, Math.floor(frameFloat)));
    const localT = Math.max(0, Math.min(1, frameFloat - i));

    const a = frames[i] || frames[frames.length-1] || [0,0,0,0,0,0];
    const b = frames[i+1] || frames[frames.length-1] || a;
    const interp = a.map((v, k) => v + ((b[k]??v) - v) * localT);
    drawRadarFrame(canvas, interp, '#22C55E');

    // Label shows the window we're transitioning toward (or currently in)
    const winIdx = localT < 0.5 ? i : Math.min(i+1, windows.length-1);
    if (label) label.textContent = formatRadarWindowLabel(windows[winIdx]) +
      (windows[winIdx].n === 0 ? (document.body.classList.contains('es') ? ' (sin sesiones)' : ' (no sessions)') : '');

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // Animation done — revert to current static radar after a brief pause
      setTimeout(() => {
        render6WeekRadar(canvas, _fsChartData.profileAvg);
        if (label) label.textContent = '';
        if (btn) btn.disabled = false;
        _radarAnimRunning = false;
      }, 600);
    }
  }
  requestAnimationFrame(step);
}

function _renderStructuralGauge(canvasId, charged, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 340;
  const h = 130;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = w / 2, cy = h - 20, r = Math.min(w/2 - 20, 90);
  const isDark = document.body.classList.contains('dark');
  const trackCol = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const textCol  = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
  const lw = 14;
  // Background track
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.strokeStyle = trackCol; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.stroke();
  // Zone fills
  const zones = [{from:0,to:.2,c:'#EF4444'},{from:.2,to:.4,c:'#EF4444'},{from:.4,to:.6,c:'#F59E0B'},{from:.6,to:1,c:'#22C55E'}];
  zones.forEach(z => {
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI + Math.PI*z.from, Math.PI + Math.PI*z.to);
    ctx.strokeStyle = z.c + '33'; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.stroke();
  });
  // Charged fill
  const pct = Math.max(0, Math.min(1, charged / 100));
  if (pct > 0) {
    const endA = Math.PI + Math.PI * pct;
    zones.forEach(z => {
      const sa = Math.PI + Math.PI * z.from, ea = Math.PI + Math.PI * z.to;
      if (sa >= endA) return;
      ctx.beginPath(); ctx.arc(cx, cy, r, sa, Math.min(ea, endA));
      ctx.strokeStyle = z.c; ctx.lineWidth = lw; ctx.lineCap = z.to >= pct ? 'round' : 'butt'; ctx.stroke();
    });
  }
  // Tick marks at thresholds
  [.2,.4,.6,.8].forEach(p => {
    const a = Math.PI + Math.PI * p;
    ctx.beginPath();
    ctx.moveTo(cx + (r-lw/2)*Math.cos(a), cy + (r-lw/2)*Math.sin(a));
    ctx.lineTo(cx + (r+lw/2)*Math.cos(a), cy + (r+lw/2)*Math.sin(a));
    ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2; ctx.lineCap = 'butt'; ctx.stroke();
  });
  // Labels
  ctx.font = `600 10px -apple-system, sans-serif`;
  ctx.fillStyle = textCol; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';  ctx.fillText('0%',  cx - r - 18, cy + 4);
  ctx.textAlign = 'right'; ctx.fillText('100%', cx + r + 18, cy + 4);
  [.2,.4,.6].forEach(p => {
    const a = Math.PI + Math.PI * p;
    const lx = cx + (r+22)*Math.cos(a), ly = cy + (r+22)*Math.sin(a);
    ctx.textAlign = 'center'; ctx.fillText(Math.round(p*100)+'%', lx, ly);
  });
}

function _renderStructuralCharts(sd) {
  if (!sd) return;
  const isDark = document.body.classList.contains('dark');
  const textCol = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  // Radial gauge in wrap
  _renderStructuralGauge('struct-gauge-fs', sd.charged, sd.color);

  // ── Session contributions chart ───────────────────────────────────────
  const contribEl = document.getElementById('struct-contrib-chart');
  if (contribEl && sd.sessionContributions?.length) {
    contribEl.style.display = 'block';
    const canvas = contribEl.querySelector('canvas');
    if (canvas) {
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: sd.sessionContributions.map(s => s.label.length > 14 ? s.label.slice(0,13)+'…' : s.label),
          datasets: [{
            label: t('struct.remaining'),
            data: sd.sessionContributions.map(s => s.remaining),
            backgroundColor: sd.sessionContributions.map(s =>
              s.remaining > sd.calibML * 0.3 ? '#EF444499' :
              s.remaining > sd.calibML * 0.15 ? '#F59E0B99' : '#22C55E99'),
            borderRadius: 4, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' structural load remaining' } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textCol, font: { size: 9 } }, border: { display: false } },
            y: { grid: { color: gridCol }, ticks: { color: textCol, font: { size: 9 } }, border: { display: false } }
          }
        }
      });
    }
  }

  // ── Recharge forecast chart ───────────────────────────────────────────
  const forecastEl = document.getElementById('struct-forecast-chart');
  if (forecastEl && sd.rawFatigue != null && sd.calibML) {
    forecastEl.style.display = 'block';
    const canvas = forecastEl.querySelector('canvas');
    if (canvas) {
      const labels = [], data = [];
      for (let d = 0; d <= 10; d++) {
        labels.push(d === 0 ? t('struct.forecast.now') : '+' + d + 'd');
        const futFatigue = sd.rawFatigue * Math.pow(0.5, d / 2);
        const pct = Math.min(100, Math.round((futFatigue / sd.calibML) * 100));
        data.push(Math.max(0, 100 - pct));
      }
      new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: '% charged',
            data,
            borderColor: '#22C55E',
            backgroundColor: 'rgba(34,197,94,0.08)',
            fill: true, borderWidth: 2,
            pointRadius: data.map((v,i) => (i===0 || v===100) ? 4 : 2),
            pointBackgroundColor: data.map(v => v >= 60 ? '#22C55E' : v >= 40 ? '#F59E0B' : '#EF4444'),
            tension: 0.4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y + '% charged' } } },
          scales: {
            x: { grid: { color: gridCol }, ticks: { color: textCol, font: { size: 9 } }, border: { display: false } },
            y: { min: 0, max: 100, grid: { color: gridCol }, ticks: { color: textCol, font: { size: 9 }, callback: v => v + '%' }, border: { display: false } }
          }
        }
      });
    }
  }

  // ── MaxLoad cards under Personal Capacity panel ───────────────────────
  const maxLoadEl = document.getElementById('struct-maxload-cards');
  if (maxLoadEl && sd.maxLoad != null) {
    const adjPct = Math.round((sd.calibML / sd.maxLoad - 1) * 100);
    const adjColor = adjPct > 0 ? '#22C55E' : adjPct < 0 ? '#EF4444' : 'var(--text)';
    const adjStr = (adjPct > 0 ? '+' : '') + adjPct + '%';
    maxLoadEl.style.display = 'block';
    maxLoadEl.innerHTML = `
      ${sd.calibHtml ? `<div style="margin-bottom:8px;">${sd.calibHtml}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:var(--text);">${sd.maxLoad}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.maxload')}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:var(--text);">${sd.calibML || sd.maxLoad}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.calibml')}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:${adjColor};">${adjStr}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.adjustment')}</div>
        </div>
      </div>`;
  }

  // ── CTL / ATL / Form cards + threshold table under Calibration panel ──
  const calibEl = document.getElementById('struct-calib-cards');
  if (calibEl && sd.ctl != null) {
    const formColor = sd.structForm > 1.4 ? '#EF4444' : sd.structForm < 0.8 ? '#22C55E' : 'var(--text)';
    const thresholds = [
      { range: '≤ 1.0',     adj: '+5%',       active: sd.structForm <= 1.0 },
      { range: '1.0 – 1.4', adj: '0%',        active: sd.structForm > 1.0 && sd.structForm <= 1.4 },
      { range: '1.4 – 2.0', adj: '0% → −30%', active: sd.structForm > 1.4 && sd.structForm < 2.0 },
      { range: '≥ 2.0',     adj: '−30% cap',  active: sd.structForm >= 2.0 },
    ];
    calibEl.style.display = 'block';
    calibEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:#3B82F6;">${Math.round(sd.ctl)}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.ctl')}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:#F59E0B;">${Math.round(sd.atl)}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.atl')}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:.95rem;font-weight:900;color:${formColor};">${sd.structForm}</div>
          <div style="font-size:.65rem;color:var(--label);margin-top:2px;">${t('struct.form.ratio')}</div>
        </div>
      </div>
      <div style="border:0.5px solid var(--glass-border);border-radius:8px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:1fr 1fr;padding:6px 10px;background:var(--surface2);">
          <div style="font-size:.65rem;font-weight:800;color:var(--label);">${t('struct.form')}</div>
          <div style="font-size:.65rem;font-weight:800;color:var(--label);text-align:right;">${t('struct.capacity')}</div>
        </div>
        ${thresholds.map(row => `
        <div style="display:grid;grid-template-columns:1fr 1fr;padding:6px 10px;${row.active ? 'background:rgba(255,107,53,.08);border-left:2px solid var(--brand);' : 'border-left:2px solid transparent;'}">
          <div style="font-size:.72rem;color:${row.active ? 'var(--text)' : 'var(--label)'};">${row.range}</div>
          <div style="font-size:.72rem;font-weight:${row.active ? '800' : '400'};color:${row.active ? 'var(--brand)' : 'var(--label)'};text-align:right;">${row.adj}</div>
        </div>`).join('')}
      </div>`;
  }
}

/* Open a chart in fullscreen horizontal overlay */
function getChartExplanation(key) {
  const lang = document.documentElement.lang || localStorage.getItem('wod-lang') || 'en';
  const isES = lang === 'es';
  const HOW = isES ? 'Cómo leer este gráfico' : 'How to read this chart';
  const LOOK = isES ? '💡 QUÉ BUSCAR' : '💡 WHAT TO LOOK FOR';
  const C = {
    scatter: isES
      ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;">Cada punto es una sesión. <strong style="color:var(--text);">Eje vertical = Intensidad Cardiovascular (MET)</strong> — qué tan duro trabajó todo tu sistema, con frecuencia cardíaca y ritmo reales, no solo el trabajo con barra. <strong style="color:var(--text);">Eje horizontal = Sesgo de Fuerza</strong> — tonelaje relativo al trabajo mecánico, sin componente de tiempo, así que una escalera pesada o un esfuerzo máximo se refleja correctamente sin importar el descanso alrededor. Más a la derecha = trabajo cargado más pesado. Más arriba = más demanda sistémica. <strong style="color:var(--text);">El tamaño del punto = Trabajo Mecánico Total (kJ)</strong> — así se distingue una sesión pesada de bajo volumen de un metcon de alto volumen, aunque caigan en el mismo cuadrante.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:4px;">METCON — arriba izquierda</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alta demanda cardiovascular, bajo Sesgo de Fuerza. Acondicionamiento dominado por carrera o gimnasia — el reloj y tu frecuencia cardíaca hacen el trabajo, no la barra.</div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:4px;">METCON PESADO — arriba derecha</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alta demanda cardiovascular Y alto Sesgo de Fuerza. Acondicionamiento cargado — thrusters, complejos de clean pesados, trabajo rápido y pesado a la vez.</div></div><div style="background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#94A3B8;margin-bottom:4px;">BASE AERÓBICA — abajo izquierda</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Baja demanda cardiovascular, bajo Sesgo de Fuerza. Sesiones de recuperación, ritmo sostenido fácil, trabajo de movimiento liviano.</div></div><div style="background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#14B8A6;margin-bottom:4px;">TRABAJO DE FUERZA — abajo derecha</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alto Sesgo de Fuerza, baja demanda cardiovascular. Levantamientos pesados y escaleras con descanso real entre intentos — el trabajo cargado es genuinamente pesado, tu frecuencia cardíaca no se mantiene elevada.</div></div></div><p style="font-size:.72rem;color:var(--label);line-height:1.6;">Este gráfico es deliberadamente independiente del gráfico de Potencia Mecánica / Carga Interna — este muestra intensidad <em>promedio</em> por sesión, aquel muestra carga <em>acumulada</em> en el tiempo. Para el balance de modalidades, ver el gráfico de Sesgo de Movimiento.</p>`
      : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;">Each dot is one session. <strong style="color:var(--text);">Vertical axis = Cardiovascular Intensity (MET)</strong> — how hard your whole system worked, real heart rate and pace included, not just barbell output. <strong style="color:var(--text);">Horizontal axis = Force Bias</strong> — tonnage relative to mechanical work, with no time component at all, so a heavy ladder or max-effort single reads correctly regardless of the rest surrounding it. Higher right = heavier loaded work. Higher up = more systemic demand. <strong style="color:var(--text);">Dot size = Total Mechanical Work (kJ)</strong> — this is what separates a heavy low-volume set from a high-volume metcon even when they land in the same quadrant.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:4px;">METCON — top left</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">High cardiovascular demand, low Force Bias. Running-heavy or bodyweight-heavy conditioning — sessions where the clock and your heart rate are doing the work, not the barbell.</div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:4px;">HEAVY METCON — top right</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">High cardiovascular demand AND high Force Bias. Loaded conditioning — thrusters, heavy clean complexes, grunt work that's both fast and heavy.</div></div><div style="background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#94A3B8;margin-bottom:4px;">RECOVERY / SKILL — bottom left</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Low cardiovascular demand, low Force Bias. Not "not real training" — recovery sessions, technique/skill work at low intensity, easy sustained pace, deliberate Zone-2 aerobic base.</div></div><div style="background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#14B8A6;margin-bottom:4px;">STRENGTH WORK — bottom right</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">High Force Bias, low cardiovascular demand. Heavy lifts and ladders with real rest between attempts — the loaded work is genuinely heavy, your heart rate isn't staying elevated.</div></div></div><p style="font-size:.72rem;color:var(--label);line-height:1.6;">This chart is deliberately separate from the Mechanical Power / Internal Load chart — this one shows <em>average</em> intensity per session, that one shows <em>accumulated</em> load over time. For training modality balance, see the Movement Bias Trend chart.</p>`,

    totalwork: isES
      ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Trabajo mecánico total (kJ)</strong> en 6 semanas. Cada barra es el total de una semana. Los <strong style="color:#60A5FA;">puntos azules</strong> muestran sesiones individuales, posicionados según el día real de la semana en que ocurrieron — lunes a domingo, de izquierda a derecha. La <strong style="color:#3B82F6;">línea azul discontinua</strong> es tu promedio semanal de 6 semanas. El encabezado sobre el gráfico muestra la tendencia general como una sola flecha y porcentaje, en lugar de una segunda línea dibujada en el gráfico. Toca cualquier barra o punto para ver una tarjeta fija con los números exactos de esa semana, o el detalle de una sesión específica.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 BARRA VERDE — semana sobre el promedio</div><div style="font-size:.72rem;color:var(--label);">El total de esa semana fue igual o superior a tu promedio de 6 semanas.</div></div><div style="background:rgba(107,140,174,.08);border:1px solid rgba(107,140,174,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#6B8CAE;margin-bottom:3px;">🔵 BARRA AZUL APAGADO — bajo el promedio, no drásticamente</div><div style="font-size:.72rem;color:var(--label);">Entre 50% y 100% de tu promedio. Puede ser genuinamente una descarga planificada, un taper, o una semana más liviana — no se trata como una alerta, ya que una semana bajo el promedio no es automáticamente una semana fallida.</div></div><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:3px;">🔴 BARRA ROJA — muy por debajo del promedio</div><div style="font-size:.72rem;color:var(--label);">Menos del 50% de tu promedio de 6 semanas — un déficit genuinamente grande. Puede ser viaje, enfermedad, o entrenamiento insuficiente real, vale la pena revisar.</div></div></div>`
      : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Total mechanical work (kJ)</strong> over 6 weeks. Each bar is one week's total. <strong style="color:#60A5FA;">Blue dots</strong> show individual sessions, positioned by the actual day of the week they happened — Monday through Sunday, left to right. The <strong style="color:#3B82F6;">blue dashed line</strong> is your 6-week weekly average. The header above the chart shows the overall trend as a single arrow and percentage, rather than a second line drawn on the chart itself. Tap any bar or dot for a pinned card with that week's exact numbers, or a specific session's detail.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 GREEN BAR — above average week</div><div style="font-size:.72rem;color:var(--label);">That week's total was at or above your 6-week average.</div></div><div style="background:rgba(107,140,174,.08);border:1px solid rgba(107,140,174,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#6B8CAE;margin-bottom:3px;">🔵 MUTED BLUE BAR — below average, not dramatically</div><div style="font-size:.72rem;color:var(--label);">Between 50% and 100% of your average. Could genuinely be a planned deload, taper, or lighter week — not treated as a red flag, since a below-average week isn't automatically a failed one.</div></div><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:3px;">🔴 RED BAR — well below average</div><div style="font-size:.72rem;color:var(--label);">Under 50% of your 6-week average — a genuinely large shortfall. Could be travel, illness, or real undertraining, worth a second look.</div></div></div>`,

    density: isES
      ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Distribución del sistema energético en 6 semanas.</strong> El donut muestra la media ponderada de todas las sesiones del período. El centro muestra el sistema dominante, su porcentaje y el total de sesiones.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:3px;">🟠 FOSFÁGENO — fuerza y potencia</div><div style="font-size:.72rem;color:var(--label);">Trabajo pesado con barra, levantamientos olímpicos, esfuerzos intensos de menos de 10 segundos. Desarrolla fuerza máxima y tasa de producción de fuerza.</div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">🟡 GLUCOLÍTICO — acondicionamiento</div><div style="font-size:.72rem;color:var(--label);">Trabajo modal mixto, esfuerzos repetidos de media intensidad de 30s a 2min. El motor del CrossFit. Desarrolla el acondicionamiento metabólico.</div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 AERÓBICO — resistencia</div><div style="font-size:.72rem;color:var(--label);">Carrera, remo, ski erg, esfuerzos sostenidos de más de 2 minutos. Construye la base aeróbica y la capacidad de recuperación.</div></div><div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">${LOOK}</div><div style="font-size:.72rem;color:var(--label);">Un programa equilibrado muestra los tres sistemas. Una sección dominante no intencionada señala una brecha de programación.</div></div></div>`
      : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">6-week energy system distribution.</strong> The donut shows the weighted average split across all sessions in the period. The centre shows the dominant system, its percentage, and the total session count.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:3px;">🟠 PHOSPHAGEN — strength & power</div><div style="font-size:.72rem;color:var(--label);">Heavy barbell work, olympic lifts, short intense efforts under 10 seconds. Builds maximal strength and rate of force development.</div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">🟡 GLYCOLYTIC — conditioning</div><div style="font-size:.72rem;color:var(--label);">Mixed modal work, medium-intensity repeated efforts 30s–2min. The CrossFit engine. Builds metabolic conditioning.</div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 AEROBIC — endurance</div><div style="font-size:.72rem;color:var(--label);">Running, rowing, ski erg, sustained efforts over 2 minutes. Builds aerobic base and recovery capacity.</div></div><div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">${LOOK}</div><div style="font-size:.72rem;color:var(--label);">A balanced programme shows all three systems. A dominant slice you didn't intend signals a programming gap.</div></div></div>`,

    movbias: (() => {
      const patternKeysForExplain = ['squat','hinge','push','pull','olympic','core','carry','handstand','monostructural'];
      const patternColorsForExplain = { squat:'#A78BFA', hinge:'#EF4444', push:'#3B82F6', pull:'#22C55E', olympic:'#F59E0B', core:'#EC4899', carry:'#14B8A6', handstand:'#8B5CF6', monostructural:'#06B6D4' };
      const detailBlocks = patternKeysForExplain.map(k => {
        const c = patternColorsForExplain[k];
        return `<div style="background:${c}14;border:1px solid ${c}40;border-radius:8px;padding:10px 12px;margin-bottom:6px;">
          <div style="font-size:.7rem;font-weight:800;color:${c};margin-bottom:3px;">${t('pattern.'+k+'.short')}</div>
          <div style="font-size:.72rem;color:var(--label);line-height:1.5;">${t('pattern.'+k+'.desc')}</div>
        </div>`;
      }).join('');
      return isES
        ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:12px;"><strong style="color:var(--text);">Distribución del patrón de movimiento en 6 semanas.</strong> El donut muestra la media ponderada de todas las sesiones del período. El centro muestra el patrón dominante, su porcentaje y el total de sesiones.</p>${detailBlocks}<div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;margin-top:6px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">${LOOK}</div><div style="font-size:.72rem;color:var(--label);">Un programa equilibrado cubre varios patrones a lo largo de 6 semanas. Un patrón ausente por completo (o uno que domina cada sesión) señala una brecha de programación real, no solo una preferencia.</div></div>`
        : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:12px;"><strong style="color:var(--text);">6-week movement pattern distribution.</strong> The donut shows the weighted average split across all sessions in the period. The centre shows the dominant pattern, its percentage, and the total session count.</p>${detailBlocks}<div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;margin-top:6px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">${LOOK}</div><div style="font-size:.72rem;color:var(--label);">A balanced programme covers several patterns across 6 weeks. A pattern that never appears — or one that dominates every session — signals a real programming gap, not just a preference.</div></div>`;
    })(),

    kcal: isES
      ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Costo Metabólico Total (kcal)</strong> — energía mecánica más energía aeróbica, ajustada por edad y género. Nuevas sesiones muestran barra dividida; sesiones antiguas se muestran como barra gris única. El encabezado sobre el gráfico muestra tu promedio de 6 semanas.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 TOCA UNA BARRA O SEGMENTO</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Actualiza la tarjeta fija abajo con el total de esa semana, el desglose, el conteo de sesiones, y una conclusión clave. Tocar un color específico — Mecánico, Aeróbico, o Sobrecarga — también atenúa los otros dos en todas las semanas, para que puedas seguir la tendencia de ese componente específico. Toca de nuevo, o toca un área sin segmento, para quitar el enfoque.</div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:3px;">🟠 MECÁNICO — del levantamiento</div><div style="font-size:.72rem;color:var(--label);">Costo energético de la producción de fuerza — barras, gimnasia, saltos. Calculado mediante W = F × d.</div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--success);margin-bottom:3px;">🟢 AERÓBICO — del cardio</div><div style="font-size:.72rem;color:var(--label);">Costo energético del cardio sostenido — carrera, remo, ski erg, bicicleta. Estimado mediante modelo de Riegel.</div></div><div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">🔵 SOBRECARGA AERÓBICA (est.) — costo sistémico</div><div style="font-size:.72rem;color:var(--label);">El costo metabólico aeróbico total más allá del trabajo mecánico — FC elevada, recuperación entre series, EPOC. Requiere VO₂max en el Perfil.</div></div><div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">💡 BARRA ALTA + kJ BAJO = sesión aeróbica</div><div style="font-size:.72rem;color:var(--label);">Muchas kcal con poco Trabajo Total (kJ) significa que dominó el cardio — correr y remar cuesta energía pero produce poco trabajo mecánico.</div></div></div>`
      : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Total Metabolic Cost (kcal)</strong> — mechanical energy plus aerobic energy, adjusted for age and gender. New sessions show a split bar; older sessions show as a single grey bar. The header above the chart shows your 6-week average.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 TAP A BAR OR SEGMENT</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Updates the pinned card below with that week's total, split breakdown, session count, and a key takeaway. Tapping a specific color — Mechanical, Aerobic, or Overhead — also dims the other two across every week, so you can trace just that one component's trend. Tap it again, or tap a bar-only area, to clear the focus.</div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:3px;">🟠 MECHANICAL — from lifting</div><div style="font-size:.72rem;color:var(--label);">Energy cost of force production — barbell work, gymnastics, jumping. Calculated via W = F × d.</div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--success);margin-bottom:3px;">🟢 AEROBIC — from cardio</div><div style="font-size:.72rem;color:var(--label);">Energy cost of sustained cardio — running, rowing, ski erg, bike. Estimated via Riegel model, corrected for age and gender.</div></div><div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">🔵 AEROBIC OVERHEAD (est.) — systemic cost</div><div style="font-size:.72rem;color:var(--label);">The full aerobic metabolic cost of the session beyond mechanical work — elevated heart rate, inter-set recovery, EPOC. Requires VO₂max in Profile. Estimated from relative intensity model.</div></div><div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">💡 TALL BAR + LOW kJ = aerobic session</div><div style="font-size:.72rem;color:var(--label);">High kcal with low Total Work (kJ) means cardio dominated — running and rowing cost energy but produce little mechanical work.</div></div></div>`,

    peakload: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">How to read this chart</div>
<p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;"><strong style="color:var(--text);">Weekly Peak Load</strong> combines two data series to show both your absolute strength ceiling and your typical strength demand each week.</p>
<div style="display:flex;flex-direction:column;gap:8px;">
  <div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 TWO TABS — Peak Load % / e1RM Trend</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;"><strong style="color:var(--text);">Peak Load %</strong> (above) shows weekly exposure across all your strength work. <strong style="color:var(--text);">e1RM Trend</strong> is a genuinely different question — real progress on one specific lift over your full history, using Epley's formula on low-rep working sets. They're deliberately separate: blending different lifts into one number would mix things that aren't comparable.</div>
  </div>
  <div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 MOVEMENT PATTERN FILTER</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Narrows both the chart and the tap-to-inspect card below to one pattern (Squat, Hinge, Olympic, or Push — the only four with any 1RM data to filter by). Selecting a pattern will show a lower Heavy Tonnage number than "All Patterns" for the same week whenever you trained more than one heavy lift that week — the gap is real tonnage from whatever else crossed 70%, not a discrepancy.</div>
  </div>
  <div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 TAP ANY BAR TO INSPECT THAT WEEK</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">The card above the chart defaults to your most recent week and updates the moment you tap a different bar — showing that week's real peak RL (even for lighter weeks that never crossed 70%) alongside its Heavy Tonnage.</div>
  </div>
  <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:4px;">🔴 RED LINE — Average RL (all sessions)</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Average peak RL across all sessions with matched 1RM data that week. Always continuous — spans weeks with no strength work. Uniform red dots with white border.</div>
  </div>
  <div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:var(--text);margin-bottom:6px;">COLOURED BARS — Peak RL (≥70% sessions only)</div>
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(34,197,94,0.5);border:1px solid rgba(34,197,94,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#22C55E;">Green 70–74%</strong> — Above strength threshold. Training in the strength zone.</div></div>
      <div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(245,158,11,0.5);border:1px solid rgba(245,158,11,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#F59E0B;">Amber 75–89%</strong> — Heavy training zone. Primary driver of strength adaptation. 48h recovery.</div></div>
      <div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(239,68,68,0.5);border:1px solid rgba(239,68,68,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#EF4444;">Red ≥90%</strong> — Near-maximal effort. High CNS demand. 72h+ recovery recommended.</div></div>
      <div style="font-size:.72rem;color:var(--label);margin-top:2px;">No bar = no session crossed 70% that week (conditioning-dominant week).</div>
    </div>
  </div>
  <div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:4px;">🟠 DASHED LINE — 70% Strength Threshold</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Above = genuine strength loading. Below = conditioning or technique work. Recovery model activates for sessions crossing this line.</div>
  </div>
  <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:4px;">🔴 FAINT LINE AT 100% — 1RM Ceiling</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Bar reaches or crosses this — update your 1RM PR in the Profile.</div>
  </div>
  <div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 READING THE GAP</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Large gap between bar and red line = one maximal effort alongside lighter sessions. Lines close together = consistent loading. Bar absent, line below 70% = conditioning week.</div>
  </div>
  <div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 BODYWEIGHT-ONLY SESSIONS</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Pure bodyweight sessions without matched 1RM movements do not appear on this chart.</div>
  </div>
</div>`,
    banister: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">How to read this chart</div>
<p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Aerobic Fitness — 6-Week Trend.</strong> Built on the Banister impulse-response model (Dr. Eric Banister, 1975). Load is driven by the <strong style="color:var(--text);">cardiovascular metabolic cost</strong> of each session — the calories expended through cardio movements (mc_aero) and the aerobic overhead of supporting barbell and gymnastics work (mc_overhead). Separate intensity amplifiers for cardio and mixed sessions ensure each type of work is compared against its own rolling baseline.</p>
<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
  <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">🔵 FITNESS — CTL (Chronic Training Load) · left axis</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">42-day exponentially weighted average of your daily cardiovascular metabolic load. Builds slowly over months. High CTL = large aerobic base — you can handle more volume without breaking down. Decays slowly during rest periods.</div>
  </div>
  <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">🟠 FATIGUE — ATL (Acute Training Load) · left axis</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">7-day exponentially weighted average. Spikes quickly after hard or long sessions, drops fast with rest. Always close to CTL during consistent training. When ATL rises well above CTL, fatigue is accumulating.</div>
  </div>
  <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 FORM — TSB (Training Stress Balance) · right axis</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">TSB = ATL ÷ CTL. A ratio, not a subtraction. TSB = 1.0 means fatigue exactly equals fitness — perfectly balanced.</div>
  </div>
</div>
<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
  <div style="font-size:.68rem;font-weight:800;color:var(--label);letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px;">TSB Zones</div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#EF4444;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">Above 2.0 — Overreaching.</strong> Fatigue is double your fitness base. Rest now.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#F59E0B;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">1.4 – 2.0 — Fatigued.</strong> Accumulating fatigue. Normal in a training block — reduce intensity if sustained.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">0.8 – 1.4 — Neutral.</strong> Balanced. Good day to train normally.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">0.4 – 0.8 — Peaking.</strong> Fresh and fit. Push hard — good time for a max effort or benchmark WOD.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;border:1px solid #F59E0B;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">Below 0.4 — Detraining Risk.</strong> Very fresh but training stimulus has dropped too low. Add a session — fitness is starting to decay.</div></div>
</div>
<div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;">
  <div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 WHAT TO LOOK FOR</div>
  <div style="font-size:.72rem;color:var(--label);line-height:1.5;">CTL rising = your aerobic base is building. ATL spiking then dropping = hard session followed by rest — healthy pattern. Form above 1.4 during a training block is <em>normal and expected</em>. Form dropping below 0.8 after a deload = peak performance window — compete or test your max. Long flat periods where CTL stops rising = training stimulus too low.</div>
</div>`,
    structural: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">How the structural battery works</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;">The structural battery tracks cumulative stress on muscles, tendons, and connective tissue driven by the <strong style="color:var(--text);">mechanical metabolic cost (mc_mech)</strong> of each session. Unlike the aerobic model which tracks cardiovascular demand, the structural battery tracks tissue-level stress. Pure cardio sessions generate no structural load.</p><div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;"><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:3px;">WHAT DEPLETES THE BATTERY?</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Any movement with mc_mech &gt; 0 — barbell work, gymnastics, bodyweight. Pure cardio (running, rowing) has near-zero mc_mech.</div><div id="struct-contrib-chart" style="display:none;position:relative;height:140px;margin-top:10px;"><canvas role="img" aria-label="Session structural load contributions"></canvas></div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">VARIABLE RECOVERY RATE</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Recovery half-life depends on mechanical intensity. High-intensity heavy sessions: up to 72 hours. Light technical sessions: as little as 12 hours. Multiple sessions follow a composite decay curve — lighter sessions clear first.</div><div id="struct-forecast-chart" style="display:none;position:relative;height:130px;margin-top:10px;"><canvas role="img" aria-label="Structural battery recharge forecast"></canvas></div></div><div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">PERSONAL CAPACITY (MAXLOAD)</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Set by your best consecutive training block. Grows with consistent training, decays with inactivity — 5% at week 2, 10% at week 3, +10%/week after, gone at week 8.</div><div id="struct-maxload-cards" style="display:none;margin-top:10px;"></div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">CHRONIC OVERLOAD CALIBRATION</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">With enough history, WOD Architect monitors whether recent structural load exceeds your chronic baseline. If so, MaxLoad is reduced up to 30%, making the battery more sensitive. Resolves automatically with rest.</div><div id="struct-calib-cards" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;"></div></div></div>`,
    profile: isES
      ? `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Perfil de entrenamiento de 6 semanas</strong> — promedio de todas las sesiones. Muestra qué tipo de atleta está construyendo tu programación. Toca "Ver Tendencia de 12 Semanas" para ver cómo tu perfil ha cambiado, ventana por ventana, a lo largo de las últimas 12 semanas.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">POTENCIA MECÁNICA</div><div style="font-size:.7rem;color:var(--label);">W/kg — trabajo mecánico por kg de peso corporal.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">INTENSIDAD CARDIO</div><div style="font-size:.7rem;color:var(--label);">MET — qué tan duro trabajó tu sistema cardiovascular, en promedio.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">TRABAJO MECÁNICO</div><div style="font-size:.7rem;color:var(--label);">kJ — volumen mecánico por sesión.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">ESFUERZO CARDIO</div><div style="font-size:.7rem;color:var(--label);">MET-min — carga cardiovascular acumulada, no solo la intensidad promedio.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">SESGO DE FUERZA</div><div style="font-size:.7rem;color:var(--label);">Alto = fuerza. Bajo = acondicionamiento.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">DEMANDA TÉC.</div><div style="font-size:.7rem;color:var(--label);">Complejidad técnica 1-5. Los levantamientos olímpicos puntúan más alto.</div></div></div>`
      : `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">${HOW}</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">6-week training profile</strong> — average across every session. Shows what kind of athlete your programming is building. Tap "Show 12-Week Trend" to see how your profile has shifted, window by window, over the last 12 weeks.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">MECHANICAL POWER</div><div style="font-size:.7rem;color:var(--label);">W/kg — mechanical work per kg of bodyweight.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">CARDIO INTENSITY</div><div style="font-size:.7rem;color:var(--label);">MET — how hard your cardiovascular system worked, on average.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">MECHANICAL WORK</div><div style="font-size:.7rem;color:var(--label);">kJ — mechanical volume per session.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">CARDIO STRAIN</div><div style="font-size:.7rem;color:var(--label);">MET-min — accumulated cardiovascular load, not just average intensity.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">FORCE BIAS</div><div style="font-size:.7rem;color:var(--label);">High = strength. Low = conditioning.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:9px;"><div style="font-size:.68rem;font-weight:800;color:var(--text);margin-bottom:2px;">TECH. DEMAND</div><div style="font-size:.7rem;color:var(--label);">Technical complexity 1-5. Olympic lifts score highest.</div></div></div>`,
  };
  // Spanish versions
  const ES = {
    scatter: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;">Cada punto es una sesión. <strong style="color:var(--text);">Eje vertical = Intensidad Cardiovascular (MET)</strong> — qué tan duro trabajó todo tu sistema. <strong style="color:var(--text);">Eje horizontal = Sesgo de Fuerza</strong> — tonelaje relativo al trabajo mecánico, sin componente de tiempo. Más a la derecha = más cargado. Más arriba = más demanda sistémica.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:4px;">METCON — arriba izquierda</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alta demanda cardiovascular, bajo Sesgo de Fuerza. Acondicionamiento dominado por carrera o gimnasia.</div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:4px;">METCON PESADO — arriba derecha</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alta demanda cardiovascular Y alto Sesgo de Fuerza. Acondicionamiento cargado — thrusters, complejos de clean, trabajo duro.</div></div><div style="background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#94A3B8;margin-bottom:4px;">RECUPERACIÓN / TÉCNICA — abajo izquierda</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Baja demanda cardiovascular, bajo Sesgo de Fuerza. Sesiones de recuperación, trabajo técnico, ritmo sostenido fácil.</div></div><div style="background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#14B8A6;margin-bottom:4px;">TRABAJO DE FUERZA — abajo derecha</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Alto Sesgo de Fuerza, baja demanda cardiovascular. Levantamientos pesados y escaleras con descanso real entre intentos.</div></div></div><p style="font-size:.72rem;color:var(--label);line-height:1.6;">Este gráfico es independiente del gráfico de Potencia Mecánica / Carga Interna. Para el equilibrio de modalidad, ver el gráfico de Tendencia de Sesgo de Movimiento.</p>`,
    totalwork: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Trabajo mecánico total (kJ)</strong> en 6 semanas. Cada barra es el total de una semana. Los <strong style="color:#60A5FA;">puntos azules</strong> muestran sesiones individuales, posicionados según el día real de la semana en que ocurrieron. La <strong style="color:#3B82F6;">línea azul discontinua</strong> es tu promedio semanal de 6 semanas. El encabezado sobre el gráfico muestra la tendencia general como una flecha y porcentaje.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 BARRA VERDE — semana sobre el promedio</div><div style="font-size:.72rem;color:var(--label);">El total de esa semana fue igual o superior a tu promedio de 6 semanas.</div></div><div style="background:rgba(107,140,174,.08);border:1px solid rgba(107,140,174,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#6B8CAE;margin-bottom:3px;">🔵 BARRA AZUL APAGADO — bajo el promedio, no drásticamente</div><div style="font-size:.72rem;color:var(--label);">Entre 50% y 100% de tu promedio. Puede ser una descarga planificada, no necesariamente una semana fallida.</div></div><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:3px;">🔴 BARRA ROJA — muy por debajo del promedio</div><div style="font-size:.72rem;color:var(--label);">Menos del 50% de tu promedio — un déficit genuinamente grande.</div></div></div>`,
    density: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Distribución del sistema energético en 6 semanas.</strong> El donut muestra la media ponderada de todas las sesiones del período. El centro muestra el sistema dominante, su porcentaje y el total de sesiones.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#FF6B35;margin-bottom:3px;">🟠 FOSFÁGENO — fuerza y potencia</div><div style="font-size:.72rem;color:var(--label);">Trabajo pesado con barra, levantamientos olímpicos, esfuerzos intensos de menos de 10 segundos. Desarrolla fuerza máxima y tasa de producción de fuerza.</div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">🟡 GLUCOLÍTICO — acondicionamiento</div><div style="font-size:.72rem;color:var(--label);">Trabajo modal mixto, esfuerzos repetidos de media intensidad de 30s a 2min. El motor del CrossFit. Desarrolla el acondicionamiento metabólico.</div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 AERÓBICO — resistencia</div><div style="font-size:.72rem;color:var(--label);">Carrera, remo, ski erg, esfuerzos sostenidos de más de 2 minutos. Construye la base aeróbica y la capacidad de recuperación.</div></div><div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">💡 QUÉ BUSCAR</div><div style="font-size:.72rem;color:var(--label);">Un programa equilibrado muestra los tres sistemas. Una sección dominante no intencionada señala una brecha de programación.</div></div></div>`,
    kcal: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Costo Metabólico Total (kcal)</strong> — energía mecánica más energía aeróbica, ajustada por edad y género. Las sesiones nuevas muestran una barra dividida; las más antiguas aparecen como una barra gris única.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--brand);"><div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:3px;">🟠 MECÁNICO — del levantamiento</div><div style="font-size:.72rem;color:var(--label);">Costo energético de la producción de fuerza — trabajo con barra, gimnasia, saltos. Calculado mediante W = F × d.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--success);"><div style="font-size:.7rem;font-weight:800;color:var(--success);margin-bottom:3px;">🟢 AERÓBICO — del cardio</div><div style="font-size:.72rem;color:var(--label);">Costo energético del cardio sostenido — carrera, remo, ski erg, bici. Estimado mediante el modelo de Riegel, corregido por edad y género.</div></div><div style="background:rgba(59,130,246,.08);border-radius:8px;padding:10px;border-left:3px solid #3B82F6;"><div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">🔵 SOBRECARGA AERÓBICA (est.) — costo sistémico</div><div style="font-size:.72rem;color:var(--label);">El costo metabólico aeróbico completo de la sesión más allá del trabajo mecánico — frecuencia cardíaca elevada, recuperación entre series, EPOC. Requiere VO₂max en el Perfil.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--glass-border);"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:3px;">💡 BARRA ALTA + kJ BAJOS = sesión aeróbica</div><div style="font-size:.72rem;color:var(--label);">Alto kcal con bajo Trabajo Total (kJ) significa que el cardio dominó — carrera y remo consumen energía pero producen poco trabajo mecánico.</div></div></div>`,
    peakload: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;"><strong style="color:var(--text);">Carga Pico Semanal</strong> combina dos series de datos para mostrar tanto tu techo de fuerza absoluta como tu demanda de fuerza típica cada semana.</p><div style="display:flex;flex-direction:column;gap:8px;"><div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 DOS PESTAÑAS — Carga Pico % / Tendencia e1RM</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;"><strong style="color:var(--text);">Carga Pico %</strong> (arriba) muestra la exposición semanal en todo tu trabajo de fuerza. <strong style="color:var(--text);">Tendencia e1RM</strong> es una pregunta distinta — progreso real en un levantamiento específico a lo largo de todo tu historial, usando la fórmula de Epley en series de pocas repeticiones. Son deliberadamente independientes: mezclar diferentes levantamientos en un solo número combinaría cosas que no son comparables.</div></div><div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 FILTRO DE PATRÓN DE MOVIMIENTO</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Reduce tanto el gráfico como la tarjeta de inspección a un solo patrón (Sentadilla, Bisagra, Olímpico o Empuje — los únicos cuatro con datos de 1RM para filtrar). Seleccionar un patrón mostrará un Tonelaje Pesado menor que "Todos los Patrones" para la misma semana si entrenaste más de un levantamiento pesado esa semana — la diferencia es tonelaje real de lo que sea que también superó el 70%, no un error.</div></div><div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#60A5FA;margin-bottom:4px;">🔵 TOCA CUALQUIER BARRA PARA INSPECCIONAR ESA SEMANA</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">La tarjeta sobre el gráfico muestra tu semana más reciente por defecto y se actualiza al tocar una barra distinta — mostrando el RL pico real de esa semana (incluso semanas más livianas que nunca superaron el 70%) junto a su Tonelaje Pesado.</div></div><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:4px;">🔴 LÍNEA ROJA — RL promedio (todas las sesiones)</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">RL pico promedio en todas las sesiones con datos de 1RM coincidentes esa semana.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--glass-border);"><div style="font-size:.7rem;font-weight:800;color:var(--text);margin-bottom:6px;">BARRAS DE COLORES — RL Pico (solo sesiones ≥70%)</div><div style="display:flex;flex-direction:column;gap:5px;"><div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(34,197,94,0.5);border:1px solid rgba(34,197,94,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#22C55E;">Verde 70–74%</strong> — Zona de fuerza. Entrenamiento en el umbral de fuerza.</div></div><div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(245,158,11,0.5);border:1px solid rgba(245,158,11,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#F59E0B;">Ámbar 75–89%</strong> — Zona de entrenamiento pesado. Principal impulsor de la adaptación de fuerza. Recuperación 48h.</div></div><div style="display:flex;align-items:center;gap:8px;"><div style="width:12px;height:12px;border-radius:2px;background:rgba(239,68,68,0.5);border:1px solid rgba(239,68,68,0.8);flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:#EF4444;">Rojo ≥90%</strong> — Esfuerzo casi máximo. Alta demanda del SNC. Recuperación recomendada 72h+.</div></div><div style="font-size:.72rem;color:var(--label);margin-top:2px;">Sin barra = ninguna sesión superó el 70% esa semana (semana dominante de acondicionamiento).</div></div></div><div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:var(--brand);margin-bottom:4px;">🟠 LÍNEA DISCONTINUA — Umbral de Fuerza 70%</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Por encima = carga de fuerza genuina. Por debajo = acondicionamiento o trabajo técnico.</div></div><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:4px;">🔴 LÍNEA TENUE AL 100% — Techo del 1RM</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Si la barra alcanza o supera esta línea — actualiza tu 1RM en el Perfil.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--glass-border);"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 LEYENDO LA BRECHA</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Gran brecha entre barra y línea roja = un esfuerzo máximo junto a sesiones más ligeras. Líneas juntas = carga consistente. Sin barra, línea bajo 70% = semana de acondicionamiento.</div></div><div style="background:var(--glass-inner);border-radius:8px;padding:10px;border-left:3px solid var(--glass-border);"><div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 SESIONES SOLO PESO CORPORAL</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Las sesiones puras de peso corporal sin movimientos con 1RM coincidentes no aparecen en este gráfico.</div></div></div>`,
    banister: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Cómo leer este gráfico</div>
<p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:10px;"><strong style="color:var(--text);">Condición Aeróbica — Tendencia de 6 Semanas.</strong> Basado en el modelo de impulso-respuesta de Banister (Dr. Eric Banister, 1975). La carga está impulsada por el <strong style="color:var(--text);">costo metabólico cardiovascular</strong> de cada sesión — las calorías gastadas en movimientos de cardio (mc_aero) y el overhead aeróbico de apoyar el trabajo con barra y gimnasia (mc_overhead). Amplificadores de intensidad separados para cardio y sesiones mixtas.</p>
<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
  <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">🔵 CONDICIÓN — CTL (Carga de Entrenamiento Crónica) · eje izquierdo</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Promedio ponderado exponencial de 42 días de tu carga metabólica cardiovascular diaria. Se construye lentamente a lo largo de meses. CTL alto = gran base aeróbica.</div>
  </div>
  <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">🟠 FATIGA — ATL (Carga de Entrenamiento Aguda) · eje izquierdo</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">Promedio ponderado de 7 días. Sube rápido tras sesiones duras o largas, baja rápido con el descanso. Cuando ATL sube muy por encima de CTL, la fatiga se acumula.</div>
  </div>
  <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;">
    <div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">🟢 FORMA — TSB (Balance de Estrés de Entrenamiento) · eje derecho</div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.5;">TSB = ATL ÷ CTL. Un ratio, no una resta. TSB = 1.0 significa que la fatiga iguala exactamente la condición física — perfectamente equilibrado.</div>
  </div>
</div>
<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
  <div style="font-size:.68rem;font-weight:800;color:var(--label);letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px;">Zonas TSB</div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#EF4444;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">Más de 2.0 — Sobreentrenamiento.</strong> La fatiga dobla tu base. Descansa ahora.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#F59E0B;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">1.4 – 2.0 — Fatigado.</strong> Fatiga acumulándose. Normal en un bloque de entrenamiento.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">0.8 – 1.4 — Neutro.</strong> Equilibrado. Buen día para entrenar normalmente.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">0.4 – 0.8 — En Pico.</strong> Fresco y en forma. Esfuérzate — buen momento para un máximo o WOD de referencia.</div></div>
  <div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#22C55E;border:1px solid #F59E0B;flex-shrink:0;"></div><div style="font-size:.72rem;color:var(--label);"><strong style="color:var(--text);">Menos de 0.4 — Riesgo de Desentrenamiento.</strong> Muy fresco pero el estímulo es demasiado bajo. Agrega una sesión — la condición física empieza a decaer.</div></div>
</div>
<div style="background:rgba(156,163,175,.08);border:1px solid rgba(156,163,175,.25);border-radius:8px;padding:10px;">
  <div style="font-size:.7rem;font-weight:800;color:var(--label);margin-bottom:4px;">💡 QUÉ BUSCAR</div>
  <div style="font-size:.72rem;color:var(--label);line-height:1.5;">CTL subiendo = base aeróbica creciendo. ATL subiendo y bajando = sesión dura seguida de descanso — patrón saludable. Forma superior a 1.4 durante un bloque es <em>normal y esperado</em>. Forma bajando de 0.8 tras un deload = ventana de rendimiento óptimo. Períodos planos largos donde CTL deja de subir = estímulo de entrenamiento demasiado bajo.</div>
</div>`,
    structural: `<div style="font-size:.72rem;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">C&oacute;mo funciona la bater&iacute;a estructural</div><p style="font-size:.78rem;color:var(--label);line-height:1.6;margin-bottom:14px;">La bater&iacute;a estructural rastrea el estr&eacute;s acumulado en m&uacute;sculos, tendones y tejido conectivo impulsado por el <strong style="color:var(--text);">costo metab&oacute;lico mec&aacute;nico (mc_mech)</strong> de cada sesi&oacute;n. A diferencia del modelo aer&oacute;bico, rastrea el estr&eacute;s a nivel tisular. Las sesiones de cardio puro no generan carga estructural.</p><div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;"><div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#EF4444;margin-bottom:3px;">&iquest;QU&Eacute; DEPLETA LA BATER&Iacute;A?</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Cualquier movimiento con mc_mech &gt; 0 &mdash; trabajo con barra, gimnasia, peso corporal. El cardio puro (correr, remar) tiene mc_mech casi nulo.</div><div id="struct-contrib-chart" style="display:none;position:relative;height:140px;margin-top:10px;"><canvas role="img" aria-label="Contribuciones de carga estructural por sesi&oacute;n"></canvas></div></div><div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#22C55E;margin-bottom:3px;">TASA DE RECUPERACI&Oacute;N VARIABLE</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">La vida media de recuperaci&oacute;n depende de la intensidad mec&aacute;nica. Sesiones pesadas: hasta 72 horas. Sesiones t&eacute;cnicas ligeras: solo 12 horas. M&uacute;ltiples sesiones siguen una curva de decaimiento compuesta.</div><div id="struct-forecast-chart" style="display:none;position:relative;height:130px;margin-top:10px;"><canvas role="img" aria-label="Pron&oacute;stico de recarga estructural"></canvas></div></div><div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#3B82F6;margin-bottom:3px;">CAPACIDAD PERSONAL (MAXLOAD)</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Establecida por el mejor bloque de entrenamiento consecutivo. Crece con el entrenamiento consistente y decae con la inactividad hasta desaparecer en la semana 8.</div><div id="struct-maxload-cards" style="display:none;margin-top:10px;"></div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;"><div style="font-size:.7rem;font-weight:800;color:#F59E0B;margin-bottom:3px;">CALIBRACI&Oacute;N DE SOBRECARGA CR&Oacute;NICA</div><div style="font-size:.72rem;color:var(--label);line-height:1.5;">Con suficiente historial, monitoriza si la carga reciente supera la l&iacute;nea base cr&oacute;nica. Si es as&iacute;, MaxLoad se reduce hasta un 30%. Se resuelve autom&aacute;ticamente con el descanso.</div><div id="struct-calib-cards" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;"></div></div></div>`
  };
  return (_lang === 'es' ? ES[key] : C[key]) || C[key] || '';
}

// Rebuilds the Weekly Peak Load chart with the selected Movement Pattern
// filter (or none, for "All Patterns"). window.buildPeakLoadChartConfig
// is set by renderAnalytics() — see that function's comment for why
// this can't just be called directly as a normal top-level function.
function _onPeakLoadPatternChange() {
  const sel = document.getElementById('peakload-pattern-select');
  const patternFilter = sel?.value || null;
  if (typeof window.buildPeakLoadChartConfig !== 'function') return;

  const cfg = window.buildPeakLoadChartConfig(patternFilter, true); // true — this handler only ever runs in the fullscreen view
  cfg.options.maintainAspectRatio = false;
  cfg.options.responsive = true;
  // Keep the cached config in sync too, so closing and reopening the
  // modal without changing the filter shows the same filtered view
  // rather than snapping back to "All Patterns".
  if (_fsChartData) _fsChartData.peakload = cfg;

  if (_fsChartInstance) { try { _fsChartInstance.destroy(); } catch(e) {} _fsChartInstance = null; }
  const canvas = document.getElementById('chart-fs-canvas');
  if (canvas) _fsChartInstance = new Chart(canvas, cfg);
  _updatePeakLoadInsightCard(cfg.weeklyInsightData && cfg.weeklyInsightData.length ? cfg.weeklyInsightData[cfg.weeklyInsightData.length - 1] : null);
}

// Renders the e1RM chart for a specific movement — shared by the tab
// switch (first render) and the movement dropdown's own change handler
// (re-render on a different selection), so there's one render path,
// not two that could drift.
// Zone label + recovery guidance for a given peak RL value — matches
// the exact thresholds already used for the bar coloring (90/75), kept
// as one function so the card's text can never disagree with what the
// bars themselves show.
function _getRLZoneLabel(rl) {
  if (rl >= 90) return { text: t('peak.zone.red') || 'Red Zone — 72h+ recovery recommended', color: '#EF4444' };
  if (rl >= 75) return { text: t('peak.zone.amber') || 'Amber Zone — 48h recovery recommended', color: '#F59E0B' };
  return { text: t('peak.zone.green') || 'Green Zone — standard recovery', color: '#22C55E' };
}

// Classifies a point into one of the four quadrants using the same
// mean-based boundaries the chart's own background shading uses —
// can't disagree with what the chart visually shows, since it's the
// exact same avgX/avgY passed in from the same computation.
function _classifyScatterQuadrant(x, y, avgX, avgY) {
  if (x >= avgX && y >= avgY) return { key: 'heavyMetcon', text: t('scatter.heavy.metcon') || 'Heavy Metcon', color: '#FF6B35' };
  if (x < avgX && y >= avgY) return { key: 'metcon', text: t('scatter.metcon') || 'Metcon', color: '#F59E0B' };
  if (x >= avgX && y < avgY) return { key: 'strength', text: t('scatter.strength.work') || 'Strength Work', color: '#14B8A6' };
  return { key: 'recovery', text: t('scatter.aerobic.base') || 'Recovery / Skill', color: '#94A3B8' };
}

// Updates the scatter chart's persistent inspector card — shared by the
// default-view display and the tap handler, one update path for both.
function _updateScatterInsightCard(point, avgX, avgY) {
  const card = document.getElementById('scatter-insight-card');
  if (!card || !point) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('scatter-insight-title').textContent =
    `${point.label || 'Session'}${point.date ? ' — ' + point.date : ''}`;
  document.getElementById('scatter-insight-fb').textContent = Math.round(point.x || 0);
  document.getElementById('scatter-insight-cv').textContent = (point.y || 0).toFixed(1);
  document.getElementById('scatter-insight-wd').textContent = Math.round(point.wd || 0) + ' kJ';
  const quadrant = _classifyScatterQuadrant(point.x, point.y, avgX, avgY);
  const badge = document.getElementById('scatter-insight-badge');
  if (badge) { badge.textContent = quadrant.text; badge.style.color = quadrant.color; badge.style.borderColor = quadrant.color; }
}

// Updates the totalwork chart's persistent insight card. weekData and
// sessionPt are independent — either can be null. A bar tap supplies
// only weekData; a dot tap supplies both (its own detail plus the week
// it belongs to, per the onClick handler above); if neither exists
// there's nothing to show.
function _updateTotalworkInsightCard(weekData, sessionPt) {
  const card = document.getElementById('totalwork-insight-card');
  if (!card || (!weekData && !sessionPt)) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';

  const weekEl = document.getElementById('totalwork-insight-week');
  const totalEl = document.getElementById('totalwork-insight-total');
  const vsAvgEl = document.getElementById('totalwork-insight-vsavg');
  const countEl = document.getElementById('totalwork-insight-count');
  const sessionEl = document.getElementById('totalwork-insight-session');

  if (weekData) {
    weekEl.textContent = `${t('peak.insight.week') || 'Week of'} ${weekData.weekLabel}`;
    totalEl.textContent = weekData.totalKj + ' kJ';
    if (weekData.pctVsAvg != null) {
      const sign = weekData.pctVsAvg >= 0 ? '+' : '';
      vsAvgEl.textContent = `${sign}${weekData.pctVsAvg}% ${t('totalwork.insight.vsavg') || 'vs 6-Wk Avg'}`;
      // Reads the same colorTier the bars themselves are colored from —
      // can't disagree with what the bar shows, since it's not a
      // separately re-derived threshold check.
      const tierColors = { green: '#22C55E', muted: '#6B8CAE', red: '#EF4444' };
      vsAvgEl.style.color = tierColors[weekData.colorTier] || 'var(--label)';
    } else {
      vsAvgEl.textContent = '';
    }
    countEl.textContent = `${weekData.sessionCount} ${weekData.sessionCount === 1 ? (t('totalwork.insight.session.singular') || 'Session') : (t('totalwork.insight.session.plural') || 'Sessions')}`;
  } else {
    weekEl.textContent = '';
    totalEl.textContent = '—';
    vsAvgEl.textContent = '';
    countEl.textContent = '';
  }

  if (sessionPt) {
    sessionEl.style.display = '';
    sessionEl.textContent = `${sessionPt.date || ''} ${sessionPt.label || 'Session'}: ${sessionPt.y} kJ`;
  } else {
    sessionEl.style.display = 'none';
    sessionEl.textContent = '';
  }
}

// Updates the kcal chart's persistent insight card — total energy,
// %-vs-average, session count, the Mechanical/Aerobic/Overhead split
// with percentages, and an auto-classified key takeaway line.
function _updateKcalInsightCard(weekData) {
  const card = document.getElementById('kcal-insight-card');
  if (!card || !weekData) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';

  document.getElementById('kcal-insight-week').textContent = `${t('peak.insight.week') || 'Week of'} ${weekData.weekLabel}`;
  document.getElementById('kcal-insight-total').textContent = weekData.totalKcal + ' kcal';
  const vsAvgEl = document.getElementById('kcal-insight-vsavg');
  if (weekData.pctVsAvg != null) {
    const sign = weekData.pctVsAvg >= 0 ? '+' : '';
    vsAvgEl.textContent = `${sign}${weekData.pctVsAvg}% ${t('totalwork.insight.vsavg') || 'vs 6-Wk Avg'}`;
    vsAvgEl.style.color = weekData.pctVsAvg >= 0 ? '#22C55E' : 'var(--label)'; // kcal has no red-flag threshold defined (unlike totalwork's 50% rule) — neutral either direction
  } else {
    vsAvgEl.textContent = '';
  }
  document.getElementById('kcal-insight-count').textContent =
    `${weekData.sessionCount} ${weekData.sessionCount === 1 ? (t('totalwork.insight.session.singular') || 'Session') : (t('totalwork.insight.session.plural') || 'Sessions')}`;

  const total = weekData.mech + weekData.aero + weekData.overhead;
  const splitEl = document.getElementById('kcal-insight-split');
  if (total > 0) {
    const pct = n => Math.round((n / total) * 100);
    splitEl.innerHTML =
      `<span style="color:var(--brand);font-weight:700;">${weekData.mech} kcal</span> ${t('sys.mech.legend') || 'Mechanical'} (${pct(weekData.mech)}%) | ` +
      `<span style="color:#22C55E;font-weight:700;">${weekData.aero} kcal</span> ${t('sys.aero.legend') || 'Aerobic'} (${pct(weekData.aero)}%)` +
      (weekData.overhead > 0 ? ` | <span style="color:#3B82F6;font-weight:700;">${weekData.overhead} kcal</span> ${t('sys.aero.overhead') || 'Overhead'} (${pct(weekData.overhead)}%)` : '');
  } else {
    splitEl.innerHTML = '';
  }

  const takeawayEl = document.getElementById('kcal-insight-takeaway');
  if (weekData.takeaway) {
    takeawayEl.style.display = '';
    takeawayEl.textContent = weekData.takeaway.text;
    const takeawayColors = { overhead: '#3B82F6', mech: '#FF6B35', aero: '#22C55E', balanced: 'var(--label)' };
    takeawayEl.style.color = takeawayColors[weekData.takeaway.key] || 'var(--label)';
  } else {
    takeawayEl.style.display = 'none';
  }
}

// Finds whichever pattern has the highest 6-week share — the default
// shown before anything is tapped, matching the donut center's own
// default-to-dominant behavior.
function _movbiasDominantKey(cfg) {
  return cfg.chartedPatternKeys.reduce((best, k) =>
    (cfg.patternPct6ByKey[k] > (cfg.patternPct6ByKey[best] || 0)) ? k : best, cfg.chartedPatternKeys[0]);
}

// Builds the vertical legend table fresh — [Color Pill] [Name] [Share%]
// [Session Count] per row, tappable to focus that pattern (same
// _movbiasSetFocus path a direct slice tap uses). Highlights whichever
// row is currently focused, so the table and the donut center can never
// visually disagree about which pattern is selected.
function _renderMovbiasLegendTable(cfg) {
  const container = document.getElementById('movbias-legend-table');
  if (!container) return;
  container.style.display = '';
  const focusedKey = window._movbiasFocusedKey;
  const sorted = [...cfg.chartedPatternKeys].sort((a,b) => cfg.patternPct6ByKey[b] - cfg.patternPct6ByKey[a]);
  container.innerHTML = sorted.map(k => {
    const meta = cfg.patternMetaSnapshot[k];
    const isFocused = k === focusedKey;
    return `<div onclick="window._movbiasSetFocus('${k}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;background:${isFocused ? meta.color + '22' : 'transparent'};border:1px solid ${isFocused ? meta.color + '55' : 'transparent'};">
      <div style="width:12px;height:12px;border-radius:50%;background:${meta.color};flex-shrink:0;"></div>
      <div style="flex:1;font-size:.76rem;font-weight:${isFocused ? '700' : '500'};color:var(--text);">${cfg.PATTERN_ICONS[k] || ''} ${meta.label}</div>
      <div style="font-size:.76rem;font-weight:700;color:var(--text);">${cfg.patternPct6ByKey[k]}%</div>
      <div style="font-size:.68rem;color:var(--label);min-width:60px;text-align:right;">${cfg.patternSessionCounts[k] || 0} ${(cfg.patternSessionCounts[k] || 0) === 1 ? 'session' : 'sessions'}</div>
    </div>`;
  }).join('');
}

// Updates the persistent pattern inspector card for a given pattern key.
// The Balance Alert only ever shows for Push or Pull specifically — no
// other pattern has a natural complementary pair to compare against.
function _updateMovbiasInsightCard(cfg, patKey) {
  const card = document.getElementById('movbias-insight-card');
  if (!card || !patKey) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';
  const meta = cfg.patternMetaSnapshot[patKey];
  document.getElementById('movbias-insight-title').textContent = `${cfg.PATTERN_ICONS[patKey] || ''} ${meta.label} — ${cfg.patternPct6ByKey[patKey]}%`;
  document.getElementById('movbias-insight-biomech').textContent = cfg.PATTERN_BIOMECH_FOCUS[patKey] || '';
  document.getElementById('movbias-insight-energy').textContent =
    `${cfg.patternAvgKcalByKey[patKey] || 0} kcal/wk ${t('movbias.insight.avg') || 'average'}`;
  const topEx = cfg.patternTopExercises[patKey] || [];
  document.getElementById('movbias-insight-exercises').textContent = topEx.length
    ? `${t('movbias.insight.top') || 'Top exercises'}: ${topEx.join(', ')}` : '';

  const balanceEl = document.getElementById('movbias-insight-balance');
  if ((patKey === 'pattern.push' || patKey === 'pattern.pull') && cfg.pushPullBalanceAlert) {
    balanceEl.style.display = '';
    balanceEl.textContent = cfg.pushPullBalanceAlert;
    balanceEl.style.color = 'var(--brand)';
  } else {
    balanceEl.style.display = 'none';
  }
}



// Updates the persistent insight card for a given week's data. Shared
// by the bar-click handler and the default-view display (most recent
// week, shown automatically) — one update path, not two that could
// show inconsistent formatting.
function _updatePeakLoadInsightCard(weekData) {
  const card = document.getElementById('peakload-insight-card');
  if (!card || !weekData) { if (card) card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('peakload-insight-week').textContent = `${t('peak.insight.week') || 'Week of'} ${weekData.weekLabel}`;
  const rlEl = document.getElementById('peakload-insight-rl');
  const zoneEl = document.getElementById('peakload-insight-zone');
  if (weekData.truePeakRL > 0) {
    rlEl.textContent = weekData.truePeakRL + '%';
    const zone = _getRLZoneLabel(weekData.truePeakRL);
    rlEl.style.color = zone.color;
    zoneEl.textContent = zone.text;
  } else {
    rlEl.textContent = '—';
    rlEl.style.color = 'var(--text)';
    zoneEl.textContent = '';
  }
  document.getElementById('peakload-insight-tonnage').textContent =
    weekData.heavyTonnage > 0 ? weekData.heavyTonnage + ' kg' : '—';
  const movementEl = document.getElementById('peakload-insight-movement');
  if (movementEl) {
    movementEl.textContent = weekData.peakMovement
      ? `${t('peak.insight.peakmovement') || 'Peak Movement'}: ${weekData.peakMovement} @ ${weekData.peakWeight}kg`
      : '';
  }
}

// Called by the chart's onClick handler (see buildPeakLoadChartConfig)
// when any bar/point is tapped.
window._onPeakLoadBarClick = function(index, weeklyInsightData) {
  if (!weeklyInsightData || !weeklyInsightData[index]) return;
  _updatePeakLoadInsightCard(weeklyInsightData[index]);
};

function _renderE1RMChart(movementName) {
  if (typeof window.buildE1RMChartConfig !== 'function' || !movementName) return;
  const cfg = window.buildE1RMChartConfig(movementName);
  cfg.options.maintainAspectRatio = false;
  cfg.options.responsive = true;

  if (_fsChartInstance) { try { _fsChartInstance.destroy(); } catch(e) {} _fsChartInstance = null; }
  const canvas = document.getElementById('chart-fs-canvas');
  const wrap = document.getElementById('chart-fs-canvas-wrap');
  if (!canvas || !wrap) return;

  if (cfg._pointCount === 0) {
    // No qualifying sets at all for this movement (every set was either
    // never logged or fell outside the rep cutoff) — same "don't render
    // an empty chart as if it were real data" discipline as the Weekly
    // Peak Load chart's own no-sessions message.
    wrap.innerHTML = `<div style="text-align:center;font-size:.78rem;color:var(--label);padding:40px 0;">${t('e1rm.no.data') || 'No qualifying sets found for this movement yet.'}</div>`;
    return;
  }
  wrap.innerHTML = '<canvas id="chart-fs-canvas"></canvas>';
  _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
}

function _onE1RMMovementChange() {
  const sel = document.getElementById('e1rm-movement-select');
  if (sel) sel.dataset.lastValue = sel.value; // so switching tabs away and back remembers this choice
  _renderE1RMChart(sel?.value || null);
}

// Switches between the two Weekly Peak Load fullscreen modes. Not a
// separate chart card — same underlying data source, two different
// ways of looking at it (exposure this week vs. genuine progress over
// time), per the original scoping discussion.
function _switchPeakLoadTab(tab) {
  window._currentPeakLoadTab = tab;
  const rlTabBtn = document.getElementById('peakload-tab-rl');
  const e1rmTabBtn = document.getElementById('peakload-tab-e1rm');
  const peakFilterWrap = document.getElementById('chart-fs-peakload-filter');
  const e1rmFilterWrap = document.getElementById('chart-fs-e1rm-filter');

  if (tab === 'rl') {
    if (rlTabBtn) { rlTabBtn.style.background = 'var(--brand)'; rlTabBtn.style.color = '#fff'; }
    if (e1rmTabBtn) { e1rmTabBtn.style.background = 'var(--card-bg)'; e1rmTabBtn.style.color = 'var(--text)'; }
    if (peakFilterWrap) peakFilterWrap.style.display = '';
    if (e1rmFilterWrap) e1rmFilterWrap.style.display = 'none';

    const wrap = document.getElementById('chart-fs-canvas-wrap');
    if (wrap) wrap.innerHTML = '<canvas id="chart-fs-canvas"></canvas>';
    if (_fsChartInstance) { try { _fsChartInstance.destroy(); } catch(e) {} _fsChartInstance = null; }
    if (_fsChartData?.peakload) {
      const canvas = document.getElementById('chart-fs-canvas');
      if (canvas) _fsChartInstance = new Chart(canvas, _fsChartData.peakload);
      // Default view — most recent week, shown automatically, before
      // any bar is tapped. Falls back to hiding the card entirely if
      // there's no week data at all (empty history for this filter).
      const insightData = _fsChartData.peakload.weeklyInsightData;
      _updatePeakLoadInsightCard(insightData && insightData.length ? insightData[insightData.length - 1] : null);
    }
  } else {
    const insightCard = document.getElementById('peakload-insight-card');
    if (insightCard) insightCard.style.display = 'none';
    if (e1rmTabBtn) { e1rmTabBtn.style.background = 'var(--brand)'; e1rmTabBtn.style.color = '#fff'; }
    if (rlTabBtn) { rlTabBtn.style.background = 'var(--card-bg)'; rlTabBtn.style.color = 'var(--text)'; }
    if (peakFilterWrap) peakFilterWrap.style.display = 'none';
    if (e1rmFilterWrap) e1rmFilterWrap.style.display = '';

    const sel = document.getElementById('e1rm-movement-select');
    if (sel && typeof window.getTrainedE1RMMovements === 'function') {
      const movements = window.getTrainedE1RMMovements();
      if (!movements.length) {
        sel.innerHTML = `<option value="">${t('e1rm.no.movements') || 'No trackable lifts logged yet'}</option>`;
        _renderE1RMChart(null);
        return;
      }
      sel.innerHTML = movements.map(m => `<option value="${m}">${m}</option>`).join('');
      // Keep whatever was previously selected if it's still valid,
      // otherwise default to the first available movement — avoids
      // silently resetting to a different lift every time you switch
      // tabs back and forth.
      if (sel.dataset.lastValue && movements.includes(sel.dataset.lastValue)) {
        sel.value = sel.dataset.lastValue;
      }
      sel.dataset.lastValue = sel.value;
    }
    _renderE1RMChart(sel?.value);
  }
}

// Hides every chart-specific persistent card/control unconditionally —
// called at the start of ANY code path that opens the fullscreen modal,
// not just openChartFullscreen(). Each chart's own rendering only needs
// to SHOW its own elements, never hide every other chart's, which is
// what actually prevents one chart's leftover UI from leaking into
// another's view regardless of which function opened the modal.
function _hideAllChartSpecificUI() {
  const ids = [
    'scatter-insight-card', 'peakload-insight-card', 'totalwork-insight-card',
    'chart-fs-totalwork-trend', 'kcal-insight-card', 'chart-fs-kcal-avg',
    'movbias-legend-table', 'movbias-insight-card', 'chart-fs-banister-resetzoom-wrap'
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  // Undo any touch-action override _wireBanisterTouchAndWheel left behind —
  // #chart-fs-canvas is shared across every chart this generic opener
  // renders, so a banister-only override left in place would silently
  // block normal touch/scroll behavior on whatever chart opens next.
  const _fsCanvas = document.getElementById('chart-fs-canvas');
  if (_fsCanvas) _fsCanvas.style.touchAction = '';
}

// Custom wheel/touch pan+zoom for the Banister (Aerobic Fitness 6-week
// trend) chart — same technique already proven on the Session Coverage
// Workbench's scatter chart: chartjs-plugin-zoom's own wheel.enabled
// can't distinguish a trackpad swipe from a pinch (both arrive as plain
// wheel events), and its touch support was never independently
// verified, so both are replaced with manual handlers here too.
//
// #chart-fs-canvas is shared across every chart type this generic
// opener renders (banister, peakload, profile, etc.), and the DOM
// element itself is reused rather than recreated each time — so these
// listeners are wired ONCE per canvas lifetime (guarded by
// canvas._banisterWired) but check window._fsCurrentChartKey at the
// moment each event actually fires, not just at wire-time. Without
// that check, panning the Banister chart once would leave live
// listeners quietly intercepting gestures on every other chart opened
// afterward through the same canvas.
function _wireBanisterTouchAndWheel(canvas) {
  if (!canvas) return;
  canvas.style.touchAction = 'none';
  if (canvas._banisterWired) return;
  canvas._banisterWired = true;

  const isActive = () => window._fsCurrentChartKey === 'banister' && _fsChartInstance;

  canvas.addEventListener('wheel', (e) => {
    if (!isActive()) return;
    const chart = _fsChartInstance;
    if (!chart.scales?.x) return;
    e.preventDefault();
    const xScale = chart.scales.x;
    const xRange = xScale.max - xScale.min;
    const xPixels = chart.chartArea.width || 1;
    if (e.ctrlKey) {
      // Pinch-to-zoom on a trackpad — browsers report this as wheel+ctrlKey.
      const zoomFactor = e.deltaY < 0 ? 0.92 : 1.08;
      const mid = (xScale.min + xScale.max) / 2;
      const halfRange = xRange / 2 * zoomFactor;
      chart.options.scales.x.min = mid - halfRange;
      chart.options.scales.x.max = mid + halfRange;
    } else {
      // Two-finger trackpad swipe — pan along time only. This chart's
      // whole point is panning back through history, and CTL/ATL (left
      // y-axis) and TSB (a SEPARATE, hardcoded 0-3 right y-axis) can't
      // both be panned/zoomed consistently on the same Y gesture anyway
      // — that mismatch was exactly why the green TSB line looked
      // "stuck" while the others stretched. X-only sidesteps that
      // entirely rather than trying to keep two different Y scales in
      // sync.
      const xShift = ((e.deltaX || e.deltaY) / xPixels) * xRange;
      chart.options.scales.x.min = xScale.min + xShift;
      chart.options.scales.x.max = xScale.max + xShift;
    }
    chart.update('none');
  }, { passive: false });

  let touchState = null;
  const dist = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

  canvas.addEventListener('touchstart', (e) => {
    if (!isActive()) { touchState = null; return; }
    const chart = _fsChartInstance;
    if (!chart.scales?.x) return;
    if (e.touches.length === 2) {
      touchState = { mode: 'pinch', startDist: dist(e.touches[0], e.touches[1]), xMin0: chart.scales.x.min, xMax0: chart.scales.x.max };
    } else if (e.touches.length === 1) {
      touchState = { mode: 'pending', startX: e.touches[0].clientX, xMin0: chart.scales.x.min, xMax0: chart.scales.x.max };
    } else {
      touchState = null;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!isActive() || !touchState) return;
    const chart = _fsChartInstance;
    const xRange0 = touchState.xMax0 - touchState.xMin0;
    const xPixels = chart.chartArea.width || 1;
    if (touchState.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const newDist = dist(e.touches[0], e.touches[1]) || 1;
      const scale = touchState.startDist / newDist;
      const midVal = (touchState.xMin0 + touchState.xMax0) / 2;
      const halfRange = xRange0 / 2 * scale;
      chart.options.scales.x.min = midVal - halfRange;
      chart.options.scales.x.max = midVal + halfRange;
      chart.update('none');
    } else if ((touchState.mode === 'pending' || touchState.mode === 'pan') && e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchState.startX;
      if (touchState.mode === 'pending') {
        if (Math.abs(dx) < 8) return; // still just a tap so far
        touchState.mode = 'pan';
      }
      e.preventDefault();
      const xShift = -(dx / xPixels) * xRange0;
      chart.options.scales.x.min = touchState.xMin0 + xShift;
      chart.options.scales.x.max = touchState.xMax0 + xShift;
      chart.update('none');
    }
  }, { passive: false });

  const endTouch = () => { touchState = null; };
  canvas.addEventListener('touchend', endTouch, { passive: true });
  canvas.addEventListener('touchcancel', endTouch, { passive: true });
}

// Deliberately does NOT call chart.resetZoom() (chartjs-plugin-zoom's
// own method) — that method resets whatever the PLUGIN's own gesture
// handlers tracked as "zoomed," but every pan/zoom here happens through
// direct chart.options.scales.x mutation instead (see
// _wireBanisterTouchAndWheel above), completely bypassing the plugin's
// pan()/zoom() API. The plugin never sees those changes as a zoom to
// undo, which is exactly why Reset Zoom did nothing. Resetting to the
// exact min/max this chart was actually created with — stashed on the
// chart instance itself right after construction — sidesteps the
// plugin's tracking entirely and just always works.
function _banisterResetZoom() {
  const chart = _fsChartInstance;
  if (!chart || !chart._banisterInitialRange) return;
  chart.options.scales.x.min = chart._banisterInitialRange.min;
  chart.options.scales.x.max = chart._banisterInitialRange.max;
  chart.update('none');
}

function openChartFullscreen(title, key) {
  const fs = document.getElementById('chart-fullscreen');
  document.getElementById('chart-fs-title').textContent = title;
  fs.classList.add('open');
  // Tracked so the shared #chart-fs-canvas's pan/zoom wheel and touch
  // handlers (wired once, reused across every chart type this opener
  // renders) can check which chart is actually showing right now before
  // acting — see _wireBanisterTouchAndWheel's own comment for why.
  window._fsCurrentChartKey = key;

  if (_fsChartInstance) { try { _fsChartInstance.destroy(); } catch(e) {} _fsChartInstance = null; }

  // Extracted into a shared function (see its own definition) so both
  // this function AND openFbDurationFullscreen() — a separate function
  // with its own, different rendering path — can call the exact same
  // hide-all logic. Duplicating this block in two places was exactly
  // how the movbias legend table ended up leaking into the Force Bias
  // vs Duration chart's view: openFbDurationFullscreen() never had
  // access to this hide logic at all, since it lived only here.
  _hideAllChartSpecificUI();

  // Movement Pattern filter — only relevant for the Weekly Peak Load
  // chart (a %1RM-based metric; every other chart has no such concept).
  // Options populated fresh each time the modal opens, using the
  // current language's translated labels via getPatternLabel().
  // 'monostructural' is deliberately excluded — cardio movements have
  // no 1RM at all, so selecting it would always show empty data.
  const peakTabsWrap = document.getElementById('chart-fs-peakload-tabs');
  const peakFilterWrap = document.getElementById('chart-fs-peakload-filter');
  const e1rmFilterWrap = document.getElementById('chart-fs-e1rm-filter');
  if (peakTabsWrap) {
    if (key === 'peakload') {
      peakTabsWrap.style.display = 'flex';
      // Always reset to the RL tab on open, same precedent as the
      // pattern dropdown resetting to "All Patterns" each time — avoids
      // silently landing on e1RM mode from a previous session's choice.
      window._currentPeakLoadTab = 'rl';
      const rlTabBtn = document.getElementById('peakload-tab-rl');
      const e1rmTabBtn = document.getElementById('peakload-tab-e1rm');
      if (rlTabBtn) { rlTabBtn.style.background = 'var(--brand)'; rlTabBtn.style.color = '#fff'; }
      if (e1rmTabBtn) { e1rmTabBtn.style.background = 'var(--card-bg)'; e1rmTabBtn.style.color = 'var(--text)'; }

      peakFilterWrap.style.display = '';
      e1rmFilterWrap.style.display = 'none';
      const sel = document.getElementById('peakload-pattern-select');
      if (sel) {
        // Only patterns with real 1RM coverage — verified by cross-
        // referencing RM_MAP against getMovementPattern(). Pull, Core,
        // Carry, and Handstand have zero movements mapped to any 1RM,
        // and 'pattern.strength' is the classifier's catch-all fallback,
        // not a real pattern — none of the four would ever show data if
        // selected, same reasoning that already excluded Monostructural.
        const patterns = ['pattern.squat', 'pattern.hinge', 'pattern.olympic', 'pattern.push'];
        sel.innerHTML = `<option value="">${t('peak.filter.all') || 'All Patterns'}</option>` +
          patterns.map(p => `<option value="${p}">${getPatternLabel(p)}</option>`).join('');
        sel.value = ''; // reset to "All Patterns" each time the modal opens, not whatever was last selected
      }
      // Rebuild the actual chart data to match — previously only the
      // dropdown reset on open, while _fsChartData.peakload kept
      // whatever was cached from the last filtered interaction (stale
      // if renderAnalytics() hadn't re-run since). The dropdown showing
      // "All Patterns" while the chart still displayed the old filtered
      // data was exactly this: two things that were supposed to reset
      // together, resetting independently instead.
      if (typeof window.buildPeakLoadChartConfig === 'function') {
        _fsChartData = _fsChartData || {};
        _fsChartData.peakload = window.buildPeakLoadChartConfig(null, true);
      }
    } else {
      peakTabsWrap.style.display = 'none';
      peakFilterWrap.style.display = 'none';
      e1rmFilterWrap.style.display = 'none';
      const insightCard = document.getElementById('peakload-insight-card');
      if (insightCard) insightCard.style.display = 'none';
    }
  }

  const wrap = document.getElementById('chart-fs-canvas-wrap');
  wrap.style.display = '';
  wrap.style.height = '300px';
  wrap.style.flexDirection = '';
  wrap.style.alignItems = '';
  wrap.innerHTML = '<canvas id="chart-fs-canvas"></canvas>'
    + '<div id="radar-anim-controls" style="display:none;text-align:center;margin-top:8px;">'
    +   '<button id="radar-anim-play" onclick="playRadarAnimation()" style="background:var(--accent);color:#fff;border:none;border-radius:20px;padding:6px 18px;font-size:.78rem;font-weight:700;cursor:pointer;"></button>'
    +   '<div id="radar-anim-label" style="font-size:.7rem;color:var(--label);margin-top:6px;min-height:1em;"></div>'
    + '</div>';

  // Populate explanation
  const expEl = document.getElementById('chart-fs-explanation');
  if (expEl) {
    expEl.innerHTML = getChartExplanation(key);
    expEl.style.padding = key === 'profile' ? '40px 20px 32px' : '16px 20px 32px';
  }

  // Handle profile radar specially
  if (key === 'structural') {
    const sd = _fsChartData?.structural;
    wrap.style.height = 'auto';
    if (sd) {
      wrap.innerHTML = `
      <div style="padding:16px 20px 8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--label);">${t('rec.structural.label')}</div>
          <div style="font-size:2.5rem;font-weight:900;color:${sd.color};line-height:1;">${sd.charged}%</div>
        </div>
        <div style="position:relative;height:130px;margin-bottom:6px;">
          <canvas id="struct-gauge-fs" role="img" aria-label="Structural battery gauge showing ${sd.charged}% charged"></canvas>
        </div>
        <div style="font-size:.78rem;color:var(--label);margin-bottom:8px;">${sd.recText}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:8px;text-align:center;${sd.status==='ready'?'border-color:#22C55E;border-width:2px;':''}">
            <div style="font-size:.68rem;font-weight:800;color:#22C55E;">${t('struct.state.ready')}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('struct.state.ready.desc')}</div>
          </div>
          <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:8px;text-align:center;${sd.status==='moderate'?'border-color:#F59E0B;border-width:2px;':''}">
            <div style="font-size:.68rem;font-weight:800;color:#F59E0B;">${t('struct.state.moderate')}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('struct.state.moderate.desc')}</div>
          </div>
          <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:8px;text-align:center;${sd.status==='fatigued'?'border-color:#EF4444;border-width:2px;':''}">
            <div style="font-size:.68rem;font-weight:800;color:#EF4444;">${t('struct.state.fatigued')}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('struct.state.fatigued.desc')}</div>
          </div>
          <div style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.15);border-radius:8px;padding:8px;text-align:center;${sd.status==='overreached'?'border-color:#EF4444;border-width:2px;':''}">
            <div style="font-size:.68rem;font-weight:800;color:#EF4444;">${t('struct.state.overreached')}</div>
            <div style="font-size:.62rem;color:var(--label);margin-top:2px;">${t('struct.state.over.desc')}</div>
          </div>
        </div>
        ${sd.recoveryEstimate?.to40 || sd.recoveryEstimate?.to60 ? `
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;">
          ${sd.recoveryEstimate.to40 ? `<div style="font-size:.72rem;color:var(--label);">${sd.recoveryEstimate.to40} → 40% (${t('rec.struct.reduced.load')})</div>` : ''}
          ${sd.recoveryEstimate.to60 ? `<div style="font-size:.72rem;color:var(--label);">${sd.recoveryEstimate.to60} → 60% (${t('rec.struct.ready')})</div>` : ''}
        </div>` : ''}
      </div>`;
    } else {
      wrap.style.display = 'none';
    }
    if (expEl) {
      expEl.innerHTML = getChartExplanation('structural');
      // After explanation renders, inject charts into the explanation panels
      setTimeout(() => _renderStructuralCharts(sd), 80);
    }
    return;
  }

  if (key === 'banister' && _fsChartData?.banister) {
    const bd = _fsChartData.banister;
    // Full history, not the 6-week-truncated array the compact inline
    // card uses — this is what actually lets panning reveal anything:
    // the chart's own dataset needs to contain the earlier days, not
    // just have its viewport nudged toward data that was never loaded.
    // Falls back to the truncated array only if an older cached
    // _fsChartData object (from before this existed) is still in memory.
    const fd = bd.fullChartData || bd.chartData;
    const isDark = document.body.classList.contains('dark');
    const gc2 = isDark?'rgba(255,255,255,.08)':'rgba(0,0,0,.07)';
    const lc = isDark?'#9CA3AF':'#6B7280';
    // Add explanation content
    if (expEl) expEl.innerHTML = getChartExplanation('banister');
    wrap.style.height = '280px';
    const resetZoomWrap = document.getElementById('chart-fs-banister-resetzoom-wrap');
    if (resetZoomWrap) resetZoomWrap.style.display = 'block';
    setTimeout(() => {
      const canvas = document.getElementById('chart-fs-canvas');
      // Opens showing the same last-42-day window as before (via the
      // x-axis's initial min/max, set as an index range on this
      // category scale) — the difference is the full history now
      // actually exists in the dataset behind it, so panning left or
      // zooming out reveals real data instead of empty space. Reset
      // Zoom restores exactly this same starting window, since
      // chartjs-plugin-zoom's resetZoom() returns to whatever scale
      // config the chart was created with.
      const initialMin = Math.max(0, fd.length - 42);
      const initialMax = fd.length - 1;
      _fsChartInstance = new Chart(canvas, {
        type:'line', data:{labels:fd.map(d=>{const dt=new Date(d.date);return (dt.getMonth()+1)+'/'+dt.getDate();}),
          datasets:[
            {label:'CTL', data:fd.map(d=>d.ctl), borderColor:'#3B82F6', backgroundColor:(ctx)=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,ctx.chart.height);g.addColorStop(0,'#3B82F655');g.addColorStop(1,'#3B82F600');return g;}, fill:true, borderWidth:3, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y'},
            {label:'ATL', data:fd.map(d=>d.atl), borderColor:'#F59E0B', backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y'},
            {label:'TSB', data:fd.map(d=>d.tsb), borderColor:'#22C55E', backgroundColor:'transparent', borderWidth:2, pointRadius:0, tension:0.4, spanGaps:true, yAxisID:'y2'}
          ]},
        options:{responsive:true, maintainAspectRatio:false, animation:{duration:400}, plugins:{
          legend:{display:false},
          // Same approach as the Session Coverage Workbench's scatter
          // chart: chartjs-plugin-zoom's own wheel.enabled treats every
          // wheel event as zoom (can't tell a trackpad swipe from a
          // pinch), and its touch support was never independently
          // verified — so wheel.enabled stays off here too, and
          // _wireBanisterTouchAndWheel (called below, after this chart
          // exists) replaces both with the same custom handlers already
          // proven working for the Workbench.
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: { pinch: { enabled: true }, wheel: { enabled: false }, mode: 'x' }
          }
        },
          scales:{
            x:{min:initialMin, max:initialMax, grid:{color:gc2,drawBorder:false},border:{display:false},ticks:{color:lc,font:{size:9},maxTicksLimit:7}},
            y:{grid:{color:gc2,drawBorder:false},border:{display:false},ticks:{color:lc,font:{size:9}},position:'left',title:{display:true,text:t('tl.fitness')+'/'+t('tl.fatigue'),color:lc,font:{size:8}}},
            y2:{grid:{display:false},border:{display:false},ticks:{color:'#22C55E99',font:{size:9}},position:'right',min:0,max:3,title:{display:true,text:t('tl.form'),color:'#22C55E99',font:{size:8}}}
          }}
      });
      // Stashed for _banisterResetZoom() — see that function's own
      // comment for why it reads this instead of calling the plugin's
      // resetZoom().
      _fsChartInstance._banisterInitialRange = { min: initialMin, max: initialMax };
      _wireBanisterTouchAndWheel(canvas);
    }, 50);
    return;
  }

  if (key === 'profile' && _fsChartData?.profileAvg) {
    const canvas = document.getElementById('chart-fs-canvas');
    const controls = document.getElementById('radar-anim-controls');
    wrap.style.height = '380px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'flex-start';
    setTimeout(() => {
      const size = Math.min((wrap.offsetWidth || 340) - 20, 280);
      canvas.style.width = size + 'px';
      canvas.style.height = (size + 30) + 'px';
      render6WeekRadar(canvas, _fsChartData.profileAvg);
      // Show the 12-week trend animation control if there's enough history
      const windows = getRollingRadarWindows(getHistory());
      // Force the last window's avg to be the EXACT same object the
      // static radar above just rendered — not a fresh approximation
      // computed independently inside getRollingRadarWindows (which
      // uses its own date-boundary math and could disagree with
      // profileAvg by a fraction of a percent at the edges). This is
      // what actually eliminates the jump: the animation's true final
      // frame becomes the identical values shown the instant playback
      // ends, not merely a close approximation of them.
      if (windows.length) windows[windows.length - 1].avg = _fsChartData.profileAvg;
      if (controls) {
        if (windows.length > 1) {
          controls.style.display = 'block';
          const btn = document.getElementById('radar-anim-play');
          if (btn) btn.textContent = t('chart.radar.play');
          const label = document.getElementById('radar-anim-label');
          if (label) label.textContent = '';
          _radarAnimWindows = windows;
        } else {
          controls.style.display = 'none';
        }
      }
    }, 50);
    return;
  }

  // scatter — add quadrant background plugin in fullscreen only
  if (key === 'scatter' && _fsChartData?.scatter) {
    const cfg = JSON.parse(JSON.stringify(_fsChartData.scatter));
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    cfg.options.plugins.tooltip = _fsChartData.scatter.options.plugins.tooltip;    // Calculate midpoints from data
    const pts = _fsChartData.scatter.data.datasets[0].data;
    const isDark = document.body.classList.contains('dark');
    window._scatterSelectedPoint = null;
    // Re-attached after the JSON clone above for the same reason
    // tooltip/onClick are re-attached below — functions don't survive
    // JSON.stringify. Both datasets keep their original coloring logic
    // (history: filled/outline by allReal; latest: solid orange) and
    // add one more case on top: the tapped point renders white, the
    // same selected-state treatment the Power Scatter and FB/Duration
    // charts already use.
    cfg.data.datasets[0].backgroundColor = ctx => {
      if (ctx.raw && ctx.raw === window._scatterSelectedPoint) return '#FFFFFF';
      return ctx.raw?.allReal
        ? (isDark ? 'rgba(96,165,250,0.75)' : 'rgba(59,130,246,0.7)')
        : 'transparent';
    };
    cfg.data.datasets[1].backgroundColor = ctx => {
      if (ctx.raw && ctx.raw === window._scatterSelectedPoint) return '#FFFFFF';
      return '#FF6B35';
    };
    const avgX = pts.length ? pts.reduce((a,b) => a + b.x, 0) / pts.length : 0;
    const avgY = pts.length ? pts.reduce((a,b) => a + b.y, 0) / pts.length : 0;
    // Quadrant training-split percentages — combines BOTH datasets
    // (history + latest), since they're mutually exclusive complementary
    // sets (scatterHistorySrc explicitly excludes the latest date,
    // scatterLatestSrc is only that date) — using just one would either
    // miss the most recent session or double-count nothing, but using
    // history alone would still leave the split slightly incomplete.
    // Reuses _classifyScatterQuadrant so a session's badge classification
    // can never disagree with which quadrant it visually renders in.
    const allScatterPts = [...(pts || []), ...((_fsChartData.scatter.data.datasets[1]?.data) || [])];
    const quadrantCounts = { metcon: 0, heavyMetcon: 0, strength: 0, recovery: 0 };
    allScatterPts.forEach(p => {
      const q = _classifyScatterQuadrant(p.x, p.y, avgX, avgY);
      quadrantCounts[q.key]++;
    });
    const totalPts = allScatterPts.length;
    const pct = n => totalPts > 0 ? Math.round((n / totalPts) * 100) : null;
    const quadrantPlugin = {
      id: 'quadrants',
      beforeDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
        if (!x || !y) return;
        const mx = x.getPixelForValue(avgX);
        const my = y.getPixelForValue(avgY);
        ctx.save();
        // Bottom-left: Aerobic Base — slate/light grey
        ctx.fillStyle = 'rgba(148,163,184,0.10)';
        ctx.fillRect(left, my, mx - left, bottom - my);
        // Bottom-right: Strength Work — teal/cyan
        ctx.fillStyle = 'rgba(20,184,166,0.10)';
        ctx.fillRect(mx, my, right - mx, bottom - my);
        // Top-left: Metcon — amber/yellow
        ctx.fillStyle = 'rgba(245,158,11,0.10)';
        ctx.fillRect(left, top, mx - left, my - top);
        // Top-right: Heavy Metcon — orange/brand
        ctx.fillStyle = 'rgba(255,107,53,0.12)';
        ctx.fillRect(mx, top, right - mx, my - top);
        // Quadrant labels, each with a percentage badge directly below —
        // omitted (not shown as 0%) when totalPts is 0, same "don't
        // fabricate a number from no data" discipline as everywhere else.
        ctx.font = '700 11px sans-serif';
        ctx.textBaseline = 'middle';
        const pad = 10;
        const pctFont = '600 9px sans-serif';
        const metconPct = pct(quadrantCounts.metcon);
        ctx.fillStyle = 'rgba(245,158,11,0.7)';
        ctx.textAlign = 'left';
        ctx.fillText(t('scatter.metcon'), left + pad, top + 16);
        if (metconPct != null) { ctx.font = pctFont; ctx.fillText(metconPct + '%', left + pad, top + 30); ctx.font = '700 11px sans-serif'; }

        const heavyPct = pct(quadrantCounts.heavyMetcon);
        ctx.fillStyle = 'rgba(255,107,53,0.8)';
        ctx.textAlign = 'right';
        ctx.fillText(t('scatter.heavy.metcon'), right - pad, top + 16);
        if (heavyPct != null) { ctx.font = pctFont; ctx.fillText(heavyPct + '%', right - pad, top + 30); ctx.font = '700 11px sans-serif'; }

        const recoveryPct = pct(quadrantCounts.recovery);
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.textAlign = 'left';
        ctx.fillText(t('scatter.aerobic.base'), left + pad, bottom - 10);
        if (recoveryPct != null) { ctx.font = pctFont; ctx.fillText(recoveryPct + '%', left + pad, bottom - 24); ctx.font = '700 11px sans-serif'; }

        const strengthPct = pct(quadrantCounts.strength);
        ctx.fillStyle = 'rgba(20,184,166,0.7)';
        ctx.textAlign = 'right';
        ctx.fillText(t('scatter.strength.work'), right - pad, bottom - 10);
        if (strengthPct != null) { ctx.font = pctFont; ctx.fillText(strengthPct + '%', right - pad, bottom - 24); ctx.font = '700 11px sans-serif'; }
        // Crosshair lines
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(mx, top); ctx.lineTo(mx, bottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(left, my); ctx.lineTo(right, my); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    };
    // Orange ring around the selected point — same crisp, fixed-stroke
    // treatment (not a blurred glow, which can bleed onto neighboring
    // points in dense clusters) already used on the Power Scatter and
    // FB/Duration charts. Ring radius scales with each point's own
    // bubble size (this is a 'bubble' chart, unlike those two — points
    // aren't a uniform size here, since dot size itself encodes
    // Mechanical Work), so the ring stays proportionate rather than a
    // fixed pixel radius that would look wrong on a large vs small dot.
    const selectedGlowPlugin = {
      id: 'scatterSelectedGlow',
      beforeDatasetsDraw(chart) {
        const sel = window._scatterSelectedPoint;
        if (!sel) return;
        for (let dsIdx = 0; dsIdx < chart.data.datasets.length; dsIdx++) {
          const meta = chart.getDatasetMeta(dsIdx);
          if (!meta || !meta.data) continue;
          const idx = chart.data.datasets[dsIdx].data.indexOf(sel);
          if (idx < 0 || !meta.data[idx]) continue;
          const el = meta.data[idx];
          const ctx = chart.ctx;
          ctx.save();
          ctx.beginPath();
          ctx.arc(el.x, el.y, (sel.r || 7) + 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,107,53,0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          return; // a point exists in exactly one dataset — done once found
        }
      }
    };
    cfg.plugins = [quadrantPlugin, selectedGlowPlugin];
    // Click handler — added here, not in the base scatterCfg, since
    // onClick is a function and wouldn't survive the JSON.parse(
    // JSON.stringify()) clone above anyway (same reason the tooltip
    // callback needs re-attaching on the line above too).
    cfg.options.onClick = (evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      const point = cfg.data.datasets[el.datasetIndex].data[el.index];
      window._scatterSelectedPoint = point;
      _updateScatterInsightCard(point, avgX, avgY);
      _fsChartInstance.update();
    };
    wrap.style.height = '300px';
    setTimeout(() => {
      _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
      // Default view — your most recent session, shown automatically,
      // same precedent as the Weekly Peak Load card defaulting to the
      // most recent week. Falls back to the last historical point if
      // there's no 'latest' dataset entry (e.g. very sparse history).
      const latestPts = cfg.data.datasets[1]?.data;
      const historyPts = cfg.data.datasets[0]?.data;
      const defaultPoint = (latestPts && latestPts.length) ? latestPts[latestPts.length - 1]
        : (historyPts && historyPts.length) ? historyPts[historyPts.length - 1] : null;
      // Highlighted immediately, matching the insight card that already
      // auto-populates for this same default point — previously the
      // card showed a session but nothing on the chart indicated which
      // dot it was.
      window._scatterSelectedPoint = defaultPoint;
      _updateScatterInsightCard(defaultPoint, avgX, avgY);
      _fsChartInstance.update();
    }, 50);
    return;
  }

  // peakload uses canvas plugins that don't survive JSON clone — re-render directly
  if (key === 'peakload' && _fsChartData?.peakload) {
    const cfg = _fsChartData.peakload;
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    wrap.style.height = '300px';
    setTimeout(() => {
      _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
      const insightData = cfg.weeklyInsightData;
      _updatePeakLoadInsightCard(insightData && insightData.length ? insightData[insightData.length - 1] : null);
    }, 50);
    return;
  }

  // density, movbias, totalwork and kcal use plugins that don't survive JSON.parse — use original config directly
  if (key === 'density' && _fsChartData?.density) {
    const cfg = _fsChartData.density;
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    wrap.style.height = '300px';
    setTimeout(() => { _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg); }, 50);
    return;
  }

  // movbias — dedicated block. Builds the vertical legend table fresh
  // each open (pattern set varies per user), wires both slice taps and
  // legend-row taps to the same _movbiasSetFocus function so there's one
  // "select this pattern" path, not two that could drift.
  if (key === 'movbias' && _fsChartData?.movbias) {
    const cfg = _fsChartData.movbias;
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    window._movbiasFocusedKey = null;

    window._movbiasSetFocus = (patKey) => {
      window._movbiasFocusedKey = (window._movbiasFocusedKey === patKey) ? null : patKey;
      if (_fsChartInstance) _fsChartInstance.update();
      _renderMovbiasLegendTable(cfg);
      const shownKey = window._movbiasFocusedKey || _movbiasDominantKey(cfg);
      _updateMovbiasInsightCard(cfg, shownKey);
    };

    cfg.options.onClick = (evt, elements) => {
      if (!elements.length) return;
      const idx = elements[0].index;
      const patKey = cfg.chartedPatternKeys[idx];
      if (patKey) window._movbiasSetFocus(patKey);
    };

    wrap.style.height = '300px';
    setTimeout(() => {
      _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
      _renderMovbiasLegendTable(cfg);
      _updateMovbiasInsightCard(cfg, _movbiasDominantKey(cfg));
    }, 50);
    return;
  }

  // kcal — dedicated block, split out of the shared one above, since it
  // needs its own header subtitle, persistent card wiring, and the
  // dim-not-hide segment focus interaction (tapping a bar's Mechanical
  // segment, or the Mechanical legend item, dims Aerobic/Overhead across
  // ALL weeks while keeping Mechanical fully visible — tap again, or
  // tap a bar-only area, to clear focus).
  if (key === 'kcal' && _fsChartData?.kcal) {
    const cfg = _fsChartData.kcal;
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;

    const trendEl = document.getElementById('chart-fs-kcal-avg');
    if (trendEl) {
      trendEl.style.display = '';
      trendEl.textContent = `6-Wk Avg: ${cfg.avgMcWeekly} kcal/wk`;
    }

    window._kcalFocusedDataset = null;
    // Base colors in the same order as the datasets themselves — used
    // to reconstruct the correct alpha-adjusted color for each,
    // whether focused (full alpha), dimmed (low alpha), or the default
    // all-visible state (also full alpha, focusedIndex === null).
    const kcalBaseColors = cfg.data.datasets.map(ds => ds.borderColor);
    function applyKcalFocus(chart, focusedIndex) {
      chart.data.datasets.forEach((ds, i) => {
        const base = kcalBaseColors[i];
        const alpha = (focusedIndex === null || i === focusedIndex) ? cfg.kcalFullAlpha : cfg.kcalDimAlpha;
        ds.backgroundColor = base + alpha;
      });
      chart.update();
    }

    cfg.options.plugins.legend.onClick = (evt, legendItem, legend) => {
      const idx = legendItem.datasetIndex;
      window._kcalFocusedDataset = (window._kcalFocusedDataset === idx) ? null : idx;
      applyKcalFocus(legend.chart, window._kcalFocusedDataset);
    };

    cfg.options.onClick = (evt, elements) => {
      if (!elements.length) return;
      const el = elements[0];
      const insightData = cfg.weeklyInsightData;
      if (insightData && insightData[el.index]) _updateKcalInsightCard(insightData[el.index]);
      // Toggling focus only makes sense with multiple real segments —
      // a legacy-only week (single "Total (no split)" dataset) has
      // nothing to focus between.
      if (cfg.data.datasets.length > 1) {
        const idx = el.datasetIndex;
        window._kcalFocusedDataset = (window._kcalFocusedDataset === idx) ? null : idx;
        applyKcalFocus(_fsChartInstance, window._kcalFocusedDataset);
      }
    };

    wrap.style.height = '300px';
    setTimeout(() => {
      _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
      const insightData = cfg.weeklyInsightData;
      _updateKcalInsightCard(insightData && insightData.length ? insightData[insightData.length - 1] : null);
    }, 50);
    return;
  }

  // totalwork — dedicated block (not the shared one above) since it
  // needs its own onClick handling for the persistent insight card:
  // bar taps use Chart.js's real click detection, dot taps need manual
  // hit-detection since the dots are hand-drawn canvas shapes, not a
  // real dataset Chart.js's own click system can see.
  if (key === 'totalwork' && _fsChartData?.totalwork) {
    const cfg = _fsChartData.totalwork;
    cfg.options.maintainAspectRatio = false;
    cfg.options.responsive = true;
    const trendEl = document.getElementById('chart-fs-totalwork-trend');
    if (trendEl) {
      trendEl.style.display = '';
      const arrow = cfg.trendDirection === 'up' ? '↑' : '↓';
      const arrowColor = cfg.trendDirection === 'up' ? '#22C55E' : '#EF4444';
      trendEl.innerHTML = `6-Wk Avg: ${cfg.avgWeeklyKj} kJ/wk` +
        (cfg.trendPct != null ? ` <span style="color:${arrowColor};font-weight:700;">${arrow} ${Math.abs(cfg.trendPct)}%</span> ${t('totalwork.trend.label') || 'trend'}` : '');
    }
    cfg.options.onClick = (evt, elements) => {
      const insightData = cfg.weeklyInsightData;
      // Dot hit-detection first — dots are drawn ON TOP of the bars, so
      // a tap that lands on a dot should show that specific session,
      // not just the week it belongs to. Only falls through to bar-tap
      // (weekly aggregate) if no dot was actually hit.
      const canvas = document.getElementById('chart-fs-canvas');
      const rect = canvas?.getBoundingClientRect();
      const clickX = evt.native ? evt.native.offsetX : (evt.x ?? null);
      const clickY = evt.native ? evt.native.offsetY : (evt.y ?? null);
      const dots = window._totalworkDotPositions || [];
      const hitDot = clickX != null ? dots.find(d => {
        const dx = clickX - d.px, dy = clickY - d.py;
        return Math.sqrt(dx*dx + dy*dy) <= d.r + 3; // +3px tolerance, easier to actually hit on mobile
      }) : null;
      if (hitDot) {
        // hitDot.pt.x is the week index this session belongs to — no
        // need to recompute it from the date, it's already there.
        const weekData = insightData && insightData[hitDot.pt.x] ? insightData[hitDot.pt.x] : null;
        _updateTotalworkInsightCard(weekData, hitDot.pt);
        window._totalworkSelectedDot = hitDot.pt;
        _fsChartInstance?.update();
        return;
      }
      if (!elements.length) return;
      const weekIdx = elements[0].index;
      // Bar-only tap (no specific dot hit) — clears any dot selection,
      // since the card is now showing a whole week's aggregate, not one
      // session, and a leftover highlighted dot would misleadingly
      // suggest the card is still describing that specific session.
      window._totalworkSelectedDot = null;
      if (insightData && insightData[weekIdx]) _updateTotalworkInsightCard(insightData[weekIdx], null);
      _fsChartInstance?.update();
    };
    wrap.style.height = '300px';
    setTimeout(() => {
      window._totalworkSelectedDot = null;
      _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
      // Default view — most recent week, shown automatically, same
      // precedent as the other two persistent cards built tonight.
      const insightData = cfg.weeklyInsightData;
      _updateTotalworkInsightCard(insightData && insightData.length ? insightData[insightData.length - 1] : null, null);
    }, 50);
    return;
  }

  if (!_fsChartData || !_fsChartData[key]) return;

  // Clone config and override for fullscreen (larger, better labels)
  const cfg = JSON.parse(JSON.stringify(_fsChartData[key]));
  cfg.options.maintainAspectRatio = false;
  cfg.options.responsive = true;
  wrap.style.height = '300px';
  if (cfg.options.scales) {
    const isDark = document.body.classList.contains('dark');
    const lc = isDark ? '#9CA3AF' : '#6B7280';
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    Object.values(cfg.options.scales).forEach(s => {
      if (s.ticks) s.ticks.font = { size: 12 };
      if (s.grid) s.grid.color = gc;
      if (s.ticks) s.ticks.color = lc;
    });
  }
  if (cfg.options.plugins?.tooltip?.callbacks) {
    // Callbacks don’t survive JSON.parse — re-attach from original
    cfg.options.plugins.tooltip = _fsChartData[key].options.plugins.tooltip;
  }
  _fsChartInstance = new Chart(document.getElementById('chart-fs-canvas'), cfg);
}

function closeChartFullscreen() {
  document.getElementById('chart-fullscreen').classList.remove('open');
  if (_fsChartInstance) { try { _fsChartInstance.destroy(); } catch(e) {} _fsChartInstance = null; }
}
function _buildAnalyticsRadarBack(pd, wd, cvIntensity, fb, internalLoad, td) {
  const back = document.getElementById('radar-back-content');
  if (!back) return;
  const sixWeeksAgoStr = new Date(Date.now()-42*24*60*60*1000).toISOString().slice(0,10);
  const recentHist = getHistory().filter(h=>h.date&&h.date.slice(0,10)>=sixWeeksAgoStr&&h.pd);
  const avg = computeRadarAverage(recentHist);
  const avgOf = key => avg[key] > 0 ? avg[key] : null;
  const radarLabels = getRadarAxisLabels();
  const axisUnits = { pd: 'W/kg', cvIntensity: '', wd: 'kJ', internalLoad: '', fb: '', td: '' };
  const valsByKey = { pd: pd||0, wd: wd||0, cvIntensity: cvIntensity||0, fb: fb||0, internalLoad: internalLoad||0, td: td||0 };
  const metrics = RADAR_AXIS_KEYS.map((key, i) => ({
    key, label: radarLabels[i].replace('\n', ' '), unit: axisUnits[key], val: valsByKey[key]
  }));
  const fmt=(v,u)=>u==='%'?v.toFixed(1)+'%':u==='W/kg'?v.toFixed(1)+' W/kg':Math.round(v)+(u?' '+u:'');
  const rows = metrics.map(m=>{
    const avg=avgOf(m.key);
    if(!avg||!m.val) return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--glass-border);"><span style="font-size:.75rem;color:var(--label);">${m.label}</span><span style="font-size:.75rem;color:var(--label);">—</span></div>`;
    const pct=Math.round((m.val-avg)/avg*100);
    const arrow=pct>=5?'↑':pct<=-5?'↓':'→';
    const clr=pct>=5?'#22C55E':pct<=-5?'#EF4444':'var(--label)';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--glass-border);">
      <span style="font-size:.75rem;color:var(--label);flex:1;">${m.label}</span>
      <span style="font-size:.75rem;font-weight:700;color:var(--text);margin:0 8px;">${fmt(m.val,m.unit)}</span>
      <span style="font-size:.75rem;font-weight:800;color:${clr};min-width:40px;text-align:right;">${arrow} ${Math.abs(pct)}%</span>
    </div>`;
  }).join('');
  back.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--label);">${t('hist.modal.signature')} — ${t('flip.hint')}</div>
    </div>
    <div style="font-size:.72rem;color:var(--label);line-height:1.6;margin-bottom:12px;padding:8px 10px;background:var(--glass-inner);border-radius:8px;">
      ${t('flip.explain')}
    </div>
    ${rows}
    <div style="display:flex;gap:14px;margin-top:10px;font-size:.68rem;color:var(--label);">
      <span><span style="color:#22C55E;font-weight:800;">↑</span> &gt;5% ${t('flip.above')}</span>
      <span><span style="color:#EF4444;font-weight:800;">↓</span> &gt;5% ${t('flip.below')}</span>
      <span>→ ${t('flip.within')}</span>
    </div>`;
  // Wire up flip toggle once
  const wrap = document.getElementById('radar-flip-wrap');
  if (wrap && !wrap._flipWired) {
    wrap._flipWired = true;
    let _showing = true;
    wrap.addEventListener('click', () => {
      _showing = !_showing;
      document.getElementById('radar-flip-front').style.display = _showing ? '' : 'none';
      document.getElementById('radar-flip-back').style.display  = _showing ? 'none' : 'block';
    });
  }
}
function renderRadarChart(pd, wd, cvIntensity, fb, internalLoad, td) {
  const card = document.getElementById('radar-card');
  const canvas = document.getElementById('radarChart');
  if (!card || !canvas) return;
  if (!hasEnoughHistory()) {
    card.style.display = '';
    canvas.style.display = 'none';
    return;
  }
  card.style.display = '';
  canvas.style.display = '';

  // Normalise each metric 0–1 against max plausible values
  // Use personal band maxes when available, fall back to fixed
  const maxes = getRadarMaxes();

  // Store normalised values back into _lastSessionRadar so history card matches
  if (window._lastSessionRadar) {
    window._lastSessionRadar = {
      pd: Math.min(1, Math.max(0, (pd||0) / maxes.pd)),
      wd: Math.min(1, Math.max(0, (wd||0) / maxes.wd)),
      cvIntensity: Math.min(1, Math.max(0, (cvIntensity||0) / maxes.cvIntensity)),
      fb: Math.min(1, Math.max(0, (fb||0) / maxes.fb)),
      internalLoad: Math.min(1, Math.max(0, (internalLoad||0) / maxes.internalLoad)),
      td: Math.min(1, Math.max(0, (td||0) / maxes.td)),
      _normalised: true,
      _v: 3 // bumped from 2 — axes changed (mc/rl -> cvIntensity/internalLoad), not just the headroom-removal migration v2 already handles
    };
  }
  const labels = getRadarAxisLabels();
  const raw = [pd, cvIntensity, wd, internalLoad, fb, td]; // must match RADAR_AXIS_KEYS' order exactly
  const maxVals = RADAR_AXIS_KEYS.map(k => maxes[k]);
  const values = raw.map((v,i) => Math.min(1, Math.max(0, (v||0) / maxVals[i])));

  // 6-week average overlay — getHistory() naturally excludes today's own
  // session here, since this live preview runs before any save commits
  // it to history, so no explicit self-exclusion filter is needed.
  // Compares date strings directly (not Date object >=) to match the
  // same timezone-safe approach the standalone 6-week radar uses, so
  // both charts define "last 6 weeks" identically at the boundary.
  const sixWeeksAgoStr = new Date(Date.now() - 42*24*60*60*1000).toISOString().slice(0,10);
  const recentHist = getHistory().filter(h => h.date && h.date.slice(0,10) >= sixWeeksAgoStr && h.pd);
  const avgRaw = computeRadarAverage(recentHist);
  const hasAvgOverlay = recentHist.length > 0;
  const avgValues = RADAR_AXIS_KEYS.map(k => Math.min(1, Math.max(0, (avgRaw[k]||0) / maxes[k])));

  const N = 6;
  // Canvas is wider than the radar to give labels room on left/right.
  // The radar sits centred — labels drawn within canvas bounds, no overflow needed.
  const containerW = canvas.offsetWidth || 280;
  const padding = 50; // extra canvas space for left/right labels
  const size    = Math.min(containerW - padding * 2, 320);
  const canvasW = containerW;
  const canvasH = size + 100;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.marginLeft = 'auto';
  canvas.style.marginRight = 'auto';
  canvas.style.display = 'block';
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  const cx = canvasW / 2;
  const cy = (size + 100) / 2;
  const R      = size * 0.28;
  const labelR = size * 0.44;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
  const isDark = document.body.classList.contains('dark');
  const gridCol = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
  const labelCol = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
  const brandCol = '#FF6B35';

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Helper: angle for axis i (start from top, clockwise)
  const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;
  const pt = (i, r) => ({ x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) });

  // Draw grid rings
  [0.25, 0.5, 0.75, 1].forEach(frac => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = pt(i, R * frac);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Draw axes
  for (let i = 0; i < N; i++) {
    const p = pt(i, R);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw 6-week average overlay FIRST, so today's session polygon draws
  // on top of it and stays the visually dominant shape, not the other
  // way around. Green (#22C55E) — matches the standalone 6-Week
  // Training Profile radar's own color exactly, since both represent
  // the same underlying data (the 6-week average) and should carry one
  // consistent color identity across the app, not two different colors
  // for the same concept.
  if (hasAvgOverlay) {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = pt(i, R * avgValues[i]);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,197,94,.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,197,94,.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4,3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw filled polygon
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const p = pt(i, R * values[i]);
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,107,53,.18)';
  ctx.fill();
  ctx.strokeStyle = brandCol;
  ctx.lineWidth = 2;
  ctx.shadowColor = brandCol;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Draw dots at each vertex
  for (let i = 0; i < N; i++) {
    const p = pt(i, R * values[i]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = brandCol;
    ctx.shadowColor = brandCol;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Draw labels
  ctx.font = `700 ${Math.max(9, size * 0.047)}px -apple-system, sans-serif`;
  ctx.fillStyle = labelCol;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < N; i++) {
    const p = pt(i, labelR);
    const lines = labels[i].split('\n');
    const lineH = size * 0.055;
    // Align labels based on their position around the circle
    const a = angle(i);
    const cosA = Math.cos(a);
    if (cosA > 0.3)       ctx.textAlign = 'left';
    else if (cosA < -0.3) ctx.textAlign = 'right';
    else                  ctx.textAlign = 'center';
    lines.forEach((line, li) => {
      ctx.fillText(line, p.x, p.y + (li - (lines.length-1)/2) * lineH);
    });
  }
  const legendEl = document.getElementById('radar-overlay-legend');
  if (legendEl) {
    if (hasAvgOverlay) {
      legendEl.style.display = 'flex';
      legendEl.innerHTML = `
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${brandCol};margin-right:4px;vertical-align:middle;"></span>${t('radar.legend.today') || 'Today'}</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(34,197,94,.75);margin-right:4px;vertical-align:middle;"></span>${t('radar.legend.sixwk') || '6-Wk Avg'}</span>`;
    } else {
      legendEl.style.display = 'none';
      legendEl.innerHTML = '';
    }
  }
  // Reset flip to front when new results are calculated
  document.getElementById('radar-flip-front').style.display = '';
  document.getElementById('radar-flip-back').style.display = 'none';
  const wrap = document.getElementById('radar-flip-wrap');
  if (wrap) wrap._flipWired = false;
  _buildAnalyticsRadarBack(pd, wd, cvIntensity, fb, internalLoad, td);
}

