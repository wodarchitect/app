/* ════════════════════════════════════════════════════
   PHYSICS RECONSTRUCTION
   Re-derives physics values from a saved history entry (or
   live builder state) rather than trusting stored fields
   directly — powers history/analytics display, the eRaw
   calculation, and Movement Pattern reconstruction.
════════════════════════════════════════════════════ */

function recalculateOverheadForVo2max(correctedVo2max) {
  const hist = getHistory();
  const sorted = [...hist].sort((a, b) => new Date(a.date) - new Date(b.date));
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;

  let updated = 0;
  const changedEntries = [];
  const attemptedEntries = [];

  sorted.forEach(w => {
    if (Number(w.vo2max_used) === Number(correctedVo2max)) return; // already correct
    const overheadOld = parseFloat(w.mc_overhead) || 0;
    if (!overheadOld) return; // no overhead was ever computed for this session — nothing to correct
    const mechKcal = parseFloat(w.mc_mech) || 0;
    const cardioKcal = parseFloat(w.mc_aero) || 0;
    const mcOld = parseFloat(w.mc) || (mechKcal + cardioKcal + overheadOld);
    const fbOld = parseFloat(w.fb) || 0;
    const durSec = parseFloat(w.duration_sec) || 0;
    const bw = parseFloat(w.bw) || 0;
    const rpe = parseFloat(w.rpe) || 0;
    if (!fbOld || !mcOld || !durSec || !bw || !rpe) { w.vo2maxAttempted = correctedVo2max; attemptedEntries.push(w); return; } // missing prerequisites — can't recompute safely, mark as attempted so the button doesn't keep asking

    const relIntensity = Math.min(1.0, rpe / 10);
    const vo2Session = relIntensity * correctedVo2max;
    const met = vo2Session / 3.5;
    const timeHours = durSec / 3600;
    const totalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
    const overheadNew = Math.max(0, Math.round(totalMetEstimate - mechKcal - cardioKcal));
    const mcNew = mechKcal + cardioKcal + overheadNew;

    w.mc_overhead = overheadNew;
    w.mc = mcNew.toFixed(0);
    // FB is intentionally untouched here — see migrateOverheadReference()
    // for the same reasoning: FB no longer depends on Overhead at all.
    w.vo2max_used = correctedVo2max;
    updated++;
    changedEntries.push(w);
  });

  return { updated, changedEntries, attemptedEntries, hist };
}

// One-time historical fix: your VO2max was originally logged as 41 (a rough
// guess), later corrected to 34 after a real test. Every session computed
// with the wrong value gets corrected — no date needed, since 34 was true
// the whole time.
// Shows the Correction-vs-Real-change decision when VO2max is manually
// changed from one real value to a different one. No default is pre-selected
// — the person has to actively choose, since guessing wrong in either
// direction has a real cost (a genuine change treated as history-rewriting,
// or an error left uncorrected in every past comparison).
function showVo2maxChangeModal(oldVal, newVal) {
  const modal = document.getElementById('vo2max-change-modal');
  if (modal) modal.style.display = 'flex';
}

function handleVo2maxChangeChoice(choice) {
  const modal = document.getElementById('vo2max-change-modal');
  if (modal) modal.style.display = 'none';
  if (choice === 'correction') {
    // Reuses the same recalculation used for the one-time historical fix —
    // it already reads the current (new) VO2max value from the profile field.
    migrateVo2maxCorrection();
  }
  // 'real' needs no action: history already correctly keeps its old values,
  // and any session saved from now on will naturally use the new VO2max
  // (captured fresh each calculation via window._lastVo2max).
}

// Movement name -> bias, for cardio movements only. Mirrors MASTER_DB's
// cardio-tagged entries; used to attribute a session's already-stored
// mc_aero to the correct bias bucket during migration, since historical
// entries don't have the live pace-based per-movement breakdown.
const CARDIO_BIAS_MAP = {
  'Double-under': 'metabolic', 'Jump Rope (per 10 reps)': 'metabolic',
  'Run (per 100m)': 'endurance', 'Row (per 100m)': 'endurance',
  'Ski Erg (per 100m)': 'endurance', 'Assault Bike (per cal)': 'endurance',
  'Echo Bike (per cal)': 'endurance'
};

// Parses "Result: N rounds + M extra" from the detail text for a specific
// block. Some historical sessions never had result.r/x persisted into the
// structured blocks[].result field, but the same information was always
// written into detail as human-readable text — this recovers the exact
// original value rather than estimating it.
// Parses "Aggregate Time: MM:SS" from the detail text — the true total
// session duration across all blocks. More reliable than the time-cap
// fallback used when result/roundSplits are both missing, which turned out
// to be inconsistent for multi-block sessions (sometimes badly
// understating duration, sometimes badly overstating it).
function parseAggregateTime(detail) {
  if (!detail) return null;
  const match = detail.match(/Aggregate Time:\s*(\d+):(\d+)/i);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

// Recomputes a session's true duration, preferring the precise Aggregate
// Time from detail over the existing (possibly cap-based, unreliable)
// stored duration_sec.
function reconstructDuration(entry) {
  const fromDetail = parseAggregateTime(entry.detail);
  if (fromDetail != null) return fromDetail;
  return parseFloat(entry.duration_sec) || 0;
}

function parseResultFromDetail(detail, blockIndex) {
  if (!detail) return null;
  const blockChunks = detail.split('---');
  const chunk = blockChunks[blockIndex];
  if (!chunk) return null;
  const match = chunk.match(/Result:\s*(\d+)\s*rounds?\s*\+\s*(\d+)\s*extra/i);
  if (!match) return null;
  const result = { r: parseInt(match[1]) || 0, x: parseInt(match[2]) || 0 };
  // Time wasn't previously extracted here at all — only rounds/extra —
  // which meant any block relying on this fallback (no stored result
  // object, older sessions) silently had no time data available to
  // reconstructDurationSec's fortime/emom/exmom branches, defaulting to
  // 0 seconds for that block. The detail text already contains it
  // ("Result: N rounds + M extra | Time: MM:SS"), just unparsed.
  const timeMatch = chunk.match(/Time:\s*(\d+):(\d+)/i);
  if (timeMatch) {
    result.m = parseInt(timeMatch[1]) || 0;
    result.s = parseInt(timeMatch[2]) || 0;
  }
  return result;
}

// Recomputes RL (Relative Loading) from a stored history entry's raw
// blocks, using the current profile's 1RM values and the now-corrected
// RM_MAP (barbell movements only). Uses your CURRENT 1RM values, not
// whatever they were at the time each session was logged — a reasonable
// simplification, since 1RMs generally don't shift as sharply as
// bodyweight can, but worth knowing this isn't a perfect historical
// reconstruction for older sessions if your strength has changed a lot.
// Recomputes mechanical work (kJ) and tonnage from a stored history
// entry's raw blocks, using a specified bodyweight and the athlete's
// CURRENT range-of-motion measurements. Tonnage (weight x reps) is
// bodyweight-independent and included for completeness, but doesn't
// actually change — only the bodyweight-involvement term in the work
// formula does.
function reconstructMechanicalWork(entry, bw, hMetres) {
  let totalWorkKJ = 0, totalTonnage = 0, loadedWorkKJ = 0, unloadedWorkKJ = 0, totalMechCostKJ = 0, totalReps = 0;
  const mechCostByBlock = {}; // per-block mechCostKJ — Phase 2's historical overhead reconstruction needs this alongside the existing session-wide totalMechCostKJ
  const workByMovement = {}; // { movementName: { workKJ, reps } } — aggregated by name across every block in the session, not per-block, since the same movement can appear in more than one block and callers want one number per movement for the whole session
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; }
    }
    let ep = x;
    (block.movements || []).forEach(mv => {
      const p = MASTER_DB[mv.name];
      if (!p || p.cardio) return; // cardio doesn't contribute to mechanical work
      const wt = parseFloat(mv.kg) || 0;
      const pres = parseFloat(mv.reps) || 0;
      let reps;
      if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = (block.movements || []).length || 1;
        const stationRounds = Math.floor(r / stationCount);
        reps = pres * Math.max(1, stationRounds);
      } else {
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
      }
      // Bar-path ROM (external weight) and personalized bodyweight-CoM ROM
      // are now separate terms — a barbell on the back/shoulders travels a
      // different distance than the whole-body CoM average does. Falls
      // back to the same bar-path value + p.bw for movements
      // getPersonalizedBodyweightROM doesn't yet cover (only squat-pattern
      // and Deadlift so far), preserving existing behavior everywhere
      // else. When the personalized calculation IS available, its own
      // massFraction replaces p.bw entirely — mixing the two would
      // double-count/misrepresent mass, since massFraction is already
      // baked into how the rom value itself was derived.
      const barPathRom = getAthleteROM(mv.name || '', p, hMetres);
      const bwPersonal = getPersonalizedBodyweightROM(mv.name || '', hMetres);
      const bwRom = bwPersonal ? bwPersonal.rom : barPathRom;
      const bwMassFrac = bwPersonal ? bwPersonal.massFraction : p.bw;
      const concentricWork = ((wt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;

      // wd (drives Power) and mc_mech (metabolic-cost-equivalent) now use
      // DIFFERENT eligibility rules for eccentric credit — this is a
      // deliberate split, not the same "eccentricEligible" flag applied to
      // both as before.
      //
      // wd (drives Power) is now ALWAYS pure concentric, unconditionally,
      // for EVERY movement — cyclical and one-directional alike. This
      // supersedes the earlier cyclical=x2/one-directional=x1 split: that
      // asymmetry never actually resolved genuine uncertainty for cyclical
      // movements the way it did for one-directional ones, since a
      // cyclical movement's eccentric phase always happens unconditionally
      // (no dropped-vs-controlled choice exists for e.g. Back Squat) — so
      // giving it credit "because time can't tell us otherwise" was
      // inconsistent with the one-directional rule's own logic. wd/Power
      // now measures a single, uniform thing: the rate of productive,
      // directional work (moving load up) — not the full bidirectional
      // cycle — for every movement, without exception.
      const workMultiplier = 1;

      // mc_mech: NOW reads the per-movement-instance "controlled descent"
      // toggle instead of RL — a genuine athlete self-report, replacing
      // the RL-based inference entirely (see memory-recorded settled
      // design v2). Cyclical movements are unaffected — always full
      // credit, no toggle to read. mv.controlledDescent defaults to true
      // for historical sessions saved before this field existed.
      const eccentricEligible = !p.oneDir || mv.controlledDescent !== false;
      const mechCostMultiplier = eccentricEligible ? (7/6) : 1;

      const work = concentricWork * workMultiplier;
      const mechCost = concentricWork * mechCostMultiplier;

      totalWorkKJ += work;
      totalMechCostKJ += mechCost;
      mechCostByBlock[blockIndex] = (mechCostByBlock[blockIndex] || 0) + mechCost;
      const mvName = mv.name || 'Unknown';
      if (!workByMovement[mvName]) workByMovement[mvName] = { workKJ: 0, reps: 0 };
      workByMovement[mvName].workKJ += work;
      workByMovement[mvName].reps += reps;
      totalTonnage += wt * reps;
      if (reps > 0) totalReps += reps;
      if (wt > 0) { loadedWorkKJ += work; } else { unloadedWorkKJ += work; }
    });
  });

  // Cardio's mechanical work — see getCardioWorkBreakdown() for the
  // Row/Ski-vs-Run/DU split rationale. All types count toward workKJ
  // (Power); only Row/Ski's validated portion moves into mechCostKJ and
  // the returned cardioCarvedKcal (which the caller subtracts from
  // mc_aero) — Run/DU's raw kJ contributes to Power but never converts
  // to a kcal figure that moves between mc_aero/mc_mech.
  const cardioBreakdown = getCardioWorkBreakdown(getSessionCardioInstances(entry), bw);
  totalWorkKJ += cardioBreakdown.totalWorkKJ;
  totalMechCostKJ += cardioBreakdown.metabolicCarveKJ;
  const cardioCarvedKcal = (cardioBreakdown.metabolicCarveKJ / 4.184) / 0.22;

  return { workKJ: totalWorkKJ, tonnage: totalTonnage, loadedWorkKJ, unloadedWorkKJ, mechCostKJ: totalMechCostKJ, totalReps, mechCostByBlock, cardioCarvedKcal, workByMovement };
}

