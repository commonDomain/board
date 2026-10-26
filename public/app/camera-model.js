import { MIDDLE_DOUBLE_CLICK_DISTANCE } from './constants.js';
import { state } from './state.js';

function preventBrowserWheelZoom(event) {
  if (window.__independentNotesActive) return;
  if ((event.ctrlKey || event.metaKey) && event.cancelable) {
    event.preventDefault();
  }
}

function preventBrowserKeyboardZoom(event) {
  if (window.__independentNotesActive) return;
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }
  const browserZoomKeys = new Set(['+', '=', '-', '0']);
  const browserZoomCodes = new Set(['NumpadAdd', 'NumpadSubtract', 'Numpad0']);
  if (browserZoomKeys.has(event.key) || browserZoomCodes.has(event.code)) {
    event.preventDefault();
  }
}

function updateZoomLabel() {
  const slider = document.getElementById('canvasZoomSlider');
  const percent = Math.round(state.zoom * 100);
  if (slider) {
    const levels = zoomSliderLevels();
    const closestIndex = levels.reduce(
      (best, level, index) => (Math.abs(level - state.zoom) < Math.abs(levels[best] - state.zoom) ? index : best),
      0
    );
    slider.value = String(closestIndex);
    slider.style.setProperty('--zoom-slider-progress', `${closestIndex * 25}%`);
    slider.setAttribute('aria-valuetext', `${percent}%`);
  }
  document.querySelector('.zoom-slider-control .zoom-percent-value')?.replaceChildren(`${percent}%`);
}

function zoomSliderLevels() {
  return [0.25, 0.5, 1, 2, 4];
}

function captureCameraView() {
  return {
    zoom: state.zoom,
    rotation: state.rotation,
    camera: { x: state.camera.x, y: state.camera.y }
  };
}

function cameraViewMatches(view) {
  if (!view) return false;
  const cameraTolerance = MIDDLE_DOUBLE_CLICK_DISTANCE * 2;
  return (
    Math.abs(state.zoom - view.zoom) < 1e-6 &&
    Math.abs(state.rotation - view.rotation) < 1e-6 &&
    Math.hypot(state.camera.x - view.camera.x, state.camera.y - view.camera.y) <= cameraTolerance
  );
}

function boardToScreen(point) {
  const radians = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: state.camera.x + (point.x * cos - point.y * sin) * state.zoom,
    y: state.camera.y + (point.x * sin + point.y * cos) * state.zoom
  };
}
export {
  preventBrowserWheelZoom,
  preventBrowserKeyboardZoom,
  zoomSliderLevels,
  captureCameraView,
  cameraViewMatches,
  boardToScreen,
  updateZoomLabel
};
