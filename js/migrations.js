/* ════════════════════════════════════════════════════
   MIGRATIONS
   One-time, run-once-and-done functions that repair or
   upgrade previously-saved history entries when a formula
   or schema changes — each iterates all of history, fixes
   what needs fixing, and is safe to run repeatedly (already-
   correct entries are left alone).
════════════════════════════════════════════════════ */

const OVERHEAD_REF_TARGET_VERSION = 3;

// Recalculates Overhead for every session using RPE directly instead of an
// inferred relative-intensity ceiling. Replaces the entire class of
// problems the ceiling approach had — no reference session to keep stable,
// no rolling window to age sessions in or out of, no mechanical/aerobic
// composition mismatch between the session and its reference. RPE is
// collected as a required part of result entry, so every session already
// has a direct, honest answer to "how hard did this feel" without needing
// to infer it from an unrelated proxy.
function migrateOverheadReference() {
  const hist = getHistory();
  const age = parseInt(document.getElementById('global-age')?.value) || 30;
  const gender = document.getElementById('global-gender')?.value || 'male';
  const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
  const genderFactor = gender === 'female' ? 0.92 : 1.0;

  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.overheadRefVersion) === OVERHEAD_REF_TARGET_VERSION) return;
    const overheadOld = parseFloat(w.mc_overhead) || 0;
    const mechKcal = parseFloat(w.mc_mech) || 0;
    const cardioKcal = parseFloat(w.mc_aero) || 0;
    const durSec = parseFloat(w.duration_sec) || 0;
    const bw = parseFloat(w.bw) || 0;
    const vo2max = parseFloat(w.vo2max_used) || 0;
    const rpe = parseFloat(w.rpe) || 0;
    if (!durSec || !bw || !vo2max || !rpe) { w.overheadRefVersion = OVERHEAD_REF_TARGET_VERSION; processedEntries.push(w); return; }

    const relIntensity = Math.min(1.0, rpe / 10);
    const vo2Session = relIntensity * vo2max;
    const met = vo2Session / 3.5;
    const timeHours = durSec / 3600;
    const totalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
    const overheadNew = Math.max(0, Math.round(totalMetEstimate - mechKcal - cardioKcal));
    const mcNew = mechKcal + cardioKcal + overheadNew;

    if (overheadNew !== overheadOld) {
      w.mc_overhead = overheadNew;
      w.mc = mcNew.toFixed(0);
      // FB is intentionally untouched here — under the current formula
      // (tonnage / mechanical work only), FB no longer depends on Overhead
      // at all, so correcting Overhead has no bearing on it.
      updated++;
      changedEntries.push(w);
    }
    w.overheadRefVersion = OVERHEAD_REF_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.overheadref.migrated').replace('{n}', updated) : t('toast.overheadref.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Overhead reference migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.overheadref.exists'));
  }
}

async function _runRadarAxisRepair() {
  const hist = getHistory();
  const maxes = getRadarMaxes();
  const changed = [];

  hist.forEach(w => {
    if (!sessionHasRadar(w)) return; // wouldn't show the card anyway — not worth recomputing
    const existing = w.radar;
    if (existing && existing._normalised && (existing._v || 0) >= 3) return; // already on the new schema
    const raw = computeRadarValuesForSession(w);
    w.radar = {
      pd: Math.min(1, Math.max(0, raw.pd / maxes.pd)),
      wd: Math.min(1, Math.max(0, raw.wd / maxes.wd)),
      cvIntensity: Math.min(1, Math.max(0, raw.cvIntensity / maxes.cvIntensity)),
      fb: Math.min(1, Math.max(0, raw.fb / maxes.fb)),
      internalLoad: Math.min(1, Math.max(0, raw.internalLoad / maxes.internalLoad)),
      td: Math.min(1, Math.max(0, raw.td / maxes.td)),
      _normalised: true,
      _v: 3
    };
    changed.push(w);
  });

  if (changed.length === 0) {
    showToast(t('toast.radaraxis.repair.none') || 'All session signatures already up to date');
    const btn = document.getElementById('history-repair-radaraxis-btn');
    if (btn) btn.style.display = 'none';
    return;
  }

  saveHistory(hist);

  const sb = getSB();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      const uid = session.user.id;
      for (const entry of changed) {
        try { await sbPushHistoryEntry(entry, uid, sb); } catch (e) { /* best-effort — local fix already saved regardless */ }
      }
    }
  }

  showToast(`${t('toast.radaraxis.repair.done') || 'Session signatures updated'} (${changed.length} ${changed.length === 1 ? 'session' : 'sessions'})`);
  const btn = document.getElementById('history-repair-radaraxis-btn');
  if (btn) btn.style.display = 'none';
  if (currentTab === 4) renderHistory();
}