// ══ eRaw modality classification (Session Coverage Workbench) ══
// ModalityClass is based on real external work output, not a telemetry
// tag — Row/Ski have real W_ext and count as MIXED; Run/DU have zero
// W_ext by deliberate decision and count as LOCO, using a throughput
// measure instead of work for their efficiency ratio.
//
// LOCO further splits into LOCO_RUN (distance-based, m/s) vs LOCO_DU
// (rep-based, reps/s) — these are different units and must never be
// compared against each other, or an eRaw comparison would be
// comparing apples to oranges. Distance takes priority if a session has
// both real running and DU — matches getEngineScoreERaw's own priority
// order.
function getEngineScoreModalityClass(workKJ, hasRunDistance, hasDuReps) {
  if (workKJ > 0) return 'MIXED';
  if (hasRunDistance) return 'LOCO_RUN';
  if (hasDuReps) return 'LOCO_DU';
  return null; // neither present — can't classify at all
}

// ══ eRaw calculation (Session Coverage Workbench) ══
// eRaw (MIXED, W_ext > 0):        W_ext (kJ) / Cardio Strain (MET-min)
// eRaw (LOCO_RUN, distance > 0):  Distance (m) / Cardio Strain (MET-min)
// eRaw (LOCO_DU, reps > 0):       Reps / Cardio Strain (MET-min) — not
//   part of the two archetypes the athlete specified (Hybrid/Strength,
//   Pure Cardio-by-distance); extended the same distance/MET-min pattern
//   to reps since DU has no meters to measure, kept in its own bucket so
//   it's never compared against LOCO_RUN's different unit.
// Entry-compatible — works for both historical backfill and live use,
// same pattern as reconstructMechanicalWork/getSessionCVEndurance.
//
// Throughput fallback: real running distance takes priority when a
// session has both running and DU (matches getEngineScoreModalityClass's
// own priority order) — DU's reps aren't blended into a run's velocity,
// they only get used when there's no distance-based movement to measure
// at all. This closes the earlier gap where a pure-DU LOCO session had
// no measurable throughput and silently returned null — it now uses
// reps instead, its own distinct bucket (LOCO_DU) keeping it from ever
// being compared against LOCO_RUN's different units.
// Mechanical-segment-specific MET-minutes — the harder half of the
// segmented efficiency metrics (Work/Running/DU Efficiency). Mirrors
// _computeBlockOverheadAndCV's live segment-level logic, but works
// from entry.blockSegments (saved per-segment HR/RPE data) instead of
// live DOM state.
//
// Two genuinely different cases per block, matching what
// entry.blockSegments actually preserves:
//  - Real segmentation (any real HR anywhere in the block): a
//    type:'mechanical' segment exists on its own, with either real HR
//    (source:'hr_segment') or no usable signal (source:'no_hr', which
//    contributes nothing — same "don't guess" rule
//    _computeBlockOverheadAndCV already applies). This case gives a
//    genuine, block-specific mechanical MET-minutes contribution.
//  - Whole-block RPE fallback (no real HR anywhere in the block): the
//    saved data is ONE undifferentiated type:'block' segment covering
//    the block's whole RPE-estimated effort — mechanical and cardio
//    time were never separated when this was saved, so there's no way
//    to split it back apart now. If the block has no cardio movements
//    at all, its whole estimate safely belongs to mechanical (nothing
//    else it could be). If it DOES have cardio movements but wasn't
//    HR-tracked, this block's contribution is excluded from the
//    segmented total entirely, rather than guessed — it still counts
//    toward Overall Efficiency (via the existing, unchanged
//    getEngineScoreERaw), just not toward the mechanical-specific
//    breakdown.
// Unified with Overall Efficiency's own calculation (_computeBlockOverheadAndCV,
// physics-core.js) rather than a second, independent formula — proven
// algebraically identical (bodyweight/age-factor/gender-factor cancel
// completely in the round-trip from kcal-equivalent back to
// MET-minutes, leaving plain met×time either way), so this was two
// implementations of the same math that could silently drift apart if
// one got touched later and the other didn't. Passing 0 for both
// blockMechKcal and blockCardioKcalTotal isolates just the mechanical
// segment's own contribution to cv, ignoring the overhead figure
// entirely (not needed here) and any cardio contribution (handled
// separately by getCardioTypeMetMinutes for Running/DU Efficiency).
function getMechanicalSegmentMetMinutes(entry, bw, vo2max, ageFactor, genderFactor) {
  if (!vo2max || !bw) return null;
  const blockSegments = entry.blockSegments;
  if (!Array.isArray(blockSegments) || !blockSegments.length) return null;
  const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
  const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;

  let metMinutes = 0;
  let anyContribution = false;

  blockSegments.forEach((segments, blockIndex) => {
    if (!Array.isArray(segments) || !segments.length) return;

    if (segments.length === 1 && segments[0].type === 'block') {
      // Whole-block RPE fallback — only attributable if this block has
      // no cardio movements to have possibly mixed in.
      const block = (entry.blocks || [])[blockIndex];
      const hasCardioMov = block && (block.movements || []).some(mv => MASTER_DB[mv.name]?.cardio);
      if (hasCardioMov) return; // indeterminate split — excluded, not guessed
    }

    const result = _computeBlockOverheadAndCV(segments, 0, 0, bw, vo2max, ageFactor, genderFactor, hrRestVal, hrMaxVal);
    if (result.cv > 0) {
      metMinutes += result.cv * 60 / (bw * ageFactor * genderFactor);
      anyContribution = true;
    }
  });

  return anyContribution ? metMinutes : null;
}

// Segmented efficiency trio for a saved entry — Work/Running/DU
// Efficiency, each numerator over only its own segment's MET-minutes.
// Distinct from getEngineScoreERaw (Overall Efficiency), which always
// uses the whole session's MET-minutes regardless of modality mix.
function getSegmentedEfficiency(entry) {
  const bw = parseFloat(entry.bw) || 0;
  if (!bw) return { workEff: null, runEff: null, duEff: null, workMetMin: null, runMetMin: null, duMetMin: null, runIsEstimate: false, duIsEstimate: false, workIsEstimate: false };
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const vo2max = parseFloat(entry.vo2max_used) || parseFloat(entry.vo2maxAttempted) || 0;

  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  const { workKJ } = reconstructMechanicalWork(entry, bw, hMetres);
  let mechMetMinutes = getMechanicalSegmentMetMinutes(entry, bw, vo2max, ageFactor, genderFactor);
  let workIsEstimate = false;

  // Running/DU Efficiency now include PR-pace-estimated instances, not
  // just real toggle-recorded ones — a session without a real toggle
  // time shouldn't lose this metric entirely when every other cardio
  // figure in the app (kcal, MET, %HRR) already falls back to a PR-pace
  // estimate rather than going blank. runIsEstimate/duIsEstimate flag
  // when ANY contributing instance was estimated, so the UI can label
  // it accordingly rather than presenting an estimate as measured.
  const { metMinutesByType, allRealByType } = getCardioTypeMetMinutes(entry, bw, gender);
  let runM = 0, duReps = 0;
  getSessionCardioInstances(entry).forEach(inst => {
    if (inst.cardioType === 'run') runM += inst.totalM;
    if (inst.cardioType === 'du') duReps += inst.totalM; // totalM is a rep count for DU, not meters
  });
  const runMetMinutes = metMinutesByType.run || 0;
  const duMetMinutes = metMinutesByType.du || 0;
  const runEff = (runM > 0 && runMetMinutes > 0) ? runM / runMetMinutes : null;
  const duEff = (duReps > 0 && duMetMinutes > 0) ? duReps / duMetMinutes : null;
  const runIsEstimate = runEff != null && allRealByType.run === false;
  const duIsEstimate = duEff != null && allRealByType.du === false;

  // Residual fallback — only when the direct segment-level calculation
  // above genuinely couldn't attribute anything despite real mechanical
  // work existing (workKJ > 0): a mixed block that never got real
  // per-segment HR falls back to one undifferentiated whole-block RPE
  // estimate, and getMechanicalSegmentMetMinutes correctly refuses to
  // guess how much of that blended number was mechanical versus cardio
  // (see its own "indeterminate split" comment). But the session's own
  // total MET-minutes (getSessionCVEndurance, Overall Efficiency's
  // denominator) already includes that block's contribution as part of
  // its whole — so subtracting the cleanly-known running/DU MET-minutes
  // from the session total gives a reasonable implied mechanical share,
  // anchored to the athlete's own overall RPE-implied effort rather
  // than an arbitrary time- or kcal-proportional guess. Always labeled
  // an estimate, since it genuinely is one — it's the same starting
  // number the excluded block's own RPE already blended together, just
  // read from the other direction.
  if ((mechMetMinutes == null || mechMetMinutes <= 0) && workKJ > 0) {
    const cvResult = getSessionCVEndurance(entry);
    if (cvResult && cvResult.metMinutes > 0) {
      const residual = cvResult.metMinutes - runMetMinutes - duMetMinutes;
      if (residual > 0) { mechMetMinutes = residual; workIsEstimate = true; }
    }
  }
  const workEff = (workKJ > 0 && mechMetMinutes > 0) ? workKJ / mechMetMinutes : null;

  // Raw MET-minute values, not just the derived efficiency ratios —
  // shown alongside each ratio in the UI so the segmented split itself
  // (how much of the session's total strain came from mechanical vs
  // running vs DU specifically) is visible, not just its downstream
  // effect on efficiency. null (not 0) whenever the matching
  // efficiency figure is also null, so the UI's existing "only show a
  // row when computable" check works for both without a separate one.
  return {
    workEff, runEff, duEff,
    workMetMin: workEff != null ? mechMetMinutes : null,
    runMetMin: runEff != null ? runMetMinutes : null,
    duMetMin: duEff != null ? duMetMinutes : null,
    runIsEstimate, duIsEstimate, workIsEstimate: workEff != null && workIsEstimate
  };
}


function getEngineScoreERaw(entry) {
  const bw = parseFloat(entry.bw) || 0;
  const totalSec = parseFloat(entry.duration_sec) || 0;

  if (!bw || !totalSec) return null;

  const cvResult = getSessionCVEndurance(entry);
  if (!cvResult || !cvResult.met || !cvResult.metMinutes) return null; // no Average METs or Cardio Strain available — can't compute any branch

  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  const { tonnage, workKJ: workKJEstimated } = reconstructMechanicalWork(entry, bw, hMetres);

  // Sensor-measured mechanical work (WitMotion VBT pod) is authoritative
  // for eRaw's numerator specifically when the pod tracked this session
  // (entry.vbt_work_kj, saved alongside entry.wd — the estimate — at
  // save time, never overwriting it). workKJEstimated above is always
  // computed regardless, both as the fallback when the pod wasn't used
  // and so it's always available for comparison against the sensor
  // value later (sensor calibration drift, ROM degradation trends) —
  // Force Bias below deliberately keeps using workKJEstimated, not
  // this: tonnage/estimated-ROM is Force Bias's own established
  // convention and wasn't part of this change.
  const usingSensorWork = entry.vbtUsed && entry.vbt_work_kj != null && entry.vbt_work_kj > 0;
  const workKJ = usingSensorWork ? entry.vbt_work_kj : workKJEstimated;

  let runMeters = 0, runSec = 0, duReps = 0, duSec = 0;
  getSessionCardioInstances(entry).forEach(inst => {
    if (inst.cardioType === 'run') { runMeters += inst.totalM; runSec += inst.secs; }
    if (inst.cardioType === 'du') { duReps += inst.totalM; duSec += inst.secs; } // totalM is a rep count for DU, not meters
  });
  const modality = getEngineScoreModalityClass(workKJ, runMeters > 0 && runSec > 0, duReps > 0 && duSec > 0);
  if (!modality) return null; // nothing measurable at all

  if (modality === 'MIXED') {
    const eRaw = workKJ / cvResult.metMinutes;
    const forceBias = tonnage / workKJEstimated;
    return { eRaw, modality, forceBias, totalSec, workKJ, workKJEstimated, usingSensorWork, metMinutes: cvResult.metMinutes };
  }
  if (modality === 'LOCO_RUN') {
    return { eRaw: runMeters / cvResult.metMinutes, modality, forceBias: null, totalSec, workKJ, workKJEstimated, usingSensorWork, metMinutes: cvResult.metMinutes };
  }
  // LOCO_DU
  return { eRaw: duReps / cvResult.metMinutes, modality, forceBias: null, totalSec, workKJ, workKJEstimated, usingSensorWork, metMinutes: cvResult.metMinutes };
}

