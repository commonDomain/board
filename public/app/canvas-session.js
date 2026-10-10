

import { cancelConnectorDraft } from './drawing-model.js';

import { els } from './elements.js';

import { showToast } from './interface-model.js';

import { canMutateItem } from './layers-model.js';
import { getMindNodeAtPath } from './mindmap-editing-model.js';
import { fitMindMapItem } from './mindmap-model.js';

import { defaultLayers, wallpaperDriftDefault } from './preferences.js';

import { eventsRuntime } from './runtime/events.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';

import { destroyAllSheetRecords, flushAllSheetSaves, sheetDraftWrites } from './sheet-store.js';

import { state } from './state.js';
import { clearSyncRetry } from './sync-queue-model.js';

import { cssEscape } from './utilities.js';

import { serializePendingOperations, flushPendingOpsStorage } from './canvas-session-model.js';

let updateRedoButton, updateUndoButton, isGuestMode, destroyAllAmapFrames, applyBackground, cancelWheelZoomAnimation, centerOnOrigin, closeCanvasMenu, renderCanvasCatalog, updateCurrentCanvasLabel, restorePendingCut, connect, renderBoardLock, setConnection, finishEditing, cancelActiveGesture, openAdaptiveDialog, setEffectBusy, destroyAllKdocsInstances, renderCursors, renderGuides, updatePresence, renderAll, markDirty, updateSaveText, closeSheetEditor, cacheBoardSnapshot, flushBoardCache, restoreCachedSnapshot, enqueueOperation, scheduleAutoSave, setMindmapPlacementLoading;

function configureCanvasSession(callbacks) {
  ({updateRedoButton,
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
setMindmapPlacementLoading} = callbacks);
}

function schedulePersistPendingOps() {
  clearTimeout(state.pendingOpsTimer);
  try {
    window.WhiteboardStorage?.flushOutboxFallback(state.boardId, serializePendingOperations());
  } catch (error) {
    console.warn('Could not journal pending operations', error);
  }
  state.pendingOpsTimer = setTimeout(persistPendingOps, 0);
}

async function persistPendingOps() {
  clearTimeout(state.pendingOpsTimer);
  try {
    const messages = serializePendingOperations();
    const saved = await window.WhiteboardStorage?.saveOutbox(state.boardId, messages);
    if (state.syncQueue.length && saved === false) {
      showToast('本地离线队列空间不足，请保持页面开启直到同步完成');
    }
  } catch (error) {
    console.warn('Could not persist pending operations', error);
  }
  updateSaveText();
}

function handlePageHide() {
  if (state.pendingCut) restorePendingCut();
  eventsRuntime.editableInputHandler?.flush?.();
  commitMindMapEditForPageHide();
  commitMindMapNoteForPageHide();
  flushPendingOpsStorage();
  flushBoardCache();
}

function commitMindMapNoteForPageHide() {
  const editor = document.querySelector('.mind-note-editor');
  const nodeElement = editor?.closest('[data-mn-path]');
  const itemElement = editor?.closest('.board-item[data-item-id]');
  const item = itemElement && state.items.get(itemElement.dataset.itemId);
  const path = nodeElement?.dataset.mnPath === '' ? [] : nodeElement?.dataset.mnPath?.split('.').map(Number);
  const node = item && Array.isArray(path) ? getMindNodeAtPath(item.tree, path) : null;
  if (!editor || !item || !node || !canMutateItem(item)) {
    return;
  }
  const value = editor.value.trim().slice(0, 4000);
  if (value === (node.note || '')) {
    return;
  }
  if (value) node.note = value;
  else delete node.note;
  state.items.set(item.id, item);
  enqueueOperation(window.ConnectorUI ? window.ConnectorUI.prepareBroadcast(item) : { kind: 'upsert', item });
  markDirty(true);
}

