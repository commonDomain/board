import { state } from './state.js';

function getSelectedIds() {
  return state.selectedIds.size ? Array.from(state.selectedIds) : state.selectedId ? [state.selectedId] : [];
}

function getPrimaryId() {
  return state.selectedId || getSelectedIds()[0] || null;
}

function getBoundsOfItems(ids) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const item = state.items.get(id);
    if (!item) {
      continue;
    }
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function selectionChangedIds(previousIds, nextIds, previousPrimary, nextPrimary) {
  const changed = new Set();
  for (const id of previousIds || []) if (!nextIds.has(id)) changed.add(id);
  for (const id of nextIds || []) if (!previousIds?.has(id)) changed.add(id);
  if (previousPrimary) changed.add(previousPrimary);
  if (nextPrimary) changed.add(nextPrimary);
  return Array.from(changed);
}
export { getSelectedIds, getPrimaryId, getBoundsOfItems, selectionChangedIds };
