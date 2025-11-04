/* ============================
   ELSA PWA Service Worker v5.3 - FIXED MANIFEST CACHE + ICON UPDATE
   ============================ */

// --- PERUBAHAN: Versi dinaikkan untuk memicu update ---
const APP_VERSION = 'v1.3';
const CACHE_NAME = `elsa-pwa-${APP_VERSION}`;
const STATIC_CACHE = `static-v1.3`; // Nama statis untuk cache utama
const PDF_CACHE = 'pdf-cache-user'; 
const STATE_CACHE = 'elsa-state-user'; 
const MAX_STATIC_ITEMS = 100;
const MAX_PDF_ITEMS = 50;

const urlsToCache = [
  './',
  './fallback/offline.html',
  './fallback/index.html',
  './index.html',
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
    return null;
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

function canonicalJSON(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(key => JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
  return '{' + parts.join(',') + '}';
}

// ==================== ENHANCED CACHE MANAGER ====================
class EnhancedCacheManager {
  
  static async limitCacheSize(cacheName, maxItems, strategy = 'auto_manage') {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      if (strategy === 'keep_all_books') {
        console.log('🛡️ Cache protection active - keeping all books');
        return { deleted: 0, kept: keys.length };
      }
      
      if (keys.length > maxItems) {
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

  static async getLockedBookUrls(lockedBookIds) {
    try {
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
            if (book && book.id && lockedBookIds.includes(book.id)) {
                if (book.downloadUrl) {
                  lockedUrls.push(book.downloadUrl);
                }
                
                if (book.oldDownloadUrls && Array.isArray(book.oldDownloadUrls)) {
                  book.oldDownloadUrls.forEach(oldUrl => {
                    if (oldUrl) lockedUrls.push(oldUrl);
                  });
                }
            }
          }
        }
      }
      
      console.log(`🔒 Found ${lockedUrls.length} locked book URLs (termasuk versi lama)`);
      return lockedUrls;
    } catch (error) {
      console.warn('Failed to get locked book URLs:', error);
      return [];
    }
  }

  static async getBooksMetadata() {
    try {
      const cache = await caches.open(STATIC_CACHE);
      let response = await cache.match('./data/books-metadata.json');
      if (!response) {
        response = await cache.match('data/books-metadata.json');
      }
      
      if (response) {
        let metadata = null;
        try {
            metadata = await response.json();
        } catch (e) {
            console.warn('SW: .json() failed, reading as text.');
            const metadataText = await response.text();
            try {
                metadata = JSON.parse(metadataText);
            } catch (parseError) {
                console.warn('SW: JSON.parse(text) failed, cleaning string.');
                const cleanedString = metadataText.substring(metadataText.indexOf('{'), metadataText.lastIndexOf('}') + 1);
                metadata = JSON.parse(cleanedString);
            }
        }

        const normalizedMetadata = {};
        if (!metadata || typeof metadata !== 'object') {
             console.warn('SW: Metadata is not an object.');
             return {};
        }
        
        for (const [classId, classData] of Object.entries(metadata)) {
            if (classData && classData.title && !classData.books) {
                 const nestedKey = Object.keys(classData).find(k => k.startsWith('{'));
                 if (nestedKey) {
                    try {
                        const nestedData = JSON.parse(nestedKey);
                        normalizedMetadata[classId] = {
                            title: classData.title,
                            books: nestedData.books
                        };
                    } catch (e) {
                         console.warn(`SW: Gagal parse nested JSON key di ${classId}`);
                         normalizedMetadata[classId] = classData;
                    }
                 } else {
                     normalizedMetadata[classId] = classData;
                 }
            } else {
                 normalizedMetadata[classId] = classData;
            }
        }
        console.log('SW: Metadata normalized.');
        return normalizedMetadata;
      }
    } catch (error) {
      console.warn('Failed to get books metadata:', error);
    }
    return {};
  }

  static isLockedUrl(url, lockedUrls) {
    const normalizedUrl = new URL(url).pathname;
    return lockedUrls.some(lockedUrl => {
      try {
        const normalizedLockedUrl = new URL(lockedUrl, self.location.origin).pathname;
        return normalizedUrl === normalizedLockedUrl;
      } catch (e) {
        return url.includes(lockedUrl);
      }
    });
  }

  static async deleteCachedBook(bookUrl) {
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      const absoluteUrl = new URL(bookUrl, self.location.origin).href;
      
      const result1 = await pdfCache.delete(bookUrl);
      const result2 = await pdfCache.delete(absoluteUrl);
      
      const success = result1 || result2;
      console.log(`🗑️ Book cache deleted: ${this.getFileNameFromUrl(bookUrl)}`, success);
      
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.delete(bookUrl);
      await staticCache.delete(absoluteUrl);
      
      return success;
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
      
      const absoluteUrl = new URL(data.url, self.location.origin).href;
      await pdfCache.put(absoluteUrl, response);
      
      console.log('✅ Book PDF cached successfully:', absoluteUrl);
      
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
      const lockedBooks = await getStateFromCache(STORAGE_KEYS.LOCKED_BOOKS) || [];
      const booksMetadata = await EnhancedCacheManager.getBooksMetadata();
      
      const normalizedBookUrl = new URL(bookUrl, self.location.origin).pathname;

      if (booksMetadata) {
        for (const classData of Object.values(booksMetadata)) {
          for (const book of classData.books || []) {
            if (!book || !book.id || !lockedBooks.includes(book.id)) {
                continue;
            }
            
            if (book.downloadUrl) {
                 const normalizedNewUrl = new URL(book.downloadUrl, self.location.origin).pathname;
                 if (normalizedNewUrl === normalizedBookUrl) return true;
            }
            
            if (book.oldDownloadUrls && Array.isArray(book.oldDownloadUrls)) {
                for (const oldUrl of book.oldDownloadUrls) {
                    const normalizedOldUrl = new URL(oldUrl, self.location.origin).pathname;
                    if (normalizedOldUrl === normalizedBookUrl) return true;
                }
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
  constructor() {
    this.suppressNotifications = false;
  }

  async checkAllCachedAssets() {
    const assetsToCheck = [
      './data/books-metadata.json'
      // manifest.json dihapus dari sini karena sudah ada handler khusus
    ];

    const changedAssets = [];
    for (const assetUrl of assetsToCheck) {
      const hasChanges = await this.checkAsset(assetUrl);
      if (hasChanges) {
        changedAssets.push(assetUrl);
      }
    }

    if (changedAssets.length > 0 && !this.suppressNotifications) {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({
          type: 'STARTUP_UPDATES_DETECTED',
          assets: changedAssets,
          hasChanges: true
        }));
      });
    }

    return changedAssets.length > 0;
  }

  async checkAsset(assetUrl) {
    try {
      const cache = await caches.open(STATIC_CACHE);
      const cachedResponse = await cache.match(assetUrl);
      if (!cachedResponse) return false;

      const headResponse = await fetch(assetUrl, { method: 'HEAD' });
      const netLastMod = headResponse.headers.get('Last-Modified');
      const cacheLastMod = cachedResponse.headers.get('Last-Modified');
      const netEtag = headResponse.headers.get('etag');
      const cacheEtag = cachedResponse.headers.get('etag');

      if ((netLastMod && cacheLastMod === netLastMod) || (netEtag && cacheEtag === netEtag)) {
        return false;
      }

      const networkResponse = await fetch(assetUrl);
      if (!networkResponse.ok) return false;

      const oldData = await cachedResponse.json();
      const newData = await networkResponse.json();
      const hasChanges = canonicalJSON(oldData) !== canonicalJSON(newData);

      if (hasChanges) {
        await cache.put(assetUrl, networkResponse.clone());
      }

      return hasChanges;
    } catch (error) {
      console.warn(`Failed to check asset ${assetUrl}:`, error);
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
    await setStateInCache(STORAGE_KEYS.READING_HISTORY, []);
    console.log('✅ Pending history cleared from SW state');
  }
  
  static async sendToServer(endpoint, data) {
    try {
      console.log('📤 Simulating server sync:', endpoint, data);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Math.random() > 0.1;
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

// ==================== SPECIALIZED HANDLERS ====================

/**
 * Handler khusus untuk manifest.json - NETWORK FIRST + NO CACHE
 */
async function handleManifestRequest(event) {
  const { request } = event;
  console.log('📄 Manifest request handler triggered');
  
  try {
    // Selalu coba ambil dari network terlebih dahulu
    const networkResponse = await fetch(request, {
      cache: 'no-cache',
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    if (networkResponse && networkResponse.ok) {
      console.log('✅ Manifest fetched from network, updating cache');
      
      // Update cache dengan versi terbaru
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, networkResponse.clone());
      
      // Notify clients tentang update manifest
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'MANIFEST_UPDATED',
            timestamp: Date.now()
          });
        });
      });
      
      return networkResponse;
    }
  } catch (error) {
    console.log('🌐 Manifest network failed, falling back to cache');
  }
  
  // Fallback ke cache jika network gagal
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('📄 Manifest served from cache');
      return cachedResponse;
    }
  } catch (cacheError) {
    console.warn('❌ Manifest cache match failed:', cacheError);
  }
  
  // Ultimate fallback - return empty manifest
  console.log('⚠️ Using fallback manifest');
  return new Response(JSON.stringify({
    name: "ELSA",
    short_name: "ELSA",
    start_url: "./",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000"
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}

/**
 * Handler untuk metadata books (Stale While Revalidate)
 */
async function handleMetadataRequest(event) {
  const { request } = event;
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);

  event.waitUntil((async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const networkResponse = await fetch(request, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (networkResponse && networkResponse.ok) {
        const netEtag = networkResponse.headers.get('etag');
        const cacheEtag = cachedResponse?.headers.get('etag');
        let hasChanges = true;

        if (netEtag && cacheEtag === netEtag) {
          hasChanges = false;
        } else if (cachedResponse) {
          const oldData = await cachedResponse.json();
          const newData = await networkResponse.json();
          hasChanges = canonicalJSON(oldData) !== canonicalJSON(newData);
        }

        await cache.put(request, networkResponse.clone());

        if (hasChanges) {
          self.clients.matchAll().then(clients => {
            clients.forEach(c => c.postMessage({
              type: 'STARTUP_UPDATES_DETECTED',
              assets: [request.url],
              hasChanges: true
            }));
          });
        }
      }
    } catch (e) { /* ignore network errors for SWR */ }
  })());

  return cachedResponse ?? (await fetch(request));
}

// PDF Request Handler dengan Lock Protection
async function handlePDFRequest(event) {
  const { request } = event;
  const url = new URL(request.url);
  const fileName = EnhancedCacheManager.getFileNameFromUrl(request.url);
  
  const absoluteUrl = new URL(request.url, self.location.origin).href;
  const cacheKey = new Request(absoluteUrl, request);

  try {
    const isLocked = await BookManagerIntegration.isBookLocked(request.url);
    if (isLocked) {
      console.log(`🛡️ Serving locked book: ${fileName}`);
    }

    const pdfCache = await caches.open(PDF_CACHE);
    const cachedResponse = await pdfCache.match(cacheKey);
    
    if (cachedResponse) {
      if (!isLocked) { 
        event.waitUntil(
          updatePDFCache(cacheKey, pdfCache, fileName)
        );
      }
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await pdfCache.put(cacheKey, networkResponse.clone());
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
      offline: !navigator.onLine
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

// Static Assets Handler (Cache first) - TAPI exclude manifest
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

// Generic Handlers
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

// Fallback Handlers
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
    status: 200, 
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
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
          // JANGAN cache manifest.json secara agresif di install
          if (url.includes('manifest.json')) {
            results.push({ url, status: 'skipped' });
            continue;
          }
          
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
      console.log(`📊 Cache results: ${successCount}/${urlsToCache.length - 1} successful (manifest skipped)`);
      
      if (successCount > 0) {
        // Force skip waiting untuk immediate update
        self.skipWaiting();
        
        // Broadcast update ke clients
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: APP_VERSION,
            timestamp: Date.now()
          });
        });
        
        console.log('✅ SW installed successfully with forced update');
      } else {
        throw new Error('No assets could be cached');
      }
      
    } catch (error) {
      console.error('❌ Cache installation failed:', error);
    }
  })());
});

