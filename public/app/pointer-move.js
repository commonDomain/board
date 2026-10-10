import { cancelConnectorDraft } from './drawing-model.js';
import {
  continueConnectorDraft,
  continueDrawing,
  continuePendingMove,
  continueShape,
  finishDrawing,
  finishShape
} from './drawing.js';
import { continueTableCellDrag, finishTableCellDrag } from './editing.js';
import { els } from './elements.js';
import { continueEraser, finishEraser } from './eraser.js';
import { cancelActiveGesture, continuePinch, finishPinch } from './gestures.js';
import { continueSmudge, finishSmudge } from './ink-geometry.js';
import { isItemVisible } from './layer-visibility.js';
import { continueMarquee, continuePendingCanvasIntent, finishMarquee, finishPendingCanvasIntent } from './marquee.js';
import {
  capturedViewportPointers,
  continuePanning,
  finishPanning,
  releaseViewportPointer,
  syncEdgePanForEvent
} from './pan.js';
import { trackPointer, untrackPointer } from './pan-model.js';
import { sendCursorFromEvent } from './presence.js';
import { pointerMoveRuntime } from './runtime/pointer-move.js';
import {
  continueSectionDraft,
  continueSectionInteraction,
  finishSectionDraft,
  finishSectionInteraction
} from './sections.js';
import { state } from './state.js';
import { continueTransform, finishTransform } from './transform.js';
import { clamp } from './utilities.js';
import { shouldCoalescePointerMove, recordGestureFrameDuration } from './pointer-move-model.js';

let sectionHoverFrame = null;

let pendingSectionHover = null;

function onWindowPointerMove(event) {
  if (state.pinch?.pointers.has(event.pointerId)) state.pinch.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  updateSectionHoverFromPointer(event);
  if (!shouldCoalescePointerMove()) {
    processWindowPointerMove(event);
    return;
  }
  if (event.cancelable) event.preventDefault();
  pointerMoveRuntime.queuedPointerMove = event;
  if (state.gestureSession) state.gestureSession.latestEvent = event;
  if (pointerMoveRuntime.pointerMoveFrame) return;
  pointerMoveRuntime.pointerMoveFrame = requestAnimationFrame(() => {
    pointerMoveRuntime.pointerMoveFrame = null;
    const latest = pointerMoveRuntime.queuedPointerMove;
    pointerMoveRuntime.queuedPointerMove = null;
    if (!latest) return;
    const startedAt = performance.now();
    pointerMoveRuntime.processingGestureFrame = true;
    try {
      processWindowPointerMove(latest);
    } finally {
      pointerMoveRuntime.processingGestureFrame = false;
      recordGestureFrameDuration(performance.now() - startedAt);
    }
  });
}

function updateSectionHoverFromPointer(event) {
  const target = event.target instanceof Element ? event.target : null;
  const sheetItemElement = target?.closest?.('.sheet-item[data-item-id]');
  const sheetItem = sheetItemElement && state.items.get(sheetItemElement.dataset.itemId);
  const commonUnavailable =
    event.pointerType !== 'mouse' || event.buttons !== 0 || state.gestureSession || state.spacePan;
  if (
    !commonUnavailable &&
    sheetItem?.type === 'sheet' &&
    target.closest('.sheet-preview') &&
    els.viewport.contains(sheetItemElement) &&
    isItemVisible(sheetItem)
  ) {
    pendingSectionHover = {
      hoverKey: `sheet:${sheetItem.id}`,
      text: sheetItem.title || '工作表',
      clientX: event.clientX,
      clientY: event.clientY
    };
    if (!sectionHoverFrame) sectionHoverFrame = requestAnimationFrame(renderSectionHoverLabel);
    return;
  }
  const frame = target?.closest?.('.section-frame');
  const sectionId = frame?.dataset.sectionId;
  const unavailable =
    commonUnavailable ||
    !sectionId ||
    !els.viewport.contains(frame) ||
    target.closest('.board-item, .section-titlebar, .section-resize-handle') ||
    state.sectionDraft;
  if (unavailable) {
    hideSectionHoverLabel();
    return;
  }
  const section = state.sections.get(sectionId);
  if (!section || section.hidden) {
    hideSectionHoverLabel();
    return;
  }
  pendingSectionHover = {
    hoverKey: `section:${section.id}`,
    text: section.name || '未命名画框',
    clientX: event.clientX,
    clientY: event.clientY
  };
  if (sectionHoverFrame) return;
  sectionHoverFrame = requestAnimationFrame(renderSectionHoverLabel);
}

