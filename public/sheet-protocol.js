'use strict';

/* Shared spreadsheet trust boundary and collaboration command helpers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SheetProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VERSION = 1;
  const MAX_SHEETS = 32;
  const MAX_CELLS_PER_SHEET = 50000;
  const MAX_TOTAL_CELLS = 500000;
  const MAX_ROWS = 50000;
  const MAX_COLUMNS = 512;
  const MAX_STYLES = 512;
  const MAX_FORMATS = 256;
  const MAX_MERGES = 2048;
  const MAX_BATCH_COMMANDS = 50000;
  const MAX_FORMULA_LENGTH = 4096;
  const MAX_TEXT_LENGTH = 32767;

  class SheetProtocolError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'SheetProtocolError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new SheetProtocolError(code, message);
  }

  function plainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function integer(value, minimum, maximum, code, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      fail(code, `${field} is outside the supported spreadsheet range.`);
    }
    return number;
  }

  function cellKey(row, column) {
    return `${row}:${column}`;
  }

  function boundedString(value, limit, fallback = '') {
    return typeof value === 'string' ? value.slice(0, limit) : fallback;
  }

  function boundedInteger(value, minimum, maximum, fallback = 0) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function normalizeCell(raw, styleCount = MAX_STYLES) {
    if (raw === null) return null;
    if (!plainObject(raw)) fail('INVALID_SHEET_CELL', 'Spreadsheet cell payload is invalid.');
    const cell = {};
    if (typeof raw.f === 'string') {
      if (!raw.f.startsWith('=') || raw.f.length > MAX_FORMULA_LENGTH) {
        fail('INVALID_SHEET_FORMULA', 'Spreadsheet formula is invalid or too long.');
      }
      cell.f = raw.f;
    } else if (typeof raw.v === 'string') {
      if (raw.v.length > MAX_TEXT_LENGTH) fail('INVALID_SHEET_CELL', 'Spreadsheet text is too long.');
      cell.v = raw.v;
    } else if (typeof raw.v === 'number' && Number.isFinite(raw.v)) cell.v = raw.v;
    else if (typeof raw.v === 'boolean') cell.v = raw.v;
    if (raw.s !== undefined) {
      const style = integer(raw.s, 0, Math.max(0, styleCount - 1), 'INVALID_SHEET_STYLE', 'style index');
      if (style) cell.s = style;
    }
    if (cell.v === undefined && cell.f === undefined && !cell.s) return null;
    return cell;
  }

  function normalizeCommand(raw, workbook) {
    if (!plainObject(raw)) fail('INVALID_SHEET_COMMAND', 'Spreadsheet command must be an object.');
    if (!plainObject(workbook) || !Array.isArray(workbook.sheets)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet workbook is unavailable.');
    if (raw.protocolVersion !== VERSION) fail('SHEET_PROTOCOL_MISMATCH', 'Spreadsheet protocol changed. Refresh before editing.');
    if (raw.type === 'replace-workbook') {
      const expectedContentVersion = integer(raw.expectedContentVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'content version');
      const expectedStructureVersion = integer(raw.expectedStructureVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'workbook structure version');
      if (expectedStructureVersion !== Math.max(0, Math.trunc(Number(workbook.structureVersion) || 0))) {
        fail('SHEET_STRUCTURE_CONFLICT', 'Spreadsheet structure changed.');
      }
      const normalizedWorkbook = normalizeWorkbook(raw.workbook);
      return {
        type: 'replace-workbook', protocolVersion: VERSION, expectedContentVersion, expectedStructureVersion,
        workbook: normalizedWorkbook
      };
    }
    if (raw.type === 'set-cell') {
      const sheetId = typeof raw.sheetId === 'string' ? raw.sheetId.slice(0, 120) : '';
      if (!sheetId) fail('INVALID_SHEET_COMMAND', 'Spreadsheet command requires a worksheet id.');
      const sheet = workbook.sheets.find((entry) => entry && entry.sheetId === sheetId);
      if (!sheet) fail('SHEET_NOT_FOUND', 'Spreadsheet worksheet no longer exists.');
      const expectedStructureVersion = integer(raw.expectedStructureVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'structure version');
      const structureVersion = Math.max(0, Math.trunc(Number(sheet.structureVersion) || 0));
      if (expectedStructureVersion !== structureVersion) fail('SHEET_STRUCTURE_CONFLICT', 'Spreadsheet structure changed.');
      const row = integer(raw.row, 0, MAX_ROWS - 1, 'INVALID_SHEET_COMMAND', 'row');
      const column = integer(raw.column, 0, MAX_COLUMNS - 1, 'INVALID_SHEET_COMMAND', 'column');
      const expectedCellVersion = integer(raw.expectedCellVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'cell version');
      return {
        type: 'set-cell', protocolVersion: VERSION, sheetId, row, column, expectedStructureVersion, expectedCellVersion,
        cell: normalizeCell(raw.cell, Array.isArray(workbook.styles) ? workbook.styles.length : 1),
        ...(typeof raw.lockId === 'string' && raw.lockId.length <= 120 ? { lockId: raw.lockId } : {})
      };
    }
    if (raw.type === 'patch-cells') {
      const sheetId = typeof raw.sheetId === 'string' ? raw.sheetId.slice(0, 120) : '';
      const sheet = workbook.sheets.find((entry) => entry && entry.sheetId === sheetId);
      if (!sheet) fail('SHEET_NOT_FOUND', 'Spreadsheet worksheet no longer exists.');
      const expectedStructureVersion = integer(raw.expectedStructureVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'structure version');
      const structureVersion = Math.max(0, Math.trunc(Number(sheet.structureVersion) || 0));
      if (expectedStructureVersion !== structureVersion) fail('SHEET_STRUCTURE_CONFLICT', 'Spreadsheet structure changed.');
      if (!Array.isArray(raw.cells) || !raw.cells.length || raw.cells.length > MAX_BATCH_COMMANDS) {
        fail('INVALID_SHEET_COMMAND', 'Spreadsheet cell patch has an invalid size.');
      }
      const seen = new Set();
      const cells = raw.cells.map((entry) => {
        const row = integer(entry?.row, 0, MAX_ROWS - 1, 'INVALID_SHEET_COMMAND', 'row');
        const column = integer(entry?.column, 0, MAX_COLUMNS - 1, 'INVALID_SHEET_COMMAND', 'column');
        const key = cellKey(row, column);
        if (seen.has(key)) fail('INVALID_SHEET_COMMAND', 'Spreadsheet cell patch contains duplicate targets.');
        seen.add(key);
        return {
          row, column,
          expectedCellVersion: integer(entry.expectedCellVersion ?? 0, 0, Number.MAX_SAFE_INTEGER, 'INVALID_SHEET_COMMAND', 'cell version'),
          cell: normalizeCell(entry.cell, Array.isArray(workbook.styles) ? workbook.styles.length : 1),
          ...(Number.isInteger(entry.version) && entry.version > 0 ? { version: entry.version } : {})
        };
      });
      return { type: 'patch-cells', protocolVersion: VERSION, sheetId, expectedStructureVersion, cells };
    }
    fail('INVALID_SHEET_COMMAND', 'Unknown spreadsheet command.');
  }

  function applyCanonicalCommand(item, raw, options = {}) {
    if (!item || item.type !== 'sheet' || !plainObject(item.workbook)) fail('SHEET_NOT_FOUND', 'Spreadsheet no longer exists.');
    const command = normalizeCommand(raw, item.workbook);
    if (command.type === 'replace-workbook') {
      const currentContentVersion = Math.max(0, Math.trunc(Number(item.contentVersion) || 0));
      if (!options.canonical && currentContentVersion !== command.expectedContentVersion) {
        fail('SHEET_CONTENT_CONFLICT', 'Spreadsheet content changed. Your local draft was retained.');
      }
      item.workbook = command.workbook;
      item.sheetEditedAt = Math.max(Number(item.sheetEditedAt) || 0, Math.trunc(Number(raw.editedAt) || 0));
      return { ...command, editedAt: item.sheetEditedAt };
    }
    const sheet = item.workbook.sheets.find((entry) => entry.sheetId === command.sheetId);
    if (!plainObject(sheet.cells)) sheet.cells = {};
    if (!plainObject(sheet.cellVersions)) sheet.cellVersions = {};
    const changes = command.type === 'set-cell' ? [command] : command.cells;
    const canonicalCells = [];
    for (const change of changes) {
      const key = cellKey(change.row, change.column);
      const currentVersion = Math.max(0, Math.trunc(Number(sheet.cellVersions[key]) || 0));
      const version = Number.isInteger(raw.version) && command.type === 'set-cell'
        ? raw.version
        : Number.isInteger(change.version) ? change.version : currentVersion + 1;
      if (!options.canonical && currentVersion !== change.expectedCellVersion) {
        fail('SHEET_CELL_CONFLICT', `Cell version changed from ${change.expectedCellVersion} to ${currentVersion}.`);
      }
      if (options.canonical && currentVersion >= version) continue;
      if (change.cell) sheet.cells[key] = change.cell;
      else delete sheet.cells[key];
      sheet.cellVersions[key] = version;
      canonicalCells.push({ ...change, version });
    }
    item.sheetEditedAt = Math.max(Number(item.sheetEditedAt) || 0, Math.trunc(Number(raw.editedAt) || 0));
    return command.type === 'set-cell'
      ? { ...(canonicalCells[0] || command), type: 'set-cell', sheetId: command.sheetId, editedAt: item.sheetEditedAt }
      : { type: 'patch-cells', sheetId: command.sheetId, cells: canonicalCells, editedAt: item.sheetEditedAt };
  }

  function inspectWorkbook(workbook) {
    if (!plainObject(workbook) || !Array.isArray(workbook.sheets) || !workbook.sheets.length || workbook.sheets.length > MAX_SHEETS) {
      fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet workbook has an invalid worksheet count.');
    }
    if (!Array.isArray(workbook.styles) || workbook.styles.length < 1 || workbook.styles.length > MAX_STYLES) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet style table is invalid.');
    if (!Array.isArray(workbook.formats) || workbook.formats.length < 1 || workbook.formats.length > MAX_FORMATS) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet format table is invalid.');
    if (workbook.recovery?.unplacedCells && (!Array.isArray(workbook.recovery.unplacedCells) || workbook.recovery.unplacedCells.length > 1000)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet recovery data is too large.');
    const ids = new Set();
    let totalCells = 0;
    for (const sheet of workbook.sheets) {
      if (!plainObject(sheet) || typeof sheet.sheetId !== 'string' || !sheet.sheetId || ids.has(sheet.sheetId)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet worksheet ids must be unique.');
      ids.add(sheet.sheetId);
      const entries = plainObject(sheet.cells) ? Object.entries(sheet.cells) : [];
      if (entries.length > MAX_CELLS_PER_SHEET) fail('SHEET_SHARD_REQUIRED', `Worksheet exceeds ${MAX_CELLS_PER_SHEET} non-empty cells.`);
      totalCells += entries.length;
      if (totalCells > MAX_TOTAL_CELLS) fail('SHEET_WORKBOOK_LIMIT', `Workbook exceeds ${MAX_TOTAL_CELLS} non-empty cells.`);
      if (Array.isArray(sheet.merges) && sheet.merges.length > MAX_MERGES) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet has too many merged ranges.');
      for (const [key, cell] of entries) {
        const match = /^(\d{1,5}):(\d{1,3})$/.exec(key);
        if (!match || Number(match[1]) >= MAX_ROWS || Number(match[2]) >= MAX_COLUMNS) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet contains an invalid cell address.');
        normalizeCell(cell, workbook.styles.length);
      }
    }
    return { sheets: workbook.sheets.length, cells: totalCells };
  }

  /** Builds a plain, bounded workbook and drops every field outside the schema. */
  function normalizeWorkbook(workbook) {
    inspectWorkbook(workbook);
    const styleFields = new Set([
      'bold', 'italic', 'underline', 'strike', 'wrap', 'align', 'valign', 'color', 'fill', 'format', 'size', 'family',
      'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'
    ]);
    const styles = workbook.styles.map((raw) => {
      const style = {};
      if (!plainObject(raw)) return style;
      for (const [field, value] of Object.entries(raw)) {
        if (!styleFields.has(field)) continue;
        if (typeof value === 'boolean') style[field] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) style[field] = Math.max(0, Math.min(256, value));
        else if (typeof value === 'string') style[field] = value.slice(0, field === 'family' ? 256 : 64);
      }
      return style;
    });
    const formats = workbook.formats.map((value) => boundedString(value, 64, 'General'));
    const sheets = workbook.sheets.map((rawSheet) => {
      const cells = {};
      for (const [address, rawCell] of Object.entries(plainObject(rawSheet.cells) ? rawSheet.cells : {})) {
        const cell = normalizeCell(rawCell, styles.length);
        if (cell) cells[address] = cell;
      }
      const cellVersions = {};
      const rawVersions = plainObject(rawSheet.cellVersions) ? rawSheet.cellVersions : {};
      if (Object.keys(rawVersions).length > MAX_CELLS_PER_SHEET * 2) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet cell version table is too large.');
      for (const [address, version] of Object.entries(rawVersions)) {
        if (!/^\d{1,5}:\d{1,3}$/.test(address)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet contains an invalid cell version address.');
        const [row, column] = address.split(':').map(Number);
        if (row >= MAX_ROWS || column >= MAX_COLUMNS) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet contains an invalid cell version address.');
        const numeric = boundedInteger(version, 0, Number.MAX_SAFE_INTEGER, 0);
        if (numeric) cellVersions[address] = numeric;
      }
      const axis = (source, maximum, minimumValue, maximumValue) => {
        const output = {};
        for (const [key, value] of Object.entries(plainObject(source) ? source : {})) {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index >= maximum || !Number.isFinite(Number(value))) {
            fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet axis metadata is invalid.');
          }
          output[index] = Math.max(minimumValue, Math.min(maximumValue, Number(value)));
        }
        return output;
      };
      const hidden = (source, maximum) => {
        if (source === null || source === undefined) return null;
        if (!plainObject(source)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet hidden-axis metadata is invalid.');
        const output = {};
        for (const [key, value] of Object.entries(source)) {
          const index = Number(key);
          if (value !== true || !Number.isInteger(index) || index < 0 || index >= maximum) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet hidden-axis metadata is invalid.');
          output[index] = true;
        }
        return Object.keys(output).length ? output : null;
      };
      const normalizeFilters = (source) => {
        if (source === null || source === undefined) return null;
        if (!plainObject(source) || !plainObject(source.range) || !Array.isArray(source.criteria) || source.criteria.length > MAX_COLUMNS) {
          fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet filter metadata is invalid.');
        }
        const range = {
          startRow: integer(source.range.startRow, 0, MAX_ROWS - 1, 'INVALID_SHEET_WORKBOOK', 'filter row'),
          startColumn: integer(source.range.startColumn, 0, MAX_COLUMNS - 1, 'INVALID_SHEET_WORKBOOK', 'filter column'),
          endRow: integer(source.range.endRow, 0, MAX_ROWS - 1, 'INVALID_SHEET_WORKBOOK', 'filter row'),
          endColumn: integer(source.range.endColumn, 0, MAX_COLUMNS - 1, 'INVALID_SHEET_WORKBOOK', 'filter column')
        };
        if (range.startRow > range.endRow || range.startColumn > range.endColumn) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet filter range is invalid.');
        const operators = new Set(['contains', 'notContains', 'beginsWith', 'endsWith', 'equals', 'notEquals', 'greater', 'greaterOrEqual', 'less', 'lessOrEqual', 'blank', 'notBlank']);
        const criteria = source.criteria.map((entry) => {
          if (!plainObject(entry)) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet filter criterion is invalid.');
          const column = integer(entry.column, range.startColumn, range.endColumn, 'INVALID_SHEET_WORKBOOK', 'filter column');
          const operator = operators.has(entry.operator) ? entry.operator : 'contains';
          let value = entry.value;
          if (typeof value === 'string') value = value.slice(0, 32767);
          else if (typeof value === 'number' && Number.isFinite(value)) value = value;
          else if (typeof value === 'boolean') value = value;
          else value = '';
          return { column, operator, value };
        });
        return { range, criteria };
      };
      const merges = (Array.isArray(rawSheet.merges) ? rawSheet.merges : []).map((merge) => {
        if (!Array.isArray(merge) || merge.length !== 4) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet merge is invalid.');
        const values = merge.map((value, index) => integer(value, 0, index % 2 ? MAX_COLUMNS - 1 : MAX_ROWS - 1, 'INVALID_SHEET_WORKBOOK', 'merge coordinate'));
        if (values[0] > values[2] || values[1] > values[3]) fail('INVALID_SHEET_WORKBOOK', 'Spreadsheet merge is invalid.');
        return values;
      });
      return {
        sheetId: boundedString(rawSheet.sheetId, 120),
        name: boundedString(rawSheet.name, 60, 'Sheet'),
        structureVersion: boundedInteger(rawSheet.structureVersion, 0, Number.MAX_SAFE_INTEGER, 0),
        cells, cellVersions,
        cols: axis(rawSheet.cols, MAX_COLUMNS, 16, 1000),
        rows: axis(rawSheet.rows, MAX_ROWS, 8, 1000),
        merges,
        frozen: {
          rows: boundedInteger(rawSheet.frozen?.rows, 0, 64, 0),
          cols: boundedInteger(rawSheet.frozen?.cols, 0, 64, 0)
        },
        rowsHint: boundedInteger(rawSheet.rowsHint, 0, MAX_ROWS, 0),
        colsHint: boundedInteger(rawSheet.colsHint, 0, MAX_COLUMNS, 0),
        hiddenRows: hidden(rawSheet.hiddenRows, MAX_ROWS),
        hiddenColumns: hidden(rawSheet.hiddenColumns, MAX_COLUMNS),
        filters: normalizeFilters(rawSheet.filters)
      };
    });
    const recovery = Array.isArray(workbook.recovery?.unplacedCells)
      ? workbook.recovery.unplacedCells.slice(0, 1000).map((entry) => ({
          sheetId: boundedString(entry?.sheetId, 120), sheetName: boundedString(entry?.sheetName, 60),
          address: boundedString(entry?.address, 32), reason: boundedString(entry?.reason, 80)
        }))
      : [];
    return {
      schemaVersion: 2,
      structureVersion: boundedInteger(workbook.structureVersion, 0, Number.MAX_SAFE_INTEGER, 0),
      title: boundedString(workbook.title, 120, '工作表'),
      active: boundedInteger(workbook.active, 0, sheets.length - 1, 0),
      sheets, styles, formats, recovery: { unplacedCells: recovery }
    };
  }

  return Object.freeze({ VERSION, MAX_SHEETS, MAX_CELLS_PER_SHEET, MAX_TOTAL_CELLS, MAX_ROWS, MAX_COLUMNS, MAX_FORMULA_LENGTH, MAX_TEXT_LENGTH, SheetProtocolError, normalizeCell, normalizeWorkbook, normalizeCommand, applyCanonicalCommand, inspectWorkbook });
});
