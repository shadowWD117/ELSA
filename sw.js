const CACHE_NAME = 'pdf-reader-pwa-v1.0.1';
const PDF_CACHE = 'pdf-cache-v1.0';

const urlsToCache = [
  './',
  './index.html',
  './viewer.html',
  './pdfjs/pdf.js',
  './pdfjs/pdf.worker.js',
  './settings/index.html',
  './profile/index.html',
  './alat/kalkulator/index.html',
  './alat/konversi/kecepatan/index.html',
  './alat/konversi/jarak/index.html',
  './alat/konversi/berat/index.html',
  './alat/periodik/index.html',
  './alat/TodoList/index.html',
  './icons/icon-96x96.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './fallback/offline.html'
];

const MAX_CACHE_ITEMS = 50;
const MAX_PDF_ITEMS = 10;

// 🔹 Helper: batasi ukuran cache
async function limitCacheSize(name, maxItems) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    limitCacheSize(name, maxItems);
  }
}

// 🔹 Install service worker → cache awal
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// 🔹 Activate → bersihkan cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== PDF_CACHE)
            .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 🔹 Fetch handler
self.addEventListener('fetch', event => {
  const req = event.request;

  // 🔹 Jika file PDF → cache di PDF_CACHE
  if (req.url.endsWith('.pdf')) {
    event.respondWith(
      caches.open(PDF_CACHE).then(cache => {
        return cache.match(req).then(response => {
          const fetchPromise = fetch(req).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(req, networkResponse.clone());
              limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS);
            }
            return networkResponse;
          }).catch(() => {
            return response || caches.match('./fallback/offline.html');
          });
          return response || fetchPromise;
        });
      })
    );
    return; // stop → jangan lanjut ke handler utama
  }

  // 🔹 Jika request adalah navigasi (misalnya refresh / langsung buka halaman)
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then(cachedPage => {
        if (cachedPage) {
          return cachedPage; // Halaman ada di cache (profile/settings/index dll)
        }
        return fetch(req).catch(() => {
          return caches.match('./fallback/offline.html');
        });
      })
    );
    return;
  }

  // 🔹 Untuk selain PDF & navigasi → cache di CACHE_NAME (stale-while-revalidate)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(req).then(response => {
        const fetchPromise = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(req, networkResponse.clone());
            limitCacheSize(CACHE_NAME, MAX_CACHE_ITEMS);
          }
          return networkResponse;
        }).catch(() => {
          return response || caches.match('./fallback/offline.html');
        });
        return response || fetchPromise;
      });
    })
  );
});