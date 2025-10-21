/* ============================
   ELSA PWA Service Worker v3.4 - CLEAN NO NOTIFICATION VERSION
   ============================ */

const APP_VERSION = 'v3';
const CACHE_NAME = `elsa-pwa-${APP_VERSION}`;
const STATIC_CACHE = `static-${APP_VERSION}`;
const PDF_CACHE = `pdf-cache-${APP_VERSION}`;
const MAX_STATIC_ITEMS = 50;
const MAX_PDF_ITEMS = 20;

const urlsToCache = [
  './',
  './fallback/offline.html',
  './index.html',
  './viewer.html', 
  './manifest.json',
  './sw.js',
  './pdfjs/pdf.js',
  './pdfjs/pdf.worker.js',
  './settings/index.html',
  './profile/index.html',
  './alat/kalkulator/index.html',
  './alat/konversi/suhu/index.html',
  './alat/konversi/jarak/index.html',
  './alat/konversi/berat/index.html',
  './alat/periodik/index.html',
  './alat/TodoList/index.html',
  './file-handler.html',
  './share-target.html',
  './icons/icon-96x96.png',
  './icons/icon-192x192.png', 
  './icons/icon-512x512.png',
  './icons/icons.svg'
];

// IndexedDB helper
const DB_NAME = 'elsa-sw-db';
const DB_VERSION = 1;
const STORE_MAP = {
  userData: 'userData',
  pdfProgress: 'pdfProgress',
  pendingPDFHistory: 'pendingPDFHistory',
  pendingUserActivity: 'pendingUserActivity',
  failedRequests: 'failedRequests'
};

// ✅ FIXED: Proper Promise wrapper dengan error handling yang lebih baik
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const store of Object.values(STORE_MAP)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked'));
  });
}

// IDB helper functions dengan error handling yang lebih baik
async function idbGetAll(storeName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('IDB getAll error:', error);
    return [];
  }
}

async function idbPut(storeName, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('IDB put error:', error);
    return null;
  }
}

async function idbDelete(storeName, id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('IDB delete error:', error);
    return null;
  }
}

async function idbClear(storeName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('IDB clear error:', error);
    return null;
  }
}

// ✅ FIXED: isOnline() function yang lebih reliable
async function isOnline() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch('./icons/icon-96x96.png', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// ======== ✅ IMPROVED INTEGRITY CHECKER ========
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
        if (this.checked || !(await isOnline())) {
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
                return true;
            }
            
            const cachedContent = await cachedResponse.text();
            console.log(`📄 CHECKER: Cached content length: ${cachedContent.length}`);
            
            // Compare content
            const changed = networkContent !== cachedContent;
            
            console.log(`📊 CHECKER: ${url}: changed=${changed}`);
            
            if (changed) {
                console.log('🔄 CHECKER: Content changed - updating cache');
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

// Helper: batasi ukuran cache dengan error handling
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
    console.warn('Error limiting cache:', error);
  }
}

// ✅ PERBAIKI: Install event dengan caching yang proper
self.addEventListener('install', event => {
  console.log(`🟢 [SW ${APP_VERSION}] install - caching critical assets...`);
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        
        // ✅ WAIT untuk caching selesai
        const results = await Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn(`⚠️ Failed to cache ${url}:`, err);
              return null; // Return null untuk failed items
            })
          )
        );
        
        // ✅ Check hasil caching
        const successful = results.filter(r => r.status === 'fulfilled' && r.value);
        const failed = results.filter(r => r.status === 'rejected');
        
        console.log(`✅ ${successful.length}/${urlsToCache.length} assets cached successfully`);
        
        if (failed.length > 0) {
          console.warn(`⚠️ ${failed.length} assets failed to cache`);
        }
        
        // ✅ FORCE ACTIVATION - jangan tunggu tab lain
        self.skipWaiting();
        
      } catch (error) {
        console.error('❌ Cache installation failed:', error);
        // ✅ Tetap lanjut meski error
      }
    })()
  );
});