// Activate Event
self.addEventListener('activate', event => {
  console.log(`🟢 [SW ${APP_VERSION}] activating...`);
  
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      const newVersionCaches = [STATIC_CACHE, PDF_CACHE, STATE_CACHE]; 

      // Migrasi cache lama
      await migrateOldUserCaches(cacheNames); 

      // Hapus cache versi lama
      await Promise.all(
        cacheNames.map(name => {
          if ((name.startsWith('elsa-pwa-') || name.startsWith('static-')) && !newVersionCaches.includes(name)) {
            console.log('🗑️ Deleting old version-locked cache:', name);
            return caches.delete(name);
          }
          return null;
        })
      );

      // HAPUS CACHE MANIFEST LAMA secara spesifik
      const cache = await caches.open(STATIC_CACHE);
      await cache.delete('./manifest.json');
      await cache.delete('manifest.json');
      console.log('✅ Old manifest cache cleared');

      await self.clients.claim();
      console.log('✅ SW activated and claimed clients');
      
      // Jalankan pengecekan integritas
      integrityChecker.checkAllCachedAssets().catch(console.error);
      
    } catch (error) {
      console.error('❌ Activation failed:', error);
    }
  })());
});

// Fetch Event Handler - DIPERBAIKI dengan handler manifest khusus
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') return;
  
  // Abaikan request yang tidak relevan
  if (request.url.startsWith('chrome-extension://') ||
      request.url.startsWith('data:') ||
      !request.url.startsWith(self.location.origin)) {
    return;
  }

  const router = {
    isManifest: url.pathname.endsWith('/manifest.json'), // PRIORITAS: Handler khusus manifest
    isFileHandler: url.search.includes('file-handler') || url.pathname.includes('/file-handler'),
    isProtocol: url.protocol === 'web+elsa:' || url.search.includes('web+elsa'),
    isPDF: url.pathname.endsWith('.pdf') || url.pathname.includes('/buku/'),
    isNavigation: request.mode === 'navigate',
    isShareTarget: url.pathname.includes('/share-target.html'),
    isBookMetadata: url.pathname.endsWith('books-metadata.json')
  };

  try {
    if (router.isManifest) {
      event.respondWith(handleManifestRequest(event));
    } else if (router.isFileHandler) {
      event.respondWith(handleFileHandlerRequest(event));
    } else if (router.isProtocol) {
      event.respondWith(handleProtocolRequest(event));
    } else if (router.isPDF) {
      event.respondWith(handlePDFRequest(event));
    } else if (router.isBookMetadata) {
      event.respondWith(handleMetadataRequest(event));
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
      
    case 'REFRESH_MANIFEST': // HANDLER BARU untuk refresh manifest
      console.log('🔄 Manually refreshing manifest cache');
      event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
          return cache.delete('./manifest.json')
            .then(() => cache.delete('manifest.json'))
            .then(() => {
              console.log('✅ Manifest cache cleared manually');
              // Notify clients
              self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                  client.postMessage({
                    type: 'MANIFEST_REFRESHED',
                    timestamp: Date.now()
                  });
                });
              });
            });
        })
      );
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
      
    default:
      console.log('📨 SW: Unknown message type:', type);
  }
});

