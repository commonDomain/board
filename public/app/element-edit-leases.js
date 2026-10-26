import { state } from './state.js';
import { eventsRuntime } from './runtime/events.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';
import { editOperationTargets } from './edit-lock-targets-model.js';
import { hasElementEditLease, isLocalEditingBlocked, isRemoteBoardLocked } from './connection-model.js';
import { requestResync } from './sync-queue-model.js';

const requests = new Map();
const acquisitions = new Map();
const releaseTimers = new Map();
const RELEASE_GRACE_MS = 120;
let releaseTimer = null;
let renderLocks = () => {}, resumeSync = () => {}, refreshSheetLocks = () => {};

function configureElementEditLeases(callbacks) {
  ({ renderLocks, resumeSync, refreshSheetLocks } = callbacks);
}

function refresh() {
  renderLocks();
  refreshSheetLocks();
  const itemId = sheetStoreRuntime.sheetEditorItemId;
  if (itemId) sheetStoreRuntime.sheetEditor?.setEditingBlocked?.(isLocalEditingBlocked() || isRemoteBoardLocked(itemId) || !hasElementEditLease(itemId));
}

function armExpiryCheck() {
  clearTimeout(state.boardLockTimer);
  // The fallback resync recovers a lost remote unlock. This connection renews
  // its own leases and the server announces their expiry, so a delayed local
  // renewal (for example a busy main thread) must not reload the whole canvas.
  const remote = [...state.boardEditLeases.values()].filter(lease => lease.ownerClientId !== state.socketClientId);
  if (!remote.length) { state.boardLockTimer = null; return; }
  const expiresAt = Math.min(...remote.map(lease => lease.expiresAt));
  state.boardLockTimer = setTimeout(() => { state.boardLockTimer = null; requestResync(); }, Math.max(200, expiresAt - Date.now() + 700));
}

function applyBoardEditLease(message, deferRefresh = false) {
  const itemId = message?.itemId || '*';
  const ownerClientId = message?.ownerClientId || message?.clientId;
  const previous = state.boardEditLeases.get(itemId);
  const wasWaiting = state.boardUnlockRevisions.has(itemId);
  let changed = false;
  if (message?.locked !== false && ownerClientId) {
    changed = !previous || previous.ownerClientId !== ownerClientId || wasWaiting;
    if (changed && ownerClientId !== state.socketClientId &&
        (itemId === '*' || itemId === state.editingId || itemId === state.mindmapEditing?.itemId ||
          itemId === document.activeElement?.closest?.('.board-item')?.dataset.itemId))
      eventsRuntime.captureDraftInputs?.();
    state.boardEditLeases.set(itemId, { ownerClientId, itemId, expiresAt: Number(message.expiresAt) || Date.now() + 3500 });
    state.boardUnlockRevisions.delete(itemId);
    if (changed && ownerClientId !== state.socketClientId) eventsRuntime.onElementEditLockLost?.(itemId);
  } else if (Number(message?.revision) > state.revision) {
    changed = !wasWaiting;
    state.boardUnlockRevisions.set(itemId, Number(message.revision));
    requestResync();
  } else {
    changed = Boolean(previous) || wasWaiting;
    state.boardEditLeases.delete(itemId);
    state.boardUnlockRevisions.delete(itemId);
  }
  if (!deferRefresh) armExpiryCheck();
  // Renewals update the deadline only. They must not scan/rewrite the entire
  // canvas, cancel gestures again, or pump the outbox for every heartbeat.
  if (changed && !deferRefresh) { refresh(); resumeSync(); }
  return changed;
}

function applyBoardEditLeaseBatch(messages) {
  let changed = false;
  for (const message of messages) if (applyBoardEditLease(message, true)) changed = true;
  armExpiryCheck();
  if (changed) { refresh(); resumeSync(); }
}

function applyBoardEditLeases(leases = []) {
  state.boardEditLeases.clear();
  state.boardUnlockRevisions.clear();
  for (const lease of leases) {
    const ownerClientId = lease.ownerClientId || lease.clientId;
    if (ownerClientId) state.boardEditLeases.set(lease.itemId || '*', { ...lease, ownerClientId });
  }
  armExpiryCheck();
  refresh();
}

