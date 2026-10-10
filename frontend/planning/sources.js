import { sameHost } from './model.js';

const key = ref => `${ref.entityId}:${ref.nodeId || ''}`;
export function brainReferences(host, items) {
  const result = [];
  for (const item of items) if (item.type === 'mindmap') {
    const visit = node => { if (!node) return; result.push({ source: { ...host, entityId: item.id, nodeId: node.id }, taskRef: node.taskRef }); for (const child of node.children || []) visit(child); };
    visit(item.tree);
  }
  return result;
}
export function brainChanges(host, before, after) {
  const old = new Map(brainReferences(host, before).map(value => [key(value.source), value]));
  const next = new Map(brainReferences(host, after).map(value => [key(value.source), value]));
  const removedEntities = new Set(before.filter(item => item.type === 'mindmap' && !after.some(value => value.id === item.id && value.type === 'mindmap')).map(item => item.id));
  return { host, removedEntities, removed: new Set([...old.keys()].filter(id => !next.has(id))), restored: [...next.values()].filter(value => !old.has(key(value.source)) && value.taskRef) };
}
export function reconcileBrainSources(original, changes, restore = true, now = Date.now()) {
  const plan = structuredClone(original); let changed = false;
  const update = (task, active) => {
    const sources = (task.sources || []).filter(ref => !sameHost(ref, changes.host) || !changes.removedEntities.has(ref.entityId) && !changes.removed.has(key(ref)));
    if (restore && active) for (const value of changes.restored) if (value.taskRef.planId === plan.id && value.taskRef.taskId === task.id && !sources.some(ref => sameHost(ref, value.source) && key(ref) === key(value.source)) && sources.length < 100) sources.push(value.source);
    if (JSON.stringify(sources) === JSON.stringify(task.sources || [])) return;
    task.sources = sources; if (!sources.length) task.linked = false;
    else if (restore && changes.restored.some(value => value.taskRef.planId === plan.id && value.taskRef.taskId === task.id)) task.linked = true;
    task.revision++; task.updatedAt = now; changed = true;
  };
  for (const task of plan.tasks || []) update(task, true);
  for (const record of plan.deletedTasks || []) if (record.snapshot) update(record.snapshot, false);
  if (!changed) return null;
  plan.revision++; plan.updatedAt = now; return plan;
}
