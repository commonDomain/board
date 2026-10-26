import { state } from '../state.js';
import { isItemVisible } from '../layer-visibility.js';
import { getViewportWorkPolicy } from '../canvas-performance.js';
import { renderItem } from '../rendering.js';
import { showToast } from '../interface-model.js';
import { persistPendingOps, schedulePersistPendingOps, discardLocalCanvasDraft } from '../canvas-session.js';
import { pumpSyncQueue } from '../sync-queue.js';
import { acquireElementEditLease, finishElementEditActivity } from '../element-edit-leases.js';
import { canMutateItem, getWritableLayer } from '../layers-model.js';
import { markDirty } from '../save-status.js';
import { reapplyPendingOperations } from '../pending-replay.js';
import { renderBoardLock } from '../connection.js';
import { collectConflictItems, recoveryItem, replaceConflictOperations } from './conflict-recovery-model.js';
import { prepareMutationVersions } from '../mutation-versions-model.js';
import { editOperationTargets } from '../edit-lock-targets-model.js';

import { endpoints } from './binding.js';
import { schedule, flushJumps } from './controls.js';
import { preview } from './draft.js';
import { endEdit, moveEdit } from './editing.js';
import { geometry } from './routing.js';
import { stateRuntime } from './runtime/state.js';
import { C, aabb, baselines, button, cache, mounted, oldBounds, outlines, pathIndex, pending, smartChoices } from './state.js';
import { invalidateContentLayout } from './layout-cache.js';

const changedContent = new Set();
const dirtyConnections = new Set();
let contentFrame = null;
let contentBoardId = null;
let contentEpoch = null;

// Content layout is published after mounting/rebuilding finishes. Coalesce
// owners in one frame so render order and virtualized mounting are irrelevant.
function contentChanged(id) {
  invalidateContentLayout(id);
  invalidate([id]);
}

function invalidate(ids) {
  if (contentBoardId !== state.boardId || contentEpoch !== state.canvasEpoch) {
    if (contentFrame !== null) cancelAnimationFrame(contentFrame);
    contentFrame = null;
    changedContent.clear();
    dirtyConnections.clear();
    contentBoardId = state.boardId;
    contentEpoch = state.canvasEpoch;
  }
  for (const id of ids || []) changedContent.add(id);
  if (contentFrame !== null) return;
  contentFrame = requestAnimationFrame(() => flushInvalidations());
}

function flushInvalidations(force = false) {
  if (contentFrame !== null) cancelAnimationFrame(contentFrame);
  contentFrame = null;
  if (contentBoardId !== state.boardId || contentEpoch !== state.canvasEpoch) { changedContent.clear(); dirtyConnections.clear(); return; }
  const affected = dirtyConnections;
  // Obstacle lookups matter only to avoiding routes. Moving a group otherwise
  // runs two path-index searches per moved item on every frame for nothing.
  let avoidingRoutes = false;
  for (const candidate of state.items.values()) {
    const route = candidate.type === 'connector' ? candidate.route : null;
    if (route?.avoidance !== false && ['orthogonal', 'smart'].includes(route?.type)) { avoidingRoutes = true; break; }
  }
  for (const id of changedContent) {
    for (const c of state.connectorIndex.get(id) || []) affected.add(c);
    const item = state.items.get(id),
      previous = oldBounds.get(id);
    if (!item) { smartChoices.delete(id); outlines.delete(id); }
    const connection = item?.type === 'connector' ? item : baselines.get(id);
    if (!item && connection?.type === 'connector') {
      cache.delete(id); pending.delete(id); pathIndex.remove(id); baselines.delete(id);
    }
    if (item?.type === 'connector') affected.add(item.id);
    if (connection?.type === 'connector')
      for (const endpointId of [connection.source?.binding?.id, connection.target?.binding?.id].filter(Boolean)) {
        for (const peerId of state.connectorIndex.get(endpointId) || [])
          if (state.items.get(peerId)?.route?.type === 'smart') affected.add(peerId);
      }
    for (const area of connection?.type === 'connector' || !avoidingRoutes ? [] : [previous, item && aabb(item)].filter(Boolean)) {
      for (const c of pathIndex.search(area)) {
        const edgeId = typeof c === 'string' ? c : c.id;
        const route = state.items.get(edgeId)?.route;
        if (route?.avoidance !== false && ['orthogonal', 'smart'].includes(route?.type)) affected.add(edgeId);
      }
    }
    if (item) oldBounds.set(id, aabb(item));
    else oldBounds.delete(id);
  }
  changedContent.clear();
  const started = performance.now();
  const budget = getViewportWorkPolicy().connectorBudgetMs;
  for (const id of affected) {
    affected.delete(id);
    const item = state.items.get(id);
    if (item && mounted(id)) renderItem(item);
    // An unmounted path cannot be repainted, but its obsolete geometry must
    // not become selectable once this id leaves the dirty queue.
    else {
      cache.delete(id);
      pending.delete(id);
      // Live, unmounted paths still participate in obstacle invalidation.
      if (!item) pathIndex.remove(id);
    }
    if (!force && performance.now() - started >= budget) break;
  }
  if (affected.size) contentFrame = requestAnimationFrame(() => flushInvalidations());
  schedule();
  window.ConnectorImpact?.invalidate();
}

