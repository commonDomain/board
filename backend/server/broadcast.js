import crypto from 'node:crypto';
import { currentBoardEditLeases } from './board-lock.js';
import { SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_THRESHOLD_BYTES } from './config.js';
import { sendWs } from './websocket-transport.js';
import { boardPresence, markClientSynced } from './board-broadcast.js';

function snapshotMessage(board) {
  return {
    type: 'snapshot',
    boardId: board.id,
    state: board.state,
    ...boardPresence(board),
    editLeases: serializedEditLeases(board)
  };
}

function unchangedSnapshotMessage(board) {
  return {
    type: 'snapshot-unchanged',
    boardId: board.id,
    revision: board.state.revision,
    savedAt: board.state.savedAt,
    ...boardPresence(board),
    editLeases: serializedEditLeases(board)
  };
}

function sendBoardSnapshot(client, board) {
  const sent = sendSnapshotPayload(client, board);
  if (sent) markClientSynced(client, board);
  return sent;
}

function sendUnchangedSnapshot(client, board) {
  const sent = sendWs(client, unchangedSnapshotMessage(board));
  if (sent) markClientSynced(client, board);
  return sent;
}

function sendSnapshotPayload(client, board) {
  const serialized = Buffer.from(JSON.stringify(board.state), 'utf8');
  if (serialized.length < SNAPSHOT_CHUNK_THRESHOLD_BYTES) {
    return sendWs(client, snapshotMessage(board));
  }
  const snapshotId = `${board.id}:${board.state.revision}:${crypto.randomBytes(6).toString('hex')}`;
  const totalChunks = Math.ceil(serialized.length / SNAPSHOT_CHUNK_BYTES);
  if (
    !sendWs(client, {
      type: 'snapshot-start',
      snapshotId,
      boardId: board.id,
      revision: board.state.revision,
      totalChunks,
      totalBytes: serialized.length,
      checksum: crypto.createHash('sha256').update(serialized).digest('hex'),
      ...boardPresence(board),
      editLeases: serializedEditLeases(board),
      encoding: 'base64-json'
    })
  )
    return false;
  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = serialized.subarray(
      index * SNAPSHOT_CHUNK_BYTES,
      Math.min(serialized.length, (index + 1) * SNAPSHOT_CHUNK_BYTES)
    );
    if (
      !sendWs(client, {
        type: 'snapshot-chunk',
        snapshotId,
        index,
        data: chunk.toString('base64')
      })
    )
      return false;
  }
  return sendWs(client, { type: 'snapshot-end', snapshotId });
}
function serializedEditLeases(board) {
  return [...currentBoardEditLeases(board).values()].map(({ clientId, itemId, expiresAt }) => ({ clientId, itemId, expiresAt }));
}
export { snapshotMessage, unchangedSnapshotMessage, sendBoardSnapshot, sendUnchangedSnapshot };
