import { state } from './state.js';

function rememberCommittedOperation(opId) {
  if (typeof opId !== 'string') {
    return;
  }
  state.recentCommittedOpIds.add(opId);
  if (state.recentCommittedOpIds.size > 512) {
    state.recentCommittedOpIds.delete(state.recentCommittedOpIds.values().next().value);
  }
}

function operationFieldTargets(op, targets = []) {
  if (!op || typeof op !== 'object') return targets;
  if (op.kind === 'batch' && Array.isArray(op.ops)) {
    for (const subOp of op.ops) operationFieldTargets(subOp, targets);
    return targets;
  }
  if (op.kind === 'upsert' && op.item?.id) {
    const current = state.items.get(op.item.id);
    const activeBase = state.interaction?.beforeById?.get(op.item.id)?.values;
    const fields = Object.keys(op.item).filter((field) => {
      const baseline = Object.prototype.hasOwnProperty.call(activeBase || {}, field)
        ? activeBase[field]
        : current?.[field];
      return JSON.stringify(op.item[field]) !== JSON.stringify(baseline);
    });
    targets.push({ targetType: 'item', id: op.item.id, fields: new Set(fields) });
  } else if (op.kind === 'sheet-command' && op.itemId) {
    targets.push({ targetType: 'item', id: op.itemId, fields: new Set(['workbook']) });
  } else if ((op.kind === 'transform' || op.kind === 'layout') && Array.isArray(op.items)) {
    for (const item of op.items) targets.push({ targetType: 'item', id: item.id, fields: new Set(Object.keys(item)) });
  } else if (op.kind === 'section-upsert' && op.section?.id) {
    const current = state.sections.get(op.section.id);
    const activeBase =
      state.sectionInteraction?.sectionId === op.section.id ? state.sectionInteraction.beforeSection : null;
    const fields = Object.keys(op.section).filter((field) => {
      const baseline = Object.prototype.hasOwnProperty.call(activeBase || {}, field)
        ? activeBase[field]
        : current?.[field];
      return JSON.stringify(op.section[field]) !== JSON.stringify(baseline);
    });
    targets.push({ targetType: 'section', id: op.section.id, fields: new Set(fields) });
  } else if (op.kind === 'group-upsert' && op.group?.id) {
    targets.push({ targetType: 'group', id: op.group.id, fields: new Set(Object.keys(op.group)) });
  } else if (op.kind === 'settings') {
    targets.push({ targetType: 'document', id: 'document', fields: new Set(Object.keys(op.settings || {})) });
  } else if (op.kind === 'layers') {
    targets.push({ targetType: 'document', id: 'document', fields: new Set(['layers']) });
  } else if (op.kind === 'delete' && Array.isArray(op.ids)) {
    for (const id of op.ids) targets.push({ targetType: 'item', id, fields: null });
  } else if (op.kind === 'reparent' && Array.isArray(op.itemIds)) {
    for (const id of op.itemIds) targets.push({ targetType: 'item', id, fields: new Set(['sectionId', 'groupId']) });
  } else if (op.kind === 'set-flags' && Array.isArray(op.ids)) {
    const targetType = op.targetType === 'section' ? 'section' : op.targetType === 'item' ? 'item' : 'group';
    for (const id of op.ids) targets.push({ targetType, id, fields: new Set(Object.keys(op.flags || {})) });
  } else if (op.kind === 'delete-container' && op.id) {
    targets.push({ targetType: op.targetType, id: op.id, fields: null });
    const membershipField = op.targetType === 'section' ? 'sectionId' : 'groupId';
    for (const item of state.items.values()) {
      if (item[membershipField] !== op.id) continue;
      targets.push({ targetType: 'item', id: item.id, fields: op.cascade ? null : new Set([membershipField]) });
    }
  } else if (op.kind === 'clear') {
    targets.push({ targetType: '*', id: '*', fields: null });
  }
  return targets;
}

function historyFieldConflicts(change, field, targets) {
  return targets.some((target) => {
    if (target.targetType === '*') return true;
    if (target.targetType !== change.targetType || target.id !== change.id) return false;
    return field === '__entity' || !target.fields || target.fields.has(field);
  });
}

function requestResync() {
  if (state.resyncing || !state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }
  state.resyncing = true;
  state.socket.send(JSON.stringify({ type: 'resync', revision: state.revision }));
  const socket = state.socket;
  clearTimeout(state.resyncResponseTimer);
  state.resyncResponseTimer = setTimeout(() => {
    if (state.socket === socket && state.resyncing) socket.close(4000, 'Resync timeout');
  }, 30000);
}

function clearSyncRetry() {
  clearTimeout(state.syncRetryTimer);
  state.syncRetryTimer = null;
  state.syncRetryAttempt = 0;
}
export { rememberCommittedOperation, operationFieldTargets, historyFieldConflicts, requestResync, clearSyncRetry };
