// Shared by the client and server: every mutation names the elements it owns.
function editOperationTargets(op, document, targets = new Set()) {
  if (!op || typeof op !== 'object') return targets;
  const add = id => { if (typeof id === 'string' && id) targets.add(id); };
  // Preserve a captured footprint after optimistic deletion/reparenting has
  // removed those members from the local document.
  for (const id of Object.keys(op.expectedMutations || {})) add(id);
  const container = (kind, id) => {
    if (!id) return;
    add(`${kind}:${id}`);
    const items = typeof document?.items?.get === 'function' ? document.items.values() : document?.items || [];
    const groups = typeof document?.groups?.get === 'function' ? [...document.groups.values()] : document?.groups || [];
    const descendants = new Set([id]);
    if (kind === 'group') {
      for (let changed = true; changed;) {
        changed = false;
        for (const group of groups) if (descendants.has(group.parentGroupId) && !descendants.has(group.id)) {
          descendants.add(group.id); changed = true;
        }
      }
    }
    for (const group of groups) if (kind === 'section' ? group.sectionId === id : descendants.has(group.id)) add(`group:${group.id}`);
    for (const item of items) if (kind === 'section' ? item.sectionId === id : descendants.has(item.groupId)) add(item.id);
  };
  if (op.kind === 'batch') for (const child of op.ops || []) editOperationTargets(child, document, targets);
  else if (op.kind === 'upsert') {
    add(op.item?.id);
    const old = typeof document?.items?.get === 'function' ? document.items.get(op.item?.id) : document?.items?.find(item => item.id === op.item?.id);
    for (const [field, prefix] of [['sectionId', 'section:'], ['groupId', 'group:']]) if (old?.[field] !== op.item?.[field]) {
      if (old?.[field]) add(prefix + old[field]);
      if (op.item?.[field]) add(prefix + op.item[field]);
    }
  }
  else if (op.kind === 'sheet-command') add(op.itemId);
  else if (['transform', 'layout'].includes(op.kind)) for (const item of op.items || []) add(item.id);
  else if (op.kind === 'delete') for (const id of op.ids || []) add(id);
  else if (op.kind === 'reparent') {
    for (const id of op.itemIds || []) add(id);
    if (op.sectionId) add(`section:${op.sectionId}`);
    if (op.groupId) add(`group:${op.groupId}`);
  }
  else if (op.kind === 'set-flags') for (const id of op.ids || []) {
    if (op.targetType === 'item') add(id); else container(op.targetType, id);
  }
  else if (op.kind === 'section-upsert') container('section', op.section?.id);
  else if (op.kind === 'group-upsert') container('group', op.group?.id);
  else if (op.kind === 'delete-container') container(op.targetType, op.id);
  else if (op.kind === 'settings') add('document:settings');
  else if (['clear', 'layers'].includes(op.kind)) add('*');
  return targets;
}

export { editOperationTargets };
