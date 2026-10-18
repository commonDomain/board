import { snapshotDocument } from './history-controller.js';

import { flushPendingOpsStorage, serializePendingOperations } from './canvas-session-model.js';

import { restorePendingCut } from './clipboard.js';

import { showToast } from './interface-model.js';
import { eventsRuntime } from './runtime/events.js';

import { flushAllSheetSaves, sheetInputDraftTimers } from './sheet-store.js';
import { state } from './state.js';
import { clearSyncRetry, requestResync } from './sync-queue-model.js';
import { blockedSyncImages, recoverSyncImage } from './sync-image-recovery.js';
import { describeSyncIssue } from './sync-dialog-model.js';

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
  let lastWake = 0;
  const recoverAfterWake = () => {
    if (isGuestMode() || !state.initialized || !state.boardId || document.hidden || Date.now() - lastWake < 1000) return;
    lastWake = Date.now();
    if (state.draftRestoreFailed) { void restoreLocalBoardStateAndConnect(); return; }
    if (state.draftRestoring) return;
    void persistPendingOps();
    if (state.connected && state.joined) requestResync();
    else { clearTimeout(state.reconnectTimer); connect(); }
  };
  window.addEventListener('focus', recoverAfterWake);
  window.addEventListener('pageshow', recoverAfterWake);
  document.addEventListener('visibilitychange', recoverAfterWake);
  window.addEventListener('online', () => {
    if (isGuestMode()) return;
    recoverAfterWake();
    if (state.connected) { pumpSyncQueue(); return; }
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
  const recovery = document.getElementById('syncImageRecovery');
  const selection = document.getElementById('syncFailedImage');
  const fileInput = document.getElementById('syncRecoveryImageFile');
  const recoveryButton = document.getElementById('recoverSyncImageButton');
  const retryButton = document.getElementById('retrySyncDraftButton');
  const recoveryStatus = document.getElementById('syncImageRecoveryStatus');
  let busy = false;
  let imageKey = '';
  let lastAction = '';
  const render = () => {
    if (!dialog.open) return;
    const images = blockedSyncImages();
    const view = describeSyncIssue(state, images.length);
    if (!busy && lastAction !== view.action) recoveryStatus.textContent = '';
    lastAction = view.action;
    document.getElementById('syncIssueTitle').textContent = view.title;
    document.getElementById('syncIssueDescription').textContent = view.description;
    document.getElementById('syncDraftSafety').textContent = view.safety;
    const reason = state.syncQueue.blockedReason || '';
    document.getElementById('syncIssueDetails').hidden = !reason || !['image', 'conflict', 'retry'].includes(view.action);
    document.getElementById('syncIssueTechnical').textContent = reason;
    const key = JSON.stringify(images);
    if (key !== imageKey) {
      const previous = selection.value;
      selection.replaceChildren(...images.map((image, index) => new Option(
        /^image[_-]/.test(image.label) ? `图片 ${index + 1}` : image.label, image.src)));
      if (images.some(image => image.src === previous)) selection.value = previous;
      imageKey = key;
    }
    recovery.hidden = view.action !== 'image' || images.length < 2;
    recoveryButton.hidden = view.action !== 'image';
    retryButton.hidden = ['image', 'none'].includes(view.action);
    retryButton.textContent = busy ? '正在处理…' : view.label;
    recoveryButton.textContent = busy ? '正在恢复…' : '重新选择图片';
    recoveryButton.disabled = selection.disabled = busy;
    retryButton.disabled = busy || view.action === 'wait';
  };
  eventsRuntime.renderSyncIssue = render;
  document.getElementById('syncIssueButton')?.addEventListener('click', () => {
    recoveryStatus.textContent = '';
    document.getElementById('syncIssueDetails').open = false;
    if (!dialog.open) dialog.showModal();
    render();
  });
  retryButton?.addEventListener('click', async () => {
    if (busy) return;
    const action = describeSyncIssue(state, blockedSyncImages().length).action;
    if (action === 'done') { dialog.close(); return; }
    if (action === 'conflict') { dialog.close(); window.ConnectorUI?.showConflictDrafts(); return; }
    if (['wait', 'none', 'image'].includes(action)) return;
    const boardId = state.boardId, epoch = state.canvasEpoch;
    const current = () => state.boardId === boardId && state.canvasEpoch === epoch;
    busy = true; recoveryStatus.textContent = ''; render();
    try {
      if (action === 'restore') await restoreLocalBoardStateAndConnect();
      else {
        if (action === 'persist' && !await persistPendingOps()) {
          if (current()) recoveryStatus.textContent = '仍无法保存，请先下载备份。系统会继续自动重试。';
          return;
        }
        if (!current()) return;
        if (action === 'retry') state.syncQueue.resume();
        clearSyncRetry(); schedulePersistPendingOps();
        if (!state.connected) { clearTimeout(state.reconnectTimer); connect(); }
        else { requestResync(); pumpSyncQueue(); }
      }
      if (current()) recoveryStatus.textContent = state.draftRestoreFailed ? '仍无法读取草稿，系统会继续自动重试。' :
        state.syncQueue.blockedReason ? '问题尚未解决，请查看详细原因。' : '';
    } catch {
      if (current()) recoveryStatus.textContent = '暂时未能完成，请稍后重试。';
    } finally { busy = false; if (current()) render(); }
  });
  recoveryButton.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file || busy) return;
    const boardId = state.boardId, epoch = state.canvasEpoch;
    const current = () => state.boardId === boardId && state.canvasEpoch === epoch;
    busy = true; render();
    recoveryStatus.textContent = '正在上传图片，请稍候…';
    try {
      if (!await recoverSyncImage(file, selection.value) || !current()) return;
      clearSyncRetry(); schedulePersistPendingOps(); requestResync(); pumpSyncQueue();
      recoveryStatus.textContent = '图片已恢复，正在继续同步。';
    } catch (error) {
      if (current()) recoveryStatus.textContent = `未能恢复图片。${error.message || '请稍后重试。'}`;
    } finally { busy = false; if (current()) render(); }
  });
  document.getElementById('exportSyncDraftButton')?.addEventListener('click', () => {
    eventsRuntime.captureDraftInputs?.();
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
