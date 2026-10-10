'use strict';

const { FILL_HANDLE_SIZE, RESIZE_GRAB_PX, readPalette } = require('./controls');

function createInteraction({
  canvas,
  columnX,
  displayColumnWidth,
  displayRowHeight,
  frozen,
  headerOffsetX,
  headerOffsetY,
  hiddenRowRunY,
  hiddenRowRuns,
  requestDraw,
  rowY,
  state,
  viewport
}) {
  function cellAt(clientX, clientY) {
    const storeRef = state.store;
    if (!storeRef) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < headerOffsetX() || y < headerOffsetY()) return null;
    const pane = frozen();
    const paneRight = headerOffsetX() + pane.width;
    const paneBottom = headerOffsetY() + pane.height;
    // The scroll offset counts pixels scrolled past the first body row, so the
    // sheet coordinate adds back the pane and the first body row's own offset.
    const column =
      x < paneRight
        ? storeRef.columnAtOffset(x - headerOffsetX(), 4096)
        : storeRef.columnAtOffset(storeRef.columnOffset(pane.cols, 4096) + state.scrollLeft + (x - paneRight), 4096);
    const row =
      y < paneBottom
        ? storeRef.rowAtOffset(y - headerOffsetY(), 4096)
        : storeRef.rowAtOffset(storeRef.rowOffset(pane.rows, 4096) + state.scrollTop + (y - paneBottom), 4096);
    return { row: Math.max(0, row), column: Math.max(0, column) };
  }

  function isOnFillHandle(clientX, clientY) {
    const storeRef = state.store;
    if (!storeRef) return false;
    const end = state.selection.end;
    const x = columnX(end.column) + displayColumnWidth(end.column);
    const y = rowY(end.row) + displayRowHeight(end.row);
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return Math.abs(px - x) <= FILL_HANDLE_SIZE && Math.abs(py - y) <= FILL_HANDLE_SIZE;
  }

  function headerColumnAt(clientX, clientY) {
    const storeRef = state.store;
    if (!storeRef) return null;
    const rect = canvas.getBoundingClientRect();
    const y = clientY - rect.top;
    if (y >= headerOffsetY()) return null;
    const cell = cellAt(clientX, clientY + headerOffsetY() + 4);
    return cell ? cell.column : null;
  }

  function headerRowAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x >= headerOffsetX()) return null;
    const cell = cellAt(clientX + headerOffsetX() + 4, clientY);
    return cell ? cell.row : null;
  }

  function hiddenRowRevealAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x > headerOffsetX()) return null;
    for (const run of hiddenRowRuns()) {
      if (Math.abs(y - hiddenRowRunY(run)) <= 8) return run;
    }
    return null;
  }

  function columnResizeHandleAt(clientX, clientY) {
    const storeRef = state.store;
    if (!storeRef) return null;
    if (clientY - canvas.getBoundingClientRect().top >= headerOffsetY()) return null;
    const view = viewport();
    if (!view) return null;
    for (let column = view.firstColumn; column <= view.lastColumn; column += 1) {
      const edge = columnX(column) + displayColumnWidth(column);
      if (Math.abs(clientX - canvas.getBoundingClientRect().left - edge) <= RESIZE_GRAB_PX) return column;
    }
    return null;
  }

  function rowResizeHandleAt(clientX, clientY) {
    const storeRef = state.store;
    if (!storeRef) return null;
    if (clientX - canvas.getBoundingClientRect().left >= headerOffsetX()) return null;
    const view = viewport();
    if (!view) return null;
    for (let row = view.firstRow; row <= view.lastRow; row += 1) {
      const edge = rowY(row) + displayRowHeight(row);
      if (Math.abs(clientY - canvas.getBoundingClientRect().top - edge) <= RESIZE_GRAB_PX) return row;
    }
    return null;
  }

  function scrollCellIntoView(row, column) {
    const storeRef = state.store;
    if (!storeRef) return;
    const pane = frozen();
    const view = viewport();
    if (!view) return;
    const headerH = headerOffsetY();
    const headerW = headerOffsetX();
    // "<=" on the window start is deliberate: when the target is exactly the
    // first visible row the grid was scrolled further than the target needs
    // (a jump back into the sheet), so the offset must be re-anchored instead
    // of left as is.
    if (row <= pane.rows || row <= view.firstRow) {
      state.scrollTop = Math.max(0, storeRef.rowOffset(row, 4096) - storeRef.rowOffset(pane.rows, 4096));
    } else {
      const bottom = rowY(row) + displayRowHeight(row);
      if (bottom > state.height) {
        const visible = state.height - headerH - pane.height;
        state.scrollTop = Math.max(
          0,
          storeRef.rowOffset(row + 1, 4096) - storeRef.rowOffset(pane.rows, 4096) - visible
        );
      }
    }
    if (column <= pane.cols || column <= view.firstColumn) {
      state.scrollLeft = Math.max(0, storeRef.columnOffset(column, 4096) - storeRef.columnOffset(pane.cols, 4096));
    } else {
      const right = columnX(column) + displayColumnWidth(column);
      if (right > state.width) {
        const visible = state.width - headerW - pane.width;
        state.scrollLeft = Math.max(
          0,
          storeRef.columnOffset(column + 1, 4096) - storeRef.columnOffset(pane.cols, 4096) - visible
        );
      }
    }
    requestDraw();
  }

  function setScroll(top, left) {
    const metrics = getScrollMetrics();
    state.scrollTop = Math.max(0, Math.min(metrics.maxTop, Number(top) || 0));
    state.scrollLeft = Math.max(0, Math.min(metrics.maxLeft, Number(left) || 0));
    requestDraw();
  }

  function getScrollMetrics() {
    const storeRef = state.store;
    if (!storeRef)
      return {
        left: 0,
        top: 0,
        maxLeft: 0,
        maxTop: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        contentWidth: 0,
        contentHeight: 0
      };
    const pane = frozen();
    const bounds = storeRef.displayBounds(4096);
    const contentWidth = Math.max(
      0,
      storeRef.columnOffset(bounds.columns, 4096) - storeRef.columnOffset(pane.cols, 4096)
    );
    const contentHeight = Math.max(0, storeRef.rowOffset(bounds.rows, 4096) - storeRef.rowOffset(pane.rows, 4096));
    const viewportWidth = Math.max(0, state.width - headerOffsetX() - pane.width);
    const viewportHeight = Math.max(0, state.height - headerOffsetY() - pane.height);
    return {
      left: state.scrollLeft,
      top: state.scrollTop,
      maxLeft: Math.max(0, contentWidth - viewportWidth),
      maxTop: Math.max(0, contentHeight - viewportHeight),
      viewportWidth,
      viewportHeight,
      contentWidth,
      contentHeight
    };
  }

  function scrollOffsetFor(row, column) {
    const storeRef = state.store;
    if (!storeRef) return { top: 0, left: 0 };
    const pane = frozen();
    return {
      top: Math.max(0, storeRef.rowOffset(row, 4096) - storeRef.rowOffset(pane.rows, 4096)),
      left: Math.max(0, storeRef.columnOffset(column, 4096) - storeRef.columnOffset(pane.cols, 4096))
    };
  }

  function getScroll() {
    return { top: state.scrollTop, left: state.scrollLeft };
  }

  function cellRect(row, column) {
    const storeRef = state.store;
    if (!storeRef) return null;
    const width = displayColumnWidth(column);
    const height = displayRowHeight(row);
    return { x: columnX(column), y: rowY(row), width, height };
  }

  function setSelection(row, column) {
    state.selection.anchor.row = row;
    state.selection.anchor.column = column;
    state.selection.focus.row = row;
    state.selection.focus.column = column;
    requestDraw();
  }

  function setHover(row, column) {
    if (state.hover && state.hover.row === row && state.hover.column === column) return;
    state.hover = row === null ? null : { row, column };
    requestDraw();
  }

  function setEditing(row, column) {
    state.editing = row === null ? null : { row, column };
    requestDraw();
  }

  function setDropTarget(target) {
    state.dropTarget = target;
    requestDraw();
  }

  function refreshPalette() {
    state.palette = readPalette(canvas);
    requestDraw();
  }

  return {
    cellAt,
    isOnFillHandle,
    headerColumnAt,
    headerRowAt,
    hiddenRowRevealAt,
    columnResizeHandleAt,
    rowResizeHandleAt,
    scrollCellIntoView,
    setScroll,
    getScrollMetrics,
    scrollOffsetFor,
    getScroll,
    cellRect,
    setSelection,
    setHover,
    setEditing,
    setDropTarget,
    refreshPalette
  };
}

module.exports = { createInteraction };
