/* ════════════════════════════════════════════════════
   PHYSICS CORE
   The core calculation engine: segment builders, cardio
   energy estimation, personal performance bands, 1RM/
   suggested-weight logic, calculateGlobalPhysics (the main
   mc/wd/fb/rl/td calculation), and the Movement Pattern
   profile calculator.
════════════════════════════════════════════════════ */

// ══ Step 1: block segmentation for saving ══
// For a given block, splits its time window into segments using the
// cardio toggle data: one segment per cardio movement actually toggled
// (unioning all its start/stop windows if toggled multiple times across
// rounds — e.g. Run appearing once per round in a 5-round block), plus
// one "mechanical" segment for whatever block time isn't covered by any
// cardio toggle. Each segment gets its own HR-derived avg/max where real
// samples exist during its window. If NO segment in the block has any
// real HR data at all (strap wasn't connected, or nothing was toggled
// and no ambient samples exist), the whole block collapses to a single
// segment using the manual RPE slider — same fallback the app has always
// had, just now the true bottom tier instead of the only tier.
function _buildBlockSegments(blockIdx, blockStartMs, blockEndMs) {
  const blockIntervals = window._cardioIntervals.filter(iv => iv.blockIdx === blockIdx);
  const segments = [];
  const cardioCoveredRanges = [];

  const byType = {};
  blockIntervals.forEach(iv => {
    if (!byType[iv.movement]) byType[iv.movement] = [];
    byType[iv.movement].push(iv);
  });

  Object.keys(byType).forEach(type => {
    const intervals = byType[type];
    let totalDurationSec = 0;
    let samples = [];
    intervals.forEach(iv => {
      totalDurationSec += iv.durationSec;
      cardioCoveredRanges.push([iv.startMs, iv.endMs]);
      samples = samples.concat(window._hrSamples.filter(s => s.ts >= iv.startMs && s.ts <= iv.endMs));
    });
    if (samples.length) {
      const bpms = samples.map(s => s.bpm);
      segments.push({
        type, source: 'hr_segment',
        avgHR: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
        maxHR: Math.max(...bpms),
        durationSec: totalDurationSec
      });
    } else {
      segments.push({ type, source: 'no_hr', durationSec: totalDurationSec });
    }
  });

  // Mechanical/leftover segment — block time not covered by any cardio toggle
  const blockDurationSec = (blockEndMs - blockStartMs) / 1000;
  const cardioDurationSec = blockIntervals.reduce((sum, iv) => sum + iv.durationSec, 0);
  const mechDurationSec = blockDurationSec - cardioDurationSec;
  if (mechDurationSec > 0) {
    const mechSamples = window._hrSamples.filter(s => {
      if (s.ts < blockStartMs || s.ts > blockEndMs) return false;
      return !cardioCoveredRanges.some(([start, end]) => s.ts >= start && s.ts <= end);
    });
    if (mechSamples.length) {
      const bpms = mechSamples.map(s => s.bpm);
      segments.push({
        type: 'mechanical', source: 'hr_segment',
        avgHR: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
        maxHR: Math.max(...bpms),
        durationSec: mechDurationSec
      });
    } else {
      segments.push({ type: 'mechanical', source: 'no_hr', durationSec: mechDurationSec });
    }
  }

  const anyRealHR = segments.some(s => s.source === 'hr_segment');
  if (!anyRealHR) {
    const rpeEl = document.getElementById('result-rpe-slider-' + blockIdx);
    const rpe = rpeEl ? parseFloat(rpeEl.value) : null;
    return [{ type: 'block', source: 'manual_rpe', rpe: rpe || null, durationSec: blockDurationSec }];
  }
  return segments;
}

// Builds the full per-block segment array for the whole session, for
// saving. Call at save time, after the last block's window has closed.
function _buildAllBlockSegments() {
  return (window._blockTimeWindows || []).map(w => _buildBlockSegments(w.blockIdx, w.startMs, w.endMs));
}

// Real, live-recorded cardio toggle duration per (block, movement type) —
// e.g. {"0_run": 187, "2_row": 412} — summed across every toggle cycle
// of that type within that block. Captured at save time so
// getSessionCardioInstances can use this real duration directly instead
// of estimating pace from profile PRs (linearSecs) whenever it's
// available for a given block/movement combination. Distance/reps
// aren't duplicated here — those are already saved via the logged
// movement data; this only adds the real TIME component to pair with it.
function _buildCardioIntervalSummary() {
  const summary = {};
  (window._cardioIntervals || []).forEach(iv => {
    const key = `${iv.blockIdx}_${iv.movement}`;
    summary[key] = (summary[key] || 0) + iv.durationSec;
  });
  return Object.keys(summary).length ? summary : null;
}

// Same (block, movement type) real-duration lookup as
// _buildCardioIntervalSummary above, but scoped to a single block —
// used live, mid-session, by the Audit Trail while building each
// block's movement rows, before a full-session summary makes sense.
function _liveCardioRealSecs(blockIdx, cardioType) {
  const secs = (window._cardioIntervals || [])
    .filter(iv => iv.blockIdx === blockIdx && iv.movement === cardioType)
    .reduce((sum, iv) => sum + iv.durationSec, 0);
  return secs > 0 ? secs : null;
}

// Formats real per-movement cardio pace/cadence/cal-min for Audit Trail
// display. totalUnits is real total distance in meters (run/row/ski),
// total calories (bike), or total reps (du/jump rope — cardioRef=1 or
// 10 respectively), all already derived the same way
// getSessionCardioInstances does from reps × MASTER_DB's cardioRef.
// secs must be a real toggle-recorded duration — this is never called
// with an estimated duration, so no fabricated pace is ever shown.
function _fmtCardioPace(cardioType, totalUnits, secs) {
  if (!secs || secs <= 0 || !totalUnits || totalUnits <= 0) return '';
  const mins = secs / 60;
  if (cardioType === 'run') {
    const secPerKm = secs / (totalUnits / 1000);
    if (!isFinite(secPerKm) || secPerKm <= 0) return '';
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')}/km`;
  }
  if (cardioType === 'row' || cardioType === 'ski') {
    const secPer500 = secs / (totalUnits / 500);
    if (!isFinite(secPer500) || secPer500 <= 0) return '';
    const m = Math.floor(secPer500 / 60), s = Math.round(secPer500 % 60);
    return `${m}:${String(s).padStart(2, '0')}/500m`;
  }
  if (cardioType === 'du') {
    const rpm = totalUnits / mins;
    if (!isFinite(rpm) || rpm <= 0) return '';
    return `${Math.round(rpm)} rpm`;
  }
  if (cardioType === 'bike') {
    const calMin = totalUnits / mins;
    if (!isFinite(calMin) || calMin <= 0) return '';
    return `${calMin.toFixed(1)} cal/min`;
  }
  return '';
}

// Rest periods as their own HR-derived segments, same treatment as any
// mechanical segment — real average HR during the window, converted to
// relIntensity via %HRR, no invented baseline MET. Only ever populated
// from window._restTimeWindows, which only gets entries when a rest
// countdown genuinely ran live (see startRestCountdown/skip-rest) — a
// recalculated or manually-edited session has no rest windows at all,
// and correctly contributes nothing here, rather than guessing.
function _buildRestSegments() {
  return (window._restTimeWindows || []).map(w => {
    const samples = window._hrSamples.filter(s => s.ts >= w.startMs && s.ts <= w.endMs);
    const durationSec = (w.endMs - w.startMs) / 1000;
    if (!samples.length) return { afterBlockIdx: w.afterBlockIdx, source: 'no_hr', durationSec };
    const bpms = samples.map(s => s.bpm);
    return {
      afterBlockIdx: w.afterBlockIdx, source: 'hr_segment',
      avgHR: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      maxHR: Math.max(...bpms),
      durationSec
    };
  });
}

// Finds this block's real time window, guarding against stale data —
// window._blockTimeWindows could belong to a DIFFERENT, previously-run
// live session (e.g. if the user loaded an old session into the Builder
// to recalculate it, per this morning's AMRAP Metabolic test) rather
// than the one currently being calculated. Only trusted if its own
// duration is close to this block's actual duration (blockTimeList[idx],
// already computed from the real result time) — a real match, not a
// coincidence of array position.
function _getBlockWindow(blockIdx, expectedDurationSec) {
  if (!window._blockTimeWindows) return null;
  const win = window._blockTimeWindows.find(w => w.blockIdx === blockIdx);
  if (!win) return null;
  const winDurationSec = (win.endMs - win.startMs) / 1000;
  if (Math.abs(winDurationSec - expectedDurationSec) > 5) return null; // mismatch — stale/unrelated data, don't trust it
  return win;
}

// ══ Step 2: segment-aware overhead + Cardiovascular Endurance ══
// Converts a block's segments (real per-movement HR where captured, or
// the single manual-RPE fallback) into the two block-level numbers the
// rest of the system already expects — blockOverhead (for Metabolic
// Cost) and blockCV (for Cardiovascular Endurance) — so nothing
// downstream (pattern-split attribution, the overhead sum, etc.) needs
// to change at all; this just makes the INPUT to those existing
// consumers more precise when real segment data exists.
//
// Cardio segments (run/row/du/ski) never get anything added here — their
// real pace-derived kcal is already counted via blockCardioKcalTotal,
// passed in separately, added once directly to blockCV. Adding an
// RPE/HR-implied number on top would be exactly the drift-vs-real-effort
// mistake from this morning's Block 3 analysis.
//
// The "mechanical" (or manual_rpe fallback) segment is where HR/RPE
// actually does work: its own relIntensity (from %HRR if real HR
// exists, else from the segment's manual RPE) drives its own
// totalMetEstimate — used directly for blockCV (per the corrected
// Cardiovascular Endurance design: RPE reflects the whole systemic
// experience of a block, not just "extra" beyond mechanical), and
// minus the block's own mechKcal (clamped >=0) for blockOverhead.
function _computeBlockOverheadAndCV(segments, blockMechKcal, blockCardioKcalTotal, bw, vo2max, ageFactor, genderFactor, hrRest, hrMax) {
  let overhead = 0;
  // cv starts at blockCardioKcalTotal ONLY when segments are genuinely
  // split by real time — _buildBlockSegments' "mechanical" segment has
  // cardio-toggle time already subtracted out (mechDurationSec =
  // blockDurationSec - cardioDurationSec), so adding blockCardioKcalTotal
  // separately doesn't double-count anything in that case. But when no
  // real HR exists anywhere in the block, _buildBlockSegments collapses
  // everything into ONE segment spanning the FULL, un-reduced block
  // duration (type:'block', source:'manual_rpe') — same shape as the
  // inline fallback in calculateGlobalPhysics when _getBlockWindow finds
  // no window at all. That single segment's RPE-based estimate already
  // implicitly represents the whole block's effort, run included —
  // starting cv at blockCardioKcalTotal on top of it added the run's
  // kcal a second time. Confirmed by comparing against
  // getSessionCVEndurance's reconstruction for an identical session:
  // reconstruction has no concept of per-segment splitting at all and
  // always computes one whole-block RPE estimate with nothing added on
  // top — which is exactly what this fallback case should have been
  // doing here too.
  const isWholeBlockFallback = segments.length === 1 && segments[0].type === 'block';
  let cv = isWholeBlockFallback ? 0 : blockCardioKcalTotal;
  // Same reasoning applies to overhead, mirroring reconstruction's
  // "blockTotalMetEstimate - blockMechKcal - blockCardioKcal": the real-
  // segmented 'mechanical' segment's duration already excludes cardio
  // time, so subtracting only blockMechKcal is correct there. The
  // whole-block fallback segment spans the full duration, cardio time
  // included, so it needs the same cardio subtraction reconstruction
  // uses — without it, overhead was overstated by roughly the cardio
  // kcal amount whenever a mixed block had no real HR data.
  const overheadCardioSubtraction = isWholeBlockFallback ? blockCardioKcalTotal : 0;
  const cardioTypes = ['run', 'row', 'du', 'ski'];

  segments.forEach(seg => {
    if (cardioTypes.includes(seg.type)) return; // handled via blockCardioKcalTotal above
    let relIntensity = null;
    if (seg.source === 'hr_segment' && hrRest != null && hrMax != null && hrMax > hrRest) {
      relIntensity = Math.max(0, Math.min(1, (seg.avgHR - hrRest) / (hrMax - hrRest)));
    } else if (seg.source === 'manual_rpe' && seg.rpe) {
      relIntensity = Math.min(1.0, seg.rpe / 10);
    } else {
      return; // 'no_hr' (toggled but strap disconnected during it) — no usable signal, contributes nothing rather than guessing
    }
    const met = (relIntensity * vo2max) / 3.5;
    const timeHours = seg.durationSec / 3600;
    const segTotalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
    overhead += Math.max(0, segTotalMetEstimate - blockMechKcal - overheadCardioSubtraction);
    cv += segTotalMetEstimate;
  });

  return { overhead, cv };
}