// Display helper for the eRaw banner (History Modal, and anywhere else
// that wants the same hero value + unit + plain-English sentence rather
// than the raw {eRaw, modality, ...} object) — one place that maps
// modality to its unit label and sentence, so the banner and any future
// consumer can't drift out of sync with each other.
function getERawDisplay(entry) {
  const r = getEngineScoreERaw(entry);
  if (!r) return null;
  if (r.modality === 'MIXED') {
    const sourceNote = r.usingSensorWork ? ' (sensor-measured)' : '';
    return { value: r.eRaw, unitLabel: 'kJ / MET-min', sentence: `Every MET-min yielded ${r.eRaw.toFixed(2)} kJ of mechanical work${sourceNote}.` };
  }
  if (r.modality === 'LOCO_RUN') {
    return { value: r.eRaw, unitLabel: 'm / MET-min', sentence: `Every MET-min yielded ${r.eRaw.toFixed(1)} meters of distance.` };
  }
  // LOCO_DU — not one of the two specified archetypes; same pattern, reps instead of meters.
  return { value: r.eRaw, unitLabel: 'reps / MET-min', sentence: `Every MET-min yielded ${r.eRaw.toFixed(1)} reps.` };
}

// Captures this session's eRaw (and the two absolute physics values it
// was derived from) onto the entry at save time. This replaced Engine
// Score's bucket/percentile scoring system entirely once the Session
// Coverage Workbench shipped as its permanent, physics-backed
// replacement — no bucketing, no stored max, no comparison against a
// prior best. Just the raw numbers, always independently verifiable.
function _updateERawForEntry(entry) {
  try {
    const result = getEngineScoreERaw(entry);
    if (!result) {
      entry.eRaw = null; entry.mechanicalWorkKJ = null; entry.cardioStrainMetMin = null;
      return;
    }
    entry.eRaw = result.eRaw;
    entry.mechanicalWorkKJ = result.workKJ;
    entry.cardioStrainMetMin = result.metMinutes;
  } catch (e) {
    entry.eRaw = null; entry.mechanicalWorkKJ = null; entry.cardioStrainMetMin = null;
  }
}

// One-time migration: recomputes the stored per-session radar snapshot
// (w.radar) for sessions saved before the axis change (mc/rl ->
// cvIntensity/internalLoad). Only touches sessions that would actually
// show the Signature card (sessionHasRadar(w) — the same profile-unlock
// gate the live display already uses) and whose stored radar predates
// the new schema (_v < 3 or missing entirely) — recompute, save
// locally, re-push changed entries to Supabase.

function getCardioMechanicalWorkKJ(cardioType, totalM, secs, bw) {
  if (secs <= 0 || totalM <= 0 || !bw) return 0;
  if (cardioType === 'row' || cardioType === 'ski') {
    const splitSecPer500m = 500 / (totalM / secs);
    if (splitSecPer500m <= 0) return 0;
    const watts = 2.80 / Math.pow(splitSecPer500m / 500, 3);
    return (watts * secs) / 1000;
  } else if (cardioType === 'run') {
    const heightM = parseFloat(document.getElementById('global-h')?.value) / 100 || 1.78; // falls back cleanly if unset
    const v = totalM / secs; // m/s
    const heightScale = Math.sqrt(heightM / 1.78);
    const baseCadence = 130 + (11.5 * v);
    const cadenceSpm = baseCadence / heightScale;
    const totalSteps = cadenceSpm * (secs / 60);
    const baseOscillationM = 0.11 - (0.01 * v);
    const oscillationM = Math.max(0.05, baseOscillationM * heightScale);
    return (totalSteps * bw * 9.81 * oscillationM) / 1000;
  } else if (cardioType === 'du') {
    const duRPM = parseFloat(document.getElementById('pr-du')?.value) || 0;
    if (!duRPM) return 0;
    const cycleTimeSec = 60 / duRPM;
    const airTimeSec = 0.35 * cycleTimeSec;
    const jumpHeightM = (9.81 * airTimeSec * airTimeSec) / 8;
    return (bw * 9.81 * jumpHeightM * totalM) / 1000; // totalM is a rep count here (cardioRef=1), not meters
  }
  return 0; // bike — no time-based formula exists yet, flagged separately this morning
}

// Splits cardio's mechanical work into two totals:
// - totalWorkKJ: ALL cardio types (Row/Ski/Run/DU) — this is pure
//   physics (mass x g x displacement, or Row/Ski's real watts x time),
//   no efficiency conversion involved, so it's trustworthy for Power's
//   numerator regardless of movement type.
// - metabolicCarveKJ: Row/Ski ONLY — the portion safe to convert to a
//   kcal-equivalent and move from mc_aero into mc_mech. Row/Ski's watts
//   and kcal both come from the same validated Concept2 pipeline, so
//   moving a slice between buckets doesn't create an inconsistency.
//   Run/DU were REMOVED from this after a real session showed their
//   mgh-based mechanical estimate, converted via the generic 22%
//   muscular-efficiency factor, exceeded the movement's own total
//   validated metabolic cost (ACSM VO2 pace formula) — physiologically
//   impossible, since mechanical work must be a subset of total cost,
//   never exceed it. Root cause: that 22% conversion assumes muscles pay
//   the full cost of the vertical displacement, but running's elastic
//   tendon recoil returns a real portion of that energy for free — a
//   cost real for Row/Ski's ergometer-measured wattage too, but not
//   double-derived from an unvalidated efficiency assumption the way
//   Run/DU's carve-out was.
//
// totalWorkKJ is now ALSO Row/Ski only — Run/DU dropped out of Power's
// numerator entirely too, by deliberate decision: if the underlying
// mgh-based estimate wasn't trustworthy enough for the kcal split, the
// same estimate (population-default height-scaling, unvalidated cadence
// coefficients) isn't trustworthy enough to claim as "pure physics" for
// Power either, even though no efficiency conversion is involved there.
// getCardioMechanicalWorkKJ()'s run/du branches are left fully intact
// and callable — real, previously-validated research (the cadence
// formula checked against published ranges, the DU air-time physics
// confirmed to the centimeter) — just not aggregated into anything that
// reaches Power or Metabolic Cost anymore, in case a better-grounded
// conversion for elastic-assisted movements surfaces later.
function getCardioWorkBreakdown(instances, bw) {
  let totalWorkKJ = 0;
  instances.forEach(inst => {
    if (inst.cardioType === 'row' || inst.cardioType === 'ski') {
      totalWorkKJ += getCardioMechanicalWorkKJ(inst.cardioType, inst.totalM, inst.secs, bw);
    }
  });
  return { totalWorkKJ, metabolicCarveKJ: totalWorkKJ }; // identical now — Row/Ski is the only contributor to either
}

function getSessionCardioInstances(entry) {
  const run400 = parseFloat(document.getElementById('pr-run400')?.value) || 0;
  const run5k  = parseFloat(document.getElementById('pr-run5k')?.value) || 0;
  const row500 = parseFloat(document.getElementById('pr-row500')?.value) || 0;
  const row2k  = parseFloat(document.getElementById('pr-row2k')?.value) || 0;
  const ski500 = parseFloat(document.getElementById('pr-ski500')?.value) || 0;
  const duRPM  = parseFloat(document.getElementById('pr-du')?.value) || 0;

  // Linear-scaled time for a given total distance, choosing the PR by
  // per-instance distance (not the total) — mirrors estimateRunSecs()/
  // estimateRowSecs()'s existing threshold logic, just swapping Riegel's
  // (target/ref)^1.06 for a plain (target/ref) ratio.
  function linearSecs(cardioType, perInstanceM, totalM) {
    if (cardioType === 'run') {
      if (perInstanceM <= 600) {
        if (!run400) return null;
        return (totalM / 400) * run400;
      } else {
        if (!run5k) return null;
        return (totalM / 5000) * run5k;
      }
    } else if (cardioType === 'row') {
      if (perInstanceM < 800) {
        if (!row500) return null;
        return (totalM / 500) * row500;
      } else {
        if (!row2k) return null;
        return (totalM / 2000) * row2k;
      }
    } else if (cardioType === 'ski') {
      // Same linear-not-Riegel convention as Run/Row above, off the one
      // reference (500m split) getCardioEnergy() also uses for Ski.
      if (!ski500) return null;
      return (totalM / 500) * ski500;
    } else if (cardioType === 'du') {
      // No distance/pacing concept for DU — a straight cadence rate
      // (reps / reps-per-minute), same formula getCardioEnergy() already
      // uses for DU's own kcal calculation, kept here as the single
      // source both draw from rather than a second, possibly-diverging copy.
      if (!duRPM) return null;
      return (totalM / duRPM) * 60; // totalM is a rep count here, not meters — cardioRef=1 for DU
    }
    return null;
  }

  const instances = [];
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; }
    }
    const allMovements = block.movements || [];
    const cardioMovements = allMovements.filter(mv => ['run', 'row', 'ski', 'du', 'bike', 'cycle'].includes(MASTER_DB[mv.name]?.cardio));
    const isSingleCardioForTime = mode === 'fortime' && allMovements.length === 1 && cardioMovements.length === 1;
    if (isSingleCardioForTime) {
      const actualSec = (parseFloat(block.result?.m) || 0) * 60 + (parseFloat(block.result?.s) || 0);
      if (actualSec > 0) {
        const p = MASTER_DB[cardioMovements[0].name];
        const ref = p.cardioRef || 1;
        const pres = parseFloat(cardioMovements[0].reps) || 0;
        instances.push({ cardioType: p.cardio, totalM: pres * ref, secs: actualSec, isReal: true, blockIndex });
        return;
      }
    }

    let ep = x;
    allMovements.forEach(mv => {
      const p = MASTER_DB[mv.name];
      if (!p) return;
      const cardioType = p.cardio;
      const pres = parseFloat(mv.reps) || 0;
      // Every movement in the rotation consumes its share of the partial
      // round (ep) in sequence, regardless of cardio/non-cardio — ep
      // represents how far into the prescribed order the athlete actually
      // got, and every movement they passed through on the way there
      // consumes part of it, not just the ones this function cares about.
      let reps;
      if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = allMovements.length || 1;
        const stationRounds = Math.floor(r / stationCount);
        reps = pres * Math.max(1, stationRounds);
      } else {
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
      }
      if (!['run', 'row', 'ski', 'du', 'bike', 'cycle'].includes(cardioType)) return; // not a movement this function tracks time for
      if (reps <= 0) return;
      const ref = p.cardioRef || 1;
      const perInstanceM = pres * ref;
      const totalM = reps * ref;
      // Real, live-recorded duration takes priority over the PR-based
      // estimate whenever it exists for this exact (block, movement)
      // combination — entry.cardioIntervalSummary is only populated
      // going forward from tonight, so older sessions still fall
      // through to the estimate below, same as before.
      const realKey = `${blockIndex}_${cardioType}`;
      const realSecs = entry.cardioIntervalSummary ? entry.cardioIntervalSummary[realKey] : null;
      if (realSecs != null) {
        instances.push({ cardioType, totalM, secs: realSecs, isReal: true, blockIndex });
        return;
      }
      // Bike has no PR-based pace to estimate from (calories aren't a
      // pace concept the way distance/cadence are) — without real
      // recorded time, there's nothing to fabricate an instance from at
      // all, so it's correctly omitted rather than guessed.
      if (cardioType === 'bike') return;
      const est = linearSecs(cardioType, perInstanceM, totalM);
      if (est != null) instances.push({ cardioType, totalM, secs: est, isReal: false, blockIndex });
    });
  });
  return instances;
}

