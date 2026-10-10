import { getBoardPoint, getBoardPointFromClient } from './camera.js';
import {
  extractRowsFromHtmlTable,
  hasHeaderLikeFirstRow,
  looksLikeIndentedTree,
  looksLikeTable,
  parseDelimitedTable,
  treeFromIndentedText,
  treeFromList
} from './clipboard-model.js';
import { pasteClipboard } from './clipboard.js';
import { isRemoteBoardLocked } from './connection-model.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from './constants.js';
import { getViewportDropPoint } from './geometry.js';
import { normalizeImageForBoard } from './image-upload-model.js';
import { uploadImageAsset } from './image-upload.js';
import { showToast } from './interface-model.js';
import { addImageItem, addTableItem, addTextLikeItem, getImageDisplaySize } from './items.js';
import {addMindMapItem} from './mindmap-import.js';
import { renderItem } from './rendering.js';
import { markDirty } from './save-status.js';
import { state } from './state.js';
import {
  getTableCellCoordinates,
  getTableColumnCount,
  getTableColumnWidths,
  getTableRowCount,
  getTableRowHeights,
  syncTableFromDom
} from './table-rendering-model.js';
import { cssEscape, isEditableTarget } from './utilities.js';
import { normalizeClipboardTableRows, getStructuredClipboardTable } from './paste-model.js';

function handlePasteEvent(event) {
  if (window.__independentNotesActive) return;
  if (isRemoteBoardLocked()) {
    event.preventDefault();
    return;
  }
  if (!state.boardId) return;
  const clipboard = event.clipboardData;
  if (!clipboard) {
    return;
  }

  const keyboardPasteRequested = Date.now() - state.keyboardPasteRequestedAt < 1500;
  state.keyboardPasteRequestedAt = 0;

  const structuredTable = getStructuredClipboardTable(clipboard);

  if (isEditableTarget(event.target)) {
    const targetCell = event.target.closest?.('.board-table td, .board-table th');
    if (targetCell && structuredTable && pasteRowsIntoTableCell(targetCell, structuredTable)) {
      event.preventDefault();
    }
    return;
  }

  if ((state.internalClipboardPreferred || state.pendingCut) && state.clipboard.length) {
    event.preventDefault();
    pasteClipboard();
    return;
  }

  if (structuredTable) {
    event.preventDefault();
    addTableItem(getViewportDropPoint(), structuredTable.rows, structuredTable.header, { autoEdit: true });
    return;
  }

  const imageItem = Array.from(clipboard.items || []).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/')
  );
  const imageFile =
    imageItem?.getAsFile() || Array.from(clipboard.files || []).find((file) => file.type.startsWith('image/'));
  if (keyboardPasteRequested && (imageItem || imageFile)) {
    event.preventDefault();
    if (imageFile) {
      addImageBlobAtPointer(imageFile);
    } else {
      showToast('无法读取剪贴板图片，请重新复制后再试');
    }
    return;
  }

  const html = clipboard.getData('text/html');
  if (html && pasteHtml(html)) {
    event.preventDefault();
    return;
  }

  const text = clipboard.getData('text/plain');
  if (text && pastePlainText(text)) {
    event.preventDefault();
    return;
  }
}

