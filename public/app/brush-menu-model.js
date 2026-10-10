import { saveBrushPresets } from './background-model.js';
import { state } from './state.js';

function deleteBrushPreset(brushId, name) {
  state.brushPresets = state.brushPresets.filter(
    (preset) => !(preset && preset.brushId === brushId && preset.name === name)
  );
  if (state.activeBrushPresets[brushId] === name) delete state.activeBrushPresets[brushId];
  saveBrushPresets();
}

function closeBrushPresetMenu(restoreFocus = false) {
  const popup = state.brushPresetPopup;
  if (!popup) return;
  state.brushPresetPopup = null;
  popup.events.abort();
  popup.panel.remove();
  popup.trigger.setAttribute('aria-expanded', 'false');
  popup.trigger.removeAttribute('aria-controls');
  if (restoreFocus && popup.trigger.isConnected) popup.trigger.focus();
}

function createBrushPreviewCanvas(brush, settings) {
  const canvas = document.createElement('canvas');
  canvas.className = 'brush-preview';
  canvas.style.width = '56px';
  canvas.style.height = '28px';
  canvas.setAttribute('aria-hidden', 'true');
  renderBrushPreviewCanvas(canvas, brush, settings);
  return canvas;
}

function renderBrushPreviewCanvas(canvas, brush, settings) {
  const engine = window.WhiteboardBrushEngine;
  if (!engine?.render) {
    return;
  }
  engine.render(canvas, {
    points: [
      { x: 4, y: 19, pressure: 0.2, tiltX: -20, tiltY: 8, time: 0, pointerType: 'pen' },
      { x: 13, y: 12, pressure: 0.42, tiltX: -28, tiltY: 12, time: 12, pointerType: 'pen' },
      { x: 24, y: 20, pressure: 0.78, tiltX: -36, tiltY: 16, time: 24, pointerType: 'pen' },
      { x: 36, y: 16, pressure: 0.58, tiltX: -24, tiltY: 10, time: 36, pointerType: 'pen' },
      { x: 51, y: 10, pressure: 0.32, tiltX: -14, tiltY: 6, time: 52, pointerType: 'pen' }
    ],
    brushId: brush.id,
    color: '#111111',
    size: Math.max(1, 4 * brush.width),
    opacity: settings.opacity,
    settings,
    seed: 1234,
    complete: true,
    pixelRatio: 2,
    bounds: { x: 0, y: 0, width: 56, height: 28 },
    resize: true,
    clear: true
  });
}
export { deleteBrushPreset, closeBrushPresetMenu, renderBrushPreviewCanvas, createBrushPreviewCanvas };
