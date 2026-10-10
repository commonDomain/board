import {
  configurePointerDown
} from '../pointer-down.js';
import {
  cancelWheelZoomAnimation,
  getBoardPoint,
  setZoom,
  applyCamera,
  registerMiddleClick,
  scheduleCameraApply
} from '../camera.js';
import {
  beginPendingMove,
  finishConnectorDraft,
  startConnectorDraft,
  startDrawing,
  startShape,
  createViewportPreviewCanvas
} from '../drawing.js';
import {
  createEditableItem,
  startEditingItem
} from '../editing.js';
import {
  startEraser,
  configureEraser
} from '../eraser.js';
import {
  setColor
} from '../format-actions.js';
import {
  finishPinch,
  startPinch
} from '../gestures.js';
import {
  sampleColorAtPoint
} from '../image-upload.js';
import {
  startSmudge,
  createInkPiece,
  inkItemPointsToBoard
} from '../ink-geometry.js';
import {
  addAmapItem,
  addTableItem
} from '../items.js';
import {
  startPendingCanvasIntent,
  attachSelectionFrame,
  updateSelectionHandleCursors,
  restoreIdleCursorState,
  setActiveCursorState,
  continueMarquee
} from '../marquee.js';
import {
  selectMindNode,
  startMindNodeEdit
} from '../mindmap-editing.js';

import {
  hideSectionHoverLabel,
  rememberCanvasPointer
} from '../pointer-move.js';
import {
  closePopovers
} from '../popovers.js';
import {
  hitTestItem,
  renderItem,
  removeItemElement
} from '../rendering.js';
import {
  startSectionDraft
} from '../sections.js';
import {
  selectItem,
  updateSelectionUI,
  configureSelection
} from '../selection.js';
import {
  openSheetEditor
} from '../sheet-editor.js';
import {
  restoreNavigationTool
} from '../toolbar.js';
import {
  startTransform,
  configureTransform,
  continueTransform
} from '../transform.js';
import {
  pushUndoSnapshot
} from '../history-controller.js';
import {
  getLayerContainer,
  moveSelectionZ
} from '../layers.js';
import {
  captureViewportPointer,
  configurePan
} from '../pan.js';
import {
  markDirty
} from '../save-status.js';
import {
  indexRemoveItem,
  indexUpsertItem
} from '../spatial-index.js';
import {
  enqueueOperation
} from '../sync-queue.js';
import {
  updateContextPanel
} from '../format-panel.js';
import {
  updateArrangeBar
} from '../groups.js';
import {
  deleteTableDimension
} from '../table-rendering.js';
import {
  clearGuides,
  renderGuides
} from '../presence.js';
import {
  scheduleFloatingToolbarPosition
} from '../floating-toolbar-menu.js';

function configurePointerInteractions() {
  configurePointerDown({cancelWheelZoomAnimation,
getBoardPoint,
setZoom,
beginPendingMove,
finishConnectorDraft,
startConnectorDraft,
startDrawing,
startShape,
createEditableItem,
startEditingItem,
startEraser,
setColor,
finishPinch,
startPinch,
sampleColorAtPoint,
startSmudge,
addAmapItem,
addTableItem,
startPendingCanvasIntent,
selectMindNode,
startMindNodeEdit,
hideSectionHoverLabel,
rememberCanvasPointer,
closePopovers,
hitTestItem,
renderItem,
startSectionDraft,
selectItem,
openSheetEditor,
restoreNavigationTool,
startTransform});
  configureEraser({
    pushUndoSnapshot,
    getBoardPoint,
    createViewportPreviewCanvas,
    createInkPiece,
    inkItemPointsToBoard,
    getLayerContainer,
    captureViewportPointer,
    removeItemElement,
    renderItem,
    markDirty,
    updateSelectionUI,
    indexRemoveItem,
    enqueueOperation
  });
  configureSelection({getBoardPoint,
updateContextPanel,
updateArrangeBar,
moveSelectionZ,
attachSelectionFrame,
updateSelectionHandleCursors,
hitTestItem,
renderItem,
deleteTableDimension});
  configureTransform({
    getBoardPoint,
    restoreIdleCursorState,
    setActiveCursorState,
    clearGuides,
    renderGuides,
    renderItem,
    indexUpsertItem,
    enqueueOperation
  });
  configurePan({
    applyCamera,
    getBoardPoint,
    registerMiddleClick,
    scheduleCameraApply,
    scheduleFloatingToolbarPosition,
    continueMarquee,
    restoreIdleCursorState,
    setActiveCursorState,
    hitTestItem,
    continueTransform
  });
}

export { configurePointerInteractions };
