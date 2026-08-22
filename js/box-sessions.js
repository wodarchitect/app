
// ═══════════════════════════════════════════════════
// BOX SESSIONS
// ═══════════════════════════════════════════════════

const SCALING_MAP = {
  // ── Gymnastics / Bodyweight ──
  'Kipping Muscle-up':           {scaled:'Kipping Chest-to-bar Pull-up', found:'Kipping Pull-up'},
  'Push-up':                     {scaled:'Push-up',                      found:'Knee Push-up'},
  'Ring Row - Advanced Parallel':{scaled:'Ring Row - Standard 45°',       found:'Ring Row - Beginner 70°'},
  'Ring Row - Standard 45°':     {scaled:'Ring Row - Standard 45°',       found:'Ring Row - Beginner 70°'},
  'Strict Bar Muscle-up':        {scaled:'Strict Pull-up',               found:'Ring Row - Beginner 70°'},
  'Kipping Bar Muscle-up':       {scaled:'Kipping Chest-to-bar Pull-up', found:'Kipping Pull-up'},
  'Freestanding Handstand Push-up':{scaled:'Strict Handstand Push-up',  found:'Pike Push-up'},
  'Strict Handstand Push-up':    {scaled:'Kipping Handstand Push-up',    found:'Pike Push-up'},
  'Kipping Handstand Push-up':   {scaled:'Pike Push-up',                 found:'Dumbbell Push Press'},
  'Handstand Push-up':           {scaled:'Kipping Handstand Push-up',    found:'Pike Push-up'},
  'Chest-to-wall Handstand Push-up':{scaled:'Strict Handstand Push-up', found:'Pike Push-up'},
  'Kipping Deficit Handstand Push-up':{scaled:'Pike Push-up',              found:'Dumbbell Push Press'},
  'Kipping Toes-to-bar':         {scaled:'Strict Knees-to-elbows',       found:'GHD Sit-up'},
  'Strict Toes-to-bar':          {scaled:'Kipping Toes-to-bar',          found:'Strict Knees-to-elbows'},
  'Strict Toes-to-rings':        {scaled:'Kipping Toes-to-bar',          found:'Strict Knees-to-elbows'},
  'L-sit Rope Climb':            {scaled:'Rope Climb (Wrapping)',         found:'Modified Rope Climb'},
  'Legless Rope Climb':          {scaled:'Rope Climb (Wrapping)',         found:'Modified Rope Climb'},
  'Rope Climb (Wrapping)':       {scaled:'Modified Rope Climb',           found:'Ring Row - Beginner 70°'},
  'Handstand Walk':              {scaled:'Wall Walk',                     found:'Wall Walk'},
  'Single-leg Squat (Pistol)':   {scaled:'Air Squat',                    found:'Air Squat'},
  'Box Jump':                    {scaled:'Box Step-up',                   found:'Box Step-up'},
  'Burpee Box Jump-over':        {scaled:'Burpee Box Jump-over',          found:'Burpee'},
  'Double-under':                {scaled:'Single-under',                  found:'Single-under'},
  'Butterfly Pull-up':           {scaled:'Kipping Pull-up',               found:'Ring Row - Beginner 70°'},
  'Kipping Chest-to-bar Pull-up':{scaled:'Kipping Pull-up',              found:'Ring Row - Beginner 70°'},
  'Strict Chest-to-bar Pull-up': {scaled:'Kipping Chest-to-bar Pull-up', found:'Kipping Pull-up'},
  'L Pull-up':                   {scaled:'Kipping Pull-up',               found:'Ring Row - Beginner 70°'},
  'Pull-up':                     {scaled:'Ring Row - Standard 45°',       found:'Ring Row - Beginner 70°'},
  'Kipping Pull-up':             {scaled:'Ring Row - Standard 45°',       found:'Ring Row - Beginner 70°'},
  'Strict Pull-up':              {scaled:'Ring Row - Standard 45°',                      found:'Ring Row - Beginner 70°'},
  'Ring Dip':                    {scaled:'Dip',                           found:'Push-up'},
  // ── Olympic Lifts ──
  'Snatch':                      {scaled:'Power Snatch',                  found:'Dumbbell Power Snatch'},
  'Squat Clean':                 {scaled:'Power Clean',                   found:'Dumbbell Power Clean'},
  'Clean and Jerk':              {scaled:'Power Clean',                   found:'Dumbbell Clean'},
  'Clean and Push Jerk':         {scaled:'Power Clean',                   found:'Dumbbell Clean'},
  'Split Jerk':                  {scaled:'Push Jerk',                     found:'Push Press'},
  'Hang Snatch':                 {scaled:'Hang Power Snatch',             found:'Dumbbell Power Snatch'},
  'Hang Clean':                  {scaled:'Hang Power Clean',              found:'Dumbbell Hang Power Clean'},
  'Power Snatch':                {scaled:'Muscle Snatch',                 found:'Dumbbell Power Snatch'},
  'Power Clean':                 {scaled:'Dumbbell Power Clean',          found:'Medicine Ball Clean'},
  'Push Jerk':                   {scaled:'Push Press',                    found:'Dumbbell Push Jerk'},
  'Overhead Squat':              {scaled:'Front Squat',                   found:'Goblet Squat'},
  // ── Barbell Strength ──
  'Thruster':                    {scaled:'Dumbbell Thruster',             found:'Kettlebell Thruster'},
  'Front Squat':                 {scaled:'Back Squat',                    found:'Goblet Squat'},
  'Sumo Deadlift High Pull':     {scaled:'Kettlebell High Pull',          found:'Dumbbell Power Clean'},
  // ── Kettlebell / Dumbbell ──
  'Kettlebell Turkish Get-up':   {scaled:'Dumbbell Turkish Get-up',       found:'Dumbbell Turkish Get-up'},
  'Kettlebell Clean and Jerk':   {scaled:'Kettlebell Clean',              found:'Kettlebell Swing'},
  'Kettlebell Snatch':           {scaled:'Kettlebell Power Snatch',       found:'Kettlebell Swing'},
  'Kettlebell Swing (American)': {scaled:'Kettlebell Swing (Russian)',    found:'Kettlebell Deadlift'},
  'Dumbbell Power Snatch':       {scaled:'Dumbbell Power Clean',          found:'Dumbbell Deadlift'},
  'Dumbbell Overhead Squat':     {scaled:'Dumbbell Front Squat',          found:'Goblet Squat'},
  'Dumbbell Thruster':           {scaled:'Dumbbell Front Squat',          found:'Goblet Squat'},
  'Dumbbell Squat Snatch':       {scaled:'Dumbbell Power Snatch',         found:'Dumbbell Power Snatch'},
};

function getLoadScale(tier) {
  return tier === 'scaled' ? 0.75 : tier === 'foundations' ? 0.50 : 1.0;
}

function roundToPlate(kg) {
  // Round to nearest 2.5kg for practical plate loading
  return Math.round(kg / 2.5) * 2.5;
}

