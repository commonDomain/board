'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');

const DEFAULT_ROW_HEIGHT = 26;

const DEFAULT_COLUMN_WIDTH = 96;

const MIN_ROW_HEIGHT = 16;

const MAX_ROW_HEIGHT = 400;

const MIN_COLUMN_WIDTH = 28;

const MAX_COLUMN_WIDTH = 1200;

const MAX_SHEETS = 32;

const MAX_CELLS_PER_SHEET = 200000;

const MAX_UNDO_STEPS = 60;

const MAX_UNDO_BYTES = 8 * 1024 * 1024;

const MAX_DISPLAY_ROWS = 50000;

const MAX_DISPLAY_COLUMNS = 512;

const WORKBOOK_SCHEMA_VERSION = 2;

let sheetIdSequence = 0;

const DEFAULT_STYLE = Object.freeze({
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'left',
  valign: 'middle',
  wrap: false,
  color: null,
  fill: null,
  format: 0,
  size: 0,
  family: null,
  borderTop: null,
  borderRight: null,
  borderBottom: null,
  borderLeft: null,
  borderTopWidth: 0,
  borderRightWidth: 0,
  borderBottomWidth: 0,
  borderLeftWidth: 0
});

function key(row, column) {
  return `${row}:${column}`;
}

function toRange(startRow, startColumn, endRow, endColumn) {
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn),
    endColumn: Math.max(startColumn, endColumn)
  };
}

function rangeContains(range, row, column) {
  return row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn;
}

function eachRangeCell(range, visit) {
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) visit(row, column);
  }
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function createSheet(name, id) {
  return {
    sheetId: typeof id === 'string' && id ? id : makeSheetId(),
    name: name || 'Sheet1',
    structureVersion: 0,
    cellVersions: {},
    cells: {},
    cols: {},
    rows: {},
    merges: [],
    frozen: { rows: 0, cols: 0 },
    rowsHint: 0,
    colsHint: 0,
    // Filtering hides rows without deleting them, so clearing restores the view.
    hiddenRows: null,
    hiddenColumns: null,
    filters: null
  };
}

function createWorkbook() {
  return {
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    structureVersion: 0,
    title: '工作表 1',
    active: 0,
    sheets: [createSheet('Sheet1')],
    styles: [{ ...DEFAULT_STYLE }],
    formats: ['General'],
    recovery: { unplacedCells: [] }
  };
}

