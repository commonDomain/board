import { state } from './state.js';

function intersectsRect(item, rect) {
  const rotation = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const width = item.w * cos + item.h * sin;
  const height = item.w * sin + item.h * cos;
  const bounds = rotation
    ? { x: item.x + (item.w - width) / 2, y: item.y + (item.h - height) / 2, w: width, h: height }
    : item;
  return (
    bounds.x < rect.x + rect.w &&
    bounds.x + bounds.w > rect.x &&
    bounds.y < rect.y + rect.h &&
    bounds.y + bounds.h > rect.y
  );
}

function boardPointToItemSpace(item, point) {
  const centerX = Number(item.x) + Number(item.w) / 2;
  const centerY = Number(item.y) + Number(item.h) / 2;
  const radians = (-(Number(item.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

function pointHitsItemBounds(item, point) {
  if (item.type === 'connector' && window.ConnectorUI) return window.ConnectorUI.hitTest(item, point);
  const local = boardPointToItemSpace(item, point);
  return local.x >= item.x && local.x <= item.x + item.w && local.y >= item.y && local.y <= item.y + item.h;
}

function getPinnedRenderItems() {
  const ids = new Set();
  if (state.editingId) ids.add(state.editingId);
  if (state.interaction?.id) ids.add(state.interaction.id);
  for (const id of state.interaction?.moveIds || []) ids.add(id);
  if (state.mindmapEditing?.itemId) ids.add(state.mindmapEditing.itemId);
  const pendingId = state.pendingMove?.itemElement?.dataset?.itemId;
  if (pendingId) ids.add(pendingId);
  return Array.from(ids, (id) => state.items.get(id)).filter(Boolean);
}
export { intersectsRect, boardPointToItemSpace, pointHitsItemBounds, getPinnedRenderItems };
