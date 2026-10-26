'use strict';

const { getCell, key } = require('./model');

function createFilter({
  activeSheet,
  activeSheetIndex,
  evaluator,
  getDisplayValue,
  getRawCell,
  mutate,
  setCellInput,
  workbook
}) {
  function isRowVisible(row) {
    const hidden = activeSheet().hiddenRows;
    return !(hidden && hidden[row]);
  }

  function activeFilters() {
    return { ...(activeSheet().filters || {}) };
  }

  function applyFilter(range, criteria) {
    return mutate('filter', () => {
      const sheet = activeSheet();
      const sheetIndex = activeSheetIndex();
      const entries = Object.entries(criteria || {})
        .map(([columnKey, criterion]) => ({ column: Number(columnKey), ...criterion }))
        .filter(
          (entry) =>
            Number.isInteger(entry.column) && entry.column >= range.startColumn && entry.column <= range.endColumn
        );
      const hidden = {};
      let hiddenCount = 0;
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        const matches = entries.every((entry) => {
          const value = getCell(workbook, sheetIndex, row, entry.column);
          return rowMatchesCriterion(value, entry);
        });
        if (!matches) {
          hidden[row] = true;
          hiddenCount += 1;
        }
      }
      sheet.filters = entries.length ? { range: { ...range }, criteria: entries.map((entry) => ({ ...entry })) } : null;
      sheet.hiddenRows = hiddenCount ? hidden : null;
      return hiddenCount;
    });
  }

  function clearFilter() {
    return mutate('filter-clear', () => {
      const sheet = activeSheet();
      sheet.filters = null;
      const had = sheet.hiddenRows ? Object.keys(sheet.hiddenRows).length : 0;
      sheet.hiddenRows = null;
      return had;
    });
  }

  function rowMatchesCriterion(cell, criterion) {
    const raw = cell ? (cell.v !== undefined ? cell.v : null) : null;
    const operator = criterion.operator || 'contains';
    const wanted = criterion.value;
    if (operator === 'blank') return raw === null || raw === '';
    if (operator === 'notBlank') return raw !== null && raw !== '';
    if (operator === 'equals') return compareFilterValues(raw, wanted) === 0;
    if (operator === 'notEquals') return compareFilterValues(raw, wanted) !== 0;
    if (operator === 'greater') return compareFilterValues(raw, wanted) > 0;
    if (operator === 'greaterOrEqual') return compareFilterValues(raw, wanted) >= 0;
    if (operator === 'less') return compareFilterValues(raw, wanted) < 0;
    if (operator === 'lessOrEqual') return compareFilterValues(raw, wanted) <= 0;
    // Text operators are case-insensitive, like Excel's own filters.
    const haystack = String(raw ?? '').toLowerCase();
    const needle = String(wanted ?? '').toLowerCase();
    if (operator === 'notContains') return !haystack.includes(needle);
    if (operator === 'beginsWith') return haystack.startsWith(needle);
    if (operator === 'endsWith') return haystack.endsWith(needle);
    return haystack.includes(needle);
  }

  function compareFilterValues(left, right) {
    const leftNumber = typeof left === 'number' ? left : Number(left);
    const rightNumber = typeof right === 'number' ? right : Number(right);
    const bothNumeric =
      left !== null && left !== '' && right !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    if (bothNumeric) return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
    const leftText = String(left ?? '').toLowerCase();
    const rightText = String(right ?? '').toLowerCase();
    return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
  }

  function sortRangeBy(range, column, ascending = true, options = {}) {
    const header = options.header === undefined ? rangeHasHeader(range) : options.header === true;
    const body = header ? { ...range, startRow: Math.min(range.endRow, range.startRow + 1) } : range;
    return sortRange(body, column, ascending);
  }

  function rangeHasHeader(range) {
    if (range.endRow <= range.startRow) return false;
    const sheetIndex = activeSheetIndex();
    let headerText = 0;
    let bodyNumeric = 0;
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const first = getCell(workbook, sheetIndex, range.startRow, column);
      if (first && first.f === undefined && typeof first.v === 'string' && first.v.trim() !== '') headerText += 1;
      const second = getCell(workbook, sheetIndex, range.startRow + 1, column);
      if (second && typeof second.v === 'number') bodyNumeric += 1;
    }
    return headerText > 0 && bodyNumeric > 0;
  }

  function sortRange(range, column, ascending = true) {
    return mutate('sort', () => {
      const sheet = activeSheet();
      const rows = [];
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        const line = [];
        for (let position = range.startColumn; position <= range.endColumn; position += 1) {
          const cell = sheet.cells[key(row, position)];
          line.push(cell ? JSON.parse(JSON.stringify(cell)) : null);
        }
        rows.push(line);
      }
      const offset = column - range.startColumn;
      // Compare evaluated values, not raw cells: sorting formula columns by
      // their formula text would look correct but be meaningless.
      const keys = rows.map((line, index) => sortKey(line[offset], range.startRow + index, column));
      const decorated = rows.map((line, index) => ({ line, index }));
      decorated.sort((left, right) => {
        const a = keys[left.index];
        const b = keys[right.index];
        if (a === b) return left.index - right.index;
        if (a === null) return 1;
        if (b === null) return -1;
        if (typeof a === 'number' && typeof b === 'number') return ascending ? a - b : b - a;
        const comparison = String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true });
        return ascending ? comparison : -comparison;
      });
      decorated.forEach((entry, targetIndex) => {
        const targetRow = range.startRow + targetIndex;
        for (let position = range.startColumn; position <= range.endColumn; position += 1) {
          const cell = entry.line[position - range.startColumn];
          if (cell) sheet.cells[key(targetRow, position)] = cell;
          else delete sheet.cells[key(targetRow, position)];
        }
      });
      return true;
    });
  }

  function sortKey(cell, row, column) {
    if (!cell) return null;
    if (cell.f) {
      const value = evaluator.getValue(activeSheetIndex(), row, column);
      return value === undefined ? null : value;
    }
    if (cell.v === undefined) return null;
    return cell.v;
  }

  function findMatches(query, options = {}) {
    const text = String(query ?? '');
    if (!text) return [];
    const matches = [];
    const sheetIndex = activeSheetIndex();
    const needle = options.caseSensitive ? text : text.toLowerCase();
    for (const cellKey of Object.keys(activeSheet().cells)) {
      const [row, column] = cellKey.split(':').map(Number);
      const haystackRaw = options.formulas
        ? getRawCell(sheetIndex, row, column)?.f || ''
        : getDisplayValue(sheetIndex, row, column);
      const haystack = options.caseSensitive ? haystackRaw : String(haystackRaw).toLowerCase();
      const position = haystack.indexOf(needle);
      if (position < 0) continue;
      matches.push({ row, column, index: position });
      if (matches.length >= 500) break;
    }
    matches.sort((left, right) => left.row - right.row || left.column - right.column);
    return matches;
  }

  function replaceAll(query, replacement, options = {}) {
    const matches = findMatches(query, options);
    if (!matches.length) return 0;
    return mutate('replace', () => {
      const sheetIndex = activeSheetIndex();
      for (const match of matches) {
        const raw = getRawCell(sheetIndex, match.row, match.column);
        if (!raw) continue;
        if (raw.f) continue; // never silently rewrite formula text
        const current = String(raw.v ?? '');
        const next = options.caseSensitive
          ? current.split(query).join(replacement)
          : current.replace(new RegExp(escapeRegExp(query), 'gi'), replacement);
        setCellInput(sheetIndex, match.row, match.column, next, { history: false });
      }
      return matches.length;
    });
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return {
    isRowVisible,
    activeFilters,
    applyFilter,
    clearFilter,
    rowMatchesCriterion,
    compareFilterValues,
    sortRangeBy,
    rangeHasHeader,
    sortRange,
    sortKey,
    findMatches,
    replaceAll,
    escapeRegExp
  };
}

module.exports = { createFilter };
