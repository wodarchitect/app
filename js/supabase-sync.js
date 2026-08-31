/* ════════════════════════════════════════════════════
   SUPABASE CLOUD BACKUP
   Tables required (run once in Supabase SQL editor):

   create table if not exists profiles (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users(id) on delete cascade,
     height int, weight int, age int,
     gender text, exp text, goal text,
     prs jsonb,
     updated_at timestamptz default now()
   );
   -- Run once to add prs column if table already exists:
   -- alter table profiles add column if not exists prs jsonb;
   -- alter table profiles add column if not exists display_name text;
   -- alter table profiles add column if not exists vo2max int;
   -- alter table profiles add column if not exists hr_max int;
   -- alter table profiles add column if not exists hr_rest int;
   -- alter table workouts add column if not exists blocks jsonb;
   -- alter table workouts add column if not exists rest_duration text;
   -- Movement Bias -> Movement Pattern replacement — run once:
   -- alter table workouts add column if not exists pattern_profile jsonb;
   -- alter table workouts add column if not exists pattern_profile_version int;

   -- Templates table (run once):
   -- create table if not exists templates (
   --   id text primary key,
   --   user_id uuid references auth.users(id) on delete cascade,
   --   name text, created_at timestamptz default now(),
   --   rest_duration text, blocks jsonb not null
   -- );
   -- alter table templates enable row level security;
   -- create policy "own templates" on templates for all using (auth.uid() = user_id);
   create table if not exists workouts (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users(id) on delete cascade,
     date text, label text, pd text, wd text, mc text, fb text,
     detail text, energy_profile jsonb,
     created_at timestamptz default now()
   );
   alter table profiles enable row level security;
   alter table workouts enable row level security;
   create policy "own profile" on profiles for all using (auth.uid() = user_id);
   create policy "own workouts" on workouts for all using (auth.uid() = user_id);
════════════════════════════════════════════════════ */

const SB_URL  = 'https://viugoqrrodrhkkdnlbqf.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpdWdvcXJyb2RyaGtrZG5sYnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0ODk1MjUsImV4cCI6MjA5MjA2NTUyNX0.CINtdFoi_LHYvJM7Q0o01DKLsJRomm2PZdGdHfGoxPo';
let _sb = null;

function getSB() {
  if (!_sb && window.supabase) {
    _sb = window.supabase.createClient(SB_URL, SB_KEY);
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        sbShowResetModal();
      } else {
        sbUpdateUI(session);
        // Defer startup sync — use window ref to avoid parse order issues
        if (session?.user) setTimeout(() => window.sbStartupSync && window.sbStartupSync(session.user.id), 500);
      }
    });
  }
  return _sb;
}

function sbFeedback(msg, ok = true) {
  // Update both profile and analytics feedback divs
  ['sb-feedback', 'sb-feedback-analytics', 'sb-feedback-history', 'sb-feedback-profile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? 'var(--success)' : 'var(--danger)';
    if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
  });
}

function sbUpdateUI(session) {
  const status    = document.getElementById('sb-auth-status');
  const magicSec  = document.getElementById('sb-magic-section');
  const dataSec   = document.getElementById('sb-data-section');
  if (!status) return;
  if (session?.user) {
    status.textContent = `✅ Signed in as ${session.user.email || 'unknown'}`;
    status.style.color = 'var(--success)';
    if (magicSec) magicSec.style.display = 'none';
    if (dataSec)  dataSec.style.display  = '';
  } else {
    status.textContent = t('not.signed.in');
    status.style.color = 'var(--label)';
    if (magicSec) magicSec.style.display = '';
    if (dataSec)  dataSec.style.display  = 'none';
  }
}

function sbShowResetModal() {
  const modal = document.getElementById('sb-reset-modal');
  if (modal) {
    modal.style.display = 'flex';
    // Switch to Profile tab so the modal is visible in context
    switchTab(0);
  }
}

function sbHideResetModal() {
  const modal = document.getElementById('sb-reset-modal');
  if (modal) modal.style.display = 'none';
}

async function sbUpdatePassword() {
  const sb = getSB();
  if (!sb) return;
  const password = document.getElementById('sb-new-password')?.value;
  const feedback = document.getElementById('sb-reset-feedback');
  if (!password || password.length < 6) {
    if (feedback) { feedback.textContent = 'At least 6 characters required'; feedback.style.color = 'var(--danger)'; }
    return;
  }
  if (feedback) { feedback.textContent = t('toast.saving'); feedback.style.color = 'var(--label)'; }
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    if (feedback) { feedback.textContent = error.message; feedback.style.color = 'var(--danger)'; }
  } else {
    if (feedback) { feedback.textContent = '✅ Password set!'; feedback.style.color = 'var(--success)'; }
    setTimeout(() => {
      sbHideResetModal();
      sbFeedback('✅ Password set — you can now sign in with email + password', true);
    }, 1500);
  }
}

async function shareWorkout() {
  const blocks=serializeBlocksForTemplate();
  if (!blocks.length) { showToast(t('toast.add.block'), 'error'); return; }
  const sb=getSB(); if(!sb) { showToast('Supabase not loaded','error'); return; }
  const id=Math.random().toString(36).slice(2,9)+Math.random().toString(36).slice(2,6);
  let label='Custom WOD';
  const fb=document.querySelector('.wod-block');
  if (fb) { const cw=fb.querySelector('.cwod-select')?.value; if(cw) label=cw; else { const ml={fortime:'For Time',amrap:'AMRAP',emom:'EMOM',tabata:'Tabata'}; label=ml[fb.querySelector('.b-mode')?.value]||'Custom WOD'; } }
  const restDuration=document.getElementById('rest-duration-sec')?.value||'0';
  let createdBy=null;
  try { const {data:{session}}=await sb.auth.getSession(); createdBy=session?.user?.id||null; } catch(e) {}
  showToast('Generating link…','info');
  const {error}=await sb.from('shared_workouts').insert({id, label, rest_duration:restDuration, blocks, created_by:createdBy});
  const baseUrl=window.location.href.split('?')[0].split('#')[0];
  const shareUrl=baseUrl+'?wod='+id;
  if (error) {
    const payload=JSON.stringify({label,restDuration,blocks});
    const encoded=btoa(encodeURIComponent(payload));
    const url=baseUrl+'?wod_local='+encoded;
    if (navigator.clipboard) { await navigator.clipboard.writeText(url); showToast('✅ Link copied (sign in for shorter links)','info'); }
    else { prompt('Copy this link:',url); }
    return;
  }
  if (navigator.clipboard) { try { await navigator.clipboard.writeText(shareUrl); showToast(t('toast.link.copied')); } catch(e) { prompt('Copy this share link:',shareUrl); } }
  else { prompt('Copy this share link:',shareUrl); }
}

async function checkSharedWodParam() {
  const params=new URLSearchParams(window.location.search);
  const wodId=params.get('wod'), wodLocal=params.get('wod_local');
  if (wodLocal) {
    try { const decoded=JSON.parse(decodeURIComponent(atob(wodLocal))); if(decoded.blocks?.length) { importSharedWod(decoded); window.history.replaceState({},'',window.location.pathname); } } catch(e) {}
    return;
  }
  if (!wodId) return;
  const sb=getSB(); if(!sb) { setTimeout(()=>checkSharedWodParam(),1000); return; }
  showToast(t('toast.link.loading'), 'info');
  const {data,error}=await sb.from('shared_workouts').select('*').eq('id',wodId).single();
  if (error||!data) { showToast(t('toast.link.notfound'), 'error'); window.history.replaceState({},'',window.location.pathname); return; }
  importSharedWod(data);
  window.history.replaceState({},'',window.location.pathname);
}

function importSharedWod(data) {
  const blocks=data.blocks; if(!blocks?.length) { showToast('Shared workout is empty','error'); return; }
  switchTab(1);
  const existing=document.querySelectorAll('.wod-block').length;
  if (existing>0&&!confirm('Load shared workout "'+( data.label||'WOD')+'"? Current blocks will be replaced.')) return;
  const re=document.getElementById('rest-duration-sec'), rd=document.getElementById('rest-duration-val');
  const restSec=data.rest_duration||data.restDuration||'0';
  if (re) { re.value=restSec; const rl={'0':t('timer.no.rest.label'),'30':'30 sec','60':'1 min','90':'1:30 min','120':'2 min','180':'3 min','300':'5 min'}; if(rd) rd.textContent=rl[restSec]||restSec+'s'; localStorage.setItem('wod_rest_duration',restSec); }
  restoreBlocksFromTemplate(blocks);
  showToast('✅ Shared workout loaded: '+(data.label||'WOD'));
}

async function sbSaveProfile() {
  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  sbFeedback(t('toast.saving'), true);
  const uid = session.user.id;
  const _prs = {};
  ['pr-bsq','pr-dl','pr-cnj','pr-snatch','pr-press','pr-bench'].forEach(id => {
    const el = document.getElementById(id); if (el) _prs[id] = el.value || '0';
  });
  const profileData = {
    id:         uid,
    height:     parseInt(document.getElementById('global-h')?.value)   || null,
    weight:     parseInt(document.getElementById('global-w')?.value)   || null,
    age:        parseInt(document.getElementById('global-age')?.value) || null,
    gender:     document.getElementById('global-gender')?.value || null,
    experience: document.getElementById('global-exp')?.value    || null,
    goal:       document.getElementById('global-goal')?.value   || null,
    prs:        _prs,
    cardio_prs: {
      run400: document.getElementById('pr-run400')?.value||'0',
      run5k:  document.getElementById('pr-run5k')?.value||'0',
      row500: document.getElementById('pr-row500')?.value||'0',
      row2k:  document.getElementById('pr-row2k')?.value||'0',
      ski500: document.getElementById('pr-ski500')?.value||'0',
      bike:   document.getElementById('pr-bike')?.value||'0',
      du:     document.getElementById('pr-du')?.value||'0',
    },
    measurements: getMeasurements(),
    vo2max:       parseFloat(document.getElementById('global-vo2max')?.value) || null,
    vo2method:    _vo2method || null,
    hr_max:       parseInt(document.getElementById('global-hrmax')?.value)  || 0,
    hr_rest:      parseInt(document.getElementById('global-hrrest')?.value) || 0,
    display_name:   document.getElementById('global-display-name')?.value    || null,
    voice_name:     localStorage.getItem('wod-voice-name') || null,
    scaling_config: JSON.parse(localStorage.getItem('wod_box_scaling_config') || 'null'),
    updated_at:     new Date().toISOString()
  };
  const { error } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
  if (error) { sbFeedback('Save failed: ' + error.message, false); return; }
  sbFeedback('✅ Profile saved to cloud', true);
}