function getSessionCardioTimeSec(entry) {
  return getSessionCardioInstances(entry).reduce((sum, inst) => sum + inst.secs, 0);
}

// Real per-movement pace/cadence/cal-min for the History Modal's log
// table — same _fmtCardioPace formatter the live Audit Trail uses (see
// physics-core.js), fed from getSessionCardioInstances' real instances
// only (inst.isReal — never a PR-based estimate). Multiple instances of
// the same (block, cardioType) — e.g. two separate DU stations — are
// summed before formatting, matching how the live Audit Trail's
// _liveCardioRealSecs aggregates toggle intervals. Returns
// {"blockIndex_cardioType": "1:58/500m", ...}, empty object if no real
// cardio toggle data exists on this entry.
function getHistoryCardioPaceMap(entry) {
  const totals = {}; // "blockIndex_cardioType" -> { totalM, secs, cardioType }
  getSessionCardioInstances(entry).forEach(inst => {
    if (!inst.isReal) return;
    const key = `${inst.blockIndex}_${inst.cardioType}`;
    if (!totals[key]) totals[key] = { totalM: 0, secs: 0, cardioType: inst.cardioType };
    totals[key].totalM += inst.totalM;
    totals[key].secs += inst.secs;
  });
  const paceByKey = {};
  Object.keys(totals).forEach(key => {
    const { totalM, secs, cardioType } = totals[key];
    const paceStr = (typeof _fmtCardioPace === 'function') ? _fmtCardioPace(cardioType, totalM, secs) : '';
    if (paceStr) paceByKey[key] = paceStr;
  });
  return paceByKey;
}

// Cardiovascular Endurance — CrossFit's actual GPP skill definition:
// efficiency of oxygen delivery/utilization, which is happening
// continuously through a session, not just during movements tagged
// "cardio." Earlier version of this metric (kept as getSessionAeroPower
// in git history) only counted cardio-movement kcal — missing that
// mc_overhead already exists specifically to capture the aerobic cost of
// everything else (barbell/gymnastics work has real cardiovascular
// demand that pure force x distance never sees).
//
// CV kcal[block] = blockCardioKcal[block] + (block is 100% cardio ? 0 : blockOverhead[block])
// CardiovascularEndurance (MET) = sum(CV kcal) / (bw x totalTimeHours x ageFactor x genderFactor)
//
// Two deliberate choices:
// - mc_mech stays OUT entirely — its kcal is a fixed 22%-efficiency
//   conversion of pure physics, not an oxygen-consumption estimate, and
//   heavy lifting is often substantially anaerobic. Including it would
//   conflate two different GPP skills (Power vs Cardiovascular Endurance)
//   this app deliberately keeps separate.
// - Denominator is TOTAL session time, not cardio-only time — unlike
//   Mechanical Power, which divides by mechanical-only time because it's
//   asking about mechanical work rate specifically. Cardiovascular output
//   is continuous, so the honest denominator is the whole session.
//
// Overhead is excluded for blocks that are 100% cardio movements — for
// those, pace-derived MET is already a complete measurement, and a
// nonzero residual on top of it is more likely cardiovascular drift
// (heart rate rising to compensate for falling stroke volume under
// dehydration/heat, without oxygen consumption rising proportionally —
// see the RPE-as-%HRR investigation) than genuine additional cost.
//
// KNOWN LIMITATION, accepted rather than "fixed" with an unproven
// discount: for MIXED blocks (cardio + non-cardio movements sharing one
// RPE/HR reading), overhead can't be cleanly separated by movement — if
// drift inflated the reading during that block's cardio portion, that
// inflation raises the whole block's single reading, and some of it may
// get attributed to the non-cardio portion too. No rigorous fix exists
// at current (per-block) measurement granularity — would need per-
// movement-within-block timing (see the cardio-interval-button backlog
// idea) to resolve properly. Documented here rather than papered over.
// Single source of truth for "how much kcal did Run/Row/Ski/DU/Bike
// contribute to each block" — shared by getSessionCVEndurance (the
// Cardio Intensity card's own MET calculation) and
// reconstructBlockOverheadList (which needs this to correctly exclude
// ALL cardio types, not just Run/Row, from what it treats as
// non-cardio "overhead" before distributing that overhead across
// mechanical movement patterns).
// Shared per-instance MET calculation — extracted so
// getSessionCardioMetKcalByBlock (kcal) and getCardioTypeMetMinutes
// (MET-minutes, for the segmented Running/DU Efficiency metrics) use
// the exact same physics rather than two copies that could drift.
// Returns null when the instance's own formula can't produce a usable
// MET (e.g. a zero/negative row split), matching each branch's
// existing bail-out behavior.
// Outdoor cycling MET by speed — 2024 Adult Compendium of Physical
// Activities' published road-cycling categories (verified against the
// actual source, not reconstructed from memory), converted from mph to
// km/h. Deliberately a step lookup, not a fitted continuous curve like
// Run/Row's ACSM-based formula — the Compendium itself is categorical,
// not a smooth relationship (note the jump from 12.0 to 16.8 MET at
// the top band, versus ~2-MET steps below it), so forcing a straight
// line through these points would introduce error the source data
// doesn't actually have. This is a fallback path (used only when no
// real segment/HR data exists for the ride), so the lack of smooth
// interpolation between bands is an accepted, deliberate tradeoff.
function _cyclingMetBySpeed(speedKmh) {
  if (speedKmh < 16.1) return 4.0;
  if (speedKmh < 19.3) return 6.8;
  if (speedKmh < 22.5) return 8.0;
  if (speedKmh < 25.7) return 10.0;
  if (speedKmh < 32.2) return 12.0;
  return 16.8;
}

function _cardioInstanceMet(inst, bw, gender) {
  if (inst.secs <= 0 || inst.totalM <= 0) return null;
  if (inst.cardioType === 'run') {
    const speedMMin = inst.totalM / (inst.secs / 60);
    return (0.2 * speedMMin + 3.5) / 3.5;
  }
  if (inst.cardioType === 'row') {
    const splitSecPer500m = 500 / (inst.totalM / inst.secs);
    if (splitSecPer500m <= 0) return null;
    const watts = 2.80 / Math.pow(splitSecPer500m / 500, 3);
    const vo2Lmin = gender === 'female' ? (0.6652 + 0.0128 * watts) : (1.1328 + 0.0113 * watts);
    return (vo2Lmin * 1000 / bw) / 3.5;
  }
  if (inst.cardioType === 'ski') return 11; // MASTER_DB flat MET — not pace-sensitive yet, same limitation as its kcal figure
  if (inst.cardioType === 'du') return 12; // MASTER_DB flat MET — not pace-sensitive yet, same limitation as its kcal figure
  if (inst.cardioType === 'bike') {
    // Reverses the standard kcal = MET × bw × hours × factor formula —
    // see getSessionCardioMetKcalByBlock's own comment for why bike
    // solves MET from a known kcal rather than the other way round.
    return inst.totalM / (bw * (inst.secs / 3600));
  }
  if (inst.cardioType === 'cycle') {
    const speedKmh = (inst.totalM / 1000) / (inst.secs / 3600);
    return _cyclingMetBySpeed(speedKmh);
  }
  return null;
}

function getSessionCardioMetKcalByBlock(entry, bw, ageFactor, genderFactor, gender) {
  const blockCardioKcal = {};
  let allReal = true;
  getSessionCardioInstances(entry).forEach(inst => {
    const met = _cardioInstanceMet(inst, bw, gender);
    if (met == null) return;
    const factor = inst.cardioType === 'row' ? ageFactor : ageFactor * genderFactor; // matches getSessionCardioKcalByBlock's existing convention — Row's VO2 regression already has its own gender coefficients
    const kcal = met * bw * (inst.secs / 3600) * factor;
    blockCardioKcal[inst.blockIndex] = (blockCardioKcal[inst.blockIndex] || 0) + kcal;
    if (!inst.isReal) allReal = false;
  });
  return { blockCardioKcal, allReal };
}

// MET-minutes per cardio type (run/row/ski/du/bike), session-wide, not
// per block — powers the segmented Running/DU Efficiency metrics,
// which need "how much cardio strain came specifically from running"
// rather than the whole session's blended total. Includes both real
// (toggle-recorded) and PR-pace-estimated instances now — a session
// without a real toggle time shouldn't lose Running/DU Efficiency
// entirely, it should show an estimate, same as every other metric in
// this app that falls back to PR pace rather than going blank. Tracks
// per-type whether every contributing instance was real, so the UI can
// label a mixed or fully-estimated result accordingly.
function getCardioTypeMetMinutes(entry, bw, gender) {
  const metMinutesByType = {};
  const allRealByType = {};
  getSessionCardioInstances(entry).forEach(inst => {
    const met = _cardioInstanceMet(inst, bw, gender);
    if (met == null) return;
    metMinutesByType[inst.cardioType] = (metMinutesByType[inst.cardioType] || 0) + met * (inst.secs / 60);
    if (allRealByType[inst.cardioType] === undefined) allRealByType[inst.cardioType] = true;
    if (!inst.isReal) allRealByType[inst.cardioType] = false;
  });
  return { metMinutesByType, allRealByType };
}

