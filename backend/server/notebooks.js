import { randomUUID, createHash } from 'node:crypto';
import { importPlanningSnapshots } from './planning.js';
import { reconcileSavedBrains } from './planning-sources.js';
import { brainConnectorIds } from '../../public/app/planning-source-links.js';
import { invalidatePlanning } from './planning-events.js';
import { ensurePlanningSchema, archiveHostPlans } from './planning-schema.js';
import { invalidateNotebookPlanning, invalidatePlanningAccess } from './planning-events.js';
import { servicesRuntime } from './runtime/services.js';
import { sendJson } from './http-response.js';
import { readJsonBody } from './http-body.js';
import { listCanvases } from './catalog.js';
import { requireCatalogBoardId } from './catalog-access.js';
import { getBoard } from './board-cache.js';
import { notebookReferences, regionItems, regionRevision } from '../../public/app/note-reference-model.js';
import { replaceAssetReferences, assetIdFromSource } from './asset-references.js';
import { validateNotebook, notebookImages, fromCanvas, toCanvas, sourceText, elementText } from '../../frontend/notebook/model.js';
import { pageContent, catalogContent } from '../../frontend/notebook/concurrency.js';
import { ensureNotebookSharingSchema, visibleNotebookRows, viewNotebook, accessibleNotebook, stripNotebookSharing, canReadSharedNotebookAsset, shareNotebookPage, sharedNotebookPatch, notebookSharingGroup, discardRevokedNotebookLeases } from './notebook-sharing.js';

