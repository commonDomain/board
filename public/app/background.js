import { pushUndoSnapshot } from './history-controller.js';
import { applyCamera } from './camera.js';
import { isRemoteBoardLocked } from './connection-model.js';
import { BACKGROUND_PRESETS, backgroundImageLoads } from './constants.js';
import { els } from './elements.js';
import { getBrush } from './format-actions-model.js';
import { loadImage } from './image-upload-model.js';
import { markDirty } from './save-status.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { buildBackgroundMenu } from './toolbar-model.js';
import { clamp, staticAssetUrl } from './utilities.js';
import {
  getBackgroundPreset,
  getBackgroundImagePreset,
  wallpaperDriftProgress,
  saveBrushSettings,
  numberOr
} from './background-model.js';

function loadBackgroundImage(preset) {
  if (!preset?.asset) return Promise.reject(new Error('Background image is unavailable'));
  if (!backgroundImageLoads.has(preset.asset)) {
    const pending = loadImage(staticAssetUrl(preset.asset)).catch((error) => {
      backgroundImageLoads.delete(preset.asset);
      throw error;
    });
    backgroundImageLoads.set(preset.asset, pending);
  }
  return backgroundImageLoads.get(preset.asset);
}

function applyGridWallpaperDrift(cameraX, cameraY) {
  const layer = els.gridLayer;
  if (!layer) {
    return;
  }
  if (!getBackgroundImagePreset() || !state.backgroundDrift || !els.viewport) {
    layer.style.backgroundPosition = '';
    return;
  }
  const width = els.viewport.clientWidth;
  const height = els.viewport.clientHeight;
  const driftX = wallpaperDriftProgress(cameraX - width / 2, width);
  const driftY = Math.max(0, wallpaperDriftProgress(cameraY - height / 2, height));
  layer.style.backgroundPosition = `${(50 + 50 * driftX).toFixed(2)}% ${(100 - 100 * driftY).toFixed(2)}%`;
}

function syncBackgroundDriftControl() {
  const toggle = els.backgroundDriftToggle;
  if (!toggle) {
    return;
  }
  const available = Boolean(getBackgroundImagePreset());
  const enabled = state.backgroundDrift === true;
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.disabled = !available;
  toggle.title = available ? '高清图景随画布平移产生轻微视差' : '选择高清图景后可用';
  if (els.backgroundDriftLabel) {
    els.backgroundDriftLabel.textContent = enabled ? '关闭背景漂移' : '开启背景漂移';
  }
}

function setBackgroundDrift(enabled) {
  if (isRemoteBoardLocked()) return false;
  const next = enabled === true;
  if (!getBackgroundImagePreset() || next === state.backgroundDrift) {
    return false;
  }
  pushUndoSnapshot();
  state.backgroundDrift = next;
  applyBackground();
  enqueueOperation({ kind: 'settings', settings: { backgroundDrift: next } });
  markDirty(true);
  return true;
}

function getBrushSettings(brushId = state.brushType) {
  const brush = getBrush(brushId);
  const saved = state.brushSettings[brush.id] || {};
  return {
    smooth: clamp(numberOr(saved.smooth, brush.smooth ?? 0.3), 0, 1),
    pressure: clamp(numberOr(saved.pressure, brush.pressureAmount ?? (brush.pressure ? 0.8 : 0.3)), 0, 1),
    pressureGamma: clamp(numberOr(saved.pressureGamma, 1), 0.2, 4),
    flow: clamp(numberOr(saved.flow, 1), 0.01, 1),
    grain: clamp(numberOr(saved.grain, brush.grain ?? 0.6), 0, 1),
    jitter: clamp(numberOr(saved.jitter, brush.jitter ?? 0), 0, 1),
    spacing: clamp(numberOr(saved.spacing, brush.spacing ?? 1), 0.25, 2),
    opacity: clamp(numberOr(saved.opacity, brush.opacity ?? 1), 0.05, 1),
    nibAngle: numberOr(saved.nibAngle, brush.nibAngle ?? -55)
  };
}

function setBrushSetting(key, value) {
  const brush = getBrush();
  state.brushSettings[brush.id] = state.brushSettings[brush.id] || {};
  state.brushSettings[brush.id][key] = Number(value);
  saveBrushSettings();
}

function setBackground(value) {
  if (isRemoteBoardLocked()) return false;
  if (!BACKGROUND_PRESETS[value] || value === state.background) {
    return false;
  }
  pushUndoSnapshot();
  state.background = value;
  applyBackground();
  buildBackgroundMenu();
  enqueueOperation({ kind: 'settings', settings: { background: getBackgroundPreset(value) } });
  markDirty(true);
  return true;
}

function applyBackground() {
  if (els.viewport) {
    els.viewport.dataset.bg = state.background;
  }
  try {
    localStorage.setItem('wb:bg', state.background);
  } catch {}
  syncBackgroundDriftControl();
  applyCamera();
}
export {
  loadBackgroundImage,
  applyGridWallpaperDrift,
  syncBackgroundDriftControl,
  setBackgroundDrift,
  getBrushSettings,
  setBrushSetting,
  setBackground,
  applyBackground
};