function resolveBoardUnlockRevision() {
  let changed = false;
  for (const [id, revision] of state.boardUnlockRevisions) if (state.revision >= revision) {
    state.boardUnlockRevisions.delete(id);
    state.boardEditLeases.delete(id);
    changed = true;
  }
  if (changed) { armExpiryCheck(); refresh(); resumeSync(); }
}

function suspendBoardEditLeaseOnDisconnect() {
  eventsRuntime.resetCursorPresence?.();
  eventsRuntime.captureDraftInputs?.();
  state.snapshotTransfer = null;
  clearTimeout(state.boardEditHeartbeatTimer);
  state.boardEditHeartbeatTimer = null;
  state.localEditActivities.clear();
  state.socketClientId = null;
  for (const request of requests.values()) { clearTimeout(request.timeout); request.resolve({ granted: false, reason: 'offline' }); }
  requests.clear();
  acquisitions.clear();
  clearTimeout(releaseTimer); releaseTimer = null;
  releaseTimers.clear();
  // Remote leases remain read-only until the next authoritative snapshot.
  refresh();
}

function activeEditorIds() {
  const focused = document.activeElement;
  const focusedId = focused?.matches?.('input,textarea,[contenteditable="true"]') ? focused.closest?.('.board-item')?.dataset.itemId : null;
  return new Set([state.editingId, state.mindmapEditing?.itemId, sheetStoreRuntime.sheetEditorItemId, focusedId,
    ...(state.elementEditSessions?.keys() || []), ...(state.gestureSession?.targetIds || []),
    ...(window.ConnectorUI?.activeGesture?.()?.itemId ? [window.ConnectorUI.activeGesture().itemId] : [])].filter(Boolean));
}

function scheduleBoardEditHeartbeat() {
  if (state.boardEditHeartbeatTimer) return;
  state.boardEditHeartbeatTimer = setTimeout(() => {
    state.boardEditHeartbeatTimer = null;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) return;
    const pending = new Set();
    const blocked = state.syncQueue.requiresResolution && !state.conflictRecoveryPending;
    if (!blocked) for (const entry of state.syncQueue.serialize().entries.filter(entry => !entry.error))
      for (const id of editOperationTargets(entry.op, state)) pending.add(id);
    const editors = document.hidden || !document.hasFocus() ? new Set() : activeEditorIds();
    const release = [], renew = [];
    for (const [id, activity] of state.localEditActivities) {
      if (releaseTimers.has(id)) continue;
      if (blocked || isRemoteBoardLocked(id)) { release.push(id); continue; }
      if (!editors.has(id) && !(state.localBoardEditGesture && activity.gesture) &&
          Date.now() >= activity.idleUntil && (!pending.has(id) || Date.now() - activity.idleUntil >= 30000)) {
        release.push(id);
      } else renew.push(id);
    }
    sendElementEditActivities(release, false);
    sendElementEditActivities(renew, true, true);
    if (state.localEditActivities.size) scheduleBoardEditHeartbeat();
  }, 900);
}

function sendBoardEditActivity(itemId = null, active = true, renewOnly = false) {
  return sendElementEditActivities(!active && !itemId ? [...state.localEditActivities.keys()] : [itemId], active, renewOnly);
}

function sendElementEditActivities(ids, active = true, renewOnly = false) {
  if (window.MuseAccount?.isGuest?.() || !state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) return;
  ids = [...new Set(ids)];
  if (active && ids.some(isRemoteBoardLocked)) return;
  const now = Date.now(), itemIds = [];
  for (const itemId of ids) {
    if (!itemId || active && (state.syncQueue.requiresResolution && !state.conflictRecoveryPending || isRemoteBoardLocked(itemId))) continue;
    releaseTimers.delete(itemId);
    if (active) {
      const activity = state.localEditActivities.get(itemId) || { idleUntil: 0, lastSent: 0, gesture: false };
      if (!renewOnly) { activity.idleUntil = now + 3500; activity.finished = false; }
      state.localEditActivities.set(itemId, activity);
      scheduleBoardEditHeartbeat();
      if (now - activity.lastSent < 850) continue;
      activity.lastSent = now;
    } else {
      state.localEditActivities.delete(itemId);
      // A release in transit is no longer safe to reuse locally.
      if (state.boardEditLeases.get(itemId)?.ownerClientId === state.socketClientId) state.boardEditLeases.delete(itemId);
    }
    itemIds.push(itemId);
  }
  if (!state.localEditActivities.size) {
    clearTimeout(state.boardEditHeartbeatTimer);
    state.boardEditHeartbeatTimer = null;
  }
  if (!itemIds.length) return;
  try { state.socket.send(JSON.stringify({ type: 'edit-activity', active, itemId: itemIds[0], itemIds })); }
  catch (error) { console.warn('Could not send editing activity', error); }
}

