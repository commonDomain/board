'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MAX_SHEETS,
  MAX_DISPLAY_ROWS,
  MAX_DISPLAY_COLUMNS,
  WORKBOOK_SCHEMA_VERSION,
  DEFAULT_STYLE,
  key,
  toRange,
  rangeContains,
  eachRangeCell,
  createSheet,
  createWorkbook,
  normalizeStyle,
  normalizeCell,
  normalizeWorkbook,
  compactWorkbook,
  getCell,
  getStyle,
  internStyle,
  internFormat,
  measureText,
  shiftFormula,
  adoptWorkbook
} = require('./model');
const { createHistory } = require('./history');
const { createCells } = require('./cells');
const { createFill } = require('./fill');
const { createFilter } = require('./filter');
const { createRanges } = require('./ranges');
const { createStructure } = require('./structure');
const { createGeometry } = require('./geometry');
const { createSheets } = require('./sheets');

function createStore(workbookPayload, options = {}) {
  const workbook = adoptWorkbook(workbookPayload, normalizeWorkbook(workbookPayload));

  const evaluator = Formula.createEvaluator(workbook);

  const listeners = new Set();

  const boundsCache = new WeakMap();

  function emit(event) {
    if (event?.type !== 'sheet-activate') boundsCache.delete(activeSheet());
    for (const listener of listeners) {
      try {
        listener(event, workbook);
      } catch (error) {
        // A broken listener must not corrupt the model.
        console.warn('[sheet] listener failed', error);
      }
    }
  }

  function activeSheetIndex() {
    return Math.min(workbook.sheets.length - 1, Math.max(0, workbook.active || 0));
  }

  function activeSheet() {
    return workbook.sheets[activeSheetIndex()];
  }

  function bumpCellVersion(sheet, row, column) {
    if (!sheet.cellVersions || typeof sheet.cellVersions !== 'object') sheet.cellVersions = {};
    const cellKey = key(row, column);
    sheet.cellVersions[cellKey] = Math.max(0, Math.trunc(Number(sheet.cellVersions[cellKey]) || 0)) + 1;
    return sheet.cellVersions[cellKey];
  }

  function bumpStructureVersion(sheet = activeSheet()) {
    if (sheet) sheet.structureVersion = Math.max(0, Math.trunc(Number(sheet.structureVersion) || 0)) + 1;
    workbook.structureVersion = Math.max(0, Math.trunc(Number(workbook.structureVersion) || 0)) + 1;
  }

  function getCellVersion(sheetIndex, row, column) {
    return Math.max(0, Math.trunc(Number(workbook.sheets[sheetIndex]?.cellVersions?.[key(row, column)]) || 0));
  }

  function getStructureVersion(sheetIndex = activeSheetIndex()) {
    return Math.max(0, Math.trunc(Number(workbook.sheets[sheetIndex]?.structureVersion) || 0));
  }

  function usedBounds() {
    const sheet = activeSheet();
    const cached = boundsCache.get(sheet);
    if (cached) return { ...cached };
    let rows = 0;
    let columns = 0;
    for (const cellKey of Object.keys(sheet.cells)) {
      const [row, column] = cellKey.split(':').map(Number);
      if (row + 1 > rows) rows = row + 1;
      if (column + 1 > columns) columns = column + 1;
    }
    for (const merge of sheet.merges) {
      rows = Math.max(rows, merge[2] + 1);
      columns = Math.max(columns, merge[3] + 1);
    }
    const result = {
      rows: Math.min(MAX_DISPLAY_ROWS, rows),
      columns: Math.min(MAX_DISPLAY_COLUMNS, columns)
    };
    boundsCache.set(sheet, result);
    return { ...result };
  }

  function displayBounds() {
    const used = usedBounds();
    return {
      rows: Math.min(MAX_DISPLAY_ROWS, Math.max(used.rows + 200, 400)),
      columns: Math.min(MAX_DISPLAY_COLUMNS, Math.max(used.columns + 26, 78)),
      usedRows: used.rows,
      usedColumns: used.columns
    };
  }

  function isEmpty() {
    return workbook.sheets.every((sheet) => Object.keys(sheet.cells).length === 0);
  }

  function cellCount() {
    return workbook.sheets.reduce((sum, sheet) => sum + Object.keys(sheet.cells).length, 0);
  }

  function searchText(limit = 4000) {
    const parts = [];
    let length = 0;
    for (let sheetIndex = 0; sheetIndex < workbook.sheets.length; sheetIndex += 1) {
      for (const cellKey of Object.keys(workbook.sheets[sheetIndex].cells)) {
        const [row, column] = cellKey.split(':').map(Number);
        const value = getDisplayValue(sheetIndex, row, column);
        if (!value) continue;
        parts.push(value);
        length += value.length + 1;
        if (length >= limit) return parts.join(' ');
      }
    }
    return parts.join(' ');
  }

  // Features share the workbook; callbacks keep history, geometry and notifications synchronized.
  const {
    isMutating,
    snapshot,
    restore,
    mutate,
    cellState,
    mutateCell,
    mutateCommand,
    mutateRange,
    edit,
    canUndo,
    canRedo,
    undo,
    redo,
    clearHistory
  } = createHistory({
    boundsCache,
    bumpCellVersion: (...args) => bumpCellVersion(...args),
    emit: (...args) => emit(...args),
    evaluator,
    invalidateGeometry: (...args) => invalidateGeometry(...args),
    options,
    workbook
  });

  const {
    applyCommand,
    invertCommand,
    applyRemotePatch,
    setCellValue,
    setCellFormula,
    validateCellInput,
    setCellInput,
    getRawCell,
    getEditText,
    getDisplayValue,
    getNumericValue,
    applyStyle,
    applyBorders,
    getStyleOf,
    commonStyle
  } = createCells({
    activeSheet: (...args) => activeSheet(...args),
    activeSheetIndex: (...args) => activeSheetIndex(...args),
    bumpCellVersion: (...args) => bumpCellVersion(...args),
    cellState: (...args) => cellState(...args),
    clearRange: (...args) => clearRange(...args),
    edit: (...args) => edit(...args),
    evaluator,
    getCellVersion: (...args) => getCellVersion(...args),
    getStructureVersion: (...args) => getStructureVersion(...args),
    mutateCell: (...args) => mutateCell(...args),
    mutateRange: (...args) => mutateRange(...args),
    isMutating,
    restore: (...args) => restore(...args),
    snapshot: (...args) => snapshot(...args),
    workbook
  });

  const { seriesValueAt, nextSeriesValue, fillRange, fillDownRange } = createFill({
    activeSheet: (...args) => activeSheet(...args),
    mutate: (...args) => mutate(...args),
    readRange: (...args) => readRange(...args)
  });

  const {
    isRowVisible,
    activeFilters,
    applyFilter,
    clearFilter,
    sortRangeBy,
    rangeHasHeader,
    sortRange,
    findMatches,
    replaceAll,
    escapeRegExp
  } = createFilter({
    activeSheet: (...args) => activeSheet(...args),
    activeSheetIndex: (...args) => activeSheetIndex(...args),
    evaluator,
    getDisplayValue: (...args) => getDisplayValue(...args),
    getRawCell: (...args) => getRawCell(...args),
    mutate: (...args) => mutate(...args),
    setCellInput: (...args) => setCellInput(...args),
    workbook
  });

  const { readRange, writeRange, moveRange, clearRange, insertCells, deleteCells } = createRanges({
    activeSheet: (...args) => activeSheet(...args),
    activeSheetIndex: (...args) => activeSheetIndex(...args),
    bumpStructureVersion: (...args) => bumpStructureVersion(...args),
    evaluator,
    mutate: (...args) => mutate(...args),
    shiftMergesForMove: (...args) => shiftMergesForMove(...args),
    toHtmlTable: (...args) => toHtmlTable(...args),
    toTsv: (...args) => toTsv(...args),
    workbook
  });

  const {
    insertRows,
    deleteRows,
    insertColumns,
    deleteColumns,
    shiftMergesForMove,
    mergeCells,
    unmergeCells,
    mergeAt,
    mergeLookup
  } = createStructure({
    activeSheet: (...args) => activeSheet(...args),
    bumpStructureVersion: (...args) => bumpStructureVersion(...args),
    mutate: (...args) => mutate(...args),
    workbook
  });

  const {
    setRowHeight,
    setColumnWidth,
    autoFitColumn,
    autoFitRow,
    getRowHeight,
    getColumnWidth,
    invalidateGeometry,
    columnOffset,
    rowOffset,
    rowAtOffset,
    columnAtOffset,
    frozenOffsets,
    setFreeze,
    setRowsHidden,
    setColumnsHidden
  } = createGeometry({
    activeSheet: (...args) => activeSheet(...args),
    activeSheetIndex: (...args) => activeSheetIndex(...args),
    bumpStructureVersion: (...args) => bumpStructureVersion(...args),
    getDisplayValue: (...args) => getDisplayValue(...args),
    getStyleOf: (...args) => getStyleOf(...args),
    mutateCommand: (...args) => mutateCommand(...args)
  });

  const {
    addSheet,
    removeSheet,
    renameSheet,
    moveSheet,
    setActiveSheet,
    toTsv,
    toCsv,
    toHtmlTable,
    parseTabular,
    detectDelimiter,
    importText,
    loadMatrix,
    toMatrix,
    matrixForSheet,
    importSheets
  } = createSheets({
    activeSheet: (...args) => activeSheet(...args),
    activeSheetIndex: (...args) => activeSheetIndex(...args),
    bumpStructureVersion: (...args) => bumpStructureVersion(...args),
    emit: (...args) => emit(...args),
    escapeRegExp: (...args) => escapeRegExp(...args),
    evaluator,
    getDisplayValue: (...args) => getDisplayValue(...args),
    mutate: (...args) => mutate(...args),
    setCellFormula: (...args) => setCellFormula(...args),
    setCellValue: (...args) => setCellValue(...args),
    usedBounds: (...args) => usedBounds(...args),
    workbook
  });

  return {
    workbook,
    evaluator,
    DEFAULT_ROW_HEIGHT,
    DEFAULT_COLUMN_WIDTH,
    MIN_ROW_HEIGHT,
    MAX_ROW_HEIGHT,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    MAX_DISPLAY_ROWS,
    MAX_DISPLAY_COLUMNS,
    // lifecycle
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      clearHistory();
    },
    // sheets
    activeSheetIndex,
    activeSheet,
    addSheet,
    removeSheet,
    renameSheet,
    moveSheet,
    setActiveSheet,
    // reads
    getRawCell,
    getEditText,
    getDisplayValue,
    getNumericValue,
    getCellVersion,
    getStructureVersion,
    getStyleOf,
    commonStyle,
    readRange,
    toTsv,
    toCsv,
    toHtmlTable,
    toMatrix,
    matrixForSheet,
    usedBounds,
    displayBounds,
    isEmpty,
    cellCount,
    searchText,
    // edits
    setCellValue,
    setCellFormula,
    setCellInput,
    validateCellInput,
    applyStyle,
    applyBorders,
    clearRange,
    insertCells,
    deleteCells,
    writeRange,
    moveRange,
    fillRange,
    fillDownRange,
    nextSeriesValue,
    seriesValueAt,
    importText,
    loadMatrix,
    importSheets,
    parseTabular,
    detectDelimiter,
    // structure
    insertRows,
    deleteRows,
    insertColumns,
    deleteColumns,
    setRowHeight,
    setColumnWidth,
    autoFitColumn,
    autoFitRow,
    setFreeze,
    setRowsHidden,
    setColumnsHidden,
    mergeCells,
    unmergeCells,
    mergeAt,
    mergeLookup,
    sortRange,
    sortRangeBy,
    rangeHasHeader,
    applyFilter,
    clearFilter,
    activeFilters,
    isRowVisible,
    findMatches,
    replaceAll,
    // geometry
    getRowHeight,
    getColumnWidth,
    rowOffset,
    columnOffset,
    rowAtOffset,
    columnAtOffset,
    frozenOffsets,
    invalidateGeometry,
    // history
    applyCommand,
    invertCommand,
    applyRemotePatch,
    mutate,
    edit,
    snapshot,
    restore,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory
  };
}

module.exports = {
  createWorkbook,
  createStore,
  adoptWorkbook,
  normalizeWorkbook,
  compactWorkbook,
  normalizeCell,
  normalizeStyle,
  createSheet,
  getCell,
  getStyle,
  internStyle,
  internFormat,
  measureText,
  shiftFormula,
  key,
  toRange,
  rangeContains,
  eachRangeCell,
  DEFAULT_STYLE,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MAX_SHEETS,
  MAX_DISPLAY_ROWS,
  MAX_DISPLAY_COLUMNS,
  WORKBOOK_SCHEMA_VERSION
};
