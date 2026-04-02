/**
 * RiskPerTrade — Service Worker
 * Versi: 1.0.0
 * Fungsi: Cache aset statis, enable offline mode, push notification
 */

const CACHE_NAME = 'riskpertrade-v1';
const CACHE_VERSION = '1.0.0';

// Aset yang di-cache saat install (App Shell)
const APP_SHELL = [
  '/',
  '/index.html',
];

// CDN yang boleh di-cache saat diakses (runtime cache)
const CDN_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

// Firebase tidak di-cache (selalu fresh dari network)
const NETWORK_ONLY = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'tradelog-regy.firebaseapp.com',
];

// ── Install: cache app shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing RiskPerTrade SW v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // Aktifkan langsung tanpa reload
  );
});

// ── Activate: hapus cache lama ────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating RiskPerTrade SW v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // Kontrol semua tab yang terbuka
  );
});

// ── Fetch: strategi cache ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Network-only untuk Firebase (data selalu fresh)
  if (NETWORK_ONLY.some((pattern) => url.hostname.includes(pattern))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Cache-first untuk CDN (font, icon, library)
  if (CDN_PATTERNS.some((pattern) => url.hostname.includes(pattern))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached); // Jika offline, kembalikan cache
      })
    );
    return;
  }

  // 3. Network-first untuk halaman utama (selalu coba network, fallback ke cache)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: tampilkan halaman dari cache
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // 4. Stale-while-revalidate untuk aset lain (CSS, JS, gambar)
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);

        // Kembalikan cache langsung, update di background
        return cached || networkFetch;
      })
    );
    return;
  }
});

// ── Push Notification: Daily Reminder ────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'RiskPerTrade', body: 'Jangan lupa catat trade hari ini! 📊' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/', timestamp: Date.now() },
    actions: [
      { action: 'open', title: '📝 Buka Journal' },
      { action: 'dismiss', title: '✕ Tutup' }
    ],
    tag: 'riskpertrade-reminder',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'RiskPerTrade', options)
  );
});

// ── Notification Click ────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Jika tab sudah terbuka, fokus ke sana
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
          return;
        }
      }
      // Jika belum terbuka, buka tab baru
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Background Sync: sinkron trade saat kembali online ───────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-trades') {
    console.log('[SW] Background sync: sync-trades');
    // Firebase akan otomatis sync saat online karena pakai Firestore offline persistence
    // Event ini sebagai sinyal tambahan saja
    event.waitUntil(Promise.resolve());
  }
});

// ── Message Handler: komunikasi dari halaman ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
  
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
