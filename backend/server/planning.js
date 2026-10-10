import { PLANNING_ENABLED } from './config.js';
import { servicesRuntime } from './runtime/services.js';
import { notebookSharedPageIds } from './notebook-sharing.js';
import { boards } from './board-registry.js';
import { getBoard } from './board-cache.js';
import { currentBoardEditLease } from './board-lock.js';
import { invalidatePlanning } from './planning-events.js';
import { sendJson } from './http-response.js';
import { readJsonBody } from './http-body.js';
import { applyOperation, createPlan, fail, host, safeId, sameHost, progress } from '../../frontend/planning/model.js';
import { archiveHostPlans } from './planning-schema.js';
import { createHash } from 'node:crypto';
import { sanitizeSnapshot } from '../../frontend/planning/transfer.js';

export function importPlanningSnapshots(db,userId,inputs,clientId) {
  if(!Array.isArray(inputs)||inputs.length>500||new Set(inputs.map(plan=>plan?.id)).size!==inputs.length||!safeId(clientId))throw fail('规划导入包无效或标识重复');
  const plans=inputs.map(input=>sanitizeSnapshot(input,userId));
  for(const plan of plans){if(planningHostAccess(db,plan.host,userId,true,clientId)!==userId)throw fail('请导入到自己的内容',403);for(const task of plan.tasks)for(const ref of task.sources)planningHostAccess(db,ref,userId,true,clientId);}
  const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');
  try{for(const plan of plans){const existing=db.prepare('SELECT owner_user_id FROM planning_documents WHERE id=?').get(plan.id);if(existing){const receipt=db.prepare('SELECT request_json FROM planning_operations WHERE plan_id=? AND actor_id=? AND op_id=?').get(plan.id,userId,`import_${plan.id}`);const hash=`sha256:${createHash('sha256').update(JSON.stringify(inputs.find(p=>p.id===plan.id))).digest('hex')}`;if(existing.owner_user_id!==userId||receipt?.request_json!==hash)throw fail('规划导入标识冲突',409);continue;}if(db.prepare('SELECT COUNT(*) AS n FROM planning_documents WHERE owner_user_id=? AND archived=0').get(userId).n>=500)throw fail('活动规划已满，请先归档');save(db,plan);db.prepare('INSERT INTO planning_operations VALUES(?,?,?,?,?,?)').run(plan.id,userId,`import_${plan.id}`,`sha256:${createHash('sha256').update(JSON.stringify(inputs.find(p=>p.id===plan.id))).digest('hex')}`,plan.revision,Date.now());}if(own)db.exec('COMMIT');return plans.map(plan=>exposed(db,read(db,plan.id,userId),userId));}catch(error){if(own&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}

export function planningHostAccess(db, value, userId, write = false, clientId = null) {
  const target = host(value), account = servicesRuntime.accountService;
  if (target.kind === 'canvas') {
    const row = db.prepare('SELECT owner_user_id FROM canvas_catalog WHERE board_id=?').get(target.boardId);
    if (!row || !row.owner_user_id || !account.canAccessBoard(userId, target.boardId)) throw fail('宿主不存在或无权访问', 404, 'PLAN_FORBIDDEN');
    if (write) {
      const board = boards.get(target.boardId), lease = board && currentBoardEditLease(board);
      if (lease && (lease.clientId !== clientId || ![...(board.clients || [])].some(client => client.id === clientId && client.userId === userId))) throw fail('宿主画布正在被另一窗口编辑，草稿已保留', 423, 'PLAN_HOST_LOCKED');
    }
    return row.owner_user_id;
  }
  const row = db.prepare('SELECT * FROM independent_notebooks WHERE id=?').get(target.notebookId);
  if (!row || row.deleted) throw fail('宿主笔记不存在或无权访问', 404, 'PLAN_FORBIDDEN');
  const book = JSON.parse(row.document_json), page = book.pages.find(p => p.id === target.pageId && !p.deleted);
  if (!page || row.owner_user_id !== userId && !notebookSharedPageIds(db, row, userId).has(page.id)) throw fail('宿主笔记不存在或无权访问', 404, 'PLAN_FORBIDDEN');
  if (write) {
    const lease = db.prepare('SELECT * FROM notebook_page_leases WHERE notebook_id=? AND page_id=? AND expires_at>?').get(row.id, page.id, Date.now());
    if (row.lease_until > Date.now() && (row.lease_client !== clientId || row.owner_user_id !== userId) || lease && (lease.user_id !== userId || lease.client_id !== clientId)) throw fail('宿主笔记正在被另一窗口编辑，草稿已保留', 423, 'PLAN_HOST_LOCKED');
    if (row.owner_user_id !== userId && !lease) throw fail('请先取得共享笔记编辑锁', 423, 'PLAN_HOST_LOCKED');
  }
  return row.owner_user_id;
}
export function planningMembers(userId) {
  const account = servicesRuntime.accountService, group = account.sharingEnabled && account.groupForUser(userId);
  const ids = group ? servicesRuntime.database.prepare('SELECT user_id FROM share_members WHERE group_id=?').all(group.id).map(r => r.user_id) : [userId];
  return [...new Set([userId, ...ids])].map(value => account.publicUser(value)).filter(Boolean);
}
function save(db, plan) {
  db.prepare(`INSERT INTO planning_documents VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    host_kind=excluded.host_kind,host_id=excluded.host_id,page_id=excluded.page_id,revision=excluded.revision,
    archived=excluded.archived,document_json=excluded.document_json,updated_at=excluded.updated_at`).run(plan.id, plan.ownerId, plan.host.kind, plan.host.boardId || plan.host.notebookId, plan.host.pageId || null, plan.revision, Number(plan.archived), JSON.stringify(plan), plan.updatedAt);
}
function read(db, id, userId, write, clientId) {
  const row = db.prepare('SELECT * FROM planning_documents WHERE id=?').get(id);
  if (!row) throw fail('规划不存在或无权访问', 404, 'PLAN_FORBIDDEN');
  const plan = JSON.parse(row.document_json);
  if (plan.archived) { if (plan.ownerId !== userId) throw fail('规划不存在或无权访问', 404, 'PLAN_FORBIDDEN'); }
  else planningHostAccess(db, plan.host, userId, write, clientId);
  return plan;
}
function exposed(db, plan, userId) {
  const result = structuredClone(plan);
  const cache = new Map(),contentCache=new Map();
  for (const task of [...result.tasks, ...(result.deletedTasks || []).map(record => record.snapshot).filter(Boolean)]) {
    let hidden = false, pending = false, unavailable = false;
    task.sources = (task.sources || []).filter(value => {
      try {
        const key=JSON.stringify(host(value)); if (!cache.has(key)) { planningHostAccess(db,value,userId); cache.set(key,true); }
        const content=sourceContent(db,value,true,contentCache), ref=content?.taskRef || content?.attrs?.taskRef;
        if (!content) return false;
        if (ref?.planId !== plan.id || ref?.taskId !== task.id) pending = true;
        return true;
      } catch(error) { if ([403,404].includes(error.statusCode)) { hidden=true;return false; } unavailable=true;return true; }
    });
    task.linkState = unavailable ? 'unavailable' : pending ? 'pending' : task.sources.length ? 'linked' : hidden ? 'restricted' : 'none';
    if (task.linked && (pending || !task.sources.length && !hidden)) task.linked=false;
  }
  result.checkedAt=Date.now();
  result.sourceVersion=createHash('sha256').update(JSON.stringify(result.tasks.map(t=>[t.id,t.linkState,t.linked,t.sources]))).digest('hex');
  return result;
}
function sourceContent(db, source, linked = true, cache = new Map()) {
  const key=JSON.stringify(host(source));
  if(!cache.has(key)){
  if (source.kind === 'canvas' && !db.prepare('SELECT 1 FROM canvas_catalog WHERE board_id=?').get(source.boardId)) return null;
  const items = source.kind === 'canvas' ? getBoard(source.boardId).state.items : (() => {
    const row = db.prepare('SELECT document_json,deleted FROM independent_notebooks WHERE id=?').get(source.notebookId);
    return row && !row.deleted ? JSON.parse(row.document_json).pages.find(page => page.id === source.pageId && !page.deleted)?.elements || [] : [];
  })();
  cache.set(key,new Map(items.map(item=>[item.id,item])));
  }
  const item=cache.get(key).get(source.entityId);if(!item||!source.nodeId||!linked)return item;
  const nodeKey=`${key}:${source.entityId}`;if(!cache.has(nodeKey)){const nodes=new Map();const visit=value=>{if(!value)return;if(value.id)nodes.set(value.id,value);if(value.attrs?.planningNodeId)nodes.set(value.attrs.planningNodeId,value);for(const child of value.children||value.content||[])visit(child);};visit(item.tree||item.doc);cache.set(nodeKey,nodes);}return cache.get(nodeKey).get(source.nodeId);
}
export function planningRows(db,userId) {
  const account=servicesRuntime.accountService, group=account.sharingEnabled && account.groupForUser(userId)?.id || '';
  if (!group) return db.prepare('SELECT * FROM planning_documents WHERE owner_user_id=? ORDER BY updated_at DESC,id DESC').all(userId);
  return db.prepare(`SELECT p.* FROM planning_documents p WHERE p.owner_user_id=? OR (p.archived=0 AND (
    (p.host_kind='canvas' AND EXISTS(SELECT 1 FROM canvas_catalog c WHERE c.board_id=p.host_id AND
      (c.owner_user_id=? OR (c.visibility='shared' AND EXISTS(SELECT 1 FROM share_members m WHERE m.user_id=c.owner_user_id AND m.group_id=?))))) OR
    (p.host_kind='notebook' AND EXISTS(SELECT 1 FROM independent_notebooks n JOIN notebook_page_shares s ON s.notebook_id=n.id
      JOIN share_members m ON m.user_id=n.owner_user_id AND m.group_id=s.group_id
      WHERE n.id=p.host_id AND n.deleted=0 AND s.page_id=p.page_id AND s.group_id=?))
  )) ORDER BY p.updated_at DESC,p.id DESC`).all(userId,userId,group,group);
}
export function listPlans(db, userId, options = {}) {
  const result = [];
  for (const row of options.rows || planningRows(db,userId)) {
    let plan;try { plan=JSON.parse(row.document_json); } catch { options.issues?.push({id:row.id,code:'PLAN_DOCUMENT_DAMAGED',message:'规划读取失败，原数据已保留'});continue; }
    if (plan.purged) continue;
    if (!plan.archived) {
      let missing;try { missing = plan.host.kind === 'canvas'
        ? !db.prepare('SELECT 1 FROM canvas_catalog WHERE board_id=?').get(plan.host.boardId)
        : (() => { const book = db.prepare('SELECT document_json,deleted FROM independent_notebooks WHERE id=?').get(plan.host.notebookId); return !book || book.deleted || !JSON.parse(book.document_json).pages.some(p => p.id === plan.host.pageId && !p.deleted); })();
      } catch { options.issues?.push({id:plan.id,code:'PLAN_HOST_UNAVAILABLE',message:'所属内容暂时无法读取'});continue; }
      if (missing && plan.ownerId===userId) { archiveHostPlans(db, plan.host.kind, plan.host.boardId || plan.host.notebookId, plan.host.pageId); plan = JSON.parse(db.prepare('SELECT document_json FROM planning_documents WHERE id=?').get(plan.id).document_json); }
    }
    try {
      read(db, plan.id, userId);
      result.push(exposed(db, plan, userId));
    } catch(error) { if (![403,404].includes(error.statusCode)) options.issues?.push({id:plan.id,code:'PLAN_READ_FAILED',message:'规划暂时无法读取，缓存保留'}); }
  }
  return result;
}
function mutatePlanInside(db, userId, planId, body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('规划请求无效');
  if (!safeId(body.opId) || !safeId(body.clientId)) throw fail('缺少有效操作标识');
  const existing = db.prepare('SELECT * FROM planning_documents WHERE id=?').get(planId);
  if (existing) read(db, planId, userId, true, body.clientId);
  else if (!creating) throw fail('规划不存在', 404);
  const receipt = db.prepare('SELECT request_json FROM planning_operations WHERE plan_id=? AND actor_id=? AND op_id=?').get(planId, userId, body.opId);
  const request = JSON.stringify(creating ? body.plan : body.operation);
  const signature=`sha256:${createHash('sha256').update(request).digest('hex')}`;
  if (receipt) { if (receipt.request_json !== signature && receipt.request_json !== request) throw fail('操作标识已用于其他请求', 409); return exposed(db, read(db, planId, userId), userId); }
  let plan;
  if (creating) {
    if (existing) throw fail('规划标识已存在', 409);
    plan = createPlan({ ...body.plan, id: planId }, userId);
    plan.ownerId = planningHostAccess(db, plan.host, userId, true, body.clientId);
    if (db.prepare('SELECT COUNT(*) AS count FROM planning_documents WHERE owner_user_id=? AND archived=0').get(plan.ownerId).count >= 500) throw fail('最多保存 500 份活动规划，请先归档');
  } else {
    let current = JSON.parse(existing.document_json); const operations = body.operation?.type==='task.batch' ? body.operation.operations : [body.operation];
    if (!Array.isArray(operations) || !operations.length || operations.length>100 || body.operation?.type==='task.batch' && operations.some(op=>!['task.create','task.update','task.delete','task.restore'].includes(op?.type))) throw fail('批量操作无效');
    for (const operation of operations) {
    if (!operation || typeof operation !== 'object') throw fail('缺少操作');
    if (['plan.delete','plan.restore','plan.purge','task.purge'].includes(operation.type)) { if (current.ownerId!==userId) throw fail('只有所有者可以管理回收站',403); }
    else if (operation.type === 'plan.update' && (operation.patch?.host || operation.patch?.archived !== undefined)) {
      if (current.ownerId !== userId) throw fail('只有所有者可以归档或迁移规划', 403);
      const owner = operation.patch.archived === true && !operation.patch.host ? current.ownerId : planningHostAccess(db, operation.patch.host || current.host, userId, true, body.clientId);
      if (owner !== userId) throw fail('请迁移到自己的画布或笔记', 403);
    } else if (current.archived) throw fail('请先恢复归档规划', 409);
    if (operation.type === 'task.decompose') {
      const refs = [operation.source, ...(Array.isArray(operation.children) ? operation.children.map(child => child?.source) : [])];
      for (const ref of refs) planningHostAccess(db, host(ref), userId, true, body.clientId);
    }
    const memberIds = planningMembers(userId).map(m => m.id);
    // Existing departed assignees may stay as historical values, but cannot be newly assigned.
    let effective = operation;
    if (Array.isArray(operation.patch?.sources)) {
      const task = current.tasks.find(task => task.id === operation.id), hidden = (task?.sources || []).filter(source => { try { planningHostAccess(db, source, userId); return false; } catch { return true; } });
      const sources = [...operation.patch.sources];
      for (const source of hidden) if (!sources.some(value => JSON.stringify(value) === JSON.stringify(source))) sources.push(source);
      effective = { ...operation, patch: { ...operation.patch, sources, ...(hidden.length && task.linked ? { linked: true } : {}) } };
    }
    plan = applyOperation(current, effective, memberIds);
    if (operation.patch?.assigneeId) {
      try { planningHostAccess(db, plan.host, operation.patch.assigneeId); }
      catch { throw fail('该成员无法访问宿主，请先共享画布或笔记'); }
    }
    if (operation.patch?.sources) for (const ref of operation.patch.sources) planningHostAccess(db, ref, userId, true, body.clientId);
    if (operation.patch?.linked === true) {
      const task = plan.tasks.find(t => t.id === operation.id),sources=[],sourceCache=new Map();
      for (const ref of task?.sources || []) {
        planningHostAccess(db, ref, userId, true, body.clientId);
        const value = sourceContent(db, ref,true,sourceCache), reference = value?.taskRef || value?.attrs?.taskRef;
        // An accessible source that has actually been removed must not block a
        // newly saved brain. Pending, inaccessible or damaged sources still fail.
        if(!value)continue;
        if (reference?.planId !== plan.id || reference?.taskId !== task.id) throw fail('来源关联尚未同步，请打开来源重试', 409, 'PLAN_SOURCE_PENDING');
        sources.push(ref);
      }
      if(!sources.length)throw fail('没有可确认的关联来源，请先保存脑图后重试',409,'PLAN_SOURCE_PENDING');
      task.sources=sources;
    }
    if (!sameHost(current.host, plan.host)) plan.archived = false;
    if(current.archived&&!plan.archived&&db.prepare('SELECT COUNT(*) AS n FROM planning_documents WHERE owner_user_id=? AND archived=0').get(plan.ownerId).n>=500)throw fail('活动规划已满，请先归档其他规划');
    if (current.deleted && !['plan.restore','plan.purge'].includes(operation.type)) throw fail('规划位于回收站，请先恢复',409);
    current=plan;
    }
  }
    save(db, plan);
    db.prepare('INSERT INTO planning_operations VALUES(?,?,?,?,?,?)').run(plan.id, userId, body.opId, signature, plan.revision, Date.now());
  return exposed(db, plan, userId);
}
export function mutatePlan(db,userId,planId,body,creating=false) {
  const ownsTransaction=!db.isTransaction;if(ownsTransaction)db.exec('BEGIN IMMEDIATE');
  try { const result=mutatePlanInside(db,userId,planId,body,creating);if(ownsTransaction)db.exec('COMMIT');if(ownsTransaction)invalidatePlanning(result);return result; }
  catch(error) { if(ownsTransaction&&db.isTransaction)db.exec('ROLLBACK');throw error; }
}
export async function handlePlanningApi(req, res, url) {
  if (!url.pathname.startsWith('/api/plans')) return false;
  if (url.pathname === '/api/plans/capabilities' && req.method === 'GET') { sendJson(res, 200, { enabled: PLANNING_ENABLED }); return true; }
  if (!PLANNING_ENABLED) throw fail('规划功能尚未启用', 404, 'PLANNING_DISABLED');
  const session = servicesRuntime.accountService.requireSession(req, { requireCsrf: !['GET', 'HEAD'].includes(req.method) });
  if (!session?.userId) throw fail('游客规划仅保存在当前浏览器', 401);
  const db = servicesRuntime.database, userId = session.userId;
  if(url.pathname==='/api/plans/import'&&req.method==='POST'){const body=await readJsonBody(req,32*1024*1024);const plans=importPlanningSnapshots(db,userId,body.plans,body.clientId);plans.forEach(invalidatePlanning);sendJson(res,201,{plans});return true;}
  if (url.pathname === '/api/plans' && req.method === 'GET') {
    const issues=[], rows=planningRows(db,userId), versions=Object.fromEntries(rows.map(row=>[row.id,row.revision]));
    const paged=url.searchParams.has('limit'), limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50));
    const offset=Math.max(0,Number(url.searchParams.get('cursor'))||0), page=paged?rows.slice(offset,offset+limit):rows;
    const requested=url.searchParams.get('versions');let known={};try{if(requested)known=JSON.parse(requested);}catch{throw fail('版本目录无效');}
    const changed=page.filter(row=>!requested || known[row.id]!==row.revision);
    const summary=url.searchParams.get('summary')==='1';
    const plans=summary?changed.flatMap(row=>{try{const plan=read(db,row.id,userId);if(plan.purged)return [];return [{id:plan.id,name:plan.name,ownerId:plan.ownerId,host:plan.host,revision:plan.revision,archived:plan.archived,deleted:plan.deleted,deletedAt:plan.deletedAt,purged:plan.purged,goal:plan.goal,current:plan.current,target:plan.target,unit:plan.unit,taskCount:plan.tasks.length,trashCount:(plan.deletedTasks||[]).filter(t=>t.snapshot).length,progress:progress(plan),tasks:[],milestones:[],reviews:[],partial:true}];}catch(error){if(![403,404].includes(error.statusCode))issues.push({id:row.id,code:'PLAN_READ_FAILED',message:'规划暂时无法读取，缓存保留'});return [];}}):listPlans(db,userId,{rows:changed,issues});
    const directoryToken=createHash('sha256').update(JSON.stringify(rows.map(row=>[row.id,row.revision]))).digest('hex');
    sendJson(res, 200, { plans,versions,directoryToken,issues,incremental:Boolean(requested),summary,nextCursor:paged&&offset+limit<rows.length?String(offset+limit):null,members:planningMembers(userId) });return true;
  }
  if (url.pathname === '/api/plans' && req.method === 'POST') {
    const body = await readJsonBody(req, 128 * 1024);
    if (!body?.plan || !safeId(body.plan.id)) throw fail('规划数据无效');
    sendJson(res, 201, { plan: mutatePlan(db, userId, body.plan.id, body, true) }); return true;
  }
  const match = url.pathname.match(/^\/api\/plans\/([a-zA-Z0-9_-]{1,128})(\/operations)?$/);
  if (match && !match[2] && req.method === 'GET') { sendJson(res, 200, { plan: exposed(db, read(db, match[1], userId), userId) }); return true; }
  if (match?.[2] && req.method === 'POST') { const body = await readJsonBody(req, 128 * 1024); sendJson(res, 200, { plan: mutatePlan(db, userId, match[1], body) }); return true; }
  throw fail('规划接口不存在', 404);
}
