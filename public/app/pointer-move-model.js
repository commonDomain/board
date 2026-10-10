import { state } from './state.js';

function shouldCoalescePointerMove() {
  return Boolean(
    state.pinch ||
    state.panning ||
    state.marquee ||
    state.pendingCanvasIntent ||
    state.sectionInteraction ||
    state.pendingMove ||
    state.interaction
  );
}

function recordGestureFrameDuration(duration) {
  if (!Number.isFinite(duration)) return;
  state.gestureFrameDurations ||= [];
  state.gestureFrameDurations.push(duration);
  if (state.gestureFrameDurations.length > 60) state.gestureFrameDurations.shift();
  if (state.gestureFrameDurations.length >= 30) {
    const sorted = [...state.gestureFrameDurations].sort((left, right) => left - right);
    state.gestureFrameP95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
  }
}
export { shouldCoalescePointerMove, recordGestureFrameDuration };
