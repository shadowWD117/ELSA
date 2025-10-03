// Nama cache
const CACHE_NAME = 'pdf-reader-pwa-v1.0.2';

// File yang akan dicache saat instalasi
const urlsToCache = [
  '/ELSA/',
  '/ELSA/index.html',
  '/ELSA/viewer.html',
  '/ELSA/pdfjs/pdf.js',
  '/ELSA/pdfjs/pdf.worker.js',
  '/ELSA/settings/index.html',
  '/ELSA/profile/index.html',
  '/ELSA/alat/kalkulator/index.html',
  '/ELSA/alat/konversi/kecepatan/index.html',
  '/ELSA/alat/konversi/jarak/index.html',
  '/ELSA/alat/konversi/massa/index.html',
  '/ELSA/alat/konversi/energi/index.html',
  '/ELSA/alat/konversi/gaya/index.html',
  '/ELSA/alat/konversi/tekanan/index.html',
  '/ELSA/offline.html',
];

// Install event → caching awal
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activate event → hapus cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Utility: limit cache size
const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size) {
        cache.delete(keys[0]).then(() => limitCacheSize(name, size));
      }
    });
  });
};

// Fetch event → handle request
self.addEventListener('fetch', event => {
  const request = event.request;

  // Handle PDF khusus
  if (request.url.endsWith('.pdf')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(request).then(response => {
          return response || fetch(request).then(fetchRes => {
            cache.put(request, fetchRes.clone());
            limitCacheSize(CACHE_NAME, 50);
            return fetchRes;
          }).catch(() => caches.match('/ELSA/fallback/offline.html'));
        });
      })
    );
    return;
  }

  // Handle navigasi (halaman)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then(response => {
          if (response) return response;
          // fallback ke index jika request root
          if (request.url.endsWith('/ELSA/') || request.url.endsWith('/')) {
            return caches.match('/ELSA/index.html');
          }
          // fallback global
          return caches.match('/ELSA/offline.html');
        });
      })
    );
    return;
  }

  // Handle asset (CSS, JS, gambar, dll.) → stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cacheRes => {
      return cacheRes || fetch(request).then(fetchRes => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(request, fetchRes.clone());
          limitCacheSize(CACHE_NAME, 50);
          return fetchRes;
        });
      });
    })
  );
});