export function ensureNotebookSchema(db) {
  ensurePlanningSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS independent_notebooks (
    id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, title TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, document_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    lease_client TEXT, lease_until INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX IF NOT EXISTS independent_notebooks_owner ON independent_notebooks(owner_user_id, updated_at);
  CREATE TABLE IF NOT EXISTS notebook_receipts (
    notebook_id TEXT NOT NULL, op_id TEXT NOT NULL, revision INTEGER NOT NULL,
    PRIMARY KEY(notebook_id, op_id), FOREIGN KEY(notebook_id) REFERENCES independent_notebooks(id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS notebook_search (
    notebook_id TEXT NOT NULL, page_id TEXT NOT NULL, element_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL, content TEXT NOT NULL,
    native INTEGER NOT NULL, PRIMARY KEY(notebook_id, page_id, element_id),
    FOREIGN KEY(notebook_id) REFERENCES independent_notebooks(id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notebook_search_owner ON notebook_search(owner_user_id, native, notebook_id, page_id, element_id);`);
  db.exec(`CREATE TABLE IF NOT EXISTS notebook_page_leases (
    notebook_id TEXT NOT NULL, page_id TEXT NOT NULL, client_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(notebook_id, page_id), FOREIGN KEY(notebook_id) REFERENCES independent_notebooks(id) ON DELETE CASCADE
  ) STRICT;`);
  ensureNotebookSharingSchema(db);
  const columns = db.prepare('PRAGMA table_info(independent_notebooks)').all();
  if (!columns.some(column => column.name === 'summary_json')) db.exec("ALTER TABLE independent_notebooks ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'");
  for (const row of db.prepare("SELECT id, owner_user_id, document_json FROM independent_notebooks WHERE summary_json = '{}' ").all()) {
    indexNotebook(db, row.owner_user_id, JSON.parse(row.document_json));
  }
}
function indexNotebook(db, owner, book) {
  if (book.deleted) archiveHostPlans(db, 'notebook', book.id);
  else {
    const pages = new Set(book.pages.filter(page => !page.deleted).map(page => page.id));
    for (const row of db.prepare("SELECT DISTINCT page_id FROM planning_documents WHERE host_kind='notebook' AND host_id=? AND archived=0").all(book.id)) if (!pages.has(row.page_id)) archiveHostPlans(db, 'notebook', book.id, row.page_id);
  }
  const summary = { ...book, unloaded: true, pages: book.pages.map(page => ({ ...page, elements: [], preview: page.elements.map(elementText).join(' · ').slice(0, 160) })) };
  db.prepare('UPDATE independent_notebooks SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), book.id);
  db.prepare('DELETE FROM notebook_search WHERE notebook_id = ?').run(book.id);
  if (book.deleted) return;
  const insert = db.prepare('INSERT INTO notebook_search VALUES(?,?,?,?,?,?,?,?)');
  for (const page of book.pages) {
    if (page.deleted) continue;
    insert.run(book.id, page.id, '', owner, 'page', `${book.title} / ${page.title}`, page.title, 0);
    for (const element of page.elements) insert.run(book.id, page.id, element.id, owner, element.type, `${book.title} / ${page.title}`, elementText(element).slice(0, 200000), element.origin.kind === 'native' ? 1 : 0);
  }
}
function error(status, message, code = 'NOTEBOOK_ERROR') { return Object.assign(new Error(message), { statusCode: status, code }); }
async function readNotebookBody(req, maximumBytes) {
  const body = await readJsonBody(req, maximumBytes);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, '笔记请求必须是 JSON 对象', 'INVALID_NOTEBOOK_REQUEST');
  return body;
}
export function rollbackNotebookTransaction(db, failure) {
  // SQLite can roll back automatically on SQLITE_FULL. A second ROLLBACK would
  // hide the actual failure and turn a recoverable storage error into a 500.
  if (db.isTransaction) { try { db.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ } }
  if (failure?.errcode === 13 || failure?.code === 'ENOSPC')
    throw Object.assign(error(507, '服务器存储空间不足，请稍后重试；本地草稿仍保留', 'STORAGE_FULL'), { expose: true });
  throw failure;
}
function referenceBoardId(value, userId) {
  try { return requireCatalogBoardId(value, userId); }
  catch { throw error(404, '来源画布已删除或无权访问'); }
}
function owned(db, id, userId) {
  const row = db.prepare('SELECT * FROM independent_notebooks WHERE id = ? AND owner_user_id = ?').get(id, userId);
  if (!row) throw error(404, '笔记本不存在或无权访问');
  return row;
}
export function canReadNotebookAsset(db, userId, assetId) {
  return Boolean(db.prepare(`SELECT 1 FROM asset_references r JOIN independent_notebooks n ON n.id = r.owner_id
    WHERE r.owner_type = 'notebook' AND r.asset_id = ? AND n.owner_user_id = ?`).get(assetId, userId)) || canReadSharedNotebookAsset(db,userId,assetId);
}
function authorizeImages(db, userId, book) {
  for (const image of notebookImages(book)) {
    const assetId = assetIdFromSource(image.src);
    image.assetId = assetId;
    const grant = db.prepare('SELECT 1 FROM asset_upload_grants WHERE asset_id = ? AND user_id = ? AND expires_at > ?').get(assetId, userId, Date.now());
    if (grant || canReadNotebookAsset(db, userId, assetId)) continue;
    const boards = db.prepare("SELECT owner_id FROM asset_references WHERE owner_type = 'board' AND asset_id = ?").all(assetId);
    if (!boards.some(row => servicesRuntime.accountService.canAccessBoard(userId, row.owner_id))) throw error(403, '无权复制这张图片');
  }
}
export function saveNotebook(db, userId, input, actorId = userId) {
  const { baseRevision, opId, clientId } = input;
  const book = stripNotebookSharing(input.notebook);
  validateNotebook(book);
  if (Buffer.byteLength(JSON.stringify(book)) > 24 * 1024 * 1024) throw error(413, '笔记本超过 24 MB，请拆分或导出');
  if (input.ownerId && input.ownerId !== actorId) throw error(403, '笔记账号已变更');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(opId || '') || !/^[a-zA-Z0-9_-]{1,80}$/.test(clientId || '')) throw error(400, '缺少操作标识');
  const row = db.prepare('SELECT * FROM independent_notebooks WHERE id = ?').get(book.id);
  if (row && row.owner_user_id !== userId) throw error(404, '笔记本不存在');
  if (!row && db.prepare('SELECT COUNT(*) AS n FROM independent_notebooks WHERE owner_user_id = ?').get(userId).n >= 200) throw error(409, '最多保存 200 本笔记，请清理回收站或导出');
  const receiptId = actorId === userId ? opId : `${actorId}:${opId}`;
  const receipt = db.prepare('SELECT revision FROM notebook_receipts WHERE notebook_id = ? AND op_id = ?').get(book.id, receiptId);
  if (receipt) return input.pageScoped ? { revision:row.revision,receiptRevision:receipt.revision,duplicate:true,notebook:JSON.parse(row.document_json) } : { revision: receipt.revision, duplicate: true };
  if (Number(baseRevision) !== Number(row?.revision || 0)) throw error(409, '笔记已在另一个窗口更新；本地草稿已保留', 'NOTEBOOK_CONFLICT');
  if (row?.lease_client && (row.lease_client !== clientId || actorId !== userId) && row.lease_until > Date.now()) throw error(423, '另一个窗口正在编辑此笔记本', 'NOTEBOOK_LOCKED');
  const previous = row ? JSON.parse(row.document_json) : null;
  for (const page of book.pages) {
    const beforePage = previous?.pages.find(value => value.id === page.id);
    const removed = (beforePage?.elements || []).filter(item => !page.elements.some(value => value.id === item.id));
    const lines = new Set(brainConnectorIds(beforePage?.elements || [], removed.map(item => item.id)));
    page.elements = page.elements.filter(item => !lines.has(item.id));
  }
  if (row) discardRevokedNotebookLeases(db,row);
  const before = new Map(previous?.pages.map(page => [page.id,page]) || []);
  const changedPages = book.pages.filter(page => JSON.stringify(pageContent(page)) !== JSON.stringify(pageContent(before.get(page.id))));
  const removedPages = previous?.pages.filter(page => !book.pages.some(entry => entry.id === page.id)) || [];
  const wholeBook = Boolean(previous && (book.deleted !== previous.deleted || JSON.stringify(book.sections) !== JSON.stringify(previous.sections)));
  const leases = db.prepare('SELECT page_id FROM notebook_page_leases WHERE notebook_id = ? AND (client_id <> ? OR user_id <> ?) AND expires_at > ?').all(book.id,clientId,actorId,Date.now());
  if (leases.some(lease => wholeBook || [...changedPages,...removedPages].some(page => page.id === lease.page_id)))
    throw error(423, '另一窗口正在编辑这篇笔记', 'NOTEBOOK_LOCKED');
  authorizeImages(db, actorId, actorId === userId ? book : {...book,pages:changedPages});
  const revision = Number(row?.revision || 0) + 1;
  const catalogChanged = !previous || JSON.stringify(catalogContent(book)) !== JSON.stringify(catalogContent(previous));
  const canonical = { ...book, revision, catalogRevision: catalogChanged ? revision : previous.catalogRevision ?? previous.revision,
    pages: book.pages.map(page => ({...page, revision: changedPages.includes(page) ? revision : before.get(page.id)?.revision ?? previous?.revision ?? revision})) };
  const leasePages=input.patch?.merge||input.pageScoped ? changedPages.filter(page=>row||!Array.isArray(input.leasePageIds)||input.leasePageIds.includes(page.id)) : [];
  const changedPlans = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO independent_notebooks(id, owner_user_id, title, revision, document_json, updated_at, deleted, lease_client, lease_until)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, revision=excluded.revision,
      document_json=excluded.document_json, updated_at=excluded.updated_at, deleted=excluded.deleted, lease_client=excluded.lease_client, lease_until=excluded.lease_until`)
      .run(book.id, userId, book.title, revision, JSON.stringify(canonical), Date.now(), book.deleted ? 1 : 0,
        input.patch?.merge || input.pageScoped ? row?.lease_client || null : clientId, input.patch?.merge || input.pageScoped ? row?.lease_until || 0 : Date.now() + 12000);
    for (const page of leasePages) db.prepare(`INSERT INTO notebook_page_leases(notebook_id,page_id,client_id,expires_at,user_id) VALUES(?,?,?,?,?)
      ON CONFLICT(notebook_id,page_id) DO UPDATE SET client_id=excluded.client_id,expires_at=excluded.expires_at,user_id=excluded.user_id`).run(book.id,page.id,clientId,Date.now()+12000,actorId);
    replaceAssetReferences('notebook', book.id, { items: notebookImages(book) });
    indexNotebook(db, userId, canonical);
    if(input.planning?.length){if(actorId!==userId||input.planning.some(plan=>plan.host?.kind!=='notebook'||plan.host.notebookId!==book.id))throw error(403,'只能随笔记导入本人的规划');importPlanningSnapshots(db,userId,input.planning,clientId);}
    db.prepare('INSERT INTO notebook_receipts(notebook_id, op_id, revision) VALUES(?, ?, ?)').run(book.id, receiptId, revision);
    db.prepare('DELETE FROM notebook_receipts WHERE notebook_id = ? AND revision < ?').run(book.id, Math.max(0, revision - 1000));
    for (const pageId of new Set([...(previous?.pages || []).map(page => page.id), ...book.pages.map(page => page.id)])) {
      const beforePage = previous?.pages.find(page => page.id === pageId), afterPage = canonical.pages.find(page => page.id === pageId);
      changedPlans.push(...reconcileSavedBrains(db, { kind: 'notebook', notebookId: book.id, pageId }, previous?.deleted || beforePage?.deleted ? [] : beforePage?.elements || [], book.deleted || afterPage?.deleted ? [] : afterPage?.elements || [], actorId));
    }
    db.exec('COMMIT');
  } catch (failure) { rollbackNotebookTransaction(db, failure); }
  invalidateNotebookPlanning(book.id);
  changedPlans.forEach(invalidatePlanning);
  if(book.deleted||removedPages.length||changedPages.some(page=>page.deleted))invalidatePlanningAccess(userId);
  return { revision, catalogRevision: canonical.catalogRevision, pageRevisions: Object.fromEntries(canonical.pages.map(page => [page.id,page.revision])),
    leasedPageIds:leasePages.map(page=>page.id),
    ...(input.merged ? {notebook:canonical} : {}) };
}
export async function handleNotebookApi(req, res, url) {
  if (!url.pathname.startsWith('/api/notebooks')) return false;
  const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: !['GET', 'HEAD'].includes(req.method) });
  if (!session?.userId) throw error(401, '请先登录');
  const db = servicesRuntime.database;
  const userId = session.userId;
  const saveForOwner = input => {
    const result = saveNotebook(db,userId,input);
    if (result.notebook) result.notebook=viewNotebook(db,owned(db,input.notebook.id,userId),userId);
    return result;
  };
  if (req.headers['x-notebook-owner'] && req.headers['x-notebook-owner'] !== userId) throw error(403, '笔记账号已变更');
  const sharingMatch = url.pathname.match(/^\/api\/notebooks\/([a-zA-Z0-9_-]{1,80})\/pages\/([a-zA-Z0-9_-]{1,80})\/sharing$/);
  if (sharingMatch && req.method === 'POST') {
    const body = await readNotebookBody(req);
    sendJson(res,200,{notebook:shareNotebookPage(db,userId,sharingMatch[1],sharingMatch[2],body.shared)}); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/notebooks/references') {
    const body = await readNotebookBody(req);
    const boardId = referenceBoardId(body.boardId, userId);
    if (!Array.isArray(body.entityIds) || body.entityIds.length > 5000) throw error(400, '选择内容无效');
    const references = visibleNotebookRows(db,userId).filter(row=>!row.deleted).flatMap(row => notebookReferences(viewNotebook(db,row,userId), boardId, body.entityIds));
    sendJson(res, 200, { references }); return true;
  }
  if (req.method === 'POST' && ['/api/notebooks/region-status', '/api/notebooks/region-preview'].includes(url.pathname)) {
    const body = await readNotebookBody(req);
    const boardId = referenceBoardId(body.boardId, userId);
    const b = body.bounds;
    if (!b || ['x','y','w','h'].some(key => !Number.isFinite(b[key]) || Math.abs(b[key]) > 1000000) || b.w <= 0 || b.h <= 0) throw error(400, '区域位置无效');
    const board = getBoard(boardId).state;
    const items = regionItems(board.items, b);
    sendJson(res, 200, { revision: regionRevision(items), empty: !items.length,
      ...(url.pathname.endsWith('/region-preview') ? { items, layers: board.layers, background: board.background } : {}) }); return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/notebooks') {
    const notebooks = visibleNotebookRows(db,userId,true).flatMap(row=>{try{return [viewNotebook(db,row,userId,true)];}catch{return [];}});
    const directoryVersion = createHash('sha256').update(JSON.stringify(notebooks)).digest('hex');
    if (url.searchParams.get('directoryVersion') === directoryVersion) { sendJson(res,200,{unchanged:true,directoryVersion}); return true; }
    sendJson(res, 200, { notebooks, directoryVersion }); return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/notebooks/materials') {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const type = url.searchParams.get('type') || '';
    const offset = Math.max(0, Math.min(1000000, parseInt(url.searchParams.get('offset'), 10) || 0));
    const canvases = listCanvases(userId).map(({id,name}) => ({id,name}));
    const visible = canvases.filter(canvas => !url.searchParams.get('boardId') || canvas.id === url.searchParams.get('boardId'));
    if (!visible.length) { sendJson(res, 200, { canvases, materials: [], next: null }); return true; }
    const placeholders = visible.map(() => '?').join(',');
    const rows = db.prepare(`SELECT d.target_id AS id, d.board_id AS boardId, c.name AS boardName, d.kind AS type,
      substr(CASE WHEN d.content = '' THEN d.label ELSE d.content END,1,250) AS label
      FROM search_documents d JOIN canvas_catalog c ON c.board_id = d.board_id
      WHERE d.board_id IN (${placeholders}) AND d.kind NOT IN ('canvas','group') AND (? = '' OR d.kind = ?)
      AND (? = '' OR instr(lower(d.content || ' ' || d.label || ' ' || c.name), lower(?)) > 0)
      ORDER BY d.board_id, d.document_id LIMIT 81 OFFSET ?`).all(...visible.map(canvas => canvas.id), type, type, query, query, offset);
    const previewBoards = new Map();
    const materials = rows.slice(0,80).map(row => {
      if (!['image','mindmap'].includes(row.type)) return row;
      if (!previewBoards.has(row.boardId)) previewBoards.set(row.boardId,getBoard(row.boardId).state.items);
      const item=previewBoards.get(row.boardId).find(item=>item.id===row.id);
      const preview=item?.type==='image'?{src:item.src}:item?.type==='mindmap'?{tree:{text:String(item.tree?.text||'').slice(0,100),children:(item.tree?.children||[]).slice(0,3).map(child=>({text:String(child.text||'').slice(0,80)}))}}:null;
      return {...row,preview};
    });
    sendJson(res, 200, { canvases, materials, next: rows.length > 80 ? offset + 80 : null }); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/notebooks/materials/convert') {
    const body = await readNotebookBody(req);
    const boardId = requireCatalogBoardId(body.boardId, userId);
    const board = getBoard(boardId);
    const source = board.state.items.find(item => item.id === body.entityId) || board.state.sections.find(section => section.id === body.entityId);
    if (!source) throw error(404, '源内容已被删除');
    const items = source.type ? [source] : [{ ...source, type: 'text', text: source.name }, ...board.state.items.filter(item => item.sectionId === source.id)];
    const elements = items.map(item => fromCanvas(item, { boardId, label: body.label || '' }, { x: 64 + Math.max(0, (item.x || 0) - (source.x || 0)), y: 64 + Math.max(0, (item.y || 0) - (source.y || 0)) }));
    // Grant access until the destination save establishes durable independent references.
    for (const image of elements.filter(element => element.type === 'image')) {
      const assetId = assetIdFromSource(image.src);
      if (assetId) db.prepare('INSERT INTO asset_upload_grants(asset_id, user_id, expires_at) VALUES(?, ?, ?) ON CONFLICT(asset_id, user_id) DO UPDATE SET expires_at = excluded.expires_at').run(assetId, userId, Date.now() + 86400000);
    }
    sendJson(res, 200, { elements }); return true;
  }
  if (req.method === 'GET' && ['/api/notebooks/originals', '/api/notebooks/search'].includes(url.pathname)) {
    const offset = Math.max(0, Math.min(1000000, parseInt(url.searchParams.get('offset'), 10) || 0));
    const query = (url.searchParams.get('q') || '').slice(0,100);
    const original = url.pathname.endsWith('/originals');
    const rows = db.prepare(`SELECT d.notebook_id AS notebookId, d.page_id AS pageId, d.element_id AS id, d.type, d.label,
      substr(d.content,max(1,instr(lower(d.content),lower(?))-40),180) AS text
      FROM notebook_search d JOIN independent_notebooks n ON n.id=d.notebook_id WHERE
      (d.owner_user_id=? OR n.deleted=0 AND EXISTS (SELECT 1 FROM notebook_page_shares s JOIN share_members m ON m.user_id=n.owner_user_id AND m.group_id=s.group_id
        WHERE s.notebook_id=d.notebook_id AND s.page_id=d.page_id AND s.group_id=?)) AND (?=0 OR d.native=1)
      AND (?='' OR instr(lower(d.content || ' ' || d.label),lower(?))>0)
      ORDER BY d.notebook_id,d.page_id,d.element_id LIMIT 81 OFFSET ?`).all(query,userId,notebookSharingGroup(userId),original?1:0,query,query,offset);
    sendJson(res, 200, { materials: rows.slice(0,80), next: rows.length > 80 ? offset + 80 : null }); return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/notebooks/originals/convert') {
    const body = await readNotebookBody(req);
    const row = accessibleNotebook(db, body.notebookId, userId);
    const book = viewNotebook(db,row,userId);
    const page = book.pages.find(page => page.id === body.pageId && !page.deleted);
    const element = page?.elements.find(element => element.id === body.elementId && element.origin.kind === 'native');
    if (book.deleted || !element) throw error(404, '笔记内容已删除');
    if (element.type === 'image') {
      const assetId = assetIdFromSource(element.src);
      if (assetId) db.prepare('INSERT INTO asset_upload_grants(asset_id, user_id, expires_at) VALUES(?, ?, ?) ON CONFLICT(asset_id, user_id) DO UPDATE SET expires_at = excluded.expires_at').run(assetId, userId, Date.now() + 86400000);
    }
    sendJson(res, 200, { item: toCanvas(element), copyId: randomUUID() }); return true;
  }
  const match = url.pathname.match(/^\/api\/notebooks\/([a-zA-Z0-9_-]{1,80})(\/lease)?$/);
  if (match) {
    if (req.method === 'GET') {
      const row = accessibleNotebook(db, match[1], userId,true);
      const summary=viewNotebook(db,row,userId,true);
      if (url.searchParams.has('revision')) {
        // Sharing changes and group membership can change the projection without a content edit.
        if (Number(url.searchParams.get('revision')) === row.revision && (url.searchParams.has('viewVersion') ? url.searchParams.get('viewVersion')===summary.access.version : row.owner_user_id===userId)) { sendJson(res,200,{unchanged:true,revision:row.revision}); return true; }
      }
      const notebook=viewNotebook(db,accessibleNotebook(db,match[1],userId),userId),visible=new Set(notebook.pages.map(page=>page.id));
      sendJson(res, 200, { notebook, leaseClient: row.owner_user_id===userId && row.lease_until > Date.now() ? row.lease_client : null,
        pageLeases:db.prepare('SELECT page_id AS pageId,client_id AS clientId,user_id AS userId,expires_at AS until FROM notebook_page_leases WHERE notebook_id=? AND expires_at>?').all(row.id,Date.now()).filter(lease=>visible.has(lease.pageId)) }); return true;
    }
    const body = await readNotebookBody(req, 24 * 1024 * 1024);
    if (!match[2] && req.method === 'DELETE') {
      const row = owned(db, match[1], userId);
      if (!row.deleted) throw error(409, '请先将笔记本移入回收站');
      if (row.revision !== body.baseRevision) throw error(409, '笔记本已更新，请刷新后再删除');
      if (row.lease_client && row.lease_client !== body.clientId && row.lease_until > Date.now()) throw error(423, '其他窗口正在编辑');
      if (db.prepare('SELECT 1 FROM notebook_page_leases WHERE notebook_id=? AND (client_id<>? OR user_id<>?) AND expires_at>?').get(row.id,body.clientId,userId,Date.now())) throw error(423,'其他窗口正在编辑');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("DELETE FROM asset_references WHERE owner_type = 'notebook' AND owner_id = ?").run(row.id);
        archiveHostPlans(db, 'notebook', row.id);
        db.prepare('DELETE FROM independent_notebooks WHERE id = ?').run(row.id);
        db.exec('COMMIT');
      } catch (failure) { rollbackNotebookTransaction(db, failure); }
      invalidatePlanningAccess(userId);sendJson(res, 200, { ok: true }); return true;
    }
    if (match[2] && req.method === 'POST') {
      const row = accessibleNotebook(db, match[1], userId);
      discardRevokedNotebookLeases(db,row);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.clientId || '')) throw error(400, '客户端标识无效');
      if (row.lease_until > Date.now() && (row.lease_client !== body.clientId || row.owner_user_id!==userId)) throw error(423, '另一个窗口正在编辑此笔记本');
      if (body.pageId !== undefined) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.pageId)) throw error(400,'笔记标识无效');
        const page=viewNotebook(db,row,userId).pages.find(page=>page.id===body.pageId);
        if (!page && row.owner_user_id!==userId) throw error(404,'这篇笔记未共享或共享已取消');
        if(!page&&!body.release)throw error(404,'笔记不存在');
        const lease=db.prepare('SELECT * FROM notebook_page_leases WHERE notebook_id=? AND page_id=?').get(row.id,body.pageId);
        if (body.release) {
          db.prepare('DELETE FROM notebook_page_leases WHERE notebook_id=? AND page_id=? AND client_id=? AND user_id=?').run(row.id,body.pageId,body.clientId,userId);
        } else {
          if (lease?.expires_at>Date.now() && (lease.client_id!==body.clientId || lease.user_id!==userId)) throw error(423,'另一成员或窗口正在编辑这篇笔记','NOTEBOOK_LOCKED');
          db.prepare('DELETE FROM notebook_page_leases WHERE notebook_id=? AND expires_at<=?').run(row.id,Date.now());
          db.prepare(`INSERT INTO notebook_page_leases(notebook_id,page_id,client_id,expires_at,user_id) VALUES(?,?,?,?,?) ON CONFLICT(notebook_id,page_id)
            DO UPDATE SET client_id=excluded.client_id,expires_at=excluded.expires_at,user_id=excluded.user_id`).run(row.id,body.pageId,body.clientId,Date.now()+12000,userId);
        }
        sendJson(res,200,{ok:true,leaseMs:12000,...(page&&!body.release&&body.includePage!==false?{page}: {})});return true;
      }
      if (row.owner_user_id!==userId) throw error(403,'共享成员不能锁定整个笔记本');
      if (!body.release && db.prepare('SELECT 1 FROM notebook_page_leases WHERE notebook_id=? AND (client_id<>? OR user_id<>?) AND expires_at>?').get(row.id,body.clientId,userId,Date.now())) throw error(423,'其他窗口正在编辑笔记');
      db.prepare('UPDATE independent_notebooks SET lease_client = ?, lease_until = ? WHERE id = ?').run(body.release ? null : body.clientId, body.release ? 0 : Date.now() + 12000, row.id);
      sendJson(res, 200, { ok: true, leaseMs:12000 }); return true;
    }
    if (req.method === 'PATCH') {
      const row = accessibleNotebook(db, match[1], userId); const existing = JSON.parse(row.document_json);
      if (row.owner_user_id!==userId) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.opId||'') || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.clientId||'')) throw error(400,'缺少操作标识');
        const receipt=db.prepare('SELECT revision FROM notebook_receipts WHERE notebook_id=? AND op_id=?').get(row.id,`${userId}:${body.opId}`);
        if (receipt) {sendJson(res,200,{revision:row.revision,receiptRevision:receipt.revision,duplicate:true,notebook:viewNotebook(db,row,userId)});return true;}
        const notebook=sharedNotebookPatch(db,row,userId,body);
        const result=saveNotebook(db,row.owner_user_id,{...body,notebook,baseRevision:row.revision,merged:true},userId);
        const saved=db.prepare('SELECT * FROM independent_notebooks WHERE id=?').get(row.id);
        sendJson(res,200,{...result,notebook:viewNotebook(db,saved,userId)});return true;
      }
      const patch = body.patch;
      if (patch?.merge) {
        const receipt=db.prepare('SELECT revision FROM notebook_receipts WHERE notebook_id=? AND op_id=?').get(row.id,body.opId);
        if(receipt){sendJson(res,200,{revision:row.revision,receiptRevision:receipt.revision,duplicate:true,notebook:viewNotebook(db,row,userId)});return true;}
        if(!Array.isArray(patch.pages)||patch.pages.length>10000||new Set(patch.pages.map(page=>page?.id)).size!==patch.pages.length||!patch.pageBases||typeof patch.pageBases!=='object') throw error(400,'笔记更新格式无效');
        const pages=new Map(existing.pages.map(page=>[page.id,page]));
        for(const page of patch.pages){
          const previous=pages.get(page?.id), base=patch.pageBases[page?.id];
          if(previous ? base!==(previous.revision??existing.revision) : base!==null) throw error(409,'这篇笔记已更新，本地草稿已保留','NOTEBOOK_CONFLICT');
          pages.set(page.id,page);
        }
        const catalogChanged=patch.metadata!==undefined||patch.order!==undefined;
        if(catalogChanged && (patch.metadata?.id!==row.id||!Array.isArray(patch.order)||patch.order.length>10000||new Set(patch.order).size!==patch.order.length)) throw error(400,'笔记目录格式无效');
        if(catalogChanged && patch.catalogBase!==(existing.catalogRevision??existing.revision)) throw error(409,'笔记目录已更新，本地草稿已保留','NOTEBOOK_CONFLICT');
        const order=catalogChanged?patch.order:existing.pages.map(page=>page.id);
        if(!catalogChanged&&patch.pages.some(page=>!existing.pages.some(entry=>entry.id===page.id))) throw error(400,'新增笔记必须提供目录');
        const notebook={...existing,...(catalogChanged?patch.metadata:{}),pages:order.map(id=>pages.get(id))};
        if(notebook.pages.some(page=>!page))throw error(400,'笔记页面不存在');
        sendJson(res,200,saveForOwner({...body,notebook,baseRevision:row.revision,merged:row.revision!==body.baseRevision}));return true;
      }
      if (!patch || patch.metadata?.id !== row.id || !Array.isArray(patch.pages) || !Array.isArray(patch.order) || patch.order.length > 10000 || new Set(patch.order).size !== patch.order.length) throw error(400,'笔记更新格式无效');
      const pages = new Map(existing.pages.map(page => [page.id,page]));
      for (const page of patch.pages) { if (!page?.id) throw error(400,'笔记页面无效'); pages.set(page.id,page); }
      const notebook = { ...existing, ...patch.metadata, pages: patch.order.map(id => pages.get(id)) };
      if (notebook.pages.some(page => !page)) throw error(400,'笔记页面不存在');
      sendJson(res,200,saveForOwner({...body,notebook})); return true;
    }
    if (req.method === 'PUT') {
      if (body.notebook?.id !== match[1]) throw error(400, '笔记本 ID 不匹配');
      sendJson(res, 200, saveForOwner(body)); return true;
    }
  }
  throw error(404, '笔记接口不存在');
}

