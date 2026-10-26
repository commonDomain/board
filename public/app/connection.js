

import { restorePendingCut } from './clipboard.js';
import { deferBackgroundWork } from './background-work.js';
import { DOCUMENT_VERSION } from './constants.js';
import { checkAppVersion } from './app-version.js';
import { els } from './elements.js';
import { interfaceEffects } from './interface.js';
import { setOrbActive, showToast } from './interface-model.js';

import { sheetCommandCommits } from './sheet-store.js';

import { state } from './state.js';
import { eventsRuntime } from './runtime/events.js';
import { clearSyncRetry, requestResync } from './sync-queue-model.js';

import { isLocalEditingBlocked, isRemoteBoardLocked } from './connection-model.js';
import { renderItemEditLock, renderSectionEditLock } from './element-lock-ui.js';
import { decodeSnapshotTransfer, isCurrentSnapshotTransfer } from './snapshot-transfer-model.js';
import { configureElementEditLeases, applyBoardEditLease, applyBoardEditLeases, resolveBoardUnlockRevision,
  suspendBoardEditLeaseOnDisconnect, scheduleBoardEditHeartbeat, sendBoardEditActivity, resumeActiveElementEditors } from './element-edit-leases.js';

let isGuestMode,
  fitZoom,
  persistPendingOps,
  reapplyPendingOperations,
  updatePresence,
  scheduleCurrentCanvasPreviewRefresh,
  updateSaveText,
  updateSavedLabel,
  updateUndoButton,
  updateRedoButton,
  armSheetCommandTimeout,
  clearSheetLocks,
  loadSnapshot,
  scheduleBoardCache,
  handleSocketMessage,
  pumpSyncQueue,
  recoverFromDeletedCanvas,
  scheduleXmindAutoSync,
  scheduleXmindRemoteCheck;

function configureConnection(callbacks) {
  eventsRuntime.renderDraftSafety = renderBoardLock;
  configureElementEditLeases({ renderLocks: renderBoardLock, resumeSync: resumeBoardSyncAfterUnlock, refreshSheetLocks: refreshSheetCommandBoardLock });
  ({
    isGuestMode,
    fitZoom,
    persistPendingOps,
    reapplyPendingOperations,
    updatePresence,
    scheduleCurrentCanvasPreviewRefresh,
    updateSaveText,
    updateSavedLabel,
    updateUndoButton,
    updateRedoButton,
    armSheetCommandTimeout,
    clearSheetLocks,
    loadSnapshot,
    scheduleBoardCache,
    handleSocketMessage,
    pumpSyncQueue,
    recoverFromDeletedCanvas,
    scheduleXmindAutoSync,
    scheduleXmindRemoteCheck
  } = callbacks);
}

function connect(joinReady = null) {
  if (state.draftRestoreFailed || state.draftDiscardPending) return;
  clearTimeout(state.reconnectTimer);
  if (!state.boardId) {
    setConnection('idle');
    return;
  }
  if (isGuestMode()) {
    state.socket = null;
    state.connected = false;
    state.joined = true;
    setConnection('local');
    updatePresence(1, 1, []);
    return;
  }
  if (navigator.onLine === false) {
    state.socket = null;
    state.connected = false;
    state.joined = false;
    setConnection('offline');
    return;
  }
  if (state.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.socket.readyState)) return;
  const boardId = state.boardId;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  state.socket = socket;
  setConnection('connecting');

  socket.addEventListener('open', async () => {
    if (joinReady) {
      try {
        await joinReady;
      } catch {
        socket.close(4000, 'Local draft recovery pending');
        return;
      }
    }
    if (state.socket !== socket || state.boardId !== boardId) {
      socket.close();
      return;
    }
    state.connected = true;
    state.joined = false;
    state.reconnectAttempt = 0;
    setConnection('online');
    void checkAppVersion();
    socket.send(
      JSON.stringify({type: 'join',
boardId,
...(state.cachedSnapshotLoaded && state.syncQueue.length === 0 ? { lastRevision: state.revision } : {}),
protocolVersion: DOCUMENT_VERSION, workspaceProtocolVersion: 4})
    );
  });

  socket.addEventListener('message', (event) => {
    if (state.socket !== socket || state.boardId !== boardId) return;
    try {
      handleSocketMessage(JSON.parse(event.data));
    } catch (error) {
      console.warn('Ignored malformed socket message', error);
    }
  });

  socket.addEventListener('close', (event) => {
    if (state.socket !== socket || state.boardId !== boardId) return;
    if (state.pendingCut) {
      restorePendingCut();
      showToast('连接已中断，剪切的元素已自动还原');
    }
    state.socket = null;
    suspendBoardEditLeaseOnDisconnect();
    clearSheetLocks('offline');
    if (event.code === 1008 && event.reason === 'Canvas deleted') {
      void recoverFromDeletedCanvas();
      return;
    }
    state.connected = false;
    state.joined = false;
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
    // Cell commands that were queued for the socket wait for the reconnect.
    if (navigator.onLine === false) return;
    const delay = Math.min(15000, 1200 * 2 ** state.reconnectAttempt) + Math.random() * 600;
    state.reconnectAttempt += 1;
    state.reconnectTimer = setTimeout(connect, delay);
  });

  socket.addEventListener('error', () => {
    if (state.socket !== socket || state.boardId !== boardId) return;
    setConnection('offline');
  });
}

