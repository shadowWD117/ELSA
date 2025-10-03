const CACHE_NAME = 'pdf-reader-pwa-v2.4';
const STATIC_CACHE = 'static-v2.4';
const PDF_CACHE = 'pdf-cache-v2.4';
const MAX_STATIC_ITEMS = 50;
const MAX_PDF_ITEMS = 20;

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

// 🔹 Helper: Batasi ukuran cache
async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key)));
      console.log(`📊 Cache ${cacheName} dibatasi: ${keys.length} → ${maxItems}`);
    }
  } catch (error) {
    console.error('Error limiting cache:', error);
  }
}

// 🔹 Install - Cache app shell
self.addEventListener('install', event => {
  console.log('🟢 Service Worker installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('📦 Caching app shell...');
        const cachePromises = urlsToCache.map(url => {
          return cache.add(url).catch(error => {
            console.log(`⚠️ Gagal cache: ${url}`, error);
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
          // Hapus cache lama yang bukan versi current
          if (![STATIC_CACHE, PDF_CACHE].includes(cacheName)) {
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

// 🔹 Fetch - Enhanced strategy
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip external resources dan chrome extensions
  if (request.url.startsWith('chrome-extension://') || 
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Handle PDF requests separately
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(handlePDFRequest(event));
    return;
  }

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  // Handle static assets
  event.respondWith(handleStaticRequest(event));
});

// 🔹 PDF Request Handler
async function handlePDFRequest(event) {
  const request = event.request;
  
  try {
    // Cek di PDF cache dulu
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedPDF = await pdfCache.match(request);
    
    if (cachedPDF) {
      console.log('📄 PDF from cache:', getFileNameFromUrl(request.url));
      return cachedPDF;
    }

    // Jika tidak ada, fetch dari network
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache PDF dengan size limit
      const responseToCache = networkResponse.clone();
      pdfCache.put(request, responseToCache)
        .then(() => {
          console.log('💾 PDF cached:', getFileNameFromUrl(request.url));
          limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS);
        })
        .catch(err => console.log('⚠️ PDF cache failed:', err));
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('❌ PDF fetch failed:', getFileNameFromUrl(request.url));
    
    // Return JSON error untuk consistency
    return new Response(
      JSON.stringify({
        error: 'PDF_UNAVAILABLE_OFFLINE',
        message: 'PDF tidak tersedia offline',
        fileName: getFileNameFromUrl(request.url)
      }),
      {
        status: 503,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );
  }
}

// 🔹 Navigation Request Handler
async function handleNavigationRequest(event) {
  const request = event.request;
  
  try {
    // Network first untuk navigation
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache halaman yang berhasil di-load
      const responseToCache = networkResponse.clone();
      caches.open(STATIC_CACHE)
        .then(cache => {
          cache.put(request, responseToCache);
          limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS);
        });
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('🌐 Navigation failed, using cache');
    
    // Cari di cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback ke offline page
    const offlinePage = await caches.match('./fallback/offline.html');
    if (offlinePage) {
      return offlinePage;
    }
    
    // Last resort
    return new Response(
      '<h1>Offline</h1><p>Aplikasi sedang offline</p>',
      { 
        status: 503,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// 🔹 Static Asset Request Handler
async function handleStaticRequest(event) {
  const request = event.request;
  
  try {
    // Cache first untuk static assets
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const responseToCache = networkResponse.clone();
      caches.open(STATIC_CACHE)
        .then(cache => {
          cache.put(request, responseToCache);
          limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS);
        });
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('❌ Static asset failed:', request.url);
    
    // Untuk CSS/JS, return empty response daripada error
    if (request.url.match(/\.(css|js)$/)) {
      return new Response('', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    return new Response('Resource tidak tersedia', { 
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 🔹 Helper functions
function getFileNameFromUrl(url) {
  try {
    return new URL(url).pathname.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// 🔹 Background Sync (optional enhancement)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('🔄 Background sync triggered');
    // Bisa digunakan untuk sync data ketika online kembali
  }
});

// 🔹 Periodic cleanup (optional)
async function periodicCleanup() {
  try {
    await limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS);
    await limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS);
    console.log('🧹 Periodic cleanup completed');
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Jalankan cleanup setiap 24 jam
setInterval(periodicCleanup, 24 * 60 * 60 * 1000);