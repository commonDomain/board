import { BACKGROUND_IMAGE_PRESETS, BACKGROUND_PRESETS, WALLPAPER_DRIFT_REACH } from './constants.js';
import { state } from './state.js';
import { clamp } from './utilities.js';

function getBackgroundPreset(value = state.background) {
  const type = typeof value === 'string' ? value : value?.type;
  return { ...(BACKGROUND_PRESETS[type] || BACKGROUND_PRESETS.dots) };
}

function getBackgroundImagePreset(value = state.background) {
  const type = typeof value === 'string' ? value : value?.type;
  return BACKGROUND_IMAGE_PRESETS[type] || null;
}

function wallpaperDriftParallax() {
  const percent = Number(document.documentElement?.dataset?.wallpaperParallax);
  return Number.isFinite(percent) ? clamp(percent, 0, 100) / 100 : 0.5;
}

function wallpaperDriftProgress(offset, extent) {
  const parallax = wallpaperDriftParallax();
  if (!(parallax > 0)) {
    return 0;
  }
  return Math.tanh((parallax * offset) / Math.max(1, extent * WALLPAPER_DRIFT_REACH));
}

function saveBrushSettings() {
  try {
    localStorage.setItem('wb:brushSettings', JSON.stringify(state.brushSettings));
  } catch {}
}

function saveBrushPresets() {
  try {
    localStorage.setItem('wb:brushPresets', JSON.stringify(state.brushPresets));
  } catch {}
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
export {
  getBackgroundPreset,
  getBackgroundImagePreset,
  wallpaperDriftParallax,
  wallpaperDriftProgress,
  saveBrushSettings,
  saveBrushPresets,
  numberOr
};
