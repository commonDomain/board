import { state } from './state.js';

function canReplayPendingOperation(operation) {
  const model = {
    layers: new Map(state.layers.map((layer) => [layer.id, { ...layer }])),
    items: new Map(Array.from(state.items.values(), (item) => [item.id, item.layerId]))
  };
  return canApplyPendingOperation(operation, model);
}

function canApplyPendingOperation(operation, model) {
  if (!operation || typeof operation !== 'object') {
    return false;
  }
  if (operation.kind === 'batch') {
    if (!Array.isArray(operation.ops)) {
      return false;
    }
    for (const child of operation.ops) {
      if (!canApplyPendingOperation(child, model)) {
        return false;
      }
    }
    return true;
  }
  if (operation.kind === 'layers') {
    if (!Array.isArray(operation.layers) || !operation.layers.length) {
      return false;
    }
    const nextLayers = new Map(operation.layers.map((layer) => [layer.id, { ...layer }]));
    for (const [id, layer] of model.layers) {
      if (layer.locked && !nextLayers.has(id)) {
        return false;
      }
    }
    model.layers = nextLayers;
    const fallbackLayerId = operation.layers[0].id;
    for (const [id, layerId] of model.items) {
      if (!nextLayers.has(layerId)) {
        model.items.set(id, fallbackLayerId);
      }
    }
    return true;
  }
  if (operation.kind === 'upsert') {
    const itemId = operation.item?.id;
    const targetLayerId = operation.item?.layerId;
    const existingLayer = model.layers.get(model.items.get(itemId));
    const targetLayer = model.layers.get(targetLayerId);
    if (!itemId || !targetLayer || targetLayer.locked || existingLayer?.locked) {
      return false;
    }
    model.items.set(itemId, targetLayerId);
    return true;
  }
  if (operation.kind === 'sheet-command') {
    const layerId = model.items.get(operation.itemId);
    return Boolean(layerId && !model.layers.get(layerId)?.locked);
  }
  if (operation.kind === 'delete') {
    if (!Array.isArray(operation.ids)) {
      return false;
    }
    for (const id of operation.ids) {
      if (model.layers.get(model.items.get(id))?.locked) {
        return false;
      }
      model.items.delete(id);
    }
    return true;
  }
  if (operation.kind === 'clear') {
    if (Array.from(model.items.values()).some((layerId) => model.layers.get(layerId)?.locked)) {
      return false;
    }
    model.items.clear();
    return true;
  }
  return true;
}
export { canApplyPendingOperation, canReplayPendingOperation };