function setConnection(status) {
  window.dispatchEvent(new CustomEvent('muse:connection-state',{detail:{online:status==='online'}}));
  els.connectionDot.classList.toggle('online', status === 'online');
  els.connectionDot.classList.toggle('offline', status === 'offline');
  els.connectionDot.classList.toggle('local', status === 'local');
  els.connectionText.textContent =
    status === 'online'
      ? '已连接'
      : status === 'local'
        ? '仅本地'
        : status === 'offline'
          ? '重连中'
          : status === 'idle'
            ? '尚无画布'
            : '连接中';
  const isWaiting = status !== 'online' && status !== 'local' && status !== 'idle';
  els.connectionDot.parentElement?.classList.toggle('has-thinking-orb', isWaiting);
  setOrbActive(interfaceEffects.connectionOrb, isWaiting, status === 'offline' ? 'breathing' : 'connecting');
}

function renderBoardLock() {
  const localBlocked = state.draftStorageFailed || state.draftRestoreFailed || state.draftRestoring;
  const locked = isRemoteBoardLocked() || isLocalEditingBlocked();
  updateUndoButton();
  updateRedoButton();
  if (els.viewport) els.viewport.inert = locked;
  if (els.toolDock) {
    // Account tools are independent of the canvas editing lease.
    els.toolDock.inert = false;
    for (const child of els.toolDock.children) {
      if (child.classList.contains('toolbar-insert')) {
        child.inert = false;
        for (const tool of child.children) tool.inert = locked && !tool.hasAttribute('data-board-independent');
      } else child.inert = locked;
    }
  }
  if (els.contextPanel) els.contextPanel.inert = locked;
  if (els.floatingFormatBar) els.floatingFormatBar.inert = locked;
  if (els.layerMenu) els.layerMenu.inert = locked;
  if (!deferBackgroundWork('locks', renderBoardLock)) {
    for (const node of document.querySelectorAll('.board-item[data-item-id]')) renderItemEditLock(node);
    for (const frame of document.querySelectorAll('.section-frame[data-section-id]')) renderSectionEditLock(frame);
  }
  for (const id of ['navigatorTree']) {
    const surface = document.getElementById(id);
    if (surface) surface.inert = locked;
  }
  if (locked) {
    const focused = document.activeElement;
    if (focused && (els.viewport.contains(focused) || focused.closest?.('#navigatorTree')))
      focused.blur();
  }
  const notice = document.getElementById('boardLockNotice');
  if (notice) {
    notice.hidden = !locked;
    if (state.draftDiscardPending) notice.textContent = '正在丢弃当前画布草稿，载入云端版本…';
    else if (localBlocked) notice.textContent = state.draftRestoring ? '正在恢复本地草稿…' :
      state.draftRestoreFailed ? '本地草稿暂时无法读取，正在自动重试；请保留此页面' :
        '本地草稿保存失败，已暂停编辑，正在自动重试';
      else if (state.accessReadOnly) notice.textContent = '编辑权限已失效，已暂停编辑并保留草稿';
      else if (state.compatibilityReadOnly) notice.textContent = '数据版本不兼容，已暂停编辑并保留草稿，请更新页面';
      else if (state.conflictRecoveryPending) notice.textContent = '正在原位恢复本地草稿…';
      else if (state.syncQueue?.requiresResolution) notice.textContent = '有未解决的同步冲突，已暂停编辑；草稿保留，请通过“同步问题”核对处理';
      else if (locked)
      notice.textContent =
        state.boardUnlockRevisions.has('*')
          ? '正在接收最新修改，画布暂时只读'
          : '其他成员正在调整画布结构，请稍后';
  }
  updateSaveText();
}

function resumeBoardSyncAfterUnlock() {
  if (state.waitingForBoardUnlock) {
    state.waitingForBoardUnlock = false;
    clearSyncRetry();
  }
  pumpSyncQueue();
}