// Estimates total time spent on cardio movements (Run, Row) within a
// session, so Power's denominator can exclude it — Power measures
// mechanical work rate, and time spent running/rowing contributes zero to
// wd, so counting it against Power's duration dilutes the result exactly
// the way "AMRAP mixed" vs "exmom 20 min" demonstrated. Uses real,
// recorded time wherever a block is a standalone single-cardio ForTime
// block (isSingleCardioForTime, same rule as the live-flow metabolic-cost
// calculation); everywhere else, falls back to an estimate.
//
// The estimate uses LINEAR scaling (pace x distance), not Riegel —
// validated against "Cash in/out", the one session with real,
// standalone-block run data to check against: linear scaling's error
// (0.17 min) was roughly 8x smaller than Riegel's (1.46 min). Riegel
// models maximal, distance-optimized race pacing; WOD running is paced
// for the whole session, not maximally for one segment, so a flat-pace
// assumption turned out to be the better fit despite being the
// physiologically cruder formula in the general case.
//
// Which PR to scale from is decided by PER-INSTANCE distance (how far a
// single visit/round covers), not the session's cumulative total — an
// exmom session with 10 short 200m visits and a session with one
// continuous 2000m run are different pacing situations even at equal
// total distance, and using cumulative distance here previously produced
// a physically impossible negative "mechanical time" for a 20-round exmom
// session before this was caught.
//
// Row currently reuses Run's exact logic (same formula, same threshold
// pattern) since no rowing ground-truth data exists yet to validate
// independently — deliberately not inventing new thresholds without data
// to check them against, matching the same caution applied to Run.
//
// Double-under and Ski's own formulas are simpler than Run/Row's (DU is
// linear off one reference value, cadence; Ski reuses the row-style
// single-threshold linear scaling below) so the Riegel-vs-linear
// validation question above doesn't apply to either of them — but that's
// not a reason to leave them out of this function's OUTPUT. This function
// is the sole source getSessionCardioTimeSec() (and Power's denominator)
// draws from, and DU/Ski being absent here meant their time was silently
// never excluded from Power at all, for any session — a past session's
// note about the validation question not applying to DU was mistakenly
// read as "DU doesn't belong in this function," missing that distinction.
// ══ Cardio mechanical work — carved out of mc_aero, feeds Power/mc_mech ══
// Row/Ski: real Concept2 physics — watts (from the same pace-to-watts
// formula already validated for mc_aero) x time = work directly. No
// estimation involved; this is what the machine's own console measures.
//
// Run: same mass x g x vertical-displacement convention every other
// movement in the app already uses (barbell ROM, bodyweight movements),
// but now velocity- and height-responsive instead of fixed population
// defaults. Cadence and vertical oscillation both genuinely change with
// pace — a fixed 8cm/1.5m applied identically to an easy jog and a hard
// tempo run was always going to be wrong at one end or the other.
//
// Cadence: linear in velocity (130 + 11.5*v spm) — verified against
// multiple independently-cited real-world ranges (easy pace ~150-170,
// recreational ~150-180, tempo ~170-178 spm), landing inside all three
// at representative speeds. Not sourced to one single paper with these
// exact coefficients, but output-checked against real published ranges
// across a spread of paces — a real but lower confidence tier than
// Row/Ski's directly-published Concept2 formula.
//
// Height scaling: sqrt(height/1.78), a Froude-pendulum-style adjustment
// (stride frequency scales with 1/sqrt(leg length) in gait dynamic-
// similarity literature) — using height as a leg-length proxy, since
// height/leg-length affecting cadence is independently corroborated by
// other real cadence calculators, even though exact leg length isn't
// tracked. 1.78m reference height, falls back cleanly if height isn't set.
//
// Vertical oscillation: decreases with pace (0.11 - 0.01*v), clamped at
// a 5cm floor for fast running — matches the known trend from published
// research (6-10cm recreational, narrower/lower for elite/faster paces).
// Horizontal propulsion is still deliberately excluded, same as every
// other movement's horizontal component — that's metabolic cost, not
// mechanical work, by the app's existing, consistent convention.
//
// DU: same convention, but jump height is derived from the athlete's
// own DU cadence (pr-du) instead of a population default — using a
// validated data point (60 DU/min -> 0.35s air time -> 15.02cm via
// projectile motion, h = g*airTime^2/8) generalized as a fixed 35%
// air-time-to-cycle-time ratio. A faster cadence implies less time
// available per rep, hence a lower jump — directionally correct
// (elite unbroken DU is barely-off-the-ground wrist-driven rotation,
// not big hops), though the 35% ratio itself rests on one athlete's
// data point, not a broader study across cadences.
function migrateBodyweightCorrection() {
  const hist = getHistory();
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.bwCorrectionVersion) === BW_CORRECTION_TARGET_VERSION) return;
    if (new Date(w.date) >= new Date(BW_CHANGE_DATE)) { w.bwCorrectionVersion = BW_CORRECTION_TARGET_VERSION; processedEntries.push(w); return; } // not affected — already using known bodyweight
    if (!w.blocks || !w.blocks.length) { w.bwCorrectionVersion = BW_CORRECTION_TARGET_VERSION; processedEntries.push(w); return; }

    const { workKJ } = reconstructMechanicalWork(w, BW_AFTER, hMetres);
    const newMechKcal = Math.round((workKJ / 4.184) / 0.22);
    const oldMechKcal = parseFloat(w.mc_mech) || 0;

    if (newMechKcal !== oldMechKcal || Number(w.bw) !== BW_AFTER) {
      w.wd = workKJ.toFixed(2);
      w.mc_mech = newMechKcal;
      w.bw = BW_AFTER;
      updated++;
      changedEntries.push(w);
    }
    w.bwCorrectionVersion = BW_CORRECTION_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.bwcorrection.migrated').replace('{n}', updated) : t('toast.bwcorrection.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Bodyweight correction push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.bwcorrection.exists'));
  }
}

const BW_WORK_PCT_TARGET_VERSION = 1;

// v2: bumped from 1 to propagate the cardio-time-exclusion fix (see
// getSessionCardioTimeSec/getSessionPower) to every session's STORED pd
// value, not just the on-the-fly getSessionPower() calculation. Several
// display paths (History modal, sort-by-Power, benchmark percentiles,
// Analytics charts) already preferred getSessionPower() over the stored
// pd and so were automatically corrected the moment that function
// changed — but a handful of paths (benchmark distribution stats,
// week-over-week PD averaging, the radar chart's PD axis) read w.pd
// directly with no such fallback, and needed the stored value itself
// corrected to pick up the fix at all.
const POWER_FIX_TARGET_VERSION = 2;

