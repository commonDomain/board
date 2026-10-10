import {
  configureCanvasSession
} from '../canvas-session.js';
import {
  updateRedoButton,
  updateUndoButton,
  pushUndoSnapshot,
  configureHistoryController
} from '../history-controller.js';
import {
  isGuestMode
} from '../account-lifecycle.js';
import {
  destroyAllAmapFrames
} from '../amap-rendering.js';
import {
  applyBackground
} from '../background.js';
import {
  cancelWheelZoomAnimation,
  centerOnOrigin,
  applyCamera,
  centerOnContent,
  getBoardPointFromClient
} from '../camera.js';
import {
  closeCanvasMenu,
  renderCanvasCatalog,
  updateCurrentCanvasLabel
} from '../catalog.js';
import {
  restorePendingCut,
  configureClipboard
} from '../clipboard.js';
import {
  connect,
  renderBoardLock,
  setConnection
} from '../connection.js';
import {
  finishEditing
} from '../editing.js';
import {
  cancelActiveGesture
} from '../gestures.js';
import {
  openAdaptiveDialog,
  setEffectBusy
} from '../interface.js';
import {
  destroyAllKdocsInstances
} from '../kdocs.js';

import {
  renderCursors,
  renderGuides,
  updatePresence
} from '../presence.js';
import {
  renderAll,
  removeItemElement,
  renderItem
} from '../rendering.js';
import {
  markDirty,
  updateSaveText
} from '../save-status.js';
import {
  closeSheetEditor
} from '../sheet-editor.js';
import {
  cacheBoardSnapshot,
  flushBoardCache,
  restoreCachedSnapshot
} from '../snapshot-cache.js';
import {
  enqueueOperation,
  scheduleAutoSave
} from '../sync-queue.js';
import {
  setMindmapPlacementLoading
} from '../xmind-connection.js';
import {
  itemNavigatorIcon
} from '../navigator-data.js';

import {
  closePopovers,
  togglePopover
} from '../popovers.js';
import {
  selectItem,
  updateSelectionUI
} from '../selection.js';
import {
  indexUpsertItem,
  rebuildSpatialIndex,
  indexRemoveItem
} from '../spatial-index.js';
import {
  setShapeLibraryTab,
  setTool,
  updateCanvasStartState,
  restoreNavigationTool
} from '../toolbar.js';

import {
  buildExportPngBlob,
  downloadBlob
} from '../export.js';
import {
  detachConnectorsFor,
  configureItems
} from '../items.js';
import {
  refreshConnectorsFor
} from '../transform.js';
import {
  focusNavigatorTarget
} from '../focus.js';
import {
  getViewportDropPoint
} from '../geometry.js';
import {
  ensureReadableToolZoom
} from '../pointer-down.js';
import {
  scheduleXmindAutoSync
} from '../xmind-sync.js';
import {
  renderLayerMenu
} from '../layers.js';
import {
  refreshOrganizationUi
} from '../navigator-controller.js';

function configureDocumentInteractions() {
  configureCanvasSession({updateRedoButton,
updateUndoButton,
isGuestMode,
destroyAllAmapFrames,
applyBackground,
cancelWheelZoomAnimation,
centerOnOrigin,
closeCanvasMenu,
renderCanvasCatalog,
updateCurrentCanvasLabel,
restorePendingCut,
connect,
renderBoardLock,
setConnection,
finishEditing,
cancelActiveGesture,
openAdaptiveDialog,
setEffectBusy,
destroyAllKdocsInstances,
renderCursors,
renderGuides,
updatePresence,
renderAll,
markDirty,
updateSaveText,
closeSheetEditor,
cacheBoardSnapshot,
flushBoardCache,
restoreCachedSnapshot,
enqueueOperation,
scheduleAutoSave,
setMindmapPlacementLoading});
  
  configureClipboard({
    pushUndoSnapshot,
    updateRedoButton,
    updateUndoButton,
    isGuestMode,
    getBoardPointFromClient,
    buildExportPngBlob,
    downloadBlob,
    detachConnectorsFor,
    removeItemElement,
    renderItem,
    markDirty,
    updateSelectionUI,
    cacheBoardSnapshot,
    indexRemoveItem,
    indexUpsertItem,
    enqueueOperation,
    updateCanvasStartState,
    refreshConnectorsFor
  });
  configureItems({
    pushUndoSnapshot,
    isGuestMode,
    focusNavigatorTarget,
    getViewportDropPoint,
    ensureReadableToolZoom,
    removeItemElement,
    renderItem,
    markDirty,
    selectItem,
    updateSelectionUI,
    indexRemoveItem,
    indexUpsertItem,
    enqueueOperation,
    restoreNavigationTool,
    scheduleXmindAutoSync
  });
  configureHistoryController({
    renderLayerMenu,
    applyBackground,
    indexUpsertItem,
    renderAll,
    renderItem,
    refreshConnectorsFor,
    refreshOrganizationUi,
    markDirty,
    selectItem,
    enqueueOperation
  });
  
}

export { configureDocumentInteractions };
