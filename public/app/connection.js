

import { restorePendingCut } from './clipboard.js';
import { DOCUMENT_VERSION } from './constants.js';
import { els } from './elements.js';
import { interfaceEffects } from './interface.js';
import { setOrbActive, showToast } from './interface-model.js';

import { sheetCommandCommits } from './sheet-store.js';

import { state } from './state.js';
import { clearSyncRetry, requestResync } from './sync-queue-model.js';

import { isRemoteBoardLocked } from './connection-model.js';

let isGuestMode,
  fitZoom,
  persistPendingOps,
  reapplyPendingOperations,
  updatePresence,
  scheduleCurrentCanvasPreviewRefresh,
  updateSaveText,
  updateSavedLabel,
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
  ({
    isGuestMode,
    fitZoom,
    persistPendingOps,
    reapplyPendingOperations,
    updatePresence,
    scheduleCurrentCanvasPreviewRefresh,
    updateSaveText,
    updateSavedLabel,
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
      } catch {}
    }
    if (state.socket !== socket || state.boardId !== boardId) {
      socket.close();
      return;
    }
    state.connected = true;
    state.joined = false;
    state.reconnectAttempt = 0;
    setConnection('online');
    socket.send(
      JSON.stringify({type: 'join',
boardId,
...(state.cachedSnapshotLoaded && state.syncQueue.length === 0 ? { lastRevision: state.revision } : {}),
protocolVersion: DOCUMENT_VERSION, workspaceProtocolVersion: 1})
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
  const locked = isRemoteBoardLocked();
  if (els.viewport) els.viewport.inert = locked;
  if (els.toolDock) els.toolDock.inert = locked;
  if (els.contextPanel) els.contextPanel.inert = locked;
  if (els.floatingFormatBar) els.floatingFormatBar.inert = locked;
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
    if (locked)
      notice.textContent =
        state.boardUnlockRevision !== null && state.revision < state.boardUnlockRevision
          ? '正在接收最新修改，画布暂时只读'
          : '其他成员正在编辑，画布暂时只读';
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

function suspendBoardEditLeaseOnDisconnect() {
  const wasRemoteLocked = isRemoteBoardLocked();
  state.snapshotTransfer = null;
  clearTimeout(state.boardEditHeartbeatTimer);
  state.boardEditHeartbeatTimer = null;
  state.boardEditIdleUntil = 0;
  state.socketClientId = null;
  if (!wasRemoteLocked) {
    applyBoardEditLease(null);
  } else {
    clearTimeout(state.boardLockTimer);
    state.boardLockTimer = null;
    renderBoardLock();
  }
}

function resolveBoardUnlockRevision() {
  if (state.boardUnlockRevision === null || state.revision < state.boardUnlockRevision) return;
  const unlockLease = state.boardUnlockLease;
  state.boardUnlockRevision = null;
  state.boardUnlockLease = null;
  if (
    state.boardEditLease &&
    state.boardEditLease !== unlockLease &&
    state.boardEditLease.ownerClientId !== 'pending-sync'
  ) {
    renderBoardLock();
    refreshSheetCommandBoardLock();
    return;
  }
  applyBoardEditLease({ locked: false, revision: state.revision });
}

function refreshSheetCommandBoardLock() {
  for (const [opId, pending] of sheetCommandCommits) {
    if (isRemoteBoardLocked()) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    } else if (!pending.timeout) {
      armSheetCommandTimeout(opId, pending);
    }
  }
}

function applyBoardEditLease(message) {
  if (!message && state.boardUnlockRevision !== null && state.revision >= state.boardUnlockRevision) {
    resolveBoardUnlockRevision();
    return;
  }
  clearTimeout(state.boardLockTimer);
  state.boardLockTimer = null;
  const ownerClientId = message?.ownerClientId || message?.clientId;
  const locked = message?.locked !== false && Boolean(ownerClientId);
  const unlockRevision = Number(message?.revision);
  if (!locked && Number.isSafeInteger(unlockRevision) && unlockRevision > state.revision) {
    state.boardUnlockRevision = Math.max(state.boardUnlockRevision || 0, unlockRevision);
  }
  if (!locked && state.boardUnlockRevision !== null && state.revision < state.boardUnlockRevision) {
    if (!state.boardEditLease || state.boardEditLease.ownerClientId === state.socketClientId) {
      state.boardEditLease = { ownerClientId: 'pending-sync', itemId: null };
    }
    if (message?.locked === false) state.boardUnlockLease = state.boardEditLease;
    renderBoardLock();
    refreshSheetCommandBoardLock();
    requestResync();
    return;
  }
  if (!locked) {
    state.boardUnlockRevision = null;
    state.boardUnlockLease = null;
  }
  state.boardEditLease = locked ? { ownerClientId, itemId: message.itemId || null } : null;
  renderBoardLock();
  refreshSheetCommandBoardLock();
  if (state.boardEditLease) {
    const lease = state.boardEditLease;
    const delay = Number.isFinite(Number(message?.expiresAt))
      ? Math.max(200, Number(message.expiresAt) - Date.now() + 700)
      : 4200;
    state.boardLockTimer = setTimeout(() => {
      if (state.boardEditLease !== lease) return;
      if (isRemoteBoardLocked()) {
        requestResync();
        return;
      }
      state.boardEditLease = null;
      renderBoardLock();
      resumeBoardSyncAfterUnlock();
    }, delay);
    if (!isRemoteBoardLocked() && state.waitingForBoardUnlock) resumeBoardSyncAfterUnlock();
  } else {
    resumeBoardSyncAfterUnlock();
  }
}

