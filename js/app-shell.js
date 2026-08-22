/* ════════════════════════════════════════════════════
   APP SHELL
   Navigation, theme, generic UI utilities (confirm dialog,
   debug viewer), PWA registration, and the window.onload
   bootstrap that ties every other module together at startup.
════════════════════════════════════════════════════ */

var currentTab = 0;

// ══ On-phone debug viewer ══ — see HTML comment above #debug-panel.
function _debugShowSession(index) {
  const out = document.getElementById('debug-output');
  if (!out) return;
  const hist = getHistory();
  const w = hist[index];
  if (!w) { out.value = `No session at index ${index} — history has ${hist.length} entries.`; return; }
  out.value = JSON.stringify({
    label: w.label, date: w.date,
    rpe: w.rpe, blockRpe: w.blockRpe, blockSegments: w.blockSegments,
    mc: w.mc, mc_mech: w.mc_mech, mc_aero: w.mc_aero, mc_overhead: w.mc_overhead,
    eRaw: w.eRaw, mechanicalWorkKJ: w.mechanicalWorkKJ, cardioStrainMetMin: w.cardioStrainMetMin
  }, null, 2);
}
function _debugCopy() {
  const out = document.getElementById('debug-output');
  if (!out || !out.value) return;
  out.select();
  try {
    navigator.clipboard.writeText(out.value).then(() => showToast('Copied')).catch(() => {});
  } catch (e) {} // clipboard API may be unavailable — the textarea is still manually selectable/copyable as a fallback
}

function switchTab(idx) {
  currentTab = idx;
  document.getElementById('screen-slider').style.transform = `translateX(-${idx * (100/6)}%)`;
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  document.getElementById('tab-indicator').style.left = (idx * (100/6)) + '%';
  const tabColors = ['#60A5FA','#FF6B35','#22C55E','#A78BFA','#2DD4BF','#F59E0B'];
  document.getElementById('tab-indicator').style.background = tabColors[idx] || tabColors[0];

  // Show builder FAB only on Builder tab AND only when no panel is open
  const fab = document.querySelector('.builder-fab');
  const templateOpen = document.getElementById('template-panel')?.classList.contains('open');
  if (fab) fab.style.display = (idx === 1 && !_openBlockId && !_openMovBlockId && !templateOpen) ? 'flex' : 'none';
  // Hide movement FAB when switching tabs, restore if returning to builder with movement panel open
  document.getElementById('movement-fab')?.classList.remove('visible');
  if (idx === 1 && _openMovBlockId) {
    document.getElementById('movement-fab')?.classList.add('visible');
  }
  if (idx === 0) { renderBenchmarkPRs(); renderCustomMovements(); loadMeasurements(); populateVoiceSelector(); }
  if (idx === 1) { renderBlockList(); }
  if (idx === 2) { updateTimerWodPreview(); }
  if (idx === 3) {
    _lastRenderedDate = new Date().toDateString();
    renderAnalytics();
    renderAnalyticsResults();
    // Ensure the session-signature radar canvas reflects the current theme —
    // renderAnalyticsResults() only redraws it when the Builder has active blocks,
    // so without this it can retain stale colours from a theme switched on another tab.
    if (window._lastRadarRaw) {
      const r = window._lastRadarRaw;
      const backVisible = document.getElementById('radar-flip-back')?.style.display === 'block';
      renderRadarChart(r.pd, r.wd, r.cvIntensity, r.fb, r.internalLoad, r.td);
      if (backVisible) {
        document.getElementById('radar-flip-front').style.display = 'none';
        document.getElementById('radar-flip-back').style.display = 'block';
      }
    }
  }
  else { window._savedAnalyticsRestSec = undefined; }
  if (idx === 4) { renderSessionsScreen(); }
  if (idx === 5) { renderHistory(); setHistView(_histView); }
}

