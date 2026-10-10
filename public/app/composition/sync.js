import {
  configureConnection,
  resolveBoardUnlockRevision,
  sendBoardEditActivity,
  setConnection,
  connect,
  suspendBoardEditLeaseOnDisconnect
} from '../connection.js';
import {
  isGuestMode,
  configureAccountLifecycle
} from '../account-lifecycle.js';
import {
  fitZoom,
  getContentBounds
} from '../camera.js';
import {
  persistPendingOps,
  resetCanvasRuntime,
  restoreLocalBoardStateAndConnect,
  schedulePersistPendingOps,
  persistCurrentCanvasForSwitch,
  switchCanvas,
  commitMindMapEditForPageHide,
  commitMindMapNoteForPageHide
} from '../canvas-session.js';
import {
  reapplyPendingOperations
} from '../pending-replay.js';
import {
  updatePresence
} from '../presence.js';
import {
  scheduleCurrentCanvasPreviewRefresh,
  updateSaveText,
  updateSavedLabel,
  configureSaveStatus
} from '../save-status.js';
import {
  armSheetCommandTimeout,
  clearSheetLocks
} from '../sheet-editor.js';
import {
  loadSnapshot,
  scheduleBoardCache,
  cacheBoardSnapshot
} from '../snapshot-cache.js';
import {
  handleSocketMessage
} from '../socket-messages.js';
import {
  pumpSyncQueue,
  recoverFromDeletedCanvas,
  configureSyncQueue,
  scheduleAutoSave
} from '../sync-queue.js';
import {
  scheduleXmindAutoSync,
  scheduleXmindRemoteCheck,
  detachLinkedXmindItem
} from '../xmind-sync.js';
import {
  scheduleHistoryCompaction,
  snapshotDocument,
  updateRedoButton,
  updateUndoButton
} from '../history-controller.js';
import {
  fetchCanvasCatalog,
  renderCanvasCatalog,
  updateCurrentCanvasLabel,
  configureCatalog,
  loadCanvasCatalog
} from '../catalog.js';

import {
  applyRemoteOperation
} from '../remote-operations.js';
import {
  syncCanvasPreviewIntent,
  onCanvasListFocusIn,
  onCanvasListFocusOut,
  onCanvasListPointerOut,
  onCanvasListPointerOver,
  resetCanvasPreviewIntent
} from '../catalog-preview.js';
import {
  buildExportPngBlob
} from '../export.js';
import {
  updateSaveEffect
} from '../interface.js';
import {
  startCanvasDrag
} from '../catalog-drag.js';
import {
  closePopovers
} from '../popovers.js';
import {
  updateCanvasStartState
} from '../toolbar.js';
import {
  refreshAmapCapabilities
} from '../amap-api.js';
import {
  configureXmindConnection
} from '../xmind-connection.js';
import {
  addMindMapItem
} from '../mindmap-import.js';

function configureSyncInteractions() {
  configureConnection({
    isGuestMode,
    fitZoom,
    persistPendingOps,
    reapplyPendingOperations,
    updatePresence,
    scheduleCurrentCanvasPreviewRefresh,
    updateSaveText,
    updateSavedLabel,
    armSheetCommandTimeout,
    clearSheetLocks,
    loadSnapshot,
    scheduleBoardCache,
    handleSocketMessage,
    pumpSyncQueue,
    recoverFromDeletedCanvas,
    scheduleXmindAutoSync,
    scheduleXmindRemoteCheck
  });
  configureSyncQueue({scheduleHistoryCompaction,
snapshotDocument,
updateRedoButton,
updateUndoButton,
isGuestMode,
resetCanvasRuntime,
restoreLocalBoardStateAndConnect,
schedulePersistPendingOps,
fetchCanvasCatalog,
renderCanvasCatalog,
updateCurrentCanvasLabel,
resolveBoardUnlockRevision,
sendBoardEditActivity,
setConnection,
reapplyPendingOperations,
applyRemoteOperation,
updateSaveText,
scheduleBoardCache,
scheduleXmindAutoSync});
  configureSaveStatus({
    isGuestMode,
    getContentBounds,
    schedulePersistPendingOps,
    renderCanvasCatalog,
    syncCanvasPreviewIntent,
    buildExportPngBlob,
    updateSaveEffect,
    cacheBoardSnapshot,
    scheduleBoardCache,
    pumpSyncQueue,
    scheduleAutoSave
  });
  configureCatalog({
    isGuestMode,
    persistCurrentCanvasForSwitch,
    resetCanvasRuntime,
    restoreLocalBoardStateAndConnect,
    switchCanvas,
    startCanvasDrag,
    onCanvasListFocusIn,
    onCanvasListFocusOut,
    onCanvasListPointerOut,
    onCanvasListPointerOver,
    resetCanvasPreviewIntent,
    connect,
    setConnection,
    closePopovers,
    updateCanvasStartState
  });
  configureAccountLifecycle({
    refreshAmapCapabilities,
    commitMindMapEditForPageHide,
    commitMindMapNoteForPageHide,
    persistCurrentCanvasForSwitch,
    persistPendingOps,
    resetCanvasRuntime,
    restoreLocalBoardStateAndConnect,
    schedulePersistPendingOps,
    loadCanvasCatalog,
    renderCanvasCatalog,
    connect,
    setConnection,
    suspendBoardEditLeaseOnDisconnect,
    clearSheetLocks,
    pumpSyncQueue
  });
  configureXmindConnection({
    addMindMapItem,
    detachLinkedXmindItem,
    scheduleXmindAutoSync,
    scheduleXmindRemoteCheck
  });
}

export { configureSyncInteractions };
