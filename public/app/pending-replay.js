import { schedulePersistPendingOps } from './canvas-session.js';
import { applyRemoteOperation } from './remote-operations.js';
import { updateSaveText } from './save-status.js';
import { state } from './state.js';
import { canReplayPendingOperation } from './pending-replay-model.js';
function reapplyPendingOperations() {
  for (const entry of state.syncQueue.serialize().entries) {
    if (entry.error) break;
    if (!canReplayPendingOperation(entry.op)) {
      state.syncQueue.block(entry.opId, '目标图层已锁定。请解锁后重试，或导出草稿。');
      schedulePersistPendingOps(); break;
    }
    replayPendingOperation(entry.op);
  }
  if (!state.syncQueue.blockedReason) document.getElementById('syncIssueDialog')?.close();
  updateSaveText();
}
function replayPendingOperation(operation) {
  if (operation?.kind === 'batch' && Array.isArray(operation.ops)) { operation.ops.forEach(replayPendingOperation); return; }
  applyRemoteOperation(operation, { rebaseGesture: false });
}
export { reapplyPendingOperations, replayPendingOperation };
