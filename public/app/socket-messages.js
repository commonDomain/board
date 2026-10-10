import { reloadCatalogAfterAccountChange } from './account-lifecycle.js';
import { schedulePersistPendingOps } from './canvas-session.js';
import {
  acceptAuthoritativeSnapshot,
  acceptUnchangedSnapshot,
  applyBoardEditLease,
  finishSnapshotTransfer
} from './connection.js';
import { appendSnapshotChunk, startSnapshotTransfer } from './connection-model.js';
import { SNAPSHOT_DEFERRED_TYPES } from './constants.js';
import { cancelActiveGesture } from './gestures.js';
import { showToast } from './interface-model.js';

import { updatePresence, updateRemoteCursor } from './presence.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';
import {
  markDirty,
  scheduleCurrentCanvasPreviewRefresh,
  updateSaveText,
  updateSavedLabel,
  uploadCurrentCanvasPreview
} from './save-status.js';
import { sheetCommandCommits, sheetLockRequests, sheetRemoteLocks } from './sheet-store.js';
import { state } from './state.js';
import { handleCommittedOperation, pumpSyncQueue, recoverFromDeletedCanvas, scheduleSyncRetry } from './sync-queue.js';
import { requestResync } from './sync-queue-model.js';
import { setTool } from './toolbar.js';

