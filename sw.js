// WOD Architect — Service Worker v12
// Strategy:
//   index.html + manifest.json → Network first, fall back to cache (always get latest)
//   CDN libraries + icons     → Cache first (never change)
//   Supabase + Google APIs    → Network only (never cache)

const CACHE = 'wod-architect-v12';
const CACHE_STATIC = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-foreground.png',
];

// On install — cache only static assets, NOT index.html
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CACHE_STATIC))
  );
  self.skipWaiting();
});

// On activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Never cache: Supabase, Google APIs ──
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('script.google.com') ||
      url.hostname.includes('docs.google.com') ||
      url.hostname.includes('sheets.googleapis.com') ||
      url.hostname.includes('anthropic.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  // ── CDN libraries — cache first, never expire ──
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r && r.status === 200) {
            const cl = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, cl));
          }
          return r;
        });
      })
    );
    return;
  }

  // ── index.html — network first, fall back to cache ──
  // This ensures users always get the latest version when online
  if (e.request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.status === 200) {
          const cl = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, cl));
        }
        return r;
      }).catch(() => {
        // Offline — serve cached version
        return caches.match('./index.html') || caches.match(e.request);
      })
    );
    return;
  }

  // ── Icons and manifest — cache first ──
  if (url.pathname.includes('/icons/') ||
      url.pathname.endsWith('manifest.json') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r && r.status === 200) {
            const cl = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, cl));
          }
          return r;
        });
      })
    );
    return;
  }

  // ── Everything else — network first ──
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Handle skip waiting message from client
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
