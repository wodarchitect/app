// ── Coaching Insight ──────────────────────────────────────────────────────
// NOTE: INSIGHT_MIN_SESSIONS is also referenced in builder.js and
// plan-training.js (both check it inside function bodies, not at
// top-level, so they resolve it correctly at call time regardless of
// script load order — but it's worth knowing this constant isn't
// exclusively used here).
const INSIGHT_MIN_SESSIONS = 10;
const INSIGHT_REGEN_TRAINING_DAYS = 4;  // min distinct training days (not raw session count) before refresh allowed
const INSIGHT_REGEN_DAYS = 14;          // min calendar days before refresh allowed

function _insightRefreshDue(cached, hist) {
  if (!cached) return true;
  const sessionsDiff = Math.max(0, hist.length - (cached.sessionCount || 0));
  // Count distinct training DAYS among the sessions added since the cached generation
  // (hist is stored newest-first via unshift) — not raw session count. Someone logging
  // 2 sessions/day shouldn't reach the threshold twice as fast as someone logging 1/day;
  // both represent the same real training frequency.
  const newSessions = hist.slice(0, sessionsDiff);
  const trainingDaysDiff = new Set(newSessions.map(w => localDateStr(new Date(w.date)))).size;
  const daysDiff = cached.generatedAt ? (Date.now() - new Date(cached.generatedAt).getTime()) / 86400000 : 999;
  return trainingDaysDiff >= INSIGHT_REGEN_TRAINING_DAYS && daysDiff >= INSIGHT_REGEN_DAYS;
}
let _insightExpanded = localStorage.getItem('wod-insight-expanded') === 'true';
let _insightCache = null; // { summary, goalAlignment, recovery, recommendations, generatedAt, sessionCount, lang, goal }

// ══ Coach Action Cards ══
// One card per tracked recommendation. Each card runs a fixed 6-week
// window (always 6, regardless of what the recommendation's own prose
// says about duration — settled design: simpler than letting the LLM
// set a variable length per card, and avoids needing the LLM to output
// a duration field at all).
//
// Card shape:
//   {
//     id: string — stable identity for this card, unrelated to its
//       structuredTarget (which can change identity via a reset) or its
//       array position. Generated once at creation, never reused.
//     structuredTarget: { type, ...type-specific fields, target } —
//       the machine-checkable definition of what this card tracks.
//       THIS, not the display text, is what defines whether an
//       incoming recommendation is "the same action" for matching/
//       reset purposes — the display text is free text the LLM writes
//       fresh every cycle and is expected to vary in wording even when
//       the intent is identical.
//     lang: 'en' | 'es' — the language headline/diagnosticWhy/
//       prescribedAction/latestCommentary are CURRENTLY written in, set
//       at creation or reset from the global _lang. The Analytics
//       render filters displayed cards to lang === current display
//       language — a card generated in the other language is hidden,
//       never shown mixed in alongside these. A card only "switches"
//       language if a later cycle's structuredTarget happens to match
//       it (a reset updates lang along with everything else); there is
//       deliberately no bilingual storage — English and Spanish
//       versions of the same underlying recommendation are allowed to
//       differ, even disagree, since the athlete only ever sees one
//       language at a time and generating both every cycle roughly
//       doubled response size for a guarantee nobody needed (see the
//       reverted bilingual attempt in git history / prior session).
//     headline / diagnosticWhy / prescribedAction: display text, all
//       in `lang`. Overwritten on reset with whatever the LLM wrote
//       that cycle — the display text should reflect how the coach is
//       currently phrasing it, not freeze at the original wording.
//     category: one of the four CARD_CATEGORY_DISPLAY keys — language-
//       independent (an enum, not display text).
//     startDate: ISO date string — when this card's CURRENT 6-week
//       window began. A reset sets this to now, discarding the old
//       window entirely rather than preserving a partial history with
//       a gap in the middle (settled design).
//     weeklyResults: array of 6 — boolean or null per week of the
//       window. null = week hasn't happened yet (future) or hasn't
//       been evaluated yet (current, in-progress week); true/false =
//       an evaluated past week's pass/fail. Index 0 = the week
//       starting at startDate.
//     latestCommentary: string | null — the coach's most recent
//       encouragement on this card, in `lang`. Cleared on reset (see
//       upsertActionCard) since it refers to the prior window.
//   }
//
// Known structuredTarget.type values (extend this list as new types
// are designed, rather than inventing ad-hoc shapes per card):
//   'movement_pattern_count' — { pattern: one of getMovementPattern()'s
//     keys (e.g. 'pattern.pull'), target: N } — met a week by including
//     at least N sessions that week with >=1 movement of this pattern.
//   'weekly_session_consistency' — { target: N, tolerance: N } — met a
//     week if that week's total session count falls within
//     [target-tolerance, target+tolerance].
// (Only these two are designed so far — modality/duration-based targets
// like "20-40min aerobic session" still need their own type before a
// recommendation of that shape can become a trackable card; until then
// it stays commentary-only prose with no progress grid.)

function getActionCards() {
  try { return JSON.parse(localStorage.getItem('wod-action-cards') || '[]'); }
  catch (e) { return []; }
}

function saveActionCards(cards) {
  try {
    localStorage.setItem('wod-action-cards', JSON.stringify(cards));
    _syncActionCardsToCloud(cards);
    return true;
  }
  catch (e) { console.error('[action cards] save failed:', e); return false; }
}