function getSessionCVEndurance(entry) {
  const bw = parseFloat(entry.bw) || 0;
  if (!bw) return null;
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const vo2max = parseFloat(entry.vo2max_used) || 0;
  const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
  const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;

  const blockList = reconstructBlockMovementData(entry);
  if (!blockList.length) return null;
  let totalTimeSec = 0;
  blockList.forEach(b => { if (b) totalTimeSec += b.timeSec; });
  if (totalTimeSec <= 0) return null;

  const { blockCardioKcal, allReal } = getSessionCardioMetKcalByBlock(entry, bw, ageFactor, genderFactor, gender);

  const blockOverheadList = reconstructBlockOverheadList(entry, blockList);
  const overheadAvailable = !!blockOverheadList;
  const overheadIsReal = overheadAvailable && blockOverheadList.isReal;

  let cvKcal = 0;
  let metMinutes = 0;
  blockList.forEach((blockData, blockIndex) => {
    if (!blockData) return;
    const blockMinutes = (blockData.timeSec || 0) / 60;
    if (blockData.isPureCardio) {
      const blockCardio = blockCardioKcal[blockIndex] || 0;
      cvKcal += blockCardio;
      if (bw && blockMinutes > 0) metMinutes += (blockCardio / (bw * (blockMinutes / 60) * ageFactor)) * blockMinutes;
      return;
    }
    // Prefer real per-segment data (entry.blockSegments) over the
    // block-level RPE-only reconstruction below whenever it's actually
    // available for this block — calling the exact same
    // _computeBlockOverheadAndCV the live flow already uses, not a
    // second implementation that could drift from it. This is what
    // makes Overall Efficiency consistent with the segmented Work/
    // Running/DU Efficiency metrics, which already use this same real
    // per-segment data: before this, a block with real HR showing
    // higher intensity than its own self-rated RPE would silently
    // understate Overall's denominator relative to the segmented one,
    // making a component look more "costly" than the whole it's part
    // of — not possible once both read from the same source.
    const segsForBlock = Array.isArray(entry.blockSegments) ? entry.blockSegments[blockIndex] : null;
    if (Array.isArray(segsForBlock) && segsForBlock.length && vo2max > 0) {
      const blockMechKcal = Object.values(blockData.patternKcal || {}).reduce((a, b) => a + b, 0);
      const blockCardio = blockCardioKcal[blockIndex] || 0;
      const result = _computeBlockOverheadAndCV(segsForBlock, blockMechKcal, blockCardio, bw, vo2max, ageFactor, genderFactor, hrRestVal, hrMaxVal);
      cvKcal += result.cv;
      if (bw && blockMinutes > 0) metMinutes += (result.cv / (bw * (blockMinutes / 60) * ageFactor * genderFactor)) * blockMinutes;
      return;
    }
    // Fallback — no entry.blockSegments for this block (session saved
    // before that feature existed, or this specific block never had
    // any HR data at all): same block-level RPE-only reconstruction as
    // before, unchanged behavior for sessions that simply don't have
    // the finer-grained data to do better.
    if (overheadAvailable) {
      const blockOverhead = blockOverheadList.totalMetEstimateList[blockIndex] || 0;
      cvKcal += blockOverhead;
      if (bw && blockMinutes > 0) metMinutes += (blockOverhead / (bw * (blockMinutes / 60) * ageFactor * genderFactor)) * blockMinutes;
    }
  });

  // Rest periods — only present on sessions saved after tonight's rest-HR
  // feature (entry.restSegments), same two-era pattern as blockRpe. Older
  // sessions simply have nothing here, same as today — not a regression.
  // Reuses hrRestVal/hrMaxVal/vo2max from the top of this function rather
  // than re-reading the same profile fields a second time.
  if (Array.isArray(entry.restSegments) && hrRestVal != null && hrMaxVal != null && hrMaxVal > hrRestVal && vo2max) {
    entry.restSegments.forEach(seg => {
      if (seg.source !== 'hr_segment') return;
      const relIntensity = Math.max(0, Math.min(1, (seg.avgHR - hrRestVal) / (hrMaxVal - hrRestVal)));
      const met = (relIntensity * vo2max) / 3.5;
      const timeHours = seg.durationSec / 3600;
      cvKcal += met * bw * timeHours * ageFactor * genderFactor;
      totalTimeSec += seg.durationSec;
      metMinutes += met * (seg.durationSec / 60);
    });
  }

  if (cvKcal <= 0) return null;

  const totalTimeHours = totalTimeSec / 3600;
  const met = cvKcal / (bw * totalTimeHours * ageFactor * genderFactor);
  return { met, metMinutes, allReal: allReal && overheadIsReal };
}

// Live version reuses the per-block mechCost/overhead/cardio data
// calculateGlobalPhysics() already computed this exact call, rather than
// reconstructing from _buildLiveCardioEntry() — that helper doesn't carry
// movement weight (.kg), only name/reps, since it was built for cardio-
// time purposes only, so reconstructBlockMovementData() would silently
// zero out every loaded movement's mechCost if used on it directly.
function getLiveCVEndurance(blockMechCostList, blockTimeSecList, blockTotalMetEstimateList, liveCardioByBlock, cardioResultByBlock) {
  const bw = parseFloat(document.getElementById('global-w')?.value) || 0;
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  if (!bw) return null;

  let totalTimeSec = 0;
  blockTimeSecList.forEach(t => { totalTimeSec += (t || 0); });
  if (totalTimeSec <= 0) return null;

  let cvKcal = 0;
  let metMinutes = 0; // Σ(MET x minutes) — see header comment below getLiveCVEndurance for why this isn't just derived from cvKcal
  let anyCardio = false;
  for (let idx = 0; idx < blockTimeSecList.length; idx++) {
    const runRow = (liveCardioByBlock.runByBlock[idx] || 0) + (liveCardioByBlock.rowByBlock[idx] || 0);
    const other = Object.values(cardioResultByBlock[idx] || {}).reduce((a, b) => a + b, 0);
    const blockCardio = runRow + other;
    if (blockCardio > 0) anyCardio = true;
    const isPureCardio = blockCardio > 0 && !(blockMechCostList[idx] > 0);
    const blockMinutes = (blockTimeSecList[idx] || 0) / 60;
    if (isPureCardio) {
      cvKcal += blockCardio;
      // Cardio MET back-derived from the already-computed kcal — an
      // approximation, not exact, since blockCardio can blend Run/Row/
      // DU/Ski together and each may use a slightly different age/gender
      // factor convention internally. Using ageFactor only (dropping
      // genderFactor, a ~0-8% multiplier) is a small, bounded imprecision
      // accepted here rather than reaching into each cardio sub-function
      // to extract its own MET separately.
      if (bw && blockMinutes > 0) metMinutes += (blockCardio / (bw * (blockMinutes / 60) * ageFactor)) * blockMinutes;
    } else {
      cvKcal += (blockTotalMetEstimateList[idx] || 0);
      // Mechanical/mixed blocks — same back-derivation, but exact here:
      // blockTotalMetEstimateList[idx] came from exactly one relIntensity
      // (RPE or %HRR) and exactly these factors, no blending risk.
      if (bw && blockMinutes > 0) metMinutes += (blockTotalMetEstimateList[idx] / (bw * (blockMinutes / 60) * ageFactor * genderFactor)) * blockMinutes;
    }
  }

  // Rest periods — same treatment as a mechanical segment: real average
  // HR during the window, converted via %HRR, no invented baseline MET.
  // Both the kcal AND the time get added, so rest genuinely dilutes the
  // average toward "the whole session" instead of silently vanishing
  // from the denominator, which was the actual distortion — a session
  // with lots of rest was reading artificially high before this, purely
  // because rest time had nowhere to go. Only ever contributes when
  // window._restTimeWindows has real entries (rest countdown genuinely
  // ran live) AND HR was connected during it — otherwise adds nothing,
  // same honest fallback as everywhere else tonight.
  const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
  const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;
  const vo2maxResult = typeof getEffectiveVO2max === 'function' ? getEffectiveVO2max() : null;
  const vo2max = vo2maxResult?.value || null;
  if (hrRestVal != null && hrMaxVal != null && hrMaxVal > hrRestVal && vo2max) {
    _buildRestSegments().forEach(seg => {
      if (seg.source !== 'hr_segment') return; // no HR during this rest — contributes nothing, not a guess
      const relIntensity = Math.max(0, Math.min(1, (seg.avgHR - hrRestVal) / (hrMaxVal - hrRestVal)));
      const met = (relIntensity * vo2max) / 3.5;
      const timeHours = seg.durationSec / 3600;
      cvKcal += met * bw * timeHours * ageFactor * genderFactor;
      totalTimeSec += seg.durationSec;
      metMinutes += met * (seg.durationSec / 60);
    });
  }

  if (cvKcal <= 0) return null;
  const totalTimeHours = totalTimeSec / 3600;
  const met = cvKcal / (bw * totalTimeHours * ageFactor * genderFactor);
  return { met, metMinutes, allReal: true, anyCardio }; // live session's own PRs/pace are always "real" for this session's own purposes
}
// Shared by getSessionRunAeroKcal/getSessionRowAeroKcal (session-wide
// totals, unchanged contract) and Phase 2's per-block overhead calc,
// which needs to know how much cardio kcal came from which block. Single
// source of truth for both formulas so the two totals functions below
// and the per-block breakdown can never drift apart from each other.
function getSessionCardioKcalByBlock(entry) {
  const bw = parseFloat(entry.bw) || 0;
  const runByBlock = {}, rowByBlock = {};
  let runTotal = 0, rowTotal = 0;
  if (!bw) return { runByBlock, rowByBlock, runTotal, rowTotal };
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const runMetFactor = ageFactor * genderFactor;

  getSessionCardioInstances(entry).forEach(inst => {
    if (inst.secs <= 0 || inst.totalM <= 0) return;
    if (inst.cardioType === 'run') {
      // ACSM running equation, flat ground — see getSessionRunAeroKcal's
      // original comment below for the full pace-derived-MET rationale.
      const speedMMin = inst.totalM / (inst.secs / 60);
      const vo2 = 0.2 * speedMMin + 3.5;
      const met = vo2 / 3.5;
      const kcal = met * bw * (inst.secs / 3600) * runMetFactor;
      runByBlock[inst.blockIndex] = (runByBlock[inst.blockIndex] || 0) + kcal;
      runTotal += kcal;
    } else if (inst.cardioType === 'row') {
      // Concept2 pace-to-watts + Klusiewicz VO2-to-watts regression — see
      // getSessionRowAeroKcal's original comment below for full rationale.
      const splitSecPer500m = 500 / (inst.totalM / inst.secs);
      if (splitSecPer500m <= 0) return;
      const watts = 2.80 / Math.pow(splitSecPer500m / 500, 3);
      const vo2Lmin = gender === 'female' ? (0.6652 + 0.0128 * watts) : (1.1328 + 0.0113 * watts);
      const met = (vo2Lmin * 1000 / bw) / 3.5;
      const kcal = met * bw * (inst.secs / 3600) * ageFactor;
      rowByBlock[inst.blockIndex] = (rowByBlock[inst.blockIndex] || 0) + kcal;
      rowTotal += kcal;
    }
  });
  return { runByBlock, rowByBlock, runTotal, rowTotal };
}

// Run's share of mc_aero, using pace-derived MET (ACSM running equation)
// instead of the flat MET=10 every other cardio movement still uses.
// Confirmed via a real session's actual, real (not estimated) pace data:
// a fixed MET produces the identical rate regardless of how fast the
// athlete actually ran — 0.1333 kcal/min/kg whether a 1000m rep took
// 375s or 476s — because MET never varied, only time did, and dividing
// back out by that same time cancels it algebraically. Pace-derived MET
// fixes this: same two reps came out to 0.1352 vs 0.1094, a real ~24%
// difference reflecting the athlete's actual, different effort each time.
//
// Deliberately scoped to Run only, not Row — the ACSM equation is
// running-specific biomechanics (VO2 = 0.2 x speed + 3.5), not a generic
// cardio-intensity formula, and applying it to rowing pace would repeat
// the same mistake Riegel's running-race formula made when first assumed
// to transfer directly to WOD running. Row has its own, better-suited
// physics (the Concept2 pace-to-watts relationship) that hasn't had its
// own design pass yet, so it stays on its existing flat-MET formula
// until that happens rather than getting a placeholder guess.
//
// Reuses getSessionCardioInstances' per-instance time data — same real
// time (isReal) or same linear-scaled estimate as Power's denominator —
// rather than maintaining a second, potentially-diverging estimate of
// how long the running actually took.
function getSessionRunAeroKcal(entry) {
  return getSessionCardioKcalByBlock(entry).runTotal;
}

// Row's share of mc_aero — same rationale as Run (pace-derived MET
// instead of a flat constant that made the rate mathematically
// independent of actual effort), but a different formula entirely, since
// ACSM's running equation is running-specific biomechanics and doesn't
// transfer to rowing.
//
// Two-step approach: (1) the Concept2 pace-to-watts formula
// (Watts = 2.80 / split^3, the same physics-based relationship Concept2
// ergometers themselves use, where split is seconds per 500m) converts
// pace to mechanical power output; (2) a published, rowing-ergometer-
// specific linear VO2-to-watts regression (Klusiewicz et al., derived
// from Concept2 testing on national-team and back-up rowers, separate
// male/female coefficients) converts watts to MET.
//
// Checked the ACSM/Compendium's tiered rowing MET table (5.0/7.5/11.0/14.0
// for <100/100-149/150-199/>=200W) as an alternative first — rejected it
// because its top tier is a ceiling: any pace faster than ~2:00/500m
// (routine for CrossFit rowing, not just elite) already exceeds 200W and
// pins at the same MET=14.0 regardless of how much faster the athlete
// actually goes, reproducing the exact "MET independent of real effort"
// problem this fix exists to solve. The continuous regression used here
// keeps distinguishing intensity well past that point. Also searched for
// a broader, multi-study consensus equivalent to ACSM's running formula —
// found none; this is the most directly relevant single source available.
//
// Gender is NOT re-applied via the app's separate ageFactor/genderFactor
// metFactor the way Run's calculation does — this equation already has
// distinct male/female coefficients, so applying genderFactor on top
// would double-count the same adjustment. ageFactor still applies, since
// the source study's coefficients don't account for age at all.
function getSessionRowAeroKcal(entry) {
  return getSessionCardioKcalByBlock(entry).rowTotal;
}

