

import { els } from './elements.js';

import { getGroupMemberItemIds } from './groups-model.js';
import { refreshIcons } from './interface-model.js';

import { createNavigatorDragGhost, moveNavigatorDragGhost, settleNavigatorDragGhost } from './navigator-drag-model.js';

import { getBoundsOfItems } from './selection-model.js';
import { state } from './state.js';

let pushUndoSnapshot,
  resolveVerticalDropIntent,
  focusNavigatorTarget,
  deleteOrganizationEntry,
  renameOrganizationEntry,
  setContainerFlags,
  clearNavigatorDropIndicators,
  previewNavigatorDrop,
  reorderNavigatorEntry,
  buildNavigatorRows,
  createNavigatorTypeIcon,
  renderAll,
  markDirty,
  locateTarget,
  buildContextMenu,
  updateSelectionUI,
  enqueueOperation,
  activateStarterTool;

function configureNavigatorRendering(callbacks) {
  ({
    pushUndoSnapshot,
    resolveVerticalDropIntent,
    focusNavigatorTarget,
    deleteOrganizationEntry,
    renameOrganizationEntry,
    setContainerFlags,
    clearNavigatorDropIndicators,
    previewNavigatorDrop,
    reorderNavigatorEntry,
    buildNavigatorRows,
    createNavigatorTypeIcon,
    renderAll,
    markDirty,
    locateTarget,
    buildContextMenu,
    updateSelectionUI,
    enqueueOperation,
    activateStarterTool
  } = callbacks);
}

let navigatorAnimationCleanupTimer = null;

function renderNavigator(animateReorder = false, landedKey = '') {
  if (!els.navigatorTree || els.navigatorPanel.hidden) return;
  if (state.navigatorPointerDrag && !animateReorder) return null;
  const previousPositions = animateReorder
    ? new Map(
        Array.from(els.navigatorTree.querySelectorAll('.navigator-row'), (element) => [
          `${element.dataset.type}:${element.dataset.id}`,
          element.getBoundingClientRect()
        ])
      )
    : null;
  const rows = buildNavigatorRows();
  if (els.navigatorExpandAll)
    els.navigatorExpandAll.textContent = state.navigatorQuery.trim() ? '清除搜索' : '全部展开';
  els.navigatorSummary.textContent = state.navigatorQuery.trim()
    ? `${rows.filter((row) => (row.searchText || row.label || '').toLocaleLowerCase('zh-CN').includes(state.navigatorQuery.trim().toLocaleLowerCase('zh-CN'))).length} 个匹配结果`
    : `${state.sections.size} 个画框 · ${state.groups.size} 个分组 · ${state.items.size} 个对象`;
  const previousScrollTop = els.navigatorTree.scrollTop;
  els.navigatorTree.textContent = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'navigator-empty';
    const icon = document.createElement('span');
    icon.className = 'navigator-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconSvg = document.createElement('i');
    iconSvg.setAttribute('data-lucide', 'panel-top');
    icon.appendChild(iconSvg);
    const title = document.createElement('strong');
    title.textContent = state.navigatorQuery.trim() ? '没有匹配的内容' : '还没有可导航的内容';
    const description = document.createElement('p');
    description.textContent = state.navigatorQuery.trim()
      ? '试试元素名称、文字内容或“便签”“表格”等类型。'
      : '先创建一个画框来组织主题，之后对象和分组会自动出现在这里。';
    const action = document.createElement('button');
    empty.append(icon, title, description);
    if (!state.navigatorQuery.trim()) {
      action.type = 'button';
      action.textContent = '创建第一个画框';
      action.addEventListener('click', () => activateStarterTool('section', { closeNavigator: true }));
      empty.appendChild(action);
    }
    els.navigatorTree.appendChild(empty);
    refreshIcons(empty);
    return;
  }
  const rowHeight = 38;
  const start = Math.max(0, Math.floor(els.navigatorTree.scrollTop / rowHeight) - 8);
  const visible = rows.slice(start, start + 180);
  const before = document.createElement('div');
  before.style.height = `${start * rowHeight}px`;
  els.navigatorTree.appendChild(before);
  for (const row of visible) els.navigatorTree.appendChild(createNavigatorRow(row));
  const after = document.createElement('div');
  after.style.height = `${Math.max(0, rows.length - start - visible.length) * rowHeight}px`;
  els.navigatorTree.appendChild(after);
  els.navigatorTree.scrollTop = previousScrollTop;
  refreshIcons(els.navigatorTree);
  if (!animateReorder) return null;
  const finalPositions = new Map();
  for (const element of els.navigatorTree.querySelectorAll('.navigator-row')) {
    const key = `${element.dataset.type}:${element.dataset.id}`;
    const finalRect = element.getBoundingClientRect();
    finalPositions.set(key, finalRect);
    if (key === landedKey) element.classList.add('is-drop-landed');
    const previousRect = previousPositions.get(key);
    if (!previousRect) continue;
    const deltaY = previousRect.top - finalRect.top;
    if (Math.abs(deltaY) < 0.5) continue;
    element.style.transition = 'none';
    element.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    element.getBoundingClientRect();
    requestAnimationFrame(() => {
      element.classList.add('is-reordering');
      element.style.removeProperty('transition');
      element.style.removeProperty('transform');
    });
  }
  clearTimeout(navigatorAnimationCleanupTimer);
  navigatorAnimationCleanupTimer = setTimeout(() => {
    navigatorAnimationCleanupTimer = null;
    els.navigatorTree
      ?.querySelectorAll('.is-reordering, .is-drop-landed')
      .forEach((element) => element.classList.remove('is-reordering', 'is-drop-landed'));
  }, 420);
  return finalPositions;
}

