import { isGuestMode } from './account-lifecycle.js';
import { els } from './elements.js';
import { cancelSurfaceMorph } from './interface-model.js';
import { state } from './state.js';
import { clamp } from './utilities.js';
import { canvasPreviewIsAvailable, usesCompactCanvasMenuLayout } from './catalog-preview-model.js';

function canvasRowForTarget(target) {
  const row = target?.closest?.('.canvas-list-item');
  return row?.parentElement === els.canvasList ? row : null;
}

function canvasListRows() {
  return Array.from(els.canvasList.querySelectorAll(':scope > .canvas-list-item[data-canvas-id]'));
}

function syncCanvasPreviewIntent() {
  if (els.canvasMenu.hidden || state.canvasDrag || usesCompactCanvasMenuLayout()) {
    hideCanvasPreview();
    return;
  }
  const canvasId = state.canvasPreviewHoverId || state.canvasPreviewFocusId;
  const row = canvasId ? canvasListRows().find((entry) => entry.dataset.canvasId === canvasId) : null;
  const canvas = canvasId ? state.canvases.find((entry) => entry.id === canvasId) : null;
  if (!row || !canvas) {
    hideCanvasPreview();
    return;
  }
  showCanvasPreview(canvas, row);
}

function resetCanvasPreviewIntent() {
  state.canvasPreviewHoverId = null;
  state.canvasPreviewFocusId = null;
  hideCanvasPreview();
}

function onCanvasListPointerOver(event) {
  if (event.pointerType !== 'mouse') return;
  const row = canvasRowForTarget(event.target);
  const previousRow = canvasRowForTarget(event.relatedTarget);
  if (!row || row === previousRow) return;
  state.canvasPreviewHoverId = row.dataset.canvasId || null;
  syncCanvasPreviewIntent();
}

function onCanvasListPointerOut(event) {
  if (event.pointerType !== 'mouse') return;
  const row = canvasRowForTarget(event.target);
  const nextRow = canvasRowForTarget(event.relatedTarget);
  if (!row || row === nextRow) return;
  state.canvasPreviewHoverId = nextRow?.dataset.canvasId || null;
  syncCanvasPreviewIntent();
}

function onCanvasListFocusIn(event) {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const row = canvasRowForTarget(event.target);
  if (!row) return;
  state.canvasPreviewFocusId = row.dataset.canvasId || null;
  syncCanvasPreviewIntent();
}

function onCanvasListFocusOut(event) {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const row = canvasRowForTarget(event.target);
  const nextRow = canvasRowForTarget(event.relatedTarget);
  if (!row || row === nextRow) return;
  state.canvasPreviewFocusId = nextRow?.dataset.canvasId || null;
  syncCanvasPreviewIntent();
}

function showCanvasPreview(canvas, anchor) {
  if (usesCompactCanvasMenuLayout()) {
    hideCanvasPreview();
    return;
  }
  const sameCanvas = !els.canvasPreview.hidden && els.canvasPreview.dataset.canvasId === canvas.id;
  const version = !isGuestMode() && canvasPreviewIsAvailable(canvas) ? Number(canvas.previewVersion) : 0;
  els.canvasPreviewName.textContent = canvas.name;
  els.canvasPreviewImage.alt = `${canvas.name}预览图`;
  if (sameCanvas && els.canvasPreview.dataset.previewVersion === String(version)) {
    positionCanvasPreview(anchor);
    return;
  }
  const request = ++state.canvasPreviewRequest;
  els.canvasPreview.dataset.canvasId = canvas.id;
  els.canvasPreview.dataset.previewVersion = String(version);
  cancelSurfaceMorph(els.canvasPreviewImage);
  els.canvasPreviewImage.hidden = true;
  els.canvasPreviewPlaceholder.hidden = false;
  if (version) {
    const image = new Image();
    image.onload = () => {
      if (request !== state.canvasPreviewRequest || els.canvasPreview.hidden) return;
      els.canvasPreviewImage.src = image.src;
      els.canvasPreviewImage.hidden = false;
      els.canvasPreviewPlaceholder.hidden = true;
      window.MuseEffects?.revealPreview(els.canvasPreviewImage);
    };
    image.src = `/api/canvases/${encodeURIComponent(canvas.id)}/preview?v=${version}&style=${Number(canvas.previewStyleVersion)}`;
  } else {
    els.canvasPreviewImage.removeAttribute('src');
  }
  els.canvasPreview.hidden = false;
  positionCanvasPreview(anchor);
  if (!sameCanvas) window.MuseEffects?.revealPreview(els.canvasPreview);
}

function positionCanvasPreview(anchor) {
  if (els.canvasPreview.hidden) return;
  const menuRect = els.canvasMenu.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const previewRect = els.canvasPreview.getBoundingClientRect();
  let left = menuRect.right + 8;
  if (left + previewRect.width > window.innerWidth - 8) {
    left = menuRect.left - previewRect.width - 8;
  }
  if (usesCompactCanvasMenuLayout()) {
    left = 8;
  }
  const top = clamp(anchorRect.top, 8, Math.max(8, window.innerHeight - previewRect.height - 8));
  els.canvasPreview.style.left = `${clamp(left, 8, Math.max(8, window.innerWidth - previewRect.width - 8))}px`;
  els.canvasPreview.style.top = `${top}px`;
}

function hideCanvasPreview() {
  state.canvasPreviewRequest += 1;
  cancelSurfaceMorph(els.canvasPreview);
  cancelSurfaceMorph(els.canvasPreviewImage);
  els.canvasPreview.hidden = true;
  els.canvasPreview.removeAttribute('style');
  delete els.canvasPreview.dataset.canvasId;
  delete els.canvasPreview.dataset.previewVersion;
  els.canvasPreviewImage.onerror = null;
}
export {
  canvasRowForTarget,
  canvasListRows,
  syncCanvasPreviewIntent,
  resetCanvasPreviewIntent,
  onCanvasListPointerOver,
  onCanvasListPointerOut,
  onCanvasListFocusIn,
  onCanvasListFocusOut,
  showCanvasPreview,
  positionCanvasPreview,
  hideCanvasPreview
};
