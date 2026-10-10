import { cssEscape } from '../utilities.js';
import { state } from '../state.js';
import { getLayer } from '../layers-model.js';
import {isItemVisible} from '../layer-visibility.js';

import { layoutMindTree } from '../mindmap-model.js';
import { getTableColumnWidths, getTableRowHeights } from '../table-rendering-model.js';
import { queryItemsInRect } from '../spatial-index-model.js';

import { C, R, aabb, mounted, outlines, smartChoices, world } from './state.js';

function boardRect(element) {
  const r = element.getBoundingClientRect();
  return C.bounds([world(r.left, r.top), world(r.right, r.top), world(r.right, r.bottom), world(r.left, r.bottom)]);
}

function rootFor(item, locator = {}) {
  const node = mounted(item.id);
  if (!node) return null;
  if (locator.nodeId) return node.querySelector(`[data-mn-id="${cssEscape(locator.nodeId)}"] .mind-node-text`);
  if (locator.rowId) {
    C.ensureTableIds(item);
    return node.querySelector(
      `[data-row="${item.rowIds.indexOf(locator.rowId)}"][data-column="${item.columnIds.indexOf(locator.columnId)}"]`
    );
  }
  return node.querySelector('.text-card, .note-card');
}

function textMap(root) {
  const entries = [];
  let value = '';
  function walk(node) {
    if (node.nodeType === 3) {
      entries.push({ node, start: value.length, length: node.data.length });
      value += node.data;
      return;
    }
    if (
      node.nodeType !== 1 ||
      (node !== root && node.getAttribute('contenteditable') === 'false') ||
      node.matches('button, .text-list-marker')
    )
      return;
    if (node.tagName === 'BR') {
      value += '\n';
      return;
    }
    const block = node !== root && ['DIV', 'P', 'LI'].includes(node.tagName);
    if (block && value && !value.endsWith('\n')) value += '\n';
    for (const child of node.childNodes) walk(child);
    if (block && node.nextSibling && !value.endsWith('\n')) value += '\n';
  }
  walk(root);
  return { entries, value };
}

function rangeRects(item, locator) {
  const root = rootFor(item, locator);
  if (!root) return [];
  const map = textMap(root),
    actual = C.contentText(item, locator);
  if (C.text(map.value) !== C.text(actual)) return [];
  const from = C.chars(map.value).slice(0, locator.start).join('').length,
    to = C.chars(map.value).slice(0, locator.end).join('').length;
  const a = map.entries.find((e) => from >= e.start && from < e.start + e.length),
    b = [...map.entries].reverse().find((e) => to > e.start && to <= e.start + e.length);
  if (!a || !b) return [];
  const range = document.createRange();
  range.setStart(a.node, from - a.start);
  range.setEnd(b.node, to - b.start);
  return Array.from(range.getClientRects())
    .filter((r) => r.width && r.height)
    .map((r) =>
      C.bounds([world(r.left, r.top), world(r.right, r.top), world(r.right, r.bottom), world(r.left, r.bottom)])
    );
}

