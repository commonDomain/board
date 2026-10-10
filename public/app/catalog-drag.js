import { isGuestMode } from './account-lifecycle.js';
import { fetchCanvasCatalog, renderCanvasCatalog, updateCurrentCanvasLabel } from './catalog.js';
import { canvasListRows, resetCanvasPreviewIntent } from './catalog-preview.js';
import { els } from './elements.js';
import { showToast } from './interface-model.js';
import { state } from './state.js';
import {
  untransformedVerticalRect,
  dragRetreatMagnitude,
  createCanvasDragGhost,
  moveCanvasDragGhost,
  settleCanvasDragGhost
} from './catalog-drag-model.js';

let canvasCatalogRenderTimer = null;

let canvasAnimationCleanupTimer = null;

let canvasDropPreviewCleanupTimer = null;

const DROP_POSITION_HYSTERESIS = 2;

function resolveVerticalDropIntent(elements, sourceElement, clientY, previousElement = null, previousPosition = null) {
  let target = null;
  let targetRect = null;
  let nearestDistance = Infinity;
  for (const element of elements) {
    const rect = untransformedVerticalRect(element);
    const distanceToRow = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (distanceToRow < nearestDistance) {
      nearestDistance = distanceToRow;
      target = element;
      targetRect = rect;
    }
    if (distanceToRow === 0) break;
  }
  if (!target || target === sourceElement || nearestDistance > 10) return null;
  const sourceRect = untransformedVerticalRect(sourceElement);
  const movingDown = targetRect.top >= sourceRect.top;
  const crossingPoint = movingDown
    ? targetRect.top + targetRect.height * 0.24
    : targetRect.bottom - targetRect.height * 0.24;
  let position;
  if (target === previousElement && previousPosition === 'before' && clientY < crossingPoint + DROP_POSITION_HYSTERESIS)
    position = 'before';
  else if (
    target === previousElement &&
    previousPosition === 'after' &&
    clientY > crossingPoint - DROP_POSITION_HYSTERESIS
  )
    position = 'after';
  else position = clientY < crossingPoint ? 'before' : 'after';
  return { target, position };
}

async function persistCanvasOrder(ids) {
  if (state.reorderingCanvases) return;
  state.reorderingCanvases = true;
  try {
    if (isGuestMode()) {
      state.canvases = await window.WhiteboardStorage.reorderGuestCanvases(ids);
      return;
    }
    const response = await fetch('/api/canvases/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ids })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.canvases)) {
      throw new Error(
        body.code === 'CANVAS_CATALOG_CHANGED' ? '画布列表已变化，请重新排序' : body.error || '排序保存失败'
      );
    }
    state.canvases = body.canvases;
  } catch (error) {
    console.warn('Could not reorder canvases', error);
    showToast(error.message || '排序保存失败');
    await fetchCanvasCatalog().catch(() => {});
  } finally {
    state.reorderingCanvases = false;
    const animationDelay = Math.max(0, Number(state.canvasAnimationUntil || 0) - performance.now());
    clearTimeout(canvasCatalogRenderTimer);
    if (animationDelay > 0) {
      canvasCatalogRenderTimer = setTimeout(() => {
        canvasCatalogRenderTimer = null;
        renderCanvasCatalog();
      }, animationDelay + 18);
    } else {
      renderCanvasCatalog();
    }
    updateCurrentCanvasLabel();
  }
}

function startCanvasDrag(event, row, handle) {
  if (event.button !== 0 || state.reorderingCanvases) return;
  event.preventDefault();
  clearCanvasDropPreview({ immediate: true });
  clearTimeout(canvasCatalogRenderTimer);
  canvasCatalogRenderTimer = null;
  clearTimeout(canvasAnimationCleanupTimer);
  canvasAnimationCleanupTimer = null;
  els.canvasList.querySelectorAll('.canvas-list-item').forEach((entry) => {
    entry.classList.remove('canvas-drop-landed');
    entry.getAnimations().forEach((animation) => animation.cancel());
  });
  resetCanvasPreviewIntent();
  state.canvasDrag = {
    pointerId: event.pointerId,
    row,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    target: null,
    position: null,
    ghost: createCanvasDragGhost(row, event),
    originalIds: state.canvases.map((canvas) => canvas.id)
  };
  row.classList.add('dragging');
  document.documentElement.classList.add('canvas-is-dragging');
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', moveCanvasDrag);
  window.addEventListener('pointerup', finishCanvasDrag);
  window.addEventListener('pointercancel', cancelCanvasDrag);
  window.addEventListener('blur', cancelCanvasDrag);
  handle.addEventListener('lostpointercapture', cancelCanvasDrag);
}