function refreshSheetCommandBoardLock() {
  for (const [opId, pending] of sheetCommandCommits) {
    if (isRemoteBoardLocked(pending.itemId)) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    } else if (!pending.timeout) armSheetCommandTimeout(opId, pending);
  }
}

function acceptAuthoritativeSnapshot(snapshot, metadata = {}) {
  // Journal the debounced editor input before the snapshot replaces its DOM.
  if (eventsRuntime.captureDraftInputs) eventsRuntime.captureDraftInputs();
  else eventsRuntime.editableInputHandler?.flush?.();
  clearTimeout(state.resyncResponseTimer);
  state.resyncResponseTimer = null;
  // A resync can finish before the retry delay; retain that backoff until ACK.
  const leases = metadata.editLeases || (metadata.editLease ? [metadata.editLease] : []);
  const preserveEditingIds = new Set(leases.filter(lease => (lease.ownerClientId || lease.clientId) === state.socketClientId).map(lease => lease.itemId));
  loadSnapshot(snapshot, { preserveView: state.fitted, preserveEditingIds });
  state.cachedSnapshotLoaded = true;
  if (!state.fitted) {
    state.fitted = true;
    fitZoom();
  }
  state.joined = true;
  state.resyncing = false;
  reapplyPendingOperations();
  if (state.editingId) state.editSnapshot = structuredClone([...state.items.values()]);
  if (state.mindmapEditing) state.mindmapEditing.beforeItems = structuredClone([...state.items.values()]);
  applyBoardEditLeases(metadata.editLeases || (metadata.editLease ? [metadata.editLease] : []));
  resumeActiveElementEditors();
  resolveBoardUnlockRevision();
  if (state.cachedSnapshotRevision !== state.revision) scheduleBoardCache();
  pumpSyncQueue();
  updatePresence(metadata.clients, metadata.maxClients, metadata.clientIds, metadata.users || null, metadata.connectionIds);
  
  updateSavedLabel(snapshot?.savedAt);
  updateSaveText();
  scheduleCurrentCanvasPreviewRefresh();
  scheduleXmindRemoteCheck(1500, true);
  scheduleXmindAutoSync(1800);
}

function acceptUnchangedSnapshot(metadata = {}) {
  clearTimeout(state.resyncResponseTimer);
  state.resyncResponseTimer = null;
  state.revision = Math.max(0, Number(metadata.revision) || state.revision);
  state.durableRevision = Math.max(state.durableRevision, state.revision);
  if (!state.fitted) {
    state.fitted = true;
    fitZoom();
  }
  state.joined = true;
  state.resyncing = false;
  applyBoardEditLeases(metadata.editLeases || (metadata.editLease ? [metadata.editLease] : []));
  resumeActiveElementEditors();
  reapplyPendingOperations();
  resolveBoardUnlockRevision();
  // The server only sends this response after the client joins with a
  // revision-matched cached snapshot. Rewriting the same large snapshot here
  // performs a synchronous clone and an IndexedDB write for no new data.
  pumpSyncQueue();
  updatePresence(metadata.clients, metadata.maxClients, metadata.clientIds, metadata.users || null, metadata.connectionIds);
  
  updateSavedLabel(metadata.savedAt);
  updateSaveText();
  scheduleCurrentCanvasPreviewRefresh();
  scheduleXmindRemoteCheck(1500, true);
  scheduleXmindAutoSync(1800);
}

async function finishSnapshotTransfer(message) {
  const transfer = state.snapshotTransfer;
  if (!transfer || !isCurrentSnapshotTransfer(transfer, state)) return;
  try {
    if (transfer.id !== message.snapshotId) throw new Error('Snapshot identity mismatch');
    const snapshot = await decodeSnapshotTransfer(transfer);
    if (!isCurrentSnapshotTransfer(transfer, state)) return;
    acceptAuthoritativeSnapshot(snapshot, transfer.metadata);
    state.snapshotTransfer = null;
    for (const deferred of transfer.deferredMessages) handleSocketMessage(deferred);
    pumpSyncQueue();
  } catch (error) {
    if (!isCurrentSnapshotTransfer(transfer, state)) return;
    state.snapshotTransfer = null;
    console.warn('Could not assemble snapshot', error);
    transfer.socket.close(4002, 'Invalid snapshot');
  }
}
export {
  connect,
  setConnection,
  renderBoardLock,
  resumeBoardSyncAfterUnlock,
  suspendBoardEditLeaseOnDisconnect,
  resolveBoardUnlockRevision,
  refreshSheetCommandBoardLock,
  applyBoardEditLease,
  scheduleBoardEditHeartbeat,
  sendBoardEditActivity,
  acceptAuthoritativeSnapshot,
  acceptUnchangedSnapshot,
  finishSnapshotTransfer
};

export { configureConnection };
