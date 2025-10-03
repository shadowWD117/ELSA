const CACHE_NAME = 'pdf-reader-pwa-v1.0.2';
const PDF_CACHE = 'pdf-cache-v1.1';

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

const MAX_CACHE_ITEMS = 10; // Sementara 10 item
const MAX_PDF_ITEMS = 10;   // Sementara 10 item

// 🔹 Helper: batasi ukuran cache dengan loop (TANPA REKURSI)
async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      // Hapus item terlama (yang pertama di cache)
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key)));
      console.log(`Cache ${cacheName} dibatasi: ${keys.length} -> ${maxItems}`);
    }
  } catch (error) {
    console.error('Error limiting cache size:', error);
  }
}

// 🔹 Strategy: Cache First dengan Background Update
async function handleCacheFirst(event, cacheName, maxItems, fallbackUrl = './fallback/offline.html') {
  // Hanya handle GET requests
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(event.request);
    
    // Selalu coba fetch update di background jika ada cache
    const fetchPromise = fetch(event.request)
      .then(async networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          await cache.put(event.request, networkResponse.clone());
          await limitCacheSize(cacheName, maxItems);
        }
        return networkResponse;
      })
      .catch(error => {
        console.log('Fetch failed, using cache:', error);
        // Return cached response jika fetch gagal
        return cachedResponse;
      });

    // Jika ada cache, return cache dan update di background
    if (cachedResponse) {
      event.waitUntil(fetchPromise);
      return cachedResponse;
    }
    
    // Jika tidak ada cache, tunggu fetch
    return fetchPromise;
  } catch (error) {
    console.error('Cache first strategy error:', error);
    return caches.match(fallbackUrl);
  }
}

// 🔹 Strategy: Network First dengan Cache Fallback
async function handleNetworkFirst(event, cacheName, maxItems, fallbackUrl = './fallback/offline.html') {
  // Hanya handle GET requests
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    const networkResponse = await fetch(event.request);
    
    // Cache response yang successful
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, networkResponse.clone());
      await limitCacheSize(cacheName, maxItems);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache:', error);
    
    // Coba dari cache
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback ke offline page
    return caches.match(fallbackUrl);
  }
}

// 🔹 Install service worker → cache awal
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => {
        console.log('Initial cache completed');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Cache installation failed:', error);
      })
  );
});

// 🔹 Activate → bersihkan cache lama
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(key => 
        key !== CACHE_NAME && key !== PDF_CACHE
      );
      
      console.log('Deleting old caches:', oldCaches);
      return Promise.all(
        oldCaches.map(key => caches.delete(key))
      );
    })
    .then(() => {
      console.log('Service Worker ready to handle requests');
      return self.clients.claim();
    })
  );
});

// 🔹 Fetch handler
self.addEventListener('fetch', event => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 🔹 Handle PDF files dengan Cache First
  if (request.url.endsWith('.pdf')) {
    event.respondWith(
      handleCacheFirst(event, PDF_CACHE, MAX_PDF_ITEMS, './fallback/offline.html')
    );
    return;
  }

  // 🔹 Handle navigation requests dengan Network First
  if (request.mode === 'navigate') {
    event.respondWith(
      handleNetworkFirst(event, CACHE_NAME, MAX_CACHE_ITEMS, './fallback/offline.html')
    );
    return;
  }

  // 🔹 Untuk static assets lainnya dengan Cache First
  event.respondWith(
    handleCacheFirst(event, CACHE_NAME, MAX_CACHE_ITEMS, './fallback/offline.html')
  );
});