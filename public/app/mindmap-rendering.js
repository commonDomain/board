import { getBoardPoint } from './camera.js';
import { isTemporaryPanGestureEvent } from './editing.js';
import { canMutateItem } from './layers-model.js';
import { setActiveCursorState } from './marquee.js';
import {
  addMindChild,
  addMindSibling,
  cycleMindStatus,
  deleteMindNode,
  selectMindNode,
  startMindNodeEdit,
  startMindNodeNoteEdit,
  toggleMindCollapse
} from './mindmap-editing.js';
import { getMindNodeAtPath, sameMindPath } from './mindmap-editing-model.js';
import { fitMindMapItem, layoutMindTree, makeSampleTree, measureMindNodeWidth } from './mindmap-model.js';
import { canvasInteraction, captureViewportPointer } from './pan.js';
import { state } from './state.js';
import { captureInteractionItems, interactionFieldsForMode } from './transform-model.js';
import { clamp, createSvg, isEditableTarget, isImeEvent } from './utilities.js';
import { syncLinkedXmindItem } from './xmind-sync.js';
import { applyMindNodeVisualStyle, makeMindActionButton } from './mindmap-rendering-model.js';

function renderMindMap(item) {
  if (!item._precomputedLayout) { const sized = fitMindMapItem({ ...item }); item.w = Math.max(item.w || 0, sized.w); item.h = Math.max(item.h || 0, sized.h); }
  const card = document.createElement('div');
  card.className = 'mindmap-card';
  card.dataset.itemId = item.id;
  card.setAttribute('role', 'tree');
  card.setAttribute('aria-label', `${item.tree?.text || '脑图'}，使用上下方向键浏览节点，Enter 编辑`);
  if (item.source?.provider === 'xmind') {
    const ownsConnection =
      String(item.source.connectedUserId || '') === String(window.MuseAccount?.session?.user?.id || '');
    const wrongProvider =
      item.source.accountProvider &&
      state.xmindConnection?.provider &&
      item.source.accountProvider !== state.xmindConnection.provider;
    card.dataset.syncState =
      ownsConnection && (state.xmindConnection?.reauthorize || wrongProvider)
        ? 'reauthorize'
        : item.source.syncState || 'synced';
  }
  const tree = item.tree && typeof item.tree === 'object' ? item.tree : makeSampleTree();
  const branchStyle = window.MindMapLayout.normalizeStyle(item.branchStyle);
  const layoutWidth = Math.max(item.w || 360);
  const layoutHeight = Math.max(item.h || 220);
  
  let layout = item._precomputedLayout;
  if (layout?.nodes?.length) {
    const nodesByLayoutId = new Map(layout.nodes.map((node) => [node.id, node]));
    layout = {
      nodes: layout.nodes,
      links: layout.links
        .map((link) => ({
          from: nodesByLayoutId.get(link.fromId),
          to: nodesByLayoutId.get(link.toId),
          siblingCount: link.siblingCount
        }))
        .filter((link) => link.from && link.to)
    };
    delete item._precomputedLayout;
  } else {
    layout = layoutMindTree(tree, layoutWidth, layoutHeight, branchStyle, item.layoutMode);
  }

  const svg = createSvg('svg');
  layout.links.forEach((link) => {
    const path = createSvg('path');
    const isLeft = link.to.side === 'left';
    const startX = isLeft ? link.from.x : link.from.x + link.from.w;
    const startY = link.from.y + link.from.h / 2;
    const endX = isLeft ? link.to.x + link.to.w : link.to.x;
    const endY = link.to.y + link.to.h / 2;
    const route = window.MindMapLayout.createLinkPath(
      {
        startX,
        startY,
        endX,
        endY,
        siblingCount: link.siblingCount
      },
      branchStyle
    );
    path.setAttribute('d', route.d);
    path.dataset.route = route.kind;
    path.setAttribute('fill', 'none');
    const lineStyle = link.to.visualStyle || {};
    path.setAttribute('stroke', lineStyle.lineColor || lineStyle.branchColor || '#334155');
    path.setAttribute(
      'stroke-width',
      String(clamp(Number(lineStyle.lineWidth || lineStyle.branchWidth) || 1.6, 0.5, 8))
    );
    if (/dash/i.test(String(lineStyle.linePattern || ''))) path.setAttribute('stroke-dasharray', '5 4');
    svg.appendChild(path);
  });
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  (Array.isArray(item.relations) ? item.relations : []).forEach((relation) => {
    const from = nodesById.get(relation.startId);
    const to = nodesById.get(relation.endId);
    if (!from || !to) return;
    const path = createSvg('path');
    const line = window.MindMapLayout.createLinkPath(
      {
        startX: from.x + from.w / 2,
        startY: from.y + from.h / 2,
        endX: to.x + to.w / 2,
        endY: to.y + to.h / 2,
        siblingCount: 1
      },
      'curve'
    );
    path.setAttribute('d', line.d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', relation.lineStyle?.lineColor || relation.lineStyle?.color || '#8b5cf6');
    path.setAttribute('stroke-width', String(clamp(Number(relation.lineStyle?.lineWidth) || 1.4, 0.5, 8)));
    path.setAttribute('stroke-dasharray', '5 4');
    path.dataset.relation = relation.id || '';
    svg.appendChild(path);
  });
  card.appendChild(svg);

  if (item.source?.provider === 'xmind') {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'mindmap-source-badge';
    badge.innerHTML = '<i data-lucide="loader-circle" aria-hidden="true"></i><span>同步XMind</span>';
    badge.hidden = !['pending', 'remote-changed'].includes(item.source.syncState);
    const ownsConnection =
      String(item.source.connectedUserId || '') === String(window.MuseAccount?.session?.user?.id || '');
    const syncing = state.xmindAutoSyncInFlight.has(item.id);
    badge.dataset.loading = String(syncing);
    badge.setAttribute('aria-busy', String(syncing));
    badge.disabled = !ownsConnection || syncing;
    badge.title = ownsConnection
      ? item.source.syncState === 'pending'
        ? '同步到 XMind'
        : '载入 XMind 最新版本'
      : '此脑图由其他共享成员连接，仅可查看';
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!ownsConnection) return;
      void syncLinkedXmindItem(item);
    });
    badge.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    card.appendChild(badge);
  }

  const mountMindNodes = (startIndex = 0) => {
    const fragment = document.createDocumentFragment();
    const batchSize = layout.nodes.length > 1000 ? 120 : layout.nodes.length;
    const endIndex = Math.min(layout.nodes.length, startIndex + batchSize);
    for (let nodeIndex = startIndex; nodeIndex < endIndex; nodeIndex += 1) {
      let node = layout.nodes[nodeIndex];
      let originalNode = item.tree;
      for (const index of node.path) originalNode = originalNode?.children?.[index];
      if (originalNode?.taskRef && window.MusePlanning?.enabled) {
        const task = window.MusePlanning.getTask(originalNode.taskRef);
        node = { ...node, taskRef: originalNode.taskRef, text: task?.title || '无权访问', status: task?.status || '', taskDeleted: Boolean(task?.deleted) };
      }
      const element = document.createElement('div');
      element.className = `mind-node${node.depth === 0 ? ' root' : ''}`;
      element.dataset.mnPath = node.path.join('.');
      element.dataset.mnId = node.id;
      const selectedNode = Boolean(
        state.mindmapSelection &&
        state.mindmapSelection.itemId === item.id &&
        sameMindPath(state.mindmapSelection.path, node.path)
      );
      element.setAttribute('role', 'treeitem');
      element.setAttribute('aria-level', String(node.depth + 1));
      element.setAttribute('aria-label', node.text || '未命名节点');
      element.tabIndex = selectedNode || (node.depth === 0 && !state.mindmapSelection) ? 0 : -1;
      if (node.children > 0) element.setAttribute('aria-expanded', String(!node.collapsed));
      if (node.status) {
        element.dataset.status = node.status;
      }
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      element.style.width = `${node.w}px`;
      element.style.height = `${node.h}px`;
      applyMindNodeVisualStyle(element, node.visualStyle);

      const text = document.createElement('span');
      text.className = 'mind-node-text';
      text.textContent = node.text;
      element.appendChild(text);
      let taskBadge;
      if (node.taskRef) {
        const badge = document.createElement('button'); badge.type = 'button'; badge.className = 'mind-node-tag planning-mind-status';
        badge.textContent = node.taskDeleted ? '任务已删除' : node.status ? window.MusePlanning.statusLabel(node.status) : '无权访问';
        badge.title = '点击切换任务状态'; badge.disabled = node.taskDeleted || !node.status || !canMutateItem(item);
        badge.addEventListener('pointerdown', event => event.stopPropagation());
        badge.addEventListener('click', event => { event.stopPropagation(); if (!badge.disabled) cycleMindStatus(item, node.path); });
        taskBadge = badge;
      }

      if (
        state.mindmapSelection &&
        state.mindmapSelection.itemId === item.id &&
        sameMindPath(state.mindmapSelection.path, node.path)
      ) {
        attachMindNodeResizeHandles(element, item, node.path);
      }

      if (node.taskRef || node.status || node.note || node.labels.length || node.markers.length || node.href) {
        const meta = document.createElement('div');
        meta.className = 'mind-node-meta';
        if (taskBadge) meta.appendChild(taskBadge);
        else if (node.status) {
          const status = document.createElement('span');
          status.className = 'mind-node-tag';
          status.textContent =
            { todo: '待办', doing: '进行中', done: '完成', blocked: '阻塞' }[node.status] || node.status;
          meta.appendChild(status);
        }
        if (node.note) {
          const note = document.createElement('span');
          note.className = 'mind-node-tag';
          note.textContent = '有备注';
          meta.appendChild(note);
        }
        node.labels.slice(0, 3).forEach((label) => {
          const tag = document.createElement('span');
          tag.className = 'mind-node-tag';
          tag.textContent = label;
          meta.appendChild(tag);
        });
        if (node.href) {
          const link = document.createElement('span');
          link.className = 'mind-node-tag';
          link.textContent = '链接';
          link.title = node.href;
          meta.appendChild(link);
        }
        element.appendChild(meta);
      }

      element.addEventListener('pointerdown', (event) => {
        if (state.tool !== 'select' && state.tool !== 'pan' && state.tool !== 'mindmap') {
          return;
        }
        if (event.pointerType === 'touch' && state.tool !== 'select') {
          return;
        }
        event.stopPropagation();
        selectMindNode(item.id, node.path, { deferPanel: true });
      });
      element.addEventListener('dblclick', (event) => {
        if (state.tool !== 'select' && state.tool !== 'pan' && state.tool !== 'mindmap') {
          return;
        }
        event.stopPropagation();
        if (text.isContentEditable) return;
        startMindNodeEdit(item, node.path, { focusAnchor: { x: event.clientX, y: event.clientY } });
      });
      element.addEventListener('keydown', (event) => handleMindNodeKeyDown(event, item, node));

      if (selectedNode) {
        element.classList.add('selected');
      }

      const actions = document.createElement('div');
      actions.className = 'mind-node-actions';
      actions.appendChild(makeMindActionButton('add-child', '添加子节点', 'plus', () => addMindChild(item, node.path)));
      if (node.depth > 0) {
        actions.appendChild(
          makeMindActionButton('add-sibling', '添加同级', 'git-branch', () => addMindSibling(item, node.path))
        );
      }
      actions.appendChild(
        makeMindActionButton(
          'status',
          `切换任务状态${item.source?.localOnlyFields?.includes('status') ? '（仅保存在画板）' : ''}`,
          'circle-dot',
          () => cycleMindStatus(item, node.path)
        )
      );
      actions.appendChild(
        makeMindActionButton(
          'note',
          `编辑节点备注${item.source?.localOnlyFields?.includes('note') ? '（仅保存在画板）' : ''}`,
          'sticky-note',
          () => startMindNodeNoteEdit(item, node.path, element)
        )
      );
      if (node.children > 0) {
        actions.appendChild(
          makeMindActionButton(
            'collapse',
            node.collapsed ? '展开' : '折叠',
            node.collapsed ? 'chevron-down' : 'chevrons-up',
            () => toggleMindCollapse(item, node.path)
          )
        );
      }
      if (node.depth > 0) {
        actions.appendChild(
          makeMindActionButton('delete', '删除节点', 'trash-2', () => deleteMindNode(item, node.path))
        );
      }
      actions.querySelectorAll('button').forEach((button) => {
        button.tabIndex = selectedNode ? 0 : -1;
      });
      element.appendChild(actions);

      fragment.appendChild(element);
    }
    card.appendChild(fragment);
    if (endIndex < layout.nodes.length) {
      requestAnimationFrame(() => {
        if (card.isConnected) mountMindNodes(endIndex);
      });
    }
  };
  mountMindNodes();
  return card;
}