/* ═══════════════════════════════════════════════════
   CARDIO ENERGY CALCULATOR (MET-based)
   Uses personal cardio PRs to estimate energy cost
   of aerobic locomotion movements.
═══════════════════════════════════════════════════ */
function getCardioEnergy(blocks, bw) {
  const run400  = parseInt(document.getElementById('pr-run400')?.value)||0;
  const run5k   = parseInt(document.getElementById('pr-run5k')?.value)||0;
  const row500  = parseInt(document.getElementById('pr-row500')?.value)||0;
  const row2k   = parseInt(document.getElementById('pr-row2k')?.value)||0;
  const ski500  = parseInt(document.getElementById('pr-ski500')?.value)||0;
  const duRPM   = parseFloat(document.getElementById('pr-du')?.value)||0;
  // Real, live-recorded duration per (block, movement) — same helper
  // used to capture entry.cardioIntervalSummary at save time, called
  // live here since this function runs pre-save. Takes priority over
  // both the Riegel-PR estimate and the single-cardio-block "actual
  // result time" path below, since it's the most granular real data
  // available — captures exactly the toggled-on portion, even within a
  // mixed block where useActualTime's whole-block time wouldn't apply.
  const liveCardioSummary = _buildCardioIntervalSummary();

  // ── Age & gender MET correction factors ──
  const age    = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor    = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const metFactor    = ageFactor * genderFactor;

  // Riegel formula — only use within same energy system
  const riegelSecs = (refSecs, refDist, targetDist) => {
    if (!refSecs || !targetDist) return null;
    return refSecs * Math.pow(targetDist / refDist, 1.06);
  };

  // Estimate run time based on distance — use sprint PR for ≤600m, endurance PR for >600m
  const estimateRunSecs = (distM) => {
    if (distM <= 600) {
      // Anaerobic zone — use 400m PR
      const ref = run400 || 90;
      return riegelSecs(ref, 400, distM) || (distM / 400 * ref);
    } else {
      // Aerobic zone — prefer 5km PR, fall back to scaling 400m with penalty
      if (run5k) {
        return riegelSecs(run5k, 5000, distM) || (distM / 5000 * run5k);
      } else if (run400) {
        // Apply aerobic penalty — assume pace degrades ~35% per energy system crossover
        const sprintPace = run400 / 400; // sec/m
        const aerobicPace = sprintPace * 2.2; // conservative aerobic pace estimate
        return distM * aerobicPace;
      }
      return distM * 0.30; // 5:00/km default
    }
  };

  // Estimate row time — use 500m split for <800m, 2000m PR for >=800m
  const estimateRowSecs = (distM) => {
    if (distM < 800) {
      const ref = row500 || 120;
      return riegelSecs(ref, 500, distM) || (distM / 500 * ref);
    } else {
      if (row2k) {
        return riegelSecs(row2k, 2000, distM) || (distM / 2000 * row2k);
      } else if (row500) {
        const splitPace = row500 / 500;
        const aerobicPace = splitPace * 1.25;
        return distM * aerobicPace;
      }
      return distM * 0.26; // ~2:10/500m default
    }
  };

  let cardioKcal = 0;
  const cardioByBias = { endurance: 0, metabolic: 0 };
  const cardioByBlock = {}; // { [blockIndex]: { ski, bike, du } } — audit trail needs each DU/ski/bike movement's own kcal share, run/row already get theirs from getSessionCardioKcalByBlock()

  blocks.forEach((block, blockIndex) => {
    const mode   = block.querySelector('.b-mode')?.value || 'fortime';
    const rounds = parseInt(block.querySelector('.res-r')?.value) || 1;

    // Check if this is a ForTime block with exactly one cardio movement
    // If so, we can use the actual result time instead of Riegel estimate
    const allMovements = block.querySelectorAll('.movement-block');
    const cardioMovements = [...allMovements].filter(mv => {
      const key = mv.querySelector('input[type="hidden"]')?.value || '';
      return !!(MASTER_DB[key]?.cardio);
    });
    const isSingleCardioForTime = mode === 'fortime'
      && allMovements.length === 1
      && cardioMovements.length === 1;

    // Get actual result time in seconds if available
    const resM = parseInt(block.querySelector('.res-m')?.value) || 0;
    const resS = parseInt(block.querySelector('.res-s')?.value) || 0;
    const actualSecs = resM * 60 + resS;

    block.querySelectorAll('.movement-block').forEach((mv, mvIdx) => {
      const key = mv.querySelector('input[type="hidden"]')?.value || '';
      const p = MASTER_DB[key];
      if (!p || !p.cardio) return;

      const presReps = parseFloat(mv.querySelector('.m-reps')?.value) || 0;
      if (presReps <= 0) return;

      // Use ladder total reps if ladder active (completed rounds only), otherwise base × rounds
      const ladderType2 = block.querySelector('.b-ladder-type')?.value || 'fixed';
      // exmom mode: each "round" is ONE STATION visit, not one full pass
      // through every movement — rounds must be divided by station count,
      // same as the main mechanical-work calculation already does. Without
      // this, cardio distance was computed using the raw round count
      // directly (e.g. 20 rounds instead of the correct 5 station-visits
      // for a 4-station block), producing ~4x too much distance and kcal.
      let effRounds = rounds;
      if (mode === 'exmom') {
        const stationCount = allMovements.length || 1;
        effRounds = Math.floor(rounds / stationCount) + (mvIdx < (rounds % stationCount) ? 1 : 0);
      }
      const totalReps = ladderType2 !== 'fixed'
        ? getLadderTotalReps(block, presReps, effRounds, 0)  // cardio doesn't use extra reps
        : presReps * effRounds;
      const cardioType = p.cardio;
      const ref = p.cardioRef;

      // Use actual time if single cardio ForTime with a valid result
      const useActualTime = isSingleCardioForTime && actualSecs > 0;
      const biasKey = (p.bias === 'endurance' || p.bias === 'metabolic') ? p.bias : null;
      const addKcal = kcal => {
        cardioKcal += kcal;
        if (biasKey) cardioByBias[biasKey] += kcal;
        if (!cardioByBlock[blockIndex]) cardioByBlock[blockIndex] = {};
        cardioByBlock[blockIndex][cardioType] = (cardioByBlock[blockIndex][cardioType] || 0) + kcal;
      };

      // Run and Row are handled separately (see getLiveRunAeroKcal/
      // getSessionRunAeroKcal and getLiveRowAeroKcal/getSessionRowAeroKcal)
      // with pace-derived MET instead of this function's flat-MET formula —
      // deliberately not computed here at all, to avoid double-counting.
      const realSecsLive = liveCardioSummary ? liveCardioSummary[`${blockIndex}_${cardioType}`] : null;
      if (cardioType === 'ski') {
        if (realSecsLive != null) { addKcal(p.met * bw * (realSecsLive / 3600) * metFactor); return; }
        if (!ski500 && !useActualTime) return;
        const distM = totalReps * ref;
        const secs = useActualTime ? actualSecs : riegelSecs(ski500, 500, distM);
        if (!secs) return;
        addKcal(p.met * bw * (secs / 3600) * metFactor);
      } else if (cardioType === 'bike') {
        addKcal(totalReps * ref * metFactor);
      } else if (cardioType === 'du') {
        if (realSecsLive != null) { addKcal(p.met * bw * (realSecsLive / 3600) * metFactor); return; }
        if (!duRPM && !useActualTime) return;
        const secs = useActualTime ? actualSecs : (totalReps * ref / duRPM) * 60;
        if (!secs) return;
        addKcal(p.met * bw * (secs / 3600) * metFactor);
      }
    });
  });

  return { total: Math.round(cardioKcal), byBias: { endurance: Math.round(cardioByBias.endurance), metabolic: Math.round(cardioByBias.metabolic) }, byBlock: cardioByBlock };
}

// Saved-data mirror of getCardioEnergy() — for the migration below, since
// getCardioEnergy() reads live DOM (block.querySelector etc.) and can't
// operate on stored entry.blocks JSON. Includes the same exmom
// station-count fix. Doesn't replicate the "actual ForTime result time"
// path (useActualTime) — historical entries don't reliably carry that
// alongside blocks, and it only applies to single-cardio-movement ForTime
// blocks, not exmom, so it doesn't affect the bug this migration targets.
function reconstructCardioEnergy(entry, bw) {
  const run400 = parseInt(document.getElementById('pr-run400')?.value)||0;
  const run5k  = parseInt(document.getElementById('pr-run5k')?.value)||0;
  const row500 = parseInt(document.getElementById('pr-row500')?.value)||0;
  const row2k  = parseInt(document.getElementById('pr-row2k')?.value)||0;
  const ski500 = parseInt(document.getElementById('pr-ski500')?.value)||0;
  const duRPM  = parseFloat(document.getElementById('pr-du')?.value)||0;
  const age    = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor    = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const metFactor    = ageFactor * genderFactor;
  const riegelSecs = (refSecs, refDist, targetDist) => {
    if (!refSecs || !targetDist) return null;
    return refSecs * Math.pow(targetDist / refDist, 1.06);
  };
  const estimateRunSecs = (distM) => {
    if (distM <= 600) { const ref = run400 || 90; return riegelSecs(ref, 400, distM) || (distM / 400 * ref); }
    if (run5k) return riegelSecs(run5k, 5000, distM) || (distM / 5000 * run5k);
    if (run400) return distM * (run400/400) * 2.2;
    return distM * 0.30;
  };
  const estimateRowSecs = (distM) => {
    if (distM < 800) { const ref = row500 || 120; return riegelSecs(ref, 500, distM) || (distM / 500 * ref); }
    if (row2k) return riegelSecs(row2k, 2000, distM) || (distM / 2000 * row2k);
    if (row500) return distM * (row500/500) * 1.25;
    return distM * 0.26;
  };

  let cardioKcal = 0;
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    const rounds = parseInt(block.result?.r) || 1;
    const movements = block.movements || [];
    movements.forEach((mv, mvIdx) => {
      const p = MASTER_DB[mv.name];
      if (!p || !p.cardio) return;
      const presReps = parseFloat(mv.reps) || 0;
      if (presReps <= 0) return;
      let effRounds = rounds;
      if (mode === 'exmom') {
        const stationCount = movements.length || 1;
        effRounds = Math.floor(rounds / stationCount) + (mvIdx < (rounds % stationCount) ? 1 : 0);
      }
      const totalReps = presReps * effRounds;
      const ref = p.cardioRef;
      // Run and Row are handled separately (see getSessionRunAeroKcal,
      // getSessionRowAeroKcal) with pace-derived MET instead of this
      // function's flat-MET formula — deliberately not computed here at
      // all, to avoid double-counting.
      //
      // Ski/DU: real, live-recorded duration (entry.cardioIntervalSummary,
      // built from the actual cardio toggle presses) takes priority over
      // the Riegel-PR estimate whenever it exists for this exact
      // (block, movement) combination — same real-data-first pattern
      // already applied to Run/Row via getSessionCardioInstances.
      // Older sessions without this field still fall through to the
      // estimate below, same as before.
      const realSecs = entry.cardioIntervalSummary ? entry.cardioIntervalSummary[`${blockIndex}_${p.cardio}`] : null;
      if (p.cardio === 'ski') {
        if (realSecs != null) { cardioKcal += p.met * bw * (realSecs / 3600) * metFactor; return; }
        if (!ski500) return;
        const distM = totalReps * ref;
        const secs = riegelSecs(ski500, 500, distM);
        if (secs) cardioKcal += p.met * bw * (secs / 3600) * metFactor;
      } else if (p.cardio === 'bike') {
        cardioKcal += totalReps * ref * metFactor;
      } else if (p.cardio === 'du') {
        if (realSecs != null) { cardioKcal += p.met * bw * (realSecs / 3600) * metFactor; return; }
        if (!duRPM) return;
        const secs = (totalReps * ref / duRPM) * 60;
        if (secs) cardioKcal += p.met * bw * (secs / 3600) * metFactor;
      }
    });
  });
  return Math.round(cardioKcal);
}

