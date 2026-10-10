import { updateRedoButton, updateUndoButton } from './history-controller.js';

import { isGuestMode } from './account-lifecycle.js';
import { applyBackground } from './background.js';
import { getBackgroundPreset } from './background-model.js';
import { centerOnContent } from './camera.js';
import { DOCUMENT_VERSION } from './constants.js';
import { els } from './elements.js';
import { showToast } from './interface-model.js';
import { updateSaveEffect } from './interface.js';
import { normalizeClientGroup, normalizeClientSection } from './layers-model.js';
import { normalizeClientLayers } from './layer-visibility.js';

import { wallpaperDriftDefault } from './preferences.js';
import { updateSaveText } from './save-status.js';
import { renderAll } from './rendering.js';
import { state } from './state.js';
import { rememberXmindContent } from './xmind-connection-model.js';

let cacheWriteInFlight = null;

function scheduleBoardCache() {
  clearTimeout(state.cacheTimer);
  state.cachePending = true;
  state.cacheGeneration += 1;
  state.cacheTimer = setTimeout(() => {
    void cacheBoardSnapshot();
  }, 1500);
}

async function cacheBoardSnapshot(options = {}) {
  if (state.compatibilityReadOnly || !state.boardId) return false;
  clearTimeout(state.cacheTimer);
  state.cacheTimer = null;
  const boardId = state.boardId;
  const canvasEpoch = state.canvasEpoch;
  const cacheGeneration = state.cacheGeneration;
  const activeWrite = cacheWriteInFlight;
  if (activeWrite) {
    if (
      activeWrite.boardId === boardId &&
      activeWrite.canvasEpoch === canvasEpoch &&
      activeWrite.cacheGeneration === cacheGeneration
    ) {
      let saved = false;
      try {
        saved = await activeWrite.promise;
      } catch {}
      if (
        options.requireLatest &&
        state.boardId === boardId &&
        state.canvasEpoch === canvasEpoch &&
        state.cacheGeneration !== cacheGeneration
      )
        return cacheBoardSnapshot(options);
      return saved;
    }
    try {
      await activeWrite.promise;
    } catch {}
    if (state.boardId !== boardId || state.canvasEpoch !== canvasEpoch) return false;
    return cacheBoardSnapshot(options);
  }
  const promise = (async () => {
    const snapshot = {version: DOCUMENT_VERSION,
boardId,
revision: state.revision,
savedAt: null,
updatedAt: Date.now(),
items: Array.from(state.items.values()).concat(
        state.pendingCut?.boardId === boardId
          ? state.pendingCut.items
          : []
      ),
sections: Array.from(state.sections.values()),
groups: Array.from(state.groups.values()),
layers: state.layers,
settings: {
        background: getBackgroundPreset(),
        backgroundDrift: state.backgroundDrift,
        connectorLineJumps: state.connectorLineJumps
      }};
    const saved = isGuestMode()
      ? await window.WhiteboardStorage?.saveGuestCanvas(boardId, snapshot)
      : await window.WhiteboardStorage?.saveSnapshot(boardId, snapshot);
    if (
      saved !== false &&
      state.boardId === boardId &&
      state.canvasEpoch === canvasEpoch &&
      state.cacheGeneration === cacheGeneration
    ) {
      state.cachePending = false;
      state.cachedSnapshotRevision = snapshot.revision;
      if (isGuestMode() && !state.syncQueue.length && window.WhiteboardStorage?.guestStorageIsDurable?.() !== false) {
        state.dirty = false;
        els.saveText.textContent = '已保存到浏览器';
        updateSaveEffect();
      } else if (isGuestMode()) {
        updateSaveText();
      }
    }
    return saved !== false;
  })();
  cacheWriteInFlight = { boardId, canvasEpoch, cacheGeneration, promise };
  let saved = false;
  try {
    saved = await promise;
  } catch (error) {
    console.warn('Could not cache board snapshot', error);
  } finally {
    if (cacheWriteInFlight?.promise === promise) cacheWriteInFlight = null;
  }
  if (state.boardId === boardId && state.canvasEpoch === canvasEpoch) {
    if (options.requireLatest && state.cacheGeneration !== cacheGeneration) {
      return cacheBoardSnapshot(options);
    }
    if (saved) {
      state.cacheRetryAttempt = 0;
    } else if (state.cacheGeneration === cacheGeneration) {
      const now = Date.now();
      if (now - state.cacheFailureNotifiedAt > 30000) {
        state.cacheFailureNotifiedAt = now;
        showToast(isGuestMode() ? '浏览器存储空间不足，请先导出画布' : '本地画布副本保存失败，正在重试');
      }
      const retryDelay = Math.min(30000, 3000 * 2 ** state.cacheRetryAttempt);
      state.cacheRetryAttempt = Math.min(4, state.cacheRetryAttempt + 1);
      clearTimeout(state.cacheTimer);
      state.cacheTimer = setTimeout(() => {
        void cacheBoardSnapshot();
      }, retryDelay);
    }
  }
  return saved;
}

