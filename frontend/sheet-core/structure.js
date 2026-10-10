'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { eachRangeCell, key } = require('./model');

function createStructure({ activeSheet, bumpStructureVersion, mutate, workbook }) {
  function insertRows(beforeRow, count = 1) {
    return mutate('insert-rows', () => {
      const sheet = activeSheet();
      sheet.cells = shiftCells(sheet.cells, 'row', beforeRow, count, false);
      sheet.rows = shiftAxisMap(sheet.rows, beforeRow, count, false);
      sheet.merges = shiftMerges(sheet.merges, 'row', beforeRow, count, false);
      rewriteAllFormulas('row', beforeRow, count, false);
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function deleteRows(startRow, count = 1) {
    return mutate('delete-rows', () => {
      const sheet = activeSheet();
      sheet.cells = shiftCells(sheet.cells, 'row', startRow, count, true);
      sheet.rows = shiftAxisMap(sheet.rows, startRow, count, true);
      sheet.merges = shiftMerges(sheet.merges, 'row', startRow, count, true);
      rewriteAllFormulas('row', startRow, count, true);
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function insertColumns(beforeColumn, count = 1) {
    return mutate('insert-columns', () => {
      const sheet = activeSheet();
      sheet.cells = shiftCells(sheet.cells, 'column', beforeColumn, count, false);
      sheet.cols = shiftAxisMap(sheet.cols, beforeColumn, count, false);
      sheet.merges = shiftMerges(sheet.merges, 'column', beforeColumn, count, false);
      rewriteAllFormulas('column', beforeColumn, count, false);
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function deleteColumns(startColumn, count = 1) {
    return mutate('delete-columns', () => {
      const sheet = activeSheet();
      sheet.cells = shiftCells(sheet.cells, 'column', startColumn, count, true);
      sheet.cols = shiftAxisMap(sheet.cols, startColumn, count, true);
      sheet.merges = shiftMerges(sheet.merges, 'column', startColumn, count, true);
      rewriteAllFormulas('column', startColumn, count, true);
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function shiftCells(cells, axis, start, count, removing) {
    const output = {};
    for (const [cellKey, cell] of Object.entries(cells)) {
      const [row, column] = cellKey.split(':').map(Number);
      const position = axis === 'row' ? row : column;
      if (removing && position >= start && position < start + count) continue;
      const next = position >= start ? position + (removing ? -count : count) : position;
      const nextRow = axis === 'row' ? next : row;
      const nextColumn = axis === 'column' ? next : column;
      if (nextRow < 0 || nextColumn < 0) continue;
      output[key(nextRow, nextColumn)] = cell;
    }
    return output;
  }

  function shiftAxisMap(map, start, count, removing) {
    const output = {};
    for (const [positionKey, value] of Object.entries(map)) {
      const position = Number(positionKey);
      if (removing && position >= start && position < start + count) continue;
      const next = position >= start ? position + (removing ? -count : count) : position;
      if (next < 0) continue;
      output[next] = value;
    }
    return output;
  }

  function shiftMerges(merges, axis, start, count, removing) {
    const startIndex = axis === 'row' ? 0 : 1;
    const endIndex = axis === 'row' ? 2 : 3;
    const output = [];
    for (const merge of merges) {
      let mergeStart = merge[startIndex];
      let mergeEnd = merge[endIndex];
      if (removing) {
        const removalEnd = start + count - 1;
        if (mergeStart >= start && mergeEnd <= removalEnd) continue; // fully removed
        if (mergeStart > removalEnd) {
          mergeStart -= count;
          mergeEnd -= count;
        } else if (mergeEnd >= start) {
          mergeEnd = Math.max(mergeStart, mergeEnd - count);
        }
      } else {
        if (mergeStart >= start) {
          mergeStart += count;
          mergeEnd += count;
        } else if (mergeEnd >= start) mergeEnd += count;
      }
      const next = [...merge];
      next[startIndex] = mergeStart;
      next[endIndex] = mergeEnd;
      output.push(next);
    }
    return output;
  }

  function shiftMergesForMove(range, rowDelta, columnDelta) {
    const sheet = activeSheet();
    sheet.merges = sheet.merges.map((merge) => {
      const inside =
        merge[0] >= range.startRow &&
        merge[1] >= range.startColumn &&
        merge[2] <= range.endRow &&
        merge[3] <= range.endColumn;
      if (!inside) return merge;
      return [merge[0] + rowDelta, merge[1] + columnDelta, merge[2] + rowDelta, merge[3] + columnDelta];
    });
  }

  function rewriteAllFormulas(axis, start, count, removing) {
    const editedName = activeSheet().name;
    for (const sheet of workbook.sheets) {
      const isEditedSheet = sheet === activeSheet();
      for (const cell of Object.values(sheet.cells)) {
        if (!cell.f) continue;
        const next = Formula.rewriteReferences(
          cell.f,
          (range) =>
            targetsEditedSheet(range.sheet, editedName, isEditedSheet)
              ? mapRangeReference(range, axis, start, count, removing)
              : undefined,
          (reference) =>
            targetsEditedSheet(reference.sheet, editedName, isEditedSheet)
              ? mapCellReference(reference, axis, start, count, removing)
              : undefined
        );
        if (next !== cell.f) cell.f = next;
      }
    }
  }

  function targetsEditedSheet(referenceSheet, editedName, isEditedSheet) {
    if (!referenceSheet) return isEditedSheet;
    return String(referenceSheet).toUpperCase() === String(editedName).toUpperCase();
  }

  function mapPosition(position, start, count, removing) {
    if (removing) {
      if (position >= start && position < start + count) return null;
      return position >= start ? position - count : position;
    }
    return position >= start ? position + count : position;
  }

  function anchoredRefText(sourceText, row, column) {
    const text = String(sourceText || '');
    const columnAbsolute = text.startsWith('$');
    const rowAbsolute = text.lastIndexOf('$') > 0;
    return `${columnAbsolute ? '$' : ''}${Formula.columnToName(column)}${rowAbsolute ? '$' : ''}${row + 1}`;
  }

  function anchorDeleted(absolute, position, start, count, removing) {
    return Boolean(removing && absolute && position >= start && position < start + count);
  }

  function mapCellReference(reference, axis, start, count, removing) {
    const text = String(reference.text || '');
    const position = axis === 'row' ? reference.row : reference.column;
    const absolute = axis === 'row' ? text.lastIndexOf('$') > 0 : text.startsWith('$');
    if (anchorDeleted(absolute, position, start, count, removing)) return Formula.ERRORS['#REF!'];
    const mapped = absolute ? position : mapPosition(position, start, count, removing);
    if (mapped === null) return Formula.ERRORS['#REF!'];
    const row = axis === 'row' ? mapped : reference.row;
    const column = axis === 'column' ? mapped : reference.column;
    const nextText = anchoredRefText(text, row, column);
    return reference.sheet ? `${Formula.quoteSheetName(reference.sheet)}!${nextText}` : nextText;
  }

  function mapRangeReference(range, axis, start, count, removing) {
    const startPosition = axis === 'row' ? range.start.row : range.start.column;
    const endPosition = axis === 'row' ? range.end.row : range.end.column;
    const startText = String(range.startText);
    const endText = String(range.endText);
    const startAnchor = axis === 'row' ? startText.lastIndexOf('$') > 0 : startText.startsWith('$');
    const endAnchor = axis === 'row' ? endText.lastIndexOf('$') > 0 : endText.startsWith('$');
    if (anchorDeleted(startAnchor, startPosition, start, count, removing)) return Formula.ERRORS['#REF!'];
    if (anchorDeleted(endAnchor, endPosition, start, count, removing)) return Formula.ERRORS['#REF!'];
    const low = Math.min(startPosition, endPosition);
    const high = Math.max(startPosition, endPosition);
    const removalEnd = start + count - 1;
    let nextLow = low;
    let nextHigh = high;
    if (removing) {
      if (low >= start && high <= removalEnd) return Formula.ERRORS['#REF!'];
      if (low > removalEnd) {
        nextLow = low - count;
        nextHigh = high - count;
      } else if (high >= start) nextHigh = Math.max(low - 1, high - count);
    } else if (low >= start) {
      nextLow = low + count;
      nextHigh = high + count;
    } else if (high >= start) {
      nextHigh = high + count;
    }
    if (nextHigh < nextLow) return Formula.ERRORS['#REF!'];
    const resolvedStart = startAnchor ? startPosition : startPosition <= endPosition ? nextLow : nextHigh;
    const resolvedEnd = endAnchor ? endPosition : startPosition <= endPosition ? nextHigh : nextLow;
    const startRow = axis === 'row' ? resolvedStart : range.start.row;
    const endRow = axis === 'row' ? resolvedEnd : range.end.row;
    const startColumn = axis === 'column' ? resolvedStart : range.start.column;
    const endColumn = axis === 'column' ? resolvedEnd : range.end.column;
    const text = `${anchoredRefText(startText, startRow, startColumn)}:${anchoredRefText(endText, endRow, endColumn)}`;
    return range.sheet ? `${Formula.quoteSheetName(range.sheet)}!${text}` : text;
  }

  function mergeCells(range) {
    if (range.startRow === range.endRow && range.startColumn === range.endColumn) return false;
    return mutate('merge', () => {
      const sheet = activeSheet();
      sheet.merges = sheet.merges.filter(
        (merge) =>
          !(
            merge[0] <= range.endRow &&
            merge[2] >= range.startRow &&
            merge[1] <= range.endColumn &&
            merge[3] >= range.startColumn
          )
      );
      // Excel keeps the top-left value and discards the rest.
      eachRangeCell(range, (row, column) => {
        if (row === range.startRow && column === range.startColumn) return;
        const cell = sheet.cells[key(row, column)];
        if (!cell) return;
        delete cell.v;
        delete cell.f;
        if (!cell.s) delete sheet.cells[key(row, column)];
      });
      sheet.merges.push([range.startRow, range.startColumn, range.endRow, range.endColumn]);
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function unmergeCells(range) {
    return mutate('unmerge', () => {
      const sheet = activeSheet();
      sheet.merges = sheet.merges.filter(
        (merge) =>
          !(
            merge[0] <= range.endRow &&
            merge[2] >= range.startRow &&
            merge[1] <= range.endColumn &&
            merge[3] >= range.startColumn
          )
      );
      bumpStructureVersion(sheet);
      return true;
    });
  }

  function mergeAt(row, column) {
    const sheet = activeSheet();
    for (const merge of sheet.merges) {
      if (row >= merge[0] && row <= merge[2] && column >= merge[1] && column <= merge[3]) {
        return { startRow: merge[0], startColumn: merge[1], endRow: merge[2], endColumn: merge[3] };
      }
    }
    return null;
  }

  function mergeLookup() {
    const map = new Map();
    for (const merge of activeSheet().merges) {
      for (let row = merge[0]; row <= merge[2]; row += 1) {
        for (let column = merge[1]; column <= merge[3]; column += 1) {
          map.set(key(row, column), {
            anchor: row === merge[0] && column === merge[1],
            range: { startRow: merge[0], startColumn: merge[1], endRow: merge[2], endColumn: merge[3] }
          });
        }
      }
    }
    return map;
  }

  return {
    insertRows,
    deleteRows,
    insertColumns,
    deleteColumns,
    shiftCells,
    shiftAxisMap,
    shiftMerges,
    shiftMergesForMove,
    rewriteAllFormulas,
    targetsEditedSheet,
    mapPosition,
    anchoredRefText,
    anchorDeleted,
    mapCellReference,
    mapRangeReference,
    mergeCells,
    unmergeCells,
    mergeAt,
    mergeLookup
  };
}

module.exports = { createStructure };
