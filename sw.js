const CACHE_NAME = 'pdf-reader-pwa-v2.1';
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

// 🔹 Install - Cache semua resources
self.addEventListener('install', event => {
  console.log('🟢 Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching app shell...');
        // Gunakan cache.add() untuk setiap URL untuk menghindari kegagalan total
        const cachePromises = urlsToCache.map(url => {
          return cache.add(url).catch(error => {
            console.log(`⚠️ Gagal cache: ${url}`, error);
            // Lanjutkan meski ada yang gagal
            return Promise.resolve();
          });
        });
        
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log('✅ Cache installation completed');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ Cache installation failed:', error);
        return self.skipWaiting();
      })
  );
});

// 🔹 Activate - Clean old caches
self.addEventListener('activate', event => {
  console.log('🟢 Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('🎯 Claiming clients...');
      return self.clients.claim();
    })
  );
});

// 🔹 Fetch - Simple cache-first strategy
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension requests
  if (request.url.startsWith('chrome-extension://')) return;
  
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        // Jika ada di cache, return cached response
        if (cachedResponse) {
          console.log('📦 Serving from cache:', request.url);
          return cachedResponse;
        }
        
        // Jika tidak ada di cache, fetch dari network
        return fetch(request)
          .then(networkResponse => {
            // Cache response yang successful untuk future use
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, responseToCache)
                    .then(() => {
                      console.log('💾 Cached new resource:', request.url);
                    })
                    .catch(cacheError => {
                      console.log('⚠️ Failed to cache:', request.url, cacheError);
                    });
                });
            }
            return networkResponse;
          })
          .catch(error => {
            console.log('❌ Network failed:', request.url, error);
            
            // Untuk navigation requests, tampilkan offline page
            if (request.mode === 'navigate') {
              return caches.match('./fallback/offline.html')
                .then(offlinePage => {
                  if (offlinePage) {
                    return offlinePage;
                  }
                  // Fallback ke index.html
                  return caches.match('./index.html');
                });
            }
            
            // Untuk PDF requests
            if (request.url.endsWith('.pdf')) {
              return new Response('PDF tidak tersedia offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
              });
            }
            
            return new Response('Resource tidak tersedia offline', { 
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});