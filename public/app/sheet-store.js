

import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';
import { markDirty } from './save-status.js';

import { state } from './state.js';

import { makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';
import { ensureSheetModules, sheetWorkbooksEqual, sheetDraftKey } from './sheet-store-model.js';

let isGuestMode,
  getViewportDropPoint,
  refreshSheetTabs,
  enqueueOperation,
  restoreNavigationTool;

function configureSheetStore(callbacks) {
  ({
    isGuestMode,
    getViewportDropPoint,
    refreshSheetTabs,
    enqueueOperation,
    restoreNavigationTool
  } = callbacks);
}

const SHEET_ITEM_WIDTH = 960;

const SHEET_ITEM_HEIGHT = 600;

const SHEET_SAVE_DEBOUNCE_MS = 350;

const sheetStores = new Map();

const sheetPreviews = new Map();

const sheetPreviewActiveSheets = new Map();

const sheetSaveTimers = new Map();

const sheetDraftWrites = new Map();

const sheetLockRequests = new Map();

const sheetHeldLocks = new Map();

const sheetRemoteLocks = new Map();

const sheetCommandCommits = new Map();

const sheetRecoveredInputs = new Map();

const sheetInputDraftTimers = new Map();

const sheetInputDraftWrites = new Map();

let sheetPageHideWired = false;

function getSheetRecord(item) {
  if (!item || item.type !== 'sheet' || !ensureSheetModules()) return null;
  if (!item.workbook || typeof item.workbook !== 'object') {
    item.workbook = window.SheetCore.createWorkbook();
  }
  let record = sheetStores.get(item.id);
  if (!record) {
    const store = window.SheetCore.createStore(item.workbook);
    record = { store, item, serverStructureVersion: Math.max(0, Number(store.workbook.structureVersion) || 0) };
    sheetStores.set(item.id, record);
    bindSheetStore(record, item.id);
  } else if (record.store.workbook !== item.workbook) {
    // Server acknowledgements and persistence round-trips clone the whole item.
    // When the workbook is unchanged, retain the live store: recreating it here
    // discarded the undo/redo stacks after every successful save.
    if (sheetWorkbooksEqual(record.store.workbook, item.workbook)) {
      item.workbook = record.store.workbook;
      record.item = item;
      return record;
    }
    // A genuinely different workbook is a remote change, board undo or reload.
    // Rebuild the model so stale local data cannot overwrite that state.
    record.unsubscribe?.();
    record.store.destroy?.();
    const store = window.SheetCore.createStore(item.workbook);
    record.store = store;
    record.item = item;
    bindSheetStore(record, item.id);
    if (sheetStoreRuntime.sheetEditorItemId === item.id)
      sheetStoreRuntime.sheetEditor?.setStore(store, store.activeSheetIndex());
  } else {
    record.item = item;
  }
  return record;
}

function bindSheetStore(record, itemId) {
  record.unsubscribe?.();
  record.unsubscribe = record.store.on((event) => {
    // Any model change makes the canvas element stale.
    const live = sheetStores.get(itemId);
    if (live) live.previewController?.requestDraw?.();
    // Adding, renaming, removing or activating a sheet changes the canvas bar.
    if (event?.type?.startsWith('sheet-')) {
      const item = state.items.get(itemId);
      if (item) refreshSheetTabs(item);
    }
  });
}

function sheetPreviewIndex(item, record = sheetStores.get(item?.id) || getSheetRecord(item)) {
  const sheets = record?.store?.workbook?.sheets || [];
  if (!sheets.length) return 0;
  const preferredId = sheetPreviewActiveSheets.get(item.id);
  let index = preferredId ? sheets.findIndex((sheet) => sheet.sheetId === preferredId) : -1;
  if (index < 0) index = Math.max(0, Math.min(sheets.length - 1, record.store.activeSheetIndex()));
  sheetPreviewActiveSheets.set(item.id, sheets[index].sheetId);
  return index;
}

function setSheetPreviewIndex(item, record, index) {
  const sheet = record?.store?.workbook?.sheets?.[index];
  if (!sheet) return false;
  sheetPreviewActiveSheets.set(item.id, sheet.sheetId);
  return true;
}

function destroySheetRecord(itemId) {
  const record = sheetStores.get(itemId);
  if (!record) return;
  record.store.destroy?.();
  record.unsubscribe?.();
  sheetStores.delete(itemId);
  sheetPreviewActiveSheets.delete(itemId);
  const timer = sheetSaveTimers.get(itemId);
  if (timer) {
    clearTimeout(timer);
    sheetSaveTimers.delete(itemId);
  }
}

function destroyAllSheetRecords() {
  for (const itemId of Array.from(sheetStores.keys())) destroySheetRecord(itemId);
  for (const itemId of Array.from(sheetPreviews.keys())) destroySheetPreview(itemId);
}

function destroySheetPreview(itemId) {
  const preview = sheetPreviews.get(itemId);
  if (!preview) return;
  if (preview.frame) cancelAnimationFrame(preview.frame);
  preview.renderer?.destroy?.();
  const record = sheetStores.get(itemId);
  if (record?.previewController === preview.renderer) record.previewController = null;
  sheetPreviews.delete(itemId);
}

function flushSheetSave(itemId) {
  const timer = sheetSaveTimers.get(itemId);
  const hadPendingTimer = Boolean(timer);
  if (timer) {
    clearTimeout(timer);
    sheetSaveTimers.delete(itemId);
  }
  const record = sheetStores.get(itemId);
  const item = state.items.get(itemId);
  if (!record || !item) return;
  if (Array.from(sheetCommandCommits.values()).some((command) => command.itemId === itemId)) {
    void persistSheetDraft(itemId);
    if (hadPendingTimer && !sheetSaveTimers.has(itemId)) {
      sheetSaveTimers.set(
        itemId,
        setTimeout(() => flushSheetSave(itemId), SHEET_SAVE_DEBOUNCE_MS)
      );
    }
    markDirty(true);
    updateSheetSaveState();
    return;
  }
  // Non-cell changes use the same durable command queue. The expected content
  // version prevents a delayed local snapshot from overwriting a collaborator's
  // acknowledged edit; the recovery draft remains available if it conflicts.
  record.previewController?.requestDraw?.();
  const expectedContentVersion = Math.max(0, Number(item.contentVersion) || 0);
  const queued = enqueueOperation({
    kind: 'sheet-command',
    itemId,
    command: {
      type: 'replace-workbook',
      protocolVersion: window.SheetProtocol.VERSION,
      expectedContentVersion,
      expectedStructureVersion: Math.max(0, Number(record.serverStructureVersion) || 0),
      workbook: structuredClone(record.store.workbook),
      editedAt: Math.max(Date.now(), Number(item.sheetEditedAt) || 0)
    }
  });
  if (queued && !isGuestMode()) item.contentVersion = expectedContentVersion + 1;
  markDirty(true);
  updateSheetSaveState();
}

function sheetDraftState(itemId, boardId = state.boardId) {
  const key = sheetDraftKey(boardId, itemId);
  let draft = sheetDraftWrites.get(key);
  if (!draft) {
    draft = {
      boardId,
      itemId,
      generation: 0,
      savedGeneration: 0,
      status: 'safe',
      promise: null,
      latestWorkbook: null,
      updatedAt: 0
    };
    sheetDraftWrites.set(key, draft);
  }
  return draft;
}

function persistSheetDraft(itemId) {
  const item = state.items.get(itemId);
  if (!item?.workbook || !window.WhiteboardStorage?.saveSheetDraft) return Promise.resolve(false);
  const draft = sheetDraftState(itemId);
  item.sheetEditedAt = Math.max(Date.now(), Number(item.sheetEditedAt || 0) + 1);
  draft.latestWorkbook = item.workbook;
  draft.updatedAt = item.sheetEditedAt;
  draft.generation += 1;
  draft.status = 'saving';
  updateSheetSaveState();
  if (draft.promise) return draft.promise;
  draft.promise = (async () => {
    while (draft.savedGeneration < draft.generation) {
      const generation = draft.generation;
      let saved = false;
      try {
        saved = await window.WhiteboardStorage.saveSheetDraft(
          draft.boardId,
          draft.itemId,
          draft.latestWorkbook,
          draft.updatedAt
        );
      } catch (error) {
        console.warn('Could not persist spreadsheet recovery draft', error);
      }
      if (!saved) {
        draft.status = 'blocked';
        updateSheetSaveState();
        return false;
      }
      draft.savedGeneration = generation;
    }
    draft.status = 'safe';
    updateSheetSaveState();
    return true;
  })().finally(() => {
    draft.promise = null;
  });
  return draft.promise;
}

function scheduleSheetSave(itemId) {
  void persistSheetDraft(itemId);
  const existing = sheetSaveTimers.get(itemId);
  if (existing) clearTimeout(existing);
  sheetSaveTimers.set(
    itemId,
    setTimeout(() => {
      sheetSaveTimers.delete(itemId);
      flushSheetSave(itemId);
    }, SHEET_SAVE_DEBOUNCE_MS)
  );
  updateSheetSaveState();
}

function flushAllSheetSaves() {
  for (const itemId of Array.from(sheetSaveTimers.keys())) flushSheetSave(itemId);
}

function hasPendingSheetSave(itemId = null) {
  if (itemId) return sheetSaveTimers.has(itemId);
  return sheetSaveTimers.size > 0;
}

function updateSheetSaveState() {
  if (!sheetStoreRuntime.sheetEditor?.isOpen?.()) return;
  const draft = sheetDraftWrites.get(sheetDraftKey(state.boardId, sheetStoreRuntime.sheetEditorItemId));
  let label = '已保存到画布';
  if (draft?.status === 'blocked') label = '本地保存失败，请勿关闭';
  else if (draft?.status === 'saving') label = '正在本地保存…';
  else if (
    Array.from(sheetCommandCommits.values()).some((command) => command.itemId === sheetStoreRuntime.sheetEditorItemId)
  )
    label = '已本地保存 · 正在同步单元格';
  else if (hasPendingSheetSave(sheetStoreRuntime.sheetEditorItemId)) label = '已本地保存 · 等待同步';
  sheetStoreRuntime.sheetEditor.setSaveLabel(label);
}

function hasUnsafeSheetDrafts() {
  return Array.from(sheetDraftWrites.values()).some((draft) => draft.status === 'saving' || draft.status === 'blocked');
}

function wireSheetPageLifecycle() {
  if (sheetPageHideWired) return;
  sheetPageHideWired = true;
  // A tab switch, reload or crash must not drop a pending edit.
  window.addEventListener('pagehide', flushAllSheetSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllSheetSaves();
  });
  window.addEventListener('beforeunload', (event) => {
    flushAllSheetSaves();
    if (!hasUnsafeSheetDrafts()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function addSheetItem(point) {
  if (!ensureSheetModules()) {
    showToast('工作表组件未加载，请刷新页面重试');
    return false;
  }
  const target = point || getViewportDropPoint(SHEET_ITEM_WIDTH, SHEET_ITEM_HEIGHT, true);
  const workbook = window.SheetCore.createWorkbook();
  const item = {
    id: makeId('sheet'),
    type: 'sheet',
    title: '工作表 1',
    x: Math.round(target.x),
    y: Math.round(target.y),
    w: SHEET_ITEM_WIDTH,
    h: SHEET_ITEM_HEIGHT,
    rotation: 0,
    z: nextZ(),
    contentVersion: 1,
    workbook
  };
  const inserted = upsertItem(item, { select: true });
  if (!inserted) return false;
  restoreNavigationTool();
  showToast('已插入工作表，双击可打开编辑器');
  return true;
}
export {
  SHEET_ITEM_WIDTH,
  SHEET_ITEM_HEIGHT,
  SHEET_SAVE_DEBOUNCE_MS,
  sheetStores,
  sheetPreviews,
  sheetPreviewActiveSheets,
  sheetSaveTimers,
  sheetDraftWrites,
  sheetLockRequests,
  sheetHeldLocks,
  sheetRemoteLocks,
  sheetCommandCommits,
  sheetRecoveredInputs,
  sheetInputDraftTimers,
  sheetInputDraftWrites,
  sheetPageHideWired,
  getSheetRecord,
  bindSheetStore,
  sheetPreviewIndex,
  setSheetPreviewIndex,
  destroySheetRecord,
  destroyAllSheetRecords,
  destroySheetPreview,
  flushSheetSave,
  sheetDraftState,
  persistSheetDraft,
  scheduleSheetSave,
  flushAllSheetSaves,
  hasPendingSheetSave,
  updateSheetSaveState,
  hasUnsafeSheetDrafts,
  wireSheetPageLifecycle,
  addSheetItem
};

export { configureSheetStore };
