import { state } from '../state.js';
import { canMutateItem } from '../layers-model.js';
import { snapshotItems } from '../history-controller-model.js';
import { pushUndoSnapshot } from '../history-controller.js';
import { upsertItem, broadcastUpsert } from '../items.js';
import { getSelectedIds } from '../selection-model.js';
import { selectItem } from '../selection.js';
import { renderItem } from '../rendering.js';
import { markDirty } from '../save-status.js';
import { makeId } from '../utilities.js';
import { openAdaptiveDialog } from '../interface.js';
import { showToast } from '../interface-model.js';
import { getBoardPoint } from '../camera.js';
import { els } from '../elements.js';
import { captureViewportPointer, syncEdgePanForEvent, releaseViewportPointer } from '../pan.js';

import { endpoints } from './binding.js';
import { schedule } from './controls.js';
import { candidate, highlight } from './draft.js';
import { stateRuntime } from './runtime/state.js';
import { C, cache, labelScale } from './state.js';

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(`museboard.connection.${state.boardId}`) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writePreferences(patch) {
  try {
    localStorage.setItem(`museboard.connection.${state.boardId}`, JSON.stringify({ ...readPreferences(), ...patch }));
  } catch {}
}

function savePreferences(item) {
  writePreferences({ style: item.style, type: item.route.type });
}

function change(item, field, value) {
  if (!canMutateItem(item)) return false;
  const before = snapshotItems(),
    next = C.clone(item);
  next[field] = value;
  C.apply(next);
  if (!upsertItem(next, { select: true, historySnapshot: before })) return false;
  if (field === 'style' || (field === 'route' && next.route.type !== item.route.type)) savePreferences(next);
  schedule();
  return true;
}

function batchStyle(key, value) {
  const items = getSelectedIds()
    .map((id) => state.items.get(id))
    .filter((i) => i?.type === 'connector' && canMutateItem(i));
  if (!items.length) return false;
  pushUndoSnapshot();
  for (const item of items) {
    const next = C.clone(item);
    C.apply(next);
    Object.assign(next.style, typeof key === 'object' ? key : { [key]: value });
    C.apply(next);
    state.items.set(next.id, next);
    renderItem(next);
    broadcastUpsert(next);
    savePreferences(next);
  }
  markDirty(true);
  schedule();
  return true;
}

function addLabel(item, forceNew = false) {
  if (!item) return;
  editLabel(item, (!forceNew && item.labels[0]) || { id: makeId('label'), text: '', position: 0.5, offset: 0 });
}

function refreshLabels() {
  const scale = `scale(${labelScale()})`;
  for (const body of document.querySelectorAll('.connector-item .connection-label-body'))
    body.setAttribute('transform', scale);
}

async function editLabel(item, label) {
  if (!canMutateItem(item)) return;
  const value = await openAdaptiveDialog({
    mode: 'prompt',
    title: '连接标签',
    message: '留空可删除标签',
    initialValue: label.text,
    maxLength: 500,
    inputLabel: '标签'
  });
  if (value === null) return;
  const existing = item.labels.some((entry) => entry.id === label.id);
  const replacement = { ...label, text: value.trim().slice(0, 500) };
  const labels = existing
    ? item.labels.flatMap((entry) => (entry.id === label.id ? (value.trim() ? [replacement] : []) : [entry]))
    : [...item.labels, ...(value.trim() ? [replacement] : [])];
  if (change(item, 'labels', labels)) showToast(value.trim() ? '连接标签已保存' : '连接标签已删除');
}

function beginEdit(event, item, kind, id) {
  if (!canMutateItem(item) || state.spacePan || event.button !== 0) return;
  if ((kind === 'segment' || kind === 'point' || kind === 'curve') && item.route.locked) return;
  event.preventDefault();
  event.stopPropagation();
  selectItem(item.id);
  stateRuntime.edit = {
    id: item.id,
    kind,
    key: id,
    pointerId: event.pointerId,
    before: C.clone(item),
    snapshot: snapshotItems(),
    start: getBoardPoint(event),
    changed: false
  };
  els.viewport.classList.add('impact-connector-editing');
  captureViewportPointer(event.pointerId);
}

function moveEdit(event) {
  const item = state.items.get(stateRuntime.edit.id);
  if (!item) return;
  const p = getBoardPoint(event);
  const next = C.clone(stateRuntime.edit.before);
  stateRuntime.edit.changed = true;
  if (stateRuntime.edit.kind === 'source' || stateRuntime.edit.kind === 'target') {
    const c = candidate(event);
    next[stateRuntime.edit.kind] = c.terminal;
    highlight(c);
  } else if (stateRuntime.edit.kind === 'label') {
    const points = cache.get(item.id)?.result.points || [item.source.fallback, item.target.fallback];
    let best = Infinity,
      position = 0;
    for (let i = 0; i <= 100; i++) {
      const q = C.pointAt(points, i / 100),
        d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) {
        best = d;
        position = i / 100;
      }
    }
    const label = next.labels.find((l) => l.id === stateRuntime.edit.key);
    label.position = position;
    label.offset = p.y - C.pointAt(points, position).y;
  } else if (stateRuntime.edit.kind === 'curve') {
    let c = next.route.constraints.find((c2) => c2.kind === 'curve');
    if (!c) {
      const controls = cache.get(item.id)?.result.control;
      c = { id: makeId('constraint'), kind: 'curve', a: controls?.a || p, b: controls?.b || p };
      next.route.constraints.push(c);
    }
    c[stateRuntime.edit.key] = p;
  } else if (stateRuntime.edit.kind === 'point') {
    const c = next.route.constraints.find((c2) => c2.id === stateRuntime.edit.key);
    if (c) c.a = p;
  } else {
    const points = stateRuntime.edit.points,
      a = points[stateRuntime.edit.key],
      b = points[stateRuntime.edit.key + 1],
      horizontal = Math.abs(a.y - b.y) < 0.01;
    next.route.constraints = next.route.constraints.filter((c) => c.id !== stateRuntime.edit.constraintId);
    next.route.constraints.push({
      id: stateRuntime.edit.constraintId,
      kind: 'segment',
      a: horizontal ? { x: a.x, y: p.y } : { x: p.x, y: a.y },
      b: horizontal ? { x: b.x, y: p.y } : { x: p.x, y: b.y }
    });
  }
  C.apply(next);
  state.items.set(next.id, next);
  renderItem(next);
  syncEdgePanForEvent(event);
  schedule();
}

function endEdit(cancelled = false) {
  if (!stateRuntime.edit) return;
  const current = stateRuntime.edit;
  stateRuntime.edit = null;
  els.viewport.classList.remove('impact-connector-editing');
  releaseViewportPointer(current.pointerId);
  highlight(null);
  if (cancelled || !current.changed) {
    state.items.set(current.id, current.before);
    renderItem(current.before);
  } else {
    const next = state.items.get(current.id);
    const e = endpoints(next);
    next.source.fallback = e.start;
    next.target.fallback = e.end;
    upsertItem(next, { select: true, historySnapshot: current.snapshot });
  }
  schedule();
}

export {
  addLabel,
  batchStyle,
  beginEdit,
  change,
  editLabel,
  endEdit,
  moveEdit,
  readPreferences,
  refreshLabels,
  savePreferences,
  writePreferences
};
