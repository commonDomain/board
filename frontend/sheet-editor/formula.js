'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const { FORMULA_ERROR_HELP, element } = require('./controls');

function createFormula({
  acquireCellLock,
  activeCell,
  activeCellProxy,
  afterModelChange,
  cellFormulaAssist,
  cloneCell,
  doc,
  editorId,
  editorOverlay,
  focusGrid,
  formulaBar,
  gridWrap,
  holdCellLockUntil,
  lockMatches,
  onEditorInput,
  onInputDraft,
  releaseActiveCellLock,
  renderer,
  requestCellLock,
  selection,
  selectionRange,
  state,
  syncHorizontalScroll,
  updateStatus,
  view
}) {
  function buildFormulaBar() {
    formulaBar.textContent = '';
    const reference = element('div', 'sheet-reference');
    reference.dataset.role = 'reference';
    const divider = element('span', 'sheet-divider', 'fx');
    const input = element('textarea', 'sheet-formula-input');
    const feedback = element('div', 'sheet-formula-feedback');
    const suggestions = element('div', 'sheet-formula-suggestions');
    suggestions.dataset.role = 'formula-suggestions';
    suggestions.hidden = true;
    suggestions.setAttribute('role', 'listbox');
    feedback.id = `sheet-formula-feedback-${editorId}`;
    feedback.dataset.role = 'formula-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.hidden = true;
    input.rows = 1;
    input.spellcheck = false;
    input.setAttribute('aria-label', '公式输入');
    input.setAttribute('aria-describedby', feedback.id);
    input.dataset.role = 'formula';
    formulaBar.append(reference, divider, input, feedback, suggestions);
    input.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    input.addEventListener('keydown', onFormulaKeyDown);
    input.addEventListener('focus', async () => {
      const cell = activeCell();
      if (!acquireCellLock) return;
      input.readOnly = true;
      const lock = await requestCellLock(cell.row, cell.column);
      if (doc.activeElement === input && lock) input.readOnly = false;
    });
    input.addEventListener('compositionstart', () => {
      state.formulaComposing = true;
    });
    input.addEventListener('compositionend', () => {
      state.formulaComposing = false;
      input.dataset.dirty = 'true';
      updateFormulaFeedback();
      updateFormulaSuggestions();
      const cell = activeCell();
      onInputDraft({
        sheetId: state.store?.activeSheet()?.sheetId,
        row: cell.row,
        column: cell.column,
        text: input.value,
        mode: 'formula-bar'
      });
    });
    input.addEventListener('input', () => {
      input.dataset.dirty = 'true';
      updateFormulaFeedback();
      updateFormulaSuggestions();
      const cell = activeCell();
      onInputDraft({
        sheetId: state.store?.activeSheet()?.sheetId,
        row: cell.row,
        column: cell.column,
        text: input.value,
        mode: 'formula-bar'
      });
    });
    input.addEventListener('blur', () => {
      if (!state.formulaComposing) commitFormulaBar({ focusOnSuccess: false, focusOnError: false });
      releaseActiveCellLock();
    });
  }

  function formulaInput() {
    return formulaBar.querySelector('[data-role="formula"]');
  }

  function formulaFeedback() {
    return formulaBar.querySelector('[data-role="formula-feedback"]');
  }

  function formulaSuggestions() {
    return formulaBar.querySelector('[data-role="formula-suggestions"]');
  }

  function hideFormulaSuggestions() {
    const suggestions = formulaSuggestions();
    if (!suggestions) return;
    suggestions.hidden = true;
    suggestions.textContent = '';
    formulaInput()?.removeAttribute('aria-activedescendant');
  }

  function acceptFormulaSuggestion(button) {
    const input = formulaInput();
    if (!input || !button?.dataset.functionName) return;
    input.value = `=${button.dataset.functionName}()`;
    input.dataset.dirty = 'true';
    hideFormulaSuggestions();
    input.focus();
    input.setSelectionRange(input.value.length - 1, input.value.length - 1);
    updateFormulaFeedback();
  }

  function updateFormulaSuggestions() {
    const input = formulaInput();
    const suggestions = formulaSuggestions();
    if (!input || !suggestions || state.formulaComposing) return;
    const prefix = /^=([A-Za-z_]*)$/.exec(input.value.slice(0, input.selectionStart || input.value.length));
    if (!prefix || !Formula.getFunctionSuggestions) {
      hideFormulaSuggestions();
      return;
    }
    let entries;
    if (!prefix[1]) {
      const preferred = ['SUM', 'AVERAGE', 'IF', 'XLOOKUP', 'COUNTIF', 'SUMPRODUCT', 'TODAY', 'TEXT'];
      entries = preferred
        .map((name) => Formula.FUNCTION_METADATA?.find((entry) => entry.name === name))
        .filter(Boolean);
    } else entries = Formula.getFunctionSuggestions(prefix[1], 8);
    suggestions.textContent = '';
    for (const [index, entry] of entries.entries()) {
      const button = element('button', 'sheet-formula-suggestion');
      button.type = 'button';
      button.id = `sheet-formula-option-${editorId}-${index}`;
      button.dataset.functionName = entry.name;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === 0));
      button.classList.toggle('is-active', index === 0);
      button.append(element('strong', null, entry.name), element('span', null, entry.description));
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => acceptFormulaSuggestion(button));
      suggestions.appendChild(button);
    }
    suggestions.hidden = entries.length === 0;
    if (entries.length) input.setAttribute('aria-activedescendant', `sheet-formula-option-${editorId}-0`);
  }

  function hideCellFormulaAssist() {
    cellFormulaAssist.hidden = true;
    cellFormulaAssist.textContent = '';
  }

  function updateCellFormulaAssist() {
    if (!state.editing || state.cellComposing) {
      hideCellFormulaAssist();
      return;
    }
    const value = editorOverlay.value;
    const caret = editorOverlay.selectionStart || value.length;
    const prefix = /^=([A-Za-z_]*)$/.exec(value.slice(0, caret));
    const token = /^=([A-Za-z_]\w*)/.exec(value.slice(0, caret));
    let entries = [];
    if (prefix && Formula.getFunctionSuggestions) {
      entries = prefix[1]
        ? Formula.getFunctionSuggestions(prefix[1], 6)
        : ['SUM', 'AVERAGE', 'IF', 'XLOOKUP']
            .map((name) => Formula.FUNCTION_METADATA?.find((entry) => entry.name === name))
            .filter(Boolean);
    }
    const metadata = token && Formula.getFunctionSuggestions ? Formula.getFunctionSuggestions(token[1], 1)[0] : null;
    cellFormulaAssist.textContent = '';
    if (metadata && !entries.length)
      cellFormulaAssist.append(
        element('div', 'sheet-cell-formula-signature', `${metadata.signature} · ${metadata.description}`)
      );
    for (const [index, entry] of entries.entries()) {
      const option = element('button', 'sheet-formula-suggestion');
      option.type = 'button';
      option.id = `sheet-cell-formula-option-${editorId}-${index}`;
      option.dataset.functionName = entry.name;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === 0));
      option.classList.toggle('is-active', index === 0);
      option.append(element('strong', null, entry.name), element('span', null, entry.description));
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        editorOverlay.value = `=${entry.name}()`;
        editorOverlay.focus();
        editorOverlay.setSelectionRange(editorOverlay.value.length - 1, editorOverlay.value.length - 1);
        onEditorInput();
      });
      cellFormulaAssist.append(option);
    }
    const rect = renderer.cellRect(state.editing.row, state.editing.column);
    if (rect) {
      cellFormulaAssist.style.left = `${Math.max(0, rect.x)}px`;
      cellFormulaAssist.style.top = `${Math.max(0, rect.y + rect.height + 3)}px`;
      cellFormulaAssist.style.width = `${Math.min(430, Math.max(280, gridWrap.clientWidth - rect.x - 8))}px`;
    }
    cellFormulaAssist.hidden = !metadata && !entries.length;
    if (entries.length) editorOverlay.setAttribute('aria-activedescendant', `sheet-cell-formula-option-${editorId}-0`);
    else editorOverlay.removeAttribute('aria-activedescendant');
  }

  function insertCellReference(input, row, column) {
    const reference = Formula.toA1(row, column);
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = `${input.value.slice(0, start)}${reference}${input.value.slice(end)}`;
    input.setSelectionRange(start + reference.length, start + reference.length);
  }

  function formulaReferenceInput() {
    if (state.editing && editorOverlay.value.trimStart().startsWith('=')) return editorOverlay;
    const input = formulaInput();
    return input?.dataset.dirty === 'true' && input.value.trimStart().startsWith('=') ? input : null;
  }

  function updateFormulaReference(drag, cell) {
    const startRef = Formula.toA1(Math.min(drag.start.row, cell.row), Math.min(drag.start.column, cell.column));
    const endRef = Formula.toA1(Math.max(drag.start.row, cell.row), Math.max(drag.start.column, cell.column));
    const reference = startRef === endRef ? startRef : `${startRef}:${endRef}`;
    drag.input.value = `${drag.prefix}${reference}${drag.suffix}`;
    drag.input.setSelectionRange(drag.prefix.length + reference.length, drag.prefix.length + reference.length);
    renderer.setSelection(drag.start.row, drag.start.column);
    selection().focus.row = cell.row;
    selection().focus.column = cell.column;
    renderer.requestDraw();
    if (drag.input === editorOverlay) onEditorInput();
    else {
      drag.input.dataset.dirty = 'true';
      updateFormulaFeedback();
      updateFormulaSuggestions();
    }
  }

  function setFormulaFeedback(message, tone = '') {
    const feedback = formulaFeedback();
    const input = formulaInput();
    if (!feedback || !input) return;
    feedback.hidden = !message;
    feedback.textContent = message || '';
    feedback.className = `sheet-formula-feedback${tone ? ` is-${tone}` : ''}`;
    input.classList.toggle('is-invalid', tone === 'error');
    input.setAttribute('aria-invalid', String(tone === 'error'));
  }

  function validateInput(value) {
    const store = state.store;
    if (!store) return { valid: true, kind: 'literal' };
    return store.validateCellInput
      ? store.validateCellInput(value)
      : { valid: !String(value || '').startsWith('=') || !Formula.parseFormula(value).error, kind: 'formula' };
  }

  function updateFormulaFeedback() {
    const input = formulaInput();
    const store = state.store;
    if (!input || !store) return;
    if (input.dataset.dirty === 'true') {
      const validation = validateInput(input.value);
      if (!validation.valid) {
        const token = /^=([A-Za-z_]\w*)/.exec(input.value.slice(0, input.selectionStart || input.value.length));
        const metadata =
          token && Formula.getFunctionSuggestions ? Formula.getFunctionSuggestions(token[1], 1)[0] : null;
        setFormulaFeedback(
          metadata && (input.value.endsWith('(') || input.value.split('(').length > input.value.split(')').length)
            ? `公式未完成 · ${metadata.signature} · ${metadata.description}`
            : `公式有误：${validation.message || validation.error || '请检查语法'}`,
          metadata ? '' : 'error'
        );
      } else if (validation.kind === 'formula') {
        const token = /^=([A-Za-z_]\w*)/.exec(input.value.slice(0, input.selectionStart || input.value.length));
        const metadata =
          token && Formula.getFunctionSuggestions ? Formula.getFunctionSuggestions(token[1], 1)[0] : null;
        setFormulaFeedback(
          metadata ? `${metadata.signature} · ${metadata.description}` : '公式格式正确，按 Enter 保存',
          'success'
        );
      } else {
        setFormulaFeedback('', '');
      }
      return;
    }
    const cell = activeCell();
    const display = store.getDisplayValue(store.activeSheetIndex(), cell.row, cell.column);
    if (typeof display === 'string' && Formula.isError(display)) {
      setFormulaFeedback(`${display} · ${FORMULA_ERROR_HELP[display] || '请检查公式引用与参数。'}`, 'error');
    } else {
      setFormulaFeedback('', '');
    }
  }

  function commitFormulaBar(options = {}) {
    const input = formulaInput();
    if (!input || input.dataset.dirty !== 'true') return true;
    if (state.formulaComposing) return false;
    const cell = activeCell();
    const store = state.store;
    if (!store) return true;
    if (acquireCellLock && !lockMatches(cell.row, cell.column)) {
      state.statusMessage = '未保存：单元格编辑锁已失效，内容仍保留在输入框中';
      setFormulaFeedback('连接恢复后请重新点击输入框获取编辑锁。', 'error');
      updateStatus();
      return false;
    }
    const validation = validateInput(input.value);
    if (!validation.valid) {
      state.statusMessage = `未保存：${validation.message || validation.error || '公式语法错误'}`;
      setFormulaFeedback(`公式有误：${validation.message || validation.error || '请检查语法'}`, 'error');
      updateStatus();
      if (options.focusOnError !== false) view().requestAnimationFrame(() => input.focus());
      return false;
    }
    const sheetIndex = store.activeSheetIndex();
    const expectedCellVersion = store.getCellVersion?.(sheetIndex, cell.row, cell.column) || 0;
    const lock = state.cellLock;
    const changed = store.setCellInput(sheetIndex, cell.row, cell.column, input.value);
    if (changed === false) {
      state.statusMessage = '未保存：公式无法写入当前单元格';
      setFormulaFeedback('公式无法保存，请检查长度和语法。', 'error');
      updateStatus();
      if (options.focusOnError !== false) view().requestAnimationFrame(() => input.focus());
      return false;
    }
    input.dataset.dirty = 'false';
    onInputDraft(null);
    state.statusMessage = `已更新 ${Formula.toA1(cell.row, cell.column)}`;
    const submission = afterModelChange({
      kind: 'set-cell',
      sheetId: store.activeSheet().sheetId,
      row: cell.row,
      column: cell.column,
      expectedCellVersion,
      cell: cloneCell(store.getRawCell(sheetIndex, cell.row, cell.column)),
      lock
    });
    holdCellLockUntil(submission, lock);
    syncFormulaBar();
    if (options.focusOnSuccess !== false) focusGrid();
    return true;
  }

  function onFormulaKeyDown(event) {
    if (event.isComposing || state.formulaComposing || event.keyCode === 229) return;
    const suggestions = formulaSuggestions();
    const choices =
      suggestions && !suggestions.hidden ? Array.from(suggestions.querySelectorAll('.sheet-formula-suggestion')) : [];
    if (choices.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const activeId = formulaInput()?.getAttribute('aria-activedescendant');
      const current = choices.findIndex((choice) => choice.id === activeId);
      const next =
        event.key === 'ArrowDown' ? (current + 1) % choices.length : current <= 0 ? choices.length - 1 : current - 1;
      choices.forEach((choice, index) => {
        choice.classList.toggle('is-active', index === next);
        choice.setAttribute('aria-selected', String(index === next));
      });
      formulaInput()?.setAttribute('aria-activedescendant', choices[next].id);
      choices[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (choices.length && event.key === 'Enter' && formulaInput()?.getAttribute('aria-activedescendant')) {
      event.preventDefault();
      acceptFormulaSuggestion(
        choices.find((choice) => choice.id === formulaInput().getAttribute('aria-activedescendant'))
      );
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (choices.length) {
        hideFormulaSuggestions();
        return;
      }
      const input = formulaInput();
      if (input) input.dataset.dirty = 'false';
      syncFormulaBar();
      focusGrid();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitFormulaBar();
    }
  }

  function syncFormulaBar() {
    const store = state.store;
    if (!store) return;
    const cell = activeCell();
    const reference = formulaBar.querySelector('[data-role="reference"]');
    const range = selectionRange();
    if (reference) {
      reference.textContent =
        range.startRow === range.endRow && range.startColumn === range.endColumn
          ? Formula.toA1(cell.row, cell.column)
          : `${Formula.toA1(range.startRow, range.startColumn)}:${Formula.toA1(range.endRow, range.endColumn)}`;
    }
    const input = formulaInput();
    if (input && input.dataset.dirty !== 'true') {
      input.value = store.getEditText(store.activeSheetIndex(), cell.row, cell.column);
    }
    hideFormulaSuggestions();
    updateFormulaFeedback();
    const address = Formula.toA1(cell.row, cell.column);
    const value = store.getDisplayValue(store.activeSheetIndex(), cell.row, cell.column);
    const formula = store.getEditText(store.activeSheetIndex(), cell.row, cell.column);
    const rangeLabel =
      range.startRow === range.endRow && range.startColumn === range.endColumn
        ? ''
        : `，选择 ${Formula.toA1(range.startRow, range.startColumn)} 到 ${Formula.toA1(range.endRow, range.endColumn)}`;
    activeCellProxy.textContent = `${address}，${formula.startsWith('=') ? `公式 ${formula}，结果 ${value || '空白'}` : value || '空白'}${rangeLabel}`;
    activeCellProxy.setAttribute('aria-rowindex', String(cell.row + 1));
    activeCellProxy.setAttribute('aria-colindex', String(cell.column + 1));
    syncHorizontalScroll();
  }

  return {
    buildFormulaBar,
    formulaInput,
    formulaFeedback,
    formulaSuggestions,
    hideFormulaSuggestions,
    acceptFormulaSuggestion,
    updateFormulaSuggestions,
    hideCellFormulaAssist,
    updateCellFormulaAssist,
    insertCellReference,
    formulaReferenceInput,
    updateFormulaReference,
    setFormulaFeedback,
    validateInput,
    updateFormulaFeedback,
    commitFormulaBar,
    onFormulaKeyDown,
    syncFormulaBar
  };
}

module.exports = { createFormula };
