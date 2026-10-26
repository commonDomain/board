import { mutationEntities } from '../mutation-versions-model.js';

const RECOVERABLE_TYPES = new Set(['planning', 'ink', 'image', 'shape', 'text', 'note', 'table', 'mindmap', 'sheet', 'connector', 'sticker', 'kdocs', 'amap-map', 'amap-search', 'amap-route']);

function collectConflictItems(conflicts, queued, document = {}) {
  const items = new Map();
  const sources = mutationEntities(document);
  for (const entry of conflicts) for (const item of entry.objects || []) sources.set(item.id, item);
  const visit = op => {
    if (!op || typeof op !== 'object') return;
    if (op.kind === 'batch') { (op.ops || []).forEach(visit); return; }
    if (op.kind === 'upsert' && RECOVERABLE_TYPES.has(op.item?.type)) items.set(op.item.id, structuredClone(op.item));
    if (op.kind === 'section-upsert') items.set(`section:${op.section.id}`, structuredClone(op.section));
    if (op.kind === 'group-upsert') items.set(`group:${op.group.id}`, structuredClone(op.group));
    if (['transform', 'layout'].includes(op.kind)) for (const change of op.items || []) {
      const source = items.get(change.id) || sources.get(change.id);
      if (source) items.set(change.id, { ...structuredClone(source), ...change, __recoveryFields: Object.keys(change) });
    }
    if (op.kind === 'sheet-command') {
      const source = items.get(op.itemId) || sources.get(op.itemId);
      if (source) items.set(op.itemId, { ...structuredClone(source), ...(op.command?.workbook ? { workbook: structuredClone(op.command.workbook) } : {}) });
    }
    // A later local deletion wins over an older archived snapshot.
    if (op.kind === 'delete') for (const id of op.ids || []) items.set(id, null);
    if (op.kind === 'clear') for (const id of items.keys()) items.set(id, null);
  };
  conflicts.forEach(entry => visit(entry.operation));
  queued.forEach(entry => visit(entry.op));
  return items;
}

function recoveryItem(draft, current) {
  const item = structuredClone(draft);
  if (current && current.type !== item.type) throw new Error('原元素类型已变化，无法原位恢复；本地草稿仍保留');
  // Content recovery must not move the original or undo its current ownership.
  if (current) for (const key of ['x', 'y', 'w', 'h', 'rotation', 'z', 'layerId', 'sectionId', 'groupId', 'locked', 'hidden']) {
    if (!draft.__recoveryFields?.includes(key) && Object.hasOwn(current, key)) item[key] = structuredClone(current[key]);
  }
  delete item.__recoveryFields;
  item.contentVersion = current?.contentVersion || 0;
  if (current) item.mutationVersion = current.mutationVersion || 0;
  else delete item.mutationVersion;
  if (item.type === 'connector') item.fieldVersions = structuredClone(current?.fieldVersions || {});
  return item;
}

function replaceConflictOperations(serialized, replacements, createId) {
  const counts = new Map();
  const keys = op => op.kind === 'upsert' ? [op.item?.id] : op.kind === 'section-upsert' ? [`section:${op.section.id}`] :
    op.kind === 'group-upsert' ? [`group:${op.group.id}`] : op.kind === 'sheet-command' ? [op.itemId] : op.kind === 'delete' ? op.ids :
      ['transform', 'layout'].includes(op.kind) ? op.items.map(item => item.id) : [];
  const count = op => {
    if (op.kind === 'batch') return op.ops.forEach(count);
    for (const id of keys(op)) if (replacements.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
  };
  serialized.entries.forEach(entry => count(entry.op));
  const entries = [];
  const remainingExpectations = op => Object.fromEntries(Object.entries(op.expectedMutations || {}).filter(([id]) => !replacements.has(id)));
  for (const [id, op] of replacements) if (!counts.has(id) && op)
    entries.push({ opId: createId(), attempted: false, baseRevision: null, op: structuredClone(op) });
  for (const entry of serialized.entries) {
    let changed = false;
    const replace = op => {
      if (op.kind === 'batch') {
        const ops = op.ops.map(replace).filter(Boolean);
        return ops.length ? { ...op, ops, ...(op.expectedMutations ? { expectedMutations: remainingExpectations(op) } : {}) } : null;
      }
      const ids = keys(op).filter(id => replacements.has(id));
      if (!ids.length) return op;
      changed = true;
      const result = [];
      if (['transform', 'layout'].includes(op.kind)) {
        const items = op.items.filter(item => !replacements.has(item.id));
        if (items.length) result.push({ ...op, items, ...(op.expectedMutations ? { expectedMutations: remainingExpectations(op) } : {}) });
      }
      if (op.kind === 'delete') {
        const ids = op.ids.filter(id => !replacements.has(id));
        if (ids.length) result.push({ ...op, ids, ...(op.expectedMutations ? { expectedMutations: remainingExpectations(op) } : {}) });
      }
      for (const id of ids) {
        counts.set(id, counts.get(id) - 1);
        if (counts.get(id) === 0 && replacements.get(id)) result.push(structuredClone(replacements.get(id)));
      }
      return result.length > 1 ? { kind: 'batch', ops: result } : result[0] || null;
    };
    const op = replace(entry.op);
    if (!op) continue;
    entries.push(changed ? { opId: createId(), op, attempted: false, baseRevision: null } : entry);
  }
  return { ...serialized, entries };
}

export { collectConflictItems, recoveryItem, replaceConflictOperations };
