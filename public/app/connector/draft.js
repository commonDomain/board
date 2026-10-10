import { getBoardPoint } from '../camera.js';
import { state } from '../state.js';
import {isItemVisible} from '../layer-visibility.js';
import { getWritableLayer, explainUnwritableLayer, canMutateItem } from '../layers-model.js';
import { queryItemsInRect } from '../spatial-index-model.js';
import { showToast } from '../interface-model.js';
import { finishEditing } from '../editing.js';
import { captureViewportPointer, syncEdgePanForEvent, stopEdgePan, releaseViewportPointer } from '../pan.js';
import { untrackPointer } from '../pan-model.js';
import { restoreNavigationTool } from '../toolbar.js';
import { makeId } from '../utilities.js';
import { nextZ } from '../canvas-state.js';
import { upsertItem } from '../items.js';

import { boardRect, endpoints } from './binding.js';
import { schedule } from './controls.js';

import { stateRuntime } from './runtime/state.js';
import { C } from './state.js';

let showCreate,
  change,
  readPreferences;

function configureConnectorDraft(callbacks) {
  ({
    showCreate,
    change,
    readPreferences
  } = callbacks);
}

function candidate(event) {
  const p = getBoardPoint(event),
    elements = document.elementsFromPoint(event.clientX, event.clientY);
  for (const element of elements) {
    if (element.closest('.connection-controls, .connection-toolbar, .connector-item')) continue;
    const container = element.closest('.board-item');
    if (container) {
      const item = state.items.get(container.dataset.itemId);
      if (!item || item.type === 'connector' || !isItemVisible(item)) continue;
      const t = C.terminal({ binding: { kind: 'item', id: item.id }, fallback: p });
      const node = element.closest('[data-mn-id]'),
        cell = element.closest('[data-row][data-column]'), task = element.closest('.planning-component [data-task-id]');
      let rect = item,
        label = item.type === 'note' ? '便签' : '对象';
      if (node) {
        t.binding.content = { kind: 'mind-node', nodeId: node.dataset.mnId };
        rect = boardRect(node);
        label = '脑图节点';
      } else if (task && item.type === 'planning') {
        t.binding.content = { kind: 'plan-task', planId: item.planRef, taskId: task.dataset.taskId }; rect = boardRect(task); label = '规划任务';
      } else if (cell) {
        C.ensureTableIds(item);
        t.binding.content = {
          kind: 'table-cell',
          rowId: item.rowIds[Number(cell.dataset.row)],
          columnId: item.columnIds[Number(cell.dataset.column)]
        };
        rect = boardRect(cell);
        label = '单元格';
      }
      if (stateRuntime.exactMode) {
        const local = C.rotate(p, rect, true);
        t.anchor = {
          mode: 'exact',
          side: 'right',
          u: Math.max(0, Math.min(1, (local.x - rect.x) / rect.w)),
          v: Math.max(0, Math.min(1, (local.y - rect.y) / rect.h))
        };
        label += ' · 精确位置';
      }
      return { terminal: t, rect, label };
    }
    const frame = element.closest('[data-section-id]');
    if (frame && (element.closest('.section-header, .section-title') || !container)) {
      const section = state.sections.get(frame.dataset.sectionId);
      if (!section || section.hidden) continue;
      const r = section,
        local = getBoardPoint(event),
        margin = 14 / state.zoom;
      if (local.x > r.x + margin && local.x < r.x + r.w - margin && local.y > r.y + 44 && local.y < r.y + r.h - margin)
        continue;
      return {
        terminal: C.terminal({ binding: { kind: 'section', id: section.id }, fallback: p }),
        rect: section,
        label: '画框'
      };
    }
  }
  if (!stateRuntime.exactMode) {
    const radius = 12 / state.zoom;
    let nearest = null;
    for (const item of queryItemsInRect({ x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 })) {
      if (item.type === 'connector' || !isItemVisible(item)) continue;
      const local = C.rotate(p, item, true),
        x = Math.max(item.x, Math.min(item.x + item.w, local.x)),
        y = Math.max(item.y, Math.min(item.y + item.h, local.y));
      const distance = Math.hypot(local.x - x, local.y - y);
      if (distance > 0 && distance <= radius && (!nearest || distance < nearest.distance)) nearest = { item, distance };
    }
    if (nearest)
      return {
        terminal: C.terminal({ binding: { kind: 'item', id: nearest.item.id }, fallback: p }),
        rect: nearest.item,
        label: '对象 · 吸附'
      };
  }
  return { terminal: C.terminal({ fallback: p }), label: '自由端点' };
}

