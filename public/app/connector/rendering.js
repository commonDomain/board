import { state } from '../state.js';
import { updateSelectionUI, selectItem } from '../selection.js';
import { canMutateItem } from '../layers-model.js';
import { canStartItemGesture } from '../pan-model.js';
import { invalidateMarqueeSelection } from '../runtime/spatial-index.js';

import { endpoints } from './binding.js';
import { schedule } from './controls.js';
import { addLabel, beginEdit, editLabel } from './editing.js';
import { geometry } from './routing.js';
import { stateRuntime } from './runtime/state.js';
import { C, cache, labelDisplay, labelScale, labelWidth, mounted, pathIndex, svg } from './state.js';
import { clipExternalConnection, renderInternalConnection } from './internal-layer.js';

const structures = new WeakMap();

function marker(defs, id, type, color) {
  if (type === 'none') return;
  const m = svg('marker', {
    id,
    viewBox: '0 0 12 12',
    refX: 10,
    refY: 6,
    markerWidth: 8,
    markerHeight: 8,
    markerUnits: 'userSpaceOnUse',
    orient: 'auto-start-reverse'
  });
  let shape;
  if (type === 'dot') shape = svg('circle', { cx: 6, cy: 6, r: 4 });
  else if (type === 'square') shape = svg('rect', { x: 2, y: 2, width: 8, height: 8 });
  else
    shape = svg('path', {
      d:
        type === 'diamond'
          ? 'M 1 6 L 6 1 L 11 6 L 6 11 Z'
          : type === 'open'
            ? 'M 2 1 L 10 6 L 2 11'
            : 'M 1 1 L 11 6 L 1 11 Z'
    });
  shape.setAttribute('fill', type === 'open' ? 'none' : color);
  shape.setAttribute('stroke', color);
  shape.setAttribute('stroke-width', '1.5');
  m.append(shape);
  defs.append(m);
}

