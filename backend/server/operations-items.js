import ConnectorCore from '../../public/connector-core.js';
import { MAX_BOARD_ITEMS } from './config.js';
import { ProtocolError } from './protocol-error.js';
import SheetProtocol from '../../public/sheet-protocol.js';
import { clampNumber } from './validation.js';
import { cleanString } from './validation.js';
import { connectorEndpointsForState } from './operation-geometry.js';
import { isItemLocked } from './document-validation.js';
import { isSafeId } from './validation.js';
import { itemIndex } from './operation-geometry.js';
import { prepareItem } from './item-assets.js';
import { brainConnectorIds } from '../../public/app/planning-source-links.js';

async function applySheetCommand(state, rawOperation, context) {
  const itemId = cleanString(rawOperation.itemId, 128, '');
  const index = itemIndex(state, itemId);
  const item = index >= 0 ? state.items[index] : null;
  if (!item || item.type !== 'sheet') throw new ProtocolError('SHEET_NOT_FOUND', 'Spreadsheet no longer exists.');
  if (isItemLocked(state, item))
    throw new ProtocolError('ITEM_LOCKED', 'Locked spreadsheet content cannot be changed.');
  let command;
  try {
    command = SheetProtocol.applyCanonicalCommand(item, rawOperation.command, { canonical: false });
    SheetProtocol.inspectWorkbook(item.workbook);
  } catch (error) {
    throw new ProtocolError(error.code || 'INVALID_SHEET_COMMAND', error.message);
  }
  item.contentVersion = Math.max(0, Number(item.contentVersion) || 0) + 1;
  return { kind: 'sheet-command', itemId, command, contentVersion: item.contentVersion };
}

async function applyUpsert(state, rawOperation, context) {
  let rawItem = rawOperation.item;
  const previous = state.items.find((entry) => entry.id === rawItem?.id);
  if (rawOperation.connectorPatch) {
    if (!previous || previous.type !== 'connector')
      throw new ProtocolError('CONNECTOR_CONFLICT', 'The connection no longer exists.');
    rawItem = structuredClone(previous);
    ConnectorCore.apply(rawItem);
    const fields = rawOperation.connectorPatch.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields))
      throw new ProtocolError('INVALID_OPERATION', 'Invalid connector patch.');
    for (const key of Object.keys(fields)) {
      if (!['source', 'target', 'route', 'style', 'labels', 'relation'].includes(key))
        throw new ProtocolError('INVALID_OPERATION', 'Invalid connector field.');
      if (rawOperation.connectorPatch.expected?.[key] !== rawItem.fieldVersions[key])
        throw new ProtocolError(
          'CONNECTOR_CONFLICT',
          'This part of the connection was changed. Your local draft has been retained.'
        );
      rawItem[key] = fields[key];
      rawItem.fieldVersions[key]++;
    }
  }
  const item = await prepareItem(rawItem, { userId: context.userId });
  const contentChanged =
    previous &&
    ['text', 'note', 'table', 'mindmap', 'sheet'].includes(item.type) &&
    JSON.stringify([previous.text, previous.richText, previous.rows, previous.tree, previous.workbook]) !==
      JSON.stringify([item.text, item.richText, item.rows, item.tree, item.workbook]);
  if (contentChanged) {
    const expected = rawOperation.baseContentVersion ?? rawOperation.item.contentVersion;
    if (expected !== undefined && expected !== (previous.contentVersion || 0))
      throw new ProtocolError('CONTENT_CONFLICT', 'The content was changed. Your local draft has been retained.');
    item.contentVersion = (previous.contentVersion || 0) + 1;
  }
  const targetLayer = state.layers.find((layer) => layer.id === item.layerId);
  if (!targetLayer) {
    throw new ProtocolError('INVALID_LAYER', `Layer ${item.layerId} does not exist.`);
  }
  const index = itemIndex(state, item.id);
  const existingLayer = index >= 0 ? state.layers.find((layer) => layer.id === state.items[index].layerId) : null;
  const targetGroup = item.groupId ? state.groups.find((group) => group.id === item.groupId) : null;
  if (item.sectionId && !state.sections.some((section) => section.id === item.sectionId)) {
    throw new ProtocolError('INVALID_SECTION', 'The target section does not exist.');
  }
  if (item.groupId && (!targetGroup || targetGroup.sectionId !== item.sectionId)) {
    throw new ProtocolError('INVALID_GROUP', 'The target group does not exist in the selected section.');
  }
  if (targetLayer.locked || existingLayer?.locked) {
    throw new ProtocolError('LAYER_LOCKED', 'Locked layer content cannot be changed.');
  }
  if (index >= 0 && isItemLocked(state, state.items[index])) {
    throw new ProtocolError('ITEM_LOCKED', 'Locked content cannot be changed.');
  }
  if (index >= 0) {
    state.items[index] = item;
  } else {
    if (state.items.length >= MAX_BOARD_ITEMS) {
      throw new ProtocolError('ITEM_LIMIT', `A board can contain at most ${MAX_BOARD_ITEMS} items.`);
    }
    state.items.push(item);
  }
  const related = previous && item.type !== 'connector' ? ConnectorCore.reconcile(state.items, previous, item) : [];
  for (const update of (Array.isArray(rawOperation.connectorGeometry) ? rawOperation.connectorGeometry : []).slice(
    0,
    MAX_BOARD_ITEMS
  )) {
    const connection = state.items.find(
      (entry) => entry.id === update.id && entry.type === 'connector' && entry.connectorVersion
    );
    if (!connection) continue;
    for (const key of ['source', 'target']) {
      if (connection[key]?.binding?.kind !== 'item' || connection[key].binding.id !== item.id || !update[key]) continue;
      connection[key].fallback = ConnectorCore.point(update[key]);
      if (!related.includes(connection)) related.push(connection);
    }
    ConnectorCore.apply(connection);
  }
  return related.length
    ? {
        kind: 'batch',
        ops: [{ kind: 'upsert', item }, ...related.map((item) => ({ kind: 'upsert', item: structuredClone(item) }))]
      }
    : { kind: 'upsert', item };
}