function moveCanvasDrag(event) {
  const drag = state.canvasDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  moveCanvasDragGhost(drag.ghost, event);
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
  event.preventDefault();
  drag.moved = true;
  const listRect = els.canvasList.getBoundingClientRect();
  if (event.clientY < listRect.top + 34) els.canvasList.scrollTop -= 12;
  else if (event.clientY > listRect.bottom - 34) els.canvasList.scrollTop += 12;
  const intent = resolveVerticalDropIntent(
    Array.from(els.canvasList.querySelectorAll(':scope > .canvas-list-item')),
    drag.row,
    event.clientY,
    drag.target,
    drag.position
  );
  if (!intent) {
    drag.target = null;
    clearCanvasDropPreview();
    return;
  }
  drag.target = intent.target;
  drag.position = intent.position;
  previewCanvasDrop(drag, intent.target, intent.position);
}

function clearCanvasDropPreview(options = {}) {
  delete els.canvasList.dataset.dragPreviewKey;
  els.canvasList.querySelectorAll('.canvas-drop-before, .canvas-drop-after').forEach((row) => {
    row.classList.remove('canvas-drop-before', 'canvas-drop-after');
  });
  clearTimeout(canvasDropPreviewCleanupTimer);
  canvasDropPreviewCleanupTimer = null;
  const displaced = Array.from(els.canvasList.querySelectorAll('.canvas-drag-displaced'));
  for (const row of displaced) {
    if (options.immediate) {
      row.classList.remove('canvas-drag-displaced');
      row.style.removeProperty('--canvas-retreat');
    } else {
      row.style.setProperty('--canvas-retreat', '0px');
    }
  }
  if (!options.immediate && displaced.length) {
    canvasDropPreviewCleanupTimer = setTimeout(() => {
      canvasDropPreviewCleanupTimer = null;
      displaced.forEach((row) => {
        if (row.style.getPropertyValue('--canvas-retreat') !== '0px') return;
        row.classList.remove('canvas-drag-displaced');
        row.style.removeProperty('--canvas-retreat');
      });
    }, 220);
  }
}

function previewCanvasDrop(drag, target, position) {
  const previewKey = `${drag.row.dataset.canvasId}>${target.dataset.canvasId}:${position}`;
  if (els.canvasList.dataset.dragPreviewKey === previewKey) return;
  clearTimeout(canvasDropPreviewCleanupTimer);
  canvasDropPreviewCleanupTimer = null;
  els.canvasList.querySelectorAll('.canvas-drop-before, .canvas-drop-after').forEach((row) => {
    row.classList.remove('canvas-drop-before', 'canvas-drop-after');
  });
  els.canvasList.dataset.dragPreviewKey = previewKey;
  target.classList.add(position === 'before' ? 'canvas-drop-before' : 'canvas-drop-after');
  const rows = canvasListRows();
  const sourceIndex = rows.indexOf(drag.row);
  let targetIndex = rows.indexOf(target);
  const reordered = rows.slice();
  reordered.splice(sourceIndex, 1);
  targetIndex = reordered.indexOf(target);
  reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, drag.row);
  const destinationIndex = reordered.indexOf(drag.row);
  if (destinationIndex === sourceIndex) return;
  const direction = destinationIndex > sourceIndex ? -1 : 1;
  const rangeStart = Math.min(sourceIndex, destinationIndex);
  const rangeEnd = Math.max(sourceIndex, destinationIndex);
  const affected = rows.slice(rangeStart, rangeEnd + 1).filter((entry) => entry !== drag.row);
  const retreats = new Map();
  affected.forEach((entry, index) => {
    const distanceFromTarget = direction < 0 ? affected.length - index - 1 : index;
    retreats.set(entry, direction * dragRetreatMagnitude(distanceFromTarget, entry.offsetHeight));
  });
  const previewRows = new Set([...els.canvasList.querySelectorAll('.canvas-drag-displaced'), ...affected]);
  previewRows.forEach((entry) => {
    entry.classList.add('canvas-drag-displaced');
    entry.style.setProperty('--canvas-retreat', `${(retreats.get(entry) || 0).toFixed(1)}px`);
  });
}