function finishElementEditActivity(itemId) {
  if (!document.hidden && (state.elementEditSessions?.has(itemId) || state.editingId === itemId || state.mindmapEditing?.itemId === itemId || sheetStoreRuntime.sheetEditorItemId === itemId)) return;
  const activity = state.localEditActivities.get(itemId);
  if (!activity) return;
  activity.idleUntil = Date.now();
  activity.gesture = false;
  activity.finished = true;
  if ([...requests.values()].some(request => request.itemIds.includes(itemId))) return;
  const pending = state.syncQueue.serialize().entries.some(entry => editOperationTargets(entry.op, state).has(itemId));
  if (!pending && !releaseTimers.has(itemId)) {
    const epoch = state.canvasEpoch, socket = state.socket;
    releaseTimers.set(itemId, { epoch, socket, at: Date.now() + RELEASE_GRACE_MS });
    scheduleReleaseFlush();
  }
  else scheduleBoardEditHeartbeat();
}

function scheduleReleaseFlush() {
  if (releaseTimer || !releaseTimers.size) return;
  const at = Math.min(...[...releaseTimers.values()].map(release => release.at));
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    const editors = document.hidden ? new Set() : activeEditorIds(), pending = new Set();
    for (const entry of state.syncQueue.serialize().entries)
      for (const id of editOperationTargets(entry.op, state)) pending.add(id);
    for (const request of requests.values()) for (const id of request.itemIds) pending.add(id);
    const ids = [];
    for (const [id, release] of releaseTimers) {
      if (release.at > Date.now()) continue;
      releaseTimers.delete(id);
      if (release.epoch === state.canvasEpoch && release.socket === state.socket && !editors.has(id) && !pending.has(id)) ids.push(id);
    }
    sendElementEditActivities(ids, false);
    scheduleReleaseFlush();
  }, Math.max(1, at - Date.now()));
}

function releaseFinishedElementEdits(operation = null) {
  const editors = activeEditorIds();
  if (operation) for (const id of editOperationTargets(operation, state))
    if (!editors.has(id)) finishElementEditActivity(id);
  for (const [id, activity] of state.localEditActivities) if (activity.finished) finishElementEditActivity(id);
}

function suspendElementEditActivities() {
  // A hidden editor can release idle ownership, but its last queued input must
  // retain the lease until the canonical ACK (or the existing failure timeout).
  for (const id of state.localEditActivities.keys()) finishElementEditActivity(id);
}

function acquireElementEditLease(itemId, { includeItem = false } = {}) {
  return acquireElementEditLeases([itemId], { includeItem });
}