function pasteRowsIntoTableCell(targetCell, clipboardTable) {
  const itemElement = targetCell.closest('.board-item');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  const start = getTableCellCoordinates(targetCell);
  if (!item || item.type !== 'table' || state.editingId !== item.id || !start) {
    return false;
  }

  syncTableFromDom(itemElement, item);
  const pastedRows = normalizeClipboardTableRows(clipboardTable.rows);
  if (!pastedRows.length) {
    return false;
  }
  const oldRowCount = getTableRowCount(item);
  const oldColumnCount = getTableColumnCount(item);
  const pastedColumnCount = Math.max(1, ...pastedRows.map((row) => row.length));
  const nextRowCount = Math.min(MAX_TABLE_ROWS, Math.max(oldRowCount, start.row + pastedRows.length));
  const nextColumnCount = Math.min(MAX_TABLE_COLUMNS, Math.max(oldColumnCount, start.column + pastedColumnCount));
  const nextRows = Array.from({ length: nextRowCount }, (_, rowIndex) =>
    Array.from({ length: nextColumnCount }, (_, columnIndex) => String(item.rows?.[rowIndex]?.[columnIndex] || ''))
  );
  pastedRows.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      const rowIndex = start.row + rowOffset;
      const columnIndex = start.column + columnOffset;
      if (rowIndex < nextRowCount && columnIndex < nextColumnCount) {
        nextRows[rowIndex][columnIndex] = value;
      }
    });
  });

  const widths = getTableColumnWidths(item, oldColumnCount);
  while (widths.length < nextColumnCount) widths.push(110);
  const heights = getTableRowHeights(item, oldRowCount);
  while (heights.length < nextRowCount) heights.push(35);
  item.rows = nextRows;
  item.columnWidths = widths;
  item.rowHeights = heights;
  item.w = widths.reduce((sum, width) => sum + width, 0);
  item.h = heights.reduce((sum, height) => sum + height, 0);
  state.items.set(item.id, item);
  state.tableCellSelection = {
    itemId: item.id,
    start,
    end: {
      row: Math.min(nextRowCount - 1, start.row + pastedRows.length - 1),
      column: Math.min(nextColumnCount - 1, start.column + pastedColumnCount - 1)
    }
  };
  renderItem(item);
  markDirty(true);
  requestAnimationFrame(() => {
    const cell = document.querySelector(
      `.board-item[data-item-id="${cssEscape(item.id)}"] [data-row="${start.row}"][data-column="${start.column}"]`
    );
    cell?.focus({ preventScroll: true });
  });
  showToast(`已粘贴 ${pastedRows.length}×${pastedColumnCount} 个单元格`);
  return true;
}

async function handleFileDrop(event) {
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) {
    return;
  }
  const point = getBoardPoint(event);
  let offset = 0;
  for (const file of files) {
    try {
      const image = await normalizeImageForBoard(file);
      const src = await uploadImageAsset(image);
      addImageItem({ x: point.x + offset, y: point.y + offset }, src, image.width, image.height);
      offset += 30;
    } catch (error) {
      console.error(error);
      showToast('图片上传失败，请稍后重试');
    }
  }
}

function pasteHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (table) {
    const rows = normalizeClipboardTableRows(extractRowsFromHtmlTable(table));
    if (rows.length) {
      const header = Boolean(table.querySelector('tr:first-child th')) || hasHeaderLikeFirstRow(rows);
      addTableItem(getViewportDropPoint(), rows, header, { autoEdit: true });
      return true;
    }
  }

  const listRoot = doc.querySelector('ul, ol');
  if (listRoot) {
    const tree = treeFromList(listRoot);
    if (tree && tree.children.length) {
      addMindMapItem(getViewportDropPoint(), tree);
      return true;
    }
  }

  const bodyText = (doc.body.textContent || '').trim();
  if (bodyText) {
    return pastePlainText(bodyText);
  }
  return false;
}

function pastePlainText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (looksLikeTable(text)) {
    addTableItem(getViewportDropPoint(), parseDelimitedTable(text), false, { autoEdit: true });
    return true;
  }
  if (looksLikeIndentedTree(text)) {
    const tree = treeFromIndentedText(text);
    if (tree) {
      addMindMapItem(getViewportDropPoint(), tree);
      return true;
    }
  }
  addTextLikeItem('text', getViewportDropPoint(), trimmed);
  return true;
}

async function addImageBlobAtViewport(blob) {
  if (!blob) {
    return;
  }
  try {
    const image = await normalizeImageForBoard(blob);
    const src = await uploadImageAsset(image);
    addImageItem(getViewportDropPoint(), src, image.width, image.height);
  } catch (error) {
    console.error(error);
    showToast('图片上传失败，请稍后重试');
  }
}

async function addImageBlobAtPointer(blob) {
  if (!blob) return;
  try {
    const image = await normalizeImageForBoard(blob);
    const src = await uploadImageAsset(image);
    const pointer = state.lastCanvasPointer;
    if (!pointer) {
      addImageItem(getViewportDropPoint(), src, image.width, image.height);
      return;
    }
    const boardPoint = getBoardPointFromClient(pointer.clientX, pointer.clientY);
    const displaySize = getImageDisplaySize(image.width, image.height);
    addImageItem(
      { x: boardPoint.x - displaySize.w / 2, y: boardPoint.y - displaySize.h / 2 },
      src,
      image.width,
      image.height
    );
  } catch (error) {
    console.error(error);
    showToast('图片上传失败，请稍后重试');
  }
}
export {
  handlePasteEvent,
  pasteRowsIntoTableCell,
  handleFileDrop,
  pasteHtml,
  pastePlainText,
  addImageBlobAtViewport,
  addImageBlobAtPointer
};

