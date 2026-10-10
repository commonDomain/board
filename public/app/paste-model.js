import {
  extractRowsFromHtmlTable,
  hasHeaderLikeFirstRow,
  looksLikeTable,
  parseDelimitedTable
} from './clipboard-model.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from './constants.js';

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
        return { rows, header: Boolean(parsed.header) };
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
          header: Boolean(table.querySelector('tr:first-child th')) || hasHeaderLikeFirstRow(rows)
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
export { normalizeClipboardTableRows, getStructuredClipboardTable, dataTransferContainsImage };