// Swipe gesture
(function() {
  let sx = 0, sy = 0, suppressSwipe = false;
  const wrap = document.getElementById('screen-wrap');
  wrap.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    const thumb = document.getElementById('swipeFinishThumb');
    suppressSwipe = !!(thumb && thumb.contains(e.target));
  }, { passive: true });
  wrap.addEventListener('touchend', e => {
    if (suppressSwipe) { suppressSwipe = false; return; }
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && currentTab < 5) switchTab(currentTab + 1);
      if (dx > 0 && currentTab > 0) switchTab(currentTab - 1);
    }
  }, { passive: true });
})();

/* ════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════ */
function dismissWelcomeCard() {
  localStorage.setItem('wod_welcome_dismissed', '1');
  const wc = document.getElementById('welcome-card');
  if (wc) { wc.style.opacity = '0'; wc.style.transition = 'opacity .3s'; setTimeout(() => wc.remove(), 300); }
}

function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  document.getElementById('theme-btn').innerText = dark ? '☀️ ' + t('btn.light') : '🌙 ' + t('btn.dark');
  localStorage.setItem('wod-theme', dark ? 'dark' : 'light');
  if (currentTab === 3) {
    renderAnalytics();
    // Redraw radar with correct theme colours if physics have been calculated
    if (window._lastRadarRaw) {
      const r = window._lastRadarRaw;
      // Preserve flip state
      const backVisible = document.getElementById('radar-flip-back')?.style.display === 'block';
      renderRadarChart(r.pd, r.wd, r.cvIntensity, r.fb, r.internalLoad, r.td);
      if (backVisible) {
        document.getElementById('radar-flip-front').style.display = 'none';
        document.getElementById('radar-flip-back').style.display = 'block';
      }
    }
  }
  _measUpdateImg();
}

function showConfirm(msg) {
  return new Promise(resolve => {
    // Use native confirm if available and not iOS PWA
    const isIOSPWA = /iphone|ipad/i.test(navigator.userAgent) && window.navigator.standalone;
    if (!isIOSPWA && typeof window.confirm === 'function') {
      try { return resolve(window.confirm(msg)); } catch(e) {}
    }
    // Fallback: custom in-app dialog
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div style="background:var(--surface);border-radius:var(--radius);padding:20px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.4);">
      <div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:16px;">${msg}</div>
      <div style="display:flex;gap:10px;">
        <button id="sc-cancel" class="btn" style="flex:1;"><span data-i18n="btn.cancel">Cancel</span></button>
        <button id="sc-ok" class="btn" style="flex:1;background:var(--error,#EF4444);color:#fff;border-color:transparent;"><span data-i18n="btn.delete">Delete</span></button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#sc-ok').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#sc-cancel').onclick = () => { overlay.remove(); resolve(false); };
  });
}

/* ════════════════════════════════════════════════════
   PWA — Service Worker + Install Banner
════════════════════════════════════════════════════ */

// Service Worker Registration
if ('serviceWorker' in navigator && location.protocol !== 'about:' && location.hostname !== 'null') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('✅ Service Worker registered:', reg.scope);

        // Check for updates every 60 seconds
        setInterval(() => reg.update(), 60000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — tell it to activate immediately
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(err => console.warn('Service Worker registration failed:', err));

    // When new SW takes over — reload to get latest index.html
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  });
}

// Install banner
let dip = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); dip = e;
  setTimeout(() => {
    if (dip && !window.matchMedia('(display-mode: standalone)').matches) {
      const b = document.createElement('div'); b.id = 'install-banner';
      b.innerHTML = '📲 Add to Home Screen';
      b.onclick = () => { dip.prompt(); dip.userChoice.then(() => { dip = null; b.remove(); }); };
      document.body.appendChild(b);
      setTimeout(() => { if (b.parentNode) b.remove(); }, 8000);
    }
  }, 3000);
});