function prepareBroadcast(item) {
  if (item.type === 'connector') {
    C.apply(item);
    const base = baselines.get(item.id);
    if (base?.type === 'connector') {
      const fields = {};
      for (const k of ['source', 'target', 'route', 'style', 'labels', 'relation'])
        if (JSON.stringify(base[k]) !== JSON.stringify(item[k])) fields[k] = C.clone(item[k]);
      if (Object.keys(fields).length) {
        const expected = {};
        for (const k of Object.keys(fields)) {
          expected[k] = base.fieldVersions?.[k] || 0;
          item.fieldVersions[k] = expected[k] + 1;
        }
        baselines.set(item.id, C.clone(item));
        return { kind: 'upsert', item, connectorPatch: { fields, expected }, connectorCapabilities: 1 };
      }
    }
    baselines.set(item.id, C.clone(item));
    return { kind: 'upsert', item, connectorCapabilities: 1 };
  }
  C.ensureTableIds(item);
  const previous = baselines.get(item.id);
  let baseContentVersion;
  if (
    previous &&
    JSON.stringify([previous.text, previous.richText, previous.rows, previous.tree]) !==
      JSON.stringify([item.text, item.richText, item.rows, item.tree])
  ) {
    baseContentVersion = previous.contentVersion || 0;
    // Content revisions belong to server commits. Advancing them per keystroke
    // creates imaginary versions when unsent edits are coalesced or retried.
    item.contentVersion = baseContentVersion;
    const attached = [...(state.connectorIndex.get(item.id) || [])].map(id => state.items.get(id)).filter(Boolean);
    for (const connection of C.reconcile(attached, previous, item))
      baselines.set(connection.id, C.clone(connection));
    contentChanged(item.id);
  }
  const connectorGeometry = [];
  for (const id of state.connectorIndex.get(item.id) || []) {
    
    const connection = state.items.get(id);
    if (!connection?.connectorVersion) continue;
    const e = endpoints(connection),
      g = { id };
    for (const key of ['source', 'target'])
      if (connection[key].binding?.id === item.id) {
        g[key] = e[key === 'source' ? 'start' : 'end'];
        connection[key].fallback = g[key];
      }
    connectorGeometry.push(g);
  }
  baselines.set(item.id, C.clone(item));
  return {
    kind: 'upsert',
    item,
    ...(baseContentVersion !== void 0 ? { baseContentVersion } : {}),
    ...(connectorGeometry.length ? { connectorGeometry } : {}),
    connectorCapabilities: 1
  };
}

function prepareOperation(operation) {
  if (operation.kind === 'batch') return prepareMutationVersions({ ...operation, ops: operation.ops.map(prepareOperation) }, state, state.mutationBaselines);
  if (operation.kind === 'upsert' && operation.item && !operation.connectorCapabilities)
    operation = { ...operation, ...prepareBroadcast(operation.item) };
  return prepareMutationVersions(operation, state, state.mutationBaselines);
}

function observe(item) {
  if (item.type === 'table') C.ensureTableIds(item);
  if (!baselines.has(item.id)) baselines.set(item.id, C.clone(item));
  if (item.type !== 'connector' && !oldBounds.has(item.id)) oldBounds.set(item.id, aabb(item));
}

function beforeRemoteOperation(op) {
  const edit = stateRuntime.edit;
  if (!edit || !op) return;
  if (op.kind === 'batch') {
    for (const child of op.ops || []) beforeRemoteOperation(child);
  } else if ((op.kind === 'upsert' && op.item?.id === edit.id) ||
    (op.kind === 'delete' && op.ids?.includes(edit.id)) ||
    (op.kind === 'set-flags' && op.targetType === 'item' && op.ids?.includes(edit.id))) {
    endEdit(true);
  }
}

function accepted(item) {
  baselines.set(item.id, C.clone(item));
  invalidate([item.id]);
}

function resetBaselines(items) {
  baselines.clear();
  for (const item of items) baselines.set(item.id, C.clone(item));
}