function makeSheetId() {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `sheet_${cryptoApi.randomUUID()}`;
  sheetIdSequence += 1;
  return `sheet_${Date.now().toString(36)}_${sheetIdSequence.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStyle(raw) {
  const style = { ...DEFAULT_STYLE };
  if (!raw || typeof raw !== 'object') return style;
  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  if (raw.underline === true) style.underline = true;
  if (raw.strike === true) style.strike = true;
  if (raw.wrap === true) style.wrap = true;
  if (['left', 'center', 'right'].includes(raw.align)) style.align = raw.align;
  if (['top', 'middle', 'bottom'].includes(raw.valign)) style.valign = raw.valign;
  if (typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color)) style.color = raw.color.toLowerCase();
  if (typeof raw.fill === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.fill)) style.fill = raw.fill.toLowerCase();
  style.format = Math.max(0, Math.trunc(Number(raw.format) || 0));
  style.size = clampNumber(raw.size, 0, 96, 0);
  // Preserve cross-platform CSS fallback stacks such as PingFang → YaHei →
  // Source Han. The individual family names are short, but the safe stack is
  // legitimately longer than the former 80-character limit.
  if (typeof raw.family === 'string' && raw.family.trim()) style.family = raw.family.trim().slice(0, 256);
  for (const side of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']) {
    if (typeof raw[side] === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw[side])) style[side] = raw[side].toLowerCase();
    const width = Number(raw[`${side}Width`]);
    if (Number.isFinite(width) && width > 0) style[`${side}Width`] = Math.min(4, Math.max(1, width));
  }
  return style;
}

function normalizeCell(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cell = {};
  if (typeof raw.f === 'string' && raw.f.startsWith('=')) {
    cell.f = raw.f.slice(0, 4096);
  } else if (raw.v !== undefined && raw.v !== null) {
    if (typeof raw.v === 'number') {
      if (Number.isFinite(raw.v)) cell.v = raw.v;
    } else if (typeof raw.v === 'boolean') {
      cell.v = raw.v;
    } else if (typeof raw.v === 'string') {
      cell.v = raw.v.slice(0, 32767);
    }
  }
  const styleIndex = Math.trunc(Number(raw.s) || 0);
  if (styleIndex > 0) cell.s = styleIndex;
  if (cell.v === undefined && cell.f === undefined) return null;
  return cell;
}

function normalizeWorkbook(raw) {
  const workbook = createWorkbook();
  if (!raw || typeof raw !== 'object') return workbook;
  if (typeof raw.title === 'string' && raw.title.trim()) workbook.title = raw.title.slice(0, 120);
  workbook.structureVersion = Math.max(0, Math.trunc(Number(raw.structureVersion) || 0));
  if (Array.isArray(raw.recovery?.unplacedCells)) {
    workbook.recovery.unplacedCells = raw.recovery.unplacedCells.map((entry) => cloneData(entry));
  }

  // Index 0 is always the default style, so incoming indexes are 0-based
  // style slots rather than offsets into a pre-filled pool.
  const rawStyles = Array.isArray(raw.styles) ? raw.styles : [];
  const defaultSerialized = JSON.stringify(DEFAULT_STYLE);
  const styleIndexMap = new Map([[0, 0]]);
  workbook.styles = [{ ...DEFAULT_STYLE }];
  for (let index = 0; index < rawStyles.length && workbook.styles.length < 512; index += 1) {
    const style = normalizeStyle(rawStyles[index]);
    if (JSON.stringify(style) === defaultSerialized) {
      styleIndexMap.set(index, 0);
      continue;
    }
    const existing = workbook.styles.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(style));
    if (existing >= 0) styleIndexMap.set(index, existing);
    else {
      styleIndexMap.set(index, workbook.styles.length);
      workbook.styles.push(style);
    }
  }

  const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
  const formatIndexMap = new Map([[0, 0]]);
  workbook.formats = ['General'];
  for (let index = 0; index < rawFormats.length && workbook.formats.length < 256; index += 1) {
    const pattern = typeof rawFormats[index] === 'string' ? rawFormats[index].slice(0, 64) : 'General';
    const existing = workbook.formats.indexOf(pattern);
    if (existing >= 0) formatIndexMap.set(index, existing);
    else {
      formatIndexMap.set(index, workbook.formats.length);
      workbook.formats.push(pattern);
    }
  }

  const rawSheets = Array.isArray(raw.sheets) ? raw.sheets.slice(0, MAX_SHEETS) : [];
  workbook.sheets = [];
  const usedSheetIds = new Set();
  rawSheets.forEach((rawSheet, sheetIndex) => {
    const incomingId =
      typeof rawSheet?.sheetId === 'string' && rawSheet.sheetId.trim() ? rawSheet.sheetId.trim().slice(0, 120) : null;
    const sheet = createSheet(undefined, incomingId && !usedSheetIds.has(incomingId) ? incomingId : undefined);
    usedSheetIds.add(sheet.sheetId);
    if (rawSheet && typeof rawSheet === 'object') {
      sheet.structureVersion = Math.max(0, Math.trunc(Number(rawSheet.structureVersion) || 0));
      if (rawSheet.cellVersions && typeof rawSheet.cellVersions === 'object') {
        for (const [cellKey, version] of Object.entries(rawSheet.cellVersions)) {
          if (!/^\d{1,7}:\d{1,5}$/.test(cellKey)) continue;
          const numeric = Math.max(0, Math.trunc(Number(version) || 0));
          if (numeric) sheet.cellVersions[cellKey] = numeric;
        }
      }
      if (typeof rawSheet.name === 'string' && rawSheet.name.trim()) sheet.name = rawSheet.name.slice(0, 60);
      const cells = rawSheet.cells && typeof rawSheet.cells === 'object' ? rawSheet.cells : {};
      let count = 0;
      for (const [cellKey, rawCell] of Object.entries(cells)) {
        if (count >= MAX_CELLS_PER_SHEET) {
          workbook.recovery.unplacedCells.push({
            sheetId: sheet.sheetId,
            sheetName: sheet.name,
            address: cellKey,
            reason: 'sheet-cell-limit',
            cell: cloneData(rawCell)
          });
          continue;
        }
        const match = /^(\d{1,7}):(\d{1,5})$/.exec(cellKey);
        if (!match) {
          workbook.recovery.unplacedCells.push({
            sheetId: sheet.sheetId,
            sheetName: sheet.name,
            address: cellKey,
            reason: 'invalid-address',
            cell: cloneData(rawCell)
          });
          continue;
        }
        const cell = normalizeCell(rawCell);
        if (!cell) {
          workbook.recovery.unplacedCells.push({
            sheetId: sheet.sheetId,
            sheetName: sheet.name,
            address: cellKey,
            reason: 'invalid-cell',
            cell: cloneData(rawCell)
          });
          continue;
        }
        const row = Number(match[1]);
        const column = Number(match[2]);
        if (row >= MAX_DISPLAY_ROWS || column >= MAX_DISPLAY_COLUMNS) {
          workbook.recovery.unplacedCells.push({
            sheetId: sheet.sheetId,
            sheetName: sheet.name,
            address: cellKey,
            reason: 'outside-supported-grid',
            cell: cloneData(rawCell)
          });
          continue;
        }
        if (cell.s) cell.s = styleIndexMap.get(cell.s) || 0;
        if (!cell.s) delete cell.s;
        sheet.cells[`${row}:${column}`] = cell;
        count += 1;
      }
      if (rawSheet.cols && typeof rawSheet.cols === 'object') {
        for (const [columnKey, width] of Object.entries(rawSheet.cols)) {
          const column = Number(columnKey);
          if (!Number.isInteger(column) || column < 0 || column >= MAX_DISPLAY_COLUMNS) continue;
          sheet.cols[column] = Math.round(clampNumber(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH));
        }
      }
      if (rawSheet.rows && typeof rawSheet.rows === 'object') {
        for (const [rowKey, height] of Object.entries(rawSheet.rows)) {
          const row = Number(rowKey);
          if (!Number.isInteger(row) || row < 0 || row >= MAX_DISPLAY_ROWS) continue;
          sheet.rows[row] = Math.round(clampNumber(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT, DEFAULT_ROW_HEIGHT));
        }
      }
      for (const [field, limit] of [
        ['hiddenRows', MAX_DISPLAY_ROWS],
        ['hiddenColumns', MAX_DISPLAY_COLUMNS]
      ]) {
        if (!rawSheet[field] || typeof rawSheet[field] !== 'object') continue;
        const hidden = {};
        for (const [axisKey, value] of Object.entries(rawSheet[field])) {
          const axis = Number(axisKey);
          if (value === true && Number.isInteger(axis) && axis >= 0 && axis < limit) hidden[axis] = true;
        }
        sheet[field] = Object.keys(hidden).length ? hidden : null;
      }
      if (Array.isArray(rawSheet.merges)) {
        sheet.merges = rawSheet.merges
          .slice(0, 2048)
          .map((entry) =>
            Array.isArray(entry) && entry.length === 4
              ? entry.map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
              : null
          )
          .filter((entry) => entry && (entry[0] !== entry[2] || entry[1] !== entry[3]));
      }
      if (rawSheet.frozen && typeof rawSheet.frozen === 'object') {
        sheet.frozen = {
          rows: Math.trunc(clampNumber(rawSheet.frozen.rows, 0, 64, 0)),
          cols: Math.trunc(clampNumber(rawSheet.frozen.cols, 0, 64, 0))
        };
      }
    }
    if (sheetIndex === 0 && !sheet.name) sheet.name = 'Sheet1';
    workbook.sheets.push(sheet);
  });
  if (!workbook.sheets.length) workbook.sheets = [createSheet('Sheet1')];
  // Only compare against sheets already finalized: the ones after `index`
  // still carry their raw names and must not force a rename of this one.
  workbook.sheets.forEach((sheet, index) => {
    sheet.name = uniqueSheetName(workbook, sheet.name, index, index, index);
  });
  workbook.active = Math.trunc(clampNumber(raw.active, 0, workbook.sheets.length - 1, 0));
  // Drop styles/formats that normalization left unreferenced.
  return compactWorkbook(workbook);
}

function uniqueSheetName(workbook, wanted, ignoreIndex = -1, fallbackIndex = 0, upTo = Infinity) {
  const base =
    String(wanted || `Sheet${fallbackIndex + 1}`)
      .trim()
      .slice(0, 60) || `Sheet${fallbackIndex + 1}`;
  const taken = new Set(
    workbook.sheets
      .map((sheet, index) => (index === ignoreIndex || index >= upTo ? null : String(sheet.name || '').toUpperCase()))
      .filter(Boolean)
  );
  if (!taken.has(base.toUpperCase())) return base;
  let suffix = 2;
  for (;;) {
    const candidate = `${base} (${suffix})`;
    if (!taken.has(candidate.toUpperCase())) return candidate;
    suffix += 1;
  }
}

function compactWorkbook(workbook) {
  const usedStyles = new Set([0]);
  const usedFormats = new Set([0]);
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (cell.s) usedStyles.add(cell.s);
    }
  }
  const styleMap = new Map();
  const nextStyles = [{ ...DEFAULT_STYLE }];
  for (const index of Array.from(usedStyles).sort((a, b) => a - b)) {
    if (index === 0) {
      styleMap.set(0, 0);
      continue;
    }
    const style = workbook.styles[index] || { ...DEFAULT_STYLE };
    styleMap.set(index, nextStyles.length);
    nextStyles.push(style);
    if (style.format) usedFormats.add(style.format);
  }
  const formatMap = new Map([[0, 0]]);
  const nextFormats = ['General'];
  for (const index of Array.from(usedFormats).sort((a, b) => a - b)) {
    if (index === 0) continue;
    formatMap.set(index, nextFormats.length);
    nextFormats.push(workbook.formats[index] || 'General');
  }
  for (const sheet of workbook.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.s) continue;
      cell.s = styleMap.get(cell.s) || 0;
      const style = nextStyles[cell.s];
      if (style && style.format) style.format = formatMap.get(style.format) || 0;
      if (!cell.s) delete cell.s;
    }
  }
  workbook.styles = nextStyles;
  workbook.formats = nextFormats;
  // Style indexes moved, so the interning memo must not hand out stale ones.
  styleInternCache.clear();
  return workbook;
}

function getCell(workbook, sheetIndex, row, column) {
  const sheet = workbook.sheets[sheetIndex];
  if (!sheet) return null;
  return sheet.cells[key(row, column)] || null;
}

function getStyle(workbook, cell) {
  if (!cell || !cell.s) return workbook.styles[0] || DEFAULT_STYLE;
  return workbook.styles[cell.s] || workbook.styles[0] || DEFAULT_STYLE;
}

const styleInternCache = new Map();

function internStyle(workbook, style) {
  const normalized = normalizeStyle(style);
  const serialized = JSON.stringify(normalized);
  const cached = styleInternCache.get(serialized);
  if (cached !== undefined && workbook.styles[cached] && JSON.stringify(workbook.styles[cached]) === serialized)
    return cached;
  const existing = workbook.styles.findIndex((candidate) => JSON.stringify(candidate) === serialized);
  if (existing >= 0) {
    styleInternCache.set(serialized, existing);
    return existing;
  }
  if (workbook.styles.length >= 512) return 0;
  workbook.styles.push(normalized);
  const index = workbook.styles.length - 1;
  styleInternCache.set(serialized, index);
  return index;
}

function internFormat(workbook, pattern) {
  const text = String(pattern ?? 'General').slice(0, 64) || 'General';
  const existing = workbook.formats.indexOf(text);
  if (existing >= 0) return existing;
  if (workbook.formats.length >= 256) return 0;
  workbook.formats.push(text);
  return workbook.formats.length - 1;
}

const DEFAULT_CHAR_WIDTH = 7.4;

function measureText(text, fontSize = 13) {
  const value = String(text ?? '');
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code > 0x2e80)
      width += 1.72; // CJK and full-width forms
    else if (code >= 0x2190 && code <= 0x2bff)
      width += 1.2; // arrows, symbols
    else if (/[ilj.,:;'`|!]/.test(char)) width += 0.42;
    else if (/[mwMW@]/.test(char)) width += 1.12;
    else if (/[A-Z0-9]/.test(char)) width += 0.68;
    else width += 0.56;
  }
  return Math.ceil(width * fontSize * (DEFAULT_CHAR_WIDTH / 13));
}