function resolve(t, toward) {
  if (!t.binding) return { point: t.fallback, status: 'normal' };
  const owner = t.binding.kind === 'section' ? state.sections.get(t.binding.id) : state.items.get(t.binding.id);
  if (!owner) return { point: t.fallback, status: 'orphan' };
  
  const layer = owner.layerId && getLayer(owner.layerId);
  if (owner.hidden || (layer && (!layer.visible || layer.opacity <= 0))) return { point: t.fallback, status: 'hidden' };
  for (
    let group = state.groups.get(owner.groupId), visited = new Set();
    group && !visited.has(group.id);
    group = state.groups.get(group.parentGroupId)
  ) {
    if (group.hidden) return { point: t.fallback, status: 'hidden' };
    visited.add(group.id);
  }
  const section = t.binding.kind === 'section' ? owner : state.sections.get(owner.sectionId);
  if (section?.hidden) return { point: t.fallback, status: 'hidden' };
  let rect = owner,
    proxy = null,
    status = t.status;
  if (section?.collapsed && !state.exporting) {
    rect = { ...section, h: 44, rotation: 0 };
    proxy = `section:${section.id}`;
  }
  const c = t.binding.content;
  if (!proxy && c?.kind === 'plan-task') {
    const task = owner.type === 'planning' && owner.planRef === c.planId && window.MusePlanning?.getTask({ planId: c.planId, taskId: c.taskId });
    if (!task || task.deleted || task.archived) status = 'orphan';
    else {
      const component = mounted(owner.id)?.querySelector('.planning-component'), row = [...(component?.querySelectorAll('[data-task-id]') || [])].find(element => element.dataset.taskId === c.taskId);
      if (row) {
        rect = boardRect(row);
        const clip = row.closest('.planning-body, .planning-link-dock');
        if (clip) { const bounds = boardRect(clip), top = Math.max(rect.y, bounds.y), bottom = Math.min(rect.y + rect.h, bounds.y + bounds.h); rect = { ...rect, y: Math.min(Math.max(top, bounds.y + 4), bounds.y + bounds.h - 8), h: Math.max(8, bottom - top) }; }
      } else { const heading = component?.querySelector('.planning-component-heading'); if (heading) rect = boardRect(heading); proxy = `task:${owner.id}:${c.taskId}`; }
    }
  }
  if (!proxy && c?.nodeId) {
    const found = C.findNode(owner.tree, c.nodeId);
    if (!found) status = 'orphan';
    else {
      const ancestor = found.parents.find((n2) => n2.collapsed),
        id = ancestor?.id || c.nodeId;
      const layout = layoutMindTree(owner.tree, owner.w || 360, owner.h || 220, owner.branchStyle),
        n = layout.nodes.find((n2) => n2.id === id);
      if (n) {
        const center = C.rotate({ x: owner.x + n.x + n.w / 2, y: owner.y + n.y + n.h / 2 }, owner);
        rect = { x: center.x - n.w / 2, y: center.y - n.h / 2, w: n.w, h: n.h, rotation: owner.rotation || 0 };
      }
      if (ancestor) proxy = `node:${owner.id}:${id}`;
    }
  }
  if (!proxy && c?.rowId) {
    C.ensureTableIds(owner);
    const r = owner.rowIds.indexOf(c.rowId),
      col = owner.columnIds.indexOf(c.columnId);
    const el = mounted(owner.id)?.querySelector(`[data-row="${r}"][data-column="${col}"]`);
    if (r < 0 || col < 0) status = 'orphan';
    else if (el) rect = boardRect(el);
    else {
      const widths = getTableColumnWidths(owner, owner.columnIds.length),
        heights = getTableRowHeights(owner, owner.rowIds.length);
      rect = {
        x: owner.x + widths.slice(0, col).reduce((a, b) => a + b, 0),
        y: owner.y + heights.slice(0, r).reduce((a, b) => a + b, 0),
        w: widths[col],
        h: heights[r]
      };
    }
  }
  let internal = Boolean(
    !proxy && status !== 'orphan' && (c?.rowId || c?.nodeId || c?.kind === 'plan-task' || (owner.type === 'image' && t.anchor.mode === 'exact'))
  );
  if (!proxy && status !== 'orphan' && c?.kind === 'text-range') {
    const content = C.contentText(owner, c);
    if (content == null || C.chars(content).slice(c.start, c.end).join('') !== c.quote) status = 'orphan';
    else {
      const rects = rangeRects(owner, c);
      if (rects.length) {
        rect = rects.sort(
          (a, b) => Math.hypot(a.x - toward.x, a.y - toward.y) - Math.hypot(b.x - toward.x, b.y - toward.y)
        )[0];
        internal = true;
      } else return { point: t.fallback, status: 'normal', owner };
    }
  }
  if (status === 'orphan') rect = owner;
  let p = C.anchor(
    rect,
    toward,
    status === 'orphan' || (internal && c?.kind === 'text-range') || proxy ? { mode: 'auto' } : t.anchor
  );
  if (owner.type === 'shape' && rect === owner && t.anchor.mode === 'auto' && status !== 'orphan') {
    const key = JSON.stringify([owner.shape, owner.w, owner.h, owner.strokeWidth, owner.flipX, owner.flipY]);
    let cached = outlines.get(owner.id);
    const geometry2 = mounted(owner.id)?.querySelector('svg path,svg polygon,svg rect,svg ellipse,svg line');
    if (geometry2?.getTotalLength && cached?.key !== key) {
      try {
        const length = geometry2.getTotalLength();
        cached = {
          key,
          points: Array.from({ length: 129 }, (_, i) => {
            const v = geometry2.getPointAtLength((length * i) / 128);
            return { x: v.x, y: v.y };
          })
        };
        outlines.set(owner.id, cached);
      } catch {}
    }
    if (cached?.points) p = C.outlineAnchor(owner, toward, cached.points);
  }
  if (internal && c?.kind === 'text-range') {
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const dx = p.x - center.x,
      dy = p.y - center.y,
      length = Math.hypot(dx, dy) || 1;
    p.x += (dx / length) * 4;
    p.y += (dy / length) * 4;
  }
  return { point: p, status: proxy ? 'proxy' : status, proxy, owner, rect, internal };
}