// Live-flow variant of getSessionCardioTimeSec/getSessionRunAeroKcal —
// reads the current .wod-block DOM elements directly (mid-session,
// before anything is saved) rather than a saved history entry, builds a
// minimal pseudo-entry with just the fields those functions need, and
// reuses them rather than duplicating their estimation logic.
function _buildLiveCardioEntry() {
  const blocks = [...document.querySelectorAll('.wod-block')].map(b => ({
    mode: b.querySelector('.b-mode')?.value || 'fortime',
    result: {
      r: parseFloat(b.querySelector('.res-r')?.value) || 0,
      x: parseFloat(b.querySelector('.res-x')?.value) || 0,
      m: parseFloat(b.querySelector('.res-m')?.value) || 0,
      s: parseFloat(b.querySelector('.res-s')?.value) || 0
    },
    movements: [...b.querySelectorAll('.movement-block')].map(mb => ({
      name: mb.querySelector('input[type="hidden"]')?.value || '',
      reps: mb.querySelector('.m-reps')?.value || '0'
    }))
  }));
  const bw = parseFloat(document.getElementById('global-w')?.value) || 0;
  return { blocks, bw };
}
function getLiveCardioTimeSec() {
  return getSessionCardioTimeSec(_buildLiveCardioEntry());
}
function getLiveRunAeroKcal() {
  return getSessionRunAeroKcal(_buildLiveCardioEntry());
}
function getLiveRowAeroKcal() {
  return getSessionRowAeroKcal(_buildLiveCardioEntry());
}
function getLiveCardioKcalByBlock() {
  return getSessionCardioKcalByBlock(_buildLiveCardioEntry());
}

// v2: bumped from 1 to propagate wd's increased storage precision
// (was 0 decimals here, now 2) to sessions affected by this migration —
// same reasoning as the eccentric-work migration's v7 bump.
const BW_CORRECTION_TARGET_VERSION = 2;

// Recomputes mechanical work for every session before BW_CHANGE_DATE,
// replacing the unverifiable 83kg estimate with the athlete's current,
// known bodyweight (80kg) — chosen because 83 was itself just a rough
// guess with no real historical basis, no more trustworthy than using the
// one bodyweight actually known with confidence. Deliberately leaves
// mc_overhead/mc/fb untouched — those depend on the all-time mechanical
// intensity ceiling, which shifts once mechanical work here changes, so
// they need the overhead-reference migration to re-run afterward using
// these corrected values, not be recalculated here from a ceiling that's
// about to go stale.

function reconstructRL(entry, patternFilter = null, returnContext = false) {
  let rmMax = 0;
  let rmMaxMovement = null;
  let rmMaxWeight = null;
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; }
    }
    let ep = x;
    const goalR = parseInt(block.target) || r;
    (block.movements || []).forEach(mv => {
      const p = MASTER_DB[mv.name];
      if (!p) return;
      if (patternFilter && getMovementPattern(mv.name) !== patternFilter) return;
      const baseKg = parseFloat(mv.kg) || 0;
      // For weight ladders, RL needs the TRUE PEAK weight reached across
      // all completed rounds, not just the starting weight — a session
      // that ladders from 100kg up to 140kg was genuinely at 93% of a
      // 150kg 1RM by the final round, even though mv.kg only ever stores
      // the starting 100kg. Ported from the Weekly Peak Load chart's
      // already-correct ladder-walking logic, since reconstructRL()
      // previously only ever read the starting weight — a real gap that
      // could understate RL enough to miss the 70% Neural Fatigue trigger
      // entirely for a genuinely heavy top-set ladder.
      let wt = baseKg;
      const ladderType = mv.wtLadderType || 'fixed';
      if (ladderType !== 'fixed') {
        const inc = parseFloat(mv.wtLadderInc) || 5;
        const totalR = Math.min(r, goalR);
        for (let ri = 0; ri < totalR; ri++) {
          let roundWt = baseKg;
          if (ladderType === 'ascending')        roundWt = Math.round((baseKg + inc * ri) * 10) / 10;
          else if (ladderType === 'descending')  roundWt = Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10);
          else if (ladderType === 'pyramid') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.round((baseKg + inc * ri) * 10) / 10 : Math.round((baseKg + inc * (totalR - ri - 1)) * 10) / 10;
          } else if (ladderType === 'valley') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10) : Math.max(0, Math.round((baseKg - inc * (totalR - ri - 1)) * 10) / 10);
          }
          if (roundWt > wt) wt = roundWt;
        }
      }
      const pres = parseFloat(mv.reps) || 0;
      let reps;
      if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = (block.movements || []).length || 1;
        const stationRounds = Math.floor(r / stationCount);
        reps = pres * Math.max(1, stationRounds);
      } else {
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
      }
      if (reps <= 0 || wt <= 0) return;
      const rmPct = get1RMPercent(mv.name, wt);
      if (rmPct !== null && rmPct > rmMax) {
        rmMax = rmPct;
        rmMaxMovement = mv.name;
        rmMaxWeight = wt;
      }
    });
  });
  if (returnContext) return { rl: Math.round(rmMax), movementName: rmMaxMovement, weight: rmMaxWeight };
  return Math.round(rmMax);
}

// Total tonnage (kg) from sets at or above a %1RM threshold — the
// "Effective Heavy Tonnage" metric: how much genuinely heavy work
// actually happened, not just how heavy the single hardest set was.
//
// Deliberately NOT built by sharing reconstructRL()'s loop — RL only
// ever needs a ladder's PEAK weight (one number), but tonnage needs to
// know, for EACH round of a ladder, whether THAT round's own weight
// crossed the threshold, summing only the qualifying rounds' reps x
// weight. A ladder from 100kg to 140kg might have its first three
// rounds below 70% and only the last two above — RL correctly cares
// only about the 140kg round; tonnage needs to sum just those last two
// rounds' real weight x reps, not the whole ladder's total reps at the
// peak weight. Forcing these into one shared walker would have meant
// restructuring RL's already-validated Neural Fatigue trigger logic to
// accommodate a need it doesn't have — safer to keep them separate,
// carefully written functions than risk a subtle regression there.
function reconstructHeavyTonnage(entry, patternFilter = null, threshold = 70) {
  let tonnage = 0;
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; }
    }
    let ep = x;
    const goalR = parseInt(block.target) || r;
    (block.movements || []).forEach(mv => {
      const p = MASTER_DB[mv.name];
      if (!p) return;
      if (patternFilter && getMovementPattern(mv.name) !== patternFilter) return;
      const baseKg = parseFloat(mv.kg) || 0;
      const pres = parseFloat(mv.reps) || 0;
      const ladderType = mv.wtLadderType || 'fixed';

      if (ladderType !== 'fixed') {
        // Walk each round individually — this is the part that
        // genuinely differs from reconstructRL(). Each round gets its
        // own weight, its own %1RM check, and only contributes tonnage
        // if that specific round cleared the threshold.
        const inc = parseFloat(mv.wtLadderInc) || 5;
        const totalR = Math.min(r, goalR);
        for (let ri = 0; ri < totalR; ri++) {
          let roundWt = baseKg;
          if (ladderType === 'ascending')        roundWt = Math.round((baseKg + inc * ri) * 10) / 10;
          else if (ladderType === 'descending')  roundWt = Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10);
          else if (ladderType === 'pyramid') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.round((baseKg + inc * ri) * 10) / 10 : Math.round((baseKg + inc * (totalR - ri - 1)) * 10) / 10;
          } else if (ladderType === 'valley') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10) : Math.max(0, Math.round((baseKg - inc * (totalR - ri - 1)) * 10) / 10);
          }
          if (roundWt <= 0 || pres <= 0) continue;
          const roundPct = get1RMPercent(mv.name, roundWt);
          if (roundPct !== null && roundPct >= threshold) tonnage += roundWt * pres;
        }
      } else {
        // Fixed weight — same reps-per-mode logic as reconstructRL(),
        // one contribution for the whole movement since there's no
        // per-round weight variation to track.
        let reps;
        if (mode === 'tabata') {
          reps = x;
        } else if (mode === 'exmom') {
          const stationCount = (block.movements || []).length || 1;
          const stationRounds = Math.floor(r / stationCount);
          reps = pres * Math.max(1, stationRounds);
        } else {
          const base = pres * r;
          const wf = Math.min(ep, pres);
          ep = Math.max(0, ep - pres);
          reps = base + wf;
        }
        if (reps <= 0 || baseKg <= 0) return;
        const rmPct = get1RMPercent(mv.name, baseKg);
        if (rmPct !== null && rmPct >= threshold) tonnage += baseKg * reps;
      }
    });
  });
  return Math.round(tonnage);
}

// Estimated 1RM (Epley: weight x (1 + reps/30)) per EXACT movement name
// — deliberately not blended across correlated variants (Front Squat
// stays separate from Back Squat, RDL stays separate from Deadlift).
// Blending would mean converting one movement's estimate into another's
// terms via RM_CORRELATION, compounding one estimate (Epley) on top of
// another (the correlation factor itself just an approximation) — and
// would show a discontinuity any week the athlete happened to train the
// variant instead of the main lift, which isn't real signal.
//
// repCutoff (default 12): Epley's formula is built for low-rep, near-
// maximal sets and increasingly overestimates true 1RM at higher rep
// counts. A set above the cutoff contributes nothing rather than a
// number that looks precise but isn't trustworthy — same "no unreliable
// estimate" discipline as everywhere else tonight, not a new one.
//
// Session e1RM is the PEAK across all qualifying sets of this movement
// that day, matching RL's own peak-not-average philosophy. For weight
// ladders, reps-per-round stays fixed in this data model (only weight
// varies round to round) — meaning e1RM is monotonic in weight for a
// fixed rep count, so the peak-WEIGHT round is always also the peak-
// e1RM round. This reuses that same peak-weight walk already validated
// for RL, rather than a separate per-round e1RM computation that would
// produce an identical result through more work.
function reconstructE1RM(entry, movementName, repCutoff = 12) {
  let peakE1RM = 0;
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; }
    }
    let ep = x;
    const goalR = parseInt(block.target) || r;
    (block.movements || []).forEach(mv => {
      if (mv.name !== movementName) return;
      const p = MASTER_DB[mv.name];
      if (!p) return;
      const baseKg = parseFloat(mv.kg) || 0;
      let wt = baseKg;
      const ladderType = mv.wtLadderType || 'fixed';
      if (ladderType !== 'fixed') {
        const inc = parseFloat(mv.wtLadderInc) || 5;
        const totalR = Math.min(r, goalR);
        for (let ri = 0; ri < totalR; ri++) {
          let roundWt = baseKg;
          if (ladderType === 'ascending')        roundWt = Math.round((baseKg + inc * ri) * 10) / 10;
          else if (ladderType === 'descending')  roundWt = Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10);
          else if (ladderType === 'pyramid') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.round((baseKg + inc * ri) * 10) / 10 : Math.round((baseKg + inc * (totalR - ri - 1)) * 10) / 10;
          } else if (ladderType === 'valley') {
            const half = Math.ceil(totalR / 2);
            roundWt = ri < half ? Math.max(0, Math.round((baseKg - inc * ri) * 10) / 10) : Math.max(0, Math.round((baseKg - inc * (totalR - ri - 1)) * 10) / 10);
          }
          if (roundWt > wt) wt = roundWt;
        }
      }
      const pres = parseFloat(mv.reps) || 0;
      let reps;
      if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = (block.movements || []).length || 1;
        const stationRounds = Math.floor(r / stationCount);
        reps = pres * Math.max(1, stationRounds);
      } else if (ladderType !== 'fixed') {
        reps = pres; // ladder: reps-per-round is the relevant count, not the total across all rounds
      } else {
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
      }
      if (reps <= 0 || reps > repCutoff || wt <= 0) return;
      const e1rm = wt * (1 + reps / 30);
      if (e1rm > peakE1RM) peakE1RM = e1rm;
    });
  });
  return peakE1RM > 0 ? Math.round(peakE1RM * 10) / 10 : null;
}

