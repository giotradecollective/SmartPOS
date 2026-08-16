// GIOTRADE SmartPOS — offline app-shell cache.
//
// Scope: this only caches the STATIC shell (this HTML page, its fonts and the
// Chart.js/Supabase-js CDN scripts) so a reload works without a live connection.
// It deliberately does NOT touch anything on *.supabase.co — those requests need
// to fail fast and for real when the network is down, because the app's own
// offline-sale queue (see OFFLINE SUPPORT in the main page's <script>) relies on
// seeing a genuine network failure to know when to queue a sale locally.
//
// Bump CACHE_NAME whenever the shell's own markup/CSS/JS changes materially, so
// returning devices don't keep serving a stale shell forever.
const CACHE_NAME = 'giotrade-pos-shell-v1';

// Root-relative — matches how favicon/icons are already referenced in the page.
// If this file ever moves off the site root, or the page itself isn't served at
// '/', update these paths (and the registration call in the page) to match.
const APP_SHELL = [
  './',
];

const RUNTIME_CACHE_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'api.fontshare.com',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {
      // A cross-origin/opaque response in APP_SHELL can make addAll() reject
      // entirely — never let that block install; the runtime cache below still
      // fills in as those assets are actually requested.
    }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  // Supabase (auth + every table read/write) always goes straight to the network,
  // untouched — see the header comment above.
  if (url.hostname.endsWith('supabase.co')) return;

  // The page itself: network-first, so a fresh deploy is picked up immediately
  // whenever there's a connection, falling back to the last cached copy offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // CDN scripts/fonts/icons: cache-first — these URLs are effectively immutable
  // (versioned or long-lived), so there's no need to hit the network every time.
  if (RUNTIME_CACHE_HOSTS.includes(url.hostname) || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);
      })
    );
  }
});
