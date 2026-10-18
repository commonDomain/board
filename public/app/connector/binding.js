import { cssEscape } from '../utilities.js';
import { state } from '../state.js';
import { getLayer } from '../layers-model.js';
import {isItemVisible} from '../layer-visibility.js';

import { layoutMindTree } from '../mindmap-model.js';
import { getTableColumnWidths, getTableRowHeights } from '../table-rendering-model.js';
import { queryItemsInRect } from '../spatial-index-model.js';

import { C, R, aabb, mounted, outlines, smartChoices } from './state.js';
import { clientContentGeometry, localContentRect, planningTaskGeometry, worldContentRect } from './content-geometry.js';
import { separateTaskCurves } from './task-routing.js';

function boardRect(element) {
  const root = element.closest('.board-item'), owner = state.items.get(root?.dataset.itemId);
  return owner ? worldContentRect(owner, localContentRect(root, element)) || owner : null;
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
  const geometry = clientContentGeometry(mounted(item.id));
  if (!geometry) return [];
  return map.entries.flatMap(entry => {
    const start = Math.max(0, from - entry.start), end = Math.min(entry.length, to - entry.start);
    if (start >= end) return [];
    const range = document.createRange();
    range.setStart(entry.node, start); range.setEnd(entry.node, end);
    const caret = range.cloneRange(); caret.collapse(true);
    const height = geometry.caretHeight(caret.getClientRects()[0]);
    return Array.from(range.getClientRects()).filter(r => r.width && r.height)
      .map(r => worldContentRect(item, geometry.rect(r, height)));
  });
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
    const view = mounted(owner.id)?.querySelector('.planning-component')?.dataset.planView || owner.planView;
    if (view === 'calendar') return { point: t.fallback, status: 'hidden', owner };
    const task = owner.type === 'planning' && owner.planRef === c.planId && window.MusePlanning?.getTask({ planId: c.planId, taskId: c.taskId });
    if (!task || task.deleted || task.archived) status = 'orphan';
    else {
      const geometry = planningTaskGeometry(owner, mounted(owner.id), c.taskId);
      rect = geometry.rect;
      if (geometry.proxy) proxy = `task:${owner.id}:${c.taskId}`;
    }
  }
  if (!proxy && c?.nodeId) {
    const found = C.findNode(owner.tree, c.nodeId);
    if (!found) status = 'orphan';
    else {
      const ancestor = found.parents.find((n2) => n2.collapsed),
        id = ancestor?.id || c.nodeId;
      const layout = layoutMindTree(owner.tree, owner.w || 360, owner.h || 220, owner.branchStyle, owner.layoutMode),
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
    const root = mounted(owner.id), el = root?.querySelector(`[data-row="${r}"][data-column="${col}"]`);
    const measured = worldContentRect(owner, localContentRect(root, el));
    if (r < 0 || col < 0) status = 'orphan';
    else if (measured) rect = measured;
    else {
      const widths = getTableColumnWidths(owner, owner.columnIds.length),
        heights = getTableRowHeights(owner, owner.rowIds.length);
      rect = worldContentRect(owner, {
        x: widths.slice(0, col).reduce((a, b) => a + b, 0),
        y: heights.slice(0, r).reduce((a, b) => a + b, 0),
        w: widths[col],
        h: heights[r]
      });
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
      } else { proxy = `text:${owner.id}:${c.anchorId}`; internal = false; }
    }
  }
  if (status === 'orphan') rect = owner;
  let p = C.anchor(
    rect,
    toward,
    status === 'orphan' || (internal && c?.kind === 'text-range') || proxy ? { mode: 'auto' } : t.anchor
  );
  // Prefer the nearby side. Only spill a minority of crowded task bindings
  // onto the top/opposite side; keep the assignment stable across renders.
  if (internal && c?.kind === 'plan-task' && t.anchor.mode === 'auto') {
    const localToward=C.rotate(toward,rect,true), left=localToward.x<rect.x+rect.w/2;
    const taskIds = new Set([c.taskId]);
    for(const id of state.connectorIndex.get(owner.id)||[]) {
      const line=state.items.get(id);
      if(!line?.connectorVersion || line.route?.type !== 'smart' || window.MusePlanning?.isTaskLineHidden?.(line))continue;
      const key=['source','target'].find(k=>line[k]?.binding?.id===owner.id && line[k].binding.content?.kind==='plan-task');
      if(!key || line[key].anchor.mode!=='auto')continue;
      const peerTask=window.MusePlanning?.getTask(line[key].binding.content);
      if(!peerTask || peerTask.archived || peerTask.deleted)continue;
      const opposite=line[key==='source'?'target':'source'], sourceOwner=state.items.get(opposite.binding?.id);
      const source=sourceOwner?{x:sourceOwner.x+sourceOwner.w/2,y:sourceOwner.y+sourceOwner.h/2}:opposite.fallback;
      const local=C.rotate(source,rect,true);
      if((local.x<rect.x+rect.w/2)===left)taskIds.add(line[key].binding.content.taskId);
    }
    const ids=[...taskIds].sort(), rank=ids.indexOf(c.taskId), slot=ids.length>4?rank%6:0;
    const useLeft=slot===5?!left:left;
    p=C.rotate(slot===4?{x:rect.x+Math.min(28,rect.w*.15),y:rect.y}:
      {x:useLeft?rect.x:rect.x+rect.w,y:rect.y+rect.h/2},rect);
  }
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
  // The binding owns its routing boundary. Node/task ports are local; text
  // selections and cells exit their containing card/table before routing.
  const portRect = internal && !['mindmap', 'planning'].includes(owner.type) ? owner : rect;
  return { point: p, status: proxy ? 'proxy' : status, proxy, owner, rect, portRect, internal };
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
  if (item.route.type === 'smart' && !item.route.constraints.length &&
      ['source','target'].some(key => item[key].binding?.content?.kind === 'plan-task' &&
        item[key].anchor.mode === 'auto' && ends[key].internal && !ends[key].owner?.rotation)) return 'orthogonal';
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
  if (item.route.type === 'smart' && route.type === 'orthogonal' && !route.constraints.length) {
    const key = ['source','target'].find(key => item[key].binding?.content?.kind === 'plan-task' && item[key].anchor.mode === 'auto' && ends[key].internal && !ends[key].owner?.rotation);
    if (key) {
      const task = ends[key], other = ends[key === 'target' ? 'source' : 'target'], owner = task.owner;
      const left = task.point.x < task.rect.x + task.rect.w / 2;
      const peers = [...(state.connectorIndex.get(owner.id) || [])].map(id=>state.items.get(id))
        .filter(line=>line?.route?.type==='smart' && !window.MusePlanning?.isTaskLineHidden?.(line) &&
          [line.source,line.target].some(t=>t.binding?.id===owner.id && t.anchor.mode==='auto' && t.binding.content?.kind==='plan-task'))
        .map(line=>{
          const resolved=endpoints(line), taskKey=['source','target'].find(k=>line[k].binding?.id===owner.id && line[k].binding.content?.kind==='plan-task');
          return {id:line.id,task:resolved[taskKey],hidden:resolved.hidden};
        }).filter(peer=>!peer.hidden && peer.task.internal &&
          (peer.task.point.x < peer.task.rect.x + peer.task.rect.w / 2) === left)
        .sort((a,b)=>a.task.point.y-b.task.point.y || a.id.localeCompare(b.id));
      const rank = Math.max(0, peers.findIndex(line=>line.id===item.id));
      const lane = Math.min(6, other.point.y > task.point.y ? Math.max(0,peers.length-1-rank) : rank);
      const x = left ? owner.x - 18 - lane * 8 : owner.x + owner.w + 18 + lane * 8;
      const topEntry = Math.abs(task.point.y-task.rect.y)<.5;
      const approachY = task.point.y-(topEntry?3:0);
      let via = [{x,y:other.point.y},{x,y:approachY}];
      // Reaching the far side of a board must go around its heading/cards.
      if (other.point.y>owner.y && other.point.y<owner.y+owner.h &&
          ((!left && other.point.x < owner.x+owner.w) || (left && other.point.x > owner.x))) {
        const sourceX=left?owner.x+owner.w+18:owner.x-18;
        const bypassY=other.point.y>owner.y+owner.h?owner.y+owner.h+18:owner.y-18;
        via=[{x:sourceX,y:other.point.y},{x:sourceX,y:bypassY},{x,y:bypassY},{x,y:approachY}];
      }
      if(topEntry)via.push({x:task.point.x,y:approachY});
      if(key==='source')via.reverse();
      route = {...route,startStub:0,endStub:0,constraints:via.map((point,index)=>({id:`task-outer-${index}`,kind:'point',a:point}))};
    }
  }
  if (item.route.type === 'smart' && route.type === 'curve' && !route.constraints.length &&
      [item.source, item.target].some(terminal => terminal.binding?.content?.kind === 'plan-task')) {
    const control = (endpoint, toward, terminal, length) => {
      const p = endpoint.point, r = endpoint.rect;
      if (r && terminal.anchor.mode === 'auto' && terminal.binding?.content?.kind === 'plan-task' && endpoint.internal) {
        const local = C.rotate(p, r, true);
        if(Math.abs(local.y-r.y)<.5)return C.rotate({x:local.x,y:local.y-length},r);
        return C.rotate({ x: local.x + (local.x < r.x + r.w / 2 ? -length : length), y: local.y }, r);
      }
      const distance = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
      return { x: p.x + (toward.x - p.x) * length / distance, y: p.y + (toward.y - p.y) * length / distance };
    };
    const curve = (line, resolved) => {
      const length = Math.min(96, Math.hypot(resolved.end.x - resolved.start.x, resolved.end.y - resolved.start.y) / 3);
      return { id:line.id,start:resolved.start,end:resolved.end,
        a:control(resolved.source,resolved.end,line.source,length),b:control(resolved.target,resolved.start,line.target,length) };
    };
    const taskOwner = [item.source,item.target].find(t=>t.binding?.content?.kind==='plan-task').binding.id;
    const entries = [curve(item, ends)];
    const peers = [...new Set([item.id,...(state.connectorIndex.get(taskOwner)||[])])].sort().slice(0,32);
    for (const id of peers.includes(item.id) ? peers : []) {
      if(id===item.id)continue;
      const peer=state.items.get(id);
      if(!peer?.connectorVersion || peer.route?.type!=='smart' || peer.route.constraints.length ||
        window.MusePlanning?.isTaskLineHidden?.(peer) ||
        ![peer.source,peer.target].some(t=>t.binding?.id===taskOwner && t.binding.content?.kind==='plan-task'))continue;
      const resolved=endpoints(peer);
      if(!resolved.hidden && effectiveRouteType(peer,resolved)==='curve') entries.push(curve(peer,resolved));
    }
    const chosen=separateTaskCurves(entries).get(item.id);
    route = { ...route, constraints: [{ id: 'task-approach', kind: 'curve', ...chosen }] };
  }
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
    const r = endpoint.portRect || endpoint.rect,
      exitOwner = r !== endpoint.rect,
      local = C.rotate(exitOwner ? C.anchor(r, toward) : endpoint.point, r, true);
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