function getPersonalBands(metric) {
  const hist = getHistory();
  let vals;
  if (metric === 'totalpower') {
    // Not a stored field — compute Total Power per session on demand,
    // consistent with how it's displayed everywhere else.
    vals = hist.map(w => { const p = getSessionPower(w); return p ? p.total : NaN; }).filter(v => !isNaN(v) && v > 0);
  } else if (metric === 'cvintensity') {
    // Also not a stored field — same on-demand pattern as totalpower.
    vals = hist.map(w => { const cv = getSessionCVEndurance(w); return cv ? cv.met : NaN; }).filter(v => !isNaN(v) && v > 0);
  } else {
    vals = hist.map(w => parseFloat(w[metric])).filter(v => !isNaN(v) && v > 0);
  }
  if (vals.length < BM_PERSONAL_MIN) return null; // not enough data
  vals.sort((a, b) => a - b);
  const pct = (p) => {
    const idx = (p / 100) * (vals.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
  };
  const p25 = pct(25), p50 = pct(50), p75 = pct(75), p100 = vals[vals.length - 1];
  return {
    beginner:     [0,    p25],
    intermediate: [p25,  p50],
    advanced:     [p50,  p75],
    elite:        [p75,  p100 * 1.0],
    max:          p100, // personal best = full scale; chart rescales as new maxes are set. NOTE: also read by getRadarMaxes() for the session radar's own axis normalization — any change here affects that too, not just this bar's tick mark.
    _personal:    true,
    _n:           vals.length,
    _max:         p100,
    // Separate, ADDITIVE field — 15% headroom above the personal best,
    // used only by renderBMBar's tier-clamping and tick positioning
    // (see there for why). Deliberately not reusing max/_max, since
    // those are also read by getRadarMaxes() for the radar's own axis
    // scaling — this field exists purely so that consumer is
    // guaranteed untouched by anything done here.
    _headroomMax: p100 * 1.15
  };
}

function getEffectiveBands(metric) {
  // Use personal percentile bands for pd, wd, mc, fb, totalpower
  // Keep fixed bands for rl, td (already normalised scales)
  if (['pd','wd','mc','fb','totalpower','cvintensity'].includes(metric)) {
    const personal = getPersonalBands(metric);
    if (personal) return personal;
  }
  return BM_BANDS[metric];
}

const BM_BANDS = {
  // ── Total Power (W/kg) — mechanical + aerobic + overhead ──
  // Approximate fallback only; personal bands (see getPersonalBands) are
  // preferred once enough history exists. Rescaled from the old
  // mechanical-only pd bands based on real Total Power values observed
  // across genuinely mixed sessions (roughly 2-12 W/kg in practice).
  // totalpower is an alias for the same mechanical-only Power value as
  // pd (confirmed: resPD's live formula (tw*1000)/tas/bw exactly
  // matches pd's own documented formula, and getSessionPower's .total
  // is confirmed to be "true mechanical Power" too, not a broader
  // total including aerobic/overhead despite the key's name) — so it
  // uses the SAME thresholds as pd, not a separate, much-higher scale.
  // Kept as a distinct alias key (not merged into pd) since it's
  // referenced from several call sites tonight (radar maxes, this
  // card) that would need updating otherwise — fixing this definition
  // is the safer, more surgical correction.
  totalpower: {
    beginner:     [0,    0.5],
    intermediate: [0.5,  1.0],
    advanced:     [1.0,  2.0],
    elite:        [2.0,  3.0],
    max: 3.5
  },
  // ── Intensity pd (W/kg) ──
  // Formula: (tw*1000) / tas / bw with (h/1.75) height scaling
  // At 175cm/75kg reference: DT 5rds ~0.8, Fran sub-3min ~2.0, Grace sprint ~2.5+
  // Low <0.5, Moderate 0.5–1.0, High 1.0–2.0, Very High 2.0–3.0, Elite >3.0
  pd: {
    beginner:     [0,    0.5],
    intermediate: [0.5,  1.0],
    advanced:     [1.0,  2.0],
    elite:        [2.0,  3.0],
    max: 3.5
  },
  // ── Total Work wd (kJ) ──
  // Formula: tw with (h/1.75) height scaling
  // At 175cm/75kg reference: DT 5rds ~35kJ, Fran ~15kJ, Murph ~80kJ
  // Light <20kJ, Moderate 20–50kJ, High 50–100kJ, Very High >100kJ
  wd: {
    beginner:     [0,    20],
    intermediate: [20,   50],
    advanced:     [50,   100],
    elite:        [100,  200],
    max: 200
  },
  // ── Metabolic Cost mc (kcal) ──
  // Formula: (tw/4.184)/0.22
  // Realistic range: 0 – ~280 typical (Murph is outlier at 280)
  // Grace 38, Fran 47, DT 60, Murph 280
  // Most WODs fall 20–150. Quartile of 0–200
  mc: {
    beginner:     [0,    50],
    intermediate: [50,   100],
    advanced:     [100,  150],
    elite:        [150,  200],
    max: 200
  },
  // ── Force Bias fb (kg·reps / kJ) ──
  // Formula: tt / tw  where tt = sum(wt*reps), tw = total work kJ
  // Pure bodyweight = 0. Heavy barbell WODs = 40–175
  // This is a TYPE indicator not a performance level —
  // use different labels: Metabolic / Mixed / Strength / Max Strength
  // Quartile of 0–200
  fb: {
    beginner:     [0,    25],
    intermediate: [25,   75],
    advanced:     [75,   125],
    elite:        [125,  200],
    max: 200
  },
  // ── Relative Loading rl (% 1RM) ──
  // Fixed scale 0–100% — quartile split makes sense here
  rl: {
    beginner:     [0,    40],
    intermediate: [40,   65],
    advanced:     [65,   82],
    elite:        [82,   100],
    max: 100
  },
  // ── Technical Demand td (1–5) ──
  // Fixed scale — keep equal quartiles
  td: {
    beginner:     [1,    2],
    intermediate: [2,    3],
    advanced:     [3,    4],
    elite:        [4,    5],
    max: 5
  },
  // ── Cardio Intensity (MET) ── Same 3-12 realistic CrossFit range
  // already established for the fbduration chart's gradient and the
  // session radar's cvIntensity axis max, kept consistent here too.
  cvintensity: {
    beginner:     [0,   5],
    intermediate: [5,   7],
    advanced:     [7,   9],
    elite:        [9,   12],
    max: 12
  }
};

// Colours — same for all metrics except fb which uses stimulus labels
const BM_COLORS = {
  beginner:     { bg: '#9CA3AF22', bar: '#9CA3AF', text: '#9CA3AF' },
  intermediate: { bg: '#22C55E22', bar: '#22C55E', text: '#22C55E' },
  advanced:     { bg: '#F59E0B22', bar: '#F59E0B', text: '#F59E0B' },
  elite:        { bg: '#EF444422', bar: '#EF4444', text: '#EF4444' }
};

// Labels — fb uses stimulus type, others use intensity level
function getBMLevelLabels() { return {
  pd: { beginner:t('bm.low'), intermediate:t('bm.moderate'), advanced:t('bm.high'), elite:t('bm.very.high') },
  totalpower: { beginner:t('bm.low'), intermediate:t('bm.moderate'), advanced:t('bm.high'), elite:t('bm.very.high') },
  cvintensity: { beginner:t('bm.low'), intermediate:t('bm.moderate'), advanced:t('bm.high'), elite:t('bm.very.high') },
  wd: { beginner:t('bm.low'), intermediate:t('bm.moderate'), advanced:t('bm.high'), elite:t('bm.very.high') },
  mc: { beginner:t('bm.light'), intermediate:t('bm.moderate'), advanced:t('bm.high'), elite:t('bm.very.high') },
  fb: { beginner:t('bm.metabolic'), intermediate:t('bm.mixed'), advanced:t('bm.strength'), elite:t('bm.max.strength') },
  rl: { beginner:t('bm.light'), intermediate:t('bm.moderate'), advanced:t('bm.heavy'), elite:t('bm.near.max') },
  td: { beginner:t('bm.basic'), intermediate:t('bm.moderate'), advanced:t('bm.advanced'), elite:t('bm.elite') }
}; }

function getBMLevel(metric, value) {
  const bands = getEffectiveBands(metric); if (!bands) return null;
  const levels = ['elite', 'advanced', 'intermediate', 'beginner'];
  for (const lvl of levels) {
    if (value >= bands[lvl][0]) return lvl;
  }
  return 'beginner';
}

function getBMContext(metric, value, exp, goal) {
  const level = getBMLevel(metric, value);
  if (!level) return '';
  const contexts = {
    totalpower: {beginner:t('bm.pd.low'),intermediate:t('bm.pd.mod'),advanced:t('bm.pd.high'),elite:t('bm.pd.elite')},
    pd: {beginner:t('bm.pd.low'),intermediate:t('bm.pd.mod'),advanced:t('bm.pd.high'),elite:t('bm.pd.elite')},
    wd: {beginner:t('bm.wd.low'),intermediate:t('bm.wd.mod'),advanced:t('bm.wd.high'),elite:t('bm.wd.elite')},
    mc: {beginner:t('bm.mc.low'),intermediate:t('bm.mc.mod'),advanced:t('bm.mc.high'),elite:t('bm.mc.elite')},
    fb: {beginner:t('bm.fb.low'),intermediate:t('bm.fb.mod'),advanced:t('bm.fb.high'),elite:t('bm.fb.elite')},
    rl: {beginner:t('bm.rl.low'),intermediate:t('bm.rl.mod'),advanced:t('bm.rl.high'),elite:t('bm.rl.elite')},
    td: {beginner:t('bm.td.low'),intermediate:t('bm.td.mod'),advanced:t('bm.td.high'),elite:t('bm.td.elite')}
  };
  return contexts[metric]?.[level] || '';
}

function renderBMBar(containerId, metric, value, exp) {
  const container = document.getElementById(containerId);
  if (!container || value === null || value === undefined || isNaN(value)) return;
  const bands = getEffectiveBands(metric); if (!bands) return;
  const level  = getBMLevel(metric, value);
  const colors = BM_COLORS[level];
  // Equal-width tier positioning — each of the 4 tiers (beginner,
  // intermediate, advanced, elite) gets a fixed 25% slice of the bar,
  // regardless of how wide that tier's own raw-value range is. The
  // value's position WITHIN its own tier determines where it lands
  // inside that slice. This is what keeps the bar visually consistent
  // with the percentile-based band system — bands are already designed
  // as roughly equal-population buckets, not equal-value-range ones —
  // and makes the Low/Mid/High labels meaningful: Mid now sits exactly
  // on the intermediate/advanced boundary, not an arbitrary raw value.
  const TIER_ORDER = ['beginner', 'intermediate', 'advanced', 'elite'];
  const tierIdx = TIER_ORDER.indexOf(level);
  const isPersonal = bands._personal;
  // Elite's upper bound gets headroom (bands._headroomMax) instead of
  // the hard personal-best cap (bands.elite[1] === bands._max) when
  // personal bands are active — without this, a genuine new PR would
  // be clamped to the exact same position as the previous best (tierFrac
  // hitting its ceiling of 1), unable to visually show "you beat your
  // own record." This only affects the elite tier's own slice — the
  // other three tiers are unaffected, and non-personal (fixed) bands
  // are untouched entirely.
  const [tMin, tMaxRaw] = bands[level];
  const tMax = (isPersonal && level === 'elite' && bands._headroomMax) ? bands._headroomMax : tMaxRaw;
  const tierFrac = tMax !== tMin ? Math.max(0, Math.min(1, (value - tMin) / (tMax - tMin))) : 0.5;
  const pct = Math.min(100, Math.max(2, tierIdx * 25 + tierFrac * 25));
  const label  = getBMLevelLabels()[metric]?.[level] || level;
  const personalNote = isPersonal
    ? `<span style="font-size:.58rem;color:var(--label);margin-left:4px;">${t('analytics.based.on').replace('{n}', bands._n)}</span>`
    : `<span style="font-size:.58rem;color:var(--label);margin-left:4px;">${t('analytics.fixed.scale')}</span>`;

  // Personal-best tick mark — positioned using the exact SAME
  // tier-positioning formula as the main marker above, just evaluated
  // at the personal best (bands._max) instead of today's value. This is
  // what makes the two markers meaningfully comparable on one shared
  // scale: the personal best always sits within the elite tier's own
  // (headroom-extended) slice, at whatever fraction of that slice it
  // actually represents — and if today's value exceeds it, the main
  // marker visibly lands further along that same slice than the tick,
  // rather than both being stuck at an identical, uninformative spot.
  let maxPct = null;
  if (isPersonal && bands._headroomMax) {
    const eliteMin = bands.elite[0];
    const eliteMax = bands._headroomMax;
    const tickFrac = eliteMax !== eliteMin ? Math.max(0, Math.min(1, (bands._max - eliteMin) / (eliteMax - eliteMin))) : 0.5;
    maxPct = Math.min(98, 3 * 25 + tickFrac * 25); // elite is always TIER_ORDER index 3
  }
  const maxTick = maxPct !== null
    ? `<div class="bm-bar-max-tick" style="left:${maxPct}%" title="Your personal best"></div>`
    : '';

  container.innerHTML = `
    <div class="bm-bar-track">
      <div class="bm-bar-fill"  style="width:${pct}%;background:${colors.bar};opacity:.35;"></div>
      <div class="bm-bar-marker" style="left:${pct}%;background:${colors.bar};"></div>
      ${maxTick}
    </div>
    <div class="bm-bar-labels">
      <span>Low</span><span>Mid</span><span>High</span>
    </div>
    <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
      <span class="bm-level-badge" style="background:${colors.bg};color:${colors.text};">${label}</span>
      ${personalNote}
    </div>`;
}

function renderAllBMBars() {
  if (!hasEnoughHistory()) {
    // Clear all benchmark bars and show nothing (no misleading fixed ranges)
    ['bm-pd','bm-wd','bm-mc','bm-fb','bm-rl','bm-aeropd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    // Hide radar card — replace with progress message
    const radarCard = document.getElementById('radar-card');
    if (radarCard) {
      radarCard.style.display = '';
      const canvas = document.getElementById('radarChart');
      if (canvas) canvas.style.display = 'none';
      let msg = radarCard.querySelector('.radar-progress-msg');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'radar-progress-msg';
        msg.style.cssText = 'text-align:center;width:100%;';
        radarCard.appendChild(msg);
      }
      msg.innerHTML = historyProgressMsg();
    }
    return;
  }
  // Enough history — restore radar canvas if hidden
  const canvas = document.getElementById('radarChart');
  if (canvas) { canvas.style.display = ''; canvas.style.margin = '0 auto'; }
  const msg = document.getElementById('radar-card')?.querySelector('.radar-progress-msg');
  if (msg) msg.innerHTML = '';
  const exp  = document.getElementById('global-exp')?.value  || 'intermediate';
  const goal = document.getElementById('global-goal')?.value || 'conditioning';
  const pd = parseFloat(document.getElementById('resPD')?.innerText);
  const wd = parseFloat(document.getElementById('resWD')?.innerText);
  const mc = parseFloat(document.getElementById('resMC')?.innerText);
  const fb = parseFloat(document.getElementById('resFB')?.innerText);
  const rl = parseFloat(document.getElementById('resRL')?.innerText);
  const td = parseFloat(document.getElementById('resTD')?.innerText);
  renderBMBar('bm-pd', 'totalpower', pd, exp);
  renderBMBar('bm-wd', 'wd', wd, exp);
  renderBMBar('bm-mc', 'mc', mc, exp);
  renderBMBar('bm-fb', 'fb', fb, exp);
  if (!isNaN(rl)) renderBMBar('bm-rl', 'rl', rl, exp);
  const tdForRadar = isNaN(td) ? 0 : td;
  const cvIntensity = window._lastCVEndurance ? window._lastCVEndurance.met : 0;
  if (cvIntensity > 0) renderBMBar('bm-aeropd', 'cvintensity', cvIntensity, exp);
  const internalLoad = window._lastCVEndurance ? window._lastCVEndurance.metMinutes : 0;
  renderRadarChart(pd, wd, cvIntensity, fb, internalLoad, tdForRadar);
  window._lastRadarRaw = { pd, wd, cvIntensity, fb, internalLoad, td: tdForRadar };
}

function getTDLabel(score) {
  if (score >= 4.5) return { label: t('cx.elite'),    color: '#EF4444' };
  if (score >= 3.5) return { label: t('cx.advanced'), color: '#F59E0B' };
  if (score >= 2.5) return { label: t('cx.moderate'), color: '#3B82F6' };
  if (score >= 1.5) return { label: t('cx.basic'),    color: '#22C55E' };
  return { label: t('cx.beginner'),  color: '#9CA3AF' };
}

const RM_MAP = {
  // Squat variants → Back Squat (barbell only — Goblet Squat, Bulgarian
  // Split Squat, Pistol Squat, Wall Ball Shot, and unqualified Lunge/Walking
  // Lunge removed since they're not barbell movements; comparing their load
  // against a barbell 1RM produces a misleadingly low percentage that isn't
  // measuring the same thing as an actual barbell RL)
  'Back Squat':              'pr-bsq',
  'Front Squat':             'pr-bsq',
  'Overhead Squat':          'pr-bsq',
  'Zercher Squat':           'pr-bsq',
  'Box Squat':               'pr-bsq',
  'Barbell Lunge':           'pr-bsq',
  // Deadlift variants → Deadlift (barbell/hex-bar only — Kettlebell
  // Deadlift, Dumbbell Deadlift, and Single Leg RDL removed)
  'Deadlift':                'pr-dl',
  'Romanian Deadlift':       'pr-dl',
  'Sumo Deadlift':           'pr-dl',
  'Hex Bar Deadlift':        'pr-dl',
  'Good Morning':            'pr-dl',
  'Sumo Deadlift High Pull': 'pr-dl',
  // Clean & Jerk variants → Clean & Jerk (barbell only — Dumbbell/Kettlebell
  // Thruster and Dumbbell/Kettlebell Clean removed)
  'Clean':                   'pr-cnj',
  'Clean and Jerk':          'pr-cnj',
  'Power Clean':             'pr-cnj',
  'Hang Power Clean':        'pr-cnj',
  'Hang Clean':              'pr-cnj',
  'Squat Clean':             'pr-cnj',
  'Push Jerk':               'pr-cnj',
  'Split Jerk':              'pr-cnj',
  'Push Press':              'pr-cnj',
  'Thruster':                'pr-cnj',
  // Snatch variants → Snatch (barbell only — Dumbbell Power Snatch and
  // Kettlebell Snatch removed)
  'Snatch':                  'pr-snatch',
  'Power Snatch':            'pr-snatch',
  'Hang Power Snatch':       'pr-snatch',
  'Hang Snatch':             'pr-snatch',
  'Squat Snatch':            'pr-snatch',
  'Muscle Snatch':           'pr-snatch',
  // Press variants → Strict Press (barbell only — Dumbbell Press and
  // Kettlebell Press removed)
  'Shoulder Press':          'pr-press',
  'Strict Press':            'pr-press',
  // Bench Press variants → Bench Press (barbell only — Dumbbell Bench Press
  // removed)
  'Bench Press':             'pr-bench',
  'Close Grip Bench Press':  'pr-bench',
};

// Short reference labels shown alongside % to clarify which lift is the reference
const RM_REF_LABEL = {
  'pr-bsq':   'BSQ',
  'pr-dl':    'DL',
  'pr-cnj':   'C&J',
  'pr-snatch':'SN',
  'pr-press': 'PRE',
  'pr-bench': 'BP',
};

// Correlation factors for movements mapped to a different lift's 1RM.
// Applied as a multiplier on the reference 1RM to estimate the movement's
// own effective 1RM, based on established strength-training ratios.
const RM_CORRELATION = {
  'Front Squat':           0.85,  // ~85% of Back Squat
  'Overhead Squat':        0.65,  // ~65% of Back Squat
  'Zercher Squat':         0.68,  // ~80% of Front Squat ≈ 0.80 × 0.85 of Back Squat
  'Bulgarian Split Squat': 0.45,  // ~45% of Back Squat (unilateral)
  'Barbell Lunge':         0.45,  // ~45% of Back Squat (unilateral)
  'Romanian Deadlift':     0.75,  // ~75% of Deadlift
  'Single Leg RDL':        0.40,  // ~40% of Deadlift (unilateral)
};

// Movements excluded from Builder weight suggestions — implement-limited
// (DB/KB), bodyweight/accessory, or conditioning-context movements where a
// %1RM-based suggestion doesn't apply. RL mapping for neural recovery is
// unaffected — these movements still reference their mapped 1RM for RL%.
const SUGGESTION_EXCLUDED = new Set([
  'Goblet Squat', 'Pistol Squat',
  'Thruster', 'Dumbbell Thruster', 'Kettlebell Thruster',
  'Wall Ball Shot', 'Lunge', 'Walking Lunge',
  'Sumo Deadlift High Pull', 'Kettlebell Deadlift', 'Dumbbell Deadlift',
  'Dumbbell Clean', 'Kettlebell Clean',
  'Dumbbell Power Snatch', 'Kettlebell Snatch',
  'Dumbbell Press', 'Kettlebell Press',
  'Dumbbell Bench Press',
]);

// Returns the effective 1RM (kg) for a movement, applying any correlation
// factor on top of the stored reference 1RM (e.g. Back Squat for Front Squat).
function getEffective1RM(movName, refOneRM) {
  const factor = RM_CORRELATION[movName] || 1;
  return refOneRM * factor;
}

function get1RMPercent(movName, weightKg) {
  // First check hardcoded RM_MAP, then fall back to MASTER_DB rm field
  let prId = RM_MAP[movName];
  if (!prId) {
    const rmCode = MASTER_DB[movName]?.rm;
    const codeMap = { BSQ:'pr-bsq', DL:'pr-dl', 'C&J':'pr-cnj', SN:'pr-snatch', PRE:'pr-press', BP:'pr-bench' };
    if (rmCode) prId = codeMap[rmCode];
  }
  if (!prId) return null;
  const rm = parseFloat(document.getElementById(prId)?.value);
  if (!rm || rm <= 0 || !weightKg || weightKg <= 0) return null;
  return Math.round((weightKg / rm) * 100);
}

function get1RMRefLabel(movName) {
  let prId = RM_MAP[movName];
  if (!prId) {
    const rmCode = MASTER_DB[movName]?.rm;
    const codeMap = { BSQ:'pr-bsq', DL:'pr-dl', 'C&J':'pr-cnj', SN:'pr-snatch', PRE:'pr-press', BP:'pr-bench' };
    if (rmCode) prId = codeMap[rmCode];
  }
  return prId ? RM_REF_LABEL[prId] || '1RM' : '1RM';
}

// Label used in Builder weight suggestions only — for movements with a
// correlation factor, indicates the % is relative to an estimated
// movement-specific 1RM rather than the reference lift's 1RM directly.
function getSuggestionRefLabel(movName) {
  const CORRELATION_ABBR = {
    'Front Squat': 'FS', 'Overhead Squat': 'OHS',
    'Zercher Squat': 'ZS', 'Bulgarian Split Squat': 'BSS',
    'Romanian Deadlift': 'RDL', 'Single Leg RDL': 'SLRDL',
  };
  if (RM_CORRELATION[movName]) return 'est. ' + (CORRELATION_ABBR[movName] || movName) + ' 1RM';
  return get1RMRefLabel(movName);
}

function get1RMLabel(movName, weightKg) {
  const pct = get1RMPercent(movName, weightKg);
  if (pct === null) return '';
  const ref = get1RMRefLabel(movName);
  const color = pct >= 90 ? '#EF4444' : pct >= 75 ? '#F59E0B' : pct >= 50 ? '#22C55E' : '#9CA3AF';
  return ` <span style="font-size:.68rem;font-weight:800;color:${color};margin-left:4px;">${pct}% ${ref}</span>`;
}

/* ════════════════════════════════════════════════════
   SUGGESTED WEIGHT
   Returns {low, high, label} based on goal + TSB,
   or null if no 1RM is set for this movement.
════════════════════════════════════════════════════ */
function getSuggestedWeight(movName) {
  if (SUGGESTION_EXCLUDED.has(movName)) return null;
  const prId = RM_MAP[movName];
  if (!prId) return null;
  const refRm = parseFloat(document.getElementById(prId)?.value);
  const rm = refRm ? getEffective1RM(movName, refRm) : refRm;
  if (!rm || rm <= 0) return null;

  const goal = document.getElementById('global-goal')?.value || 'conditioning';

  // Base % ranges by goal
  const goalRanges = {
    conditioning:  [0.50, 0.65],
    strength:      [0.80, 0.90],
    allround:      [0.50, 0.65],
    weightloss:    [0.45, 0.60],
    endurance:     [0.40, 0.55],
    competition:   [0.70, 0.85],
    rehab:         [0.30, 0.50],
  };

  let [lo, hi] = goalRanges[goal] || goalRanges.conditioning;

  // Adjust for current Form (TSB) if Training Load data exists
  const hist = getHistory();
  if (hist.length >= 1) {
    const { calcTrainingLoad } = window; // available globally
    try {
      const tl = calcTrainingLoad(hist);
      if (tl) {
        if (tl.tsb > 1.4) { lo -= 0.05; hi -= 0.05; }       // fatigued/overreaching — go lighter
        else if (tl.tsb < 0.8) { lo += 0.03; hi += 0.03; }  // peaking/fresh — can push a bit more
      }
    } catch(e) {}
  }

  // Clamp
  lo = Math.max(0.25, lo); hi = Math.min(1.0, hi);

  const lowKg  = Math.round(rm * lo / 2.5) * 2.5;   // round to nearest 2.5kg
  const highKg = Math.round(rm * hi / 2.5) * 2.5;
  // Suggestion-specific label (handles correlation-factor movements)
  const ref = getSuggestionRefLabel(movName);

  const goalLabels = {
    conditioning:'Conditioning', strength:'Strength',
    weightloss:'Fat Loss', endurance:'Endurance',
    competition:'Competition', rehab:'Rehab'
  };

  return {
    low: lowKg, high: highKg, ref,
    pctLow: Math.round(lo*100), pctHigh: Math.round(hi*100),
    goal: goalLabels[goal] || goal
  };
}

function makeSuggestionHTML(movName) {
  const s = getSuggestedWeight(movName);
  if (!s) return '';
  return `<div style="margin-top:8px;padding:8px 10px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;font-size:.72rem;line-height:1.5;">
    <span style="font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);">Suggested for ${s.goal}</span><br>
    <span style="font-weight:800;color:var(--text);">${s.low}–${s.high} kg</span>
    <span style="color:var(--label);"> &middot; ${s.pctLow}–${s.pctHigh}% ${s.ref}</span>
    ${s.low > 0 ? '<span style="font-size:.62rem;color:var(--label);display:block;margin-top:2px;">Based on your 1RM — adjust for today’s feel.</span>' : ''}
  </div>`;
}

// Helper: returns local date string YYYY-MM-DD avoiding UTC offset issues
function localDateStr(date) {
  const d = date || new Date();
  const dd = typeof d === 'string' ? new Date(d) : d;
  return dd.getFullYear() + '-' +
    String(dd.getMonth()+1).padStart(2,'0') + '-' +
    String(dd.getDate()).padStart(2,'0');
}

window._lastMechKcal = null;
window._lastCardioKcal = null;
window._lastOverheadKcal = null;

function calculateGlobalPhysics() {
  // RPE is required, same as rounds/reps/duration — Overhead is now driven
  // directly by it, so a session calculated without a deliberately-set RPE
  // would silently produce a wrong Overhead using whatever the slider's
  // default happens to be, with no visible sign anything was skipped.
  const blockRpeEls = document.querySelectorAll('[id^="result-rpe-slider-"]');
  const untouchedRpeEl = Array.from(blockRpeEls).find(el => el.dataset.touched !== 'true');
  if (blockRpeEls.length && untouchedRpeEl) {
    untouchedRpeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    untouchedRpeEl.style.outline = '2px solid #e34948';
    untouchedRpeEl.style.borderRadius = '4px';
    const idx = untouchedRpeEl.id.replace('result-rpe-slider-', '');
    const rpeLabelEl = document.getElementById('result-rpe-label-' + idx);
    if (rpeLabelEl) { rpeLabelEl.innerText = t('result.rpe.required'); rpeLabelEl.style.color = '#e34948'; }
    showToast('⚠️ ' + t('toast.rpe.required'));
    setTimeout(() => { untouchedRpeEl.style.outline = ''; }, 2500);
    return;
  }
  // Sync result values from analytics results section into hidden blocks
  // This ensures values entered in the UI are available for physics calculation
  const analyticsBody = document.getElementById('analytics_results_body');
  if (analyticsBody) {
    const blockWrappers = analyticsBody.querySelectorAll(':scope > div[style*="margin-bottom"]');
    const hiddenBlocks = document.querySelectorAll('.wod-block');
    blockWrappers.forEach((wrap, i) => {
      const block = hiddenBlocks[i];
      if (!block) return;
      ['res-r','res-x','res-emom','res-m','res-s'].forEach(cls => {
        const displayed = wrap.querySelector('.' + cls);
        const hidden = block.querySelector('.' + cls);
        if (displayed && hidden) hidden.value = displayed.value;
      });
    });
  }
  const bw = parseFloat(document.getElementById('global-w').value);
  const h  = parseFloat(document.getElementById('global-h').value) / 100;
  let tw = 0, tt = 0, tas = 0, ah = '', twMechCost = 0;
  const blockMechCost = []; // per-block mechanical-work-kcal-equivalent — Phase 2's per-block overhead needs this alongside the existing session-wide twMechCost total
  let rpeWeightedSum = 0, rpeWeightTotal = 0; // for duration-weighted session RPE — see window._lastComputedRPE below
  const blockRpeList = []; // per-block RPE values, in block order
  const blockTimeList = []; // per-block duration in seconds, in block order — Phase 2's per-block overhead formula needs each block's own time alongside its own RPE
  let loadedWorkKJ = 0, unloadedWorkKJ = 0; // for Bodyweight Work % — split by whether the movement carries any external weight
  let rmMax = 0; // for Relative Loading metric — peak RL not average
  let rmMaxMovement = null; // which movement actually drove rmMax — RL isn't always Back Squat, it's whichever movement had the session's heaviest %1RM effort
  let tdTotal = 0, tdReps = 0;  // for Technical Demand metric

  // Actual rest between blocks from results window (falls back to builder value)
  const allBlocks = document.querySelectorAll('.wod-block');
  const restInp = document.querySelector('.res-rest-card .res-rest');
  const actualRestSec = restInp ? (parseInt(restInp.value) || 0) : (parseInt(document.getElementById('rest-duration-sec')?.value) || 0);
  const totalRestSec = (window._timerRestCompleted && window._actualRestUsed > 0)
    ? window._actualRestUsed
    : (allBlocks.length > 1 ? actualRestSec * (allBlocks.length - 1) : 0);

  // Moved earlier (was computed after this loop) so the audit trail below
  // can show each cardio movement's real share of mc_aero instead of the
  // generic mechanical-work figure that never actually counts toward
  // anything for cardio movements — see the DU/Run/Row audit-trail fix.
  const bwVal = parseFloat(document.getElementById('global-w')?.value) || 75;
  const cardioResult = getCardioEnergy(document.querySelectorAll('.wod-block'), bwVal);
  const liveCardioByBlock = getLiveCardioKcalByBlock();

  document.querySelectorAll('.wod-block').forEach((block, idx) => {
    const mode = block.querySelector('.b-mode').value;
    let bM = 0, bS = 0;

    // Time: ForTime uses result fields; others use config (fixed duration)
    if (mode === 'fortime') {
      bM = parseFloat(block.querySelector('.res-m').value) || 0;
      bS = parseFloat(block.querySelector('.res-s').value) || 0;
    } else if (mode === 'amrap') {
      bM = parseFloat(block.querySelector('.b-dur').value) || 0;
    } else if (mode === 'emom' || mode === 'exmom') {
      // Read res-m/res-s directly, the same way fortime mode already
      // does — no separate "was this genuinely set" check needed, since
      // autoPopulateResultTime() already guarantees these fields hold
      // either the real, actual time (Timer-tracked or manually entered
      // via the results accordion) or the same planned config value my
      // fallback would compute anyway. This replaces an earlier version
      // that checked a dataset.userSet flag instead — that flag is set
      // and read through several layers of indirection (the results
      // accordion clones these fields and re-wires its own picker
      // callback to update the originals), and in practice the flag
      // wasn't reliably reflecting genuinely-entered times across that
      // chain. Reading the fields directly sidesteps the fragility
      // entirely. The zero/zero fallback below only matters for the
      // narrow case where a block was just created and
      // autoPopulateResultTime() genuinely hasn't run for it yet.
      const resMEl = block.querySelector('.res-m');
      const resSEl = block.querySelector('.res-s');
      const rM = parseFloat(resMEl?.value) || 0;
      const rS = parseFloat(resSEl?.value) || 0;
      if (rM > 0 || rS > 0) {
        bM = rM; bS = rS;
      } else {
        const ts = (parseInt(block.querySelector('.b-int').value) || 60) * (parseInt(block.querySelector('.b-total-int').value) || 1);
        bM = Math.floor(ts / 60); bS = ts % 60;
      }
    } else if (mode === 'tabata') {
      const r = parseInt(block.querySelector('.b-tab-r').value) || 8;
      const ts = r * ((parseInt(block.querySelector('.b-work').value) || 20) + (parseInt(block.querySelector('.b-rest').value) || 10));
      bM = Math.floor(ts / 60); bS = ts % 60;
    }

    tas += (bM * 60) + bS;
    // Per-block RPE — weighted by this block's own time, same value tas
    // just accumulated, so a long easy block and a short brutal block
    // don't count equally toward the session-wide average. Unrated
    // blocks (shouldn't happen — the gate above requires every block's
    // slider be touched — but defensive here) fall back to 5 rather than
    // silently dropping out of the weighting.
    const blockTimeSec = (bM * 60) + bS;
    const blockRpeEl = document.getElementById('result-rpe-slider-' + idx);
    const blockRpe = blockRpeEl ? (parseFloat(blockRpeEl.value) || 5) : 5;
    rpeWeightedSum += blockRpe * blockTimeSec;
    rpeWeightTotal += blockTimeSec;
    blockRpeList[idx] = blockRpe;
    blockTimeList[idx] = blockTimeSec;
    const r = parseFloat(block.querySelector('.res-r').value) || 0;
    const x = parseFloat(block.querySelector('.res-x').value) || 0;
    ah += `<div class="audit-item">
      <div style="font-size:.78rem;font-weight:800;color:var(--brand);margin-bottom:4px;">${t('builder.block.n')} ${idx+1} (${mode.toUpperCase()}) · ${t('audit.time')}: ${String(bM).padStart(2,'0')}:${String(bS).padStart(2,'0')} · ${t('audit.result')}: ${r}${t('audit.rounds').charAt(0).toUpperCase()} + ${x}${t('audit.extra').charAt(0).toUpperCase()}</div>`;

    // If both rounds and extra reps are zero — no work done, skip calculation
    const isMaxReps = block.dataset.maxReps === '1';
    if (!isMaxReps && r === 0 && x === 0) {
      ah += `<div style="font-size:.74rem;color:var(--label);font-style:italic;padding:4px 0;">${t('audit.no.result')}</div></div>`;
      return;
    }
    let mvData = {};
    if (isMaxReps) {
      try { mvData = JSON.parse(block.querySelector('.res-mv-data')?.value || '{}'); } catch(e) {}
    }
    let ep = x;
    let mvIdx = 0;
    // Counts, not amounts — used below to split a per-block-per-cardioType
    // kcal total evenly across the rare case of two movements sharing the
    // same cardio type in one block (e.g. two separate DU stations).
    // Normally 1, so this is a no-op division in the common case.
    const cardioTypeCounts = {};
    block.querySelectorAll('.movement-block').forEach(mv => {
      const k = mv.querySelector('input[type="hidden"]')?.value;
      const pp = k ? MASTER_DB[k] : null;
      if (pp?.cardio) cardioTypeCounts[pp.cardio] = (cardioTypeCounts[pp.cardio] || 0) + 1;
    });
    block.querySelectorAll('.movement-block').forEach(move => {
      const key = move.querySelector('input[type="hidden"]').value;
      if (!MASTER_DB[key]) return;
      const p = MASTER_DB[key];
      const _rawWt = parseFloat(move.querySelector('.m-wt').value) || 0;
      const wt = _rawWt === 999 ? (parseFloat(move.querySelector('.m-wt')?.dataset?.maxKgEntered) || 0) : _rawWt;
      const pres = parseFloat(move.querySelector('.m-reps')?.value) || 0;
      let reps;
      if (isMaxReps) {
        reps = (mvData.reps && mvData.reps[mvIdx] !== undefined) ? (mvData.reps[mvIdx] || 0) : 0;
      } else if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = block.querySelectorAll('.movement-block').length || 1;
        const stationRounds = Math.floor(r / stationCount) + (mvIdx < (r % stationCount) ? 1 : 0);
        reps = pres === 999 ? (parseFloat(move.querySelector('.m-reps')?.dataset.maxRepsEntered) || 0)
                            : pres * Math.max(1, stationRounds);
      } else {
        if (pres === 999) {
          const entered = parseFloat(move.querySelector('.m-reps')?.dataset.maxRepsEntered) || 0;
          reps = entered;
          ep = 0;
        } else {
          const repsOverride = move.querySelector('.m-reps-override')?.value === '1';
          if (repsOverride) {
            // Per-movement rep scheme override
            const ovScheme = move.querySelector('.m-reps-scheme')?.value || 'fixed';
            const goalRoundsOv = getLadderSequence(block)?.length || (parseInt(block.querySelector('.b-target')?.value) || 1);
            if (ovScheme === 'fixed') {
              const base = pres * r;
              const wf = Math.min(ep, pres);
              ep = Math.max(0, ep - pres);
              reps = base + wf;
            } else {
              const ovSeq = getMovRepsSequence(move, goalRoundsOv);
              if (ovSeq && ovSeq.length) {
                const completedSeq = ovSeq.slice(0, Math.min(r, ovSeq.length));
                const extraRepsOv = Math.min(ep, ovSeq[Math.min(r, ovSeq.length-1)] || pres);
                reps = completedSeq.reduce((a,b) => a+b, 0) + extraRepsOv;
                ep = 0;
              } else {
                reps = pres * r;
              }
            }
          } else {
            const ladderType = block.querySelector('.b-ladder-type')?.value || 'fixed';
            if (ladderType !== 'fixed') {
              reps = getLadderTotalReps(block, pres, r, ep);
              ep = 0;
            } else {
              const base = pres * r;
              const wf = Math.min(ep, pres);
              ep = Math.max(0, ep - pres);
              reps = base + wf;
            }
          }
        }
      }
      const epForWtLadder = ep; // capture before it may be further modified

      // wd (drives Power) and mc_mech (metabolic-cost-equivalent) now use
      // DIFFERENT eligibility rules — see reconstructMechanicalWork for the
      // full reasoning. wd is now ALWAYS pure concentric (x1), for every
      // movement unconditionally — supersedes the earlier cyclical=x2 rule.
      const workMultiplier = 1;

      // mc_mech eligibility — NOW reads the per-movement-instance
      // "controlled descent" toggle instead of RL (see memory-recorded
      // settled design v2). Unlike the old RL-based check, this doesn't
      // depend on weight at all, so it's a constant per movement, not a
      // per-round function.
      const mcMechEligible = !p || !p.oneDir || move.querySelector('.m-controlled-descent')?.value !== '0';

      // Weight ladder: calculate total work accounting for per-round weight variation
      const wtLadderType = move.querySelector('.m-wt-ladder-type')?.value || 'fixed';
      let tw_mv = 0, tt_mv = 0, mechCost_mv = 0, wtLabel2 = wt == 0 ? 'BW' : wt + ' kg';
      // Personalized bodyweight-CoM ROM doesn't vary by round/weight, so
      // it's computed once here rather than per round below — same
      // approach as workMultiplier. When available, its own massFraction
      // replaces p.bw entirely (see getPersonalizedBodyweightROM's doc
      // comment) — mixing the two would double-count/misrepresent mass.
      const bwPersonalLive = getPersonalizedBodyweightROM(key || '', h);
      if (wtLadderType !== 'fixed' && _rawWt !== 999) {
        // Sum work per round using round-specific weight
        const repSeq = getLadderSequence(block);
        const goalRounds = parseInt(block.querySelector('.b-target')?.value) || 1;
        const seqLen = repSeq ? repSeq.length : goalRounds;
        const completedRounds = repSeq
          ? Math.min(r || seqLen, seqLen)
          : Math.min(r || goalRounds, goalRounds);
        for (let ri = 0; ri < completedRounds; ri++) {
          const roundWt = getWtAtRound(move, ri);
          // Use per-movement rep override if active, else block rep scheme
          const _ovActive = move.querySelector('.m-reps-override')?.value === '1';
          const _ovSeqWL = _ovActive ? getMovRepsSequence(move, seqLen) : null;
          const roundReps = _ovSeqWL ? (_ovSeqWL[ri] || pres) : (repSeq ? repSeq[ri] : pres);
          const barPathRomR = getAthleteROM(key || '', p, h);
          const bwRomR = bwPersonalLive ? bwPersonalLive.rom : barPathRomR;
          const bwMassFracR = bwPersonalLive ? bwPersonalLive.massFraction : p.bw;
          const concentricRound = ((roundWt * barPathRomR + bw * bwMassFracR * bwRomR) * 9.81 * roundReps) / 1000;
          tw_mv += concentricRound * workMultiplier;
          mechCost_mv += concentricRound * (mcMechEligible ? (7/6) : 1);
          tt_mv += roundWt * roundReps;
        }
        // Add extra reps at last round weight — use x directly since ep was zeroed by ladder calc
        const extraReps = repSeq ? x : epForWtLadder;
        if (extraReps > 0 && completedRounds > 0) {
          const lastWt = getWtAtRound(move, completedRounds - 1);
          const barPathRomE = getAthleteROM(key || '', p, h);
          const bwRomE = bwPersonalLive ? bwPersonalLive.rom : barPathRomE;
          const bwMassFracE = bwPersonalLive ? bwPersonalLive.massFraction : p.bw;
          const concentricExtra = ((lastWt * barPathRomE + bw * bwMassFracE * bwRomE) * 9.81 * extraReps) / 1000;
          tw_mv += concentricExtra * workMultiplier;
          mechCost_mv += concentricExtra * (mcMechEligible ? (7/6) : 1);
          tt_mv += lastWt * extraReps;
        }
        const wtSeqDisp = getWtLadderSequence(move, completedRounds);
        wtLabel2 = fmtWtScheme(move, completedRounds) || wtLabel2;
      } else {
        const barPathRomF = getAthleteROM(key || '', p, h);
        const bwRomF = bwPersonalLive ? bwPersonalLive.rom : barPathRomF;
        const bwMassFracF = bwPersonalLive ? bwPersonalLive.massFraction : p.bw;
        const concentricFixed = ((wt * barPathRomF + bw * bwMassFracF * bwRomF) * 9.81 * reps) / 1000;
        tw_mv = concentricFixed * workMultiplier;
        mechCost_mv = concentricFixed * (mcMechEligible ? (7/6) : 1);
        tt_mv = wt * reps;
      }
      mvIdx++;
      if (!p) return;
      // Cardio movements must never contribute to tw (mechanical work/wd) —
      // this guard was missing here even though the identical guard
      // already existed one line below for twMechCost, and the comment
      // beneath both claimed cardio was "excluded from both buckets" when
      // it was only actually excluded from one. A Run computed via the
      // generic p.dist x height fallback was silently adding real
      // mechanical-work credit for movements that contribute zero
      // mechanical work by design — their cost is entirely captured
      // through mc_aero instead, via a completely separate calculation.
      if (!p.cardio) { tw += tw_mv; tt += tt_mv; }
      if (!p.cardio) { twMechCost += mechCost_mv; blockMechCost[idx] = (blockMechCost[idx] || 0) + mechCost_mv; } // cardio's own mc_aero path handles its cost separately
      if (p.cardio) { /* cardio movements don't contribute to mechanical work at all — excluded from both buckets */ }
      else if (wt > 0) { loadedWorkKJ += tw_mv; }
      else { unloadedWorkKJ += tw_mv; }
      // 1RM tracking — use max weight for ladders, base weight for fixed
      const rmWt = (wtLadderType !== 'fixed' && _rawWt !== 999)
        ? Math.max(...Array.from({length: Math.min(r||1, parseInt(block.querySelector('.b-target')?.value)||1)}, (_, i) => getWtAtRound(move, i)))
        : wt;
      const rmPct = get1RMPercent(key, rmWt);
      if (rmPct !== null && rmPct > rmMax) { rmMax = rmPct; rmMaxMovement = key; }
      // Technical Demand tracking
      if (p.cx && reps > 0) { tdTotal += p.cx * reps; tdReps += reps; }
      const rmRef = rmPct !== null ? get1RMRefLabel(key) : '';
      const rmTag = rmPct !== null ? ` <span style="font-size:.7rem;font-weight:800;color:${rmPct>=90?'#EF4444':rmPct>=75?'#F59E0B':rmPct>=50?'#22C55E':'#9CA3AF'};">${rmPct}% ${rmRef}</span>` : '';
      // Compute average weight for display
      const _avgWt = (wtLadderType !== 'fixed' && tt_mv > 0 && reps > 0)
        ? Math.round(tt_mv / reps * 10) / 10
        : wt;
      const _wtDisplay = _avgWt === 0 ? 'BW' : (_avgWt !== wt ? `${_avgWt}kg avg` : wtLabel2);
      // Cardio movements' real cost is mc_aero (pace/flat-MET derived,
      // computed separately — see cardioResult/liveCardioByBlock above),
      // not the generic force x distance figure (tw_mv) shown for every
      // movement above this branch — that figure is never actually used
      // for cardio (excluded from Total Work and mc_mech both), so
      // showing it here was misleadingly implying it counted toward
      // something when it never did.
      let _workDisplay;
      if (p.cardio) {
        const cardioType = p.cardio;
        const splitCount = cardioTypeCounts[cardioType] || 1;
        let kcalShare = 0;
        if (cardioType === 'run') kcalShare = (liveCardioByBlock.runByBlock[idx] || 0) / splitCount;
        else if (cardioType === 'row') kcalShare = (liveCardioByBlock.rowByBlock[idx] || 0) / splitCount;
        else kcalShare = ((cardioResult.byBlock[idx] || {})[cardioType] || 0) / splitCount;
        _workDisplay = `${Math.round(kcalShare)} kcal (aerobic)`;
        // Real pace/cadence/cal-min — only appended when the cardio
        // toggle was actually used for this (block, movement type)
        // during the live session. No estimate ever shown here.
        const _realSecs = _liveCardioRealSecs(idx, cardioType);
        if (_realSecs) {
          const _totalUnits = reps * (p.cardioRef || 1);
          const _paceStr = _fmtCardioPace(cardioType, _totalUnits, _realSecs);
          if (_paceStr) _workDisplay += ` · ${_paceStr}`;
        }
      } else {
        _workDisplay = `${tw_mv.toFixed(2)} kJ`;
      }
      ah += `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:.78rem;color:var(--text);display:flex;justify-content:space-between;align-items:center;"><span>${key}${rmTag}</span><span style="color:var(--label);">${reps} reps @ ${_wtDisplay} · ${_workDisplay}</span></div>`;
    });

    // EMOM interruptor contribution — uses penalty-on flag, not accordion open state
    const emomEnabled = block.querySelector('.emom-accordion')?.classList.contains('penalty-on');
    if (emomEnabled) {
      const emomR = parseFloat(block.querySelector('.res-emom')?.value) || 0;
      const eKey  = block.querySelector('.int-key')?.value || '';
      const p     = MASTER_DB[eKey];
      const eWt   = parseFloat(block.querySelector('.int-wt')?.value) || 0;
      const eReps = block.querySelector('.int-reps')?.value || '?';
      const eSec  = block.querySelector('.int-sec')?.value  || '?';
      const intWtInpP = block.querySelector('.int-wt');
      const isBWP = intWtInpP?.disabled || MASTER_DB[eKey]?.type === 'bw';
      const eWtLabel = isBWP ? 'BW' : (eWt > 0 ? eWt + 'kg' : '0kg');
      if (emomR > 0) {
        const eRom = p ? getAthleteROM(eWt > 0 ? (p.type||'') : '', p, h) : 0.2 * (h/1.75); const eWork = ((eWt + (bw * (p?.bw || .5))) * 9.81 * eRom * emomR) / 1000;
        tw += eWork; tt += (eWt * emomR);
        ah += `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:.75rem;color:#F59E0B;display:flex;justify-content:space-between;"><span>⚡ EMOM: ${eKey || 'Penalty'} ×${eReps} @ ${eWtLabel} / ${eSec}s</span><span>${emomR} reps · ${eWork.toFixed(2)} kJ</span></div>`;
      } else {
        ah += `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:.75rem;color:#F59E0B;display:flex;justify-content:space-between;"><span>⚡ EMOM: ${eKey || 'Penalty'} ×${eReps} @ ${eWtLabel} / ${eSec}s</span><span style="font-style:italic;opacity:.7;">set Total Reps</span></div>`;
      }
    }
    ah += '</div>';
  });

  // Duration-weighted session RPE — Phase 1 stopgap for per-block RPE:
  // the overhead formula below still takes one session-wide RPE (Phase 2
  // will split mechKcal/cardioKcal per block and compute real per-block
  // overhead instead), but that single number is now a weighted average
  // of each block's own rating instead of one flat, whole-session value.
  // Cached on window so the save functions (which run after this
  // function, once the user hits Save) reuse the exact same number
  // rather than re-reading now-nonexistent DOM state.
  window._lastComputedRPE = rpeWeightTotal > 0 ? (rpeWeightedSum / rpeWeightTotal) : null;
  window._lastBlockRpeList = blockRpeList;

  // Add rest time to total session time and audit trail
  tas += totalRestSec;

  if (totalRestSec > 0) {
    const totalLabel = totalRestSec >= 60
      ? `${Math.floor(totalRestSec/60)}:${String(totalRestSec%60).padStart(2,'0')}`
      : `${totalRestSec}s`;
    ah += `<div class="audit-item"><div style="font-size:.75rem;color:var(--accent);display:flex;justify-content:space-between;align-items:center;"><span>⏸ ${t('res.total.rest')}</span><span>${totalLabel}</span></div></div>`;
  }

  document.getElementById('results').classList.remove('hidden-el');
  document.getElementById('session-match-outer').classList.remove('hidden-el');
  document.getElementById('cloud-backup-section').classList.remove('hidden-el');
  document.getElementById('auditTrail').innerHTML = ah;

  // ══ Cardio mechanical work — Power gets all types; mc_mech/mc_aero
  // carve-out only for Row/Ski ══
  // See getCardioWorkBreakdown() for full rationale — Row/Ski's watts and
  // kcal come from the same validated Concept2 pipeline, safe to move
  // between mc_aero/mc_mech. Run/DU's raw kJ still counts toward Power
  // (tw), but doesn't move any kcal between buckets — their mgh-based
  // estimate, run through the generic 22% efficiency conversion, was
  // found to exceed the movement's own total validated metabolic cost
  // on a real session (elastic tendon recoil isn't accounted for by
  // that conversion), so mc_aero stays exactly as the ACSM VO2 formula
  // computed it for them.
  const _cardioBreakdown = getCardioWorkBreakdown(getSessionCardioInstances(_buildLiveCardioEntry()), bw);
  tw += _cardioBreakdown.totalWorkKJ;
  twMechCost += _cardioBreakdown.metabolicCarveKJ;
  const _cardioCarvedKcal = (_cardioBreakdown.metabolicCarveKJ / 4.184) / 0.22;

  // Power's denominator is now simply total session time. The exclusion
  // built this morning (getLiveCardioTimeSec/_mechSec) existed because
  // cardio contributed exactly zero to tw — excluding its time avoided
  // diluting a rate with time that had no corresponding numerator
  // contribution at all. That's no longer true: cardio now has a real,
  // if often small, mechanical contribution for every second of its
  // duration, so its time is no longer "dead time" to exclude — a
  // running-heavy session correctly reading a LOWER Power than a
  // squat-heavy one is the whole point now, with Cardiovascular
  // Endurance as the counterbalancing signal for the same session
  // (see the Run/Squat scoping discussion). getLiveCardioTimeSec()
  // itself stays essential elsewhere (CV Endurance's segment/HR work) —
  // only Power stops consuming its output.
  const _pdVal = ((tw * 1000) / (tas || 1) / bw).toFixed(2);
  const _pdEl = document.getElementById('resPD');
  const _pdColor = getPDColor(_pdVal);
  if (_pdEl) { _pdEl.innerText = _pdVal; _pdEl.style.color = _pdColor; }
  const _pdCard = document.getElementById('resPD-card');
  if (_pdCard) _pdCard.style.borderLeftColor = _pdColor;

  const resWDEl = document.getElementById('resWD');
  resWDEl.innerText = tw.toFixed(1);
  resWDEl.dataset.precise = tw.toFixed(4);
  // mechKcal derives from twMechCost, NOT tw — the two now diverge once
  // eccentric work is added, since wd gets it at full weight (x2) while
  // mc_mech gets it at ~1/6 weight (x7/6), reflecting the real metabolic
  // cost asymmetry between concentric and eccentric contraction.
  const mechKcal = Math.round((twMechCost / 4.184) / 0.22);
  // bwVal/cardioResult computed earlier now, before the audit-trail loop —
  // see the comment there.
  // Run and Row's kcal are computed separately, with pace-derived MET
  // instead of this function's flat-MET formula (see getLiveRunAeroKcal,
  // getLiveRowAeroKcal) — added back in here to both the total and the
  // endurance bias bucket (both movements' MASTER_DB bias is
  // 'endurance'), since getCardioEnergy() no longer includes either.
  const runAeroKcal = getLiveRunAeroKcal();
  const rowAeroKcal = getLiveRowAeroKcal();
  // _cardioCarvedKcal subtracted here — the mechanical-work equivalent
  // that just moved into mechKcal above, via twMechCost, must come back
  // out of the aerobic total or the session's overall Metabolic Cost
  // would silently inflate by double-counting it in both buckets.
  const cardioKcal = Math.max(0, Math.round(cardioResult.total + runAeroKcal + rowAeroKcal - _cardioCarvedKcal));
  window._lastCardioByBias = {
    endurance: cardioResult.byBias.endurance + runAeroKcal + rowAeroKcal,
    metabolic: cardioResult.byBias.metabolic
  };
  const totalMC = mechKcal + cardioKcal;
  document.getElementById('resMC').innerText = totalMC.toFixed(0);
  // Store mechanical/aerobic split for stacked chart and history entry
  window._lastMechKcal   = mechKcal;
  window._lastCardioKcal = cardioKcal;

  // ── Aerobic overhead — uses VO2max data or population estimate ──
  let overheadKcal = 0;
  const blockOverheadList = []; // per-block overhead, in block order — feeds the pattern-split attribution below instead of the old whole-session proportional guess
  const blockTotalMetEstimateList = []; // per-block RPE-implied kcal, BEFORE mechanical subtraction — Cardiovascular Endurance uses this directly for non-pure-cardio blocks
  const vo2maxResult = getEffectiveVO2max();
  const vo2max = vo2maxResult?.value || null;
  const vo2maxIsEstimate = vo2maxResult?.estimated || false;
  if (vo2max) {
    const age   = parseInt(document.getElementById('global-age')?.value)||30;
    const gender = document.getElementById('global-gender')?.value || 'male';
    const bwKg  = parseFloat(document.getElementById('global-w')?.value)||75;
    const ageFactor  = Math.max(0.60, 1 - Math.max(0, (age-25)*0.01));
    const genderFactor = gender === 'female' ? 0.92 : 1.0;
    // Overhead is driven directly by RPE (required, collected as part of
    // result entry) rather than an inferred relative-intensity ceiling.
    // This removes the entire class of problems the ceiling approach had:
    // no reference session to keep stable, no mechanical/aerobic
    // composition-matching needed, no risk of the top-down estimate
    // undershooting known real costs from a proxy that couldn't see half
    // of what actually happened in the session. RPE measures perceived
    // exertion directly, the same way any modality of effort — heavy
    // barbell work or a hard row — can each honestly self-report how close
    // to max effort they were.
    //
    // Phase 2: computed per block instead of once for the whole session.
    // Each block gets its own totalMetEstimate (its own RPE, its own
    // time) minus its own already-known mechKcal/cardioKcal, clamped to
    // >=0 individually before summing (Option A, approved earlier) — a
    // block where the direct measurement already exceeds what RPE implied
    // contributes zero, never a negative that would silently erode a
    // different block's real overhead. See the Cash in/out 800 analysis:
    // this is exactly why the AMRAP block ended up carrying ~all the
    // session's overhead while the Runs contributed close to none, once
    // computed this way instead of as one blended session-wide number.
    //
    // Step 2 (per-movement HR/cardio-toggle integration): each block is
    // now further split into segments where real interval + HR data
    // exists (_buildBlockSegments), giving genuine per-movement precision
    // within a mixed block instead of one blended RPE for the whole
    // block. Falls back to exactly today's whole-block RPE-slider
    // behavior when no segment data is available (pre-Phase-1 blocks, or
    // a block where the strap wasn't connected) — _buildBlockSegments
    // itself returns that single-segment manual_rpe fallback, so no
    // separate branch is needed here.
    const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
    const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;
    for (let idx = 0; idx < blockRpeList.length; idx++) {
      const blockTimeSec = blockTimeList[idx] || 0;
      if (blockTimeSec <= 0) { blockOverheadList[idx] = 0; blockTotalMetEstimateList[idx] = 0; continue; }
      const blockMechKcal = ((blockMechCost[idx] || 0) / 4.184) / 0.22;
      const blockCardioKcal = (liveCardioByBlock.runByBlock[idx] || 0) + (liveCardioByBlock.rowByBlock[idx] || 0)
        + Object.values(cardioResult.byBlock[idx] || {}).reduce((a, b) => a + b, 0); // du/ski — previously missing from this subtraction entirely

      const win = _getBlockWindow(idx, blockTimeSec);
      const segments = win
        ? _buildBlockSegments(idx, win.startMs, win.endMs)
        : [{ type: 'block', source: 'manual_rpe', rpe: blockRpeList[idx] || null, durationSec: blockTimeSec }];

      const { overhead, cv } = _computeBlockOverheadAndCV(
        segments, blockMechKcal, blockCardioKcal, bwKg, vo2max, ageFactor, genderFactor, hrRestVal, hrMaxVal
      );
      blockOverheadList[idx] = overhead;
      blockTotalMetEstimateList[idx] = cv;
    }
    overheadKcal = Math.round(blockOverheadList.reduce((sum, v) => sum + v, 0));
  }
  window._lastOverheadKcal = overheadKcal > 0 ? overheadKcal : null;
  window._lastBlockOverheadList = blockOverheadList;
  window._lastVo2max = vo2max || null;

  // Cardiovascular Endurance — mass-independent aerobic intensity (MET),
  // now correctly including overhead for any block with non-cardio
  // movements (see getSessionCVEndurance's comment for the full
  // rationale and the mixed-block limitation this doesn't fully solve).
  // Card hidden entirely for sessions with no aerobic content at all —
  // not shown as 0, which would misleadingly read as "measured, zero
  // intensity" rather than "not applicable."
  const _cvResult = getLiveCVEndurance(blockMechCost, blockTimeList, blockTotalMetEstimateList, liveCardioByBlock, cardioResult.byBlock);
  const _aeroCard = document.getElementById('resAeroPD-card');
  if (_aeroCard) {
    if (_cvResult) {
      _aeroCard.style.display = '';
      const _aeroEl = document.getElementById('resAeroPD');
      if (_aeroEl) _aeroEl.innerText = _cvResult.met.toFixed(1);
      // MET-minutes — total accumulated metabolic volume (MET x minutes),
      // distinct from the average-intensity MET above. Grows with
      // duration even at constant intensity, unlike the average — see
      // tonight's Gemini-doc review for why these are deliberately kept
      // as two separate numbers, not one metric doing both jobs.
      const _metMinEl = document.getElementById('resMetMinutes');
      if (_metMinEl) _metMinEl.innerText = _cvResult.metMinutes ? Math.round(_cvResult.metMinutes) : '0';
      // %HRR — real Karvonen formula ((session avg HR − resting HR) /
      // (HR max − resting HR)) whenever the session has real measured
      // HR AND the profile's Resting HR / HR Max fields are both set —
      // same formula _computeBlockOverheadAndCV already applies
      // per-segment, just against the whole-session avg HR here. Falls
      // back to reversing met = relIntensity * vo2max / 3.5 (the
      // pace/MET-derived estimate) only when real HR data isn't
      // available, labeled "(est.)" so it's never mistaken for measured.
      //
      // The "(est.)" note text lives in the Session Data card's HR row
      // now, not here — and is gated on whether %HRR SPECIFICALLY fell
      // back to estimate (_hrrIsEstimate below), not on cvResult.allReal
      // (whether the MET value overall is fully real). Those are
      // genuinely different conditions: MET can be fully real (real
      // segment HR throughout) while %HRR still estimates, if the
      // profile's Resting HR / HR Max fields simply aren't filled in.
      const _hrrEl = document.getElementById('resHRR');
      let _hrrIsEstimate = false;
      if (_hrrEl) {
        const _sessionHRForHRR = (typeof _hrStatsForRange === 'function') ? _hrStatsForRange(0, Date.now()) : null;
        const _hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
        const _hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;
        if (_sessionHRForHRR && _hrRestVal && _hrMaxVal && _hrMaxVal > _hrRestVal) {
          const realPctHRR = Math.max(0, Math.min(100, (_sessionHRForHRR.avg - _hrRestVal) / (_hrMaxVal - _hrRestVal) * 100));
          _hrrEl.innerText = `${Math.round(realPctHRR)}% HRR`;
        } else if (vo2max > 0) {
          const pctHRR = Math.max(0, Math.min(100, (_cvResult.met * 3.5 / vo2max) * 100));
          _hrrEl.innerText = `${Math.round(pctHRR)}% HRR (est.)`;
          _hrrIsEstimate = true;
        } else {
          _hrrEl.innerText = '';
        }
      }
      const _aeroNoteEl = document.getElementById('resAeroPD-note');
      if (_aeroNoteEl) _aeroNoteEl.innerText = _hrrIsEstimate ? t('aero.power.estimated') : '';
      // Real avg/max HR for the whole session — frozen into
      // window._lastSessionHR right here, at Calculate time, and
      // history.js's save flow reuses this exact object rather than
      // recomputing _hrStatsForRange(0, Date.now()) fresh at save time.
      // They used to be two separate calls with two different
      // Date.now() values — if any time passed between Calculate and
      // Save (reviewing the result, picking an RPE), more HR samples
      // would stream in during that gap and shift the average, so the
      // number shown here and the number that got saved could
      // genuinely disagree even though nothing was wrong — freezing it
      // here is what actually guarantees they always match.
      const _hrAvgEl = document.getElementById('resHRAvg');
      const _hrMaxEl = document.getElementById('resHRMax');
      const _hrAvgMaxLineEl = document.getElementById('resHRAvgMax-line');
      if (_hrAvgEl || _hrMaxEl) {
        const _sessionHR = (typeof _hrStatsForRange === 'function') ? _hrStatsForRange(0, Date.now()) : null;
        window._lastSessionHR = _sessionHR;
        if (_hrAvgEl) _hrAvgEl.innerText = _sessionHR ? _sessionHR.avg : '0';
        if (_hrMaxEl) _hrMaxEl.innerText = _sessionHR ? _sessionHR.max : '0';
        // Avg/Max BPM line hides on its own when there's no real HR —
        // showing "0 / 0 bpm" would be worse than not showing it — but
        // the row itself must NOT hide on that same condition (see
        // below): %HRR can still have a real value here, since this
        // whole-session avg/max HR check is separate from the
        // per-segment source _hrrEl's own real-vs-estimate branch used.
        if (_hrAvgMaxLineEl) _hrAvgMaxLineEl.style.display = _sessionHR ? '' : 'none';
        // HR row in the Session Data card shows if EITHER real avg/max
        // HR exists OR %HRR has any value at all (real or estimated) —
        // previously gated on real avg/max HR alone, which incorrectly
        // hid the ESTIMATED %HRR too whenever no HR strap was
        // connected, which is exactly the scenario that estimate
        // exists to cover. _hrrEl was already populated above,
        // regardless of order, since both blocks run inside the same
        // enclosing if (_cvResult) scope.
        const _hrrHasContent = !!(_hrrEl && _hrrEl.innerText);
        const _hrRowEl = document.getElementById('resSessionData-hr-row');
        if (_hrRowEl) _hrRowEl.style.display = (_sessionHR || _hrrHasContent) ? '' : 'none';
        // Relative Load spans both grid columns when HR is absent —
        // otherwise it'd sit alone in column 2 with an empty gap to its
        // left where Heart Rate would have been.
        const _rlRowEl = document.getElementById('resSessionData-rl-row');
        if (_rlRowEl) _rlRowEl.style.gridColumn = (_sessionHR || _hrrHasContent) ? '2' : '1 / -1';
      }
    } else {
      _aeroCard.style.display = 'none';
      window._lastSessionHR = null;
      const _metMinEl = document.getElementById('resMetMinutes');
      if (_metMinEl) _metMinEl.innerText = '0'; // now the card's own hero value (Cardio Strain), so it needs an explicit zero here rather than blanking — unlike before, an empty hero number would look broken instead of just disappearing
      const _hrRowElHide = document.getElementById('resSessionData-hr-row');
      if (_hrRowElHide) _hrRowElHide.style.display = 'none';
      const _rlRowElHide = document.getElementById('resSessionData-rl-row');
      if (_rlRowElHide) _rlRowElHide.style.gridColumn = '1 / -1';
    }
  }
  window._lastCVEndurance = _cvResult || null; // full object (met + metMinutes), not just met — the session radar needs both

  // Update total MC display to include overhead — Metabolic Cost is a
  // total-cost question, and the extra cardiovascular strain from pushing
  // hard is a genuine part of that total, even when estimated from RPE.
  if (overheadKcal > 0) {
    const totalWithOverhead = mechKcal + cardioKcal + overheadKcal;
    document.getElementById('resMC').innerText = totalWithOverhead.toFixed(0);
  }
  // Power was previously duplicated here as a second calculation using
  // raw tas (not cardio-excluded _mechSec), silently overwriting the
  // correct _pdVal computed above and re-diluting Power for any session
  // with running/rowing blocks. Removed — _pdVal above already computes
  // pure Force x Distance / Time physics (tw straight to Watts, no
  // mc_mech efficiency-factor routing) with the correct cardio-excluded
  // denominator, so nothing here needs recomputing.
  if (overheadKcal > 0) {
    // Rebuild kcal chart cleanly so overhead shows correctly
    const hist = getHistory();
    const sixWeeksAgo = new Date(Date.now() - 42*24*60*60*1000);
    if (hist.filter(w => w.date && new Date(w.date) >= sixWeeksAgo).length >= 2) {
      setTimeout(() => renderAnalytics(), 100);
    }
  }
  const breakdown = document.getElementById('resMC-breakdown');
  const barMech = document.getElementById('resMC-bar-mech');
  const barAero = document.getElementById('resMC-bar-aero');
  const barOver = document.getElementById('resMC-bar-over');
  if (breakdown) {
    // Check if workout has cardio movements but no cardio PRs set
    const hasCardioMov = [...document.querySelectorAll('.wod-block .movement-block')].some(mv => {
      const key = mv.querySelector('input[type="hidden"]')?.value || '';
      return !!MASTER_DB[key]?.cardio;
    });
    const hasCardioPRs = ['pr-run400','pr-run5k','pr-row500','pr-row2k','pr-ski500','pr-bike','pr-du']
      .some(id => parseInt(document.getElementById(id)?.value) > 0);
    const overheadKcalDisp = window._lastOverheadKcal || 0;
    const overheadLabelText = vo2maxIsEstimate ? `Over (~est.)` : `Over (est.)`;
    // Check if overhead is unavailable due to insufficient history
    const hist2 = getHistory();
    const sixWeeksAgo2 = new Date(Date.now() - 42*24*60*60*1000);
    const recentPD2 = hist2.filter(w => w.date && new Date(w.date) >= sixWeeksAgo2).map(w => parseFloat(w.pd)||0).filter(v => v > 0);
    const sessionsNeeded = Math.max(0, 5 - recentPD2.length);
    const overheadPending = vo2max && sessionsNeeded > 0;
    const overheadNoVO2 = !vo2max;
    // Legend item — colored dot, muted label, bold value — matching the
    // segmented bar directly above it. Value styled distinctly from the
    // label now that this sits under a visual bar rather than being the
    // only representation of the breakdown.
    const dotRow = (color, label, value) => `<div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span><span style="color:var(--label);">${label} <span style="color:var(--text);font-weight:700;">${value}</span></span></div>`;
    if (cardioKcal > 0 || overheadKcalDisp > 0 || overheadPending || overheadNoVO2) {
      let rows = [dotRow('#FF6B35', 'Mech', `${mechKcal} kcal`), dotRow('#22C55E', 'Aero', `${cardioKcal} kcal`)];
      if (overheadKcalDisp > 0) rows.push(dotRow('#3B82F6', overheadLabelText, `${overheadKcalDisp} kcal`));
      if (overheadPending) rows.push(dotRow('#3B82F6', `${t('overhead.pending.1')} ${sessionsNeeded} ${t('overhead.pending.2')}`, ''));
      if (overheadNoVO2) rows.push(dotRow('#3B82F6', t('overhead.no.vo2'), ''));
      breakdown.innerHTML = rows.join('');
      breakdown.style.display = 'flex';
      breakdown.style.color = 'var(--label)';
      // Segmented bar — only meaningful when all three components are
      // real numbers with a genuine total to divide by; the
      // pending/no-VO2 rows above have no clean split to visualize, so
      // the bar collapses to a flat, empty track in those cases rather
      // than showing a misleadingly confident proportion.
      const barTotal = mechKcal + cardioKcal + overheadKcalDisp;
      if (barMech && barAero && barOver) {
        if (barTotal > 0) {
          barMech.style.width = `${(mechKcal / barTotal) * 100}%`;
          barAero.style.width = `${(cardioKcal / barTotal) * 100}%`;
          barOver.style.width = `${(overheadKcalDisp / barTotal) * 100}%`;
        } else {
          barMech.style.width = '0%';
          barAero.style.width = '0%';
          barOver.style.width = '0%';
        }
      }
    } else if (hasCardioMov && !hasCardioPRs) {
      breakdown.textContent = '⚠️ Add Cardio PRs in Profile to include aerobic energy';
      breakdown.style.display = 'flex';
      breakdown.style.color = 'var(--brand)';
      if (barMech && barAero && barOver) { barMech.style.width = '0%'; barAero.style.width = '0%'; barOver.style.width = '0%'; }
    } else {
      breakdown.style.display = 'none';
      if (barMech && barAero && barOver) { barMech.style.width = '0%'; barAero.style.width = '0%'; barOver.style.width = '0%'; }
    }
  }
  const pdBreakdown = document.getElementById('resPD-breakdown');
  if (pdBreakdown) pdBreakdown.style.display = 'none';
  document.getElementById('resFB').innerText = (tt / (tw || 1)).toFixed(0);
  // Store session radar values for history
  window._lastSessionRadar = {
    pd: parseFloat(_pdVal), // reuse the correct Power value above — do not recompute independently (that was the same bug as resPD's duplicate calc, twice now)
    wd: tw,
    mc: mechKcal + cardioKcal + overheadKcal, // overheadKcal is 0 if VO2max/history prerequisites weren't met
    fb: (tt / (tw || 1)),
    rl: 0, td: 0
  };
  // Store duration and bodyweight-at-time — needed so Power (mechanical/aerobic/
  // overhead/total, in W/kg) can be computed honestly for this specific session
  // later, rather than always using whatever bodyweight is on the profile *now*.
  window._lastDurationSec = tas;
  window._lastBodyweight = bw;
  // Relative Loading — always show, 0% if no 1RM matched. Value now
  // lives in the Session Data card's RL column (bold hero number, plain
  // white/text-colored to match HR and MC's hero numbers there) rather
  // than as a small secondary line under Technical Demand — the old
  // tier-based color coding doesn't fit that new consistent hierarchy,
  // so it's dropped here rather than carried over.
  const rlCard = document.getElementById('resRL-card');
  const rlVal  = document.getElementById('resRL');
  const rlMoveEl = document.getElementById('resRL-movement');
  if (rlCard && rlVal) {
    const avgRL = rmMax > 0 ? Math.round(rmMax) : 0;
    rlVal.innerText = avgRL;
    if (rlMoveEl) rlMoveEl.innerText = (avgRL > 0 && rmMaxMovement) ? rmMaxMovement : '';
    if (window._lastSessionRadar) window._lastSessionRadar.rl = avgRL;
    rlVal.style.color = 'var(--text)'; // explicit reset — a prior session's now-removed tier coloring must not persist onto this one
    rlCard.style.display = '';
  }
  // Bodyweight Work % — share of total mechanical work that came from
  // unloaded (bodyweight-only) movements vs externally loaded ones. No
  // dedicated card yet — computed and stored for use elsewhere (Session
  // Match Additional Context, History) until a UI slot is built.
  const totalMechForBwPct = loadedWorkKJ + unloadedWorkKJ;
  window._lastBodyweightWorkPct = totalMechForBwPct > 0 ? Math.round((unloadedWorkKJ / totalMechForBwPct) * 100) : null;
  if (window._lastSessionRadar) window._lastSessionRadar.bwWorkPct = window._lastBodyweightWorkPct;
  // Technical Demand
  const tdEl = document.getElementById('resTD');
  if (tdEl) {
    if (tdReps > 0) {
      const avgTD = tdTotal / tdReps;
      const tdInfo = getTDLabel(avgTD);
      tdEl.innerText = avgTD.toFixed(1) + ' / 5';
      if (window._lastSessionRadar) window._lastSessionRadar.td = avgTD;
      tdEl.style.color = tdInfo.color;
      // Add label to audit trail header
      ah = ah.replace('<div class="audit-item">', '<div class="audit-item">');
    } else {
      tdEl.innerText = '—';
      tdEl.style.color = '';
    }
  }

  // Render contextual benchmark bars
  setTimeout(() => { renderAllBMBars(); }, 150);
  // Force analytics chart re-render after physics — charts may be blank if
  // canvas was zero-sized when first rendered (e.g. accordion collapsed)
  setTimeout(() => { if (currentTab === 3) renderAnalytics(); }, 200);

  // Calculate and display energy profile
  calculateMovementPatternProfile();

  // eRaw banner — sources workKJ (tw) and metMinutes (window._lastCVEndurance)
  // from values ALREADY computed live above, rather than re-deriving them
  // through the reconstruction path getEngineScoreERaw/getSessionCVEndurance
  // use for saved entries — that path exists for reconstructing a session
  // from storage after the fact, and re-running it here risks drifting
  // from what this exact calculation just produced. Only run/DU distance
  // needs the lightweight preview-entry technique below (same one
  // renderSessionMatchSection uses just after this), since that number
  // isn't otherwise available as a single live variable.
  {
    const eRawCard = document.getElementById('resERaw-card');
    const eRawVal = document.getElementById('resERaw');
    const eRawUnit = document.getElementById('resERawUnit');
    const eRawSentence = document.getElementById('resERawSentence');
    let eRawDisplay = null;
    const liveMetMinutes = window._lastCVEndurance ? window._lastCVEndurance.metMinutes : 0;
    if (liveMetMinutes) {
      let runMeters = 0, duReps = 0;
      try {
        const previewEntry = { blocks: serializeBlocksForTemplate(), cardioIntervalSummary: (typeof _buildCardioIntervalSummary === 'function' ? _buildCardioIntervalSummary() : null) };
        (typeof getSessionCardioInstances === 'function' ? getSessionCardioInstances(previewEntry) : []).forEach(inst => {
          if (inst.cardioType === 'run') runMeters += inst.totalM;
          if (inst.cardioType === 'du') duReps += inst.totalM; // totalM is a rep count for DU, not meters
        });
      } catch (e) {}
      // Sensor-measured mechanical work (WitMotion VBT pod) is
      // authoritative for eRaw's numerator specifically when the pod
      // tracked at least one rep this session — a real measured
      // displacement beats an assumed one. tw itself is deliberately
      // left untouched here: the Mechanical Work card and Force Bias
      // both read tw elsewhere in this function, and neither was part
      // of this request — only eRaw's own workKJ input changes.
      const vbtWorkKJ = window._vbtSessionWorkKJ || 0;
      const usingSensorWork = vbtWorkKJ > 0;
      const eRawWorkKJ = usingSensorWork ? vbtWorkKJ : tw;
      let modality = null;
      if (eRawWorkKJ > 0) modality = 'MIXED';
      else if (runMeters > 0) modality = 'LOCO_RUN';
      else if (duReps > 0) modality = 'LOCO_DU';
      if (modality === 'MIXED') {
        const v = eRawWorkKJ / liveMetMinutes;
        const sourceNote = usingSensorWork ? ' (sensor-measured)' : '';
        eRawDisplay = { value: v, unitLabel: 'kJ / MET-min', sentence: `Every MET-min yielded ${v.toFixed(2)} kJ of mechanical work${sourceNote}.` };
      } else if (modality === 'LOCO_RUN') {
        const v = runMeters / liveMetMinutes;
        eRawDisplay = { value: v, unitLabel: 'm / MET-min', sentence: `Every MET-min yielded ${v.toFixed(1)} meters of distance.` };
      } else if (modality === 'LOCO_DU') {
        const v = duReps / liveMetMinutes;
        eRawDisplay = { value: v, unitLabel: 'reps / MET-min', sentence: `Every MET-min yielded ${v.toFixed(1)} reps.` };
      }
    }
    if (eRawCard) {
      if (eRawDisplay) {
        eRawVal.innerText = eRawDisplay.value.toFixed(2);
        eRawUnit.innerText = eRawDisplay.unitLabel;
        eRawSentence.innerText = eRawDisplay.sentence;
        eRawCard.style.display = '';
      } else {
        eRawCard.style.display = 'none';
      }
    }

    // Running eRaw — second, separate banner. Only meaningful (and
    // only shown) for a MIXED session that also has real running in
    // it — a pure LOCO_RUN session already gets this exact number as
    // its own primary eRaw above, and a session with no real running
    // has nothing to credit here at all.
    const runERawCard = document.getElementById('resRunERaw-card');
    const runERawVal = document.getElementById('resRunERaw');
    const runERawUnit = document.getElementById('resRunERawUnit');
    const runERawSentence = document.getElementById('resRunERawSentence');
    let runERawDisplay = null;
    if (typeof getRunningERawDisplay === 'function') {
      try {
        let runMetersForCard = 0;
        const previewEntryForRunERaw = { blocks: serializeBlocksForTemplate(), cardioIntervalSummary: (typeof _buildCardioIntervalSummary === 'function' ? _buildCardioIntervalSummary() : null) };
        (typeof getSessionCardioInstances === 'function' ? getSessionCardioInstances(previewEntryForRunERaw) : []).forEach(inst => {
          if (inst.cardioType === 'run') runMetersForCard += inst.totalM;
        });
        // Only relevant when the main banner above landed on MIXED —
        // a LOCO_RUN session's running is already the primary eRaw,
        // showing it again here would be pure duplication. Shares
        // liveMetMinutes as its denominator — the exact same value the
        // mechanical eRaw above just used — rather than isolating a
        // running-only denominator, so the two banners are genuinely
        // comparable on the same cost basis.
        if (eRawDisplay && eRawDisplay.unitLabel === 'kJ / MET-min' && runMetersForCard > 0) {
          runERawDisplay = getRunningERawDisplay(runMetersForCard, liveMetMinutes);
        }
      } catch (e) {}
    }
    if (runERawCard) {
      if (runERawDisplay) {
        runERawVal.innerText = runERawDisplay.value.toFixed(1);
        runERawUnit.innerText = runERawDisplay.unitLabel;
        runERawSentence.innerText = runERawDisplay.sentence;
        runERawCard.style.display = '';
      } else {
        runERawCard.style.display = 'none';
      }
    }
  }

  // Find and render comparable prior sessions using the just-computed data.
  // Uses "now" as the date so every history entry correctly counts as prior
  // to this not-yet-saved session.
  renderSessionMatchSection({
    fb: parseFloat(document.getElementById('resFB')?.innerText),
    wd: parseFloat(document.getElementById('resWD')?.dataset.precise || document.getElementById('resWD')?.innerText),
    duration_sec: window._lastDurationSec,
    bw: window._lastBodyweight,
    mc_mech: mechKcal, mc_aero: cardioKcal, mc_overhead: overheadKcal,
    patternProfile: _lastPatternProfile,
    rl: window._lastSessionRadar?.rl,
    mc: window._lastSessionRadar?.mc,
    td: window._lastSessionRadar?.td,
    bw_work_pct: window._lastBodyweightWorkPct,
    rpe: window._lastComputedRPE || null,
    date: new Date().toISOString(),
    // Required for getSessionWorkPerRep() — without this, the live,
    // just-calculated session could never compute its own work/rep and
    // Session Match would always report "no matches" for it, regardless
    // of history. serializeBlocksForTemplate() already includes result
    // (reads it directly from the live res-m/res-s/res-r/res-x fields),
    // so no separate step is needed to attach it.
    blocks: serializeBlocksForTemplate()
  });

  // If in an active box session, offer to submit to leaderboard
  if (window._activeBoxSession && window._activeBoxSession.id) {
    setTimeout(() => showLeaderboardSubmitPrompt(), 600);
  }
  // Check if any max-load movement exceeds recorded 1RM — prompt to update
  setTimeout(() => checkMaxKgPRs(), 800);
}