function commitMindMapEditForPageHide() {
  const editing = state.mindmapEditing;
  if (!editing) {
    return;
  }
  const item = state.items.get(editing.itemId);
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(editing.itemId)}"]`);
  const nodeElement = root?.querySelector(`[data-mn-path="${cssEscape(editing.path.join('.'))}"] .mind-node-text`);
  const node = item && getMindNodeAtPath(item.tree, editing.path);
  if (!item || !node || !nodeElement || !canMutateItem(item)) {
    return;
  }
  const value = nodeElement.textContent.replace(/\u00a0/g, ' ').trim() || '未命名';
  if (node.text === value) {
    return;
  }
  node.text = value;
  fitMindMapItem(item);
  state.items.set(item.id, item);
  enqueueOperation({ kind: 'upsert', item });
  markDirty(true);
}

async function restorePendingOps() {
  const epoch = state.canvasEpoch;
  const generation = window.WhiteboardStorage?.getGeneration();
  if (isGuestMode()) {
    state.syncQueue = new window.WhiteboardSyncQueue();
    return;
  }
  try {
    const entries = (await window.WhiteboardStorage?.loadOutbox(state.boardId)) || [];
    if (epoch !== state.canvasEpoch || generation !== window.WhiteboardStorage?.getGeneration()) return;
    state.syncQueue.restore({ version: window.WhiteboardSyncQueue.VERSION, entries });
    if (state.syncQueue.blockedReason === 'Background type is unsupported.') {
      state.syncQueue.resume();
      schedulePersistPendingOps();
    }
    if (state.syncQueue.length) {
      state.dirty = true;
      scheduleAutoSave();
    }
    updateSaveText();
  } catch (error) {
    console.warn('Could not restore pending operations', error);
  }
}

async function persistCurrentCanvasForSwitch() {
  if (!state.boardId) return true;
  if (state.pendingCut) restorePendingCut();
  if (sheetStoreRuntime.sheetEditor?.isOpen?.() && sheetStoreRuntime.sheetEditor.commitPending?.() === false) {
    showToast('请先修正工作表中尚未保存的公式');
    return false;
  }
  if (state.boardId) flushAllSheetSaves();
  const sheetDrafts = Array.from(sheetDraftWrites.values()).filter((draft) => draft.boardId === state.boardId);
  await Promise.all(sheetDrafts.map((draft) => draft.promise).filter(Boolean));
  if (sheetDrafts.some((draft) => draft.status === 'blocked')) {
    showToast('工作表本地恢复副本保存失败，暂时无法切换画布');
    return false;
  }
  eventsRuntime.editableInputHandler?.flush?.();
  finishEditing();
  commitMindMapEditForPageHide();
  commitMindMapNoteForPageHide();
  cancelActiveGesture();
  cancelConnectorDraft();
  if (isGuestMode()) {
    return (await cacheBoardSnapshot({ requireLatest: true })) === true;
  }
  const pending = serializePendingOperations();
  if (pending.length) {
    let outboxSaved = false;
    try {
      window.WhiteboardStorage?.flushOutboxFallback(state.boardId, pending);
      outboxSaved = (await window.WhiteboardStorage?.saveOutbox(state.boardId, pending)) !== false;
    } catch (error) {
      console.warn('Could not persist canvas outbox before switching', error);
    }
    if (!outboxSaved) {
      showToast('离线修改未能保存，暂时无法切换画布');
      return false;
    }
  }
  // A revision-matched cache is already durable. Avoid cloning and writing the
  // entire document again on every switch; pending changes still force a
  // fresh snapshot through scheduleBoardCache().
  if (state.cachePending || state.cachedSnapshotRevision !== state.revision) {
    if ((await cacheBoardSnapshot({ requireLatest: true })) !== true) {
      showToast('本地画布副本保存失败，暂时无法切换画布');
      return false;
    }
  }
  return true;
}

async function restoreLocalBoardStateAndConnect() {
  const restoration = Promise.all([restorePendingOps(), restoreCachedSnapshot()]);
  // Open the socket while IndexedDB is being read, but do not send the join
  // revision until the local cache and outbox are ready.
  connect(restoration);
  await restoration;
}

