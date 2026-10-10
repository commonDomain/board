'use strict';

(function installWhiteboardStorage(global) {
  const DATABASE_NAME = 'museboard-client';
  const DATABASE_VERSION = 5;
  const OUTBOX_STORE = 'outbox';
  const SNAPSHOT_STORE = 'snapshots';
  const GUEST_CANVAS_STORE = 'guestCanvases';
  const GUEST_GUIDE_DISMISSAL_ID = 'guest_guide_dismissed';
  const SHEET_DRAFT_STORE = 'sheetDrafts';
  const FALLBACK_LIMIT = 1024 * 1024;
  let databasePromise = null;
  let lastTimestamp = 0;
  const writeTails = new Map();
  let storageScope = 'legacy';
  let scopeGeneration = 0;
  let guestMemoryMode = false;
  let guideProvisioning = null;
  const guestMemoryCanvases = new Map();
  const guestBlobCache = new Map();
  try { localStorage.removeItem('wb:workspaceMode'); } catch { /* Storage may be unavailable. */ }

  function retireNoteOperation(op) {
    if (!op || /^(note-(upsert|reorder|place|delete|unlink|delete-content)|canvas-place)$/.test(op.kind)) return null;
    delete op.notebook;
    if (op.kind === 'batch') { op.ops = (op.ops || []).map(retireNoteOperation).filter(Boolean); if (!op.ops.length) return null; }
    return op;
  }

  function nextTimestamp() {
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    return lastTimestamp;
  }

  function openDatabase() {
    if (!('indexedDB' in global)) {
      return Promise.reject(new Error('IndexedDB is unavailable'));
    }
    if (databasePromise) {
      return databasePromise;
    }
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          database.createObjectStore(OUTBOX_STORE, { keyPath: 'boardId' });
        }
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'boardId' });
        }
        if (!database.objectStoreNames.contains(GUEST_CANVAS_STORE)) {
          database.createObjectStore(GUEST_CANVAS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(SHEET_DRAFT_STORE)) {
          database.createObjectStore(SHEET_DRAFT_STORE, { keyPath: 'boardId' });
        }
        for (const name of [SNAPSHOT_STORE, GUEST_CANVAS_STORE, OUTBOX_STORE]) {
          const cursor = request.transaction.objectStore(name).openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            const record = entry.value;
            if (record.state) delete record.state.notebook;
            if (record.snapshot) delete record.snapshot.notebook;
            if (Array.isArray(record.messages)) record.messages = record.messages.filter(message => Boolean(retireNoteOperation(message?.op)));
            entry.update(record); entry.continue();
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked'));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function runTransaction(storeName, mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode, { durability: 'strict' });
      const store = transaction.objectStore(storeName);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(request && request.result);
      transaction.onerror = () => reject(transaction.error || request?.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function fallbackKey(kind, boardId) {
    return `museboard:${kind}:${boardId}`;
  }

  function scopedBoardId(boardId) {
    return storageScope === 'legacy' ? boardId : `${storageScope}:${boardId}`;
  }

  function setScope(scope) {
    const value = String(scope || '').trim();
    if ((value || 'legacy') !== storageScope) scopeGeneration += 1;
    storageScope = value || 'legacy';
  }

  async function clearScope(scope) {
    const value = String(scope || '').trim();
    if (!value || value === 'legacy' || value === 'guest') return;
    const prefix = `${value}:`;
    for (const storeName of [OUTBOX_STORE, SNAPSHOT_STORE, SHEET_DRAFT_STORE]) {
      try {
        await runTransaction(storeName, 'readwrite', (store) => {
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            if (String(entry.key).startsWith(prefix)) entry.delete();
            entry.continue();
          };
          return cursor;
        });
      } catch {}
    }
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('museboard:') && key.includes(`:${prefix}`)) localStorage.removeItem(key);
      }
    } catch {}
  }

  function readFallback(kind, boardId) {
    try {
      const raw = localStorage.getItem(fallbackKey(kind, boardId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeFallback(kind, boardId, value) {
    try {
      if (value === null) {
        localStorage.removeItem(fallbackKey(kind, boardId));
        return true;
      }
      const serialized = JSON.stringify(value);
      if (serialized.length > FALLBACK_LIMIT) {
        return false;
      }
      localStorage.setItem(fallbackKey(kind, boardId), serialized);
      return true;
    } catch {
      return false;
    }
  }

  function writeFallbackIfNewer(kind, boardId, value) {
    if (value === null) {
      return writeFallback(kind, boardId, null);
    }
    const current = readFallback(kind, boardId);
    const currentTime = Number(current?.updatedAt) || 0;
    const nextTime = Number(value.updatedAt) || 0;
    if (current && currentTime > nextTime) {
      return true;
    }
    return writeFallback(kind, boardId, value);
  }

  function newestRecord(primary, fallback) {
    if (!primary) return fallback;
    if (!fallback) return primary;
    const primaryTime = Number(primary.updatedAt) || 0;
    const fallbackTime = Number(fallback.updatedAt) || 0;
    return fallbackTime >= primaryTime ? fallback : primary;
  }

  function enqueueWrite(store, boardId, task) {
    const key = `${store}:${boardId}`;
    const previous = writeTails.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    writeTails.set(key, next);
    return next.finally(() => {
      if (writeTails.get(key) === next) {
        writeTails.delete(key);
      }
    });
  }

  async function loadRecord(store, kind, boardId) {
    const fallback = readFallback(kind, boardId);
    let primary = null;
    try {
      primary = await runTransaction(store, 'readonly', (objectStore) => objectStore.get(boardId));
    } catch {
      // Private browsing and full storage quotas can make IndexedDB unavailable.
    }
    return newestRecord(primary, fallback);
  }

  function saveRecord(store, kind, record) {
    record = structuredClone(record);
    return enqueueWrite(store, record.boardId, async () => {
      let durable = false;
      try {
        await runTransaction(store, 'readwrite', (objectStore) => objectStore.put(record));
        durable = true;
      } catch {
        durable = false;
      }
      if (durable && (kind === 'snapshot' || kind === 'sheet-draft')) {
        // IndexedDB is the durable snapshot store. Keeping a second copy in
        // localStorage would synchronously stringify the complete canvas on
        // every save and can stall switching large canvases.
        writeFallback(kind, record.boardId, null);
        return true;
      }
      const fallbackSaved = writeFallbackIfNewer(kind, record.boardId, record);
      return durable || fallbackSaved;
    });
  }

  async function loadOutbox(boardId) {
    const record = await loadRecord(OUTBOX_STORE, 'outbox', scopedBoardId(boardId));
    if (!record || ![2, 3, 4].includes(record.schema) || !Array.isArray(record.messages)) {
      return [];
    }
    const before = JSON.stringify(record.messages);
    const messages = record.messages.filter(message => message && message.type === 'op' && typeof message.opId === 'string').filter(message => Boolean(retireNoteOperation(message.op)));
    if (before !== JSON.stringify(messages)) await saveOutbox(boardId, messages);
    return messages;
  }

  async function saveOutbox(boardId, messages) {
    return saveRecord(OUTBOX_STORE, 'outbox', {
      boardId: scopedBoardId(boardId),
      schema: 4,
      updatedAt: nextTimestamp(),
      messages
    });
  }

  function flushOutboxFallback(boardId, messages) {
    const scopedId = scopedBoardId(boardId);
    return writeFallbackIfNewer('outbox', scopedId, {
      boardId: scopedId,
      schema: 4,
      updatedAt: nextTimestamp(),
      messages
    });
  }

  async function loadSnapshot(boardId) {
    const scopedId = scopedBoardId(boardId);
    const record = await loadRecord(SNAPSHOT_STORE, 'snapshot', scopedId);
    if (!record || ![2, 3, 4].includes(record.schema) || !record.state || record.state.boardId !== boardId) {
      return null;
    }
    if (Object.hasOwn(record.state, 'notebook')) {
      delete record.state.notebook;
      await saveSnapshot(boardId, record.state);
    }
    return record.state;
  }

  async function saveSnapshot(boardId, state) {
    return saveRecord(SNAPSHOT_STORE, 'snapshot', {
      boardId: scopedBoardId(boardId),
      schema: 4,
      revision: Number(state.revision) || 0,
      updatedAt: nextTimestamp(),
      state
    });
  }

  function sheetDraftId(boardId, itemId) {
    return `${scopedBoardId(boardId)}:${String(itemId || '')}`;
  }

  async function loadSheetDraft(boardId, itemId) {
    const id = sheetDraftId(boardId, itemId);
    const record = await loadRecord(SHEET_DRAFT_STORE, 'sheet-draft', id);
    if (
      !record
      || record.schema !== 1
      || record.sourceBoardId !== boardId
      || record.itemId !== itemId
      || !record.workbook
    ) return null;
    const loaded = {
      boardId,
      itemId,
      updatedAt: Number(record.updatedAt) || 0,
      workbook: structuredClone(record.workbook)
    };
    if (record.pendingInput) loaded.pendingInput = structuredClone(record.pendingInput);
    return loaded;
  }

  async function saveSheetDraft(boardId, itemId, workbook, updatedAt = Date.now()) {
    const id = sheetDraftId(boardId, itemId);
    return saveRecord(SHEET_DRAFT_STORE, 'sheet-draft', {
      boardId: id,
      schema: 1,
      sourceBoardId: boardId,
      itemId,
      updatedAt: Number(updatedAt) || nextTimestamp(),
      workbook
    });
  }

  async function saveSheetPendingInput(boardId, itemId, workbook, pendingInput, updatedAt = Date.now()) {
    const id = sheetDraftId(boardId, itemId);
    return saveRecord(SHEET_DRAFT_STORE, 'sheet-draft', {
      boardId: id,
      schema: 1,
      sourceBoardId: boardId,
      itemId,
      updatedAt: Number(updatedAt) || nextTimestamp(),
      workbook,
      pendingInput: pendingInput || null
    });
  }

  async function deleteSheetDraft(boardId, itemId) {
    const id = sheetDraftId(boardId, itemId);
    writeFallback('sheet-draft', id, null);
    try {
      await runTransaction(SHEET_DRAFT_STORE, 'readwrite', (store) => store.delete(id));
      return true;
    } catch {
      return false;
    }
  }

  function guestCanvasId() {
    const uuid = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `guest_${uuid.replace(/-/g, '')}`;
  }

  function defaultGuestState(boardId) {
    const state = {
      version: 5,
      boardId,
      revision: 0,
      savedAt: null,
      updatedAt: Date.now(),
      items: [],
      sections: [],
      groups: [],
      layers: [{ id: 'layer_default', name: '默认图层', visible: true, locked: false }],
      settings: { background: { type: 'dots' } }
    };
    return state;
  }

  function migrateGuestSnapshot(boardId, snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const migrated = structuredClone(snapshot);
    migrated.boardId = boardId;
    delete migrated.notebook;
    migrated.version = 5;
    return migrated;
  }

  function dataUrlToBlob(value) {
    const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/i);
    if (!match || typeof global.atob !== 'function' || typeof global.Blob !== 'function') return null;
    try {
      const binary = global.atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new global.Blob([bytes], { type: match[1].toLowerCase() });
    } catch {
      return null;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new global.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read guest image'));
      reader.readAsDataURL(blob);
    });
  }

  function packGuestSnapshot(boardId, snapshot) {
    const packed = structuredClone(snapshot);
    const imageBlobs = [];
    const activeKeys = new Set();
    for (const item of Array.isArray(packed.items) ? packed.items : []) {
      if (item?.type !== 'image') continue;
      const cacheKey = `${boardId}:${item.id}`;
      activeKeys.add(cacheKey);
      const cached = guestBlobCache.get(cacheKey);
      const blob = cached?.src === item.src ? cached.blob : dataUrlToBlob(item.src);
      if (!blob) continue;
      guestBlobCache.set(cacheKey, { src: item.src, blob });
      imageBlobs.push({ itemId: item.id, blob });
      item.src = `guest-blob:${item.id}`;
      delete item.assetId;
    }
    for (const key of guestBlobCache.keys()) {
      if (key.startsWith(`${boardId}:`) && !activeKeys.has(key)) guestBlobCache.delete(key);
    }
    return { snapshot: packed, imageBlobs };
  }

  async function hydrateGuestSnapshot(record) {
    if (!record?.snapshot) return null;
    const snapshot = structuredClone(record.snapshot);
    const blobs = new Map((record.imageBlobs || []).map((entry) => [entry.itemId, entry.blob]));
    await Promise.all((snapshot.items || []).map(async (item) => {
      if (item?.type !== 'image' || !String(item.src || '').startsWith('guest-blob:')) return;
      const blob = blobs.get(item.id);
      if (!blob) throw new Error(`Guest image ${item.id} is unavailable`);
      item.src = await blobToDataUrl(blob);
      guestBlobCache.set(`${record.id}:${item.id}`, { src: item.src, blob });
    }));
    return snapshot;
  }

  async function listGuestCanvases(options = {}) {
    let records = [];
    try {
      if (guestMemoryMode) throw new Error('memory mode');
      records = await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.getAll());
    } catch {
      guestMemoryMode = true;
      records = Array.from(guestMemoryCanvases.values());
    }
    const guideDismissed = (records || []).some((record) => record.id === GUEST_GUIDE_DISMISSAL_ID);
    let canvases = (records || []).filter((record) => record.id !== GUEST_GUIDE_DISMISSAL_ID)
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    if (options.createIfEmpty !== false && !guideDismissed && !canvases.some((canvas) => canvas.isGuide)) {
      if (!guideProvisioning) {
        guideProvisioning = (async () => {
          if (guestMemoryMode ? guestMemoryCanvases.has(GUEST_GUIDE_DISMISSAL_ID)
            : await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.get(GUEST_GUIDE_DISMISSAL_ID))) return null;
          const current = await listGuestCanvases({ createIfEmpty: false });
          const existingGuide = current.find((canvas) => canvas.isGuide);
          if (existingGuide) return existingGuide;
          const response = await fetch(new URL('guide-template.json', document.baseURI), { cache: 'force-cache' });
          if (!response.ok) throw new Error('无法加载操作指南模板');
          const template = await response.json();
          return createGuestCanvas('操作指南', { isGuide: true, template });
        })().finally(() => { guideProvisioning = null; });
      }
      const guide = await guideProvisioning;
      if (guide) canvases.push(guide);
    }
    return canvases.map(({ snapshot, imageBlobs, ...canvas }) => ({
      ...canvas,
      hasContent: Boolean(
        snapshot?.items?.length
        || snapshot?.sections?.length
        || snapshot?.groups?.length
      )
    }));
  }

  async function createGuestCanvas(name, options = {}) {
    const normalized = String(name || '').normalize('NFKC').trim();
    if (!normalized || Array.from(normalized).length > 30) throw Object.assign(new Error('画布名称无效'), { code: 'INVALID_CANVAS_NAME' });
    const existing = await listGuestCanvases({ createIfEmpty: false });
    if (!options.isGuide && existing.filter((canvas) => !canvas.isGuide).length >= 10) throw Object.assign(new Error('最多只能创建 10 个画布'), { code: 'CANVAS_LIMIT_REACHED' });
    if (existing.some((canvas) => canvas.name === normalized)) {
      if (!options.isGuide) throw Object.assign(new Error('该画布名称已存在'), { code: 'CANVAS_NAME_EXISTS' });
      let suffix = 2;
      do { name = `操作指南 (${suffix++})`; }
      while (existing.some((canvas) => canvas.name === name));
    }
    const id = guestCanvasId();
    const record = {
      id,
      name: options.isGuide ? name : normalized,
      isGuide: Boolean(options.isGuide),
      sortOrder: existing.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      visibility: 'private',
      canManage: true,
      ownerUserId: null,
      snapshot: options.template
        ? migrateGuestSnapshot(id, { ...options.template, boardId: id, revision: 0, savedAt: null, updatedAt: Date.now() })
        : defaultGuestState(id),
      imageBlobs: []
    };
    if (guestMemoryMode) guestMemoryCanvases.set(id, structuredClone(record));
    else {
      try {
        await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.put(record));
      } catch {
        guestMemoryMode = true;
        guestMemoryCanvases.set(id, structuredClone(record));
      }
    }
    return { ...record, snapshot: undefined };
  }

  async function loadGuestCanvas(boardId) {
    if (guestMemoryMode) {
      const memoryRecord = guestMemoryCanvases.get(boardId);
      if (!memoryRecord?.snapshot) return null;
      const migrated = migrateGuestSnapshot(boardId, memoryRecord.snapshot);
      memoryRecord.snapshot = structuredClone(migrated);
      guestMemoryCanvases.set(boardId, memoryRecord);
      return migrated;
    }
    const record = await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.get(boardId));
    if (!record?.snapshot) return null;
    const needsMigration = record.snapshot.version !== 5 || Boolean(record.snapshot.notebook);
    record.snapshot = migrateGuestSnapshot(boardId, record.snapshot);
    if (needsMigration) {
      record.updatedAt = Date.now();
      await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.put(record));
    }
    return hydrateGuestSnapshot(record);
  }

  async function saveGuestCanvas(boardId, snapshot) {
    return enqueueWrite(GUEST_CANVAS_STORE, boardId, async () => {
      if (guestMemoryMode) {
        const memoryRecord = guestMemoryCanvases.get(boardId);
        if (!memoryRecord) throw Object.assign(new Error('游客画布不存在'), { code: 'CANVAS_NOT_FOUND' });
        memoryRecord.snapshot = structuredClone(snapshot);
        memoryRecord.updatedAt = Date.now();
        guestMemoryCanvases.set(boardId, memoryRecord);
        return true;
      }
      const current = await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.get(boardId));
      if (!current) throw Object.assign(new Error('游客画布不存在'), { code: 'CANVAS_NOT_FOUND' });
      const packed = packGuestSnapshot(boardId, migrateGuestSnapshot(boardId, snapshot));
      current.snapshot = packed.snapshot;
      current.snapshot.boardId = boardId;
      current.imageBlobs = packed.imageBlobs;
      current.updatedAt = Date.now();
      await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.put(current));
      return true;
    });
  }

  async function renameGuestCanvas(boardId, name) {
    const normalized = String(name || '').normalize('NFKC').trim();
    const existing = await listGuestCanvases({ createIfEmpty: false });
    if (!normalized || Array.from(normalized).length > 30) throw Object.assign(new Error('画布名称无效'), { code: 'INVALID_CANVAS_NAME' });
    if (existing.some((canvas) => canvas.id !== boardId && canvas.name === normalized)) throw Object.assign(new Error('该画布名称已存在'), { code: 'CANVAS_NAME_EXISTS' });
    const record = guestMemoryMode
      ? guestMemoryCanvases.get(boardId)
      : await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.get(boardId));
    if (!record) throw Object.assign(new Error('游客画布不存在'), { code: 'CANVAS_NOT_FOUND' });
    record.name = normalized;
    record.updatedAt = Date.now();
    if (guestMemoryMode) guestMemoryCanvases.set(boardId, record);
    else await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.put(record));
    return { ...record, snapshot: undefined };
  }

  async function reorderGuestCanvases(ids) {
    const existing = await listGuestCanvases({ createIfEmpty: false });
    if (!Array.isArray(ids) || ids.length !== existing.length || new Set(ids).size !== ids.length || existing.some((canvas) => !ids.includes(canvas.id))) {
      throw Object.assign(new Error('画布顺序已改变'), { code: 'CANVAS_CATALOG_CHANGED' });
    }
    const records = guestMemoryMode
      ? ids.map((id) => guestMemoryCanvases.get(id))
      : await Promise.all(ids.map((id) => runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.get(id))));
    for (let index = 0; index < records.length; index += 1) {
      records[index].sortOrder = index;
      records[index].updatedAt = Date.now();
      if (guestMemoryMode) guestMemoryCanvases.set(records[index].id, records[index]);
      else await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.put(records[index]));
    }
    return listGuestCanvases({ createIfEmpty: false });
  }

  async function deleteGuestCanvas(boardId) {
    const existing = await listGuestCanvases({ createIfEmpty: false });
    const canvas = existing.find((entry) => entry.id === boardId);
    if (!canvas) throw Object.assign(new Error('游客画布不存在'), { code: 'CANVAS_NOT_FOUND' });
    if (guestMemoryMode) {
      if (canvas.isGuide) guestMemoryCanvases.set(GUEST_GUIDE_DISMISSAL_ID, { id: GUEST_GUIDE_DISMISSAL_ID, dismissedAt: Date.now() });
      guestMemoryCanvases.delete(boardId);
    } else {
      await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => {
        const request = store.delete(boardId);
        if (canvas.isGuide) store.put({ id: GUEST_GUIDE_DISMISSAL_ID, dismissedAt: Date.now() });
        return request;
      });
    }
    for (const key of guestBlobCache.keys()) if (key.startsWith(`${boardId}:`)) guestBlobCache.delete(key);
    const remaining = existing.filter((entry) => entry.id !== boardId);
    return remaining.length
      ? reorderGuestCanvases(remaining.map((entry) => entry.id))
      : listGuestCanvases();
  }

  async function exportGuestCanvases(ids = null, options = {}) {
    const records = guestMemoryMode
      ? Array.from(guestMemoryCanvases.values())
      : await runTransaction(GUEST_CANVAS_STORE, 'readonly', (store) => store.getAll());
    const allowed = Array.isArray(ids) ? new Set(ids) : null;
    const selected = (records || [])
      .filter((record) => record.id !== GUEST_GUIDE_DISMISSAL_ID && !record.isGuide && (!allowed || allowed.has(record.id)))
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    return Promise.all(selected.map(async (record) => ({
      id: record.id,
      name: record.name,
      snapshot: guestMemoryMode || options.hydrateImages === false
        ? structuredClone(record.snapshot)
        : await hydrateGuestSnapshot(record)
    })));
  }

  async function removeGuestCanvases(ids) {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    if (!selected.size) return;
    for (const id of selected) {
      if (guestMemoryMode) guestMemoryCanvases.delete(id);
      else await runTransaction(GUEST_CANVAS_STORE, 'readwrite', (store) => store.delete(id));
      for (const key of guestBlobCache.keys()) if (key.startsWith(`${id}:`)) guestBlobCache.delete(key);
    }
    const remaining = await listGuestCanvases({ createIfEmpty: false });
    if (remaining.length) await reorderGuestCanvases(remaining.map((canvas) => canvas.id));
  }

  global.WhiteboardStorage = Object.freeze({
    getScope: () => storageScope,
    getGeneration: () => scopeGeneration,
    setScope,
    clearScope,
    loadOutbox,
    saveOutbox,
    flushOutboxFallback,
    loadSnapshot,
    saveSnapshot,
    loadSheetDraft,
    saveSheetDraft,
    saveSheetPendingInput,
    deleteSheetDraft,
    listGuestCanvases,
    createGuestCanvas,
    loadGuestCanvas,
    saveGuestCanvas,
    renameGuestCanvas,
    reorderGuestCanvases,
    deleteGuestCanvas,
    exportGuestCanvases,
    removeGuestCanvases,
    guestStorageIsDurable() { return !guestMemoryMode; }
  });
})(window);