function render(item, previousRoot = null) {
  const ends = endpoints(item),
    result = geometry(item, ends),
    labelBounds = item.labels.flatMap((label) => {
      const p = C.pointAt(result.points, label.position),
        width = labelWidth(label),
        scale = labelScale();
      return [
        { x: p.x - (width * scale) / 2, y: p.y + label.offset - 44 * scale },
        { x: p.x + (width * scale) / 2, y: p.y + label.offset + 2 * scale }
      ];
    }),
    bounds = C.bounds([...result.points, ...labelBounds], 32);
  const entry = cache.get(item.id);
  if (entry) entry.ends = ends;
  Object.assign(item, bounds, { rotation: 0 });
  pathIndex.upsert(item.id, bounds);
  const structureKey = JSON.stringify([item.style, item.labels, item.dasharray, result.conflict, result.failure,
    ends.source.status, ends.target.status, item.labels.length ? labelScale() : 0]);
  const previous = previousRoot && structures.get(previousRoot);
  if (previous?.key === structureKey) {
    previousRoot.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w || 1} ${bounds.h || 1}`);
    previousRoot.style.visibility = ends.hidden ? 'hidden' : '';
    previous.path.setAttribute('d', result.path);
    previous.hit.setAttribute('d', result.path);
    previous.hit.setAttribute('stroke-width', 12 / state.zoom);
    if (previous.warning) {
      const p = result.conflict ? C.pointAt(result.points, 0.5) : ends.source.status === 'orphan' ? ends.start : ends.end;
      previous.warning.setAttribute('x', p.x + 8); previous.warning.setAttribute('y', p.y - 8);
    }
    item.labels.forEach((label, index) => {
      const p = C.pointAt(result.points, label.position);
      previous.labels[index].setAttribute('transform', `translate(${p.x} ${p.y + label.offset})`);
    });
    window.MusePlanning?.decorateTaskLine(previousRoot, item);
    previousRoot.querySelectorAll('.impact-line-halo,.impact-line-core,.impact-line-flow,.impact-travel-arrow').forEach(node => node.remove());
    previousRoot.classList.remove('impact-edge');
    window.ConnectorImpact?.decorateConnector(previousRoot, item, result);
    clipExternalConnection(previousRoot, previous.group, item, ends, bounds);
    renderInternalConnection(item, ends, previous.path, previousRoot);
    if (stateRuntime.lineJumps) stateRuntime.jumpsDirty = true;
    schedule();
    return previousRoot;
  }
  const root = svg('svg', {
    viewBox: `${bounds.x} ${bounds.y} ${bounds.w || 1} ${bounds.h || 1}`,
    'data-connector-version': 1
  });
  root.classList.add('connection-svg');
  window.MusePlanning?.decorateTaskLine(root,item);
  root.style.visibility = ends.hidden ? 'hidden' : '';
  const defs = svg('defs');
  root.append(defs);
  marker(defs, `cs-${item.id}`, item.style.start, item.style.color);
  marker(defs, `ce-${item.id}`, item.style.end, item.style.color);
  const path = svg('path', {
    d: result.path,
    fill: 'none',
    stroke: item.style.color,
    'stroke-width': item.style.width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'connection-line'
  });
  if (item.style.start !== 'none') path.setAttribute('marker-start', `url(#cs-${item.id})`);
  if (item.style.end !== 'none') path.setAttribute('marker-end', `url(#ce-${item.id})`);
  if (item.dasharray) path.setAttribute('stroke-dasharray', item.dasharray);
  const routeGroup = svg('g', { class: 'connection-route' });
  routeGroup.append(path); root.append(routeGroup);
  window.ConnectorImpact?.decorateConnector(root, item, result);
  renderInternalConnection(item, ends, path, root);
  const hit = svg('path', {
    d: result.path,
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': 12 / state.zoom,
    class: 'connection-hit'
  });
  hit.addEventListener('pointerdown', (e) => {
    item = state.items.get(item.id) || item;
    if (!canStartItemGesture(e, ['select', 'pan', 'connector']) || !canMutateItem(item)) return;
    if (!['select', 'pan', 'connector'].includes(state.tool) || state.editingId || state.spacePan) return;
    e.stopPropagation();
    e.preventDefault();
    invalidateMarqueeSelection();
    if (e.shiftKey) {
      if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
      else state.selectedIds.add(item.id);
      state.selectedId = state.selectedIds.has(item.id) ? item.id : [...state.selectedIds].at(-1) || null;
      updateSelectionUI();
    } else selectItem(item.id);
    schedule();
  });
  hit.addEventListener('dblclick', (e) => {
    item = state.items.get(item.id) || item;
    e.stopPropagation();
    if (canMutateItem(item)) addLabel(item, true);
  });
  routeGroup.append(hit);
  clipExternalConnection(root, routeGroup, item, ends, bounds);
  for (const label of item.labels) {
    const p = C.pointAt(result.points, label.position),
      group = svg('g', { class: 'connection-label', transform: `translate(${p.x} ${p.y + label.offset})` });
    const width = labelWidth(label),
      body = svg('g', { class: 'connection-label-body', transform: `scale(${labelScale()})` });
    body.append(svg('rect', { x: -width / 2, y: -43, width, height: 34, rx: 16 }));
    body.append(svg('path', { d: 'M -8 -11 Q 0 1 8 -11 Z', class: 'connection-label-tail' }));
    body.append(svg('circle', { cx: -width / 2 + 17, cy: -26, r: 4, class: 'connection-label-spark' }));
    const labelText = svg('text', { x: 7, y: -26, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    labelText.textContent = labelDisplay(label);
    body.append(labelText);
    group.append(body);
    const title = svg('title');
    title.textContent = label.text;
    group.append(title);
    group.addEventListener('pointerdown', (e) => beginEdit(e, state.items.get(item.id) || item, 'label', label.id));
    group.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const current = state.items.get(item.id) || item;
      editLabel(current, current.labels.find(value => value.id === label.id) || label);
    });
    root.append(group);
  }
  if (result.conflict || [ends.source.status, ends.target.status].includes('orphan')) {
    const p = result.conflict ? C.pointAt(result.points, 0.5) : ends.source.status === 'orphan' ? ends.start : ends.end;
    const mark = svg('text', { x: p.x + 8, y: p.y - 8, class: 'connection-warning' });
    mark.textContent = '⚠';
    const title = svg('title');
    title.textContent = [
      result.failure || (result.conflict ? '路径受阻：可调整局部约束或恢复自动路径' : null),
      [ends.source.status, ends.target.status].includes('orphan') ? '原内容已变化，请重新关联' : null
    ]
      .filter(Boolean)
      .join('；');
    mark.append(title);
    root.append(mark);
  }
  if (stateRuntime.lineJumps) stateRuntime.jumpsDirty = true;
  structures.set(root, { key: structureKey, path, hit, group: routeGroup, labels: [...root.querySelectorAll('.connection-label')], warning: root.querySelector('.connection-warning') });
  schedule();
  return root;
}

function drawJumps() {
  document.querySelectorAll('.connection-jumps').forEach((n) => n.remove());
  document.querySelectorAll('.connection-line[mask]').forEach((n) => n.removeAttribute('mask'));
  if (!stateRuntime.lineJumps) return;
  const ids = [...cache.keys()].filter(id => state.items.has(id) && mounted(id) && cache.get(id)?.effectiveType !== 'curve').sort();
  const ranks = new Map(ids.map((id, index) => [id, index]));
  for (let i = 0; i < ids.length; i++) {
    const node = mounted(ids[i])?.querySelector('svg');
    if (!node) continue;
    const a = cache.get(ids[i]).result.points,
      g = svg('g', { class: 'connection-jumps', 'pointer-events': 'none' });
    const bounds = C.bounds(a, 32),
      mask = svg('mask', {
        id: `jump-${ids[i]}`,
        class: 'connection-jumps',
        maskUnits: 'userSpaceOnUse',
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h
      });
    mask.append(svg('rect', { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, fill: 'white' }));
    const nearby = pathIndex.search(bounds).map(v => typeof v === 'string' ? v : v.id).filter(id => ranks.get(id) > i).sort();
    for (const peerId of nearby) {
      const b = cache.get(peerId).result.points;
      for (let k = 1; k < a.length; k++)
        for (let m = 1; m < b.length; m++) {
          const p = a[k - 1],
            q = a[k],
            u = b[m - 1],
            v = b[m];
          if (p.y !== q.y || u.x !== v.x) continue;
          const x = u.x,
            y = p.y;
          if (
            x <= Math.min(p.x, q.x) + 8 ||
            x >= Math.max(p.x, q.x) - 8 ||
            y <= Math.min(u.y, v.y) + 8 ||
            y >= Math.max(u.y, v.y) - 8
          )
            continue;
          mask.append(svg('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: 'black' }));
          g.append(
            svg('path', {
              d: `M ${x - 5} ${y} Q ${x} ${y - 9} ${x + 5} ${y}`,
              fill: 'none',
              stroke: state.items.get(ids[i])?.style?.color || '#475569',
              'stroke-width': 2
            })
          );
        }
    }
    if (g.childNodes.length) {
      node.querySelector('defs').append(mask);
      node.querySelector('.connection-line').setAttribute('mask', `url(#jump-${ids[i]})`);
    }
    node.append(g);
  }
}

export { drawJumps, marker, render };
