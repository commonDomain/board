'use strict';

const {
  HEADER_HEIGHT,
  HEADER_WIDTH,
  FILL_HANDLE_SIZE,
  FALLBACK_PALETTE,
  readPalette,
  fontString,
  createSelection
} = require('./controls');
const { createGeometry } = require('./geometry');
const { createPainting } = require('./painting');
const { createInteraction } = require('./interaction');

function createGridRenderer(canvas, options = {}) {
  const context = canvas.getContext('2d', { alpha: false });

  const selection = options.selection || createSelection();

  const state = {
    store: options.store || null,
    sheetIndex: 0,
    scrollTop: 0,
    scrollLeft: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
    showHeaders: options.showHeaders !== false,
    showGrid: options.showGrid !== false,
    // Pinning is opt-in; see freezeRendering().
    freezeRendering: options.freezeRendering === true,
    palette: readPalette(canvas),
    selection,
    editing: null, // {row, column} of the cell being edited by an overlay
    hover: null,
    dropTarget: null,
    // Rows removed by the active filter, refreshed per draw.
    hiddenRows: new Set(),
    // Transient column/row size being dragged; never persisted.
    sizeOverride: null,
    highlightRow: null,
    highlightColumn: null,
    frame: 0,
    // Cached metrics so repeated draws do not re-read the DOM.
    metrics: { family: 'Inter, system-ui, "Microsoft YaHei", sans-serif', baseSize: 13 }
  };

  function store() {
    return state.store;
  }

  function setStore(store, sheetIndex = 0) {
    state.store = store;
    state.sheetIndex = sheetIndex;
    state.palette = readPalette(canvas);
    requestDraw();
  }

  function setSheetIndex(index) {
    state.sheetIndex = Math.max(0, index);
    state.scrollTop = 0;
    state.scrollLeft = 0;
    requestDraw();
  }

  function resize(width, height, pixelRatio) {
    const ratio = Math.max(
      1,
      Math.min(3, Number(pixelRatio) || (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1)
    );
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (state.width === nextWidth && state.height === nextHeight && state.pixelRatio === ratio) return false;
    state.width = nextWidth;
    state.height = nextHeight;
    state.pixelRatio = ratio;
    canvas.width = Math.floor(state.width * ratio);
    canvas.height = Math.floor(state.height * ratio);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    requestDraw();
    return true;
  }

  function requestDraw() {
    if (state.frame) return;
    if (typeof requestAnimationFrame !== 'function') {
      draw();
      return;
    }
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      draw();
    });
  }

  function destroy() {
    if (state.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.store = null;
    state.editing = null;
    state.hover = null;
    state.dropTarget = null;
    state.sizeOverride = null;
    canvas.width = 1;
    canvas.height = 1;
  }

  // Assemble panel features before registering events. Callbacks are resolved when invoked.
  const {
    frozen,
    headerOffsetX,
    headerOffsetY,
    hiddenRowSet,
    hiddenRowRuns,
    hiddenRowRunY,
    setHighlight,
    paintHighlight,
    columnX,
    rowY,
    bandFor,
    paintBands,
    cellSize,
    setSizeOverride,
    displayColumnWidth,
    displayRowHeight,
    viewport
  } = createGeometry({
    requestDraw: (...args) => requestDraw(...args),
    state
  });

  const { draw } = createPainting({
    bandFor: (...args) => bandFor(...args),
    cellSize: (...args) => cellSize(...args),
    columnX: (...args) => columnX(...args),
    context,
    displayColumnWidth: (...args) => displayColumnWidth(...args),
    displayRowHeight: (...args) => displayRowHeight(...args),
    frozen: (...args) => frozen(...args),
    headerOffsetX: (...args) => headerOffsetX(...args),
    headerOffsetY: (...args) => headerOffsetY(...args),
    hiddenRowRunY: (...args) => hiddenRowRunY(...args),
    hiddenRowRuns: (...args) => hiddenRowRuns(...args),
    hiddenRowSet: (...args) => hiddenRowSet(...args),
    paintBands: (...args) => paintBands(...args),
    paintHighlight: (...args) => paintHighlight(...args),
    rowY: (...args) => rowY(...args),
    state,
    viewport: (...args) => viewport(...args)
  });

  const {
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
  } = createInteraction({
    canvas,
    columnX: (...args) => columnX(...args),
    displayColumnWidth: (...args) => displayColumnWidth(...args),
    displayRowHeight: (...args) => displayRowHeight(...args),
    frozen: (...args) => frozen(...args),
    headerOffsetX: (...args) => headerOffsetX(...args),
    headerOffsetY: (...args) => headerOffsetY(...args),
    hiddenRowRunY: (...args) => hiddenRowRunY(...args),
    hiddenRowRuns: (...args) => hiddenRowRuns(...args),
    requestDraw: (...args) => requestDraw(...args),
    rowY: (...args) => rowY(...args),
    state,
    viewport: (...args) => viewport(...args)
  });

  return {
    selection,
    state,
    setHighlight,
    setSizeOverride,
    setStore,
    setSheetIndex,
    resize,
    requestDraw,
    draw,
    cellAt,
    cellRect,
    headerColumnAt,
    headerRowAt,
    hiddenRowRevealAt,
    columnResizeHandleAt,
    rowResizeHandleAt,
    isOnFillHandle,
    scrollCellIntoView,
    setScroll,
    scrollOffsetFor,
    getScroll,
    getScrollMetrics,
    setSelection,
    setHover,
    setEditing,
    setDropTarget,
    refreshPalette,
    destroy,
    get sheetIndex() {
      return state.sheetIndex;
    },
    get metrics() {
      return state.metrics;
    }
  };
}

module.exports = {
  createGridRenderer,
  createSelection,
  readPalette,
  fontString,
  HEADER_HEIGHT,
  HEADER_WIDTH,
  FILL_HANDLE_SIZE,
  FALLBACK_PALETTE
};