// Sync Event Handler
self.addEventListener('sync', event => {
  console.log('🔄 Background Sync triggered:', event.tag);
  
  switch (event.tag) {
    case 'sync-pdf-history':
      event.waitUntil(BackgroundSyncManager.syncPDFHistory());
      break;
      
    case 'sync-user-activity':
      event.waitUntil(BackgroundSyncManager.syncPDFHistory());
      break;
      
    case 'content-cleanup':
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
      EnhancedCacheManager.limitCacheSize(PDF_CACHE, MAX_PDF_ITEMS, 'auto_manage')
    ]);
    
    console.log('🧹 Periodic cleanup completed:', cleanupResults);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

// Migrasi Cache Lama
async function migrateOldUserCaches(cacheNames) {
  console.log('🔄 Starting user cache migration check...');

  const permanentPdfCacheName = 'pdf-cache-user';
  const permanentStateCacheName = 'elsa-state-user';
  
  const oldPdfCaches = cacheNames.filter(name => 
    name.startsWith('pdf-cache-') && name !== permanentPdfCacheName
  );
  const oldStateCaches = cacheNames.filter(name => 
    name.startsWith('elsa-state-') && name !== permanentStateCacheName
  );

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
            await newPdfCache.put(key, response.clone());
            console.log(`   ✅ Migrated PDF: ${EnhancedCacheManager.getFileNameFromUrl(key.url)}`);
          }
        }
        await caches.delete(oldName);
        console.log(`   🗑️ Deleted old PDF cache: ${oldName}`);
      } catch (error) {
        console.error(`❌ Failed to migrate PDF cache ${oldName}:`, error);
      }
    }
  }

  if (oldStateCaches.length > 0) {
    console.log(`🔑 Migrating ${oldStateCaches.length} old state caches...`);
    const newStateCache = await caches.open(permanentStateCacheName);
    
    const keysToMigrate = [STORAGE_KEYS.LOCKED_BOOKS, STORAGE_KEYS.READING_HISTORY];

    for (const oldName of oldStateCaches) {
      try {
        const oldCache = await caches.open(oldName);
        for (const stateKey of keysToMigrate) {
          const response = await oldCache.match(stateKey);
          if (response) {
             const isPresent = await newStateCache.match(stateKey);
             if (!isPresent) {
                await newStateCache.put(stateKey, response.clone());
                console.log(`   ✅ Migrated State Key: ${stateKey} from ${oldName}`);
             } else {
                console.log(`   ⚠️ State Key ${stateKey} already exists in permanent cache. Skipping.`);
             }
          }
        }
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
    const criticalUrls = ['./index.html', './fallback/offline.html'];
    
    let missing = [];
    for (const url of criticalUrls) {
      const response = await cache.match(url);
      if (!response) {
        missing.push(url);
        try {
          const netResponse = await fetch(url, { cache: 'no-cache' });
          if (netResponse.ok) {
              await cache.put(url, netResponse);
              console.log('✅ Re-cached missing critical asset:', url);
          }
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

console.log(`✅ ELSA Enhanced Service Worker ${APP_VERSION} loaded with MANIFEST FIX`);