function highlight(c) {
  stateRuntime.overlay?.querySelector('.connection-target')?.remove();
  if (c?.rect && stateRuntime.overlay) {
    const d = document.createElement('div');
    d.className = 'connection-target';
    Object.assign(d.style, {
      left: `${c.rect.x}px`,
      top: `${c.rect.y}px`,
      width: `${c.rect.w}px`,
      height: `${c.rect.h}px`
    });
    stateRuntime.overlay.append(d);
  }
  stateRuntime.targetBadge.hidden = !c || !stateRuntime.lastPointer;
  if (!stateRuntime.targetBadge.hidden) {
    stateRuntime.targetBadge.textContent = c.label;
    stateRuntime.targetBadge.style.left = `${Math.min(innerWidth - 180, stateRuntime.lastPointer.clientX + 18)}px`;
    stateRuntime.targetBadge.style.top = `${stateRuntime.lastPointer.clientY + 18}px`;
  }
}

function start(event, terminal = null, drag = false) {
  if (state.tool !== 'connector') return;
  if (!getWritableLayer()) {
    showToast(explainUnwritableLayer());
    return;
  }
  if (state.editingId) finishEditing();
  event.preventDefault();
  cancel();
  const c = terminal ? { terminal } : candidate(event);
  stateRuntime.draft = {
    source: C.clone(c.terminal),
    target: C.terminal({ fallback: getBoardPoint(event) }),
    pointerId: event.pointerId,
    dragging: drag,
    down: { x: event.clientX, y: event.clientY },
    layerId: state.activeLayerId
  };
  state.connectorDraft = stateRuntime.draft;
  if (drag) captureViewportPointer(event.pointerId);
  schedule();
}

function preview(event) {
  if (!stateRuntime.draft || stateRuntime.targetTextMode || state.spacePan) return;
  const c = candidate(event);
  stateRuntime.draft.target = c.terminal;
  if (!c.terminal.binding && event.shiftKey) {
    const p = stateRuntime.draft.source.fallback,
      q = c.terminal.fallback,
      length = Math.hypot(q.x - p.x, q.y - p.y),
      angle = (Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) * Math.PI) / 4;
    stateRuntime.draft.target.fallback = { x: p.x + Math.cos(angle) * length, y: p.y + Math.sin(angle) * length };
  }
  highlight(c);
  syncEdgePanForEvent(event);
  schedule();
}

function finish(event, terminal = null) {
  if (!stateRuntime.draft || (stateRuntime.targetTextMode && !terminal)) return;
  const end = terminal || candidate(event).terminal,
    source = stateRuntime.draft.source,
    layerId = stateRuntime.draft.layerId;
  if (stateRuntime.textRebind) {
    const { id, key } = stateRuntime.textRebind,
      current = state.items.get(id);
    cancel();
    if (current && canMutateItem(current)) change(current, key, end);
    restoreNavigationTool();
    return;
  }
  const preferences = readPreferences();
  if (event) untrackPointer(event);
  cancel();
  const item = C.apply({
    id: makeId('connector'),
    type: 'connector',
    connectorVersion: 1,
    source,
    target: end,
    layerId,
    sectionId: null,
    groupId: null,
    x: source.fallback.x,
    y: source.fallback.y,
    w: 1,
    h: 1,
    z: nextZ(),
    route: { type: preferences.type || 'smart', constraints: [] },
    style: preferences.style,
    labels: []
  });
  const e = endpoints(item);
  item.source.fallback = e.start;
  item.target.fallback = e.end;
  if (upsertItem(item, { select: true })) {
    if (!end.binding) showCreate(item);
    if (!stateRuntime.continuous) restoreNavigationTool();
    schedule();
  }
}

function cancel() {
  if (state.edgePan?.kind === 'connector') stopEdgePan();
  if (stateRuntime.draft?.pointerId != null) releaseViewportPointer(stateRuntime.draft.pointerId);
  stateRuntime.draft = null;
  state.connectorDraft = null;
  stateRuntime.targetTextMode = false;
  stateRuntime.textRebind = null;
  stateRuntime.selectedText = null;
  if (stateRuntime.targetBadge) stateRuntime.targetBadge.hidden = true;
  if (stateRuntime.selectionBar) stateRuntime.selectionBar.hidden = true;
  stateRuntime.overlay?.querySelectorAll('.connection-target,.connection-preview').forEach((n) => n.remove());
  schedule();
}

export { cancel, candidate, finish, highlight, preview, start };

export { configureConnectorDraft };
