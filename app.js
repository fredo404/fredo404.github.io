(() => {
  'use strict';

  const DB_NAME = 'PersonalDiaryDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'entries';
  const FALLBACK_STORAGE_KEY = 'personal_diary_entries_v1';
  const THEME_STORAGE_KEY = 'personal_diary_theme';

  const MOODS = [
    { id: 'happy', emoji: '😊', label: 'Happy' },
    { id: 'calm', emoji: '🌿', label: 'Calm' },
    { id: 'grateful', emoji: '✨', label: 'Grateful' },
    { id: 'reflective', emoji: '🌙', label: 'Reflective' },
    { id: 'tired', emoji: '☕', label: 'Tired' },
    { id: 'anxious', emoji: '🌧️', label: 'Anxious' }
  ];

  // App state
  let db = null;
  let useLocalStorageFallback = false;
  let entries = [];
  let activeEntryId = null;
  let activeFilter = 'all';
  let activeTag = null;
  let searchQuery = '';
  let saveTimer = null;
  let toastTimer = null;
  let lightboxIndex = 0;

  // DOM references
  const els = {
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    openSidebarBtn: document.getElementById('openSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIconSun: document.getElementById('themeIconSun'),
    themeIconMoon: document.getElementById('themeIconMoon'),
    entryStats: document.getElementById('entryStats'),
    newEntryBtn: document.getElementById('newEntryBtn'),
    emptyNewEntryBtn: document.getElementById('emptyNewEntryBtn'),
    searchInput: document.getElementById('searchInput'),
    filterPills: document.querySelectorAll('.filter-pill'),
    activeTagFilter: document.getElementById('activeTagFilter'),
    activeTagName: document.getElementById('activeTagName'),
    clearTagFilterBtn: document.getElementById('clearTagFilterBtn'),
    entriesList: document.getElementById('entriesList'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFileInput: document.getElementById('importFileInput'),
    saveStatus: document.getElementById('saveStatus'),
    editorToolbar: document.getElementById('editorToolbar'),
    addPhotoToolbarBtn: document.getElementById('addPhotoToolbarBtn'),
    favoriteBtn: document.getElementById('favoriteBtn'),
    deleteEntryBtn: document.getElementById('deleteEntryBtn'),
    emptyState: document.getElementById('emptyState'),
    editorContainer: document.getElementById('editorContainer'),
    dropZone: document.getElementById('dropZone'),
    dropOverlay: document.getElementById('dropOverlay'),
    entryDate: document.getElementById('entryDate'),
    entryDayLabel: document.getElementById('entryDayLabel'),
    moodPicker: document.getElementById('moodPicker'),
    entryTitle: document.getElementById('entryTitle'),
    entryBody: document.getElementById('entryBody'),
    photoCountBadge: document.getElementById('photoCountBadge'),
    addPhotoInlineBtn: document.getElementById('addPhotoInlineBtn'),
    photoFileInput: document.getElementById('photoFileInput'),
    photoGrid: document.getElementById('photoGrid'),
    photoDropHint: document.getElementById('photoDropHint'),
    tagsList: document.getElementById('tagsList'),
    tagInput: document.getElementById('tagInput'),
    wordCount: document.getElementById('wordCount'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxCaption: document.getElementById('lightboxCaption'),
    lightboxCounter: document.getElementById('lightboxCounter'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxPrev: document.getElementById('lightboxPrev'),
    lightboxNext: document.getElementById('lightboxNext'),
    confirmModal: document.getElementById('confirmModal'),
    confirmCancelBtn: document.getElementById('confirmCancelBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    toast: document.getElementById('toast')
  };

  /* -------------------- Storage Layer (IndexedDB + Fallback) -------------------- */

  function openDatabase() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        useLocalStorageFallback = true;
        resolve(null);
        return;
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const database = event.target.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = (event) => {
          db = event.target.result;
          resolve(db);
        };
        request.onerror = () => {
          useLocalStorageFallback = true;
          resolve(null);
        };
      } catch (_err) {
        useLocalStorageFallback = true;
        resolve(null);
      }
    });
  }

  function loadAllEntries() {
    if (useLocalStorageFallback || !db) {
      try {
        const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
        return Promise.resolve(raw ? JSON.parse(raw) : []);
      } catch (_err) {
        return Promise.resolve([]);
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function saveEntryToStore(entry) {
    if (useLocalStorageFallback || !db) {
      try {
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(entries));
        return Promise.resolve();
      } catch (err) {
        showToast('Storage full — try exporting a backup or removing large photos.');
        return Promise.reject(err);
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function deleteEntryFromStore(id) {
    if (useLocalStorageFallback || !db) {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(entries));
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /* -------------------- Utilities -------------------- */

  function generateId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseLocalDate(dateStr) {
    const [y, m, d] = (dateStr || getTodayDateString()).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function formatDayLabel(dateStr) {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatMonthGroup(dateStr) {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function sortEntries() {
    entries.sort((a, b) => {
      if (b.date !== a.date) {
        return b.date.localeCompare(a.date);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getActiveEntry() {
    return entries.find((e) => e.id === activeEntryId) || null;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 2800);
  }

  function autoResizeTextarea() {
    els.entryBody.style.height = 'auto';
    els.entryBody.style.height = Math.max(220, els.entryBody.scrollHeight) + 'px';
  }

  function updateWordCount(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    els.wordCount.textContent = words === 1 ? '1 word' : `${words} words`;
  }

  /* -------------------- Image Processing -------------------- */

  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Unsupported file type'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Invalid image file'));
        img.onload = () => {
          const MAX_DIM = 1600;
          let { width, height } = img;

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width >= height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Keep PNG for transparent/graphic PNGs; otherwise compress as JPEG
          const isPng = file.type === 'image/png';
          const mimeType = isPng ? 'image/png' : 'image/jpeg';
          const dataUrl = isPng
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', 0.85);

          resolve({
            id: generateId(),
            dataUrl,
            caption: '',
            addedAt: Date.now()
          });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFiles(fileList) {
    const entry = getActiveEntry();
    if (!entry) return;

    const imageFiles = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      showToast('Please select valid image files.');
      return;
    }

    els.saveStatus.textContent = 'Processing images...';
    let addedCount = 0;

    for (const file of imageFiles) {
      try {
        const photoObj = await processImageFile(file);
        entry.photos = entry.photos || [];
        entry.photos.push(photoObj);
        addedCount++;
      } catch (_err) {
        // Skip unreadable images
      }
    }

    if (addedCount > 0) {
      entry.updatedAt = Date.now();
      await saveEntryToStore(entry);
      renderPhotos(entry);
      renderEntriesList();
      updateStats();
      els.saveStatus.textContent = 'Saved';
      showToast(addedCount === 1 ? 'Photo attached' : `${addedCount} photos attached`);
    } else {
      els.saveStatus.textContent = '';
      showToast('Could not attach image.');
    }
  }

  /* -------------------- Theme -------------------- */

  function initTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (theme === 'dark') {
      els.themeIconSun.classList.add('hidden');
      els.themeIconMoon.classList.remove('hidden');
    } else {
      els.themeIconSun.classList.remove('hidden');
      els.themeIconMoon.classList.add('hidden');
    }
  }

  /* -------------------- Rendering -------------------- */

  function updateStats() {
    const totalEntries = entries.length;
    const totalPhotos = entries.reduce((sum, e) => sum + ((e.photos && e.photos.length) || 0), 0);
    const entryLabel = totalEntries === 1 ? '1 entry' : `${totalEntries} entries`;
    const photoLabel = totalPhotos > 0 ? ` · ${totalPhotos} ${totalPhotos === 1 ? 'photo' : 'photos'}` : '';
    els.entryStats.textContent = entryLabel + photoLabel;
  }

  function getFilteredEntries() {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeFilter === 'favorites' && !entry.favorite) return false;
      if (activeFilter === 'photos' && (!entry.photos || entry.photos.length === 0)) return false;
      if (activeTag && !(entry.tags || []).includes(activeTag)) return false;

      if (q) {
        const inTitle = (entry.title || '').toLowerCase().includes(q);
        const inBody = (entry.body || '').toLowerCase().includes(q);
        const inTags = (entry.tags || []).some((t) => t.toLowerCase().includes(q));
        const inCaptions = (entry.photos || []).some((p) => (p.caption || '').toLowerCase().includes(q));
        if (!inTitle && !inBody && !inTags && !inCaptions) return false;
      }
      return true;
    });
  }

  function renderEntriesList() {
    sortEntries();
    const filtered = getFilteredEntries();
    els.entriesList.innerHTML = '';

    if (filtered.length === 0) {
      const msg = entries.length === 0
        ? 'No entries yet. Click "New Entry" to begin your journal.'
        : 'No entries match your current filter.';
      els.entriesList.innerHTML = `<div class="list-empty-note">${msg}</div>`;
      return;
    }

    let currentMonth = '';

    filtered.forEach((entry) => {
      const monthLabel = formatMonthGroup(entry.date);
      if (monthLabel !== currentMonth) {
        currentMonth = monthLabel;
        const header = document.createElement('div');
        header.className = 'month-group-label';
        header.textContent = monthLabel;
        els.entriesList.appendChild(header);
      }

      const d = parseLocalDate(entry.date);
      const dayNum = d.getDate();
      const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
      const moodObj = MOODS.find((m) => m.id === entry.mood);

      const card = document.createElement('div');
      card.className = 'entry-card' + (entry.id === activeEntryId ? ' active' : '');
      card.dataset.id = entry.id;

      const dateBadge = document.createElement('div');
      dateBadge.className = 'entry-date-badge';
      dateBadge.innerHTML = `
        <span class="entry-date-day">${dayNum}</span>
        <span class="entry-date-weekday">${weekday}</span>
      `;

      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'entry-card-body';

      const topRow = document.createElement('div');
      topRow.className = 'entry-card-top';

      const titleEl = document.createElement('h4');
      titleEl.className = 'entry-card-title';
      titleEl.textContent = entry.title.trim() || 'Untitled entry';

      const iconsEl = document.createElement('span');
      iconsEl.className = 'entry-card-meta-icons';
      if (moodObj) {
        const moodSpan = document.createElement('span');
        moodSpan.textContent = moodObj.emoji;
        moodSpan.title = moodObj.label;
        iconsEl.appendChild(moodSpan);
      }
      if (entry.favorite) {
        const starSpan = document.createElement('span');
        starSpan.textContent = '★';
        starSpan.style.color = 'var(--star)';
        iconsEl.appendChild(starSpan);
      }

      topRow.appendChild(titleEl);
      topRow.appendChild(iconsEl);

      const snippetEl = document.createElement('p');
      snippetEl.className = 'entry-card-snippet';
      snippetEl.textContent = entry.body.trim() || (entry.photos && entry.photos.length ? `${entry.photos.length} photo${entry.photos.length > 1 ? 's' : ''}` : 'Empty entry');

      bodyWrap.appendChild(topRow);
      bodyWrap.appendChild(snippetEl);

      card.appendChild(dateBadge);
      card.appendChild(bodyWrap);

      if (entry.photos && entry.photos.length > 0) {
        const thumb = document.createElement('img');
        thumb.className = 'entry-card-thumb';
        thumb.src = entry.photos[0].dataUrl;
        thumb.alt = entry.photos[0].caption || 'Entry photo';
        card.appendChild(thumb);
      }

      card.addEventListener('click', () => {
        selectEntry(entry.id);
        closeMobileSidebar();
      });

      els.entriesList.appendChild(card);
    });
  }

  function renderMoodPicker(selectedMood) {
    els.moodPicker.innerHTML = '';
    MOODS.forEach((mood) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mood-btn' + (selectedMood === mood.id ? ' selected' : '');
      btn.innerHTML = `<span>${mood.emoji}</span><span>${mood.label}</span>`;
      btn.addEventListener('click', () => {
        const entry = getActiveEntry();
        if (!entry) return;
        entry.mood = entry.mood === mood.id ? null : mood.id;
        renderMoodPicker(entry.mood);
        scheduleSave();
      });
      els.moodPicker.appendChild(btn);
    });
  }

  function renderPhotos(entry) {
    const photos = entry.photos || [];
    els.photoCountBadge.textContent = photos.length;
    els.photoGrid.innerHTML = '';

    if (photos.length === 0) {
      els.photoDropHint.classList.remove('hidden');
      return;
    }

    els.photoDropHint.classList.add('hidden');

    photos.forEach((photo, idx) => {
      const card = document.createElement('div');
      card.className = 'photo-card';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'photo-thumb-wrap';
      thumbWrap.addEventListener('click', () => openLightbox(idx));

      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = photo.caption || `Photo ${idx + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'photo-remove-btn';
      removeBtn.title = 'Remove photo';
      removeBtn.setAttribute('aria-label', 'Remove photo');
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        entry.photos.splice(idx, 1);
        entry.updatedAt = Date.now();
        await saveEntryToStore(entry);
        renderPhotos(entry);
        renderEntriesList();
        updateStats();
        showToast('Photo removed');
      });

      thumbWrap.appendChild(img);
      thumbWrap.appendChild(removeBtn);

      const captionInput = document.createElement('input');
      captionInput.type = 'text';
      captionInput.className = 'photo-caption-input';
      captionInput.placeholder = 'Add a caption...';
      captionInput.value = photo.caption || '';
      captionInput.addEventListener('input', () => {
        photo.caption = captionInput.value;
        scheduleSave();
      });

      card.appendChild(thumbWrap);
      card.appendChild(captionInput);
      els.photoGrid.appendChild(card);
    });
  }

  function renderTags(entry) {
    els.tagsList.innerHTML = '';
    (entry.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';

      const label = document.createElement('span');
      label.className = 'tag-chip-label';
      label.textContent = `#${tag}`;
      label.title = `Filter by #${tag}`;
      label.addEventListener('click', () => {
        activeTag = tag;
        els.activeTagName.textContent = `#${tag}`;
        els.activeTagFilter.classList.remove('hidden');
        renderEntriesList();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-chip-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
      removeBtn.addEventListener('click', () => {
        entry.tags = (entry.tags || []).filter((t) => t !== tag);
        renderTags(entry);
        scheduleSave();
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      els.tagsList.appendChild(chip);
    });
  }

  function renderEditor() {
    const entry = getActiveEntry();
    if (!entry) {
      els.emptyState.classList.remove('hidden');
      els.editorContainer.classList.add('hidden');
      els.editorToolbar.classList.add('hidden');
      els.saveStatus.textContent = '';
      return;
    }

    els.emptyState.classList.add('hidden');
    els.editorContainer.classList.remove('hidden');
    els.editorToolbar.classList.remove('hidden');

    els.entryDate.value = entry.date;
    els.entryDayLabel.textContent = formatDayLabel(entry.date);
    els.entryTitle.value = entry.title || '';
    els.entryBody.value = entry.body || '';
    els.favoriteBtn.classList.toggle('favorited', Boolean(entry.favorite));

    renderMoodPicker(entry.mood);
    renderPhotos(entry);
    renderTags(entry);
    autoResizeTextarea();
    updateWordCount(entry.body);
    els.saveStatus.textContent = 'Saved';
  }

  /* -------------------- Entry Actions -------------------- */

  async function createNewEntry() {
    const now = Date.now();
    const newEntry = {
      id: generateId(),
      date: getTodayDateString(),
      title: '',
      body: '',
      mood: null,
      favorite: false,
      tags: [],
      photos: [],
      createdAt: now,
      updatedAt: now
    };

    entries.unshift(newEntry);
    activeEntryId = newEntry.id;
    await saveEntryToStore(newEntry);

    // Clear active filters if they would hide the newly created entry
    if (activeFilter !== 'all' || activeTag || searchQuery) {
      activeFilter = 'all';
      activeTag = null;
      searchQuery = '';
      els.searchInput.value = '';
      els.activeTagFilter.classList.add('hidden');
      els.filterPills.forEach((p) => {
        const isAll = p.dataset.filter === 'all';
        p.classList.toggle('active', isAll);
        p.setAttribute('aria-selected', String(isAll));
      });
    }

    updateStats();
    renderEntriesList();
    renderEditor();
    closeMobileSidebar();
    els.entryTitle.focus();
  }

  function selectEntry(id) {
    if (activeEntryId === id) return;
    activeEntryId = id;
    renderEntriesList();
    renderEditor();
  }

  function scheduleSave() {
    const entry = getActiveEntry();
    if (!entry) return;
    els.saveStatus.textContent = 'Saving...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      entry.updatedAt = Date.now();
      try {
        await saveEntryToStore(entry);
        els.saveStatus.textContent = 'Saved';
        renderEntriesList();
        updateStats();
      } catch (_err) {
        els.saveStatus.textContent = 'Save failed';
      }
    }, 350);
  }

  async function deleteActiveEntry() {
    const entry = getActiveEntry();
    if (!entry) return;

    const idToDelete = entry.id;
    entries = entries.filter((e) => e.id !== idToDelete);
    await deleteEntryFromStore(idToDelete);

    const remaining = getFilteredEntries();
    activeEntryId = remaining.length > 0 ? remaining[0].id : (entries[0] ? entries[0].id : null);

    updateStats();
    renderEntriesList();
    renderEditor();
    showToast('Entry deleted');
  }

  /* -------------------- Lightbox -------------------- */

  function openLightbox(index) {
    const entry = getActiveEntry();
    if (!entry || !entry.photos || entry.photos.length === 0) return;

    lightboxIndex = index;
    updateLightboxView();
    els.lightbox.classList.remove('hidden');
  }

  function updateLightboxView() {
    const entry = getActiveEntry();
    if (!entry || !entry.photos || entry.photos.length === 0) return;

    const photos = entry.photos;
    if (lightboxIndex < 0) lightboxIndex = photos.length - 1;
    if (lightboxIndex >= photos.length) lightboxIndex = 0;

    const photo = photos[lightboxIndex];
    els.lightboxImg.src = photo.dataUrl;
    els.lightboxImg.alt = photo.caption || 'Diary photo';
    els.lightboxCaption.textContent = photo.caption || '';
    els.lightboxCounter.textContent = `${lightboxIndex + 1} / ${photos.length}`;

    const showNav = photos.length > 1;
    els.lightboxPrev.classList.toggle('hidden', !showNav);
    els.lightboxNext.classList.toggle('hidden', !showNav);
  }

  function closeLightbox() {
    els.lightbox.classList.add('hidden');
    els.lightboxImg.src = '';
  }

  /* -------------------- Backup & Import -------------------- */

  function exportBackup() {
    const payload = {
      app: 'PersonalDiary',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-backup-${getTodayDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = Array.isArray(parsed) ? parsed : parsed.entries;

      if (!Array.isArray(imported)) {
        showToast('Invalid backup file format.');
        return;
      }

      const existingIds = new Set(entries.map((e) => e.id));
      let added = 0;

      for (const item of imported) {
        if (!item || typeof item !== 'object') continue;
        const normalized = {
          id: item.id && !existingIds.has(item.id) ? item.id : generateId(),
          date: item.date || getTodayDateString(),
          title: String(item.title || ''),
          body: String(item.body || ''),
          mood: item.mood || null,
          favorite: Boolean(item.favorite),
          tags: Array.isArray(item.tags) ? item.tags : [],
          photos: Array.isArray(item.photos) ? item.photos : [],
          createdAt: item.createdAt || Date.now(),
          updatedAt: item.updatedAt || Date.now()
        };
        entries.push(normalized);
        await saveEntryToStore(normalized);
        added++;
      }

      sortEntries();
      if (!activeEntryId && entries.length > 0) {
        activeEntryId = entries[0].id;
      }
      updateStats();
      renderEntriesList();
      renderEditor();
      showToast(`Imported ${added} ${added === 1 ? 'entry' : 'entries'}`);
    } catch (_err) {
      showToast('Could not read backup file.');
    }
  }

  /* -------------------- Mobile Sidebar -------------------- */

  function openMobileSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.classList.add('open');
  }

  function closeMobileSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('open');
  }

  /* -------------------- Event Listeners -------------------- */

  function bindEvents() {
    // Theme toggle
    els.themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    // Mobile sidebar
    els.openSidebarBtn.addEventListener('click', openMobileSidebar);
    els.closeSidebarBtn.addEventListener('click', closeMobileSidebar);
    els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

    // New entry
    els.newEntryBtn.addEventListener('click', createNewEntry);
    els.emptyNewEntryBtn.addEventListener('click', createNewEntry);

    // Search & filters
    els.searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderEntriesList();
    });

    els.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        activeFilter = pill.dataset.filter;
        els.filterPills.forEach((p) => {
          const active = p === pill;
          p.classList.toggle('active', active);
          p.setAttribute('aria-selected', String(active));
        });
        renderEntriesList();
      });
    });

    els.clearTagFilterBtn.addEventListener('click', () => {
      activeTag = null;
      els.activeTagFilter.classList.add('hidden');
      renderEntriesList();
    });

    // Editor fields
    els.entryDate.addEventListener('change', () => {
      const entry = getActiveEntry();
      if (!entry) return;
      entry.date = els.entryDate.value || getTodayDateString();
      els.entryDayLabel.textContent = formatDayLabel(entry.date);
      scheduleSave();
    });

    els.entryTitle.addEventListener('input', () => {
      const entry = getActiveEntry();
      if (!entry) return;
      entry.title = els.entryTitle.value;
      scheduleSave();
    });

    els.entryBody.addEventListener('input', () => {
      const entry = getActiveEntry();
      if (!entry) return;
      entry.body = els.entryBody.value;
      autoResizeTextarea();
      updateWordCount(entry.body);
      scheduleSave();
    });

    // Favorite toggle
    els.favoriteBtn.addEventListener('click', () => {
      const entry = getActiveEntry();
      if (!entry) return;
      entry.favorite = !entry.favorite;
      els.favoriteBtn.classList.toggle('favorited', entry.favorite);
      scheduleSave();
    });

    // Delete modal
    els.deleteEntryBtn.addEventListener('click', () => {
      if (!getActiveEntry()) return;
      els.confirmModal.classList.remove('hidden');
    });

    els.confirmCancelBtn.addEventListener('click', () => {
      els.confirmModal.classList.add('hidden');
    });

    els.confirmDeleteBtn.addEventListener('click', async () => {
      els.confirmModal.classList.add('hidden');
      await deleteActiveEntry();
    });

    els.confirmModal.addEventListener('click', (e) => {
      if (e.target === els.confirmModal) {
        els.confirmModal.classList.add('hidden');
      }
    });

    // Tags input
    els.tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const entry = getActiveEntry();
        if (!entry) return;
        const clean = els.tagInput.value.trim().replace(/^#/, '').toLowerCase();
        if (clean && !(entry.tags || []).includes(clean)) {
          entry.tags = entry.tags || [];
          entry.tags.push(clean);
          renderTags(entry);
          scheduleSave();
        }
        els.tagInput.value = '';
      }
    });

    // Photo file upload
    const triggerPhotoPicker = () => els.photoFileInput.click();
    els.addPhotoToolbarBtn.addEventListener('click', triggerPhotoPicker);
    els.addPhotoInlineBtn.addEventListener('click', triggerPhotoPicker);

    els.photoFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleImageFiles(e.target.files);
      }
      els.photoFileInput.value = '';
    });

    // Drag & drop images onto editor
    let dragCounter = 0;
    els.dropZone.addEventListener('dragenter', (e) => {
      if (!getActiveEntry()) return;
      e.preventDefault();
      dragCounter++;
      els.dropOverlay.classList.remove('hidden');
    });

    els.dropZone.addEventListener('dragover', (e) => {
      if (!getActiveEntry()) return;
      e.preventDefault();
    });

    els.dropZone.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        els.dropOverlay.classList.add('hidden');
      }
    });

    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      els.dropOverlay.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImageFiles(e.dataTransfer.files);
      }
    });

    // Paste images from clipboard
    document.addEventListener('paste', (e) => {
      if (!getActiveEntry()) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const pastedImages = [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) pastedImages.push(file);
        }
      }
      if (pastedImages.length > 0) {
        e.preventDefault();
        handleImageFiles(pastedImages);
      }
    });

    // Lightbox controls
    els.lightboxClose.addEventListener('click', closeLightbox);
    els.lightboxPrev.addEventListener('click', () => {
      lightboxIndex--;
      updateLightboxView();
    });
    els.lightboxNext.addEventListener('click', () => {
      lightboxIndex++;
      updateLightboxView();
    });
    els.lightbox.addEventListener('click', (e) => {
      if (e.target === els.lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (els.lightbox.classList.contains('hidden')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') {
        lightboxIndex--;
        updateLightboxView();
      }
      if (e.key === 'ArrowRight') {
        lightboxIndex++;
        updateLightboxView();
      }
    });

    // Backup & Import
    els.exportBtn.addEventListener('click', exportBackup);
    els.importBtn.addEventListener('click', () => els.importFileInput.click());
    els.importFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importBackup(e.target.files[0]);
      }
      els.importFileInput.value = '';
    });
  }

  /* -------------------- Init -------------------- */

  async function init() {
    initTheme();
    bindEvents();
    await openDatabase();
    entries = await loadAllEntries();
    sortEntries();

    if (entries.length > 0) {
      activeEntryId = entries[0].id;
    }

    updateStats();
    renderEntriesList();
    renderEditor();
  }

  init();
})();
