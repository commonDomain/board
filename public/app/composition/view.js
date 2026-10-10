import {
  configureToolbar,
  updateCanvasStartState,
  activateStarterTool,
  restoreNavigationTool
} from '../toolbar.js';
import {
  redoLastChange,
  undoLastChange,
  pushUndoSnapshot
} from '../history-controller.js';
import {
  isGuestMode
} from '../account-lifecycle.js';
import {
  setBackgroundDrift,
  applyGridWallpaperDrift
} from '../background.js';
import {
  closeFloatingSelectPickers,
  setFloatingMoreOpen,
  scheduleFloatingToolbarPosition,
  updateFloatingFormatBar
} from '../floating-toolbar-menu.js';
import {
  focusNavigatorTarget,
  focusBoundsInViewport
} from '../focus.js';
import {
  setShape
} from '../format-actions.js';
import {
  updateContextPanel
} from '../format-panel.js';
import {
  cancelActiveGesture
} from '../gestures.js';
import {
  addStickerItem
} from '../items.js';
import {
  openKdocsInsertDialog,
  configureKdocs
} from '../kdocs.js';
import {
  renderLayerMenu,
  ensureLayerContainers,
  getLayerContainer
} from '../layers.js';
import {
  restoreIdleCursorState,
  attachSelectionFrame,
  renderNoteMoveHandle,
  updateSelectionHandleCursors
} from '../marquee.js';

import {
  invalidateInteractionViewportBounds
} from '../pan.js';
import {
  closePopovers,
  handleGlobalPointerDown,
  togglePopover
} from '../popovers.js';
import {
  saveBoard,
  markDirty
} from '../save-status.js';
import {
  selectItem,
  updateMultiSelectionFrame,
  updateSelectionUI,
  buildContextMenu
} from '../selection.js';
import {
  addSheetItem,
  destroySheetPreview,
  destroySheetRecord
} from '../sheet-store.js';
import {
  configureRendering,
  renderAll,
  refreshVisibleItems
} from '../rendering.js';
import {
  destroyAmapFrame,
  renderAmapMap,
  renderAmapRoute,
  renderAmapSearch,
  syncAmapFrame
} from '../amap-rendering.js';
import {
  getBoardPointFromClient,
  configureCamera
} from '../camera.js';
import {
  renderMindMap
} from '../mindmap-rendering.js';
import {
  refreshOrganizationUi
} from '../navigator-controller.js';
import {
  mountSheetPreview,
  refreshSheetPreviews
} from '../sheet-preview.js';
import {
  rebuildSpatialIndex
} from '../spatial-index.js';
import {
  renderTable
} from '../table-rendering.js';
import {
  renderTextCard
} from '../text-rendering.js';
import {
  updateItemElementGeometry
} from '../transform.js';
import {
  configureNavigatorRendering
} from '../navigator-rendering.js';
import {
  resolveVerticalDropIntent
} from '../catalog-drag.js';
import {
  deleteOrganizationEntry,
  renameOrganizationEntry,
  setContainerFlags,
  configureGroups
} from '../groups.js';
import {
  clearNavigatorDropIndicators,
  previewNavigatorDrop,
  reorderNavigatorEntry
} from '../navigator-drag.js';
import {
  buildNavigatorRows,
  createNavigatorTypeIcon,
  itemNavigatorLabel,
  itemNavigatorTypeLabel
} from '../navigator-data.js';
import {
  locateTarget,
  positionSearchLocator
} from '../search-locator.js';
import {
  enqueueOperation
} from '../sync-queue.js';
import {
  hideSectionHoverLabel
} from '../pointer-move.js';
import {
  renderCursors,
  renderGuides
} from '../presence.js';
import {
  openAdaptiveDialog
} from '../interface.js';
import {
  configureSearch
} from '../search.js';

function configureViewInteractions() {
  configureToolbar({redoLastChange,
undoLastChange,
isGuestMode,
setBackgroundDrift,
closeFloatingSelectPickers,
setFloatingMoreOpen,
focusNavigatorTarget,
setShape,
updateContextPanel,
cancelActiveGesture,
addStickerItem,
openKdocsInsertDialog,
renderLayerMenu,
restoreIdleCursorState,
invalidateInteractionViewportBounds,
closePopovers,
handleGlobalPointerDown,
togglePopover,
saveBoard,
selectItem,
addSheetItem});
  configureRendering({
    destroyAmapFrame,
    renderAmapMap,
    renderAmapRoute,
    renderAmapSearch,
    syncAmapFrame,
    getBoardPointFromClient,
    scheduleFloatingToolbarPosition,
    updateFloatingFormatBar,
    cancelActiveGesture,
    ensureLayerContainers,
    getLayerContainer,
    attachSelectionFrame,
    renderNoteMoveHandle,
    renderMindMap,
    refreshOrganizationUi,
    selectItem,
    updateMultiSelectionFrame,
    updateSelectionUI,
    mountSheetPreview,
    destroySheetPreview,
    destroySheetRecord,
    rebuildSpatialIndex,
    renderTable,
    renderTextCard,
    updateCanvasStartState,
    updateItemElementGeometry
  });
  configureNavigatorRendering({
    pushUndoSnapshot,
    resolveVerticalDropIntent,
    focusNavigatorTarget,
    deleteOrganizationEntry,
    renameOrganizationEntry,
    setContainerFlags,
    clearNavigatorDropIndicators,
    previewNavigatorDrop,
    reorderNavigatorEntry,
    buildNavigatorRows,
    createNavigatorTypeIcon,
    renderAll,
    markDirty,
    locateTarget,
    buildContextMenu,
    updateSelectionUI,
    enqueueOperation,
    activateStarterTool
  });
  configureCamera({
    applyGridWallpaperDrift,
    scheduleFloatingToolbarPosition,
    focusBoundsInViewport,
    updateSelectionHandleCursors,
    hideSectionHoverLabel,
    renderCursors,
    renderGuides,
    refreshVisibleItems,
    positionSearchLocator,
    refreshSheetPreviews
  });
  configureKdocs({
    openAdaptiveDialog,
    restoreNavigationTool
  });
  configureGroups({
    itemNavigatorLabel,
    refreshOrganizationUi
  });
  configureSearch({
    itemNavigatorTypeLabel
  });
}

export { configureViewInteractions };
