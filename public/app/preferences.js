import {
  BACKGROUND_PRESETS,
  DOCUMENT_BAR_COLLAPSED_KEY,
  TEXT_TOOLBAR_MODE_KEY,
  TOOL_DOCK_COLLAPSED_KEY
} from './constants.js';
import { clamp } from './utilities.js';

function defaultLayers() {
  return [{ id: 'layer_default', name: '图层 1', visible: true, opacity: 1, locked: false, blendMode: 'normal' }];
}

function loadToolDockCollapsedPreference() {
  try {
    return localStorage.getItem(TOOL_DOCK_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadDocumentBarCollapsedPreference() {
  try {
    return localStorage.getItem(DOCUMENT_BAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadTextToolbarMode() {
  try {
    return localStorage.getItem(TEXT_TOOLBAR_MODE_KEY) === 'panel' ? 'panel' : 'floating';
  } catch {
    return 'floating';
  }
}

function loadEraserSize() {
  try {
    const value = Number(localStorage.getItem('wb:eraserSize'));
    return Number.isFinite(value) && value >= 10 ? clamp(value, 10, 240) : 15;
  } catch {
    return 15;
  }
}

function loadBackgroundPreference() {
  try {
    const value = localStorage.getItem('wb:bg');
    return BACKGROUND_PRESETS[value] ? value : 'dots';
  } catch {
    return 'dots';
  }
}

// The deployment defaults are injected as `data-` attributes on <html>; a board
// that already stored its own switch value overrides them once it is loaded.
function wallpaperDriftDefault() {
  return document.documentElement?.dataset?.wallpaperDrift !== 'off';
}

function loadBrushSettings() {
  try {
    const raw = localStorage.getItem('wb:brushSettings');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadBrushPresets() {
  try {
    const raw = localStorage.getItem('wb:brushPresets');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export {
  defaultLayers,
  loadBackgroundPreference,
  loadBrushPresets,
  loadBrushSettings,
  loadDocumentBarCollapsedPreference,
  loadEraserSize,
  loadTextToolbarMode,
  loadToolDockCollapsedPreference,
  wallpaperDriftDefault
};
