import { configureInteractions } from './composition/index.js';
import { initialize as initializeConnectors } from './connector/bootstrap.js';
import { state } from './state.js';
import { defaultLayers } from './preferences.js';
import { buildExportPngBlob } from './export.js';

// This document only renders a supplied snapshot. It never starts the account,
// canvas session, websocket, persistence or user-interaction lifecycle.
configureInteractions();
initializeConnectors();
window.MuseRegionRenderer = async ({ boardId, items, layers, background, bounds }) => {
  state.boardId = boardId;
  state.items = new Map(items.map(item => [item.id, item]));
  state.layers = layers?.length ? layers : defaultLayers();
  state.background = background || 'blank';
  state.sections = new Map();
  state.compatibilityReadOnly = true;
  const blob = await buildExportPngBlob(bounds, new Set(items.map(item => item.id)), null, { keepSectionIds: new Set(), maxSide: 1600 });
  if (state.renderErrorIds.size) throw new Error('部分画布内容无法生成预览，保留上次预览');
  return blob;
};