function handleMindNodeKeyDown(event, item, node) {
  // Text and note editors own their keys; node shortcuts must not delete a
  // branch, collapse it or change focus while its contents are being edited.
  if (event.defaultPrevented || isImeEvent(event) || isEditableTarget(event.target) || event.target.closest('.mind-node-actions')) return;
  const key = event.key;
  if (key === 'Enter' || key === 'F2') {
    event.preventDefault();
    event.stopPropagation();
    startMindNodeEdit(item, node.path);
    return;
  }
  if ((key === 'Delete' || key === 'Backspace') && node.depth > 0) {
    event.preventDefault();
    event.stopPropagation();
    deleteMindNode(item, node.path);
    return;
  }
  if (key === 'ArrowLeft' && node.children > 0 && !node.collapsed) {
    event.preventDefault();
    event.stopPropagation();
    toggleMindCollapse(item, node.path);
    return;
  }
  if (key === 'ArrowRight' && node.children > 0 && node.collapsed) {
    event.preventDefault();
    event.stopPropagation();
    toggleMindCollapse(item, node.path);
    return;
  }
  if (!['ArrowUp', 'ArrowDown'].includes(key)) return;
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest('.mindmap-card');
  const nodes = Array.from(card?.querySelectorAll('.mind-node[role="treeitem"]') || []);
  const index = nodes.indexOf(event.currentTarget);
  const target = nodes[index + (key === 'ArrowDown' ? 1 : -1)];
  if (!target) return;
  const path = String(target.dataset.mnPath || '')
    .split('.')
    .filter(Boolean)
    .map(Number);
  selectMindNode(item.id, path);
  target.focus({ preventScroll: true });
}

