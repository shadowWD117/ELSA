/* ===================================================
 * ELSA: Education Learning Smart App
 * Main Application JavaScript (app.js)
 * Refactored for Best Practices
 * VERSI FINAL (SINKRON DENGAN SW.JS v5.1)
 * =================================================== */

(function () {
    'use strict';

    // --- APLIKASI STATE ---
    const appState = {
        pdfDoc: null,
        pageNum: 1,
        pageIsRendering: false,
        pageNumIsPending: null,
        deferredPrompt: null,
        bookManager: null,
        readingSession: null,
        offlineManager: null,
        isAppInitialized: false
    };

    // --- REFERENSI DOM ---
    const dom = {
        canvas: null,
        ctx: null,
        loading: null,
        pageInfo: null,
        pageInput: null,
        fileNameDisplay: null,
        mainContent: null,
        pdfViewer: null,
        installButton: null,
        installModal: null,
        greetingName: null,
        pdfUploadInput: null,
        selectedFileName: null,
        bukuSection: null,
        body: null,
        // BARU: Custom Alert UI
        customAlertModal: null,
        customAlertTitle: null,
        customAlertMessage: null,
        customAlertConfirm: null,
        customAlertCancel: null
    };
    
    // --- HELPER UNTUK KOMUNIKASI SW ---
    /**
     * BARU: Mengirim data state ke Service Worker agar tetap sinkron.
     */
    function updateSWState(key, value) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'UPDATE_SW_STATE',
                key: key, // mis: 'elsa-locked-books'
                value: value // mis: ['book-id-1', 'book-id-2']
            });
            console.log(`🚀 Pushing state to SW: ${key}`);
        } else {
            console.warn('Cannot push state to SW. Controller not available.');
        }
    }

    // --- KONSTANTA ---
    const CACHE_STRATEGIES = {
        AUTO_MANAGE: 'auto_manage',
        KEEP_ALL_BOOKS: 'keep_all_books',
        KEEP_FAVORITES: 'keep_favorites',
        BY_LAST_READ: 'by_last_read'
    };

    // ==================== PDF.JS LOADER ====================
    async function loadPDFJS() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.js';
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './pdfjs/pdf.js';
            script.onload = () => {
                if (typeof pdfjsLib !== 'undefined') {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.js';
                    console.log('✅ PDF.js worker configured');
                }
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load PDF.js'));
            document.head.appendChild(script);
        });
    }

    async function ensurePDFJSLoaded(maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) {
                    return true;
                }
                await loadPDFJS();
                if (typeof pdfjsLib !== 'undefined' && pdfjsLib.getDocument) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            } catch (error) {
                console.warn(`❌ PDF.js load attempt ${attempt} failed:`, error);
                if (attempt === maxRetries) {
                    throw new Error(`Gagal memuat PDF.js setelah ${maxRetries} percobaan`);
                }
            }
        }
    }

    // ==================== BOOK LOCK MANAGER ====================
    class BookLockManager {
        constructor() {
            this.lockedBooks = new Set(this.loadLockedBooks());
        }

        loadLockedBooks() {
            try {
                return JSON.parse(localStorage.getItem('elsa-locked-books') || '[]');
            } catch (error) {
                console.error('Error loading locked books:', error);
                return [];
            }
        }

        saveLockedBooks() {
            try {
                const lockedBooksData = [...this.lockedBooks]; // Ambil data
                localStorage.setItem('elsa-locked-books', JSON.stringify(lockedBooksData));
                
                // --- PERBAIKAN SINKRONISASI ---
                // BARU: Kirim update ke Service Worker
                updateSWState('elsa-locked-books', lockedBooksData);
                // ---------------------------------

            } catch (error) {
                console.error('Error saving locked books:', error);
            }
        }

        lockBook(bookId) {
            this.lockedBooks.add(bookId);
            this.saveLockedBooks();
            console.log(`🔒 Book locked: ${bookId}`);
            return true;
        }

        unlockBook(bookId) {
            const result = this.lockedBooks.delete(bookId);
            this.saveLockedBooks();
            if (result) {
                console.log(`🔓 Book unlocked: ${bookId}`);
            }
            return result;
        }

        isBookLocked(bookId) {
            return this.lockedBooks.has(bookId);
        }

        getLockedBooks() {
            return [...this.lockedBooks];
        }

        clearAllLocks() {
            this.lockedBooks.clear();
            this.saveLockedBooks();
            console.log('🧹 All book locks cleared');
        }
    }

    // ==================== ENHANCED CACHE MANAGER ====================
    class EnhancedCacheManager {
        // Fungsi deleteCachedBook di app.js harus mengirim pesan ke SW
        static async deleteCachedBook(bookUrl) {
            console.log(`App: Requesting SW to delete ${bookUrl}`);
            return new Promise((resolve, reject) => {
                if (!('serviceWorker' in navigator)) {
                    return resolve(false);
                }
                navigator.serviceWorker.ready.then(registration => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                        if (event.data.type === 'BOOK_DELETE_RESULT') {
                            if (event.data.success) {
                                console.log('App: SW confirmed deletion');
                                resolve(true);
                            } else {
                                reject(new Error('SW failed to delete book'));
                            }
                        }
                    };
                    registration.active.postMessage({
                        type: 'DELETE_CACHED_BOOK',
                        data: { url: bookUrl }
                    }, [channel.port2]);
                }).catch(err => reject(err));
            });
        }
    }

    // ==================== ENHANCED BOOK MANAGER ====================
    class EnhancedBookManager {
        constructor() {
            this.booksMetadata = {};
            this.basePath = './buku';
            this.cachedBooks = new Map();
            this.lockManager = new BookLockManager(); // Menggunakan BookLockManager yang sudah diperbarui
            this.userPreferences = this.loadUserPreferences();
            this.safeInit();
        }

        async safeInit() {
            try {
                await this.loadBooksMetadata();
                await this.loadCachedBooks();
                this.renderAllBooks();
                console.log('✅ Book Manager initialized successfully');
            } catch (error) {
                console.error('❌ Book Manager init failed:', error);
                this.showErrorState();
            }
        }

        loadUserPreferences() {
            try {
                return JSON.parse(localStorage.getItem('elsa-book-preferences') || '{}');
            } catch (error) {
                return {};
            }
        }

        saveUserPreferences() {
            try {
                localStorage.setItem('elsa-book-preferences', JSON.stringify(this.userPreferences));
            } catch (error) {
                console.error('Error saving preferences:', error);
            }
        }
        
        // ... (sisa fungsi loadBooksMetadata, getFallbackMetadata, dll. sama) ...
        async loadBooksMetadata() {
            try {
                console.log('📚 Loading books metadata...');
                const possiblePaths = [
                    './data/books-metadata.json',
                    'data/books-metadata.json'
                ];

                let metadata = null;
                for (const path of possiblePaths) {
                    try {
                        // BARU: Tambahkan no-cache agar SW bisa revalidasi
                        const response = await fetch(path, { cache: 'no-store' }); 
                        if (response.ok) {
                            metadata = await response.json();
                            console.log(`✅ Metadata loaded from: ${path}`);
                            break;
                        }
                    } catch (e) {
                        console.log(`❌ Failed to load from ${path}:`, e.message);
                    }
                }
                if (!metadata) {
                    throw new Error('Tidak bisa memuat metadata dari semua path yang dicoba');
                }
                this.booksMetadata = metadata;
            } catch (error) {
                console.error('❌ Failed to load metadata:', error);
                this.booksMetadata = this.getFallbackMetadata();
            }
        }

        getFallbackMetadata() {
            return {
                "kelas-10": { "title": "Kelas 10", "books": [{"id": "fallback-1", "title": "Contoh Buku", "subject": "Matematika", "size": "2.5 MB", "downloadUrl": "./buku/contoh.pdf"}] },
                "kelas-11-ipa": { "title": "Kelas 11 IPA", "books": [] },
                "kelas-11-ips": { "title": "Kelas 11 IPS", "books": [] }
            };
        }

        async loadCachedBooks() {
            try {
                if ('serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.ready;
                    if (!registration.active) {
                        console.warn('SW not active, cannot load cached books.');
                        return [];
                    }
                    return new Promise((resolve) => {
                        const channel = new MessageChannel();
                        channel.port1.onmessage = (event) => {
                            if (event.data.type === 'CACHED_BOOKS_LIST') {
                                console.log('📚 Cached books loaded:', event.data.books);
                                event.data.books.forEach(book => {
                                    this.cachedBooks.set(book.url, book);
                                });
                                resolve(event.data.books);
                            }
                        };
                        registration.active.postMessage({ type: 'GET_CACHED_BOOKS' }, [channel.port2]);
                    });
                }
            } catch (error) {
                console.warn('Failed to load cached books:', error);
                return [];
            }
        }
        
        // ... (downloadAndCacheBook, cacheBookInSW, generateBookCover, dll. sama) ...
        async downloadAndCacheBook(classId, bookId) {
            try {
                const book = this.findBook(classId, bookId);
                if (!book) throw new Error('Buku tidak ditemukan dalam metadata');
                if (!book.downloadUrl) throw new Error('URL download tidak tersedia');

                console.log('🚀 Starting download:', book.downloadUrl);
                const progressEl = document.getElementById(`progress-${book.id}`);
                if (progressEl) {
                    progressEl.style.display = 'block';
                    progressEl.textContent = 'Mengunduh...';
                }

                const response = await fetch(book.downloadUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

                const pdfBuffer = await response.arrayBuffer();
                const cacheSuccess = await this.cacheBookInSW(book.downloadUrl, pdfBuffer);

                if (cacheSuccess) {
                    // this.showMessage('✅ Buku berhasil diunduh', 'success');
                    this.updateBookUI(book.id, true); // Perbarui UI
                    this.generateBookCover(book.downloadUrl, pdfBuffer, book.id);
                    bukaPDF(book.downloadUrl); // Buka PDF
                } else {
                    throw new Error('Gagal menyimpan buku');
                }
                return true;
            } catch (error) {
                console.error('❌ Download failed:', error);
                this.showMessage(`Error: ${error.message}`, 'error');
                return false;
            }
        }

        async cacheBookInSW(url, pdfBuffer) {
            return new Promise((resolve, reject) => {
                if (!('serviceWorker' in navigator)) {
                    resolve(false);
                    return;
                }

                navigator.serviceWorker.ready.then(registration => {
                    if (!registration.active) {
                        console.error('SW not active, cannot cache book.');
                        return reject(new Error('Service Worker not active'));
                    }
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                        if (event.data.type === 'BOOK_CACHE_RESULT') {
                            if (event.data.success) {
                                console.log('✅ Book cached in SW:', url);
                                this.cachedBooks.set(url, { url: url, cachedAt: Date.now() });
                                resolve(true);
                            } else {
                                reject(new Error('Failed to cache in SW'));
                            }
                        }
                    };
                    registration.active.postMessage({
                        type: 'CACHE_BOOK_PDF',
                        data: { url: url, content: pdfBuffer }
                    }, [channel.port2]);
                }).catch(error => {
                    console.error('SW not ready:', error);
                    resolve(false);
                });
            });
        }

        async generateBookCover(pdfUrl, pdfBuffer, bookId) {
            try {
                await ensurePDFJSLoaded();
                const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
                const pdf = await loadingTask.promise;
                if (pdf.numPages === 0) throw new Error('PDF has no pages');

                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 0.3 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                await page.render({ canvasContext: context, viewport: viewport }).promise;
                const coverDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                localStorage.setItem(`book-cover-${bookId}`, coverDataUrl);
                console.log('✅ Book cover generated:', bookId);
                this.updateBookCover(bookId, coverDataUrl);
            } catch (error) {
                console.warn('❌ Failed to generate cover:', error);
            }
        }

        updateBookCover(bookId, coverDataUrl) {
            const bookElement = document.querySelector(`[data-book-id="${bookId}"]`);
            if (bookElement) {
                const iconWrapper = bookElement.querySelector('.icon-wrapper');
                if (iconWrapper) {
                    iconWrapper.innerHTML = `<img src="${coverDataUrl}" alt="Cover" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px;">`;
                }
            }
        }

        updateBookUI(bookId, isCached) {
            const bookElement = document.querySelector(`[data-book-id="${bookId}"]`);
            if (bookElement) {
                const button = bookElement.querySelector('[data-action="download-book"]');
                const deleteButton = bookElement.querySelector('[data-action="delete-book"]');
                const status = bookElement.querySelector('.book-status');
                const lockBtn = bookElement.querySelector('.lock-btn');
                const isLocked = this.lockManager.isBookLocked(bookId);

                if (button) {
                    // --- PERUBAHAN INI ---
                    button.textContent = isCached ? 'Buka' : 'Download dan Buka'; 
                    // ---------------------
                    button.className = isCached ? 'btn-read' : 'btn-download';
                }

                // Hapus tombol hapus jika tidak di-cache
                if (deleteButton && !isCached) {
                    deleteButton.parentElement.remove(); // Hapus div .book-actions
                }

                if (!status && isCached) {
                    const statusEl = document.createElement('div');
                    statusEl.className = 'book-status';
                    statusEl.style.cssText = 'font-size: 0.7rem; color: #28a745; margin-top: 5px;';
                    statusEl.textContent = '✅ Tersimpan offline';
                    bookElement.appendChild(statusEl);
                } else if (status) {
                    status.textContent = isCached ? '✅ Tersimpan offline' : '';
                    if (!isCached) status.remove();
                }

                if (lockBtn) {
                    lockBtn.innerHTML = isLocked ? '🔒' : '🔓';
                    lockBtn.className = `lock-btn ${isLocked ? 'locked' : ''}`;
                }
                
                // ... sisa render
                this.renderAllBooks(); // Panggil renderAllBooks untuk membangun ulang UI dengan benar
            }
        }

        renderAllBooks() {
            for (const [classId, classData] of Object.entries(this.booksMetadata)) {
                this.renderClassBooks(classId, classData);
            }
        }

        renderClassBooks(classId, classData) {
            const container = document.getElementById(`${classId}-books`);
            if (!container) return;
            container.innerHTML = '';
            if (!classData.books || classData.books.length === 0) {
                container.innerHTML = `<div class="card-item"><div class="icon-wrapper">📚</div><h3>Belum ada buku</h3><p>Buku akan segera tersedia</p></div>`;
                return;
            }
            classData.books.forEach(book => {
                const bookElement = this.createBookElement(book, classId);
                container.appendChild(bookElement);
            });
        }

        createBookElement(book, classId) {
            const div = document.createElement('div');
            div.className = 'card-item';
            div.setAttribute('data-book-id', book.id);

            const savedCover = localStorage.getItem(`book-cover-${book.id}`);
            const isCached = this.cachedBooks.has(book.downloadUrl);
            const isLocked = this.lockManager.isBookLocked(book.id);

            const coverHtml = savedCover ?
                `<img src="${savedCover}" alt="Cover" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;">` :
                `<div class="icon-wrapper">📚</div>`;

            div.innerHTML = `
                <div class="book-header">
                    <h3>${book.title}</h3>
                    <button class="lock-btn ${isLocked ? 'locked' : ''}" 
                            data-action="toggle-lock" data-book-id="${book.id}"
                            title="${isLocked ? 'Buka kunci buku' : 'Kunci buku'}">
                        ${isLocked ? '🔒' : '🔓'}
                    </button>
                </div>
                ${coverHtml}
                <p>${book.subject}</p>
                <p class="file-size">${book.size}</p>
                <button class="${isCached ? 'btn-read' : 'btn-download'}" 
                        data-action="download-book" data-class-id="${classId}" data-book-id="${book.id}">
                    ${isCached ? 'Buka' : 'Download dan Buka'} </button>
                ${isCached ?
                    `<div class="book-actions" style="margin-top: 5px;">
                        <button class="btn-delete" data-action="delete-book" data-class-id="${classId}" data-book-id="${book.id}" title="Hapus buku">
                            🗑️ Hapus
                        </button>
                    </div>` : ''
                }
                ${isCached ? '<div class="book-status" style="font-size: 0.7rem; color: #28a745; margin-top: 5px;"> Tersimpan</div>' : ''}
                ${isLocked ? '<div class="lock-status" style="font-size: 0.7rem; color: #ffc107; margin-top: 3px;">🔒 Terkunci</div>' : ''}
                <div class="download-progress" id="progress-${book.id}" style="display: none;"></div>
            `;
            return div;
        }

        toggleBookLock(bookId) {
            if (this.lockManager.isBookLocked(bookId)) {
                if (this.lockManager.unlockBook(bookId)) {
                    //this.showMessage('🔓 Buku dibuka kunci', 'success');
                }
            } else {
                if (this.lockManager.lockBook(bookId)) {
                    //this.showMessage('🔒 Buku dikunci - tidak akan terhapus otomatis', 'success');
                }
            }
            this.renderAllBooks(); // Re-render untuk update UI
        }

        async deleteBook(classId, bookId) {
            const book = this.findBook(classId, bookId);
            if (!book) {
                // MENGGANTI: alert('Buku tidak ditemukan!')
                customAlert('Error Hapus', 'Buku tidak ditemukan!');
                return false;
            }

            const isLocked = this.lockManager.isBookLocked(bookId);
            if (isLocked) {
                // MENGGANTI: confirm('Buku ini terkunci. ...')
                const confirmUnlock = await customConfirm('Buku Terkunci', 'Buku ini terkunci. Apakah Anda yakin ingin membuka kunci dan menghapusnya?');
                if (!confirmUnlock) return false;
                this.lockManager.unlockBook(bookId); // Ini akan memanggil saveLockedBooks() dan updateSWState()
            }

            // MENGGANTI: confirm(`Apakah Anda yakin ingin menghapus ...`)
            const confirmDelete = await customConfirm('Konfirmasi Hapus', `Apakah Anda yakin ingin menghapus "${book.title}"?`);
            if (!confirmDelete) return false;

            try {
                // Gunakan EnhancedCacheManager yang sudah di-refactor
                const cacheDeleted = await EnhancedCacheManager.deleteCachedBook(book.downloadUrl);
                
                if (cacheDeleted) {
                    this.cachedBooks.delete(book.downloadUrl); // Hapus dari map internal
                    localStorage.removeItem(`book-cover-${bookId}`); // Hapus cover
                    this.showMessage('🗑️ Buku berhasil dihapus', 'success');
                    this.updateBookUI(bookId, false); // Update UI
                    return true;
                } else {
                    throw new Error('Gagal menghapus dari cache via SW');
                }

            } catch (error) {
                console.error('Error deleting book:', error);
                this.showMessage('❌ Gagal menghapus buku', 'error');
                return false;
            }
        }
        
        // ... (sisa fungsi cleanupAllUnlockedBooks, showMessage, dll. sama) ...
        
        async cleanupAllUnlockedBooks() {
            // ... (implementasi sama)
        }

        showMessage(text, type = 'info') {
            const messageEl = document.createElement('div');
            messageEl.style.cssText = `
                position: fixed; top: 100px; right: 20px; padding: 12px 16px;
                border-radius: 6px; color: white; z-index: 10000; font-weight: bold;
                background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            messageEl.textContent = text;
            dom.body.appendChild(messageEl);
            setTimeout(() => {
                if (messageEl.parentNode) {
                    dom.body.removeChild(messageEl);
                }
            }, 3000);
        }

        setupStorageManagement() {
            if (!this.getPreference('cache_strategy')) {
                this.setPreference('cache_strategy', CACHE_STRATEGIES.AUTO_MANAGE);
            }
        }

        async estimateStorageUsage() {
            // ... (implementasi sama)
        }

        findBook(classId, bookId) {
            if (!this.booksMetadata || !this.booksMetadata[classId]) {
                console.warn(`Class ${classId} not found in metadata`);
                return null;
            }
            const classData = this.booksMetadata[classId];
            return classData.books?.find(b => b.id === bookId) || null;
        }

        showErrorState() {
            const containers = ['kelas-10-books', 'kelas-11-ipa-books', 'kelas-11-ips-books'];
            containers.forEach(containerId => {
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `<div class="card-item"><div class="icon-wrapper">⚠️</div><h3>Error Load Buku</h3><p>Refresh halaman</p><button class="btn-download" data-action="reload-page">🔄 Refresh</button></div>`;
                }
            });
        }
    }

    // ==================== CUSTOM UI ALERT/CONFIRM HANDLER ====================
    
    /**
     * Menampilkan modal alert kustom.
     * @param {string} title - Judul pesan.
     * @param {string} message - Isi pesan.
     * @param {function} [callback] - Fungsi yang dipanggil saat tombol OK diklik.
     */
    function customAlert(title, message, callback) {
        if (!dom.customAlertModal) {
            console.error('Custom alert DOM not found. Falling back to native alert.');
            alert(`${title}: ${message}`);
            if (callback) callback();
            return;
        }

        dom.customAlertTitle.textContent = title || 'Pemberitahuan';
        dom.customAlertMessage.textContent = message || '';
        dom.customAlertCancel.style.display = 'none'; // Selalu sembunyikan untuk alert

        // Hapus listener lama
        const oldConfirm = dom.customAlertConfirm.cloneNode(true);
        dom.customAlertConfirm.parentNode.replaceChild(oldConfirm, dom.customAlertConfirm);
        dom.customAlertConfirm = oldConfirm;

        dom.customAlertConfirm.textContent = 'OK';
        dom.customAlertConfirm.classList.remove('secondary');
        dom.customAlertConfirm.classList.add('primary');

        dom.customAlertConfirm.onclick = () => {
            dom.customAlertModal.style.display = 'none';
            if (callback) callback();
        };

        dom.customAlertModal.style.display = 'flex';
    }

    /**
     * Menampilkan modal konfirmasi kustom.
     * @param {string} title - Judul pesan.
     * @param {string} message - Isi pesan.
     * @returns {Promise<boolean>} - Resolves dengan true jika 'Ya', false jika 'Batal'.
     */
    function customConfirm(title, message) {
        return new Promise(resolve => {
            if (!dom.customAlertModal) {
                console.error('Custom alert DOM not found. Falling back to native confirm.');
                resolve(confirm(`${title}: ${message}`));
                return;
            }

            dom.customAlertTitle.textContent = title || 'Konfirmasi';
            dom.customAlertMessage.textContent = message || '';
            
            dom.customAlertCancel.style.display = 'inline-block';

            // Hapus listener lama untuk Confirm
            const oldConfirm = dom.customAlertConfirm.cloneNode(true);
            dom.customAlertConfirm.parentNode.replaceChild(oldConfirm, dom.customAlertConfirm);
            dom.customAlertConfirm = oldConfirm;
            
            // Hapus listener lama untuk Cancel
            const oldCancel = dom.customAlertCancel.cloneNode(true);
            dom.customAlertCancel.parentNode.replaceChild(oldCancel, dom.customAlertCancel);
            dom.customAlertCancel = oldCancel;


            dom.customAlertConfirm.textContent = 'Ya';
            dom.customAlertConfirm.classList.remove('secondary');
            dom.customAlertConfirm.classList.add('primary');

            dom.customAlertCancel.textContent = 'Batal';
            dom.customAlertCancel.classList.remove('primary');
            dom.customAlertCancel.classList.add('secondary');


            dom.customAlertConfirm.onclick = () => {
                dom.customAlertModal.style.display = 'none';
                resolve(true);
            };

            dom.customAlertCancel.onclick = () => {
                dom.customAlertModal.style.display = 'none';
                resolve(false);
            };

            dom.customAlertModal.style.display = 'flex';
        });
    }

    // ==================== NAVIGATION FUNCTIONALITY ====================
    function setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', function (e) {
                e.preventDefault();
                navItems.forEach(nav => nav.classList.remove('active'));
                this.classList.add('active');
                const contentSections = document.querySelectorAll('.content-section');
                contentSections.forEach(section => section.classList.remove('active'));
                const targetId = this.getAttribute('data-target');
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
                setTimeout(adjustCardSizes, 100);
            });
        });
    }

    // ==================== PDF VIEWER FUNCTIONS ====================
    function tampilkanPDFViewer() {
        // ... (fungsi sama)
        if (dom.mainContent && dom.pdfViewer) {
            dom.mainContent.style.display = 'none';
            dom.pdfViewer.style.display = 'flex';
            dom.body.style.overflow = 'hidden';
        }
    }

    function sembunyikanPDFViewer() {
        // ... (fungsi sama, termasuk scheduleHistorySync)
        if (dom.mainContent && dom.pdfViewer) {
            dom.mainContent.style.display = 'block';
            dom.pdfViewer.style.display = 'none';
            dom.body.style.overflow = 'auto';
            if (dom.ctx && dom.canvas) {
                dom.ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
            }
            appState.pdfDoc = null;
            appState.pageNum = 1;

            if (appState.readingSession && appState.readingSession.currentPDF) {
                appState.readingSession.scheduleHistorySync();
            }
        }
    }

    const updatePageInfo = num => {
        // ... (fungsi sama)
        if (!appState.pdfDoc || !dom.pageInfo) return;
        dom.pageInfo.textContent = `Halaman ${num} dari ${appState.pdfDoc.numPages}`;
        const prevBtn = document.getElementById("prev");
        const nextBtn = document.getElementById("next");
        if (prevBtn) prevBtn.classList.toggle('disabled', appState.pageNum <= 1);
        if (nextBtn) nextBtn.classList.toggle('disabled', appState.pageNum >= appState.pdfDoc.numPages);
    };

    const renderPage = num => {
        // ... (fungsi sama)
        if (!appState.pdfDoc || !dom.canvas || !dom.ctx || !dom.loading) return;
        appState.pageIsRendering = true;
        dom.loading.style.display = 'block';
        dom.canvas.style.display = 'none';
        appState.pdfDoc.getPage(num).then(page => {
            const viewerContainer = document.getElementById('viewer-container');
            if (!viewerContainer) return;
            let viewport = page.getViewport({ scale: 1.0 });
            let scale = (viewerContainer.clientWidth - 40) / viewport.width;
            scale = Math.max(0.5, Math.min(scale, 3.0));
            const scaledViewport = page.getViewport({ scale });
            const outputScale = window.devicePixelRatio || 1;
            dom.canvas.width = Math.floor(scaledViewport.width * outputScale);
            dom.canvas.height = Math.floor(scaledViewport.height * outputScale);
            dom.canvas.style.width = Math.floor(scaledViewport.width) + "px";
            dom.canvas.style.height = Math.floor(scaledViewport.height) + "px";
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
            const renderCtx = {
                canvasContext: dom.ctx,
                viewport: scaledViewport,
                transform: transform
            };
            page.render(renderCtx).promise.then(() => {
                appState.pageIsRendering = false;
                dom.loading.style.display = 'none';
                dom.canvas.style.display = 'block';
                if (appState.pageNumIsPending !== null) {
                    renderPage(appState.pageNumIsPending);
                    appState.pageNumIsPending = null;
                }
            });
            updatePageInfo(num);
        }).catch(err => {
            console.error("Error rendering page:", err);
            if (dom.loading) {
                dom.loading.textContent = "Error memuat halaman: " + err.message;
            }
        });
    };

    const queueRenderPage = num => {
        // ... (fungsi sama)
        if (appState.pageIsRendering) {
            appState.pageNumIsPending = num;
        } else {
            renderPage(num);
        }
    };

    function loadPDF(source) {
        // ... (fungsi sama)
        if (!dom.loading) return;
        dom.loading.textContent = "Memuat PDF...";
        tampilkanPDFViewer();
        let loadingTask;
        if (typeof source === 'string') {
            loadingTask = pdfjsLib.getDocument({ url: source });
            trackPDFView(source.split("/").pop());
        } else {
            const reader = new FileReader();
            reader.onload = function (event) {
                loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(event.target.result) });
                loadingTask.promise.then(pdf => {
                    appState.pdfDoc = pdf;
                    renderPage(appState.pageNum);
                    trackPDFView(source.name);
                }).catch(err => {
                    console.error("Error loading PDF from file:", err);
                    if (dom.loading) dom.loading.textContent = "Gagal memuat PDF: " + err.message;
                });
            };
            reader.readAsArrayBuffer(source);
            return;
        }
        loadingTask.promise.then(pdf => {
            appState.pdfDoc = pdf;
            renderPage(appState.pageNum);
        }).catch(err => {
            console.error("Error loading PDF:", err);
            if (dom.loading) dom.loading.textContent = "Gagal memuat PDF: " + err.message;
        });
    }

    // ==================== PDF NAVIGATION EVENT LISTENERS ====================
    function setupPDFNavigation() {
        // ... (fungsi sama)
        document.getElementById("prev")?.addEventListener("click", () => {
            if (appState.pageNum > 1 && !appState.pageIsRendering) {
                appState.pageNum--;
                queueRenderPage(appState.pageNum);
                appState.readingSession?.trackPageTurn();
            }
        });
        document.getElementById("next")?.addEventListener("click", () => {
            if (appState.pdfDoc && appState.pageNum < appState.pdfDoc.numPages && !appState.pageIsRendering) {
                appState.pageNum++;
                queueRenderPage(appState.pageNum);
                appState.readingSession?.trackPageTurn();
            }
        });
        dom.pageInfo?.addEventListener("click", () => {
            if (!dom.pageInput) return;
            dom.pageInfo.style.display = "none";
            dom.pageInput.style.display = "inline-block";
            dom.pageInput.value = appState.pageNum;
            dom.pageInput.focus();
        });
        dom.pageInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                let val = parseInt(dom.pageInput.value, 10);
                if (isNaN(val) || val < 1 || val > appState.pdfDoc.numPages) {
                    // MENGGANTI: alert(`Masukkan halaman 1-${appState.pdfDoc.numPages}`);
                    customAlert('Halaman Tidak Valid', `Masukkan halaman 1-${appState.pdfDoc.numPages}`);
                } else {
                    appState.pageNum = val;
                    queueRenderPage(appState.pageNum);
                    appState.readingSession?.trackPageTurn();
                }
                dom.pageInput.style.display = "none";
                if (dom.pageInfo) dom.pageInfo.style.display = "inline-block";
            }
        });
    }

    // ==================== PDF OPENING FUNCTIONS ====================
    async function bukaPDF(path) {
        // ... (fungsi sama)
        try {
            console.log('Loading PDF:', path);
            await ensurePDFJSLoaded();
            if (!dom.fileNameDisplay) {
                console.error('fileNameDisplay not found');
                return;
            }
            const fileName = path.split("/").pop().replace(/%20/g, " ");
            dom.fileNameDisplay.textContent = fileName;
            const isCached = await isPDFCached(path);
            console.log(isCached ? '📚 Loading from cache:' : '🌐 Loading from network:', path);
            loadPDF(path);
        } catch (error) {
            console.error('PDF.js load error:', error);
            // MENGGANTI: alert('Error: PDF viewer tidak bisa dimuat. ' + error.message);
            customAlert('Error Memuat PDF', 'PDF viewer tidak bisa dimuat. ' + error.message);
        }
    }

    async function isPDFCached(url) {
        // ... (fungsi sama, tapi nama cache harus sesuai sw.js)
        try {
            if ('caches' in window) {
                // Ambil nama cache dari SW jika memungkinkan, atau hardcode
                const cacheName = `pdf-cache-v2-book-management-finalV1`; // Sesuaikan dengan APP_VERSION di sw.js
                const cache = await caches.open(cacheName);
                const response = await cache.match(url);
                return !!response;
            }
            return false;
        } catch (error) {
            console.warn('Cache check failed:', error);
            return false;
        }
    }

    function bacaPDFUpload() {
        // ... (fungsi sama)
        if (dom.pdfUploadInput && dom.pdfUploadInput.files.length > 0) {
            const file = dom.pdfUploadInput.files[0];
            if (dom.fileNameDisplay) {
                dom.fileNameDisplay.textContent = file.name;
            }
            loadPDF(file);
        } else {
            // MENGGANTI: alert('Silakan pilih file PDF terlebih dahulu.');
            customAlert('Peringatan', 'Silakan pilih file PDF terlebih dahulu.');
        }
    }

    function setupFileUpload() {
        // ... (fungsi sama)
        dom.pdfUploadInput?.addEventListener('change', function () {
            if (dom.selectedFileName) {
                dom.selectedFileName.textContent = this.files.length > 0 ?
                    this.files[0].name :
                    'Tidak ada file yang dipilih';
            }
        });
    }

    // ==================== PWA INSTALLATION ====================
    function setupPWAInstall() {
        // ... (fungsi sama)
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            appState.deferredPrompt = e;
            if (dom.installButton) {
                dom.installButton.style.display = 'block';
            }
            setTimeout(tampilkanModal, 2000);
        });
        dom.installButton?.addEventListener('click', installApp);
    }

    function tampilkanModal() {
        if (dom.installModal) dom.installModal.style.display = 'flex';
    }

    function sembunyikanModal() {
        if (dom.installModal) dom.installModal.style.display = 'none';
    }

    function installApp() {
        // ... (fungsi sama)
        if (dom.installButton) dom.installButton.style.display = 'none';
        if (appState.deferredPrompt) {
            appState.deferredPrompt.prompt();
            appState.deferredPrompt.userChoice.then((choiceResult) => {
                console.log(choiceResult.outcome === 'accepted' ? 'Pengguna menerima instalasi' : 'Pengguna menolak instalasi');
                appState.deferredPrompt = null;
            });
        }
        sembunyikanModal();
    }

    // ==================== GREETING SYSTEM ====================
    function setupGreeting() {
        // ... (fungsi sama)
        if (!dom.greetingName) return;
        const userName = localStorage.getItem('userName');
        dom.greetingName.textContent = (userName && userName.trim() !== '' && userName !== 'Nama Pengguna') ?
            'Halo, ' + userName + '!' :
            'Halo!';
    }

    // ==================== SERVICE WORKER REGISTRATION ====================
    async function initializeServiceWorker() {
        // ... (fungsi sama)
        if (!('serviceWorker' in navigator)) {
            console.log('❌ Service Worker not supported');
            return null;
        }
        try {
            const swUrl = './sw.js';
            const registration = await navigator.serviceWorker.register(swUrl, {
                scope: './'
                // updateViaCache: 'none' // Hapus ini untuk membiarkan browser mengelola update
            });
            console.log('✅ Service Worker registered successfully');
            return registration;
        } catch (error) {
            console.error('❌ Service Worker registration failed:', error);
            return null;
        }
    }

    // ==================== BACKGROUND SYNC SETUP ====================
    async function setupBackgroundSync(registration) {
        // ... (fungsi sama)
        try {
            if ('sync' in registration) {
                console.log('✅ Background Sync supported');
                await registration.sync.register('sync-pdf-history');
                await registration.sync.register('sync-user-activity');
                console.log('✅ Background Sync tags registered');
            }
            if ('periodicSync' in registration) {
                const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                if (status.state === 'granted') {
                    await registration.periodicSync.register('content-cleanup', {
                        minInterval: 24 * 60 * 60 * 1000,
                    });
                    console.log('✅ Periodic Sync registered');
                }
            }
        } catch (error) {
            console.log('⚠️ Background Sync setup failed:', error);
        }
    }

    // ==================== UPDATE NOTIFICATION SYSTEM ====================
    function showUpdateNotification() {
        // ... (fungsi sama)
        let notification = document.getElementById('update-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'update-notification';
            notification.style.cssText = `
                position: fixed; top: 20px; right: 15px; background: #28a745;
                color: white; padding: 12px 16px; border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 2000;
                font-family: Arial, sans-serif; max-width: min(300px, calc(100vw - 30px));
                word-break: break-word; display: none;
            `;
            dom.body.appendChild(notification);
        }
        notification.innerHTML = '🔄 Update tersedia! <button id="updateRefreshBtn">Perbarui Sekarang</button>';
        notification.style.display = 'block';
        document.getElementById('updateRefreshBtn').addEventListener('click', async () => {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration && registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        window.location.reload();
                    });
                    return;
                }
            }
            window.location.reload();
        });
        setTimeout(() => { notification.style.display = 'none'; }, 10000);
    }

    // ==================== SERVICE WORKER MESSAGE HANDLER ====================
    function setupServiceWorkerMessages() {
        // ... (fungsi sama, tambahkan case baru)
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.addEventListener('message', event => {
            const data = event.data;
            console.log('📨 Client: Received message from SW:', data);
            switch (data.type) {
                case 'STARTUP_UPDATES_DETECTED':
                    console.log('📢 Updates detected on startup:', data.assets);
                    showUpdateNotification();
                    break;
                case 'VERSION_ACTIVATED':
                case 'SW_ACTIVATED':
                    console.log('✅ SW activated:', data.version || 'ready');
                    break;
                // BARU: Tangani pesan dari SW
                case 'SYNC_COMPLETED':
                    appState.offlineManager?.showMessage(`Sync ${data.syncType} selesai`, 'success');
                    break;
                case 'CACHE_CLEARED':
                    // MENGGANTI: alert('Cache telah dibersihkan. Aplikasi akan dimuat ulang.');
                    customAlert('Cache Dihapus', 'Cache telah dibersihkan. Aplikasi akan dimuat ulang.', () => {
                        window.location.reload();
                    });
                    break;
            }
        });
    }

    // ==================== READING SESSION TRACKER ====================
    class ReadingSession {
        constructor() {
            this.sessionStart = Date.now();
            this.pageTurns = 0;
            this.currentPDF = null;
        }

        startPDF(pdfName) {
            // ... (fungsi sama)
            this.currentPDF = pdfName;
            this.sessionStart = Date.now();
            this.pageTurns = 0;
            console.log('📖 Reading session started:', pdfName);
        }

        trackPageTurn() {
            // ... (fungsi sama)
            this.pageTurns++;
            if (this.pageTurns % 3 === 0) {
                this.scheduleHistorySync();
            }
        }

        async scheduleHistorySync() {
            if (!this.currentPDF) return;
            const sessionData = {
                id: `${this.currentPDF}-${Date.now()}`,
                pdfName: this.currentPDF,
                duration: Date.now() - this.sessionStart,
                pageTurns: this.pageTurns,
                timestamp: Date.now(),
                synced: false
            };
            
            const pendingHistory = JSON.parse(localStorage.getItem('pendingPDFHistory') || '[]');
            pendingHistory.push(sessionData);
            localStorage.setItem('pendingPDFHistory', JSON.stringify(pendingHistory));
            
            // --- PERBAIKAN SINKRONISASI ---
            // BARU: Kirim update ke Service Worker
            updateSWState('pendingPDFHistory', pendingHistory);
            // ---------------------------------
            
            console.log('💾 Saved reading session:', sessionData);

            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                if ('sync' in registration) {
                    await registration.sync.register('sync-pdf-history');
                    this.showSyncIndicator('Progress membaca disimpan');
                }
            }
        }

        showSyncIndicator(message) {
            // ... (fungsi sama)
            const indicator = document.createElement('div');
            indicator.style.cssText = `
                position: fixed; top: 10px; right: 10px; background: #4CAF50;
                color: white; padding: 5px 10px; border-radius: 4px;
                font-size: 0.8rem; z-index: 10000;
            `;
            indicator.textContent = '✓ ' + message;
            dom.body.appendChild(indicator);
            setTimeout(() => { indicator.parentNode?.removeChild(indicator); }, 2000);
        }
    }

    function trackPDFView(pdfName) {
        appState.readingSession?.startPDF(pdfName);
    }

    // ==================== OFFLINE MANAGER ====================
    class OfflineManager {
        // ... (semua fungsi sama)
        constructor() {
            this.isOnline = navigator.onLine;
            this.offlineIndicator = null;
            this.init();
        }
        init() {
            this.setupNetworkListeners();
            this.updateOnlineStatus(); // Panggil saat init
        }

        setupNetworkListeners() {
            window.addEventListener('online', () => this.handleOnline());
            window.addEventListener('offline', () => this.handleOffline());
        }
        updateOnlineStatus() {
             if (navigator.onLine) {
                this.handleOnline(true); // true = silent
            } else {
                this.handleOffline();
            }
        }
        handleOnline(silent = false) {
            this.isOnline = true;
            this.hideOfflineIndicator();
            if (!silent) {
                // this.showMessage('✅ Koneksi pulih', 'success');
            }
        }
        handleOffline() {
            this.isOnline = false;
            this.showOfflineIndicator();
            //this.showMessage('📶 Sedang offline', 'warning');
        }
        showOfflineIndicator() {
            if(this.offlineIndicator) this.offlineIndicator.style.transform = 'translateY(0)';
        }
        hideOfflineIndicator() {
            if(this.offlineIndicator) this.offlineIndicator.style.transform = 'translateY(-100%)';
        }
        showMessage(text, type = 'info') {
            const messageEl = document.createElement('div');
            messageEl.style.cssText = `
                position: fixed; top: 50px; right: 20px; padding: 12px 16px;
                border-radius: 6px; color: white; z-index: 10000; font-weight: bold;
                ${type === 'success' ? 'background: #4CAF50;' : ''}
                ${type === 'warning' ? 'background: #ffc107; color: #000;' : ''}
                ${type === 'error' ? 'background: #f44336;' : ''}
            `;
            messageEl.textContent = text;
            dom.body.appendChild(messageEl);
            setTimeout(() => { messageEl.parentNode?.removeChild(messageEl); }, 3000);
        }
    }

    // ==================== LAYOUT AND UI FUNCTIONS ====================
    function adjustCardSizes() {
        // ... (fungsi sama)
        document.querySelectorAll('.card-row').forEach(row => {
            const cardItems = row.querySelectorAll('.card-item');
            if (cardItems.length === 0) return;
            const containerWidth = row.offsetWidth;
            const totalWidth = Array.from(cardItems).reduce((total, card) => total + card.offsetWidth + 15, 0);
            if (totalWidth > containerWidth) {
                const scaleFactor = containerWidth / totalWidth * 0.9;
                cardItems.forEach(card => {
                    const newWidth = Math.max(100, card.offsetWidth * scaleFactor);
                    card.style.minWidth = newWidth + 'px';
                    card.style.maxWidth = newWidth + 'px';
                });
            }
        });
    }

    function ensureNavbarPosition() {
        // ... (fungsi sama)
        const navbar = document.querySelector('.mobile-navbar');
        if (navbar) {
            navbar.style.bottom = '0';
            navbar.style.transform = 'translateY(0)';
        }
    }

    function checkOnlineStatus() {
        if (!navigator.onLine) {
            console.log('📴 Aplikasi sedang offline');
        }
    }

    // ==================== EVENT HANDLERS (DELEGATION) ====================
    function handleDynamicBookActions(event) {
        // ... (fungsi sama)
        const button = event.target.closest('[data-action]');
        if (!button || !appState.bookManager) return;
        const action = button.dataset.action;
        const bookId = button.dataset.bookId;
        const classId = button.dataset.classId;
        switch (action) {
            case 'toggle-lock':
                appState.bookManager.toggleBookLock(bookId);
                break;
            case 'download-book':
                appState.bookManager.downloadAndCacheBook(classId, bookId);
                break;
            case 'delete-book':
                appState.bookManager.deleteBook(classId, bookId);
                break;
            case 'reload-page':
                location.reload();
                break;
        }
    }

    function handleStaticActions(event) {
        // ... (fungsi sama)
        const target = event.target;
        if (target.matches('.upload-section .btn')) {
            bacaPDFUpload();
            return;
        }
        if (target.matches('.modal-btn.primary')) {
            installApp();
            return;
        }
        if (target.matches('.modal-btn.secondary')) {
            sembunyikanModal();
            return;
        }
        if (target.closest('.back-btn')) {
            sembunyikanPDFViewer();
            return;
        }
    }

    // ==================== INITIALIZATION ====================
    function initializeDOMElements() {
        // ... (fungsi sama)
        dom.canvas = document.getElementById('pdf-render');
        dom.ctx = dom.canvas ? dom.canvas.getContext('2d') : null;
        dom.loading = document.getElementById('loading');
        dom.pageInfo = document.getElementById('page-info');
        dom.pageInput = document.getElementById('page-input');
        dom.fileNameDisplay = document.getElementById('file-name-display');
        dom.mainContent = document.getElementById('main-content');
        dom.pdfViewer = document.getElementById('pdf-viewer');
        dom.installButton = document.getElementById('installButton');
        dom.installModal = document.getElementById('installModal');
        dom.greetingName = document.getElementById('greetingName');
        dom.pdfUploadInput = document.getElementById('pdfUpload');
        dom.selectedFileName = document.getElementById('selectedFileName');
        dom.bukuSection = document.getElementById('buku-section');
        dom.body = document.body;
        // BARU: Custom Alert UI
        dom.customAlertModal = document.getElementById('customAlertModal');
        dom.customAlertTitle = document.getElementById('customAlertTitle');
        dom.customAlertMessage = document.getElementById('customAlertMessage');
        dom.customAlertConfirm = document.getElementById('customAlertConfirm');
        dom.customAlertCancel = document.getElementById('customAlertCancel');
    }

    function initializeApp() {
        if (appState.isAppInitialized) return;
        console.log('🚀 Starting ELSA PWA initialization...');
        initializeDOMElements();
        setupNavigation();
        setupPDFNavigation();
        setupFileUpload();
        setupPWAInstall();
        setupGreeting();
        setupServiceWorkerMessages();
        appState.readingSession = new ReadingSession();
        appState.offlineManager = new OfflineManager();

        // Inisialisasi Book Manager (tidak perlu delay)
        try {
            appState.bookManager = new EnhancedBookManager();
            if (window.elsaApp) {
                window.elsaApp.bookManager = appState.bookManager;
            }
        } catch (error) {
            console.error('❌ Book Manager initialization failed:', error);
            appState.bookManager = {
                showMessage: (text) => console.log(`[Book Manager Fallback]: ${text}`),
                renderAllBooks: () => console.log('Fallback: renderAllBooks')
            };
        }

        ensureNavbarPosition();
        adjustCardSizes();

        // Inisialisasi Service Worker
        initializeServiceWorker().then(registration => {
            if (registration) {
                console.log('✅ Service Worker initialized successfully');
                setupBackgroundSync(registration).catch(console.error);
                
                // --- PERBAIKAN SINKRONISASI ---
                // BARU: Kirim state awal ke SW setelah siap
                navigator.serviceWorker.ready.then(readyReg => {
                    if (readyReg.active) {
                        console.log('📡 Syncing initial state to SW...');
                        updateSWState('elsa-locked-books', JSON.parse(localStorage.getItem('elsa-locked-books') || '[]'));
                        updateSWState('pendingPDFHistory', JSON.parse(localStorage.getItem('pendingPDFHistory') || '[]'));
                    }
                });
                // ---------------------------------
            }
        }).catch(error => {
            console.error('❌ Service Worker initialization failed:', error);
        });

        // Pasang Event Listeners
        dom.body.addEventListener('click', handleStaticActions);
        dom.bukuSection.addEventListener('click', handleDynamicBookActions);
        window.addEventListener('resize', () => {
            adjustCardSizes();
            ensureNavbarPosition();
        });
        window.addEventListener('scroll', ensureNavbarPosition);
        
        // Error handling global
        window.addEventListener('error', (event) => {
            if (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT') {
                console.log('❌ Resource failed to load:', event.target.src);
            }
        });
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason?.message?.includes('PDF')) {
                console.log('❌ PDF loading error:', event.reason);
                appState.offlineManager?.showMessage('❌ Gagal memuat PDF', 'error');
            }
        });

        appState.isAppInitialized = true;
        console.log('✅ ELSA Enhanced App JavaScript loaded successfully');
        setTimeout(debugAppState, 2000);
    }

    // ==================== DEBUGGING ====================
    function debugAppState() {
        // ... (fungsi sama)
        console.log('🔍 ELSA App Debug Info:');
        console.log('- DOM Ready:', document.readyState);
        console.log('- PDF.js Loaded:', typeof pdfjsLib !== 'undefined');
        console.log('- Book Manager:', appState.bookManager ? 'Initialized' : 'Not initialized');
        console.log('- Service Worker:', 'serviceWorker' in navigator ? 'Supported' : 'Not supported');
        console.log('- Online:', navigator.onLine);
        if (appState.bookManager && appState.bookManager.booksMetadata) {
            console.log('- Books Metadata:', Object.keys(appState.bookManager.booksMetadata));
        }
    }

    // --- GLOBAL DEBUG EXPORT ---
    window.elsaApp = {
        readingSession: appState.readingSession,
        offlineManager: appState.offlineManager,
        bookManager: appState.bookManager,
        EnhancedCacheManager,
        CACHE_STRATEGIES,
        initializeServiceWorker,
        showUpdateNotification,
        bukaPDF,
        bacaPDFUpload,
        customAlert, // NEW
        customConfirm, // NEW
        debug: debugAppState,
        // BARU: Tambahkan helper debug
        forceSWUpdate: () => {
            navigator.serviceWorker.getRegistration().then(reg => {
                reg.update().then(() => console.log('SW update check forced'));
            });
        },
        clearAllCaches: () => {
            if(navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
            }
        }
    };

    // --- MULAI APLIKASI ---
    document.addEventListener('DOMContentLoaded', initializeApp);

})();