function edgeGesture() {
  return !state.spacePan &&
    !stateRuntime.targetTextMode &&
    (stateRuntime.draft || stateRuntime.edit) &&
    stateRuntime.lastPointer
    ? { kind: 'connector', pointerId: stateRuntime.edit?.pointerId ?? stateRuntime.lastPointer.pointerId }
    : null;
}

function edgeReplay(event) {
  if (stateRuntime.edit) moveEdit(event);
  else if (stateRuntime.draft) preview(event);
}

function hitTest(item, p) {
  const route = selectionGeometry(item);
  if (!route) return false;
  for (let i = 1; i < route.points.length; i++)
    if (C.distanceToSegment(p, route.points[i - 1], route.points[i]) <= 6 / state.zoom) return true;
  return false;
}

function selectionGeometry(item) {
  if (!isItemVisible(item) || window.MusePlanning?.isTaskLineHidden(item)) return null;
  const entry = cache.get(item.id);
  const dirty = dirtyConnections.has(item.id) || changedContent.has(item.id) ||
    [item.source?.binding?.id, item.target?.binding?.id].some(id => id && changedContent.has(id));
  // A settled path is read-only: selecting it must not measure its text ports.
  const ends = !dirty && entry?.ends || endpoints(item);
  if (ends.hidden) return null;
  // Reuse the rendered route, including the worker's obstacle detours.
  const result = !dirty && entry?.result || geometry(item, ends);
  return { points: result.points, radius: Math.max(0.5, Number(item.style?.width) / 2 || 0.5) };
}

async function prepareExport() {
  await document.fonts.ready;
  flushInvalidations(true);
  for (const item of state.items.values()) if (item.type === 'connector') renderItem(item);
  const started = performance.now();
  while (pending.size && performance.now() - started < 5e3) await new Promise((resolve2) => setTimeout(resolve2, 16));
  flushInvalidations(true);
  flushJumps();
}

function preserveConflict(message) {
  const entry = state.syncQueue.serialize().entries.find((e) => e.opId === message.opId);
  if (!entry) return;
  const key = conflictStorageKey();
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  if (!entries.some(saved => saved.opId === entry.opId))
    entries.push({ time: Date.now(), code: message.code, opId: entry.opId, operation: entry.op,
      objects: [...editOperationTargets(entry.op, state)].map(id => state.items.get(id)).filter(Boolean).map(item => C.clone(item)) });
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(-30)));
  } catch {}
  showConflictDrafts();
}

