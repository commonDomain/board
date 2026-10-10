import { servicesRuntime } from './runtime/services.js';
import { invalidatePlanningAccess } from './planning-events.js';
import { createHash } from 'node:crypto';
import { assetIdFromSource } from './asset-references.js';
import { notebookImages } from '../../frontend/notebook/model.js';

const fail = (statusCode, message, code = 'NOTEBOOK_SHARING_ERROR') => Object.assign(new Error(message), {statusCode, code});
export function notebookSharingGroup(userId) {
  const account = servicesRuntime.accountService;
  return account?.sharingEnabled ? account.groupForUser(userId)?.id || null : null;
}
export function ensureNotebookSharingSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notebook_page_shares (
    notebook_id TEXT NOT NULL, page_id TEXT NOT NULL, group_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(notebook_id,page_id), FOREIGN KEY(notebook_id) REFERENCES independent_notebooks(id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notebook_page_shares_group ON notebook_page_shares(group_id,notebook_id);`);
  if (!db.prepare('PRAGMA table_info(notebook_page_leases)').all().some(column => column.name === 'user_id')) {
    db.exec("ALTER TABLE notebook_page_leases ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
    db.exec('UPDATE notebook_page_leases SET user_id=(SELECT owner_user_id FROM independent_notebooks WHERE id=notebook_id)');
  }
}
const summaryColumns = 'id,owner_user_id,revision,deleted,updated_at,summary_json,lease_client,lease_until';
export function visibleNotebookRows(db, userId, summary = false) {
  const group = notebookSharingGroup(userId);
  const columns = summary ? summaryColumns.split(',').map(column=>`n.${column}`).join(',') : 'n.*';
  if (!group) return db.prepare(`SELECT ${columns} FROM independent_notebooks n WHERE owner_user_id=? ORDER BY updated_at DESC`).all(userId);
  return db.prepare(`SELECT ${columns} FROM independent_notebooks n WHERE n.owner_user_id=? OR (n.deleted=0 AND EXISTS (
    SELECT 1 FROM notebook_page_shares s JOIN share_members m ON m.user_id=n.owner_user_id AND m.group_id=s.group_id
    WHERE s.notebook_id=n.id AND s.group_id=?)) ORDER BY n.updated_at DESC`).all(userId, group)
    .filter(row=>row.owner_user_id===userId || JSON.parse(summary?row.summary_json:row.document_json).pages.some(page=>!page.deleted && notebookSharedPageIds(db,row,userId).has(page.id)));
}
export function notebookSharedPageIds(db, row, userId) {
  const group = notebookSharingGroup(userId);
  if (!group || notebookSharingGroup(row.owner_user_id) !== group || row.deleted) return new Set();
  return new Set(db.prepare('SELECT page_id FROM notebook_page_shares WHERE notebook_id=? AND group_id=?').all(row.id, group).map(entry => entry.page_id));
}
export function viewNotebook(db, row, userId, summary = false) {
  const book = JSON.parse(summary ? row.summary_json : row.document_json);
  const own = row.owner_user_id === userId;
  const shared = notebookSharedPageIds(db, row, userId);
  const ownerName = servicesRuntime.accountService?.publicUser?.(row.owner_user_id)?.username || '共享成员';
  const pages = book.pages.filter(page => own || !page.deleted && shared.has(page.id)).map(page => {
    const {sharing: _sharing, ...content} = page;
    return {...content, ...(shared.has(page.id) && !page.deleted ? {sharing: {ownerId: row.owner_user_id, ownerName, received: !own}} : {})};
  });
  if (!own && !pages.length) throw fail(404,'共享笔记不存在或共享已取消');
  const version = createHash('sha256').update(JSON.stringify([ownerName,own,pages.map(page=>[page.id,page.sharing])])).digest('hex');
  return {...book, pages, sections: own ? book.sections : book.sections.filter(section => pages.some(page => page.sectionId === section.id)),
    access: {ownerId: row.owner_user_id, ownerName, received: !own, version}};
}
export function accessibleNotebook(db, id, userId, summary = false) {
  const row = db.prepare(`SELECT ${summary?summaryColumns:'*'} FROM independent_notebooks WHERE id=?`).get(id);
  if (!row) throw fail(404,'笔记本不存在或无权访问');
  viewNotebook(db,row,userId,summary);
  return row;
}
export function discardRevokedNotebookLeases(db, row) {
  const pages = new Set(JSON.parse(row.document_json).pages.filter(page=>!page.deleted).map(page=>page.id));
  for (const lease of db.prepare('SELECT page_id,user_id FROM notebook_page_leases WHERE notebook_id=? AND user_id<>?').all(row.id,row.owner_user_id)) {
    if (!pages.has(lease.page_id) || !notebookSharedPageIds(db,row,lease.user_id).has(lease.page_id))
      db.prepare('DELETE FROM notebook_page_leases WHERE notebook_id=? AND page_id=? AND user_id=?').run(row.id,lease.page_id,lease.user_id);
  }
}
export function stripNotebookSharing(book) {
  if (!book || !Array.isArray(book.pages)) return book;
  const {access: _access, ...content} = book;
  return {...content, pages: book.pages.map(page => {if (!page)return page;const {sharing: _sharing, ...content} = page; return content;})};
}
export function canReadSharedNotebookAsset(db, userId, assetId) {
  const rows=db.prepare(`SELECT n.* FROM independent_notebooks n JOIN asset_references r ON r.owner_id=n.id
    WHERE r.owner_type='notebook' AND r.asset_id=? AND n.owner_user_id<>? AND n.deleted=0`).all(assetId,userId);
  return rows.some(row=>{try{return notebookImages(viewNotebook(db,row,userId)).some(image=>assetIdFromSource(image.src)===assetId);}catch{return false;}});
}
export function shareNotebookPage(db, userId, id, pageId, shared) {
  if (typeof shared !== 'boolean') throw fail(400,'共享设置无效');
  const row = db.prepare('SELECT * FROM independent_notebooks WHERE id=? AND owner_user_id=?').get(id,userId);
  if (!row) throw fail(404,'只有笔记所有者可以修改共享设置');
  const book = JSON.parse(row.document_json), page = book.pages.find(page => page.id === pageId && !page.deleted);
  if (book.deleted || !page) throw fail(404,'笔记已删除');
  const group = notebookSharingGroup(userId);
  if (shared && !group) throw fail(409,'请先在账号设置中创建或加入共享组','SHARING_GROUP_REQUIRED');
  const revision = row.revision + 1;
  book.revision = revision;
  const summary = JSON.parse(row.summary_json); summary.revision = revision;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (shared) db.prepare(`INSERT INTO notebook_page_shares VALUES(?,?,?,?) ON CONFLICT(notebook_id,page_id)
      DO UPDATE SET group_id=excluded.group_id,created_at=excluded.created_at`).run(id,pageId,group,Date.now());
    else db.prepare('DELETE FROM notebook_page_shares WHERE notebook_id=? AND page_id=?').run(id,pageId);
    db.prepare('UPDATE independent_notebooks SET revision=?,document_json=?,summary_json=?,updated_at=? WHERE id=?')
      .run(revision,JSON.stringify(book),JSON.stringify(summary),Date.now(),id);
    if (!shared) db.prepare('DELETE FROM notebook_page_leases WHERE notebook_id=? AND page_id=? AND user_id<>?').run(id,pageId,userId);
    db.exec('COMMIT');
  } catch (error) {if (db.isTransaction)db.exec('ROLLBACK'); throw error;}
  invalidatePlanningAccess(userId);
  return viewNotebook(db,{...row,revision,document_json:JSON.stringify(book)},userId);
}
export function sharedNotebookPatch(db, row, userId, body) {
  const existing = JSON.parse(row.document_json), visible = viewNotebook(db,row,userId);
  const patch = body.patch;
  if (!patch?.merge || !Array.isArray(patch.pages) || patch.pages.length > visible.pages.length ||
      new Set(patch.pages.map(page => page?.id)).size !== patch.pages.length || !patch.pageBases || patch.metadata !== undefined || patch.order !== undefined)
    throw fail(403,'共享成员只能编辑已共享笔记的内容和标题');
  const before = new Map(visible.pages.map(page => [page.id,page]));
  for (const page of patch.pages) {
    const current = before.get(page?.id);
    if (!current) throw fail(404,'这篇笔记未共享或共享已取消');
    for (const field of ['sectionId','deleted','favorite','createdAt']) if (page[field] !== current[field]) throw fail(403,'只有所有者可以移动、收藏或删除原笔记');
    if (patch.pageBases[page.id] !== (current.revision ?? existing.revision)) throw fail(409,'这篇共享笔记已更新，本地草稿已保留','NOTEBOOK_CONFLICT');
    const lease = db.prepare('SELECT 1 FROM notebook_page_leases WHERE notebook_id=? AND page_id=? AND user_id=? AND client_id=? AND expires_at>?')
      .get(row.id,page.id,userId,body.clientId,Date.now());
    if (!lease) throw fail(423,'请先获取这篇共享笔记的编辑锁','NOTEBOOK_LOCKED');
  }
  const changes = new Map(patch.pages.map(page => [page.id,page]));
  return {...existing, pages: existing.pages.map(page => changes.get(page.id) || page)};
}