// Fire-and-forget, not awaited — same pattern the existing
// coaching_insight cloud push already uses (see generateCoachingInsight
// below). Deliberately silent on failure beyond the console warning:
// saveActionCards's own return value reflects whether the LOCAL write
// succeeded, since that's the one the rest of the app depends on
// synchronously — a cloud push failing (offline, no session) shouldn't
// make local save/render logic behave as though nothing was saved at
// all when the local copy is in fact fine.
async function _syncActionCardsToCloud(cards) {
  try {
    const sb = getSB();
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return;
    await sb.from('profiles').upsert({ id: session.user.id, action_cards: cards, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  } catch (e) { console.warn('[action cards] cloud sync failed:', e); }
}

// Deliberately NOT JSON.stringify comparison — key order isn't
// guaranteed to match between an existing card's stored target and a
// freshly-parsed one from the LLM's latest response, and a naive
// string comparison would treat two functionally-identical targets
// with differently-ordered keys as different actions, silently
// defeating the whole point of matching on structure over prose.
function structuredTargetsMatch(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => a[k] === b[k]);
}

function findMatchingActionCard(cards, structuredTarget) {
  return cards.find(c => structuredTargetsMatch(c.structuredTarget, structuredTarget)) || null;
}

function _newActionCardId() {
  return 'ac_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Creates a new card, OR resets an existing one in place if
// structuredTarget already matches one of the cards passed in — same
// operation either way from the caller's perspective (upsert), since
// "is this actually new or a reset" is exactly the ambiguity this
// function exists to resolve via structuredTargetsMatch rather than
// making every call site re-implement that check. Returns the full,
// updated cards array — does not save it; the caller decides when to
// persist, since this may be called several times in a row while
// processing one insight response before a single save at the end.

// Valid category values — same validate-don't-trust reasoning as
// VALID_MOVEMENT_PATTERNS below: the prompt asking for one of these
// four strings is not a guarantee one came back.
const VALID_CARD_CATEGORIES = new Set(['PATTERN_IMBALANCE', 'GOAL_ALIGNMENT', 'LOAD_PERIODIZATION', 'RECOVERY']);

// cardContent = { headline, diagnosticWhy, prescribedAction, category }
// — single-language again (reverted from the bilingual shape — see
// generateCoachingInsight's cache-key comment for why). Headline is
// defensively truncated to 8 words here (not just requested in the
// prompt) for the same reason every other LLM-supplied constraint in
// this file is re-enforced in code rather than trusted: a word-count
// instruction is a request, not a guarantee. category falls back to
// 'PATTERN_IMBALANCE' if missing or not one of the four known values,
// rather than leaving the card with an unrenderable badge.
function _sanitizeCardContent(cardContent) {
  const headline = (cardContent.headline || '').trim().split(/\s+/).slice(0, 8).join(' ');
  return {
    headline,
    diagnosticWhy: cardContent.diagnosticWhy || '',
    prescribedAction: cardContent.prescribedAction || '',
    category: VALID_CARD_CATEGORIES.has(cardContent.category) ? cardContent.category : 'PATTERN_IMBALANCE'
  };
}

// lang: the language this card's text is CURRENTLY in — read from the
// global _lang at the moment of creation/reset, not passed explicitly,
// since this is always called from within a single generation's own
// language context. This is the actual fix for the original mixing
// bug: rendering filters action cards to lang === current display
// language, so a card generated in one language never shows up
// alongside cards from the other — it's simply hidden until the
// athlete is back in its language, or until a matching structuredTarget
// resets it (updating its lang along with everything else, effectively
// "converting" it rather than leaving a stale duplicate behind).
function upsertActionCard(cards, structuredTarget, cardContent) {
  const existing = findMatchingActionCard(cards, structuredTarget);
  const today = new Date().toISOString().slice(0, 10);
  const content = _sanitizeCardContent(cardContent);
  const lang = _lang === 'es' ? 'es' : 'en';
  if (existing) {
    Object.assign(existing, content);
    existing.lang = lang;
    existing.startDate = today;
    existing.weeklyResults = [null, null, null, null, null, null];
    // A reset also clears any leftover commentary from the prior
    // window — it referred to the old 6-week cycle's progress, and
    // showing it under a grid that just restarted would misrepresent
    // it as current.
    existing.latestCommentary = null;
    return cards;
  }
  cards.push({
    id: _newActionCardId(),
    structuredTarget,
    lang,
    ...content,
    startDate: today,
    weeklyResults: [null, null, null, null, null, null]
  });
  return cards;
}

// Week i of a card's window is [startDate + i*7 days, startDate + (i+1)*7 days).
function _getCardWeekRange(card, weekIndex) {
  const start = new Date(card.startDate + 'T00:00:00');
  start.setDate(start.getDate() + weekIndex * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

// Pure function: given a concrete date range and the type-specific
// target, returns true/false — or null if this target's type isn't
// (yet) one this function knows how to evaluate, e.g. a card created
// for a recommendation shape that only has commentary-level tracking
// so far (see the type list documented above upsertActionCard). null
// here means "can't determine," same meaning as an unevaluated future
// week — refreshActionCardResults leaves both as null rather than
// guessing.
//
// Separated from refreshActionCardResults (which decides WHICH weeks
// need evaluating) so this piece — the actual pass/fail rule per type —
// is independently testable and is the one place each target type's
// logic lives, rather than duplicated across every caller that needs
// to check a week.
function evaluateCardWeek(structuredTarget, weekStart, weekEnd, hist) {
  const weekSessions = hist.filter(w => {
    if (!w.date) return false;
    const d = new Date(w.date);
    return d >= weekStart && d < weekEnd;
  });

  if (structuredTarget.type === 'movement_pattern_count') {
    const matchCount = weekSessions.filter(w =>
      (w.blocks || []).some(block =>
        (block.movements || []).some(mv => getMovementPattern(mv.name) === structuredTarget.pattern)
      )
    ).length;
    return matchCount >= structuredTarget.target;
  }

  if (structuredTarget.type === 'weekly_session_consistency') {
    const count = weekSessions.length;
    const tolerance = structuredTarget.tolerance || 0;
    return count >= (structuredTarget.target - tolerance) && count <= (structuredTarget.target + tolerance);
  }

  return null; // unknown/unsupported type — not evaluable yet
}

// Fills in weeklyResults for every card, for every week that has fully
// elapsed (weekEnd <= now) and hasn't already been evaluated (still
// null). Never re-evaluates a week that already holds true/false —
// that result is locked in once a week has passed; only a reset (via
// upsertActionCard, a separate operation) clears results back to null.
// A week that's still in progress (now falls inside its range) stays
// null on purpose — more sessions could still be logged before it
// ends, so evaluating it early could lock in a wrong answer.
//
// Returns the updated cards array; does not save it, matching
// upsertActionCard's pattern — call sites decide when to persist,
// since this is meant to run as a cheap refresh (e.g. on app load or
// before rendering the cards UI) that may not always need a write.
function refreshActionCardResults(cards, hist) {
  const now = new Date();
  cards.forEach(card => {
    for (let i = 0; i < 6; i++) {
      if (card.weeklyResults[i] !== null) continue; // already locked in
      const { start, end } = _getCardWeekRange(card, i);
      if (now < end) break; // this week and every week after it haven't fully elapsed yet — stop, don't skip ahead into future weeks
      card.weeklyResults[i] = evaluateCardWeek(card.structuredTarget, start, end, hist);
    }
  });
  return cards;
}

// Valid pattern.* keys getMovementPattern() can actually return — kept
// as an explicit list (not derived from the function itself, which has
// no "list all possible outputs" mode) so an LLM-supplied
// structuredTarget.pattern can be validated against real values rather
// than trusted on the strength of the prompt instruction alone.
const VALID_MOVEMENT_PATTERNS = new Set([
  'pattern.squat', 'pattern.hinge', 'pattern.push', 'pattern.pull',
  'pattern.olympic', 'pattern.core', 'pattern.carry', 'pattern.handstand',
  'pattern.monostructural'
]);

// Returns a validated structuredTarget, or null if malformed/invalid —
// null here is treated exactly like the LLM omitting structuredTarget
// entirely (see _processInsightRecommendations below): the
// recommendation still displays as prose, it just doesn't become a
// trackable card. This is the actual enforcement of the prompt's
// constraints — the prompt asking nicely for a valid pattern key is
// not a guarantee one was returned, same reasoning as every other
// hallucination-risk spot in this file.
function _validateStructuredTarget(st) {
  if (!st || typeof st !== 'object') return null;
  if (st.type === 'movement_pattern_count') {
    if (!VALID_MOVEMENT_PATTERNS.has(st.pattern)) return null;
    const target = parseInt(st.target);
    if (!Number.isInteger(target) || target < 1) return null;
    return { type: 'movement_pattern_count', pattern: st.pattern, target };
  }
  if (st.type === 'weekly_session_consistency') {
    const target = parseInt(st.target);
    const tolerance = parseInt(st.tolerance);
    if (!Number.isInteger(target) || target < 1) return null;
    if (!Number.isInteger(tolerance) || tolerance < 0) return null;
    return { type: 'weekly_session_consistency', target, tolerance };
  }
  return null; // unknown type — not one of the two supported shapes
}

// Applies one insight response's recommendations to the stored action
// cards: "new" items with a valid structuredTarget become (or reset) a
// tracked card via upsertActionCard; "commentary" items attach their
// text to an existing card for display, found by exact id match against
// what's actually stored right now — never trusted blindly, since a
// hallucinated or stale targetCardId is a real possibility despite the
// prompt instruction. Saves once at the end rather than after each
// item, and refreshes weekly results afterward so a freshly-created
// card's (all-null) grid and any newly-reset card are both consistent
// with the rest of the app immediately, not stale until some later
// unrelated refresh happens to run.
function _processInsightRecommendations(recommendations) {
  let cards = getActionCards();
  const hist = getHistory();

  (recommendations || []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    if (r.type === 'new') {
      const validTarget = _validateStructuredTarget(r.structuredTarget);
      if (validTarget) {
        cards = upsertActionCard(cards, validTarget, {
          headline: r.headline,
          diagnosticWhy: r.diagnosticWhy,
          prescribedAction: r.prescribedAction,
          category: r.category
        });
      }
      // No structuredTarget (or an invalid one) — this recommendation
      // stays in the plain recommendations array for display, same as
      // before this feature existed. Not an error case; per the
      // prompt, plenty of valid recommendations don't fit either
      // trackable shape on purpose.
    } else if (r.type === 'commentary') {
      const currentLang = _lang === 'es' ? 'es' : 'en';
      const card = cards.find(c => c.id === r.targetCardId && c.lang === currentLang);
      if (card) card.latestCommentary = r.text || '';
      // targetCardId not found among current cards — silently dropped
      // (also silently dropped if it's found but its lang doesn't match
      // the current generation's language: applying commentary text in
      // one language to a card whose headline/etc. are still in the
      // other would create exactly the mixed-language card this whole
      // lang-tagging scheme exists to prevent — that card just won't
      // get this round's commentary, which is the correct outcome
      // when the card isn't even currently visible under this
      // language's filter to begin with)
      // rather than attached to the wrong card or thrown as an error;
      // the underlying card may have expired or been reset between
      // when the payload was built and when this response arrived.
    }
  });

  cards = refreshActionCardResults(cards, hist);
  saveActionCards(cards);
}

function toggleInsightCard() {
  _insightExpanded = !_insightExpanded;
  localStorage.setItem('wod-insight-expanded', _insightExpanded);
  const body = document.getElementById('insight-body');
  const chevron = document.getElementById('insight-chevron');
  if (body) body.style.display = _insightExpanded ? 'block' : 'none';
  if (chevron) chevron.style.transform = _insightExpanded ? 'rotate(180deg)' : '';
}

function _buildInsightPayload(hist) {
  const now = Date.now();
  const sixWeeksAgo = now - 42 * 86400000;
  const recent = hist.filter(w => new Date(w.date).getTime() >= sixWeeksAgo);
  const hrRestVal = parseFloat(document.getElementById('global-hrrest')?.value) || null;
  const hrMaxVal = parseFloat(document.getElementById('global-hrmax')?.value) || null;

  // Weekly breakdown — 6 weeks oldest first
  const weeklyBreakdown = [];
  for (let i = 5; i >= 0; i--) {
    const wStart = now - (i + 1) * 7 * 86400000;
    const wEnd   = now - i * 7 * 86400000;
    const wSess  = recent.filter(w => {
      const t = new Date(w.date).getTime();
      return t >= wStart && t < wEnd;
    });
    // Overall Efficiency average for the week — only across sessions
    // where it's actually computable (getEngineScoreERaw returns null
    // for plenty of sessions; averaging over 0s would understate a
    // week that had real efficiency data on some sessions and none on
    // others, same reasoning as avgRl already excluding zero-RL rows).
    const wEff = wSess.map(w => { try { return getEngineScoreERaw(w)?.eRaw; } catch(e) { return null; } }).filter(v => v != null && v > 0);
    weeklyBreakdown.push({
      week: 6 - i,
      sessions: wSess.length,
      avgPd:  wSess.length ? +(wSess.reduce((s,w) => s + (parseFloat(w.pd)||0), 0) / wSess.length).toFixed(2) : 0,
      avgFb:  wSess.length ? +(wSess.reduce((s,w) => s + (parseFloat(w.fb)||0), 0) / wSess.length).toFixed(0) : 0,
      avgRl:  (() => { const rlS = wSess.filter(w => parseFloat(w.rl) > 0); return rlS.length ? +(rlS.reduce((s,w) => s + (parseFloat(w.rl)||0), 0) / rlS.length).toFixed(0) : 0; })(),
      avgEfficiency: wEff.length ? +(wEff.reduce((s,v) => s+v, 0) / wEff.length).toFixed(3) : null,
      totalMc:      +(recent.filter(w => { const t=new Date(w.date).getTime(); return t>=wStart&&t<wEnd; }).reduce((s,w)=>s+(parseFloat(w.mc)||0),0)).toFixed(0),
      totalMcMech:  +(recent.filter(w => { const t=new Date(w.date).getTime(); return t>=wStart&&t<wEnd; }).reduce((s,w)=>s+(parseFloat(w.mc_mech)||0),0)).toFixed(0),
      totalMcAero:  +(recent.filter(w => { const t=new Date(w.date).getTime(); return t>=wStart&&t<wEnd; }).reduce((s,w)=>s+(parseFloat(w.mc_aero)||0),0)).toFixed(0),
    });
  }

  // Per-session table — the actual FB/PD/RL spread the weekly averages
  // above were smoothing over. Directly caused this addition: verifying
  // an earlier insight against this same payload found the model
  // inventing a Force Bias upper bound (96) that didn't exist anywhere
  // in the weekly-average data it was given — the real spread was only
  // visible at the session level, which the prompt never included. 19
  // sessions over 6 weeks is small enough that sending all of them is
  // cheap, and removes the model's need to guess at a spread it can't
  // actually see.
  const sessionTable = recent.map(w => {
    let eff = null;
    try { eff = getEngineScoreERaw(w)?.eRaw ?? null; } catch(e) {}
    return {
      date: (w.date || '').slice(0, 10),
      fb: parseFloat(w.fb) || 0,
      pd: parseFloat(w.pd) || 0,
      rl: parseFloat(w.rl) || 0,
      efficiency: eff != null ? +eff.toFixed(3) : null
    };
  });

  // RPE-vs-real-HR accuracy — only sessions with BOTH a real session-wide
  // avgHR AND a logged RPE qualify; per the athlete, that's 3 of 19
  // sessions here. Deliberately kept as a small, explicitly-labeled
  // sample rather than silently averaged into a bigger claim — the goal
  // is surfacing a real, directionally-consistent pattern found earlier
  // (real %HRR running higher than RPE×10 across sessions checked by
  // hand) as a data point worth watching, not asserting it as an
  // established fact from 3 sessions. sampleSize is included explicitly
  // so the prompt can instruct the model to hedge appropriately.
  const rpeAccuracySessions = [];
  if (hrRestVal != null && hrMaxVal != null && hrMaxVal > hrRestVal) {
    recent.forEach(w => {
      const avgHR = parseFloat(w.avgHR);
      const rpe = parseFloat(w.rpe);
      if (!avgHR || !rpe) return;
      const realPctHRR = Math.max(0, Math.min(100, ((avgHR - hrRestVal) / (hrMaxVal - hrRestVal)) * 100));
      const rpeImpliedPct = rpe * 10;
      rpeAccuracySessions.push({
        date: (w.date || '').slice(0, 10),
        realPctHRR: Math.round(realPctHRR),
        rpeImpliedPct: Math.round(rpeImpliedPct),
        deltaPts: Math.round(realPctHRR - rpeImpliedPct)
      });
    });
  }
  const rpeAccuracy = {
    sampleSize: rpeAccuracySessions.length,
    sessions: rpeAccuracySessions,
    avgDeltaPts: rpeAccuracySessions.length
      ? Math.round(rpeAccuracySessions.reduce((s,v) => s+v.deltaPts, 0) / rpeAccuracySessions.length)
      : null
  };

  const avgFb = recent.length ? recent.reduce((s,w)=>s+(parseFloat(w.fb)||0),0)/recent.length : 0;
  const dominantModality = avgFb > 100 ? 'strength' : avgFb > 60 ? 'mixed' : 'conditioning';
  const weeksWithSessions = weeklyBreakdown.filter(w => w.sessions > 0).length;
  const consistency = Math.round((weeksWithSessions / 6) * 100);

  // Recovery state
  const tl = calcTrainingLoad(hist);
  const structural = getStructuralFatigue();
  const banStatus  = tl ? getTrainingStatus(tl, document.getElementById('global-goal')?.value || 'general').status : 'neutral';

  // Recovery trends over 6 weeks — not current state
  const tsbHistory = tl?.tsbHistory || [];
  const recentTsbHistory = tsbHistory.slice(-42); // last 42 days
  const avgForm = recentTsbHistory.length
    ? +(recentTsbHistory.reduce((s,d) => s + (d.tsb||1), 0) / recentTsbHistory.length).toFixed(2)
    : 1;
  const overreachingDays = recentTsbHistory.filter(d => (d.tsb||1) > 1.4).length;
  const detrainingDays   = recentTsbHistory.filter(d => (d.tsb||1) < 0.8).length;
  const ctlTrend = tsbHistory.length >= 14
    ? (tsbHistory[tsbHistory.length-1]?.ctl || 0) > (tsbHistory[Math.max(0,tsbHistory.length-14)]?.ctl || 0) ? 'building' : 'declining'
    : 'insufficient data';

  // Structural — use weekly breakdown to infer pattern
  const structuralLoads = weeklyBreakdown.map(w => w.totalMcMech);
  const avgStructuralLoad = structuralLoads.reduce((s,v)=>s+v,0) / structuralLoads.filter(v=>v>0).length || 0;
  const peakStructuralWeek = Math.max(...structuralLoads);
  const structuralVariability = peakStructuralWeek > 0 ? Math.round((peakStructuralWeek / avgStructuralLoad - 1) * 100) : 0;
  let ctlChange = 0;
  if (tsbHistory.length >= 14) {
    const firstWeekCtl  = tsbHistory[Math.max(0, tsbHistory.length - 42)]?.ctl || 0;
    const lastWeekCtl   = tsbHistory[tsbHistory.length - 1]?.ctl || 0;
    ctlChange = firstWeekCtl > 0 ? Math.round(((lastWeekCtl - firstWeekCtl) / firstWeekCtl) * 100) : 0;
  }

  // Neural pattern distribution over 6 weeks — from movement names in blocks
  const patternCounts = {};
  let sessionsWithPattern = 0;
  let sessionsWithoutPattern = 0;
  let sessionsCardioOnly = 0;
  recent.forEach(w => {
    const blocks = Array.isArray(w.blocks) ? w.blocks : (typeof w.blocks === 'string' ? JSON.parse(w.blocks || '[]') : []);
    const sessionPatterns = new Set();
    blocks.forEach(b => {
      (b.movements || []).forEach(mv => {
        if (mv.name) {
          const p = getMovementPattern(mv.name);
          if (p) sessionPatterns.add(p);
        }
      });
    });
    // monostructural is excluded from the "real pattern" set here — it's
    // cardio's fallback category, not a barbell/gymnastics pattern the
    // AI Coach should track coverage/gaps for. A session that's only
    // Run/Row should still count as cardio-only below, not silently
    // start counting as "has pattern" now that getMovementPattern()
    // returns monostructural for cardio instead of null.
    const nonCardioPatterns = new Set([...sessionPatterns].filter(p => p !== 'pattern.monostructural'));
    if (nonCardioPatterns.size > 0) {
      sessionsWithPattern++;
      nonCardioPatterns.forEach(p => {
        patternCounts[p] = (patternCounts[p] || 0) + 1;
      });
    } else if (sessionPatterns.has('pattern.monostructural') || parseFloat(w.mc_aero) > 0) {
      sessionsCardioOnly++;
    } else {
      sessionsWithoutPattern++;
    }
  });
  const patternDistribution = Object.entries(patternCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([p, count]) => ({ pattern: getPatternLabel(p), sessions: count, pct: Math.round(count / recent.length * 100) }));

  return {
    profile: {
      goal:         document.getElementById('global-goal')?.value    || 'general',
      fitnessLevel: document.getElementById('global-exp')?.value     || 'intermediate',
      vo2max:       parseFloat(document.getElementById('global-vo2max')?.value) || null,
    },
    training: {
      sessionsPerWeek: +(recent.length / 6).toFixed(1),
      totalSessions:   recent.length,
      weeklyBreakdown,
      sessionTable,
      dominantModality,
      consistency
    },
    // Active action cards — included ONLY so the coach can (a) avoid
    // recommending something that's already being tracked, generating
    // a differently-worded duplicate of an existing card, and (b)
    // encourage follow-through on a card that isn't being hit, rather
    // than staying silent on it. Deliberately NOT used for anything
    // more elaborate (changing strategy on a repeatedly-missed card,
    // narrating a card's history) — settled scope, narrower than what
    // was originally proposed for this payload.
    //
    // Filtered to the CURRENT display language before the coach ever
    // sees it — not just at render time. Two reasons: (1) the
    // recommendation-count formula reads N = activeCards.length, and
    // that needs to mean "how many cards can the athlete actually see
    // right now," not a global cross-language total — otherwise a
    // language switch can silently defeat the "always at least 3
    // visible cards" floor (confirmed happening: switching to Spanish
    // with 2 English cards already active produced only 1 new
    // recommendation, leaving zero visible Spanish cards until that one
    // generation, since N=2 counted cards the athlete couldn't see at
    // all in Spanish). (2) There's little value showing the coach a
    // card it can't write visible commentary for anyway — the
    // commentary-application step already refuses to attach text to a
    // card whose lang doesn't match the current generation, so a
    // same-language activeCards list keeps what the coach is told in
    // sync with what it can actually act on, not just what merely
    // exists somewhere in storage.
    activeCards: refreshActionCardResults(getActionCards(), hist)
      .filter(c => !c.lang || c.lang === (_lang === 'es' ? 'es' : 'en'))
      .map(c => ({
        id: c.id,
        text: c.headline || '',
        weeksElapsed: c.weeklyResults.filter(w => w !== null).length,
        weeksMet: c.weeklyResults.filter(w => w === true).length
      })),
    recovery: {
      aerobic: {
        ctlTrend,
        avgForm,
        overreachingDays,
        detrainingDays,
        ctlChange6w: ctlChange
      },
      structural: {
        avgWeeklyLoad: Math.round(avgStructuralLoad),
        peakWeekLoad:  Math.round(peakStructuralWeek),
        variabilityPct: structuralVariability
      },
      neural: { patternDistribution, sessionsWithPattern, sessionsWithoutPattern, sessionsCardioOnly },
      rpeAccuracy
    },
    trends: { ctlChange6w: ctlChange }
  };
}

async function generateCoachingInsight(force = false) {
  const hist = getHistory();
  if (hist.length < INSIGHT_MIN_SESSIONS) {
    _renderInsightUnlock(hist.length);
    return;
  }

  // Cache is keyed by BOTH language and goal, back to the original
  // scheme — reverted from a single bilingual-per-generation approach
  // (see git history / prior turn) after reconsidering the actual
  // requirement: the athlete doesn't need English and Spanish to be
  // the same insight, just never mixed together on screen at once.
  // Generating both languages every cycle roughly doubled response
  // size and started truncating mid-string against the backend's
  // max_tokens limit — a real cost for a guarantee (identical content
  // across languages) nobody asked for. The actual mixing bug is fixed
  // below instead, by tagging each action card with the language it
  // was generated in and filtering the DISPLAY to one language at a
  // time — cheaper, and targets the real problem directly rather than
  // solving a bigger one that happened to make it moot.
  const currentLang = _lang === 'es' ? 'es' : 'en';
  const currentGoal = document.getElementById('global-goal')?.value || 'general';
  const cacheKey = 'wod-insight-cache-' + currentLang + '-' + currentGoal;
  const cached = (_insightCache?.lang === currentLang && _insightCache?.goal === currentGoal ? _insightCache : null) || JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (!force && cached && cached.lang === currentLang && cached.goal === currentGoal && !_insightRefreshDue(cached, hist)) {
    _insightCache = cached;
    _renderInsightResult(cached);
    return;
  }

  _renderInsightLoading();

  try {
    const payload = _buildInsightPayload(hist);
    const goalMap = { allround: 'All-Round CrossFit Athlete', conditioning: 'Conditioning', strength: 'Strength & Power', weightloss: 'Fat Loss', endurance: 'Endurance', competition: 'Competition', rehab: 'Rehab / Low Impact', general: 'General Fitness' };
    const goalLabel = goalMap[payload.profile.goal] || payload.profile.goal;
    const goalGuidance = payload.profile.goal === 'allround'
      ? 'For an All-Round CrossFit Athlete goal, evaluate balance between strength and conditioning — appropriate mix of high and low Force Bias sessions, aerobic CTL growth, and movement pattern coverage across all eight patterns. Neither pure strength nor pure conditioning should dominate.'
      : payload.profile.goal === 'strength' ? 'For a Strength goal, focus on barbell progressive overload, movement pattern balance, and session consistency. Do not recommend CTL targets.'
      : payload.profile.goal === 'conditioning' ? 'For a Conditioning goal, focus on aerobic CTL growth, session frequency and cardio volume. Flag lack of monostructural work.'
      : payload.profile.goal === 'competition' ? 'For a Competition goal, evaluate peak timing, Form ratio, and whether training is building toward a performance peak.'
      : payload.profile.goal === 'weightloss' ? 'For a Fat Loss goal, focus on metabolic cost per session, training frequency and work density.'
      : payload.profile.goal === 'endurance' ? 'For an Endurance goal, focus on aerobic CTL growth, cardio volume and session consistency.'
      : '';

    const currentLangName = currentLang === 'es' ? 'Spanish' : 'English';
    const systemPrompt = `You are an experienced CrossFit coach with deep knowledge of CrossFit methodology, programming, and periodization. You understand GPP (General Physical Preparedness), the CrossFit theoretical hierarchy, energy systems, and how to structure training across the ten physical skills (cardiovascular endurance, stamina, strength, flexibility, power, speed, coordination, agility, balance, accuracy). Speak directly to the athlete in second person. Be specific and honest. Respond entirely in ${currentLangName}.

Recommendations must be grounded in CrossFit programming principles — reference CrossFit movements, modalities (gymnastics, monostructural, weightlifting), rep schemes, and periodization concepts where relevant. Avoid generic fitness advice that could apply to any sport.

${goalGuidance}

IMPORTANT: Always return valid JSON regardless of data completeness. Never ask for more data. Work with what you have.

METRIC DEFINITIONS — interpret these correctly:
- W/kg (pd): mechanical power output relative to bodyweight. Comparable only within similar session types — a 0.6 W/kg deadlift session and 0.6 W/kg metcon are very different. Higher is not always better.
- Force Bias (fb): tonnage ÷ mechanical work. High (>120) = strength-dominant session, low (<60) = conditioning-dominant. Neither is inherently better — it describes session character, not quality.
- Relative Loading (rl): the heaviest barbell effort in the session relative to 1RM — a peak, not an average across the session. Measures barbell intensity, NOT cardiovascular effort. High RL = heavy relative to max strength.
- Efficiency (eRaw): mechanical work (or distance/reps for a pure-cardio session) divided by the session's total cardiovascular strain (MET-minutes) — how much output per unit of physiological cost. Trending up over the 6 weeks means the athlete is producing more for the same strain; trending down or flat is worth naming as a specific coaching point, not just described in passing. Only present for sessions where a MET-minutes estimate exists — a week with no efficiency value is missing data, not a zero.
- Dominant modality: 'strength' = barbell-heavy sessions dominate, 'mixed' = combination of barbell and conditioning, 'conditioning' = cardio/metcon dominant. Mixed is not unfocused — it reflects CrossFit's broad stimulus.
- CTL: aerobic cardiovascular chronic load (42-day average). Measures cardiovascular training base only. NOT overall training quality or strength. Do not recommend CTL targets for strength or power goals.
- ATL: aerobic cardiovascular acute load (7-day average). Spikes after hard conditioning sessions.
- Form (ATL÷CTL): ratio of recent to chronic aerobic load. >1.0 means recent aerobic load exceeds chronic baseline (fatigued aerobically). <1.0 means below baseline (fresh or detraining). 1.0 is neutral. Higher Form is NOT better for strength athletes.
- Recovery data is 6-week trend data, NOT current state. The recovery section of your analysis should describe how the athlete has managed fatigue and recovery across the full period — were they consistently overreaching, detraining, or well-balanced? Structural variability shows how erratic their mechanical loading was week to week.
- Pattern distribution: how many sessions in 6 weeks included each movement pattern. Imbalances (e.g. squat every week, no pull work) are coaching opportunities.
- Per-session table (sessionTable): the actual session-by-session FB/PD/RL/efficiency values behind the weekly averages above. Use this for any claim about a range, spread, or specific session — e.g. "sessions ranged from X to Y" must be read directly off this table, never estimated or extrapolated from the weekly averages. If you state a minimum, maximum, or specific value, it must appear literally in this table.
- RPE accuracy (rpeAccuracy): compares the athlete's self-rated RPE against real heart-rate-derived intensity, ONLY for sessions where both exist. sampleSize tells you how many sessions that is — if it's small (roughly under 5), treat any pattern here as a single observation worth watching, not an established finding, and say so explicitly rather than stating it as fact. If sampleSize is 0, do not mention RPE accuracy at all.
- Active action cards (activeCards): recommendations from previous cycles the athlete is currently being tracked against, each with weeksElapsed (how many weeks of its 6-week window have been scored so far) and weeksMet (how many of those were on-target). This exists for exactly two purposes and nothing more: (1) do not generate a new recommendation that duplicates the intent of an existing active card, even worded differently — check the list before writing each new recommendation; (2) for a card that's underperforming (weeksMet meaningfully below weeksElapsed), write commentary that encourages following the existing action — do not reframe it, escalate it, or propose a different approach, just encourage adherence to what's already being tracked. Do not narrate a card's full history or speculate about why it isn't being hit.

RECOMMENDATION OUTPUT — how many, and what shape:
Let N = the number of items currently in activeCards.
- Output max(1, 3 - N) NEW recommendations (type "new"). This is always at least 1, even when N is already 3 or more.
- Fill any remaining slots, up to 3 total items, with commentary on existing active cards (type "commentary") — one item per card, prioritizing cards that are underperforming. If there are fewer active cards than remaining slots, output fewer than 3 items total rather than inventing extra commentary or extra new recommendations to pad the count.
- Every "new" item needs exactly these four fields:
  - "headline": a short, bold, actionable directive — 8 words maximum, imperative voice (e.g. "Add One Dedicated Pulling Session Weekly").
  - "diagnosticWhy": exactly 2 sentences of data justification — grounded in the actual numbers provided (weeklyBreakdown, sessionTable, patternDistribution, etc.), never invented, same rule as everywhere else in this prompt.
  - "prescribedAction": one short, concrete target string for display in a highlighted prescription pill (e.g. "Pull-ups, Rows, or C2B x2 sessions").
  - "category": exactly one of "PATTERN_IMBALANCE", "GOAL_ALIGNMENT", "LOAD_PERIODIZATION", "RECOVERY" — never invent a different category string.
  If — and only if — the recommendation is a specific, countable, weekly action, ALSO include "structuredTarget" using ONE of these two shapes:
  - {"type":"movement_pattern_count","pattern":"<one of: pattern.squat, pattern.hinge, pattern.push, pattern.pull, pattern.olympic, pattern.core, pattern.carry, pattern.handstand, pattern.monostructural>","target":<integer, sessions per week>}
  - {"type":"weekly_session_consistency","target":<integer, sessions per week>,"tolerance":<integer, allowed deviation either direction>}
  Omit "structuredTarget" entirely for a recommendation that doesn't cleanly fit one of these two shapes (e.g. a duration- or pace-qualified suggestion) — do not force it into a shape that misrepresents it. The "pattern" value must be exactly one of the strings listed above — never invent a new one.
- Every "commentary" item needs "text" (a short encouragement sentence, not a full paragraph) and "targetCardId" set to the exact "id" of the activeCards entry it's about — never a card id that doesn't appear in activeCards.

Even when training is going well, always find ways to improve, optimize or progress further within whatever recommendation budget the rule above allows. A good coach never just praises — they identify the next challenge, the weak link, or the next level to pursue. New recommendations should be forward-looking and concrete, not generic.

CRITICAL — do not state a specific number (a range, a minimum, a maximum, a single session's value) unless it appears literally in the data provided. If you want to describe a spread or pattern across multiple data points, either read the actual values from sessionTable or describe it qualitatively (e.g. "varied considerably") rather than inventing a specific number.

Return this exact JSON structure, no markdown, no backticks, no other text:
{"summary":"2-3 sentences describing training pattern","goalAlignment":"1-2 sentences on goal alignment — honest assessment, not just praise","recovery":"1-2 sentences on recovery state","recommendations":[{"type":"new","headline":"Short 8-word-max actionable directive","diagnosticWhy":"Exactly two sentences of data justification.","prescribedAction":"Concrete target for the prescription pill","category":"PATTERN_IMBALANCE","structuredTarget":{"type":"movement_pattern_count","pattern":"pattern.pull","target":1}},{"type":"commentary","text":"short encouragement referencing an existing active card","targetCardId":"the exact id from activeCards"}]}`;

    const userPrompt = `Athlete goal: ${goalLabel}
Fitness level: ${payload.profile.fitnessLevel}
VO2max: ${payload.profile.vo2max || 'not set'}

Training (last 6 weeks):
- Sessions per week: ${payload.training.sessionsPerWeek}
- Total sessions: ${payload.training.totalSessions}
- Dominant modality: ${payload.training.dominantModality}
- Consistency: ${payload.training.consistency}% of weeks had sessions
- Weekly breakdown (week 1=oldest):
${payload.training.weeklyBreakdown.map(w => `  Week ${w.week}: ${w.sessions} sessions, avg ${w.avgPd} W/kg, avg FB ${w.avgFb}, avg RL ${w.avgRl}%, avg Efficiency ${w.avgEfficiency ?? 'n/a'}`).join('\n')}
- Per-session table (date, FB, W/kg, RL%, Efficiency) — the ONLY source for any claim about a specific session, range, minimum, or maximum:
${payload.training.sessionTable.map(s => `  ${s.date}: FB ${s.fb}, ${s.pd} W/kg, RL ${s.rl}%, Efficiency ${s.efficiency ?? 'n/a'}`).join('\n')}

Recovery patterns (6-week view — not current state):
- Aerobic trend: ${payload.recovery.aerobic.ctlTrend}, CTL change: ${payload.recovery.aerobic.ctlChange6w > 0 ? '+' : ''}${payload.recovery.aerobic.ctlChange6w}%, avg Form over period: ${payload.recovery.aerobic.avgForm}, days overreaching (Form>1.4): ${payload.recovery.aerobic.overreachingDays}, days detraining (Form<0.8): ${payload.recovery.aerobic.detrainingDays}
- Structural load pattern: avg weekly mc_mech load ${payload.recovery.structural.avgWeeklyLoad}, peak week ${payload.recovery.structural.peakWeekLoad}, variability ${payload.recovery.structural.variabilityPct}% above average
- Movement pattern balance: ${payload.recovery.neural.patternDistribution.length ? payload.recovery.neural.patternDistribution.map(p => `${p.pattern}: ${p.sessions} sessions (${p.pct}%)`).join(', ') : 'no barbell pattern data'} — cardio-only sessions: ${payload.recovery.neural.sessionsCardioOnly}, unclassified: ${payload.recovery.neural.sessionsWithoutPattern}
${payload.recovery.rpeAccuracy.sampleSize > 0 ? `- RPE accuracy — SMALL SAMPLE (${payload.recovery.rpeAccuracy.sampleSize} of ${payload.training.totalSessions} sessions had both real HR and a logged RPE): ${payload.recovery.rpeAccuracy.sessions.map(s => `${s.date}: real ${s.realPctHRR}% HRR vs RPE-implied ${s.rpeImpliedPct}%, delta ${s.deltaPts > 0 ? '+' : ''}${s.deltaPts} pts`).join('; ')}. Average delta: ${payload.recovery.rpeAccuracy.avgDeltaPts > 0 ? '+' : ''}${payload.recovery.rpeAccuracy.avgDeltaPts} pts. This sample is too small to state as a firm conclusion — mention it only as a single observation worth watching if you reference it at all.` : ''}

Trends:
- CTL change over 6 weeks: ${payload.trends.ctlChange6w > 0 ? '+' : ''}${payload.trends.ctlChange6w}% (0% means stable, positive means building, negative means declining — do not comment on absolute CTL values)

Active action cards (${payload.activeCards.length}) — check before writing each new recommendation, and use for commentary items:
${payload.activeCards.length ? payload.activeCards.map(c => `  id "${c.id}": "${c.text}" — on target ${c.weeksMet} of ${c.weeksElapsed} scored weeks so far`).join('\n') : '  (none yet)'}`;

    // Get Supabase JWT for authentication
    const sb = getSB();
    let jwt = null;
    if (sb) {
      const { data: { session } } = await sb.auth.getSession();
      jwt = session?.access_token || null;
    }
    if (!jwt) { _renderInsightError(); return; }

    const response = await fetch('https://api.wodarchitect.app/insight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + jwt
      },
      body: JSON.stringify({
        systemPrompt: systemPrompt,
        userPrompt:   userPrompt
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    _processInsightRecommendations(result.recommendations || []);

    const cache = {
      summary:       result.summary,
      goalAlignment: result.goalAlignment,
      recovery:      result.recovery,
      recommendations: result.recommendations,
      generatedAt:   new Date().toISOString(),
      sessionCount:  hist.length,
      lang:          currentLang,
      goal:          currentGoal
    };

    _insightCache = cache;
    localStorage.setItem(cacheKey, JSON.stringify(cache));

    // Save to Supabase profiles (reuse sb from JWT retrieval above).
    // Back to a per-language column (coaching_insight_en/_es) — but
    // this time actually fixing the mismatch this had before, rather
    // than reintroducing it: the pull side (sbStartupSync,
    // supabase-sync.js) previously read an unsuffixed
    // prof.coaching_insight while this push wrote the suffixed
    // version, so the two never agreed on a column name. Both sides
    // now consistently use coaching_insight_en/coaching_insight_es.
    if (sb) {
      const { data: { session: sess2 } } = await sb.auth.getSession();
      if (sess2?.user) {
        const insightField = 'coaching_insight_' + currentLang;
        sb.from('profiles').upsert({ id: sess2.user.id, [insightField]: cache, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      }
    }

    _renderInsightResult(cache);

  } catch(e) {
    console.error('Coaching insight error:', e);
    _renderInsightError();
  }
}

function _renderInsightUnlock(count) {
  const card = document.getElementById('coaching-insight-card');
  const progressEl = document.getElementById('insight-unlock-progress');
  const barEl = document.getElementById('insight-unlock-bar');
  const countEl = document.getElementById('insight-unlock-count');
  const msgEl = document.getElementById('insight-unlock-msg');

  // Show prominent progress bar, hide insight card
  if (card) card.style.display = 'none';
  if (progressEl) progressEl.style.display = 'block';
  if (barEl) barEl.style.width = Math.round(count / INSIGHT_MIN_SESSIONS * 100) + '%';
  if (countEl) countEl.textContent = count + ' / ' + INSIGHT_MIN_SESSIONS;
  if (msgEl) {
    const remaining = INSIGHT_MIN_SESSIONS - count;
    msgEl.textContent = t('insight.unlock').replace('{n}', remaining);
  }
}

function _renderInsightLoading() {
  const card = document.getElementById('coaching-insight-card');
  const progressEl = document.getElementById('insight-unlock-progress');
  if (progressEl) progressEl.style.display = 'none';
  const preview = document.getElementById('insight-preview');
  const content = document.getElementById('insight-content');
  if (!card) return;
  card.style.display = 'block';
  if (preview) preview.textContent = t('insight.loading');
  if (content) content.innerHTML = `<div style="font-size:.75rem;color:var(--label);text-align:center;padding:12px 0;">
    <div style="display:inline-block;width:16px;height:16px;border:2px solid var(--brand);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:8px;vertical-align:middle;"></div>
    ${t('insight.loading')}
  </div>`;
}

function _renderInsightError() {
  const card = document.getElementById('coaching-insight-card');
  const preview = document.getElementById('insight-preview');
  const content = document.getElementById('insight-content');
  if (!card) return;
  card.style.display = 'block';
  if (preview) preview.textContent = t('insight.error');
  if (content) content.innerHTML = `<div style="font-size:.75rem;color:#EF4444;text-align:center;padding:8px 0;">
    ${t('insight.error')}
    <button onclick="generateCoachingInsight(true)" style="display:block;margin:8px auto 0;background:var(--brand);color:white;border:none;border-radius:8px;padding:6px 16px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;">${t('insight.retry')}</button>
  </div>`;
}

function _renderInsightResult(cache, hist) {
  const card = document.getElementById('coaching-insight-card');
  const progressEl = document.getElementById('insight-unlock-progress');
  if (progressEl) progressEl.style.display = 'none'; // hide unlock progress
  const preview = document.getElementById('insight-preview');
  const body = document.getElementById('insight-body');
  const chevron = document.getElementById('insight-chevron');
  const content = document.getElementById('insight-content');
  if (!card || !cache) return;
  card.style.display = 'block';

  const firstSentence = cache.summary?.split(/[.!?]/)[0] || '';
  if (preview) preview.textContent = firstSentence + (firstSentence ? '.' : '');

  const updDate = cache.generatedAt ? new Date(cache.generatedAt).toLocaleDateString() : '';
  const histArr = hist || getHistory();
  const refreshDue = _insightRefreshDue(cache, histArr);
  const refreshBtn = refreshDue
    ? `<button onclick="localStorage.removeItem('wod-insight-cache-'+(_lang==='es'?'es':'en')+'-'+(document.getElementById('global-goal')?.value||'general'));_insightCache=null;generateCoachingInsight(true);" style="background:var(--brand);color:white;border:none;border-radius:8px;padding:6px 14px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:10px;">${t('insight.refresh')}</button>`
    : '';

  if (content) content.innerHTML = `
    <div style="font-size:.65rem;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
      <span>${t('insight.updated')}: ${updDate}</span>
    </div>
    <div style="margin-bottom:10px;">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);margin-bottom:3px;">${t('insight.summary')}</div>
      <div style="font-size:.76rem;color:var(--text);line-height:1.6;">${cache.summary}</div>
    </div>
    <div style="margin-bottom:10px;">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);margin-bottom:3px;">${t('insight.goal')}</div>
      <div style="font-size:.76rem;color:var(--text);line-height:1.6;">${cache.goalAlignment}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);margin-bottom:3px;">${t('insight.recovery')}</div>
      <div style="font-size:.76rem;color:var(--text);line-height:1.6;">${cache.recovery}</div>
    </div>
    ${(() => {
      // Only "new" recommendations that DIDN'T become a tracked card —
      // one that did is now shown once, as a card, below. Re-validates
      // each item's structuredTarget the same way _processInsightRecommendations
      // did when the response first came in, rather than trusting a
      // separate "did this become a card" flag that could drift out of
      // sync with what actually happened — this is the same check, run
      // again, so the two can't disagree.
      const untracked = (cache.recommendations||[]).filter(r => r && r.type === 'new' && !_validateStructuredTarget(r.structuredTarget));
      if (!untracked.length) return '';
      return `<div style="border-top:0.5px solid var(--glass-border);padding-top:10px;">
        <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);margin-bottom:6px;">${t('insight.recs')}</div>
        ${untracked.map(r => `
          <div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start;">
            <span style="color:var(--brand);font-weight:900;flex-shrink:0;">→</span>
            <div>
              <div style="font-size:.76rem;color:var(--text);font-weight:700;line-height:1.4;">${r.headline || ''}</div>
              ${r.diagnosticWhy ? `<div style="font-size:.72rem;color:var(--label);line-height:1.4;margin-top:2px;">${r.diagnosticWhy}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
    })()}
    ${_renderActionCardsSection()}
    ${refreshBtn ? `<div style="text-align:center;border-top:0.5px solid var(--glass-border);padding-top:10px;margin-top:4px;">${refreshBtn}</div>` : ''}`;

  if (body) body.style.display = _insightExpanded ? 'block' : 'none';
  if (chevron) chevron.style.transform = _insightExpanded ? 'rotate(180deg)' : '';
}

// Category display: icon + human label, keyed by the same enum
// enforced in _sanitizeCardContent. Falls back to PATTERN_IMBALANCE's
// entry if somehow given a value outside the known set, rather than
// rendering an empty badge — belt-and-suspenders alongside the
// sanitization that should already have caught this earlier.
const CARD_CATEGORY_DISPLAY = {
  PATTERN_IMBALANCE:  { icon: '🏋️', label: 'Imbalance' },
  GOAL_ALIGNMENT:      { icon: '🎯', label: 'Goal' },
  LOAD_PERIODIZATION:  { icon: '📊', label: 'Load' },
  RECOVERY:            { icon: '🔋', label: 'Recovery' }
};

// Six cells, one per week of a card's window, now with FOUR distinct
// states rather than three — COMPLETED and MISSED are unchanged
// (weeklyResults[i] is locked in true/false by refreshActionCardResults
// once a week has fully elapsed), but a week still sitting at null now
// renders differently depending on WHY it's null: the current,
// still-in-progress week (glowing border, distinct from a plain future
// week) vs. a week that hasn't started yet (dimmed outline only). Both
// of those were previously the same flat grey — this needed knowing
// which week index "now" actually falls in, which _getCardWeekRange
// already computes elsewhere in this file; nothing new had to be
// stored to support this, only rendered differently.
function _renderActionCardWeekGrid(card) {
  const now = new Date();
  // box-sizing:border-box on every cell, added to the two states that
  // have a border — confirmed root cause of the oversized "in progress"
  // cell in testing: this app has no global box-sizing reset (it's set
  // per-element wherever needed, not inherited), so a bordered cell's
  // content-box default adds the border ON TOP of the specified 22px,
  // and the box-shadow glow further exaggerated how much larger it
  // looked next to the plain, borderless completed/missed cells.
  return `<div style="display:flex;gap:4px;">
    ${card.weeklyResults.map((w, i) => {
      if (w === true) {
        return `<div title="${t('insight.actioncards.week') || 'Week'} ${i + 1}: ${t('insight.actioncards.completed') || 'Completed'}" style="box-sizing:border-box;width:22px;height:22px;border-radius:5px;background:#22C55E;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:900;color:white;flex-shrink:0;">✓</div>`;
      }
      if (w === false) {
        return `<div title="${t('insight.actioncards.week') || 'Week'} ${i + 1}: ${t('insight.actioncards.missed') || 'Missed'}" style="box-sizing:border-box;width:22px;height:22px;border-radius:5px;background:#EF4444;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:900;color:white;flex-shrink:0;">✕</div>`;
      }
      const { start, end } = _getCardWeekRange(card, i);
      const isCurrent = now >= start && now < end;
      if (isCurrent) {
        return `<div title="${t('insight.actioncards.week') || 'Week'} ${i + 1}: ${t('insight.actioncards.inprogress') || 'In progress'}" style="box-sizing:border-box;width:22px;height:22px;border-radius:5px;background:var(--glass-border);border:2px solid var(--brand);box-shadow:0 0 4px var(--brand);flex-shrink:0;"></div>`;
      }
      return `<div title="${t('insight.actioncards.week') || 'Week'} ${i + 1}: ${t('insight.actioncards.upcoming') || 'Upcoming'}" style="box-sizing:border-box;width:22px;height:22px;border-radius:5px;background:transparent;border:1.5px dashed var(--glass-border);opacity:.6;flex-shrink:0;"></div>`;
    }).join('')}
  </div>`;
}

function _renderActionCardsSection() {
  // Refreshed here, not only right after a new insight generates —
  // time passes and new sessions get logged between insight cycles,
  // so a card's grid needs to reflect "as of right now" every time
  // this section is actually shown, not just whatever it looked like
  // when the cache was last written. This runs on the FULL set,
  // regardless of language — a card currently hidden by the language
  // filter below still needs its weekly results kept current in the
  // background, or it would silently stop being tracked the moment the
  // athlete stopped viewing it in its own language.
  let cards = getActionCards();
  if (!cards.length) return '';
  cards = refreshActionCardResults(cards, getHistory());
  saveActionCards(cards);

  // THE actual fix for the original mixing bug: only ever display
  // cards whose lang matches the current display language — a card
  // generated in the other language is simply hidden, never shown
  // alongside these, rather than mixed in. A card with no lang at all
  // (from before this field existed) is shown regardless — treating an
  // unknown language as "never show" seems worse than the small chance
  // of it displaying under the wrong language once, and older cards
  // like this should get cleared out during this same update anyway.
  const currentLang = _lang === 'es' ? 'es' : 'en';
  const displayCards = cards.filter(c => !c.lang || c.lang === currentLang);
  if (!displayCards.length) return '';

  return `<div style="border-top:0.5px solid var(--glass-border);padding-top:10px;margin-top:2px;">
    <div style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--brand);margin-bottom:8px;">${t('insight.actioncards.title') || 'Action Cards'}</div>
    ${displayCards.map(c => {
      const weeksElapsed = c.weeklyResults.filter(w => w !== null).length;
      const catDisplay = CARD_CATEGORY_DISPLAY[c.category] || CARD_CATEGORY_DISPLAY.PATTERN_IMBALANCE;
      return `
      <div style="margin-bottom:12px;padding:10px;border:0.5px solid var(--glass-border);border-radius:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:.65rem;font-weight:700;color:var(--label);">${catDisplay.icon} ${catDisplay.label}</span>
          <span style="font-size:.6rem;font-weight:700;color:var(--brand);background:var(--glass-inner);padding:2px 8px;border-radius:10px;">${t('insight.actioncards.weekof') || 'Week'} ${Math.min(weeksElapsed + 1, 6)} ${t('insight.actioncards.of') || 'of'} 6</span>
        </div>
        <div style="font-size:.82rem;font-weight:800;color:var(--text);line-height:1.4;margin-bottom:4px;">${c.headline || ''}</div>
        ${c.diagnosticWhy ? `<div style="font-size:.72rem;color:var(--label);line-height:1.5;margin-bottom:8px;">${c.diagnosticWhy}</div>` : ''}
        ${c.prescribedAction ? `<div style="font-size:.72rem;color:var(--brand);background:var(--glass-inner);border-radius:8px;padding:6px 10px;margin-bottom:10px;">💡 ${t('insight.actioncards.target') || 'Target'}: ${c.prescribedAction}</div>` : ''}
        ${_renderActionCardWeekGrid(c)}
        ${c.latestCommentary ? `<div style="font-size:.7rem;color:var(--label);font-style:italic;margin-top:8px;line-height:1.4;">${c.latestCommentary}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}