function showConflictDrafts() {
  const key = conflictStorageKey();
  const panelEpoch = state.canvasEpoch;
  const panelCurrent = () => conflictStorageKey() === key && state.canvasEpoch === panelEpoch;
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  if (!entries.length) return;
  document.querySelector('.connection-conflicts')?.remove();
  const panel = document.createElement('dialog');
  panel.className = 'sync-dialog connection-conflicts';
  panel.dataset.tone = 'warning';
  panel.setAttribute('aria-labelledby', 'connectionConflictTitle');
  panel.setAttribute('aria-describedby', 'connectionConflictDescription');
  const header = document.createElement('header');
  header.className = 'sync-dialog-header';
  header.innerHTML = '<span class="sync-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 0 1 15.4-5.4L21 8M21 3v5h-5M21 13a9 9 0 0 1-15.4 5.4L3 16M3 21v-5h5"/></svg></span><div class="sync-dialog-heading"><span class="sync-dialog-eyebrow">画布同步</span><h2 id="connectionConflictTitle">处理同步冲突</h2></div>';
  button('×', () => panel.remove(), header, '关闭').className = 'sync-close';
  panel.append(header);
  panel.addEventListener('cancel', () => panel.remove());
  document.body.append(panel);
  const message = document.createElement('p');
  message.id = 'connectionConflictDescription';
  message.className = 'sync-description';
  message.textContent = '云端已有更新。恢复会以本地内容替换原元素，保留原位置；其他成员仍在编辑时需稍后重试。';
  panel.append(message);
  const safety = document.createElement('p');
  safety.className = 'sync-safety';
  safety.textContent = '本地草稿已保留，仅处理当前画布。';
  const status = document.createElement('p');
  status.className = 'sync-feedback';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const feedback = text => { status.textContent = text; };
  const actions = document.createElement('footer');
  actions.className = 'sync-dialog-actions';
  panel.append(safety, status, actions);
  const setBusy = busy => {
    panel.setAttribute('aria-busy', String(busy));
    restoreButton.disabled = discardButton.disabled = busy;
  };
  const restoreButton = button(
    '恢复到原元素',
    async () => {
      if (!panelCurrent()) { panel.remove(); return; }
      const queue = state.syncQueue, epoch = state.canvasEpoch, boardId = state.boardId;
      if (state.draftDiscardPending || state.conflictRecoveryPending || queue.inflightOpId) { feedback('请等待当前同步完成后再恢复'); return; }
      const before = queue.serialize(), acquired = new Set(), replacements = new Map();
      const items = collectConflictItems(entries, before.entries, state);
      if (!items.size) { feedback('没有可恢复的完整元素；草稿仍保留在本机'); return; }
      const current = () => state.syncQueue === queue && state.canvasEpoch === epoch && state.boardId === boardId && panelCurrent();
      queue.pause();
      state.conflictRecoveryPending = true;
      setBusy(true);
      feedback('正在恢复本地修改…');
      renderBoardLock();
      let replaced = false, durable = false;
      try {
        for (const [id, draft] of items) {
          const result = await acquireElementEditLease(id, { includeItem: true });
          if (!current()) return;
          if (!result.granted) throw new Error('原元素正在被其他成员编辑，或连接尚未确认；草稿仍保留，请稍后重试');
          acquired.add(id);
          const original = result.item;
          if (!draft) {
            replacements.set(id, { kind: 'delete', ids: [id], expectedMutations: { [id]: original ? original.mutationVersion || 0 : null } });
            continue;
          }
          const container = id.startsWith('section:') ? 'section' : id.startsWith('group:') ? 'group' : null;
          const safety = { allowConflictRecovery: true };
          state.conflictRecoveryPending = false;
          const writable = container ? !original?.locked : getWritableLayer(original?.layerId || draft.layerId, safety) && (!original || canMutateItem(original, safety));
          state.conflictRecoveryPending = true;
          if (!writable) throw new Error('原元素或所属图层已锁定，草稿仍保留，请解锁后重试');
          const item = recoveryItem(draft, original);
          if (container) {
            replacements.set(id, prepareMutationVersions({ kind: `${container}-upsert`, [container]: item }, state, state.mutationBaselines));
            continue;
          }
          if (original) baselines.set(id, C.clone(original)); else baselines.delete(id);
          replacements.set(id, prepareOperation(prepareBroadcast(item)));
        }
        const ready = replaceConflictOperations(queue.serialize(), replacements, () => crypto.randomUUID());
        queue.restore(ready);
        queue.pause();
        replaced = true;
        schedulePersistPendingOps();
        if (!await persistPendingOps()) throw new Error('恢复内容尚未可靠保存在本机，原草稿仍保留，请保持此页面');
        durable = true;
        if (!current()) return;
        reapplyPendingOperations();
        markDirty(true);
        localStorage.removeItem(key);
        panel.remove();
        showToast(queue.requiresResolution ? '已原位恢复；仍有其他同步问题，请继续核对' : '已恢复到原元素，可以继续编辑');
      } catch (error) {
        if (current() && replaced && !durable) { queue.restore(before); queue.pause(); schedulePersistPendingOps(); }
        if (current()) feedback(error.message || '恢复失败，原草稿仍保留');
      } finally {
        queue.unpause();
        if (current()) {
          setBusy(false);
          state.conflictRecoveryPending = false;
          for (const id of acquired) finishElementEditActivity(id);
          renderBoardLock();
          pumpSyncQueue();
        }
      }
    },
    actions
  );
  restoreButton.className = 'sync-primary';
  const discardButton = button('丢弃本地草稿，使用云端版本', async () => {
    if (!panelCurrent()) { panel.remove(); return; }
    const previousToast = document.querySelector('.toast');
    panel.close();
    setBusy(true);
    try {
      const discarded = await discardLocalCanvasDraft();
      if (!discarded && panelCurrent() && panel.isConnected) {
        panel.showModal();
        const toast = document.querySelector('.toast');
        if (toast && toast !== previousToast) feedback(toast.textContent);
      }
    } finally { setBusy(false); }
  }, actions);
  discardButton.className = 'sync-discard';
  actions.prepend(discardButton);
  document.getElementById('syncIssueDialog')?.close();
  panel.showModal();
}

function conflictStorageKey() {
  return `museboard.connection-conflicts.${window.WhiteboardStorage?.getScope?.() || 'legacy'}:${state.boardId}`;
}

export {
  contentChanged,
  accepted,
  resetBaselines,
  edgeGesture,
  edgeReplay,
  hitTest,
  selectionGeometry,
  invalidate,
  observe,
  beforeRemoteOperation,
  prepareBroadcast,
  prepareExport,
  prepareOperation,
  preserveConflict,
  showConflictDrafts
};
