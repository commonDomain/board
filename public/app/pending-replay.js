import { schedulePersistPendingOps } from './canvas-session.js';
import { applyRemoteOperation } from './remote-operations.js';
import { updateSaveText } from './save-status.js';
import { state } from './state.js';
import { canReplayPendingOperation } from './pending-replay-model.js';
import { sendBoardEditActivity } from './connection.js';
const REPLAY_LOCK_REASON = '目标图层已锁定。请解锁后重试，或导出草稿。';
function reapplyPendingOperations() {
  const entries = state.syncQueue.serialize().entries;
  for (const entry of entries) {
    if (entry.error === REPLAY_LOCK_REASON &&
        entry === entries[0] && canReplayPendingOperation(entry.op)) {
      state.syncQueue.resume();
      delete entry.error;
      schedulePersistPendingOps();
    }
    // Submission errors pause the outbox, not the local draft. A fresh server
    // snapshot must still show edits queued after the rejected operation.
    if (!canReplayPendingOperation(entry.op)) {
      if (!state.syncQueue.blockedReason) {
        state.syncQueue.block(entry.opId, REPLAY_LOCK_REASON);
        sendBoardEditActivity(null, false);
        schedulePersistPendingOps();
      }
      continue;
    }
    replayPendingOperation(entry.op);
  }
  updateSaveText();
}
function replayPendingOperation(operation) {
  if (operation?.kind === 'batch' && Array.isArray(operation.ops)) { operation.ops.forEach(replayPendingOperation); return; }
  applyRemoteOperation(operation, { rebaseGesture: false });
}
export { reapplyPendingOperations, replayPendingOperation };
