

import { cancelConnectorDraft } from './drawing-model.js';
import { clearBackgroundWork } from './background-work.js';
import { resetViewportPerformance } from './canvas-performance.js';

import { els } from './elements.js';

import { showToast } from './interface-model.js';

import { canMutateItem } from './layers-model.js';
import { getMindNodeAtPath } from './mindmap-editing-model.js';
import { fitMindMapItem } from './mindmap-model.js';

import { defaultLayers, wallpaperDriftDefault } from './preferences.js';

import { eventsRuntime } from './runtime/events.js';
import { sheetStoreRuntime } from './runtime/sheet-store.js';

import { destroyAllSheetRecords, flushAllSheetSaves, sheetDraftWrites, sheetInputDraftTimers, sheetInputDraftWrites, sheetRecoveredInputs } from './sheet-store.js';

import { state } from './state.js';
import { suspendElementEditActivities } from './element-edit-leases.js';
import { clearSyncRetry } from './sync-queue-model.js';
let reapplyPendingOperations;

import { cssEscape } from './utilities.js';

import { serializePendingOperations, flushPendingOpsStorage } from './canvas-session-model.js';

let updateRedoButton, updateUndoButton, isGuestMode, destroyAllAmapFrames, applyBackground, cancelWheelZoomAnimation, centerOnOrigin, closeCanvasMenu, renderCanvasCatalog, updateCurrentCanvasLabel, restorePendingCut, connect, renderBoardLock, setConnection, finishEditing, cancelActiveGesture, openAdaptiveDialog, setEffectBusy, destroyAllKdocsInstances, renderCursors, renderGuides, updatePresence, renderAll, markDirty, updateSaveText, closeSheetEditor, cacheBoardSnapshot, flushBoardCache, restoreCachedSnapshot, enqueueOperation, scheduleAutoSave, setMindmapPlacementLoading;

function configureCanvasSession(callbacks) {
  eventsRuntime.captureDraftInputs = captureDraftInputs;
  reapplyPendingOperations = callbacks.reapplyPendingOperations;
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
  if (state.draftRestoreFailed || state.draftRestoring || state.draftDiscardPending) return;
  clearTimeout(state.pendingOpsTimer);
  state.draftStorageSerial = (state.draftStorageSerial || 0) + 1;
  state.draftStoragePending = true;
  try {
    if (window.WhiteboardStorage?.flushOutboxFallback(state.boardId, serializePendingOperations()) === true) {
      state.draftStorageSafeSerial = state.draftStorageSerial;
      state.draftStoragePending = false;
      state.draftStorageFailed = false;
    }
  } catch (error) {
    console.warn('Could not journal pending operations', error);
  }
  state.pendingOpsTimer = setTimeout(persistPendingOps, 0);
}

async function persistPendingOps() {
  clearTimeout(state.pendingOpsTimer);
  if (state.draftRestoreFailed || state.draftRestoring || state.draftDiscardPending || !state.boardId) return false;
  if (isGuestMode()) return cacheBoardSnapshot({ requireLatest: true });
  const boardId = state.boardId, epoch = state.canvasEpoch;
  const serial = state.draftStorageSerial || 0;
  const generation = window.WhiteboardStorage?.getGeneration();
  let saved = false;
  try {
    const messages = serializePendingOperations();
    saved = await window.WhiteboardStorage?.saveOutbox(boardId, messages) === true;
  } catch (error) {
    console.warn('Could not persist pending operations', error);
  }
  if (state.draftDiscardPending || state.boardId !== boardId || state.canvasEpoch !== epoch ||
      generation !== window.WhiteboardStorage?.getGeneration() || serial !== (state.draftStorageSerial || 0)) return saved;
  const durable = saved || (serial > 0 && state.draftStorageSafeSerial >= serial);
  const failed = !durable && state.syncQueue.length > 0;
  if (failed && !state.draftStorageFailed) {
    eventsRuntime.editableInputHandler?.flush?.();
    if (serial !== (state.draftStorageSerial || 0)) return false;
  }
  if (failed && !state.draftStorageFailed) showToast('本地草稿保存失败，已暂停新增编辑；正在自动重试，请保留此页面');
  state.draftStorageFailed = failed;
  state.draftStoragePending = false;
  if (durable) state.draftStorageSafeSerial = serial;
  clearTimeout(state.draftStorageRetryTimer);
  state.draftStorageRetryTimer = null;
  if (failed) state.draftStorageRetryTimer = setTimeout(() => {
    if (state.boardId === boardId && state.canvasEpoch === epoch) void persistPendingOps();
  }, 5000);
  renderBoardLock();
  updateSaveText();
  return durable;
}