// iOS Safari install prompt — Apple doesn't fire beforeinstallprompt
(function() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const isDismissed = localStorage.getItem('ios_install_dismissed');
  if (!isIOS || isStandalone || isDismissed) return;
  setTimeout(() => {
    const banner = document.createElement('div');
    banner.id = 'ios-install-banner';
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:.82rem;font-weight:800;color:var(--text);margin-bottom:4px;" data-i18n="install.ios.title">Install WOD Architect</div>
          <div style="font-size:.75rem;color:var(--label);line-height:1.5;" data-i18n="install.ios.body">Tap <svg style="display:inline;vertical-align:middle;margin:0 2px;" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v13M7 8l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="13" width="18" height="8" rx="2" stroke="currentColor" stroke-width="2"/></svg> then <strong>Add to Home Screen</strong></div>
        </div>
        <button onclick="localStorage.setItem('ios_install_dismissed','1');document.getElementById('ios-install-banner').remove();"
          style="background:none;border:none;color:var(--label);font-size:1.2rem;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">✕</button>
      </div>
      <div style="position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid var(--glass-bg);"></div>`;
    banner.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      width:calc(100% - 40px);max-width:360px;
      background:var(--glass-bg);border:1px solid var(--glass-border);
      backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      border-radius:14px;padding:14px 16px;z-index:99999;
      box-shadow:0 8px 32px rgba(0,0,0,.4);`;
    document.body.appendChild(banner);
    applyLangToEl(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
  }, 3000);
})();

/* ════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════ */
/* ── Onboarding ── */



window.onload = () => {

  // Restore theme
  const savedTheme = localStorage.getItem('wod-theme');
  if (savedTheme !== 'light') {
    document.body.classList.add('dark');
    document.getElementById('theme-btn').innerText = '☀️ Light';
  }
  document.getElementById('global-h').addEventListener('input', () => { updateProfileStats(); autoSave(); });
  document.getElementById('global-w').addEventListener('input', () => { updateProfileStats(); autoSave(); });
  document.getElementById('global-gender').addEventListener('change', autoSave);
  // Load saved body metrics and profile extras and PRs
  loadBodyMetrics();
  loadProfile();
  loadPRs();
  getHistory().forEach(entry => detectBenchmarkPR(entry));
  renderBenchmarkPRs();
  mergeCustomMovements();
  renderCustomMovements();
  loadMeasurements();
  // Restore box scaling pct values from localStorage
  const _savedScaling = JSON.parse(localStorage.getItem('wod_box_scaling_config') || '{}');
  if (_savedScaling._scaledPct) {
    const scEl = document.getElementById('global-scale-pct-scaled');
    const scVal = document.getElementById('prof-scale-pct-scaled-val');
    if (scEl) scEl.value = _savedScaling._scaledPct;
    if (scVal) scVal.textContent = _savedScaling._scaledPct + '%';
  }
  if (_savedScaling._foundPct) {
    const fdEl = document.getElementById('global-scale-pct-found');
    const fdVal = document.getElementById('prof-scale-pct-found-val');
    if (fdEl) fdEl.value = _savedScaling._foundPct;
    if (fdVal) fdVal.textContent = _savedScaling._foundPct + '%';
  }
  if (_savedScaling._scaledRepPct) {
    const el = document.getElementById('global-scale-rep-scaled');
    const v  = document.getElementById('prof-scale-rep-scaled-val');
    if (el) el.value = _savedScaling._scaledRepPct;
    if (v)  v.textContent = _savedScaling._scaledRepPct + '%';
  }
  if (_savedScaling._foundRepPct) {
    const el = document.getElementById('global-scale-rep-found');
    const v  = document.getElementById('prof-scale-rep-found-val');
    if (el) el.value = _savedScaling._foundRepPct;
    if (v)  v.textContent = _savedScaling._foundRepPct + '%';
  }
  // Restore workout state if available; otherwise start with empty builder
  restoreWorkoutState();
  renderBlockList();
  updateProfileStats();
  refreshProfileDisplays();
  updateGoalRec();
  document.getElementById('tab-indicator').style.left = '0%';
  switchTab(0);
  // Apply saved language
  applyLang();
  // Re-apply rest display after applyLang (which would override data-i18n elements)
  try {
    const savedRest = localStorage.getItem('wod_rest_duration');
    if (savedRest && savedRest !== '0') {
      const disp = document.getElementById('rest-duration-val');
      if (disp) {
        const labels = {'10':'10 sec','20':'20 sec','30':'30 sec','40':'40 sec','50':'50 sec','60':'1 min','75':'1:15 min','90':'1:30 min','105':'1:45 min','120':'2 min','150':'2:30 min','180':'3 min','210':'3:30 min','240':'4 min','270':'4:30 min','300':'5 min','360':'6 min','420':'7 min','480':'8 min','540':'9 min','600':'10 min'};
        disp.textContent = labels[savedRest] || (savedRest + 's');
      }
    }
  } catch(e) {}
  // Restore profile tab
  const savedProfileTab = parseInt(localStorage.getItem('wod_profile_tab') || '0');
  switchProfileTab(savedProfileTab);
  renderProfileHighlights(savedProfileTab);

  // Restore voice enabled state in toggle button
  document.querySelectorAll('#voiceToggleBtn').forEach(btn => btn.classList.toggle('voice-on', voiceEnabled));
  document.querySelectorAll('#voiceToggleLabel').forEach(lbl => {
    lbl.textContent = voiceEnabled ? t('timer.voice.on') : t('timer.voice.off');
  });
  // Restore voice name label on timer screen
  const _savedVoice = localStorage.getItem('wod-voice-name') || '';
  document.querySelectorAll('#voiceSelectLabel').forEach(lbl => {
    lbl.textContent = _savedVoice ? _savedVoice.split(' ')[0] : t('voice.default');
  });
  // Re-render blueprint after applyLang (applyLang would have overwritten it via data-i18n)
  updateBlueprint();
  // Re-render benchmark PRs after language is set
  if (typeof rebuildBenchmarkPRs === 'function') rebuildBenchmarkPRs();
  // Show welcome card on first run
  if (!localStorage.getItem('wod_welcome_dismissed')) {
    const wc = document.getElementById('welcome-card');
    if (wc) wc.style.display = 'block';
  }
  // Render training status card
};

