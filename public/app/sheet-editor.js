import { pushUndoSnapshot } from './history-controller.js';

import { isRemoteBoardLocked } from './connection-model.js';
import { els } from './elements.js';
import { refreshIcons, showToast } from './interface-model.js';
import { canMutateItem, explainUnwritableLayer } from './layers-model.js';

import { pointerMoveRuntime } from './runtime/pointer-move.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';
import { markDirty } from './save-status.js';

import { ensureSheetModules, sheetDraftKey } from './sheet-store-model.js';
import {
  flushSheetSave,
  getSheetRecord,
  persistSheetDraft,
  scheduleSheetSave,
  setSheetPreviewIndex,
  sheetCommandCommits,
  sheetDraftState,
  sheetDraftWrites,
  sheetHeldLocks,
  sheetInputDraftTimers,
  sheetInputDraftWrites,
  sheetLockRequests,
  sheetPreviewIndex,
  sheetPreviews,
  sheetRecoveredInputs,
  sheetRemoteLocks,
  sheetStores,
  updateSheetSaveState,
  wireSheetPageLifecycle
} from './sheet-store.js';
import { state } from './state.js';

let isGuestMode,
  closePopovers,
  refreshSheetPreviews,
  enqueueOperation,
  restoreNavigationTool;

function configureSheetEditor(callbacks) {
  ({
    isGuestMode,
    closePopovers,
    refreshSheetPreviews,
    enqueueOperation,
    restoreNavigationTool
  } = callbacks);
}

function sendSheetLockRequest(type, payload) {
  if (isGuestMode())
    return Promise.resolve({
      granted: true,
      local: true,
      lockId: `local:${payload.itemId}:${payload.sheetId}:${payload.row}:${payload.column}`
    });
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return Promise.resolve({ granted: false, reason: 'offline' });
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      sheetLockRequests.delete(requestId);
      resolve({ granted: false, reason: 'timeout' });
    }, 5000);
    sheetLockRequests.set(requestId, { resolve, timeout });
    try {
      state.socket.send(JSON.stringify({ type, requestId, ...payload }));
    } catch {
      clearTimeout(timeout);
      sheetLockRequests.delete(requestId);
      resolve({ granted: false, reason: 'offline' });
    }
  });
}

async function acquireSheetCellLock(itemId, sheetId, row, column) {
  if (!itemId || !sheetId) return { granted: false, reason: 'missing-target' };
  const result = await sendSheetLockRequest('sheet-lock-request', { itemId, sheetId, row, column });
  if (!result.granted || result.local) return result;
  const lock = { itemId, sheetId, row, column, lockId: result.lockId, expiresAt: result.expiresAt, timer: null };
  const renew = async () => {
    if (!sheetHeldLocks.has(lock.lockId)) return;
    const renewed = await sendSheetLockRequest('sheet-lock-renew', lock);
    if (!renewed.granted) {
      sheetHeldLocks.delete(lock.lockId);
      sheetStoreRuntime.sheetEditor?.loseCellLock?.(lock, renewed.reason || 'lock-expired');
      return;
    }
    lock.expiresAt = renewed.expiresAt;
    lock.timer = setTimeout(renew, 7000);
  };
  sheetHeldLocks.set(lock.lockId, lock);
  lock.timer = setTimeout(renew, 7000);
  return { granted: true, ...lock };
}

function releaseSheetCellLock(lock) {
  if (!lock?.lockId || lock.local) return;
  const held = sheetHeldLocks.get(lock.lockId);
  if (held?.timer) clearTimeout(held.timer);
  sheetHeldLocks.delete(lock.lockId);
  void sendSheetLockRequest('sheet-lock-release', lock);
}

function armSheetCommandTimeout(opId, pending) {
  clearTimeout(pending.timeout);
  pending.timeout = setTimeout(() => {
    if (sheetCommandCommits.get(opId) !== pending) return;
    sheetCommandCommits.delete(opId);
    pending.resolve({ ok: false, reason: 'timeout' });
  }, 12000);
}

async function submitSheetCellCommand(itemId, change) {
  const item = state.items.get(itemId);
  const record = sheetStores.get(itemId) || getSheetRecord(item);
  if (!item || !record) return { ok: false, reason: 'missing-sheet' };
  const draftWrite = persistSheetDraft(itemId);
  const opId = crypto.randomUUID();
  const committed = new Promise((resolve) => {
    const pending = { resolve, timeout: null, itemId };
    sheetCommandCommits.set(opId, pending);
    if (!isRemoteBoardLocked()) armSheetCommandTimeout(opId, pending);
  });
  const editedAt = Number(state.items.get(itemId)?.sheetEditedAt) || Date.now();
  const command = {
    type: 'set-cell',
    protocolVersion: window.SheetProtocol.VERSION,
    sheetId: change.sheetId,
    expectedStructureVersion: Math.max(
      0,
      Number(record.store.workbook.sheets.find((sheet) => sheet.sheetId === change.sheetId)?.structureVersion) || 0
    ),
    row: change.row,
    column: change.column,
    expectedCellVersion: change.expectedCellVersion,
    localVersion: change.expectedCellVersion + 1,
    cell: change.cell,
    editedAt,
    ...(change.lock?.lockId ? { lockId: change.lock.lockId } : {})
  };
  enqueueOperation({ kind: 'sheet-command', itemId, command }, opId);
  await draftWrite;
  const result = await committed;
  if (result.ok) void cleanupConfirmedSheetDraft(itemId);
  return result;
}

