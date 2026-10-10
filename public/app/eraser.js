
import { snapshotItems } from './history-controller-model.js';
import { boardToScreen } from './camera-model.js';

import { els } from './elements.js';
import { getBrush } from './format-actions-model.js';
import { getPointsBounds } from './geometry-model.js';
import {
  createEraserHitTester,
  densifyStrokePoints,
  limitStrokePoints,
  splitKeptStrokeRuns
} from './ink-geometry-model.js';

import { renderInk } from './ink-rendering-model.js';
import { showToast } from './interface-model.js';
import { canMutateItem, sortedRenderItems } from './layers-model.js';

import { queryItemsInRect } from './spatial-index-model.js';
import { state } from './state.js';

import { cssEscape, distance } from './utilities.js';
import { eraseInkGeometry, restoreEraserInkPreview, clearEraserPreview } from './eraser-model.js';

let pushUndoSnapshot,
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
  enqueueOperation;

function configureEraser(callbacks) {
  ({
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
  } = callbacks);
}

function startEraser(event) {
  event.preventDefault();
  if (!window.WhiteboardBrushEngine?.getCoalescedSamples) {
    showToast('画笔引擎尚未就绪');
    return;
  }
  const preview = createViewportPreviewCanvas('eraser-preview-canvas');
  state.eraserPath = {
    points: [],
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    radius: state.eraserSize / 2,
    previewCanvas: preview.canvas,
    previewPixelRatio: preview.pixelRatio,
    previewIndex: 0,
    previewFrame: 0,
    inkPreviews: new Map()
  };
  appendEraserSamples(event);
  drawEraserPreview();
  captureViewportPointer(event.pointerId);
}

function continueEraser(event) {
  const eraser = state.eraserPath;
  if (!eraser || event.pointerId !== eraser.pointerId) {
    return;
  }
  event.preventDefault();
  if (appendEraserSamples(event) && !eraser.previewFrame) {
    eraser.previewFrame = requestAnimationFrame(drawEraserPreview);
  }
}

function appendEraserSamples(event) {
  const eraser = state.eraserPath;
  if (!eraser || event.pointerId !== eraser.pointerId) {
    return false;
  }
  const engine = window.WhiteboardBrushEngine;
  const samples = engine.getCoalescedSamples(event, (source) => getBoardPoint(source));
  let added = false;
  for (const point of samples) {
    const last = eraser.points[eraser.points.length - 1];
    if (!last || distance(last, point) >= 0.2) {
      eraser.points.push(point);
      added = true;
    }
  }
  if (eraser.points.length > 12_000) {
    eraser.points = limitStrokePoints(eraser.points);
    eraser.previewIndex = Math.max(0, eraser.points.length - 2);
  }
  return added;
}

function createEraserInkGeometry(item, radius) {
  const points = densifyStrokePoints(
    inkItemPointsToBoard(item),
    Math.max(0.75, Math.min(radius * 0.4, (Number(item.strokeWidth) || 4) * 0.5))
  );
  const scaleX = Math.abs((Number(item.w) || 1) / Math.max(1, Number(item.baseW || item.w) || 1));
  const scaleY = Math.abs((Number(item.h) || 1) / Math.max(1, Number(item.baseH || item.h) || 1));
  const brushRadiusScale = Math.max(0.5, (getBrush(item.brushType).pad || 1.2) * 0.7);
  return {
    points,
    removed: points.map(() => false),
    inkRadius: (Number(item.strokeWidth) || 4) * Math.max(scaleX, scaleY) * brushRadiusScale
  };
}