function handlePageHide() {
  if (state.draftDiscardPending) return;
  if (state.pendingCut) restorePendingCut();
  captureDraftInputs();
  flushPendingOpsStorage();
  flushBoardCache();
  suspendElementEditActivities();
}

function captureDraftInputs() {
  if (state.draftDiscardPending) return;
  eventsRuntime.editableInputHandler?.flush?.();
  commitMindMapEditForPageHide();
  commitMindMapNoteForPageHide();
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
  if (!editing.beforeItems) editing.beforeItems = structuredClone([...state.items.values()]);
  editing.changed = true;
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
    if (!window.WhiteboardStorage?.loadOutbox) throw new Error('Local draft storage is unavailable');
    const entries = await window.WhiteboardStorage.loadOutbox(state.boardId);
    if (epoch !== state.canvasEpoch || generation !== window.WhiteboardStorage?.getGeneration()) return;
    state.syncQueue.restore({ version: window.WhiteboardSyncQueue.VERSION, entries });
    if (state.syncQueue.restoreIssueCount) throw new Error('Some local draft operations could not be decoded; original storage retained');
    // Retry old permission failures once after the notebook asset policy fix.
    // Any remaining failure receives a specific new message and stays blocked.
    if (['Background type is unsupported.', 'This image is not available to the current account.'].includes(state.syncQueue.blockedReason)) {
      state.syncQueue.resume();
      schedulePersistPendingOps();
    }
    if (state.syncQueue.length) {
      state.draftStorageSerial = (state.draftStorageSerial || 0) + 1;
      state.draftStorageFailed = window.WhiteboardStorage?.hasUnsafeOutbox?.(state.boardId) === true;
      if (!state.draftStorageFailed) state.draftStorageSafeSerial = state.draftStorageSerial;
      state.dirty = true;
      scheduleAutoSave();
    }
    updateSaveText();
  } catch (error) {
    console.warn('Could not restore pending operations', error);
    if (epoch === state.canvasEpoch && generation === window.WhiteboardStorage?.getGeneration()) state.draftRestoreFailed = true;
    throw error;
  }
}

async function persistCurrentCanvasForSwitch({ signal, purpose = 'switch' } = {}) {
  const unavailable = (switchMessage, reloadMessage) => {
    if (purpose === 'reload') throw Object.assign(new Error(reloadMessage), { userFacing: true });
    showToast(switchMessage);
    return false;
  };
  const boardId = state.boardId, epoch = state.canvasEpoch;
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (signal && (state.boardId !== boardId || state.canvasEpoch !== epoch)) throw new Error('画布已切换，请确认当前内容后重试刷新。');
  };
  assertCurrent();
  if (state.draftRestoreFailed || state.draftRestoring || state.draftDiscardPending) {
    return unavailable('正在恢复本地草稿，请稍后再切换画布', state.draftRestoring ? '正在恢复本地草稿，请恢复完成后重试刷新。' : '本地草稿尚未恢复，请先处理草稿恢复问题再刷新。');
  }
  if (!state.boardId) return true;
  if (state.pendingCut) restorePendingCut();
  if (sheetStoreRuntime.sheetEditor?.isOpen?.() && sheetStoreRuntime.sheetEditor.commitPending?.() === false) {
    return unavailable('请先修正工作表中尚未保存的公式', '工作表公式尚未通过校验，请修正公式后重试刷新。');
  }
  if (state.boardId) flushAllSheetSaves();
  const sheetDrafts = Array.from(sheetDraftWrites.values()).filter((draft) => draft.boardId === state.boardId);
  await Promise.all(sheetDrafts.map((draft) => draft.promise).filter(Boolean));
  assertCurrent();
  if (sheetDrafts.some((draft) => draft.status === 'blocked' || draft.inputFailed)) {
    return unavailable('工作表本地恢复副本保存失败，暂时无法切换画布', '工作表草稿未能保存在本机，请检查浏览器存储空间后重试刷新。');
  }
  eventsRuntime.editableInputHandler?.flush?.();
  finishEditing();
  commitMindMapEditForPageHide();
  commitMindMapNoteForPageHide();
  cancelActiveGesture();
  cancelConnectorDraft();
  const pendingSerial = state.draftStorageSerial;
  if (isGuestMode()) {
    const saved = await cacheBoardSnapshot({ requireLatest: true });
    assertCurrent();
    return saved === true || unavailable('画布本地副本保存失败，暂时无法切换画布', '画布未能保存在本机，请检查浏览器存储空间后重试刷新。');
  }
  const pending = serializePendingOperations();
  if (pending.length) {
    let outboxSaved = false;
    try {
      window.WhiteboardStorage?.flushOutboxFallback(state.boardId, pending);
      outboxSaved = (await window.WhiteboardStorage?.saveOutbox(state.boardId, pending)) === true;
    } catch (error) {
      console.warn('Could not persist canvas outbox before switching', error);
    }
    assertCurrent();
    if (!outboxSaved) {
      return unavailable('离线修改未能保存，暂时无法切换画布', '待同步修改未能保存在本机，请检查浏览器存储空间后重试刷新。');
    }
  }
  // A revision-matched cache is already durable. Avoid cloning and writing the
  // entire document again on every switch; pending changes still force a
  // fresh snapshot through scheduleBoardCache().
  if (state.cachePending || state.cachedSnapshotRevision !== state.revision) {
    const saved = await cacheBoardSnapshot({ requireLatest: true });
    assertCurrent();
    if (saved !== true) {
      return unavailable('本地画布副本保存失败，暂时无法切换画布', '画布本地副本保存失败，请检查浏览器存储空间后重试刷新。');
    }
  }
  assertCurrent();
  if (pendingSerial !== state.draftStorageSerial) return persistCurrentCanvasForSwitch({ signal, purpose });
  return true;
}

