import { cloneHistoryValue } from './history-controller-model.js';
import { MIN_ITEM_SIZE, MIN_TABLE_COLUMN_WIDTH } from './constants.js';
import { state } from './state.js';
import {
  getTableColumnCount,
  getTableColumnWidths,
  getTableRowCount,
  getTableRowHeights
} from './table-rendering-model.js';
import { clamp } from './utilities.js';

function interactionFieldsForMode(item, mode) {
  if (mode === 'move') return ['x', 'y', 'sectionId', 'groupId'];
  if (mode === 'rotate') return ['rotation'];
  if (mode === 'table-column') return ['w', 'columnWidths'];
  if (mode === 'mind-node-resize') return ['x', 'y', 'w', 'h', 'tree'];
  const fields = ['x', 'y', 'w', 'h'];
  if (item?.type === 'table') fields.push('columnWidths', 'rowHeights');
  return fields;
}

function captureFields(target, fields) {
  const snapshot = {};
  for (const field of fields || []) snapshot[field] = cloneHistoryValue(target?.[field]);
  return snapshot;
}

function captureInteractionItems(ids, mode) {
  const snapshots = new Map();
  for (const id of ids) {
    const item = state.items.get(id);
    if (!item) continue;
    const fields = interactionFieldsForMode(item, mode);
    snapshots.set(id, { fields, values: captureFields(item, fields) });
  }
  return snapshots;
}

function interactionHistoryChanges(interaction) {
  const changes = [];
  for (const [id, snapshot] of interaction?.beforeById || []) {
    const item = state.items.get(id);
    if (!item) continue;
    changes.push({
      targetType: 'item',
      id,
      fields: snapshot.fields,
      before: snapshot.values,
      after: captureFields(item, snapshot.fields)
    });
  }
  return changes;
}

function nearestSortedLine(lines, value) {
  if (!Array.isArray(lines) || !lines.length || !Number.isFinite(value)) return null;
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle] < value) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return lines[0];
  if (low === lines.length) return lines[lines.length - 1];
  return value - lines[low - 1] <= lines[low] - value ? lines[low - 1] : lines[low];
}

function resizeTableColumn(item, interaction, dx) {
  const widths = interaction.startWidths.slice();
  const index = clamp(interaction.columnIndex, 0, widths.length - 1);
  widths[index] = Math.max(MIN_TABLE_COLUMN_WIDTH, widths[index] + dx);
  item.columnWidths = widths.map((width) => Math.round(width));
  item.w = Math.max(
    MIN_ITEM_SIZE,
    item.columnWidths.reduce((sum, width) => sum + width, 0)
  );
}

function resizeItemFromHandle(item, handle, dx, dy, startItem = item) {
  if (item.type === 'text') {
    resizeTextFromHandle(item, startItem, handle, dx, dy);
    return;
  }
  if (item.type === 'image') {
    resizeImageFromHandle(item, startItem, handle, dx, dy);
    return;
  }
  const originalWidth = item.w;
  const originalHeight = item.h;
  if (handle.includes('e')) {
    item.w = Math.max(MIN_ITEM_SIZE, item.w + dx);
  }
  if (handle.includes('s')) {
    item.h = Math.max(MIN_ITEM_SIZE, item.h + dy);
  }
  if (handle.includes('w')) {
    const newWidth = Math.max(MIN_ITEM_SIZE, item.w - dx);
    item.x += item.w - newWidth;
    item.w = newWidth;
  }
  if (handle.includes('n')) {
    const newHeight = Math.max(MIN_ITEM_SIZE, item.h - dy);
    item.y += item.h - newHeight;
    item.h = newHeight;
  }
  if (item.type === 'table') {
    const baseWidths = getTableColumnWidths(startItem, getTableColumnCount(startItem));
    const baseHeights = getTableRowHeights(startItem, getTableRowCount(startItem));
    const scale = item.w / Math.max(1, originalWidth);
    const heightScale = item.h / Math.max(1, originalHeight);
    item.columnWidths = baseWidths.map((width) => Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(width * scale)));
    item.rowHeights = baseHeights.map((height) => Math.max(34, Math.round(height * heightScale)));
    const totalWidth = item.columnWidths.reduce((sum, width) => sum + width, 0);
    const totalHeight = item.rowHeights.reduce((sum, height) => sum + height, 0);
    if (handle.includes('w')) {
      item.x += item.w - totalWidth;
    }
    if (handle.includes('n')) {
      item.y += item.h - totalHeight;
    }
    item.w = totalWidth;
    item.h = totalHeight;
  }
}

function resizeTextFromHandle(item, startItem, handle, dx, dy) {
  const baseWidth = Math.max(MIN_ITEM_SIZE, Number(startItem.w) || 120);
  const baseHeight = Math.max(MIN_ITEM_SIZE, Number(startItem.h) || 32);
  if (handle.includes('e')) {
    item.w = Math.max(MIN_ITEM_SIZE, baseWidth + dx);
  }
  if (handle.includes('s')) {
    item.h = Math.max(MIN_ITEM_SIZE, baseHeight + dy);
  }
  if (handle.includes('w')) {
    const nextWidth = Math.max(MIN_ITEM_SIZE, baseWidth - dx);
    item.x = startItem.x + baseWidth - nextWidth;
    item.w = nextWidth;
  }
  if (handle.includes('n')) {
    const nextHeight = Math.max(MIN_ITEM_SIZE, baseHeight - dy);
    item.y = startItem.y + baseHeight - nextHeight;
    item.h = nextHeight;
  }
}

function resizeImageFromHandle(item, startItem, handle, dx, dy) {
  if (handle.includes('e')) {
    item.w = Math.max(MIN_ITEM_SIZE, startItem.w + dx);
  }
  if (handle.includes('s')) {
    item.h = Math.max(MIN_ITEM_SIZE, startItem.h + dy);
  }
  if (handle.includes('w')) {
    const nextW = Math.max(MIN_ITEM_SIZE, startItem.w - dx);
    item.x = startItem.x + startItem.w - nextW;
    item.w = nextW;
  }
  if (handle.includes('n')) {
    const nextH = Math.max(MIN_ITEM_SIZE, startItem.h - dy);
    item.y = startItem.y + startItem.h - nextH;
    item.h = nextH;
  }
}
export {
  interactionFieldsForMode,
  captureFields,
  captureInteractionItems,
  interactionHistoryChanges,
  nearestSortedLine,
  resizeTableColumn,
  resizeTextFromHandle,
  resizeImageFromHandle,
  resizeItemFromHandle
};
