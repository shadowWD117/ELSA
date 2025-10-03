const CACHE_NAME = 'pdf-reader-pwa-v2.2';
const PDF_CACHE = 'pdf-cache-v2.2';

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
    Promise.all([
      caches.open(CACHE_NAME)
        .then(cache => {
          console.log('📦 Caching app shell...');
          const cachePromises = urlsToCache.map(url => {
            return cache.add(url).catch(error => {
              console.log(`⚠️ Gagal cache: ${url}`, error);
              return Promise.resolve();
            });
          });
          return Promise.all(cachePromises);
        }),
      caches.open(PDF_CACHE)
        .then(cache => {
          console.log('📚 PDF Cache ready');
          return cache.keys().then(keys => {
            console.log(`📊 PDFs in cache: ${keys.length}`);
          });
        })
    ])
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
          if (cacheName !== CACHE_NAME && cacheName !== PDF_CACHE) {
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

// 🔹 Fetch - Enhanced PDF handling
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension requests
  if (request.url.startsWith('chrome-extension://')) return;

  // Handle PDF requests specifically
  if (request.url.endsWith('.pdf')) {
    event.respondWith(handlePDFRequest(event));
    return;
  }

  // Default cache-first strategy untuk lainnya
  event.respondWith(handleDefaultRequest(event));
});

// 🔹 PDF Request Handler
async function handlePDFRequest(event) {
  const request = event.request;
  
  try {
    // Cek di PDF cache dulu
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedPDF = await pdfCache.match(request);
    
    if (cachedPDF) {
      console.log('📄 PDF served from cache:', request.url);
      return cachedPDF;
    }

    // Cek di IndexedDB (untuk PDF yang didownload user)
    const pdfBlob = await getPDFFromIndexedDB(getFileNameFromURL(request.url));
    if (pdfBlob) {
      console.log('💾 PDF served from IndexedDB:', request.url);
      return new Response(pdfBlob, {
        headers: { 'Content-Type': 'application/pdf' }
      });
    }

    // Jika tidak ada di cache/IndexedDB, fetch dari network
    console.log('🌐 Fetching PDF from network:', request.url);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache PDF untuk penggunaan offline (optional - bisa dihapus jika tidak ingin auto-cache)
      const responseToCache = networkResponse.clone();
      pdfCache.put(request, responseToCache)
        .then(() => console.log('💾 PDF cached:', request.url))
        .catch(err => console.log('⚠️ Failed to cache PDF:', err));
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('❌ PDF fetch failed:', request.url, error);
    
    // Beri feedback yang lebih informative
    return new Response(
      JSON.stringify({
        error: 'PDF_NOT_AVAILABLE_OFFLINE',
        message: 'PDF belum diunduh untuk akses offline',
        fileName: getFileNameFromURL(request.url)
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// 🔹 Default Request Handler
async function handleDefaultRequest(event) {
  const request = event.request;
  
  try {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      console.log('📦 Serving from cache:', request.url);
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok && !request.url.endsWith('.pdf')) {
      const responseToCache = networkResponse.clone();
      caches.open(CACHE_NAME)
        .then(cache => cache.put(request, responseToCache))
        .catch(err => console.log('⚠️ Cache failed:', err));
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('❌ Network failed:', request.url, error);
    
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('./fallback/offline.html');
      if (offlinePage) return offlinePage;
      return caches.match('./index.html');
    }
    
    return new Response('Resource tidak tersedia offline', { 
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 🔹 Helper functions
function getFileNameFromURL(url) {
  return url.split('/').pop().split('?')[0];
}

// 🔹 Communication dengan client pages
self.addEventListener('message', async (event) => {
  if (event.data.type === 'CACHE_PDF') {
    const { url, blob } = event.data;
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      await pdfCache.put(url, new Response(blob));
      console.log('✅ PDF manually cached:', url);
      
      // Kirim response kembali ke client
      event.ports[0].postMessage({ success: true });
    } catch (error) {
      console.error('❌ Failed to cache PDF:', error);
      event.ports[0].postMessage({ success: false, error: error.message });
    }
  }
  
  if (event.data.type === 'GET_CACHED_PDFS') {
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      const keys = await pdfCache.keys();
      const pdfList = keys.map(key => key.url);
      event.ports[0].postMessage({ pdfs: pdfList });
    } catch (error) {
      event.ports[0].postMessage({ pdfs: [], error: error.message });
    }
  }
});

// 🔹 IndexedDB helper untuk service worker
async function getPDFFromIndexedDB(fileName) {
  // Service worker tidak bisa akses IndexedDB langsung,
  // jadi kita perlu komunikasi dengan client page
  return null;
}