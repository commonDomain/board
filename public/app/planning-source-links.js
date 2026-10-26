// Keep native and legacy lines in the same deletion/undo operation as a linked brain.
export function brainConnectorIds(items, removedIds) {
  const removed = new Set(removedIds), brains = new Set();
  const linked = node => Boolean(node?.taskRef?.planId && node.taskRef.taskId) || (node?.children || []).some(linked);
  for (const item of items) if (removed.has(item.id) && item.type === 'mindmap' && linked(item.tree)) brains.add(item.id);
  return [...items].filter(item => item.type === 'connector' && (
    brains.has(item.startId) || brains.has(item.endId) || ['source', 'target'].some(key => item[key]?.binding?.kind === 'item' && brains.has(item[key].binding.id))
  )).map(item => item.id);
}