function autoScaleBlocks(blocks, tier) {
  if (tier === 'rx') return JSON.parse(JSON.stringify(blocks));
  const config = getBoxScalingConfig();
  const scalePct = tier === 'scaled'
    ? (config._scaledPct || parseInt(document.getElementById('global-scale-pct-scaled')?.value) || 75) / 100
    : (config._foundPct  || parseInt(document.getElementById('global-scale-pct-found')?.value)  || 50) / 100;
  const repPct = tier === 'scaled'
    ? (config._scaledRepPct || parseInt(document.getElementById('global-scale-rep-scaled')?.value) || 100) / 100
    : (config._foundRepPct  || parseInt(document.getElementById('global-scale-rep-found')?.value)  || 100) / 100;

  return JSON.parse(JSON.stringify(blocks)).map(b => {
    // Apply rep scaling to block-level ladder if set
    if (repPct < 1 && b.ladderType && b.ladderType !== 'fixed') {
      const newStart = Math.max(1, Math.round((parseInt(b.ladderStart) || 1) * repPct));
      const newInc   = Math.max(1, Math.round((parseInt(b.ladderInc)   || 1) * repPct));
      b.ladderStart = String(newStart);
      b.ladderInc   = String(newInc);
    }
    b.movements = (b.movements || []).map(mv => {
      const originalName = mv.name;
      const originalKg   = parseFloat(mv.kg) || 0;
      const originalIsBW = originalKg === 0;

      // Movement substitution
      const saved = config[originalName];
      if (saved) {
        mv.name = tier === 'scaled' ? (saved.scaled || mv.name) : (saved.found || mv.name);
      } else {
        const sub = SCALING_MAP[originalName];
        if (sub) mv.name = tier === 'scaled' ? sub.scaled : sub.found;
      }

      // Load scaling
      const subIsBW = MASTER_DB[mv.name]?.type === 'bw';
      if (originalIsBW && !subIsBW) {
        mv.kg = '999';
      } else if (!originalIsBW && subIsBW) {
        mv.kg = '0';
      } else if (originalKg > 0 && originalKg !== 999) {
        mv.kg = String(roundToPlate(originalKg * scalePct));
      }

      // Rep scaling — skip max reps (999), skip if repPct is 100%
      if (repPct < 1) {
        const rawReps = parseFloat(mv.reps) || 0;
        if (rawReps > 0 && rawReps < 999) {
          mv.reps = String(Math.max(1, Math.round(rawReps * repPct)));
        }
        // Scale per-movement rep ladder if overridden
        if (mv.repsOverride === '1' && mv.repsScheme && mv.repsScheme !== 'fixed') {
          const newRepStart = Math.max(1, Math.round((parseFloat(mv.reps) || 1)));
          const newRepInc   = Math.max(1, Math.round((parseInt(mv.repsInc) || 1) * repPct));
          mv.repsInc = String(newRepInc);
        }
      }

      return mv;
    });
    return b;
  });
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRankingType(blocks) {
  if (!blocks || !blocks.length) return 'fortime';
  const mode = (blocks[0]?.mode || blocks[0]?.b_mode || 'fortime').toLowerCase();
  if (mode === 'amrap') return 'amrap';
  if (mode === 'emom' || mode === 'exmom') return 'emom';
  if (mode === 'tabata') return 'tabata';
  return 'fortime';
}

function getResultDisplay(score, rankingType) {
  if (rankingType === 'fortime') {
    const m = Math.floor(score / 60), s = Math.round(score % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  if (rankingType === 'amrap' || rankingType === 'tabata') {
    const rounds = Math.floor(score / 100);
    const reps   = score % 100;
    return reps > 0 ? `${rounds} rds + ${reps} reps` : `${rounds} rounds`;
  }
  if (rankingType === 'emom') {
    return `${score} rounds`;
  }
  if (rankingType === 'maxload') {
    return `${score} kg`;
  }
  if (rankingType === 'maxrl') {
    return `${score}% 1RM`;
  }
  return String(score);
}

function rankResults(results, rankingType) {
  const sorted = [...results];
  if (rankingType === 'fortime') {
    sorted.sort((a,b) => a.result_score - b.result_score);
  } else {
    sorted.sort((a,b) => b.result_score - a.result_score);
  }
  return sorted;
}

// ── Create Box Session ──
function openCreateBoxSession() {
  const sb = getSB(); if (!sb) { showToast(t('toast.signin.create')); return; }
  const blocks = serializeBlocksForTemplate();
  if (!blocks || !blocks.length) { showToast(t('toast.build.first')); return; }
  const rxBlocks = blocks;
  const scaledBlocks = autoScaleBlocks(blocks, 'scaled');
  const foundBlocks  = autoScaleBlocks(blocks, 'foundations');
  const rankType = getRankingType(blocks);
  const today = localDateStr(new Date());

  // Show modal
  const modal = document.getElementById('box-session-modal');
  if (!modal) { console.error('Box session modal not found'); return; }
  const scPct    = parseInt(document.getElementById('global-scale-pct-scaled')?.value) || 75;
  const fdPct    = parseInt(document.getElementById('global-scale-pct-found')?.value)  || 50;
  const scRepPct = parseInt(document.getElementById('global-scale-rep-scaled')?.value) || 100;
  const fdRepPct = parseInt(document.getElementById('global-scale-rep-found')?.value)  || 100;
  const scaledLabel = document.getElementById('bsm-scaled-label');
  const foundLabel  = document.getElementById('bsm-found-label');
  const scRepStr = scRepPct < 100 ? ` · ${scRepPct}% ${t('session.rep.label')}` : '';
  const fdRepStr = fdRepPct < 100 ? ` · ${fdRepPct}% ${t('session.rep.label')}` : '';
  if (scaledLabel) scaledLabel.textContent = t('session.scaled.label').replace('{n}', scPct) + scRepStr;
  if (foundLabel)  foundLabel.textContent  = t('session.found.label').replace('{n}', fdPct) + fdRepStr;
  document.getElementById('bsm-name').value = 'WOD ' + today;
  document.getElementById('bsm-date').value = today;
  document.getElementById('bsm-rank').value = rankType;
  document.getElementById('bsm-scaling-rx').innerHTML    = renderScalingSummary(rxBlocks);
  document.getElementById('bsm-scaling-scaled').innerHTML = renderScalingSummary(scaledBlocks);
  document.getElementById('bsm-scaling-found').innerHTML  = renderScalingSummary(foundBlocks);
  modal._rxBlocks     = rxBlocks;
  modal._scaledBlocks = scaledBlocks;
  modal._foundBlocks  = foundBlocks;
  updateBsmRankSelectors();
  modal.classList.add('open');
}

function updateBsmRankSelectors() {
  const modal     = document.getElementById('box-session-modal');
  const blocks    = modal?._rxBlocks || [];
  const rank      = document.getElementById('bsm-rank')?.value || 'fortime';
  const blockWrap = document.getElementById('bsm-rank-block-wrap');
  const movWrap   = document.getElementById('bsm-rank-movement-wrap');
  const blockSel  = document.getElementById('bsm-rank-block');
  const movSel    = document.getElementById('bsm-rank-movement');
  const isMaxType = rank === 'maxload' || rank === 'maxrl';

  if (isMaxType) {
    // Movement selector — list all max-load movements across blocks
    blockWrap.style.display = 'none';
    movWrap.style.display   = '';
    const maxMovs = [];
    blocks.forEach((b, bi) => {
      (b.movements || []).forEach(mv => {
        if (parseFloat(mv.kg) === 999) {
          maxMovs.push({ name: mv.name, blockIdx: bi });
        }
      });
    });
    if (maxMovs.length === 0) {
      // No explicit max movements — list all loaded movements
      blocks.forEach((b, bi) => {
        (b.movements || []).forEach(mv => {
          if (parseFloat(mv.kg) > 0 && parseFloat(mv.kg) !== 999) {
            maxMovs.push({ name: mv.name, blockIdx: bi });
          }
        });
      });
    }
    movSel.innerHTML = maxMovs.map((m, i) => {
      const label = blocks.length > 1
        ? `${m.name} (${t('builder.block.n')} ${m.blockIdx + 1})`
        : m.name;
      return `<option value="${i}" data-name="${m.name}" data-block="${m.blockIdx}">${label}</option>`;
    }).join('');
  } else {
    // Block selector for time/amrap/emom/tabata
    movWrap.style.display = 'none';
    if (blocks.length <= 1) {
      blockWrap.style.display = 'none';
      blockSel.innerHTML = '<option value="0">Block 1</option>';
      return;
    }
    blockWrap.style.display = '';
    const allSameMode = blocks.every(b =>
      (b.mode||b.b_mode||'').toLowerCase() === (blocks[0].mode||blocks[0].b_mode||'').toLowerCase()
    );
    let opts = blocks.map((b, i) => {
      const mode = (b.mode || b.b_mode || 'ForTime').toUpperCase();
      return `<option value="${i}">${t('builder.block.n')} ${i+1} — ${mode}</option>`;
    }).join('');
    if (allSameMode) opts += `<option value="all">${t('session.all.blocks')}</option>`;
    blockSel.innerHTML = opts;
    if (allSameMode) {
      blockSel.value = 'all';
    } else {
      const defaultIdx = blocks.findIndex(b =>
        (b.mode||b.b_mode||'').toLowerCase() === rank
      );
      blockSel.value = defaultIdx >= 0 ? String(defaultIdx) : '0';
    }
  }
}

function renderScalingSummary(blocks) {
  return (blocks || []).map(b => {
    const mode = b.mode || b.b_mode || 'ForTime';
    const ladderType  = b.ladderType  || 'fixed';
    const ladderStart = parseInt(b.ladderStart) || 0;
    const ladderInc   = parseInt(b.ladderInc)   || 0;
    const goalRounds  = parseInt(b.target) || 1;

    // EXMOM — show each movement as a labelled station
    if (mode.toLowerCase() === 'exmom') {
      const stationCount = (b.movements || []).length;
      const mvStations = (b.movements || []).map((mv, si) => {
        const kg = parseFloat(mv.kg) || 0;
        const kgStr = kg === 999 ? 'Max kg' : kg === 0 ? 'BW' : kg + 'kg';
        return `<div style="font-size:.7rem;color:var(--label);">
          <span style="color:var(--accent);font-weight:800;">${t('exmom.station')} ${si+1}:</span> ${mv.reps} ${mv.name} @ ${kgStr}
        </div>`;
      }).join('');
      return `<div style="margin-bottom:6px;"><div style="font-size:.72rem;font-weight:700;color:var(--text);">E${stationCount}MOM</div>${mvStations}</div>`;
    }

    const mvs = (b.movements || []).map(mv => {
      const kgNum = parseFloat(mv.kg) || 0;
      const wtLadderType = mv.wtLadderType || 'fixed';
      const wtLadderInc  = parseFloat(mv.wtLadderInc) || 5;

      // Build weight display
      let kgStr;
      if (kgNum === 999) {
        kgStr = 'Max kg';
      } else if (kgNum === 0) {
        kgStr = 'BW';
      } else if (wtLadderType !== 'fixed') {
        // Show weight range for ladder
        const endKg = wtLadderType === 'ascending'
          ? Math.round((kgNum + wtLadderInc * (goalRounds - 1)) * 10) / 10
          : Math.max(0, Math.round((kgNum - wtLadderInc * (goalRounds - 1)) * 10) / 10);
        const arrow = wtLadderType === 'ascending' ? '↑' : wtLadderType === 'descending' ? '↓' : '△';
        kgStr = `${kgNum}→${endKg}kg (${arrow}${wtLadderInc}kg)`;
      } else {
        kgStr = kgNum + 'kg';
      }
      const ph = kgNum > 0 && kgNum !== 999 && wtLadderType === 'fixed' ? getPerHandNote(mv.name, kgNum) : '';
      const kgFull = kgStr + (ph ? ` (${ph})` : '');

      // Build reps display
      let repsStr;
      const repsNum = parseFloat(mv.reps) || 0;
      if (repsNum === 999) {
        repsStr = 'Max reps';
      } else if (ladderType !== 'fixed' && mv.repsOverride !== '1') {
        // Block-level rep ladder
        const endReps = ladderType === 'ascending'
          ? ladderStart + ladderInc * (goalRounds - 1)
          : Math.max(0, ladderStart - ladderInc * (goalRounds - 1));
        const arrow = ladderType === 'ascending' ? '↑' : '↓';
        repsStr = `${ladderStart}→${endReps} reps (${arrow}${ladderInc})`;
      } else if (mv.repsOverride === '1' && mv.repsScheme !== 'fixed') {
        // Per-movement rep ladder
        const repsInc = parseInt(mv.repsInc) || 0;
        const endReps = mv.repsScheme === 'ascending'
          ? repsNum + repsInc * (goalRounds - 1)
          : Math.max(0, repsNum - repsInc * (goalRounds - 1));
        const arrow = mv.repsScheme === 'ascending' ? '↑' : '↓';
        repsStr = `${repsNum}→${endReps} reps (${arrow}${repsInc})`;
      } else {
        repsStr = mv.reps + ' reps';
      }

      return `<div style="font-size:.7rem;color:var(--label);">${mv.name} — ${repsStr} @ ${kgFull}</div>`;
    }).join('');

    // Show ladder scheme label if applicable
    const ladderLabel = ladderType !== 'fixed'
      ? `<div style="font-size:.65rem;color:var(--accent);margin-bottom:2px;">🔢 ${goalRounds}-round ${ladderType} ladder</div>`
      : '';

    const cwodName = b.cwod && b.cwodOpen ? `<div style="font-size:.72rem;font-weight:900;color:var(--accent);margin-bottom:2px;">★ ${b.cwod}</div>` : '';

    return `<div style="margin-bottom:6px;"><div style="font-size:.72rem;font-weight:700;color:var(--text);">${mode}</div>${cwodName}${ladderLabel}${mvs}</div>`;
  }).join('');
}

async function confirmCreateBoxSession() {
  const sb = getSB();
  if (!sb) { showToast(t('toast.signin.create')); return; }
  const modal = document.getElementById('box-session-modal');
  const name  = document.getElementById('bsm-name').value.trim() || 'Box WOD';
  const date  = document.getElementById('bsm-date').value;
  const rank  = document.getElementById('bsm-rank').value;
  if (!date) { showToast(t('toast.select.date')); return; }

  const { data: { user }, error: ue } = await sb.auth.getUser();
  if (!user) { showToast(t('toast.signin.create')); return; }

  const rankBlockVal = document.getElementById('bsm-rank-block')?.value || '0';
  const rankBlock    = rankBlockVal === 'all' ? -1 : parseInt(rankBlockVal); // -1 = aggregate all
  const movOpt       = document.getElementById('bsm-rank-movement')?.selectedOptions?.[0];
  const rankMovement = movOpt ? movOpt.dataset.name  : null;
  const rankMovBlock = movOpt ? parseInt(movOpt.dataset.block || '0') : 0;

  const scaling = {
    rx:          modal._rxBlocks || [],
    scaled:      modal._scaledBlocks || [],
    foundations: modal._foundBlocks || []
  };

  // Save template first
  const { data: tpl, error: te } = await sb.from('box_templates').insert({
    creator_id:   user.id,
    name,
    blocks:       modal._rxBlocks || [],
    scaling:      scaling,
    ranking_type: rank,
    rank_block:   rankBlock,
    rank_movement: rankMovement,
    rank_mov_block: rankMovBlock
  }).select().single();

  if (te) {
    console.error('Template insert error:', te);
    showToast('Error creating template: ' + te.message);
    return;
  }

  // Generate join code and create session
  const code = generateJoinCode();
  // End of day in local timezone
  const expiryLocal = new Date(date + 'T23:59:59');

  const { data: sess, error: se } = await sb.from('box_sessions').insert({
    template_id:  tpl.id,
    creator_id:   user.id,
    name,
    join_code:    code,
    session_date: date,
    expires_at:   expiryLocal.toISOString(),
    status:       'active'
  }).select().single();

  if (se) {
    console.error('Session insert error:', se);
    showToast('Error creating session: ' + se.message);
    return;
  }

  modal.classList.remove('open');
  showBoxSessionCode(code, name, sess.id);
  // Add to local joined sessions immediately so it shows without waiting for Supabase query
  const joined = JSON.parse(localStorage.getItem('wod_joined_sessions') || '[]');
  if (!joined.find(s => s.id === sess.id)) {
    joined.push({ id: sess.id, join_code: code, name, session_date: date, creator_id: user.id, status: 'active', expires_at: expiryLocal.toISOString() });
    localStorage.setItem('wod_joined_sessions', JSON.stringify(joined));
  }
  await renderSessionsScreen();
}

function showBoxSessionCode(code, name, sessionId) {
  const modal = document.getElementById('box-code-modal');
  document.getElementById('bcm-name').textContent = name;
  document.getElementById('bcm-code').textContent = code;
  // QR code via Google Charts API (free, no key needed)
  modal._sessionId = sessionId;
  modal.classList.add('open');
}

function copyBoxCode() {
  const code = document.getElementById('bcm-code').textContent;
  navigator.clipboard.writeText(code).then(() => showToast(t('toast.code.copied'))).catch(() => {
    showToast(t('session.code') + ': ' + code);
  });
}

function shareBoxCode() {
  const code = document.getElementById('bcm-code').textContent;
  const name = document.getElementById('bcm-name').textContent;
  if (navigator.share) {
    navigator.share({ title: name, text: `Join the box session! Code: ${code}` });
  } else {
    copyBoxCode();
  }
}

// ── Join Box Session ──
function openJoinBoxSession() {
  const modal = document.getElementById('box-join-modal');
  document.getElementById('bjm-code').value = '';
  document.getElementById('bjm-error').textContent = '';
  modal.classList.add('open');
  setTimeout(() => document.getElementById('bjm-code').focus(), 200);
}

async function confirmJoinBoxSession() {
  const sb = getSB();
  if (!sb) { showToast(t('toast.signin.join')); return; }
  const code = document.getElementById('bjm-code').value.trim().toUpperCase();
  if (code.length !== 6) {
    document.getElementById('bjm-error').textContent = t('session.join.err');
    return;
  }
  const { data: sess, error } = await sb.from('box_sessions')
    .select('*, box_templates(id, blocks, scaling, ranking_type, name)')
    .eq('join_code', code)
    .single();
  if (error || !sess) {
    document.getElementById('bjm-error').textContent = 'Session not found. Check the code.';
    return;
  }
  if (sess.status !== 'active' || new Date(sess.expires_at) < new Date()) {
    document.getElementById('bjm-error').textContent = 'This session has expired.';
    return;
  }
  // Save session to local joined list
  const joined = JSON.parse(localStorage.getItem('wod_joined_sessions') || '[]');
  if (!joined.find(s => s.id === sess.id)) {
    joined.unshift({
      id: sess.id,
      name: sess.name,
      code,
      date: sess.session_date,
      expires_at: sess.expires_at,
      creator_id: sess.creator_id
    });
    localStorage.setItem('wod_joined_sessions', JSON.stringify(joined));
  }
  document.getElementById('box-join-modal').classList.remove('open');
  // Load the Rx workout into the builder
  loadBoxSessionToBuilder(sess.box_templates.blocks, sess);
  showToast('✅ Joined: ' + sess.name);
}

function loadBoxSessionToBuilder(blocks, sess) {
  window._activeBoxSession = { ...sess, ranking_type: sess.box_templates?.ranking_type || 'fortime', _tier: 'rx' };
  // Close any open block or movement panels before switching to builder
  if (_openMovBlockId) closeMovementPanel();
  if (_openBlockId)    closeBlockDetail();
  switchTab(1);
  showScalingTierSelector(sess);
  // Lock builder — prevent structural edits
  const builderList = document.getElementById('builder-list-view');
  if (builderList) builderList.classList.add('box-session-locked');
  // Hide the add block FAB
  const fab = document.querySelector('.builder-fab');
  if (fab) fab.style.display = 'none';
  setTimeout(() => {
    window._activeBoxSession._loading = true;
    restoreBlocksFromTemplate(blocks || []);
    window._activeBoxSession._loading = false;
    showToast(t('toast.session.loaded'));
  }, 200);
}

function showScalingTierSelector(sess) {
  const existing = document.getElementById('scaling-tier-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'scaling-tier-bar';
  bar.style.cssText = 'position:sticky;top:0;z-index:50;background:var(--surface);border-bottom:1px solid var(--border);padding:8px 14px;display:flex;gap:8px;align-items:center;';
  bar.innerHTML = `
    <span style="font-size:.72rem;font-weight:700;color:var(--label);white-space:nowrap;">Scaling:</span>
    <button onclick="applyScalingTier('rx',this)" style="flex:1;padding:6px;border-radius:var(--radius-sm);border:1.5px solid var(--brand);background:var(--brand);color:white;font-size:.75rem;font-weight:700;">${t('session.tier.rx')}</button>
    <button onclick="applyScalingTier('scaled',this)" style="flex:1;padding:6px;border-radius:var(--radius-sm);border:1px solid var(--border);background:transparent;color:var(--text);font-size:.75rem;font-weight:600;">${t('session.tier.scaled')}</button>
    <button onclick="applyScalingTier('foundations',this)" style="flex:1;padding:6px;border-radius:var(--radius-sm);border:1px solid var(--border);background:transparent;color:var(--text);font-size:.75rem;font-weight:600;">${t('session.tier.found')}</button>
    <button onclick="clearBoxSession()" style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);background:transparent;color:var(--label);font-size:.7rem;">✕</button>
  `;
  bar._sess = sess;
  const builderList = document.getElementById('builder-list-view');
  if (builderList) builderList.insertBefore(bar, builderList.firstChild);
  else document.getElementById('screen-builder').insertBefore(bar, document.getElementById('screen-builder').firstChild);
}

function applyScalingTier(tier, btn) {
  const bar = document.getElementById('scaling-tier-bar');
  const sess = bar?._sess;
  if (!sess) return;
  bar.querySelectorAll('button[onclick*="applyScalingTier"]').forEach(b => {
    b.style.background = 'transparent'; b.style.color = 'var(--text)';
    b.style.border = '1px solid var(--border)'; b.style.fontWeight = '600';
  });
  btn.style.background = 'var(--brand)'; btn.style.color = 'white';
  btn.style.border = '1.5px solid var(--brand)'; btn.style.fontWeight = '700';
  if (window._activeBoxSession) window._activeBoxSession._tier = tier;
  const tpl = sess.box_templates || {};
  const blocks = (tpl.scaling && tpl.scaling[tier]) ? tpl.scaling[tier] : (tpl.blocks || []);
  if (window._activeBoxSession) window._activeBoxSession._loading = true;
  restoreBlocksFromTemplate(blocks);
  if (window._activeBoxSession) window._activeBoxSession._loading = false;
  // Keep builder locked after tier switch
  setTimeout(() => {
    document.getElementById('builder-list-view')?.classList.add('box-session-locked');
    const fab = document.querySelector('.builder-fab');
    if (fab) fab.style.display = 'none';
  }, 50);
  showToast(tier.charAt(0).toUpperCase() + tier.slice(1) + ' loaded');
}

function clearBoxSession() {
  window._activeBoxSession = null;
  const bar = document.getElementById('scaling-tier-bar');
  if (bar) bar.remove();
  // Unlock builder
  const builderList = document.getElementById('builder-list-view');
  if (builderList) builderList.classList.remove('box-session-locked');
  showToast(t('toast.session.cleared'));
}

// ── Submit to leaderboard ──
function checkMaxKgPRs() {
  // Check if any max-load movement exceeded the athlete's recorded 1RM
  document.querySelectorAll('.wod-block').forEach(block => {
    block.querySelectorAll('.movement-block').forEach(mv => {
      const rawKg = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
      if (rawKg !== 999) return;
      const entered = parseFloat(mv.querySelector('.m-wt')?.dataset?.maxKgEntered) || 0;
      if (!entered) return;
      const name = mv.querySelector('.m-search')?.value || '';
      const prKey = RM_MAP[name] || RM_MAP[name.split(' (')[0]];
      if (!prKey) return;
      const matchedName = RM_MAP[name] ? name : name.split(' (')[0];
      // Skip PR-update prompt for movements using a correlation factor —
      // their "1RM" is derived from a different lift's recorded PR, so
      // updating that field with this movement's weight would be incorrect.
      if (RM_CORRELATION[matchedName]) return;
      const current1RM = parseFloat(document.getElementById(prKey)?.value) || 0;
      if (entered > current1RM) {
        setTimeout(() => {
          if (confirm(`🏆 ${name}: ${entered}kg exceeds your recorded 1RM (${current1RM}kg). Update your PR?`)) {
            const prInp = document.getElementById(prKey);
            if (prInp) { prInp.value = entered; saveProfile(); sbSaveProfile(); showToast(t('toast.pr.updated')); }
          }
        }, 500);
      }
    });
  });
}

function showLeaderboardSubmitPrompt() {
  const sess = window._activeBoxSession;
  if (!sess) return false;
  const modal = document.getElementById('box-submit-modal');
  document.getElementById('bsub-name').textContent = sess.name || 'Box Session';
  modal.classList.add('open');
  return true;
}

async function submitToLeaderboard(type) {
  const sb = getSB(); if (!sb) return;
  const sess = window._activeBoxSession;
  if (!sess) return;
  document.getElementById('box-submit-modal').classList.remove('open');

  const user = (await sb.auth.getUser()).data.user;
  if (!user) return;

  const displayName = document.getElementById('global-display-name')?.value?.trim() || user.email.split('@')[0];
  const tier = sess._tier || 'rx';
  const rank         = sess.ranking_type || 'fortime';
  const rankBlockIdx = parseInt(sess.box_templates?.rank_block ?? sess.rank_block ?? 0);
  const rankMovName  = sess.box_templates?.rank_movement || sess.rank_movement || null;
  const rankMovBlock = parseInt(sess.box_templates?.rank_mov_block ?? sess.rank_mov_block ?? 0);
  const isAggregate  = rankBlockIdx === -1;

  // Get score from results
  const blocks = document.querySelectorAll('.wod-block');
  let score = 0;

  if (rank === 'maxload' || rank === 'maxrl') {
    // Find specific movement in specific block
    const targetBlock = blocks[rankMovBlock] || blocks[0];
    targetBlock?.querySelectorAll('.movement-block').forEach(mv => {
      const mvName = mv.querySelector('.m-search')?.value || '';
      if (rankMovName && mvName !== rankMovName) return;
      const rawKg = parseFloat(mv.querySelector('.m-wt')?.value) || 0;
      const kg = rawKg === 999
        ? (parseFloat(mv.querySelector('.m-wt')?.dataset?.maxKgEntered) || 0)
        : rawKg;
      if (!kg) return;
      if (rank === 'maxload') {
        if (kg > score) score = kg;
      } else {
        const name = mv.querySelector('.m-search')?.value || '';
        const prKey = RM_MAP[name] || RM_MAP[name.split(' (')[0]];
        if (!prKey) return;
        const oneRM = parseFloat(document.getElementById(prKey)?.value) || 0;
        if (oneRM > 0) score = Math.max(score, Math.round((kg / oneRM) * 100));
      }
    });
  } else if (isAggregate) {
    // Aggregate across all blocks
    blocks.forEach(b => {
      if (rank === 'fortime' || rank === 'emom') {
        const resM = parseInt(b.querySelector('.res-m')?.value) || 0;
        const resS = parseInt(b.querySelector('.res-s')?.value) || 0;
        score += resM * 60 + resS;
      } else if (rank === 'amrap' || rank === 'tabata') {
        const resR = parseInt(b.querySelector('.res-r')?.value) || 0;
        const resX = parseInt(b.querySelector('.res-x')?.value) || 0;
        score += resR * 100 + resX;
      }
    });
  } else {
    // Single block
    const rankBlock = blocks[rankBlockIdx] || blocks[0];
    if (rank === 'fortime' || rank === 'emom') {
      const resM = rankBlock?.querySelector('.res-m')?.value || 0;
      const resS = rankBlock?.querySelector('.res-s')?.value || 0;
      score = parseInt(resM) * 60 + parseInt(resS);
    } else if (rank === 'amrap' || rank === 'tabata') {
      const resR = rankBlock?.querySelector('.res-r')?.value || 0;
      const resX = rankBlock?.querySelector('.res-x')?.value || 0;
      score = parseInt(resR) * 100 + parseInt(resX);
    }
  }

  const row = {
    session_id: sess.id,
    user_id: user.id,
    display_name: displayName,
    scaling_tier: tier,
    result_score: score,
    result_display: getResultDisplay(score, rank),
    submission_type: type,
    reactions: {}
  };

  if (type === 'full') {
    row.pd = parseFloat(document.getElementById('resPD')?.innerText) || null;
    row.wd = parseFloat(document.getElementById('resWD')?.dataset.precise || document.getElementById('resWD')?.innerText) || null;
    row.mc = parseFloat(document.getElementById('resMC')?.innerText) || null;
    row.fb = parseFloat(document.getElementById('resFB')?.innerText) || null;
    row.rl = parseFloat(document.getElementById('resRL')?.innerText) || null;
    row.td = parseFloat(document.getElementById('resTD')?.innerText) || null;
  }

  // Upsert — keeps best score (lower for fortime, higher for amrap)
  const { data: existing } = await sb.from('box_results')
    .select('id, result_score')
    .eq('session_id', sess.id)
    .eq('user_id', user.id)
    .maybeSingle();

  let shouldInsert = true;
  if (existing) {
    const isBetter = rank === 'fortime' ? score < existing.result_score : score > existing.result_score;
    if (isBetter) {
      await sb.from('box_results').update(row).eq('id', existing.id);
      showToast(t('toast.leaderboard.updated'));
    } else {
      showToast(t('toast.pr.not.better'));
    }
    shouldInsert = false;
  }
  if (shouldInsert) {
    const { error } = await sb.from('box_results').insert(row);
    if (error) showToast('Error: ' + error.message);
    else showToast(t('toast.result.submitted'));
  }
  window._activeBoxSession = null;
}


// ── Box Scaling Configuration ──
// ── Box Scaling Configuration ──

function getBoxScalingConfig() {
  return JSON.parse(localStorage.getItem('wod_box_scaling_config') || '{}');
}

function saveBoxScalingEntry(mvName, scaledMv, foundMv) {
  const config = getBoxScalingConfig();
  const defaultSub = SCALING_MAP[mvName];
  if (defaultSub && defaultSub.scaled === scaledMv && defaultSub.found === foundMv) {
    delete config[mvName];
  } else {
    config[mvName] = { scaled: scaledMv, found: foundMv };
  }
  // Always preserve current pct values
  config._scaledPct    = parseInt(document.getElementById('global-scale-pct-scaled')?.value) || config._scaledPct    || 75;
  config._foundPct     = parseInt(document.getElementById('global-scale-pct-found')?.value)  || config._foundPct     || 50;
  config._scaledRepPct = parseInt(document.getElementById('global-scale-rep-scaled')?.value) || config._scaledRepPct || 100;
  config._foundRepPct  = parseInt(document.getElementById('global-scale-rep-found')?.value)  || config._foundRepPct  || 100;
  localStorage.setItem('wod_box_scaling_config', JSON.stringify(config));
  localStorage.setItem('wod_profile_updated_at', new Date().toISOString());
  const sb = getSB();
  if (sb) sb.auth.getUser().then(({ data: { user } }) => {
    if (user) sb.from('profiles').upsert({ id: user.id, scaling_config: config, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  });
  // Close the editor — use data-mv attribute to find it safely
  const list = document.getElementById('box-scaling-list');
  if (list) {
    const editor = list.querySelector(`[data-mv="${mvName}"]`);
    if (editor) editor.remove();
  }
  renderBoxScalingList();
  showToast(t('toast.scaling.saved'));
}

function resetBoxScalingEntry(mvName) {
  const config = getBoxScalingConfig();
  delete config[mvName];
  localStorage.setItem('wod_box_scaling_config', JSON.stringify(config));
  const sb = getSB();
  if (sb) sb.auth.getUser().then(({ data: { user } }) => {
    if (user) sb.from('profiles').upsert({ id: user.id, scaling_config: config, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  });
  renderBoxScalingList();
  showToast(t('toast.reset.default'));
}

function initBoxScaling() {
  renderBoxScalingList();
  // Close search results on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#box-scaling-search') && !e.target.closest('#box-scaling-results')) {
      const r = document.getElementById('box-scaling-results');
      if (r) r.style.display = 'none';
    }
  }, { once: false });
}

function boxScalingSearch(query) {
  const results = document.getElementById('box-scaling-results');
  const input   = document.getElementById('box-scaling-search');
  if (!results || !input) return;
  if (!query.trim()) { results.style.display = 'none'; return; }
  const q = query.toLowerCase();
  const matches = Object.keys(MASTER_DB).filter(m => m.toLowerCase().includes(q)).slice(0, 12);
  if (!matches.length) { results.style.display = 'none'; return; }
  results.innerHTML = matches.map(m => {
    const isInMap = !!SCALING_MAP[m];
    return `<div onclick="selectBoxScalingMovement('${m.replace(/'/g,"\\'")}');document.getElementById('box-scaling-search').value='';document.getElementById('box-scaling-results').style.display='none';"
      style="padding:10px 14px;cursor:pointer;font-size:.8rem;color:var(--text);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);">
      <span>${m}</span>
      ${isInMap ? '<span style="font-size:.62rem;color:var(--brand);font-weight:700;">has defaults</span>' : ''}
    </div>`;
  }).join('');
  // Position fixed relative to input so it escapes accordion overflow
  const rect = input.getBoundingClientRect();
  results.style.top   = (rect.bottom + 4) + 'px';
  results.style.left  = rect.left + 'px';
  results.style.width = rect.width + 'px';
  results.style.display = 'block';
}

function selectBoxScalingMovement(mvName) {
  const config = getBoxScalingConfig();
  const defaultSub = SCALING_MAP[mvName];
  const saved = config[mvName];
  const currentScaled = saved?.scaled || defaultSub?.scaled || '';
  const currentFound  = saved?.found  || defaultSub?.found  || '';
  const isCustom = !!saved;

  // Build inline editor and insert at top of list
  const list = document.getElementById('box-scaling-list');
  if (!list) return;

  // Remove any existing editor for same movement
  const existing = document.getElementById(`bse-${CSS.escape(mvName)}`);
  if (existing) { existing.remove(); return; }

  const allMvs = Object.keys(MASTER_DB).sort();
  const scOpts = allMvs.map(m => `<option value="${m}"${m===currentScaled?' selected':''}>${m}</option>`).join('');
  const fdOpts = allMvs.map(m => `<option value="${m}"${m===currentFound?' selected':''}>${m}</option>`).join('');

  const editor = document.createElement('div');
  editor.id = `bse-${mvName}`;
  editor.dataset.mv = mvName;
  editor.style.cssText = 'background:var(--surface2);border:1px solid var(--brand);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;';
  editor.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:.78rem;font-weight:800;color:var(--text);">${mvName}</div>
      <button onclick="document.getElementById('bse-${mvName.replace(/'/g,"\\'")}').remove()" style="background:none;border:none;color:var(--label);cursor:pointer;font-size:.9rem;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <div>
        <div style="font-size:.62rem;font-weight:700;color:var(--accent);margin-bottom:3px;">SCALED</div>
        <select id="bse-sc-${mvName}" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.76rem;-webkit-appearance:none;">${scOpts}</select>
      </div>
      <div>
        <div style="font-size:.62rem;font-weight:700;color:var(--success);margin-bottom:3px;">FOUNDATIONS</div>
        <select id="bse-fd-${mvName}" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.76rem;-webkit-appearance:none;">${fdOpts}</select>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button onclick="saveBoxScalingEntry('${mvName.replace(/'/g,"\\'")}',document.getElementById('bse-sc-${mvName.replace(/'/g,"\\'")}').value,document.getElementById('bse-fd-${mvName.replace(/'/g,"\\'")}').value)"
        class="btn btn-primary" style="flex:1;font-size:.74rem;"><span data-i18n="btn.save">Save</span></button>
      ${isCustom || !defaultSub ? `<button onclick="resetBoxScalingEntry('${mvName.replace(/'/g,"\\'")}');document.getElementById('bse-${mvName.replace(/'/g,"\\'")}').remove();"
        class="btn" style="font-size:.74rem;background:var(--surface);color:var(--text);">↺ Reset to default</button>` : ''}
    </div>`;
  list.insertBefore(editor, list.firstChild);
  // Scroll editor into view
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderBoxScalingList() {
  const el = document.getElementById('box-scaling-list');
  if (!el) return;
  const config = getBoxScalingConfig();
  const customEntries = Object.entries(config).filter(([k]) => !k.startsWith('_'));

  if (!customEntries.length) {
    // Remove any existing entries but keep open editors
    const existing = el.querySelectorAll('.bsc-saved-entry');
    existing.forEach(e => e.remove());
    if (!el.querySelector('[id^="bse-"]')) {
      el.innerHTML = '<div style="font-size:.72rem;color:var(--label);font-style:italic;padding:8px 0;">No custom scaling configured. Search a movement above to customise.</div>';
    }
    return;
  }

  // Remove old saved entries, keep editors
  el.querySelectorAll('.bsc-saved-entry').forEach(e => e.remove());
  // Remove placeholder
  const placeholder = el.querySelector('div[style*="font-style:italic"]');
  if (placeholder) placeholder.remove();

  customEntries.forEach(([mv, subs]) => {
    const defaultSub = SCALING_MAP[mv];
    const isOverride = defaultSub && (defaultSub.scaled !== subs.scaled || defaultSub.found !== subs.found);
    const isNew = !defaultSub;
    const tag = isNew ? 'NEW' : isOverride ? 'CUSTOM' : '';
    const entry = document.createElement('div');
    entry.className = 'bsc-saved-entry';
    entry.style.cssText = 'background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:6px;';
    entry.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="flex:1;">
          <div style="font-size:.76rem;font-weight:800;color:var(--text);margin-bottom:4px;">
            ${mv} ${tag ? `<span style="font-size:.6rem;color:var(--brand);font-weight:700;background:rgba(255,107,53,.1);padding:1px 5px;border-radius:8px;">${tag}</span>` : ''}
          </div>
          <div style="font-size:.68rem;color:var(--label);">Scaled: <span style="color:var(--accent);font-weight:600;">${subs.scaled||'—'}</span></div>
          <div style="font-size:.68rem;color:var(--label);">Foundations: <span style="color:var(--success);font-weight:600;">${subs.found||'—'}</span></div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button onclick="selectBoxScalingMovement('${mv.replace(/'/g,"\\'")}');" style="background:none;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--label);font-size:.68rem;cursor:pointer;padding:3px 7px;"><span data-i18n="btn.edit">Edit</span></button>
          <button onclick="resetBoxScalingEntry('${mv.replace(/'/g,"\\'")}');" style="background:none;border:none;color:var(--label);font-size:.8rem;cursor:pointer;padding:3px 6px;" title="Reset to default">✕</button>
        </div>
      </div>`;
    el.appendChild(entry);
  });
}

async function deleteBoxSession(sessionId) {
  const ok = await showConfirm(t('confirm.delete.session'));
  if (!ok) return;
  const sb = getSB(); if (!sb) return;
  try {
    // Get template_id using maybeSingle to avoid 406 when row missing
    const { data: sess } = await sb.from('box_sessions')
      .select('template_id').eq('id', sessionId).maybeSingle();
    // Delete results (may be empty — ignore error)
    await sb.from('box_results').delete().eq('session_id', sessionId);
    // Delete session
    const { error: se } = await sb.from('box_sessions').delete().eq('id', sessionId);
    if (se) { showToast('Error: ' + se.message); console.error('Session delete:', se); return; }
    // Delete template if found
    if (sess?.template_id) {
      await sb.from('box_templates').delete().eq('id', sess.template_id);
    }
    // Remove from local joined sessions list
    const joined = JSON.parse(localStorage.getItem('wod_joined_sessions') || '[]');
    localStorage.setItem('wod_joined_sessions', JSON.stringify(joined.filter(s => s.id !== sessionId)));
    showToast(t('toast.session.deleted'));
    await renderSessionsScreen();
  } catch(e) {
    console.error('deleteBoxSession error:', e);
    showToast(t('toast.delete.failed'));
  }
}

function leaveBoxSession(sessionId) {
  const joined = JSON.parse(localStorage.getItem('wod_joined_sessions') || '[]');
  localStorage.setItem('wod_joined_sessions', JSON.stringify(joined.filter(s => s.id !== sessionId)));
  renderSessionsScreen();
}

async function renderSessionsScreen() {
  const el = document.getElementById('sessions-list');
  if (!el) return;

  // Show empty state immediately while loading
  const emptyState = `<div style="text-align:center;padding:40px 20px;">
    <div style="margin-bottom:16px;opacity:.9;"><svg width="100" height="80" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Person 1 -->
  <circle cx="28" cy="22" r="10" fill="var(--brand)" opacity=".6"/>
  <path d="M10 62 Q10 44 28 44 Q46 44 46 62" fill="var(--brand)" opacity=".4"/>
  <!-- Person 2 (behind right) -->
  <circle cx="72" cy="22" r="10" fill="var(--accent)" opacity=".6"/>
  <path d="M54 62 Q54 44 72 44 Q90 44 90 62" fill="var(--accent)" opacity=".4"/>
  <!-- Person middle (front) -->
  <circle cx="50" cy="18" r="12" fill="#22C55E" opacity=".8"/>
  <path d="M28 68 Q28 46 50 46 Q72 46 72 68" fill="#22C55E" opacity=".6"/>
  <!-- Plus icon -->
  <circle cx="78" cy="58" r="10" fill="var(--brand)" opacity=".9"/>
  <line x1="78" y1="52" x2="78" y2="64" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="72" y1="58" x2="84" y2="58" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
</svg></div>
    <div style="font-size:.88rem;font-weight:900;color:var(--text);margin-bottom:6px;">${t('session.no.sessions')}</div>
    <div style="font-size:.74rem;color:var(--label);line-height:1.6;">${t('session.join.title')}.</div>
  </div>`;

  try {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--label);font-size:.78rem;">${t('session.active')}...</div>`;

    const sb = getSB();
    let createdSessions = [];

    if (sb) {
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const { data } = await sb.from('box_sessions')
            .select('*')
            .eq('creator_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);
          createdSessions = data || [];
        }
      } catch(e) { /* not signed in or network error */ }
    }

    const joined = JSON.parse(localStorage.getItem('wod_joined_sessions') || '[]');
    // Get current user id for creator detection on joined sessions
    let currentUserId = null;
    try {
      if (sb) currentUserId = (await sb.auth.getUser()).data?.user?.id;
    } catch(e) {}

    const allSessions = [
      ...createdSessions.map(s => ({...s, role:'creator'})),
      ...joined.filter(j => !createdSessions.find(c => c.id === j.id))
               .map(s => ({...s, role: s.creator_id === currentUserId ? 'creator' : 'member'}))
    ].sort((a,b) => new Date(b.session_date || b.date) - new Date(a.session_date || a.date));

    if (!allSessions.length) {
      el.innerHTML = emptyState;
      return;
    }

    el.innerHTML = allSessions.map(s => {
      const isActive = (s.status === 'active' || !s.status) && s.expires_at && new Date(s.expires_at) > new Date();
      const statusDot = isActive
        ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22C55E;margin-right:5px;"></span>'
        : '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--label);margin-right:5px;"></span>';
      const sid = s.id || '';
      const scode = s.join_code || s.code || '';
      const deleteBtn = s.role === 'creator'
        ? `<button onclick="event.stopPropagation();deleteBoxSession(this.dataset.sid)" data-sid="${sid}" style="background:none;border:none;color:var(--label);font-size:1rem;cursor:pointer;padding:4px;">🗑️</button>`
        : `<button onclick="event.stopPropagation();leaveBoxSession(this.dataset.sid)" data-sid="${sid}" style="background:none;border:none;color:var(--label);font-size:.75rem;cursor:pointer;padding:4px;">${t('btn.cancel')}</button>`;
      return `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:var(--glass-shadow);border-radius:var(--radius);padding:12px;margin-bottom:10px;cursor:pointer;" onclick="openSessionLeaderboard(this.dataset.sid,this.dataset.scode)" data-sid="${sid}" data-scode="${scode}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-size:.84rem;font-weight:800;color:var(--text);">${s.name}</div>
            <div style="font-size:.72rem;color:var(--label);margin-top:2px;">${statusDot}${isActive ? t('session.active') : t('session.results')} · ${s.session_date || s.date || ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${(s.join_code||s.code) ? `<div style="font-size:.9rem;font-weight:900;color:var(--brand);letter-spacing:.1em;">${s.join_code||s.code}</div>` : ''}
            <div style="font-size:.65rem;color:var(--label);">${s.role === 'creator' ? t('session.create.title').split(' ')[0] : t('session.member')}</div>
            ${deleteBtn}
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('renderSessionsScreen error:', e);
    el.innerHTML = emptyState;
  }
}

async function refreshLeaderboard() {
  const modal = document.getElementById('box-leaderboard-modal');
  if (modal._sessionId) await openSessionLeaderboard(modal._sessionId, modal._code || '');
}

async function openSessionLeaderboard(sessionId, code) {
  const sb = getSB(); if (!sb) return;
  const { data: results, error } = await sb.from('box_results')
    .select('*')
    .eq('session_id', sessionId)
    .order('result_score', { ascending: true });  // ascending = best fortime first
  if (error) { showToast(t('toast.error')); return; }

  const { data: sess } = await sb.from('box_sessions')
    .select('*, box_templates(ranking_type, name, blocks, scaling)')
    .eq('id', sessionId).maybeSingle();
  const rankType = sess?.box_templates?.ranking_type || 'fortime';
  const ranked = rankResults(results || [], rankType);

  const modal = document.getElementById('box-leaderboard-modal');
  modal._sessionId = sessionId;
  modal._code = code;
  document.getElementById('blm-title').textContent = sess?.name || 'Leaderboard';
  document.getElementById('blm-code').textContent = code ? `${t('session.code.label')} ${code}` : '';

  // WOD overview — same as create box session modal
  const scaling = sess?.box_templates?.scaling;
  const wodSection = document.getElementById('blm-wod-section');
  const wodContent = document.getElementById('blm-wod-content');
  if (scaling && wodSection && wodContent) {
    const rxBlocks  = scaling.rx          || sess?.box_templates?.blocks || [];
    const scBlocks  = scaling.scaled      || [];
    const fdBlocks  = scaling.foundations || [];
    wodContent.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:var(--radius-sm);padding:8px;border-left:3px solid var(--brand);">
          <div style="font-size:.65rem;font-weight:800;color:var(--brand);margin-bottom:4px;" data-i18n="session.rx.label">RX — as prescribed</div>
          ${renderScalingSummary(rxBlocks)}
        </div>
        ${scBlocks.length ? `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:var(--radius-sm);padding:8px;border-left:3px solid var(--accent);">
          <div style="font-size:.65rem;font-weight:800;color:var(--accent);margin-bottom:4px;" data-i18n="session.tier.scaled">SCALED</div>
          ${renderScalingSummary(scBlocks)}
        </div>` : ''}
        ${fdBlocks.length ? `<div style="background:var(--glass-bg);border:0.5px solid var(--glass-border);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:var(--radius-sm);padding:8px;border-left:3px solid var(--success);">
          <div style="font-size:.65rem;font-weight:800;color:var(--success);margin-bottom:4px;" data-i18n="session.tier.found">FOUNDATIONS</div>
          ${renderScalingSummary(fdBlocks)}
        </div>` : ''}
      </div>`;
    applyLangToEl(wodContent);
    wodSection.style.display = '';
  } else {
    wodSection.style.display = 'none';
  }

  const tiers = ['rx','scaled','foundations'];
  const tierNames = {rx:t('session.tier.rx'), scaled:t('session.tier.scaled'), foundations:t('session.tier.found')};
  let html = '';
  tiers.forEach(tier => {
    const tierResults = ranked.filter(r => r.scaling_tier === tier);
    if (!tierResults.length) return;
    html += `<div style="margin-bottom:16px;">
      <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--label);margin-bottom:8px;">${tierNames[tier]}</div>`;
    tierResults.forEach((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
      const user = (sb.auth.getUser && window._sbUser?.id === r.user_id) ? ' (you)' : '';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:5px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:.9rem;">${medal}</span>
          <div>
            <div style="font-size:.8rem;font-weight:700;color:var(--text);">${r.display_name}${user}</div>
            ${r.submission_type === 'full' ? `<div style="font-size:.65rem;color:var(--label);">${r.pd||'—'} W/kg · ${r.wd||'—'} kJ · ${r.mc||'—'} kcal</div>` : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.88rem;font-weight:900;color:var(--brand);">${r.result_display}</div>
          <div style="display:flex;gap:4px;margin-top:3px;justify-content:flex-end;">
            ${[['fire','🔥'],['muscle','💪'],['clap','👏']].map(([key,emoji]) =>
              `<button onclick="toggleReaction(this.dataset.rid,this.dataset.key,this)" data-rid="${r.id}" data-key="${key}" data-emoji="${emoji}" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:2px 6px;font-size:.7rem;cursor:pointer;color:var(--text);">
                ${emoji} <span style="color:var(--label);font-size:.65rem;">${(r.reactions?.[key] > 0) ? r.reactions[key] : ''}</span>
              </button>`
            ).join('')}
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
  });

  if (!html) html = '<div style="text-align:center;padding:20px;color:var(--label);font-size:.78rem;">No results yet.</div>';
  document.getElementById('blm-results').innerHTML = html;
  modal.classList.add('open');
}

async function toggleReaction(resultId, key, btn) {
  const sb = getSB(); if (!sb) return;
  const user = (await sb.auth.getUser()).data.user;
  if (!user) { showToast(t('toast.signin.react')); return; }
  try {
    const emoji = btn.dataset.emoji || key;
    const storageKey = `wod_reaction_${resultId}_${key}_${user.id}`;
    const alreadyReacted = localStorage.getItem(storageKey);
    const { data: r } = await sb.from('box_results')
      .select('reactions').eq('id', resultId).maybeSingle();
    const reactions = r?.reactions || {};
    if (alreadyReacted) {
      reactions[key] = Math.max(0, (reactions[key] || 1) - 1);
      localStorage.removeItem(storageKey);
      btn.style.background = 'var(--surface)';
      btn.style.borderColor = 'var(--border)';
    } else {
      reactions[key] = (reactions[key] || 0) + 1;
      localStorage.setItem(storageKey, '1');
      btn.style.background = 'var(--surface2)';
      btn.style.borderColor = 'var(--brand)';
    }
    const { error } = await sb.from('box_results').update({ reactions }).eq('id', resultId);
    if (error) { console.error('Reaction save error:', error); showToast(t('toast.reaction.failed')); return; }
    const count = reactions[key] || '';
    btn.innerHTML = `${emoji} <span style="color:var(--label);font-size:.65rem;">${count > 0 ? count : ''}</span>`;
  } catch(e) {
    console.error('toggleReaction error:', e);
  }
}
