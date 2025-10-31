/* ============================
   ELSA PWA Service Worker v5.1 - ROBUST STATE
   ============================ */

const APP_VERSION = 'v2-FAQ-update';
const CACHE_NAME = `elsa-pwa-${APP_VERSION}`;
const STATIC_CACHE = `static-${APP_VERSION}`;
// --- UBAH INI ---
const PDF_CACHE = 'pdf-cache-user'; 
const STATE_CACHE = 'elsa-state-user'; 
// --- END UBAH ---
const MAX_STATIC_ITEMS = 100;
const MAX_PDF_ITEMS = 50;

const urlsToCache = [
  './',
  './fallback/offline.html',
  './fallback/index.html',
  './index.html',
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
  './icons/icons.svg',
  './data/books-metadata.json'
];

// ==================== STORAGE MANAGEMENT ====================
const STORAGE_KEYS = {
  LOCKED_BOOKS: 'elsa-locked-books',
  BOOK_PREFERENCES: 'elsa-book-preferences',
  READING_HISTORY: 'pendingPDFHistory'
};

// ==================== SW STATE HELPERS ====================

/**
 * Mengambil state (JSON) dari cache state internal SW.
 */
async function getStateFromCache(key) {
  try {
    const cache = await caches.open(STATE_CACHE);
    const response = await cache.match(key);
    if (response) {
      return await response.json();
    }
    return null; // Mengembalikan null jika tidak ditemukan
  } catch (error) {
    console.warn(`Failed to get state '${key}':`, error);
    return null;
  }
}

/**
 * Menulis state (JSON) ke cache state internal SW.
 */
async function setStateInCache(key, data) {
  try {
    const cache = await caches.open(STATE_CACHE);
    const response = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put(key, response);
    console.log(`✅ SW State updated: ${key}`);
    return true;
  } catch (error) {
    console.error(`Failed to set state '${key}':`, error);
    return false;
  }
}

// ==================== ENHANCED CACHE MANAGER ====================
class EnhancedCacheManager {
  
  // FUNGSI DUPLIKAT YANG LAMA TELAH DIHAPUS.
  