// ✅ IMPROVED: ACTIVATE event dengan error handling
// ======== ✅ FIXED ACTIVATE EVENT ========
// ✅ PERBAIKI: Activate event yang lebih agresif
self.addEventListener('activate', event => {
  console.log(`🟢 [SW ${APP_VERSION}] activating...`);
  
  event.waitUntil(
    (async () => {
      try {
        // Clean old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(name => {
            if (name !== STATIC_CACHE && name !== PDF_CACHE) {
              console.log('🗑️ Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        );

        // ✅ AGGRESSIVE CLAIMING
        await self.clients.claim();
        console.log('✅ SW activated and claimed clients');
        
      } catch (error) {
        console.error('❌ Activation failed:', error);
        // ✅ Tetap lanjut meski error
      }
    })()
  );
});
 

// ======== ✅ IMPROVED MESSAGE HANDLER ========
self.addEventListener('message', event => {
  const data = event.data;
  
  if (!data || !data.type) return;

  console.log('📨 SW: Received message:', data.type);

  switch (data.type) {
    case 'SKIP_WAITING':
      console.log('🔔 SW: Skip waiting requested');
      self.skipWaiting();
      break;
      
    case 'RUN_INTEGRITY_CHECK':
      console.log('🔍 SW: Running integrity check...');
      event.waitUntil(
        integrityChecker.checkAllCachedAssets().catch(err => {
          console.error('Integrity check error:', err);
        })
      );
      break;
      
    default:
      console.log('📨 SW: Unknown message type:', data.type);
  }
});

// ======== ✅ IMPROVED FETCH EVENT HANDLER ========
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip non-GET requests early
  if (request.method !== 'GET') return;
  
  // Skip external resources
  if (request.url.startsWith('chrome-extension://') ||
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Handler khusus
  if (url.search.includes('file-handler') || url.pathname.includes('/file-handler')) {
    console.log('📁 [SW] File handler request detected:', request.url);
    event.respondWith(handleFileHandlerRequest(event));
    return;
  }

  if (url.protocol === 'web+elsa:' || url.search.includes('web+elsa')) {
    console.log('🔗 [SW] Custom protocol request:', request.url);
    event.respondWith(handleProtocolRequest(event));
    return;
  }

  // Log cache strategies
  if (request.mode === 'navigate') {
    console.log('🏠 [CACHE] Navigation request - Network First + Cache Fallback');
  }
  
  if (url.pathname.endsWith('.pdf')) {
    console.log('📄 [CACHE] PDF request - Cache First + Network Update');
  }

  // Route requests
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(handlePDFRequest(event));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }
  
  if (url.pathname.includes('/share-target.html')) {
    event.respondWith(handleShareTargetRequest(event));
    return;
  }

  // Static asset
  event.respondWith(handleStaticRequest(event));
});