function resetCanvasRuntime() {
  state.preparingCut = false;
  if (state.pendingCut) {
    state.pendingCut = null;
    state.clipboard = [];
  }
  
  state.canvasEpoch = (state.canvasEpoch || 0) + 1;
  cancelWheelZoomAnimation();
  state.compatibilityReadOnly = false;
  state.backgroundDrift = wallpaperDriftDefault();
  state.connectorLineJumps = false;
  cancelActiveGesture();
  cancelConnectorDraft();
  clearTimeout(state.cacheTimer);
  clearTimeout(state.autoSaveTimer);
  clearTimeout(state.mindNodePanelTimer);
  clearTimeout(state.saveResponseTimer);
  clearTimeout(state.operationAckTimer);
  clearTimeout(state.resyncResponseTimer);
  clearTimeout(state.xmindAutoSyncTimer);
  clearTimeout(state.xmindRemoteCheckTimer);
  setMindmapPlacementLoading(false);
  clearTimeout(state.boardLockTimer);
  clearTimeout(state.boardEditHeartbeatTimer);
  clearTimeout(state.pendingOpsTimer);
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.previewRefreshTimer);
  state.previewRefreshTimer = null;
  clearSyncRetry();
  state.items = new Map();
  state.connectorIndex = new Map();
  state.connectorEndpoints = new Map();
  state.loadTier = 'small';
  state.inkPointCount = 0;
  state.renderComplexity = 0;
  state.renderComplexityByItem = new Map();
  state.inkPointCountByItem = new Map();
  state.gestureFrameDurations = [];
  state.gestureFrameP95 = 0;
  state.sections = new Map();
  state.groups = new Map();

  state.selectedId = null;
  state.selectedIds = new Set();
  state.middleClick = null;
  state.middleFocusToggle = null;
  state.sectionDraft = null;
  state.sectionInteraction = null;
  state.navigatorExpanded = new Set();
  state.layers = defaultLayers();
  state.activeLayerId = 'layer_default';
  state.background = 'blank';
  state.revision = 0;
  state.durableRevision = 0;
  state.saveQueued = false;
  state.saveInFlight = false;
  state.saveRequestId = null;
  state.localChangeSerial = 0;
  state.saveChangeSerial = 0;
  state.saveResponseTimer = null;
  state.operationAckTimer = null;
  state.resyncResponseTimer = null;
  state.xmindAutoSyncTimer = null;
  state.xmindAutoSyncInFlight.clear();
  state.xmindAutoSyncFailures.clear();
  state.xmindRemoteCheckTimer = null;
  state.xmindRemoteCheckForceRequested = false;
  state.xmindRemoteCheckInFlight = false;
  state.xmindRemoteCheckToken += 1;
  state.boardLockTimer = null;
  state.boardEditLease = null;
  state.boardUnlockRevision = null;
  state.boardUnlockLease = null;
  state.boardEditHeartbeatTimer = null;
  state.boardEditIdleUntil = 0;
  state.waitingForBoardUnlock = false;
  state.socketClientId = null;
  state.lastEditActivityAt = 0;
  state.localBoardEditGesture = false;
  renderBoardLock();
  state.autoSaveTimer = null;
  state.mindNodePanelTimer = null;
  state.previewAfterSave = false;
  state.previewGeneration += 1;
  state.resyncing = false;
  state.snapshotTransfer = null;
  state.connected = false;
  state.joined = false;
  state.cachedSnapshotLoaded = false;
  state.cachePending = false;
  state.cacheGeneration = 0;
  state.cacheRetryAttempt = 0;
  state.cacheFailureNotifiedAt = 0;
  state.cachedSnapshotRevision = null;
  state.reconnectAttempt = 0;
  state.syncRetryAttempt = 0;
  state.syncQueue = new window.WhiteboardSyncQueue();
  
  state.recentCommittedOpIds = new Set();
  state.renderErrorIds.clear();
  state.zCounter = 1;
  state.dirty = false;
  state.undoStack = [];
  state.redoStack = [];
  state.undoBytes = 0;
  state.redoBytes = 0;
  state.cursors = new Map();
  state.presenceUsers = new Map();
  state.lastCursorSent = null;
  state.fitted = false;
  state.rotation = 0;
  state.zoom = 1;
  state.camera = { x: 0, y: 0 };
  state.dropSequence = 0;
  state.guides = { v: null, h: null };
  state.mindmapSelection = null;
  state.mindmapEditing = null;
  state.editingId = null;
  state.editSnapshot = null;
  state.editingCreatedId = null;
  state.editingUndoDepth = null;
  state.editingHistoryInput = null;
  state.draftEditableId = null;
  state.textSelection = null;
  state.tableDraft = null;
  state.skipPointerId = null;
  state.pointerPositions.clear();
  state.spatialIndex.clear();
  state.spatialIndexEnabled = false;
  state.viewportVirtualizationEnabled = false;
  destroyAllKdocsInstances();
  destroyAllAmapFrames();
  // Pending spreadsheet edits are flushed before their stores are dropped, so a
  // canvas switch cannot discard a debounced save.
  flushAllSheetSaves();
  closeSheetEditor();
  destroyAllSheetRecords();
  applyBackground();
  renderAll();
  renderCursors();
  renderGuides();
  updatePresence(0, 5, []);
  updateUndoButton();
  updateRedoButton();
  updateSaveText();
  centerOnOrigin();
}