function createNavigatorRow(row) {
  const element = document.createElement('div');
  element.className = 'navigator-row';
  element.style.setProperty('--depth', row.depth);
  element.dataset.type = row.type;
  element.dataset.id = row.id;
  const dragHandle = document.createElement('button');
  dragHandle.type = 'button';
  dragHandle.className = 'navigator-drag-handle';
  if (row.canReorder) {
    dragHandle.title = '上下拖拽排序';
    dragHandle.setAttribute('aria-label', '上下拖拽排序');
    const handleIcon = document.createElement('i');
    handleIcon.dataset.lucide = 'menu';
    dragHandle.appendChild(handleIcon);
    dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      clearNavigatorDropIndicators({ immediate: true });
      dragHandle.setPointerCapture(event.pointerId);
      state.navigatorPointerDrag = {
        source: { type: row.type, id: row.id, parentKey: row.parentKey },
        target: null,
        position: null,
        ghost: createNavigatorDragGhost(element, event)
      };
      element.classList.add('is-dragging');
      document.documentElement.classList.add('navigator-is-dragging');
      window.addEventListener('pointerup', finishPointerDrag, { once: true });
      window.addEventListener('pointercancel', finishPointerDrag, { once: true });
    });
    dragHandle.addEventListener('pointermove', (event) => {
      const drag = state.navigatorPointerDrag;
      if (!drag || !dragHandle.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      moveNavigatorDragGhost(drag.ghost, event);
      const treeBounds = els.navigatorTree.getBoundingClientRect();
      if (event.clientY < treeBounds.top + 36) els.navigatorTree.scrollTop -= 14;
      else if (event.clientY > treeBounds.bottom - 36) els.navigatorTree.scrollTop += 14;
      const visibleElements = Array.from(els.navigatorTree.querySelectorAll('.navigator-row'));
      const previousElement =
        drag.target &&
        visibleElements.find((entry) => entry.dataset.type === drag.target.type && entry.dataset.id === drag.target.id);
      const intent = resolveVerticalDropIntent(visibleElements, element, event.clientY, previousElement, drag.position);
      const targetElement = intent?.target || null;
      const targetRow =
        targetElement &&
        buildNavigatorRows().find(
          (entry) => entry.type === targetElement.dataset.type && entry.id === targetElement.dataset.id
        );
      if (
        !targetRow ||
        targetRow.parentKey !== drag.source.parentKey ||
        (targetRow.type === drag.source.type && targetRow.id === drag.source.id)
      ) {
        drag.target = null;
        clearNavigatorDropIndicators();
        return;
      }
      drag.target = targetRow;
      drag.position = intent.position;
      previewNavigatorDrop(drag.source, targetRow, drag.position, targetElement);
    });
    const finishPointerDrag = (event) => {
      const drag = state.navigatorPointerDrag;
      if (!drag) return;
      if (!drag.target) {
        const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest('.navigator-row');
        const targetRow =
          targetElement &&
          buildNavigatorRows().find(
            (entry) => entry.type === targetElement.dataset.type && entry.id === targetElement.dataset.id
          );
        if (
          targetRow &&
          targetRow.parentKey === drag.source.parentKey &&
          (targetRow.type !== drag.source.type || targetRow.id !== drag.source.id)
        ) {
          drag.target = targetRow;
          drag.position =
            event.clientY < targetElement.getBoundingClientRect().top + targetElement.offsetHeight / 2
              ? 'before'
              : 'after';
        }
      }
      state.navigatorPointerDrag = null;
      document.documentElement.classList.remove('navigator-is-dragging');
      element.classList.remove('is-dragging');
      clearNavigatorDropIndicators({ immediate: true });
      const destinationRect = drag.target ? reorderNavigatorEntry(drag.source, drag.target, drag.position) : null;
      settleNavigatorDragGhost(drag.ghost, destinationRect);
      if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
    };
    dragHandle.addEventListener('pointerup', finishPointerDrag);
    dragHandle.addEventListener('pointercancel', finishPointerDrag);
    dragHandle.addEventListener('keydown', (event) => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const siblings = buildNavigatorRows().filter(
        (entry) => entry.parentKey === row.parentKey && entry.type !== 'root'
      );
      const index = siblings.findIndex((entry) => entry.type === row.type && entry.id === row.id);
      const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!target) return;
      event.preventDefault();
      reorderNavigatorEntry(
        { type: row.type, id: row.id, parentKey: row.parentKey },
        target,
        event.key === 'ArrowUp' ? 'before' : 'after'
      );
    });
  } else {
    dragHandle.disabled = true;
    dragHandle.setAttribute('aria-hidden', 'true');
  }
  const disclosure = document.createElement('button');
  disclosure.type = 'button';
  disclosure.className = 'navigator-disclosure';
  disclosure.disabled = !row.hasChildren;
  disclosure.setAttribute('aria-label', row.expanded ? '折叠' : '展开');
  const disclosureIcon = document.createElement('i');
  disclosureIcon.dataset.lucide = row.hasChildren ? (row.expanded ? 'chevron-down' : 'chevron-right') : 'minus';
  disclosure.appendChild(disclosureIcon);
  disclosure.addEventListener('click', () => {
    const key = `${row.type}:${row.id}`;
    if (state.navigatorExpanded.has(key)) state.navigatorExpanded.delete(key);
    else state.navigatorExpanded.add(key);
    renderNavigator();
  });
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'navigator-row-main';
  const icon = createNavigatorTypeIcon(row);
  const label = document.createElement('span');
  label.textContent = row.label;
  main.title=`${row.label}${row.locked?' · 已锁定':''}${row.hidden?' · 已隐藏':''}`;
  main.setAttribute('aria-label',main.title);
  main.append(icon, label);
  main.addEventListener('click', () => locateNavigatorRow(row));
  main.addEventListener('dblclick', () => {
    if (row.type !== 'root') renameOrganizationEntry(row.type, row.id);
  });
  const actions = document.createElement('div');
  actions.className = 'navigator-actions';
  if (row.type !== 'root') {
    actions.append(
      makeNavigatorAction('pencil', '重命名', () => renameOrganizationEntry(row.type, row.id)),
      makeNavigatorAction(row.hidden ? 'eye-off' : 'eye', row.hidden ? '显示' : '隐藏', () =>
        setContainerFlags(row.type, [row.id], { hidden: !row.hidden })
      ),
      makeNavigatorAction(row.locked ? 'lock' : 'unlock', row.locked ? '解锁' : '锁定', () => {
        if (row.type === 'section')
          setContainerFlags('section', [row.id], { lockChildren: !state.sections.get(row.id)?.lockChildren });
        else setContainerFlags(row.type, [row.id], { locked: !row.locked });
      })
    );
    if (row.type === 'section' || row.type === 'group') {
      actions.append(
        makeNavigatorAction('trash-2', '删除并保留内容', () => deleteOrganizationEntry(row.type, row.id, false))
      );
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        buildContextMenu(
          [
            {
              label: `重命名${row.type === 'section' ? '画框' : '分组'}`,
              action: () => renameOrganizationEntry(row.type, row.id)
            },
            {
              label: `删除${row.type === 'section' ? '画框' : '分组'}（保留内容）`,
              action: () => deleteOrganizationEntry(row.type, row.id, false)
            },
            {
              label: `删除${row.type === 'section' ? '画框' : '分组'}及其中内容`,
              action: () => deleteOrganizationEntry(row.type, row.id, true)
            }
          ],
          event.clientX,
          event.clientY
        );
      });
    }
  }
  element.append(dragHandle, disclosure, main, actions);
  return element;
}