function shiftFormula(source, rowDelta, columnDelta) {
  if (!rowDelta && !columnDelta) return source;
  const text = String(source ?? '');
  if (!text.startsWith('=')) return text;
  return Formula.rewriteReferences(
    text,
    (range) => {
      if (range.sheet) return undefined;
      const start = shiftRefText(range.startText, range.start.row, range.start.column, rowDelta, columnDelta);
      const end = shiftRefText(range.endText, range.end.row, range.end.column, rowDelta, columnDelta);
      return `${start}:${end}`;
    },
    (reference) => {
      if (reference.sheet) return undefined;
      return shiftRefText(reference.text, reference.row, reference.column, rowDelta, columnDelta);
    }
  );
}

function shiftRefText(text, row, column, rowDelta, columnDelta) {
  const columnAbsolute = String(text).startsWith('$');
  const rowAbsolute = String(text).lastIndexOf('$') > 0;
  const nextColumn = columnAbsolute ? column : Math.max(0, column + columnDelta);
  const nextRow = rowAbsolute ? row : Math.max(0, row + rowDelta);
  const prefix = columnAbsolute ? '$' : '';
  const rowPrefix = rowAbsolute ? '$' : '';
  return `${prefix}${Formula.columnToName(nextColumn)}${rowPrefix}${nextRow + 1}`;
}

function adoptWorkbook(target, source) {
  if (!target || typeof target !== 'object') return source;
  for (const existing of Object.keys(target)) {
    if (!Object.hasOwn(source, existing)) delete target[existing];
  }
  for (const [property, value] of Object.entries(source)) target[property] = value;
  return target;
}

function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MAX_SHEETS,
  MAX_CELLS_PER_SHEET,
  MAX_UNDO_STEPS,
  MAX_UNDO_BYTES,
  MAX_DISPLAY_ROWS,
  MAX_DISPLAY_COLUMNS,
  WORKBOOK_SCHEMA_VERSION,
  sheetIdSequence,
  DEFAULT_STYLE,
  key,
  toRange,
  rangeContains,
  eachRangeCell,
  clampNumber,
  createSheet,
  createWorkbook,
  makeSheetId,
  normalizeStyle,
  normalizeCell,
  normalizeWorkbook,
  uniqueSheetName,
  compactWorkbook,
  getCell,
  getStyle,
  styleInternCache,
  internStyle,
  internFormat,
  DEFAULT_CHAR_WIDTH,
  measureText,
  shiftFormula,
  shiftRefText,
  adoptWorkbook,
  cloneData
};
