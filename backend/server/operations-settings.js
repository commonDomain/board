
import { ProtocolError } from './protocol-error.js';
import { defaultSettings } from './document-defaults.js';
import { isItemLocked } from './document-validation.js';
import { sanitizeLayers } from './document-settings.js';
import { sanitizeSettings } from './document-settings.js';

async function applyLayers(state, rawOperation, context) {
  const layers = sanitizeLayers(rawOperation.layers, { allowDefault: false });
  const nextLayerIds = new Set(layers.map((layer) => layer.id));
  if (state.layers.some((layer) => layer.locked && !nextLayerIds.has(layer.id))) {
    throw new ProtocolError('LAYER_LOCKED', 'Unlock a layer before deleting it.');
  }
  state.layers = layers;
  const validIds = new Set(layers.map((layer) => layer.id));
  const fallbackLayerId = layers[0].id;
  const reassigned = [];
  for (const item of state.items) {
    if (!validIds.has(item.layerId)) {
      item.layerId = fallbackLayerId;
      reassigned.push({ kind: 'upsert', item: structuredClone(item) });
    }
  }
  const layerOperation = { kind: 'layers', layers };
  return reassigned.length ? { kind: 'batch', ops: [layerOperation, ...reassigned] } : layerOperation;
}

async function applySettings(state, rawOperation, context) {
  const settings = sanitizeSettings(rawOperation.settings, state.settings || defaultSettings());
  state.settings = settings;
  return { kind: 'settings', settings };
}

async function applyClear(state, rawOperation, context) {
  if (state.items.some((item) => state.layers.find((layer) => layer.id === item.layerId)?.locked)) {
    throw new ProtocolError('LAYER_LOCKED', 'Unlock all layers before clearing the board.');
  }
  if (state.items.some((item) => isItemLocked(state, item))) {
    throw new ProtocolError('ITEM_LOCKED', 'Unlock all content before clearing the board.');
  }
  state.items = [];
  state.sections = [];
  state.groups = [];
  
  return { kind: 'clear' };
}

export { applyLayers, applySettings, applyClear };