// Corrects pd for any session where the stored value doesn't match the
// current, correct calculation. v1 caught sessions where Power was
// accidentally computed via mc_mech instead of directly from wd. v2 adds
// the cardio-time exclusion: time spent running/rowing contributes zero
// to wd, so counting it against Power's denominator dilutes the result —
// validated across seven real sessions, corrections ranging from +11.9%
// to +94.6% once excluded. wd itself was never wrong in either case; this
// just recomputes pd from the reliable, already-correct source.
function migratePowerFix() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.powerFixVersion) === POWER_FIX_TARGET_VERSION) return;
    const wd = parseFloat(w.wd) || 0;
    const durSec = parseFloat(w.duration_sec) || 0;
    const bw = parseFloat(w.bw) || 0;
    if (!wd || !durSec || !bw) { w.powerFixVersion = POWER_FIX_TARGET_VERSION; processedEntries.push(w); return; }

    const cardioSec = getSessionCardioTimeSec(w);
    const mechSec = Math.max(1, durSec - cardioSec);
    const correctPd = ((wd * 1000) / mechSec / bw).toFixed(2);
    const oldPd = w.pd != null ? parseFloat(w.pd).toFixed(2) : null;

    if (correctPd !== oldPd) {
      w.pd = correctPd;
      updated++;
      changedEntries.push(w);
    }
    w.powerFixVersion = POWER_FIX_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.powerfix.migrated').replace('{n}', updated) : t('toast.powerfix.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Power fix push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.powerfix.exists'));
  }
}

// Computes Bodyweight Work % for historical sessions — the share of total
// mechanical work that came from unloaded (bodyweight-only) movements vs
// externally loaded ones. Uses each session's own stored bw (already
// corrected by migrateBodyweightCorrection) and current ROM, same
// reconstruction approach as the other historical migrations tonight.
function migrateBwWorkPct() {
  const hist = getHistory();
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.bwWorkPctVersion) === BW_WORK_PCT_TARGET_VERSION) return;
    if (!w.blocks || !w.blocks.length || w.bw == null) { w.bwWorkPctVersion = BW_WORK_PCT_TARGET_VERSION; processedEntries.push(w); return; }

    const { loadedWorkKJ, unloadedWorkKJ } = reconstructMechanicalWork(w, parseFloat(w.bw), hMetres);
    const total = loadedWorkKJ + unloadedWorkKJ;
    const newPct = total > 0 ? Math.round((unloadedWorkKJ / total) * 100) : null;
    const oldPct = (w.bw_work_pct === null || w.bw_work_pct === undefined) ? null : parseFloat(w.bw_work_pct);

    if (newPct !== oldPct) {
      w.bw_work_pct = newPct;
      updated++;
      changedEntries.push(w);
    }
    w.bwWorkPctVersion = BW_WORK_PCT_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.bwworkpct.migrated').replace('{n}', updated) : t('toast.bwworkpct.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Bodyweight Work % push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.bwworkpct.exists'));
  }
}

// returnContext (optional, default false): when true, returns
// {rl, movementName, weight} instead of just the number — tracks which
// exact movement and weight produced the session's peak RL, updated
// alongside rmMax rather than recomputed separately, so the two can
// never disagree. Existing callers (Neural Fatigue, the Weekly Peak
// Load chart's own bars) don't pass this and get the exact same number
// return as before — this is an additive capability, not a change to
// what anything already depends on.
function migrateDurationV2() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];
  hist.forEach(w => {
    if (Number(w.durationV2Version) === DURATION_V2_TARGET_VERSION) return;
    const trueDuration = parseAggregateTime(w.detail);
    if (trueDuration != null && trueDuration !== (parseFloat(w.duration_sec) || 0)) {
      w.duration_sec = trueDuration;
      updated++;
      changedEntries.push(w);
    }
    w.durationV2Version = DURATION_V2_TARGET_VERSION;
    processedEntries.push(w);
  });
  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.duration.migrated').replace('{n}', updated) : t('toast.duration.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Duration migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.duration.exists'));
  }
}

function migrateRL() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];
  hist.forEach(w => {
    if (Number(w.rlVersion) === RL_TARGET_VERSION) return;
    if (!w.blocks || !w.blocks.length) { w.rlVersion = RL_TARGET_VERSION; processedEntries.push(w); return; }
    const newRL = reconstructRL(w);
    // A stored null/undefined rl is never treated as equal to a computed 0 —
    // otherwise a session that's null because of the earlier "|| null" bug
    // would look unchanged (both effectively "no value") and the broken
    // null would never get corrected to the genuine, correct 0.
    const oldRl = (w.rl === null || w.rl === undefined) ? null : parseFloat(w.rl);
    console.log(`[migrateRL] ${w.label} (${w.date?.slice(0,10)}): oldRl=${oldRl}, newRL=${newRL}, willUpdate=${newRL !== oldRl}`);
    if (newRL !== oldRl) {
      w.rl = newRL;
      updated++;
      changedEntries.push(w);
    }
    w.rlVersion = RL_TARGET_VERSION;
    processedEntries.push(w);
  });
  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.rl.migrated').replace('{n}', updated) : t('toast.rl.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] RL migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.rl.exists'));
  }
}

function migratePatternProfile() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  hist.forEach(w => {
    if (Number(w.patternProfileVersion) === PATTERN_PROFILE_TARGET_VERSION) return;
    if (!w.blocks || !w.blocks.length) { w.patternProfileVersion = PATTERN_PROFILE_TARGET_VERSION; return; }
    w.patternProfile = reconstructPatternProfile(w);
    w.patternProfileVersion = PATTERN_PROFILE_TARGET_VERSION;
    updated++;
    changedEntries.push(w);
  });
  if (updated > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast('✅ ' + t('toast.patternprofile.migrated').replace('{n}', updated));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of changedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Pattern profile migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${changedEntries.length} pattern profile corrections to cloud`);
      });
    } else {
      changedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.patternprofile.exists'));
  }
}

function migrateVo2maxCorrection() {
  const correctedVo2max = parseFloat(document.getElementById('global-vo2max')?.value) || null;
  if (!correctedVo2max) { showToast(t('toast.vo2max.novalue')); return; }
  const { updated, changedEntries, attemptedEntries, hist } = recalculateOverheadForVo2max(correctedVo2max);
  const allTouched = [...changedEntries, ...attemptedEntries];
  if (allTouched.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    if (updated > 0) {
      showToast('✅ ' + t('toast.vo2max.migrated').replace('{n}', updated));
    } else {
      showToast(t('toast.vo2max.exists'));
    }
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of allTouched) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] VO2max correction push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${changedEntries.length} corrections and ${attemptedEntries.length} attempted-markers to cloud`);
      });
    } else {
      allTouched.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.vo2max.exists'));
  }
}