async function sbSaveTemplates() {
  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  const templates = getTemplates();
  if (!templates.length) { sbFeedback('No templates to save', false); return; }
  sbFeedback(t('toast.saving'), true);
  const uid = session.user.id;
  // Delete existing then re-insert
  await sb.from('templates').delete().eq('user_id', uid);
  const rows = templates.map(t => ({
    id:           t.id,
    user_id:      uid,
    name:         t.name,
    created_at:   t.createdAt || new Date().toISOString(),
    rest_duration: t.restDuration || '0',
    blocks:       t.blocks
  }));
  const { error } = await sb.from('templates').insert(rows);
  if (error) { sbFeedback('Templates save failed: ' + error.message, false); return; }
  sbFeedback('✅ Saved ' + rows.length + ' template' + (rows.length !== 1 ? 's' : '') + ' to cloud', true);
}

async function sbLoadTemplates() {
  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  sbFeedback('Loading templates…', true);
  const uid = session.user.id;
  const { data, error } = await sb.from('templates').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) { sbFeedback('Templates load failed: ' + error.message, false); return; }
  if (!data?.length) { sbFeedback('No templates found in cloud', false); return; }
  // Merge with local — cloud takes priority for same id
  const local = getTemplates();
  const cloudIds = new Set(data.map(t => t.id));
  const merged = [
    ...data.map(t => ({
      id:          t.id,
      name:        t.name,
      createdAt:   t.created_at,
      restDuration: t.rest_duration || '0',
      blocks:      t.blocks
    })),
    ...local.filter(t => !cloudIds.has(t.id))
  ];
  saveTemplates(merged);
  renderTemplatePanel();
  sbFeedback('✅ Loaded ' + data.length + ' template' + (data.length !== 1 ? 's' : '') + ' from cloud', true);
}

async function sbSyncAll() {
  if (!confirm('⚠️ This will delete all data stored in the cloud and replace it with your local data.\n\nProfile, history and templates will all be overwritten.\n\nContinue?')) return;

  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  sbFeedback('Syncing everything…', true);
  const uid = session.user.id;

  // 1. Profile + PRs
  const _prs = {};
  ['pr-bsq','pr-dl','pr-cnj','pr-snatch','pr-press','pr-bench'].forEach(id => {
    const el = document.getElementById(id); if (el) _prs[id] = el.value || '0';
  });
  const profileData = {
    id: uid,
    height:     parseInt(document.getElementById('global-h')?.value)   || null,
    weight:     parseInt(document.getElementById('global-w')?.value)   || null,
    age:        parseInt(document.getElementById('global-age')?.value) || null,
    gender:     document.getElementById('global-gender')?.value || null,
    experience: document.getElementById('global-exp')?.value    || null,
    goal:       document.getElementById('global-goal')?.value   || null,
    prs:        _prs,
    cardio_prs: {
      run400: document.getElementById('pr-run400')?.value||'0',
      run5k:  document.getElementById('pr-run5k')?.value||'0',
      row500: document.getElementById('pr-row500')?.value||'0',
      row2k:  document.getElementById('pr-row2k')?.value||'0',
      ski500: document.getElementById('pr-ski500')?.value||'0',
      bike:   document.getElementById('pr-bike')?.value||'0',
      du:     document.getElementById('pr-du')?.value||'0',
    },
    measurements: getMeasurements(),
    vo2max:     parseInt(document.getElementById('global-vo2max')?.value) || null,
    hr_max:     parseInt(document.getElementById('global-hrmax')?.value)  || 0,
    hr_rest:    parseInt(document.getElementById('global-hrrest')?.value) || 0,
    updated_at: new Date().toISOString()
  };
  const { error: pe } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
  if (pe) { sbFeedback('Profile sync failed: ' + pe.message, false); return; }

  // 2. History
  const history = getHistory();
  await sb.from('workouts').delete().eq('user_id', uid);
  if (history.length > 0) {
    const rows = history.map(w => ({
      user_id: uid, date: w.date, label: w.label || '',
      pd: w.pd || '0', wd: w.wd || '0', mc: w.mc || '0', fb: w.fb || '0',
      td: w.td != null ? w.td : null, rl: w.rl != null ? w.rl : null, rpe: w.rpe != null ? w.rpe : null,
      mc_mech:        w.mc_mech     != null ? w.mc_mech     : null,
      mc_aero:        w.mc_aero     != null ? w.mc_aero     : null,
      mc_overhead:    w.mc_overhead != null ? w.mc_overhead : null,
      duration_sec:   w.duration_sec != null ? w.duration_sec : null,
      bw:             w.bw != null ? w.bw : null,
      vo2max_used:    w.vo2max_used != null ? w.vo2max_used : null,
      fb_version:     w.fbVersion != null ? w.fbVersion : null,
      power_version:  w.powerVersion != null ? w.powerVersion : null,
      vo2max_attempted: w.vo2maxAttempted != null ? w.vo2maxAttempted : null,
      pattern_profile_version: w.patternProfileVersion != null ? w.patternProfileVersion : null,
      rl_version: w.rlVersion != null ? w.rlVersion : null,
      duration_v2_version: w.durationV2Version != null ? w.durationV2Version : null,
      overhead_ref_version: w.overheadRefVersion != null ? w.overheadRefVersion : null,
      bw_correction_version: w.bwCorrectionVersion != null ? w.bwCorrectionVersion : null,
      bw_work_pct: w.bw_work_pct != null ? w.bw_work_pct : null,
      bw_work_pct_version: w.bwWorkPctVersion != null ? w.bwWorkPctVersion : null,
      power_fix_version: w.powerFixVersion != null ? w.powerFixVersion : null,
      eccentric_version: w.eccentricVersion != null ? w.eccentricVersion : null,
      cardio_exmom_fix_version: w.cardioExmomFixVersion != null ? w.cardioExmomFixVersion : null,
      round_splits:   w.roundSplits ? JSON.stringify(w.roundSplits) : null,
      radar:          w.radar || null,
      blocks: w.blocks || null, rest_duration: w.restDuration || null,
      detail: w.detail || '', pattern_profile: w.patternProfile || null,
      e_raw: w.eRaw != null ? w.eRaw : null,
      mechanical_work_kj: w.mechanicalWorkKJ != null ? w.mechanicalWorkKJ : null,
      cardio_strain_met_min: w.cardioStrainMetMin != null ? w.cardioStrainMetMin : null,
      block_segments: w.blockSegments || null,
      rest_segments: w.restSegments || null,
      avg_hr: w.avgHR != null ? w.avgHR : null,
      max_hr: w.maxHR != null ? w.maxHR : null,
      cardio_interval_summary: w.cardioIntervalSummary || null
    }));
    const { error: we } = await sb.from('workouts').insert(rows);
    if (we) { sbFeedback('History sync failed: ' + we.message, false); return; }
  }

  // 3. Templates
  const templates = getTemplates();
  await sb.from('templates').delete().eq('user_id', uid);
  if (templates.length > 0) {
    const trows = templates.map(t => ({
      id: t.id, user_id: uid, name: t.name,
      created_at: t.createdAt || new Date().toISOString(),
      rest_duration: t.restDuration || '0', blocks: t.blocks
    }));
    const { error: te } = await sb.from('templates').insert(trows);
    if (te) { sbFeedback('Templates sync failed: ' + te.message, false); return; }
  }

  sbFeedback('✅ Synced — ' + history.length + ' workouts, ' + templates.length + ' templates + profile', true);
}

// ── Stage 1: Startup merge — purely additive, never overwrites or deletes ──
let _startupSyncDone = false;

// ── Pending sync queue — stores failed Supabase operations for retry ──
function getPendingSync() {
  try { return JSON.parse(localStorage.getItem('wod_pending_sync') || '{"uploads":[],"deletes":[]}'); }
  catch(e) { return { uploads: [], deletes: [] }; }
}
function savePendingSync(q) {
  localStorage.setItem('wod_pending_sync', JSON.stringify(q));
}
function queueUpload(type, data) {
  const q = getPendingSync();
  q.uploads.push({ type, data, ts: new Date().toISOString() });
  savePendingSync(q);
}
function queueDelete(type, id) {
  const q = getPendingSync();
  q.deletes.push({ type, id, ts: new Date().toISOString() });
  savePendingSync(q);
}

