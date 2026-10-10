import { clone, createElement, plainText, replaceDocTitle, uid } from './model.js';

const findNode = (tree, id) => tree?.id === id ? tree : (tree?.children || []).map(child => findNode(child, id)).find(Boolean);
const sameRef = (a, b) => a?.planId === b?.planId && a?.taskId === b?.taskId;
const taskNodes = doc => { const result = []; const visit = value => { if (value?.type === 'taskItem') result.push(value); value?.content?.forEach(visit); }; visit(doc); return result; };
export function setupNotebookPlanning(app) {
  const planning = window.MusePlanning; if (!planning) return;
  const host = () => app.book && app.page ? { kind: 'notebook', notebookId: app.book.id, pageId: app.page.id } : null;
  app.focusPlanningComponent=elementId=>{
    const element=app.page?.elements.find(value=>value.id===elementId),scroll=app.$('.nt-scroll'),current=app.surface.querySelector(`[data-element-id="${elementId}"]`);
    if(!element||!current||!scroll.clientWidth||!scroll.clientHeight)return;
    app.finishEdit();
    app.setZoom(Math.min(1.55,(scroll.clientWidth-48)/Math.max(1,element.w),(scroll.clientHeight-48)/Math.max(1,element.h,current.offsetHeight)));
    const target=app.surface.querySelector(`[data-element-id="${elementId}"]`),rect=target.getBoundingClientRect(),viewport=scroll.getBoundingClientRect();
    scroll.scrollLeft+=rect.left-viewport.left-(scroll.clientWidth-rect.width)/2;
    scroll.scrollTop+=rect.top-viewport.top-(scroll.clientHeight-rect.height)/2;
    app.saveView();
  };
  const save = async () => { app.changed(); await app.store.flush(); if (!app.store.guest && app.store.dirty.has(app.book.id)) throw new Error('来源关联已保留为草稿，尚未同步，请重试关联'); };
  const valid = context => { if (!app.current(context) || !app.writable()) throw new Error('笔记已切换或编辑锁已失效'); };
  const sources = target => {
    if (!app.page) return [];
    const context = app.context(), itemNode = target?.closest('[data-element-id]'), clicked = app.page.elements.find(e => e.id === itemNode?.dataset.elementId);
    const elements = clicked ? app.selection.has(clicked.id) && app.selection.size > 1 ? app.page.elements.filter(e => app.selection.has(e.id)) : [clicked] : app.page.elements.filter(e => app.selection.has(e.id));
    return elements.flatMap(element => {
      if (!['text', 'callout', 'tag', 'mindmap'].includes(element.type)) return [];
      const treeNode = element.type === 'mindmap' ? findNode(element.tree, target?.closest('[data-planning-node]')?.dataset.planningNode || element.tree.id) : null;
      const listItem = target?.closest('li[data-type="taskItem"]');
      let index = listItem && itemNode ? [...itemNode.querySelectorAll('li[data-type="taskItem"]')].indexOf(listItem) : -1;
      if (index < 0 && app.editingId === element.id && app.editor?.isActive('taskItem')) {
        const selected = app.editor.state.selection.$from;
        for (let depth = selected.depth; depth > 0; depth--) if (selected.node(depth).type.name === 'taskItem') { const position = selected.before(depth); let ordinal = -1; app.editor.state.doc.descendants((value, pos) => { if (value.type.name === 'taskItem') { ordinal++; if (pos === position) index = ordinal; } }); break; }
      }
      const originalDoc = app.editingId === element.id ? app.editor.getJSON() : element.doc, taskItem = index >= 0 ? taskNodes(originalDoc)[index] : null;
      const taskNodeId = treeNode?.id || taskItem?.attrs?.planningNodeId || (taskItem ? uid('tasknode') : null);
      const value = treeNode || taskItem || element, title = treeNode ? treeNode.text : taskItem ? plainText(taskItem) : plainText(element.doc);
      const taskRef = treeNode?.taskRef || taskItem?.attrs?.taskRef || element.taskRef;
      const ref = { ...host(), entityId: element.id, ...(taskNodeId ? { nodeId: taskNodeId } : {}) };
      const modify = async (reference, task) => {
        valid(context); const current = app.page.elements.find(e => e.id === element.id); if (!current) throw new Error('来源已删除');
        app.remember();
        if (treeNode) {
          const value = findNode(current.tree, treeNode.id); if (!value) throw new Error('来源节点已删除');
          if (reference) { if (value.taskRef && !sameRef(value.taskRef, reference)) throw new Error('来源已关联任务'); value.taskRef = reference; }
          else { delete value.taskRef; value.text = task.title; value.status = task.status; }
        } else if (taskItem) {
          const doc = clone(app.editingId === current.id && app.editor ? app.editor.getJSON() : current.doc);
          const items = taskNodes(doc), value = items.find(n => n.attrs?.planningNodeId === taskNodeId) || items[index];
          if (!value || reference && value.attrs?.taskRef && !sameRef(value.attrs.taskRef, reference)) throw new Error('待办已改变或已关联其他任务');
          value.attrs ||= {}; value.attrs.planningNodeId = taskNodeId;
          if (reference) value.attrs.taskRef = reference;
          else { delete value.attrs.taskRef; value.attrs.checked = task.status === 'done'; value.content = replaceDocTitle(value, task.title).content; }
          current.doc = doc; if (app.editingId === current.id && app.editor) app.editor.commands.setContent(doc, { emitUpdate: false });
        } else {
          if (reference) { if (current.taskRef && !sameRef(current.taskRef, reference)) throw new Error('来源已关联任务'); current.taskRef = reference; }
          else { delete current.taskRef; current.doc = replaceDocTitle(current.doc, task.title); current.status = task.status; }
        }
        await save(); app.renderPage();
      };
      return [{ title: (title || '新任务').split('\n')[0].slice(0, 200), status: taskItem ? value.attrs?.checked ? 'done' : 'todo' : ['todo','doing','done','blocked'].includes(value.status) ? value.status : 'todo', taskRef, ref,
        branches:treeNode?()=>{const rows=[];const visit=(node,parentNodeId)=>{const row=sources({closest:selector=>selector==='[data-element-id]'?{dataset:{elementId:element.id}}:selector==='[data-planning-node]'?{dataset:{planningNode:node.id}}:null}).find(source=>source.ref.entityId===element.id&&source.ref.nodeId===node.id);if(row)rows.push({...row,parentNodeId});for(const child of node.children||[])visit(child,node.id);};visit(treeNode,null);return rows;}:null,
        edit: !treeNode ? () => { valid(context); const current = app.page.elements.find(value => value.id === element.id); const body = app.surface.querySelector(`[data-element-id="${element.id}"] .nt-element-body`); if (taskItem && !app.editor) { const value = taskNodes(current.doc).find(n => n.attrs?.planningNodeId === taskNodeId); if (value?.content.length === 1) { app.remember(); value.content.push({ type: 'paragraph' }); app.changed(); } } app.startEdit(current, body, null, true); } : null,
        bind: reference => modify(reference), unbind: task => modify(null, task) }];
    });
  };
  planning.registerNotebook({
    host, writable: () => Boolean(app.book && app.page && app.store?.active() && !app.readOnly && app.store.leaseValid(app.book.id, app.page.id) && !app.book.deleted && !app.page.deleted), clientId: () => app.store?.clientId, toast: message => app.toast(message),
    async openHost(target){if(!app.store)await app.show();const book=await app.store.getBook(target.notebookId),page=book.pages.find(p=>p.id===target.pageId&&!p.deleted);if(!page)throw new Error('所属笔记已删除或无权访问');if(app.root.hidden)await app.show();await app.openPage(book,page);},
    async prepareHost(target){if(!app.store)await app.show();const book=await app.store.getBook(target.notebookId);if(!book.pages.some(page=>page.id===target.pageId&&!page.deleted))throw new Error('所属笔记已删除或无权访问');if(!await app.store.lease(target.notebookId,false,target.pageId))throw new Error('所属笔记正在其他窗口编辑，请打开宿主检查');return app.store.clientId;},
    captureLocation(){const scroll=app.$('.nt-scroll');return {host:host(),zoom:app.zoom,left:scroll.scrollLeft,top:scroll.scrollTop};},
    async restoreLocation(location){await this.openHost(location.host);app.setZoom(location.zoom);const scroll=app.$('.nt-scroll');scroll.scrollTo({left:location.left,top:location.top});},
    highlightTask(planId,taskId){for(const element of app.surface.querySelectorAll('[data-planning-node]')){const owner=app.page.elements.find(e=>e.id===element.closest('[data-element-id]')?.dataset.elementId),node=findNode(owner?.tree,element.dataset.planningNode);element.classList.toggle('planning-related',Boolean(planId&&node?.taskRef?.planId===planId&&node.taskRef.taskId===taskId));}},
    sourceExists(source,ref) { if (source.notebookId !== app.book?.id || source.pageId !== app.page?.id || !app.store.guest) return null; const element=app.page.elements.find(value=>value.id===source.entityId),value=source.nodeId?element?.tree?findNode(element.tree,source.nodeId):taskNodes(element?.doc).find(value=>value.attrs?.planningNodeId===source.nodeId):element;if(!value)return false;return ref&&!sameRef(value.taskRef||value.attrs?.taskRef,ref)?'pending':true; },
    brainReferences(){const refs=[];for(const item of app.page?.elements||[])if(item.type==='mindmap'){const visit=node=>{if(node.taskRef)refs.push({taskRef:node.taskRef,source:{...host(),entityId:item.id,nodeId:node.id}});for(const child of node.children||[])visit(child);};visit(item.tree);}return refs;},
    planIds() { const result = new Set(); const visit = value => { if (value.taskRef) result.add(value.taskRef.planId); if (value.attrs?.taskRef) result.add(value.attrs.taskRef.planId); if (value.planRef) result.add(value.planRef); (value.children || value.content || []).forEach(visit); }; for (const element of app.page?.elements || []) { visit(element); if (element.tree) visit(element.tree); if (element.doc) visit(element.doc); } return result; },
    async prepare() { if (!app.writable()) throw new Error('笔记编辑锁已失效'); await app.store.flush(); if (!app.store.guest && app.store.dirty.has(app.book.id)) throw new Error('请先同步宿主笔记，再提交规划；当前输入仍保留'); },
    async insert(planRef, planView = 'list', point = null) {
      if (!app.writable()) throw new Error('当前笔记只读');
      const location = point || app.visiblePoint(), element = createElement('planning', location); Object.assign(element, { planRef, planView, w: planView === 'list' ? 440 : 740, h: 420 });
      app.place([element], location, { reveal: false }); await app.store.flush();
      if (!app.store.guest && app.store.dirty.has(app.book.id)) throw new Error('规划组件已保留为本地草稿，等待同步');
    },
    async ensureComponent(planId, sourceRef) {
      if (app.page.elements.some(e => e.type === 'planning' && e.planRef === planId)) return;
      const source = app.page.elements.find(e => e.id === sourceRef?.entityId), element = createElement('planning');
      Object.assign(element, { planRef: planId, planView: 'list', x: source ? source.x + source.w + 100 : 40, y: source?.y || 40, w: 460, h: 480 });
      app.remember(); app.page.elements.push(element); await save(); app.renderPage();
    },
    canExtendBreakdown(source,ref){const element=app.page?.elements.find(e=>e.id===source.entityId),node=findNode(element?.tree,source.nodeId);return element?.type==='mindmap'&&Boolean(node)&&(!node.taskRef||sameRef(node.taskRef,ref));},
    async insertBreakdown(planId, entityId, tree) {
      const existing=app.page.elements.find(e=>e.id===entityId);if(existing){
        const root=findNode(existing.tree,tree.id);if(existing.type!=='mindmap'||!root)throw new Error('原脑图节点已删除或类型已改变');
        if(root.taskRef&&!sameRef(root.taskRef,tree.taskRef))throw new Error('脑图节点已关联其他任务，请检查来源后重试');
        app.remember();root.taskRef=clone(tree.taskRef);root.children||=[];for(const child of tree.children)if(!findNode(existing.tree,child.id))root.children.push(child);
      }
      const widget = app.page.elements.find(e => e.type === 'planning' && e.planRef === planId);
      if (!app.page.elements.some(e => e.id === entityId)) {
        const element = createElement('mindmap'); Object.assign(element, { id: entityId, tree, x: widget ? Math.max(20, widget.x - 720) : 40, y: widget?.y || 40, w: 600, h: 380 });
        for (const other of app.page.elements.filter(e => e.type === 'mindmap').sort((a, b) => a.y - b.y)) if (element.x < other.x + other.w && element.x + element.w > other.x && element.y < other.y + other.h && element.y + element.h > other.y) element.y = other.y + other.h + 60;
        app.remember(); app.page.elements.push(element);
        if (widget && widget.x < element.x + element.w + 100) widget.x = element.x + element.w + 100;
        await save(); app.renderPage();
      }
      if(existing){await save();app.renderPage();}
      await this.ensureComponent(planId, { entityId });
    },
    async ensureTaskConnections(planId, entityId) {
      const brain = app.page.elements.find(e => e.id === entityId && e.type === 'mindmap'), widget = app.page.elements.find(e => e.type === 'planning' && e.planRef === planId), C = window.ConnectorCore;
      if (!brain || !widget || !C || !app.writable()) return;
      const created = [];
      const visit = node => {
        const task = node.taskRef && planning.getTask(node.taskRef);
        if (node.taskRef?.planId === planId && task && !task.deleted && !task.archived && !app.page.elements.some(e => e.type === 'connector' && e.source.binding?.id === brain.id && e.source.binding.content?.nodeId === node.id && e.target.binding?.id === widget.id && e.target.binding.content?.taskId === node.taskRef.taskId)) {
          const item = C.apply({ id: uid('connector'), type: 'connector', connectorVersion: 1, source: C.terminal({ binding: { kind: 'item', id: brain.id, content: { kind: 'mind-node', nodeId: node.id } }, fallback: { x: brain.x + brain.w, y: brain.y + brain.h / 2 } }), target: C.terminal({ binding: { kind: 'item', id: widget.id, content: { kind: 'plan-task', planId, taskId: node.taskRef.taskId } }, fallback: { x: widget.x, y: widget.y + widget.h / 2 } }), route: { type: 'smart', constraints: [] }, style: { color: '#8b73c7', width: 2, start: 'none', end: 'open' }, labels: [], origin: { kind: 'native' } }); item.w = Math.max(8, item.w); item.h = Math.max(8, item.h); created.push(item);
        }
        (node.children || []).forEach(visit);
      };
      visit(brain.tree); if (created.length) { app.remember(); app.page.elements.push(...created); await save(); app.renderPage(); }
    },
    refreshConnections() { app.refreshConnectors?.(); },
    async locate(source) {
      await app.show(); const context = app.context(), book = await app.store.getBook(source.notebookId); if (!app.current(context, false)) throw new Error('笔记上下文已切换');
      const page = book.pages.find(p => p.id === source.pageId && !p.deleted); if (!page || !page.elements.some(e => e.id === source.entityId)) throw new Error('来源内容已删除或无权访问');
      await app.openPage(book, page); const element = app.page.elements.find(e => e.id === source.entityId); app.select(element.id); app.renderElements();
      app.$('.nt-scroll').scrollTo({ top: Math.max(0, element.y * app.zoom - 80), left: Math.max(0, element.x * app.zoom - 24) });
    },
    async relink(task, reference) {
      const source = task.sources.find(s => s.kind === 'notebook' && s.notebookId === app.book?.id && s.pageId === app.page?.id); if (!source) throw new Error('请先打开原来源笔记再重试关联');
      const element = app.page.elements.find(e => e.id === source.entityId); if (!element || !app.writable()) throw new Error('来源已删除或当前笔记只读'); app.remember();
      if (source.nodeId && element.type === 'mindmap') { const value = findNode(element.tree, source.nodeId); if (!value || value.taskRef && !sameRef(value.taskRef,reference)) throw new Error('来源节点已删除或已关联其他任务'); value.taskRef = reference; }
      else if (source.nodeId) { const value = taskNodes(element.doc).find(n => n.attrs?.planningNodeId === source.nodeId); if (!value || value.attrs?.taskRef && !sameRef(value.attrs.taskRef,reference)) throw new Error('来源待办已删除或已关联其他任务'); value.attrs.taskRef = reference; }
      else { if (element.taskRef && !sameRef(element.taskRef,reference)) throw new Error('来源已关联其他任务'); element.taskRef = reference; }
      await save(); app.renderPage();
    },
    repaint() {
      if (app.root.hidden || !app.page) return;
      for (const root of app.surface.querySelectorAll('[data-element-id]')) {
        const element = app.page.elements.find(e => e.id === root.dataset.elementId); if (!element) continue;
        if (element.taskRef) planning.updateLinked(root, element.taskRef);
        for (const linked of root.querySelectorAll('.planning-linked[data-task-id]')) planning.updateLinked(linked, { planId: linked.dataset.planId, taskId: linked.dataset.taskId });
        if (element.type === 'mindmap') for (const input of root.querySelectorAll('[data-planning-node] input')) {
          const box = input.closest('[data-planning-node]'), value = findNode(element.tree, box.dataset.planningNode); if (!value?.taskRef) continue;
          const task = planning.getTask(value.taskRef); if (document.activeElement !== input) { input.value = task?.title || '无权访问'; app.fitMindmapInput(input); app.fitMindmapFrame(element, root.querySelector('.nt-element-body')); }
          box.dataset.status = task?.status || ''; const status = box.querySelector('.nt-task-status'); if (status) { status.textContent = task?.deleted ? '已删除' : planning.statusLabel(task?.status) || '无权访问'; status.dataset.status = task?.status || ''; status.disabled = !app.writable() || !task || task.deleted; status.setAttribute('aria-label', `切换任务状态：${task?.title || value.text}`); }
        }
        if (element.id !== app.editingId) hydrateNotebookTasks(root);
      }
    }
  });
  app.insertPlanning = point => planning.insertPlanning(point);
  app.planningContextActions = (target, point) => planning.enabled ? [{ label: '插入规划', icon: 'list-checks', group: 'planning', run: () => app.insertPlanning(point), disabled: !app.writable(), reason: '当前页面只读' }] : [];
  app.planningContentActions = (target, point) => planning.contextActions(sources(target), point).map(action => ({ ...action, run: action.action, reason: '当前页面只读' }));
}
export function hydrateNotebookTasks(root) {
  if (!window.MusePlanning?.enabled) return;
  for (const item of root.querySelectorAll('li[data-task-plan][data-task-id]')) {
    const reference = { planId: item.dataset.taskPlan, taskId: item.dataset.taskId }, content = item.querySelector(':scope > div');
    if (!content || content.querySelector('.planning-linked')) continue;
    const sourceBody = document.createElement('div'); sourceBody.className = 'planning-task-source-body';
    while (content.firstChild) sourceBody.append(content.firstChild);
    content.append(window.MusePlanning.renderLinked(reference), sourceBody);
    const checkbox = item.querySelector(':scope > label input'); if (checkbox) checkbox.hidden = true;
  }
}