function makeNavigatorAction(iconName, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'navigator-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  const icon = document.createElement('i');
  icon.dataset.lucide = iconName;
  button.appendChild(icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

function locateNavigatorRow(row) {
  if (row.type === 'item') return locateTarget(row.id, 0, 0, { fromNavigator: true });
  if (row.type === 'section') {
    const section = state.sections.get(row.id);
    if (section) focusNavigatorTarget(section, 'section');
    return;
  }
  if (row.type === 'group') {
    const ids = getGroupMemberItemIds(row.id);
    state.selectedIds = new Set(ids);
    state.selectedId = ids[0] || null;
    updateSelectionUI();
    const bounds = getBoundsOfItems(ids);
    if (bounds) focusNavigatorTarget(bounds, 'group');
  }
}

function reorderSections(sourceId, targetId) {
  if (!sourceId || sourceId === targetId || !state.sections.has(sourceId) || !state.sections.has(targetId)) return;
  const ordered = Array.from(state.sections.values()).sort((a, b) => a.order - b.order);
  const sourceIndex = ordered.findIndex((section) => section.id === sourceId);
  const targetIndex = ordered.findIndex((section) => section.id === targetId);
  const [moved] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, moved);
  pushUndoSnapshot();
  ordered.forEach((section, order) => {
    section.order = order;
  });
  enqueueOperation({ kind: 'batch', ops: ordered.map((section) => ({ kind: 'section-upsert', section })) });
  markDirty(true);
  renderAll();
}

export { createNavigatorRow, locateNavigatorRow, makeNavigatorAction, renderNavigator, reorderSections };

export { configureNavigatorRendering };