function migratePowerFields() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];
  hist.forEach(w => {
    if (Number(w.powerVersion) === 1) return; // already migrated or already had real data
    if (w.duration_sec != null && w.bw != null) { w.powerVersion = 1; processedEntries.push(w); return; }
    const durSec = deriveSessionDurationSec(w);
    if (!durSec) { w.powerVersion = 1; processedEntries.push(w); return; } // nothing to derive safely — mark done, leave as-is
    w.duration_sec = durSec;
    w.bw = new Date(w.date) < new Date(BW_CHANGE_DATE) ? BW_BEFORE : BW_AFTER;
    w.powerVersion = 1;
    updated++;
    changedEntries.push(w);
    processedEntries.push(w);
  });
  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.power.migrated').replace('{n}', updated) : t('toast.power.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Power field migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real backfills) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.power.exists'));
  }
}

// Phase 1 of the settled Type-metric redesign: FB now measures loaded
// intensity purely — tonnage divided by mechanical work only, excluding
// both Aerobic and Overhead entirely. This is a genuine reformulation, not
// a bug fix — the previous (fbVersion 2) formula divided by full metabolic
// cost, diluting FB by Overhead specifically, which we established should
// never factor into a Type-side metric since it depends on current fitness
// state, not what actually happened in the session.
function migrateFBReformulation() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  hist.forEach(w => {
    if (Number(w.fbVersion) === 3) return;
    const oldFb = parseFloat(w.fb) || 0;
    const mc = parseFloat(w.mc) || 0;
    const mechKcal = parseFloat(w.mc_mech) || 0;
    if (!oldFb || !mc || !mechKcal) { w.fbVersion = 3; return; }
    const tonnage = oldFb * mc; // back-derive tonnage from the current (fbVersion 2) formula
    w.fb = (tonnage / mechKcal).toFixed(0);
    w.fbVersion = 3;
    updated++;
    changedEntries.push(w);
  });
  if (updated > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast('✅ ' + t('toast.fbreform.migrated').replace('{n}', updated));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of changedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] FB reformulation push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${changedEntries.length} FB corrections to cloud`);
      });
    } else {
      changedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.fbreform.exists'));
  }
}

// FB precision fix: migrateFBReformulation() back-derived tonnage from the
// already-rounded fbVersion-2 value (tonnage = oldFb * mc), which could
// carry forward a small rounding artifact from that earlier value into the
// new formula. This recomputes tonnage directly from each session's raw
// blocks instead — the same source-of-truth approach used by every other
// reconstruction tonight — eliminating that drift entirely.
function migrateFBPrecision() {
  const hist = getHistory();
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.fbVersion) === 4) return;
    if (!w.blocks || !w.blocks.length || w.bw == null || !w.mc_mech) { w.fbVersion = 4; processedEntries.push(w); return; }

    const { tonnage } = reconstructMechanicalWork(w, parseFloat(w.bw), hMetres);
    const mechKcal = parseFloat(w.mc_mech);
    const oldFb = parseFloat(w.fb) || 0;
    const newFb = mechKcal > 0 ? Math.round(tonnage / mechKcal) : 0;

    if (newFb !== oldFb && newFb > 0) {
      w.fb = newFb.toFixed(0);
      updated++;
      changedEntries.push(w);
    }
    w.fbVersion = 4;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.fbprecision.migrated').replace('{n}', updated) : t('toast.fbprecision.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] FB precision fix push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.fbprecision.exists'));
  }
}

// FB now divides by raw mechanical work (wd, kJ) instead of mc_mech (the
// metabolic-cost-equivalent, which applies a 22% muscular-efficiency
// factor). That efficiency conversion has no place in FB — it's meant to
// be a loading-character ratio (tonnage relative to total mechanical
// work), not anything involving estimated fuel cost. Same reasoning as
// why Power was switched off mc_mech earlier tonight, just a smaller
// effect here (~8.6%, since 4.184*0.22 happens to be close to 1) rather
// than Power's ~4.5x inflation.
function migrateFBMechanicalWork() {
  const hist = getHistory();
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.fbVersion) === 5) return;
    if (!w.blocks || !w.blocks.length || w.bw == null) { w.fbVersion = 5; processedEntries.push(w); return; }

    const { tonnage, workKJ } = reconstructMechanicalWork(w, parseFloat(w.bw), hMetres);
    const oldFb = parseFloat(w.fb) || 0;
    const newFb = workKJ > 0 ? Math.round(tonnage / workKJ) : 0;

    if (newFb !== oldFb && newFb > 0) {
      w.fb = newFb.toFixed(0);
      updated++;
      changedEntries.push(w);
    }
    w.fbVersion = 5;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.fbmechwork.migrated').replace('{n}', updated) : t('toast.fbmechwork.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] FB mechanical-work fix push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.fbmechwork.exists'));
  }
}

// v6: bumped from 5 after confirming a session already marked version 5
// still held a stale wd value relative to the current
// reconstructMechanicalWork() — the personalized bodyweight-CoM
// calculation for squat/lunge patterns evidently changed after that
// session was migrated, with no version bump at the time to signal
// affected sessions needed re-processing. Re-running is safe and
// idempotent: sessions already correctly up to date recompute to the
// same values, only genuinely stale ones actually change.
// v7: bumped from 6 to propagate wd's increased storage precision
// (1 decimal -> 2) to already-migrated sessions. wd was being rounded
// enough to occasionally land on the wrong side of a Power rounding
// boundary compared to the live, full-precision calculation — same
// session, same underlying numbers, but a live-vs-historical display
// that could differ by 0.01 purely from this precision loss. Confirmed
// directly against a real session sitting almost exactly on that
// boundary. Re-running is safe: sessions unaffected by the boundary
// issue just get their wd value refreshed with more decimal places at
// the same underlying magnitude.
// v8: mc_overhead now uses real per-block reconstruction
// (reconstructBlockOverheadList, with its new single-flat-RPE-per-block
// fallback for sessions without entry.blockRpe) instead of this
// migration's old single whole-session subtraction. Recompute is now
// unconditional (not gated behind "did mc_mech change") since the
// overhead formula changed independently of mc_mech.
// v9: Row/Ski/Run/DU's carved mechanical work (getCardioMechanicalWorkKJ)
// now correctly moves mc_aero down by the same amount that moves into
// mc_mech — wd/mechCostKJ from reconstructMechanicalWork() already
// included the carve-out, but mc_aero itself was never being reduced to
// compensate, silently double-counting the carved portion in the total.
// getSessionPower() updated in parallel to stop re-applying its own
// on-the-fly adjustment for entries that have already been through this
// migration (checked via entry.eccentricVersion), which would have
// double-subtracted on top of the now-correctly-adjusted stored fields.
// v10: corrects v9's own mistake, found on a real session — Run/DU's
// mgh-based mechanical estimate, run through the generic 22% muscular-
// efficiency conversion, was found to EXCEED the movement's own total
// validated metabolic cost (physiologically impossible; elastic tendon
// recoil isn't accounted for by that conversion). Row/Ski keep the
// carve-out (their watts/kcal both come from the same validated
// Concept2 pipeline); Run/DU's raw kJ still counts toward Power but no
// longer moves any kcal between mc_aero/mc_mech. Also fixes v9's
// migration itself: mc_aero was being adjusted INCREMENTALLY from
// whatever was already stored, which isn't safe when a previous
// migration run got the carve amount wrong — v10 recomputes mc_aero
// entirely from scratch (getSessionRunAeroKcal + getSessionRowAeroKcal +
// reconstructCardioEnergy) each time, so it self-corrects regardless of
// what v9 already did to the stored value.
// v11: Run/DU dropped from Power's numerator (wd/tw) entirely too, by
// deliberate decision — not just the kcal split. Row/Ski keep their
// full contribution (real, validated Concept2 physics). Run/DU's
// mechanical formulas stay intact and callable in
// getCardioMechanicalWorkKJ(), just no longer aggregated into anything
// that reaches Power or Metabolic Cost — see getCardioWorkBreakdown().
const ECCENTRIC_WORK_TARGET_VERSION = 11;

// Adds eccentric work to mc_mech (Metabolic Cost) ONLY — settled design v3,
// supersedes the earlier v2 (which gave cyclical movements x2 credit in wd
// too). wd (Power) is now ALWAYS pure concentric, unconditionally, for
// EVERY movement — cyclical and one-directional alike. That asymmetry
// (cyclical=x2/one-directional=x1) never actually resolved genuine
// uncertainty for cyclical movements the way it did for one-directional
// ones, since a cyclical movement's eccentric phase always happens
// unconditionally (no dropped-vs-controlled choice exists for e.g. Back
// Squat) — so crediting it "because time can't tell us otherwise" was
// inconsistent with the one-directional rule's own logic. wd/Power now
// measures one uniform thing: the rate of productive, directional work,
// not the full bidirectional cycle, for every movement without exception.
//
// mc_mech is unaffected by this — cyclical movements still always get full
// eccentric credit (x7/6, unconditional); one-directional movements read
// the per-movement-instance "controlled descent" toggle (mv.controlledDescent)
// — a genuine athlete self-report — defaulting to true (full credit) for
// historical sessions saved before this field existed, matching the
// athlete's real, stated no-throw training practice. Credit at mc_mech is
// ~1/6 weight (x7/6 total, Aura & Komi 1986 re: eccentric's real metabolic
// cost).
//
// This changes wd, mc_mech, mc, fb, and pd together, since all five are
// coupled through the same reconstruction — updating them separately
// would leave them inconsistent with each other mid-migration.
function migrateEccentricWork() {
  const hist = getHistory();
  const hMetres = (parseFloat(document.getElementById('global-h')?.value) || 175) / 100;
  let updated = 0;
  const changedEntries = [];
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.eccentricVersion) === ECCENTRIC_WORK_TARGET_VERSION) return;
    if (!w.blocks || !w.blocks.length || w.bw == null) { w.eccentricVersion = ECCENTRIC_WORK_TARGET_VERSION; processedEntries.push(w); return; }

    const { tonnage, workKJ, mechCostKJ, cardioCarvedKcal } = reconstructMechanicalWork(w, parseFloat(w.bw), hMetres);
    const oldWd = parseFloat(w.wd) || 0;
    const newWd = workKJ;
    const newMechKcal = Math.round((mechCostKJ / 4.184) / 0.22);
    const oldMechKcal = parseFloat(w.mc_mech) || 0;

    // Recompute unconditionally, not just when mc_mech changed — the
    // overhead formula itself changed independently (real per-block
    // reconstruction via reconstructBlockOverheadList, including its new
    // single-flat-RPE fallback for sessions without entry.blockRpe),
    // so an entry needs refreshing even if its mc_mech happens to land
    // on the same number as before.
    w.wd = newWd.toFixed(2);
    w.mc_mech = newMechKcal;
    // mc_aero is recomputed ENTIRELY from scratch each run — not
    // incrementally adjusted from whatever's currently stored. An
    // incremental adjustment assumes the stored value was already
    // correct going in, which isn't safe: a previous migration run
    // (this one, before the Row/Ski-vs-Run/DU carve-out split existed)
    // already carved Run/DU's kcal out of a real session's mc_aero,
    // clamping it to 0. Re-running with only the FIX applied wouldn't
    // restore the correct value from an incrementally-adjusted 0 — it'd
    // just subtract 0 from an already-wrong 0. Recomputing from the
    // entry's own stored blocks each time, via the same functions the
    // live path uses, is the only way to make this self-correcting
    // regardless of what any earlier migration version got wrong.
    const bw = parseFloat(w.bw) || 0;
    const trueAeroKcal = getSessionRunAeroKcal(w) + getSessionRowAeroKcal(w) + reconstructCardioEnergy(w, bw);
    w.mc_aero = Math.max(0, Math.round(trueAeroKcal - cardioCarvedKcal));
    const cardioKcal = w.mc_aero;
    const durSec = parseFloat(w.duration_sec) || 0;

    // Overhead — real per-block reconstruction (each block's own
    // mech/cardio kcal subtracted from its own RPE-implied cost, summed,
    // excluding blocks that are 100% cardio) instead of the old single
    // whole-session subtraction this migration used previously. Falls
    // back to the old inline formula only if reconstruction genuinely
    // isn't possible (no rpe/vo2max_used/blocks at all).
    const blockList = reconstructBlockMovementData(w);
    const blockOverheadList = reconstructBlockOverheadList(w, blockList);
    let overheadKcal;
    if (blockOverheadList) {
      let sum = 0;
      blockList.forEach((blockData, idx) => {
        if (!blockData) return;
        if (!blockData.isPureCardio) sum += blockOverheadList[idx] || 0;
      });
      overheadKcal = Math.round(sum);
    } else {
      const vo2max = parseFloat(w.vo2max_used) || 0;
      const rpe = parseFloat(w.rpe) || 0;
      overheadKcal = parseFloat(w.mc_overhead) || 0; // last-resort fallback: keep old value
      if (durSec > 0 && bw > 0 && vo2max > 0 && rpe > 0) {
        const age = parseInt(document.getElementById('global-age')?.value) || 30;
        const gender = document.getElementById('global-gender')?.value || 'male';
        const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
        const genderFactor = gender === 'female' ? 0.92 : 1.0;
        const relIntensity = Math.min(1.0, rpe / 10);
        const vo2Session = relIntensity * vo2max;
        const met = vo2Session / 3.5;
        const timeHours = durSec / 3600;
        const totalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
        overheadKcal = Math.max(0, Math.round(totalMetEstimate - newMechKcal - cardioKcal));
      }
    }
    const oldOverheadKcal = parseFloat(w.mc_overhead) || 0;

    if (Math.abs(newWd - oldWd) > 0.01 || newMechKcal !== oldMechKcal || overheadKcal !== oldOverheadKcal) {
      w.mc_overhead = overheadKcal;
      w.mc = (newMechKcal + cardioKcal + overheadKcal).toFixed(0);
      w.fb = newWd > 0 ? Math.round(tonnage / newWd).toFixed(0) : '0';
      if (durSec > 0 && bw > 0) {
        // Matches migratePowerFix v2's formula — excludes running/rowing
        // time from Power's denominator, same reasoning as the fix
        // applied to migrateEmomDuration's pd recalculation.
        const cardioSec = getSessionCardioTimeSec(w);
        const mechSec = Math.max(1, durSec - cardioSec);
        w.pd = ((newWd * 1000) / mechSec / bw).toFixed(2);
      }
      updated++;
      changedEntries.push(w);
    }
    w.eccentricVersion = ECCENTRIC_WORK_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.eccentric.migrated').replace('{n}', updated) : t('toast.eccentric.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Eccentric work migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.eccentric.exists'));
  }
}

const CARDIO_EXMOM_FIX_TARGET_VERSION = 4;

// v1: mc_aero never accounted for exmom's station-based rep-counting —
// it used the raw round count directly instead of dividing by station
// count, producing ~4x too much distance/kcal for any exmom block with
// multiple stations.
//
// v2: bumped from 1 to add Run's pace-derived MET fix (see
// getSessionRunAeroKcal) — the flat MET=10 every cardio movement
// previously used made mc_aero's rate mathematically independent of how
// fast the athlete actually ran, confirmed directly against a real
// session's two different-paced reps producing an identical rate despite
// a real ~24% difference in effort. Scope widened from exmom-only to any
// session containing a Run movement in any mode, since this fix isn't
// exmom-specific the way v1's was.
//
// v3: bumped from 2 to add Row's equivalent fix (see getSessionRowAeroKcal)
// — same underlying problem as Run, but a different formula: Concept2's
// pace-to-watts physics combined with a published, rowing-ergometer-
// specific VO2-to-watts regression, not ACSM's running equation (which
// doesn't transfer to rowing biomechanics). Ski/Bike/DU remain on their
// existing flat-MET formula — out of scope for this fix.
//
// v4: bumped from 3 to round newCardioKcal — getSessionRunAeroKcal/
// getSessionRowAeroKcal return raw, unrounded floats, but this was being
// added directly to reconstructCardioEnergy's already-rounded integer
// output, leaving mc_aero stored with many trailing decimals instead of
// a clean whole-kcal number. Cosmetic only — doesn't change any
// downstream calculation, since everything reading mc_aero already
// parses it as a float regardless of how many decimals it carries.
//
// Also recomputes mc_overhead and mc alongside the corrected mc_aero,
// since Overhead is mathematically coupled to mc_aero via subtraction
// from a fixed totalMetEstimate — same coupling principle as the earlier
// mc_mech/Overhead fix.
function migrateCardioExmomFix() {
  const hist = getHistory();
  let updated = 0;
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.cardioExmomFixVersion) === CARDIO_EXMOM_FIX_TARGET_VERSION) return;
    const hasRelevantCardio = (w.blocks || []).some(b =>
      (b.movements || []).some(mv => MASTER_DB[mv.name]?.cardio));
    if (!hasRelevantCardio || w.bw == null) { w.cardioExmomFixVersion = CARDIO_EXMOM_FIX_TARGET_VERSION; processedEntries.push(w); return; }

    const bw = parseFloat(w.bw);
    const newCardioKcal = Math.round(reconstructCardioEnergy(w, bw) + getSessionRunAeroKcal(w) + getSessionRowAeroKcal(w));
    const oldCardioKcal = parseFloat(w.mc_aero) || 0;

    if (newCardioKcal !== oldCardioKcal) {
      w.mc_aero = newCardioKcal;
      const mechKcal = parseFloat(w.mc_mech) || 0;

      const durSec = parseFloat(w.duration_sec) || 0;
      const vo2max = parseFloat(w.vo2max_used) || 0;
      const rpe = parseFloat(w.rpe) || 0;
      let overheadKcal = parseFloat(w.mc_overhead) || 0;
      if (durSec > 0 && bw > 0 && vo2max > 0 && rpe > 0) {
        const age = parseInt(document.getElementById('global-age')?.value) || 30;
        const gender = document.getElementById('global-gender')?.value || 'male';
        const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
        const genderFactor = gender === 'female' ? 0.92 : 1.0;
        const relIntensity = Math.min(1.0, rpe / 10);
        const vo2Session = relIntensity * vo2max;
        const met = vo2Session / 3.5;
        const timeHours = durSec / 3600;
        const totalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
        overheadKcal = Math.max(0, Math.round(totalMetEstimate - mechKcal - newCardioKcal));
      }
      w.mc_overhead = overheadKcal;
      w.mc = (mechKcal + newCardioKcal + overheadKcal).toFixed(0);
      updated++;
    }
    w.cardioExmomFixVersion = CARDIO_EXMOM_FIX_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.cardioexmom.migrated').replace('{n}', updated) : t('toast.cardioexmom.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Cardio exmom fix push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.cardioexmom.exists'));
  }
}

// v2: bumped from 1 after discovering the original delta-based approach
// wasn't idempotent — if it ran twice on the same session for any reason,
// the correction compounded instead of staying stable. Confirmed directly
// against a real affected session where the stored duration matched
// exactly double the intended correction. The v2 logic rebuilds duration
// from scratch instead (see reconstructDurationSec), which is safe to run
// any number of times.
//
// v3: bumped from 2 after discovering reconstructDurationSec's fortime
// branch read block.result directly with no fallback — any older session
// with no stored result object at all (relying entirely on the detail
// text) silently contributed 0 seconds for that block. parseResultFromDetail
// now also extracts time, not just rounds/extra, and reconstructDurationSec
// falls back to it — confirmed against "EMOM + For Time Metabolic", whose
// v2-migrated duration (570s) was wrong by 900s, exactly the size of its
// untracked ForTime block.
const EMOM_DURATION_TARGET_VERSION = 3;

// Fixes a real bug: emom/exmom session duration always used the planned
// config (interval length x total interval count), never the actual
// Timer-tracked elapsed time — even though the Timer was already
// recording it (finishCurrentBlock()'s totalSessionSec). This
// understates the natural pattern where the last completed interval
// finishes before its full length elapses, and — more significantly —
// leaves duration unchanged even when a session stopped early with
// fewer completed intervals than planned. Both cases inflate the stored
// duration relative to reality, which understates Power (wd/duration/bw)
// for the affected session.
//
// Delta-based correction: for each emom/exmom block, compute what its
// duration *should* have been (the block's own stored result.m/result.s,
// when genuinely present — i.e. not both exactly zero, which would only
// happen if the Timer was never actually run for that block) versus what
// it *was* computed as under the old, config-only formula, then adjust
// the session's stored duration_sec by that precise delta. This avoids
// rebuilding duration_sec from scratch — safer than re-deriving every
// block's contribution and rest time, since only the emom/exmom
// component was ever wrong; everything else contributing to the stored
// total was already correct.
// Rebuilds a session's total duration from scratch, using each block's own
// stable fields (never the currently-stored duration_sec) — genuinely
// idempotent, safe to run any number of times, matching the same
// from-scratch-reconstruction pattern already used for mechanical work,
// cardio energy, and energy profile. A delta-based ("adjust the current
// value by X seconds") approach was tried first and found unsafe: if it
// ever ran twice on the same session for any reason, the second run had
// no way to know the correction was already baked in, and compounded it —
// confirmed directly against a real affected session, where the stored
// duration matched exactly double the intended correction.
function migrateEmomDuration() {
  const hist = getHistory();
  let updated = 0;
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.emomDurationVersion) === EMOM_DURATION_TARGET_VERSION) return;
    const blocks = w.blocks || [];
    const hasEmomExmom = blocks.some(b => b.mode === 'emom' || b.mode === 'exmom');
    if (!hasEmomExmom || w.duration_sec == null) { w.emomDurationVersion = EMOM_DURATION_TARGET_VERSION; processedEntries.push(w); return; }

    const newDurSec = reconstructDurationSec(w);
    const oldDurSec = parseFloat(w.duration_sec) || 0;

    if (newDurSec != null && newDurSec !== oldDurSec) {
      w.duration_sec = newDurSec;
      const wd = parseFloat(w.wd) || 0;
      const bw = parseFloat(w.bw) || 0;
      if (wd > 0 && bw > 0) {
        // Matches migratePowerFix v2's formula exactly — excludes
        // running/rowing time from Power's denominator. Recomputing pd
        // here with the OLD formula (no cardio exclusion) would silently
        // regress any session that needs both fixes back to the diluted
        // value, even though its powerFixVersion would still read as
        // current and give no indication anything had changed.
        const cardioSec = getSessionCardioTimeSec(w);
        const mechSec = Math.max(1, newDurSec - cardioSec);
        w.pd = ((wd * 1000) / mechSec / bw).toFixed(2);
      }
      // mc_overhead is mathematically coupled to duration_sec through
      // totalMetEstimate (met x bw x timeHours x ...) — leaving it stale
      // after a duration correction was a real gap in the first version
      // of this migration, same coupling principle as the earlier
      // mc_mech/Overhead and cardio/Overhead fixes.
      const mechKcal = parseFloat(w.mc_mech) || 0;
      const cardioKcal = parseFloat(w.mc_aero) || 0;
      const vo2max = parseFloat(w.vo2max_used) || 0;
      const rpe = parseFloat(w.rpe) || 0;
      if (bw > 0 && vo2max > 0 && rpe > 0) {
        const age = parseInt(document.getElementById('global-age')?.value) || 30;
        const gender = document.getElementById('global-gender')?.value || 'male';
        const ageFactor = Math.max(0.60, 1 - Math.max(0, (age - 25) * 0.01));
        const genderFactor = gender === 'female' ? 0.92 : 1.0;
        const relIntensity = Math.min(1.0, rpe / 10);
        const vo2Session = relIntensity * vo2max;
        const met = vo2Session / 3.5;
        const timeHours = newDurSec / 3600;
        const totalMetEstimate = met * bw * timeHours * ageFactor * genderFactor;
        const overheadKcal = Math.max(0, Math.round(totalMetEstimate - mechKcal - cardioKcal));
        w.mc_overhead = overheadKcal;
        w.mc = (mechKcal + cardioKcal + overheadKcal).toFixed(0);
      }
      updated++;
    }
    w.emomDurationVersion = EMOM_DURATION_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.emomduration.migrated').replace('{n}', updated) : t('toast.emomduration.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Emom duration migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.emomduration.exists'));
  }
}

const PD_STORED_TARGET_VERSION = 1;

// Fixes a real bug: the pd (Power) field saved to history was computed via
// a separate formula routed through window._lastMechKcal/_lastDurationSec/
// _lastBodyweight — but those globals weren't actually assigned until
// later in the same function than where this read them, so the saved
// value silently used stale globals left over from whatever calculation
// ran previously, not the one actually being saved. Confirmed directly
// against a real session where the saved pd was mathematically
// inconsistent with its own saved duration_sec. The live-flow bug itself
// is already fixed (pd now reads the already-correct, already-displayed
// value directly) — this migration corrects the historical fallout: any
// session whose stored pd doesn't match what wd/duration_sec/bw actually
// imply gets recomputed. This matters beyond cosmetics — pd is read
// directly (not via getSessionPower()) in several real places: the
// Profile screen's 6-week Average Power summary, personal-band
// percentile calculations, benchmark qualification checks, several trend
// chart aggregations, and the History edit modal's pre-filled value.
function migratePdStored() {
  const hist = getHistory();
  let updated = 0;
  const processedEntries = [];

  hist.forEach(w => {
    if (Number(w.pdStoredVersion) === PD_STORED_TARGET_VERSION) return;
    const wd = parseFloat(w.wd) || 0;
    const bw = parseFloat(w.bw) || 0;
    const durSec = parseFloat(w.duration_sec) || 0;
    if (wd <= 0 || bw <= 0 || durSec <= 0) { w.pdStoredVersion = PD_STORED_TARGET_VERSION; processedEntries.push(w); return; }

    // Matches migratePowerFix v2's formula — excludes running/rowing time
    // from Power's denominator, same reasoning applied everywhere else pd
    // gets recomputed.
    const cardioSec = getSessionCardioTimeSec(w);
    const mechSec = Math.max(1, durSec - cardioSec);
    const correctPd = ((wd * 1000) / mechSec / bw).toFixed(2);
    const oldPd = w.pd != null ? parseFloat(w.pd).toFixed(2) : null;

    if (oldPd !== correctPd) {
      w.pd = correctPd;
      updated++;
    }
    w.pdStoredVersion = PD_STORED_TARGET_VERSION;
    processedEntries.push(w);
  });

  if (processedEntries.length > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast(updated > 0 ? '✅ ' + t('toast.pdstored.migrated').replace('{n}', updated) : t('toast.pdstored.exists'));
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of processedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] pd correction migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${processedEntries.length} entries (${updated} with real changes) to cloud`);
      });
    } else {
      processedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.pdstored.exists'));
  }
}

