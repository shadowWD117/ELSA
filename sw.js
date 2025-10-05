/* ============================
   ELSA PWA Service Worker v3.1
   Sinkron dengan manifest + update flow (SKIP_WAITING)
   ============================ */

const APP_VERSION = 'v3.0';
const CACHE_NAME = `pdf-reader-pwa-${APP_VERSION}`;
const STATIC_CACHE = `static-${APP_VERSION}`;
const PDF_CACHE = `pdf-cache-${APP_VERSION}`;
const MAX_STATIC_ITEMS = 50;
const MAX_PDF_ITEMS = 20;

const urlsToCache = [
  './',
  './index.html',
  './viewer.html',
  './manifest.json',
  './sw.js',
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

// Helper: batasi ukuran cache
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

// INSTALL: cache app shell
self.addEventListener('install', event => {
  console.log(`🟢 [SW ${APP_VERSION}] install - caching app shell...`);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        const promises = urlsToCache.map(url =>
          cache.add(url).catch(err => {
            console.warn(`⚠️ gagal cache ${url}`, err);
            return Promise.resolve();
          })
        );
        return Promise.all(promises);
      })
      .then(() => {
        // NOTE: *tidak* memanggil skipWaiting() otomatis.
        // Kita ingin worker baru menunggu sampai user memilih update.
        console.log('✅ resources cached for app shell');
      })
      .catch(err => {
        console.error('❌ cache install failed:', err);
      })
  );
});

// ACTIVATE: clean old caches & notify clients that a new SW has taken control
self.addEventListener('activate', event => {
  console.log(`🟢 [SW ${APP_VERSION}] activating...`);
  event.waitUntil(
    (async () => {
      // Hapus cache lama
      const names = await caches.keys();
      await Promise.all(names.map(name => {
        if (![STATIC_CACHE, PDF_CACHE].includes(name)) {
          console.log('🗑️ deleting old cache:', name);
          return caches.delete(name);
        }
      }));

      // Klaim klien agar SW baru mulai mengontrol page setelah activation
      await self.clients.claim();

      // Inform all clients that a new version is active now
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) {
        client.postMessage({ type: 'VERSION_ACTIVATED', version: APP_VERSION });
      }

      console.log('🎯 activated & clients claimed');
    })()
  );
});

// FETCH: Enhanced strategy (sama fungsi seperti sebelumnya)
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Abaikan non-GET & external resources
  if (request.method !== 'GET') return;
  if (request.url.startsWith('chrome-extension://') ||
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Tangani file PDF
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(handlePDFRequest(event));
    return;
  }

  // Navigasi (halaman)
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  // Static asset
  event.respondWith(handleStaticRequest(event));
});

// Handle PDF
async function handlePDFRequest(event) {
  const request = event.request;
  try {
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedPDF = await pdfCache.match(request);
    if (cachedPDF) {
      console.log('📄 PDF from cache:', getFileNameFromUrl(request.url));
      return cachedPDF;
    }
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      pdfCache.put(request, clone).then(() => limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS))
        .catch(e => console.warn('⚠️ pdf cache put failed', e));
    }
    return networkResponse;
  } catch (error) {
    console.warn('❌ pdf fetch error:', getFileNameFromUrl(request.url), error);
    return new Response(JSON.stringify({
      error: 'PDF_UNAVAILABLE_OFFLINE',
      message: 'PDF tidak tersedia offline',
      fileName: getFileNameFromUrl(request.url)
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle navigation (network-first, fallback to cache -> offline page)
async function handleNavigationRequest(event) {
  const request = event.request;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(STATIC_CACHE).then(cache => {
        cache.put(request, clone).then(() => limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS));
      });
    }
    return networkResponse;
  } catch (err) {
    console.log('🌐 navigation failed, fallback to cache/offline', err);
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('./fallback/offline.html');
    if (offline) return offline;
    return new Response('<h1>Offline</h1><p>Aplikasi sedang offline</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Handle static assets (cache-first)
async function handleStaticRequest(event) {
  const request = event.request;
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(STATIC_CACHE).then(cache => {
        cache.put(request, clone).then(() => limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS));
      });
    }
    return networkResponse;
  } catch (err) {
    console.warn('❌ static fetch failed for', request.url, err);
    if (request.url.match(/\.(css|js)$/)) {
      return new Response('', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Resource tidak tersedia', { status: 503 });
  }
}

// Helper
function getFileNameFromUrl(url) {
  try {
    return new URL(url).pathname.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Messaging: dengarkan perintah dari client
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') {
    console.log('🔔 Received SKIP_WAITING message — calling skipWaiting()');
    self.skipWaiting();
    return;
  }

  // Tambahkan handler pesan lain jika diperlukan di masa depan
});

// Background sync hook (opsional)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('🔄 background sync triggered');
    // implement sync tasks jika diperlukan
  }
});

// Periodic cleanup
async function periodicCleanup() {
  try {
    await limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS);
    await limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS);
    console.log('🧹 periodic cleanup done');
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}
setInterval(periodicCleanup, 24 * 60 * 60 * 1000);