'use strict';

function createKeyboard({
  activeCell,
  afterModelChange,
  beginEdit,
  buildTabs,
  close,
  openFindReplace,
  openShortcutHelp,
  releaseActiveCellLock,
  renderer,
  save,
  selection,
  selectionRange,
  state,
  syncFormulaBar,
  syncHighlight,
  syncToolbarState,
  toggleStyle,
  updateStatus,
  view
}) {
  function onGridKeyDown(event) {
    const store = state.store;
    if (!store || state.editing) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (state.startingEdit) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        event.preventDefault();
        state.startingEdit.text = `${state.startingEdit.text ?? ''}${event.key}`;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        state.startingEdit.commit = true;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        state.startingEdit = null;
        releaseActiveCellLock();
      }
      return;
    }
    // Focus inside a form control belongs to that control: Escape closes the
    // native picker instead of the whole panel, and typing never reaches the
    // grid's single-key shortcuts.
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select')) return;
    const cell = activeCell();
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (meta && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      copySelection(true);
      return;
    }
    if (meta && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteSelection();
      return;
    }
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      const changed = event.shiftKey ? store.redo() : store.undo();
      if (changed) {
        renderer.setSheetIndex(store.activeSheetIndex());
        buildTabs();
        afterModelChange();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (store.redo()) {
        renderer.setSheetIndex(store.activeSheetIndex());
        buildTabs();
        afterModelChange();
      }
      return;
    }
    if (meta && event.key.toLowerCase() === 's') {
      // Saves in place; closing is a separate, explicit action.
      event.preventDefault();
      save();
      return;
    }
    if (meta && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFindReplace();
      return;
    }
    if (meta && event.key === '/') {
      event.preventDefault();
      openShortcutHelp();
      return;
    }
    if (meta && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleStyle('bold');
      return;
    }
    if (meta && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      toggleStyle('italic');
      return;
    }
    if (meta && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      toggleStyle('underline');
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const used = store.usedBounds();
      renderer.setSelection(0, 0);
      selection().focus.row = Math.max(0, (used.rows || 1) - 1);
      selection().focus.column = Math.max(0, (used.columns || 1) - 1);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      return;
    }

    const movement = {
      ArrowUp: { row: -1, column: 0 },
      ArrowDown: { row: 1, column: 0 },
      ArrowLeft: { row: 0, column: -1 },
      ArrowRight: { row: 0, column: 1 }
    }[event.key];

    if (movement) {
      event.preventDefault();
      if (meta) {
        const used = store.usedBounds();
        const limitRow = movement.row > 0 ? Math.max(0, used.rows - 1) : 0;
        const limitColumn = movement.column > 0 ? Math.max(0, used.columns - 1) : 0;
        renderer.setSelection(movement.row ? limitRow : cell.row, movement.column ? limitColumn : cell.column);
      } else if (event.shiftKey) {
        selection().focus.row = Math.max(0, selection().focus.row + movement.row);
        selection().focus.column = Math.max(0, selection().focus.column + movement.column);
        renderer.requestDraw();
      } else {
        renderer.setSelection(Math.max(0, cell.row + movement.row), Math.max(0, cell.column + movement.column));
      }
      renderer.scrollCellIntoView(selection().anchor.row, selection().anchor.column);
      syncHighlight();
      syncFormulaBar();
      updateStatus();
      syncToolbarState();
      return;
    }

    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        moveActive(0, event.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        event.preventDefault();
        beginEdit(cell.row, cell.column, '');
        break;
      case 'F2':
        event.preventDefault();
        beginEdit(cell.row, cell.column);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        store.clearRange(selectionRange(), 'content');
        afterModelChange();
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Home':
        event.preventDefault();
        renderer.setSelection(cell.row, 0);
        renderer.scrollCellIntoView(cell.row, 0);
        syncHighlight();
        syncFormulaBar();
        break;
      case 'End': {
        event.preventDefault();
        const used = store.usedBounds();
        renderer.setSelection(cell.row, Math.max(0, used.columns - 1));
        renderer.scrollCellIntoView(cell.row, Math.max(0, used.columns - 1));
        syncHighlight();
        syncFormulaBar();
        break;
      }
      case 'PageDown':
        event.preventDefault();
        moveActive(20, 0);
        break;
      case 'PageUp':
        event.preventDefault();
        moveActive(-20, 0);
        break;
      default:
        // A printable character starts an edit with that character, as Excel does.
        if (!meta && !event.altKey && event.key.length === 1) {
          event.preventDefault();
          beginEdit(cell.row, cell.column, event.key);
        }
        break;
    }
  }

  function moveActive(rowDelta, columnDelta) {
    const cell = activeCell();
    const row = Math.max(0, cell.row + rowDelta);
    const column = Math.max(0, cell.column + columnDelta);
    renderer.setSelection(row, column);
    renderer.scrollCellIntoView(row, column);
    syncHighlight();
    syncFormulaBar();
    updateStatus();
    syncToolbarState();
  }

  function copySelection(cut = false) {
    const store = state.store;
    if (!store) return;
    const range = selectionRange();
    const payload = store.readRange(range);
    state.clipboard = { ...payload, range, cut };
    state.statusMessage = cut ? '已剪切，待粘贴' : '已复制，可粘贴到表格或 Excel';
    updateStatus();
    const clipboard = view().navigator?.clipboard;
    if (clipboard && typeof clipboard.write === 'function' && typeof view().ClipboardItem === 'function') {
      const items = { 'text/plain': new Blob([payload.text], { type: 'text/plain' }) };
      if (payload.html) items['text/html'] = new Blob([payload.html], { type: 'text/html' });
      clipboard.write([new view().ClipboardItem(items)]).catch(() => {});
    }
  }

  function pasteSelection() {
    const store = state.store;
    if (!store) return;
    const cell = activeCell();
    const clipboard = view().navigator?.clipboard;
    const apply = (text) => {
      if (!text) return;
      store.importText(cell.row, cell.column, text);
      afterModelChange();
    };
    if (clipboard && typeof clipboard.readText === 'function') {
      clipboard
        .readText()
        .then(apply)
        .catch(() => {
          if (state.clipboard) apply(state.clipboard.text);
        });
    } else if (state.clipboard) {
      apply(state.clipboard.text);
    }
    if (state.clipboard?.cut) {
      store.clearRange(state.clipboard.range, 'content');
      state.clipboard = null;
    }
  }

  function onPasteEvent(event) {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    const store = state.store;
    if (!store) return;
    const cell = activeCell();
    store.importText(cell.row, cell.column, text);
    afterModelChange();
  }

  function onCopyEvent(event) {
    const store = state.store;
    if (!store) return;
    const payload = store.readRange(selectionRange());
    event.clipboardData?.setData('text/plain', payload.text);
    if (payload.html) event.clipboardData?.setData('text/html', payload.html);
    event.preventDefault();
    event.stopPropagation();
  }

  return { onGridKeyDown, moveActive, copySelection, pasteSelection, onPasteEvent, onCopyEvent };
}

module.exports = { createKeyboard };
