import { historyEntryBytes, isPatchHistoryEntry } from './history-controller-model.js';

import { isRemoteBoardLocked } from './connection-model.js';

import { els } from './elements.js';
import { showToast } from './interface-model.js';

import { sheetCommandCommits } from './sheet-store.js';

import { state } from './state.js';

import {
  rememberCommittedOperation,
  operationFieldTargets,
  historyFieldConflicts,
  requestResync,
  clearSyncRetry
} from './sync-queue-model.js';

let scheduleHistoryCompaction, snapshotDocument, updateRedoButton, updateUndoButton, isGuestMode, resetCanvasRuntime, restoreLocalBoardStateAndConnect, schedulePersistPendingOps, fetchCanvasCatalog, renderCanvasCatalog, updateCurrentCanvasLabel, resolveBoardUnlockRevision, sendBoardEditActivity, setConnection, reapplyPendingOperations, applyRemoteOperation, updateSaveText, scheduleBoardCache, scheduleXmindAutoSync;

function configureSyncQueue(callbacks) {
  ({scheduleHistoryCompaction,
snapshotDocument,
updateRedoButton,
updateUndoButton,
isGuestMode,
resetCanvasRuntime,
restoreLocalBoardStateAndConnect,
schedulePersistPendingOps,
fetchCanvasCatalog,
renderCanvasCatalog,
updateCurrentCanvasLabel,
resolveBoardUnlockRevision,
sendBoardEditActivity,
setConnection,
reapplyPendingOperations,
applyRemoteOperation,
updateSaveText,
scheduleBoardCache,
scheduleXmindAutoSync} = callbacks);
}

async function recoverFromDeletedCanvas() {
  if (state.switchingCanvas) return;
  state.switchingCanvas = true;
  document.documentElement.classList.add('canvas-switching');
  els.canvasSwitcherButton.classList.add('is-beam-active');
  const socket = state.socket;
  state.socket = null;
  socket?.close(1000, 'Canvas deleted');
  try {
    await fetchCanvasCatalog();
    state.boardId = state.canvases[0]?.id || null;
    resetCanvasRuntime();
    renderCanvasCatalog();
    updateCurrentCanvasLabel();
    if (state.boardId) {
      setConnection('connecting');
      await restoreLocalBoardStateAndConnect();
      showToast('当前画布已被删除，已进入第一块画布');
    } else {
      setConnection('idle');
      showToast('当前画布已被删除，请创建新画布');
    }
  } catch (error) {
    console.warn('Could not recover after canvas deletion', error);
    showToast('当前画布已被删除，请刷新页面');
  } finally {
    state.switchingCanvas = false;
    document.documentElement.classList.remove('canvas-switching');
    els.canvasSwitcherButton.classList.remove('is-beam-active');
  }
}

function handleCommittedOperation(message) {
  if (message.opId === state.syncQueue.inflightOpId) {
    clearTimeout(state.operationAckTimer);
    state.operationAckTimer = null;
  }
  const revision = Number(message.revision) || 0;
  if (revision && revision > state.revision + 1) {
    if (message.opId === state.syncQueue.inflightOpId) {
      state.syncQueue.retry(message.opId);
      schedulePersistPendingOps();
    }
    requestResync();
    return;
  }
  state.revision = Math.max(state.revision, revision);
  let acknowledged = false;
  if (typeof message.opId === 'string') {
    acknowledged = state.syncQueue.ack(message.opId);
  }
  if (acknowledged) {

    rememberCommittedOperation(message.opId);
    clearSyncRetry();
    if (message.duplicate) {
      requestResync();
    } else {
      applyRemoteOperation(message.op, { rebaseGesture: false, acknowledged: true });
      reapplyPendingOperations();
    }
    schedulePersistPendingOps();
  } else if (state.recentCommittedOpIds.has(message.opId)) {
    // Duplicate ACKs must not roll a newer optimistic operation backwards.
  } else {
    if (message.from && message.from !== state.clientId) pruneHistoryForRemoteOperation(message.op);
    applyRemoteOperation(message.op);
  }
  if (!state.resyncing) resolveBoardUnlockRevision();
  scheduleBoardCache();
  updateSaveText();
  pumpSyncQueue();
  scheduleXmindAutoSync();
  const sheetCommit = sheetCommandCommits.get(message.opId);
  if (sheetCommit) {
    clearTimeout(sheetCommit.timeout);
    sheetCommandCommits.delete(message.opId);
    sheetCommit.resolve({ ok: true, revision });
  }
}

