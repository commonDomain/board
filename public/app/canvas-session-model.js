import { state } from './state.js';

function flushPendingOpsStorage() {
  if (state.draftRestoreFailed || state.draftRestoring || state.draftDiscardPending) return;
  clearTimeout(state.pendingOpsTimer);
  try {
    const messages = serializePendingOperations();
    const fallbackSaved = window.WhiteboardStorage?.flushOutboxFallback(state.boardId, messages) === true;
    if (fallbackSaved) {
      state.draftStorageSafeSerial = state.draftStorageSerial || 0;
      state.draftStoragePending = false;
    }
    void Promise.resolve(window.WhiteboardStorage?.saveOutbox(state.boardId, messages)).catch(error => {
      console.warn('Could not persist pending operations on page hide', error);
    });
  } catch (error) {
    console.warn('Could not persist pending operations on page hide', error);
  }
}

function serializePendingOperations() {
  return state.syncQueue.serialize().entries.map((entry) => ({
    type: 'op',
    opId: entry.opId,
    attempted: entry.attempted,
    baseRevision: entry.baseRevision,
    op: entry.op,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.errorImage ? { errorImage: entry.errorImage } : {})
  }));
}
export { serializePendingOperations, flushPendingOpsStorage };
