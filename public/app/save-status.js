

import { currentCanvas } from './catalog-model.js';

import { canvasPreviewIsCurrent } from './catalog-preview-model.js';

import { isRemoteBoardLocked } from './connection-model.js';
import { CANVAS_PREVIEW_BACKGROUND, CANVAS_PREVIEW_REFRESH_DELAY, CANVAS_PREVIEW_STYLE_VERSION } from './constants.js';
import { els } from './elements.js';

import { canvasToBlob, loadImage } from './image-upload-model.js';
import { showToast } from './interface-model.js';

import { explainUnwritableLayer } from './layers-model.js';

import { state } from './state.js';
import { eventsRuntime } from './runtime/events.js';

let isGuestMode,
  getContentBounds,
  schedulePersistPendingOps,
  renderCanvasCatalog,
  syncCanvasPreviewIntent,
  buildExportPngBlob,
  updateSaveEffect,
  cacheBoardSnapshot,
  scheduleBoardCache,
  pumpSyncQueue,
  scheduleAutoSave;

function configureSaveStatus(callbacks) {
  ({
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
  } = callbacks);
}

function updateSavedLabel(savedAt) {
  if (!savedAt) {
    els.saveText.textContent = state.dirty ? '未保存' : '已就绪';
    updateSaveEffect();
    return;
  }
  const time = new Date(savedAt);
  els.saveText.textContent = Number.isNaN(time.getTime())
    ? '已保存'
    : `已保存 ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  updateSaveEffect();
}

function saveBoard() {
  if (state.compatibilityReadOnly) {
    showToast(explainUnwritableLayer());
    return;
  }
  if (state.syncQueue.blockedReason === 'Background type is unsupported.') {
    state.syncQueue.resume();
    schedulePersistPendingOps();
  }
  if (isGuestMode()) {
    state.previewAfterSave = false;
    const boardId = state.boardId, epoch = state.canvasEpoch;
    void cacheBoardSnapshot({ requireLatest: true }).then((saved) => {
      if (!saved) showToast('浏览器存储空间不足，请先导出画布');
      else if (state.boardId === boardId && state.canvasEpoch === epoch && !state.dirty &&
        window.WhiteboardStorage?.guestStorageIsDurable?.() !== false) {
        window.dispatchEvent(new CustomEvent('muse:pet-feedback', {
          detail: { type: 'save', id: `${boardId}:${epoch}:${state.localChangeSerial}` }
        }));
      }
    });
    return;
  }
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = null;
  state.previewAfterSave = true;
  state.saveQueued = true;
  pumpSyncQueue();
  updateSaveText();
}

async function buildCurrentCanvasPreviewBlob() {
  const bounds = getContentBounds();
  if (!bounds || !bounds.w || !bounds.h) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = CANVAS_PREVIEW_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (state.background === 'dots' || state.background === 'blank') {
      context.fillStyle = 'rgba(255,255,255,.18)';
      for (let y = 9; y < canvas.height; y += 18) {
        for (let x = 9; x < canvas.width; x += 18) {
          context.beginPath();
          context.arc(x, y, 1, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    return canvasToBlob(canvas, 'image/webp', 0.75);
  }
  const png = await buildExportPngBlob(bounds, null, null, {
      maxSide: 640,
    backgroundCss: `background:${CANVAS_PREVIEW_BACKGROUND};`
  });
  if (!png) return null;
  const image = await decodeImageBlob(png);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    context.fillStyle = CANVAS_PREVIEW_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    context.drawImage(
      image,
      Math.round((canvas.width - width) / 2),
      Math.round((canvas.height - height) / 2),
      width,
      height
    );
    return canvasToBlob(canvas, 'image/webp', 0.78);
  } finally {
    image.close?.();
  }
}

async function decodeImageBlob(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadCanvasPreview(boardId, blob) {
  if (!blob || !boardId) return;
  const response = await fetch(`/api/canvases/${encodeURIComponent(boardId)}/preview`, {
    method: 'PUT',
    headers: {
      'content-type': 'image/webp',
      accept: 'application/json',
      'x-canvas-preview-style-version': String(CANVAS_PREVIEW_STYLE_VERSION)
    },
    body: blob
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Canvas preview upload failed');
  const canvas = state.canvases.find((entry) => entry.id === boardId);
  if (canvas) {
    canvas.previewVersion = Number(body.previewVersion) || canvas.previewVersion;
    canvas.previewStyleVersion = Number(body.previewStyleVersion) || CANVAS_PREVIEW_STYLE_VERSION;
  }
  if (!els.canvasMenu.hidden) {
    renderCanvasCatalog();
    syncCanvasPreviewIntent();
  }
}

function scheduleCurrentCanvasPreviewRefresh() {
  clearTimeout(state.previewRefreshTimer);
  state.previewRefreshTimer = null;
  const canvas = currentCanvas();
  if (!state.joined || isGuestMode() || !canvas || canvas.canManage === false || canvasPreviewIsCurrent(canvas)) return;
  const boardId = canvas.id;
  const generation = state.previewGeneration;
  state.previewRefreshTimer = setTimeout(() => {
    state.previewRefreshTimer = null;
    if (!state.joined || state.switchingCanvas || state.boardId !== boardId || state.previewGeneration !== generation)
      return;
    void uploadCurrentCanvasPreview(boardId);
  }, CANVAS_PREVIEW_REFRESH_DELAY);
}

async function uploadCurrentCanvasPreview(boardId = state.boardId) {
  if (!boardId || state.switchingCanvas || boardId !== state.boardId) return;
  // A thumbnail is disposable background work. Do not expand/paint the entire
  // canvas during editing or gestures; retry after interaction has settled.
  if (state.editingId || state.mindmapEditing || state.interaction || state.gestureSession ||
      document.activeElement?.matches('input, textarea, [contenteditable="true"]')) {
    const generation = state.previewGeneration;
    clearTimeout(state.previewRefreshTimer);
    state.previewRefreshTimer = setTimeout(() => {
      state.previewRefreshTimer = null;
      if (boardId === state.boardId && generation === state.previewGeneration) void uploadCurrentCanvasPreview(boardId);
    }, CANVAS_PREVIEW_REFRESH_DELAY);
    return;
  }
  if (state.previewUpload) return state.previewUpload;
  const generation = state.previewGeneration;
  if (state.switchingCanvas || boardId !== state.boardId || generation !== state.previewGeneration) return;
  const upload = (async () => {
    try {
      const blob = await buildCurrentCanvasPreviewBlob();
      if (blob && !state.switchingCanvas && boardId === state.boardId && generation === state.previewGeneration) {
        await uploadCanvasPreview(boardId, blob);
      }
    } catch (error) {
      console.warn('Could not update canvas preview', error);
    }
  })();
  state.previewUpload = upload;
  try {
    await upload;
  } finally {
    if (state.previewUpload === upload) state.previewUpload = null;
  }
}

function markDirty(dirty) {
  state.dirty = dirty;
  if (dirty) {
    state.localChangeSerial += 1;
    scheduleBoardCache();
    scheduleAutoSave();
  } else {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
  }
  updateSaveText();
}

function updateSaveText() {
  eventsRuntime.renderSyncIssue?.();
  const issueButton = document.getElementById('syncIssueButton');
  if (issueButton) issueButton.hidden = !(state.syncQueue.blockedReason || state.draftStorageFailed || state.draftRestoreFailed);
  if (!els.saveText) {
    return;
  }
  if (state.draftStorageFailed || state.draftRestoreFailed || state.draftRestoring) {
    els.saveText.textContent = state.draftRestoring ? '正在恢复草稿' :
      state.draftRestoreFailed ? '草稿读取失败，正在重试' : '草稿保存失败，已暂停编辑';
    updateSaveEffect();
    return;
  }
  if (isGuestMode() && window.WhiteboardStorage?.guestStorageIsDurable?.() === false) {
    els.saveText.textContent = '仅当前页面，建议导出';
    updateSaveEffect();
    return;
  }
  if (isRemoteBoardLocked()) {
    els.saveText.textContent = '画布暂时只读';
    updateSaveEffect();
    return;
  }
  if (state.syncQueue.blockedReason) {
    els.saveText.textContent = state.draftStoragePending ? '正在保存本地草稿' :
      `有 ${state.syncQueue.length} 项待处理，本地草稿已保留`;
  } else if (state.syncQueue.length) {
    els.saveText.textContent = state.draftStoragePending ? '正在保存草稿' :
      state.connected ? '正在同步' : `已存本机，联网后自动同步（${state.syncQueue.length}）`;
  } else if (state.saveInFlight) {
    els.saveText.textContent = '保存中';
  } else if (state.saveQueued) {
    els.saveText.textContent = state.connected ? '等待保存' : '联网后保存';
  } else if (state.dirty) {
    els.saveText.textContent = '未保存';
  } else if (!isGuestMode() && state.joined && state.durableRevision >= state.revision) {
    els.saveText.textContent = '已同步';
  }
  updateSaveEffect();
}

export {
  buildCurrentCanvasPreviewBlob,
  decodeImageBlob,
  markDirty,
  saveBoard,
  scheduleCurrentCanvasPreviewRefresh,
  updateSaveText,
  updateSavedLabel,
  uploadCanvasPreview,
  uploadCurrentCanvasPreview
};

export { configureSaveStatus };
