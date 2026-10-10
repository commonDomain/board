'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');

function createPointer({
  afterModelChange,
  beginEdit,
  commitEdit,
  commitFormulaBar,
  editorOverlay,
  formulaInput,
  formulaReferenceInput,
  gridCanvas,
  gridWrap,
  onGridContextMenu,
  renderer,
  selection,
  selectionRange,
  state,
  syncFormulaBar,
  syncHighlight,
  syncHorizontalScroll,
  syncToolbarState,
  updateFormulaReference,
  updateStatus,
  view
}) {
  function onGridPointerDown(event) {
    if (event.button !== 0) return;
    const store = state.store;
    if (!store) return;
    if (event.pointerType === 'touch') {
      if (state.touchPointerId != null) return;
      state.touchPointerId = event.pointerId;
      gridCanvas.setPointerCapture?.(event.pointerId);
      cancelTouchContext();
      const touch = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
      touch.timer = setTimeout(() => {
        if (state.touchContext !== touch) return;
        state.touchContext = null;
        state.touchPointerId = null;
        state.drag = null;
        gridCanvas.releasePointerCapture?.(touch.pointerId);
        onGridContextMenu({ clientX: touch.x, clientY: touch.y, preventDefault() {}, stopPropagation() {} });
      }, 520);
      state.touchContext = touch;
    }
    const referenceInput = formulaReferenceInput();
    if (referenceInput) {
      const referenceCell = renderer.cellAt(event.clientX, event.clientY);
      if (referenceCell) {
        const start = referenceInput.selectionStart ?? referenceInput.value.length;
        const end = referenceInput.selectionEnd ?? start;
        state.drag = {
          kind: 'formula-reference',
          input: referenceInput,
          start: referenceCell,
          prefix: referenceInput.value.slice(0, start),
          suffix: referenceInput.value.slice(end)
        };
        state.formulaReference = state.drag;
        updateFormulaReference(state.drag, referenceCell);
        gridCanvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (state.editing && commitEdit(null) === false) {
      event.preventDefault();
      event.stopPropagation();
      editorOverlay.focus();
      return;
    }
    if (formulaInput()?.dataset.dirty === 'true' && !commitFormulaBar()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const hiddenRun = renderer.hiddenRowRevealAt?.(event.clientX, event.clientY);
    if (hiddenRun) {
      store.setRowsHidden(hiddenRun.start, hiddenRun.end, false);
      state.statusMessage =
        hiddenRun.start === hiddenRun.end
          ? `已显示第 ${hiddenRun.start + 1} 行`
          : `已显示第 ${hiddenRun.start + 1}–${hiddenRun.end + 1} 行`;
      afterModelChange();
      event.preventDefault();
      return;
    }
    // Header borders resize rows/columns and must win over header selection,
    // otherwise pressing the border would just select the column instead.
    const resizeColumn = renderer.columnResizeHandleAt(event.clientX, event.clientY);
    if (resizeColumn !== null && resizeColumn !== undefined) {
      state.drag = {
        kind: 'resize-column',
        column: resizeColumn,
        startX: event.clientX,
        startWidth: store.getColumnWidth(resizeColumn)
      };
      gridCanvas.setPointerCapture?.(event.pointerId);
      return;
    }
    const resizeRow = renderer.rowResizeHandleAt(event.clientX, event.clientY);
    if (resizeRow !== null && resizeRow !== undefined) {
      state.drag = {
        kind: 'resize-row',
        row: resizeRow,
        startY: event.clientY,
        startHeight: store.getRowHeight(resizeRow)
      };
      gridCanvas.setPointerCapture?.(event.pointerId);
      return;
    }
    const headerColumn = renderer.headerColumnAt(event.clientX, event.clientY);
    const headerRow = renderer.headerRowAt(event.clientX, event.clientY);
    if (headerColumn !== null && headerColumn !== undefined) {
      renderer.setSelection(0, headerColumn);
      selection().focus.row = Math.max(0, store.usedBounds().rows - 1);
      state.drag = { kind: 'header-column' };
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      renderer.requestDraw();
      return;
    }
    if (headerRow !== null && headerRow !== undefined) {
      renderer.setSelection(headerRow, 0);
      selection().focus.column = Math.max(0, store.usedBounds().columns - 1);
      state.drag = { kind: 'header-row' };
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      renderer.requestDraw();
      return;
    }
    const cell = renderer.cellAt(event.clientX, event.clientY);
    if (!cell) return;
    if (renderer.isOnFillHandle(event.clientX, event.clientY)) {
      state.drag = { kind: 'fill', origin: selectionRange(), axis: null, target: null };
      gridCanvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (state.formatPainter) {
      renderer.setSelection(cell.row, cell.column);
      store.applyStyle(
        { startRow: cell.row, startColumn: cell.column, endRow: cell.row, endColumn: cell.column },
        state.formatPainter
      );
      state.formatPainter = null;
      state.statusMessage = '格式已应用';
      gridCanvas.style.cursor = 'cell';
      afterModelChange();
      event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      selection().focus.row = cell.row;
      selection().focus.column = cell.column;
    } else {
      renderer.setSelection(cell.row, cell.column);
    }
    state.drag = event.pointerType === 'touch' && !state.touchSelect
      ? { kind: 'touch-pan', x: event.clientX, y: event.clientY, scroll: renderer.getScroll(), cell, moved: false }
      : { kind: 'select', anchor: { ...selection().anchor } };
    gridCanvas.setPointerCapture?.(event.pointerId);
    syncHighlight();
    syncFormulaBar();
    updateStatus();
    syncToolbarState();
  }

  function onGridPointerMove(event) {
    if (event.pointerType === 'touch' && state.touchPointerId !== event.pointerId) return;
    if (
      state.touchContext &&
      Math.hypot(event.clientX - state.touchContext.x, event.clientY - state.touchContext.y) > 10
    )
      cancelTouchContext();
    const cell = renderer.cellAt(event.clientX, event.clientY);
    renderer.setHover(cell ? cell.row : null, cell ? cell.column : null);
    const drag = state.drag;
    if (!drag) {
      // Cursors match the affordance under the pointer: resize on a header
      // border, a crosshair on the fill handle, otherwise a cell.
      if (renderer.columnResizeHandleAt(event.clientX, event.clientY) !== null) gridCanvas.style.cursor = 'col-resize';
      else if (renderer.rowResizeHandleAt(event.clientX, event.clientY) !== null)
        gridCanvas.style.cursor = 'row-resize';
      else if (renderer.isOnFillHandle(event.clientX, event.clientY)) gridCanvas.style.cursor = 'crosshair';
      else gridCanvas.style.cursor = 'cell';
      return;
    }
    if (drag.kind === 'touch-pan') {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.moved ||= Math.hypot(dx, dy) > 8;
      if (drag.moved) { renderer.setScroll(drag.scroll.top - dy, drag.scroll.left - dx); syncHorizontalScroll(); }
      event.preventDefault(); return;
    }
    if (drag.kind === 'formula-reference') {
      if (cell) updateFormulaReference(drag, cell);
      return;
    }
    if (drag.kind === 'resize-column') {
      // The preview is purely visual: the model is written once on release, so
      // an interrupted drag cannot leave a half-applied size behind.
      gridCanvas.style.cursor = 'col-resize';
      drag.pendingSize = drag.startWidth + (event.clientX - drag.startX);
      renderer.setSizeOverride({ axis: 'column', index: drag.column, size: drag.pendingSize });
      return;
    }
    if (drag.kind === 'resize-row') {
      gridCanvas.style.cursor = 'row-resize';
      drag.pendingSize = drag.startHeight + (event.clientY - drag.startY);
      renderer.setSizeOverride({ axis: 'row', index: drag.row, size: drag.pendingSize });
      return;
    }
    if (!cell) return;
    if (drag.kind === 'select' || drag.kind === 'header-column' || drag.kind === 'header-row') {
      if (drag.kind === 'select') {
        selection().focus.row = cell.row;
        selection().focus.column = cell.column;
      } else if (drag.kind === 'header-row') {
        selection().focus.row = cell.row;
      } else {
        selection().focus.column = cell.column;
      }
      renderer.requestDraw();
      updateStatus();
      syncFormulaBar();
      return;
    }
    if (drag.kind === 'fill') {
      // Snap to one axis, the way Excel locks a fill direction once the drag
      // clearly moves along it.
      const origin = drag.origin;
      const rowSpan = origin.endRow - origin.startRow + 1;
      const columnSpan = origin.endColumn - origin.startColumn + 1;
      const rowDistance = cell.row > origin.endRow ? cell.row - origin.endRow : origin.startRow - cell.row;
      const columnDistance =
        cell.column > origin.endColumn ? cell.column - origin.endColumn : origin.startColumn - cell.column;
      const vertical = rowDistance * rowSpan >= columnDistance * columnSpan;
      drag.axis = vertical ? 'row' : 'column';
      drag.target = vertical
        ? {
            startRow: Math.min(origin.startRow, cell.row),
            startColumn: origin.startColumn,
            endRow: Math.max(origin.endRow, cell.row),
            endColumn: origin.endColumn
          }
        : {
            startRow: origin.startRow,
            startColumn: Math.min(origin.startColumn, cell.column),
            endRow: origin.endRow,
            endColumn: Math.max(origin.endColumn, cell.column)
          };
      renderer.setDropTarget(drag.target);
    }
  }

  function onGridPointerUp(event) {
    if (event.pointerType === 'touch' && state.touchPointerId !== event.pointerId) return;
    state.touchPointerId = null;
    cancelTouchContext();
    const drag = state.drag;
    state.drag = null;
    renderer.setDropTarget(null);
    gridCanvas.releasePointerCapture?.(event.pointerId);
    if (!drag) return;
    if (event.type === 'pointercancel') { renderer.setSizeOverride(null); state.formulaReference = null; state.lastTouchTap = null; renderer.requestDraw(); return; }
    if (drag.kind === 'touch-pan') {
      if (!drag.moved) {
        const previous = state.lastTouchTap, now = Date.now();
        if (previous && now - previous.time < 350 && previous.row === drag.cell.row && previous.column === drag.cell.column) { state.lastTouchTap = null; beginEdit(drag.cell.row, drag.cell.column); }
        else state.lastTouchTap = { ...drag.cell, time: now };
      } else state.lastTouchTap = null;
      return;
    }
    if (drag.kind === 'formula-reference') {
      state.formulaReference = null;
      drag.input.focus({ preventScroll: true });
      drag.input.setSelectionRange(drag.input.selectionStart, drag.input.selectionStart);
      return;
    }
    if (drag.kind === 'resize-column' || drag.kind === 'resize-row') {
      gridCanvas.style.cursor = 'cell';
      renderer.setSizeOverride(null);
      // One model write, one undo step, only if the size actually changed.
      const size = Number.isFinite(drag.pendingSize) ? drag.pendingSize : null;
      const original =
        drag.kind === 'resize-column' ? state.store.getColumnWidth(drag.column) : state.store.getRowHeight(drag.row);
      const rounded = size === null ? original : size;
      if (Math.round(rounded) !== Math.round(original)) {
        if (drag.kind === 'resize-column') state.store.setColumnWidth(drag.column, rounded);
        else state.store.setRowHeight(drag.row, rounded);
        state.statusMessage =
          drag.kind === 'resize-column'
            ? `列宽 ${state.store.getColumnWidth(drag.column)} px`
            : `行高 ${state.store.getRowHeight(drag.row)} px`;
        afterModelChange();
      } else {
        renderer.requestDraw();
      }
    } else if (drag.kind === 'fill' && state.store) {
      const origin = drag.origin;
      const target = drag.target;
      const moved =
        target &&
        (target.endRow > origin.endRow ||
          target.endColumn > origin.endColumn ||
          target.startRow < origin.startRow ||
          target.startColumn < origin.startColumn);
      if (moved) {
        state.store.fillRange(origin, target);
        renderer.setSelection(origin.startRow, origin.startColumn);
        selection().focus.row = target.endRow;
        selection().focus.column = target.endColumn;
        afterModelChange();
      }
    } else if (drag.kind === 'select' && state.store) {
      const range = selectionRange();
      const rows = range.endRow - range.startRow + 1;
      const columns = range.endColumn - range.startColumn + 1;
      state.statusMessage = rows > 1 || columns > 1 ? `已选择 ${rows} × ${columns}` : '';
      updateStatus();
    }
  }

  function cancelTouchContext() {
    if (!state.touchContext) return;
    clearTimeout(state.touchContext.timer);
    state.touchContext = null;
  }

  function onGridDoubleClick(event) {
    // Double-clicking a header border auto-fits, like Excel.
    const fitColumn = renderer.columnResizeHandleAt(event.clientX, event.clientY);
    if (fitColumn !== null && fitColumn !== undefined && state.store) {
      state.store.autoFitColumn(fitColumn, state.store.usedBounds().rows);
      state.statusMessage = `已自动调整 ${Formula.columnToName(fitColumn)} 列宽`;
      afterModelChange();
      return;
    }
    const fitRow = renderer.rowResizeHandleAt(event.clientX, event.clientY);
    if (fitRow !== null && fitRow !== undefined && state.store) {
      state.store.autoFitRow(fitRow, state.store.usedBounds().columns);
      state.statusMessage = `已自动调整第 ${fitRow + 1} 行高`;
      afterModelChange();
      return;
    }
    // Excel's fill-handle affordance: double-clicking it extends the series
    // down to match the neighbouring column.
    if (renderer.isOnFillHandle(event.clientX, event.clientY) && state.store) {
      const extended = state.store.fillDownRange(selectionRange());
      state.statusMessage = extended ? `已填充 ${extended} 行` : '相邻列没有可参照的数据';
      afterModelChange();
      return;
    }
    const cell = renderer.cellAt(event.clientX, event.clientY);
    if (!cell) return;
    renderer.setSelection(cell.row, cell.column);
    syncHighlight();
    beginEdit(cell.row, cell.column);
  }

  function onGridWheel(event) {
    const store = state.store;
    if (!store) return;
    // The grid owns the wheel while the pointer is over it: scrolling the
    // canvas instead would fight the sheet.
    event.preventDefault();
    event.stopPropagation();
    const scroll = renderer.getScroll();
    if (event.shiftKey) renderer.setScroll(scroll.top, scroll.left + event.deltaY + event.deltaX);
    else renderer.setScroll(scroll.top + event.deltaY, scroll.left + event.deltaX);
    syncHorizontalScroll();
  }

  function onGridResize() {
    const rect = gridWrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.resize(rect.width, rect.height, view().devicePixelRatio);
    syncHorizontalScroll();
  }

  function focusGrid() {
    gridCanvas.tabIndex = 0;
    gridCanvas.focus({ preventScroll: true });
  }

  return {
    onGridPointerDown,
    onGridPointerMove,
    onGridPointerUp,
    cancelTouchContext,
    onGridDoubleClick,
    onGridWheel,
    onGridResize,
    focusGrid
  };
}

module.exports = { createPointer };
