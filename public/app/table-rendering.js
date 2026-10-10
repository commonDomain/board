import { pushUndoSnapshot } from './history-controller.js';
import { snapshotItems } from './history-controller-model.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, MIN_ITEM_SIZE, MIN_TABLE_HEIGHT } from './constants.js';
import {
  onTableClick,
  onTableColumnHandlePointerDown,
  onTableMoveHandlePointerDown,
  onTablePointerDown
} from './editing.js';
import { normalizeFontFamily } from './format-actions-model.js';
import { updateContextPanel } from './format-panel.js';
import { showToast } from './interface-model.js';
import { broadcastUpsert } from './items.js';
import { canMutateItem } from './layers-model.js';
import { renderItem } from './rendering.js';
import { markDirty } from './save-status.js';
import { selectItem } from './selection.js';
import { state } from './state.js';
import { clamp, cssEscape, makeId, placeCursorAtEnd } from './utilities.js';
import {
  isTableCellSelected,
  clearTableCellSelection,
  getTableCellCoordinates,
  getTableColumnCount,
  getTableRowCount,
  getTableRowHeights,
  getTableColumnWidths,
  syncTableFromDom
} from './table-rendering-model.js';

function renderTable(item) {
  const shell = document.createElement('div');
  shell.className = 'table-shell';
  shell.dataset.itemId = item.id;
  shell.addEventListener('pointerdown', onTablePointerDown);
  shell.addEventListener('click', onTableClick);
  const selected = state.selectedId === item.id;
  const editing = state.editingId === item.id;
  if (selected || editing) {
    const moveHandle = document.createElement('button');
    moveHandle.className = 'table-move-handle';
    moveHandle.type = 'button';
    moveHandle.title = '拖动表格';
    moveHandle.setAttribute('aria-label', '拖动表格');
    moveHandle.addEventListener('pointerdown', onTableMoveHandlePointerDown);
    moveHandle.addEventListener('click', (event) => event.stopPropagation());
    shell.appendChild(moveHandle);
  }
  const content = document.createElement('div');
  content.className = 'table-content';
  const table = document.createElement('table');
  table.className = 'board-table';
  table.style.fontSize = `${item.fontSize || 15}px`;
  table.style.fontFamily = normalizeFontFamily(item.fontFamily);
  table.style.fontWeight = item.bold ? '700' : '400';
  const rows = Array.isArray(item.rows) && item.rows.length ? item.rows : [['', '', '']];
  const columnCount = getTableColumnCount(item);
  const rowCount = getTableRowCount(item);
  const widths = getTableColumnWidths(item, columnCount);
  const rowHeights = getTableRowHeights(item, rowCount);
  const colgroup = document.createElement('colgroup');
  widths.forEach((width) => {
    const col = document.createElement('col');
    col.style.width = `${width}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  table.style.height = `${rowHeights.reduce((sum, height) => sum + height, 0)}px`;
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.style.height = `${rowHeights[rowIndex] || 34}px`;
    row.forEach((cell, columnIndex) => {
      const tag = item.header && rowIndex === 0 ? 'th' : 'td';
      const td = document.createElement(tag);
      td.contentEditable = state.editingId === item.id ? 'true' : 'false';
      td.spellcheck = false;
      td.dataset.row = String(rowIndex);
      td.dataset.column = String(columnIndex);
      td.style.color = item.color || '#111111';
      td.style.textAlign = item.align || 'left';
      td.textContent = cell;
      if (isTableCellSelected(item.id, rowIndex, columnIndex)) {
        td.classList.add('table-cell-selected');
        td.setAttribute('aria-selected', 'true');
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  content.appendChild(table);
  shell.appendChild(content);
  shell.append(
    makeTableAddButton(item, 'column', columnCount >= MAX_TABLE_COLUMNS),
    makeTableAddButton(item, 'row', rowCount >= MAX_TABLE_ROWS)
  );
  if (editing && widths.length > 1) {
    shell.classList.add('is-editing');
    const guides = document.createElement('div');
    guides.className = 'table-column-guides';
    let offset = 0;
    for (let index = 0; index < widths.length - 1; index += 1) {
      offset += widths[index];
      const handle = document.createElement('button');
      handle.className = 'table-column-handle';
      handle.type = 'button';
      handle.dataset.column = String(index);
      handle.style.left = `${offset}px`;
      handle.addEventListener('pointerdown', onTableColumnHandlePointerDown);
      handle.addEventListener('click', (event) => event.stopPropagation());
      guides.appendChild(handle);
    }
    shell.appendChild(guides);
  }
  return shell;
}

function makeTableAddButton(item, axis, disabled) {
  const isRow = axis === 'row';
  const label = isRow ? '添加一行' : '添加一列';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `table-add-control table-add-${axis}`;
  button.dataset.tableAdd = axis;
  button.disabled = disabled;
  button.title = disabled ? `${isRow ? '行' : '列'}数已达上限` : label;
  button.setAttribute('aria-label', button.title);
  const icon = document.createElement('i');
  icon.dataset.lucide = 'plus';
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = isRow ? '行' : '列';
  button.append(icon, text);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    addTableDimension(item, axis);
  });
  return button;
}

function onTableCellFocus(event) {
  const cell = event.target.closest?.('.board-table td, .board-table th');
  const root = cell?.closest('.board-item');
  const item = root && state.items.get(root.dataset.itemId);
  const point = getTableCellCoordinates(cell);
  if (!item || item.type !== 'table' || !point) {
    return;
  }
  state.tableFocus = { itemId: item.id, ...point };
  updateContextPanel();
}

function addTableDimension(item, axis, options = {}) {
  if (!canMutateItem(item) || item.type !== 'table') {
    return false;
  }
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const editing = state.editingId === item.id;
  if (editing && root) {
    syncTableFromDom(root, item);
  }
  const beforeItems = editing ? null : snapshotItems();
  const rowCount = getTableRowCount(item);
  const columnCount = getTableColumnCount(item);
  const isRow = axis === 'row';
  if ((isRow && rowCount >= MAX_TABLE_ROWS) || (!isRow && columnCount >= MAX_TABLE_COLUMNS)) {
    showToast(`${isRow ? '行' : '列'}数已达上限`);
    return false;
  }

  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => String(item.rows?.[rowIndex]?.[columnIndex] || ''))
  );
  let focusCell;
  if (isRow) {
    const insertAt = clamp(Number.isInteger(options.index) ? options.index : rowCount, 0, rowCount);
    window.ConnectorCore.ensureTableIds(item);
    item.rowIds.splice(insertAt, 0, makeId('row'));
    rows.splice(
      insertAt,
      0,
      Array.from({ length: columnCount }, () => '')
    );
    const heights = getTableRowHeights(item, rowCount);
    const referenceHeight = heights[Math.max(0, Math.min(insertAt - 1, heights.length - 1))] || 35;
    heights.splice(insertAt, 0, referenceHeight);
    item.rowHeights = heights;
    item.h = Math.max(
      MIN_TABLE_HEIGHT,
      heights.reduce((sum, height) => sum + height, 0)
    );
    focusCell = { row: insertAt, column: 0 };
  } else {
    const insertAt = clamp(Number.isInteger(options.index) ? options.index : columnCount, 0, columnCount);
    window.ConnectorCore.ensureTableIds(item);
    item.columnIds.splice(insertAt, 0, makeId('column'));
    rows.forEach((row) => row.splice(insertAt, 0, ''));
    const widths = getTableColumnWidths(item, columnCount);
    const referenceWidth = widths[Math.max(0, Math.min(insertAt - 1, widths.length - 1))] || 110;
    widths.splice(insertAt, 0, referenceWidth);
    item.columnWidths = widths;
    item.w = Math.max(
      MIN_ITEM_SIZE,
      widths.reduce((sum, width) => sum + width, 0)
    );
    focusCell = { row: 0, column: insertAt };
  }
  item.rows = rows;
  state.tableFocus = { itemId: item.id, ...focusCell };
  state.items.set(item.id, item);
  clearTableCellSelection(item.id);
  renderItem(item);
  updateContextPanel();

  if (editing) {
    requestAnimationFrame(() => {
      const nextCell = document.querySelector(
        `.board-item[data-item-id="${cssEscape(item.id)}"] [data-row="${focusCell.row}"][data-column="${focusCell.column}"]`
      );
      if (nextCell) {
        nextCell.focus({ preventScroll: true });
        placeCursorAtEnd(nextCell);
      }
    });
  } else {
    pushUndoSnapshot(beforeItems);
    broadcastUpsert(item);
    markDirty(true);
  }
  showToast(isRow ? `已添加第 ${rows.length} 行` : `已添加第 ${getTableColumnCount(item)} 列`);
  return true;
}

function deleteTableDimension(item, axis, focus = state.tableFocus) {
  if (!canMutateItem(item) || item.type !== 'table' || focus?.itemId !== item.id) {
    showToast('请先双击一个单元格，选择要删除的行或列');
    return false;
  }
  const itemId = item.id;
  let beforeItems;
  if (state.editingId === itemId) {
    const editingRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(itemId)}"]`);
    if (editingRoot) {
      syncTableFromDom(editingRoot, item);
    }
    beforeItems = state.editSnapshot ? JSON.parse(JSON.stringify(state.editSnapshot)) : snapshotItems();
    state.editSnapshot = null;
    state.editingId = null;
    state.editingCreatedId = null;
    state.editingUndoDepth = null;
    state.editingHistoryInput = null;
    state.textSelection = null;
    state.tableCellDrag = null;
    clearTableCellSelection(itemId);
  } else {
    beforeItems = snapshotItems();
  }
  const rowCount = getTableRowCount(item);
  const columnCount = getTableColumnCount(item);
  const isRow = axis === 'row';
  if ((isRow && rowCount <= 1) || (!isRow && columnCount <= 1)) {
    showToast(`表格至少需要保留一${isRow ? '行' : '列'}`);
    return false;
  }

  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => String(item.rows?.[rowIndex]?.[columnIndex] || ''))
  );
  const targetIndex = isRow
    ? clamp(Number(focus.row) || 0, 0, rowCount - 1)
    : clamp(Number(focus.column) || 0, 0, columnCount - 1);
  let nextFocus;
  if (isRow) {
    window.ConnectorCore.ensureTableIds(item);
    item.rowIds.splice(targetIndex, 1);
    rows.splice(targetIndex, 1);
    const heights = getTableRowHeights(item, rowCount);
    heights.splice(targetIndex, 1);
    item.rowHeights = heights;
    item.h = Math.max(
      MIN_TABLE_HEIGHT,
      heights.reduce((sum, height) => sum + height, 0)
    );
    nextFocus = {
      row: Math.min(targetIndex, rows.length - 1),
      column: clamp(Number(focus.column) || 0, 0, columnCount - 1)
    };
  } else {
    window.ConnectorCore.ensureTableIds(item);
    item.columnIds.splice(targetIndex, 1);
    rows.forEach((row) => row.splice(targetIndex, 1));
    const widths = getTableColumnWidths(item, columnCount);
    widths.splice(targetIndex, 1);
    item.columnWidths = widths;
    item.w = Math.max(
      MIN_ITEM_SIZE,
      widths.reduce((sum, width) => sum + width, 0)
    );
    nextFocus = {
      row: clamp(Number(focus.row) || 0, 0, rowCount - 1),
      column: Math.min(targetIndex, columnCount - 2)
    };
  }

  item.rows = rows;
  state.tableFocus = { itemId: item.id, ...nextFocus };
  state.items.set(item.id, item);
  clearTableCellSelection(item.id);
  renderItem(item);
  pushUndoSnapshot(beforeItems);
  broadcastUpsert(item);
  markDirty(true);
  selectItem(item.id);
  updateContextPanel();
  showToast(`已删除第 ${targetIndex + 1} ${isRow ? '行' : '列'}，可撤销`);
  return true;
}
export { renderTable, makeTableAddButton, onTableCellFocus, addTableDimension, deleteTableDimension };