function pruneHistoryForRemoteOperation(op) {
  if ([...state.undoStack, ...state.redoStack].some((entry) => !isPatchHistoryEntry(entry))) {
    const current = snapshotDocument();
    state.undoStack = window.WhiteboardHistory.convert(state.undoStack, current, 'undo');
    state.redoStack = window.WhiteboardHistory.convert(state.redoStack, current, 'redo');
  }
  const targets = operationFieldTargets(op);
  const prune = (stack) =>
    stack.flatMap((entry) => {
      if (!isPatchHistoryEntry(entry)) return [];
      const changes = entry.changes.flatMap((change) => {
        const fields = change.fields.filter((field) => !historyFieldConflicts(change, field, targets));
        if (!fields.length) return [];
        const before = {};
        const after = {};
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(change.before, field)) before[field] = change.before[field];
          if (Object.prototype.hasOwnProperty.call(change.after, field)) after[field] = change.after[field];
        }
        return [{ ...change, fields, before, after }];
      });
      return changes.length ? [{ ...entry, changes }] : [];
    });
  state.undoStack = prune(state.undoStack);
  state.redoStack = prune(state.redoStack);
  state.undoBytes = state.undoStack.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
  state.redoBytes = state.redoStack.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
  updateUndoButton();
  updateRedoButton();
}

function scheduleSyncRetry(minimumDelay = 0) {
  clearTimeout(state.syncRetryTimer);
  const delay = Math.max(minimumDelay, Math.min(5000, 300 * 2 ** state.syncRetryAttempt)) + Math.random() * 180;
  state.syncRetryAttempt = Math.min(6, state.syncRetryAttempt + 1);
  state.syncRetryTimer = setTimeout(() => {
    state.syncRetryTimer = null;
    pumpSyncQueue();
  }, delay);
}

function enqueueOperation(operation, opId) {
  if (state.compatibilityReadOnly) return null;
  scheduleHistoryCompaction();

  if (operation && window.ConnectorUI) operation = window.ConnectorUI.prepareOperation(operation);
  if (!operation || (operation.kind === 'batch' && !operation.ops?.length)) return null;
  if (isGuestMode()) {
    scheduleBoardCache();
    updateSaveText();
    return opId || crypto.randomUUID();
  }
  const queuedId = state.syncQueue.enqueue(operation, opId);
  sendBoardEditActivity(operation.item?.id || operation.itemId || null);
  scheduleAutoSave();
  schedulePersistPendingOps();
  updateSaveText();
  pumpSyncQueue();
  return queuedId;
}

function scheduleAutoSave() {
  if (isGuestMode() || state.compatibilityReadOnly || !state.boardId) return;
  clearTimeout(state.autoSaveTimer);
  const boardId = state.boardId;
  const canvasEpoch = state.canvasEpoch;
  state.autoSaveTimer = setTimeout(() => {
    state.autoSaveTimer = null;
    if (state.boardId !== boardId || state.canvasEpoch !== canvasEpoch || !state.dirty) return;
    state.saveQueued = true;
    pumpSyncQueue();
    updateSaveText();
  }, 2200);
}

function pumpSyncQueue() {
  if (state.compatibilityReadOnly) return;
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN ||
    !state.joined ||
    state.resyncing ||
    state.snapshotTransfer ||
    state.syncRetryTimer ||
    isRemoteBoardLocked()
  ) {
    return;
  }

  const envelope = state.syncQueue.nextEnvelope(state.revision);
  if (envelope) {
    state.waitingForBoardUnlock = false;
    try {
      envelope.connectorCapabilities = 1;
      state.socket.send(JSON.stringify(envelope));
      const socket = state.socket;
      clearTimeout(state.operationAckTimer);
      state.operationAckTimer = setTimeout(() => {
        if (state.socket === socket && state.syncQueue.inflightOpId === envelope.opId) {
          socket.close(4000, 'Operation acknowledgement timeout');
        }
      }, 15000);
      schedulePersistPendingOps();
    } catch (error) {
      clearTimeout(state.operationAckTimer);
      state.operationAckTimer = null;
      state.syncQueue.retry(envelope.opId);
      console.warn('Could not send queued operation', error);
    }
    updateSaveText();
    return;
  }

  if (!state.syncQueue.length && state.saveQueued && !state.saveInFlight) {
    state.saveInFlight = true;
    state.saveQueued = false;
    const requestId = crypto.randomUUID();
    state.saveRequestId = requestId;
    state.saveChangeSerial = state.localChangeSerial;
    try {
      state.socket.send(JSON.stringify({ type: 'save', revision: state.revision, requestId }));
      state.saveResponseTimer = setTimeout(() => {
        if (state.saveRequestId !== requestId) return;
        state.saveRequestId = null;
        state.saveResponseTimer = null;
        state.saveInFlight = false;
        state.saveQueued = true;
        scheduleSyncRetry(1500);
        updateSaveText();
      }, 15000);
    } catch (error) {
      state.saveRequestId = null;
      state.saveInFlight = false;
      state.saveQueued = true;
      scheduleSyncRetry(1200);
      console.warn('Could not send save request', error);
    }
    updateSaveText();
  }
}
export {
  recoverFromDeletedCanvas,
  handleCommittedOperation,
  pruneHistoryForRemoteOperation,
  scheduleSyncRetry,
  enqueueOperation,
  scheduleAutoSave,
  pumpSyncQueue
};

export { configureSyncQueue };
