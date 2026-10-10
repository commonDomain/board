import { serializeState } from '../state-codec.js';

import {AMAP_ITEM_TYPES} from './item-schema.js';
import {DOCUMENT_VERSION,MAX_BOARD_ITEMS,MAX_GROUPS,MAX_GROUP_DEPTH,MAX_SECTIONS,MAX_STATE_BYTES} from './config.js';
import { defaultSettings } from './document-defaults.js';
import { sanitizeLayers, sanitizeSettings } from './document-settings.js';
import { sanitizeItem } from './item-validation.js';
import { ProtocolError } from './protocol-error.js';
import { clampNumber, cleanString, isSafeId } from './validation.js';

function sanitizeSection(input, fallbackOrder = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = cleanString(input.id, 128, '');
  if (!isSafeId(id)) return null;
  return {
    id,
    name: cleanString(input.name, 100, `画框 ${fallbackOrder + 1}`).trim() || `画框 ${fallbackOrder + 1}`,
    x: clampNumber(input.x, -100000000, 100000000, 0),
    y: clampNumber(input.y, -100000000, 100000000, 0),
    w: clampNumber(input.w, 80, 1000000, 960),
    h: clampNumber(input.h, 60, 1000000, 540),
    order: Math.floor(clampNumber(input.order, 0, MAX_SECTIONS - 1, fallbackOrder)),
    navigatorOrder: clampNumber(input.navigatorOrder, -1000000000, 1000000000, fallbackOrder),
    collapsed: Boolean(input.collapsed),
    locked: Boolean(input.locked),
    lockChildren: Boolean(input.lockChildren),
    hidden: Boolean(input.hidden),
    style: {
      fill: cleanString(input.style?.fill, 64, '#ffffff') || '#ffffff',
      stroke: cleanString(input.style?.stroke, 64, '#94a3b8') || '#94a3b8',
      titleColor: cleanString(input.style?.titleColor, 64, '#334155') || '#334155'
    }
  };
}

function sanitizeGroup(input, fallbackOrder = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = cleanString(input.id, 128, '');
  if (!isSafeId(id)) return null;
  const parentGroupId =
    input.parentGroupId === null || input.parentGroupId === undefined
      ? null
      : cleanString(input.parentGroupId, 128, '');
  const sectionId =
    input.sectionId === null || input.sectionId === undefined ? null : cleanString(input.sectionId, 128, '');
  if ((parentGroupId && !isSafeId(parentGroupId)) || (sectionId && !isSafeId(sectionId))) return null;
  return {
    id,
    name: cleanString(input.name, 100, '分组').trim() || '分组',
    parentGroupId,
    sectionId,
    navigatorOrder: clampNumber(input.navigatorOrder, -1000000000, 1000000000, fallbackOrder),
    locked: Boolean(input.locked),
    hidden: Boolean(input.hidden)
  };
}

function validateGroupGraph(groups, sectionIds, boardId = 'board') {
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    if (group.sectionId && !sectionIds.has(group.sectionId)) {
      throw new Error(`Group section invariant failed for board ${boardId}`);
    }
    let cursor = group;
    const seen = new Set([group.id]);
    let depth = 0;
    while (cursor.parentGroupId) {
      const parent = byId.get(cursor.parentGroupId);
      if (!parent || seen.has(parent.id) || parent.sectionId !== group.sectionId) {
        throw new Error(`Group hierarchy invariant failed for board ${boardId}`);
      }
      seen.add(parent.id);
      cursor = parent;
      depth += 1;
      if (depth >= MAX_GROUP_DEPTH) {
        throw new Error(`Group hierarchy exceeds ${MAX_GROUP_DEPTH} levels for board ${boardId}`);
      }
    }
  }
  return byId;
}

function isItemLocked(state, item) {
  if (!item) return false;
  if (item.locked || state.layers.find((layer) => layer.id === item.layerId)?.locked) return true;
  const section = item.sectionId ? state.sections.find((entry) => entry.id === item.sectionId) : null;
  if (section?.lockChildren) return true;
  const groups = new Map(state.groups.map((group) => [group.id, group]));
  let group = item.groupId ? groups.get(item.groupId) : null;
  const visited = new Set();
  while (group && !visited.has(group.id)) {
    if (group.locked) return true;
    visited.add(group.id);
    group = group.parentGroupId ? groups.get(group.parentGroupId) : null;
  }
  return false;
}

