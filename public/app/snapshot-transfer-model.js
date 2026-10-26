function isCurrentSnapshotTransfer(transfer, state) {
  return Boolean(transfer && state.snapshotTransfer === transfer && state.socket === transfer.socket &&
    state.boardId === transfer.boardId && state.canvasEpoch === transfer.canvasEpoch);
}

async function decodeSnapshotTransfer(transfer) {
  if (transfer.chunks.length !== transfer.totalChunks) throw new Error('Incomplete snapshot');
  let size = 0;
  // Array#some skips sparse holes. Inspect every slot before allocating or
  // reading .length, so a missing chunk becomes a handled protocol failure.
  for (const chunk of transfer.chunks) {
    if (!(chunk instanceof Uint8Array) || !chunk.length) throw new Error('Incomplete snapshot');
    size += chunk.length;
    if (size > transfer.totalBytes) throw new Error('Snapshot size mismatch');
  }
  if (size !== transfer.totalBytes) throw new Error('Snapshot size mismatch');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of transfer.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (transfer.checksum && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const checksum = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (checksum !== transfer.checksum) throw new Error('Snapshot checksum mismatch');
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export { isCurrentSnapshotTransfer, decodeSnapshotTransfer };
