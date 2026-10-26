import ConnectorCore from '../../public/connector-core.js';
import { MAX_BOARD_ITEMS } from './config.js';
import { MAX_GROUPS } from './config.js';
import { MAX_SECTIONS } from './config.js';
import { ProtocolError } from './protocol-error.js';
import { cleanString } from './validation.js';
import { connectorEndpointsForState } from './operation-geometry.js';
import { isItemLocked } from './document-validation.js';
import { isSafeId } from './validation.js';
import { sanitizeGroup } from './document-validation.js';
import { sanitizeSection } from './document-validation.js';
import { validateGroupGraph } from './document-validation.js';

async function applySectionUpsert(state, rawOperation, context) {
  const index = state.sections.findIndex((section) => section.id === rawOperation.section?.id);
  const section = sanitizeSection(
    rawOperation.section,
    index >= 0 ? state.sections[index].order : state.sections.length
  );
  if (!section) throw new ProtocolError('INVALID_SECTION', 'Section is invalid.');
  if (index < 0 && state.sections.length >= MAX_SECTIONS) {
    throw new ProtocolError('SECTION_LIMIT', `A board can contain at most ${MAX_SECTIONS} sections.`);
  }
  if (index >= 0 && state.sections[index].locked) {
    throw new ProtocolError('SECTION_LOCKED', 'Unlock the section before changing it.');
  }
  if (index >= 0) state.sections[index] = section;
  else state.sections.push(section);
  state.sections.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  state.sections.forEach((entry, order) => {
    entry.order = order;
  });
  return { kind: 'section-upsert', section: structuredClone(state.sections.find((entry) => entry.id === section.id)) };
}

async function applyGroupUpsert(state, rawOperation, context) {
  const group = sanitizeGroup(rawOperation.group, state.groups.length);
  if (!group) throw new ProtocolError('INVALID_GROUP', 'Group is invalid.');
  const index = state.groups.findIndex((entry) => entry.id === group.id);
  if (index < 0 && state.groups.length >= MAX_GROUPS) {
    throw new ProtocolError('GROUP_LIMIT', `A board can contain at most ${MAX_GROUPS} groups.`);
  }
  if (index >= 0 && state.groups[index].locked) {
    throw new ProtocolError('GROUP_LOCKED', 'Unlock the group before changing it.');
  }
  const nextGroups = state.groups.slice();
  if (index >= 0) nextGroups[index] = group;
  else nextGroups.push(group);
  try {
    if (!context.depth)
      validateGroupGraph(nextGroups, new Set(state.sections.map((section) => section.id)), state.boardId);
  } catch (error) {
    throw new ProtocolError('INVALID_GROUP', error.message);
  }
  state.groups = nextGroups;
  return { kind: 'group-upsert', group };
}

async function applyReparent(state, rawOperation, context) {
  if (
    !Array.isArray(rawOperation.itemIds) ||
    !rawOperation.itemIds.length ||
    rawOperation.itemIds.length > MAX_BOARD_ITEMS
  ) {
    throw new ProtocolError('INVALID_OPERATION', 'Reparent item ids are invalid.');
  }
  const sectionId =
    rawOperation.sectionId === null || rawOperation.sectionId === undefined
      ? null
      : cleanString(rawOperation.sectionId, 128, '');
  const groupId =
    rawOperation.groupId === null || rawOperation.groupId === undefined
      ? null
      : cleanString(rawOperation.groupId, 128, '');
  const group = groupId ? state.groups.find((entry) => entry.id === groupId) : null;
  if (
    (sectionId && !state.sections.some((section) => section.id === sectionId)) ||
    (groupId && (!group || group.sectionId !== sectionId))
  ) {
    throw new ProtocolError('INVALID_OPERATION', 'Reparent target is invalid.');
  }
  const ids = [...new Set(rawOperation.itemIds.map((id) => cleanString(id, 128, '')))];
  if (ids.some((id) => !isSafeId(id))) throw new ProtocolError('INVALID_OPERATION', 'Reparent item id is invalid.');
  for (const id of ids) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) continue;
    if (isItemLocked(state, item)) throw new ProtocolError('ITEM_LOCKED', 'Locked content cannot be moved.');
    item.sectionId = sectionId;
    item.groupId = groupId;
  }
  return { kind: 'reparent', itemIds: ids, sectionId, groupId };
}