function flushBoardCache() {
  if (!state.boardId || (!state.cachePending && state.cachedSnapshotRevision === state.revision)) return;
  clearTimeout(state.cacheTimer);
  void cacheBoardSnapshot();
}

async function restoreCachedSnapshot() {
  const epoch = state.canvasEpoch;
  const generation = window.WhiteboardStorage?.getGeneration();
  try {
    const parsed = isGuestMode()
      ? await window.WhiteboardStorage?.loadGuestCanvas(state.boardId)
      : await window.WhiteboardStorage?.loadSnapshot(state.boardId);
    if (epoch !== state.canvasEpoch || generation !== window.WhiteboardStorage?.getGeneration()) return;
    if (parsed && parsed.boardId === state.boardId && Array.isArray(parsed.items)) {
      loadSnapshot(parsed);
      state.cachedSnapshotLoaded = true;
      state.cachedSnapshotRevision = state.revision;
      state.cachePending = false;
      centerOnContent();
    }
  } catch (error) {
    console.warn('Could not restore cached board', error);
  }
}

function loadSnapshot(snapshot, options = {}) {

  const nextItems = new Map();
  const items = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
  const sections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];
  const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
  state.sections = new Map(
    sections
      .filter((section) => section?.id)
      .map((section, index) => [section.id, normalizeClientSection(section, index)])
  );
  state.groups = new Map(
    groups.filter((group) => group?.id).map((group, index) => [group.id, normalizeClientGroup(group, index)])
  );
  if (!state.navigatorExpanded.size) {
    for (const section of state.sections.values()) state.navigatorExpanded.add(`section:${section.id}`);
    for (const group of state.groups.values())
      if (!group.parentGroupId) state.navigatorExpanded.add(`group:${group.id}`);
    state.navigatorExpanded.add('root:unframed');
  }
  state.layers = normalizeClientLayers(snapshot && snapshot.layers);
  const fallbackLayerId = state.layers[0].id;
  for (const item of items) {
    if (item && item.id && item.type) {
      if (!state.layers.some((layer) => layer.id === (item.layerId || 'layer_default'))) {
        item.layerId = fallbackLayerId;
      }
      item.sectionId = item.sectionId && state.sections.has(item.sectionId) ? item.sectionId : null;
      item.groupId = item.groupId && state.groups.has(item.groupId) ? item.groupId : null;
      item.locked = Boolean(item.locked);
      item.hidden = Boolean(item.hidden);
      nextItems.set(item.id, item);
    }
  }
  if (state.pendingCut?.boardId === state.boardId) {
    state.pendingCut.items = state.pendingCut.items.map((item) => {
      const current = nextItems.get(item.id);
      nextItems.delete(item.id);
      return current ? JSON.parse(JSON.stringify(current)) : item;
    });
  }
  state.items = nextItems;
  state.xmindRemoteAlerts.clear();
  state.xmindSyncFingerprints.clear();
  for (const item of nextItems.values()) rememberXmindContent(item);
  
  state.revision = Math.max(0, Number(snapshot?.revision) || 0);
  state.durableRevision = Math.max(state.durableRevision, state.revision);
  state.background = getBackgroundPreset(snapshot?.settings?.background).type;
  state.backgroundDrift =
    typeof snapshot?.settings?.backgroundDrift === 'boolean'
      ? snapshot.settings.backgroundDrift
      : wallpaperDriftDefault();
  state.connectorLineJumps = snapshot?.settings?.connectorLineJumps === true;
  applyBackground();
  if (!state.layers.some((layer) => layer.id === state.activeLayerId)) {
    state.activeLayerId = state.layers[0].id;
  }
  state.zCounter = 1;
  for (const item of items) {
    state.zCounter = Math.max(state.zCounter, Number(item.z || 1) + 1);
  }
  state.undoStack = [];
  state.redoStack = [];
  state.undoBytes = 0;
  state.redoBytes = 0;
  state.mindmapSelection = null;
  state.mindmapEditing = null;
  state.selectedIds = new Set();
  state.selectedId = null;
  state.renderErrorIds.clear();
  
  renderAll();
  
  updateUndoButton();
  updateRedoButton();
}

export { cacheBoardSnapshot, flushBoardCache, loadSnapshot, restoreCachedSnapshot, scheduleBoardCache };