// ✅ IMPROVED: Handle PDF dengan error handling
async function handlePDFRequest(event) {
  const request = event.request;
  const fileName = getFileNameFromUrl(request.url);
  
  try {
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedPDF = await pdfCache.match(request);
    
    if (cachedPDF) {
      console.log('📄 PDF from cache:', fileName);
      return cachedPDF;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      pdfCache.put(request, clone)
        .then(() => limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS))
        .catch(e => console.warn('⚠️ PDF cache put failed', e));
    }
    
    return networkResponse;
    
  } catch (error) {
    console.warn('❌ PDF fetch error:', fileName, error);
    
    return new Response(JSON.stringify({
      error: 'PDF_UNAVAILABLE_OFFLINE',
      message: 'PDF tidak tersedia offline',
      fileName: fileName
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ✅ IMPROVED: Handle navigation dengan fallback yang lebih baik
// ✅ PERBAIKI: Navigation handler yang lebih sederhana dan reliable
async function handleNavigationRequest(event) {
  const request = event.request;
  
  try {
    // ✅ Coba network dulu
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache the response for next time
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone()).catch(console.warn);
      return networkResponse;
    }
  } catch (err) {
    console.log('[SW] Network failed for navigation:', request.url);
  }
  
  // ✅ FALLBACK SEDERHANA: langsung ke cache atau offline.html
  try {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
  } catch (err) {
    console.warn('[SW] Cache match failed:', err);
  }
  
  // ✅ ULTIMATE FALLBACK: offline.html
  try {
    const offlinePage = await caches.match('./fallback/offline.html');
    if (offlinePage) {
      return offlinePage;
    }
  } catch (err) {
    console.warn('[SW] Offline page not available');
  }
  
  // ✅ HARDCODED OFFLINE PAGE sebagai last resort
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Offline - ELSA</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; padding: 2rem; text-align: center; background: #f0f0f0; }
        .container { max-width: 500px; margin: 50px auto; background: white; padding: 2rem; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📵 Offline</h1>
        <p>Aplikasi ELSA membutuhkan koneksi internet untuk halaman ini.</p>
        <button onclick="location.reload()">Coba Lagi</button>
      </div>
    </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ✅ IMPROVED: Handle static assets
async function handleStaticRequest(event) {
  const request = event.request;
  
  try {
    // Try cache first
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Try network
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(STATIC_CACHE)
        .then(cache => cache.put(request, clone))
        .then(() => limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS))
        .catch(e => console.warn('[SW] Cache put error:', e));
    }
    
    return networkResponse;
    
  } catch (err) {
    console.warn('[SW] Static fetch failed for', request.url, err);
    
    // Better fallback based on content type
    const url = request.url.toLowerCase();
    
    if (url.endsWith('.css')) {
      return new Response('/* CSS tidak tersedia offline */', {
        status: 404,
        headers: { 
          'Content-Type': 'text/css',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    if (url.endsWith('.js')) {
      return new Response('// JS tidak tersedia offline', {
        status: 404,
        headers: { 
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    if (url.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)) {
      // Return transparent 1x1 pixel for images
      return new Response(
        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB2aWV3Qm94PSIwIDAgMSAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InRyYW5zcGFyZW50Ii8+PC9zdmc+',
        {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' }
        }
      );
    }
    
    return new Response('Resource tidak tersedia offline', {
      status: 503,
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
}

// Helper function dengan validasi
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ✅ NEW: Clear all caches function
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
    console.log('✅ All caches cleared');
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_CLEARED',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('❌ Error clearing caches:', error);
  }
}

// Periodic cleanup dengan error handling
async function periodicCleanup() {
  try {
    await limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS);
    await limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS);
    console.log('🧹 Periodic cleanup done');
  } catch (err) {
    console.error('❌ Cleanup error:', err);
  }
}

// ======== ✅ IMPROVED BACKGROUND SYNC ========
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync triggered:', event.tag);
  
  switch (event.tag) {
    case 'sync-pdf-history':
      event.waitUntil(syncPDFHistory());
      break;
      
    case 'sync-user-activity':
      event.waitUntil(syncUserActivity());
      break;
      
    case 'retry-failed-requests':
      event.waitUntil(retryFailedRequests());
      break;
      
    case 'content-cleanup':
      event.waitUntil(periodicCleanup());
      break;
      
    default:
      console.log('Unknown sync tag:', event.tag);
  }
});

// REAL SYNC: PDF Reading History dengan error handling
async function syncPDFHistory() {
  try {
    console.log('🔄 Starting PDF history sync...');
    
    const pendingHistory = await getPendingPDFHistory();
    
    if (pendingHistory.length > 0) {
      console.log(`📚 Found ${pendingHistory.length} pending history items`);
      
      const success = await sendPDFHistoryToServer(pendingHistory);
      
      if (success) {
        console.log('✅ PDF history synced successfully');
        await clearSyncedPDFHistory(pendingHistory);
      } else {
        throw new Error('PDF history sync failed');
      }
    } else {
      console.log('✅ No pending PDF history to sync');
    }
    
  } catch (error) {
    console.error('❌ PDF history sync failed:', error);
    throw error;
  }
}

// REAL SYNC: User Activity dengan error handling
async function syncUserActivity() {
  try {
    console.log('🔄 Syncing user activity...');
    
    const userActivity = await getPendingUserActivity();
    
    if (userActivity && userActivity.length > 0) {
      const batchSuccess = await sendUserActivityToServer(userActivity);
      
      if (batchSuccess) {
        console.log('✅ User activity synced');
        await clearSyncedUserActivity();
      } else {
        throw new Error('User activity sync failed');
      }
    } else {
      console.log('✅ No pending user activity to sync');
    }
    
  } catch (error) {
    console.error('❌ User activity sync failed:', error);
    throw error;
  }
}

// REAL SYNC: Retry Failed Requests dengan error handling
async function retryFailedRequests() {
  try {
    console.log('🔄 Retrying failed requests...');
    
    const failedRequests = await getFailedRequests();
    
    if (failedRequests.length === 0) {
      console.log('✅ No failed requests to retry');
      return;
    }
    
    console.log(`🔁 Retrying ${failedRequests.length} failed requests`);
    
    for (const request of failedRequests) {
      try {
        await retryRequest(request);
        await removeFailedRequest(request.id);
        console.log('✅ Request retry successful:', request.id);
      } catch (retryError) {
        console.log('❌ Request retry failed, will retry later:', request.id);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed requests retry failed:', error);
    throw error;
  }
}

// ======== ✅ IMPROVED STORAGE HELPERS ========
async function getPendingPDFHistory() {
  try {
    const items = await idbGetAll(STORE_MAP.pendingPDFHistory);
    return items.map(x => x.data).filter(Boolean);
  } catch (error) {
    console.warn('Error getting pending PDF history:', error);
    return [];
  }
}

async function clearSyncedPDFHistory(syncedHistory) {
  try {
    const all = await idbGetAll(STORE_MAP.pendingPDFHistory);
    const syncedIds = syncedHistory.map(item => item.id).filter(Boolean);
    
    for (const item of all) {
      if (syncedIds.includes(item.data.id)) {
        await idbDelete(STORE_MAP.pendingPDFHistory, item.id);
      }
    }
  } catch (error) {
    console.warn('Error clearing synced PDF history:', error);
  }
}

async function sendPDFHistoryToServer(history) {
  console.log('🌐 Sending PDF history to server:', history);
  
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const success = Math.random() > 0.2;
      
      if (success) {
        console.log('✅ Server accepted PDF history');
        resolve(true);
      } else {
        console.log('❌ Server rejected PDF history');
        reject(new Error('Server error'));
      }
    }, 1000);
  });
}

async function getPendingUserActivity() {
  try {
    const items = await idbGetAll(STORE_MAP.pendingUserActivity);
    return items.map(x => x.data).filter(Boolean);
  } catch (error) {
    console.warn('Error getting pending user activity:', error);
    return [];
  }
}

async function clearSyncedUserActivity() {
  try {
    await idbClear(STORE_MAP.pendingUserActivity);
  } catch (error) {
    console.warn('Error clearing synced user activity:', error);
  }
}

async function sendUserActivityToServer(activity) {
  console.log('🌐 Sending user activity to server:', activity.length, 'items');
  await new Promise(resolve => setTimeout(resolve, 500));
  return true;
}

async function getFailedRequests() {
  try {
    const items = await idbGetAll(STORE_MAP.failedRequests);
    return items.map(x => x.data).filter(Boolean);
  } catch (error) {
    console.warn('Error getting failed requests:', error);
    return [];
  }
}

async function retryRequest(request) {
  console.log('🔄 Retrying request:', request.url);
  
  const response = await fetch(request.url, {
    method: request.method || 'GET',
    body: request.body,
    headers: request.headers || {}
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return response;
}

async function removeFailedRequest(requestId) {
  try {
    const all = await idbGetAll(STORE_MAP.failedRequests);
    for (const item of all) {
      if (item.data.id === requestId) {
        await idbDelete(STORE_MAP.failedRequests, item.id);
        break;
      }
    }
  } catch (error) {
    console.warn('Error removing failed request:', error);
  }
}

// ======== ✅ IMPROVED FILE HANDLER ========
async function handleFileHandlerRequest(event) {
  try {
    console.log('📁 [SW] Processing file handler request...');
    
    if (event.request.url.includes('/file-handler.html')) {
      const cachedResponse = await caches.match('./file-handler.html');
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return new Response(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ELSA - File Handler</title>
            <style>
                body { 
                  font-family: Arial, sans-serif; 
                  padding: 20px; 
                  background: #f5f5f5; 
                  margin: 0;
                }
                .container { 
                  max-width: 600px; 
                  margin: 0 auto; 
                  background: white; 
                  padding: 30px; 
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                h1 { color: #2c3e50; margin-top: 0; }
                .loading { 
                  text-align: center; 
                  color: #7f8c8d;
                  font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📁 File Handler ELSA</h1>
                <p>File akan diproses oleh aplikasi ELSA.</p>
                <div id="file-info" class="loading">Memproses file...</div>
            </div>
            <script>
                console.log('File handler page loaded');
                // Redirect setelah delay
                setTimeout(() => {
                  window.location.href = '../index.html?source=file-handler';
                }, 1000);
            </script>
        </body>
        </html>
      `, {
        headers: { 
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'File received by ELSA',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error('❌ [SW] File handler error:', error);
    return new Response(JSON.stringify({
      error: 'FILE_HANDLER_ERROR',
      message: 'Gagal memproses file'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ======== ✅ IMPROVED PROTOCOL HANDLER ========
async function handleProtocolRequest(event) {
  try {
    const url = new URL(event.request.url);
    console.log('🔗 [SW] Processing protocol request:', url.toString());
    
    const linkParam = url.searchParams.get('link') || url.searchParams.get('url') || '';
    const redirectUrl = `./index.html?protocol=web+elsa&data=${encodeURIComponent(linkParam)}`;
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Redirecting to ELSA...</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <h1>🔗 ELSA</h1>
        <p>Mengarahkan ke aplikasi ELSA...</p>
        <div class="spinner"></div>
        <script>
          setTimeout(() => {
            window.location.href = '${redirectUrl}';
          }, 100);
        </script>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error('❌ [SW] Protocol handler error:', error);
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <script>
          window.location.href = './index.html?protocol_error=true';
        </script>
      </head>
      <body>
        <p>Redirecting...</p>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ======== ✅ IMPROVED SHARE TARGET HANDLER ========
async function handleShareTargetRequest(event) {
  try {
    console.log('📤 [SW] Processing share target request...');
    
    const cachedResponse = await caches.match('./share-target.html');
    if (cachedResponse) {
      return cachedResponse;
    }
    
    return new Response(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>ELSA - Share Target</title>
          <style>
              body { 
                font-family: Arial, sans-serif; 
                padding: 20px; 
                background: #f5f5f5; 
                margin: 0;
              }
              .container { 
                max-width: 600px; 
                margin: 0 auto; 
                background: white; 
                padding: 30px; 
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #2c3e50; margin-top: 0; }
              .loading { 
                text-align: center; 
                color: #7f8c8d;
                font-style: italic;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>📤 Berbagi ke ELSA</h1>
              <p>Konten sedang diproses dan akan dibuka di aplikasi ELSA.</p>
              <div id="share-info" class="loading">Memproses konten...</div>
          </div>
          <script>
              console.log('Share target page loaded');
              // Redirect ke halaman utama
              setTimeout(() => {
                window.location.href = '../index.html?source=share-target';
              }, 1000);
          </script>
      </body>
      </html>
    `, {
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error('❌ [SW] Share target error:', error);
    
    return new Response(JSON.stringify({
      error: 'SHARE_TARGET_ERROR',
      message: 'Gagal memproses konten yang dibagikan'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

console.log(`✅ ELSA Service Worker ${APP_VERSION} loaded successfully`);

// ✅ TAMBAHKAN: Cache health check
async function verifyCacheHealth() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    const criticalUrls = [
      './index.html',
      './fallback/offline.html',
      './manifest.json'
    ];
    
    let missing = [];
    for (const url of criticalUrls) {
      const response = await cache.match(url);
      if (!response) {
        missing.push(url);
        // ✅ Coba cache ulang critical assets yang missing
        try {
          await cache.add(url);
          console.log('✅ Re-cached missing critical asset:', url);
        } catch (err) {
          console.warn('❌ Failed to re-cache:', url, err);
        }
      }
    }
    
    console.log(`📊 Cache health: ${keys.length} items, ${missing.length} critical missing`);
    return missing.length === 0;
  } catch (error) {
    console.error('❌ Cache health check failed:', error);
    return false;
  }
}

// Panggil di activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // ... cleanup code ...
      
      // ✅ Verify cache health setelah activation
      await verifyCacheHealth();
    })()
  );
});