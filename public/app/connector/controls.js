import { state } from '../state.js';
import { els } from '../elements.js';
import { makeId } from '../utilities.js';
import { endpoints, inputFor, resolve } from './binding.js';

import { stateRuntime } from './runtime/state.js';
import {
  C,
  R,
  baselines,
  cache,
  mounted,
  oldBounds,
  outlines,
  pathIndex,
  pending,
  smartChoices,
  svg
} from './state.js';

let cancel,
  start,
  beginEdit,
  change,
  readPreferences,
  drawJumps,
  observe,
  showConflictDrafts,
  buildCreationToolbar,
  buildToolbar;

function configureConnectorControls(callbacks) {
  ({
    cancel,
    start,
    beginEdit,
    change,
    readPreferences,
    drawJumps,
    observe,
    showConflictDrafts,
    buildCreationToolbar,
    buildToolbar
  } = callbacks);
}

function handle(p, label, onDown, parent = stateRuntime.overlay) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'connection-handle';
  b.title = label;
  b.setAttribute('aria-label', label);
  Object.assign(b.style, {
    left: `${p.x}px`,
    top: `${p.y}px`,
    transform: `translate(-50%, -50%) scale(${1 / state.zoom})`
  });
  b.addEventListener('pointerdown', onDown);
  parent.append(b);
  return b;
}

function schedule() {
  if (!stateRuntime.scheduled) stateRuntime.scheduled = requestAnimationFrame(drawControls);
}

