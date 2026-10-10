import { snapshotDocument } from './history-controller.js';

import { flushPendingOpsStorage, serializePendingOperations } from './canvas-session-model.js';

import { restorePendingCut } from './clipboard.js';

import { showToast } from './interface-model.js';
import { eventsRuntime } from './runtime/events.js';

import { flushAllSheetSaves, sheetInputDraftTimers } from './sheet-store.js';
import { state } from './state.js';
import { clearSyncRetry, requestResync } from './sync-queue-model.js';

let refreshAmapCapabilities,
  commitMindMapEditForPageHide,
  commitMindMapNoteForPageHide,
  persistCurrentCanvasForSwitch,
  persistPendingOps,
  resetCanvasRuntime,
  restoreLocalBoardStateAndConnect,
  schedulePersistPendingOps,
  loadCanvasCatalog,
  renderCanvasCatalog,
  connect,
  setConnection,
  suspendBoardEditLeaseOnDisconnect,
  clearSheetLocks,
  pumpSyncQueue;

function configureAccountLifecycle(callbacks) {
  ({
    refreshAmapCapabilities,
    commitMindMapEditForPageHide,
    commitMindMapNoteForPageHide,
    persistCurrentCanvasForSwitch,
    persistPendingOps,
    resetCanvasRuntime,
    restoreLocalBoardStateAndConnect,
    schedulePersistPendingOps,
    loadCanvasCatalog,
    renderCanvasCatalog,
    connect,
    setConnection,
    suspendBoardEditLeaseOnDisconnect,
    clearSheetLocks,
    pumpSyncQueue
  } = callbacks);
}

function isGuestMode() {
  return window.MuseAccount?.isGuest?.() === true;
}

function wireNetworkLifecycle() {
  window.addEventListener('online', () => {
    if (isGuestMode() || state.connected) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectAttempt = Math.min(state.reconnectAttempt, 2);
    connect();
  });
  window.addEventListener('offline', () => {
    if (state.pendingCut) {
      restorePendingCut();
      showToast('网络已断开，剪切的元素已自动还原');
    }
    if (isGuestMode() || !state.boardId) return;
    clearTimeout(state.reconnectTimer);
    state.connected = false;
    state.joined = false;
    clearSheetLocks('offline');
    clearSyncRetry();
    if (state.syncQueue.inflightOpId) {
      clearTimeout(state.operationAckTimer);
      state.operationAckTimer = null;
      state.syncQueue.retry(state.syncQueue.inflightOpId);
    }
    if (state.saveInFlight) {
      clearTimeout(state.saveResponseTimer);
      state.saveResponseTimer = null;
      state.saveRequestId = null;
      state.saveInFlight = false;
      state.saveQueued = true;
    }
    setConnection('offline');
    persistPendingOps();
    const socket = state.socket;
    state.socket = null;
    suspendBoardEditLeaseOnDisconnect();
    socket?.close(1000, 'Network offline');
  });
}

function wireAccountLifecycle() {
  wireSyncDraftDialog();
  window.addEventListener('muse:account-changing', suspendAccountCanvas);
  window.addEventListener('muse:auth-expired', () => {
    suspendAccountCanvas();
    void refreshAmapCapabilities();
  });
  window.addEventListener('muse:logout', () => {
    suspendAccountCanvas();
    void refreshAmapCapabilities();
  });
  window.addEventListener('muse:sharing-changed', () => {
    if (!isGuestMode()) void reloadCatalogAfterAccountChange();
  });
  window.addEventListener('muse:login', () => {
    void refreshAmapCapabilities();
    if (state.initialized) void reloadCatalogAfterAccountChange({ selectFirst: true });
  });
}

function wireSyncDraftDialog() {
  const dialog = document.getElementById('syncIssueDialog');
  document.getElementById('syncIssueButton')?.addEventListener('click', () => {
    document.getElementById('syncIssueDescription').textContent =
      state.syncQueue.blockedReason || `共有 ${state.syncQueue.length} 项修改等待同步。`;
    dialog.showModal();
  });
  document.getElementById('retrySyncDraftButton')?.addEventListener('click', () => {
    state.syncQueue.resume();
    clearSyncRetry();
    schedulePersistPendingOps();
    requestResync();
    pumpSyncQueue();
    dialog.close();
  });
  document.getElementById('exportSyncDraftButton')?.addEventListener('click', () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, boardId: state.boardId, document: snapshotDocument(), pending: serializePendingOperations() },
          null,
          2
        )
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `museboard-draft-${state.boardId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

async function prepareAccountExit() {
  await window.MuseNotebook?.prepareAccountExit?.();
  if (!state.boardId || isGuestMode()) return true;
  const persisted = await persistCurrentCanvasForSwitch();
  if (!persisted) throw new Error('仍有修改未能安全保存在本机，请保持页面开启并重试退出。');
  return true;
}

function journalAccountExit() {
  if (!state.boardId || isGuestMode()) return;
  eventsRuntime.editableInputHandler?.flush?.();
  commitMindMapEditForPageHide();
  commitMindMapNoteForPageHide();
  flushPendingOpsStorage();
}

window.MuseBoardLifecycle = Object.freeze({ prepareAccountExit, journalAccountExit });

function suspendAccountCanvas() {
  if (state.pendingCut) restorePendingCut();
  flushAllSheetSaves();
  for (const timer of sheetInputDraftTimers.values()) clearTimeout(timer);
  sheetInputDraftTimers.clear();
  clearSheetLocks('account-changed');
  clearTimeout(state.reconnectTimer);
  const socket = state.socket;
  state.socket = null;
  socket?.close(1000, 'Authentication required');
  state.connected = false;
  state.joined = false;
  state.canvases = [];
  state.canvasCatalogLoadedAt = 0;
  state.boardId = '';
  resetCanvasRuntime();
  document.getElementById('syncIssueDialog')?.close();
  renderCanvasCatalog();
  setConnection('offline');
}

async function reloadCatalogAfterAccountChange(options = {}) {
  if (state.pendingCut) restorePendingCut();
  const generation = window.WhiteboardStorage?.getGeneration?.();
  const requestId = (state.catalogReloadId = (state.catalogReloadId || 0) + 1);
  const isCurrent = () =>
    requestId === state.catalogReloadId && generation === window.WhiteboardStorage?.getGeneration?.();
  const previousBoardId = state.boardId;
  try {
    await loadCanvasCatalog({ selectFirst: options.selectFirst || false, isCurrent });
    if (!isCurrent()) return;
    if (state.boardId === previousBoardId) return;
    const socket = state.socket;
    state.socket = null;
    socket?.close(1000, 'Account canvas catalog changed');
    resetCanvasRuntime();
    if (isCurrent() && state.boardId) await restoreLocalBoardStateAndConnect();
    else if (isCurrent()) setConnection('idle');
  } catch (error) {
    if (isCurrent()) showToast(error.message || '加载画布失败，请重试');
  }
}

export {
  isGuestMode,
  journalAccountExit,
  prepareAccountExit,
  reloadCatalogAfterAccountChange,
  suspendAccountCanvas,
  wireAccountLifecycle,
  wireNetworkLifecycle,
  wireSyncDraftDialog
};

export { configureAccountLifecycle };
