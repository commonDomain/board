import { state } from './state.js';

function flushPendingOpsStorage() {
  clearTimeout(state.pendingOpsTimer);
  try {
    const messages = serializePendingOperations();
    window.WhiteboardStorage?.flushOutboxFallback(state.boardId, messages);
    void window.WhiteboardStorage?.saveOutbox(state.boardId, messages);
  } catch (error) {
    console.warn('Could not persist pending operations on page hide', error);
  }
}

function serializePendingOperations() {
  return state.syncQueue.serialize().entries.map((entry) => ({
    type: 'op',
    opId: entry.opId,
    baseRevision: entry.baseRevision,
    op: entry.op,
    ...(entry.error ? { error: entry.error } : {})
  }));
}
export { serializePendingOperations, flushPendingOpsStorage };
