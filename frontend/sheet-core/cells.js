'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  DEFAULT_STYLE,
  cloneData,
  eachRangeCell,
  getCell,
  getStyle,
  internFormat,
  internStyle,
  key,
  normalizeCell
} = require('./model');

function createCells({
  activeSheet,
  activeSheetIndex,
  bumpCellVersion,
  cellState,
  clearRange,
  edit,
  evaluator,
  getCellVersion,
  getStructureVersion,
  mutateCell,
  mutateRange,
  isMutating,
  restore,
  snapshot,
  workbook
}) {
  function commandSheetIndex(command) {
    if (Number.isInteger(command?.sheetIndex)) return command.sheetIndex;
    if (command?.sheetId) return workbook.sheets.findIndex((sheet) => sheet.sheetId === command.sheetId);
    return activeSheetIndex();
  }

  function applyCommand(command, options = {}) {
    if (!command || typeof command !== 'object') return { ok: false, reason: 'invalid-command' };
    const sheetIndex = commandSheetIndex(command);
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return { ok: false, reason: 'sheet-not-found' };
    if (
      Number.isInteger(command.expectedStructureVersion) &&
      command.expectedStructureVersion !== getStructureVersion(sheetIndex)
    ) {
      return {
        ok: false,
        reason: 'structure-version-conflict',
        currentStructureVersion: getStructureVersion(sheetIndex)
      };
    }
    if (
      Number.isInteger(command.expectedCellVersion) &&
      Number.isInteger(command.row) &&
      Number.isInteger(command.column) &&
      command.expectedCellVersion !== getCellVersion(sheetIndex, command.row, command.column)
    ) {
      return {
        ok: false,
        reason: 'cell-version-conflict',
        currentCellVersion: getCellVersion(sheetIndex, command.row, command.column)
      };
    }
    const history = options.history !== false;
    let result = false;
    switch (command.type) {
      case 'cell-input':
        result = setCellInput(sheetIndex, command.row, command.column, command.input, { history });
        break;
      case 'cell-value':
        result = edit('command-cell-value', { history }, () =>
          setCellValue(sheetIndex, command.row, command.column, command.value)
        );
        break;
      case 'cell-formula':
        result = edit('command-cell-formula', { history }, () =>
          setCellFormula(sheetIndex, command.row, command.column, command.formula)
        );
        break;
      case 'apply-style':
        result = edit('command-style', { history }, () => applyStyle(command.range, command.patch || {}));
        break;
      case 'clear-range':
        result = edit('command-clear', { history }, () => clearRange(command.range, command.mode));
        break;
      case 'restore-workbook':
        restore(command.state);
        result = true;
        break;
      default:
        return { ok: false, reason: 'unsupported-command' };
    }
    return { ok: result !== false, result, structureVersion: getStructureVersion(sheetIndex) };
  }

  function invertCommand(command) {
    if (!command || typeof command !== 'object') return null;
    const sheetIndex = commandSheetIndex(command);
    if (!workbook.sheets[sheetIndex]) return null;
    if (
      ['cell-input', 'cell-value', 'cell-formula'].includes(command.type) &&
      Number.isInteger(command.row) &&
      Number.isInteger(command.column)
    ) {
      const cell = cellState(sheetIndex, command.row, command.column);
      return cell?.f
        ? { type: 'cell-formula', sheetIndex, row: command.row, column: command.column, formula: cell.f }
        : { type: 'cell-value', sheetIndex, row: command.row, column: command.column, value: cell?.v ?? '' };
    }
    return { type: 'restore-workbook', sheetIndex, state: snapshot() };
  }

  function applyRemotePatch(patch) {
    if (!patch || typeof patch !== 'object' || !Array.isArray(patch.cells))
      return { ok: false, reason: 'invalid-patch', applied: 0, conflicts: [] };
    const sheetIndex = commandSheetIndex(patch);
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return { ok: false, reason: 'sheet-not-found', applied: 0, conflicts: [] };
    if (
      Number.isInteger(patch.baseStructureVersion) &&
      patch.baseStructureVersion !== getStructureVersion(sheetIndex)
    ) {
      return {
        ok: false,
        reason: 'structure-version-conflict',
        applied: 0,
        conflicts: [],
        currentStructureVersion: getStructureVersion(sheetIndex)
      };
    }
    const conflicts = [];
    let applied = 0;
    edit('remote-patch', { history: false }, () => {
      for (const change of patch.cells) {
        if (!Number.isInteger(change?.row) || !Number.isInteger(change?.column)) continue;
        const currentVersion = getCellVersion(sheetIndex, change.row, change.column);
        if (Number.isInteger(change.expectedVersion) && change.expectedVersion !== currentVersion) {
          conflicts.push({
            row: change.row,
            column: change.column,
            expectedVersion: change.expectedVersion,
            currentVersion,
            local: cellState(sheetIndex, change.row, change.column),
            remote: cloneData(change.cell ?? null)
          });
          continue;
        }
        const cellKey = key(change.row, change.column);
        const normalized = normalizeCell(change.cell, workbook.styles.length, workbook.formats.length);
        if (normalized) sheet.cells[cellKey] = normalized;
        else delete sheet.cells[cellKey];
        sheet.cellVersions[cellKey] = Number.isInteger(change.version)
          ? Math.max(currentVersion + 1, change.version)
          : currentVersion + 1;
        evaluator.invalidateCell(sheetIndex, change.row, change.column);
        applied += 1;
      }
      return true;
    });
    return { ok: conflicts.length === 0, applied, conflicts, structureVersion: getStructureVersion(sheetIndex) };
  }

  function setCellValue(sheetIndex, row, column, value, options = {}) {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return false;
    const cellKey = key(row, column);
    const existing = sheet.cells[cellKey];
    const next = existing ? { ...existing } : {};
    if (value === null || value === undefined || value === '') {
      delete next.v;
      delete next.f;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      next.v = value;
      delete next.f;
    } else if (typeof value === 'boolean') {
      next.v = value;
      delete next.f;
    } else {
      next.v = String(value);
      delete next.f;
    }
    if (next.v === undefined && next.f === undefined) delete sheet.cells[cellKey];
    else sheet.cells[cellKey] = next;
    bumpCellVersion(sheet, row, column);
    if (!options.silent) evaluator.invalidateCell(sheetIndex, row, column);
    return true;
  }

  function setCellFormula(sheetIndex, row, column, formulaText) {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return false;
    const text = String(formulaText || '').trim();
    const cellKey = key(row, column);
    if (!text) {
      const existing = sheet.cells[cellKey];
      if (existing) {
        delete existing.f;
        if (existing.v === undefined && !existing.s) delete sheet.cells[cellKey];
      }
      bumpCellVersion(sheet, row, column);
      evaluator.invalidateCell(sheetIndex, row, column);
      return true;
    }
    if (text.length > 4096) return false;
    if (!text.startsWith('=')) {
      setCellValue(sheetIndex, row, column, text);
      return true;
    }
    const parsed = Formula.parseFormula(text);
    if (parsed.error) return false;
    const cell = sheet.cells[cellKey] || {};
    cell.f = text;
    delete cell.v;
    sheet.cells[cellKey] = cell;
    bumpCellVersion(sheet, row, column);
    evaluator.invalidateCell(sheetIndex, row, column);
    return true;
  }

  function validateCellInput(rawText) {
    const text = String(rawText ?? '');
    if (!text.startsWith('=')) return { valid: true, kind: 'literal' };
    if (text.length > 4096) {
      return { valid: false, kind: 'formula', error: '#VALUE!', message: '公式最多支持 4096 个字符' };
    }
    const parsed = Formula.parseFormula(text);
    if (parsed.error) {
      return {
        valid: false,
        kind: 'formula',
        error: parsed.error,
        message: parsed.message || '公式语法错误'
      };
    }
    return { valid: true, kind: 'formula' };
  }

  function setCellInput(sheetIndex, row, column, rawText, options) {
    const text = String(rawText ?? '');
    const validation = validateCellInput(text);
    if (!validation.valid) return false;
    const operation = () => {
      if (text.startsWith('=')) return setCellFormula(sheetIndex, row, column, text);
      if (text === '') return setCellValue(sheetIndex, row, column, '');
      if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text.trim())) {
        return setCellValue(sheetIndex, row, column, Number(text.trim()));
      }
      if (/^-?(\d+\.?\d*|\.\d+)%$/.test(text.trim())) {
        return setCellValue(sheetIndex, row, column, Number(text.trim().slice(0, -1)) / 100);
      }
      if (/^(TRUE|FALSE)$/i.test(text.trim())) {
        return setCellValue(sheetIndex, row, column, text.trim().toUpperCase() === 'TRUE');
      }
      return setCellValue(sheetIndex, row, column, text);
    };
    if (options?.history === false || isMutating()) return edit('edit', options, operation);
    return mutateCell('edit', sheetIndex, row, column, operation);
  }

  function getRawCell(sheetIndex, row, column) {
    return getCell(workbook, sheetIndex, row, column);
  }

  function getEditText(sheetIndex, row, column) {
    const cell = getCell(workbook, sheetIndex, row, column);
    if (!cell) return '';
    if (cell.f) return cell.f;
    if (cell.v === undefined || cell.v === null) return '';
    return String(cell.v);
  }

  function getDisplayValue(sheetIndex, row, column) {
    const style = getStyle(workbook, getCell(workbook, sheetIndex, row, column));
    const pattern = workbook.formats[style.format] || 'General';
    const value = evaluator.getValue(sheetIndex, row, column);
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' && Formula.isError(value)) return value;
    if (pattern === 'General' || pattern === '@') {
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return Formula.ERRORS['#NUM!'];
        // General keeps up to 11 significant digits, like Excel.
        const rounded = Number(value.toPrecision(11));
        return String(rounded);
      }
      return String(value);
    }
    const formatted = Formula.formatValue(value, pattern);
    return typeof formatted === 'string' ? formatted : String(formatted);
  }

  function getNumericValue(sheetIndex, row, column) {
    const value = evaluator.getValue(sheetIndex, row, column);
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return null;
  }

  function applyStyle(range, patch) {
    return mutateRange('style', activeSheetIndex(), range, () => {
      const sheet = activeSheet();
      // Interning is memoized per distinct incoming style so a large selection
      // costs one pool lookup per style rather than one per cell.
      const resolvedByStyle = new Map();
      let touched = 0;
      eachRangeCell(range, (row, column) => {
        const cellKey = key(row, column);
        const cell = sheet.cells[cellKey] || {};
        const current = getStyle(workbook, cell);
        const memoKey = patch.clear ? '__clear__' : `${JSON.stringify(current)}|${JSON.stringify(patch)}`;
        let nextIndex = resolvedByStyle.get(memoKey);
        if (nextIndex === undefined) {
          let next = patch.clear ? { ...DEFAULT_STYLE } : { ...current };
          if (!patch.clear) {
            for (const [property, value] of Object.entries(patch)) {
              if (property === 'format') next.format = internFormat(workbook, value);
              else next[property] = value;
            }
          }
          nextIndex = JSON.stringify(next) === JSON.stringify(DEFAULT_STYLE) ? 0 : internStyle(workbook, next);
          resolvedByStyle.set(memoKey, nextIndex);
        }
        if (nextIndex === 0) delete cell.s;
        else cell.s = nextIndex;
        if (cell.v === undefined && cell.f === undefined && !cell.s) delete sheet.cells[cellKey];
        else sheet.cells[cellKey] = cell;
        touched += 1;
      });
      return touched;
    });
  }

  function applyBorders(range, mode = 'all', color = '#64748b') {
    return mutateRange('borders', activeSheetIndex(), range, () => {
      const sheet = activeSheet();
      const clear = mode === 'clear';
      const thick = mode === 'thick-outer';
      eachRangeCell(range, (row, column) => {
        const cellKey = key(row, column);
        const cell = sheet.cells[cellKey] || {};
        const next = { ...getStyle(workbook, cell) };
        const set = (side, enabled, width = 1.5) => {
          next[side] = enabled && !clear ? color : null;
          next[`${side}Width`] = enabled && !clear ? width : 0;
        };
        if (mode === 'all' || clear) {
          set('borderTop', true);
          set('borderRight', true);
          set('borderBottom', true);
          set('borderLeft', true);
        } else if (mode === 'outer' || thick) {
          const width = thick ? 3 : 1.5;
          if (row === range.startRow) set('borderTop', true, width);
          if (row === range.endRow) set('borderBottom', true, width);
          if (column === range.startColumn) set('borderLeft', true, width);
          if (column === range.endColumn) set('borderRight', true, width);
        } else if (mode === 'inner') {
          if (row > range.startRow) set('borderTop', true);
          if (column > range.startColumn) set('borderLeft', true);
        } else if (['top', 'right', 'bottom', 'left'].includes(mode)) {
          set(`border${mode[0].toUpperCase()}${mode.slice(1)}`, true);
        }
        const nextIndex = JSON.stringify(next) === JSON.stringify(DEFAULT_STYLE) ? 0 : internStyle(workbook, next);
        if (nextIndex) cell.s = nextIndex;
        else delete cell.s;
        if (cell.v === undefined && cell.f === undefined && !cell.s) delete sheet.cells[cellKey];
        else sheet.cells[cellKey] = cell;
      });
      return true;
    });
  }

  function getStyleOf(sheetIndex, row, column) {
    const cell = getCell(workbook, sheetIndex, row, column);
    const style = getStyle(workbook, cell);
    return { ...style, formatPattern: workbook.formats[style.format] || 'General' };
  }

  function commonStyle(range) {
    const sheetIndex = activeSheetIndex();
    let shared = null;
    let mixed = false;
    eachRangeCell(range, (row, column) => {
      const style = getStyleOf(sheetIndex, row, column);
      if (!shared) shared = style;
      else if (JSON.stringify(shared) !== JSON.stringify(style)) mixed = true;
    });
    return { style: shared || getStyleOf(sheetIndex, range.startRow, range.startColumn), mixed };
  }

  return {
    commandSheetIndex,
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
  };
}

module.exports = { createCells };