function migrateForceBiasFormula() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  hist.forEach(w => {
    if (Number(w.fbVersion) === 2) return; // already using the corrected formula
    const oldFb = parseFloat(w.fb) || 0;
    const wd = parseFloat(w.wd) || 0;
    const mc = parseFloat(w.mc) || 0;
    if (!oldFb || !wd || !mc) { w.fbVersion = 2; return; } // nothing to recalculate safely — mark done, leave as-is
    const tonnage = oldFb * wd;
    w.fb = (tonnage / mc).toFixed(0);
    w.fbVersion = 2;
    updated++;
    changedEntries.push(w);
  });
  if (updated > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast('✅ ' + t('toast.fb.migrated').replace('{n}', updated));
    // Push each corrected entry to Supabase — without this, the next sync
    // would treat cloud as source of truth and silently overwrite the fix.
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of changedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Force Bias migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${changedEntries.length} Force Bias corrections to cloud`);
      });
    } else {
      changedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.fb.exists'));
  }
}

function migrateMetabolicSplits() {
  const hist = getHistory();
  let updated = 0;
  const changedEntries = [];
  hist.forEach(w => {
    if (w.mc_mech != null) return; // already has split
    const mc = parseFloat(w.mc) || 0;
    if (!mc) return;
    const detail = (w.detail || '').toLowerCase();
    const hasCardio = detail.includes('run') || detail.includes('row') ||
                      detail.includes('ski') || detail.includes('bike') ||
                      detail.includes('double-under');
    if (hasCardio) {
      // Rough split — can't know exact without recalculating
      w.mc_mech = Math.round(mc * 0.5);
      w.mc_aero  = mc - w.mc_mech;
    } else {
      // Pure mechanical session
      w.mc_mech = mc;
      w.mc_aero  = 0;
    }
    updated++;
    changedEntries.push(w);
  });
  if (updated > 0) {
    saveHistory(hist);
    renderHistory();
    renderAnalytics();
    showToast('✅ Updated ' + updated + ' sessions with estimated split data');
    const sbInst = getSB();
    if (sbInst) {
      sbInst.auth.getSession().then(async ({ data: { session } }) => {
        if (!session?.user) return;
        const uid = session.user.id;
        for (const entry of changedEntries) {
          try {
            await sbPushHistoryEntry(entry, uid, sbInst);
          } catch (e) {
            console.warn('[sync] Metabolic split migration push failed for one entry:', e);
            queueUpload('history', entry);
          }
        }
        console.log(`[sync] Pushed ${changedEntries.length} metabolic split updates to cloud`);
      });
    } else {
      changedEntries.forEach(entry => queueUpload('history', entry));
    }
  } else {
    showToast(t('toast.split.exists'));
  }
}
