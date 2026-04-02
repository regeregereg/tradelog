// ── RiskPerTrade Service Worker ──
// Versi ini: cache-first untuk CDN assets, network-first untuk app shell
const CACHE_NAME = 'rpt-v1';
const CDN_CACHE = 'rpt-cdn-v1';

// Asset CDN yang di-cache permanen (versioned, tidak berubah)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
];

// Install: pre-cache CDN assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CDN_CACHE).then(cache => {
      // Cache CDN assets di background - tidak block install
      return Promise.allSettled(
        CDN_ASSETS.map(url =>
          fetch(url, { mode: 'cors' })
            .then(res => { if (res.ok) cache.put(url, res); })
            .catch(() => {}) // Gagal silent - tidak kritis
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: bersihkan cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: strategi berdasarkan tipe request
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // === CDN assets: Cache-First (tidak pernah berubah) ===
  if (
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CDN_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // === Google Fonts CSS: Cache-First ===
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CDN_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // === Firebase: Network-Only (data selalu fresh) ===
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // Biarkan browser handle langsung
  }

  // === App shell (index.html): Network-First dengan fallback ===
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