async function prepareCanvasReload(options) {
  if (await persistCurrentCanvasForSwitch({ ...options, purpose: 'reload' }) !== true) return false;
  const boardId = state.boardId, epoch = state.canvasEpoch, serial = state.draftStorageSerial, generation = state.cacheGeneration;
  return () => state.boardId === boardId && state.canvasEpoch === epoch && state.draftStorageSerial === serial &&
    state.cacheGeneration === generation && !state.cachePending && !state.draftStorageFailed;
}

async function restoreLocalBoardStateAndConnect() {
  if (state.draftRestoring || state.draftDiscardPending) return;
  clearTimeout(state.draftRestoreRetryTimer);
  state.draftRestoreRetryTimer = null;
  const epoch = state.canvasEpoch;
  const boardId = state.boardId;
  state.draftRestoring = true;
  state.draftRestoreFailed = false;
  renderBoardLock();
  const restoration = Promise.all([restorePendingOps(), restoreCachedSnapshot()]).then(() => {
    if (state.canvasEpoch === epoch && state.boardId === boardId) {
      state.draftRestoring = false;
      reapplyPendingOperations();
      renderBoardLock();
      if (state.draftStorageFailed) void persistPendingOps();
    }
  });
  // Open the socket while IndexedDB is being read, but do not send the join
  // revision until the local cache and outbox are ready.
  connect(restoration);
  try { await restoration; }
  catch (error) {
    if (state.canvasEpoch !== epoch || state.boardId !== boardId) return;
    state.draftRestoring = false;
    state.draftRestoreFailed = true;
    renderBoardLock();
    clearTimeout(state.draftRestoreRetryTimer);
    state.draftRestoreRetryTimer = setTimeout(() => {
      if (state.canvasEpoch === epoch && state.boardId === boardId) void restoreLocalBoardStateAndConnect();
    }, 5000);
  }
}