async function cleanupConfirmedSheetDraft(itemId) {
  const item = state.items.get(itemId);
  const key = sheetDraftKey(state.boardId, itemId);
  const draft = sheetDraftWrites.get(key);
  if (!item || !draft || draft.status !== 'safe' || draft.savedGeneration < draft.generation) return false;
  if (Number(item.sheetEditedAt) < Number(draft.updatedAt)) return false;
  const deleted = await window.WhiteboardStorage?.deleteSheetDraft?.(state.boardId, itemId);
  if (deleted) sheetDraftWrites.delete(key);
  return Boolean(deleted);
}

function clearSheetLocks(reason = 'offline') {
  for (const request of sheetLockRequests.values()) {
    clearTimeout(request.timeout);
    request.resolve({ granted: false, reason });
  }
  sheetLockRequests.clear();
  for (const lock of sheetHeldLocks.values()) if (lock.timer) clearTimeout(lock.timer);
  sheetHeldLocks.clear();
  sheetRemoteLocks.clear();
  for (const command of sheetCommandCommits.values()) {
    clearTimeout(command.timeout);
    command.resolve({ ok: false, reason });
  }
  sheetCommandCommits.clear();
  sheetStoreRuntime.sheetEditor?.loseCellLock?.(null, reason);
}

function ensureSheetEditor() {
  if (sheetStoreRuntime.sheetEditor || !ensureSheetModules()) return sheetStoreRuntime.sheetEditor;
  wireSheetPageLifecycle();
  sheetStoreRuntime.sheetEditor = window.SheetEditor.createEditor({
    saveLabel: () => '已保存到画布',
    onDirty: (change) => {
      if (!sheetStoreRuntime.sheetEditorItemId) return null;
      if (change?.kind === 'set-cell' && !isGuestMode())
        return submitSheetCellCommand(sheetStoreRuntime.sheetEditorItemId, change);
      scheduleSheetSave(sheetStoreRuntime.sheetEditorItemId);
      return null;
    },
    onRename: (nextTitle) => renameSheetItem(sheetStoreRuntime.sheetEditorItemId, nextTitle),
    onInputDraft: (pendingInput) => {
      if (!sheetStoreRuntime.sheetEditorItemId || !window.WhiteboardStorage?.saveSheetPendingInput) return;
      const itemId = sheetStoreRuntime.sheetEditorItemId;
      const storageGeneration = window.WhiteboardStorage?.getGeneration?.();
      const previous = sheetInputDraftTimers.get(itemId);
      if (previous) clearTimeout(previous);
      const write = async () => {
        sheetInputDraftTimers.delete(itemId);
        if (storageGeneration !== window.WhiteboardStorage?.getGeneration?.()) return;
        const item = state.items.get(itemId);
        if (!item?.workbook) return;
        const updatedAt = Math.max(Date.now(), Number(item.sheetEditedAt || 0) + 1);
        const promise = window.WhiteboardStorage.saveSheetPendingInput(
          state.boardId,
          itemId,
          item.workbook,
          pendingInput,
          updatedAt
        );
        sheetInputDraftWrites.set(itemId, promise);
        const saved = await promise;
        if (sheetInputDraftWrites.get(itemId) === promise) sheetInputDraftWrites.delete(itemId);
        if (!saved) {
          const draft = sheetDraftState(itemId);
          draft.status = 'blocked';
          updateSheetSaveState();
        }
      };
      if (pendingInput) sheetInputDraftTimers.set(itemId, setTimeout(write, 180));
      else void write();
    },
    acquireCellLock: ({ sheetId, row, column }) =>
      acquireSheetCellLock(sheetStoreRuntime.sheetEditorItemId, sheetId, row, column),
    releaseCellLock: (lock) => releaseSheetCellLock(lock),
    onCommit: () => {
      if (sheetStoreRuntime.sheetEditorItemId) flushSheetSave(sheetStoreRuntime.sheetEditorItemId);
    },
    // Confirmations are the panel's own cards. The adaptive dialog lives at
    // z-index 1000, far below the full-screen editor surface, so routing a
    // spreadsheet prompt through it would hand the user an unclickable dialog.
    onClose: () => {
      const closedItemId = sheetStoreRuntime.sheetEditorItemId;
      const closedItem = closedItemId ? state.items.get(closedItemId) : null;
      const closedRecord = closedItemId ? sheetStores.get(closedItemId) : null;
      if (closedItem && closedRecord) {
        setSheetPreviewIndex(closedItem, closedRecord, closedRecord.store.activeSheetIndex());
      }
      sheetStoreRuntime.sheetEditorItemId = null;
      const app = document.querySelector('.app');
      if (app) {
        app.inert = false;
        app.removeAttribute('aria-hidden');
      }
      document.body.classList.remove('sheet-editor-open');
      // Re-paint the canvas preview now that editing has stopped.
      refreshSheetPreviews();
      restoreNavigationTool();
      updateSheetSaveState();
    },
    onOpen: () => {
      const app = document.querySelector('.app');
      if (app?.contains(document.activeElement)) document.activeElement.blur();
      if (app) {
        app.inert = true;
        app.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.add('sheet-editor-open');
    },
    lucide: () => refreshIcons(sheetStoreRuntime.sheetEditor.root)
  });
  document.body.appendChild(sheetStoreRuntime.sheetEditor.root);
  return sheetStoreRuntime.sheetEditor;
}

function renameSheetItem(itemId, nextTitle) {
  const item = itemId ? state.items.get(itemId) : null;
  if (!item || item.type !== 'sheet' || !canMutateItem(item)) return false;
  const next = String(nextTitle || '')
    .trim()
    .slice(0, 100);
  const previous = item.title || '工作表';
  if (!next || next === previous) return false;
  pushUndoSnapshot();
  item.title = next;
  state.items.set(item.id, item);
  enqueueOperation({ kind: 'upsert', item });
  markDirty(true);
  const preview = sheetPreviews.get(item.id);
  if (els.sectionHoverLabel?.dataset.hoverKey === `sheet:${item.id}`) {
    els.sectionHoverLabel.textContent = next;
    pointerMoveRuntime.sectionHoverLabelSize = null;
  }
  if (preview?.canvas) preview.canvas.setAttribute('aria-label', `${next} 预览`);
  return true;
}

async function restoreSheetDraft(itemOrId) {
  const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
  if (!itemId || !window.WhiteboardStorage?.loadSheetDraft) return false;
  try {
    await sheetInputDraftWrites.get(itemId);
    const draft = await window.WhiteboardStorage.loadSheetDraft(state.boardId, itemId);
    if (draft?.pendingInput) sheetRecoveredInputs.set(itemId, draft.pendingInput);
    const liveItem = state.items.get(itemId);
    if (!liveItem || liveItem.type !== 'sheet') return false;
    if (!draft?.workbook || Number(draft.updatedAt) <= Number(liveItem.sheetEditedAt || 0))
      return Boolean(draft?.pendingInput);
    // Recovery drafts contain workbook content only. Merge that content into
    // the current item instead of reinstating a stale object captured by an old
    // preview button; otherwise x/y and frame membership could jump backwards.
    liveItem.workbook = draft.workbook;
    liveItem.sheetEditedAt = draft.updatedAt;
    state.items.set(itemId, liveItem);
    getSheetRecord(liveItem);
    scheduleSheetSave(itemId);
    showToast('已恢复上次未完成同步的工作表内容');
    return true;
  } catch (error) {
    console.warn('Could not restore spreadsheet recovery draft', error);
    return false;
  }
}

async function openSheetEditor(itemOrId) {
  const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
  let item = itemId ? state.items.get(itemId) : null;
  if (!canMutateItem(item)) {
    showToast(explainUnwritableLayer(item?.layerId));
    return false;
  }
  const request = ++sheetStoreRuntime.sheetEditorOpenRequest;
  await restoreSheetDraft(itemId);
  item = state.items.get(itemId);
  if (request !== sheetStoreRuntime.sheetEditorOpenRequest || !item || item.type !== 'sheet') return false;
  const record = getSheetRecord(item);
  const editor = ensureSheetEditor();
  if (!record || !editor) {
    showToast('工作表组件未加载，请刷新页面重试');
    return false;
  }
  sheetStoreRuntime.sheetEditorItemId = itemId;
  const sheetIndex = sheetPreviewIndex(item, record);
  record.store.setActiveSheet(sheetIndex);
  editor.setStore(record.store, sheetIndex);
  editor.setTitle(item.title || record.store.workbook.title || '工作表');
  editor.open();
  const recoveredInput = sheetRecoveredInputs.get(item.id);
  if (recoveredInput && editor.restoreInputDraft?.(recoveredInput)) sheetRecoveredInputs.delete(item.id);
  updateSheetSaveState();
  closePopovers();
  return true;
}

function closeSheetEditor() {
  if (!sheetStoreRuntime.sheetEditor?.isOpen?.()) return;
  sheetStoreRuntime.sheetEditor.close();
}

export {
  acquireSheetCellLock,
  armSheetCommandTimeout,
  cleanupConfirmedSheetDraft,
  clearSheetLocks,
  closeSheetEditor,
  ensureSheetEditor,
  openSheetEditor,
  releaseSheetCellLock,
  renameSheetItem,
  restoreSheetDraft,
  sendSheetLockRequest,
  submitSheetCellCommand
};

export { configureSheetEditor };