function handleSocketMessage(message) {
  if (['planning-changed', 'planning-access-changed', 'sharing-changed', 'access-revoked', 'canvas-deleted'].includes(message.type)) window.MusePlanning?.refresh(message).catch(()=>{});
  if (message.type === 'planning-changed') return;
  if (state.snapshotTransfer && SNAPSHOT_DEFERRED_TYPES.has(message.type)) {
    if (state.snapshotTransfer.deferredMessages.length >= 1000) {
      state.socket?.close(1009, 'Snapshot event backlog');
      return;
    }
    state.snapshotTransfer.deferredMessages.push(message);
    return;
  }
  if (message.type === 'hello') {
    if (typeof message.clientId === 'string' && message.clientId) {
      state.clientId = message.clientId;
    }
    if (typeof message.socketClientId === 'string') state.socketClientId = message.socketClientId;
    void window.MuseAccount?.refreshSharing?.().catch((error) => {
      console.warn('Could not refresh sharing members', error);
    });
    return;
  }
  if (message.type === 'board-lock') {
    if (message.boardId && message.boardId !== state.boardId) return;
    applyBoardEditLease(message);
    return;
  }
  if (message.type === 'sheet-lock-result') {
    const pending = sheetLockRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      sheetLockRequests.delete(message.requestId);
      pending.resolve(message);
    }
    return;
  }
  if (message.type === 'sheet-lock-changed') {
    const lockKey = `${message.itemId}:${message.sheetId}:${message.row}:${message.column}`;
    if (message.locked) sheetRemoteLocks.set(lockKey, message);
    else sheetRemoteLocks.delete(lockKey);
    sheetStoreRuntime.sheetEditor?.setRemoteCellLocks?.(sheetRemoteLocks);
    return;
  }
  if (message.type === 'canvas-deleted') {
    void recoverFromDeletedCanvas();
    return;
  }
  if (message.type === 'access-revoked') {
    showToast('该画布已设为私密或共享关系已取消');
    void window.MuseAccount?.refreshSharing?.().catch((error) => {
      console.warn('Could not refresh sharing members', error);
    });
    void reloadCatalogAfterAccountChange({ selectFirst: true });
    return;
  }
  if (message.type === 'sharing-changed') {
    void window.MuseAccount?.refreshSharing?.().catch((error) => {
      console.warn('Could not refresh sharing members', error);
    });
    return;
  }
  if (message.type === 'snapshot') {
    acceptAuthoritativeSnapshot(message.state, message);
    return;
  }
  if (message.type === 'snapshot-unchanged') {
    acceptUnchangedSnapshot(message);
    return;
  }
  if (message.type === 'snapshot-start') {
    startSnapshotTransfer(message);
    return;
  }
  if (message.type === 'snapshot-chunk') {
    appendSnapshotChunk(message);
    return;
  }
  if (message.type === 'snapshot-end') {
    void finishSnapshotTransfer(message);
    return;
  }
  if (message.type === 'committed') {
    handleCommittedOperation(message);
    return;
  }
  if (message.type === 'saved') {
    if (!state.saveInFlight) return;
    if (message.requestId && message.requestId !== state.saveRequestId) return;
    clearTimeout(state.saveResponseTimer);
    state.saveResponseTimer = null;
    state.saveRequestId = null;
    const savedRevision = Number(message.revision);
    if (Number.isSafeInteger(savedRevision) && savedRevision >= 0) {
      state.durableRevision = Math.max(state.durableRevision, savedRevision);
    }
    state.saveInFlight = false;
    if (
      !state.syncQueue.length &&
      !state.saveQueued &&
      state.durableRevision >= state.revision &&
      state.saveChangeSerial === state.localChangeSerial
    ) {
      markDirty(false);
    }
    if (!state.dirty) {
      updateSavedLabel(message.savedAt);
    } else {
      updateSaveText();
    }
    pumpSyncQueue();
    if (state.previewAfterSave) {
      state.previewAfterSave = false;
      void uploadCurrentCanvasPreview();
    } else if (!state.dirty) {
      scheduleCurrentCanvasPreviewRefresh();
    }
    return;
  }
  if (message.type === 'presence') {
    updatePresence(message.clients, message.maxClients, message.clientIds, message.users);
    return;
  }
  if (message.type === 'cursor') {
    updateRemoteCursor(message);
    return;
  }
  if (message.type === 'error') {
    if (message.requestId && message.requestId === state.saveRequestId) {
      clearTimeout(state.saveResponseTimer);
      state.saveResponseTimer = null;
      state.saveRequestId = null;
      state.saveInFlight = false;
      const retryable = [
        'RATE_LIMITED',
        'INTERNAL_ERROR',
        'MEMORY_PRESSURE',
        'STORAGE_LIMIT',
        'NOT_JOINED',
        'SERVER_SHUTTING_DOWN'
      ].includes(message.code);
      state.saveQueued = retryable;
      if (retryable) {
        scheduleSyncRetry(message.code === 'STORAGE_LIMIT' ? 60000 : 1200);
        if (message.code === 'NOT_JOINED' || message.code === 'SERVER_SHUTTING_DOWN') state.socket?.close();
      }
      updateSaveText();
      showToast(message.message || '保存暂时失败，修改已保留');
      return;
    }
    if (message.requestId) return;
    const sheetCommit = typeof message.opId === 'string' ? sheetCommandCommits.get(message.opId) : null;
    if (sheetCommit) {
      if (message.code === 'BOARD_BUSY') {
        clearTimeout(sheetCommit.timeout);
        sheetCommit.timeout = null;
      } else {
        clearTimeout(sheetCommit.timeout);
        sheetCommandCommits.delete(message.opId);
        sheetCommit.resolve({ ok: false, reason: message.code, message: message.message });
        if (message.code === 'SHEET_CELL_CONFLICT') requestResync();
      }
    }
    if (['CONTENT_CONFLICT', 'CONNECTOR_CONFLICT', 'CONNECTOR_VERSION'].includes(message.code)) {
      window.ConnectorUI?.preserveConflict(message);
    }
    if (message.code === 'CONNECTOR_VERSION') {
      cancelActiveGesture();
      state.compatibilityReadOnly = true;
      setTool('pan');
      showToast('连接数据版本不兼容，已进入只读模式。原数据与未提交草稿均保留，请更新后重新打开。');
    }
    if (message.code === 'AUTH_EXPIRED') {
      window.MuseAccount?.expireSession?.();
      return;
    }
    if (typeof message.opId === 'string') {
      if (message.opId === state.syncQueue.inflightOpId) {
        clearTimeout(state.operationAckTimer);
        state.operationAckTimer = null;
      }
      if (message.code === 'REVISION_CONFLICT') {
        if (state.syncQueue.retry(message.opId)) {
          schedulePersistPendingOps();
          requestResync();
        }
      } else if (
        [
          'RATE_LIMITED',
          'INBOUND_QUEUE_LIMIT',
          'BOARD_BUSY',
          'INTERNAL_ERROR',
          'SERVER_SHUTTING_DOWN',
          'NOT_JOINED',
          'MEMORY_PRESSURE',
          'STORAGE_LIMIT'
        ].includes(message.code)
      ) {
        if (state.syncQueue.retry(message.opId)) {
          schedulePersistPendingOps();
          if (message.code === 'BOARD_BUSY') state.waitingForBoardUnlock = true;
          scheduleSyncRetry(
            message.code === 'STORAGE_LIMIT'
              ? 60000
              : message.code === 'MEMORY_PRESSURE'
                ? 5000
                : message.code === 'BOARD_BUSY'
                  ? 3600
                  : 0
          );
          if (message.code === 'NOT_JOINED' || message.code === 'SERVER_SHUTTING_DOWN') {
            state.socket?.close();
          } else if (!['RATE_LIMITED', 'BOARD_BUSY', 'MEMORY_PRESSURE', 'STORAGE_LIMIT'].includes(message.code)) {
            requestResync();
          }
        }
      } else if (state.syncQueue.block(message.opId, message.message || message.code)) {
        schedulePersistPendingOps();
        requestResync();
      }
    }
    if (!['BOARD_BUSY', 'INVALID_NOTE_PLACEMENT', 'INVALID_NOTE_ORDER'].includes(message.code))
      showToast(message.message || '协同服务暂时不可用');
  }
}

export { handleSocketMessage };