async function processPendingSync() {
  const sb = getSB(); if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) return;
  const uid = session.user.id;
  const q = getPendingSync();
  if (!q.uploads.length && !q.deletes.length) return;
  console.log(`[sync] Processing pending: ${q.uploads.length} uploads, ${q.deletes.length} deletes`);

  // Process deletes first
  const failedDeletes = [];
  for (const item of q.deletes) {
    try {
      if (item.type === 'history') {
        await sb.from('workouts').delete().eq('date', item.id).eq('user_id', uid);
      } else if (item.type === 'template') {
        await sb.from('templates').delete().eq('id', item.id).eq('user_id', uid);
      }
    } catch(e) { failedDeletes.push(item); }
  }

  // Process uploads
  const failedUploads = [];
  for (const item of q.uploads) {
    try {
      if (item.type === 'history') {
        await sbPushHistoryEntry(item.data, uid, sb);
      } else if (item.type === 'template') {
        await sb.from('templates').upsert({
          id: item.data.id, user_id: uid, name: item.data.name,
          created_at: item.data.createdAt, rest_duration: item.data.restDuration || '0',
          blocks: item.data.blocks
        });
      }
    } catch(e) { failedUploads.push(item); }
  }

  // Save only failed items back to queue
  savePendingSync({ uploads: failedUploads, deletes: failedDeletes });
  if (!failedUploads.length && !failedDeletes.length) {
    console.log('[sync] Pending queue cleared ✅');
  }
}

// Helper: push one history entry to Supabase
async function sbPushHistoryEntry(entry, uid, sb) {
  if (!sb) { sb = getSB(); }
  if (!uid) { const { data: { session } } = await sb.auth.getSession(); uid = session?.user?.id; }
  if (!uid) return;
  const { error } = await sb.from('workouts').upsert({
    user_id: uid, date: entry.date, label: entry.label || 'Custom WOD',
    pd: entry.pd, wd: entry.wd, mc: entry.mc, fb: entry.fb,
    td: entry.td != null ? entry.td : null, rl: entry.rl != null ? entry.rl : null, rpe: entry.rpe != null ? entry.rpe : null,
    mc_mech: entry.mc_mech != null ? entry.mc_mech : null, mc_aero: entry.mc_aero != null ? entry.mc_aero : null,
    mc_overhead: entry.mc_overhead != null ? entry.mc_overhead : null,
    duration_sec: entry.duration_sec != null ? entry.duration_sec : null,
    bw: entry.bw != null ? entry.bw : null,
    vo2max_used: entry.vo2max_used != null ? entry.vo2max_used : null,
    fb_version: entry.fbVersion != null ? entry.fbVersion : null,
    power_version: entry.powerVersion != null ? entry.powerVersion : null,
    vo2max_attempted: entry.vo2maxAttempted != null ? entry.vo2maxAttempted : null,
    pattern_profile_version: entry.patternProfileVersion != null ? entry.patternProfileVersion : null,
    rl_version: entry.rlVersion != null ? entry.rlVersion : null,
    duration_v2_version: entry.durationV2Version != null ? entry.durationV2Version : null,
    overhead_ref_version: entry.overheadRefVersion != null ? entry.overheadRefVersion : null,
    bw_correction_version: entry.bwCorrectionVersion != null ? entry.bwCorrectionVersion : null,
    bw_work_pct: entry.bw_work_pct != null ? entry.bw_work_pct : null,
    bw_work_pct_version: entry.bwWorkPctVersion != null ? entry.bwWorkPctVersion : null,
    power_fix_version: entry.powerFixVersion != null ? entry.powerFixVersion : null,
    eccentric_version: entry.eccentricVersion != null ? entry.eccentricVersion : null,
    cardio_exmom_fix_version: entry.cardioExmomFixVersion != null ? entry.cardioExmomFixVersion : null,
    emom_duration_version: entry.emomDurationVersion != null ? entry.emomDurationVersion : null,
    pd_stored_version: entry.pdStoredVersion != null ? entry.pdStoredVersion : null,
    round_splits: entry.roundSplits || null,
    blocks: entry.blocks || null, rest_duration: entry.restDuration || null,
    detail: entry.detail, pattern_profile: entry.patternProfile, radar: entry.radar || null,
    e_raw: entry.eRaw != null ? entry.eRaw : null,
    mechanical_work_kj: entry.mechanicalWorkKJ != null ? entry.mechanicalWorkKJ : null,
    cardio_strain_met_min: entry.cardioStrainMetMin != null ? entry.cardioStrainMetMin : null,
    block_segments: entry.blockSegments || null,
    rest_segments: entry.restSegments || null,
    avg_hr: entry.avgHR != null ? entry.avgHR : null,
    max_hr: entry.maxHR != null ? entry.maxHR : null,
    cardio_interval_summary: entry.cardioIntervalSummary || null
  }, { onConflict: 'user_id,date' });
  if (error) {
    console.error('[sync] sbPushHistoryEntry error:', error.message, error.details, error.hint);
    throw error;
  }
}

// Listen for connectivity restore
window.addEventListener('online', () => {
  console.log('[sync] Back online — processing pending queue');
  processPendingSync();
});

// Re-sync when app comes back to foreground (PWA lifecycle)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const sb = getSB();
    if (!sb) return;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { console.log('[sync] visibilitychange: no session'); return; }
      console.log('[sync] visibilitychange: re-syncing');
      _startupSyncDone = false;
      sbStartupSync(session.user.id);
    });
  }
});

async function sbStartupSync(uid) {
  // Only run once per app session — prevents duplicate calls from multiple auth events
  if (_startupSyncDone) return;
  _startupSyncDone = true;

  const sb = getSB();
  if (!sb || !uid) return;

  // Process any pending operations from when device was offline
  await processPendingSync();

  // ── 1. Profile: cloud is always source of truth on startup ──
  try {
    const { data: prof } = await sb.from('profiles').select('*').eq('id', uid).single();
    if (prof) {
      // Always apply cloud profile — it's the canonical source of truth
      // Local is only used when offline (no Supabase connection)
      await sbApplyProfile(prof);
      localStorage.setItem('wod_profile_updated_at', prof.updated_at || new Date().toISOString());
      // Load cached coaching insight from cloud
      if (prof.coaching_insight) {
        const ci = prof.coaching_insight;
        if (ci.lang) localStorage.setItem('wod-insight-cache-' + ci.lang, JSON.stringify(ci));
        if (ci.lang === (_lang === 'es' ? 'es' : 'en')) _insightCache = ci;
      }
      // Load action cards from cloud — cloud is source of truth here too,
      // same rule as the rest of this profile fetch, and safe to apply
      // even if the cloud copy has a slightly stale weeklyResults: this
      // just writes what the cloud has to localStorage, and the next
      // render calls refreshActionCardResults() regardless, which only
      // ever fills in weeks still sitting at null — it never overwrites
      // an already-locked-in true/false — so any week that's fully
      // elapsed since the last push gets correctly evaluated locally
      // right after this pull, using this device's own current history.
      if (Array.isArray(prof.action_cards)) {
        localStorage.setItem('wod-action-cards', JSON.stringify(prof.action_cards));
      }
      console.log('[sync] Profile applied from cloud');
    }
  } catch(e) { console.warn('[sync] Profile fetch failed:', e); }

  // ── 2. History: sync with Supabase — add missing, remove deleted ──
  try {
    const { data: wRows, error: wErr } = await sb.from('workouts')
      .select('*').eq('user_id', uid).order('date', { ascending: false });
    if (wErr) console.warn('[sync] History query error:', wErr);
    console.log(`[sync] Supabase returned ${wRows?.length} rows`);
    const local = getHistory();

    if (wRows) {
      // Map cloud entries to local format
      const cloudEntries = wRows.map(r => ({
        date: r.date, label: r.label || 'Custom WOD',
        pd: r.pd, wd: r.wd, mc: r.mc, fb: r.fb,
        td: r.td != null ? r.td : null, rl: r.rl != null ? r.rl : null, rpe: r.rpe != null ? r.rpe : null,
        mc_mech: r.mc_mech != null ? r.mc_mech : null, mc_aero: r.mc_aero != null ? r.mc_aero : null,
        mc_overhead: r.mc_overhead != null ? r.mc_overhead : null,
        duration_sec: r.duration_sec != null ? r.duration_sec : null,
        bw: r.bw != null ? r.bw : null,
        vo2max_used: r.vo2max_used != null ? r.vo2max_used : null,
        fbVersion: r.fb_version != null ? r.fb_version : null,
        powerVersion: r.power_version != null ? r.power_version : null,
        vo2maxAttempted: r.vo2max_attempted != null ? r.vo2max_attempted : null,
        patternProfileVersion: r.pattern_profile_version != null ? r.pattern_profile_version : null,
        rlVersion: r.rl_version != null ? r.rl_version : null,
        durationV2Version: r.duration_v2_version != null ? r.duration_v2_version : null,
        overheadRefVersion: r.overhead_ref_version != null ? r.overhead_ref_version : null,
        bwCorrectionVersion: r.bw_correction_version != null ? r.bw_correction_version : null,
        bw_work_pct: r.bw_work_pct != null ? r.bw_work_pct : null,
        bwWorkPctVersion: r.bw_work_pct_version != null ? r.bw_work_pct_version : null,
        powerFixVersion: r.power_fix_version != null ? r.power_fix_version : null,
        eccentricVersion: r.eccentric_version != null ? r.eccentric_version : null,
        cardioExmomFixVersion: r.cardio_exmom_fix_version != null ? r.cardio_exmom_fix_version : null,
        emomDurationVersion: r.emom_duration_version != null ? r.emom_duration_version : null,
        pdStoredVersion: r.pd_stored_version != null ? r.pd_stored_version : null,
        roundSplits: r.round_splits ? (typeof r.round_splits === 'string' ? JSON.parse(r.round_splits) : r.round_splits) : null,
        blocks: r.blocks || null, restDuration: r.rest_duration || null,
        detail: r.detail, patternProfile: r.pattern_profile, radar: r.radar || null,
        eRaw: r.e_raw != null ? r.e_raw : null,
        mechanicalWorkKJ: r.mechanical_work_kj != null ? r.mechanical_work_kj : null,
        cardioStrainMetMin: r.cardio_strain_met_min != null ? r.cardio_strain_met_min : null,
        blockSegments: r.block_segments != null ? r.block_segments : null,
        restSegments: r.rest_segments != null ? r.rest_segments : null,
        avgHR: r.avg_hr != null ? r.avg_hr : null,
        maxHR: r.max_hr != null ? r.max_hr : null,
        cardioIntervalSummary: r.cardio_interval_summary != null ? r.cardio_interval_summary : null
      }));

      console.log(`[sync] Cloud has ${cloudEntries.length} entries, local has ${local.length} (uid: ${uid})`);

      const cloudDateMap = new Map(cloudEntries.map(e => [new Date(e.date).toISOString(), e]));
      const localDateMap = new Map(local.map(w => [new Date(w.date).toISOString(), w]));

      // Cloud is source of truth — always replace local with cloud
      const added   = cloudEntries.filter(e => !localDateMap.has(new Date(e.date).toISOString())).length;
      const removed = local.filter(w => !cloudDateMap.has(new Date(w.date).toISOString())).length;
      const updated = cloudEntries.filter(e => {
        const localE = localDateMap.get(new Date(e.date).toISOString());
        return localE && JSON.stringify(localE) !== JSON.stringify(e);
      }).length;

      const cloudSorted = cloudEntries.sort((a,b) => new Date(b.date) - new Date(a.date));
      saveHistory(cloudSorted);

      // Update last sync timestamp
      localStorage.setItem('wod_last_sync_ts', new Date().toISOString());

      if (added || updated || removed) {
        if (added)   console.log(`[sync] Added ${added} history entries from cloud`);
        if (updated) console.log(`[sync] Updated ${updated} history entries with new data`);
        if (removed) console.log(`[sync] Removed ${removed} deleted history entries`);
      } else {
        console.log('[sync] History up to date');
      }
      // Always re-render to reflect latest cloud data
      renderHistory();
      if (currentTab === 3) renderAnalytics();
    }
  } catch(e) { console.warn('[sync] History fetch failed:', e); }

  // ── 3. Templates: sync with Supabase — add missing, remove deleted ──
  try {
    const { data: tRows } = await sb.from('templates')
      .select('*').eq('user_id', uid).order('created_at', { ascending: false });
    const localT = getTemplates();
    if (tRows) {
      // Cloud is truth — replace local templates entirely
      const cloudTemplates = tRows.map(t => ({
        id: t.id, name: t.name, createdAt: t.created_at,
        restDuration: t.rest_duration || '0', blocks: t.blocks
      }));
      const cloudIds = new Set(tRows.map(t => t.id));
      const added   = tRows.filter(t => !localT.find(lt => lt.id === t.id)).length;
      const deleted = localT.filter(t => !cloudIds.has(t.id)).length;
      saveTemplates(cloudTemplates);
      if (added || deleted) {
        if (added)   console.log(`[sync] Added ${added} templates from cloud`);
        if (deleted) console.log(`[sync] Removed ${deleted} deleted templates`);
      } else {
        console.log('[sync] Templates up to date');
      }
    }
  } catch(e) { console.warn('[sync] Templates fetch failed:', e); }
}