async function applySetFlags(state, rawOperation, context) {
  const targetType = rawOperation.targetType;
  if (
    !['item', 'section', 'group'].includes(targetType) ||
    !Array.isArray(rawOperation.ids) ||
    !rawOperation.ids.length
  ) {
    throw new ProtocolError('INVALID_OPERATION', 'Flag targets are invalid.');
  }
  const flags = {};
  if (Object.hasOwn(rawOperation.flags || {}, 'locked')) flags.locked = Boolean(rawOperation.flags.locked);
  if (Object.hasOwn(rawOperation.flags || {}, 'hidden')) flags.hidden = Boolean(rawOperation.flags.hidden);
  if (targetType === 'section') {
    if (Object.hasOwn(rawOperation.flags || {}, 'collapsed')) flags.collapsed = Boolean(rawOperation.flags.collapsed);
    if (Object.hasOwn(rawOperation.flags || {}, 'lockChildren'))
      flags.lockChildren = Boolean(rawOperation.flags.lockChildren);
  }
  if (!Object.keys(flags).length) throw new ProtocolError('INVALID_OPERATION', 'No supported flags were provided.');
  const collection = targetType === 'item' ? state.items : targetType === 'section' ? state.sections : state.groups;
  const ids = [...new Set(rawOperation.ids.map((id) => cleanString(id, 128, '')))];
  if (ids.some((id) => !isSafeId(id))) throw new ProtocolError('INVALID_OPERATION', 'Flag target id is invalid.');
  for (const entry of collection) if (ids.includes(entry.id)) Object.assign(entry, flags);
  return { kind: 'set-flags', targetType, ids, flags };
}

async function applyDeleteContainer(state, rawOperation, context) {
  const targetType = rawOperation.targetType;
  const id = cleanString(rawOperation.id, 128, '');
  const cascade = Boolean(rawOperation.cascade);
  const detached = [];
  const detachConnectors = (removedIds) => {
    for (const item of state.items) {
      if (item.type !== 'connector' || removedIds.has(item.id)) continue;
      const endpoints = connectorEndpointsForState(state, item);
      let changed = false;
      if (item.startId && removedIds.has(item.startId)) {
        item.startId = null;
        item.startX = endpoints.start.x;
        item.startY = endpoints.start.y;
        changed = true;
      }
      if (item.endId && removedIds.has(item.endId)) {
        item.endId = null;
        item.endX = endpoints.end.x;
        item.endY = endpoints.end.y;
        changed = true;
      }
      if (item.connectorVersion) {
        for (const key of ['source', 'target'])
          if (item[key]?.binding && removedIds.has(item[key].binding.id)) {
            item[key].status = 'orphan';
            item[key].fallback = endpoints[key === 'source' ? 'start' : 'end'];
            changed = true;
          }
        ConnectorCore.apply(item);
      }
      if (changed) detached.push({ kind: 'upsert', item: structuredClone(item) });
    }
  };
  if (!['section', 'group'].includes(targetType) || !isSafeId(id)) {
    throw new ProtocolError('INVALID_OPERATION', 'Container target is invalid.');
  }
  if (targetType === 'section') {
    const section = state.sections.find((entry) => entry.id === id);
    if (!section) return { kind: 'delete-container', targetType, id, cascade };
    if (section.locked) throw new ProtocolError('SECTION_LOCKED', 'Unlock the section before deleting it.');
    const groupIds = new Set(state.groups.filter((group) => group.sectionId === id).map((group) => group.id));
    if (cascade && state.items.some((item) => item.sectionId === id && isItemLocked(state, item))) {
      throw new ProtocolError('ITEM_LOCKED', 'Unlock section content before deleting it.');
    }
    if (cascade) detachConnectors(new Set(state.items.filter((item) => item.sectionId === id).map((item) => item.id)));
    state.items = cascade
      ? state.items.filter((item) => item.sectionId !== id)
      : state.items.map((item) => (item.sectionId === id ? { ...item, sectionId: null, groupId: null } : item));
    state.groups = state.groups.filter((group) => !groupIds.has(group.id));
    state.sections = state.sections.filter((entry) => entry.id !== id);
    state.sections.forEach((entry, order) => {
      entry.order = order;
    });
  } else {
    const group = state.groups.find((entry) => entry.id === id);
    if (!group) return { kind: 'delete-container', targetType, id, cascade };
    if (group.locked) throw new ProtocolError('GROUP_LOCKED', 'Unlock the group before deleting it.');
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of state.groups)
        if (entry.parentGroupId && descendants.has(entry.parentGroupId) && !descendants.has(entry.id)) {
          descendants.add(entry.id);
          changed = true;
        }
    }
    if (cascade && state.items.some((item) => descendants.has(item.groupId) && isItemLocked(state, item))) {
      throw new ProtocolError('ITEM_LOCKED', 'Unlock group content before deleting it.');
    }
    if (cascade) {
      detachConnectors(new Set(state.items.filter((item) => descendants.has(item.groupId)).map((item) => item.id)));
      state.items = state.items.filter((item) => !descendants.has(item.groupId));
      state.groups = state.groups.filter((entry) => !descendants.has(entry.id));
    } else {
      state.items = state.items.map((item) => (item.groupId === id ? { ...item, groupId: group.parentGroupId } : item));
      state.groups = state.groups
        .filter((entry) => entry.id !== id)
        .map((entry) => (entry.parentGroupId === id ? { ...entry, parentGroupId: group.parentGroupId } : entry));
    }
  }
  const deleteOperation = { kind: 'delete-container', targetType, id, cascade };
  return detached.length ? { kind: 'batch', ops: [deleteOperation, ...detached] } : deleteOperation;
}

export { applySectionUpsert, applyGroupUpsert, applyReparent, applySetFlags, applyDeleteContainer };