function renderSectionHoverLabel() {
  sectionHoverFrame = null;
  const pending = pendingSectionHover;
  pendingSectionHover = null;
  const label = els.sectionHoverLabel;
  if (!label || !pending || state.gestureSession || state.spacePan) {
    hideSectionHoverLabel();
    return;
  }
  if (label.dataset.hoverKey !== pending.hoverKey || label.textContent !== pending.text) {
    label.dataset.hoverKey = pending.hoverKey;
    label.textContent = pending.text;
    label.hidden = false;
    const bounds = label.getBoundingClientRect();
    pointerMoveRuntime.sectionHoverLabelSize = { width: bounds.width, height: bounds.height };
  } else {
    label.hidden = false;
  }
  const size = pointerMoveRuntime.sectionHoverLabelSize || { width: 120, height: 24 };
  positionViewportHoverLabel(label, size, pending.clientX, pending.clientY);
}

function hideSectionHoverLabel() {
  pendingSectionHover = null;
  if (sectionHoverFrame) cancelAnimationFrame(sectionHoverFrame);
  sectionHoverFrame = null;
  if (!els.sectionHoverLabel) return;
  if (els.sectionHoverLabel.hidden && !els.sectionHoverLabel.dataset.hoverKey) return;
  els.sectionHoverLabel.hidden = true;
  delete els.sectionHoverLabel.dataset.hoverKey;
  pointerMoveRuntime.sectionHoverLabelSize = null;
}

function positionViewportHoverLabel(label, size, clientX, clientY) {
  const viewport = els.viewport.getBoundingClientRect();
  const localX = clientX - viewport.left;
  const localY = clientY - viewport.top;
  const x = clamp(localX + 12, 8, Math.max(8, viewport.width - size.width - 8));
  const preferredY = localY + 16;
  const y = preferredY + size.height <= viewport.height - 8 ? preferredY : Math.max(8, localY - size.height - 12);
  label.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

function processWindowPointerMove(event) {
  rememberCanvasPointer(event);
  trackPointer(event, false);
  sendCursorFromEvent(event);
  if (state.tableCellDrag) {
    continueTableCellDrag(event);
    return;
  }
  if (state.pinch) {
    if (state.pinch.pointers.has(event.pointerId)) {
      continuePinch(event);
    }
    return;
  }
  if (state.panning) {
    if (event.pointerId === state.panning.pointerId) {
      continuePanning(event);
    }
    return;
  }
  if (state.marquee) {
    if (event.pointerId === state.marquee.pointerId) {
      continueMarquee(event);
      syncEdgePanForEvent(event);
    }
    return;
  }
  if (state.pendingCanvasIntent) {
    if (event.pointerId === state.pendingCanvasIntent.pointerId) {
      continuePendingCanvasIntent(event);
    }
    return;
  }
  if (state.sectionDraft) {
    if (event.pointerId === state.sectionDraft.pointerId) continueSectionDraft(event);
    return;
  }
  if (state.sectionInteraction) {
    if (event.pointerId === state.sectionInteraction.pointerId) {
      continueSectionInteraction(event);
      syncEdgePanForEvent(event);
    }
    return;
  }
  if (state.connectorDraft) {
    if (event.pointerId === state.connectorDraft.pointerId) {
      continueConnectorDraft(event);
    }
    return;
  }
  if (state.smudgePath) {
    if (event.pointerId === state.smudgePath.pointerId) {
      continueSmudge(event);
    }
    return;
  }
  if (state.eraserPath) {
    if (event.pointerId === state.eraserPath.pointerId) {
      continueEraser(event);
    }
    return;
  }
  if (state.currentPath) {
    if (event.pointerId === state.currentPath.pointerId) {
      continueDrawing(event);
    }
    return;
  }
  if (state.currentShape) {
    if (event.pointerId === state.currentShape.pointerId) {
      continueShape(event);
    }
    return;
  }
  if (state.pendingMove) {
    if (event.pointerId === state.pendingMove.pointerId) {
      continuePendingMove(event);
    }
    return;
  }
  if (state.interaction && event.pointerId === state.interaction.pointerId) {
    continueTransform(event);
    syncEdgePanForEvent(event);
  }
}

function flushQueuedPointerMove(pointerId) {
  if (!pointerMoveRuntime.queuedPointerMove || pointerMoveRuntime.queuedPointerMove.pointerId !== pointerId) return;
  if (pointerMoveRuntime.pointerMoveFrame) cancelAnimationFrame(pointerMoveRuntime.pointerMoveFrame);
  pointerMoveRuntime.pointerMoveFrame = null;
  const latest = pointerMoveRuntime.queuedPointerMove;
  pointerMoveRuntime.queuedPointerMove = null;
  const startedAt = performance.now();
  pointerMoveRuntime.processingGestureFrame = true;
  try {
    processWindowPointerMove(latest);
  } finally {
    pointerMoveRuntime.processingGestureFrame = false;
    recordGestureFrameDuration(performance.now() - startedAt);
  }
}

function rememberCanvasPointer(event) {
  if (!els.viewport || event.pointerType === 'touch') return;
  const rect = els.viewport.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    return;
  }
  state.lastCanvasPointer = { clientX: event.clientX, clientY: event.clientY };
}