// Which RM_MAP movements actually produce at least one real e1RM data
// point — not just "was this movement ever logged," but "does
// reconstructE1RM() ever return a real number for it." A movement
// trained only in sets above the rep cutoff, or one whose reference
// 1RM was never entered, would previously still appear in the
// dropdown and immediately show "no qualifying sets" the moment it
// was selected — this filters those out before they ever show up.
function getTrainedE1RMMovements() {
  const hist = getHistory();
  const candidates = new Set();
  hist.forEach(entry => {
    (entry.blocks || []).forEach(block => {
      (block.movements || []).forEach(mv => {
        if (RM_MAP[mv.name]) candidates.add(mv.name);
      });
    });
  });
  return Array.from(candidates)
    .filter(movName => hist.some(entry => reconstructE1RM(entry, movName) !== null))
    .sort();
}

// Reconstructs patternPct from a stored history entry's raw blocks — same
// logic and same underlying workKcal formula as the live
// calculateMovementPatternProfile(), but reading from persisted data.
// Simpler than the old bias version: all cardio goes into one
// monostructural bucket, so there's no need to track which cardio type(s)
// were present the way the old endurance/metabolic split required.
// Per-block movement-work reconstruction, shared by reconstructPatternProfile()
// (needs the pattern-level split) and reconstructBlockOverheadList() /
// getSessionCVEndurance() (only need each block's own mech-kcal total and
// timing) — single source of truth so these can't independently drift.
//
// Formula MUST match reconstructMechanicalWork() exactly (personalized
// bodyweight ROM, bar-path vs whole-body-CoM ROM distinction, eccentric
// credit via the controlled-descent toggle) — this function previously
// used a simpler approximation (no eccentric weighting, no personalized
// ROM), which meant this block's "mechanical kcal" and mc_mech's
// authoritative version disagreed with each other. Same drift risk as
// the two independent Power calculations from earlier today, just newly
// introduced here instead of inherited from history.
function reconstructBlockMovementData(entry) {
  const bw = parseFloat(entry.bw) || 80;
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  const blockList = []; // { patternKcal: {...}, timeSec, isPureCardio } per block
  (entry.blocks || []).forEach((block, blockIndex) => {
    const mode = block.mode || 'fortime';
    let r = parseFloat(block.result?.r) || 0;
    let x = parseFloat(block.result?.x) || 0;
    let bM = parseFloat(block.result?.m) || 0;
    let bS = parseFloat(block.result?.s) || 0;
    if (!block.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed) { r = parsed.r; x = parsed.x; bM = parsed.m || 0; bS = parsed.s || 0; }
    }
    let ep = x;
    const blockPatternKcal = {};
    const movements = block.movements || [];
    const isPureCardio = movements.length > 0 && movements.every(mv => MASTER_DB[mv.name]?.cardio);
    movements.forEach(mv => {
      const p = MASTER_DB[mv.name];
      if (!p) return;
      if (p.cardio) return; // handled separately using real cardio kcal
      const wt = parseFloat(mv.kg) || 0;
      const pres = parseFloat(mv.reps) || 0;
      let reps;
      if (mode === 'tabata') {
        reps = x;
      } else if (mode === 'exmom') {
        const stationCount = movements.length || 1;
        const stationRounds = Math.floor(r / stationCount);
        reps = pres * Math.max(1, stationRounds);
      } else {
        const base = pres * r;
        const wf = Math.min(ep, pres);
        ep = Math.max(0, ep - pres);
        reps = base + wf;
      }
      const pattern = getMovementPattern(mv.name);
      if (!pattern) return;
      // Matches reconstructMechanicalWork() exactly — see that function
      // for the full rationale on each term.
      const barPathRom = getAthleteROM(mv.name || '', p, hMetres);
      const bwPersonal = getPersonalizedBodyweightROM(mv.name || '', hMetres);
      const bwRom = bwPersonal ? bwPersonal.rom : barPathRom;
      const bwMassFrac = bwPersonal ? bwPersonal.massFraction : p.bw;
      const concentricWork = ((wt * barPathRom + bw * bwMassFrac * bwRom) * 9.81 * reps) / 1000;
      const eccentricEligible = !p.oneDir || mv.controlledDescent !== false;
      const mechCostMultiplier = eccentricEligible ? (7 / 6) : 1;
      const mechCost = concentricWork * mechCostMultiplier; // kJ
      const mechKcal = (mechCost / 4.184) / 0.22;
      blockPatternKcal[pattern] = (blockPatternKcal[pattern] || 0) + mechKcal;
    });
    blockList[blockIndex] = { patternKcal: blockPatternKcal, timeSec: (bM * 60) + bS, isPureCardio };
  });
  return blockList;
}

// Reconstructs each block's own overhead for historical sessions. Two
// precision tiers:
// - REAL per-block RPE (entry.blockRpe present) — sessions logged after
//   the per-block RPE redesign.
// - FALLBACK: entry.blockRpe absent, but the session's single flat
//   entry.rpe exists (every session has always required one) — applies
//   that same RPE to every block. Still does real per-block mech/cardio
//   subtraction with today's formulas, just reusing one RPE number
//   across blocks instead of genuine per-block ones — strictly better
//   than the old whole-session approach (one subtraction for the entire
//   session, no per-block granularity at all), and it's what makes
//   nearly all existing history reconstructable instead of just the
//   handful of sessions saved after today.
// Uses the VO2max that was actually in effect at save time
// (entry.vo2max_used — current VO2max would silently drift the
// reconstruction; that's what the separate vo2max-correction migration
// is for). Returns { list, isReal } — isReal is false for the fallback
// tier, so callers can flag imprecise data instead of presenting it as
// equally reliable. Returns null only when neither RPE source exists at
// all.
function reconstructBlockOverheadList(entry, blockList) {
  const hasBlockRpe = Array.isArray(entry.blockRpe) && entry.blockRpe.some(v => v);
  const sessionRpe = parseFloat(entry.rpe) || 0;
  // Falls back to vo2maxAttempted when vo2max_used is missing. That
  // field is set by a DIFFERENT function (recalculateOverheadForVo2max,
  // the VO2max-update migration) when it found a session with overhead
  // already computed, tried to recompute it with a corrected VO2max,
  // but bailed because fb, mc, duration_sec, bw, or rpe was missing —
  // it records "this is the VO2max we would have applied" without
  // actually applying it. Safe to use here specifically because THIS
  // function never references fb at all (only bw, age, gender, RPE,
  // and the VO2max value) — the reason that other migration bailed has
  // no bearing on whether this number is usable for this calculation.
  const vo2maxUsed = parseFloat(entry.vo2max_used) || parseFloat(entry.vo2maxAttempted) || 0;
  if ((!hasBlockRpe && !sessionRpe) || !vo2maxUsed) return null;
  const isReal = hasBlockRpe;
  const bw = parseFloat(entry.bw) || 80;
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;
  const { blockCardioKcal: cardioKcalByBlock } = getSessionCardioMetKcalByBlock(entry, bw, ageFactor, genderFactor, gender);
  const blockOverheadList = [];
  const blockTotalMetEstimateList = [];
  blockList.forEach((blockData, blockIndex) => {
    if (!blockData) { blockOverheadList[blockIndex] = 0; blockTotalMetEstimateList[blockIndex] = 0; return; }
    const blockRpe = hasBlockRpe ? entry.blockRpe[blockIndex] : sessionRpe;
    const blockTimeSec = blockData.timeSec;
    if (!blockRpe || blockTimeSec <= 0) { blockOverheadList[blockIndex] = 0; blockTotalMetEstimateList[blockIndex] = 0; return; }
    const relIntensity = Math.min(1.0, blockRpe / 10);
    const met = (relIntensity * vo2maxUsed) / 3.5;
    const timeHours = blockTimeSec / 3600;
    const blockTotalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
    blockTotalMetEstimateList[blockIndex] = blockTotalMetEstimate;
    const blockMechKcal = Object.values(blockData.patternKcal).reduce((a, b) => a + b, 0);
    const blockCardioKcal = cardioKcalByBlock[blockIndex] || 0;
    blockOverheadList[blockIndex] = Math.max(0, blockTotalMetEstimate - blockMechKcal - blockCardioKcal);
  });
  blockOverheadList.isReal = isReal; // attached, not wrapped, so existing array-consuming callers keep working unchanged
  blockOverheadList.totalMetEstimateList = blockTotalMetEstimateList;
  return blockOverheadList;
}

function reconstructPatternProfile(entry) {
  const bw = parseFloat(entry.bw) || 80;
  const patterns = {};
  const blockPatternKcalList = reconstructBlockMovementData(entry);
  blockPatternKcalList.forEach(blockData => {
    if (!blockData) return;
    Object.entries(blockData.patternKcal).forEach(([pattern, kcal]) => {
      patterns[pattern] = (patterns[pattern] || 0) + kcal;
    });
  });

  const mcAero = parseFloat(entry.mc_aero) || 0;
  if (mcAero > 0) {
    patterns['pattern.monostructural'] = (patterns['pattern.monostructural'] || 0) + mcAero;
  }

  // Aerobic overhead — real per-block reconstruction for sessions logged
  // after the per-block RPE redesign (entry.blockRpe present); the old
  // interim whole-session proportional rule for everything logged before
  // it, since those sessions only ever had one flat, session-wide RPE and
  // there's no per-block split to reconstruct. See reconstructBlockOverheadList().
  const blockOverheadList = reconstructBlockOverheadList(entry, blockPatternKcalList);
  if (blockOverheadList) {
    blockPatternKcalList.forEach((blockData, blockIndex) => {
      if (!blockData) return;
      const blockOverhead = blockOverheadList[blockIndex] || 0;
      const blockMechKcal = Object.values(blockData.patternKcal).reduce((a, b) => a + b, 0);
      if (blockOverhead > 0 && blockMechKcal > 0) {
        Object.keys(blockData.patternKcal).forEach(k => {
          patterns[k] += blockOverhead * (blockData.patternKcal[k] / blockMechKcal);
        });
      }
    });
  } else {
    const mcOverhead = parseFloat(entry.mc_overhead) || 0;
    if (mcOverhead > 0) {
      const nonCardioTotal = Object.keys(patterns)
        .filter(k => k !== 'pattern.monostructural')
        .reduce((sum, k) => sum + patterns[k], 0);
      if (nonCardioTotal > 0) {
        Object.keys(patterns).forEach(k => {
          if (k === 'pattern.monostructural') return;
          patterns[k] += mcOverhead * (patterns[k] / nonCardioTotal);
        });
      }
    }
  }

  const totalPattern = Object.values(patterns).reduce((a, b) => a + b, 0) || 1;
  const patternPct = {};
  Object.keys(patterns).forEach(k => { patternPct[k] = patterns[k] / totalPattern; });
  const dominantPattern = Object.entries(patternPct).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
  return { patternPct, dominantPattern };
}

