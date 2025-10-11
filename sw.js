/* ============================
   ELSA PWA Service Worker v3.2 - RELATIVE PATHS
   ============================ */

const APP_VERSION = 'v3.2-pwabuilder-test';
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
  
  // ⭐ NEW: Add handler pages
  './file-handler.html',
  './share-target.html',
  './protocol-handler.html',
  
  './icons/icon-96x96.png',
  './icons/icon-192x192.png', 
  './icons/icon-512x512.png',
  './fallback/offline.html'
];

// IndexedDB helper khusus untuk Service Worker
const DB_NAME = 'elsa-sw-db';
const DB_VERSION = 1;
const STORE_MAP = {
  userData: 'userData',
  pdfProgress: 'pdfProgress',
  pendingPDFHistory: 'pendingPDFHistory',
  pendingUserActivity: 'pendingUserActivity',
  failedRequests: 'failedRequests',
  pendingNotificationStatus: 'pendingNotificationStatus',
};

function openDB() {
  if (!('indexedDB' in self)) {
    console.warn('IndexedDB not supported in this Service Worker context');
    return Promise.reject(new Error('IndexedDB not supported'));
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
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

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
// INSTALL: cache app shell — DIPERBAIKI UNTUK PWABUILDER
self.addEventListener('install', event => {
  console.log(`🟢 [SW ${APP_VERSION}] install - caching critical assets...`);
  event.waitUntil(
  caches.open(STATIC_CACHE).then(async cache => {
    const results = await Promise.allSettled(
      urlsToCache.map(url => cache.add(url))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`❌ Failed to cache ${urlsToCache[index]}:`, result.reason);
      }
    });
    if (results.some(r => r.status === 'rejected')) {
      throw new Error('Some critical assets failed to cache');
    }
  })
);
});

// ACTIVATE: clean old caches
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

      // ❌ HAPUS INI — JANGAN PANGGIL integrityChecker DI SINI
      // console.log('⏸️ SW: Integrity checker disabled for PWA Builder test');
      // setTimeout(() => {
      //   integrityChecker.checkAllCachedAssets();
      // }, 3000);

      console.log('🎯 SW: activated & clients claimed');
    })()
  );
});

