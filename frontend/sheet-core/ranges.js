'use strict';

const {
  MAX_DISPLAY_COLUMNS,
  MAX_DISPLAY_ROWS,
  eachRangeCell,
  getCell,
  key,
  shiftFormula,
  toRange
} = require('./model');

function createRanges({
  activeSheet,
  activeSheetIndex,
  bumpStructureVersion,
  evaluator,
  mutate,
  shiftMergesForMove,
  toHtmlTable,
  toTsv,
  workbook
}) {
  function readRange(range) {
    const sheetIndex = activeSheetIndex();
    const cells = [];
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      const line = [];
      for (let column = range.startColumn; column <= range.endColumn; column += 1) {
        const cell = getCell(workbook, sheetIndex, row, column);
        line.push(cell ? JSON.parse(JSON.stringify(cell)) : null);
      }
      cells.push(line);
    }
    return {
      width: range.endColumn - range.startColumn + 1,
      height: range.endRow - range.startRow + 1,
      cells,
      text: toTsv(range),
      html: toHtmlTable(range)
    };
  }

  function writeRange(startRow, startColumn, payload, options = {}) {
    return mutate('paste', () => {
      const sheet = activeSheet();
      const sheetIndex = activeSheetIndex();
      const source = payload && Array.isArray(payload.cells) ? payload.cells : null;
      if (!source || !source.length) return 0;
      const originRow = options.originRow || 0;
      const originColumn = options.originColumn || 0;
      const fill = source.length === 1 && source[0].length === 1 && options.fill === true;
      let written = 0;
      const rowCount = fill ? options.height || 1 : source.length;
      const columnCount = fill ? options.width || 1 : Math.max(...source.map((line) => line.length));
      for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
          const sourceRow = fill ? 0 : rowOffset % source.length;
          const sourceLine = source[sourceRow] || [];
          const sourceCell = fill ? source[0][0] : sourceLine[columnOffset % Math.max(1, sourceLine.length)];
          const targetRow = startRow + rowOffset;
          const targetColumn = startColumn + columnOffset;
          const cellKey = key(targetRow, targetColumn);
          if (!sourceCell) {
            delete sheet.cells[cellKey];
            written += 1;
            continue;
          }
          const next = {};
          // Deltas are per-target, not per-call: filling a single cell across
          // a range must shift the formula for every destination.
          if (sourceCell.f) next.f = shiftFormula(sourceCell.f, targetRow - originRow, targetColumn - originColumn);
          else if (sourceCell.v !== undefined) next.v = sourceCell.v;
          if (sourceCell.s) next.s = sourceCell.s;
          if (next.f === undefined && next.v === undefined) delete sheet.cells[cellKey];
          else sheet.cells[cellKey] = next;
          written += 1;
        }
      }
      return written;
    });
  }

  function moveRange(range, destinationRow, destinationColumn) {
    const payload = readRange(range);
    const rowDelta = destinationRow - range.startRow;
    const columnDelta = destinationColumn - range.startColumn;
    return mutate('move', () => {
      const sheet = activeSheet();
      eachRangeCell(range, (row, column) => {
        delete sheet.cells[key(row, column)];
      });
      for (let offsetRow = 0; offsetRow < payload.height; offsetRow += 1) {
        for (let offsetColumn = 0; offsetColumn < payload.width; offsetColumn += 1) {
          const sourceCell = payload.cells[offsetRow][offsetColumn];
          if (!sourceCell) continue;
          const cell = {};
          if (sourceCell.f) cell.f = shiftFormula(sourceCell.f, rowDelta, columnDelta);
          else if (sourceCell.v !== undefined) cell.v = sourceCell.v;
          if (sourceCell.s) cell.s = sourceCell.s;
          sheet.cells[key(destinationRow + offsetRow, destinationColumn + offsetColumn)] = cell;
        }
      }
      shiftMergesForMove(range, rowDelta, columnDelta);
      return true;
    });
  }

  function clearRange(range, mode = 'all') {
    return mutate('clear', () => {
      const sheet = activeSheet();
      eachRangeCell(range, (row, column) => {
        const cellKey = key(row, column);
        const cell = sheet.cells[cellKey];
        if (!cell) return;
        if (mode === 'content') {
          delete cell.v;
          delete cell.f;
          if (!cell.s) delete sheet.cells[cellKey];
        } else if (mode === 'format') {
          delete cell.s;
          if (cell.v === undefined && cell.f === undefined) delete sheet.cells[cellKey];
        } else if (mode === 'data') {
          // Keep formulas, but remove literal values. Formula cells may carry a
          // cached value from an import, which must be discarded as well.
          if (cell.f) delete cell.v;
          else delete sheet.cells[cellKey];
        } else if (mode === 'formula') {
          // Materialize the calculated result before removing the formula so
          // “clear formula, keep value” behaves like its spreadsheet peer.
          const calculated = cell.f ? evaluator.getValue(activeSheetIndex(), row, column) : undefined;
          delete cell.f;
          if (calculated !== undefined && calculated !== null) cell.v = calculated;
          if (cell.v === undefined && !cell.s) delete sheet.cells[cellKey];
        } else {
          delete sheet.cells[cellKey];
        }
      });
      return true;
    });
  }

  function insertCells(range, direction = 'right') {
    const normalized = toRange(range.startRow, range.startColumn, range.endRow, range.endColumn);
    const rowCount = normalized.endRow - normalized.startRow + 1;
    const columnCount = normalized.endColumn - normalized.startColumn + 1;
    return mutate(`insert-cells-${direction}`, () => {
      const sheet = activeSheet();
      const output = {};
      for (const [cellKey, cell] of Object.entries(sheet.cells)) {
        let [row, column] = cellKey.split(':').map(Number);
        if (
          direction === 'down' &&
          column >= normalized.startColumn &&
          column <= normalized.endColumn &&
          row >= normalized.startRow
        )
          row += rowCount;
        else if (
          direction === 'right' &&
          row >= normalized.startRow &&
          row <= normalized.endRow &&
          column >= normalized.startColumn
        )
          column += columnCount;
        if (row < MAX_DISPLAY_ROWS && column < MAX_DISPLAY_COLUMNS) output[key(row, column)] = cell;
      }
      sheet.cells = output;
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function deleteCells(range, direction = 'left') {
    const normalized = toRange(range.startRow, range.startColumn, range.endRow, range.endColumn);
    const rowCount = normalized.endRow - normalized.startRow + 1;
    const columnCount = normalized.endColumn - normalized.startColumn + 1;
    return mutate(`delete-cells-${direction}`, () => {
      const sheet = activeSheet();
      const output = {};
      for (const [cellKey, cell] of Object.entries(sheet.cells)) {
        let [row, column] = cellKey.split(':').map(Number);
        const inRange =
          row >= normalized.startRow &&
          row <= normalized.endRow &&
          column >= normalized.startColumn &&
          column <= normalized.endColumn;
        if (inRange) continue;
        if (
          direction === 'up' &&
          column >= normalized.startColumn &&
          column <= normalized.endColumn &&
          row > normalized.endRow
        )
          row -= rowCount;
        else if (
          direction === 'left' &&
          row >= normalized.startRow &&
          row <= normalized.endRow &&
          column > normalized.endColumn
        )
          column -= columnCount;
        output[key(row, column)] = cell;
      }
      sheet.cells = output;
      bumpStructureVersion(sheet);
      return true;
    });
  }

  return { readRange, writeRange, moveRange, clearRange, insertCells, deleteCells };
}

module.exports = { createRanges };
