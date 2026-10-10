import { state } from './state.js';
import { MAX_UNDO_BYTES, MAX_UNDO_STEPS } from './constants.js';

function snapshotItems() {
  return JSON.parse(JSON.stringify(Array.from(state.items.values())));
}

function serializeItems(items) {
  return JSON.stringify(items || []);
}

function serializeDocument(snapshot) {
  return JSON.stringify(snapshot || {});
}

function isPatchHistoryEntry(entry) {
  return Boolean(entry && entry.__historyType === 'patch' && Array.isArray(entry.changes));
}

function historyEntryBytes(entry) {
  return JSON.stringify(entry || {}).length * 2;
}

function cloneHistoryValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function trimHistoryStack(kind, deferByteLimit = false) {
  const stack = kind === 'undo' ? state.undoStack : state.redoStack;
  const bytesKey = kind === 'undo' ? 'undoBytes' : 'redoBytes';
  while ((stack.length > MAX_UNDO_STEPS || (!deferByteLimit && state[bytesKey] > MAX_UNDO_BYTES)) && stack.length > 1) {
    const removed = stack.shift();
    state[bytesKey] = Math.max(0, state[bytesKey] - historyEntryBytes(removed));
  }
}

function popHistoryState(kind) {
  const stack = kind === 'undo' ? state.undoStack : state.redoStack;
  const bytesKey = kind === 'undo' ? 'undoBytes' : 'redoBytes';
  const snapshot = stack.pop();
  if (snapshot) {
    state[bytesKey] = Math.max(0, state[bytesKey] - historyEntryBytes(snapshot));
  }
  return snapshot;
}
export {
  snapshotItems,
  serializeItems,
  serializeDocument,
  isPatchHistoryEntry,
  historyEntryBytes,
  cloneHistoryValue,
  trimHistoryStack,
  popHistoryState
};