// Apply cloud profile data to DOM and localStorage
async function sbApplyProfile(prof) {
  if (prof.height) {
    const e = document.getElementById('global-h'); if (e) e.value = prof.height;
    const v = document.getElementById('prof-h-val'); if (v) v.textContent = prof.height + ' cm';
  }
  if (prof.weight) {
    const e = document.getElementById('global-w'); if (e) e.value = prof.weight;
    const v = document.getElementById('prof-w-val'); if (v) v.textContent = prof.weight + ' kg';
  }
  if (prof.age) {
    const e = document.getElementById('global-age'); if (e) e.value = prof.age;
    const v = document.getElementById('prof-age-val'); if (v) v.textContent = prof.age;
  }
  if (prof.gender) {
    const e = document.getElementById('global-gender'); if (e) e.value = prof.gender;
    const genderOpts = {male:'♂ Male', female:'♀ Female', other:'⚥ Other'};
    const gVal = document.getElementById('prof-gender-val');
    if (gVal && genderOpts[prof.gender]) gVal.textContent = genderOpts[prof.gender];
  }
  if (prof.experience) {
    const e = document.getElementById('global-exp');    if (e) e.value = prof.experience;
    // Update picker display
    const expOpts = {beginner:'🌱 Beginner', intermediate:'💪 Intermediate', advanced:'🔥 Advanced', elite:'⚡ Elite'};
    const expVal = document.getElementById('prof-exp-val');
    if (expVal && expOpts[prof.experience]) expVal.textContent = expOpts[prof.experience];
  }
  if (prof.goal) {
    const e = document.getElementById('global-goal');   if (e) e.value = prof.goal;
    // Update picker display
    const goalOpts = {conditioning:'❤️ Conditioning', strength:'💪 Strength', weightloss:'⚖️ Weight Loss', performance:'🏆 Performance', endurance:'🏃 Endurance'};
    const goalVal = document.getElementById('prof-goal-val');
    if (goalVal && goalOpts[prof.goal]) goalVal.textContent = goalOpts[prof.goal];
  }
  if (prof.display_name) { const e = document.getElementById('global-display-name'); if (e) e.value = prof.display_name; }
  if (prof.voice_name) { localStorage.setItem('wod-voice-name', prof.voice_name); populateVoiceSelector(); }
  if (prof.prs && typeof prof.prs === 'object') {
    Object.entries(prof.prs).forEach(([id, val]) => {
      const el = document.getElementById(id); if (el) el.value = val || '0';
    });
    const existingPRs = JSON.parse(localStorage.getItem('wod-prs') || '{}');
    localStorage.setItem('wod-prs', JSON.stringify({...existingPRs, ...prof.prs}));
  }
  if (prof.cardio_prs && typeof prof.cardio_prs === 'object') {
    const cp = prof.cardio_prs;
    if (cp.run400) { const e = document.getElementById('pr-run400'); if (e) e.value = cp.run400; }
    if (cp.run5k)  { const e = document.getElementById('pr-run5k');  if (e) e.value = cp.run5k;  }
    if (cp.row500) { const e = document.getElementById('pr-row500'); if (e) e.value = cp.row500; }
    if (cp.row2k)  { const e = document.getElementById('pr-row2k');  if (e) e.value = cp.row2k;  }
    if (cp.ski500) { const e = document.getElementById('pr-ski500'); if (e) e.value = cp.ski500; }
    if (cp.bike)   { const e = document.getElementById('pr-bike');   if (e) e.value = cp.bike;   }
    if (cp.du)     { const e = document.getElementById('pr-du');     if (e) e.value = cp.du;     }
    savePRs(); loadPRs();
  }
  if (prof.measurements && typeof prof.measurements === 'object') {
    localStorage.setItem('wod_athlete_measurements', JSON.stringify(prof.measurements));
    loadMeasurements();
  }
  if (prof.scaling_config) {
    localStorage.setItem('wod_box_scaling_config', JSON.stringify(prof.scaling_config));
    const scPct    = prof.scaling_config._scaledPct;
    const fdPct    = prof.scaling_config._foundPct;
    const scRepPct = prof.scaling_config._scaledRepPct;
    const fdRepPct = prof.scaling_config._foundRepPct;
    if (scPct) { const el = document.getElementById('global-scale-pct-scaled'); if (el) el.value = scPct; const v = document.getElementById('prof-scale-pct-scaled-val'); if (v) v.textContent = scPct + '%'; }
    if (fdPct) { const el = document.getElementById('global-scale-pct-found');  if (el) el.value = fdPct; const v = document.getElementById('prof-scale-pct-found-val');  if (v) v.textContent = fdPct + '%'; }
    const repSc = scRepPct || 100;
    const repFd = fdRepPct || 100;
    const elSc = document.getElementById('global-scale-rep-scaled'); if (elSc) elSc.value = repSc; const vSc = document.getElementById('prof-scale-rep-scaled-val'); if (vSc) vSc.textContent = repSc + '%';
    const elFd = document.getElementById('global-scale-rep-found');  if (elFd) elFd.value = repFd; const vFd = document.getElementById('prof-scale-rep-found-val');  if (vFd) vFd.textContent = repFd + '%';
  }
  if (prof.vo2max) {
    const e = document.getElementById('global-vo2max');
    if (e) {
      e.value = prof.vo2max;
      const v = document.getElementById('prof-vo2max-val');
      if (v) v.textContent = prof.vo2max + ' ml/kg/min';
    }
    if (prof.vo2method) { _vo2method = prof.vo2method; localStorage.setItem('wod-vo2method', prof.vo2method); }
  }
  if (prof.cooper && prof.cooper !== '0') { const e=document.getElementById('global-cooper'); if(e) { e.value=prof.cooper; const v=document.getElementById('prof-cooper-val'); if(v) v.textContent=prof.cooper+' m'; } }
  if (prof.hr_max  !== undefined && prof.hr_max  !== null) { const e = document.getElementById('global-hrmax');  if (e) { e.value = prof.hr_max;  const v = document.getElementById('prof-hrmax-val');  if (v) v.textContent = prof.hr_max  + ' bpm'; } }
  if (prof.hr_rest !== undefined && prof.hr_rest !== null) { const e = document.getElementById('global-hrrest'); if (e) { e.value = prof.hr_rest; const v = document.getElementById('prof-hrrest-val'); if (v) v.textContent = prof.hr_rest + ' bpm'; } }
  updateVO2maxEstimate();
  refreshProfileDisplays();
  updateProfileStats();
  // Save to localStorage without resetting updated_at (cloud timestamp is preserved by caller)
  const _pExtra = {
    age: document.getElementById('global-age')?.value || '',
    exp: document.getElementById('global-exp')?.value || '',
    goal: document.getElementById('global-goal')?.value || '',
    vo2max: document.getElementById('global-vo2max')?.value || '',
    vo2method: _vo2method || '',
    hrmax: document.getElementById('global-hrmax')?.value ?? '',
    hrrest: document.getElementById('global-hrrest')?.value ?? '',
    cooper: document.getElementById('global-cooper')?.value || '',
    displayName: document.getElementById('global-display-name')?.value || '',
  };
  localStorage.setItem('wod-profile-extra', JSON.stringify(_pExtra));
  saveBodyMetrics();
}

