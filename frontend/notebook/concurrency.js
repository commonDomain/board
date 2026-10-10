import { clone } from './model.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function pageContent(page) {
  if (!page) return undefined;
  const { revision, sharing, ...content } = page;
  return content;
}
export function catalogContent(book) {
  const { pages, revision, catalogRevision, unloaded, access, ...metadata } = book;
  return { metadata, order: pages.map(page => page.id) };
}
export function notebookPatch(base, draft) {
  const previous = new Map(base.pages.map(page => [page.id, page]));
  const pages = draft.pages.filter(page => !equal(pageContent(previous.get(page.id)), pageContent(page)));
  const catalog = catalogContent(draft);
  return {
    merge: true,
    catalogBase: base.catalogRevision ?? base.revision,
    pageBases: Object.fromEntries(pages.map(page => [page.id, previous.has(page.id) ? previous.get(page.id).revision ?? base.revision : null])),
    pages,
    ...(equal(catalogContent(base), catalog) ? {} : catalog)
  };
}
// Merge independent pages while refusing to silently replace two edits to one page.
export function mergeNotebookDraft(base, draft, saved) {
  if (!base) {
    if (equal(draft, saved)) return clone(saved);
    throw Object.assign(new Error('另一窗口已保存更新，请保留草稿并另存副本'), { status: 409, local: true });
  }
  const localCatalog = catalogContent(draft), remoteCatalog = catalogContent(saved);
  const oldCatalog = catalogContent(base);
  const catalogChanged = !equal(oldCatalog, localCatalog);
  if (catalogChanged && !equal(oldCatalog, remoteCatalog) && !equal(localCatalog, remoteCatalog))
    throw Object.assign(new Error('笔记目录已在另一窗口更新，当前草稿仍保留'), { status: 409, local: true });
  const catalog = catalogChanged ? localCatalog : remoteCatalog;
  const old = new Map(base.pages.map(page => [page.id, page]));
  const local = new Map(draft.pages.map(page => [page.id, page]));
  const remote = new Map(saved.pages.map(page => [page.id, page]));
  const pages = catalog.order.map(id => {
    const before = old.get(id), own = local.get(id), other = remote.get(id);
    const changed = !equal(pageContent(before), pageContent(own));
    if (changed && !equal(pageContent(before), pageContent(other)) && !equal(pageContent(own), pageContent(other)))
      throw Object.assign(new Error('同一篇笔记已在另一窗口更新，当前草稿仍保留'), { status: 409, local: true });
    const page = changed ? own : other;
    if (!page) throw Object.assign(new Error('笔记已被删除，当前草稿仍保留'), { status: 409, local: true });
    return { ...clone(page), ...(other?.revision !== undefined ? { revision: other.revision } : {}) };
  });
  return { ...clone(catalog.metadata), ...(saved.access ? {access:clone(saved.access)} : {}), revision: saved.revision, catalogRevision: saved.catalogRevision,
    pages:pages.map(page=>({...page,...(remote.get(page.id)?.sharing?{sharing:clone(remote.get(page.id).sharing)}:{sharing:undefined})})) };
}