// v1: replaces the old, retired ENERGY_PROFILE_TARGET_VERSION system
// (Movement Bias — Strength/Power/Metabolic/Endurance) entirely. Bias was
// a static, per-movement tag with the same "doesn't adapt to context"
// problem the old movement-pattern catch-all had before tonight's fixes —
// removed rather than patched further. patternProfile uses the same
// workKcal-weighted-share structure, bucketed by getMovementPattern()
// instead.
// v2: mc_overhead now attributed 100% to non-cardio patterns (interim
// rule, see calculateMovementPatternProfile()) instead of being excluded
// from the pattern split entirely. Bumped to force recalculation of all
// historical sessions via migratePatternProfile().
// v3: Phase 2 of the per-block RPE/HR redesign — sessions with
// entry.blockRpe (logged after Phase 1) now get real per-block overhead
// reconstruction instead of the v2 interim whole-session proportional
// rule. Sessions without entry.blockRpe (logged before Phase 1) keep the
// v2 rule, since there's no per-block RPE to reconstruct from for them.
// v4: two fixes discovered building Cardiovascular Endurance. (1)
// reconstructBlockMovementData() was using a simpler mechanical-work
// formula than reconstructMechanicalWork() (missing eccentric credit and
// personalized bodyweight ROM) — now matches exactly. (2)
// reconstructBlockOverheadList() now falls back to the session's single
// flat entry.rpe applied per-block when entry.blockRpe is absent
// (virtually every session before today), instead of falling all the way
// back to the v2 whole-session-proportional rule — real per-block
// mech/cardio subtraction with one reused RPE number beats no per-block
// split at all.
const PATTERN_PROFILE_TARGET_VERSION = 4;

const RL_TARGET_VERSION = 7;

const DURATION_V2_TARGET_VERSION = 1;


function getSessionPower(entry) {
  const durSec = parseFloat(entry.duration_sec) || 0;
  const bw = parseFloat(entry.bw) || 0;
  if (!durSec || !bw) return null;
  const kcalToWkg = kcal => ((parseFloat(kcal) || 0) * 4.184 * 1000) / durSec / bw;

  // Cardio's carved mechanical work — same formula as the live path
  // (getCardioMechanicalWorkKJ), reconstructed from the entry's stored
  // blocks rather than live DOM state. entry.wd itself is a frozen value
  // computed at save time WITHOUT this contribution (for any session
  // saved before today, and any session saved today before this fix),
  // so it has to be added back in here rather than assumed already
  // included — same "recompute from stored data, don't trust a stale
  // frozen field" approach as mc_mech's own historical reconstruction.
  // See getCardioWorkBreakdown() for the Row/Ski-vs-Run/DU split
  // rationale — all cardio types count toward Power's numerator (pure
  // physics), only Row/Ski's validated portion adjusts the aero figure
  // below.
  const cardioBreakdown = getCardioWorkBreakdown(getSessionCardioInstances(entry), bw);
  const cardioCarvedWorkKJ = cardioBreakdown.totalWorkKJ;
  const cardioCarvedKcal = (cardioBreakdown.metabolicCarveKJ / 4.184) / 0.22;

  // mech is true mechanical Power — Force x Distance / Time, computed
  // directly from raw work (wd, kJ) plus cardio's carved contribution,
  // converted straight to Watts. This deliberately does NOT route
  // through mc_mech's 22% muscular-efficiency factor — that conversion
  // has no place in a pure physics power number.
  //
  // Denominator is now full session duration, not time-with-cardio-
  // excluded. That exclusion existed because cardio contributed exactly
  // zero to wd — now that it has a real (if often small) mechanical
  // contribution for every second of its duration, excluding its time
  // would be excluding real work, not dead time. See today's Run/Row/Ski
  // scoping discussion for the full reasoning.
  //
  // isMigrated: if this entry has already been through the carve-out
  // migration, entry.wd and entry.mc_aero are ALREADY adjusted (wd
  // includes cardio's carved work, mc_aero has already had it
  // subtracted) — applying the same adjustment again here would double-
  // count it. Only apply the on-the-fly adjustment for entries that
  // haven't been migrated yet, as a compatibility shim for old data.
  const isMigrated = Number(entry.eccentricVersion) === ECCENTRIC_WORK_TARGET_VERSION;
  const totalWorkKJ = (parseFloat(entry.wd) || 0) + (isMigrated ? 0 : cardioCarvedWorkKJ);
  const mech = (totalWorkKJ * 1000) / durSec / bw;
  const aero = isMigrated
    ? Math.max(0, kcalToWkg(entry.mc_aero))
    : Math.max(0, kcalToWkg(entry.mc_aero) - kcalToWkg(cardioCarvedKcal));
  const overhead = kcalToWkg(entry.mc_overhead);
  // total is mechanical-only — Aerobic and Overhead are metabolic cost
  // rates, not mechanical work rates. Both still returned separately for
  // anything that needs them (Metabolic Cost, the VO2max-retest
  // diagnostic), just not folded into Power itself.
  return { mech, aero, overhead, total: mech };
}

// A session-type discriminator for Session Match: average mechanical work
// per rep across all non-cardio movements, work-weighted so movements
// that contributed more of the session's total work naturally dominate
// the average. Unlike Relative Load (%1RM), this needs no tracked 1RM —
// it works for any weighted or bodyweight movement, which matters since
// RM_MAP only covers a small fraction of MASTER_DB. Deliberately not
// normalized by bodyweight: Session Match only ever compares one
// athlete's own sessions against each other, never across athletes, so
// bodyweight is already an effective constant across the comparison and
// normalizing it away would only discard signal.
//
// This was validated against a real, ~47-session history before being
// wired in: a heavy strength session and a bodyweight metabolic session
// landed nearly 4x apart (1.02 vs 0.27 kJ/rep), and it correctly
// separated real session pairs that passed FB+Duration but used
// meaningfully different loading (e.g. a heavy Deadlift-based session
// vs. a lighter kettlebell complex at the same FB and duration).
//
// This replaces the old Movement Bias gate (energyProfile.biasPct) for
// Session Match specifically — Movement Bias classifies by each
// movement's fixed MASTER_DB tag regardless of how it was actually
// performed (a Bench Press session done well below the athlete's other
// lifts still reads as "Strength"), the same fixed-tag problem Energy
// System had before its removal. work/rep looks at what actually
// happened in the session instead.
function getSessionWorkPerRep(entry) {
  const bw = parseFloat(entry.bw) || 0;
  if (!bw || !entry.blocks?.length) return null;
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  const { workKJ, totalReps } = reconstructMechanicalWork(entry, bw, hMetres);
  return totalReps > 0 ? workKJ / totalReps : null;
}

// A second, independent session-type discriminator for Session Match:
// what share of the session's MEASURED metabolic cost (mc_mech + mc_aero,
// deliberately excluding mc_overhead — see below) came from mechanical
// work versus cardio. Where work/rep answers "how heavy was each rep,"
// this answers "how much of this session's effort went toward mechanical
// work versus cardio at all" — a genuinely different question. A session
// can be extremely heavy whether it's 100% barbell work or half running,
// and light/high-volume under either composition split too — FB and
// work/rep can't see the mech-vs-aero split, and this gate can't see load
// intensity, which is exactly why both are needed rather than either
// alone.
//
// mc_overhead is deliberately excluded from this ratio: it's an RPE-and-
// duration-implied residual (see the VO2max-retest signal's fix earlier
// this session), not a directly measured quantity — including it would
// blend an objective composition measure with a subjective, self-reported
// one.
//
// Validated against a real, ~47-session history before being wired in:
// found a real pair (a run-heavy session vs. a mixed barbell/kettlebell
// session) that passed FB, Duration, and work/rep at 87% similarity, yet
// sat at 21.8% vs 50.3% mech share — a mismatch none of the other three
// gates could see, since it's a different axis entirely. A parallel check
// confirmed the reverse also holds: FB alone still catches 55 of 69 pairs
// that pass Duration+work/rep+mechShare, confirming these aren't
// redundant with each other in either direction.
function getSessionMechShare(entry) {
  const mech = parseFloat(entry.mc_mech) || 0;
  const aero = parseFloat(entry.mc_aero) || 0;
  if (mech + aero <= 0) return null;
  return mech / (mech + aero) * 100;
}

// Derives a session's actual duration in seconds from its stored raw data.
// Priority matches what was validated against real exported history data:
// result.m/s (the actual logged completion time) first — NOT roundSplits,
// since some modes (EXMOM) reset their per-round split rather than
// accumulating it, which silently produced wildly wrong durations when
// trusted first. Falls back to roundSplits only if no result exists, and
// to the time cap only as a last resort when nothing else is available.
function deriveSessionDurationSec(entry) {
  let total = 0, hasResult = false;
  (entry.blocks || []).forEach(b => {
    const r = b.result || {};
    if (r.m || r.s) {
      total += (parseFloat(r.m) || 0) * 60 + (parseFloat(r.s) || 0);
      hasResult = true;
    } else if (b.mode === 'amrap') {
      total += (parseInt(b.dur) || 0) * 60;
      hasResult = true;
    } else if (b.mode === 'emom' || b.mode === 'exmom') {
      total += (parseInt(b.totalInt) || 0) * (parseInt(b.intSec) || 0);
      hasResult = true;
    }
  });
  if (hasResult) return total;
  if (entry.roundSplits && entry.roundSplits.length) {
    return Math.max(...entry.roundSplits.map(rs => rs.cumSec || 0));
  }
  return (entry.blocks || []).reduce((sum, b) => sum + (parseInt(b.cap) || 0) * 60, 0);
}

// Backfills duration_sec and bw for historical sessions that predate the
// Power feature, so Mechanical/Aerobic/Overhead/Total Power can be computed
// for them. Bodyweight is date-gated (not a blanket assumption) because it
// reflects a genuine change over time, unlike Force Bias — see BW_CHANGE_DATE.
const BW_CHANGE_DATE = '2026-06-09';
const BW_BEFORE = 83;
const BW_AFTER  = 80;


function reconstructDurationSec(entry) {
  const blocks = entry.blocks || [];
  if (!blocks.length) return null;
  let totalSec = 0;
  blocks.forEach((b, blockIndex) => {
    const mode = b.mode || 'fortime';
    let sec = 0;
    // Falls back to parsing time out of the detail text when a block has
    // no stored result object at all — older sessions saved before
    // result objects were consistently populated relied entirely on this
    // text, but the parser previously only extracted rounds/extra from
    // it, never time, so any such block silently contributed 0 seconds
    // here regardless of how long it actually took.
    let resultM = parseFloat(b.result?.m);
    let resultS = parseFloat(b.result?.s);
    if ((isNaN(resultM) || (resultM === 0 && isNaN(resultS))) && !b.result) {
      const parsed = parseResultFromDetail(entry.detail, blockIndex);
      if (parsed && parsed.m != null) { resultM = parsed.m; resultS = parsed.s; }
    }
    if (mode === 'fortime') {
      sec = (parseFloat(resultM) || 0) * 60 + (parseFloat(resultS) || 0);
    } else if (mode === 'amrap') {
      sec = (parseFloat(b.dur) || 0) * 60;
    } else if (mode === 'emom' || mode === 'exmom') {
      const intLen = parseInt(b.int) || 60;
      const totalInt = parseInt(b.totalInt) || 1;
      const hasRealTime = !isNaN(resultM) && !isNaN(resultS) && (resultM > 0 || resultS > 0);
      sec = hasRealTime ? (resultM * 60 + resultS) : (intLen * totalInt);
    } else if (mode === 'tabata') {
      const r = parseInt(b.tabR) || 8;
      sec = r * ((parseInt(b.work) || 20) + (parseInt(b.rest) || 10));
    }
    totalSec += sec;
  });
  const restPerGap = parseFloat(entry.restDuration) || 0;
  if (blocks.length > 1) totalSec += restPerGap * (blocks.length - 1);
  return Math.max(1, Math.round(totalSec));
}