function acquireElementEditLeases(ids, { includeItem = false } = {}) {
  const itemIds = [...new Set(ids)].sort(), itemId = itemIds[0];
  if (!itemIds.length) return Promise.resolve({ granted: true, itemIds });
  if (window.MuseAccount?.isGuest?.()) return Promise.resolve({ granted: true, local: true, itemIds, item: state.items.get(itemId) });
  if (document.hidden) return Promise.resolve({ granted: false, reason: 'background' });
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined || itemIds.some(isRemoteBoardLocked))
    return Promise.resolve({ granted: false, reason: 'unavailable' });
  for (const id of itemIds) releaseTimers.delete(id);
  // Focus, beforeinput and a modal can request the same lease concurrently.
  // Share the confirmation and keep an already confirmed session continuous.
  const key = JSON.stringify([state.canvasEpoch, includeItem, itemIds]);
  const existing = acquisitions.get(key);
  if (existing?.socket === state.socket) return existing.promise;
  if (!includeItem && itemIds.every(hasElementEditLease)) {
    sendElementEditActivities(itemIds);
    return Promise.resolve({ granted: true, itemIds });
  }
  const requestId = crypto.randomUUID(), socket = state.socket, epoch = state.canvasEpoch;
  const promise = new Promise(resolve => {
    const timeout = setTimeout(() => { requests.delete(requestId); resolve({ granted: false, reason: 'timeout' }); }, 6000);
    requests.set(requestId, { resolve, timeout, socket, epoch, itemId, itemIds });
    try { socket.send(JSON.stringify({ type: 'edit-activity', active: true, itemId, itemIds, requestId, includeItem, revision: state.revision })); }
    catch { handleElementEditLeaseResult({ requestId, granted: false, reason: 'offline' }); }
  }).finally(() => { if (acquisitions.get(key)?.promise === promise) acquisitions.delete(key); });
  acquisitions.set(key, { socket, promise });
  return promise;
}

function handleElementEditLeaseResult(message) {
  const request = requests.get(message.requestId);
  if (!request) return;
  requests.delete(message.requestId);
  clearTimeout(request.timeout);
  const current = request.socket === state.socket && request.epoch === state.canvasEpoch && (!message.boardId || message.boardId === state.boardId);
  const granted = current && message.granted && state.revision >= message.revision;
  if (granted) {
    for (const id of request.itemIds) state.localEditActivities.set(id, { idleUntil: Date.now() + 3500, lastSent: Date.now(), gesture: false });
    scheduleBoardEditHeartbeat();
    if (document.hidden) for (const id of request.itemIds) finishElementEditActivity(id);
  }
  // A confirmation arriving after visibilitychange must not reopen a hidden
  // editor. Release idle ownership using the same pending-input/ACK rules.
  request.resolve({ ...message, itemIds: request.itemIds, granted: Boolean(granted && !document.hidden) });
}

async function beginElementEditSession(ids) {
  const epoch = state.canvasEpoch, socket = state.socket;
  const result = await acquireElementEditLeases(ids);
  if (!result.granted || epoch !== state.canvasEpoch || socket !== state.socket) return null;
  for (const id of result.itemIds) state.elementEditSessions.set(id, (state.elementEditSessions.get(id) || 0) + 1);
  let released = false;
  return {
    current: () => !released && epoch === state.canvasEpoch && socket === state.socket && result.itemIds.every(hasElementEditLease),
    release() {
      if (released) return;
      released = true;
      if (epoch !== state.canvasEpoch) return;
      for (const id of result.itemIds) {
        const count = (state.elementEditSessions.get(id) || 0) - 1;
        if (count > 0) state.elementEditSessions.set(id, count);
        else { state.elementEditSessions.delete(id); finishElementEditActivity(id); }
      }
    }
  };
}

function waitForGestureEditLease(gesture, ids, isCurrent, onGranted) {
  gesture.leasePending = true;
  void beginElementEditSession(ids).then(session => {
    if (!isCurrent()) { session?.release(); return; }
    if (!session) { eventsRuntime.onElementEditLockLost?.(ids[0]); return; }
    gesture.editSession = session;
    gesture.leasePending = false;
    onGranted?.();
  });
}

function resumeActiveElementEditors() {
  if (document.hidden || isLocalEditingBlocked()) return;
  for (const id of activeEditorIds()) if (!hasElementEditLease(id)) void acquireElementEditLease(id);
}

export { configureElementEditLeases, applyBoardEditLease, applyBoardEditLeases, resolveBoardUnlockRevision,
  suspendBoardEditLeaseOnDisconnect, scheduleBoardEditHeartbeat, sendBoardEditActivity, finishElementEditActivity,
  acquireElementEditLease, acquireElementEditLeases, beginElementEditSession, waitForGestureEditLease, handleElementEditLeaseResult, resumeActiveElementEditors };
export { sendElementEditActivities, releaseFinishedElementEdits, applyBoardEditLeaseBatch, suspendElementEditActivities };