// FETCH: Handle requests
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
    // ⭐ NEW: Handle file protocol requests
  if (url.search.includes('file-handler') || url.pathname.includes('/file-handler')) {
    console.log('📁 [SW] File handler request detected:', request.url);
    event.respondWith(handleFileHandlerRequest(event));
    return;
  }

  // ⭐ NEW: Handle custom protocol requests
  if (url.protocol === 'web+elsa:' || url.search.includes('web+elsa')) {
    console.log('🔗 [SW] Custom protocol request:', request.url);
    event.respondWith(handleProtocolRequest(event));
    return;
  }

  // Abaikan non-GET & external resources
  if (request.method !== 'GET') return;
  if (request.url.startsWith('chrome-extension://') ||
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }
  
    // ⭐ ADD THIS: Log specific cache strategies
  if (request.mode === 'navigate') {
    console.log('🏠 [CACHE] Navigation request - Network First + Cache Fallback');
  }
  
  if (url.pathname.endsWith('.pdf')) {
    console.log('📄 [CACHE] PDF request - Cache First + Network Update');
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
  
  if (request.url.match(/\.(css)$/)) {
  return new Response('/* CSS tidak tersedia offline */', {
    status: 404,
    headers: { 'Content-Type': 'text/css' }
  });
}
if (request.url.match(/\.(js)$/)) {
  return new Response('// JS tidak tersedia offline', {
    status: 404,
    headers: { 'Content-Type': 'application/javascript' }
  });
}
  
  if (url.pathname.includes('/share-target.html')) {
  event.respondWith(handleShareTargetRequest(event));
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
// Handle navigation - OPTIMIZED FOR PWABUILDER
// Handle navigation - DIPERBAIKI UNTUK PWABUILDER
// Handle navigation — DIPERBAIKI 100% UNTUK PWABUILDER
async function handleNavigationRequest(event) {
  const request = event.request;

  try {
    // Coba jaringan dulu (untuk konten terbaru saat online)
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache respons untuk offline nanti
      const clone = networkResponse.clone();
      caches.open(STATIC_CACHE).then(cache => {
        cache.put(request, clone)
          .then(() => limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS))
          .catch(e => console.warn('[SW] Gagal cache halaman:', e));
      });
      return networkResponse;
    }
    // Jika respons tidak OK (404, 500, dll), lanjut ke fallback
  } catch (err) {
    console.log('[SW] Network gagal untuk navigasi:', request.url);
  }

  // Jika offline atau jaringan error, coba ambil dari cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Jika tidak ada di cache, SAJIKAN offline.html DARI CACHE
  const offlineResponse = await caches.match('./fallback/offline.html');
  if (offlineResponse) {
    console.log('[SW] Menyajikan offline.html untuk:', request.url);
    return offlineResponse;
  }

  // Jika offline.html juga tidak ada (seharusnya tidak terjadi karena install dijamin cache-nya),
  // sajikan inline sebagai cadangan terakhir
  console.error('[SW] KRISIS: offline.html tidak ditemukan di cache!');
  return new Response(`
    <!DOCTYPE html>
    <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Offline</title>
        <style>body{font-family:sans-serif;text-align:center;padding:2rem;background:#f5f5f5;color:#333;}</style>
      </head>
      <body>
        <h1>Anda Sedang Offline</h1>
        <p>Aplikasi tidak dapat diakses tanpa koneksi internet.</p>
      </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
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
  console.warn('[SW] Static fetch failed for', request.url, err);
  
  // Better fallback based on content type
  if (request.url.match(/\.(css)$/)) {
    return new Response('/* CSS tidak tersedia offline */', {
      status: 404,
      headers: { 'Content-Type': 'text/css' }
    });
  }
  
  if (request.url.match(/\.(js)$/)) {
    return new Response('// JS tidak tersedia offline', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript' }
    });
  }
  
  // For other file types
  return new Response('Resource tidak tersedia offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
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
// Di messaging section yang sudah ada, tambahkan:
// Di messaging section, pastikan seperti ini:
// DI sw.js - PERBAIKI bagian message handler:
// DI sw.js - PERBAIKI bagian message handler YANG UTUH:
// MESSAGE HANDLER YANG UTUH & TERPUSAT
self.addEventListener('message', event => {
    const data = event.data;
    console.log('📨 SW: Received message:', data);
    
    if (!data || !data.type) return;

    if (data.type === 'RUN_INTEGRITY_CHECK') {
        console.log('🔍 SW: Menjalankan integrity check berdasarkan permintaan halaman...');
        event.waitUntil(
            integrityChecker.checkAllCachedAssets().catch(err => {
                console.error('💥 Integrity check error:', err);
            })
        );
    } 
    else if (data.type === 'SKIP_WAITING') {
        console.log('🔔 SW: Received SKIP_WAITING message — calling skipWaiting()');
        self.skipWaiting();
    }
    else if (data.type === 'MANUAL_SYNC_REQUEST') {
        console.log('🔄 SW: Manual sync requested');
        event.waitUntil(
            performBackgroundSync().then(result => {
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({
                        type: 'MANUAL_SYNC_RESULT',
                        result: result
                    });
                }
            })
        );
    }
    else if (data.type === 'PUSH_SUBSCRIBE') {
        console.log('🔔 SW: Push subscribe request received');
        // Handle push subscription logic here
    }
    else if (data.type === 'PUSH_UNSUBSCRIBE') {
        console.log('🔔 SW: Push unsubscribe request received');
        // Handle push unsubscription logic here
    }
    else if (data.type === 'SHOW_PUSH_NOTIFICATION') {
        console.log('🔔 SW: Show push notification request:', data.notification);
        
        event.waitUntil(
            self.registration.showNotification(
                data.notification.title, 
                {
                    body: data.notification.body,
                    icon: './icons/icon-192x192.png',
                    badge: './icons/icon-96x96.png',
                    data: data.notification.data,
                    actions: [
                        {
                            action: 'open-app',
                            title: 'Buka'
                        },
                        {
                            action: 'dismiss', 
                            title: 'Tutup'
                        }
                    ]
                }
            )
        );
    }
});

// Helper untuk save PDF progress
async function savePDFProgress(progress) {
  // Simpan ke IndexedDB atau storage
  console.log('💾 Saving PDF progress:', progress);
  
  const existingData = await getStoredProgress();
  const newData = existingData.filter(p => p.id !== progress.id);
  newData.push(progress);
  
  // Simulate async storage
  return new Promise(resolve => {
    setTimeout(() => {
      console.log('✅ Progress saved');
      resolve();
    }, 100);
  });
}

async function getStoredProgress() {
  // Simulate getting from storage
  return [];
}

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

console.log('🚀 SW: Service Worker loaded successfully');

// ======== ✅ PERIODIC SYNC IMPLEMENTATION ========

// Periodic Sync Event Handler
self.addEventListener('periodicsync', event => {
  if (event.tag === 'content-cleanup') {
    event.waitUntil(periodicCleanup());
  }
});

// Background Sync Task
async function performBackgroundSync() {
  try {
    console.log('🔄 Starting background sync...');
    
    // 1. Check for content updates
    const updates = await checkForContentUpdates();
    
    // 2. Update cache if needed
    if (updates.length > 0) {
      console.log('🔄 Background updates found:', updates);
      await updateCachedContent(updates);
      
      // 3. Notify user about new content
      await showBackgroundNotification(updates);
    } else {
      console.log('✅ No updates in background sync');
    }
    
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

// Check for content updates
async function checkForContentUpdates() {
  const updates = [];
  
  try {
    // Check critical files for updates
    const criticalFiles = [
      './index.html',
      './manifest.json'
    ];
    
    for (const file of criticalFiles) {
      const isUpdated = await checkSingleFileUpdate(file);
      if (isUpdated) {
        updates.push(file);
      }
    }
    
  } catch (error) {
    console.error('Error checking content updates:', error);
  }
  
  return updates;
}

// Check single file update
async function checkSingleFileUpdate(url) {
  try {
    const networkResponse = await fetch(url, { cache: 'no-store' });
    if (!networkResponse.ok) return false;
    
    const networkContent = await networkResponse.text();
    const cachedResponse = await caches.match(url);
    
    if (!cachedResponse) return true;
    
    const cachedContent = await cachedResponse.text();
    return networkContent !== cachedContent;
    
  } catch (error) {
    return false;
  }
}

// Update cached content
async function updateCachedContent(updates) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    
    for (const url of updates) {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        console.log('✅ Updated cache for:', url);
      }
    }
  } catch (error) {
    console.error('Error updating cache:', error);
  }
}

// Show background notification
async function showBackgroundNotification(updates) {
  // Only show notification if app is not in foreground
  const clients = await self.clients.matchAll();
  const isAppInForeground = clients.some(client => client.visibilityState === 'visible');
  
  if (!isAppInForeground && updates.length > 0) {
    self.registration.showNotification('ELSA Update', {
      body: `${
        updates.length === 1 
          ? 'New content available' 
          : `${updates.length} new updates available`
      }`,
      icon: './icons/icon-192x192.png',
      badge: './icons/icon-96x96.png',
      tag: 'content-update',
      actions: [
        {
          action: 'open',
          title: 'View'
        },
        {
          action: 'dismiss', 
          title: 'Dismiss'
        }
      ]
    });
  }
}

// ======== ✅ BACKGROUND SYNC IMPLEMENTATION ========

// Background Sync Event Handler
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync triggered:', event.tag);
  
  switch (event.tag) {
    case 'content-sync':
      event.waitUntil(syncContentUpdates());
      break;
      
    case 'user-data-sync':
      event.waitUntil(syncUserData());
      break;
      
    case 'pdf-metadata-sync':
      event.waitUntil(syncPDFMetadata());
      break;
      
    default:
      console.log('Unknown sync tag:', event.tag);
  }
});

// Sync content updates
async function syncContentUpdates() {
  try {
    console.log('🔄 Syncing content updates...');
    
    // Get pending updates from IndexedDB
    const pendingUpdates = await getPendingUpdates();
    
    if (pendingUpdates.length > 0) {
      console.log(`📦 Found ${pendingUpdates.length} pending updates`);
      
      for (const update of pendingUpdates) {
        await processContentUpdate(update);
      }
      
      // Clear processed updates
      await clearPendingUpdates();
      
      console.log('✅ Content sync completed');
      
      // Notify user
      await showSyncNotification('Content updated successfully');
    } else {
      console.log('✅ No pending content updates');
    }
    
  } catch (error) {
    console.error('❌ Content sync failed:', error);
    throw error; // Important: re-throw to retry
  }
}

// Sync user data (bookmarks, progress, etc)
async function syncUserData() {
  try {
    console.log('🔄 Syncing user data...');
    
    const userData = await getUserDataFromStorage();
    
    if (userData && Object.keys(userData).length > 0) {
      // Simulate API call to sync user data
      const success = await syncToBackend(userData);
      
      if (success) {
        console.log('✅ User data synced successfully');
        await clearSyncedUserData();
      }
    }
    
  } catch (error) {
    console.error('❌ User data sync failed:', error);
    throw error;
  }
}

// Sync PDF reading progress/metadata
async function syncPDFMetadata() {
  try {
    console.log('🔄 Syncing PDF metadata...');
    
    const pdfProgress = await getPDFProgressFromStorage();
    
    if (pdfProgress && pdfProgress.length > 0) {
      for (const progress of pdfProgress) {
        await syncPDFProgress(progress);
      }
      console.log('✅ PDF metadata synced');
    }
    
  } catch (error) {
    console.error('❌ PDF metadata sync failed:', error);
    throw error;
  }
}

// Helper functions for Background Sync
async function getPendingUpdates() {
  // Simulate getting updates from storage
  // In real app, this would use IndexedDB
  return new Promise(resolve => {
    setTimeout(() => {
      resolve([
        { type: 'content', id: '1', data: 'update1' },
        { type: 'content', id: '2', data: 'update2' }
      ]);
    }, 100);
  });
}

async function processContentUpdate(update) {
  console.log('📄 Processing update:', update.id);
  // Simulate processing
  await new Promise(resolve => setTimeout(resolve, 200));
}

async function clearPendingUpdates() {
  console.log('🧹 Clearing pending updates');
}

// Simpan userData sebagai satu objek, id = 'main'
async function getUserDataFromStorage() {
  const all = await idbGetAll(STORE_MAP.userData);
  return all.find(x => x.id === 'main')?.data || null;
}
async function saveUserData(data) {
  await idbPut(STORE_MAP.userData, { id: 'main', data });
}
async function clearSyncedUserData() {
  await idbDelete(STORE_MAP.userData, 'main');
}

async function syncToBackend(userData) {
  console.log('🌐 Syncing to backend:', userData);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 300));
  return true; // Simulate success
}


// id = progress.id
async function getPDFProgressFromStorage() {
  return (await idbGetAll(STORE_MAP.pdfProgress)).map(x => x.data);
}
async function savePDFProgress(progress) {
  await idbPut(STORE_MAP.pdfProgress, { id: progress.id, data: progress });
}

async function syncPDFProgress(progress) {
  console.log('📊 Syncing PDF progress:', progress);
  await new Promise(resolve => setTimeout(resolve, 150));
}

async function showSyncNotification(message) {
  const clients = await self.clients.matchAll();
  const isAppInForeground = clients.some(client => client.visibilityState === 'visible');
  
  if (!isAppInForeground) {
    self.registration.showNotification('ELSA Sync', {
      body: message,
      icon: './icons/icon-192x192.png',
      tag: 'sync-notification'
    });
  }
}

// ======== ✅ REAL BACKGROUND SYNC IMPLEMENTATION ========


// REAL SYNC: PDF Reading History
async function syncPDFHistory() {
  try {
    console.log('🔄 Starting PDF history sync...');
    
    // Get pending history from storage
    const pendingHistory = await getPendingPDFHistory();
    
    if (pendingHistory.length > 0) {
      console.log(`📚 Found ${pendingHistory.length} pending history items`);
      
      // Simulate API call to sync with backend
      const success = await sendPDFHistoryToServer(pendingHistory);
      
      if (success) {
        console.log('✅ PDF history synced successfully');
        
        // Clear only successfully synced items
        await clearSyncedPDFHistory(pendingHistory);
        
        // Show notification
        await showSyncNotification('Reading history synced');
      } else {
        // If sync fails, throw error to retry later
        throw new Error('PDF history sync failed');
      }
    } else {
      console.log('✅ No pending PDF history to sync');
    }
    
  } catch (error) {
    console.error('❌ PDF history sync failed:', error);
    throw error; // ⭐ IMPORTANT: Re-throw untuk automatic retry
  }
}

// REAL SYNC: User Activity
async function syncUserActivity() {
  try {
    console.log('🔄 Syncing user activity...');
    
    const userActivity = await getPendingUserActivity();
    
    if (userActivity && userActivity.length > 0) {
      // Simulate batch API call
      const batchSuccess = await sendUserActivityToServer(userActivity);
      
      if (batchSuccess) {
        console.log('✅ User activity synced');
        await clearSyncedUserActivity(userActivity);
      } else {
        throw new Error('User activity sync failed');
      }
    }
    
  } catch (error) {
    console.error('❌ User activity sync failed:', error);
    throw error;
  }
}

// REAL SYNC: Retry Failed Requests
async function retryFailedRequests() {
  try {
    console.log('🔄 Retrying failed requests...');
    
    const failedRequests = await getFailedRequests();
    
    for (const request of failedRequests) {
      try {
        await retryRequest(request);
        await removeFailedRequest(request.id);
        console.log('✅ Request retry successful:', request.id);
      } catch (retryError) {
        console.log('❌ Request retry failed, will retry later:', request.id);
        // Keep in queue for next retry
      }
    }
    
  } catch (error) {
    console.error('❌ Failed requests retry failed:', error);
    throw error;
  }
}

// ======== ✅ STORAGE HELPERS ========

// Setiap history punya id unik
async function getPendingPDFHistory() {
  return (await idbGetAll(STORE_MAP.pendingPDFHistory)).map(x => x.data);
}
async function clearSyncedPDFHistory(syncedHistory) {
  const all = await idbGetAll(STORE_MAP.pendingPDFHistory);
  const syncedIds = syncedHistory.map(item => item.id);
  for (const item of all) {
    if (syncedIds.includes(item.data.id)) {
      await idbDelete(STORE_MAP.pendingPDFHistory, item.id);
    }
  }
}

async function sendPDFHistoryToServer(history) {
  console.log('🌐 Sending PDF history to server:', history);
  
  // Simulate API call dengan kemungkinan gagal
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 80% success rate untuk demo
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
  return (await idbGetAll(STORE_MAP.pendingUserActivity)).map(x => x.data);
}
async function clearSyncedUserActivity() {
  await idbClear(STORE_MAP.pendingUserActivity);
}

async function sendUserActivityToServer(activity) {
  console.log('🌐 Sending user activity to server:', activity.length, 'items');
  await new Promise(resolve => setTimeout(resolve, 500));
  return true; // Simulate success
}


async function getFailedRequests() {
  return (await idbGetAll(STORE_MAP.failedRequests)).map(x => x.data);
}

async function retryRequest(request) {
  console.log('🔄 Retrying request:', request.url);
  
  // Simulate retry dengan fetch
  const response = await fetch(request.url, {
    method: request.method || 'GET',
    body: request.body,
    headers: request.headers
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return response;
}

async function removeFailedRequest(requestId) {
  // Ambil semua request dari IndexedDB
  const all = await idbGetAll(STORE_MAP.failedRequests);
  for (const item of all) {
    if (item.data.id === requestId) {
      await idbDelete(STORE_MAP.failedRequests, item.id);
      break;
    }
  }
}

// ======== ✅ PUSH NOTIFICATIONS IMPLEMENTATION ========

// Push Event Handler - Terima push notifications
// DI sw.js - PASTIKAN push handler ada:
self.addEventListener('push', event => {
    console.log('📨 Push notification received:', event);
    
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        console.log('❌ Error parsing push data:', error);
        data = {
            title: 'ELSA Update',
            body: 'New content available',
            icon: './icons/icon-192x192.png'
        };
    }
    
    console.log('📊 Push data:', data);
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'ELSA', {
            body: data.body || 'You have new updates',
            icon: data.icon || './icons/icon-192x192.png',
            badge: './icons/icon-96x96.png',
            data: data,
            actions: [
                {
                    action: 'open-app',
                    title: 'Buka Aplikasi'
                },
                {
                    action: 'dismiss',
                    title: 'Tutup'
                }
            ],
            tag: data.tag || 'elsa-update'
        })
    );
});


// Notification Click Handler
self.addEventListener('notificationclick', event => {
  console.log('👆 Notification clicked:', event.notification.data);
  event.notification.close();

  const notificationData = event.notification.data || {};
  const action = event.action;

  if (action === 'open-app' || action === '') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  } else if (action === 'view-content' && notificationData.url) {
    event.waitUntil(clients.openWindow(notificationData.url));
  } else if (action === 'dismiss') {
    console.log('❌ Notification dismissed');
  }

  trackNotificationClick(notificationData, action);
});

// Notification Close Handler
self.addEventListener('notificationclose', event => {
  console.log('❌ Notification closed:', event.notification.data);
  
  // Track notification dismissal
  trackNotificationDismissal(event.notification.data);
});

// Helper functions untuk analytics
function trackNotificationClick(data, action) {
  console.log('📊 Notification click tracked:', { data, action });
  // Di real app, kirim ke analytics service
}

function trackNotificationDismissal(data) {
  console.log('📊 Notification dismissal tracked:', data);
  // Di real app, kirim ke analytics service
}

// Background sync untuk push notification status
async function syncNotificationStatus() {
  try {
    const notifications = await getPendingNotificationStatus();
    
    if (notifications.length > 0) {
      // Kirim status ke server
      await sendNotificationStatusToServer(notifications);
      await clearSyncedNotificationStatus(notifications);
    }
  } catch (error) {
    console.error('❌ Notification status sync failed:', error);
    throw error;
  }
}

// Helper functions untuk notification status sync
async function getPendingNotificationStatus() {
  return (await idbGetAll(STORE_MAP.pendingNotificationStatus)).map(x => x.data);
}

async function clearSyncedNotificationStatus() {
  await idbClear(STORE_MAP.pendingNotificationStatus);
}

async function sendNotificationStatusToServer(status) {
  console.log('🌐 Sending notification status to server:', status);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));
  return true;
}

// PWABUILDER: OFFLINE SUPPORT ENABLED ✅
// This service worker provides a valid offline fallback for navigation requests.

// ⭐ NEW: Handle File Handler Requests
async function handleFileHandlerRequest(event) {
  try {
    console.log('📁 [SW] Processing file handler request...');
    
    // Untuk GET requests ke file-handler.html
    if (event.request.url.includes('/file-handler.html')) {
      const cachedResponse = await caches.match('./file-handler.html');
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Fallback ke halaman file handler
      return new Response(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ELSA - File Handler</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📁 File Handler ELSA</h1>
                <p>File akan diproses oleh aplikasi ELSA.</p>
                <div id="file-info"></div>
            </div>
            <script>
                // JavaScript untuk menangani file akan ditambahkan di halaman asli
                console.log('File handler page loaded');
            </script>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // Untuk POST requests dengan file data
    return new Response(JSON.stringify({
      status: 'success',
      message: 'File received by ELSA',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
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

// ⭐ NEW: Handle Custom Protocol Requests
async function handleProtocolRequest(event) {
  try {
    const url = new URL(event.request.url);
    console.log('🔗 [SW] Processing protocol request:', url.toString());
    
    // Extract parameters dari protocol
    const linkParam = url.searchParams.get('link') || url.searchParams.get('url') || '';
    
    // Redirect ke halaman utama dengan parameter
    const redirectUrl = `./index.html?protocol=web+elsa&data=${encodeURIComponent(linkParam)}`;
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Redirecting...</title>
        <script>
          window.location.href = '${redirectUrl}';
        </script>
      </head>
      <body>
        <p>Mengarahkan ke ELSA...</p>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
    
  } catch (error) {
    console.error('❌ [SW] Protocol handler error:', error);
    
    // Fallback redirect
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <script>window.location.href = './index.html';</script>
      </head>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ⭐ NEW: Handle Share Target Requests
async function handleShareTargetRequest(event) {
  try {
    console.log('📤 [SW] Processing share target request...');
    
    // Untuk GET requests ke share-target.html
    if (event.request.method === 'GET') {
      const cachedResponse = await caches.match('./share-target.html');
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Fallback share target page
      return new Response(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ELSA - Share Content</title>
        </head>
        <body>
            <h1>📤 Berbagi Konten ke ELSA</h1>
            <p>Konten akan diproses...</p>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // Untuk POST requests dengan shared data
    if (event.request.method === 'POST') {
      const formData = await event.request.formData();
      const title = formData.get('title') || '';
      const text = formData.get('text') || '';
      const url = formData.get('url') || '';
      
      console.log('📤 [SW] Shared data received:', { title, text, url });
      
      // Simpan shared data untuk diproses nanti
      await saveSharedData({ title, text, url });
      
      // Redirect ke halaman utama dengan shared data
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <script>
            localStorage.setItem('sharedData', JSON.stringify({
              title: '${title.replace(/'/g, "\\'")}',
              text: '${text.replace(/'/g, "\\'")}', 
              url: '${url.replace(/'/g, "\\'")}',
              timestamp: '${new Date().toISOString()}'
            }));
            window.location.href = './index.html?source=share';
          </script>
        </head>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
  } catch (error) {
    console.error('❌ [SW] Share target error:', error);
    return new Response('Error processing share', { status: 500 });
  }
}

// Helper untuk save shared data
async function saveSharedData(data) {
  console.log('💾 [SW] Saving shared data:', data);
  
  // Kirim ke semua clients
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SHARED_DATA_RECEIVED',
      data: data
    });
  });
}