'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  FILL_SWATCHES,
  FONT_FAMILIES,
  FONT_SIZES,
  NUMBER_FORMATS,
  TEXT_SWATCHES,
  element,
  formatIdFromPattern,
  textButton
} = require('./controls');

function createToolbarActions({
  state,
  selectionRange,
  toolbar,
  syncSelectMenu,
  afterModelChange,
  activeCell,
  updateStatus,
  renderer,
  root,
  formulaInput,
  commitFormulaBar,
  buildTabs,
  syncHighlight,
  gridCanvas,
  openFilterDialog,
  openFindReplace,
  openShortcutHelp,
  importXlsx,
  exportXlsx,
  exportCsv,
  save,
  close,
  closeToolbarMenus,
  focusGrid
}) {
  function syncToolbarState() {
    const store = state.store;
    if (!store) return;
    const range = selectionRange();
    const { style, mixed } = store.commonStyle(range);
    const set = (action, active) => {
      const button = toolbar.querySelector(`[data-action="${action}"]`);
      if (!button) return;
      button.classList.toggle('is-active', Boolean(active) && !mixed);
      button.setAttribute('aria-pressed', String(Boolean(active) && !mixed));
    };
    set('bold', style.bold);
    set('italic', style.italic);
    set('underline', style.underline);
    set('strike', style.strike);
    set('align-left', style.align === 'left');
    set('align-center', style.align === 'center');
    set('align-right', style.align === 'right');
    set('valign-top', style.valign === 'top');
    set('valign-middle', style.valign === 'middle');
    set('valign-bottom', style.valign === 'bottom');
    set('wrap', style.wrap);
    set('row-column-highlight', state.highlightEnabled);
    const select = toolbar.querySelector('[data-action="format"]');
    if (select) {
      select.value = formatIdFromPattern(style.formatPattern);
      syncSelectMenu(select);
    }
    const fontSelect = toolbar.querySelector('[data-action="font-family"]');
    if (fontSelect) {
      fontSelect.value = style.family || '';
      syncSelectMenu(fontSelect);
    }
    const sizeSelect = toolbar.querySelector('[data-action="font-size"]');
    if (sizeSelect) {
      sizeSelect.value = String(style.size || 13);
      syncSelectMenu(sizeSelect);
    }
    const painter = toolbar.querySelector('[data-action="format-painter"]');
    if (painter) painter.classList.toggle('is-active', Boolean(state.formatPainter));
    const textBar = toolbar.querySelector('.sheet-text-color .sheet-color-bar');
    if (textBar) textBar.style.background = style.color || 'transparent';
    const fillBar = toolbar.querySelector('.sheet-fill-color .sheet-color-bar');
    if (fillBar) fillBar.style.background = style.fill || 'transparent';
    const undo = toolbar.querySelector('[data-action="undo"]');
    if (undo) undo.disabled = !store.canUndo();
    const redo = toolbar.querySelector('[data-action="redo"]');
    if (redo) redo.disabled = !store.canRedo();
    const frozen = store.activeSheet().frozen || { rows: 0, cols: 0 };
    const cancelFreeze = toolbar.querySelector('[data-action="freeze-none"]');
    if (cancelFreeze) {
      const visible = Boolean(frozen.rows || frozen.cols);
      cancelFreeze.hidden = !visible;
      const separator = cancelFreeze.nextElementSibling;
      if (separator?.classList.contains('sheet-action-menu-separator')) separator.hidden = !visible;
    }
    const filterButton = toolbar.querySelector('[data-action="filter"]');
    if (filterButton) {
      const active = Boolean(store.activeFilters()?.criteria?.length);
      filterButton.classList.toggle('is-active', active);
      filterButton.setAttribute('aria-pressed', String(active));
    }
  }

  function applyStyleToSelection(patch) {
    const store = state.store;
    if (!store) return;
    store.applyStyle(selectionRange(), patch);
    afterModelChange();
  }

  function toggleStyle(property) {
    const store = state.store;
    if (!store) return;
    const { style } = store.commonStyle(selectionRange());
    applyStyleToSelection({ [property]: !style[property] });
  }

  function setFreeze(rows, cols, message) {
    state.store.setFreeze(rows, cols);
    state.statusMessage = message || (rows || cols ? `已冻结 ${rows} 行 / ${cols} 列` : '已取消冻结');
    afterModelChange();
  }

  function applyQuickFormula(name) {
    const store = state.store;
    const range = selectionRange();
    const single = range.startRow === range.endRow && range.startColumn === range.endColumn;
    let source = { ...range };
    let target = { row: range.endRow + 1, column: range.startColumn };
    if (single) {
      const cell = activeCell();
      let startRow = cell.row - 1;
      while (
        startRow >= 0 &&
        String(store.getDisplayValue(store.activeSheetIndex(), startRow, cell.column) ?? '') !== ''
      )
        startRow -= 1;
      if (startRow < cell.row - 1) {
        source = { startRow: startRow + 1, endRow: cell.row - 1, startColumn: cell.column, endColumn: cell.column };
        target = cell;
      } else {
        let startColumn = cell.column - 1;
        while (
          startColumn >= 0 &&
          String(store.getDisplayValue(store.activeSheetIndex(), cell.row, startColumn) ?? '') !== ''
        )
          startColumn -= 1;
        if (startColumn < cell.column - 1) {
          source = { startRow: cell.row, endRow: cell.row, startColumn: startColumn + 1, endColumn: cell.column - 1 };
          target = cell;
        } else {
          state.statusMessage = '请先选择要计算的数据区域';
          updateStatus();
          return;
        }
      }
    }
    const reference = `${Formula.toA1(source.startRow, source.startColumn)}:${Formula.toA1(source.endRow, source.endColumn)}`;
    store.setCellInput(store.activeSheetIndex(), target.row, target.column, `=${name}(${reference})`);
    renderer.setSelection(target.row, target.column);
    renderer.scrollCellIntoView(target.row, target.column);
    state.statusMessage = `已插入 ${name} 公式`;
    afterModelChange();
  }

  function onToolbarClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;
    if (formulaInput()?.dataset.dirty === 'true' && !commitFormulaBar({ focusOnSuccess: false })) return;
    const store = state.store;
    if (!store) return;
    const cell = activeCell();
    const range = selectionRange();
    switch (action) {
      case 'undo':
        if (store.undo()) {
          renderer.setSheetIndex(store.activeSheetIndex());
          buildTabs();
          afterModelChange();
        }
        break;
      case 'redo':
        if (store.redo()) {
          renderer.setSheetIndex(store.activeSheetIndex());
          buildTabs();
          afterModelChange();
        }
        break;
      case 'bold':
        toggleStyle('bold');
        break;
      case 'italic':
        toggleStyle('italic');
        break;
      case 'underline':
        toggleStyle('underline');
        break;
      case 'strike':
        toggleStyle('strike');
        break;
      case 'align-left':
        applyStyleToSelection({ align: 'left' });
        break;
      case 'align-center':
        applyStyleToSelection({ align: 'center' });
        break;
      case 'align-right':
        applyStyleToSelection({ align: 'right' });
        break;
      case 'valign-top':
        applyStyleToSelection({ valign: 'top' });
        break;
      case 'valign-middle':
        applyStyleToSelection({ valign: 'middle' });
        break;
      case 'valign-bottom':
        applyStyleToSelection({ valign: 'bottom' });
        break;
      case 'wrap':
        toggleStyle('wrap');
        break;
      case 'row-column-highlight':
        state.highlightEnabled = !state.highlightEnabled;
        state.statusMessage = state.highlightEnabled ? '已开启行列高亮' : '已关闭行列高亮';
        syncHighlight();
        syncToolbarState();
        updateStatus();
        renderer.requestDraw();
        break;
      case 'border-all':
        store.applyBorders(range, 'all');
        afterModelChange();
        break;
      case 'border-outer':
        store.applyBorders(range, 'outer');
        afterModelChange();
        break;
      case 'border-clear':
        store.applyBorders(range, 'clear');
        afterModelChange();
        break;
      case 'border-top':
        store.applyBorders(range, 'top');
        afterModelChange();
        break;
      case 'border-right':
        store.applyBorders(range, 'right');
        afterModelChange();
        break;
      case 'border-bottom':
        store.applyBorders(range, 'bottom');
        afterModelChange();
        break;
      case 'border-left':
        store.applyBorders(range, 'left');
        afterModelChange();
        break;
      case 'border-thick-outer':
        store.applyBorders(range, 'thick-outer');
        afterModelChange();
        break;
      case 'format-painter':
        state.formatPainter = { ...store.getStyleOf(store.activeSheetIndex(), cell.row, cell.column) };
        delete state.formatPainter.formatPattern;
        state.statusMessage = '格式刷已启用，请点击目标单元格';
        gridCanvas.style.cursor = 'copy';
        updateStatus();
        syncToolbarState();
        return;
      case 'merge':
        store.mergeCells(range);
        afterModelChange();
        break;
      case 'unmerge':
        store.unmergeCells(range);
        afterModelChange();
        break;
      case 'insert-row':
        store.insertRows(range.startRow, 1);
        afterModelChange();
        break;
      case 'insert-column':
        store.insertColumns(range.startColumn, 1);
        afterModelChange();
        break;
      case 'delete-row':
        store.deleteRows(range.startRow, range.endRow - range.startRow + 1);
        afterModelChange();
        break;
      case 'freeze-none':
        setFreeze(0, 0, '已取消冻结');
        break;
      case 'freeze-panes':
        setFreeze(
          range.startRow,
          range.startColumn,
          `已冻结当前单元格上方 ${range.startRow} 行、左侧 ${range.startColumn} 列`
        );
        break;
      case 'freeze-through-row':
        setFreeze(range.startRow + 1, store.activeSheet().frozen.cols, `已冻结至第 ${range.startRow + 1} 行`);
        break;
      case 'freeze-through-column':
        setFreeze(
          store.activeSheet().frozen.rows,
          range.startColumn + 1,
          `已冻结至 ${Formula.columnToName(range.startColumn)} 列`
        );
        break;
      case 'freeze-header':
        setFreeze(1, store.activeSheet().frozen.cols, '已冻结表头');
        break;
      case 'freeze-first-row':
        setFreeze(1, store.activeSheet().frozen.cols, '已冻结首行');
        break;
      case 'freeze-first-column':
        setFreeze(store.activeSheet().frozen.rows, 1, '已冻结首列');
        break;
      case 'sort-asc':
        store.sortRangeBy(range, cell.column, true);
        afterModelChange();
        break;
      case 'sort-desc':
        store.sortRangeBy(range, cell.column, false);
        afterModelChange();
        break;
      case 'quick-sum':
        applyQuickFormula('SUM');
        break;
      case 'quick-average':
        applyQuickFormula('AVERAGE');
        break;
      case 'quick-count':
        applyQuickFormula('COUNT');
        break;
      case 'quick-max':
        applyQuickFormula('MAX');
        break;
      case 'quick-min':
        applyQuickFormula('MIN');
        break;
      case 'filter':
        openFilterDialog();
        return;
      case 'find':
        openFindReplace();
        return;
      case 'shortcut-help':
        openShortcutHelp();
        return;
      case 'import-xlsx':
        importXlsx();
        return;
      case 'export-xlsx':
        exportXlsx();
        break;
      case 'export-csv':
        exportCsv();
        break;
      case 'clear-content':
        store.clearRange(range, 'content');
        afterModelChange();
        break;
      case 'text-color':
        applyStyleToSelection({ color: target.dataset.color });
        break;
      case 'fill-color':
        applyStyleToSelection({ fill: target.dataset.color });
        break;
      case 'save':
        save();
        return;
      case 'close':
        close();
        return;
      default:
        break;
    }
    if (action.endsWith('color')) {
      const menu = target.closest('.sheet-color')?.querySelector('.sheet-color-menu');
      if (menu) menu.hidden = true;
    }
    if (action.startsWith('border-')) {
      const menu = target.closest('.sheet-border-picker')?.querySelector('.sheet-border-menu');
      if (menu) menu.hidden = true;
    }
    if (target.closest('.sheet-action-menu')) closeToolbarMenus();
    // Native selects (the number-format picker) keep focus for themselves:
    // pulling focus back to the grid blurs the control and closes the open
    // picker, which makes the dropdown flash and impossible to choose from.
    if (target.tagName === 'SELECT') return;
    if (action !== 'filter' && action !== 'import-xlsx') focusGrid();
  }

  function onToolbarChange(event) {
    const select = event.target.closest('select[data-action]');
    if (!select) return;
    // A real pick arrives as pointerdown → change; a change that arrives while
    // the pointer is still down belongs to the grid (drag-select reaching the
    // toolbar) and must not format anything.
    if (select.dataset.pointer === 'down') return;
    if (select.dataset.action === 'format') applyStyleToSelection({ format: select.value });
    else if (select.dataset.action === 'font-family') applyStyleToSelection({ family: select.value || null });
    else if (select.dataset.action === 'font-size') applyStyleToSelection({ size: Number(select.value) || 13 });
    focusGrid();
  }

  function onToolbarKeyDown(event) {
    const picker = event.target.closest?.('.sheet-select-picker');
    if (picker && event.key === 'Escape') {
      event.preventDefault();
      closeToolbarMenus();
      picker.querySelector('.sheet-select-trigger')?.focus({ preventScroll: true });
      return;
    }
    const select = event.target.closest('select[data-action]');
    if (!select) return;
    // The grid owns Escape / arrows / Enter whenever it has focus. While the
    // picker is open they belong to the picker, and blurring it here would
    // close the very list the user is choosing from.
    if (event.key === 'Escape') {
      if (select.matches(':open')) select.blur();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') event.stopPropagation();
  }
  return {
    syncToolbarState,
    applyStyleToSelection,
    toggleStyle,
    setFreeze,
    applyQuickFormula,
    onToolbarClick,
    onToolbarChange,
    onToolbarKeyDown
  };
}
module.exports = { createToolbarActions };