function updateEraserInkPreview(eraser, segment) {
  const bounds = getPointsBounds(segment);
  const radius = eraser.radius;
  const hitTest = createEraserHitTester(segment, radius);
  for (const [id, entry] of eraser.inkPreviews) {
    if (state.items.get(id) !== entry.item || !entry.node.isConnected || !canMutateItem(entry.item)) {
      restoreEraserInkPreview(entry);
      eraser.inkPreviews.delete(id);
    }
  }
  const candidates = new Map(
    queryItemsInRect({
      x: bounds.x - radius,
      y: bounds.y - radius,
      w: bounds.w + radius * 2,
      h: bounds.h + radius * 2
    }).map((item) => [item.id, item])
  );
  // The spatial index stores unrotated rectangles; rotated ink can extend beyond them.
  for (const item of state.items.values()) {
    if (item.type === 'ink' && Math.abs(Number(item.rotation) || 0) % 360 >= 0.01) candidates.set(item.id, item);
  }
  for (const item of candidates.values()) {
    if (item.type !== 'ink' || !canMutateItem(item)) continue;
    let entry = eraser.inkPreviews.get(item.id);
    if (!entry) {
      const node = els.itemsLayer.querySelector('.board-item[data-item-id="' + cssEscape(item.id) + '"]');
      if (!node) continue;
      entry = {
        item,
        node,
        visibility: node.style.visibility,
        pieces: [],
        geometry: createEraserInkGeometry(item, radius)
      };
      eraser.inkPreviews.set(item.id, entry);
    }
    if (!eraseInkGeometry(entry.geometry, hitTest)) continue;
    entry.pieces.forEach((node) => node.remove());
    entry.pieces = [];
    const runs = splitKeptStrokeRuns(entry.geometry.points, entry.geometry.removed).slice(0, 128);
    for (const [index, run] of runs.entries()) {
      const piece = createInkPiece(item, run, index);
      const preview = document.createElement('div');
      preview.className = 'board-item ink-item eraser-ink-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.left = piece.x + 'px';
      preview.style.top = piece.y + 'px';
      preview.style.width = piece.w + 'px';
      preview.style.height = piece.h + 'px';
      preview.style.setProperty('--rotation', '0deg');
      preview.style.setProperty('--z', piece.z || 1);
      const canvas = renderInk(piece);
      canvas.removeAttribute('data-ink-canvas');
      preview.appendChild(canvas);
      getLayerContainer(item.layerId || 'layer_default').appendChild(preview);
      entry.pieces.push(preview);
    }
    entry.node.style.visibility = 'hidden';
  }
}

function drawEraserPreview() {
  const eraser = state.eraserPath;
  if (!eraser) return;
  eraser.previewFrame = 0;
  if (eraser.previewIndex >= eraser.points.length) return;
  const start = Math.max(0, eraser.previewIndex - 1);
  const segment = eraser.points.slice(start);
  updateEraserInkPreview(eraser, segment);
  const current = boardToScreen(segment[segment.length - 1]);
  const context = eraser.previewCanvas.getContext('2d');
  context.clearRect(0, 0, eraser.previewCanvas.width, eraser.previewCanvas.height);
  context.save();
  context.scale(eraser.previewPixelRatio, eraser.previewPixelRatio);
  context.beginPath();
  context.arc(current.x, current.y, eraser.radius * state.zoom, 0, Math.PI * 2);
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(255,255,255,.9)';
  context.stroke();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(24,31,48,.75)';
  context.stroke();
  context.restore();
  eraser.previewIndex = eraser.points.length;
}

function finishEraser() {
  const eraser = state.eraserPath;
  state.eraserPath = null;
  clearEraserPreview(eraser);
  if (!eraser?.points.length) {
    return;
  }
  applyEraserPath(eraser.points, eraser.radius);
}

function applyEraserPath(eraserPoints, radius) {
  const beforeItems = snapshotItems();
  const removedIds = [];
  const replacementItems = [];
  const eraserHitTest = createEraserHitTester(eraserPoints, radius);
  for (const item of sortedRenderItems()) {
    if (item.type !== 'ink' || !canMutateItem(item)) {
      continue;
    }
    const rotation = Math.abs(Number(item.rotation) || 0) % 360;
    if (rotation < 0.01 && !eraserMayIntersectItem(item, eraserPoints, radius)) {
      continue;
    }
    const geometry = createEraserInkGeometry(item, radius);
    if (!eraseInkGeometry(geometry, eraserHitTest)) continue;
    removedIds.push(item.id);
    const runs = splitKeptStrokeRuns(geometry.points, geometry.removed).slice(0, 128);
    runs.forEach((run, index) => {
      replacementItems.push(createInkPiece(item, run, index));
    });
  }
  if (!removedIds.length) {
    return;
  }

  pushUndoSnapshot(beforeItems);
  for (const id of removedIds) {
    state.items.delete(id);
    indexRemoveItem(id);
    removeItemElement(id);
  }
  for (const item of replacementItems) {
    state.items.set(item.id, item);
    renderItem(item);
  }
  for (const id of removedIds) {
    if (!state.items.has(id)) {
      state.selectedIds.delete(id);
      if (state.selectedId === id) {
        state.selectedId = null;
      }
    }
  }
  updateSelectionUI();
  const ops = [{ kind: 'delete', ids: removedIds }, ...replacementItems.map((item) => ({ kind: 'upsert', item }))];
  enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
  markDirty(true);
}

function eraserMayIntersectItem(item, eraserPoints, radius) {
  const bounds = getPointsBounds(eraserPoints);
  return !(
    item.x > bounds.x + bounds.w + radius ||
    item.x + item.w < bounds.x - radius ||
    item.y > bounds.y + bounds.h + radius ||
    item.y + item.h < bounds.y - radius
  );
}
export {
  startEraser,
  continueEraser,
  appendEraserSamples,
  createEraserInkGeometry,
  updateEraserInkPreview,
  drawEraserPreview,
  finishEraser,
  applyEraserPath,
  eraserMayIntersectItem
};

export { configureEraser };
