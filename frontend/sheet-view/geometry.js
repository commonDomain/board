'use strict';

const { HEADER_HEIGHT, HEADER_WIDTH } = require('./controls');

function createGeometry({ requestDraw, state }) {
  function freezeRendering() {
    return state.freezeRendering === true;
  }

  function frozen() {
    if (!state.store || !freezeRendering()) return { rows: 0, cols: 0, width: 0, height: 0 };
    return state.store.frozenOffsets(4096);
  }

  function headerOffsetX() {
    return state.showHeaders ? HEADER_WIDTH : 0;
  }

  function headerOffsetY() {
    return state.showHeaders ? HEADER_HEIGHT : 0;
  }

  function hiddenRowSet() {
    const storeRef = state.store;
    if (!storeRef) return new Set();
    const hidden = storeRef.activeSheet?.().hiddenRows;
    if (!hidden) return new Set();
    return new Set(Object.keys(hidden).map(Number));
  }

  function hiddenRowRuns() {
    const rows = Array.from(state.hiddenRows)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const runs = [];
    for (const row of rows) {
      const last = runs[runs.length - 1];
      if (last && row === last.end + 1) last.end = row;
      else runs.push({ start: row, end: row });
    }
    return runs;
  }

  function hiddenRowRunY(run) {
    if (!state.store || !run) return -1;
    // A hidden row has no own screen coordinate. The first visible row after
    // the run starts at the exact collapsed boundary we need to mark.
    return rowY(run.end + 1);
  }

  function setHighlight(row, column) {
    const changed = state.highlightRow !== row || state.highlightColumn !== column;
    state.highlightRow = row;
    state.highlightColumn = column;
    if (changed) requestDraw();
  }

  function paintHighlight(ctx, storeRef, view, palette) {
    if (state.highlightRow === null && state.highlightColumn === null) return;
    const pane = frozen();
    ctx.save();
    ctx.fillStyle = palette.accentSoft;
    if (state.highlightColumn !== null) {
      const column = state.highlightColumn;
      const x = columnX(column);
      const width = displayColumnWidth(column);
      if (x + width > headerOffsetX() + pane.width && x < state.width) {
        ctx.fillRect(x, headerOffsetY() + pane.height, width, state.height - headerOffsetY() - pane.height);
      }
    }
    if (state.highlightRow !== null) {
      const row = state.highlightRow;
      const y = rowY(row);
      if (y >= 0) {
        const height = displayRowHeight(row);
        ctx.fillRect(headerOffsetX() + pane.width, y, state.width - headerOffsetX() - pane.width, height);
      }
    }
    ctx.restore();
  }

  function scrollColumnX(column) {
    const storeRef = state.store;
    const pane = frozen();
    return (
      headerOffsetX() +
      pane.width +
      storeRef.columnOffset(column, 4096, state.sizeOverride) -
      storeRef.columnOffset(pane.cols, 4096, null) -
      state.scrollLeft
    );
  }

  function scrollRowY(row) {
    const storeRef = state.store;
    const pane = frozen();
    const rowTop = visibleRowTop(row);
    if (rowTop < 0) return -1;
    return headerOffsetY() + pane.height + rowTop - storeRef.rowOffset(pane.rows, 4096, null) - state.scrollTop;
  }

  function visibleRowTop(row) {
    const storeRef = state.store;
    if (!storeRef) return -1;
    if (state.hiddenRows.size && state.hiddenRows.has(row)) return -1;
    const pane = frozen();
    let total = 0;
    for (const hiddenRow of state.hiddenRows) {
      if (hiddenRow >= pane.rows && hiddenRow < row) total -= displayRowHeight(hiddenRow);
    }
    return storeRef.rowOffset(row, 4096, state.sizeOverride) + total;
  }

  function visibleRowCount(from, to) {
    if (!state.hiddenRows.size) return to - from + 1;
    let count = 0;
    for (let row = from; row <= to; row += 1) {
      if (!state.hiddenRows.has(row)) count += 1;
    }
    return count;
  }

  function columnX(column) {
    const storeRef = state.store;
    if (!storeRef) return headerOffsetX();
    const pane = frozen();
    if (column < pane.cols) return headerOffsetX() + storeRef.columnOffset(column, 4096, state.sizeOverride);
    return scrollColumnX(column);
  }

  function rowY(row) {
    const storeRef = state.store;
    if (!storeRef) return headerOffsetY();
    const pane = frozen();
    if (row < pane.rows) return headerOffsetY() + storeRef.rowOffset(row, 4096, state.sizeOverride);
    return scrollRowY(row);
  }

  function clipBand(ctx, band) {
    const pane = frozen();
    const left = headerOffsetX();
    const top = headerOffsetY();
    const edgeX = left + pane.width;
    const edgeY = top + pane.height;
    const rects = {
      body: [edgeX, edgeY, Math.max(0, state.width - edgeX), Math.max(0, state.height - edgeY)],
      frozenCols: [left, edgeY, Math.max(0, pane.width), Math.max(0, state.height - edgeY)],
      frozenRows: [edgeX, top, Math.max(0, state.width - edgeX), Math.max(0, pane.height)],
      frozenCorner: [left, top, Math.max(0, pane.width), Math.max(0, pane.height)]
    };
    const rect = rects[band];
    ctx.beginPath();
    ctx.rect(rect[0], rect[1], rect[2], rect[3]);
    ctx.clip();
  }

  function isScrollCellVisible(row, column, size) {
    const pane = frozen();
    const left = headerOffsetX() + pane.width;
    const top = headerOffsetY() + pane.height;
    const x = scrollColumnX(column);
    const y = scrollRowY(row);
    return x + size.width > left && y + size.height > top && x < state.width && y < state.height;
  }

  function bandFor(row, column, size) {
    const storeRef = state.store;
    if (!storeRef) return null;
    const pane = frozen();
    const columnFrozen = column < pane.cols;
    const rowFrozen = row < pane.rows;
    const x = columnX(column);
    const y = rowY(row);
    const left = headerOffsetX();
    const top = headerOffsetY();
    if (columnFrozen && x + size.width <= left) return null;
    if (rowFrozen && y + size.height <= top) return null;
    // Both frozen is tested first: the top-left intersection is its own band
    // and would otherwise be claimed by the single-axis branch below.
    if (columnFrozen && rowFrozen) return 'frozenCorner';
    if (columnFrozen) return y + size.height > top && y < state.height ? 'frozenCols' : null;
    // A frozen-row band still lays its columns out with the body scroll, so a
    // body column scrolled off to the left must be skipped rather than painted
    // at a negative offset inside the pane.
    if (rowFrozen) return x >= left && x + size.width <= state.width ? 'frozenRows' : null;
    return isScrollCellVisible(row, column, size) ? 'body' : null;
  }

  function paintBands(ctx, paint) {
    const pane = frozen();
    const bands = pane.rows || pane.cols ? ['frozenCorner', 'frozenCols', 'frozenRows', 'body'] : ['body'];
    for (const band of bands) {
      ctx.save();
      clipBand(ctx, band);
      paint(band);
      ctx.restore();
    }
  }

  function cellSize(row, column) {
    const storeRef = state.store;
    if (!storeRef) return { width: 0, height: 0 };
    return { width: displayColumnWidth(column), height: displayRowHeight(row) };
  }

  function setSizeOverride(override) {
    const next = override && Number.isFinite(override.size) ? override : null;
    const changed = JSON.stringify(state.sizeOverride) !== JSON.stringify(next);
    state.sizeOverride = next;
    if (changed) requestDraw();
  }

  function columnOffsetOf(column) {
    const storeRef = state.store;
    return storeRef ? storeRef.columnOffset(column, 4096, state.sizeOverride) : 0;
  }

  function rowOffsetOf(row) {
    const storeRef = state.store;
    return storeRef ? storeRef.rowOffset(row, 4096, state.sizeOverride) : 0;
  }

  function displayColumnWidth(column) {
    const storeRef = state.store;
    const base = storeRef ? storeRef.getColumnWidth(column) : 0;
    const override = state.sizeOverride;
    return override && override.axis === 'column' && override.index === column ? override.size : base;
  }

  function displayRowHeight(row) {
    const storeRef = state.store;
    const base = storeRef ? storeRef.getRowHeight(row) : 0;
    const override = state.sizeOverride;
    return override && override.axis === 'row' && override.index === row ? override.size : base;
  }

  function viewport() {
    const storeRef = state.store;
    if (!storeRef) return null;
    const pane = frozen();
    const bounds = storeRef.displayBounds(4096);
    // The window must always include the frozen pane: the pane is the first
    // thing painted, so iteration starts exactly at it and the body continues
    // from the first visible body row/column. `scrollTop`/`scrollLeft` are
    // measured from the first body row/column, so the pane size is added back
    // before asking which body cell sits at the origin.
    const firstBodyRow = storeRef.rowAtOffset(Math.max(0, pane.height + state.scrollTop), 4096);
    const firstBodyColumn = storeRef.columnAtOffset(Math.max(0, pane.width + state.scrollLeft), 4096);
    const firstRow = pane.rows > 0 ? 0 : firstBodyRow;
    const firstColumn = pane.cols > 0 ? 0 : firstBodyColumn;
    let lastColumn = firstColumn;
    let width = columnX(firstColumn) + displayColumnWidth(firstColumn);
    while (lastColumn + 1 < bounds.columns && width < state.width) {
      lastColumn += 1;
      width += displayColumnWidth(lastColumn);
    }
    let lastRow = firstRow;
    let height = rowY(firstRow) + displayRowHeight(firstRow);
    while (lastRow + 1 < bounds.rows && height < state.height) {
      lastRow += 1;
      height += displayRowHeight(lastRow);
    }
    return {
      firstRow,
      firstColumn,
      lastRow: Math.min(bounds.rows - 1, lastRow),
      lastColumn: Math.min(bounds.columns - 1, lastColumn),
      pane
    };
  }

  return {
    freezeRendering,
    frozen,
    headerOffsetX,
    headerOffsetY,
    hiddenRowSet,
    hiddenRowRuns,
    hiddenRowRunY,
    setHighlight,
    paintHighlight,
    scrollColumnX,
    scrollRowY,
    visibleRowTop,
    visibleRowCount,
    columnX,
    rowY,
    clipBand,
    isScrollCellVisible,
    bandFor,
    paintBands,
    cellSize,
    setSizeOverride,
    columnOffsetOf,
    rowOffsetOf,
    displayColumnWidth,
    displayRowHeight,
    viewport
  };
}

module.exports = { createGeometry };
