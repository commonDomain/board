'use strict';

const items = new Map();
const spatialCells = new Map();
const itemCellKeys = new Map();
const CELL_SIZE = 512;

function boundsOf(start, current) {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    w: Math.abs(current.x - start.x),
    h: Math.abs(current.y - start.y)
  };
}

function rotatedBounds(item) {
  const radians = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = item.w * cos + item.h * sin;
  const height = item.w * sin + item.h * cos;
  return radians
    ? { x: item.x + (item.w - width) / 2, y: item.y + (item.h - height) / 2, w: width, h: height }
    : item;
}

function cellKeysForBounds(bounds) {
  const keys = [];
  const minX = Math.floor(bounds.x / CELL_SIZE);
  const maxX = Math.floor((bounds.x + Math.max(0, bounds.w)) / CELL_SIZE);
  const minY = Math.floor(bounds.y / CELL_SIZE);
  const maxY = Math.floor((bounds.y + Math.max(0, bounds.h)) / CELL_SIZE);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`);
  }
  return keys;
}

function removeIndexedItem(id) {
  for (const key of itemCellKeys.get(id) || []) {
    const ids = spatialCells.get(key);
    ids?.delete(id);
    if (!ids?.size) spatialCells.delete(key);
  }
  itemCellKeys.delete(id);
  items.delete(id);
}

function indexItem(item) {
  removeIndexedItem(item.id);
  items.set(item.id, item);
  const keys = cellKeysForBounds(rotatedBounds(item));
  itemCellKeys.set(item.id, keys);
  for (const key of keys) {
    let ids = spatialCells.get(key);
    if (!ids) {
      ids = new Set();
      spatialCells.set(key, ids);
    }
    ids.add(item.id);
  }
}

function queryIds(bounds) {
  const ids = new Set();
  for (const key of cellKeysForBounds(bounds)) {
    for (const id of spatialCells.get(key) || []) ids.add(id);
  }
  return ids;
}

function pointsBounds(points) {
  if (!points?.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function intersectsRect(item, rect) {
  const bounds = rotatedBounds(item);
  return bounds.x < rect.x + rect.w && bounds.x + bounds.w > rect.x &&
    bounds.y < rect.y + rect.h && bounds.y + bounds.h > rect.y;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((b.y > point.y) !== (a.y > point.y) && point.x < ((a.x - b.x) * (point.y - b.y)) / (a.y - b.y) + b.x) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const epsilon = 1e-8;
  const values = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  const opposite = (left, right) => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (opposite(values[0], values[1]) && opposite(values[2], values[3])) return true;
  const onSegment = (p, q, r) => r.x >= Math.min(p.x, q.x) - epsilon && r.x <= Math.max(p.x, q.x) + epsilon &&
    r.y >= Math.min(p.y, q.y) - epsilon && r.y <= Math.max(p.y, q.y) + epsilon;
  return (Math.abs(values[0]) <= epsilon && onSegment(a, b, c)) ||
    (Math.abs(values[1]) <= epsilon && onSegment(a, b, d)) ||
    (Math.abs(values[2]) <= epsilon && onSegment(c, d, a)) ||
    (Math.abs(values[3]) <= epsilon && onSegment(c, d, b));
}

function intersectsLasso(item, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const corners = [
    { x: item.x, y: item.y },
    { x: item.x + item.w, y: item.y },
    { x: item.x + item.w, y: item.y + item.h },
    { x: item.x, y: item.y + item.h }
  ];
  if (corners.some((point) => pointInPolygon(point, polygon)) ||
    polygon.some((point) => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h)) return true;
  const rectangleEdges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]]);
  for (let index = 0; index < polygon.length; index += 1) {
    const edge = [polygon[index], polygon[(index + 1) % polygon.length]];
    if (rectangleEdges.some((rectangleEdge) => segmentsIntersect(edge[0], edge[1], rectangleEdge[0], rectangleEdge[1]))) return true;
  }
  return false;
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'reset') {
    items.clear();
    spatialCells.clear();
    itemCellKeys.clear();
    for (const item of message.items || []) indexItem(item);
    return;
  }
  if (message.type === 'upsert' && message.item?.id) {
    indexItem(message.item);
    return;
  }
  if (message.type === 'remove') {
    removeIndexedItem(message.id);
    return;
  }
  if (message.type !== 'select') return;
  const rect = boundsOf(message.start, message.current);
  const candidateBounds = message.mode === 'lasso' ? pointsBounds(message.points) : rect;
  const ids = [];
  let selectionBounds = null;
  for (const id of queryIds(candidateBounds)) {
    const item = items.get(id);
    if (!item.selectable) continue;
    const selected = message.mode === 'lasso'
        ? intersectsLasso(item, message.points)
        : intersectsRect(item, rect);
    if (selected) {
      ids.push(id);
      selectionBounds = selectionBounds
        ? {
            x: Math.min(selectionBounds.x, item.x),
            y: Math.min(selectionBounds.y, item.y),
            w: Math.max(selectionBounds.x + selectionBounds.w, item.x + item.w) - Math.min(selectionBounds.x, item.x),
            h: Math.max(selectionBounds.y + selectionBounds.h, item.y + item.h) - Math.min(selectionBounds.y, item.y)
          }
        : { x: item.x, y: item.y, w: item.w, h: item.h };
    }
  }
  self.postMessage({ type: 'selection', sequence: message.sequence, ids, bounds: selectionBounds });
};