async function discardLocalCanvasDraft() {
  const boardId = state.boardId, epoch = state.canvasEpoch, queue = state.syncQueue;
  const generation = window.WhiteboardStorage?.getGeneration?.();
  const current = () => state.boardId === boardId && state.canvasEpoch === epoch && state.syncQueue === queue &&
    generation === window.WhiteboardStorage?.getGeneration?.();
  const available = () => !isGuestMode() && boardId && !state.switchingCanvas && !state.draftRestoring &&
    !state.draftDiscardPending && !state.conflictRecoveryPending && !queue.inflightOpId && !state.saveInFlight &&
    !state.resyncing && !state.snapshotTransfer;
  if (!available()) { showToast('请等待当前画布操作完成后再丢弃草稿'); return false; }
  if (!state.connected || !state.joined || state.socket?.readyState !== WebSocket.OPEN) {
    showToast('请先连接到云端，再丢弃本地草稿'); return false;
  }
  const name = state.canvases.find(canvas => canvas.id === boardId)?.name || '当前画布';
  const confirmed = await openAdaptiveDialog({ title: '丢弃本地草稿？', danger: true, appearance: 'sync',
    message: `将丢弃“${name}”在此浏览器中尚未同步的修改，并重新载入云端版本。其他画布的草稿不受影响，此操作无法撤销。`,
    confirmLabel: '确认丢弃', cancelLabel: '保留草稿' });
  if (!confirmed || !current()) return false;
  if (!available() || !state.connected || !state.joined || state.socket?.readyState !== WebSocket.OPEN) {
    showToast('连接或画布状态已变化，草稿尚未丢弃，请稍后重试'); return false;
  }
  queue.pause();
  try {
    // Settle editor callbacks while transport is paused, before freezing writes.
    captureDraftInputs();
    finishEditing();
    closeSheetEditor();
    cancelActiveGesture();
    cancelConnectorDraft();
    flushAllSheetSaves();
    state.draftDiscardPending = true;
    renderBoardLock();
    const socket = state.socket;
    state.socket = null;
    state.connected = state.joined = false;
    socket.close(1000, 'Discarding local canvas draft');
    for (const timer of [state.pendingOpsTimer, state.cacheTimer, state.autoSaveTimer, state.reconnectTimer,
      state.draftStorageRetryTimer, state.draftRestoreRetryTimer, state.syncDispatchTimer]) clearTimeout(timer);
    state.syncDispatchTimer = null;
    clearSyncRetry();
    // Drain existing sheet writes, then remove their retry/input callbacks so
    // old editor work cannot recreate a discarded recovery draft.
    const drafts = [...sheetDraftWrites].filter(([, draft]) => draft.boardId === boardId);
    await Promise.allSettled([...drafts.map(([, draft]) => draft.promise), ...sheetInputDraftWrites.values()].filter(Boolean));
    if (!current()) return false;
    for (const [, draft] of drafts) clearTimeout(draft.retryTimer);
    for (const timer of sheetInputDraftTimers.values()) clearTimeout(timer);
    sheetInputDraftTimers.clear();
    if (await window.WhiteboardStorage?.discardBoardDraft?.(boardId) !== true)
      throw new Error('未能清除当前画布草稿，请重试');
    if (!current()) return false;
    for (const [key] of drafts) sheetDraftWrites.delete(key);
    sheetRecoveredInputs.clear();
    document.querySelector('.connection-conflicts')?.remove();
    resetCanvasRuntime();
    connect();
    showToast('已丢弃当前画布的本地草稿，正在载入云端版本');
    return true;
  } catch (error) {
    if (current()) showToast(error.message || '清理失败，当前草稿仍保留，请重试');
    return false;
  } finally {
    queue.unpause();
    if (current()) {
      state.draftDiscardPending = false;
      renderBoardLock();
      schedulePersistPendingOps();
      connect();
    }
  }
}

function resetCanvasRuntime() {
  clearBackgroundWork();
  eventsRuntime.resetCursorPresence?.();
  clearTimeout(state.draftStorageRetryTimer);
  clearTimeout(state.draftRestoreRetryTimer);
  Object.assign(state, { draftStorageSerial: 0, draftStorageSafeSerial: 0, draftStoragePending: false,
    draftStorageFailed: false, draftRestoreFailed: false, draftRestoring: false, draftDiscardPending: false,
    draftStorageRetryTimer: null, draftRestoreRetryTimer: null });
  state.preparingCut = false;
  if (state.pendingCut) {
    state.pendingCut = null;
    state.clipboard = [];
  }
  
  state.canvasEpoch = (state.canvasEpoch || 0) + 1;
  cancelWheelZoomAnimation();
  state.compatibilityReadOnly = false;
  state.accessReadOnly = false;
  state.backgroundDrift = wallpaperDriftDefault();
  state.connectorLineJumps = false;
  cancelActiveGesture();
  cancelConnectorDraft();
  clearTimeout(state.cacheTimer);
  clearTimeout(state.autoSaveTimer);
  clearTimeout(state.mindNodePanelTimer);
  clearTimeout(state.saveResponseTimer);
  clearTimeout(state.operationAckTimer);
  clearTimeout(state.syncDispatchTimer);
  state.syncDispatchTimer = null;
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
  resetViewportPerformance();
  state.inkPointCount = 0;
  state.inkItemCount = 0;
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
  state.boardEditLeases.clear();
  state.boardUnlockRevisions.clear();
  state.localEditActivities.clear();
  state.mutationBaselines.clear();
  state.elementEditSessions.clear();
  state.conflictRecoveryPending = false;
  state.boardEditHeartbeatTimer = null;
  state.waitingForBoardUnlock = false;
  state.socketClientId = null;
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
  if (state.draftDiscardPending || state.switchingCanvas || !state.canvases.some((canvas) => canvas.id === boardId)) return;
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
  prepareCanvasReload,
  restoreLocalBoardStateAndConnect,
  discardLocalCanvasDraft,
  resetCanvasRuntime,
  switchCanvas
};

export { configureCanvasSession };
