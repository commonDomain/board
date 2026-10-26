import { editOperationTargets } from './edit-lock-targets-model.js';

function mutationEntities(document) {
  const result = new Map();
  for (const [collection, prefix] of [['items', ''], ['sections', 'section:'], ['groups', 'group:']]) {
    const values = typeof document?.[collection]?.get === 'function' ? document[collection].values() : document?.[collection] || [];
    for (const value of values) result.set(prefix + value.id, value);
  }
  return result;
}

function prepareMutationVersions(operation, document, baselines = new Map()) {
  if (operation.expectedMutations) return operation;
  const entities = mutationEntities(document), explicit = new Map();
  const collect = op => {
    if (op.kind === 'batch') return op.ops.forEach(collect);
    if (op.kind === 'upsert') explicit.set(op.item.id, op.item);
    if (op.kind === 'section-upsert') explicit.set(`section:${op.section.id}`, op.section);
    if (op.kind === 'group-upsert') explicit.set(`group:${op.group.id}`, op.group);
  };
  collect(operation);
  const targets = editOperationTargets(operation, document);
  if (targets.delete('*')) for (const key of new Set([...entities.keys(), ...baselines.keys()])) targets.add(key);
  const expectedMutations = {};
  for (const key of targets) {
    if (key.startsWith('document:')) continue;
    const entity = explicit.get(key) || entities.get(key);
    expectedMutations[key] = Number.isSafeInteger(entity?.mutationVersion) ? entity.mutationVersion : baselines.get(key) ?? null;
  }
  return { ...operation, expectedMutations };
}

function mutationConflicts(operation, document) {
  const entities = mutationEntities(document), conflicts = new Set();
  const visit = op => {
    for (const [key, expected] of Object.entries(op.expectedMutations || {})) {
      const actual = entities.has(key) ? entities.get(key).mutationVersion || 0 : null;
      if (expected !== actual) conflicts.add(key);
    }
    if (op.kind === 'batch') op.ops.forEach(visit);
  };
  visit(operation);
  return [...conflicts];
}

// Version every entity changed by the canonical transaction, including derived
// connector/container changes, and publish those versions with the same ACK.
function stampMutationVersions(previous, next, canonical) {
  const before = mutationEntities(previous), after = mutationEntities(next), mutations = {};
  const content = entity => JSON.stringify(Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'mutationVersion')));
  for (const [key, entity] of after) {
    const old = before.get(key);
    const changed = !old || content(old) !== content(entity);
    // An ID can be restored after deletion. Its new incarnation must not reuse
    // an old version, or a stale offline write can pass the guard (ABA).
    // Existing versions are at most the board revision; a new entity starts
    // above that floor without storing deleted content or tombstones.
    entity.mutationVersion = old ? (old.mutationVersion || 0) + (changed ? 1 : 0) : (previous.revision || 0) + 1;
    if (changed) mutations[key] = entity.mutationVersion;
  }
  for (const key of before.keys()) if (!after.has(key)) mutations[key] = null;
  const stamp = op => {
    if (op.kind === 'batch') op.ops.forEach(stamp);
    if (op.item && after.has(op.item.id)) op.item.mutationVersion = after.get(op.item.id).mutationVersion;
    if (op.section && after.has(`section:${op.section.id}`)) op.section.mutationVersion = after.get(`section:${op.section.id}`).mutationVersion;
    if (op.group && after.has(`group:${op.group.id}`)) op.group.mutationVersion = after.get(`group:${op.group.id}`).mutationVersion;
    if (['transform', 'layout'].includes(op.kind)) for (const item of op.items || [])
      if (after.has(item.id)) item.mutationVersion = after.get(item.id).mutationVersion;
  };
  stamp(canonical);
  canonical.mutations = mutations;
  return mutations;
}

export { mutationEntities, prepareMutationVersions, mutationConflicts, stampMutationVersions };
