'use strict';

self.onmessage = (event) => {
  try {
    const { action, items = [], connectors = [] } = event.data || {};
    if (!Array.isArray(items) || !items.length) throw new TypeError('No layout items');
    const result = action === 'layout-grid' ? gridLayout(items) : flowLayout(items, connectors, action === 'layout-flow-down');
    self.postMessage({ items: result });
  } catch (error) {
    self.postMessage({ error: error.message || 'Layout failed' });
  }
};

function gridLayout(items) {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const originX = Math.min(...ordered.map((item) => item.x));
  const originY = Math.min(...ordered.map((item) => item.y));
  const columnWidths = Array.from({ length: columns }, () => 0);
  ordered.forEach((item, index) => { columnWidths[index % columns] = Math.max(columnWidths[index % columns], item.w); });
  const rows = Math.ceil(ordered.length / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);
  ordered.forEach((item, index) => { rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], item.h); });
  const xOffsets = columnWidths.map((_, index) => originX + columnWidths.slice(0, index).reduce((sum, width) => sum + width + 48, 0));
  const yOffsets = rowHeights.map((_, index) => originY + rowHeights.slice(0, index).reduce((sum, height) => sum + height + 48, 0));
  return ordered.map((item, index) => ({ ...item, x: xOffsets[index % columns], y: yOffsets[Math.floor(index / columns)] }));
}

function flowLayout(items, connectors, vertical) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const incoming = new Map(items.map((item) => [item.id, 0]));
  const outgoing = new Map(items.map((item) => [item.id, []]));
  for (const connector of connectors) {
    if (!byId.has(connector.startId) || !byId.has(connector.endId) || connector.startId === connector.endId) continue;
    outgoing.get(connector.startId).push(connector.endId);
    incoming.set(connector.endId, incoming.get(connector.endId) + 1);
  }
  const queue = items.filter((item) => incoming.get(item.id) === 0).sort((a, b) => a.id.localeCompare(b.id));
  const rank = new Map(items.map((item) => [item.id, 0]));
  const visited = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    for (const target of outgoing.get(item.id)) {
      rank.set(target, Math.max(rank.get(target), rank.get(item.id) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(byId.get(target));
    }
    queue.sort((a, b) => a.id.localeCompare(b.id));
  }
  for (const item of items) if (!visited.has(item.id)) rank.set(item.id, Math.max(0, ...rank.values()) + 1);
  const levels = new Map();
  for (const item of items) {
    const key = rank.get(item.id);
    if (!levels.has(key)) levels.set(key, []);
    levels.get(key).push(item);
  }
  for (const level of levels.values()) level.sort((a, b) => (vertical ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
  const originX = Math.min(...items.map((item) => item.x));
  const originY = Math.min(...items.map((item) => item.y));
  const majorSizes = new Map(Array.from(levels, ([key, level]) => [key, Math.max(...level.map((item) => vertical ? item.h : item.w))]));
  const sortedRanks = Array.from(levels.keys()).sort((a, b) => a - b);
  const majorOffset = new Map();
  let cursor = vertical ? originY : originX;
  for (const key of sortedRanks) {
    majorOffset.set(key, cursor);
    cursor += majorSizes.get(key) + 96;
  }
  const result = [];
  for (const key of sortedRanks) {
    let minor = vertical ? originX : originY;
    for (const item of levels.get(key)) {
      result.push({ ...item, x: vertical ? minor : majorOffset.get(key), y: vertical ? majorOffset.get(key) : minor });
      minor += (vertical ? item.w : item.h) + 56;
    }
  }
  return result;
}