function startMindNodeResize(event, item, path, handle) {
  if (isTemporaryPanGestureEvent(event)) return;
  if (!canMutateItem(item)) return;
  const mindNode = getMindNodeAtPath(item.tree, path);
  if (!mindNode) return;
  event.preventDefault();
  event.stopPropagation();
  const point = getBoardPoint(event);
  const layoutNode = layoutMindTree(item.tree, item.w, item.h, item.branchStyle, item.layoutMode).nodes.find((entry) =>
    sameMindPath(entry.path, path)
  );
  state.interaction = {
    id: item.id,
    mode: 'mind-node-resize',
    mindPath: [...path],
    mindHandle: handle,
    mindStartWidth: layoutNode?.w || measureMindNodeWidth(mindNode.text, path.length === 0),
    mindStartHeight: layoutNode?.h || (mindNode.status || mindNode.note ? 50 : 38),
    beforeById: captureInteractionItems([item.id], 'mind-node-resize'),
    ownedFields: interactionFieldsForMode(item, 'mind-node-resize'),
    startPoint: point,
    startItem: { ...item },
    changed: false,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse'
  };
  state.gestureSession = { kind: 'resize', pointerId: event.pointerId, targetIds: [item.id] };
  setActiveCursorState(
    canvasInteraction?.getResizeCursor(handle, (item.rotation || 0) + state.rotation) || 'nwse-resize'
  );
  captureViewportPointer(event.pointerId);
}

function attachMindNodeResizeHandles(element, item, path) {
  if (!element || element.querySelector('.mind-node-resize')) return;
  ['e', 's', 'se'].forEach((handle) => {
    const resizeHandle = document.createElement('span');
    resizeHandle.className = `mind-node-resize mind-node-resize-${handle}`;
    resizeHandle.dataset.mindResize = handle;
    resizeHandle.setAttribute('aria-hidden', 'true');
    resizeHandle.addEventListener('pointerdown', (event) => {
      startMindNodeResize(event, item, path, handle);
    });
    element.appendChild(resizeHandle);
  });
}
export { renderMindMap, handleMindNodeKeyDown, startMindNodeResize, attachMindNodeResizeHandles };
