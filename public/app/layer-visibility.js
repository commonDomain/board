
import { defaultLayers } from './preferences.js';
import { state } from './state.js';
import { clamp } from './utilities.js';
import { isLayerVisible } from './layers-model.js';

function normalizeClientLayers(input) {
  const list = Array.isArray(input) && input.length ? input : defaultLayers();
  const blendModes = new Set([
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light'
  ]);
  const seen = new Set();
  const layers = [];
  for (const [index, layer] of list.slice(0, 64).entries()) {
    if (!layer || typeof layer.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(layer.id) || seen.has(layer.id)) {
      continue;
    }
    seen.add(layer.id);
    const opacity = Number(layer.opacity);
    layers.push({
      id: layer.id,
      name: String(layer.name || `图层 ${index + 1}`).slice(0, 64),
      visible: layer.visible !== false,
      opacity: Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1,
      locked: Boolean(layer.locked),
      blendMode: blendModes.has(layer.blendMode) ? layer.blendMode : 'normal'
    });
  }
  if (!layers.length) {
    return defaultLayers();
  }
  return layers;
}

function isItemVisible(item) {
  if (!item || item.hidden || !isLayerVisible(item)) return false;
  
  const section = item.sectionId ? state.sections.get(item.sectionId) : null;
  if (section?.hidden || (section?.collapsed && !state.exporting)) return false;
  let group = item.groupId ? state.groups.get(item.groupId) : null;
  const visited = new Set();
  while (group && !visited.has(group.id)) {
    if (group.hidden) return false;
    visited.add(group.id);
    group = group.parentGroupId ? state.groups.get(group.parentGroupId) : null;
  }
  return true;
}
export { normalizeClientLayers, isItemVisible };
