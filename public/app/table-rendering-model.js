import { MIN_ITEM_SIZE, MIN_TABLE_COLUMN_WIDTH, MIN_TABLE_HEIGHT, MIN_ZOOM } from './constants.js';
import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';

function getNormalizedTableCellSelection(selection = state.tableCellSelection) {
  if (!selection?.start || !selection?.end) {
    return null;
  }
  return {
    itemId: selection.itemId,
    startRow: Math.min(selection.start.row, selection.end.row),
    endRow: Math.max(selection.start.row, selection.end.row),
    startColumn: Math.min(selection.start.column, selection.end.column),
    endColumn: Math.max(selection.start.column, selection.end.column)
  };
}

function isTableCellSelected(itemId, row, column) {
  const selection = getNormalizedTableCellSelection();
  return Boolean(
    selection &&
    selection.itemId === itemId &&
    row >= selection.startRow &&
    row <= selection.endRow &&
    column >= selection.startColumn &&
    column <= selection.endColumn
  );
}

function updateTableCellSelectionClasses(itemId) {
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(itemId)}"]`);
  if (!root) {
    return;
  }
  root.querySelectorAll('.board-table td, .board-table th').forEach((cell) => {
    const selected = isTableCellSelected(itemId, Number(cell.dataset.row), Number(cell.dataset.column));
    cell.classList.toggle('table-cell-selected', selected);
    if (selected) {
      cell.setAttribute('aria-selected', 'true');
    } else {
      cell.removeAttribute('aria-selected');
    }
  });
}

function clearTableCellSelection(itemId = null) {
  const previousItemId = state.tableCellSelection?.itemId;
  if (itemId && previousItemId && previousItemId !== itemId) {
    return;
  }
  state.tableCellSelection = null;
  if (previousItemId) {
    updateTableCellSelectionClasses(previousItemId);
  }
}

function getTableCellCoordinates(cell) {
  if (!cell) {
    return null;
  }
  const row = Number(cell.dataset.row);
  const column = Number(cell.dataset.column);
  return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
}

function getTableColumnCount(item) {
  const rows = Array.isArray(item.rows) && item.rows.length ? item.rows : [['', '', '']];
  return Math.max(1, ...rows.map((row) => row.length));
}

function getTableRowCount(itemOrRows) {
  if (Array.isArray(itemOrRows)) {
    return Math.max(1, itemOrRows.length);
  }
  const rows = Array.isArray(itemOrRows?.rows) && itemOrRows.rows.length ? itemOrRows.rows : [['', '', '']];
  return Math.max(1, rows.length);
}

function getTableHeightForRows(rowCountOrRows) {
  const rowCount = getTableRowCount(rowCountOrRows);
  return clamp(rowCount * 35 + 10, MIN_TABLE_HEIGHT, 520);
}

function getTableRowHeights(item, rowCount) {
  const targetHeight = Math.max(MIN_TABLE_HEIGHT, Number(item.h) || getTableHeightForRows(rowCount));
  const rawHeights = Array.isArray(item.rowHeights) ? item.rowHeights.slice(0, rowCount) : [];
  const fallbackHeight = Math.max(34, Math.round(targetHeight / rowCount));
  while (rawHeights.length < rowCount) {
    rawHeights.push(fallbackHeight);
  }
  let heights = rawHeights.map((height) => Math.max(34, Number(height) || fallbackHeight));
  const currentTotal = heights.reduce((sum, height) => sum + height, 0);
  if (currentTotal <= 0) {
    return Array.from({ length: rowCount }, () => fallbackHeight);
  }
  if (Math.abs(currentTotal - targetHeight) < rowCount) {
    return heights;
  }
  const scale = targetHeight / currentTotal;
  heights = heights.map((height) => Math.max(34, Math.round(height * scale)));
  const diff = targetHeight - heights.reduce((sum, height) => sum + height, 0);
  heights[heights.length - 1] = Math.max(34, heights[heights.length - 1] + diff);
  return heights;
}

function getTableColumnWidths(item, columnCount) {
  const targetWidth = Math.max(
    MIN_ITEM_SIZE,
    Number(item.w) || columnCount * 120,
    columnCount * MIN_TABLE_COLUMN_WIDTH
  );
  const rawWidths = Array.isArray(item.columnWidths) ? item.columnWidths.slice(0, columnCount) : [];
  const fallbackWidth = Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(targetWidth / columnCount));
  while (rawWidths.length < columnCount) {
    rawWidths.push(fallbackWidth);
  }
  let widths = rawWidths.map((width) => Math.max(MIN_TABLE_COLUMN_WIDTH, Number(width) || fallbackWidth));
  const currentTotal = widths.reduce((sum, width) => sum + width, 0);
  if (currentTotal <= 0) {
    return Array.from({ length: columnCount }, () => fallbackWidth);
  }
  if (Math.abs(currentTotal - targetWidth) < columnCount) {
    return widths;
  }
  const scale = targetWidth / currentTotal;
  widths = widths.map((width) => Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(width * scale)));
  const diff = targetWidth - widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.max(MIN_TABLE_COLUMN_WIDTH, widths[widths.length - 1] + diff);
  return widths;
}

function syncTableFromDom(itemElement, item) {
  const rows = Array.from(itemElement.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) => cell.textContent.trim())
  );
  item.rows = rows;
  const columnCount = getTableColumnCount(item);
  const rowCount = getTableRowCount(item);
  const widths = Array.from(itemElement.querySelectorAll('col')).map((col) => {
    const logicalWidth =
      Number.parseFloat(col.style.width) || col.getBoundingClientRect().width / Math.max(state.zoom, MIN_ZOOM);
    const measured = Math.round(logicalWidth || 0);
    return Math.max(MIN_TABLE_COLUMN_WIDTH, measured);
  });
  item.columnWidths = widths.length ? widths.slice(0, columnCount) : getTableColumnWidths(item, columnCount);
  const heights = Array.from(itemElement.querySelectorAll('tr')).map((row) => {
    const logicalHeight =
      Number.parseFloat(row.style.height) || row.getBoundingClientRect().height / Math.max(state.zoom, MIN_ZOOM);
    const measured = Math.round(logicalHeight || 0);
    return Math.max(34, measured);
  });
  item.rowHeights = heights.length ? heights.slice(0, rowCount) : getTableRowHeights(item, rowCount);
  if (!Number.isFinite(item.h) || item.h < MIN_TABLE_HEIGHT) {
    item.h = getTableHeightForRows(rows);
  } else if (Array.isArray(item.rowHeights) && item.rowHeights.length) {
    item.h = Math.max(
      MIN_TABLE_HEIGHT,
      item.rowHeights.reduce((sum, height) => sum + height, 0)
    );
  }
}
export {
  getNormalizedTableCellSelection,
  isTableCellSelected,
  updateTableCellSelectionClasses,
  clearTableCellSelection,
  getTableCellCoordinates,
  getTableColumnCount,
  getTableRowCount,
  getTableHeightForRows,
  getTableRowHeights,
  getTableColumnWidths,
  syncTableFromDom
};
