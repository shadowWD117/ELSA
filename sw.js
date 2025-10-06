/* ============================
   ELSA PWA Service Worker v3.1 - RELATIVE PATHS
   ============================ */

const APP_VERSION = 'v3.1-debug';
const CACHE_NAME = `elsa-pwa-${APP_VERSION}`;
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

// ======== ✅ INTEGRITY CHECKER ========
class StartupIntegrityChecker {
    constructor() {
        this.checked = false;
        this.cacheConfig = {
            static: STATIC_CACHE,
            pdf: PDF_CACHE
        };
    }
    
    async checkAllCachedAssets() {
        console.log('🎯 CHECKER: Starting checkAllCachedAssets...');
        console.log('🎯 CHECKER: Online status:', navigator.onLine);
        console.log('🎯 CHECKER: Already checked:', this.checked);
        
        if (this.checked || !navigator.onLine) {
            console.log('⏩ CHECKER: Skip - already checked or offline');
            return [];
        }
        
        this.checked = true;
        console.log('🔍 CHECKER: Running startup integrity check...');
        
        const allChanges = [];
        
        try {
            console.log('🔍 CHECKER: Checking static cache...');
            const staticChanges = await this.checkCache(this.cacheConfig.static);
            allChanges.push(...staticChanges);
            
            console.log('🔍 CHECKER: Checking PDF cache...');
            const pdfChanges = await this.checkCache(this.cacheConfig.pdf);
            allChanges.push(...pdfChanges);
            
            console.log('📊 CHECKER: Total changes found:', allChanges.length);
            
            if (allChanges.length > 0) {
                console.log('🔄 CHECKER: Changes detected:', allChanges);
                this.notifyUpdates(allChanges);
            } else {
                console.log('✅ CHECKER: No changes detected');
            }
            
        } catch (error) {
            console.error('❌ CHECKER: Error during check:', error);
        }
        
        return allChanges;
    }
    
    async checkCache(cacheName) {
        console.log(`🔍 CHECKER: Checking cache: ${cacheName}`);
        const changes = [];
        
        try {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            console.log(`🔍 CHECKER: Found ${requests.length} items in ${cacheName}`);
            
            for (const request of requests) {
                console.log(`🔍 CHECKER: Processing: ${request.url}`);
                const isChanged = await this.isAssetChanged(request.url);
                if (isChanged) {
                    console.log(`🔄 CHECKER: Change detected: ${request.url}`);
                    changes.push(request.url);
                }
            }
        } catch (error) {
            console.error(`❌ CHECKER: Error checking cache ${cacheName}:`, error);
        }
        
        console.log(`📊 CHECKER: ${cacheName} changes:`, changes.length);
        return changes;
    }
    
    async isAssetChanged(url) {
        try {
            console.log(`🔍 CHECKER: Checking asset: ${url}`);
            
            // Skip external URLs
            if (!url.startsWith(self.location.origin)) {
                console.log(`➡️ CHECKER: Skip external: ${url}`);
                return false;
            }
            
            console.log(`🌐 CHECKER: Fetching from network: ${url}`);
            
            // Force network request - bypass semua cache
            const networkResponse = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            
            if (!networkResponse.ok) {
                console.log(`❌ CHECKER: Network failed for ${url} - Status: ${networkResponse.status}`);
                return false;
            }
            
            const networkContent = await networkResponse.text();
            console.log(`📄 CHECKER: Network content length: ${networkContent.length}`);
            
            const cachedResponse = await caches.match(url);
            
            if (!cachedResponse) {
                console.log(`📝 CHECKER: No cache for ${url} - first time`);
                return true; // Consider as changed to cache it
            }
            
            const cachedContent = await cachedResponse.text();
            console.log(`📄 CHECKER: Cached content length: ${cachedContent.length}`);
            
            // Compare content
            const changed = networkContent !== cachedContent;
            
            console.log(`📊 CHECKER: ${url}: changed=${changed}`);
            
            if (changed) {
                console.log('🔄 CHECKER: Content changed - updating cache');
                // Update cache dengan versi baru
                const cache = await caches.open(STATIC_CACHE);
                await cache.put(url, networkResponse.clone());
                console.log('✅ CHECKER: Cache updated');
            }
            
            return changed;
            
        } catch (error) {
            console.error(`💥 CHECKER: Error checking ${url}:`, error);
            return false;
        }
    }
    
