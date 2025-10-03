const CACHE_NAME = 'pdf-reader-pwa-v1.0.3'; // ⬅️ UBAH VERSI SETIAP UPDATE
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

// 🔹 Strategy: Cache First dengan Background Update
async function handleCacheFirst(event, cacheName, maxItems, fallbackUrl = './fallback/offline.html') {
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(event.request);
    
    // Background update untuk cache yang ada
    if (cachedResponse) {
      event.waitUntil(
        fetch(event.request)
          .then(async networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              await cache.put(event.request, networkResponse.clone());
              await limitCacheSize(cacheName, maxItems);
            }
          })
          .catch(() => console.log('Background update failed'))
      );
      return cachedResponse;
    }
    
    // Jika tidak ada cache, fetch dari network
    const networkResponse = await fetch(event.request);
    if (networkResponse && networkResponse.status === 200) {
      await cache.put(event.request, networkResponse.clone());
      await limitCacheSize(cacheName, maxItems);
    }
    return networkResponse;
    
  } catch (error) {
    console.log('Cache first failed, trying fallback:', error);
    const fallback = await caches.match(fallbackUrl);
    return fallback || new Response('Offline', { status: 503 });
  }
}

// 🔹 Strategy: Network First untuk Navigation
async function handleNavigationRequest(event, cacheName, maxItems) {
  if (event.request.method !== 'GET') {
    return fetch(event.request);
  }

  try {
    // Timeout untuk network request (8 detik)
    const networkPromise = fetch(event.request);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 8000)
    );
    
    const networkResponse = await Promise.race([networkPromise, timeoutPromise]);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, networkResponse.clone());
      await limitCacheSize(cacheName, maxItems);
      return networkResponse;
    }
    throw new Error('Network response not OK');
    
  } catch (error) {
    console.log('Navigation network failed, using cache:', error);
    
    // Cari di cache dengan matching yang flexible
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(event.request, {
      ignoreSearch: true, // Abaikan query parameters
      ignoreMethod: true
    });
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Coba match halaman lain yang mungkin relevan
    const allCaches = await caches.keys();
    for (const cacheName of allCaches) {
      const cacheStorage = await caches.open(cacheName);
      const response = await cacheStorage.match('./index.html');
      if (response) return response;
    }
    
    // Fallback ke offline page
    const fallback = await caches.match('./fallback/offline.html');
    return fallback || new Response('Offline', { 
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// 🔹 Install Service Worker
self.addEventListener('install', event => {
  console.log('🟢 Service Worker installing:', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Pastikan fallback page di-cache pertama
        return cache.add('./fallback/offline.html')
          .then(() => {
            console.log('Fallback page cached');
            return cache.addAll(
              urlsToCache.filter(url => url !== './fallback/offline.html')
            );
          });
      })
      .then(() => {
        console.log('All resources cached');
        // ⚡ LANGSUNG AKTIFKAN TANPA TUNGGU
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Cache installation failed:', error);
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
      
      console.log('Deleting old caches:', oldCaches);
      return Promise.all(
        oldCaches.map(key => caches.delete(key))
      );
    })
    .then(() => {
      console.log('🟢 Service Worker ready, claiming clients');
      // ⚡ LANGSUNG AMBIL KENDALI SEMUA TAB
      return self.clients.claim();
    })
  );
});

// 🔹 Fetch Handler
self.addEventListener('fetch', event => {
  const request = event.request;

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 🔹 Handle PDF files - Cache First
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(
      handleCacheFirst(event, PDF_CACHE, MAX_PDF_ITEMS)
    );
    return;
  }

  // 🔹 Handle navigation requests - Network First
  if (request.mode === 'navigate') {
    event.respondWith(
      handleNavigationRequest(event, CACHE_NAME, MAX_CACHE_ITEMS)
    );
    return;
  }

  // 🔹 Untuk static assets - Cache First
  event.respondWith(
    handleCacheFirst(event, CACHE_NAME, MAX_CACHE_ITEMS)
  );
});

// 🔹 Pesan untuk debugging
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});