function endpoints(item) {
  C.apply(item);
  const start2 = resolve(item.source, item.target.fallback),
    end = resolve(item.target, start2.point);
  const revised = resolve(item.source, end.point);
  const distribute = (terminal, resolved) => {
    if (
      !terminal.binding ||
      terminal.anchor.mode !== 'auto' ||
      resolved.internal ||
      !resolved.rect ||
      resolved.status === 'orphan'
    )
      return;
    const peers = [...(state.connectorIndex.get(terminal.binding.id) || [])]
      .filter((id) => {
        const other = state.items.get(id);
        return (
          other?.connectorVersion &&
          ['source', 'target'].some((key) => JSON.stringify(other[key]?.binding) === JSON.stringify(terminal.binding))
        );
      })
      .sort();
    const index = peers.indexOf(item.id);
    if (index < 0 || peers.length < 2) return;
    const r = resolved.rect,
      p = C.rotate(resolved.point, r, true),
      horizontal =
        Math.min(Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.h)) <
        Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.w)),
      delta = (index - (peers.length - 1) / 2) * Math.min(10, ((horizontal ? r.w : r.h) * 0.7) / peers.length);
    if (horizontal) p.x = Math.max(r.x + 8, Math.min(r.x + r.w - 8, p.x + delta));
    else p.y = Math.max(r.y + 8, Math.min(r.y + r.h - 8, p.y + delta));
    resolved.point = C.rotate(p, r);
  };
  distribute(item.source, revised);
  distribute(item.target, end);
  return {
    start: revised.point,
    end: end.point,
    source: revised,
    target: end,
    hidden: revised.status === 'hidden' || end.status === 'hidden' || (revised.proxy && revised.proxy === end.proxy)
  };
}

function relatedRouteTypes(item) {
  const ids = [item.source.binding?.id, item.target.binding?.id].filter(Boolean);
  const peers = new Set(ids.flatMap((id) => [...(state.connectorIndex.get(id) || [])]));
  const votes = { straight: 0, curve: 0, orthogonal: 0 };
  for (const id of peers) {
    const other = state.items.get(id);
    if (!other || other.id === item.id || !(other.route?.type in votes)) continue;
    const otherIds = [other.source.binding?.id, other.target.binding?.id].filter(Boolean);
    const samePair = ids.length === 2 && otherIds.length === 2 && ids.every((value) => otherIds.includes(value));
    votes[other.route.type] += samePair ? 3 : 1;
  }
  return votes;
}