async function sbInit() {
  const sb = getSB();
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  sbUpdateUI(session);
  if (session?.user) setTimeout(() => window.sbStartupSync && window.sbStartupSync(session.user.id), 500);
}

function sbShowTab(tab) {
  const pwPanel = document.getElementById('sb-pw-panel');
  const mlPanel = document.getElementById('sb-ml-panel');
  const pwTab   = document.getElementById('sb-tab-pw');
  const mlTab   = document.getElementById('sb-tab-ml');
  if (tab === 'pw') {
    if (pwPanel) pwPanel.style.display = '';
    if (mlPanel) mlPanel.style.display = 'none';
    if (pwTab) { pwTab.style.background = 'var(--accent)'; pwTab.style.color = 'white'; }
    if (mlTab) { mlTab.style.background = 'transparent'; mlTab.style.color = 'var(--label)'; }
  } else {
    if (pwPanel) pwPanel.style.display = 'none';
    if (mlPanel) mlPanel.style.display = '';
    if (pwTab) { pwTab.style.background = 'transparent'; pwTab.style.color = 'var(--label)'; }
    if (mlTab) { mlTab.style.background = 'var(--accent)'; mlTab.style.color = 'white'; }
  }
}

async function sbResetPassword() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email = document.getElementById('sb-email')?.value?.trim();
  if (!email) { sbFeedback('Enter your email above first', false); return; }
  sbFeedback('Sending reset code…', true);
  // No redirectTo — the code-entry flow never redirects, so there's
  // nothing for a Safari-vs-PWA context mismatch to break.
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) { sbFeedback(error.message, false); return; }
  sbFeedback(`Code sent to ${email} — check your inbox`, true);
  const step = document.getElementById('sb-reset-code-step');
  if (step) step.style.display = '';
  const codeEl = document.getElementById('sb-reset-otp-code');
  if (codeEl) { codeEl.value = ''; codeEl.focus(); }
}

async function sbVerifyResetCode() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email = document.getElementById('sb-email')?.value?.trim();
  const token = document.getElementById('sb-reset-otp-code')?.value?.trim();
  if (!email) { sbFeedback('Enter your email first', false); return; }
  if (!token || token.length < 8) { sbFeedback('Enter the 8-digit code from your email', false); return; }
  sbFeedback('Verifying…', true);
  // type: 'recovery' — establishes the same recovery session the old
  // link-click flow used to get from Supabase auto-processing the URL
  // hash. Everything downstream (the set-new-password modal, updateUser())
  // stays exactly as it already was.
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'recovery' });
  if (error) { sbFeedback(error.message, false); return; }
  const step = document.getElementById('sb-reset-code-step');
  if (step) step.style.display = 'none';
  sbShowResetModal();
}

async function sbSignIn() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email    = document.getElementById('sb-email')?.value?.trim();
  const password = document.getElementById('sb-password')?.value;
  if (!email || !password) { sbFeedback('Enter email and password', false); return; }
  sbFeedback('Signing in…', true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { sbFeedback(error.message, false); }
  else { sbFeedback('✅ Signed in!', true); }
}

async function sbSignUp() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email    = document.getElementById('sb-email')?.value?.trim();
  const password = document.getElementById('sb-password')?.value;
  if (!email || !password) { sbFeedback('Enter email and password', false); return; }
  if (password.length < 6) { sbFeedback('Password must be at least 6 characters', false); return; }
  sbFeedback('Creating account…', true);
  const { error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.href.split('?')[0].split('#')[0] }
  });
  if (error) { sbFeedback(error.message, false); }
  else { sbFeedback('✅ Account created! Check your email to confirm.', true); }
}

async function sbSendMagicLink() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email = document.getElementById('sb-email')?.value?.trim();
  if (!email) { sbFeedback('Enter your email first', false); return; }
  sbFeedback('Sending…', true);
  // No emailRedirectTo — the code-entry flow never redirects at all, so
  // there's nothing for a URL to break. shouldCreateUser lets a new email
  // sign up straight through this same flow, same as before.
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) { sbFeedback(error.message, false); return; }
  sbFeedback(`Code sent to ${email} — check your inbox`, true);
  const step1 = document.getElementById('sb-ml-step1');
  const step2 = document.getElementById('sb-ml-step2');
  if (step1) step1.style.display = 'none';
  if (step2) step2.style.display = '';
  const codeEl = document.getElementById('sb-otp-code');
  if (codeEl) { codeEl.value = ''; codeEl.focus(); }
}

async function sbVerifyOtpCode() {
  const sb = getSB();
  if (!sb) { sbFeedback('Supabase not loaded yet', false); return; }
  const email = document.getElementById('sb-email')?.value?.trim();
  const token = document.getElementById('sb-otp-code')?.value?.trim();
  if (!email) { sbFeedback('Enter your email first', false); return; }
  if (!token || token.length < 8) { sbFeedback('Enter the 8-digit code from your email', false); return; }
  sbFeedback('Verifying…', true);
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) { sbFeedback(error.message, false); return; }
  sbFeedback('✅ Signed in!', true);
  // Reset the panel back to step 1 for next time
  const step1 = document.getElementById('sb-ml-step1');
  const step2 = document.getElementById('sb-ml-step2');
  if (step1) step1.style.display = '';
  if (step2) step2.style.display = 'none';
}


async function sbSignOut() {
  const sb = getSB();
  if (!sb) return;
  await sb.auth.signOut();
  _startupSyncDone = false; // Allow sync to run again on next login
  sbFeedback('Signed out', true);
}

/* Save the CURRENT workout session to history + Supabase */
async function sbSaveCurrentWorkout() {
  const sb = getSB();
  // Check if physics have been calculated
  const pd = document.getElementById('resPD')?.innerText;
  if (!pd || pd === '0') {
    sbFeedback('Run ⚡ Calculate Physics first', false);
    return;
  }

  // Build entry (same logic as saveModularToHistory)
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
    const cwodAcc = b.querySelector('.classic-accordion');
    const cn = cwodAcc?.classList.contains('open') ? b.querySelector('.cwod-select')?.value : null;
    lines.push(`Block ${i+1} (${mode}) · ${intent}${cn ? ' ★ '+cn : ''}`);
    const ladderSeqD2 = getLadderSequence(b);
    const ladderStrD2 = ladderSeqD2 ? ladderSeqD2.join('-') : null;
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
      } else if (ladderStrD2) {
        repStr = `${ladderStrD2} @ ${wtLabel}`;
      } else {
        repStr = `${repsRaw} reps @ ${wtLabel}`;
      }
      lines.push(`  ${name} | ${repStr}`);
    });
    const emomOn = b.querySelector('.emom-accordion')?.classList.contains('penalty-on');
    if (emomOn) {
      const eKey = b.querySelector('.int-key')?.value || 'Penalty';
      const eWt  = b.querySelector('.int-wt')?.value  || '0';
      const eRps = b.querySelector('.int-reps')?.value || '0';
      const eSec = b.querySelector('.int-sec')?.value  || '60';
      const isBW = b.querySelector('.int-wt')?.disabled || MASTER_DB[eKey]?.type === 'bw';
      lines.push(`  ⚡ EMOM Penalty: ${eKey} | ${eRps} reps @ ${isBW?'BW':eWt+' kg'} every ${eSec}s → ${e} total reps`);
    }
    const resultStr = mode==='TABATA' ? `${t('audit.total.reps')}: ${x}` : `${t('audit.result')}: ${r} ${t('audit.rounds')} + ${x} ${t('audit.extra')} | ${t('audit.time')}: ${m}:${(s||'0').padStart(2,'0')}`;
    lines.push(`  ${resultStr}`);
  });
  const wd  = document.getElementById('resWD')?.dataset.precise || document.getElementById('resWD')?.innerText || '0';
  const mc  = document.getElementById('resMC')?.innerText || '0';
  const fb  = document.getElementById('resFB')?.innerText || '0';
  const restSecSave2 = (window._timerRestCompleted && window._actualRestUsed > 0)
    ? window._actualRestUsed
    : parseInt(document.querySelector('.res-rest-card .res-rest')?.value || document.getElementById('rest-duration-sec')?.value) || 0;
  const blockCount2 = document.querySelectorAll('.wod-block').length;
  const restGaps2 = Math.max(0, blockCount2 - 1);
  const totalRestSec2 = (window._timerRestCompleted && window._actualRestUsed > 0)
    ? restSecSave2
    : restSecSave2 * restGaps2;
  if (totalRestSec2 > 0 && restGaps2 > 0) {
    const restMin2 = Math.floor(totalRestSec2/60), restRemSec2 = totalRestSec2%60;
    const restLabel2 = restMin2 > 0 ? `${restMin2}:${restRemSec2.toString().padStart(2,'0')}` : `${totalRestSec2}s`;
    lines.push(`⏸ ${t('res.total.rest')}: ${restLabel2}`);
    aggSumTime += totalRestSec2;
  }
  const aggStr = `${Math.floor(aggSumTime/60)}:${(aggSumTime%60).toString().padStart(2,'0')}`;
  lines.push(`${t('audit.agg.time')}: ${aggStr}`);
  // Physics stored in separate entry fields — not duplicated in detail text
  const detail = lines.join('\n');

  // Determine auto label from template or benchmark
  let autoLabel = _activeTemplateName || '';
  if (!autoLabel) {
    const firstCwodOpen = document.querySelector('.classic-accordion.open');
    if (firstCwodOpen) { const sel = firstCwodOpen.querySelector('.cwod-select'); if (sel?.value) autoLabel = sel.value; }
    if (!autoLabel) {
      document.querySelectorAll('.cwod-select').forEach(sel => {
        if (!autoLabel && sel.value) autoLabel = sel.value;
      });
    }
  }

  const _tdRaw2 = document.getElementById('resTD')?.innerText||'';
  const _rlCard2 = document.getElementById('resRL-card');
  const _rlRaw2 = (_rlCard2?.style.display !== 'none') ? (document.getElementById('resRL')?.innerText||'') : '';
  const _td2 = _tdRaw2 && _tdRaw2 !== '—' ? parseFloat(_tdRaw2) : null;
  const _rl2 = _rlRaw2 && _rlRaw2 !== '0%' ? parseFloat(_rlRaw2) : null;
  const _blocksSnap2 = serializeBlocksForTemplate();
  const _restSnap2 = String(document.querySelector('.res-rest-card .res-rest')?.value || document.getElementById('rest-duration-sec')?.value || '0');

  // Store pending entry and show name modal
  _pendingHistoryEntry = {
    pd, wd, mc, fb, fbVersion: 5,
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION, rlVersion: RL_TARGET_VERSION,
    durationV2Version: DURATION_V2_TARGET_VERSION, bwCorrectionVersion: BW_CORRECTION_TARGET_VERSION,
    bwWorkPctVersion: BW_WORK_PCT_TARGET_VERSION, overheadRefVersion: OVERHEAD_REF_TARGET_VERSION,
    td: _td2, rl: _rl2,
    bw_work_pct: window._lastBodyweightWorkPct != null ? window._lastBodyweightWorkPct : null,
    mc_mech:     window._lastMechKcal    != null ? window._lastMechKcal    : null,
    mc_aero:     window._lastCardioKcal  != null ? window._lastCardioKcal  : null,
    mc_overhead: window._lastOverheadKcal != null ? window._lastOverheadKcal : null,
    duration_sec: window._lastDurationSec != null ? window._lastDurationSec : null,
    bw: window._lastBodyweight != null ? window._lastBodyweight : null,
    vo2max_used: window._lastVo2max != null ? window._lastVo2max : null,
    detail, _blocksSnap: _blocksSnap2, _restSnap: _restSnap2,
    isSbSave: true
  };
  const inp = document.getElementById('wodNameInput');
  if (inp) inp.value = autoLabel;
  document.getElementById('wodNameModal')?.classList.add('open');
  setTimeout(() => { inp?.focus(); if (!autoLabel) inp?.select(); }, 300);
}