/* ════════════════════════════════════════════════════
   MOVEMENT PATTERN CALCULATOR
   Weights each movement's work contribution by which
   pattern getMovementPattern() classifies it as.
   Replaces the old Movement Bias system (Strength/Power/
   Metabolic/Endurance) — bias was a static, per-movement
   tag with the same "doesn't adapt to context" problem
   the old movement-pattern catch-all had, and pattern
   already exists, is more accurate, and is directly
   reusable here.
════════════════════════════════════════════════════ */

// Store last-calculated profile for saving to history
let _lastPatternProfile = null;

function calculateMovementPatternProfile() {
  const bw = parseFloat(document.getElementById('global-w').value);
  const h  = parseFloat(document.getElementById('global-h').value) / 100;

  // Accumulator: work-kcal per pattern
  const patterns = {};

  document.querySelectorAll('.wod-block').forEach((block, blockIdx) => {
    const mode = block.querySelector('.b-mode').value;
    const r = parseFloat(block.querySelector('.res-r').value) || 0;
    const x = parseFloat(block.querySelector('.res-x').value) || 0;
    let ep = x;

    // This block's own pattern kcal, kept separate from the session-wide
    // `patterns` accumulator so this block's own overhead (Phase 2) can be
    // attributed proportionally to this block's own mix, not the whole
    // session's — a block that's 100% squat shouldn't have its overhead
    // diluted by push/hinge work that happened in a completely different block.
    const blockPatternKcal = {};

    const isMaxRepsE = block.dataset.maxReps === '1';
    let mvDataE = {};
    if (isMaxRepsE) {
      try { mvDataE = JSON.parse(block.querySelector('.res-mv-data')?.value || '{}'); } catch(e) {}
    }
    let epE = x;
    let mvIdxE = 0;
    block.querySelectorAll('.movement-block').forEach(move => {
      const key = move.querySelector('input[type="hidden"]').value;
      if (!MASTER_DB[key]) return;
      const p = MASTER_DB[key];
      const wt  = parseFloat(move.querySelector('.m-wt').value) || 0;
      const pres= parseFloat(move.querySelector('.m-reps')?.value) || 0;
      let reps;
      if (isMaxRepsE) {
        reps = (mvDataE.reps && mvDataE.reps[mvIdxE] !== undefined) ? (mvDataE.reps[mvIdxE] || 0) : 0;
      } else if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = block.querySelectorAll('.movement-block').length || 1;
        const stationRounds = Math.floor(r / stationCount) + (mvIdxE < (r % stationCount) ? 1 : 0);
        reps = pres === 999 ? (parseFloat(move.querySelector('.m-reps')?.dataset.maxRepsEntered) || 0)
                            : pres * Math.max(1, stationRounds);
      } else {
        const base = pres * r;
        const wf = Math.min(epE, pres);
        epE = Math.max(0, epE - pres);
        reps = base + wf;
      }
      mvIdxE++;
      if (!p) return;
      if (p.cardio) return; // handled separately below using real cardio kcal, not near-zero mechanical work
      const pattern = getMovementPattern(key);
      if (!pattern) return; // defensive — shouldn't happen, the catch-all is empty
      const rom1 = getAthleteROM(key || '', p, h);
      const work = ((wt + (bw * p.bw)) * 9.81 * rom1 * reps) / 1000;
      const workKcal = (work / 4.184) / 0.22; // metabolic-cost-equivalent, same conversion used everywhere else
      patterns[pattern] = (patterns[pattern] || 0) + workKcal;
      blockPatternKcal[pattern] = (blockPatternKcal[pattern] || 0) + workKcal;
    });

    // EMOM penalty contribution
    const emomEnabledE = block.querySelector('.emom-accordion')?.classList.contains('penalty-on');
    if (emomEnabledE) {
      const emomRE = parseFloat(block.querySelector('.res-emom')?.value) || 0;
      if (emomRE > 0) {
        const eKeyE  = block.querySelector('.int-key')?.value || '';
        const pE     = MASTER_DB[eKeyE];
        const eWtE   = parseFloat(block.querySelector('.int-wt')?.value) || 0;
        const eRomE = pE ? getAthleteROM('', pE, h) : 0.2 * (h/1.75); const eWorkE = ((eWtE + (bw * (pE?.bw || .5))) * 9.81 * eRomE * emomRE) / 1000;
        const eWorkKcalE = (eWorkE / 4.184) / 0.22;
        const ePattern = pE ? getMovementPattern(eKeyE) : null;
        if (ePattern) {
          patterns[ePattern] = (patterns[ePattern] || 0) + eWorkKcalE;
          blockPatternKcal[ePattern] = (blockPatternKcal[ePattern] || 0) + eWorkKcalE;
        }
      }
    }

    // This block's own overhead (Phase 2's real per-block figure, from
    // calculateGlobalPhysics()) attributed to this block's own pattern
    // mix, proportional to its own non-cardio work — not the whole
    // session's. A block with no non-cardio movements (e.g. a pure Run
    // block) has nowhere for its own overhead to go under the
    // 100%-to-non-cardio rule, so it's dropped for that block specifically
    // rather than diluted into unrelated blocks elsewhere in the session.
    const blockOverhead = (window._lastBlockOverheadList && window._lastBlockOverheadList[blockIdx]) || 0;
    if (blockOverhead > 0) {
      const blockNonCardioTotal = Object.values(blockPatternKcal).reduce((a, b) => a + b, 0);
      if (blockNonCardioTotal > 0) {
        Object.keys(blockPatternKcal).forEach(k => {
          patterns[k] += blockOverhead * (blockPatternKcal[k] / blockNonCardioTotal);
        });
      }
    }
  });

  // Cardio movements (Run, Row, Ski, Bike, Double-under, Jump Rope) all go
  // into monostructural using the real, already-computed total cardio kcal
  // (the same pace-derived MET, including tonight's Run/Row fixes, that
  // Metabolic Cost shows) — not a re-derived estimate, and not split by
  // bias the way the old system did, since monostructural is one category
  // covering all cyclical/single-modality movements regardless of type.
  const cardioKcalTotal = window._lastCardioKcal || 0;
  if (cardioKcalTotal > 0) {
    patterns['pattern.monostructural'] = (patterns['pattern.monostructural'] || 0) + cardioKcalTotal;
  }

  const totalPattern = Object.values(patterns).reduce((a, b) => a + b, 0) || 1;
  const patternPct = {};
  Object.keys(patterns).forEach(k => { patternPct[k] = patterns[k] / totalPattern; });

  const dominantPattern = Object.entries(patternPct).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  _lastPatternProfile = { patternPct, dominantPattern };
  renderMovementPatternProfile(_lastPatternProfile);
}

