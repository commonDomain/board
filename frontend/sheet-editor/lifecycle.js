'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { element } = require('./controls');

function createLifecycle({
  afterModelChange,
  buildFormulaBar,
  buildTabs,
  buildToolbar,
  cancelEdit,
  cancelTouchContext,
  commitEdit,
  commitFormulaBar,
  dismissToolbarMenus,
  doc,
  editorOverlay,
  focusGrid,
  formulaInput,
  header,
  hideContextMenu,
  onClose,
  onCommit,
  onGridResize,
  onInputDraft,
  onRename,
  onViewportResize,
  options,
  releaseActiveCellLock,
  renderer,
  resetPickerPointer,
  root,
  showPanelCard,
  state,
  statusBar,
  syncFormulaBar,
  syncHighlight,
  syncToolbarState,
  title,
  titleButton,
  titleWrap,
  updateStatus,
  validateInput,
  view
}) {
  function pendingInputProblem() {
    const store = state.store;
    if (!store) return null;
    if (state.editing && editorOverlay.value !== state.editing.original) {
      if (state.lockLost) {
        return {
          where: `${Formula.toA1(state.editing.row, state.editing.column)} 单元格`,
          message: '编辑锁已失效，当前输入仍保留在编辑器中'
        };
      }
      const validation = validateInput(editorOverlay.value);
      if (!validation.valid) {
        return {
          where: `${Formula.toA1(state.editing.row, state.editing.column)} 单元格`,
          message: validation.message || validation.error || '公式语法错误'
        };
      }
    }
    const input = formulaInput();
    if (input && input.dataset.dirty === 'true') {
      const validation = validateInput(input.value);
      if (!validation.valid) {
        return {
          where: '编辑栏',
          message: validation.message || validation.error || '公式语法错误'
        };
      }
    }
    return null;
  }

  function settlePendingInput() {
    if (state.editing && commitEdit(null) === false) return false;
    if (!commitFormulaBar()) return false;
    return true;
  }

  function confirmDiscardInput(problem, proceed) {
    const card = showPanelCard((node) => {
      node.append(
        element('div', 'sheet-card-title', '放弃未保存的内容？'),
        element(
          'div',
          'sheet-card-note',
          `${problem.where}中的公式无法保存：${problem.message}。放弃将不会写入这处修改，其余修改已经保存。`
        )
      );
      const row = element('div', 'sheet-card-row');
      const discard = element('button', 'sheet-tool-text sheet-tool-danger', '放弃修改并退出');
      discard.type = 'button';
      discard.dataset.action = 'discard-input';
      const stay = element('button', 'sheet-tool sheet-tool-primary sheet-tool-wide', '返回修正');
      stay.type = 'button';
      stay.dataset.action = 'keep-input';
      discard.addEventListener('click', () => {
        card.remove();
        proceed();
      });
      stay.addEventListener('click', () => {
        card.remove();
        focusInputForRepair();
      });
      row.append(discard, stay);
      node.appendChild(row);
      stay.focus();
    });
    return card;
  }

  function focusInputForRepair() {
    if (state.editing) {
      editorOverlay.focus();
      editorOverlay.setSelectionRange(editorOverlay.value.length, editorOverlay.value.length);
      return;
    }
    const input = formulaInput();
    if (input) input.focus();
    else focusGrid();
  }

  function open() {
    state.closed = false;
    root.hidden = false;
    buildToolbar();
    buildFormulaBar();
    buildTabs();
    options.lucide?.();
    renderer.setSheetIndex(state.store ? state.store.activeSheetIndex() : 0);
    renderer.refreshPalette();
    onGridResize();
    syncFormulaBar();
    updateStatus();
    syncToolbarState();
    syncHighlight();
    options.onOpen?.();
    view().requestAnimationFrame(() => {
      onGridResize();
      renderer.draw();
      focusGrid();
      options.lucide?.();
    });
  }

  function save() {
    if (state.closed) return true;
    if (settlePendingInput() === false) {
      focusInputForRepair();
      return false;
    }
    onCommit('save');
    state.statusMessage = '已保存到画布';
    afterModelChange();
    focusGrid();
    return true;
  }

  function close() {
    if (state.closed) return true;
    const problem = pendingInputProblem();
    if (problem) {
      // 确认框必须放在表格面板内，否则会被全屏编辑器遮挡。
      confirmDiscardInput(problem, discardInputAndClose);
      return false;
    }
    if (settlePendingInput() === false) {
      focusInputForRepair();
      return false;
    }
    finishClose();
    return true;
  }

  function discardInputAndClose() {
    const input = formulaInput();
    if (input) input.dataset.dirty = 'false';
    onInputDraft(null);
    cancelEdit();
    finishClose();
  }

  function finishClose() {
    // 即使宿主保存回调失败，也要释放编辑锁并关闭面板，避免无法退出。
    try {
      onCommit('close');
    } catch (error) {
      console.error('[sheet] close commit failed', error);
    }
    state.closed = true;
    cancelTouchContext();
    releaseActiveCellLock();
    root.hidden = true;
    hideContextMenu();
    resetPickerPointer();
    try {
      onClose();
    } catch (error) {
      console.error('[sheet] close callback failed', error);
    }
  }

  function destroy() {
    view().removeEventListener('resize', onViewportResize);
    view().visualViewport?.removeEventListener('resize', onViewportResize);
    view().visualViewport?.removeEventListener('scroll', onViewportResize);
    doc.removeEventListener('pointerdown', dismissToolbarMenus, true);
    releaseActiveCellLock();
    renderer.setStore(null);
    root.remove();
  }

  function setStore(store, sheetIndex) {
    releaseActiveCellLock();
    state.store = store;
    renderer.setStore(store, Number.isInteger(sheetIndex) ? sheetIndex : store ? store.activeSheetIndex() : 0);
    if (!state.closed) {
      buildTabs();
      syncFormulaBar();
      updateStatus();
      syncToolbarState();
      syncHighlight();
      renderer.draw();
    }
  }

  function focusCell(target = {}, focusOptions = {}) {
    const store = state.store;
    if (!store) return false;
    let sheetIndex = Number.isInteger(target.sheetIndex) ? target.sheetIndex : -1;
    if (target.sheetId) {
      sheetIndex = store.workbook.sheets.findIndex((sheet) => sheet.sheetId === target.sheetId);
    }
    if (sheetIndex < 0 || sheetIndex >= store.workbook.sheets.length) return false;
    const row = Math.max(0, Math.trunc(Number(target.row) || 0));
    const column = Math.max(0, Math.trunc(Number(target.column) || 0));
    store.setActiveSheet(sheetIndex);
    renderer.setSheetIndex(sheetIndex);
    renderer.setSelection(row, column);
    renderer.scrollCellIntoView(row, column);
    buildTabs();
    syncFormulaBar();
    updateStatus();
    syncToolbarState();
    syncHighlight();
    renderer.draw();
    state.statusMessage = `已定位到 ${store.workbook.sheets[sheetIndex].name}!${Formula.toA1(row, column)}`;
    updateStatus();
    if (focusOptions.focus !== false && !state.closed) focusGrid();
    return true;
  }

  function setSaveLabel(text) {
    const nodes = [
      statusBar.querySelector('[data-role="save-state"]'),
      header.querySelector('[data-role="header-save-state"]')
    ];
    for (const node of nodes) if (node) node.textContent = text;
  }

  function setTitle(text) {
    const node = header.querySelector('[data-role="editor-title"]');
    if (node) node.textContent = String(text || '工作表');
  }

  function beginTitleRename() {
    if (titleWrap.querySelector('.sheet-editor-title-input')) return;
    const previous = title.textContent || '工作表';
    const input = element('input', 'sheet-editor-title-input');
    input.type = 'text';
    input.maxLength = 100;
    input.value = previous;
    input.setAttribute('aria-label', '工作表名称');
    titleButton.hidden = true;
    titleWrap.appendChild(input);
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const next = input.value.trim().slice(0, 100);
      input.remove();
      titleButton.hidden = false;
      if (!save || !next || next === previous) {
        titleButton.focus({ preventScroll: true });
        return;
      }
      try {
        if (onRename(next) !== false) setTitle(next);
      } catch (error) {
        console.error('[sheet] rename failed', error);
        setTitle(previous);
      }
      titleButton.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus({ preventScroll: true });
    input.select();
  }

  return {
    pendingInputProblem,
    settlePendingInput,
    confirmDiscardInput,
    focusInputForRepair,
    open,
    save,
    close,
    discardInputAndClose,
    finishClose,
    destroy,
    setStore,
    focusCell,
    setSaveLabel,
    setTitle,
    beginTitleRename
  };
}

module.exports = { createLifecycle };
