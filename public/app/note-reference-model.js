// Shared reference lookup and change detection; no browser dependencies.
export function regionItems(items, bounds) {
  return items.filter(item => item.x < bounds.x + bounds.w && item.x + item.w > bounds.x && item.y < bounds.y + bounds.h && item.y + item.h > bounds.y);
}
export function regionRevision(items) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const text = JSON.stringify(canonical([...items].sort((a,b) => a.id.localeCompare(b.id))));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function notebookReferences(book, boardId, entityIds) {
  if (book.deleted) return [];
  const ids = new Set(entityIds);
  return book.pages.filter(page => !page.deleted).flatMap(page => page.elements.filter(element => {
    const origin = element.origin;
    return origin?.kind === 'canvas' && origin.boardId === boardId && (ids.has(origin.entityId) || origin.region?.entityIds.some(id => ids.has(id)));
  }).map(element => ({ notebookId: book.id, pageId: page.id, id: element.id, label: `${book.title} / ${page.title}` })));
}