async function switchCanvas(boardId) {
  if (state.switchingCanvas || !state.canvases.some((canvas) => canvas.id === boardId)) return;
  if (boardId === state.boardId) {
    closeCanvasMenu();
    return;
  }
  if (state.pendingCut) {
    closeCanvasMenu({ restoreFocus: false });
    const restore = await openAdaptiveDialog({
      title: '还有未粘贴的剪切内容',
      message: '请先在当前画布粘贴，或还原剪切的元素后再切换画布。',
      confirmLabel: '还原',
      cancelLabel: '关闭'
    });
    if (restore) restorePendingCut();
    return;
  }
  state.switchingCanvas = true;
  document.documentElement.classList.add('canvas-switching');
  els.canvasSwitcherButton.classList.add('is-beam-active');
  setEffectBusy(els.canvasSwitcherButton, true);
  closeCanvasMenu({ restoreFocus: false });
  const previousBoardId = state.boardId;
  try {
    if (!(await persistCurrentCanvasForSwitch())) return;
    const previousSocket = state.socket;
    state.socket = null;
    previousSocket?.close(1000, 'Switching canvas');
    state.boardId = boardId;
    resetCanvasRuntime();
    updateCurrentCanvasLabel();
    renderCanvasCatalog();
    setConnection('connecting');
    await restoreLocalBoardStateAndConnect();
  } catch (error) {
    console.error('Could not switch canvas', error);
    showToast('画布切换失败，请重试');
    if (state.boardId !== previousBoardId) {
      state.boardId = previousBoardId;
      resetCanvasRuntime();
      updateCurrentCanvasLabel();
      await restoreLocalBoardStateAndConnect();
    }
  } finally {
    state.switchingCanvas = false;
    window.MusePlanning?.notify();
    document.documentElement.classList.remove('canvas-switching');
    els.canvasSwitcherButton.classList.remove('is-beam-active');
    setEffectBusy(els.canvasSwitcherButton, false);
  }
}
export {
  schedulePersistPendingOps,
  persistPendingOps,
  handlePageHide,
  commitMindMapNoteForPageHide,
  commitMindMapEditForPageHide,
  restorePendingOps,
  persistCurrentCanvasForSwitch,
  restoreLocalBoardStateAndConnect,
  resetCanvasRuntime,
  switchCanvas
};

export { configureCanvasSession };
