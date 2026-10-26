import { state } from './state.js';

function trackPointer(event, allowAdd = true) {
  const previous = state.pointerPositions.get(event.pointerId);
  if (!previous && !allowAdd) {
    return;
  }
  state.pointerPositions.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType || previous?.pointerType || 'mouse',
    isPrimary: event.isPrimary ?? previous?.isPrimary ?? false,
    buttons: Number.isFinite(event.buttons) ? event.buttons : previous?.buttons || 0
  });
}

function untrackPointer(event) {
  state.pointerPositions.delete(event.pointerId);
}

function getActiveTouchPointerIds() {
  return Array.from(state.pointerPositions.entries())
    .filter(([, pointer]) => pointer.pointerType === 'touch')
    .map(([id]) => id);
}

function hasActivePen() {
  if (
    [
      state.currentPath,
      state.eraserPath,
      state.currentShape,
      state.smudgePath,
      state.panning,
      state.marquee,
      state.interaction,
      state.pendingMove,
      state.pendingCanvasIntent,
      state.connectorDraft,
      state.sectionDraft,
      state.sectionInteraction,
      window.ConnectorUI?.activeGesture?.()
    ].some((gesture) => gesture?.pointerType === 'pen')
  ) {
    return true;
  }
  return Array.from(state.pointerPositions.values()).some((pointer) => pointer.pointerType === 'pen');
}

function getActiveGesturePointerId() {
  const gesture =
    window.ConnectorUI?.activeGesture?.() ||
    state.tableCellDrag ||
    state.currentPath ||
    state.eraserPath ||
    state.currentShape ||
    state.smudgePath ||
    state.panning ||
    state.marquee ||
    state.interaction ||
    state.pendingMove ||
    state.pendingCanvasIntent ||
    state.sectionDraft ||
    state.sectionInteraction ||
    state.connectorDraft;
  return Number.isFinite(gesture?.pointerId) ? gesture.pointerId : null;
}

function canStartItemGesture(event, tools = ['select', 'pan']) {
  const owner = getActiveGesturePointerId();
  // Native pointermove reports button=-1 while the primary button stays held.
  // A pending item drag promotes to a transform on that move event.
  const primaryInput = event.button === 0 || (event.type === 'pointermove' && Boolean(event.buttons & 1));
  return primaryInput && !state.spacePan && !state.pinch && tools.includes(state.tool) &&
    (owner === null || owner === event.pointerId) && !(event.pointerType === 'touch' && hasActivePen());
}

function getEdgePanGesture() {
  const connectionGesture = window.ConnectorUI?.edgeGesture();
  if (connectionGesture) return connectionGesture;
  if (state.interaction?.mode === 'move') {
    return { kind: 'move', pointerId: state.interaction.pointerId };
  }
  if (state.sectionInteraction?.mode === 'move') {
    return { kind: 'section-move', pointerId: state.sectionInteraction.pointerId };
  }
  if (state.marquee) {
    return { kind: 'marquee', pointerId: state.marquee.pointerId };
  }
  return null;
}
export {
  trackPointer,
  untrackPointer,
  getActiveTouchPointerIds,
  hasActivePen,
  getActiveGesturePointerId,
  canStartItemGesture,
  getEdgePanGesture
};
