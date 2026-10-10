'use strict';
const { createToolbarLayout } = require('./toolbar-layout');
const { createToolbarPickers } = require('./toolbar-pickers');
const { createToolbarActions } = require('./toolbar-actions');
function createToolbar(options) {
  const { buildToolbar } = createToolbarLayout({
    toolbar: options.toolbar,
    withAction: options.withAction,
    labeledTool: options.labeledTool,
    selectMenu: (...args) => selectMenu(...args),
    swatchPicker: (...args) => swatchPicker(...args),
    borderPicker: (...args) => borderPicker(...args),
    actionMenu: (...args) => actionMenu(...args)
  });
  const {
    actionMenu,
    syncSelectMenu,
    selectMenu,
    closeToolbarMenus,
    swatchPicker,
    borderPicker,
    trackPickerPointer,
    resetPickerPointer
  } = createToolbarPickers({
    labeledTool: options.labeledTool,
    menuChevron: options.menuChevron,
    toolbar: options.toolbar,
    referenceGlyph: options.referenceGlyph
  });
  const {
    syncToolbarState,
    applyStyleToSelection,
    toggleStyle,
    setFreeze,
    applyQuickFormula,
    onToolbarClick,
    onToolbarChange,
    onToolbarKeyDown
  } = createToolbarActions({
    state: options.state,
    selectionRange: options.selectionRange,
    toolbar: options.toolbar,
    syncSelectMenu: (...args) => syncSelectMenu(...args),
    afterModelChange: options.afterModelChange,
    activeCell: options.activeCell,
    updateStatus: options.updateStatus,
    renderer: options.renderer,
    root: options.root,
    formulaInput: options.formulaInput,
    commitFormulaBar: options.commitFormulaBar,
    buildTabs: options.buildTabs,
    syncHighlight: options.syncHighlight,
    gridCanvas: options.gridCanvas,
    openFilterDialog: options.openFilterDialog,
    openFindReplace: options.openFindReplace,
    openShortcutHelp: options.openShortcutHelp,
    importXlsx: options.importXlsx,
    exportXlsx: options.exportXlsx,
    exportCsv: options.exportCsv,
    save: options.save,
    close: options.close,
    closeToolbarMenus: (...args) => closeToolbarMenus(...args),
    focusGrid: options.focusGrid
  });
  return {
    buildToolbar,
    actionMenu,
    syncSelectMenu,
    selectMenu,
    closeToolbarMenus,
    swatchPicker,
    borderPicker,
    syncToolbarState,
    applyStyleToSelection,
    toggleStyle,
    setFreeze,
    applyQuickFormula,
    onToolbarClick,
    onToolbarChange,
    onToolbarKeyDown,
    trackPickerPointer,
    resetPickerPointer
  };
}
module.exports = { createToolbar };