async function _finishSbSave(wodLabel, e) {
  const sb = getSB();
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  const entry = {
    date: localISOString(),
    pd: e.pd, wd: e.wd, mc: e.mc, fb: e.fb, fbVersion: 5, mc_mech: e.mc_mech != null ? e.mc_mech : null, mc_aero: e.mc_aero != null ? e.mc_aero : null, mc_overhead: e.mc_overhead != null ? e.mc_overhead : null,
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION, rlVersion: RL_TARGET_VERSION,
    durationV2Version: DURATION_V2_TARGET_VERSION, bwCorrectionVersion: BW_CORRECTION_TARGET_VERSION,
    bwWorkPctVersion: BW_WORK_PCT_TARGET_VERSION, overheadRefVersion: OVERHEAD_REF_TARGET_VERSION,
    bw_work_pct: e.bw_work_pct != null ? e.bw_work_pct : null,
    bw: e.bw != null ? e.bw : (parseFloat(document.getElementById('global-w')?.value) || null),
    duration_sec: e.duration_sec != null ? e.duration_sec : null,
    vo2max_used: e.vo2max_used != null ? e.vo2max_used : null,
    powerVersion: 1,
    eccentricVersion: ECCENTRIC_WORK_TARGET_VERSION,
    cardioExmomFixVersion: CARDIO_EXMOM_FIX_TARGET_VERSION,
    powerFixVersion: POWER_FIX_TARGET_VERSION,
    emomDurationVersion: EMOM_DURATION_TARGET_VERSION,
    pdStoredVersion: PD_STORED_TARGET_VERSION,
    ...(e.td !== null && { td: e.td }),
    ...(e.rl !== null && { rl: e.rl }),
    label: wodLabel,
    detail: e.detail,
    blocks: e._blocksSnap,
    restDuration: e._restSnap,
    patternProfile: _lastPatternProfile || { patternPct:{}, dominantPattern:'unknown' },
    patternProfileVersion: PATTERN_PROFILE_TARGET_VERSION,
    roundSplits: _roundSplits.length > 0 ? [..._roundSplits] : null,
    // Radar built the same way history.js's saveModularToHistory() does —
    // this function used to build it inline with the OLD 6-axis scheme
    // (pd/wd/mc/fb/rl/td, _v:2), from before the radar axes changed to
    // cvIntensity/internalLoad (_v:3). Every session saved through this
    // path got a permanently-outdated radar that could never pass the
    // repair button's version check — not a one-time gap, every single
    // save via this button re-triggered it. Needs blockSegments/
    // vo2max_used/bw already set on `entry` first, since
    // computeRadarValuesForSession → getSessionCVEndurance reads those;
    // populated further below in this same function, so this radar
    // computation is deferred there rather than done here.
    radar: null
  };

  // RPE was already collected as part of result entry, per block, then
  // duration-weighted-averaged by calculateGlobalPhysics() — no post-save
  // prompt needed anymore. blockRpe is the raw per-block array, saved for
  // Phase 2 (real per-block overhead) even though nothing reads it yet.
  const rpe = window._lastComputedRPE || null;
  entry.rpe = rpe;
  entry.blockRpe = window._lastBlockRpeList || null;
  // Reuses window._lastBlockSegments frozen at Calculate time
  // (physics-core.js), not a fresh _buildAllBlockSegments() call — same
  // fix as history.js's save path, for the same reason: any HR samples
  // streaming in between Calculate and this save (even during a brief
  // cool-down) would otherwise produce different segment data than what
  // Calculate already showed, silently shifting Overall/Work/Running/DU
  // Efficiency between what was displayed live and what got saved.
  try { entry.blockSegments = window._lastBlockSegments !== undefined ? window._lastBlockSegments : _buildAllBlockSegments(); } catch (e) { entry.blockSegments = null; }
  try { entry.restSegments = _buildRestSegments(); } catch (e) { entry.restSegments = null; }
  try {
    // Reuses window._lastSessionHR frozen at Calculate time, not a
    // fresh _hrStatsForRange(0, Date.now()) call — same fix as
    // history.js's save path: a second, independent call with its own
    // later Date.now() could include HR samples that arrived after
    // Calculate, making the saved avgHR/maxHR drift from what was
    // actually displayed live.
    const sessionHR = window._lastSessionHR !== undefined ? window._lastSessionHR : _hrStatsForRange(0, Date.now());
    entry.avgHR = sessionHR ? sessionHR.avg : null;
    entry.maxHR = sessionHR ? sessionHR.max : null;
  } catch (e) { entry.avgHR = null; entry.maxHR = null; }
  try { entry.cardioIntervalSummary = _buildCardioIntervalSummary(); } catch (e) { entry.cardioIntervalSummary = null; }
  _updateERawForEntry(entry);
  // Session Signature radar — same computation history.js's save flow
  // uses, run here (not inline above) since computeRadarValuesForSession
  // → getSessionCVEndurance needs entry.blockSegments/vo2max_used/bw,
  // all set by this point.
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

  // 1. Save to local history
  const hist = getHistory();
  hist.unshift(entry);
    if (hist.length > 50) hist.pop();
  saveHistory(hist);
  detectBenchmarkPR(entry);
  if (currentTab === 4) renderHistory();
  if (currentTab === 0) renderBenchmarkPRs();

  // 2. Save to Supabase if signed in
  if (!sb || !session?.user) {
    showToast('✅ Saved: ' + wodLabel + (rpe ? ' · RPE ' + rpe : '') + ' ' + (!session?.user ? '(sign in to sync)' : ''));
    return;
  }

  sbFeedback(t('toast.saving'), true);
  const uid = session.user.id;
  const row = {
    user_id:        uid,
    date:           entry.date,
    label:          entry.label,
    pd:             entry.pd,
    wd:             entry.wd,
    bw:             entry.bw || null,
    mc:             entry.mc,
    fb:             entry.fb,
    td:             entry.td  != null ? entry.td  : null,
    rl:             entry.rl  != null ? entry.rl  : null,
    rpe:            entry.rpe != null ? entry.rpe : null,
    mc_mech:        entry.mc_mech     != null ? entry.mc_mech     : null,
    mc_aero:        entry.mc_aero     != null ? entry.mc_aero     : null,
    mc_overhead:    entry.mc_overhead != null ? entry.mc_overhead : null,
    duration_sec:   entry.duration_sec != null ? entry.duration_sec : null,
    vo2max_used:    entry.vo2max_used != null ? entry.vo2max_used : null,
    fb_version:     entry.fbVersion != null ? entry.fbVersion : null,
    power_version:  entry.powerVersion != null ? entry.powerVersion : null,
    vo2max_attempted: entry.vo2maxAttempted != null ? entry.vo2maxAttempted : null,
    pattern_profile_version: entry.patternProfileVersion != null ? entry.patternProfileVersion : null,
    rl_version: entry.rlVersion != null ? entry.rlVersion : null,
    duration_v2_version: entry.durationV2Version != null ? entry.durationV2Version : null,
    overhead_ref_version: entry.overheadRefVersion != null ? entry.overheadRefVersion : null,
    bw_correction_version: entry.bwCorrectionVersion != null ? entry.bwCorrectionVersion : null,
    bw_work_pct: entry.bw_work_pct != null ? entry.bw_work_pct : null,
    bw_work_pct_version: entry.bwWorkPctVersion != null ? entry.bwWorkPctVersion : null,
    power_fix_version: entry.powerFixVersion != null ? entry.powerFixVersion : null,
    eccentric_version: entry.eccentricVersion != null ? entry.eccentricVersion : null,
    cardio_exmom_fix_version: entry.cardioExmomFixVersion != null ? entry.cardioExmomFixVersion : null,
    emom_duration_version: entry.emomDurationVersion != null ? entry.emomDurationVersion : null,
    pd_stored_version: entry.pdStoredVersion != null ? entry.pdStoredVersion : null,
    round_splits:   entry.roundSplits ? JSON.stringify(entry.roundSplits) : null,
    blocks:         entry.blocks || null,
    rest_duration:  entry.restDuration || null,
    detail:         entry.detail,
    pattern_profile: entry.patternProfile || null,
    radar:          entry.radar || null,
    e_raw: entry.eRaw != null ? entry.eRaw : null,
    mechanical_work_kj: entry.mechanicalWorkKJ != null ? entry.mechanicalWorkKJ : null,
    cardio_strain_met_min: entry.cardioStrainMetMin != null ? entry.cardioStrainMetMin : null,
    block_segments: entry.blockSegments || null,
    rest_segments: entry.restSegments || null,
    avg_hr: entry.avgHR != null ? entry.avgHR : null,
    max_hr: entry.maxHR != null ? entry.maxHR : null,
    cardio_interval_summary: entry.cardioIntervalSummary || null
  };
  const { error } = await sb.from('workouts').insert(row);
  if (error) {
    // Always shown regardless of the hero card — a cloud sync failure
    // is genuinely important error information, not a redundant "saved"
    // confirmation the card already covers.
    showToast('✅ Saved locally · RPE ' + (rpe || '—') + ' (cloud failed)');
    sbFeedback('Cloud: ' + error.message, false);
  } else {
    showToast('✅ Saved: ' + wodLabel + (rpe ? ' · RPE ' + rpe : ''));
    sbFeedback('✅ Synced to Supabase', true);
  }
}