async function applyTransform(state, rawOperation, context) {
  if (!Array.isArray(rawOperation.items) || !rawOperation.items.length || rawOperation.items.length > MAX_BOARD_ITEMS) {
    throw new ProtocolError('INVALID_OPERATION', 'Transform items are invalid.');
  }
  const changes = [];
  const seen = new Set();
  for (const rawChange of rawOperation.items) {
    const id = cleanString(rawChange?.id, 128, '');
    if (!isSafeId(id) || seen.has(id)) throw new ProtocolError('INVALID_OPERATION', 'Transform item id is invalid.');
    seen.add(id);
    const item = state.items.find((entry) => entry.id === id);
    if (!item) continue;
    if (isItemLocked(state, item)) throw new ProtocolError('ITEM_LOCKED', 'Locked content cannot be transformed.');
    const change = {
      id,
      x: clampNumber(rawChange.x, -100000000, 100000000, item.x),
      y: clampNumber(rawChange.y, -100000000, 100000000, item.y),
      w: clampNumber(rawChange.w, 8, 1000000, item.w),
      h: clampNumber(rawChange.h, 8, 1000000, item.h),
      rotation: clampNumber(rawChange.rotation, -36000, 36000, item.rotation)
    };
    Object.assign(item, change);
    changes.push(change);
  }
  return { kind: rawOperation.kind, items: changes, direction: cleanString(rawOperation.direction, 16, '') };
}

async function applyDelete(state, rawOperation, context) {
  if (!Array.isArray(rawOperation.ids) || !rawOperation.ids.length || rawOperation.ids.length > MAX_BOARD_ITEMS) {
    throw new ProtocolError('INVALID_OPERATION', 'Delete ids are invalid.');
  }
  const ids = [];
  const seen = new Set();
  for (const id of rawOperation.ids) {
    if (!isSafeId(id)) {
      throw new ProtocolError('INVALID_OPERATION', 'Delete id is invalid.');
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  for (const id of brainConnectorIds(state.items, ids)) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  for (const item of state.items) {
    if (seen.has(item.id) && state.layers.find((layer) => layer.id === item.layerId)?.locked) {
      throw new ProtocolError('LAYER_LOCKED', 'Locked layer content cannot be deleted.');
    }
    if (seen.has(item.id) && isItemLocked(state, item)) {
      throw new ProtocolError('ITEM_LOCKED', 'Locked content cannot be deleted.');
    }
  }
  const detached = [];
  for (const item of state.items) {
    if (item.type !== 'connector' || seen.has(item.id)) continue;
    const endpoints = connectorEndpointsForState(state, item);
    let changed = false;
    if (item.startId && seen.has(item.startId)) {
      item.startId = null;
      item.startX = endpoints.start.x;
      item.startY = endpoints.start.y;
      changed = true;
    }
    if (item.endId && seen.has(item.endId)) {
      item.endId = null;
      item.endX = endpoints.end.x;
      item.endY = endpoints.end.y;
      changed = true;
    }
    if (item.connectorVersion) {
      for (const key of ['source', 'target'])
        if (item[key]?.binding && seen.has(item[key].binding.id)) {
          item[key].status = 'orphan';
          item[key].fallback = endpoints[key === 'source' ? 'start' : 'end'];
          changed = true;
        }
      ConnectorCore.apply(item);
    }
    if (changed) detached.push({ kind: 'upsert', item: structuredClone(item) });
  }
  state.items = state.items.filter((item) => !seen.has(item.id));
  const deleteOperation = { kind: 'delete', ids };
  return detached.length ? { kind: 'batch', ops: [deleteOperation, ...detached] } : deleteOperation;
}

export { applySheetCommand, applyUpsert, applyTransform, applyDelete };
