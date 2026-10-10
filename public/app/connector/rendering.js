import { cssEscape } from '../utilities.js';
import { state } from '../state.js';
import { updateSelectionUI, selectItem } from '../selection.js';
import { canMutateItem } from '../layers-model.js';

import { endpoints } from './binding.js';
import { schedule } from './controls.js';
import { addLabel, beginEdit, editLabel } from './editing.js';
import { geometry } from './routing.js';
import { stateRuntime } from './runtime/state.js';
import { C, cache, labelDisplay, labelScale, labelWidth, mounted, pathIndex, svg, world } from './state.js';

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

function render(item) {
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
  Object.assign(item, bounds, { rotation: 0 });
  pathIndex.upsert(item.id, bounds);
  const root = svg('svg', {
    viewBox: `${bounds.x} ${bounds.y} ${bounds.w || 1} ${bounds.h || 1}`,
    'data-connector-version': 1
  });
  root.classList.add('connection-svg');
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
  root.append(path);
  window.ConnectorImpact?.decorateConnector(root, item, result);
  if (stateRuntime.internalLayer) {
    stateRuntime.internalLayer.querySelector(`[data-internal-id="${cssEscape(item.id)}"]`)?.remove();
    if (!ends.hidden && (ends.source.internal || ends.target.internal)) {
      const inner = svg('g', { 'data-internal-id': item.id }),
        localDefs = svg('defs'),
        clip = svg('clipPath', { id: `ci-${item.id}` }),
        mask = svg('mask', {
          id: `cm-${item.id}`,
          maskUnits: 'userSpaceOnUse',
          x: bounds.x,
          y: bounds.y,
          width: bounds.w,
          height: bounds.h
        });
      mask.append(svg('rect', { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, fill: 'white' }));
      for (const endpoint of [ends.source, ends.target].filter((e) => e.internal)) {
        const r = endpoint.owner;
        clip.append(
          svg('rect', {
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
            transform: `rotate(${r.rotation || 0} ${r.x + r.w / 2} ${r.y + r.h / 2})`
          })
        );
        const node = mounted(r.id);
        for (const content of node?.querySelectorAll('.text-list-content,.mind-node-text,td,th') || []) {
          const range = document.createRange();
          range.selectNodeContents(content);
          for (const glyphRect of range.getClientRects()) {
            if (!glyphRect.width) continue;
            const box = C.bounds([world(glyphRect.left, glyphRect.top), world(glyphRect.right, glyphRect.bottom)]);
            mask.append(
              svg('rect', { x: box.x - 2, y: box.y - 2, width: box.w + 4, height: box.h + 4, fill: 'black' })
            );
          }
        }
      }
      marker(localDefs, `ics-${item.id}`, item.style.start, item.style.color);
      marker(localDefs, `ice-${item.id}`, item.style.end, item.style.color);
      localDefs.append(clip, mask);
      inner.append(localDefs);
      const line = path.cloneNode(true);
      if (item.style.start !== 'none') line.setAttribute('marker-start', `url(#ics-${item.id})`);
      if (item.style.end !== 'none') line.setAttribute('marker-end', `url(#ice-${item.id})`);
      line.setAttribute('clip-path', `url(#ci-${item.id})`);
      line.setAttribute('mask', `url(#cm-${item.id})`);
      inner.append(line);
      stateRuntime.internalLayer.append(inner);
    }
  }
  const hit = svg('path', {
    d: result.path,
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': 12 / state.zoom,
    class: 'connection-hit'
  });
  hit.addEventListener('pointerdown', (e) => {
    if (!['select', 'pan', 'connector'].includes(state.tool) || state.editingId || state.spacePan) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) {
      if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
      else state.selectedIds.add(item.id);
      state.selectedId = state.selectedIds.has(item.id) ? item.id : [...state.selectedIds].at(-1) || null;
      updateSelectionUI();
    } else selectItem(item.id);
    schedule();
  });
  hit.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (canMutateItem(item)) addLabel(item, true);
  });
  root.append(hit);
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
    group.addEventListener('pointerdown', (e) => beginEdit(e, item, 'label', label.id));
    group.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      editLabel(item, label);
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
  schedule();
  return root;
}

function drawJumps() {
  document.querySelectorAll('.connection-jumps').forEach((n) => n.remove());
  document.querySelectorAll('.connection-line[mask]').forEach((n) => n.removeAttribute('mask'));
  if (!stateRuntime.lineJumps) return;
  const ids = [...cache.keys()].sort();
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
    const nearby = new Set(pathIndex.search(bounds).map((v) => (typeof v === 'string' ? v : v.id)));
    for (let j = i + 1; j < ids.length; j++) {
      if (
        !nearby.has(ids[j]) ||
        !mounted(ids[j]) ||
        cache.get(ids[i])?.effectiveType === 'curve' ||
        cache.get(ids[j])?.effectiveType === 'curve'
      )
        continue;
      const b = cache.get(ids[j]).result.points;
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