async function sbSaveToCloud() {
  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  sbFeedback(t('toast.saving'), true);
  const uid = session.user.id;

  // Save profile — id IS the user id (your schema: id uuid references auth.users)
  const _prs = {};
  ['pr-bsq','pr-dl','pr-cnj','pr-snatch','pr-press','pr-bench'].forEach(id => {
    const el = document.getElementById(id); if (el) _prs[id] = el.value || '0';
  });
  const profileData = {
    id:         uid,
    height:     parseInt(document.getElementById('global-h')?.value)   || null,
    weight:     parseInt(document.getElementById('global-w')?.value)   || null,
    age:        parseInt(document.getElementById('global-age')?.value) || null,
    gender:     document.getElementById('global-gender')?.value || null,
    experience: document.getElementById('global-exp')?.value    || null,
    goal:       document.getElementById('global-goal')?.value   || null,
    prs:        _prs,
    cardio_prs: {
      run400: document.getElementById('pr-run400')?.value||'0',
      run5k:  document.getElementById('pr-run5k')?.value||'0',
      row500: document.getElementById('pr-row500')?.value||'0',
      row2k:  document.getElementById('pr-row2k')?.value||'0',
      ski500: document.getElementById('pr-ski500')?.value||'0',
      bike:   document.getElementById('pr-bike')?.value||'0',
      du:     document.getElementById('pr-du')?.value||'0',
    },
    measurements: getMeasurements(),
    vo2max:     parseInt(document.getElementById('global-vo2max')?.value) || null,
    hr_max:     parseInt(document.getElementById('global-hrmax')?.value)  || null,
    hr_rest:    parseInt(document.getElementById('global-hrrest')?.value) || null,
    updated_at: new Date().toISOString()
  };
  const { error: pe } = await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
  if (pe) { sbFeedback('Profile save failed: ' + pe.message, false); return; }

  // Save workouts — delete owned rows first (add delete policy if missing), then insert
  const history = getHistory();
  if (history.length > 0) {
    // Attempt delete (requires delete policy — add if needed: create policy "Users can delete own workouts" on workouts for delete using (auth.uid() = user_id))
    await sb.from('workouts').delete().eq('user_id', uid);
    const rows = history.map(w => ({
      user_id:        uid,
      date:           w.date,
      label:          w.label   || '',
      pd:             w.pd      || '0',
      wd:             w.wd      || '0',
      mc:             w.mc      || '0',
      fb:             w.fb      || '0',
      td:             w.td      != null ? w.td      : null,
      rl:             w.rl      != null ? w.rl      : null,
      rpe:            w.rpe     != null ? w.rpe     : null,
      mc_mech:        w.mc_mech     != null ? w.mc_mech     : null,
      mc_aero:        w.mc_aero     != null ? w.mc_aero     : null,
      mc_overhead:    w.mc_overhead != null ? w.mc_overhead : null,
      duration_sec:   w.duration_sec != null ? w.duration_sec : null,
      bw:             w.bw != null ? w.bw : null,
      vo2max_used:    w.vo2max_used != null ? w.vo2max_used : null,
      fb_version:     w.fbVersion != null ? w.fbVersion : null,
      power_version:  w.powerVersion != null ? w.powerVersion : null,
      vo2max_attempted: w.vo2maxAttempted != null ? w.vo2maxAttempted : null,
      pattern_profile_version: w.patternProfileVersion != null ? w.patternProfileVersion : null,
      rl_version: w.rlVersion != null ? w.rlVersion : null,
      duration_v2_version: w.durationV2Version != null ? w.durationV2Version : null,
      overhead_ref_version: w.overheadRefVersion != null ? w.overheadRefVersion : null,
      bw_correction_version: w.bwCorrectionVersion != null ? w.bwCorrectionVersion : null,
      bw_work_pct: w.bw_work_pct != null ? w.bw_work_pct : null,
      bw_work_pct_version: w.bwWorkPctVersion != null ? w.bwWorkPctVersion : null,
      power_fix_version: w.powerFixVersion != null ? w.powerFixVersion : null,
      eccentric_version: w.eccentricVersion != null ? w.eccentricVersion : null,
      cardio_exmom_fix_version: w.cardioExmomFixVersion != null ? w.cardioExmomFixVersion : null,
      round_splits:   w.roundSplits ? JSON.stringify(w.roundSplits) : null,
      blocks:         w.blocks  || null,
      rest_duration:  w.restDuration || null,
      detail:         w.detail  || '',
      pattern_profile: w.patternProfile || null,
      radar:          w.radar || null,
      e_raw: w.eRaw != null ? w.eRaw : null,
      mechanical_work_kj: w.mechanicalWorkKJ != null ? w.mechanicalWorkKJ : null,
      cardio_strain_met_min: w.cardioStrainMetMin != null ? w.cardioStrainMetMin : null,
      block_segments: w.blockSegments || null,
      rest_segments: w.restSegments || null,
      avg_hr: w.avgHR != null ? w.avgHR : null,
      max_hr: w.maxHR != null ? w.maxHR : null,
      cardio_interval_summary: w.cardioIntervalSummary || null
    }));
    const { error: we } = await sb.from('workouts').insert(rows);
    if (we) { sbFeedback('Workouts save failed: ' + we.message, false); return; }
  }

  if (_lastPatternProfile) {
    localStorage.setItem('wod_last_pattern_profile', JSON.stringify(_lastPatternProfile));
  }
  sbFeedback('✅ Saved ' + history.length + ' workouts + profile', true);
}