    notifyUpdates(changedAssets) {
        console.log('📢 CHECKER: notifyUpdates called with:', changedAssets);
        
        self.clients.matchAll().then(clients => {
            console.log(`📢 CHECKER: Found ${clients.length} clients`);
            
            if (clients.length === 0) {
                console.log('❌ CHECKER: No clients found to notify');
                return;
            }
            
            clients.forEach(client => {
                console.log(`📢 CHECKER: Sending to client: ${client.url}`);
                client.postMessage({
                    type: 'STARTUP_UPDATES_DETECTED',
                    assets: changedAssets,
                    timestamp: Date.now()
                });
            });
            
            console.log('✅ CHECKER: Messages sent to all clients');
        }).catch(error => {
            console.error('❌ CHECKER: Error matching clients:', error);
        });
    }
}

const integrityChecker = new StartupIntegrityChecker();
// ======== ✅ END INTEGRITY CHECKER ========

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
        console.log('📦 SW: Starting to cache URLs...');
        const promises = urlsToCache.map(url =>
          cache.add(url).catch(err => {
            console.warn(`⚠️ gagal cache ${url}`, err);
            return Promise.resolve();
          })
        );
        return Promise.all(promises);
      })
      .then(() => {
        console.log('✅ SW: resources cached for app shell');
        
        // ======== ✅ CHECK INTEGRITY SETELAH INSTALL ========
        console.log('⏰ SW: Setting install timeout for integrity check...');
        setTimeout(() => {
          console.log('🔔 SW: Install timeout executed, calling integrity check...');
          integrityChecker.checkAllCachedAssets();
        }, 3000);
        // ======== ✅ END CHECK ========
      })
      .catch(err => {
        console.error('❌ SW: cache install failed:', err);
      })
  );
});

// ACTIVATE: clean old caches
self.addEventListener('activate', event => {
  console.log(`🟢 [SW ${APP_VERSION}] activating...`);
  event.waitUntil(
    (async () => {
      console.log('🗑️ SW: Starting cache cleanup...');
      // Hapus cache lama
      const names = await caches.keys();
      console.log(`🗑️ SW: Found ${names.length} caches`);
      
      await Promise.all(names.map(name => {
        if (![STATIC_CACHE, PDF_CACHE].includes(name)) {
          console.log('🗑️ SW: deleting old cache:', name);
          return caches.delete(name);
        }
      }));

      console.log('👑 SW: Claiming clients...');
      // Klaim klien
      await self.clients.claim();

      // Inform clients
      const clientList = await self.clients.matchAll({ type: 'window' });
      console.log(`👑 SW: Claimed ${clientList.length} clients`);
      
      for (const client of clientList) {
        client.postMessage({ type: 'VERSION_ACTIVATED', version: APP_VERSION });
      }

      // ======== ✅ CHECK INTEGRITY SETELAH ACTIVATE ========
      console.log('⏰ SW: Setting activate timeout for integrity check...');
      setTimeout(() => {
        console.log('🔔 SW: Activate timeout executed, calling integrity check...');
        integrityChecker.checkAllCachedAssets();
      }, 2000);
      // ======== ✅ END CHECK ========

      console.log('🎯 SW: activated & clients claimed');
    })()
  );
});

// FETCH: Handle requests
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

// Handle navigation
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
    
    // ✅ RELATIVE PATH untuk offline
    const offline = await caches.match('./fallback/offline.html');
    if (offline) return offline;
    
    return new Response('<h1>Offline</h1><p>Aplikasi ELSA sedang offline</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Handle static assets
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

// Messaging
self.addEventListener('message', event => {
  const data = event.data;
  console.log('📨 SW: Received message:', data);
  
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') {
    console.log('🔔 SW: Received SKIP_WAITING message — calling skipWaiting()');
    self.skipWaiting();
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

console.log('🚀 SW: Service Worker loaded successfully');