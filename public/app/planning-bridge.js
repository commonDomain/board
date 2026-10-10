import { state } from './state.js';
import { upsertItem } from './items.js';
import { getBoardPointFromClient } from './camera.js';
import { canMutateItem, getWritableLayer } from './layers-model.js';
import { showToast } from './interface-model.js';
import { updateCanvasStartState } from './toolbar.js';
import { beginPendingMove } from './drawing.js';
import { createMindMapItem } from './mindmap-model.js';
import { renderItem } from './rendering.js';

const account = () => window.MuseAccount?.session?.user?.id || 'guest';
const findNode = (tree, id) => tree?.id === id ? tree : (tree?.children || []).map(child => findNode(child, id)).find(Boolean);
const sameRef = (a, b) => a?.planId === b?.planId && a?.taskId === b?.taskId;
function replaceTitle(item, title) {
  const original = String(item.text || ''), boundary = original.indexOf('\n');
  item.text = title + (boundary >= 0 ? original.slice(boundary) : '');
  if (!Array.isArray(item.richText)) return;
  let offset = boundary >= 0 ? boundary : original.length;
  const tail = [];
  for (const run of item.richText) { const value = String(run.text || ''); if (offset >= value.length) offset -= value.length; else { tail.push({ ...run, text: value.slice(offset) }); offset = 0; } }
  item.richText = [{ ...(item.richText[0] || {}), text: title }, ...tail];
}
async function saveSource() {
  if (account() === 'guest') {
    if (!await (await import('./snapshot-cache.js')).cacheBoardSnapshot({ requireLatest: true })) throw new Error('来源关联尚未保存，请重试');
    return;
  }
  await (await import('./canvas-session.js')).persistPendingOps();
  const boardId = state.boardId, owner = account(), until = Date.now() + 10000;
  while (state.syncQueue.serialize().entries.length && Date.now() < until) {
    if (boardId !== state.boardId || owner !== account()) throw new Error('来源上下文已切换');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (boardId !== state.boardId || owner !== account() || state.syncQueue.serialize().entries.length) throw new Error('来源关联已保留为草稿，等待同步，请重试关联');
}
export async function initializePlanning() {
  const planning = window.MusePlanning; if (!planning) return;
  await planning.initialize({
    host: () => state.boardId ? { kind: 'canvas', boardId: state.boardId } : null,
    writable: () => Boolean(state.boardId && getWritableLayer() && !state.compatibilityReadOnly),
    clientId: () => state.socketClientId || state.clientId,
    canWriteHost(host){return host.boardId===state.boardId&&Boolean(getWritableLayer())&&!state.compatibilityReadOnly;},
    async openHost(host){window.MuseNotebook?.hide();if(host.boardId!==state.boardId)await (await import('./canvas-session.js')).switchCanvas(host.boardId);},
    async prepareHost(host){if(host.boardId!==state.boardId)throw new Error('请先打开规划所属画布，再编辑任务；当前输入已保留');if(!getWritableLayer()||state.compatibilityReadOnly)throw new Error('规划所属画布只读');await saveSource();return state.socketClientId||state.clientId;},
    captureLocation(){return {host:{kind:'canvas',boardId:state.boardId},camera:structuredClone(state.camera),zoom:state.zoom};},
    async restoreLocation(location){await this.openHost(location.host);Object.assign(state.camera,location.camera);state.zoom=location.zoom;(await import('./camera.js')).applyCamera();},
    highlightTask(planId,taskId){for(const element of document.querySelectorAll('.mind-node[data-mn-id]')){const item=state.items.get(element.closest('[data-item-id]')?.dataset.itemId),node=findNode(item?.tree,element.dataset.mnId);element.classList.toggle('planning-related',Boolean(planId&&node?.taskRef?.planId===planId&&node.taskRef.taskId===taskId));}},
    planIds() { const result = new Set(); const visit = value => { if (value.taskRef) result.add(value.taskRef.planId); if (value.planRef) result.add(value.planRef); (value.children || []).forEach(visit); }; for (const item of state.items.values()) { visit(item); if (item.tree) visit(item.tree); } return result; },
    toast: showToast,
    moveComponent(event, itemId) {
      const item = state.items.get(itemId), element = event.target.closest('.board-item');
      if (event.button !== 0 || state.spacePan || !item || !canMutateItem(item) || !element) return false;
      event.stopPropagation(); beginPendingMove(event, element, { capture: false }); return true;
    },
    sourceExists(source,ref) { if (source.boardId !== state.boardId || state.switchingCanvas || !state.joined && account() !== 'guest') return null; const item=state.items.get(source.entityId),value=source.nodeId?findNode(item?.tree,source.nodeId):item;if(!value)return false;return ref&&!sameRef(value.taskRef,ref)?'pending':true; },
    brainReferences(){const refs=[];for(const item of state.items.values())if(item.type==='mindmap'){const visit=node=>{if(node.taskRef)refs.push({taskRef:node.taskRef,source:{kind:'canvas',boardId:state.boardId,entityId:item.id,nodeId:node.id}});for(const child of node.children||[])visit(child);};visit(item.tree);}return refs;},
    insert(planRef, planView = 'list', point = null) {
      const position = point || getBoardPointFromClient(innerWidth * .55, innerHeight * .5);
      if (!upsertItem({ id: `planning_${crypto.randomUUID().replaceAll('-', '')}`, type: 'planning', planRef, planView, ...position, w: planView === 'list' ? 440 : 740, h: 420, rotation: 0, z: ++state.zCounter }, { select: true })) throw new Error('当前画布不可插入规划');
      updateCanvasStartState();
    },
    async ensureComponent(planId, sourceRef) {
      if ([...state.items.values()].some(item => item.type === 'planning' && item.planRef === planId)) return;
      const source = state.items.get(sourceRef?.entityId), position = source ? { x: source.x + source.w + 100, y: source.y } : getBoardPointFromClient(innerWidth * .5, innerHeight * .3);
      if (!upsertItem({ id: `planning_${crypto.randomUUID().replaceAll('-', '')}`, type: 'planning', planRef: planId, planView: 'list', ...position, w: 460, h: 480, rotation: 0, z: ++state.zCounter }, { select: false })) throw new Error('当前画布不可插入规划');
      await saveSource();
    },
    canExtendBreakdown(source,ref){const item=state.items.get(source.entityId),node=findNode(item?.tree,source.nodeId);return item?.type==='mindmap'&&Boolean(node)&&(!node.taskRef||sameRef(node.taskRef,ref));},
    async insertBreakdown(planId, entityId, tree) {
      if(state.items.has(entityId)){
        const item=state.items.get(entityId);if(item.type!=='mindmap')throw new Error('拆解来源类型已改变');const copy=structuredClone(item),root=findNode(copy.tree,tree.id);if(!root)throw new Error('原脑图节点已删除');
        if(root.taskRef&&!sameRef(root.taskRef,tree.taskRef))throw new Error('脑图节点已关联其他任务，请检查来源后重试');
        root.taskRef=structuredClone(tree.taskRef);root.children||=[];for(const child of tree.children)if(!findNode(copy.tree,child.id))root.children.push(child);
        const measured=createMindMapItem({x:copy.x,y:copy.y},copy.tree,{branchStyle:copy.branchStyle});if(measured){copy.w=Math.max(copy.w,measured.w);copy.h=Math.max(copy.h,measured.h);}if(!upsertItem(copy,{select:false}))throw new Error('原脑图不能修改');
      }
      if (!state.items.has(entityId)) {
        const widget = [...state.items.values()].find(item => item.type === 'planning' && item.planRef === planId), point = widget ? { x: widget.x, y: widget.y } : getBoardPointFromClient(innerWidth * .25, innerHeight * .25);
        const item = createMindMapItem(point, tree, { branchStyle: 'smart' }); if (!item) throw new Error('脑图未能保存，可重试创建');
        if (widget) item.x = widget.x - item.w - 96;
        for (const other of [...state.items.values()].filter(value => value.type === 'mindmap').sort((a, b) => a.y - b.y)) if (item.x < other.x + other.w && item.x + item.w > other.x && item.y < other.y + other.h && item.y + item.h > other.y) item.y = other.y + other.h + 60;
        if (!upsertItem({ ...item, id: entityId }, { select: false })) throw new Error('脑图未能保存，可重试创建');
      }
      await saveSource(); await this.ensureComponent(planId, { entityId });
    },
    async ensureTaskConnections(planId, entityId) {
      const widget = [...state.items.values()].find(item => item.type === 'planning' && item.planRef === planId), brain = state.items.get(entityId), C = window.ConnectorCore;
      if (!widget || !brain || brain.type !== 'mindmap' || !C) return;
      const visit = node => {
        const task = node.taskRef && planning.getTask(node.taskRef);
        if (node.taskRef?.planId === planId && task && !task.deleted && !task.archived && ![...state.items.values()].some(item => item.type === 'connector' && item.source?.binding?.id === brain.id && item.source.binding.content?.nodeId === node.id && item.target?.binding?.id === widget.id && item.target.binding.content?.taskId === node.taskRef.taskId)) {
          const item = C.apply({ id: `connector_${crypto.randomUUID().replaceAll('-', '')}`, type: 'connector', connectorVersion: 1, source: C.terminal({ binding: { kind: 'item', id: brain.id, content: { kind: 'mind-node', nodeId: node.id } }, fallback: { x: brain.x + brain.w, y: brain.y + brain.h / 2 } }), target: C.terminal({ binding: { kind: 'item', id: widget.id, content: { kind: 'plan-task', planId, taskId: node.taskRef.taskId } }, fallback: { x: widget.x, y: widget.y + widget.h / 2 } }), route: { type: 'smart', constraints: [] }, style: { color: '#8b73c7', width: 2, start: 'none', end: 'open' }, labels: [], z: ++state.zCounter });
          if (!upsertItem(item, { select: false })) throw new Error('连线未能保存，请重试关联');
        }
        (node.children || []).forEach(visit);
      };
      visit(brain.tree); await saveSource();
    },
    refreshConnections() { window.ConnectorUI?.invalidate([...state.items.values()].filter(item => item.type === 'planning' || item.type === 'mindmap').map(item => item.id)); },
    async locate(source) {
      const owner = account();
      if (source.boardId !== state.boardId) await (await import('./canvas-session.js')).switchCanvas(source.boardId);
      if (owner !== account()) throw new Error('账号已切换');
      const item = state.items.get(source.entityId); if (!item) throw new Error('来源内容已删除');
      window.MuseNotebook?.hide();
      (await import('./focus.js')).focusBoundsInViewport(item, { screenPadding: 70, zoomCap: 1.5 });
      (await import('./selection.js')).selectItem(item.id);
    },
    async relink(task, ref) {
      const source = task.sources.find(s => s.kind === 'canvas' && s.boardId === state.boardId);
      if (!source) throw new Error('请先打开原来源画布再重试关联');
      const original = state.items.get(source.entityId); if (!original || !canMutateItem(original)) throw new Error('来源已删除或不可编辑');
      const item = structuredClone(original), target = source.nodeId ? findNode(item.tree, source.nodeId) : item;
      if (!target || target.taskRef && !sameRef(target.taskRef, ref)) throw new Error('来源已关联其他任务或已删除');
      target.taskRef = ref; if (!upsertItem(item, { select: false })) throw new Error('来源关联保存失败');
      await saveSource();
    },
    sources(target) {
      const selected = [...state.selectedIds].map(key => state.items.get(key)).filter(Boolean), boardId = state.boardId, owner = account();
      const nodeId = target?.closest('.mind-node')?.dataset.mnId;
      const valid = item => { if (owner !== account() || boardId !== state.boardId || !canMutateItem(item)) throw new Error('来源已切换或不可编辑'); };
      return selected.flatMap(item => {
        if (!['text', 'note', 'mindmap'].includes(item.type)) return [];
        const selectedNode = state.mindmapSelection?.itemId === item.id ? state.mindmapSelection.path.reduce((value, index) => value?.children?.[index], item.tree) : null;
        const treeNode = item.type === 'mindmap' ? findNode(item.tree, nodeId || selectedNode?.id || item.tree?.id) : null;
        if (item.type === 'mindmap' && !treeNode) return [];
        const value = treeNode || item, ref = { kind: 'canvas', boardId, entityId: item.id, ...(treeNode ? { nodeId: treeNode.id } : {}) };
        return [{ title: String(value.text || '新任务').split('\n')[0].slice(0, 200), status: ['todo', 'doing', 'blocked', 'done'].includes(value.status) ? value.status : 'todo', taskRef: value.taskRef, ref,
          branches:treeNode?()=>{const rows=[];const visit=(node,parentNodeId)=>{const row=this.sources({closest:selector=>selector==='.mind-node'?{dataset:{mnId:node.id}}:null}).find(source=>source.ref.entityId===item.id&&source.ref.nodeId===node.id);if(row)rows.push({...row,parentNodeId});for(const child of node.children||[])visit(child,node.id);};visit(treeNode,null);return rows;}:null,
          edit: !treeNode ? async () => { const original = state.items.get(item.id); valid(original); const task = planning.getTask(original.taskRef); if (!task) throw new Error('无权访问任务'); replaceTitle(original, task.title); (await import('./editing.js')).startEditingItem(item.id, { editLinkedSource: true }); } : null,
          async bind(taskRef) { const original = state.items.get(item.id); valid(original); const copy = structuredClone(original), target = treeNode ? findNode(copy.tree, treeNode.id) : copy; if (!target) throw new Error('来源已删除'); if (target.taskRef && !sameRef(target.taskRef, taskRef)) throw new Error('来源已关联任务'); target.taskRef = taskRef; if (!upsertItem(copy, { select: false })) throw new Error('未能保存来源关联'); await saveSource(); },
          async unbind(task) { const original = state.items.get(item.id); valid(original); const copy = structuredClone(original), target = treeNode ? findNode(copy.tree, treeNode.id) : copy; if (!target) throw new Error('来源已删除'); delete target.taskRef; if (treeNode) target.text = task.title; else replaceTitle(target, task.title); target.status = task.status; if (!upsertItem(copy, { select: false })) throw new Error('未能解除来源关联'); await saveSource(); }
        }];
      });
    },
    repaint() {
      if (!state.boardId || window.__independentNotesActive) return;
      for (const root of document.querySelectorAll('.board-item[data-item-id]')) {
        const item = state.items.get(root.dataset.itemId); if (!item || state.editingId === item.id) continue;
        if (item.taskRef) planning.updateLinked(root, item.taskRef);
        if (item.type === 'mindmap' && !root.querySelector('[contenteditable=true]') && [...root.querySelectorAll('[data-mn-id]')].some(element => { const node = findNode(item.tree, element.dataset.mnId); return node?.taskRef && element.querySelector('.mind-node-text')?.textContent !== planning.taskTitle(node.taskRef); })) { renderItem(item); continue; }
        if (item.type === 'mindmap') for (const element of root.querySelectorAll('.mind-node[data-mn-id]')) {
          const value = findNode(item.tree, element.dataset.mnId); if (!value?.taskRef || element.querySelector('[contenteditable=true]')) continue;
          const task = planning.getTask(value.taskRef); const title = element.querySelector('.mind-node-text'); if (title) title.textContent = task?.title || '无权访问';
          element.dataset.status = task?.status || ''; const badge = element.querySelector('.planning-mind-status'); if (badge) { badge.textContent = task?.deleted ? '任务已删除' : task ? planning.statusLabel(task.status) : '无权访问'; badge.disabled = !task || task.deleted || !canMutateItem(item); }
        }
      }
    }
  });
  planning.canvasActions = (target, point) => planning.contextActions(planning.canvasSources(target), point);
}
