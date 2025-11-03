/* ============================
   ELSA PWA Service Worker v5.2 - ROBUST STATE + UPDATE LOGIC
   ============================ */

// --- PERUBAHAN: Versi dinaikkan untuk memicu update ---
// Gunakan version yang stabil
const APP_VERSION = 'v5.2-final';
const CACHE_NAME = `elsa-pwa-${APP_VERSION}`;
const STATIC_CACHE = `static-v5`; // Nama statis untuk cache utama
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
  './data/books-metadata.json' // Pastikan ini di-cache ulang saat install
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

// Tambahkan fungsi ini di atas class EnhancedCacheManager
function canonicalJSON(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();  // Sort keys alphabetically
  const parts = keys.map(key => JSON.stringify(key) + ':' + canonicalJSON(obj[key]));
  return '{' + parts.join(',') + '}';
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
      
      // Get locked book URLs (versi baru yang sudah diperbaiki)
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

  /**
   * --- PERUBAHAN ---
   * Diperbarui untuk melindungi URL baru (downloadUrl) DAN URL lama (oldDownloadUrls)
   * agar buku yang "needs update" tidak terhapus otomatis jika dikunci.
   */
  static async getLockedBookUrls(lockedBookIds) {
    try {
      if (!lockedBookIds || lockedBookIds.length === 0) {
        return [];
      }
        
      const booksMetadata = await this.getBooksMetadata(); // Menggunakan fungsi baru
      const lockedUrls = [];
      
      if (!booksMetadata || typeof booksMetadata !== 'object') {
        console.warn('No books metadata available for locked URLs');
        return lockedUrls;
      }
      
      for (const classData of Object.values(booksMetadata)) {
        if (classData && Array.isArray(classData.books)) {
          for (const book of classData.books) {
            // Cek apakah buku ini ada di daftar ID yang dikunci
            if (book && book.id && lockedBookIds.includes(book.id)) {
                
                // 1. Lindungi URL baru (wajib)
                if (book.downloadUrl) {
                  lockedUrls.push(book.downloadUrl);
                }
                
                // 2. Lindungi juga SEMUA URL lama jika ada
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

  /**
   * --- PERUBAHAN ---
   * Ditambahkan logika parsing dan normalisasi JSON yang robust
   * untuk menangani format file metadata yang tidak standar.
   */
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
            // Coba parse sebagai JSON dulu
            metadata = await response.json();
        } catch (e) {
            // Jika gagal (seperti pada metadata yang di-upload), baca sebagai teks
            console.warn('SW: .json() failed, reading as text.');
            const metadataText = await response.text();
            // Coba parse teks
            try {
                metadata = JSON.parse(metadataText);
            } catch (parseError) {
                // Jika masih gagal, coba bersihkan
                console.warn('SW: JSON.parse(text) failed, cleaning string.');
                const cleanedString = metadataText.substring(metadataText.indexOf('{'), metadataText.lastIndexOf('}') + 1);
                metadata = JSON.parse(cleanedString);
            }
        }

        // --- BARU: Normalisasi struktur metadata (copy dari app.js) ---
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
    return {}; // Fallback
  }


  static isLockedUrl(url, lockedUrls) {
    // Normalisasi URL dari cache (mis: ..././buku/...)
    const normalizedUrl = new URL(url).pathname;

    return lockedUrls.some(lockedUrl => {
      try {
        // Normalisasi URL dari metadata (mis: ./buku/...)
        const normalizedLockedUrl = new URL(lockedUrl, self.location.origin).pathname;
        return normalizedUrl === normalizedLockedUrl;
      } catch (e) {
        // Fallback
        return url.includes(lockedUrl);
      }
    });
  }

  static async deleteCachedBook(bookUrl) {
    try {
      const pdfCache = await caches.open(PDF_CACHE);
      // Gunakan URL absolut untuk menghapus
      const absoluteUrl = new URL(bookUrl, self.location.origin).href;
      
      // Coba hapus dengan URL asli dan URL absolut
      const result1 = await pdfCache.delete(bookUrl);
      const result2 = await pdfCache.delete(absoluteUrl);
      
      const success = result1 || result2;
      console.log(`🗑️ Book cache deleted: ${this.getFileNameFromUrl(bookUrl)}`, success);
      
      // Coba hapus juga dari static cache jika ada
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
      
      // Gunakan URL absolut sebagai key
      const absoluteUrl = new URL(data.url, self.location.origin).href;
      await pdfCache.put(absoluteUrl, response);
      
      console.log('✅ Book PDF cached successfully:', absoluteUrl);
      
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
              url: request.url, // Kembalikan URL absolut yang di-cache
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
      const booksMetadata = await EnhancedCacheManager.getBooksMetadata(); // Pakai fungsi baru
      
      const normalizedBookUrl = new URL(bookUrl, self.location.origin).pathname;

      // Find book ID from URL
      if (booksMetadata) {
        for (const classData of Object.values(booksMetadata)) {
          for (const book of classData.books || []) {
            if (!book || !book.id || !lockedBooks.includes(book.id)) {
                continue;
            }
            
            // Cek URL baru
            if (book.downloadUrl) {
                 const normalizedNewUrl = new URL(book.downloadUrl, self.location.origin).pathname;
                 if (normalizedNewUrl === normalizedBookUrl) return true;
            }
            
            // Cek URL lama
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
// Ganti seluruh class StartupIntegrityChecker dengan ini (untuk konsistensi)
class StartupIntegrityChecker {
  constructor() {
    this.suppressNotifications = false;  // Flag untuk suppress pada check rutin
  }

  async checkAllCachedAssets() {
    const assetsToCheck = [
      './data/books-metadata.json',
      './manifest.json'
      // Tambah aset lain jika perlu
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

      // Cek HEAD untuk Last-Modified/ETag
      const headResponse = await fetch(assetUrl, { method: 'HEAD' });
      const netLastMod = headResponse.headers.get('Last-Modified');
      const cacheLastMod = cachedResponse.headers.get('Last-Modified');
      const netEtag = headResponse.headers.get('etag');
      const cacheEtag = cachedResponse.headers.get('etag');

      if ((netLastMod && cacheLastMod === netLastMod) || (netEtag && cacheEtag === netEtag)) {
        return false;  // Tidak berubah
      }

      // Jika header tidak cukup, fetch full dan bandingkan JSON canonical
      const networkResponse = await fetch(assetUrl);
      if (!networkResponse.ok) return false;

      const oldData = await cachedResponse.json();
      const newData = await networkResponse.json();
      const hasChanges = canonicalJSON(oldData) !== canonicalJSON(newData);  // Ganti ini

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
            cache: 'no-cache', // Selalu ambil versi baru saat install
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
          // atau 'static-' versi lama, dan BUKAN nama cache versi baru/permanen
          if ((name.startsWith('elsa-pwa-') || name.startsWith('static-')) && !newVersionCaches.includes(name)) {
            console.log('🗑️ Deleting old version-locked cache:', name);
            return caches.delete(name);
          }
          return null;
        })
      );

      await self.clients.claim();
      console.log('✅ SW activated and claimed clients');
      
      // Jalankan pengecekan integritas setelah aktivasi
      integrityChecker.checkAllCachedAssets().catch(console.error);
      
    } catch (error) {
      console.error('❌ Activation failed:', error);
    }
  })());
});

// Message Event Handler
self.addEventListener('message', event => {
  const { type, data } = event.data || {};
  
  // Di dalam self.addEventListener('message', event => { ...
if (event.data.type === 'RUN_INTEGRITY_CHECK') {
  const checker = new StartupIntegrityChecker();
  checker.suppressNotifications = true;  // Suppress untuk check rutin
  checker.checkAllCachedAssets();
}
  
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
  
  // Abaikan request yang tidak relevan
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
    } else if (router.isPDF) {
      // Penanganan khusus untuk PDF
      event.respondWith(handlePDFRequest(event));
    } else if (router.isBookMetadata) {
       // Penanganan khusus metadata (Stale While Revalidate)
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

// PDF Request Handler dengan Lock Protection
async function handlePDFRequest(event) {
  const { request } = event;
  const url = new URL(request.url);
  const fileName = EnhancedCacheManager.getFileNameFromUrl(request.url);
  
  // Gunakan URL absolut sebagai key cache
  const absoluteUrl = new URL(request.url, self.location.origin).href;
  const cacheKey = new Request(absoluteUrl, request);

  try {
    // Check if this is a locked book (menggunakan URL asli/relatif)
    const isLocked = await BookManagerIntegration.isBookLocked(request.url);
    if (isLocked) {
      console.log(`🛡️ Serving locked book: ${fileName}`);
    }

    // Try cache first
    const pdfCache = await caches.open(PDF_CACHE);
    const cachedResponse = await pdfCache.match(cacheKey);
    
    if (cachedResponse) {
      // Stale-while-revalidate (HANYA jika tidak dikunci)
      if (!isLocked) { 
        event.waitUntil(
          updatePDFCache(cacheKey, pdfCache, fileName) // Gunakan cacheKey
        );
      }
      return cachedResponse;
    }

    // Network fallback
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await pdfCache.put(cacheKey, networkResponse.clone()); // Gunakan cacheKey
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

// Metadata Request Handler (Stale While Revalidate)
// Ganti seluruh async function handleMetadataRequest(event) dengan ini
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
          hasChanges = false;  // Prioritaskan ETag jika ada
        } else if (cachedResponse) {
          const oldData = await cachedResponse.json();
          const newData = await networkResponse.json();
          hasChanges = canonicalJSON(oldData) !== canonicalJSON(newData);  // Normalkan
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
    } catch (e) { /* ignore */ }
  })());

  return cachedResponse ?? (await fetch(request));
}

function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`);
  return '{' + parts.join(',') + '}';
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
          // Ambil dari network jika hilang
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

console.log(`✅ ELSA Enhanced Service Worker ${APP_VERSION} loaded successfully`);
