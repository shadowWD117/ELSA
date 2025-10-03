const CACHE_NAME = 'pdf-reader-pwa-v1.0.2';
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
  './fallback/offline.html'  // Pastikan ini ada
];

const MAX_CACHE_ITEMS = 10;
const MAX_PDF_ITEMS = 10;

// 🔹 Helper: batasi ukuran cache
async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key)));
      console.log(`Cache ${cacheName} dibatasi: ${keys.length} -> ${maxItems}`);
    }
  } catch (error) {
    console.error('Error limiting cache size:', error);
  }
}

// 🔹 Strategy: Stale-While-Revalidate (untuk PDF & static assets)
async function handleStaleWhileRevalidate(event, cacheName, maxItems) {
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(event.request);
    
    // Fetch dari network untuk update cache (di background)
    const fetchPromise = fetch(event.request)
      .then(async networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          await cache.put(event.request, networkResponse.clone());
          await limitCacheSize(cacheName, maxItems);
        }
        return networkResponse;
      })
      .catch(error => {
        console.log('Fetch failed, using cache if available:', error);
        return cachedResponse; // Kembalikan cache jika fetch gagal
      });

    // Jika ada cache, return cache dan update di background
    if (cachedResponse) {
      event.waitUntil(fetchPromise);
      return cachedResponse;
    }
    
    // Jika tidak ada cache, tunggu fetch
    return fetchPromise;
    
  } catch (error) {
    console.error('Stale-while-revalidate error:', error);
    // Fallback ke offline page
    const fallback = await caches.match('./fallback/offline.html');
    return fallback || new Response('Offline', { status: 503 });
  }
}

// 🔹 Strategy: Network First dengan Cache Fallback (untuk navigation)
async function handleNetworkFirst(event, cacheName, maxItems) {
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    // Coba fetch dari network dulu
    const networkResponse = await fetch(event.request);
    
    // Jika sukses, cache dan return
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, networkResponse.clone());
      await limitCacheSize(cacheName, maxItems);
      return networkResponse;
    }
    throw new Error('Network response not OK');
    
  } catch (error) {
    console.log('Network failed, trying cache:', error);
    
    // Coba dari cache dengan matching yang flexible
    const cachedResponse = await caches.match(event.request, {
      ignoreSearch: true
    });
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Coba match halaman utama
    const mainPage = await caches.match('./index.html');
    if (mainPage) {
      return mainPage;
    }
    
    // Fallback ke offline page
    const fallback = await caches.match('./fallback/offline.html');
    if (fallback) {
      return fallback;
    }
    
    // Last resort
    return new Response('Offline - No cache available', { 
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 🔹 Strategy: Cache Only untuk fallback offline
async function handleCacheOnly(event, fallbackUrl) {
  const cachedResponse = await caches.match(event.request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  const fallback = await caches.match(fallbackUrl);
  if (fallback) {
    return fallback;
  }
  
  return new Response('Offline', { status: 503 });
}

// 🔹 Install Service Worker - PASTIKAN SEMUA FILE TER-CACHE
self.addEventListener('install', event => {
  console.log('🟢 Service Worker installing:', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching initial resources...');
        // Cache semua URL penting termasuk fallback
        return cache.addAll(urlsToCache)
          .then(() => {
            console.log('All initial resources cached successfully');
            // Pastikan fallback offline.html benar-benar ter-cache
            return cache.match('./fallback/offline.html');
          })
          .then(fallbackCached => {
            if (!fallbackCached) {
              console.warn('Fallback page not cached, trying to cache separately');
              return cache.add('./fallback/offline.html');
            }
            return true;
          });
      })
      .then(() => {
        console.log('🟢 Installation complete, skipping waiting');
        // Langsung aktifkan tanpa menunggu
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ Cache installation failed:', error);
        // Even if caching fails, continue installation
        return self.skipWaiting();
      })
  );
});

// 🔹 Activate Service Worker
self.addEventListener('activate', event => {
  console.log('🟢 Service Worker activating:', CACHE_NAME);
  
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(key => 
        key !== CACHE_NAME && key !== PDF_CACHE
      );
      
      console.log('Cleaning old caches:', oldCaches);
      return Promise.all(
        oldCaches.map(key => caches.delete(key))
      );
    })
    .then(() => {
      console.log('🟢 Activation complete, claiming clients');
      // Langsung ambil kendali semua tab
      return self.clients.claim();
    })
  );
});

// 🔹 Fetch Handler - DENGAN OFFLINE SUPPORT LENGKAP
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 🔹 Handle PDF files - Cache First dengan background update
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(
      handleStaleWhileRevalidate(event, PDF_CACHE, MAX_PDF_ITEMS)
    );
    return;
  }

  // 🔹 Handle navigation requests (browser refresh, direct URL access)
  if (request.mode === 'navigate') {
    event.respondWith(
      handleNetworkFirst(event, CACHE_NAME, MAX_CACHE_ITEMS)
    );
    return;
  }

  // 🔹 Untuk static assets (CSS, JS, images) - Cache First
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
    event.respondWith(
      handleStaleWhileRevalidate(event, CACHE_NAME, MAX_CACHE_ITEMS)
    );
    return;
  }

  // 🔹 Default strategy untuk request lainnya
  event.respondWith(
    handleStaleWhileRevalidate(event, CACHE_NAME, MAX_CACHE_ITEMS)
  );
});

// 🔹 Handle messages dari main thread
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});