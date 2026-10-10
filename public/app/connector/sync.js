import { state } from '../state.js';
import { renderItem } from '../rendering.js';
import { snapshotDocument } from '../history-controller.js';
import { makeId } from '../utilities.js';
import { upsertItem } from '../items.js';
import { showToast } from '../interface-model.js';
import { schedulePersistPendingOps } from '../canvas-session.js';
import { requestResync } from '../sync-queue-model.js';
import { pumpSyncQueue } from '../sync-queue.js';

import { endpoints } from './binding.js';
import { schedule } from './controls.js';
import { preview } from './draft.js';
import { moveEdit } from './editing.js';
import { stateRuntime } from './runtime/state.js';
import { C, aabb, baselines, button, cache, mounted, oldBounds, pathIndex, pending, smartChoices } from './state.js';

function invalidate(ids) {
  const affected = new Set();
  for (const id of ids || []) {
    for (const c of state.connectorIndex.get(id) || []) affected.add(c);
    const item = state.items.get(id),
      previous = oldBounds.get(id);
    if (!item) smartChoices.delete(id);
    const connection = item?.type === 'connector' ? item : baselines.get(id);
    if (connection?.type === 'connector')
      for (const endpointId of [connection.source?.binding?.id, connection.target?.binding?.id].filter(Boolean)) {
        for (const peerId of state.connectorIndex.get(endpointId) || [])
          if (state.items.get(peerId)?.route?.type === 'smart') affected.add(peerId);
      }
    for (const area of [previous, item && aabb(item)].filter(Boolean)) {
      for (const c of pathIndex.search(area)) affected.add(typeof c === 'string' ? c : c.id);
    }
    if (item) oldBounds.set(id, aabb(item));
  }
  for (const id of affected) {
    cache.delete(id);
    const item = state.items.get(id);
    if (item && mounted(id)) renderItem(item);
  }
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
    item.contentVersion = baseContentVersion + 1;
    for (const connection of C.reconcile(state.items.values(), previous, item))
      baselines.set(connection.id, C.clone(connection));
    invalidate([item.id]);
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
  if (operation.kind === 'batch') return { ...operation, ops: operation.ops.map(prepareOperation) };
  if (operation.kind === 'upsert' && operation.item && !operation.connectorCapabilities)
    return { ...operation, ...prepareBroadcast(operation.item) };
  return operation;
}

function observe(item) {
  if (item.type === 'table') C.ensureTableIds(item);
  if (!baselines.has(item.id)) baselines.set(item.id, C.clone(item));
  if (item.type !== 'connector' && !oldBounds.has(item.id)) oldBounds.set(item.id, aabb(item));
}

function accepted(item) {
  baselines.set(item.id, C.clone(item));
  invalidate([item.id]);
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
  const points = cache.get(item.id)?.result.points;
  if (!points) return false;
  return points.slice(1).some((b, i) => C.distanceToSegment(p, points[i], b) <= 6 / state.zoom);
}

async function prepareExport() {
  await document.fonts.ready;
  for (const item of state.items.values()) if (item.type === 'connector') renderItem(item);
  const started = performance.now();
  while (pending.size && performance.now() - started < 5e3) await new Promise((resolve2) => setTimeout(resolve2, 16));
}

function preserveConflict(message) {
  const entry = state.syncQueue.serialize().entries.find((e) => e.opId === message.opId);
  if (!entry) return;
  const key = `museboard.connection-conflicts.${state.boardId}`;
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  entries.push({ time: Date.now(), code: message.code, opId: entry.opId, operation: entry.op });
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(-30)));
  } catch {}
  showConflictDrafts();
}