  static async limitCacheSize(cacheName, maxItems, strategy = 'auto_manage') {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      if (strategy === 'keep_all_books') {
        console.log('🛡️ Cache protection active - keeping all books');
        return { deleted: 0, kept: keys.length };
      }
      
      if (keys.length > maxItems) {
        // PERBAIKAN: Mengambil data dari state cache SW yang reliabel
        const lockedBooks = await getStateFromCache(STORAGE_KEYS.LOCKED_BOOKS) || [];
        
        const cleanupResult = await this.safeCacheCleanup(cacheName, maxItems, lockedBooks);
        console.log(`📊 Cache ${cacheName} limited: ${keys.length} → ${cleanupResult.kept}`);
        return cleanupResult;
      }
      
      return { deleted: 0, kept: keys.length };
    } catch (error) {
      console.warn('Error limiting cache:', error);
      return { deleted: 0, kept: 0 };
    }
  }

  static async safeCacheCleanup(cacheName, maxItems, lockedBookIds = []) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      // Get locked book URLs
      const lockedBookUrls = await this.getLockedBookUrls(lockedBookIds);
      
      const unlockedItems = keys.filter(key => !this.isLockedUrl(key.url, lockedBookUrls));
      const lockedItems = keys.filter(key => this.isLockedUrl(key.url, lockedBookUrls));
      
      console.log(`🔒 Locked items: ${lockedItems.length}, Unlocked: ${unlockedItems.length}`);
      
      if (unlockedItems.length > maxItems - lockedItems.length) {
        const itemsToDelete = unlockedItems.slice(0, unlockedItems.length - (maxItems - lockedItems.length));
        
        await Promise.all(itemsToDelete.map(key => {
          console.log(`🗑️ Deleting unlocked item: ${this.getFileNameFromUrl(key.url)}`);
          return cache.delete(key);
        }));
        
        console.log(`🧹 Deleted ${itemsToDelete.length} unlocked items, kept ${lockedItems.length} locked books`);
        return { deleted: itemsToDelete.length, kept: lockedItems.length };
      }
      
      return { deleted: 0, kept: keys.length };
    } catch (error) {
      console.error('Safe cache cleanup error:', error);
      return { deleted: 0, kept: 0 };
    }
  }

  // DI EnhancedCacheManager - Ini adalah versi yang benar (duplikat telah dihapus)
  static async getLockedBookUrls(lockedBookIds) {
    try {
      // PERBAIKAN: Validasi booksMetadata
      if (!lockedBookIds || lockedBookIds.length === 0) {
        return [];
      }
        
      const booksMetadata = await this.getBooksMetadata();
      const lockedUrls = [];
      
      if (!booksMetadata || typeof booksMetadata !== 'object') {
        console.warn('No books metadata available for locked URLs');
        return lockedUrls;
      }
      
      for (const classData of Object.values(booksMetadata)) {
        if (classData && Array.isArray(classData.books)) {
          for (const book of classData.books) {
            if (book && book.id && lockedBookIds.includes(book.id) && book.downloadUrl) {
              lockedUrls.push(book.downloadUrl);
            }
          }
        }
      }
      
      console.log(`🔒 Found ${lockedUrls.length} locked book URLs`);
      return lockedUrls;
    } catch (error) {
      console.warn('Failed to get locked book URLs:', error);
      return [];
    }
  }

  static async getBooksMetadata() {
    try {
      const cache = await caches.open(STATIC_CACHE);
      // Coba path yang paling mungkin
      let response = await cache.match('./data/books-metadata.json');
      if (!response) {
        response = await cache.match('data/books-metadata.json');
      }
      
      if (response) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Failed to get books metadata:', error);
    }
    return {};
  }

  static isLockedUrl(url, lockedUrls) {
    return lockedUrls.some(lockedUrl => {
      try {
        const urlObj = new URL(url);
        const lockedUrlObj = new URL(lockedUrl);
        return urlObj.pathname === lockedUrlObj.pathname;
      } catch {
        return url.includes(lockedUrl);
      }
    });
  }

  static async deleteCachedBook(bookUrl) {
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      const result = await pdfCache.delete(bookUrl);
      console.log(`🗑️ Book cache deleted: ${this.getFileNameFromUrl(bookUrl)}`, result);
      
      // Also try to delete from static cache if it exists there
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.delete(bookUrl);
      
      return result;
    } catch (error) {
      console.error('Error deleting cached book:', error);
      return false;
    }
  }

  static async clearAllCaches() {
    try {
      const cacheNames = await caches.keys();
      const deletePromises = cacheNames.map(name => caches.delete(name));
      await Promise.all(deletePromises);
      console.log('✅ All caches cleared');
      
      // Notify clients
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'CACHE_CLEARED',
          timestamp: Date.now()
        });
      });
      
      return true;
    } catch (error) {
      console.error('❌ Error clearing caches:', error);
      return false;
    }
  }

  static getFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.split('/').pop() || 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

// ==================== BOOK MANAGER INTEGRATION ====================
class BookManagerIntegration {
  static async handleBookCache(request, data) {
    try {
      console.log('📚 Caching book PDF:', data?.url);
      
      const pdfCache = await caches.open(PDF_CACHE);
      const response = new Response(data.content, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': data.content.byteLength.toString(),
          'X-Cached-At': Date.now().toString(),
          'X-Book-Type': 'downloaded',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
      
      await pdfCache.put(data.url, response);
      console.log('✅ Book PDF cached successfully:', data.url);
      
      // Limit cache size after adding new book
      await EnhancedCacheManager.limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS, 'auto_manage');
      
      return true;
    } catch (error) {
      console.error('❌ Book caching failed:', error);
      return false;
    }
  }