function getPATTERNMETA() {
  return {
    'pattern.squat':          { label: t('pattern.squat'),          color: '#A78BFA' },
    'pattern.hinge':          { label: t('pattern.hinge'),          color: '#EF4444' },
    'pattern.push':           { label: t('pattern.push'),           color: '#3B82F6' },
    'pattern.pull':           { label: t('pattern.pull'),           color: '#22C55E' },
    'pattern.olympic':        { label: t('pattern.olympic'),        color: '#F59E0B' },
    'pattern.core':           { label: t('pattern.core'),           color: '#EC4899' },
    'pattern.carry':          { label: t('pattern.carry'),          color: '#14B8A6' },
    'pattern.handstand':      { label: t('pattern.handstand'),      color: '#8B5CF6' },
    'pattern.monostructural': { label: t('pattern.monostructural'), color: '#06B6D4' },
  };
}

// Deep-dive reference card content for the Movement Pattern flip
// card's back face — icon+short-label and full description per
// pattern, plus pre-computed rgba backgrounds matching the exact
// values the original static HTML used (extracted directly from it,
// not re-derived), keyed the same as getPATTERNMETA() so both can be
// looked up together.
function getPatternDeepDiveMeta() {
  return {
    'pattern.squat':          { bg: 'rgba(167,139,250,.08)', border: 'rgba(167,139,250,.25)', shortKey: 'pattern.squat.short',          descKey: 'pattern.squat.desc' },
    'pattern.hinge':           { bg: 'rgba(239,68,68,.08)',   border: 'rgba(239,68,68,.25)',   shortKey: 'pattern.hinge.short',          descKey: 'pattern.hinge.desc' },
    'pattern.push':            { bg: 'rgba(59,130,246,.08)',  border: 'rgba(59,130,246,.25)',  shortKey: 'pattern.push.short',           descKey: 'pattern.push.desc' },
    'pattern.pull':            { bg: 'rgba(34,197,94,.08)',   border: 'rgba(34,197,94,.25)',   shortKey: 'pattern.pull.short',           descKey: 'pattern.pull.desc' },
    'pattern.olympic':         { bg: 'rgba(245,158,11,.08)',  border: 'rgba(245,158,11,.25)',  shortKey: 'pattern.olympic.short',        descKey: 'pattern.olympic.desc' },
    'pattern.core':            { bg: 'rgba(236,72,153,.08)',  border: 'rgba(236,72,153,.25)',  shortKey: 'pattern.core.short',           descKey: 'pattern.core.desc' },
    'pattern.carry':           { bg: 'rgba(20,184,166,.08)',  border: 'rgba(20,184,166,.25)',  shortKey: 'pattern.carry.short',          descKey: 'pattern.carry.desc' },
    'pattern.handstand':       { bg: 'rgba(139,92,246,.08)',  border: 'rgba(139,92,246,.25)',  shortKey: 'pattern.handstand.short',      descKey: 'pattern.handstand.desc' },
    'pattern.monostructural':  { bg: 'rgba(6,182,212,.08)',   border: 'rgba(6,182,212,.25)',   shortKey: 'pattern.monostructural.short', descKey: 'pattern.monostructural.desc' },
  };
}