function effectiveRouteType(item, ends) {
  const choice = C.chooseRouteType(
    item,
    ends,
    item.route.type === 'smart'
      ? { previousType: smartChoices.get(item.id), relatedTypes: () => relatedRouteTypes(item) }
      : {}
  );
  if (item.route.type === 'smart') smartChoices.set(item.id, choice);
  if (
    item.route.type !== 'smart' ||
    choice === 'orthogonal' ||
    item.route.avoidance === false ||
    (item.source.binding?.id && item.source.binding.id === item.target.binding?.id) ||
    Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y) < 80
  )
    return choice;
  const points =
    choice === 'curve'
      ? R.route({ start: ends.start, end: ends.end, route: { type: 'curve', constraints: [] } }).points
      : [ends.start, ends.end];
  const bounds = C.bounds(points, 8);
  for (const candidate of queryItemsInRect(bounds)) {
    const other = state.items.get(typeof candidate === 'string' ? candidate : candidate.id);
    if (
      !other ||
      other.type === 'connector' ||
      other.id === item.source.binding?.id ||
      other.id === item.target.binding?.id ||
      !isItemVisible(other)
    )
      continue;
    const r = aabb(other);
    if (C.pathIntersectsRect(points, { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 })) {
      return 'orthogonal';
    }
  }
  return choice;
}

function inputFor(item, ends, includeObstacles = true, resolvedType = effectiveRouteType(item, ends)) {
  const region = includeObstacles
    ? C.bounds([ends.start, ends.end, ...item.route.constraints.flatMap((c) => [c.a, c.b])], 160)
    : null;
  const excluded = new Set([item.id, item.source.binding?.id, item.target.binding?.id]);
  const candidates = includeObstacles ? queryItemsInRect(region) : [];
  const obstacles = candidates
    .map((v) => state.items.get(typeof v === 'string' ? v : v.id))
    .filter((v) => v && v.type !== 'connector' && !excluded.has(v.id) && isItemVisible(v))
    .map((v) => ({ ...aabb(v), id: v.id }));
  let route = item.route.type === 'smart' ? { ...item.route, type: resolvedType } : item.route;
  if (
    item.source.binding?.id === item.target.binding?.id &&
    item.source.binding &&
    ends.source.owner &&
    Math.hypot(ends.start.x - ends.end.x, ends.start.y - ends.end.y) < 2 &&
    !route.constraints.length
  ) {
    const owner = ends.source.owner;
    route = {
      ...route,
      constraints: [
        route.type === 'curve'
          ? {
              id: 'self-loop',
              kind: 'curve',
              a: { x: owner.x + owner.w + 64, y: owner.y - 90 },
              b: { x: owner.x - 64, y: owner.y - 90 }
            }
          : {
              id: 'self-loop',
              kind: 'segment',
              a: { x: owner.x + owner.w + 48, y: owner.y - 48 },
              b: { x: owner.x - 48, y: owner.y - 48 }
            }
      ]
    };
  }
  const port = (endpoint, toward, length) => {
    if (!endpoint.rect || endpoint.status === 'orphan' || endpoint.owner?.type === void 0) return null;
    if (length <= 0) return null;
    const r = endpoint.internal ? endpoint.owner : endpoint.rect,
      local = C.rotate(endpoint.internal ? C.anchor(r, toward) : endpoint.point, r, true);
    const sides = [
      ['left', Math.abs(local.x - r.x)],
      ['right', Math.abs(local.x - r.x - r.w)],
      ['top', Math.abs(local.y - r.y)],
      ['bottom', Math.abs(local.y - r.y - r.h)]
    ].sort((a, b) => a[1] - b[1]);
    const side = sides[0][0],
      p = C.rotate(endpoint.point, r, true);
    if (side === 'left') p.x = r.x - length;
    else if (side === 'right') p.x = r.x + r.w + length;
    else if (side === 'top') p.y = r.y - length;
    else p.y = r.y + r.h + length;
    obstacles.push({ ...aabb(r), id: `port-${endpoint.owner.id}` });
    return C.rotate(p, r);
  };
  const startPort = route.type === 'orthogonal' ? port(ends.source, ends.end, route.startStub) : null,
    endPort = route.type === 'orthogonal' ? port(ends.target, ends.start, route.endStub) : null;
  return { start: ends.start, end: ends.end, startPort, endPort, route, obstacles };
}

export { boardRect, effectiveRouteType, endpoints, inputFor, rangeRects, relatedRouteTypes, resolve, rootFor, textMap };