function drawControls() {
  stateRuntime.scheduled = 0;
  if (!stateRuntime.overlay) return;
  if (stateRuntime.frameBoard !== state.boardId) {
    stateRuntime.frameBoard = state.boardId;
    stateRuntime.routeWarningShown = false;
    cache.clear();
    smartChoices.clear();
    pending.clear();
    pathIndex.clear();
    baselines.clear();
    oldBounds.clear();
    outlines.clear();
    stateRuntime.lineJumps = state.connectorLineJumps === true;
    stateRuntime.jumpsDirty = true;
    const preferences = readPreferences();
    stateRuntime.exactMode = preferences.exactMode === true;
    stateRuntime.continuous = preferences.continuous === true;
    stateRuntime.internalLayer?.replaceChildren();
    cancel();
    stateRuntime.hovered = null;
    for (const item2 of state.items.values()) observe(item2);
    showConflictDrafts();
  }
  if (stateRuntime.lineJumps !== (state.connectorLineJumps === true)) {
    stateRuntime.lineJumps = state.connectorLineJumps === true;
    stateRuntime.jumpsDirty = true;
  }
  if (stateRuntime.jumpsDirty) {
    stateRuntime.jumpsDirty = false;
    drawJumps();
  }
  stateRuntime.overlay.replaceChildren();
  stateRuntime.internalLayer?.querySelectorAll('[data-internal-id]').forEach((n) => {
    if (!state.items.has(n.dataset.internalId) || !mounted(n.dataset.internalId)) n.remove();
  });
  if (state.zoom < 0.25) stateRuntime.sparse = true;
  else if (state.zoom >= 0.3) stateRuntime.sparse = false;
  els.board.classList.toggle('connection-sparse', stateRuntime.sparse);
  const selected = state.items.get(state.selectedId),
    active = ['select', 'pan', 'connector'].includes(state.tool) && !state.editingId && !state.spacePan;
  const selectedConnector = active && selected?.type === 'connector';
  const creationToolbar = active && state.tool === 'connector' && !selectedConnector;
  stateRuntime.toolbar.hidden = !selectedConnector && !creationToolbar;
  if (creationToolbar) buildCreationToolbar();
  if (stateRuntime.draft) {
    const item2 = C.apply({
        connectorVersion: 1,
        source: stateRuntime.draft.source,
        target: stateRuntime.draft.target,
        route: { type: readPreferences().type || 'smart' },
        id: 'preview'
      }),
      e = endpoints(item2),
      r = R.route({ ...inputFor(item2, e, false), obstacles: [] });
    const s = svg('svg', { class: 'connection-preview' });
    s.append(
      svg('path', {
        d: r.path,
        fill: 'none',
        stroke: 'var(--accent)',
        'stroke-width': 2 / state.zoom,
        'stroke-dasharray': `${6 / state.zoom} ${4 / state.zoom}`
      })
    );
    stateRuntime.overlay.append(s);
    return;
  }
  if (!active) return;
  if (selected?.type === 'connector') {
    C.apply(selected);
    const e = endpoints(selected),
      r = cache.get(selected.id)?.result;
    if (e.hidden) return;
    const s = svg('svg', { class: 'connection-preview' });
    if (r)
      s.append(svg('path', { d: r.path, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5 / state.zoom }));
    stateRuntime.overlay.append(s);
    for (const [k, p] of [
      ['source', e.start],
      ['target', e.end]
    ]) {
      const b = handle(p, `${k === 'source' ? '起点' : '终点'}：拖动重新关联`, (ev) => beginEdit(ev, selected, k));
      b.onkeydown = (event) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] },
          direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        const t = C.clone(selected[k]),
          step = (event.shiftKey ? 10 : 1) / state.zoom;
        if (t.binding) {
          const resolved = resolve(t, p);
          if (!resolved.rect || t.binding.content?.kind === 'text-range') return;
          const local = C.rotate(p, resolved.rect, true);
          t.anchor = {
            ...t.anchor,
            mode: 'exact',
            u: Math.max(0, Math.min(1, (local.x + direction[0] * step - resolved.rect.x) / resolved.rect.w)),
            v: Math.max(0, Math.min(1, (local.y + direction[1] * step - resolved.rect.y) / resolved.rect.h))
          };
        } else t.fallback = { x: p.x + direction[0] * step, y: p.y + direction[1] * step };
        change(selected, k, t);
      };
    }
    if (!selected.route.locked && r && selected.route.type !== 'smart') {
      if (selected.route.type === 'curve')
        for (const k of ['a', 'b']) handle(r.control[k], '调整曲线', (ev) => beginEdit(ev, selected, 'curve', k));
      else if (selected.route.type === 'orthogonal')
        r.points.slice(1).forEach((p, i) => {
          const a = r.points[i];
          if (Math.hypot(p.x - a.x, p.y - a.y) < 24 / state.zoom) return;
          const middle = { x: (p.x + a.x) / 2, y: (p.y + a.y) / 2 };
          const b = handle(middle, '拖动线段；双击添加经过点', (ev) => {
            beginEdit(ev, selected, 'segment', i);
            if (stateRuntime.edit) {
              stateRuntime.edit.points = C.clone(r.points);
              stateRuntime.edit.constraintId =
                selected.route.constraints.find(
                  (c) => c.kind === 'segment' && C.distanceToSegment(middle, c.a, c.b) < 1
                )?.id || makeId('constraint');
            }
          });
          b.ondblclick = () =>
            change(selected, 'route', {
              ...selected.route,
              constraints: [
                ...selected.route.constraints,
                { id: makeId('constraint'), kind: 'point', a: middle, b: middle }
              ]
            });
        });
      for (const c of selected.route.constraints.filter((c2) => c2.kind === 'point')) {
        const b = handle(c.a, '拖动经过点；双击移除', (ev) => beginEdit(ev, selected, 'point', c.id));
        b.ondblclick = () =>
          change(selected, 'route', {
            ...selected.route,
            constraints: selected.route.constraints.filter((v) => v.id !== c.id)
          });
      }
    }
    buildToolbar(selected);
    return;
  }
  if (state.tool !== 'connector') return;
  if (
    stateRuntime.hovered &&
    ((stateRuntime.hovered.item && !state.items.has(stateRuntime.hovered.item.id)) ||
      (stateRuntime.hovered.section && !state.sections.has(stateRuntime.hovered.section.id)))
  )
    stateRuntime.hovered = null;
  const item = stateRuntime.hovered?.item && state.items.get(stateRuntime.hovered.item.id),
    section = stateRuntime.hovered?.section && state.sections.get(stateRuntime.hovered.section.id);
  if (!item && !section) return;
  if (item?.type === 'connector') return;
  const rect = stateRuntime.hovered?.rect || item || section,
    binding = stateRuntime.hovered?.binding || { kind: section ? 'section' : 'item', id: (section || item).id };
  for (const [side, u, v] of [
    ['top', 0.5, 0],
    ['right', 1, 0.5],
    ['bottom', 0.5, 1],
    ['left', 0, 0.5]
  ]) {
    const p = C.anchor(rect, { x: rect.x, y: rect.y }, { mode: 'edge', side, u, v });
    handle(p, '拖动创建连接', (ev) => {
      ev.stopPropagation();
      start(ev, C.terminal({ binding, anchor: { mode: 'edge', side, u, v }, fallback: p }), true);
    });
  }
}
export { handle, schedule, drawControls };

export { configureConnectorControls };