function scheduleBoardEditHeartbeat() {
  if (state.boardEditHeartbeatTimer) return;
  state.boardEditHeartbeatTimer = setTimeout(() => {
    state.boardEditHeartbeatTimer = null;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined || isRemoteBoardLocked()) return;
    const now = Date.now();
    const pending = (state.syncQueue.length > 0 && !state.syncQueue.blockedReason) || sheetCommandCommits.size > 0;
    if (
      !state.localBoardEditGesture &&
      now >= state.boardEditIdleUntil &&
      (!pending || now - state.boardEditIdleUntil >= 30000)
    ) {
      sendBoardEditActivity(null, false);
      return;
    }
    sendBoardEditActivity(null, true, true);
    scheduleBoardEditHeartbeat();
  }, 900);
}

function sendBoardEditActivity(itemId = null, active = true, renewOnly = false) {
  if (
    isGuestMode() ||
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN ||
    !state.joined ||
    isRemoteBoardLocked()
  )
    return;
  const now = Date.now();
  if (active && !renewOnly) {
    state.boardEditIdleUntil = now + 3500;
    scheduleBoardEditHeartbeat();
  }
  if (!active) {
    clearTimeout(state.boardEditHeartbeatTimer);
    state.boardEditHeartbeatTimer = null;
    state.boardEditIdleUntil = 0;
  }
  if (active && now - state.lastEditActivityAt < 900) return;
  state.lastEditActivityAt = now;
  try {
    state.socket.send(JSON.stringify({ type: 'edit-activity', active, itemId }));
  } catch (error) {
    console.warn('Could not send editing activity', error);
  }
}

function acceptAuthoritativeSnapshot(snapshot, metadata = {}) {
  clearTimeout(state.resyncResponseTimer);
  state.resyncResponseTimer = null;
  clearSyncRetry();
  loadSnapshot(snapshot, { preserveView: state.fitted });
  state.cachedSnapshotLoaded = true;
  if (!state.fitted) {
    state.fitted = true;
    fitZoom();
  }
  state.joined = true;
  state.resyncing = false;
  reapplyPendingOperations();
  applyBoardEditLease(metadata.editLease);
  resolveBoardUnlockRevision();
  if (state.cachedSnapshotRevision !== state.revision) scheduleBoardCache();
  pumpSyncQueue();
  updatePresence(metadata.clients, metadata.maxClients, metadata.clientIds);
  
  updateSavedLabel(snapshot?.savedAt);
  updateSaveText();
  scheduleCurrentCanvasPreviewRefresh();
  scheduleXmindRemoteCheck(1500, true);
  scheduleXmindAutoSync(1800);
}

function acceptUnchangedSnapshot(metadata = {}) {
  clearTimeout(state.resyncResponseTimer);
  state.resyncResponseTimer = null;
  clearSyncRetry();
  state.revision = Math.max(0, Number(metadata.revision) || state.revision);
  state.durableRevision = Math.max(state.durableRevision, state.revision);
  if (!state.fitted) {
    state.fitted = true;
    fitZoom();
  }
  state.joined = true;
  state.resyncing = false;
  applyBoardEditLease(metadata.editLease);
  reapplyPendingOperations();
  resolveBoardUnlockRevision();
  // The server only sends this response after the client joins with a
  // revision-matched cached snapshot. Rewriting the same large snapshot here
  // performs a synchronous clone and an IndexedDB write for no new data.
  pumpSyncQueue();
  updatePresence(metadata.clients, metadata.maxClients, metadata.clientIds);
  
  updateSavedLabel(metadata.savedAt);
  updateSaveText();
  scheduleCurrentCanvasPreviewRefresh();
  scheduleXmindRemoteCheck(1500, true);
  scheduleXmindAutoSync(1800);
}

async function finishSnapshotTransfer(message) {
  const transfer = state.snapshotTransfer;
  if (!transfer || transfer.id !== message.snapshotId || transfer.chunks.some((chunk) => !chunk)) {
    state.snapshotTransfer = null;
    state.socket?.close(1002, 'Incomplete snapshot');
    return;
  }
  const bytes = new Uint8Array(transfer.totalBytes);
  let offset = 0;
  for (const chunk of transfer.chunks) {
    if (offset + chunk.length > bytes.length) {
      state.socket?.close(1002, 'Snapshot size mismatch');
      return;
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== bytes.length) {
    state.socket?.close(1002, 'Snapshot size mismatch');
    return;
  }
  try {
    if (transfer.checksum && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const checksum = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
      if (checksum !== transfer.checksum) throw new Error('Snapshot checksum mismatch');
    }
    const snapshot = JSON.parse(new TextDecoder().decode(bytes));
    if (
      state.snapshotTransfer !== transfer ||
      state.socket !== transfer.socket ||
      state.boardId !== transfer.boardId ||
      state.canvasEpoch !== transfer.canvasEpoch
    )
      return;
    acceptAuthoritativeSnapshot(snapshot, transfer.metadata);
    state.snapshotTransfer = null;
    for (const deferred of transfer.deferredMessages) handleSocketMessage(deferred);
    pumpSyncQueue();
  } catch (error) {
    if (state.snapshotTransfer === transfer) state.snapshotTransfer = null;
    console.warn('Could not assemble snapshot', error);
    state.socket?.close(1002, 'Invalid snapshot');
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
