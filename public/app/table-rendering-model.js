import { MIN_ITEM_SIZE, MIN_TABLE_COLUMN_WIDTH, MIN_TABLE_HEIGHT, MIN_ZOOM } from './constants.js';
import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';
import { serializeRichTextRuns, matchingRichText } from './text-rendering-model.js';

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
  window.ConnectorCore.ensureTableIds(item);
  const richText = {};
  const rows = Array.from(itemElement.querySelectorAll('tr')).map((row, rowIndex) =>
    Array.from(row.children).map((cell, columnIndex) => {
      const runs = serializeRichTextRuns(cell, item);
      richText[tableCellRichKey(item, rowIndex, columnIndex)] = runs;
      return runs.map(run => run.text).join('');
    })
  );
  item.rows = rows;
  item.cellRichText = richText;
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
  fitTableToContent(item, itemElement);
}

function tableCellRichKey(item, row, column) {
  return `${item.rowIds?.[row]}/${item.columnIds?.[column]}`;
}

function tableCellRuns(item, row, column) {
  return matchingRichText(item.cellRichText?.[tableCellRichKey(item, row, column)], item.rows?.[row]?.[column]);
}

// Moving, regrouping or exporting a table does not change its natural row
// heights. Cache the normalized probe, but still apply requested row minima.
const tableMeasurements = new Map();
let tableMeasurementFonts = 0;
if (typeof document !== 'undefined' && document.fonts?.addEventListener)
  document.fonts.addEventListener('loadingdone', () => { tableMeasurementFonts++; tableMeasurements.clear(); });

function fitTableToContent(item, root) {
  const table = root?.querySelector('.board-table');
  if (!table) return;
  const widths = getTableColumnWidths(item, getTableColumnCount(item));
  const probe = table.cloneNode(true);
  Object.assign(probe.style, { position:'fixed',left:'-100000px',top:'0',visibility:'hidden',height:'auto',width:`${widths.reduce((a,b)=>a+b,0)}px`,fontSize:table.style.fontSize,fontFamily:table.style.fontFamily });
  probe.querySelectorAll('col').forEach((col, i) => { col.style.width = `${widths[i]}px`; });
  probe.querySelectorAll('tr').forEach(row => { row.style.height = 'auto'; });
  const rootElement = document.documentElement;
  const key = `${tableMeasurementFonts}|${globalThis.devicePixelRatio || 1}|${rootElement.dataset.formFactor || ''}|${rootElement.dataset.theme || ''}|${rootElement.className}|${probe.outerHTML}`;
  try {
    let measurement = tableMeasurements.get(key);
    if (!measurement) {
      document.body.appendChild(probe);
      // CSS min-content respects grapheme clusters and mixed fonts, allowing
      // wrapping between glyphs without ever clipping a single glyph.
      probe.style.tableLayout = 'auto'; probe.style.width = 'min-content';
      probe.querySelectorAll('col').forEach(col => { col.style.width = 'auto'; });
      const minimumWidths = widths.map((value,i) => Math.max(MIN_TABLE_COLUMN_WIDTH, ...[...probe.rows].map(row => row.cells[i]?.offsetWidth || 0)) + 2);
      widths.forEach((value,i) => { widths[i] = Math.max(value,minimumWidths[i]); });
      probe.style.tableLayout = 'fixed'; probe.style.width = `${widths.reduce((a,b)=>a+b,0)}px`;
      probe.querySelectorAll('col').forEach((col,i) => { col.style.width = `${widths[i]}px`; });
      measurement = { minimumWidths, heights:[...probe.rows].map(row => row.offsetHeight + 2) };
      if (tableMeasurements.size >= 512) tableMeasurements.delete(tableMeasurements.keys().next().value);
      tableMeasurements.set(key, measurement);
    }
    widths.forEach((value,i) => { widths[i] = Math.max(value,measurement.minimumWidths[i]); });
    const heights = getTableRowHeights(item, getTableRowCount(item));
    item.rowHeights = measurement.heights.map((height, i) => Math.max(heights[i] || 34, height));
    item.columnWidths = widths;
    item.h = item.rowHeights.reduce((a,b)=>a+b,0);
    item.w = widths.reduce((a,b)=>a+b,0);
    [...table.rows].forEach((row,i) => { row.style.height = `${item.rowHeights[i]}px`; });
    table.style.height = `${item.h}px`;
    table.style.width = `${item.w}px`;
    table.querySelectorAll('col').forEach((col,i)=>{col.style.width=`${widths[i]}px`;});
    const node = root.matches('.board-item') ? root : root.closest('.board-item');
    if (node) { node.style.width = `${item.w}px`; node.style.height = `${item.h}px`; }
  } finally { probe.remove(); }
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
  syncTableFromDom,
  tableCellRichKey,
  tableCellRuns,
  fitTableToContent
};
