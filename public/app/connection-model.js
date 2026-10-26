import { state } from './state.js';
import { editOperationTargets } from './edit-lock-targets-model.js';

function isLocalEditingBlocked({ allowConflictRecovery = false } = {}) {
  return Boolean(state.draftStorageFailed || state.draftRestoreFailed || state.draftRestoring || state.draftDiscardPending || state.conflictRecoveryPending ||
    state.compatibilityReadOnly || state.accessReadOnly || (!allowConflictRecovery && state.syncQueue?.requiresResolution));
}

function isRemoteBoardLocked(itemId = '*') {
  return ['*', itemId].some(id => {
    const lease = state.boardEditLeases.get(id);
    return state.boardUnlockRevisions.has(id) || Boolean(lease && lease.ownerClientId !== state.socketClientId);
  });
}

function hasElementEditLease(itemId) {
  if (window.MuseAccount?.isGuest?.()) return true;
  const lease = state.boardEditLeases.get(itemId);
  return Boolean(state.connected && state.joined && lease?.ownerClientId === state.socketClientId && lease.expiresAt > Date.now());
}

function isOperationRemotelyLocked(operation) {
  const targets = editOperationTargets(operation, state);
  if (targets.has('*')) return [...state.boardEditLeases.values()].some(lease => lease.ownerClientId !== state.socketClientId) || state.boardUnlockRevisions.size > 0;
  return [...targets].some(id => isRemoteBoardLocked(id));
}

function startSnapshotTransfer(message) {
  const totalChunks = Number(message.totalChunks);
  const totalBytes = Number(message.totalBytes);
  if (
    !message.snapshotId ||
    !Number.isSafeInteger(totalChunks) ||
    totalChunks < 1 ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 1
  ) {
    state.socket?.close(4002, 'Invalid snapshot manifest');
    return;
  }
  state.snapshotTransfer = {
    id: message.snapshotId,
    socket: state.socket,
    boardId: state.boardId,
    canvasEpoch: state.canvasEpoch,
    totalChunks,
    totalBytes,
    checksum: message.checksum,
    chunks: new Array(totalChunks),
    metadata: message,
    deferredMessages: []
  };
}

function appendSnapshotChunk(message) {
  const transfer = state.snapshotTransfer;
  const index = Number(message.index);
  if (
    !transfer ||
    transfer.id !== message.snapshotId ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= transfer.totalChunks ||
    typeof message.data !== 'string'
  ) {
    state.socket?.close(4002, 'Invalid snapshot chunk');
    return;
  }
  try {
    if (transfer.chunks[index]) throw new Error('Duplicate snapshot chunk');
    const remaining = transfer.totalBytes - (transfer.receivedBytes || 0);
    if (message.data.length > Math.ceil(remaining / 3) * 4) throw new Error('Snapshot exceeds announced size');
    const binary = atob(message.data);
    if (!binary.length || binary.length > remaining) throw new Error('Snapshot exceeds announced size');
    const chunk = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) chunk[offset] = binary.charCodeAt(offset);
    transfer.chunks[index] = chunk;
    transfer.receivedBytes = (transfer.receivedBytes || 0) + chunk.length;
  } catch {
    state.socket?.close(4002, 'Invalid snapshot encoding');
  }
}
export { isLocalEditingBlocked, isRemoteBoardLocked, hasElementEditLease, isOperationRemotelyLocked, startSnapshotTransfer, appendSnapshotChunk };
