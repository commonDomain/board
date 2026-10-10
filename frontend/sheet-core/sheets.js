'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MAX_COLUMN_WIDTH,
  MAX_DISPLAY_COLUMNS,
  MAX_DISPLAY_ROWS,
  MAX_ROW_HEIGHT,
  MAX_SHEETS,
  MIN_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  clampNumber,
  createSheet,
  getCell,
  getStyle,
  internFormat,
  internStyle,
  key,
  normalizeStyle,
  uniqueSheetName
} = require('./model');

function createSheets({
  activeSheet,
  activeSheetIndex,
  bumpStructureVersion,
  emit,
  escapeRegExp,
  evaluator,
  getDisplayValue,
  mutate,
  setCellFormula,
  setCellValue,
  usedBounds,
  workbook
}) {
  function addSheet(name) {
    if (workbook.sheets.length >= MAX_SHEETS) return false;
    return mutate('sheet-add', () => {
      const sheet = createSheet();
      sheet.name = uniqueSheetName(workbook, name || `Sheet${workbook.sheets.length + 1}`);
      workbook.sheets.push(sheet);
      bumpStructureVersion(sheet);
      workbook.active = workbook.sheets.length - 1;
      return true;
    });
  }

  function removeSheet(index) {
    if (workbook.sheets.length <= 1) return false;
    if (index < 0 || index >= workbook.sheets.length) return false;
    return mutate('sheet-remove', () => {
      workbook.sheets.splice(index, 1);
      workbook.structureVersion = Math.max(0, Math.trunc(Number(workbook.structureVersion) || 0)) + 1;
      workbook.active = Math.max(
        0,
        Math.min(workbook.sheets.length - 1, workbook.active >= index ? workbook.active - 1 : workbook.active)
      );
      return true;
    });
  }

  function renameSheet(index, name) {
    const sheet = workbook.sheets[index];
    if (!sheet) return false;
    const next = String(name || '').trim();
    if (!next) return false;
    for (const [position, candidate] of workbook.sheets.entries()) {
      if (position !== index && String(candidate.name).toUpperCase() === next.toUpperCase()) return false;
    }
    if (sheet.name === next.slice(0, 60)) return false;
    return mutate('sheet-rename', () => {
      const previous = sheet.name;
      sheet.name = next.slice(0, 60);
      // Update cross-sheet references in every formula.
      for (const target of workbook.sheets) {
        for (const cell of Object.values(target.cells)) {
          if (!cell.f) continue;
          cell.f = cell.f.replace(
            new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(Formula.quoteSheetName(previous))}!`, 'g'),
            (all, prefix) => `${prefix}${Formula.quoteSheetName(sheet.name)}!`
          );
        }
      }
      return true;
    });
  }

  function moveSheet(from, to) {
    if (from < 0 || from >= workbook.sheets.length) return false;
    const target = Math.max(0, Math.min(workbook.sheets.length - 1, to));
    if (target === from) return false;
    return mutate('sheet-move', () => {
      const [sheet] = workbook.sheets.splice(from, 1);
      workbook.sheets.splice(target, 0, sheet);
      workbook.structureVersion = Math.max(0, Math.trunc(Number(workbook.structureVersion) || 0)) + 1;
      workbook.active = target;
      return true;
    });
  }

  function setActiveSheet(index) {
    const next = Math.max(0, Math.min(workbook.sheets.length - 1, index));
    if (next === workbook.active) return false;
    workbook.active = next;
    emit({ type: 'sheet-activate' });
    return true;
  }

  function toTsv(range) {
    const sheetIndex = activeSheetIndex();
    const target = range || {
      startRow: 0,
      startColumn: 0,
      endRow: Math.max(0, usedBounds().rows - 1),
      endColumn: Math.max(0, usedBounds().columns - 1)
    };
    const lines = [];
    for (let row = target.startRow; row <= target.endRow; row += 1) {
      const line = [];
      for (let column = target.startColumn; column <= target.endColumn; column += 1) {
        const value = getDisplayValue(sheetIndex, row, column);
        line.push(/[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
      }
      lines.push(line.join('\t'));
    }
    return lines.join('\n');
  }

  function toCsv() {
    const sheetIndex = activeSheetIndex();
    const bounds = usedBounds();
    const lines = [];
    for (let row = 0; row < Math.max(1, bounds.rows); row += 1) {
      const line = [];
      for (let column = 0; column < Math.max(1, bounds.columns); column += 1) {
        const value = getDisplayValue(sheetIndex, row, column);
        line.push(/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
      }
      lines.push(line.join(','));
    }
    return lines.join('\r\n');
  }

  function toHtmlTable(range) {
    const sheetIndex = activeSheetIndex();
    const target = range || {
      startRow: 0,
      startColumn: 0,
      endRow: Math.max(0, usedBounds().rows - 1),
      endColumn: Math.max(0, usedBounds().columns - 1)
    };
    // Excel paste payloads must stay small; a whole-sheet copy falls back to
    // TSV because the receiving app prefers text/plain at that size anyway.
    const cellTotal = (target.endRow - target.startRow + 1) * (target.endColumn - target.startColumn + 1);
    if (cellTotal > 20000) return '';
    const lines = ['<table>'];
    for (let row = target.startRow; row <= target.endRow; row += 1) {
      lines.push('<tr>');
      for (let column = target.startColumn; column <= target.endColumn; column += 1) {
        const cell = getCell(workbook, sheetIndex, row, column);
        const style = getStyle(workbook, cell);
        const attributes = [];
        if (style.bold) attributes.push('font-weight:700');
        if (style.italic) attributes.push('font-style:italic');
        if (style.color) attributes.push(`color:${style.color}`);
        if (style.fill) attributes.push(`background:${style.fill}`);
        if (style.align && style.align !== 'left') attributes.push(`text-align:${style.align}`);
        const value = escapeHtml(getDisplayValue(sheetIndex, row, column));
        lines.push(attributes.length ? `<td style="${attributes.join(';')}">${value}</td>` : `<td>${value}</td>`);
      }
      lines.push('</tr>');
    }
    lines.push('</table>');
    return lines.join('');
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  }

  function parseTabular(text, options = {}) {
    const source = String(text ?? '');
    if (!source) return [];
    const delimiter = options.delimiter || detectDelimiter(source);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else quoted = false;
        } else field += char;
        continue;
      }
      if (char === '"' && field === '') {
        quoted = true;
        continue;
      }
      if (char === delimiter) {
        row.push(field);
        field = '';
        continue;
      }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        continue;
      }
      field += char;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function detectDelimiter(source) {
    const head = source.split(/\r?\n/).slice(0, 5).join('\n');
    const tabs = (head.match(/\t/g) || []).length;
    const commas = (head.match(/,/g) || []).length;
    const semicolons = (head.match(/;/g) || []).length;
    if (tabs >= commas && tabs >= semicolons) return '\t';
    return commas >= semicolons ? ',' : ';';
  }

  function importText(startRow, startColumn, text) {
    const rows = parseTabular(text);
    if (!rows.length) return 0;
    return mutate('import', () => {
      const sheetIndex = activeSheetIndex();
      let written = 0;
      rows.forEach((line, rowOffset) => {
        line.forEach((field, columnOffset) => {
          const targetRow = startRow + rowOffset;
          const targetColumn = startColumn + columnOffset;
          const trimmed = String(field ?? '');
          if (trimmed === '') {
            const cellKey = key(targetRow, targetColumn);
            if (activeSheet().cells[cellKey]) {
              delete activeSheet().cells[cellKey];
              written += 1;
            }
            return;
          }
          if (trimmed.startsWith('=')) setCellFormula(sheetIndex, targetRow, targetColumn, trimmed);
          else if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed))
            setCellValue(sheetIndex, targetRow, targetColumn, Number(trimmed));
          else setCellValue(sheetIndex, targetRow, targetColumn, trimmed);
          written += 1;
        });
      });
      return written;
    });
  }

  function loadMatrix(matrix, options = {}) {
    return mutate('load', () => {
      const sheet = activeSheet();
      const nextCells = {};
      const rows = Array.isArray(matrix) ? matrix.slice(0, MAX_DISPLAY_ROWS) : [];
      rows.forEach((line, row) => {
        if (!Array.isArray(line)) return;
        line.slice(0, MAX_DISPLAY_COLUMNS).forEach((value, column) => {
          if (value === null || value === undefined || value === '') return;
          if (value && typeof value === 'object' && value.formula) {
            const text = String(value.formula).startsWith('=') ? value.formula : `=${value.formula}`;
            nextCells[key(row, column)] = { f: text.slice(0, 4096) };
            return;
          }
          const scalar = value && typeof value === 'object' && 'value' in value ? value.value : value;
          if (scalar === null || scalar === undefined || scalar === '') return;
          if (typeof scalar === 'number' && Number.isFinite(scalar)) nextCells[key(row, column)] = { v: scalar };
          else if (typeof scalar === 'boolean') nextCells[key(row, column)] = { v: scalar };
          else nextCells[key(row, column)] = { v: String(scalar).slice(0, 32767) };
        });
      });
      if (options.replace !== false) sheet.cells = nextCells;
      else Object.assign(sheet.cells, nextCells);
      return Object.keys(nextCells).length;
    });
  }

  function toMatrix() {
    return matrixForSheet(activeSheetIndex());
  }

  function matrixForSheet(sheetIndex) {
    const sheet = workbook.sheets[sheetIndex];
    if (!sheet) return [];
    const bounds = sheetBounds(sheet);
    const rows = [];
    for (let row = 0; row < Math.max(1, bounds.rows); row += 1) {
      const line = [];
      for (let column = 0; column < Math.max(1, bounds.columns); column += 1) {
        const cell = sheet.cells[key(row, column)];
        if (!cell) {
          line.push(null);
          continue;
        }
        if (cell.f) line.push({ formula: cell.f.slice(1), value: evaluator.getValue(sheetIndex, row, column) });
        else if (cell.v !== undefined) line.push(cell.v);
        else line.push(null);
      }
      rows.push(line);
    }
    return rows;
  }

  function sheetBounds(sheet) {
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
    return { rows, columns };
  }

  function importSheets(sheets) {
    const incoming = (Array.isArray(sheets) ? sheets : []).filter((sheet) => sheet && Array.isArray(sheet.matrix));
    if (!incoming.length) return { sheets: 0, cells: 0 };
    return mutate('import-sheets', () => {
      const reusable =
        workbook.sheets.length === 1 &&
        Object.keys(workbook.sheets[0].cells).length === 0 &&
        !workbook.sheets[0].merges.length;
      let cellTotal = 0;
      incoming.forEach((source, offset) => {
        let index;
        if (offset === 0 && reusable) {
          const sheet = workbook.sheets[0];
          sheet.cells = {};
          sheet.cols = {};
          sheet.rows = {};
          sheet.merges = [];
          sheet.frozen = { rows: 0, cols: 0 };
          sheet.hiddenRows = null;
          sheet.hiddenColumns = null;
          sheet.filters = null;
          // Scan the other sheets for a collision but skip this one, which
          // would otherwise collide with its own name and gain a suffix.
          sheet.name = uniqueSheetName(workbook, source.name || 'Sheet1', 0, 0, workbook.sheets.length);
          index = 0;
        } else {
          const sheet = createSheet();
          const insertAt = workbook.sheets.length;
          workbook.sheets.push(sheet);
          // The new sheet is already in the list, so stop the scan before it.
          sheet.name = uniqueSheetName(workbook, source.name || `Sheet${insertAt + 1}`, insertAt, insertAt, insertAt);
          index = insertAt;
        }
        cellTotal += loadMatrixIntoSheet(workbook.sheets[index], index, source);
      });
      // Land on the first imported sheet so the user sees what was imported.
      workbook.active = Math.max(0, workbook.sheets.length - incoming.length);
      return { sheets: incoming.length, cells: cellTotal };
    });
  }

  function loadMatrixIntoSheet(sheet, sheetIndex, source) {
    const matrix = Array.isArray(source.matrix) ? source.matrix : [];
    let written = 0;
    const nextCells = {};
    matrix.forEach((line, row) => {
      if (!Array.isArray(line) || row >= MAX_DISPLAY_ROWS) return;
      line.slice(0, MAX_DISPLAY_COLUMNS).forEach((value, column) => {
        if (value === null || value === undefined || value === '') return;
        if (value && typeof value === 'object' && value.formula) {
          const text = String(value.formula).startsWith('=') ? value.formula : `=${value.formula}`;
          nextCells[key(row, column)] = { f: text.slice(0, 4096) };
          written += 1;
        } else {
          const scalar = value && typeof value === 'object' && 'value' in value ? value.value : value;
          if (scalar === null || scalar === undefined || scalar === '') return;
          if (typeof scalar === 'number' && Number.isFinite(scalar)) nextCells[key(row, column)] = { v: scalar };
          else if (typeof scalar === 'boolean') nextCells[key(row, column)] = { v: scalar };
          else nextCells[key(row, column)] = { v: String(scalar).slice(0, 32767) };
          written += 1;
        }
        const rawStyle = typeof source.styleAt === 'function' ? source.styleAt(row, column) : null;
        if (rawStyle && nextCells[key(row, column)]) {
          const normalized = normalizeStyle(rawStyle);
          normalized.format = internFormat(workbook, rawStyle.format || 'General');
          const styleIndex = internStyle(workbook, normalized);
          if (styleIndex) nextCells[key(row, column)].s = styleIndex;
        }
      });
    });
    sheet.cells = nextCells;
    for (const [column, width] of Object.entries(source.cols || {})) {
      const index = Number(column);
      if (Number.isInteger(index) && index >= 0 && index < MAX_DISPLAY_COLUMNS) {
        sheet.cols[index] = Math.round(clampNumber(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH));
      }
    }
    for (const [row, height] of Object.entries(source.rows || {})) {
      const index = Number(row);
      if (Number.isInteger(index) && index >= 0 && index < MAX_DISPLAY_ROWS) {
        sheet.rows[index] = Math.round(clampNumber(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_ROW_HEIGHT));
      }
    }
    sheet.merges = (Array.isArray(source.merges) ? source.merges : [])
      .slice(0, 2048)
      .map((merge) =>
        Array.isArray(merge) && merge.length === 4
          ? merge.map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
          : null
      )
      .filter((merge) => merge && (merge[0] !== merge[2] || merge[1] !== merge[3]));
    if (source.frozen && typeof source.frozen === 'object') {
      sheet.frozen = {
        rows: Math.trunc(clampNumber(source.frozen.rows, 0, 64, 0)),
        cols: Math.trunc(clampNumber(source.frozen.cols, 0, 64, 0))
      };
    }
    sheet.hiddenRows = source.hiddenRows && typeof source.hiddenRows === 'object' ? { ...source.hiddenRows } : null;
    sheet.hiddenColumns =
      source.hiddenColumns && typeof source.hiddenColumns === 'object' ? { ...source.hiddenColumns } : null;
    void sheetIndex;
    return written;
  }

  return {
    addSheet,
    removeSheet,
    renameSheet,
    moveSheet,
    setActiveSheet,
    toTsv,
    toCsv,
    toHtmlTable,
    escapeHtml,
    parseTabular,
    detectDelimiter,
    importText,
    loadMatrix,
    toMatrix,
    matrixForSheet,
    sheetBounds,
    importSheets,
    loadMatrixIntoSheet
  };
}

module.exports = { createSheets };
