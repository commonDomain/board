'use strict';

const {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MAX_COLUMN_WIDTH,
  MAX_DISPLAY_COLUMNS,
  MAX_DISPLAY_ROWS,
  MAX_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  clampNumber,
  measureText
} = require('./model');

function createGeometry({
  activeSheet,
  activeSheetIndex,
  bumpStructureVersion,
  getDisplayValue,
  getStyleOf,
  mutateCommand
}) {
  function setRowHeight(row, height, options) {
    const sheet = activeSheet();
    const before = Object.hasOwn(sheet.rows, row) ? sheet.rows[row] : undefined;
    const after = Math.round(clampNumber(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_ROW_HEIGHT));
    const apply = (value) => {
      if (value === undefined) delete sheet.rows[row];
      else sheet.rows[row] = value;
      invalidateGeometry();
      return true;
    };
    if (options?.history === false) return apply(after);
    return mutateCommand(
      'row-height',
      () => apply(after),
      () => apply(before)
    );
  }

  function setColumnWidth(column, width, options) {
    const sheet = activeSheet();
    const before = Object.hasOwn(sheet.cols, column) ? sheet.cols[column] : undefined;
    const after = Math.round(clampNumber(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH));
    const apply = (value) => {
      if (value === undefined) delete sheet.cols[column];
      else sheet.cols[column] = value;
      invalidateGeometry();
      return true;
    };
    if (options?.history === false) return apply(after);
    return mutateCommand(
      'column-width',
      () => apply(after),
      () => apply(before)
    );
  }

  function autoFitColumn(column, rows) {
    const sheetIndex = activeSheetIndex();
    let width = MIN_COLUMN_WIDTH;
    const limit = Math.min(Number(rows) || 200, 2000);
    for (let row = 0; row < limit; row += 1) {
      const text = getDisplayValue(sheetIndex, row, column);
      if (!text) continue;
      width = Math.max(width, measureText(text, getStyleOf(sheetIndex, row, column).size || 13) + 18);
    }
    return setColumnWidth(column, Math.min(MAX_COLUMN_WIDTH, width));
  }

  function autoFitRow(row, columns) {
    const sheetIndex = activeSheetIndex();
    let height = DEFAULT_ROW_HEIGHT;
    const limit = Math.min(Number(columns) || 40, MAX_DISPLAY_COLUMNS);
    for (let column = 0; column < limit; column += 1) {
      const text = getDisplayValue(sheetIndex, row, column);
      if (!text) continue;
      const width = getColumnWidth(column) - 12;
      const needed = Math.max(
        1,
        Math.ceil(measureText(text, getStyleOf(sheetIndex, row, column).size || 13) / Math.max(20, width))
      );
      height = Math.max(height, needed * 20 + 8);
    }
    return setRowHeight(row, Math.min(MAX_ROW_HEIGHT, height));
  }

  function getRowHeight(row) {
    const sheet = activeSheet();
    return sheet.hiddenRows?.[row] ? 0 : sheet.rows[row] || DEFAULT_ROW_HEIGHT;
  }

  function getColumnWidth(column) {
    const sheet = activeSheet();
    return sheet.hiddenColumns?.[column] ? 0 : sheet.cols[column] || DEFAULT_COLUMN_WIDTH;
  }

  const offsetCache = {
    sheet: -1,
    version: -1,
    overrideKey: '',
    rows: null,
    columns: null,
    rowCount: 0,
    columnCount: 0,
    frozenWidth: 0,
    frozenHeight: 0
  };

  let geometryVersion = 0;

  function invalidateGeometry() {
    geometryVersion += 1;
  }

  function columnOffset(column, count, sizeOverride) {
    ensureOffsets(count, sizeOverride);
    const offsets = offsetCache.columns;
    if (column <= 0) return 0;
    if (column >= offsets.length)
      return offsets[offsets.length - 1] + (column - offsets.length + 1) * DEFAULT_COLUMN_WIDTH;
    return offsets[column];
  }

  function rowOffset(row, count, sizeOverride) {
    ensureOffsets(count, sizeOverride);
    const offsets = offsetCache.rows;
    if (row <= 0) return 0;
    if (row >= offsets.length) return offsets[offsets.length - 1] + (row - offsets.length + 1) * DEFAULT_ROW_HEIGHT;
    return offsets[row];
  }

  function ensureOffsets(count, sizeOverride) {
    const sheetIndex = activeSheetIndex();
    const needed = Math.max(1000, Number(count) || 0);
    const overrideKey = sizeOverride ? `${sizeOverride.axis}:${sizeOverride.index}:${sizeOverride.size}` : '';
    if (
      offsetCache.sheet === sheetIndex &&
      offsetCache.version === geometryVersion &&
      offsetCache.overrideKey === overrideKey &&
      offsetCache.rowCount >= needed
    )
      return;
    const sheet = activeSheet();
    const widthOf = (index) =>
      sizeOverride && sizeOverride.axis === 'column' && sizeOverride.index === index
        ? sizeOverride.size
        : sheet.hiddenColumns?.[index]
          ? 0
          : sheet.cols[index] || DEFAULT_COLUMN_WIDTH;
    const heightOf = (index) =>
      sizeOverride && sizeOverride.axis === 'row' && sizeOverride.index === index
        ? sizeOverride.size
        : sheet.hiddenRows?.[index]
          ? 0
          : sheet.rows[index] || DEFAULT_ROW_HEIGHT;
    const rows = new Array(needed + 2);
    const columns = new Array(needed + 2);
    let total = 0;
    for (let index = 0; index <= needed + 1; index += 1) {
      rows[index] = total;
      total += heightOf(index);
    }
    total = 0;
    for (let index = 0; index <= needed + 1; index += 1) {
      columns[index] = total;
      total += widthOf(index);
    }
    offsetCache.sheet = sheetIndex;
    offsetCache.version = geometryVersion;
    offsetCache.overrideKey = overrideKey;
    offsetCache.rows = rows;
    offsetCache.columns = columns;
    offsetCache.rowCount = needed + 2;
    offsetCache.columnCount = needed + 2;
    const frozenRows = Math.min(sheet.frozen.rows, 32);
    const frozenCols = Math.min(sheet.frozen.cols, 32);
    offsetCache.frozenHeight = rows[Math.min(frozenRows, rows.length - 1)] || 0;
    offsetCache.frozenWidth = columns[Math.min(frozenCols, columns.length - 1)] || 0;
  }

  function rowAtOffset(y, count) {
    return axisAtOffset('rows', y, count);
  }

  function columnAtOffset(x, count) {
    return axisAtOffset('columns', x, count);
  }

  function axisAtOffset(which, position, count) {
    ensureOffsets(count);
    const offsets = offsetCache[which];
    let low = 0;
    let high = Math.min(offsets.length - 1, Math.max(1, Number(count) || offsets.length - 1));
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (offsets[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function frozenOffsets(count) {
    const sheet = activeSheet();
    const rows = Math.min(sheet.frozen.rows, 32);
    const cols = Math.min(sheet.frozen.cols, 32);
    return {
      rows,
      cols,
      width: columnOffset(cols, count),
      height: rowOffset(rows, count)
    };
  }

  function setFreeze(rows, cols) {
    const sheet = activeSheet();
    const before = { ...sheet.frozen };
    const after = { rows: Math.trunc(clampNumber(rows, 0, 64, 0)), cols: Math.trunc(clampNumber(cols, 0, 64, 0)) };
    const apply = (value) => {
      sheet.frozen = { ...value };
      invalidateGeometry();
      return true;
    };
    return mutateCommand(
      'freeze',
      () => apply(after),
      () => apply(before)
    );
  }

  function setRowsHidden(startRow, endRow, hidden = true) {
    const sheet = activeSheet();
    const first = Math.max(0, startRow);
    const last = Math.min(MAX_DISPLAY_ROWS - 1, endRow);
    const before = [];
    for (let row = first; row <= last; row += 1) before.push(Boolean(sheet.hiddenRows?.[row]));
    const apply = (mode, previous = null) => {
      const map = { ...(sheet.hiddenRows || {}) };
      for (let row = first; row <= last; row += 1) {
        const value = previous ? previous[row - first] : mode;
        if (value) map[row] = true;
        else delete map[row];
      }
      sheet.hiddenRows = Object.keys(map).length ? map : null;
      invalidateGeometry();
      bumpStructureVersion(sheet);
      return true;
    };
    return mutateCommand(
      hidden ? 'hide-rows' : 'unhide-rows',
      () => apply(hidden),
      () => apply(false, before),
      before.length + 128
    );
  }

  function setColumnsHidden(startColumn, endColumn, hidden = true) {
    const sheet = activeSheet();
    const first = Math.max(0, startColumn);
    const last = Math.min(MAX_DISPLAY_COLUMNS - 1, endColumn);
    const before = [];
    for (let column = first; column <= last; column += 1) before.push(Boolean(sheet.hiddenColumns?.[column]));
    const apply = (mode, previous = null) => {
      const map = { ...(sheet.hiddenColumns || {}) };
      for (let column = first; column <= last; column += 1) {
        const value = previous ? previous[column - first] : mode;
        if (value) map[column] = true;
        else delete map[column];
      }
      sheet.hiddenColumns = Object.keys(map).length ? map : null;
      invalidateGeometry();
      bumpStructureVersion(sheet);
      return true;
    };
    return mutateCommand(
      hidden ? 'hide-columns' : 'unhide-columns',
      () => apply(hidden),
      () => apply(false, before),
      before.length + 128
    );
  }

  return {
    setRowHeight,
    setColumnWidth,
    autoFitColumn,
    autoFitRow,
    getRowHeight,
    getColumnWidth,
    invalidateGeometry,
    columnOffset,
    rowOffset,
    ensureOffsets,
    rowAtOffset,
    columnAtOffset,
    axisAtOffset,
    frozenOffsets,
    setFreeze,
    setRowsHidden,
    setColumnsHidden
  };
}

module.exports = { createGeometry };