function onWindowPointerUp(event) {
  flushQueuedPointerMove(event.pointerId);
  untrackPointer(event);
  releaseViewportPointer(event.pointerId);
  if (state.tableCellDrag?.pointerId === event.pointerId) {
    finishTableCellDrag(event);
    return;
  }
  if (state.pinch) {
    if (state.pinch.pointers.has(event.pointerId)) {
      finishPinch();
    }
    return;
  }
  if (state.panning?.pointerId === event.pointerId) {
    finishPanning(event);
    return;
  }
  if (state.marquee?.pointerId === event.pointerId) {
    finishMarquee();
    return;
  }
  if (state.pendingCanvasIntent?.pointerId === event.pointerId) {
    finishPendingCanvasIntent(event);
    return;
  }
  if (state.sectionDraft?.pointerId === event.pointerId) {
    finishSectionDraft(event);
    return;
  }
  if (state.sectionInteraction?.pointerId === event.pointerId) {
    finishSectionInteraction();
    return;
  }
  if (state.smudgePath?.pointerId === event.pointerId) {
    finishSmudge();
    return;
  }
  if (state.eraserPath?.pointerId === event.pointerId) {
    continueEraser(event);
    finishEraser();
    return;
  }
  if (state.currentPath?.pointerId === event.pointerId) {
    clearTimeout(state.eyedropperTimer);
    state.eyedropperTimer = null;
    state.eyedropperStart = null;
    continueDrawing(event);
    finishDrawing();
    return;
  }
  if (state.currentShape?.pointerId === event.pointerId) {
    continueShape(event);
    finishShape();
    return;
  }
  if (state.interaction?.pointerId === event.pointerId) {
    finishTransform();
    return;
  }
  if (state.pendingMove?.pointerId === event.pointerId) {
    state.pendingMove = null;
    state.gestureSession = null;
    return;
  }
  if (state.connectorDraft?.pointerId === event.pointerId) {
    state.connectorDraft.pointerId = null;
  }
}

function onWindowPointerCancel(event) {
  // Touch implicitly captures the pressed child. Transferring that capture to
  // the viewport bubbles the child's loss event through this listener.
  if (event.type === 'lostpointercapture' && event.target !== els.viewport) return;
  if (event.type === 'lostpointercapture' && !capturedViewportPointers.has(event.pointerId)) return;
  if (event.type === 'lostpointercapture' && event.pointerType === 'mouse' && event.buttons & 1) {
    // A responsive panel can take over hit testing while the mouse remains down.
    // Window-level move/up listeners can finish the gesture without capture.
    capturedViewportPointers.delete(event.pointerId);
    return;
  }
  if (pointerMoveRuntime.queuedPointerMove?.pointerId === event.pointerId) pointerMoveRuntime.queuedPointerMove = null;
  if (!pointerMoveRuntime.queuedPointerMove && pointerMoveRuntime.pointerMoveFrame) {
    cancelAnimationFrame(pointerMoveRuntime.pointerMoveFrame);
    pointerMoveRuntime.pointerMoveFrame = null;
  }
  untrackPointer(event);
  releaseViewportPointer(event.pointerId);
  if (state.tableCellDrag?.pointerId === event.pointerId) {
    finishTableCellDrag(event, true);
    return;
  }
  if (state.pinch?.pointers.has(event.pointerId)) {
    cancelActiveGesture();
    return;
  }
  if (state.connectorDraft?.pointerId === event.pointerId) {
    cancelConnectorDraft();
  }
  const owned = [
    state.panning,
    state.marquee,
    state.smudgePath,
    state.eraserPath,
    state.currentPath,
    state.currentShape,
    state.interaction,
    state.pendingMove,
    state.pendingCanvasIntent,
    state.sectionDraft,
    state.sectionInteraction
  ].some((gesture) => gesture?.pointerId === event.pointerId);
  if (owned) {
    if (state.panning?.button === 1) state.middleClick = null;
    cancelActiveGesture();
  }
}
export {
  sectionHoverFrame,
  pendingSectionHover,
  onWindowPointerMove,
  updateSectionHoverFromPointer,
  renderSectionHoverLabel,
  hideSectionHoverLabel,
  positionViewportHoverLabel,
  processWindowPointerMove,
  flushQueuedPointerMove,
  rememberCanvasPointer,
  onWindowPointerUp,
  onWindowPointerCancel
};
