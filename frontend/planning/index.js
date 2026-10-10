import { STATUSES, VIEWS, childProgress, id, matches, progress, sameHost, today, planIndex } from './model.js';
import { PlanningStore } from './store.js';
import { parseQuickTask, taskList } from './workflow.js';

let enabled = false, store, panel, shade, panelOpen = false, selectedPlan = null, scope = 'current', filter = 'all', query = '', queryComposing = false, refreshFrame, panelFocus, panelPosition;
const panelInert = new Map();
let cancelPanelMove;
const adapters = {}, mounts = new Map();
let brainScope, brainKeys = new Set();
const taskSelection=new Map();let undoAction,returnLocation,searchTimer;
const preferences=()=>ensureStore().inputs.get('preferences')||{density:'comfortable',docked:false,views:[],reminders:false};
async function savePreferences(patch){await ensureStore().saveInput('preferences',{...preferences(),...patch});if(panelOpen)showPanel(true);}
function planningSettings(){const pref=preferences();dialog('规划显示与提醒',form=>{const density=field(form,'列表密度',pref.density,'select',[['comfortable','舒适'],['compact','紧凑']]),docked=field(form,'固定在左侧','','checkbox'),reminders=field(form,'显示应用内待处理提醒','','checkbox');docked.checked=Boolean(pref.docked);reminders.checked=Boolean(pref.reminders);form.append(node('p','planning-hint','提醒只在打开此应用时显示，可随时关闭；不会发送到外部服务。'));return {density,docked,reminders};},f=>savePreferences({density:f.density.value,docked:f.docked.checked,reminders:f.reminders.checked}));}
function saveView(){dialog('保存常用筛选',form=>({name:field(form,'筛选名称')}),async f=>{const pref=preferences(),views=(pref.views||[]).filter(v=>v.name!==f.name.value);views.push({name:f.name.value,scope,filter,query});await savePreferences({views:views.slice(-20)});});}
function manageViews(){dialog('管理常用筛选',form=>{for(const view of preferences().views||[]){const row=node('div','planning-actions');row.append(node('span','',view.name),button('删除筛选',async()=>{await savePreferences({views:(preferences().views||[]).filter(v=>v.name!==view.name)});row.remove();},'planning-quiet'));form.append(row);}return {};},async()=>{} ,'完成');}
const node = (tag, className, content) => { const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element; };
const iconPaths = { plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2', list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', kanban: 'M4 4h16v16H4zM9 4v16M15 4v16M6 8h1M11 8h2M17 8h1M6 12h1M11 12h2', calendar: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4', search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', arrow: 'M5 12h14m-5-5 5 5-5 5', left: 'm14 6-6 6 6 6', right: 'm10 6 6 6-6 6', target: 'M21 12a9 9 0 1 1-9-9M17 12a5 5 0 1 1-5-5M12 12l9-9M17 3h4v4', archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4' };
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('planning-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.65'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', iconPaths[name] || iconPaths.list); svg.append(path); return svg; }
Object.assign(iconPaths, { trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', edit: 'm16 3 5 5-12 12-6 1 1-6zM14 5l5 5', grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01' });
const button = (label, action, className = '') => {
  const element = node('button', `planning-button ${className}`), name = { '关闭': 'close', '设置': 'settings', '刷新': 'refresh', '新建规划': 'plus', '添加任务': 'plus', '+ 添加任务': 'plus', '插入当前内容': 'arrow', '清单': 'list', '看板': 'kanban', '日历': 'calendar', '上一月': 'left', '下一月': 'right', '定位来源': 'target', '归档任务': 'archive', '规划': 'kanban' }[label];
  const actionIcon = name || (label.startsWith('删除') ? 'trash' : label.startsWith('编辑') ? 'edit' : null);
  if (actionIcon) element.append(icon(actionIcon)); element.append(document.createTextNode(label)); element.type = 'button'; element.addEventListener('click', () => Promise.resolve().then(() => action(element)).catch(report)); return element;
};
const adapter = () => window.__independentNotesActive ? adapters.notebook : adapters.canvas;
const writable = () => Boolean(adapter()?.writable());
const canWritePlan=plan=>!plan.archived&&!plan.deleted&&(sameHost(plan.host,adapter()?.host())?writable():plan.host.kind==='notebook'||adapters.canvas?.canWriteHost?.(plan.host));
const clientId = () => adapter()?.clientId?.() || store?.clientId;
const report = error => { if (error.name !== 'AbortError') (adapter()?.toast || window.alert)(error.message || String(error)); };
const formatDate = value => value ? value.slice(5).replace('-', '/') : '未安排';
function ensureStore() {
  const account = window.MuseAccount?.session?.user?.id || 'guest';
  if (!store?.active() || store.scope !== account) { store?.dispose(); store = new PlanningStore(changed); store.load().catch(report); }
  return store;
}
function componentState(data) {
  const plan = store?.plans.get(data.planRef);
  return JSON.stringify([enabled, store?.scope, data.planRef, plan?.revision,plan?.partial,plan?.sourceVersion,plan?.archived, store?.cloud, store?.guest, store?.members, data.planView, data.month, writable(), data.writable?.(), today()]);
}
function changed() {
  if (refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = null; if (!enabled) return;
    renderPanel();
    for (const [element, data] of mounts) { if (!element.isConnected) { mounts.delete(element); continue; } if (data.renderState === componentState(data)) continue; const scroll = element.querySelector('.planning-body')?.scrollTop || 0, quick=[...element.querySelectorAll('.planning-quick-form')],focus=quick.find(form=>form.contains(document.activeElement))&&document.activeElement; renderComponent(element, data); const body = element.querySelector('.planning-body'); if(body){for(const form of quick){const target=(form.dataset.placement==='column'&&[...body.querySelectorAll('.planning-column')].find(column=>column.dataset.status===form.dataset.status))||element.querySelector('.planning-component-footer');if(target)placeQuickForm(target,form);}body.scrollTop = scroll;}focus?.focus({preventScroll:true}); }
    adapters.canvas?.repaint?.(); adapters.notebook?.repaint?.();
    adapters.canvas?.refreshConnections?.(); adapters.notebook?.refreshConnections?.();
    const references = [...(adapters.canvas?.brainReferences?.() || []), ...(adapters.notebook?.brainReferences?.() || [])];
    const restored = brainScope === store?.scope ? references.filter(value => !brainKeys.has(JSON.stringify(value.source))) : [];
    brainScope = store?.scope; brainKeys = new Set(references.map(value => JSON.stringify(value.source)));
    store?.detachSources((source,ref) => (source.kind === 'canvas' ? adapters.canvas : adapters.notebook)?.sourceExists?.(source,ref), restored).catch(report);
  });
}
function header(title, close) { const row = node('div', 'planning-heading'), copy = node('div', 'planning-heading-copy'); copy.append(node('strong', '', title)); if (title === '规划与跟踪') copy.append(node('span', 'planning-subtitle', '让想法有进度，让成果可见')); const dismiss = button('关闭', close, 'planning-quiet planning-close'); dismiss.setAttribute('aria-label', '关闭'); row.append(copy, dismiss); return row; }
function field(form, label, value = '', type = 'text', options = []) {
  const wrap = node('label', 'planning-field'); wrap.append(node('span', '', label));
  const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  if (input.tagName === 'INPUT') input.type = type;
  if (type === 'select') for (const [key, name] of options) { const option = node('option', '', name); option.value = key; input.append(option); }
  input.value = value ?? ''; input.setAttribute('aria-label', label); input.maxLength = type === 'textarea' ? 4000 : 200;
  if (type === 'number') { input.min = '0'; input.step = 'any'; }
  wrap.append(input); form.append(wrap); return input;
}
function dialog(title, build, submit, label = '保存', options = {}) {
  if(options.drawer)closeTaskDetails();
  const context = adapter()?.host(), owner = ensureStore().scope, currentStore = store;
  const root = node('dialog', 'planning-dialog planning-toplevel'); root.setAttribute('aria-label', title);
  if (options.drawer) root.classList.add('planning-property-panel');
  const form = node('form', 'planning-form'); root.append(header(title, () => root.close()), form);
  const fields = build(form), error = node('p', 'planning-error'); error.setAttribute('role', 'status'); form.append(error);
  const inputKey=options.inputKey;
  if(inputKey)root.dataset.inputKey=inputKey;
  if(inputKey){
    const saved=currentStore.inputs.get(inputKey);if(saved&&(sameHost(saved.host,context)||/^(task|plan):/.test(inputKey)))for(const input of form.querySelectorAll('[aria-label]')){const value=saved.values?.[input.getAttribute('aria-label')];if(value!==undefined){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
    const persist=()=>{const values={};for(const input of form.querySelectorAll('input[aria-label],select[aria-label],textarea[aria-label]'))values[input.getAttribute('aria-label')]=input.type==='checkbox'?input.checked:input.value;currentStore.saveInput(inputKey,{title,host:context,values}).catch(report);};
    let touched=Boolean(saved);const onInput=()=>{touched=true;persist();};
    form.addEventListener('input',onInput);form.addEventListener('change',onInput);root.persistInput=()=>{if(touched)persist();};
  }
  let composing = false; form.addEventListener('compositionstart', () => { composing = true; }); form.addEventListener('compositionend', () => { composing = false; });
  const footer = node('div', 'planning-actions planning-form-footer'), save = node('button', 'planning-button planning-primary', label); save.type = 'submit'; footer.append(button('取消', () => root.close(), 'planning-quiet'), save); form.append(footer);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled || composing) return;
    if (!currentStore.active() || currentStore !== store || owner !== store.scope || !sameHost(context, adapter()?.host())) { error.textContent = '编辑上下文已改变，请重新打开'; return; }
    save.disabled = true; error.textContent = '';
    try { await submit(fields, root);if(inputKey)await currentStore.clearInput(inputKey); root.close(); }
    catch (failure) { error.textContent = failure.message; }
    finally { save.disabled = false; }
  });
  root.addEventListener('cancel', event => { if (save.disabled) event.preventDefault(); });
  root.addEventListener('close', () => root.remove(), { once: true }); document.body.append(root);
  if(options.drawer){
    const dismiss=event=>{
      const rect=root.getBoundingClientRect(),backdrop=event.target===root&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
      if(root.contains(event.target)&&!backdrop||event.target!==root&&event.target.closest('.planning-dialog'))return;
      root.persistInput?.();root.close();
    };
    document.addEventListener('pointerdown',dismiss,true);
    root.addEventListener('close',()=>document.removeEventListener('pointerdown',dismiss,true),{once:true});
  }
  if (options.drawer && innerWidth > 700) root.show(); else root.showModal();
  return root;
}
function closeTaskDetails(){for(const root of document.querySelectorAll('.planning-property-panel[open]')){root.persistInput?.();root.close();}}
function inCurrent(plan) { return sameHost(plan.host, adapter()?.host()) || Boolean(adapter()?.planIds?.().has(plan.id)); }
function choosePlanOptions() { const current = adapter()?.host(); return [...ensureStore().plans.values()].filter(p => !p.archived).sort((a, b) => Number(sameHost(b.host, current)) - Number(sameHost(a.host, current))).map(p => [p.id, p.name]); }
function checkWrite() { if (!writable()) throw new Error('当前画布或笔记只读，请先取得编辑权限'); }
async function ready() { const context = adapter()?.host(), currentStore = ensureStore(); checkWrite(); await adapter()?.prepare?.(); if (!currentStore.active() || currentStore !== store || !sameHost(context, adapter()?.host())) throw new Error('编辑上下文已改变，当前输入已保留，请重新提交'); checkWrite(); }
async function operation(planId, op, capturedValues=null) {
  const plan=ensureStore().plans.get(planId),target=plan?.host;
  if(plan?.archived&&plan.ownerId===store.scope)return ensureStore().operate(planId,op,clientId(),capturedValues);
  if(target&&!sameHost(target,adapter()?.host())&&!plan.archived){if(target.kind==='notebook'&&!adapters.notebook)window.MuseNotebook?.initialize({});const service=target.kind==='canvas'?adapters.canvas:adapters.notebook;if(!service?.prepareHost)throw new Error('请打开规划所属内容编辑');const writer=await service.prepareHost(target);return ensureStore().operate(planId,op,writer,capturedValues);}
  await ready();return ensureStore().operate(planId, op, clientId(),capturedValues);
}
async function taskChange(planId,taskId,patch) {
  const current=ensureStore().task({planId,taskId});if(!current||current.deleted)throw new Error('任务不存在或已删除');
  const previous=Object.fromEntries(Object.keys(patch).map(key=>[key,current[key]??(typeof patch[key]==='boolean'?false:null)]));
  const result=await operation(planId,{type:'task.update',id:taskId,baseRevision:current.revision,patch}),revision=result.tasks.find(t=>t.id===taskId).revision;
  undoAction={planId,taskId,patch:previous,revision};showUndo();return result;
}
function showUndo() {
  document.querySelector('.planning-undo')?.remove();const action=undoAction;if(!action)return;
  const bar=node('div','planning-undo planning-toplevel');bar.setAttribute('role','status');bar.append(node('span','','任务已更新'),button('撤销',async()=>{await operation(action.planId,{type:'task.update',id:action.taskId,baseRevision:action.revision,patch:action.patch});bar.remove();undoAction=null;}));document.body.append(bar);setTimeout(()=>bar.remove(),8000);
}
function chooseStatus(ref) { const task=ensureStore().task(ref);if(!task||task.deleted)return;dialog('修改任务状态',form=>({status:field(form,'状态',task.status,'select',Object.entries(STATUSES))}),f=>taskChange(ref.planId,ref.taskId,{status:f.status.value})); }
function confirmDeletion(title, description, submit) {
  return dialog(title, form => { form.append(node('p', 'planning-delete-description', description)); return {}; }, submit, '确认删除');
}
function deleteTask(plan, task, after = () => {}) {
  if(!canWritePlan(plan))throw new Error('请打开规划所属内容取得编辑权限');
  return confirmDeletion('删除任务', `将“${task.title}”移入回收站？30 天内可恢复，关联原文保留。永久清理会移除任务正文，仅保留标识以防重复操作。`, async () => { await operation(plan.id, { type: 'task.delete', id: task.id, baseRevision: task.revision }); after(); });
}
function editTask(ref, draft = null) {
  const current = ensureStore().task(ref), plan = store.plans.get(ref.planId);
  const task = current && { ...current, ...draft?.operation?.patch };
  if (!task || task.deleted) return report(new Error(task?.deleted ? '任务已删除，可在来源菜单中解除关联后继续编辑原文' : '任务不存在或无权访问'));
  const revision = current.revision;
  const copyId = id('task');
  let editFields;
  const saveEdits=async f=>{
    const values={...draft?.operation?.patch,title:f.title.value,status:f.status.value,dueDate:f.due.value||null,scheduledDate:f.scheduled.value||null,checkDate:f.check.value||null,waitingFor:f.waiting.value,focused:f.focused.checked,verified:f.verified.checked,dependsOn:[...f.dependencies.selectedOptions].map(option=>option.value).filter(Boolean),priority:Number(f.priority.value),milestoneId:f.milestone.value||null,blockedReason:f.reason.value,evidence:f.evidence.value,assigneeId:f.assignee.value||null};
    const original=key=>current[key]??(typeof values[key]==='boolean'?false:Array.isArray(values[key])?[]:typeof values[key]==='string'?'':null);
    const patch=Object.fromEntries(Object.entries(values).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(original(key))));
    if(Object.keys(patch).length)await operation(ref.planId,{type:'task.update',id:task.id,baseRevision:revision,patch},Object.fromEntries(Object.keys(patch).map(key=>[key,current[key]??null])));
    if(draft)await store.discard(draft.opId);
  };
  dialog('任务详情', form => {
    if (draft) {
      const patch = draft.operation.patch, extra = [];
      if (patch.archived !== undefined) extra.push(patch.archived ? '归档任务' : '恢复任务');
      if (patch.order !== undefined) extra.push('调整排序');
      if (patch.sources !== undefined || patch.linked !== undefined) extra.push('更新来源关联');
      form.append(node('p', 'planning-draft-intent', `检查原草稿后重新提交${extra.length ? ` · 同时${extra.join('、')}` : ''}`));
      const labels={title:'任务标题',status:'状态',assigneeId:'负责人',dueDate:'截止日期',scheduledDate:'执行日期',priority:'优先级',evidence:'成果',blockedReason:'阻塞说明',focused:'下一步重点',verified:'验收',waitingFor:'等待对象',checkDate:'检查日期',milestoneId:'里程碑',archived:'归档',parentTaskId:'父任务',dependsOn:'前置依赖'};
      const comparison=node('div','planning-conflict-comparison');for(const [key,value] of Object.entries(patch)){if(!labels[key])continue;const original=draft.baseValues?.[key];const format=value=>key==='status'?STATUSES[value]||'空':key==='assigneeId'?store.members.find(m=>m.id===value)?.username||'未分配':typeof value==='boolean'?value?'是':'否':value??'空';comparison.append(node('p','',`${labels[key]}：${original===undefined?'':`原值 ${format(original)} · `}当前 ${format(current[key])} → 本次 ${format(value)}`));}form.append(comparison);
    }
    const title = field(form, '任务标题', task.title); title.required = true;
    const status = field(form, '状态', task.status, 'select', Object.entries(STATUSES));
    const assignee = field(form, '负责人', task.assigneeId, 'select', [['', '未分配'], ...store.members.map(m => [m.id, m.username || m.id]), ...(task.assigneeId && !store.members.some(m => m.id === task.assigneeId) ? [[task.assigneeId, '原负责人（已离组）']] : [])]);
    const due = field(form, '截止日期', task.dueDate, 'date'), priority = field(form, '优先级', task.priority, 'select', [['1', '高'], ['2', '中'], ['3', '低']]);
    const milestone = field(form, '所属里程碑', task.milestoneId, 'select', [['', '未分组'], ...plan.milestones.map(m => [m.id, m.title])]);
    const reason = field(form, '阻塞说明', task.blockedReason, 'textarea'), evidence = field(form, '成果与链接', task.evidence, 'textarea');
    const scheduled=field(form,'执行日期',task.scheduledDate,'date'),waiting=field(form,'等待对象 / 解除条件',task.waitingFor||''),check=field(form,'下次检查日期',task.checkDate,'date');
    const focused=field(form,'作为下一步重点','','checkbox');focused.checked=Boolean(task.focused);
    const verified=field(form,'成果已验收','','checkbox');verified.checked=Boolean(task.verified);
    const dependencies=field(form,'阻塞于哪些任务','','select',plan.tasks.filter(t=>t.id!==task.id&&!t.archived).map(t=>[t.id,t.title]));dependencies.multiple=true;dependencies.size=Math.min(4,Math.max(1,plan.tasks.length-1));for(const option of dependencies.options)option.selected=task.dependsOn?.includes(option.value)||false;
    const extras=node('details','planning-form-details');extras.append(node('summary','','成果、等待与依赖'));extras.open=task.status==='blocked';for(const input of [reason,evidence,waiting,check,verified,dependencies])extras.append(input.closest('label'));form.append(extras);
    form.append(node('p','planning-hint','执行日期用于安排工作；截止日期是交付承诺。完成任务与成果验收分别记录。'));
    const actions = node('div', 'planning-actions');
    const breakdown = button('脑图拆解', async () => {await saveEdits(editFields);await store.clearInput(`task:${ref.planId}:${ref.taskId}`);actions.closest('dialog').close();decomposeTask(store.plans.get(plan.id),store.task(ref));}); breakdown.disabled = !writable() || task.archived; actions.append(breakdown);
    const children = childProgress(plan, task.id); if (children.total) form.append(node('p', 'planning-hint', `子任务进度：${children.done}/${children.total} 项完成（规划进度按末级任务统计）`));
    if (task.parentTaskId) { const parent = plan.tasks.find(t => t.id === task.parentTaskId); if (parent) actions.append(button(`父任务：${parent.title}`, () => { actions.closest('dialog').close(); editTask({ planId: plan.id, taskId: parent.id }); })); }
    const locate=button('定位来源',()=>{actions.closest('dialog').persistInput?.();return locateTask(task);});locate.disabled=!task.sources.length;actions.append(locate, button(task.archived ? '恢复任务' : '归档任务', async () => { await operation(plan.id, { type: 'task.update', id: task.id, baseRevision: revision, patch: { archived: !task.archived } }); actions.closest('dialog').close(); }));
    if(!sameHost(plan.host,adapter()?.host())){actions.append(button('打开规划所属内容',async()=>{const root=actions.closest('dialog');root.persistInput?.();root.close();await openHost(plan.host);editTask(ref);}));if(!canWritePlan(plan))form.append(node('p','planning-warning','请打开规划所属画布后编辑。当前输入会保留。'));}
    for(const [index,source] of task.sources.entries())actions.append(button(`来源 ${index+1}${source.nodeId?' · 脑图/待办':''}`,()=>locateTask(task,index),'planning-quiet'));
    actions.append(button('复制为新任务', async () => { const { id: _id, revision: _rev, createdAt: _created, updatedAt: _updated, linkState:_linkState, ...patch } = task; await operation(plan.id, { type: 'task.create', id: copyId, patch: { ...patch, parentTaskId: null, order: plan.tasks.length, archived: false, assigneeId: store.members.some(member => member.id === task.assigneeId) ? task.assigneeId : null, linked: false, sources: [] } }); actions.closest('dialog').close(); }));
    form.append(actions);
    const danger = button('删除任务', () => deleteTask(plan, current, () => danger.closest('dialog')?.close()), 'planning-danger'); danger.disabled = !writable(); form.append(danger);
    if (!task.linked && task.sources.length) form.append(button('重新关联来源', async () => { await adapter().relink(task, ref); await operation(ref.planId, { type: 'task.update', id: task.id, baseRevision: store.task(ref).revision, patch: { linked: true } }); actions.closest('dialog').close(); }));
    return editFields={ title, status, assignee, due, priority, milestone, reason, evidence,scheduled,waiting,check,focused,verified,dependencies };
  },saveEdits,'保存', { drawer: true,inputKey:`task:${ref.planId}:${ref.taskId}` });
}
function decomposeTask(plan, task) {
  checkWrite();
  if (!sameHost(plan.host, adapter()?.host())) throw new Error('请打开规划所属画布或笔记，再拆解任务');
  const currentHost = adapter().host(), entityId = id('mindmap'), rootId = id('node'), entries = Array.from({ length: 30 }, () => ({ id: id('branch'), nodeId: id('node') }));
  let source = { ...currentHost, entityId, nodeId: rootId };
  const anchors=task.sources.filter(ref=>sameHost(ref,currentHost)&&adapter().canExtendBreakdown?.(ref,{planId:plan.id,taskId:task.id}));
  let committed = false, selected;
  dialog('脑图拆解任务', form => {
    form.append(node('p', 'planning-hint', `“${task.title}”作为脑图父节点并关联当前任务。每行生成一个普通子节点，可自由编辑，不创建任务或任务连线。`));
    const steps = field(form, '执行步骤（每行一项）', '', 'textarea'); steps.required = true; steps.placeholder = '确认范围\n制作方案\n验收交付';
    const anchor=field(form,'脑图位置',anchors.length?'0':'new','select',[['new','新建脑图'],...anchors.map((ref,i)=>[String(i),`添加到已有节点 ${i+1}`])]);return { steps,anchor };
  }, async f => {
    await ready();
    if (!committed) {
      if(f.anchor.value!=='new')source=anchors[Number(f.anchor.value)];
      const titles = f.steps.value.split('\n').map(t => t.trim()).filter(Boolean); if (!titles.length || titles.length > 30) throw new Error('请填写 1–30 项执行步骤');
      selected = titles.map((title, i) => ({ ...entries[i], title, source: { ...currentHost, entityId:source.entityId, nodeId: entries[i].nodeId } }));
      await operation(plan.id, { type: 'task.decompose', id: task.id, baseRevision: task.revision, source, children: selected.map(({ id, title, source }) => ({ id, title, source })) }); committed = true;
      f.steps.disabled = true;
    }
    await completeBreakdown(plan.id, { id: task.id, source, children: selected.map(({ id, title, source }) => ({ id, title, source })) });
  }, '创建拆解');
}
async function completeBreakdown(planId, op) {
  await ready(); if (!sameHost(op.source, adapter()?.host())) throw new Error('请打开原画布或笔记，再重试脑图拆解');
  const parent = store.task({ planId, taskId: op.id }); if (!parent || parent.deleted || parent.archived) throw new Error('拆解任务已改变，请检查后放弃原草稿');
  const tree = { id: op.source.nodeId, text: parent.title, taskRef: { planId, taskId: parent.id }, children: op.children.map(child => ({ id: child.source.nodeId, text: child.title, children: [] })) };
  await adapter().insertBreakdown(planId, op.source.entityId, tree); await store.refresh();
  const confirmations=[{id:op.id,source:op.source}];
  const sameSource=(a,b)=>sameHost(a,b)&&a.entityId===b.entityId&&a.nodeId===b.nodeId;
  for (const entry of confirmations) {
    const current=store.task({planId,taskId:entry.id});if(!current||current.deleted)throw new Error('任务已改变，脑图已保留，请检查后重试');
    const missing=!current.sources.some(ref=>sameSource(ref,entry.source));
    // Replayed batches may have had their source removed after a brain deletion.
    // Restore the exact forward reference before confirming the reverse reference.
    if(missing||!current.linked)await operation(planId,{type:'task.update',id:entry.id,baseRevision:current.revision,patch:{...(missing?{sources:[...current.sources,entry.source]}:{}),linked:true}});
  }
  await adapter().ensureTaskConnections(planId, op.source.entityId);
  if(confirmations.some(entry=>{const task=store.task({planId,taskId:entry.id});return !task||task.deleted||!task.linked||!task.sources.some(ref=>sameSource(ref,entry.source));}))throw new Error('关联内容已改变，脑图和草稿仍保留，请检查后重试');
  for (const draft of [...store.drafts.values()]) {
    if(draft.planId!==planId)continue;const pending=draft.operation;
    const batch=pending?.type==='task.decompose'&&pending.id===op.id&&sameSource(pending.source,op.source)&&JSON.stringify(pending.children.map(child=>child.id))===JSON.stringify(op.children.map(child=>child.id));
    const entry=confirmations.find(entry=>entry.id===pending?.id),current=entry&&store.task({planId,taskId:entry.id});
    const confirmation=pending?.type==='task.update'&&entry&&current&&!current.deleted&&current.linked&&pending.patch?.linked===true&&Object.keys(pending.patch).every(key=>['sources','linked'].includes(key))&&(!pending.patch.sources||pending.patch.sources.every(ref=>current.sources.some(source=>sameSource(source,ref))));
    if(batch||confirmation)await store.discard(draft.opId);
  }
}
async function retryDraft(draft) {
  if (draft.operation?.type !== 'task.decompose') return store.commit(draft);
  await ready(); if (!sameHost(draft.operation.source, adapter()?.host())) throw new Error('请打开原画布或笔记，再重试脑图拆解');
  await store.commit({ ...draft, clientId: clientId() }); await completeBreakdown(draft.planId, draft.operation);
}
function linkExisting(source) {
  checkWrite();
  const plans = [...ensureStore().plans.values()].filter(p => !p.archived && sameHost(p.host, adapter().host())), options = plans.flatMap(p => p.tasks.filter(t => !t.archived).map(t => [`${p.id}:${t.id}`, `${p.name} · ${t.title}`]));
  if (!options.length) throw new Error('当前内容还没有可关联任务，请先创建规划任务');
  dialog('关联已有任务', form => {
    form.append(node('p', 'planning-hint', '选择具体任务，节点显示该任务的标题和状态，并连到规划任务行。多个节点可以关联同一任务。'));
    return { target: field(form, '目标任务', options[0][0], 'select', options) };
  }, async f => {
    const [planId, taskId] = f.target.value.split(':'), task = store.task({ planId, taskId }); if (!task || task.deleted) throw new Error('任务已失效，请重新选择');
    const sources = [...task.sources]; if (!sources.some(ref => JSON.stringify(ref) === JSON.stringify(source.ref))) sources.push(source.ref);
    await operation(planId, { type: 'task.update', id: taskId, baseRevision: task.revision, patch: { sources } });
    await source.bind({ planId, taskId });
    const latest = store.task({ planId, taskId }); if (!latest.linked) await operation(planId, { type: 'task.update', id: taskId, baseRevision: latest.revision, patch: { linked: true } });
    await adapter().ensureComponent(planId, source.ref);
    await adapter().ensureTaskConnections(planId, source.ref.entityId);
  }, '确认关联');
}
async function openHost(host) {const service=host.kind==='canvas'?adapters.canvas:adapters.notebook;await service?.openHost?.(host);changed();}
async function locateTask(task,index=0) {
  if (!task.sources.length) throw new Error('来源已删除、未关联或无权访问');
  if(!returnLocation)returnLocation=adapter()?.captureLocation?.();
  const source = task.sources[index]; await (source.kind === 'canvas' ? adapters.canvas : adapters.notebook)?.locate(source);
  document.querySelector('.planning-dialog')?.close();
  const bar=node('div','planning-return planning-toplevel');bar.append(button('返回刚才的任务',async()=>{await (returnLocation?.host.kind==='canvas'?adapters.canvas:adapters.notebook)?.restoreLocation?.(returnLocation);returnLocation=null;bar.remove();editTask({planId:task.sources.length? [...store.plans.values()].find(p=>p.tasks.some(t=>t.id===task.id))?.id:'',taskId:task.id});}));document.querySelector('.planning-return')?.remove();document.body.append(bar);
}
function placeQuickForm(parent, form) {
  const addControl = [...parent.children].find(child => child.matches('.planning-column-add, .planning-add, .planning-plan-footer'));
  parent.insertBefore(form, addControl || null);
}
function addTask(planId, anchor, status = 'todo') {
  checkWrite();
  const component = anchor?.closest('.planning-component'), panelPlan = anchor?.closest('.planning-panel-plan');
  const column = anchor?.closest('.planning-column');
  const parent = column || component?.querySelector('.planning-component-footer') || panelPlan;
  if (!parent) return;
  const existing = parent.querySelector('.planning-quick-form'); if (existing) { existing.querySelector('input').focus(); return; }
  const context = adapter().host(), currentStore = ensureStore(), form = node('form', 'planning-quick-form');let taskId=id('task'),continuous=false;form.dataset.planId = planId;form.dataset.status=status;form.dataset.placement=column?'column':'footer';
  const input = field(form, '任务标题'); input.required = true; input.maxLength = 200; input.placeholder = '输入任务，按 Enter 添加';
  let composing = false; input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; });
  const error = node('small', 'planning-error'); error.setAttribute('role', 'status');
  const inputKey=`quick:${planId}:${status}`,saved=currentStore.inputs.get(inputKey);if(saved&&sameHost(saved.host,context))input.value=saved.value||'';
  form.dataset.inputKey=inputKey;
  const preview=node('small','planning-parse-preview'),parseToggle=field(form,'应用识别的日期 / 负责人','','checkbox');parseToggle.checked=true;
  const updatePreview=()=>{const parsed=parseQuickTask(input.value,store.members);preview.textContent=parsed.recognized.join(' · ');parseToggle.closest('label').hidden=!parsed.recognized.length;currentStore.saveInput(inputKey,{title:'添加任务',host:context,value:input.value,planId,status}).catch(report);};input.addEventListener('input',updatePreview);form.append(preview);updatePreview();
  input.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text/plain');if(value?.includes('\n')){event.preventDefault();batchAdd(planId,value,status);}});
  const actions = node('div', 'planning-actions'), save = node('button', 'planning-button planning-primary', '添加'); save.type = 'submit';
  actions.append(save, button('完成', async () => {await currentStore.clearInput(inputKey); form.remove(); changed(); }, 'planning-quiet'),button('批量添加',()=>batchAdd(planId,'',status),'planning-batch-add')); form.append(error, actions); placeQuickForm(parent,form); input.focus({ preventScroll: true });
  form.addEventListener('keydown', event => { if (event.isComposing || event.keyCode === 229) return; if(event.key==='Enter'){event.preventDefault();continuous=true;form.requestSubmit();}if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); form.remove(); changed(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled || composing) return;
    if (currentStore !== store || !currentStore.active() || !sameHost(context, adapter()?.host())) { error.textContent = '内容已切换，请重新添加'; return; }
    save.disabled = true; error.textContent = '';
    try {const parsed=parseQuickTask(input.value,store.members);await operation(planId, { type: 'task.create', id: taskId, patch: { title:parseToggle.checked?parsed.title:input.value,...(parseToggle.checked?parsed.patch:{}), status: filter === 'blocked' && panelPlan ? 'blocked' : status, ...(scope === 'mine' || filter === 'mine' ? { assigneeId: store.scope } : {}) } });await currentStore.clearInput(inputKey);if(continuous){taskId=id('task');input.value='';preview.textContent='';input.focus();}else form.remove(); changed(); }
    catch (failure) { error.textContent = failure.message; }
    finally { save.disabled = false;continuous=false; }
  });
}
function batchAdd(planId,value='',status='todo',extraPatch={}) {
  const ids=Array.from({length:100},()=>id('task'));
  dialog('批量添加任务',form=>{const text=field(form,'每行一项任务',value,'textarea');form.append(node('p','planning-hint','最多 100 项。可输入“明天 提交方案 @我 !高”；识别结果确认后才会保存。'));const preview=node('div','planning-batch-preview');const toggle=field(form,'应用识别的属性','','checkbox');toggle.checked=true;const render=()=>{preview.replaceChildren();for(const line of text.value.split('\n').filter(t=>t.trim()).slice(0,100)){const parsed=parseQuickTask(line,store.members);preview.append(node('p','',`${parsed.title}${parsed.recognized.length?' · '+parsed.recognized.join(' · '):''}`));}};text.addEventListener('input',render);render();form.append(preview);return {text,toggle};},async f=>{const lines=f.text.value.split('\n').map(t=>t.trim()).filter(Boolean);if(!lines.length||lines.length>100)throw new Error('请填写 1–100 项任务');const operations=lines.map((line,i)=>{const parsed=parseQuickTask(line,store.members);return {type:'task.create',id:ids[i],patch:{title:f.toggle.checked?parsed.title:line,status,...extraPatch,...(f.toggle.checked?parsed.patch:{})}};}).filter(op=>!extraPatch.reviewId||!store.plans.get(planId).tasks.some(t=>t.reviewId===extraPatch.reviewId&&t.title===op.patch.title));if(!operations.length)throw new Error('这些复盘行动已加入任务');await operation(planId,{type:'task.batch',operations});},'确认添加',{inputKey:`batch:${planId}`});
}
function editProperty(ref,key) {
  const task=ensureStore().task(ref);if(!task)return;
  const labels={scheduledDate:'执行日期',dueDate:'截止日期',assigneeId:'负责人',priority:'优先级'};
  dialog(`修改${labels[key]}`,form=>({value:field(form,labels[key],task[key],['assigneeId','priority'].includes(key)?'select':'date',key==='assigneeId'?[['','未分配'],...store.members.map(m=>[m.id,m.username||m.id])]:[['1','高'],['2','中'],['3','低']])}),f=>taskChange(ref.planId,ref.taskId,{[key]:key==='priority'?Number(f.value.value):f.value.value||null}));
}
function selectTask(planId,taskId) {let selected=taskSelection.get(planId);if(!selected){selected=new Set();taskSelection.set(planId,selected);}if(selected.has(taskId))selected.delete(taskId);else{if(selected.size>=100)throw new Error('每批最多选择 100 项任务，请分批处理');selected.add(taskId);}showBatchActions(planId);changed();}
async function moveTask(planId,taskId,direction){const plan=store.plans.get(planId),list=plan.tasks.filter(t=>!t.archived).sort((a,b)=>a.order-b.order),index=list.findIndex(t=>t.id===taskId),task=list[index],neighbor=list[index+direction];if(!neighbor)return;await operation(planId,{type:'task.batch',operations:[{type:'task.update',id:task.id,baseRevision:task.revision,patch:{order:neighbor.order}},{type:'task.update',id:neighbor.id,baseRevision:neighbor.revision,patch:{order:task.order}}]});}
function showBatchActions(planId) {
  document.querySelector('.planning-bulk-actions')?.remove();const selected=taskSelection.get(planId);if(!selected?.size)return;
  const bar=node('div','planning-bulk-actions planning-toplevel');bar.append(node('strong','',`已选择 ${selected.size} 项`),button('统一修改',()=>dialog('批量修改任务',form=>({status:field(form,'状态','','select',[['','保持不变'],...Object.entries(STATUSES)]),date:field(form,'执行日期','','date'),due:field(form,'截止日期','','date'),owner:field(form,'负责人','keep','select',[['keep','保持不变'],['','未分配'],...store.members.map(m=>[m.id,m.username||m.id])]),archive:field(form,'归档所选任务','','checkbox')}),async f=>{const plan=store.plans.get(planId),patch={};if(f.status.value)patch.status=f.status.value;if(f.date.value)patch.scheduledDate=f.date.value;if(f.due.value)patch.dueDate=f.due.value;if(f.owner.value!=='keep')patch.assigneeId=f.owner.value||null;if(f.archive.checked)patch.archived=true;if(!Object.keys(patch).length)throw new Error('请选择需要修改的属性');await operation(planId,{type:'task.batch',operations:[...selected].map(id=>({type:'task.update',id,baseRevision:planIndex(plan).byId.get(id).revision,patch}))});selected.clear();bar.remove();})),button('取消选择',()=>{selected.clear();bar.remove();changed();},'planning-quiet'));document.body.append(bar);
}
function summary(plan) {
  const value = plan.partial?plan.progress:progress(plan), root = node('div', 'planning-summary');
  const data = node('div', 'planning-summary-data'); data.append(node('span', '', value.total ? `${value.done}/${value.total} 项完成` : '尚无任务'), node('strong', '', value.percent === null ? '—' : `${value.percent}%`));
  const track = node('div', 'planning-progress'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', '任务完成率'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(value.percent ?? 0)); const fill = node('span'); fill.style.width = `${value.percent ?? 0}%`; track.append(fill); root.append(data, track);
  if (plan.target) root.append(node('span', 'planning-outcome', `成果 ${plan.current ?? 0}/${plan.target}${plan.unit ? ` ${plan.unit}` : ''}`));
  return root;
}
function taskRow(plan, task, compact = false) {
  const root = node('div', `planning-task${task.archived ? ' is-archived' : ''}`); root.dataset.taskId = task.id; root.dataset.status = task.status;
  root.addEventListener('mouseenter',()=>adapter()?.highlightTask?.(plan.id,task.id));root.addEventListener('mouseleave',()=>adapter()?.highlightTask?.(null,null));
  const ref = { planId: plan.id, taskId: task.id }, checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = task.status === 'done'; checkbox.setAttribute('aria-label', `完成任务：${task.title}`); checkbox.disabled = !canWritePlan(plan);if(checkbox.disabled)checkbox.title='请打开所属内容取得编辑权限';
  checkbox.addEventListener('change', async () => { checkbox.disabled = true; try { await taskChange(plan.id,task.id,{status:checkbox.checked?'done':'todo'}); } catch (error) { checkbox.checked = task.status === 'done'; report(error); } finally { checkbox.disabled = !writable(); } });
  const text = button(task.title, () => editTask(ref), 'planning-task-title');text.setAttribute('aria-label',`任务详情：${task.title}`);
  if(task.parentTaskId){let depth=0,parent=task;const index=planIndex(plan);while(parent.parentTaskId&&depth<3){depth++;parent=index.byId.get(parent.parentTaskId);if(!parent)break;}root.style.marginInlineStart=`${depth*12}px`;}
  const metadata = node('small', 'planning-task-meta');
  const owner = store.members.find(m => m.id === task.assigneeId);
  const stateLabel = button(STATUSES[task.status],()=>chooseStatus(ref),`planning-status planning-status-${task.status} planning-meta-button`); metadata.append(stateLabel);
  if (task.parentTaskId) { const parent = plan.tasks.find(t => t.id === task.parentTaskId); if (parent) metadata.append(node('span', 'planning-parent-task', `子任务 · ${parent.title}`)); }
  const children = childProgress(plan, task.id); if (children.total) metadata.append(node('span', 'planning-child-progress', `拆解 ${children.done}/${children.total}`));
  const scheduled=button(task.scheduledDate?`安排 ${formatDate(task.scheduledDate)}`:'安排日期',()=>editProperty(ref,'scheduledDate'),'planning-meta-button');metadata.append(scheduled);
  const due = button(task.dueDate?`截止 ${formatDate(task.dueDate)}`:'截止日期',()=>editProperty(ref,'dueDate'),'planning-due planning-meta-button');due.prepend(icon('calendar'));due.title=task.dueDate||'设置交付截止日期';metadata.append(due);
  if (task.priority === 1) metadata.append(node('span', 'planning-priority', '高优先级'));
  {const name=task.assigneeId?owner?.username||'原负责人':'分配负责人',assignee=button(name,()=>editProperty(ref,'assigneeId'),'planning-assignee planning-meta-button');if(task.assigneeId){const avatar=node('span','planning-avatar',Array.from(name)[0]);assignee.prepend(avatar);}metadata.append(assignee);}
  metadata.append(button(task.focused?'★ 下一步':'设为重点',()=>taskChange(plan.id,task.id,{focused:!task.focused,...(!task.assigneeId?{assigneeId:store.scope}:{})}),'planning-meta-button'));
  if(task.verified)metadata.append(node('span','planning-verified','已验收'));
  if(task.dependsOn?.some(id=>planIndex(plan).byId.get(id)?.status!=='done'))metadata.append(node('span','planning-dependency','等待前置任务'));
  if(task.linkState==='unavailable')metadata.append(node('span','planning-warning','来源暂时无法读取'));
  if (!task.linked && task.sources.length) metadata.append(node('span', '', '来源待关联'));
  if (matches(task, 'overdue', store.scope)) { root.classList.add('is-overdue'); metadata.append(node('span', 'planning-overdue-label', '已逾期')); }
  const content = node('div', 'planning-task-copy'); content.append(text, metadata); root.append(checkbox, content);
  const menu=node('details','planning-row-menu'),toggle=node('summary','','更多');toggle.setAttribute('aria-label',`更多任务操作：${task.title}`);menu.append(toggle,button('选择任务',()=>selectTask(plan.id,task.id),'planning-quiet'),button('优先级',()=>editProperty(ref,'priority'),'planning-quiet'),button('移到某状态',()=>chooseStatus(ref),'planning-quiet'),button('上移',()=>moveTask(plan.id,task.id,-1),'planning-quiet'),button('下移',()=>moveTask(plan.id,task.id,1),'planning-quiet'));
  const remove = button('删除任务', () => deleteTask(plan, task), 'planning-row-action planning-danger'); remove.setAttribute('aria-label', `删除任务：${task.title}`); remove.title = '删除任务'; remove.disabled = !canWritePlan(plan); menu.append(remove);root.append(menu);root.classList.toggle('is-selected',taskSelection.get(plan.id)?.has(task.id)||false);
  root.addEventListener('click', event => { if (event.button===0&&!event.target.closest('button,input,select,textarea,details,a')) { event.stopPropagation(); editTask(ref); } });
  if (!compact && task.blockedReason) root.append(node('small', 'planning-blocked-reason', task.blockedReason));
  for(const control of root.querySelectorAll('button'))if(!control.classList.contains('planning-task-title')){control.disabled=!canWritePlan(plan);if(control.disabled)control.title='请打开所属内容取得编辑权限';}
  return root;
}
function planDetails(plan, draft = null) {
  if (!plan) throw new Error('规划不存在或无权访问');
  let revision = plan.revision;
  plan = { ...plan, ...draft?.operation?.patch };
  let updateTracking = () => {};
  const ownOperation = async op => { const result = await operation(plan.id, op); revision = result.revision; plan = result; updateTracking(); return result; };
  dialog('规划设置与复盘', form => {
    if (draft) form.append(node('p', 'planning-draft-intent', `检查原草稿后重新提交${draft.operation.patch.host ? ' · 同时迁移规划宿主' : ''}${draft.operation.patch.archived !== undefined ? draft.operation.patch.archived ? ' · 同时归档规划' : ' · 同时恢复规划' : ''}`));
    const name = field(form, '规划名称', plan.name); name.required = true;
    const goal = field(form, '目标', plan.goal, 'textarea'), criteria = field(form, '完成标准', plan.criteria, 'textarea');
    const current = field(form, '当前成果值', plan.current, 'number'), target = field(form, '目标值', plan.target, 'number'), unit = field(form, '单位', plan.unit);
    const wip=field(form,'进行中提醒数量（0 为关闭）',plan.wipLimit||0,'number');wip.step='1';wip.max='30';
    const milestones = node('section', 'planning-milestones'), reviews = node('section', 'planning-reviews');
    updateTracking = () => {
    milestones.replaceChildren(node('strong', 'planning-section-label', '里程碑'));
    for (const milestone of plan.milestones) {
      const row = node('div', 'planning-milestone'), box = node('input'); box.type = 'checkbox'; box.checked = milestone.done; box.setAttribute('aria-label', `完成里程碑：${milestone.title}`);
      box.addEventListener('change', async () => { box.disabled = true; try { const result = await ownOperation({ type: 'milestone.update', id: milestone.id, baseRevision: milestone.revision, patch: { done: box.checked } }); Object.assign(milestone, result.milestones.find(m => m.id === milestone.id)); } catch (error) { box.checked = milestone.done; report(error); } finally { box.disabled = false; } });
      const actions = node('div', 'planning-milestone-actions');
      actions.append(button('编辑里程碑', () => dialog('编辑里程碑', inner => ({ title: field(inner, '里程碑名称', milestone.title), criteria: field(inner, '完成标准', milestone.criteria, 'textarea') }), f => ownOperation({ type: 'milestone.update', id: milestone.id, baseRevision: milestone.revision, patch: { title: f.title.value, criteria: f.criteria.value } })), 'planning-quiet'));
      actions.append(button('删除里程碑', () => confirmDeletion('删除里程碑', `删除“${milestone.title}”后，所属任务保留并解除里程碑分组。`, () => ownOperation({ type: 'milestone.delete', id: milestone.id, baseRevision: milestone.revision })), 'planning-danger'));
      row.append(box, node('span', '', milestone.title), node('small', '', milestone.criteria), actions); milestones.append(row);
    }
    if (!plan.milestones.length) milestones.append(node('p', 'planning-hint', '把重要的交付节点记录在这里。'));
    milestones.append(button('添加里程碑', () => { const milestoneId = id('milestone'); return dialog('添加里程碑', inner => ({ title: field(inner, '里程碑名称'), criteria: field(inner, '完成标准', '', 'textarea') }), f => ownOperation({ type: 'milestone.create', id: milestoneId, patch: { title: f.title.value, criteria: f.criteria.value } })); }, 'planning-quiet'));
    reviews.replaceChildren(node('strong', 'planning-section-label', '复盘记录'), button('添加复盘记录', () => { const reviewId = id('review'); return dialog('复盘记录', inner => ({ results: field(inner, '完成成果', '', 'textarea'), reasons: field(inner, '未完成原因', '', 'textarea'), next: field(inner, '下一步调整', '', 'textarea') }), f => ownOperation({ type: 'review.create', id: reviewId, patch: { results: f.results.value, reasons: f.reasons.value, next: f.next.value } })); }, 'planning-quiet'));
    for (const review of [...plan.reviews].reverse()) { const block = node('div', 'planning-review'); block.append(node('strong', '', today(review.createdAt)), node('p', '', `成果：${review.results || '未填写'}`), node('p', '', `原因：${review.reasons || '未填写'}`), node('p', '', `调整：${review.next || '未填写'}`),button('编辑复盘',()=>dialog('编辑复盘',inner=>({results:field(inner,'完成成果',review.results,'textarea'),reasons:field(inner,'未完成原因',review.reasons,'textarea'),next:field(inner,'下一步调整',review.next,'textarea')}),f=>ownOperation({type:'review.update',id:review.id,baseRevision:revision,patch:{results:f.results.value,reasons:f.reasons.value,next:f.next.value}})),'planning-quiet'),button('将调整转为任务',()=>batchAdd(plan.id,review.next||'','todo',{evidence:`来自复盘 ${today(review.createdAt)}：${review.results}`,reviewId:review.id}),'planning-quiet'), button('删除复盘记录', () => confirmDeletion('删除复盘记录', '删除这条复盘记录？规划、任务和其他复盘记录保留。', () => ownOperation({ type: 'review.delete', id: review.id, baseRevision: revision })), 'planning-danger')); reviews.append(block); }
    };
    updateTracking(); form.append(milestones, reviews);
    if(plan.ownerId===store.scope){const management=node('div','planning-actions');management.append(button('归档规划',async()=>{await ownOperation({type:'plan.update',baseRevision:revision,patch:{archived:true}});management.closest('dialog').close();},'planning-quiet'),button('删除规划',()=>confirmDeletion('删除规划','移入回收站，30 天内可恢复；所有引用暂时不可使用。',async()=>{await ownOperation({type:'plan.delete',baseRevision:revision});management.closest('dialog')?.close();}),'planning-danger'));form.append(management);}
    return { name, goal, criteria, current, target, unit,wip };
  }, async f => { await operation(plan.id, { type: 'plan.update', baseRevision: revision, patch: { ...draft?.operation?.patch, name: f.name.value, goal: f.goal.value, criteria: f.criteria.value, current: f.current.value === '' ? null : Number(f.current.value), target: f.target.value === '' ? null : Number(f.target.value), unit: f.unit.value,wipLimit:Number(f.wip.value) } }); if (draft) await store.discard(draft.opId); },'保存',{inputKey:`plan:${plan.id}`});
}
function createPlanning(view = 'list', point = null, insert = false) {
  if (!enabled) return;
  checkWrite(); const currentHost = adapter().host(), newPlanId = id('plan'), milestoneIds = [id('milestone'), id('milestone')], taskIds = [id('task'), id('task'), id('task')];
  dialog(insert ? '插入规划' : '新建规划', form => ({ name: field(form, '规划名称', '新规划'), template: field(form, '起始模板', '', 'select', [['', '空白规划'], ['weekly', '个人周计划'], ['team', '小团队项目'], ['creative', '创意交付']]) }), async f => {
    await ready(); let plan = store.plans.get(newPlanId) || await store.create(currentHost, f.name.value, clientId(), newPlanId); selectedPlan = plan.id;
    const templates = { weekly: { goal: '明确本周最重要的成果', criteria: '周末检查成果并记录下一周重点', milestones: ['本周重点', '周末复盘'], tasks: ['确定本周三项重点', '推进最重要的成果', '记录本周复盘与下周调整'] }, team: { goal: '明确项目交付目标', criteria: '按约定的交付标准验收', milestones: ['方案确认', '交付验收'], tasks: ['确认范围与完成标准', '分配交付任务', '验收成果并记录复盘'] }, creative: { goal: '把创意变成可交付作品', criteria: '完成作品并确认交付成果', milestones: ['方案选择', '作品交付'], tasks: ['收集素材并选择方案', '制作可交付作品', '确认交付并记录反馈'] } };
    if (templates[f.template.value]) {
      const template = templates[f.template.value]; if (plan.goal !== template.goal || plan.criteria !== template.criteria) plan = await operation(plan.id, { type: 'plan.update', baseRevision: plan.revision, patch: { goal: template.goal, criteria: template.criteria } });
      for (const [index, title] of template.milestones.entries()) if (!plan.milestones.some(m => m.id === milestoneIds[index])) plan = await operation(plan.id, { type: 'milestone.create', id: milestoneIds[index], patch: { title, criteria: '' } });
      for (const [index, title] of template.tasks.entries()) if (!plan.tasks.some(task => task.id === taskIds[index])) plan = await operation(plan.id, { type: 'task.create', id: taskIds[index], patch: { title } });
    }
    if (insert || f.template.value) await adapter().insert(plan.id, view, point);
    if (!insert) showPanel(true);
  }, insert ? '插入规划' : '创建规划');
}
function insertPlanning(point = null) { return createPlanning('list', point, true); }
function joinSources(sources,settings={}) {
  if (!enabled || !sources.length) return;
  checkWrite();
  const currentHost = adapter().host(), options = choosePlanOptions(), newPlanId = id('plan');
  dialog('加入规划', form => {
    const select = field(form, '目标规划', selectedPlan && options.some(([key]) => key === selectedPlan) ? selectedPlan : options[0]?.[0] || '', 'select', [['', '在当前内容中新建规划'], ...options]);
    const audience=node('p','planning-sharing-preview');const showAudience=()=>{const p=store.plans.get(select.value);audience.textContent=p&&p.ownerId!==store.scope?'任务标题、阻塞说明和成果将与规划所属内容的成员共享；私有来源的定位权限仍独立检查。':'任务信息沿用所属画布 / 笔记的共享范围。请确认标题没有不适合共享的信息。';};select.addEventListener('change',showAudience);showAudience();form.append(audience);
    const name = field(form, '新规划名称', '新规划'), rows = [];
    for (const source of sources.slice(0, 100)) {
      const row = node('div', 'planning-source-preview'), checked = node('input'); checked.type = 'checkbox'; checked.checked = !settings.choose&& !source.taskRef;checked.disabled=Boolean(source.taskRef); checked.setAttribute('aria-label', `加入：${source.title}`);
      const title = field(row, '任务标题', source.title || '新任务'); title.maxLength = 200; row.prepend(checked); form.append(row); rows.push({ checked, title, source, taskId: id('task') });
    }
    form.append(node('p', 'planning-hint', '只关联勾选内容；脑图按明确选择的节点建立任务。'));
    return { select, name, rows };
  }, async f => {
    await ready(); const rows = f.rows.filter(r => r.checked.checked); if (!rows.length) throw new Error('请至少选择一项内容');
    let plan = f.select.value ? store.plans.get(f.select.value) : await store.create(currentHost, f.name.value, clientId(), newPlanId);
    if (!plan || plan.archived) throw new Error('规划已失效，请重新选择');
    selectedPlan = plan.id;
    const creates=rows.filter(row=>!row.source.taskRef&&!store.plans.get(plan.id)?.tasks.some(task=>task.id===row.taskId)).map(row=>({type:'task.create',id:row.taskId,patch:{title:row.title.value,status:row.source.status||'todo',sources:[row.source.ref],linked:false,...(settings.hierarchy?{parentTaskId:rows.find(parent=>parent.source.ref.nodeId===row.source.parentNodeId&&parent.source.ref.entityId===row.source.ref.entityId)?.taskId||null}:{})}}));
    if(creates.length)plan=await operation(plan.id,{type:'task.batch',operations:creates});
    for (const row of rows) {
      const taskId = row.source.taskRef?.taskId || row.taskId;
      if (row.source.taskRef) continue;
      const ref = { planId: plan.id, taskId };
      await row.source.bind(ref);
      const task = store.task(ref); if (!task.linked) plan = await operation(plan.id, { type: 'task.update', id: taskId, baseRevision: task.revision, patch: { linked: true } });
    }
    if (rows.some(row => row.source.ref.nodeId) && sameHost(plan.host, adapter()?.host())) await adapter().ensureComponent(plan.id, rows[0].source.ref);
    for (const row of rows) if (row.source.ref.nodeId) await adapter().ensureTaskConnections(plan.id, row.source.ref.entityId);
    showPanel(true);
  }, '确认加入');
}
function renderComponent(root, data) {
  const plan = enabled ? ensureStore().plans.get(data.planRef) : null;
  data.renderState = componentState(data);
  root.replaceChildren(); root.className = 'planning-component';
  if (!enabled) { root.append(node('p', 'planning-hint', '规划功能未启用')); return; }
  if (!plan || plan.archived) { root.append(node('p', 'planning-hint', plan?.archived ? '规划已归档' : store.cloud || store.guest ? '无权访问或规划已删除' : '离线 · 规划尚未载入')); return; }
  if(plan.partial){root.append(node('p','planning-hint','正在载入规划任务…'));store.loadPlan(plan.id).catch(report);return;}
  root.dataset.planId = plan.id;
  const heading = node('div', 'planning-component-heading planning-component-drag'), name = node('strong', 'planning-grip', plan.name); name.prepend(icon('grip')); name.title = '拖动移动 · 双击编辑规划';
  const controls = node('div', 'planning-component-actions'), edit = button('编辑规划', () => planDetails(plan), 'planning-quiet'); controls.append(edit);
  if (data.remove) { const remove = button('删除组件', () => confirmDeletion('删除规划组件', '仅删除当前位置的规划组件，规划与任务仍保留在规划侧栏中。', async () => { checkWrite(); await data.remove(); }), 'planning-row-action planning-danger'); remove.setAttribute('aria-label', '删除规划组件'); remove.title = '删除规划组件'; remove.disabled = !data.writable?.(); controls.append(remove); }
  heading.append(name, controls);
  const tabs = node('div', 'planning-view-tabs');
  VIEWS.forEach((view, index) => { const tab = button(['清单', '看板', '日历'][index], () => { data.setView(view); }, 'planning-quiet'); tab.setAttribute('aria-pressed', String(view === data.planView)); tabs.append(tab); });
  root.append(heading, summary(plan));
    if (plan.goal) root.append(node('p', 'planning-goal', plan.goal)); root.append(tabs);
  const body = node('div', 'planning-body'), tasks = plan.tasks.filter(t => !t.archived).sort((a, b) => a.order - b.order);
  if (data.planView === 'kanban') {
    body.classList.add('planning-kanban');
    for (const [status, label] of Object.entries(STATUSES)) {
      const column = node('section', 'planning-column'), list = tasks.filter(t => t.status === status); column.dataset.status = status; const title = node('h4'); title.append(node('span', `planning-status planning-status-${status}`, label), node('span', 'planning-count', list.length)); column.append(title);
      data.collapsedColumns||={};const collapsed=data.collapsedColumns[status]??(status==='done'&&list.length>10),fold=button(collapsed?'展开':'收起',()=>{data.collapsedColumns[status]=!collapsed;renderComponent(root,data);},'planning-quiet');fold.setAttribute('aria-label',`${collapsed?'展开':'收起'}${label}列`);fold.setAttribute('aria-expanded',String(!collapsed));title.append(fold);
      if(collapsed){column.append(node('p','planning-hint',`${list.length} 项任务已收起`));body.append(column);continue;}
      const reorder = async (event, before = null) => {
        event.preventDefault(); event.stopPropagation(); if (!canWritePlan(plan)) return;
        const transferred = event.dataTransfer.getData('application/x-muse-task');
        const task = tasks.find(t => t.id === transferred); if (!task||task.id===before?.id) return;
        const others=list.filter(t=>t.id!==task.id);
        const order = before ? (() => { const index = others.indexOf(before); return ((others[index - 1]?.order ?? before.order - 2) + before.order) / 2; })() : (others.at(-1)?.order ?? -1) + 1;
        await operation(plan.id, { type: 'task.update', id: task.id, baseRevision: task.revision, patch: { status, order } });
      };
      column.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); }); column.addEventListener('drop', event => reorder(event).catch(report));
      if(status==='doing'&&plan.wipLimit&&list.length>plan.wipLimit)column.append(node('p','planning-wip-warning',`已有 ${list.length} 项进行中，建议先完成再开始`));
      taskList(column,list,task=>{const row=taskRow(plan,task);row.draggable=writable();row.addEventListener('dragstart',event=>{event.stopPropagation();event.dataTransfer.setData('application/x-muse-task',task.id);event.dataTransfer.effectAllowed='move';});row.addEventListener('drop',event=>reorder(event,task).catch(report));return row;},()=>adapter()?.refreshConnections?.());
      column.append(button('+ 添加任务', anchor => addTask(plan.id, anchor, status), 'planning-column-add'));
      body.append(column);
    }
  } else if (data.planView === 'calendar') {
    body.classList.add('planning-calendar');
    data.calendarMode??=innerWidth<=700?'agenda':'month';
    const month = data.month || today().slice(0, 7), nav = node('div', 'planning-calendar-nav');
    const changeMonth = offset => { const value = new Date(`${month}-01T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + offset); data.month = value.toISOString().slice(0, 7); renderComponent(root, data); };
    nav.append(button(data.calendarMode==='agenda'?'月视图':'日程',()=>{data.calendarMode=data.calendarMode==='agenda'?'month':'agenda';renderComponent(root,data);},'planning-quiet'));
    nav.append(button('上一月', () => changeMonth(-1), 'planning-quiet'), node('strong', '', `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`),button('今天',()=>{data.month=today().slice(0,7);renderComponent(root,data);},'planning-quiet'), button('下一月', () => changeMonth(1), 'planning-quiet')); body.append(nav);
    const grid = node('div', 'planning-calendar-grid'); ['一', '二', '三', '四', '五', '六', '日'].forEach(day => grid.append(node('span', 'planning-weekday', day)));
    const first = new Date(`${month}-01T00:00:00Z`), days = new Date(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getDate();
    for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) grid.append(node('div', 'planning-calendar-day is-empty'));
    const dates=new Map();for(const task of tasks)for(const value of new Set([task.dueDate,task.scheduledDate].filter(Boolean))){if(!dates.has(value))dates.set(value,[]);dates.get(value).push(task);}
    for (let day = 1; day <= days; day++) { const value = `${month}-${String(day).padStart(2, '0')}`, cell = node('div', `planning-calendar-day${value === today() ? ' is-today' : ''}`); cell.append(node('strong', 'planning-day-number', day),button('+',()=>dialog('按日添加任务',form=>({title:field(form,'任务标题')}),f=>operation(plan.id,{type:'task.create',id:id('task'),patch:{title:f.title.value,scheduledDate:value,assigneeId:store.scope}}),'添加'),'planning-day-add'));const list=dates.get(value)||[];for(const task of list.slice(0,3)){const event=button(`${task.dueDate===value?'截止 · ':''}${task.title}`,()=>editTask({planId:plan.id,taskId:task.id}),'planning-calendar-task');event.dataset.taskId=task.id;event.dataset.status=task.status;event.title=`${task.title} · ${STATUSES[task.status]}`;cell.append(event);}if(list.length>3)cell.append(button(`还有 ${list.length-3} 项`,()=>dialog(`${value} 的任务`,form=>{taskList(form,list,task=>taskRow(plan,task),()=>{});return {};},()=>{}),'planning-quiet'));grid.append(cell); }
    if(data.calendarMode==='agenda'){for(const [date,list] of [...dates].filter(([day])=>day.startsWith(month)).sort(([a],[b])=>a.localeCompare(b))){body.append(node('h4','',date));taskList(body,list,task=>taskRow(plan,task),()=>adapter()?.refreshConnections?.());}}else body.append(grid);
    body.append(node('h4', '', '未安排'));taskList(body,tasks.filter(t=>!t.dueDate&&!t.scheduledDate),task=>taskRow(plan,task),()=>adapter()?.refreshConnections?.());
  } else taskList(body,tasks,task=>taskRow(plan,task),()=>adapter()?.refreshConnections?.());
  if (!tasks.length) body.append(node('p', 'planning-empty', '添加第一项任务，开始安排与跟踪。'));
  root.append(body);
  const shown = new Set([...body.querySelectorAll('[data-task-id]')].map(row => row.dataset.taskId)), outside = data.planView==='calendar'?tasks.filter(task => task.sources.length && !shown.has(task.id)):[];
  if (outside.length) { const dock = node('div', 'planning-link-dock'); dock.append(node('small', '', '当前视图外的关联任务')); for (const task of outside.slice(0,20)) { const port = button(task.title, () => editTask({ planId: plan.id, taskId: task.id }), 'planning-link-target'); port.dataset.taskId = task.id; dock.append(port); }if(outside.length>20)dock.append(button(`查看其余 ${outside.length-20} 项`,()=>dialog('其他关联任务',form=>{taskList(form,outside,task=>taskRow(plan,task),()=>{});return {};},()=>{}),'planning-quiet')); root.append(dock); }
  const footer = node('div', 'planning-component-footer');
  footer.append(button('添加任务', anchor => addTask(plan.id, anchor), 'planning-add')); root.append(footer);
}
function mount(data, setView, controls = {}) {
  const root = node('section', 'planning-component'); root.setAttribute('aria-label', '规划组件');
  const entry = { ...data, ...controls, setView: view => { entry.planView = view; renderComponent(root, entry); if (writable()) return setView(view); } }; mounts.set(root, entry);
  let middleDown,middleClick;
  root.addEventListener('pointerdown', event => {
    if(event.button===1){
      if(controls.focus){event.preventDefault();event.stopPropagation();middleDown={pointerId:event.pointerId,x:event.clientX,y:event.clientY};root.setPointerCapture(event.pointerId);}
      return;
    }
    const dragArea = event.target.closest('.planning-component-drag') || event.target === root || event.pointerType !== 'touch' && event.target.classList.contains('planning-body');
    if (dragArea && !event.target.closest('button,input,select,textarea')) { if (controls.move?.(event) !== false) event.stopPropagation(); }
    else event.stopPropagation();
  });
  root.addEventListener('pointerup',event=>{
    if(event.button!==1||!controls.focus||middleDown?.pointerId!==event.pointerId)return;
    const down=middleDown;middleDown=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
    if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>8){middleClick=null;return;}
    const now=performance.now();if(middleClick&&now-middleClick.time<=400&&Math.hypot(event.clientX-middleClick.x,event.clientY-middleClick.y)<=8){middleClick=null;controls.focus();}else middleClick={time:now,x:event.clientX,y:event.clientY};
  });
  root.addEventListener('pointercancel',()=>{middleDown=null;middleClick=null;});
  root.addEventListener('dblclick', event => { event.stopPropagation(); if (event.button===0&&!event.target.closest('button,input,select,textarea,.planning-task,.planning-quick-form')) { const plan = ensureStore().plans.get(entry.planRef); if (plan && !plan.archived) planDetails(plan); } });
  // Match worksheet previews: zoom reaches the canvas, ordinary wheel input
  // stays inside the planning list or board columns.
  root.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) event.stopPropagation(); }, { passive: true });
  root.addEventListener('scroll', () => adapter()?.refreshConnections?.(), true);
  for (const name of ['keydown', 'contextmenu']) root.addEventListener(name, event => event.stopPropagation());
  renderComponent(root, entry); return root;
}
function renderLinked(ref, bodyText = '') {
  const root = node('div', 'planning-linked'); root.dataset.planId = ref.planId; root.dataset.taskId = ref.taskId;
  const title = button('', () => editTask(ref), 'planning-task-title'); title.dataset.linkedTitle = 'true';
  const metadata = node('small', 'planning-task-meta'); metadata.dataset.linkedStatus = 'true';
  const toggle = node('input'); toggle.type = 'checkbox'; toggle.dataset.linkedChecked = 'true'; toggle.setAttribute('aria-label', '完成关联任务');
  toggle.addEventListener('change', async () => { const task = ensureStore().task(ref); if (!task || !writable()) return; try { await operation(ref.planId, { type: 'task.update', id: task.id, baseRevision: task.revision, patch: { status: toggle.checked ? 'done' : 'todo' } }); } catch (error) { toggle.checked = task.status === 'done'; report(error); } });
  root.append(toggle, title, metadata);
  const body = String(bodyText || '').split('\n').slice(1).join('\n');
  if (body) { const description = node('p', 'planning-linked-body', body); description.hidden = !ensureStore().task(ref); root.append(description); }
  root.addEventListener('pointerdown', event => { if (event.target.closest('button,input')) event.stopPropagation(); });
  updateLinked(root, ref); return root;
}
function updateLinked(root, ref) {
  const task = ensureStore().task(ref), title = root.querySelector('[data-linked-title]'), status = root.querySelector('[data-linked-status]');
  const loading=ensureStore().plans.get(ref.planId)?.partial;
  if (title) title.textContent = task?.title || (loading?'正在载入':'无权访问');
  if (status) status.textContent = task ? [STATUSES[task.status], task.dueDate ? formatDate(task.dueDate) : ''].filter(Boolean).join(' · ') : loading?'正在载入任务…':'任务不存在或无权访问';
  const toggle = root.querySelector('[data-linked-checked]'); if (toggle) { toggle.checked = task?.status === 'done'; toggle.disabled = !task || task.deleted || !writable(); }
  if (task?.deleted && status) status.textContent = '任务已删除 · 原文保留，可解除关联';
  const body = root.querySelector('.planning-linked-body'); if (body) body.hidden = !task;
}
function applyPanelPosition() {
  if (!panel) return;
  const pref=preferences();panelPosition||=pref.position||null;panel.classList.toggle('is-docked',Boolean(pref.docked));panel.dataset.density=pref.density||'comfortable';if(pref.width&&innerWidth>700)panel.style.width=`${Math.max(320,Math.min(pref.width,innerWidth*.6))}px`;
  if(innerWidth<=700||pref.docked||!panelPosition){panel.style.removeProperty('left');panel.style.removeProperty('top');return;}
  const width = panel.getBoundingClientRect().width || 336;
  panelPosition.left = Math.max(12, Math.min(panelPosition.left, innerWidth - width - 12));
  panelPosition.top = Math.max(12, Math.min(panelPosition.top, innerHeight - 304));
  panel.style.left = `${panelPosition.left}px`; panel.style.top = `${panelPosition.top}px`;
}
function startPanelMove(event) {
  if (event.button !== 0 || innerWidth <= 700 || !event.target.closest('.planning-heading-copy') || !event.target.closest('.planning-heading')?.parentElement?.isSameNode(panel)) return;
  event.preventDefault(); event.stopPropagation(); cancelPanelMove?.();
  const rect = panel.getBoundingClientRect(), previous = panelPosition && { ...panelPosition }, pointerId = event.pointerId;
  const move = next => { if (next.pointerId !== pointerId) return; panelPosition = { left: rect.left + next.clientX - event.clientX, top: rect.top + next.clientY - event.clientY }; applyPanelPosition(); };
  const finish = (cancelled = false) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId); panel.classList.remove('is-moving'); cancelPanelMove = null; if (cancelled) { panelPosition = previous; applyPanelPosition(); }else savePreferences({position:panelPosition,width:panel.offsetWidth}).catch(report); };
  const up = next => { if (next.pointerId === pointerId) finish(); }, cancel = next => { if (next.pointerId === pointerId) finish(true); }, key = next => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); finish(true); } };
  cancelPanelMove = () => finish(true); panel.setPointerCapture(pointerId); panel.classList.add('is-moving'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true);
}
function renderPanel() {
  if (!panel || !panelOpen || !enabled) return;
  if (queryComposing && document.activeElement === panel.querySelector('[aria-label="搜索规划任务"]')) return;
  const quickForms = [...panel.querySelectorAll('.planning-quick-form')], quickFocus = quickForms.some(form => form.contains(document.activeElement)) ? document.activeElement : null, searchFocused = document.activeElement === panel.querySelector('[aria-label="搜索规划任务"]'), selection = searchFocused ? document.activeElement.selectionStart : 0;
  const focusName = panel.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  const scroll = panel.querySelector('.planning-panel-content')?.scrollTop || 0;
  panel.classList.toggle('planning-notes', Boolean(window.__independentNotesActive)); panel.replaceChildren(header('规划与跟踪', () => showPanel(false)));
  const reset = button('复位位置',async()=>{panelPosition=null;await savePreferences({position:null,width:336,docked:false});applyPanelPosition();}, 'planning-reset-position'); reset.title = '恢复面板位置'; panel.querySelector('.planning-heading').insertBefore(reset, panel.querySelector('.planning-close'));
  const search = node('div', 'planning-search'), searchInput = field(search, '搜索规划任务', query, 'search'); search.prepend(icon('search')); searchInput.placeholder = '搜索任务、阻塞说明、成果…'; searchInput.addEventListener('compositionstart', () => { queryComposing = true; }); searchInput.addEventListener('input', event => { query = searchInput.value; if (!event.isComposing && !queryComposing){clearTimeout(searchTimer);searchTimer=setTimeout(renderPanel,100);} }); searchInput.addEventListener('compositionend', () => { queryComposing = false; query = searchInput.value; renderPanel(); }); panel.append(search);
  const presets=node('div','planning-presets');for(const [value,label] of [['today','今日安排'],['next','下一步'],['waiting','等待事项']]){const control=button(label,()=>{filter=value;scope='mine';renderPanel();},'planning-quiet');control.setAttribute('aria-pressed',String(filter===value));presets.append(control);}panel.append(presets);
  const selectors = node('div', 'planning-panel-selectors');
  const viewScope = field(selectors, '查看范围', scope, 'select', [['current', '当前画布 / 笔记'], ['mine', '我的任务'], ['all', '全部可访问规划'], ['archived', '已归档规划'],['trash','回收站']]);
  viewScope.addEventListener('change', () => { scope = viewScope.value; selectedPlan = null; renderPanel(); });
  const taskFilter = field(selectors, '任务筛选', filter, 'select', [['all', '全部任务'],['unfinished','未完成'], ['mine', '我的未完成'],['today','今日安排'],['next','下一步重点'],['waiting','等待事项'], ['week', '本周到期'], ['overdue', '已逾期'], ['blocked', '阻塞'], ['archived', '归档任务']]);
  taskFilter.addEventListener('change', () => { filter = taskFilter.value; renderPanel(); });const filterBox=node('details','planning-filter-box');filterBox.open=innerWidth>700;filterBox.append(node('summary','',`筛选 · ${viewScope.selectedOptions[0]?.textContent||'当前内容'}`),selectors);panel.append(filterBox);
  const actions = node('div', 'planning-actions planning-panel-toolbar'); actions.append(button('新建规划', () => createPlanning(), 'planning-quiet'), button('刷新', () => store.refresh(), 'planning-quiet'),button('保存筛选',saveView,'planning-quiet'),button('显示设置',planningSettings,'planning-quiet')); panel.append(actions);
  const views=preferences().views||[];if(views.length){const saved=field(panel,'常用筛选','','select',[['','选择常用筛选'],...views.map((view,i)=>[String(i),view.name])]);saved.addEventListener('change',()=>{const view=views[Number(saved.value)];if(saved.value!==''&&view){scope=view.scope;filter=view.filter;query=view.query;renderPanel();}});panel.append(button('管理筛选',manageViews,'planning-quiet'));}
  const content = node('div', 'planning-panel-content'); panel.append(content);
  const plans = [...ensureStore().plans.values()].filter(p=>!p.purged&&(scope==='trash'?p.deleted||p.ownerId===store.scope&&(p.trashCount>0||p.deletedTasks?.some(t=>t.snapshot)):!p.deleted&&(scope==='archived'?p.archived:!p.archived&&(scope!=='current'||inCurrent(p)))));
  for (const plan of plans) {
    const section = node('section', 'planning-panel-plan'), heading = node('div', 'planning-heading'); section.dataset.planId = plan.id;
    heading.append(button(plan.name, () => { selectedPlan = selectedPlan === plan.id ? null : plan.id; renderPanel(); }, 'planning-plan-name'));
    if(plan.deleted)heading.append(button('恢复规划',()=>operation(plan.id,{type:'plan.restore',baseRevision:plan.revision})),button('永久清理',()=>confirmDeletion('永久清理规划','清理后不能恢复正文，关联内容会显示规划不可用；最小操作回执仍保留。',()=>operation(plan.id,{type:'plan.purge',baseRevision:plan.revision})),'planning-danger'));
    else if (plan.archived) heading.append(button('恢复到当前内容', () => operation(plan.id, { type: 'plan.update', baseRevision: plan.revision, patch: { host: adapter().host(), archived: false } })),button('移入回收站',()=>confirmDeletion('删除规划','30 天内可恢复。',()=>operation(plan.id,{type:'plan.delete',baseRevision:plan.revision})),'planning-danger'));
    else heading.append(button('设置',async()=>planDetails(await store.loadPlan(plan.id)), 'planning-quiet')); section.append(heading, summary(plan));
    if (!selectedPlan || selectedPlan === plan.id || scope === 'mine') {
      if(plan.partial){section.append(node('p','planning-hint','正在载入任务…'));store.loadPlan(plan.id).catch(report);}
      const tasks = scope==='trash'?[]:plan.tasks.filter(t => (scope !== 'mine' || t.assigneeId === store.scope) && matches(t, filter, store.scope,Date.now(),planIndex(plan).byId) && (!query.trim() || `${t.title} ${t.blockedReason} ${t.evidence}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).sort((a, b) => a.order - b.order);
      taskList(section,tasks,task=>taskRow(plan,task,true),()=>adapter()?.refreshConnections?.());
      if(!plan.deleted&&plan.ownerId===store.scope&&(scope==='trash'||filter==='archived'))for(const record of plan.deletedTasks||[]){if(!record.snapshot)continue;const row=node('div','planning-trash-task');row.append(node('span','',record.title),button('恢复任务',()=>operation(plan.id,{type:'task.restore',id:record.id}),'planning-quiet'),button('永久清理任务',()=>confirmDeletion('永久清理任务','正文清理后无法恢复；原引用保留最小标识。',()=>operation(plan.id,{type:'task.purge',id:record.id})),'planning-danger'));section.append(row);}
      if (!tasks.length) section.append(node('p', 'planning-filter-empty', query || filter !== 'all' ? '没有符合条件的任务' : scope === 'mine' ? '还没有分配给你的任务' : '添加一项任务，开始推进计划'));
      if (!plan.archived&&scope!=='trash') { const footer = node('div', 'planning-actions planning-plan-footer'); footer.append(button('添加任务', anchor => addTask(plan.id, anchor), 'planning-quiet'), button('插入当前内容', () => { checkWrite(); return adapter().insert(plan.id, 'list'); }, 'planning-quiet')); section.append(footer); }
    }
    content.append(section);
  }
  for (const quick of quickForms) {
    const target = [...content.querySelectorAll('.planning-panel-plan')].find(section => section.dataset.planId === quick.dataset.planId);
    if (target) placeQuickForm(target,quick);
    else { const retained = node('section', 'planning-retained-input'); retained.append(node('strong', '', '其他内容中的未提交输入'), node('p', 'planning-hint', '切回原画布或笔记后继续提交。'), quick); content.append(retained); }
  }
  if (!plans.length) content.append(node('p', 'planning-empty', '这里还没有规划。新建规划，或右键选择内容加入规划。'));
  if (store.drafts.size) {
    const drafts = node('section', 'planning-drafts'); drafts.append(node('strong', '', '本地草稿 · 等待提交'));
    for (const draft of store.drafts.values()) { const row = node('div', 'planning-draft'); row.append(node('span', '', draft.operation?.type === 'task.decompose' ? '脑图拆解 · 等待来源保存' : draft.operation?.patch?.title || draft.plan?.name || '规划修改'), button('重试提交', () => retryDraft(draft))); if (['task.update', 'plan.update'].includes(draft.operation?.type)) row.append(button('检查后重新应用', async () => { await store.refresh(); if (draft.operation.type === 'task.update') editTask({ planId: draft.planId, taskId: draft.operation.id }, draft); else planDetails(store.plans.get(draft.planId), draft); })); row.append(button('放弃草稿', () => store.discard(draft.opId))); drafts.append(row); }
    content.append(drafts);
  }
  for(const issue of store.issues||[])content.append(node('p','planning-warning',`${issue.message} · ${issue.id}`));
  for(const [key,input] of store.inputs){if(key==='preferences'||!sameHost(input.host,adapter()?.host())||document.querySelector(`[data-input-key="${key}"]`))continue;const row=node('div','planning-retained-input');row.append(node('span','',`${input.title||'未提交输入'} · 已保留`),button('继续编辑',()=>{const [,planId,taskId]=key.split(':');if(key.startsWith('task:'))editTask({planId,taskId});else if(key.startsWith('plan:'))planDetails(store.plans.get(planId));else if(key.startsWith('batch:'))batchAdd(planId);else if(key.startsWith('quick:'))addTask(planId,[...panel.querySelectorAll('.planning-panel-plan')].find(e=>e.dataset.planId===planId)?.querySelector('button'),input.status||'todo');}),button('放弃输入',()=>store.clearInput(key).then(changed),'planning-quiet'));content.append(row);}
  content.scrollTop = scroll;
  const status = node('p', `planning-save-status${!store.guest && !store.cloud || store.drafts.size||store.cacheError ? ' is-pending' : ''}`, store.cacheError|| (store.drafts.size ? `${store.drafts.size} 项草稿等待提交` : store.guest ? '已保存到此设备' : store.cloud ? '已同步 · 权限随内容共享' : '离线 · 输入保留为本地草稿')); status.prepend(node('span', 'planning-save-dot')); panel.append(status);
  if (searchFocused) { searchInput.focus({ preventScroll: true }); searchInput.setSelectionRange(selection, selection); }
  else quickFocus?.focus({ preventScroll: true });
  if (focusName && !searchFocused && !quickFocus) [...panel.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === focusName)?.focus({ preventScroll: true });
  if (innerWidth <= 700 && !panel.contains(document.activeElement) && !document.querySelector('dialog[open]')) panel.focus({ preventScroll: true });
}
function showPanel(open = !panelOpen) {
  if (!enabled) return;
  ensureStore(); const wasOpen = panelOpen; panelOpen = open; if (!open) { queryComposing = false; cancelPanelMove?.(); }
  if (!panel) { panel = node('aside', 'planning-panel planning-toplevel'); panel.tabIndex = -1; panel.setAttribute('aria-label', '规划与跟踪'); document.body.append(panel); panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); showPanel(false); } if (event.key === 'Tab' && innerWidth <= 700) { const controls = [...panel.querySelectorAll('button,input,select,textarea')].filter(e => !e.disabled && e.getClientRects().length), first = controls[0], last = controls.at(-1); if (document.activeElement === panel || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); } } }); }
  if (!panel.dataset.dragReady) { panel.dataset.dragReady = 'true'; panel.addEventListener('pointerdown', startPanelMove); }
  if (!shade) { shade = node('div', 'planning-shade'); shade.addEventListener('pointerdown', () => showPanel(false)); document.body.append(shade); }
  shade.hidden = !open;
  panel.hidden = !open; applyPanelPosition();
  const mobile = innerWidth <= 700; panel.setAttribute('role', mobile ? 'dialog' : 'complementary'); if (mobile) panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
  if (!open || !mobile) { for (const [element, value] of panelInert) element.inert = value; panelInert.clear(); }
  else for (const element of document.body.children) if (element !== panel && element !== shade && !element.matches('script,style,link,.planning-dialog') && !panelInert.has(element)) { panelInert.set(element, element.inert); element.inert = true; }
  if (open) { if (!wasOpen) panelFocus = document.activeElement; renderPanel(); if (mobile && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true }); store.refresh().catch(report); }
  else if (wasOpen && panelFocus?.isConnected) panelFocus.focus({ preventScroll: true });
}
function attachButton(parent) {
  if (!enabled || !parent || parent.querySelector('[data-planning-insert]')) return;
  const insert = button('插入规划', () => insertPlanning());
  insert.id = 'planningButton'; insert.className = 'tool-button'; insert.dataset.planningInsert = 'true';
  insert.setAttribute('aria-label', '插入规划'); insert.setAttribute('aria-haspopup', 'dialog'); insert.title = '插入规划';
  insert.replaceChildren(icon('kanban'), node('span', 'tool-label', '规划'));
  parent.insertBefore(insert, parent.querySelector('#backgroundButton'));
}
async function initialize(canvasAdapter) {
  adapters.canvas = canvasAdapter;
  const response = await fetch('/api/plans/capabilities', { cache: 'no-store' }); enabled = Boolean((await response.json()).enabled);
  if (!enabled) return;
  attachButton(document.querySelector('#toolDock .toolbar-insert')); ensureStore();
  for (const name of ['muse:account-changing', 'muse:logout', 'muse:auth-expired']) window.addEventListener(name, () => { store?.dispose(); store = null; selectedPlan = null; query = '';scope='current';filter='all';panelPosition=null;taskSelection.clear();undoAction=null;returnLocation=null;clearTimeout(searchTimer);document.querySelectorAll('.planning-bulk-actions,.planning-undo,.planning-return').forEach(root=>root.remove());panel?.style.removeProperty('width');panel?.replaceChildren(); showPanel(false); document.querySelectorAll('.planning-dialog').forEach(root => root.close()); changed(); });
  window.addEventListener('online', () => ensureStore().refresh().catch(report));
  window.addEventListener('muse:sharing-changed',()=>ensureStore().refresh().catch(report));
  window.addEventListener('resize', () => { if (panelOpen) showPanel(true); });
  window.addEventListener('pointerup',()=>{if(panelOpen&&innerWidth>700&&panel.offsetWidth&&Math.abs(panel.offsetWidth-(preferences().width||336))>2)savePreferences({width:panel.offsetWidth}).catch(report);});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureStore().refresh().catch(report); });
  setInterval(()=>{if(!document.hidden&&(panelOpen||[...mounts.keys()].some(root=>root.isConnected&&root.getClientRects().length))){ensureStore().refresh({incremental:true}).catch(()=>{});if(preferences().reminders)showReminders();}},30000);
}
function showReminders(){const due=[...store.plans.values()].filter(p=>!p.archived&&!p.deleted).flatMap(p=>p.tasks).filter(t=>!t.archived&&t.status!=='done'&&t.assigneeId===store.scope&&(t.scheduledDate===today()||t.checkDate&&t.checkDate<=today()));if(!due.length)return;const key=`reminder:${today()}`;if(store.inputs.has(key))return;store.saveInput(key,{shown:true}).catch(()=>{});adapter()?.toast?.(`今天有 ${due.length} 项安排或等待事项需要检查，可在规划中查看。`);}
function contextActions(sources, point) {
  if (!enabled) return [];
  const actions = [];
  if (sources?.length) {
    actions.push({ label: '加入规划', icon: 'list-checks', group: 'planning', action: () => joinSources(sources), disabled: !writable() });
    if(sources.length===1&&sources[0].ref?.nodeId&&sources[0].branches)actions.push({label:'选择分支加入规划',icon:'list-checks',group:'planning',action:()=>joinSources(sources[0].branches(),{choose:true,hierarchy:true}),disabled:!writable()});
    if (sources.length === 1 && sources[0].ref?.nodeId && !sources[0].taskRef) actions.push({ label: '关联已有任务', icon: 'link', group: 'planning', action: () => linkExisting(sources[0]), disabled: !writable() });
    if (sources.length === 1 && sources[0].taskRef) {
      const ref = sources[0].taskRef;
      const deleted = ensureStore().task(ref);
      if (deleted?.deleted) return [{ label: '解除任务关联', icon: 'unlink', group: 'planning', action: () => sources[0].unbind(deleted), disabled: !writable() }];
      actions.push({ label: '任务详情', icon: 'list-checks', group: 'planning', action: () => editTask(ref) });
      if (sources[0].ref?.nodeId) actions.push({ label: '添加任务连线', icon: 'link', group: 'planning', action: async () => { await ready(); await adapter().ensureComponent(ref.planId, sources[0].ref); await adapter().ensureTaskConnections(ref.planId, sources[0].ref.entityId); }, disabled: !writable() });
      if (sources[0].edit) actions.push({ label: '编辑来源正文', icon: 'text-cursor', group: 'planning', action: () => sources[0].edit(), disabled: !writable() });
      actions.push({ label: '解除任务关联', icon: 'unlink', group: 'planning', action: async () => { const task = ensureStore().task(ref); if (!task) throw new Error('无权访问任务，不能提取任务内容'); await sources[0].unbind(task); const remaining = task.sources.filter(s => JSON.stringify(s) !== JSON.stringify(sources[0].ref)); await operation(ref.planId, { type: 'task.update', id: task.id, baseRevision: task.revision, patch: { sources: remaining, linked: remaining.length > 0 } }); }, disabled: !writable() });
    }
  }
  return actions;
}
window.MusePlanning = {
  initialize, attachButton, registerNotebook: value => { adapters.notebook = value; changed(); }, contextActions, mount, showPanel, createPlanning, insertPlanning, joinSources,
  renderLinked, updateLinked, statusLabel: status => STATUSES[status] || '', canvasSources: target => adapters.canvas?.sources(target) || [],
  get enabled() { return enabled; }, get store() { return enabled ? ensureStore() : null; }, getTask: ref => enabled ? ensureStore().task(ref) : null,
  editTask,chooseStatus, taskTitle: ref => ensureStore().task(ref)?.title || (ensureStore().plans.get(ref.planId)?.partial?'正在载入':'无权访问'), notify: changed,
  refresh: message => enabled ? message?.planId&&ensureStore().plans.has(message.planId) ? ensureStore().loadPlan(message.planId,true) : ensureStore().refresh({incremental:!message?.type||message.type==='planning-changed'}) : Promise.resolve(), archiveHost: async host => { if (enabled) return ensureStore().archiveHost(host); const localStore = new PlanningStore(() => {}); try { if (localStore.guest) { await localStore.load(); await localStore.archiveHost(host); } } finally { localStore.dispose(); } },
  moveCanvasComponent: (event, itemId) => adapters.canvas?.moveComponent(event, itemId),
  updateTask: (ref, patch, baseRevision = null) => { const task = ensureStore().task(ref); if (!task || task.deleted) return Promise.reject(new Error(task?.deleted ? '任务已删除，请解除关联后编辑原文' : '任务不存在或无权访问')); return operation(ref.planId, { type: 'task.update', id: task.id, baseRevision: baseRevision ?? task.revision, patch }); }
};