function animateCanvasListReorder(draggedRow, reorder) {
  const rows = canvasListRows();
  const previousTops = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
  reorder();
  for (const row of rows) {
    if (row === draggedRow) continue;
    const offset = previousTops.get(row) - row.getBoundingClientRect().top;
    if (!offset) continue;
    row.getAnimations().forEach((animation) => animation.cancel());
    row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], {
      duration: 340,
      easing: 'cubic-bezier(0.18, 1, 0.28, 1)'
    });
  }
}

function finishCanvasDrag(event) {
  const drag = state.canvasDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  let destinationRect = null;
  if (drag.moved && drag.target) {
    const rows = canvasListRows();
    const targetIndex = rows.indexOf(drag.target);
    const reference = drag.position === 'before' ? drag.target : rows[targetIndex + 1] || null;
    clearCanvasDropPreview({ immediate: true });
    animateCanvasListReorder(drag.row, () => els.canvasList.insertBefore(drag.row, reference));
    destinationRect = drag.row.getBoundingClientRect();
    drag.row.classList.add('canvas-drop-landed');
    state.canvasAnimationUntil = performance.now() + 420;
    clearTimeout(canvasAnimationCleanupTimer);
    canvasAnimationCleanupTimer = setTimeout(() => {
      canvasAnimationCleanupTimer = null;
      els.canvasList
        ?.querySelectorAll('.canvas-drop-landed')
        .forEach((entry) => entry.classList.remove('canvas-drop-landed'));
    }, 420);
  }
  cleanupCanvasDrag({ preserveGhost: true });
  settleCanvasDragGhost(drag.ghost, destinationRect);
  if (!drag.moved || !drag.target) return;
  const ids = canvasListRows().map((row) => row.dataset.canvasId);
  state.canvases.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  void persistCanvasOrder(ids);
}

function cancelCanvasDrag(event) {
  if (event?.pointerId != null && state.canvasDrag && event.pointerId !== state.canvasDrag.pointerId) return;
  const originalIds = state.canvasDrag?.originalIds;
  cleanupCanvasDrag();
  if (originalIds) {
    state.canvases.sort((a, b) => originalIds.indexOf(a.id) - originalIds.indexOf(b.id));
    renderCanvasCatalog();
  }
}

function cleanupCanvasDrag(options = {}) {
  const drag = state.canvasDrag;
  if (!drag) return;
  drag.row.classList.remove('dragging');
  document.documentElement.classList.remove('canvas-is-dragging');
  clearCanvasDropPreview({ immediate: true });
  if (!options.preserveGhost) settleCanvasDragGhost(drag.ghost);
  state.canvasDrag = null;
  window.removeEventListener('pointermove', moveCanvasDrag);
  window.removeEventListener('pointerup', finishCanvasDrag);
  window.removeEventListener('pointercancel', cancelCanvasDrag);
  window.removeEventListener('blur', cancelCanvasDrag);
  drag.handle.removeEventListener('lostpointercapture', cancelCanvasDrag);
  try {
    drag.handle.releasePointerCapture?.(drag.pointerId);
  } catch {}
}
export {
  canvasCatalogRenderTimer,
  canvasAnimationCleanupTimer,
  canvasDropPreviewCleanupTimer,
  DROP_POSITION_HYSTERESIS,
  resolveVerticalDropIntent,
  persistCanvasOrder,
  startCanvasDrag,
  moveCanvasDrag,
  clearCanvasDropPreview,
  previewCanvasDrop,
  animateCanvasListReorder,
  finishCanvasDrag,
  cancelCanvasDrag,
  cleanupCanvasDrag
};
