import {
  configureSections
} from '../sections.js';
import {
  pushUndoPatch,
  pushUndoSnapshot
} from '../history-controller.js';
import {
  getBoardPoint
} from '../camera.js';
import {
  isTemporaryPanGestureEvent
} from '../editing.js';
import {
  buildExportPngBlob,
  downloadBlob
} from '../export.js';
import {
  deleteOrganizationEntry,
  renameOrganizationEntry,
  setContainerFlags
} from '../groups.js';
import {
  detachConnectorsFor
} from '../items.js';
import {
  restoreIdleCursorState,
  setActiveCursorState
} from '../marquee.js';
import {
  refreshOrganizationUi
} from '../navigator-controller.js';
import {
  captureViewportPointer,
  stopEdgePan
} from '../pan.js';
import {
  clearGuides,
  renderGuides
} from '../presence.js';
import {
  renderAll
} from '../rendering.js';
import {
  markDirty
} from '../save-status.js';
import {
  buildContextMenu
} from '../selection.js';
import {
  indexRemoveItem
} from '../spatial-index.js';
import {
  enqueueOperation
} from '../sync-queue.js';
import {
  restoreNavigationTool
} from '../toolbar.js';
import {
  refreshConnectorsFor,
  snapSectionMoveDelta,
  updateItemElementGeometry
} from '../transform.js';
import {
  configureConnectorControls
} from '../connector/controls.js';
import {
  cancel,
  start,
  configureConnectorDraft
} from '../connector/draft.js';
import {
  beginEdit,
  change,
  readPreferences
} from '../connector/editing.js';
import {
  drawJumps
} from '../connector/rendering.js';
import {
  observe,
  showConflictDrafts
} from '../connector/sync.js';
import {
  buildCreationToolbar,
  buildToolbar
} from '../connector/toolbar.js';
import {
  configureImpactCamera
} from '../impact-camera.js';
import {
  syncTrigger,
  finish
} from '../connector-impact.js';
import {
  renderPanel,
  configureImpactPanel
} from '../impact-panel.js';
import {
  showCreate
} from '../connector/creation.js';

function configureConnectorsInteractions() {
  configureSections({
    pushUndoPatch,
    pushUndoSnapshot,
    getBoardPoint,
    isTemporaryPanGestureEvent,
    buildExportPngBlob,
    downloadBlob,
    deleteOrganizationEntry,
    renameOrganizationEntry,
    setContainerFlags,
    detachConnectorsFor,
    restoreIdleCursorState,
    setActiveCursorState,
    refreshOrganizationUi,
    captureViewportPointer,
    stopEdgePan,
    clearGuides,
    renderGuides,
    renderAll,
    markDirty,
    buildContextMenu,
    indexRemoveItem,
    enqueueOperation,
    restoreNavigationTool,
    refreshConnectorsFor,
    snapSectionMoveDelta,
    updateItemElementGeometry
  });
  configureConnectorControls({
    cancel,
    start,
    beginEdit,
    change,
    readPreferences,
    drawJumps,
    observe,
    showConflictDrafts,
    buildCreationToolbar,
    buildToolbar
  });
  configureImpactCamera({
    syncTrigger,
    renderPanel
  });
  configureConnectorDraft({
    showCreate,
    change,
    readPreferences
  });
  configureImpactPanel({
    finish
  });
}

export { configureConnectorsInteractions };