function renderMovementPatternProfile(profile) {
  if (!profile) return;
  const { patternPct, dominantPattern } = profile;

  document.getElementById('energy-profile-section').classList.remove('hidden-el');

  const PATTERN_META = getPATTERNMETA();

  // Only show patterns that actually appeared in this session — with 9
  // categories instead of the old 4, showing every one (most at 0%,
  // since a typical session only touches a handful) would be cluttered
  // and not useful. A 0% pattern isn't "this session's bias toward X",
  // it's just absent.
  const sortedPatterns = Object.entries(PATTERN_META)
    .filter(([key]) => (patternPct[key] || 0) > 0)
    .sort((a, b) => (patternPct[b[0]] || 0) - (patternPct[a[0]] || 0));

  document.getElementById('bias-bars').innerHTML = sortedPatterns.map(([key, meta]) => `
    <div class="energy-bar-row">
      <div class="energy-bar-label">
        <span>${meta.label}</span>
        <span>${(patternPct[key] * 100).toFixed(1)}%</span>
      </div>
      <div class="energy-bar-track">
        <div class="energy-bar-fill" style="width:${(patternPct[key]*100).toFixed(1)}%;background:${meta.color};"></div>
      </div>
    </div>`).join('');

  // Dominant pattern label
  const biasDomEl = document.getElementById('bias-dominant-label');
  if (biasDomEl) biasDomEl.innerHTML = `<span>${PATTERN_META[dominantPattern]?.label || dominantPattern}-${t('energy.dominant.mid').replace(' ·','')}</span>`;

  // Deep-dive reference cards (flip card back) — only patterns
  // actually present in this session, in the exact same dominance
  // order as the front's bars/pie (sortedPatterns), so a core-dominant
  // session surfaces the Core definition first and patterns absent
  // from the session don't appear at all — mirrors the front's own
  // filtering (patternPct > 0) exactly, rather than showing a full
  // 9-pattern glossary regardless of what the session actually was.
  const deepDiveMeta = getPatternDeepDiveMeta();
  const orderedKeys = sortedPatterns.map(([key]) => key);
  const deepDiveEl = document.getElementById('pattern-deep-dive-cards');
  if (deepDiveEl) {
    deepDiveEl.innerHTML = orderedKeys.map(key => {
      const dd = deepDiveMeta[key];
      if (!dd) return '';
      return `<div style="background:${dd.bg};border:1px solid ${dd.border};border-radius:8px;padding:11px 12px;">
        <div style="font-size:.75rem;font-weight:800;color:${PATTERN_META[key]?.color || 'var(--text)'};margin-bottom:4px;" data-i18n="${dd.shortKey}">${t(dd.shortKey)}</div>
        <div style="font-size:.77rem;color:var(--label);line-height:1.65;" data-i18n="${dd.descKey}">${t(dd.descKey)}</div>
      </div>`;
    }).join('');
  }

  // Pattern pie chart — same filtered set as the bars, so the tooltip
  // never shows a 0% slice
  if (chartInstances.biasPie) { try { chartInstances.biasPie.destroy(); } catch(e) {} }
  chartInstances.biasPie = new Chart(document.getElementById('chart-bias-pie'), {
    type: 'doughnut',
    data: {
      labels: sortedPatterns.map(([, meta]) => meta.label),
      datasets: [{
        data: sortedPatterns.map(([key]) => (patternPct[key] || 0) * 100),
        backgroundColor: sortedPatterns.map(([, meta]) => meta.color + 'CC'),
        borderColor:     sortedPatterns.map(([, meta]) => meta.color),
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw.toFixed(1)}%` } }
      }
    }
  });
}
