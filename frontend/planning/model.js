export const STATUSES = { todo: '待办', doing: '进行中', blocked: '阻塞', done: '完成' };
export const VIEWS = ['list', 'kanban', 'calendar'];
export const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const fail = (message, statusCode = 400, code = 'INVALID_PLAN') => Object.assign(new Error(message), { statusCode, code });
export const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw fail('名称或内容无效，或超过长度限制');
  return value.trim();
}
export function host(value) {
  if (!value || !['canvas', 'notebook'].includes(value.kind)) throw fail('请选择画布或笔记作为规划宿主');
  if (value.kind === 'canvas' && safeId(value.boardId)) return { kind: 'canvas', boardId: value.boardId };
  if (value.kind === 'notebook' && safeId(value.notebookId) && safeId(value.pageId)) return { kind: 'notebook', notebookId: value.notebookId, pageId: value.pageId };
  throw fail('规划宿主无效');
}
export const sameHost = (a, b) => a?.kind === b?.kind && (a?.kind === 'canvas' ? a.boardId === b.boardId : a?.notebookId === b?.notebookId && a?.pageId === b?.pageId);
export function source(value) {
  const result = host(value);
  if (!safeId(value.entityId)) throw fail('来源对象无效');
  result.entityId = value.entityId;
  if (value.nodeId !== undefined) { if (!safeId(value.nodeId)) throw fail('来源节点无效'); result.nodeId = value.nodeId; }
  return result;
}
export function date(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail('截止日期无效');
  return value;
}
export function taskPatch(input, members) {
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (['title', 'blockedReason', 'evidence', 'waitingFor'].includes(key)) result[key] = text(value, key === 'title' ? 200 : 4000, key === 'title');
    else if (key === 'status') { if (!Object.hasOwn(STATUSES, value)) throw fail('任务状态无效'); result.status = value; }
    else if (['dueDate', 'scheduledDate', 'checkDate'].includes(key)) result[key] = date(value);
    else if (key === 'assigneeId') { if (value !== null && !members.includes(value)) throw fail('负责人必须是本人或当前共享组成员'); result.assigneeId = value; }
    else if (key === 'priority') { if (![1, 2, 3].includes(value)) throw fail('优先级无效'); result.priority = value; }
    else if (['milestoneId','parentTaskId','reviewId'].includes(key)) { if (value !== null && !safeId(value)) throw fail('任务分组无效'); result[key] = value; }
    else if (['archived', 'linked', 'focused', 'verified'].includes(key)) { if (typeof value !== 'boolean') throw fail('任务属性无效'); result[key] = value; }
    else if (key === 'dependsOn') { if (!Array.isArray(value) || value.length > 30 || value.some(id => !safeId(id))) throw fail('依赖任务无效'); result[key] = [...new Set(value)]; }
    else if (key === 'order') { if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw fail('排序无效'); result.order = value; }
    else if (key === 'sources') { if (!Array.isArray(value) || value.length > 100) throw fail('来源过多'); result.sources = value.map(source); }
    else throw fail(`不支持的任务属性：${key}`);
  }
  return result;
}
export function createPlan(input, ownerId, now = Date.now()) {
  if (!safeId(input.id)) throw fail('规划标识无效');
  return { id: input.id, ownerId, host: host(input.host), name: text(input.name || '新规划', 100, true), goal: '', criteria: '', current: null, target: null, unit: '', revision: 0, archived: false, tasks: [], milestones: [], reviews: [], createdAt: now, updatedAt: now };
}
export function applyOperation(original, op, members, now = Date.now()) {
  if (op.type === 'task.batch') {
    if (!Array.isArray(op.operations) || !op.operations.length || op.operations.length > 100 || op.operations.some(value => !['task.create', 'task.update', 'task.delete', 'task.restore'].includes(value?.type))) throw fail('请选择 1–100 项任务操作');
    let result = original;
    for (const operation of op.operations) result = applyOperation(result, operation, members, now);
    return result;
  }
  const plan = structuredClone(original);
  const revision = entity => { if (!Number.isSafeInteger(op.baseRevision) || op.baseRevision !== entity.revision) throw fail('内容已在其他窗口更新，当前草稿已保留，请检查后重新提交', 409, 'PLAN_CONFLICT'); };
  if (op.type === 'task.create') {
    if (plan.tasks.length >= 2000 || !safeId(op.id) || plan.tasks.some(t => t.id === op.id) || plan.deletedTasks?.some(t => t.id === op.id)) throw fail('任务标识重复或超过 2000 项');
    const patch = taskPatch(op.patch, members);
    if (!patch.title) throw fail('请填写任务标题');
    plan.tasks.push({ id: op.id, title: patch.title, status: 'todo', assigneeId: null, dueDate: null, scheduledDate: null, checkDate: null, waitingFor: '', focused: false, verified: false, dependsOn: [], priority: 2, milestoneId: null, parentTaskId: null, blockedReason: '', evidence: '', archived: false, linked: false, sources: [], order: plan.tasks.length, ...patch, revision: 1, createdAt: now, updatedAt: now });
  } else if (op.type === 'task.decompose') {
    const parent = plan.tasks.find(t => t.id === op.id); if (!parent || parent.archived) throw fail('任务不存在或已归档', 404);
    revision(parent);
    if (!Array.isArray(op.children) || !op.children.length || op.children.length > 30) throw fail('一次拆解可添加 1–30 个普通脑图节点');
    const rootSource = source(op.source), seen = new Set(), nodes = new Set([rootSource.nodeId]);
    const validateSource = value => { const ref = source(value); if (!sameHost(ref, plan.host) || ref.entityId !== rootSource.entityId || !ref.nodeId) throw fail('拆解脑图必须位于规划宿主中'); return ref; };
    validateSource(rootSource);
    for (const child of op.children) {
      if (!safeId(child?.id) || seen.has(child.id)) throw fail('分支标识重复或无效'); seen.add(child.id);
      const ref = validateSource(child.source);
      if (nodes.has(ref.nodeId)) throw fail('脑图节点标识重复'); nodes.add(ref.nodeId);
      if (plan.tasks.some(t => t.sources.some(s => sameHost(s, ref) && s.entityId === ref.entityId && s.nodeId === ref.nodeId))) throw fail('脑图节点已关联其他任务');
      text(child.title, 200, true);
    }
    if (!parent.sources.some(s => JSON.stringify(s) === JSON.stringify(rootSource))) parent.sources.push(rootSource);
    if (parent.sources.length > 100) throw fail('来源过多');
    parent.linked = false; parent.revision++; parent.updatedAt = now;
  } else if (op.type === 'task.update') {
    const task = plan.tasks.find(t => t.id === op.id); if (!task) throw fail('任务不存在', 404);
    revision(task); Object.assign(task, taskPatch(op.patch, members), { revision: task.revision + 1, updatedAt: now });
  } else if (op.type === 'task.delete') {
    const task = plan.tasks.find(t => t.id === op.id); if (!task) throw fail('任务不存在', 404);
    revision(task);
    // A small snapshot keeps copied/source references readable without counting
    // a deleted task toward capacity or changing another host's document.
    plan.deletedTasks ||= [];
    plan.deletedTasks.push({ id: task.id, title: task.title, status: task.status, deleted: true, deletedAt: now, snapshot: task });
    plan.tasks = plan.tasks.filter(t => t.id !== task.id);
    for (const child of plan.tasks) if (child.parentTaskId === task.id) { child.parentTaskId = null; child.revision++; child.updatedAt = now; }
    for (const dependent of plan.tasks) if (dependent.dependsOn?.includes(task.id)) { dependent.dependsOn = dependent.dependsOn.filter(id => id !== task.id); dependent.revision++; }
  } else if (op.type === 'task.restore' || op.type === 'task.purge') {
    const record = plan.deletedTasks?.find(t => t.id === op.id); if (!record) throw fail('回收站任务不存在', 404);
    if (op.type === 'task.restore') {
      if (!record.snapshot || now - record.deletedAt > 30 * 86400000) throw fail('此任务已超过恢复期限');
      if (plan.tasks.length >= 2000) throw fail('任务超过 2000 项');
      const task = { ...record.snapshot, revision: record.snapshot.revision + 1, updatedAt: now, parentTaskId: null, dependsOn: [] };
      if (task.milestoneId && !plan.milestones.some(m => m.id === task.milestoneId)) task.milestoneId = null;
      if (task.reviewId && !plan.reviews.some(r => r.id === task.reviewId)) task.reviewId = null;
      if (!members.includes(task.assigneeId)) task.assigneeId = null;
      plan.tasks.push(task); plan.deletedTasks = plan.deletedTasks.filter(t => t.id !== op.id);
    } else { delete record.snapshot; record.title = '已永久清理的任务'; record.status = 'todo'; }
  } else if (['plan.delete', 'plan.restore', 'plan.purge'].includes(op.type)) {
    revision(plan);
    if (op.type === 'plan.delete') { plan.deleted = true; plan.deletedAt = now; plan.archived = true; }
    else if (op.type === 'plan.restore') { if (!plan.deleted || now - plan.deletedAt > 30 * 86400000 || plan.purged) throw fail('规划已超过恢复期限'); plan.deleted = false; plan.archived = true; }
    else { if (!plan.deleted) throw fail('请先移入回收站'); plan.tasks = []; plan.deletedTasks = []; plan.milestones = []; plan.reviews = []; plan.name = '已永久清理的规划'; plan.goal = ''; plan.criteria = ''; plan.current = null; plan.target = null; plan.unit = ''; plan.purged = true; }
  } else if (op.type === 'plan.update') {
    revision(plan);
    for (const [key, value] of Object.entries(op.patch || {})) {
      if (['name', 'goal', 'criteria', 'unit'].includes(key)) plan[key] = text(value, key === 'name' ? 100 : key === 'unit' ? 30 : 4000, key === 'name');
      else if (key === 'current' || key === 'target') { if (value !== null && (!Number.isFinite(value) || value < 0 || key === 'target' && value === 0)) throw fail('成果指标无效'); plan[key] = value; }
      else if (key === 'host') plan.host = host(value);
      else if (key === 'archived') { if (typeof value !== 'boolean') throw fail('归档状态无效'); plan.archived = value; }
      else if (key === 'wipLimit') { if (!Number.isInteger(value) || value < 0 || value > 30) throw fail('进行中提醒数量应为 0–30'); plan.wipLimit = value; }
      else throw fail('不支持的规划属性');
    }
  } else if (op.type === 'milestone.create') {
    if (plan.milestones.length >= 100 || !safeId(op.id) || plan.milestones.some(m => m.id === op.id)) throw fail('里程碑无效或过多');
    plan.milestones.push({ id: op.id, title: text(op.patch?.title, 200, true), criteria: text(op.patch?.criteria || '', 4000), done: false, revision: 1 });
  } else if (op.type === 'milestone.update') {
    const milestone = plan.milestones.find(m => m.id === op.id); if (!milestone) throw fail('里程碑不存在', 404);
    revision(milestone);
    for (const [key, value] of Object.entries(op.patch || {})) {
      if (key === 'title' || key === 'criteria') milestone[key] = text(value, key === 'title' ? 200 : 4000, key === 'title');
      else if (key === 'done' && typeof value === 'boolean') milestone.done = value;
      else throw fail('里程碑属性无效');
    }
    milestone.revision++;
  } else if (op.type === 'milestone.delete') {
    const milestone = plan.milestones.find(m => m.id === op.id); if (!milestone) throw fail('里程碑不存在', 404);
    revision(milestone);
    plan.milestones = plan.milestones.filter(m => m.id !== op.id);
    for (const task of plan.tasks) if (task.milestoneId === op.id) { task.milestoneId = null; task.revision++; task.updatedAt = now; }
  } else if (op.type === 'review.create') {
    if (plan.reviews.length >= 200 || !safeId(op.id) || plan.reviews.some(r => r.id === op.id)) throw fail('复盘记录无效或过多');
    plan.reviews.push({ id: op.id, createdAt: now, results: text(op.patch?.results || '', 4000), reasons: text(op.patch?.reasons || '', 4000), next: text(op.patch?.next || '', 4000) });
  } else if (op.type === 'review.update') {
    revision(plan); const review = plan.reviews.find(r => r.id === op.id); if (!review) throw fail('复盘不存在', 404);
    for (const [key, value] of Object.entries(op.patch || {})) { if (!['results', 'reasons', 'next'].includes(key)) throw fail('复盘属性无效'); review[key] = text(value, 4000); }
  } else if (op.type === 'review.delete') {
    revision(plan);
    if (!plan.reviews.some(r => r.id === op.id)) throw fail('复盘记录不存在', 404);
    plan.reviews = plan.reviews.filter(r => r.id !== op.id);
    for(const task of plan.tasks)if(task.reviewId===op.id){task.reviewId=null;task.revision++;}
  } else throw fail('操作类型无效');
  if (plan.tasks.some(t => t.milestoneId && !plan.milestones.some(m => m.id === t.milestoneId))) throw fail('所属里程碑不存在');
  if(plan.tasks.some(t=>t.reviewId&&!plan.reviews.some(r=>r.id===t.reviewId)))throw fail('来源复盘不存在');
  const byId = new Map(plan.tasks.map(t => [t.id, t]));
  for (const task of plan.tasks) { const seen = new Set([task.id]); let parent = task.parentTaskId; while (parent) { if (!byId.has(parent) || seen.has(parent) || seen.size > 32) throw fail('父任务不存在、循环关联或拆解层级过深'); seen.add(parent); parent = byId.get(parent).parentTaskId; } }
  const visited = new Set(), visiting = new Set();
  const visit = task => { if (visiting.has(task.id)) throw fail('任务依赖不能形成循环'); if (visited.has(task.id)) return; visiting.add(task.id); for (const id of task.dependsOn || []) { if (!byId.has(id)) throw fail('依赖任务不存在'); visit(byId.get(id)); } visiting.delete(task.id); visited.add(task.id); };
  plan.tasks.forEach(visit);
  for (const record of plan.deletedTasks || []) if (now - record.deletedAt > 30 * 86400000) { delete record.snapshot; record.title = '已清理的任务'; }
  plan.revision++; plan.updatedAt = now;
  return plan;
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export function today(now = Date.now()) { return dayFormatter.format(now); }
export function matches(task, filter, userId, now = Date.now(), lookup = null) {
  if (filter === 'archived') return task.archived;
  if (task.archived) return false;
  if (filter === 'all') return true;
  const day = today(now);
  if (filter === 'today') return task.status !== 'done' && task.scheduledDate === day;
  if (filter === 'next') return task.status !== 'done' && task.status !== 'blocked' && task.focused && (!lookup||!(task.dependsOn||[]).some(id=>lookup.get(id)?.status!=='done'));
  if (filter === 'waiting') return task.status !== 'done' && (task.status === 'blocked' || Boolean(task.waitingFor));
  if (filter === 'unfinished') return task.status !== 'done';
  if (filter === 'mine') return task.assigneeId === userId && task.status !== 'done';
  if (filter === 'overdue') return task.status !== 'done' && task.dueDate && task.dueDate < day;
  if (filter === 'blocked') return task.status === 'blocked';
  if (filter === 'week') { const start = new Date(`${day}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6); return task.status !== 'done' && task.dueDate && task.dueDate >= start.toISOString().slice(0, 10) && task.dueDate <= end.toISOString().slice(0, 10); }
  return true;
}
const planIndexes = new WeakMap();
export function planIndex(plan) {
  let index = planIndexes.get(plan); if (index?.revision === plan.revision && index.tasks === plan.tasks) return index;
  index = { revision: plan.revision, tasks: plan.tasks, byId: new Map(), children: new Map() };
  for (const task of plan.tasks) { index.byId.set(task.id, task); if (!task.archived && task.parentTaskId) { const stats = index.children.get(task.parentTaskId) || { total: 0, done: 0 }; stats.total++; stats.done += task.status === 'done' ? 1 : 0; index.children.set(task.parentTaskId, stats); } }
  for (const task of plan.deletedTasks || []) index.byId.set(task.id, task);
  planIndexes.set(plan, index); return index;
}
export function childProgress(plan, taskId) { return planIndex(plan).children.get(taskId) || { total: 0, done: 0 }; }
export function progress(plan) { const active = plan.tasks.filter(t => !t.archived), parents = new Set(active.map(t => t.parentTaskId).filter(Boolean)), tasks = active.filter(t => !parents.has(t.id)), done = tasks.filter(t => t.status === 'done').length; return { total: tasks.length, done, percent: tasks.length ? Math.round(done / tasks.length * 100) : null }; }
