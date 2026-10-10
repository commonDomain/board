import {
  configureEditing
} from '../editing.js';
import {
  applyDocumentState,
  documentDiffOps,
  pushUndoSnapshot,
  sendOpsPayload,
  snapshotDocument
} from '../history-controller.js';
import {
  getBoardPoint,
  setZoom
} from '../camera.js';
import {
  scheduleFloatingToolbarPosition,
  updateFloatingFormatBar,
  getEditingMindNodeContext,
  configureFloatingToolbarMenu
} from '../floating-toolbar-menu.js';
import {
  ensureEditableZoom,
  configureFormatActions
} from '../format-actions.js';
import {
  getTextCaretLocation,
  restoreTextCaretLocation,
  updateTextListControls
} from '../text-list.js';
import {
  updateContextPanel,
  getSelectedOrEditingItem,
  updateTextAppearanceControls,
  configureFormatPanel
} from '../format-panel.js';
import {
  broadcastUpsert,
  upsertItem
} from '../items.js';
import {
  setActiveCursorState
} from '../marquee.js';
import {
  captureViewportPointer
} from '../pan.js';
import {
  removeItemElement,
  renderItem
} from '../rendering.js';
import {
  markDirty
} from '../save-status.js';
import {
  selectItem
} from '../selection.js';
import {
  indexRemoveItem
} from '../spatial-index.js';
import {
  enqueueOperation
} from '../sync-queue.js';
import {
  autosizeTextItem,
  ensureTextListLinePlaceholder,
  rememberTextSelection,
  scheduleTextAutosize,
  configureTextInput
} from '../text-input.js';
import {
  syncTextItemFromDom,
  applyInlineTextFormat,
  createTextListLine
} from '../text-rendering.js';
import {
  startTransform
} from '../transform.js';
import {
  configureMindmapEditing
} from '../mindmap-editing.js';
import {
  resizeMindNodeEditor,
  applyMindNodeTextFormat
} from '../mindmap-format.js';
import {
  attachMindNodeResizeHandles
} from '../mindmap-rendering.js';
import {
  updateBrushFeedback
} from '../brush-menu.js';
import {
  cancelActiveGesture
} from '../gestures.js';
import {
  configureSheetEditor
} from '../sheet-editor.js';
import {
  isGuestMode
} from '../account-lifecycle.js';
import {
  closePopovers
} from '../popovers.js';
import {
  refreshSheetPreviews,
  refreshSheetTabs
} from '../sheet-preview.js';
import {
  restoreNavigationTool
} from '../toolbar.js';
import {
  configureSheetStore
} from '../sheet-store.js';
import {
  getViewportDropPoint
} from '../geometry.js';
import {
  floatingToolbarSafeRect,
  positionFloatingToolbar
} from '../floating-toolbar-position.js';

function configureEditingInteractions() {
  configureEditing({
    applyDocumentState,
    documentDiffOps,
    pushUndoSnapshot,
    sendOpsPayload,
    snapshotDocument,
    getBoardPoint,
    scheduleFloatingToolbarPosition,
    updateFloatingFormatBar,
    ensureEditableZoom,
    getTextCaretLocation,
    restoreTextCaretLocation,
    updateTextListControls,
    updateContextPanel,
    broadcastUpsert,
    upsertItem,
    setActiveCursorState,
    captureViewportPointer,
    removeItemElement,
    renderItem,
    markDirty,
    selectItem,
    indexRemoveItem,
    enqueueOperation,
    autosizeTextItem,
    ensureTextListLinePlaceholder,
    rememberTextSelection,
    scheduleTextAutosize,
    syncTextItemFromDom,
    startTransform
  });
  configureMindmapEditing({
    pushUndoSnapshot,
    scheduleFloatingToolbarPosition,
    ensureEditableZoom,
    resizeMindNodeEditor,
    updateContextPanel,
    attachMindNodeResizeHandles,
    renderItem,
    markDirty,
    selectItem,
    rememberTextSelection
  });
  configureFormatActions({
    updateBrushFeedback,
    setZoom,
    getSelectedOrEditingItem,
    updateContextPanel,
    updateTextAppearanceControls,
    cancelActiveGesture,
    renderItem,
    applyInlineTextFormat,
    applyMindNodeTextFormat
  });
  configureSheetEditor({
    isGuestMode,
    closePopovers,
    refreshSheetPreviews,
    enqueueOperation,
    restoreNavigationTool
  });
  configureSheetStore({
    isGuestMode,
    getViewportDropPoint,
    refreshSheetTabs,
    enqueueOperation,
    restoreNavigationTool
  });
  configureTextInput({
    getEditingMindNodeContext,
    scheduleFloatingToolbarPosition,
    getTextCaretLocation,
    restoreTextCaretLocation,
    updateTextListControls,
    renderItem,
    createTextListLine,
    syncTextItemFromDom
  });
  configureFormatPanel({
    getEditingMindNodeContext,
    updateFloatingFormatBar,
    updateTextListControls,
    renderItem
  });
  configureFloatingToolbarMenu({
    floatingToolbarSafeRect,
    positionFloatingToolbar
  });
}

export { configureEditingInteractions };