  static async getCachedBooks() {
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      const requests = await pdfCache.keys();
      const books = [];
      
      for (const request of requests) {
        try {
          const response = await pdfCache.match(request);
          if (response) {
            const cachedAt = response.headers.get('X-Cached-At');
            const bookType = response.headers.get('X-Book-Type');
            
            books.push({
              url: request.url,
              cachedAt: cachedAt ? parseInt(cachedAt) : Date.now(),
              filename: EnhancedCacheManager.getFileNameFromUrl(request.url),
              type: bookType || 'regular',
              size: (await response.clone().arrayBuffer()).byteLength
            });
          }
        } catch (bookError) {
          console.warn('Error processing book:', bookError);
        }
      }
      
      console.log(`📚 Found ${books.length} cached books`);
      return books;
    } catch (error) {
      console.error('Error getting cached books:', error);
      return [];
    }
  }

  static async isBookLocked(bookUrl) {
    try {
      // PERBAIKAN: Mengambil data dari state cache SW yang reliabel
      const lockedBooks = await getStateFromCache(STORAGE_KEYS.LOCKED_BOOKS) || [];
      const booksMetadata = await EnhancedCacheManager.getBooksMetadata();
      
      // Find book ID from URL
      if (booksMetadata) {
        for (const classData of Object.values(booksMetadata)) {
          for (const book of classData.books || []) {
            if (book.downloadUrl === bookUrl && lockedBooks.includes(book.id)) {
              return true;
            }
          }
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Error checking if book is locked:', error);
      return false;
    }
  }
}

// ==================== INTEGRITY CHECKER ====================
class StartupIntegrityChecker {
  // ... (Kelas ini tidak memiliki masalah kritis, dibiarkan apa adanya) ...
  constructor() {
    this.checked = false;
    this.cacheConfig = {
      static: STATIC_CACHE,
      pdf: PDF_CACHE
    };
  }
  
  async checkAllCachedAssets() {
    console.log('🎯 CHECKER: Starting integrity check...');
    
    if (this.checked || !(await this.isOnline())) {
      console.log('⏩ CHECKER: Skip - already checked or offline');
      return [];
    }
    
    this.checked = true;
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
        const isChanged = await this.isAssetChanged(request.url, cacheName);
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
  
  async isAssetChanged(url, cacheName = STATIC_CACHE) {
    try {
      if (!url.startsWith(self.location.origin)) return false;

      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(url);
      
      if (!cachedResponse) {
        console.log(`🆕 CHECKER: New asset not in cache: ${url}`);
        return true;
      }

      const headResponse = await fetch(url, { 
        method: 'HEAD', 
        cache: 'no-store' 
      }).catch(() => null);

      if (headResponse && headResponse.ok) {
        const remoteETag = headResponse.headers.get('ETag');
        const remoteLastModified = headResponse.headers.get('Last-Modified');
        
        const cachedETag = cachedResponse.headers.get('ETag');
        const cachedLastModified = cachedResponse.headers.get('Last-Modified');

        if (remoteETag && cachedETag && remoteETag !== cachedETag) {
          console.log(`🔄 CHECKER: ETag changed for ${url}`);
          await this.updateCachedAsset(url, cacheName);
          return true;
        }

        if (remoteLastModified && cachedLastModified && remoteLastModified !== cachedLastModified) {
          console.log(`🔄 CHECKER: Last-Modified changed for ${url}`);
          await this.updateCachedAsset(url, cacheName);
          return true;
        }
      }

      const isContentChanged = await this.isContentChanged(url, cachedResponse, cacheName);
      if (isContentChanged) {
        await this.updateCachedAsset(url, cacheName);
        return true;
      }

      return false;
      
    } catch (error) {
      console.error(`❌ CHECKER: Error checking asset ${url}:`, error);
      return false;
    }
  }
  
  async isContentChanged(url, cachedResponse, cacheName) {
    try {
      const networkResponse = await fetch(url, { cache: 'no-store' });
      if (!networkResponse || !networkResponse.ok) return false;

      const [remoteHash, cachedHash] = await Promise.all([
        this.computeHash(networkResponse.clone()),
        this.computeHash(cachedResponse.clone())
      ]);

      return remoteHash && cachedHash && remoteHash !== cachedHash;
    } catch (error) {
      console.warn(`⚠️ CHECKER: Content comparison failed for ${url}:`, error);
      return false;
    }
  }
  
  async computeHash(response) {
    try {
      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      console.warn('Hash compute failed', error);
      return null;
    }
  }
  
  async updateCachedAsset(url, cacheName) {
    try {
      const networkResponse = await fetch(url, { cache: 'no-store' });
      if (networkResponse && networkResponse.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(url, networkResponse);
        console.log(`✅ CHECKER: Updated cache for ${url}`);
        return true;
      }
    } catch (error) {
      console.error(`❌ CHECKER: Failed to update cache for ${url}:`, error);
    }
    return false;
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

  async isOnline() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${self.location.origin}/icons/icon-96x96.png`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response && response.ok;
    } catch (error) {
      return false;
    }
  }
}

const integrityChecker = new StartupIntegrityChecker();

// ==================== BACKGROUND SYNC MANAGER ====================
class BackgroundSyncManager {
  static async syncPDFHistory() {
    try {
      console.log('🔄 Starting PDF history sync...');
      
      // PERBAIKAN: Mengambil data dari state cache SW yang reliabel
      const pendingHistory = await getStateFromCache(STORAGE_KEYS.READING_HISTORY);
      
      if (!pendingHistory || pendingHistory.length === 0) {
        console.log('✅ No pending PDF history to sync');
        return;
      }
      
      console.log(`📚 Syncing ${pendingHistory.length} history items`);
      const success = await this.sendToServer('/api/history/sync', {
        type: 'pdf_history',
        items: pendingHistory
      });
      
      if (success) {
        // PERBAIKAN: Membersihkan state cache SW
        await this.clearPendingHistory();
        console.log('✅ PDF history synced successfully');
        this.notifySyncSuccess('PDF history');
      } else {
        throw new Error('Server rejected sync');
      }
      
    } catch (error) {
      console.error('❌ PDF history sync failed:', error);
      throw error;
    }
  }
  
  static async clearPendingHistory() {
    // PERBAIKAN: Hapus state dari cache SW, bukan mengirim pesan ke klien
    await setStateInCache(STORAGE_KEYS.READING_HISTORY, []);
    console.log('✅ Pending history cleared from SW state');
  }
  
  static async sendToServer(endpoint, data) {
    try {
      console.log('📤 Simulating server sync:', endpoint, data);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Math.random() > 0.1; // Sukses 90%
    } catch (error) {
      console.error('❌ Server sync error:', error);
      return false;
    }
  }
  
  static notifySyncSuccess(type) {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_COMPLETED',
          syncType: type,
          timestamp: Date.now()
        });
      });
    });
  }
}

// ==================== SERVICE WORKER EVENTS ====================

// Install Event
self.addEventListener('install', event => {
  console.log(`🟢 [SW ${APP_VERSION}] install - caching critical assets...`);

  event.waitUntil((async () => {
    try {
      // Buat cache state
      await caches.open(STATE_CACHE); 
      
      const cache = await caches.open(STATIC_CACHE);
      const results = [];

      for (const url of urlsToCache) {
        try {
          const response = await fetch(url, { 
            cache: 'no-cache',
            headers: { 'Cache-Control': 'no-cache' }
          });
          
          if (response && response.ok) {
            await cache.put(url, response);
            results.push({ url, status: 'success' });
            console.log(`✅ Cached: ${url}`);
          } else {
            results.push({ url, status: 'failed', error: `HTTP ${response?.status}` });
          }
        } catch (error) {
          results.push({ url, status: 'failed', error: error.message });
        }
      }

      const successCount = results.filter(r => r.status === 'success').length;
      console.log(`📊 Cache results: ${successCount}/${urlsToCache.length} successful`);
      
      if (successCount > 0) {
        self.skipWaiting();
        console.log('✅ SW installed successfully');
      } else {
        throw new Error('No assets could be cached');
      }
      
    } catch (error) {
      console.error('❌ Cache installation failed:', error);
    }
  })());
});

// Activate Event
// Activate Event (Kode Terakhir dan Lengkap)
self.addEventListener('activate', event => {
  console.log(`🟢 [SW ${APP_VERSION}] activating...`);
  
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      const newVersionCaches = [STATIC_CACHE, PDF_CACHE, STATE_CACHE]; 

      // Panggil Migrasi terlebih dahulu
      await migrateOldUserCaches(cacheNames); 

      // Lakukan Penghapusan Cache Versi Lama Statis
      await Promise.all(
        cacheNames.map(name => {
          // Hapus cache yang dimulai dengan 'elsa-pwa-' (prefix lama) 
          // atau 'static-' versi lama, dan bukan nama cache versi baru/permanen
          if (name.includes('elsa-pwa') && !newVersionCaches.includes(name)) {
            console.log('🗑️ Deleting old version-locked cache:', name);
            return caches.delete(name);
          }
        })
      );

      await self.clients.claim();
      // ... (kode lainnya) ...
      
    } catch (error) {
      console.error('❌ Activation failed:', error);
    }
  })());
});

// Message Event Handler
self.addEventListener('message', event => {
  const { type, data } = event.data || {};
  
  if (!type) return;

  console.log('📨 SW: Received message:', type, data);

  switch (type) {
    case 'SKIP_WAITING':
      console.log('🔔 SW: Skip waiting requested');
      self.skipWaiting();
      break;
      
    // PERBAIKAN: Handler baru untuk menerima state dari klien
    case 'UPDATE_SW_STATE':
      console.log('💾 SW: Updating state:', data?.key);
      if (data.key && data.value !== undefined) {
        event.waitUntil(setStateInCache(data.key, data.value));
      }
      break;
      
    case 'RUN_INTEGRITY_CHECK':
      console.log('🔍 SW: Running integrity check...');
      event.waitUntil(
        integrityChecker.checkAllCachedAssets().catch(err => {
          console.error('Integrity check error:', err);
        })
      );
      break;
      
    case 'CLEAR_CACHE':
      console.log('🗑️ SW: Clearing cache requested');
      event.waitUntil(EnhancedCacheManager.clearAllCaches());
      break;
      
    case 'GET_CACHE_STATUS':
      console.log('📊 SW: Cache status requested');
      event.ports[0]?.postMessage({
        type: 'CACHE_STATUS',
        staticCache: STATIC_CACHE,
        pdfCache: PDF_CACHE,
        version: APP_VERSION
      });
      break;
      
    case 'CACHE_BOOK_PDF':
      console.log('📚 SW: Caching book PDF:', data?.url);
      event.waitUntil(
        BookManagerIntegration.handleBookCache(event.request, data)
          .then(success => {
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({
                type: 'BOOK_CACHE_RESULT',
                success: success,
                url: data.url
              });
            }
          })
      );
      break;
      
    case 'GET_CACHED_BOOKS':
      console.log('📚 SW: Getting cached books list');
      event.waitUntil(
        BookManagerIntegration.getCachedBooks().then(books => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({
              type: 'CACHED_BOOKS_LIST',
              books: books
            });
          }
        })
      );
      break;

    case 'DELETE_CACHED_BOOK':
      console.log('🗑️ SW: Deleting cached book:', data?.url);
      event.waitUntil(
        EnhancedCacheManager.deleteCachedBook(data.url).then(success => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({
              type: 'BOOK_DELETE_RESULT',
              success: success,
              url: data.url
            });
          }
        })
      );
      break;

    // DIHAPUS: Case 'GET_STORAGE' yang lama dan tidak reliabel telah dihapus.
      
    default:
      console.log('📨 SW: Unknown message type:', type);
  }
});

// Fetch Event Handler
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') return;
  
  if (request.url.startsWith('chrome-extension://') ||
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }

  const router = {
    isFileHandler: url.search.includes('file-handler') || url.pathname.includes('/file-handler'),
    isProtocol: url.protocol === 'web+elsa:' || url.search.includes('web+elsa'),
    isPDF: url.pathname.endsWith('.pdf') || url.pathname.includes('/buku/'),
    isNavigation: request.mode === 'navigate',
    isShareTarget: url.pathname.includes('/share-target.html'),
    isBookMetadata: url.pathname.endsWith('books-metadata.json')
  };

  try {
    if (router.isFileHandler) {
      event.respondWith(handleFileHandlerRequest(event));
    } else if (router.isProtocol) {
      event.respondWith(handleProtocolRequest(event));
    } else if (router.isPDF || router.isBookMetadata) {
      // Penanganan khusus untuk PDF dan metadata buku
      event.respondWith(handlePDFRequest(event));
    } else if (router.isNavigation) {
      event.respondWith(handleNavigationRequest(event));
    } else if (router.isShareTarget) {
      event.respondWith(handleShareTargetRequest(event));
    } else {
      event.respondWith(handleStaticRequest(event));
    }
  } catch (error) {
    console.error('❌ Fetch handler error:', error);
    event.respondWith(handleFallbackResponse(request));
  }
});

// PDF Request Handler dengan Lock Protection
async function handlePDFRequest(event) {
  const { request } = event;
  const url = new URL(request.url);
  const fileName = EnhancedCacheManager.getFileNameFromUrl(request.url);

  try {
    // Check if this is a locked book
    const isLocked = await BookManagerIntegration.isBookLocked(request.url);
    if (isLocked) {
      console.log(`🛡️ Serving locked book: ${fileName}`);
    }

    // Try cache first
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedResponse = await pdfCache.match(request);
    
    if (cachedResponse) {
      // Stale-while-revalidate (HANYA jika tidak dikunci)
      if (!isLocked) { 
        event.waitUntil(
          updatePDFCache(request, pdfCache, fileName)
        );
      }
      return cachedResponse;
    }

    // Network fallback
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await pdfCache.put(request, networkResponse.clone());
      await EnhancedCacheManager.limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS, 'auto_manage');
      return networkResponse;
    }

    throw new Error(`Network response not OK: ${networkResponse?.status}`);
    
  } catch (error) {
    console.warn('❌ PDF fetch failed:', fileName, error);
    return new Response(JSON.stringify({
      error: 'PDF_UNAVAILABLE',
      message: 'PDF tidak dapat diakses',
      fileName,
      offline: !(await integrityChecker.isOnline())
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function updatePDFCache(request, cache, fileName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse);
      console.log(`✅ PDF cache updated: ${fileName}`);
    }
  } catch (error) {
    console.warn(`⚠️ PDF cache update failed: ${fileName}`, error);
  }
}

// Navigation Request Handler (Network first)
async function handleNavigationRequest(event) {
  const { request } = event;
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone()).catch(console.warn);
      return networkResponse;
    }
  } catch (error) {
    console.log('🌐 Network failed, falling back to cache:', request.url);
  }
  
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (error) {
    console.warn('❌ Cache match failed:', error);
  }
  
  return getOfflineFallback();
}

// Static Assets Handler (Cache first)
async function handleStaticRequest(event) {
  const { request } = event;
  
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(STATIC_CACHE)
        .then(cache => cache.put(request, clone))
        .then(() => EnhancedCacheManager.limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS, 'auto_manage'))
        .catch(console.warn);
    }
    
    return networkResponse;
    
  } catch (error) {
    console.warn('❌ Static asset failed:', request.url, error);
    return handleFallbackResponse(request);
  }
}

// ... (Generic Handlers: handleFileHandlerRequest, etc. tetap sama) ...
async function handleFileHandlerRequest(event) {
  return handleGenericHandler(event, 'file-handler', 'File Handler');
}
async function handleProtocolRequest(event) {
  return handleGenericHandler(event, 'protocol-handler', 'Protocol Handler');
}
async function handleShareTargetRequest(event) {
  return handleGenericHandler(event, 'share-target', 'Share Target');
}
async function handleGenericHandler(event, type, title) {
  try {
    const cachedResponse = await caches.match(`./${type}.html`);
    if (cachedResponse) return cachedResponse;
    
    return new Response(`... (HTML fallback untuk ${title}) ...`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    console.error(`❌ ${title} error:`, error);
    return new Response(JSON.stringify({ error: `${type.toUpperCase()}_ERROR` }), { status: 500 });
  }
}
// ... (Fallback Handlers: handleFallbackResponse, getOfflineFallback tetap sama) ...
async function handleFallbackResponse(request) {
  const url = request.url.toLowerCase();
  
  if (url.endsWith('.css')) {
    return new Response('/* CSS offline */', { headers: { 'Content-Type': 'text/css' } });
  }
  if (url.endsWith('.js')) {
    return new Response('// JS offline', { headers: { 'Content-Type': 'application/javascript' } });
  }
  if (url.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)) {
    return new Response('<svg></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
  }
  return getOfflineFallback();
}
async function getOfflineFallback() {
  try {
    const offlinePage = await caches.match('./fallback/offline.html');
    if (offlinePage) return offlinePage;
  } catch (error) { console.warn('Offline page not found'); }
  
  return new Response(`... (HTML fallback offline utama) ...`, {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// Sync Event Handler
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync triggered:', event.tag);
  
  switch (event.tag) {
    case 'sync-pdf-history':
      event.waitUntil(BackgroundSyncManager.syncPDFHistory());
      break;
      
    case 'sync-user-activity':
      event.waitUntil(BackgroundSyncManager.syncPDFHistory()); // Reuse
      break;
      
    case 'content-cleanup': // Tag ini dari periodicSync
      event.waitUntil(periodicCleanup());
      break;
      
    default:
      console.log('Unknown sync tag:', event.tag);
  }
});

// Periodic Cleanup
async function periodicCleanup() {
  try {
    const cleanupResults = await Promise.all([
      EnhancedCacheManager.limitCacheSize(STATIC_CACHE, MAX_STATIC_ITEMS, 'auto_manage'),
      EnhancedCacheManager.limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS, 'auto_manage') // Ini akan menggunakan getLockedBooksFromState
    ]);
    
    console.log('🧹 Periodic cleanup completed:', cleanupResults);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

// Tambahkan fungsi ini di luar event handler, misalnya di dekat verifyCacheHealth()

async function migrateOldUserCaches(cacheNames) {
  console.log('🔄 Starting user cache migration check...');

  // 1. Definisikan Cache Tujuan Permanen
  const permanentPdfCacheName = 'pdf-cache-user'; // PDF_CACHE yang baru
  const permanentStateCacheName = 'elsa-state-user'; // STATE_CACHE yang baru
  
  // Cache yang perlu dimigrasi adalah yang namanya dimulai dengan 'pdf-cache-' atau 'elsa-state-'
  // DAN TIDAK sama dengan nama cache permanen yang baru.
  const oldPdfCaches = cacheNames.filter(name => 
    name.startsWith('pdf-cache-') && name !== permanentPdfCacheName
  );
  const oldStateCaches = cacheNames.filter(name => 
    name.startsWith('elsa-state-') && name !== permanentStateCacheName
  );

  // --- Migrasi Data Buku (PDF) ---
  if (oldPdfCaches.length > 0) {
    console.log(`📦 Migrating ${oldPdfCaches.length} old PDF caches...`);
    const newPdfCache = await caches.open(permanentPdfCacheName);
    
    for (const oldName of oldPdfCaches) {
      try {
        const oldCache = await caches.open(oldName);
        const keys = await oldCache.keys();
        
        for (const key of keys) {
          const response = await oldCache.match(key);
          if (response) {
            // Salin item dari cache lama ke cache baru
            await newPdfCache.put(key, response.clone());
            console.log(`   ✅ Migrated PDF: ${EnhancedCacheManager.getFileNameFromUrl(key.url)}`);
          }
        }
        // Setelah berhasil disalin, hapus cache lama
        await caches.delete(oldName);
        console.log(`   🗑️ Deleted old PDF cache: ${oldName}`);
      } catch (error) {
        console.error(`❌ Failed to migrate PDF cache ${oldName}:`, error);
      }
    }
  }

  // --- Migrasi Data State (Metadata Kunci) ---
  if (oldStateCaches.length > 0) {
    console.log(`🔑 Migrating ${oldStateCaches.length} old state caches...`);
    const newStateCache = await caches.open(permanentStateCacheName);
    
    // Kita hanya perlu memigrasi item kunci 'elsa-locked-books' dan 'pendingPDFHistory'
    const keysToMigrate = [STORAGE_KEYS.LOCKED_BOOKS, STORAGE_KEYS.READING_HISTORY];

    for (const oldName of oldStateCaches) {
      try {
        const oldCache = await caches.open(oldName);
        for (const stateKey of keysToMigrate) {
          const response = await oldCache.match(stateKey);
          if (response) {
             // Cek apakah data sudah ada di cache baru. Jika belum, salin.
             const isPresent = await newStateCache.match(stateKey);
             if (!isPresent) {
                await newStateCache.put(stateKey, response.clone());
                console.log(`   ✅ Migrated State Key: ${stateKey} from ${oldName}`);
             } else {
                console.log(`   ⚠️ State Key ${stateKey} already exists in permanent cache. Skipping.`);
             }
          }
        }
        // Setelah mencoba migrasi, hapus cache state lama
        await caches.delete(oldName);
        console.log(`   🗑️ Deleted old State cache: ${oldName}`);
      } catch (error) {
        console.error(`❌ Failed to migrate State cache ${oldName}:`, error);
      }
    }
  }
  
  console.log('✅ User cache migration check completed.');
}

// Cache Health Check
async function verifyCacheHealth() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    const criticalUrls = ['./index.html', './fallback/offline.html', './manifest.json'];
    
    let missing = [];
    for (const url of criticalUrls) {
      const response = await cache.match(url);
      if (!response) {
        missing.push(url);
        try {
          await cache.add(url);
          console.log('✅ Re-cached missing critical asset:', url);
        } catch (error) {
          console.warn('❌ Failed to re-cache:', url, error);
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

console.log(`✅ ELSA Enhanced Service Worker ${APP_VERSION} loaded successfully`);