function showConflictDrafts() {
  const key = `museboard.connection-conflicts.${state.boardId}`;
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  if (!entries.length) return;
  document.querySelector('.connection-conflicts')?.remove();
  const panel = document.createElement('div');
  panel.className = 'connection-relations connection-conflicts';
  const title = document.createElement('strong');
  title.textContent = '本地修改已保留';
  panel.append(title);
  document.body.append(panel);
  const message = document.createElement('p');
  message.textContent = '远端内容已变化。可以下载完整草稿，或把冲突及后续未同步的内容恢复为独立可编辑副本进行比较。';
  panel.append(message);
  button(
    '下载草稿',
    () => {
      const payload = {
        version: 2,
        boardId: state.boardId,
        document: snapshotDocument(),
        conflicts: entries,
        pending: state.syncQueue.serialize().entries
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'museboard-conflict-drafts.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    },
    panel
  );
  button(
    '恢复完整可编辑副本',
    () => {
      const queued = state.syncQueue.serialize().entries;
      const recovered = new Map();
      const collect = (op, opId = null) => {
        if (!op || typeof op !== 'object') return;
        if (op.kind === 'batch') return (op.ops || []).forEach((child) => collect(child, opId));
        if (op.item && ['text', 'note', 'table', 'mindmap', 'sheet', 'connector'].includes(op.item.type)) {
          recovered.set(op.item.id, { item: C.clone(op.item), opIds: new Set(opId ? [opId] : []) });
        }
      };
      entries.forEach((entry) => collect(entry.operation, entry.opId));
      queued.forEach((entry) => collect(entry.op, entry.opId));
      const restoredOriginalIds = new Set();
      let restored = 0;
      for (const [originalId, { item }] of recovered) {
        item.id = makeId(item.type);
        if (item.type === 'connector') {
          item.connectorVersion = 1;
          item.fieldVersions = {};
          C.apply(item);
          for (const key of ['source', 'target'])
            if (!item[key].binding) {
              item[key].fallback.x += 32 + restored * 12;
              item[key].fallback.y += 32 + restored * 12;
            }
          item.route.constraints = item.route.constraints.map((constraint) => ({
            ...constraint,
            a: { x: constraint.a.x + 32 + restored * 12, y: constraint.a.y + 32 + restored * 12 },
            b: { x: constraint.b.x + 32 + restored * 12, y: constraint.b.y + 32 + restored * 12 }
          }));
          C.apply(item);
        } else {
          item.x = (Number(item.x) || 0) + 32 + restored * 12;
          item.y = (Number(item.y) || 0) + 32 + restored * 12;
        }
        item.contentVersion = 0;
        item.sectionId = null;
        item.groupId = null;
        if (item.type === 'mindmap' && item.source?.provider === 'xmind') delete item.source;
        if (upsertItem(item, { select: true })) {
          restoredOriginalIds.add(originalId);
          restored += 1;
        }
      }
      if (!restored) {
        showToast('没有可恢复的完整对象；草稿仍保留在本机');
        return;
      }
      if (restoredOriginalIds.size !== recovered.size) {
        showToast(`已恢复 ${restored} 个副本；仍有内容未恢复，草稿和待同步操作已保留`);
        return;
      }
      const touchesRecoveredItem = (op) => {
        if (!op || typeof op !== 'object') return false;
        if (op.kind === 'batch') return (op.ops || []).some(touchesRecoveredItem);
        if (op.item?.id) return restoredOriginalIds.has(op.item.id);
        if (op.itemId) return restoredOriginalIds.has(op.itemId);
        return false;
      };
      const discardIds = queued.filter((entry) => touchesRecoveredItem(entry.op)).map((entry) => entry.opId);
      state.syncQueue.discard(discardIds);
      localStorage.removeItem(key);
      panel.remove();
      schedulePersistPendingOps();
      requestResync();
      pumpSyncQueue();
      showToast(restored ? `已恢复 ${restored} 个完整可编辑副本` : '没有可恢复的完整对象');
    },
    panel
  );
  button('关闭', () => panel.remove(), panel);
}

export {
  accepted,
  edgeGesture,
  edgeReplay,
  hitTest,
  invalidate,
  observe,
  prepareBroadcast,
  prepareExport,
  prepareOperation,
  preserveConflict,
  showConflictDrafts
};