async function sbLoadFromCloud() {
  const sb = getSB();
  if (!sb) { sbFeedback('Not connected', false); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { sbFeedback('Sign in first', false); return; }
  sbFeedback('Loading…', true);
  const uid = session.user.id;

  // Load profile — id IS the user id
  const { data: prof, error: pe } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (!pe && prof) {
    if (prof.height)     { const e = document.getElementById('global-h');      if (e) e.value = prof.height;     }
    if (prof.weight)     { const e = document.getElementById('global-w');      if (e) e.value = prof.weight;     }
    if (prof.age)        { const e = document.getElementById('global-age');    if (e) e.value = prof.age;        }
    if (prof.gender)     { const e = document.getElementById('global-gender'); if (e) e.value = prof.gender;     }
    if (prof.experience) { const e = document.getElementById('global-exp');    if (e) e.value = prof.experience; }
    if (prof.goal)       { const e = document.getElementById('global-goal');   if (e) e.value = prof.goal;       }
    // Restore 1RM PRs
    if (prof.prs && typeof prof.prs === 'object') {
      Object.entries(prof.prs).forEach(([id, val]) => {
        const el = document.getElementById(id); if (el) el.value = val || '0';
      });
      // Merge with existing cardio PRs so we don't overwrite them
      const existingPRs = JSON.parse(localStorage.getItem('wod-prs') || '{}');
      localStorage.setItem('wod-prs', JSON.stringify({...existingPRs, ...prof.prs}));
      ['bsq','dl','cnj','snatch','press','bench'].forEach(k => {
        const val = document.getElementById('pr-' + k)?.value;
        const disp = document.getElementById('pp-' + k + '-val');
        if (disp) disp.textContent = (!val || val === '0') ? '—' : val + ' kg';
      });
    }
    // Restore precise body measurements
    if (prof.measurements && typeof prof.measurements === 'object') {
      localStorage.setItem('wod_athlete_measurements', JSON.stringify(prof.measurements));
      loadMeasurements();
    }
    // Restore cardio PRs
    if (prof.cardio_prs && typeof prof.cardio_prs === 'object') {
      const cp = prof.cardio_prs;
      if (cp.run400) document.getElementById('pr-run400').value = cp.run400;
      if (cp.run5k)  document.getElementById('pr-run5k').value  = cp.run5k;
      if (cp.row500) document.getElementById('pr-row500').value = cp.row500;
      if (cp.row2k)  document.getElementById('pr-row2k').value  = cp.row2k;
      if (cp.ski500) document.getElementById('pr-ski500').value = cp.ski500;
      if (cp.bike)   document.getElementById('pr-bike').value   = cp.bike;
      if (cp.du)     document.getElementById('pr-du').value     = cp.du;
      savePRs(); // persist to localStorage so they survive app close
      loadPRs(); // update display values
    }
    // Restore aerobic capacity fields
    if (prof.display_name) document.getElementById('global-display-name').value = prof.display_name;
    if (prof.voice_name) { localStorage.setItem('wod-voice-name', prof.voice_name); populateVoiceSelector(); }
    if (prof.scaling_config) {
      localStorage.setItem('wod_box_scaling_config', JSON.stringify(prof.scaling_config));
      const scPct    = prof.scaling_config._scaledPct;
      const fdPct    = prof.scaling_config._foundPct;
      const scRepPct = prof.scaling_config._scaledRepPct;
      const fdRepPct = prof.scaling_config._foundRepPct;
      if (scPct)    { document.getElementById('global-scale-pct-scaled').value = scPct;    document.getElementById('prof-scale-pct-scaled-val').textContent = scPct + '%'; }
      if (fdPct)    { document.getElementById('global-scale-pct-found').value  = fdPct;    document.getElementById('prof-scale-pct-found-val').textContent  = fdPct + '%'; }
      const repSc2 = scRepPct || 100; const repFd2 = fdRepPct || 100;
      const elSc2 = document.getElementById('global-scale-rep-scaled'); if (elSc2) elSc2.value = repSc2; const vSc2 = document.getElementById('prof-scale-rep-scaled-val'); if (vSc2) vSc2.textContent = repSc2 + '%';
      const elFd2 = document.getElementById('global-scale-rep-found');  if (elFd2) elFd2.value = repFd2; const vFd2 = document.getElementById('prof-scale-rep-found-val');  if (vFd2) vFd2.textContent = repFd2 + '%';
    }
    if (prof.vo2max) { document.getElementById('global-vo2max').value = prof.vo2max; document.getElementById('prof-vo2max-val').textContent = prof.vo2max + ' ml/kg/min'; }
    if (prof.hr_max  !== undefined && prof.hr_max  !== null) { document.getElementById('global-hrmax').value  = prof.hr_max;  document.getElementById('prof-hrmax-val').textContent  = prof.hr_max  + ' bpm'; }
    if (prof.hr_rest !== undefined && prof.hr_rest !== null) { document.getElementById('global-hrrest').value = prof.hr_rest; document.getElementById('prof-hrrest-val').textContent = prof.hr_rest + ' bpm'; }
    updateVO2maxEstimate();
    refreshProfileDisplays();
    updateProfileStats();
    saveProfile();
    saveBodyMetrics();
  }

  // Load workouts
  const { data: wRows, error: we } = await sb.from('workouts')
    .select('*').eq('user_id', uid).order('date', { ascending: false });
  if (we) { sbFeedback('Load failed: ' + we.message, false); return; }
  if (wRows && wRows.length > 0) {
    // Get existing local history to preserve split data not stored in cloud
    const localHist = getHistory();
    const localByDate = {};
    localHist.forEach(w => { if (w.date) localByDate[w.date] = w; });
    // Also build index by label for fuzzy matching after date edits
    const localByLabel = {};
    localHist.forEach(w => {
      const k = (w.label||'').toLowerCase().trim();
      if (k && !localByLabel[k]) localByLabel[k] = w;
    });

    const hist = wRows.map(r => {
      // Find matching local entry — exact date, then label match
      const labelKey = (r.label||'').toLowerCase().trim();
      const local = localByDate[r.date] || localByLabel[labelKey] || {};
      return {
        date:          r.date,
        label:         r.label || 'Custom WOD',
        pd:            r.pd,
        wd:            r.wd,
        mc:            r.mc,
        fb:            r.fb,
        td:            r.td   != null ? r.td  : (local.td  != null ? local.td  : null),
        rl:            r.rl   != null ? r.rl  : (local.rl  != null ? local.rl  : null),
        rpe:           r.rpe  != null ? r.rpe : (local.rpe != null ? local.rpe : null),
        mc_mech:       r.mc_mech     != null ? r.mc_mech     : (local.mc_mech     != null ? local.mc_mech     : null),
        mc_aero:       r.mc_aero     != null ? r.mc_aero     : (local.mc_aero     != null ? local.mc_aero     : null),
        mc_overhead:   r.mc_overhead != null ? r.mc_overhead : (local.mc_overhead != null ? local.mc_overhead : null),
        duration_sec:  r.duration_sec != null ? r.duration_sec : (local.duration_sec != null ? local.duration_sec : null),
        bw:            r.bw != null ? r.bw : (local.bw != null ? local.bw : null),
        vo2max_used:   r.vo2max_used != null ? r.vo2max_used : (local.vo2max_used != null ? local.vo2max_used : null),
        fbVersion:     r.fb_version != null ? r.fb_version : (local.fbVersion != null ? local.fbVersion : null),
        powerVersion:  r.power_version != null ? r.power_version : (local.powerVersion != null ? local.powerVersion : null),
        vo2maxAttempted: r.vo2max_attempted != null ? r.vo2max_attempted : (local.vo2maxAttempted != null ? local.vo2maxAttempted : null),
        patternProfileVersion: r.pattern_profile_version != null ? r.pattern_profile_version : (local.patternProfileVersion != null ? local.patternProfileVersion : null),
        rlVersion: r.rl_version != null ? r.rl_version : (local.rlVersion != null ? local.rlVersion : null),
        durationV2Version: r.duration_v2_version != null ? r.duration_v2_version : (local.durationV2Version != null ? local.durationV2Version : null),
        overheadRefVersion: r.overhead_ref_version != null ? r.overhead_ref_version : (local.overheadRefVersion != null ? local.overheadRefVersion : null),
        bwCorrectionVersion: r.bw_correction_version != null ? r.bw_correction_version : (local.bwCorrectionVersion != null ? local.bwCorrectionVersion : null),
        bw_work_pct: r.bw_work_pct != null ? r.bw_work_pct : (local.bw_work_pct != null ? local.bw_work_pct : null),
        bwWorkPctVersion: r.bw_work_pct_version != null ? r.bw_work_pct_version : (local.bwWorkPctVersion != null ? local.bwWorkPctVersion : null),
        powerFixVersion: r.power_fix_version != null ? r.power_fix_version : (local.powerFixVersion != null ? local.powerFixVersion : null),
        eccentricVersion: r.eccentric_version != null ? r.eccentric_version : (local.eccentricVersion != null ? local.eccentricVersion : null),
        cardioExmomFixVersion: r.cardio_exmom_fix_version != null ? r.cardio_exmom_fix_version : (local.cardioExmomFixVersion != null ? local.cardioExmomFixVersion : null),
        roundSplits:   r.round_splits ? (typeof r.round_splits === 'string' ? JSON.parse(r.round_splits) : r.round_splits) : (local.roundSplits || null),
        blocks:        r.blocks || local.blocks || null,
        restDuration:  r.rest_duration || null,
        detail:        r.detail,
        patternProfile: r.pattern_profile,
        radar:         r.radar || local.radar || null,
        eRaw: r.e_raw != null ? r.e_raw : (local.eRaw != null ? local.eRaw : null),
        mechanicalWorkKJ: r.mechanical_work_kj != null ? r.mechanical_work_kj : (local.mechanicalWorkKJ != null ? local.mechanicalWorkKJ : null),
        cardioStrainMetMin: r.cardio_strain_met_min != null ? r.cardio_strain_met_min : (local.cardioStrainMetMin != null ? local.cardioStrainMetMin : null),
        blockSegments: r.block_segments != null ? r.block_segments : (local.blockSegments != null ? local.blockSegments : null),
        restSegments: r.rest_segments != null ? r.rest_segments : (local.restSegments != null ? local.restSegments : null),
        avgHR: r.avg_hr != null ? r.avg_hr : (local.avgHR != null ? local.avgHR : null),
        maxHR: r.max_hr != null ? r.max_hr : (local.maxHR != null ? local.maxHR : null),
        cardioIntervalSummary: r.cardio_interval_summary != null ? r.cardio_interval_summary : (local.cardioIntervalSummary != null ? local.cardioIntervalSummary : null)
      };
    });
    saveHistory(hist);
    // Recalculate profile unlock date from freshly loaded history
    localStorage.removeItem('wod_profile_unlocked_at');
    rebuildBenchmarkPRs();
    if (currentTab === 4) renderHistory();
    if (currentTab === 3) renderAnalytics();
  }
  // Also load templates
  const { data: tRows } = await sb.from('templates').select('*').eq('user_id', uid).order('created_at', { ascending: false });
  if (tRows?.length) {
    const cloudTemplates = tRows.map(t => ({
      id: t.id, name: t.name, createdAt: t.created_at,
      restDuration: t.rest_duration || '0', blocks: t.blocks
    }));
    const local = getTemplates();
    const cloudIds = new Set(cloudTemplates.map(t => t.id));
    const merged = [...cloudTemplates, ...local.filter(t => !cloudIds.has(t.id))];
    saveTemplates(merged);
  }

  sbFeedback('✅ Loaded ' + (wRows?.length || 0) + ' workouts, ' + (tRows?.length || 0) + ' templates + profile', true);
}

// Init Supabase on page load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(sbInit, 500);
  setTimeout(checkSharedWodParam, 800);
});
