'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const View = typeof window === 'object' ? window.SheetView : require('../../public/sheet-view.js');

function createCells({
  acquireCellLock,
  afterModelChange,
  cellFormulaAssist,
  cloneCell,
  editorOverlay,
  focusGrid,
  formulaInput,
  hideCellFormulaAssist,
  onInputDraft,
  releaseCellLock,
  renderer,
  state,
  syncFormulaBar,
  syncHighlight,
  syncToolbarState,
  updateCellFormulaAssist,
  updateFormulaFeedback,
  updateStatus,
  validateInput
}) {
  async function beginEdit(row, column, initialText) {
    const store = state.store;
    if (!store) return false;
    if (state.startingEdit) return false;
    const pending = { row, column, text: initialText, commit: false };
    state.startingEdit = pending;
    if (isRemotelyLocked(row, column)) {
      state.startingEdit = null;
      state.statusMessage = `${Formula.toA1(row, column)} 正由其他协作者编辑`;
      updateStatus();
      return false;
    }
    const lock = await requestCellLock(row, column);
    if (!lock) {
      if (state.startingEdit === pending) state.startingEdit = null;
      return false;
    }
    if (state.startingEdit !== pending) {
      releaseActiveCellLock();
      return false;
    }
    const rect = renderer.cellRect(row, column);
    if (!rect) {
      state.startingEdit = null;
      releaseActiveCellLock();
      return false;
    }
    state.editing = { row, column, original: store.getEditText(store.activeSheetIndex(), row, column) };
    editorOverlay.hidden = false;
    editorOverlay.readOnly = false;
    editorOverlay.style.left = `${rect.x}px`;
    editorOverlay.style.top = `${rect.y}px`;
    editorOverlay.style.width = `${Math.max(rect.width, 60)}px`;
    editorOverlay.style.height = `${rect.height}px`;
    editorOverlay.style.font = View.fontString(
      store.getStyleOf(store.activeSheetIndex(), row, column),
      13,
      renderer.metrics.family
    );
    editorOverlay.value = pending.text ?? state.editing.original;
    editorOverlay.classList.remove('is-invalid');
    editorOverlay.setAttribute('aria-invalid', 'false');
    renderer.setEditing(row, column);
    editorOverlay.focus();
    if (pending.text === undefined) editorOverlay.select();
    else editorOverlay.setSelectionRange(editorOverlay.value.length, editorOverlay.value.length);
    autoGrowEditor();
    updateCellFormulaAssist();
    onEditorInput();
    state.startingEdit = null;
    if (pending.commit) commitEdit((editing) => ({ row: editing.row + 1, column: editing.column }));
    return true;
  }

  function lockMatches(row, column) {
    if (!acquireCellLock) return true;
    const sheetId = state.store?.activeSheet()?.sheetId;
    return Boolean(
      state.cellLock &&
      state.cellLock.sheetId === sheetId &&
      state.cellLock.row === row &&
      state.cellLock.column === column &&
      !state.lockLost
    );
  }

  function isRemotelyLocked(row, column) {
    const sheetId = state.store?.activeSheet()?.sheetId;
    for (const lock of state.remoteCellLocks.values()) {
      if (lock.sheetId === sheetId && lock.row === row && lock.column === column && lock.locked !== false) return true;
    }
    return false;
  }

  async function requestCellLock(row, column) {
    if (!acquireCellLock) return { granted: true, local: true };
    if (lockMatches(row, column)) return state.cellLock;
    releaseActiveCellLock();
    const request = ++state.lockRequest;
    state.statusMessage = `正在获取 ${Formula.toA1(row, column)} 的编辑权限…`;
    updateStatus();
    const sheetId = state.store?.activeSheet()?.sheetId;
    const result = await acquireCellLock({ sheetId, row, column });
    if (request !== state.lockRequest || state.closed) {
      if (result?.granted) releaseCellLock(result);
      return null;
    }
    if (!result?.granted) {
      state.statusMessage =
        result?.reason === 'cell-busy'
          ? `${Formula.toA1(row, column)} 正由其他协作者编辑`
          : '当前离线或连接不稳定，共享工作表暂时只读';
      updateStatus();
      return null;
    }
    state.cellLock = { ...result, sheetId, row, column };
    state.lockLost = false;
    state.statusMessage = `正在编辑 ${Formula.toA1(row, column)}`;
    updateStatus();
    return state.cellLock;
  }

  function releaseActiveCellLock() {
    state.lockRequest += 1;
    if (state.cellLock?.pending) return;
    if (state.cellLock) releaseCellLock(state.cellLock);
    state.cellLock = null;
    state.lockLost = false;
  }

  function holdCellLockUntil(submission, lock) {
    if (!lock || !submission || typeof submission.finally !== 'function') return;
    lock.pending = true;
    submission.finally(() => {
      lock.pending = false;
      if (state.cellLock?.lockId === lock.lockId) releaseActiveCellLock();
      else releaseCellLock(lock);
    });
  }

  function autoGrowEditor() {
    const rect = state.editing ? renderer.cellRect(state.editing.row, state.editing.column) : null;
    if (!rect) return;
    const lines = editorOverlay.value.split('\n');
    const longest = lines.reduce((best, line) => Math.max(best, line.length), 0);
    editorOverlay.style.width = `${Math.max(rect.width, Math.min(520, 8 + longest * 8))}px`;
    editorOverlay.style.height = `${Math.max(rect.height, Math.min(200, 6 + lines.length * 18))}px`;
  }

  function onEditorInput() {
    autoGrowEditor();
    updateCellFormulaAssist();
    const formula = formulaInput();
    if (formula && state.editing) {
      // Both surfaces display one live draft. Keeping the formula bar out of
      // its independent dirty state also prevents a second commit/history step.
      formula.value = editorOverlay.value;
      formula.dataset.dirty = 'false';
      updateFormulaFeedback();
    }
    if (state.editing)
      onInputDraft({
        sheetId: state.store?.activeSheet()?.sheetId,
        row: state.editing.row,
        column: state.editing.column,
        text: editorOverlay.value,
        mode: 'cell'
      });
    const validation = validateInput(editorOverlay.value);
    const invalid = validation.valid === false;
    editorOverlay.classList.toggle('is-invalid', invalid);
    editorOverlay.setAttribute('aria-invalid', String(invalid));
    if (invalid) {
      state.statusMessage = `公式有误：${validation.message || validation.error || '请检查语法'}`;
      updateStatus();
    }
  }

  function commitEdit(move) {
    const editing = state.editing;
    if (!editing) return true;
    if (state.cellComposing) return false;
    if (!lockMatches(editing.row, editing.column)) {
      state.statusMessage = '未保存：编辑锁已失效，当前输入仍保留';
      updateStatus();
      return false;
    }
    const store = state.store;
    const sheetIndex = store?.activeSheetIndex();
    const expectedCellVersion = store?.getCellVersion?.(sheetIndex, editing.row, editing.column) || 0;
    const lock = state.cellLock;
    let submission = null;
    if (store && editorOverlay.value !== editing.original) {
      const validation = validateInput(editorOverlay.value);
      if (
        !validation.valid ||
        store.setCellInput(store.activeSheetIndex(), editing.row, editing.column, editorOverlay.value) === false
      ) {
        const message = validation.message || validation.error || '公式语法错误';
        editorOverlay.classList.add('is-invalid');
        editorOverlay.setAttribute('aria-invalid', 'true');
        state.statusMessage = `未保存：${message}`;
        updateStatus();
        return false;
      }
      state.statusMessage = `已更新 ${Formula.toA1(editing.row, editing.column)}`;
      submission = afterModelChange({
        kind: 'set-cell',
        sheetId: store.activeSheet().sheetId,
        row: editing.row,
        column: editing.column,
        expectedCellVersion,
        cell: cloneCell(store.getRawCell(sheetIndex, editing.row, editing.column)),
        lock
      });
      holdCellLockUntil(submission, lock);
    }
    state.editing = null;
    hideCellFormulaAssist();
    onInputDraft(null);
    editorOverlay.hidden = true;
    editorOverlay.classList.remove('is-invalid');
    editorOverlay.setAttribute('aria-invalid', 'false');
    renderer.setEditing(null, null);
    releaseActiveCellLock();
    if (move) {
      const next = move(editing);
      renderer.setSelection(next.row, next.column);
      renderer.scrollCellIntoView(next.row, next.column);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      syncToolbarState();
    }
    return true;
  }

  function cancelEdit() {
    if (!state.editing) return;
    state.editing = null;
    hideCellFormulaAssist();
    editorOverlay.hidden = true;
    renderer.setEditing(null, null);
    editorOverlay.classList.remove('is-invalid');
    editorOverlay.setAttribute('aria-invalid', 'false');
    editorOverlay.readOnly = false;
    releaseActiveCellLock();
  }

  function onEditorKeyDown(event) {
    if (event.isComposing || state.cellComposing || event.keyCode === 229) return;
    const choices = !cellFormulaAssist.hidden
      ? Array.from(cellFormulaAssist.querySelectorAll('.sheet-formula-suggestion'))
      : [];
    if (choices.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      event.stopPropagation();
      const activeId = editorOverlay.getAttribute('aria-activedescendant');
      const current = choices.findIndex((choice) => choice.id === activeId);
      const next =
        event.key === 'ArrowDown' ? (current + 1) % choices.length : current <= 0 ? choices.length - 1 : current - 1;
      choices.forEach((choice, index) => {
        choice.classList.toggle('is-active', index === next);
        choice.setAttribute('aria-selected', String(index === next));
      });
      editorOverlay.setAttribute('aria-activedescendant', choices[next].id);
      choices[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (choices.length && event.key === 'Enter') {
      const selected =
        choices.find((choice) => choice.id === editorOverlay.getAttribute('aria-activedescendant')) || choices[0];
      if (selected?.dataset.functionName) {
        event.preventDefault();
        event.stopPropagation();
        editorOverlay.value = `=${selected.dataset.functionName}()`;
        editorOverlay.setSelectionRange(editorOverlay.value.length - 1, editorOverlay.value.length - 1);
        onEditorInput();
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      focusGrid();
      return;
    }
    if (event.key === 'Enter' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (commitEdit((editing) => ({ row: editing.row + 1, column: editing.column }))) focusGrid();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      if (
        commitEdit((editing) => ({ row: editing.row, column: Math.max(0, editing.column + (event.shiftKey ? -1 : 1)) }))
      )
        focusGrid();
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) autoGrowEditor();
  }

  return {
    beginEdit,
    lockMatches,
    isRemotelyLocked,
    requestCellLock,
    releaseActiveCellLock,
    holdCellLockUntil,
    autoGrowEditor,
    onEditorInput,
    commitEdit,
    cancelEdit,
    onEditorKeyDown
  };
}

module.exports = { createCells };
