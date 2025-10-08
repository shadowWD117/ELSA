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
  './fallback/offline.html',
  './sw-offline.js'
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
        console.log('✅ [OFFLINE SUPPORT] App shell successfully cached for offline use');
        
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
// Di messaging section yang sudah ada, tambahkan:
// Di messaging section, pastikan seperti ini:
self.addEventListener('message', event => {
  const data = event.data;
  console.log('📨 SW: Received message:', data);
  
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') {
    console.log('🔔 SW: Received SKIP_WAITING message — calling skipWaiting()');
    self.skipWaiting();
  }
  
  // Handle manual sync requests
  if (data.type === 'MANUAL_SYNC_REQUEST') {
    console.log('🔄 SW: Manual sync requested');
    event.waitUntil(
      performBackgroundSync().then(result => {
        // ✅ FIX: Gunakan event.ports dengan safety check
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({
            type: 'MANUAL_SYNC_RESULT',
            result: result
          });
        }
      })
    );
  }
  
  // Handle PDF progress updates
  if (data.type === 'PDF_PROGRESS_UPDATE') {
    console.log('📊 SW: PDF progress update received:', data.progress);
    
    // Simpan progress untuk sync nanti
    event.waitUntil(
      savePDFProgress(data.progress).then(() => {
        // Trigger background sync untuk PDF metadata
        return self.registration.sync.register('pdf-metadata-sync');
      }).then(() => {
        console.log('✅ PDF progress sync scheduled');
      }).catch(err => {
        console.log('❌ PDF progress sync failed:', err);
      })
    );
  }
});

// Helper untuk save PDF progress
async function savePDFProgress(progress) {
  // Simpan ke IndexedDB atau storage
  console.log('💾 Saving PDF progress:', progress);
  
  // Simpan ke localStorage simulation (di real app bisa pakai IndexedDB)
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
setInterval(periodicCleanup, 24 * 60 * 60 * 1000);

console.log('🚀 SW: Service Worker loaded successfully');

// ======== ✅ PERIODIC SYNC IMPLEMENTATION ========

// Periodic Sync Event Handler
self.addEventListener('periodicsync', event => {
  console.log('🔄 Periodic Sync triggered:', event.tag);
  
  if (event.tag === 'content-update') {
    event.waitUntil(
      performBackgroundSync()
    );
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

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(windowClients => {
        // Focus existing window or open new one
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  }
});

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

async function getUserDataFromStorage() {
  // Get user data from localStorage or IndexedDB
  const userName = localStorage.getItem('userName');
  const userSettings = localStorage.getItem('userSettings');
  
  return userName || userSettings ? { userName, userSettings } : null;
}

async function syncToBackend(userData) {
  console.log('🌐 Syncing to backend:', userData);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 300));
  return true; // Simulate success
}

async function clearSyncedUserData() {
  console.log('✅ User data cleared after sync');
}

async function getPDFProgressFromStorage() {
  // Get PDF progress from storage
  const progress = localStorage.getItem('pdfProgress');
  return progress ? JSON.parse(progress) : [];
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

// Background Sync Event Handler - ENHANCED
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
      
    default:
      console.log('Unknown sync tag:', event.tag);
  }
});

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

async function getPendingPDFHistory() {
  // Get from IndexedDB atau localStorage
  return new Promise((resolve) => {
    const history = JSON.parse(localStorage.getItem('pendingPDFHistory') || '[]');
    console.log('📖 Pending PDF history:', history.length);
    resolve(history);
  });
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

async function clearSyncedPDFHistory(syncedHistory) {
  const currentHistory = JSON.parse(localStorage.getItem('pendingPDFHistory') || '[]');
  
  // Remove only synced items
  const syncedIds = syncedHistory.map(item => item.id);
  const remainingHistory = currentHistory.filter(item => !syncedIds.includes(item.id));
  
  localStorage.setItem('pendingPDFHistory', JSON.stringify(remainingHistory));
  console.log('🧹 Cleared synced PDF history, remaining:', remainingHistory.length);
}

async function getPendingUserActivity() {
  return JSON.parse(localStorage.getItem('pendingUserActivity') || '[]');
}

async function sendUserActivityToServer(activity) {
  console.log('🌐 Sending user activity to server:', activity.length, 'items');
  await new Promise(resolve => setTimeout(resolve, 500));
  return true; // Simulate success
}

async function clearSyncedUserActivity(activity) {
  localStorage.removeItem('pendingUserActivity');
}

async function getFailedRequests() {
  return JSON.parse(localStorage.getItem('failedRequests') || '[]');
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
  const requests = JSON.parse(localStorage.getItem('failedRequests') || '[]');
  const updatedRequests = requests.filter(req => req.id !== requestId);
  localStorage.setItem('failedRequests', JSON.stringify(updatedRequests));
}

// ======== ✅ PUSH NOTIFICATIONS IMPLEMENTATION ========

// Push Event Handler - Terima push notifications
self.addEventListener('push', event => {
  console.log('📨 Push notification received:', event);
  
  // Parse push data
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
  
  // Tampilkan notification
  event.waitUntil(
    self.registration.showNotification(data.title || 'ELSA', {
      body: data.body || 'You have new updates',
      icon: data.icon || './icons/icon-192x192.png',
      badge: './icons/icon-96x96.png',
      image: data.image,
      data: data,
      actions: data.actions || [
        {
          action: 'open-app',
          title: 'Buka Aplikasi',
          icon: './icons/icon-96x96.png'
        },
        {
          action: 'dismiss',
          title: 'Tutup',
          icon: './icons/icon-96x96.png'
        }
      ],
      tag: data.tag || 'elsa-update',
      requireInteraction: data.requireInteraction || false,
      vibrate: [200, 100, 200] // Vibrate pattern
    })
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
  console.log('👆 Notification clicked:', event.notification.data);
  
  event.notification.close();
  
  const notificationData = event.notification.data || {};
  const action = event.action;
  
  // Handle different actions
  if (action === 'open-app' || action === '') {
    // Default action - open app
    event.waitUntil(
      clients.matchAll({ 
        type: 'window', 
        includeUncontrolled: true 
      }).then(clientList => {
        // Cari window yang sudah terbuka
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            console.log('🎯 Focusing existing window:', client.url);
            return client.focus();
          }
        }
        
        // Buka window baru jika tidak ada yang terbuka
        if (clients.openWindow) {
          console.log('🚀 Opening new window');
          return clients.openWindow('./');
        }
      })
    );
  } else if (action === 'view-content' && notificationData.url) {
    // Open specific content
    event.waitUntil(
      clients.openWindow(notificationData.url)
    );
  } else if (action === 'dismiss') {
    // Do nothing - notification already closed
    console.log('❌ Notification dismissed');
  }
  
  // Send analytics atau track click
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
  return JSON.parse(localStorage.getItem('pendingNotificationStatus') || '[]');
}

async function sendNotificationStatusToServer(status) {
  console.log('🌐 Sending notification status to server:', status);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));
  return true;
}

async function clearSyncedNotificationStatus(status) {
  localStorage.removeItem('pendingNotificationStatus');
}