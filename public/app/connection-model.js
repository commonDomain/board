import { state } from './state.js';

function isRemoteBoardLocked() {
  return Boolean(
    (state.boardUnlockRevision !== null && state.revision < state.boardUnlockRevision) ||
    (state.boardEditLease && state.boardEditLease.ownerClientId !== state.socketClientId)
  );
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
    state.socket?.close(1002, 'Invalid snapshot manifest');
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
    state.socket?.close(1002, 'Invalid snapshot chunk');
    return;
  }
  try {
    const binary = atob(message.data);
    const chunk = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) chunk[offset] = binary.charCodeAt(offset);
    transfer.chunks[index] = chunk;
  } catch {
    state.socket?.close(1002, 'Invalid snapshot encoding');
  }
}
export { isRemoteBoardLocked, startSnapshotTransfer, appendSnapshotChunk };