function normalizeStoredState(input, boardId, revision) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![2, 3, 4, DOCUMENT_VERSION].includes(input.version)
  ) {
    throw new Error(`Stored state for board ${boardId} is invalid`);
  }
  const layers = sanitizeLayers(input.layers, { allowDefault: false });
  const layerIds = new Set(layers.map((layer) => layer.id));
  if (!Array.isArray(input.items) || input.items.length > MAX_BOARD_ITEMS) {
    throw new Error(`Stored items for board ${boardId} are invalid`);
  }
  if (
    !input.settings ||
    typeof input.settings !== 'object' ||
    Array.isArray(input.settings) ||
    !input.settings.background
  ) {
    throw new Error(`Stored settings for board ${boardId} are invalid`);
  }
  const itemIds = new Set();
  const sections =
    input.version === 2
      ? []
      : (Array.isArray(input.sections) ? input.sections : []).map((rawSection, index) =>
          sanitizeSection(rawSection, index)
        );
  if (sections.length > MAX_SECTIONS || sections.some((section) => !section)) {
    throw new Error(`Stored sections for board ${boardId} are invalid`);
  }
  const sectionIds = new Set();
  const sectionOrders = new Set();
  for (const section of sections) {
    if (sectionIds.has(section.id) || sectionOrders.has(section.order)) {
      throw new Error(`Stored section invariant failed for board ${boardId}`);
    }
    sectionIds.add(section.id);
    sectionOrders.add(section.order);
  }
  const groups =
    input.version === 2
      ? []
      : (Array.isArray(input.groups) ? input.groups : []).map((group, index) => sanitizeGroup(group, index));
  if (
    groups.length > MAX_GROUPS ||
    groups.some((group) => !group) ||
    new Set(groups.map((group) => group.id)).size !== groups.length
  ) {
    throw new Error(`Stored groups for board ${boardId} are invalid`);
  }
  const groupsById = validateGroupGraph(groups, sectionIds, boardId);
  const items = input.items.map((rawItem) => {
    const item = sanitizeItem(rawItem);
    if (
      !item ||
      itemIds.has(item.id) ||
      !layerIds.has(item.layerId) ||
      (item.sectionId && !sectionIds.has(item.sectionId)) ||
      (item.groupId && !groupsById.has(item.groupId)) ||
      (item.groupId && groupsById.get(item.groupId).sectionId !== item.sectionId)
    ) {
      throw new Error(`Stored item invariant failed for board ${boardId}`);
    }
    itemIds.add(item.id);
    return item;
  });
  const amapTypes = items.filter((item) => AMAP_ITEM_TYPES.has(item.type)).map((item) => item.type);
  if (new Set(amapTypes).size !== amapTypes.length) {
    throw new Error(`Stored navigation component invariant failed for board ${boardId}`);
  }
  const normalized = {
    version: DOCUMENT_VERSION,
    boardId,
    revision,
    savedAt: typeof input.savedAt === 'string' ? input.savedAt.slice(0, 40) : null,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
    items,
    sections,
    groups,
    layers,
    settings: sanitizeSettings(input.settings, defaultSettings())
  };
  
  return normalized;
}

function assertStateLimits(state) {
  if (state.items.length > MAX_BOARD_ITEMS) {
    throw new ProtocolError('ITEM_LIMIT', `A board can contain at most ${MAX_BOARD_ITEMS} items.`);
  }
  if (state.sections.length > MAX_SECTIONS || state.groups.length > MAX_GROUPS) {
    throw new ProtocolError('CONTAINER_LIMIT', 'Board organization exceeds its container limit.');
  }

  const sectionIds = new Set(state.sections.map((section) => section.id));
  const groups = validateGroupGraph(state.groups, sectionIds, state.boardId);
  for (const item of state.items) {
    if (
      (item.sectionId && !sectionIds.has(item.sectionId)) ||
      (item.groupId && (!groups.has(item.groupId) || groups.get(item.groupId).sectionId !== item.sectionId))
    ) {
      throw new ProtocolError('INVALID_OPERATION', 'Item and group must belong to the same existing frame.');
    }
  }
  const serialized = serializeState(state);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    throw new ProtocolError('STATE_TOO_LARGE', `Board state exceeds ${MAX_STATE_BYTES} bytes.`);
  }
  return serialized;
}

export { assertStateLimits, isItemLocked, normalizeStoredState, sanitizeGroup, sanitizeSection, validateGroupGraph };