// ── Date/time formatting ──
const _MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const _MONTHS_ES_LONG = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const _DAYS_ES = ['dom','lun','mar','mié','jue','vie','sáb'];

function fmtDate(date, opts) {
  if (_lang !== 'es') {
    try { return date.toLocaleDateString('en-GB', opts); } catch(e) {}
    return date.toLocaleDateString();
  }
  // Manual ES formatting
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  const wd = date.getDay();
  let str = '';
  if (opts.weekday) str += _DAYS_ES[wd] + ' ';
  str += String(d).padStart(2,'0') + ' ';
  str += (opts.month === 'long' ? _MONTHS_ES_LONG[m] : _MONTHS_ES[m]);
  if (opts.year) str += ' ' + y;
  return str;
}
function fmtTime(date, opts) {
  try { return date.toLocaleTimeString(_lang === 'es' ? 'es-ES' : 'en-GB', opts); }
  catch(e) {
    const h = date.getHours(), mn = date.getMinutes();
    return String(h).padStart(2,'0') + ':' + String(mn).padStart(2,'0');
  }
}

/* Silent toast notification */
function showToast(msg, type = 'success') {
  const existing = document.getElementById('wod-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'wod-toast';
  const bg = type === 'error' ? '#EF4444' : type === 'info' ? '#3B82F6' : '#22C55E';
  t.style.cssText = `position:fixed;bottom:calc(var(--tab-h)+16px);left:50%;transform:translateX(-50%);
    background:${bg};color:white;padding:11px 20px;border-radius:30px;font-weight:800;
    font-size:.82rem;z-index:99998;box-shadow:0 4px 20px rgba(0,0,0,.3);
    white-space:nowrap;font-family:inherit;opacity:0;transition:opacity .2s;`;
  t.innerText = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
