import {
  extractRowsFromHtmlTable,
  extractFormatsFromHtmlTable,
  hasHeaderLikeFirstRow,
  looksLikeTable,
  parseDelimitedTable
} from './clipboard-model.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from './constants.js';
import { matchingRichText, defaultRichTextRun } from './text-rendering-model.js';

function clipboardCellFormats(source, rows) {
  const cellRichText = {}, cellStyles = {};
  rows.forEach((row, r) => row.forEach((text, c) => {
    const key = `${r}/${c}`, rawStyle = source?.cellStyles?.[key];
    if (rawStyle && typeof rawStyle === 'object') cellStyles[key] = pickCellStyle(rawStyle);
    const runs = source?.cellRichText?.[key];
    if (Array.isArray(runs) && runs.length <= 5000 && matchingRichText(runs,text).length)
      cellRichText[key] = runs.map(run => ({ ...pickCellStyle(run), text:String(run.text || '') }));
  }));
  return { cellRichText, cellStyles };
}

function pickCellStyle(source) {
  const result = {};
  for (const key of ['color','fontFamily','align']) if (typeof source[key] === 'string') result[key] = source[key].slice(0,200);
  if (Number.isFinite(source.fontSize)) result.fontSize = Math.max(8,Math.min(256,source.fontSize));
  for (const key of ['bold','italic','underline']) if (typeof source[key] === 'boolean') result[key] = source[key];
  return result;
}

function applyClipboardTableFormats(item, source, startRow = 0, startColumn = 0) {
  window.ConnectorCore.ensureTableIds(item);
  const formats = clipboardCellFormats(source, source.rows);
  item.cellRichText ||= {}; item.cellStyles ||= {};
  source.rows.forEach((row,r) => row.forEach((text,c) => {
    if (!item.rowIds[startRow+r] || !item.columnIds[startColumn+c]) return;
    const from = `${r}/${c}`, to = `${item.rowIds[startRow+r]}/${item.columnIds[startColumn+c]}`;
    // Replacing equal plain text must still discard stale target character styles.
    delete item.cellRichText[to];
    if (formats.cellStyles[from]) item.cellStyles[to] = {...formats.cellStyles[from]};
    if (formats.cellRichText[from]) {
      const defaults=defaultRichTextRun({...item,...item.cellStyles[to]});
      item.cellRichText[to] = formats.cellRichText[from].map(run=>({...defaults,...run}));
    }
  }));
}

function normalizeClipboardTableRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }
  const limitedRows = rows.slice(0, MAX_TABLE_ROWS);
  const columnCount = Math.min(
    MAX_TABLE_COLUMNS,
    Math.max(1, ...limitedRows.map((row) => (Array.isArray(row) ? row.length : 0)))
  );
  return limitedRows.map((row) => {
    const values = Array.isArray(row) ? row : [];
    return Array.from({ length: columnCount }, (_, columnIndex) => String(values[columnIndex] || '').slice(0, 5000));
  });
}

function getStructuredClipboardTable(clipboard) {
  try {
    const internal = clipboard.getData('application/x-whiteboard-table+json');
    if (internal) {
      const parsed = JSON.parse(internal);
      const rows = normalizeClipboardTableRows(parsed?.rows);
      if (rows.length) {
        return { rows, header: Boolean(parsed.header), ...clipboardCellFormats(parsed,rows) };
      }
    }
  } catch {
    // Fall through to interoperable HTML and TSV formats.
  }

  const html = clipboard.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (table) {
      const rows = normalizeClipboardTableRows(extractRowsFromHtmlTable(table));
      if (rows.length) {
        return {
          rows,
          header: Boolean(table.querySelector('tr:first-child th')) || hasHeaderLikeFirstRow(rows),
          ...clipboardCellFormats(extractFormatsFromHtmlTable(table),rows)
        };
      }
    }
  }

  const text = clipboard.getData('text/plain');
  if (looksLikeTable(text)) {
    const rows = normalizeClipboardTableRows(parseDelimitedTable(text));
    if (rows.length) {
      return { rows, header: false };
    }
  }
  return null;
}

function dataTransferContainsImage(dataTransfer) {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items || []);
  if (items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true;
  return Array.from(dataTransfer.files || []).some((file) => file.type.startsWith('image/'));
}
export { normalizeClipboardTableRows, getStructuredClipboardTable, dataTransferContainsImage, applyClipboardTableFormats };
