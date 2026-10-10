'use strict';

const Core = typeof window === 'object' ? window.SheetCore : require('../../public/sheet-core.js');
const View = typeof window === 'object' ? window.SheetView : require('../../public/sheet-view.js');
const { NUMBER_FORMATS, FILL_SWATCHES, TEXT_SWATCHES, FILTER_OPERATORS, element, iconButton } = require('./controls');
const { createToolbar } = require('./toolbar');
const { createFormula } = require('./formula');
const { createTabs } = require('./tabs');
const { createTools } = require('./tools');
const { createMenus } = require('./menus');
const { createCells } = require('./cells');
const { createPointer } = require('./pointer');
const { createKeyboard } = require('./keyboard');
const { createLifecycle } = require('./lifecycle');

const { createToolbarControls } = require('./toolbar-controls');
const { createSurface } = require('./surface');
const { wireEditorEvents } = require('./events');
let editorSequence = 0;

function createEditor(options = {}) {
  const doc = options.document || document;
  const { labeledTool, menuChevron, referenceGlyph } = createToolbarControls(doc);

  const onCommit = typeof options.onCommit === 'function' ? options.onCommit : () => {};

  const onClose = typeof options.onClose === 'function' ? options.onClose : () => {};

  const onDirty = typeof options.onDirty === 'function' ? options.onDirty : () => {};

  const onRename = typeof options.onRename === 'function' ? options.onRename : () => true;

  const onInputDraft = typeof options.onInputDraft === 'function' ? options.onInputDraft : () => {};

  const acquireCellLock = typeof options.acquireCellLock === 'function' ? options.acquireCellLock : null;

  const releaseCellLock = typeof options.releaseCellLock === 'function' ? options.releaseCellLock : () => {};

  const editorId = ++editorSequence;
  const {
    root,
    header,
    identity,
    identityIcon,
    titleWrap,
    titleButton,
    title,
    titleEditIcon,
    headerActions,
    headerSaveState,
    headerDone,
    toolbar,
    formulaBar,
    gridWrap,
    gridCanvas,
    activeCellProxy,
    editorOverlay,
    cellFormulaAssist,
    horizontalScroll,
    horizontalScrollTrack,
    tabsBar,
    statusBar
  } = createSurface({ doc, editorId, labeledTool, withAction });

  const renderer = View.createGridRenderer(gridCanvas, {
    store: options.store,
    // Frozen rows/columns are pinned in the panel, matching Excel.
    freezeRendering: true,
    selection: View.createSelection(0, 0)
  });

  const state = {
    store: options.store,
    editing: null,
    startingEdit: null,
    drag: null,
    clipboard: null,
    statusMessage: '',
    formulaComposing: false,
    cellComposing: false,
    highlightEnabled: false,
    cellLock: null,
    lockRequest: 0,
    lockLost: false,
    remoteCellLocks: new Map(),
    touchContext: null,
    formatPainter: null,
    formulaReference: null,
    closed: true
  };

  function view() {
    return root.ownerDocument.defaultView || window;
  }

  function selection() {
    return renderer.selection;
  }

  function selectionRange() {
    const start = selection().start;
    const end = selection().end;
    return {
      startRow: start.row,
      startColumn: start.column,
      endRow: end.row,
      endColumn: end.column
    };
  }

  function activeCell() {
    return { row: selection().anchor.row, column: selection().anchor.column };
  }

  function withAction(button, action) {
    button.dataset.action = action;
    return button;
  }

  function syncHorizontalScroll() {
    const metrics = renderer.getScrollMetrics?.();
    if (!metrics) return;
    const viewport = Math.max(1, horizontalScroll.clientWidth || metrics.viewportWidth || 1);
    horizontalScrollTrack.style.width = `${Math.max(viewport, viewport + metrics.maxLeft)}px`;
    horizontalScroll.hidden = metrics.maxLeft <= 0;
    if (Math.abs(horizontalScroll.scrollLeft - metrics.left) > 1) horizontalScroll.scrollLeft = metrics.left;
  }

  function cloneCell(cell) {
    if (!cell) return null;
    return typeof structuredClone === 'function' ? structuredClone(cell) : JSON.parse(JSON.stringify(cell));
  }

  function syncHighlight() {
    const cell = activeCell();
    renderer.setHighlight(state.highlightEnabled ? cell.row : null, state.highlightEnabled ? cell.column : null);
  }

  const contextMenu = element('div', 'sheet-context-menu');

  contextMenu.hidden = true;

  contextMenu.setAttribute('role', 'menu');

  root.appendChild(contextMenu);

  const visualViewport = view().visualViewport || null;

  function onViewportResize() {
    hideContextMenu();
    if (state.closed) return;
    view().requestAnimationFrame(() => {
      onGridResize();
      renderer.draw();
    });
  }

  function dismissToolbarMenus(event) {
    if (state.closed) return;
    if (!event.target.closest?.('.sheet-color, .sheet-border-picker, .sheet-menu-picker')) closeToolbarMenus();
  }

  // Assemble panel features before registering events. Callbacks are resolved when invoked.
  const {
    buildToolbar,
    closeToolbarMenus,
    syncToolbarState,
    toggleStyle,
    onToolbarClick,
    onToolbarChange,
    onToolbarKeyDown,
    trackPickerPointer,
    resetPickerPointer
  } = createToolbar({
    activeCell: (...args) => activeCell(...args),
    afterModelChange: (...args) => afterModelChange(...args),
    buildTabs: (...args) => buildTabs(...args),
    close: (...args) => close(...args),
    commitFormulaBar: (...args) => commitFormulaBar(...args),
    exportCsv: (...args) => exportCsv(...args),
    exportXlsx: (...args) => exportXlsx(...args),
    focusGrid: (...args) => focusGrid(...args),
    formulaInput: (...args) => formulaInput(...args),
    gridCanvas,
    importXlsx: (...args) => importXlsx(...args),
    labeledTool: (...args) => labeledTool(...args),
    menuChevron: (...args) => menuChevron(...args),
    openFilterDialog: (...args) => openFilterDialog(...args),
    openFindReplace: (...args) => openFindReplace(...args),
    openShortcutHelp: (...args) => openShortcutHelp(...args),
    referenceGlyph: (...args) => referenceGlyph(...args),
    renderer,
    root,
    save: (...args) => save(...args),
    selectionRange: (...args) => selectionRange(...args),
    state,
    syncHighlight: (...args) => syncHighlight(...args),
    toolbar,
    updateStatus: (...args) => updateStatus(...args),
    withAction: (...args) => withAction(...args)
  });

  const {
    buildFormulaBar,
    formulaInput,
    hideCellFormulaAssist,
    updateCellFormulaAssist,
    formulaReferenceInput,
    updateFormulaReference,
    validateInput,
    updateFormulaFeedback,
    commitFormulaBar,
    syncFormulaBar
  } = createFormula({
    acquireCellLock,
    activeCell: (...args) => activeCell(...args),
    activeCellProxy,
    afterModelChange: (...args) => afterModelChange(...args),
    cellFormulaAssist,
    cloneCell: (...args) => cloneCell(...args),
    doc,
    editorId,
    editorOverlay,
    focusGrid: (...args) => focusGrid(...args),
    formulaBar,
    gridWrap,
    holdCellLockUntil: (...args) => holdCellLockUntil(...args),
    lockMatches: (...args) => lockMatches(...args),
    onEditorInput: (...args) => onEditorInput(...args),
    onInputDraft,
    releaseActiveCellLock: (...args) => releaseActiveCellLock(...args),
    renderer,
    requestCellLock: (...args) => requestCellLock(...args),
    selection: (...args) => selection(...args),
    selectionRange: (...args) => selectionRange(...args),
    state,
    syncHorizontalScroll: (...args) => syncHorizontalScroll(...args),
    updateStatus: (...args) => updateStatus(...args),
    view: (...args) => view(...args)
  });

  const { buildTabs, requestSheetDelete, renameSheet, updateStatus, afterModelChange } = createTabs({
    commitFormulaBar: (...args) => commitFormulaBar(...args),
    focusGrid: (...args) => focusGrid(...args),
    onDirty,
    openContextMenu: (...args) => openContextMenu(...args),
    options,
    renderer,
    selectionRange: (...args) => selectionRange(...args),
    sheetMenuItems: (...args) => sheetMenuItems(...args),
    showPanelCard: (...args) => showPanelCard(...args),
    state,
    statusBar,
    syncFormulaBar: (...args) => syncFormulaBar(...args),
    syncHighlight: (...args) => syncHighlight(...args),
    syncHorizontalScroll: (...args) => syncHorizontalScroll(...args),
    syncToolbarState: (...args) => syncToolbarState(...args),
    tabsBar
  });

  const { showPanelCard, openFindReplace, openShortcutHelp, openFilterDialog, exportXlsx, exportCsv, importXlsx } =
    createTools({
      afterModelChange: (...args) => afterModelChange(...args),
      buildTabs: (...args) => buildTabs(...args),
      doc,
      focusGrid: (...args) => focusGrid(...args),
      options,
      renderer,
      root,
      selectionRange: (...args) => selectionRange(...args),
      state,
      syncFormulaBar: (...args) => syncFormulaBar(...args),
      syncHighlight: (...args) => syncHighlight(...args),
      updateStatus: (...args) => updateStatus(...args),
      view: (...args) => view(...args)
    });

  const { hideContextMenu, openContextMenu, sheetMenuItems, onGridContextMenu } = createMenus({
    activeCell: (...args) => activeCell(...args),
    afterModelChange: (...args) => afterModelChange(...args),
    commitEdit: (...args) => commitEdit(...args),
    commitFormulaBar: (...args) => commitFormulaBar(...args),
    contextMenu,
    copySelection: (...args) => copySelection(...args),
    doc,
    focusGrid: (...args) => focusGrid(...args),
    formulaInput: (...args) => formulaInput(...args),
    gridCanvas,
    options,
    pasteSelection: (...args) => pasteSelection(...args),
    renameSheet: (...args) => renameSheet(...args),
    renderer,
    requestSheetDelete: (...args) => requestSheetDelete(...args),
    root,
    selection: (...args) => selection(...args),
    selectionRange: (...args) => selectionRange(...args),
    state,
    syncFormulaBar: (...args) => syncFormulaBar(...args),
    syncHighlight: (...args) => syncHighlight(...args),
    syncToolbarState: (...args) => syncToolbarState(...args),
    updateStatus: (...args) => updateStatus(...args),
    view: (...args) => view(...args),
    visualViewport
  });

  const {
    beginEdit,
    lockMatches,
    requestCellLock,
    releaseActiveCellLock,
    holdCellLockUntil,
    onEditorInput,
    commitEdit,
    cancelEdit,
    onEditorKeyDown
  } = createCells({
    acquireCellLock,
    afterModelChange: (...args) => afterModelChange(...args),
    cellFormulaAssist,
    cloneCell: (...args) => cloneCell(...args),
    editorOverlay,
    focusGrid: (...args) => focusGrid(...args),
    formulaInput: (...args) => formulaInput(...args),
    hideCellFormulaAssist: (...args) => hideCellFormulaAssist(...args),
    onInputDraft,
    releaseCellLock,
    renderer,
    state,
    syncFormulaBar: (...args) => syncFormulaBar(...args),
    syncHighlight: (...args) => syncHighlight(...args),
    syncToolbarState: (...args) => syncToolbarState(...args),
    updateCellFormulaAssist: (...args) => updateCellFormulaAssist(...args),
    updateFormulaFeedback: (...args) => updateFormulaFeedback(...args),
    updateStatus: (...args) => updateStatus(...args),
    validateInput: (...args) => validateInput(...args)
  });

  const {
    onGridPointerDown,
    onGridPointerMove,
    onGridPointerUp,
    cancelTouchContext,
    onGridDoubleClick,
    onGridWheel,
    onGridResize,
    focusGrid
  } = createPointer({
    afterModelChange: (...args) => afterModelChange(...args),
    beginEdit: (...args) => beginEdit(...args),
    commitEdit: (...args) => commitEdit(...args),
    commitFormulaBar: (...args) => commitFormulaBar(...args),
    editorOverlay,
    formulaInput: (...args) => formulaInput(...args),
    formulaReferenceInput: (...args) => formulaReferenceInput(...args),
    gridCanvas,
    gridWrap,
    onGridContextMenu: (...args) => onGridContextMenu(...args),
    renderer,
    selection: (...args) => selection(...args),
    selectionRange: (...args) => selectionRange(...args),
    state,
    syncFormulaBar: (...args) => syncFormulaBar(...args),
    syncHighlight: (...args) => syncHighlight(...args),
    syncHorizontalScroll: (...args) => syncHorizontalScroll(...args),
    syncToolbarState: (...args) => syncToolbarState(...args),
    updateFormulaReference: (...args) => updateFormulaReference(...args),
    updateStatus: (...args) => updateStatus(...args),
    view: (...args) => view(...args)
  });

  const { onGridKeyDown, copySelection, pasteSelection, onPasteEvent, onCopyEvent } = createKeyboard({
    activeCell: (...args) => activeCell(...args),
    afterModelChange: (...args) => afterModelChange(...args),
    beginEdit: (...args) => beginEdit(...args),
    buildTabs: (...args) => buildTabs(...args),
    close: (...args) => close(...args),
    openFindReplace: (...args) => openFindReplace(...args),
    openShortcutHelp: (...args) => openShortcutHelp(...args),
    releaseActiveCellLock: (...args) => releaseActiveCellLock(...args),
    renderer,
    save: (...args) => save(...args),
    selection: (...args) => selection(...args),
    selectionRange: (...args) => selectionRange(...args),
    state,
    syncFormulaBar: (...args) => syncFormulaBar(...args),
    syncHighlight: (...args) => syncHighlight(...args),
    syncToolbarState: (...args) => syncToolbarState(...args),
    toggleStyle: (...args) => toggleStyle(...args),
    updateStatus: (...args) => updateStatus(...args),
    view: (...args) => view(...args)
  });

  const { open, save, close, destroy, setStore, focusCell, setSaveLabel, setTitle, beginTitleRename } = createLifecycle(
    {
      afterModelChange: (...args) => afterModelChange(...args),
      buildFormulaBar: (...args) => buildFormulaBar(...args),
      buildTabs: (...args) => buildTabs(...args),
      buildToolbar: (...args) => buildToolbar(...args),
      cancelEdit: (...args) => cancelEdit(...args),
      cancelTouchContext: (...args) => cancelTouchContext(...args),
      commitEdit: (...args) => commitEdit(...args),
      commitFormulaBar: (...args) => commitFormulaBar(...args),
      dismissToolbarMenus: (...args) => dismissToolbarMenus(...args),
      doc,
      editorOverlay,
      focusGrid: (...args) => focusGrid(...args),
      formulaInput: (...args) => formulaInput(...args),
      header,
      hideContextMenu: (...args) => hideContextMenu(...args),
      onClose,
      onCommit,
      onGridResize: (...args) => onGridResize(...args),
      onInputDraft,
      onRename,
      onViewportResize: (...args) => onViewportResize(...args),
      options,
      releaseActiveCellLock: (...args) => releaseActiveCellLock(...args),
      renderer,
      resetPickerPointer: (...args) => resetPickerPointer(...args),
      root,
      showPanelCard: (...args) => showPanelCard(...args),
      state,
      statusBar,
      syncFormulaBar: (...args) => syncFormulaBar(...args),
      syncHighlight: (...args) => syncHighlight(...args),
      syncToolbarState: (...args) => syncToolbarState(...args),
      title,
      titleButton,
      titleWrap,
      updateStatus: (...args) => updateStatus(...args),
      validateInput: (...args) => validateInput(...args),
      view: (...args) => view(...args)
    }
  );

  toolbar.addEventListener('click', onToolbarClick);

  toolbar.addEventListener('change', onToolbarChange);

  toolbar.addEventListener('keydown', onToolbarKeyDown);

  toolbar.addEventListener('pointerdown', trackPickerPointer);

  toolbar.addEventListener('pointerup', trackPickerPointer);

  toolbar.addEventListener('pointercancel', trackPickerPointer);

  wireEditorEvents({
    beginTitleRename,
    close,
    onEditorKeyDown,
    lockMatches,
    requestCellLock,
    onEditorInput,
    commitEdit,
    onGridPointerDown,
    onGridPointerMove,
    onGridPointerUp,
    onGridDoubleClick,
    onGridWheel,
    onGridKeyDown,
    onCopyEvent,
    onPasteEvent,
    onGridContextMenu,
    closeToolbarMenus,
    buildToolbar,
    buildFormulaBar,
    buildTabs,
    titleButton,
    headerDone,
    editorOverlay,
    state,
    renderer,
    gridCanvas,
    horizontalScroll,
    gridWrap,
    root,
    view,
    onViewportResize,
    doc,
    dismissToolbarMenus
  });

  return {
    root,
    renderer,
    open,
    close,
    destroy,
    setStore,
    focusCell,
    setSaveLabel,
    setTitle,
    restoreInputDraft(draft) {
      if (!draft || !state.store) return false;
      const sheetIndex = state.store.workbook.sheets.findIndex((sheet) => sheet.sheetId === draft.sheetId);
      if (sheetIndex < 0) return false;
      state.store.setActiveSheet(sheetIndex);
      renderer.setSheetIndex(sheetIndex);
      renderer.setSelection(Math.max(0, Number(draft.row) || 0), Math.max(0, Number(draft.column) || 0));
      buildTabs();
      syncFormulaBar();
      const input = formulaInput();
      input.value = String(draft.text ?? '');
      input.dataset.dirty = 'true';
      state.statusMessage = '已恢复上次中断的输入，确认无误后按 Enter 保存';
      updateFormulaFeedback();
      updateStatus();
      view().requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      return true;
    },
    setRemoteCellLocks(locks) {
      state.remoteCellLocks = locks instanceof Map ? new Map(locks) : new Map();
      renderer.requestDraw();
    },
    loseCellLock(lock, reason) {
      if (lock && state.cellLock?.lockId !== lock.lockId) return;
      state.cellLock = null;
      state.lockLost = true;
      if (state.editing) editorOverlay.readOnly = true;
      const input = formulaInput();
      if (input && doc.activeElement === input) input.readOnly = true;
      state.statusMessage =
        reason === 'offline'
          ? '连接已断开：当前输入已保留，恢复连接后需重新获取编辑锁'
          : '编辑锁已失效：当前输入已保留，请重新获取';
      updateStatus();
    },
    focusGrid,
    isOpen: () => !state.closed,
    commitPending: () => {
      if (state.editing && commitEdit(null) === false) return false;
      if (!commitFormulaBar()) return false;
      onCommit('flush');
      return true;
    },
    handleResize: onGridResize,
    get selectionRange() {
      return selectionRange();
    }
  };
}

module.exports = {
  createEditor,
  NUMBER_FORMATS,
  FILL_SWATCHES,
  TEXT_SWATCHES,
  FILTER_OPERATORS
};
