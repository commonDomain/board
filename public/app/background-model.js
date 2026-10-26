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

// What a canvas background looks like behind a glass section backdrop: a photo, or a flat colour or
// light pattern that is light or dark. Glass over a flat light canvas needs its own visible structure.
function canvasSurfaceKind(value = state.background) {
  return getBackgroundImagePreset(value) ? 'image' : canvasTone(value);
}

// Whether the canvas reads light or dark, from the preset's base colour (photos carry their dominant
// tone there too); controls floating over the canvas pick their highlights from it.
function canvasTone(value = state.background) {
  const hex = /^#([0-9a-f]{6})$/i.exec(getBackgroundPreset(value).color)?.[1];
  if (!hex) return 'light';
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
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
  canvasSurfaceKind,
  canvasTone,
  wallpaperDriftParallax,
  wallpaperDriftProgress,
  saveBrushSettings,
  saveBrushPresets,
  numberOr
};
