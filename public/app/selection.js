import { placeAnchoredMenu } from './menu-placement.js';

import { copySelection, copySelectionAsImage, cutSelection, pasteClipboard } from './clipboard.js';
import { finishEditing } from './editing.js';
import { els } from './elements.js';

import { closeMenuSurface, openMenuSurface } from './interface-model.js';
import { refreshIcons } from './interface-model.js';
import { platformShortcut, setControlAvailability } from './ui-feedback.js';
let contextMenuFocus = null;
import { deleteItems } from './items.js';
import { canMutateItem } from './layers-model.js';

import { isTransformableItem } from './marquee-model.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';

import { state } from './state.js';
import {
  clearTableCellSelection,
  getTableCellCoordinates,
  getTableColumnCount,
  getTableRowCount,
  syncTableFromDom
} from './table-rendering-model.js';

import { cssEscape } from './utilities.js';
import { getSelectedIds } from './selection-model.js';

let getBoardPoint, updateContextPanel, updateArrangeBar, moveSelectionZ, attachSelectionFrame, updateSelectionHandleCursors, hitTestItem, renderItem, deleteTableDimension;

function configureSelection(callbacks) {
  ({getBoardPoint,
updateContextPanel,
updateArrangeBar,
moveSelectionZ,
attachSelectionFrame,
updateSelectionHandleCursors,
hitTestItem,
renderItem,
deleteTableDimension} = callbacks);
}

function showContextMenu(event) {
  if (!state.boardId || !event.target.closest('#viewport')) {
    return;
  }
  event.preventDefault();
  const tableCell = event.target.closest('.board-table td, .board-table th');
  const tableElement = tableCell?.closest('.board-item');
  const tableItem = tableElement && state.items.get(tableElement.dataset.itemId);
  const tablePoint = getTableCellCoordinates(tableCell);
  if (tableItem?.type === 'table' && tablePoint && canMutateItem(tableItem)) {
    if (state.editingId === tableItem.id) {
      syncTableFromDom(tableElement, tableItem);
    } else if (!state.selectedIds.has(tableItem.id)) {
      selectItem(tableItem.id);
    }
    state.tableFocus = { itemId: tableItem.id, ...tablePoint };
    updateContextPanel();
    buildContextMenu(
      [
        {
          label: `删除第 ${tablePoint.row + 1} 行`,
          danger: true,
          disabled: getTableRowCount(tableItem) <= 1,
          action: () => deleteTableDimension(tableItem, 'row', state.tableFocus)
        },
        {
          label: `删除第 ${tablePoint.column + 1} 列`,
          danger: true,
          disabled: getTableColumnCount(tableItem) <= 1,
          action: () => deleteTableDimension(tableItem, 'column', state.tableFocus)
        },
        { type: 'separator' },
        { label: '复制表格', action: copySelection },
        { label: '复制为图片', action: copySelectionAsImage }
      ],
      event.clientX,
      event.clientY
    );
    return;
  }
  if (state.editingId) {
    finishEditing();
  }
  const point = getBoardPoint(event);
  let itemElement = event.target.closest('.board-item');
  if (!itemElement && (state.tool === 'select' || state.tool === 'eraser')) {
    const hit = hitTestItem(point);
    if (hit) {
      renderItem(hit);
      itemElement = document.querySelector(`.board-item[data-item-id="${cssEscape(hit.id)}"]`);
    }
  }
  const item = itemElement ? state.items.get(itemElement.dataset.itemId) : null;
  if (item && !state.selectedIds.has(item.id)) {
    selectItem(item.id);
  }
  const hasSelection = getSelectedIds().length > 0;
  const items = [];
  if (hasSelection) {
    items.push({ label: '复制', icon:'copy', shortcut:'$mod C', action: copySelection });
    items.push({ label: '剪切', icon:'scissors', shortcut:'$mod X', action: cutSelection });
    items.push({ label: '删除', icon:'trash-2', danger:true, action: () => deleteItems(getSelectedIds()) });
    items.push({ type: 'separator' });
    items.push({ label: '上移一层', action: () => moveSelectionZ('up') });
    items.push({ label: '下移一层', action: () => moveSelectionZ('down') });
    items.push({ label: '置顶', action: () => moveSelectionZ('top') });
    items.push({ label: '置底', action: () => moveSelectionZ('bottom') });
    items.push({ type: 'separator' });
    items.push({ label: '复制为图片', action: copySelectionAsImage });
    
  } else {
    items.push({ label: '粘贴', icon:'clipboard-paste', shortcut:'$mod V', action: pasteClipboard, disabled: !state.clipboard.length, reason:'剪贴板中没有可粘贴的画板内容' });
  }
  if (window.MusePlanning?.enabled) {
    const planningItems = window.MusePlanning.canvasActions?.(event.target, point) || [];
    if (planningItems.length) items.push({ type: 'separator' }, ...planningItems);
  }
  buildContextMenu(items, event.clientX, event.clientY);
}

function buildContextMenu(items, x, y) {
  contextMenuFocus=document.activeElement;
  els.contextMenu.setAttribute('role','menu');
  els.contextMenu.textContent = '';
  for (const item of items) {
    if (item.type === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'menu-separator';
      els.contextMenu.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    const label=document.createElement('span');label.textContent=item.label;
    const icon=document.createElement(item.icon?'i':'span');if(item.icon)icon.dataset.lucide=item.icon;icon.className='context-menu-icon';icon.setAttribute('aria-hidden','true');button.append(icon,label);
    button.setAttribute('aria-label',item.label);
    button.setAttribute('role','menuitem');
    if(item.shortcut){const key=document.createElement('kbd');key.textContent=platformShortcut(item.shortcut);button.append(key);}
    button.classList.toggle('danger', Boolean(item.danger));
    setControlAvailability(button,Boolean(item.disabled),item.reason || '当前选区不适用，请至少保留一行一列');
    if(item.disabled){const reason=document.createElement('small');reason.className='context-menu-reason';reason.textContent=button.dataset.disabledReason;button.append(reason);}
    button.addEventListener('click', () => {
      hideContextMenu();
      item.action();
    });
    els.contextMenu.appendChild(button);
  }
  els.contextMenu.hidden = false;
  refreshIcons(els.contextMenu);
  if(!els.contextMenu.dataset.keyboardReady){
    els.contextMenu.dataset.keyboardReady='true';
    els.contextMenu.addEventListener('keydown',event=>{
      if(event.isComposing || event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hideContextMenu({immediate:true});return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();const controls=[...els.contextMenu.querySelectorAll('button:not(:disabled)')],index=controls.indexOf(document.activeElement);
      controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowDown'?1:-1)+controls.length)%controls.length]?.focus({preventScroll:true});
    });
  }
  els.contextMenu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  const rect = els.contextMenu.getBoundingClientRect();
  const visual = window.visualViewport;
  const left = visual?.offsetLeft || 0, top = visual?.offsetTop || 0;
  els.contextMenu.style.left = `${Math.max(left + 4, Math.min(x, left + (visual?.width || window.innerWidth) - rect.width - 8))}px`;
  els.contextMenu.style.top = `${Math.max(top + 4, Math.min(y, top + (visual?.height || window.innerHeight) - rect.height - 8))}px`;
  placeAnchoredMenu(els.contextMenu, { left: x, top: y, width: 1, height: 1 });
  openMenuSurface(els.contextMenu, { left: x, top: y, width: 1, height: 1 });
}

function hideContextMenu(options = {}) {
  if (!els.contextMenu || els.contextMenu.hidden || els.contextMenu.dataset.menuClosing === 'true') return;
  const restoreFocus=els.contextMenu.contains(document.activeElement);
  closeMenuSurface(
    els.contextMenu,
    () => {
      els.contextMenu.hidden = true;
      els.contextMenu.removeAttribute('style');
      if(restoreFocus && contextMenuFocus?.isConnected && !document.querySelector('dialog[open]'))contextMenuFocus.focus({preventScroll:true});
    },
    { immediate: options.immediate !== false }
  );
}

function selectItem(id, options = {}) {
  if (id) {
    const item = state.items.get(id);
    if (!isTransformableItem(item)) {
      id = null;
    }
  }
  if (state.selectedId === id && state.selectedIds.size === (id ? 1 : 0)) {
    return;
  }
  if (state.tableCellSelection && state.tableCellSelection.itemId !== id) {
    clearTableCellSelection();
  }
  if (state.tableFocus && state.tableFocus.itemId !== id) {
    state.tableFocus = null;
  }
  if (!id || !state.mindmapSelection || state.mindmapSelection.itemId !== id) {
    clearMindNodeSelection();
  }
  finishEditing();
  state.selectedId = id;
  state.selectedIds = new Set(id ? [id] : []);
  updateSelectionUI(options);
}

function updateSelectionUI(options = {}) {
  window.ConnectorUI?.schedule();
  window.ConnectorImpact?.syncTrigger();
  const requestedIds = Array.isArray(options.itemIds) ? options.itemIds : null;
  const nodes =
    requestedIds && requestedIds.length < 500
      ? requestedIds.map((id) => document.querySelector(`.board-item[data-item-id="${cssEscape(id)}"]`)).filter(Boolean)
      : document.querySelectorAll('.board-item');
  nodes.forEach((node) => {
    const id = node.dataset.itemId;
    const selected = state.selectedIds.has(id);
    node.classList.toggle('selected', selected);
    const existingFrame = node.querySelector('.selection-frame');
    if (selected && state.selectedId === id) {
      if (existingFrame) updateSelectionHandleCursors(existingFrame, state.items.get(id));
      else attachSelectionFrame(node);
    } else {
      existingFrame?.remove();
    }
  });
  updateMultiSelectionFrame(options.selectionBounds);
  if (options.panels !== false) {
    updateContextPanel();
    updateArrangeBar();
  }
}

function updateMultiSelectionFrame(boundsOverride = null) {
  if (state.selectedIds.size < 2) {
    document.querySelector('.multi-selection')?.remove();
    return;
  }
  let frame = document.querySelector('.multi-selection');
  if (!frame) {
    frame = document.createElement('div');
    frame.className = 'multi-selection';
    els.itemsLayer.appendChild(frame);
  }
  let minX = boundsOverride?.x ?? Infinity;
  let minY = boundsOverride?.y ?? Infinity;
  let maxX = boundsOverride ? boundsOverride.x + boundsOverride.w : -Infinity;
  let maxY = boundsOverride ? boundsOverride.y + boundsOverride.h : -Infinity;
  if (!boundsOverride) {
    for (const id of state.selectedIds) {
      const item = state.items.get(id);
      if (!item) {
        continue;
      }
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.w);
      maxY = Math.max(maxY, item.y + item.h);
    }
  }
  if (!Number.isFinite(minX)) {
    frame.remove();
    return;
  }
  frame.style.left = `${minX}px`;
  frame.style.top = `${minY}px`;
  frame.style.width = `${maxX - minX}px`;
  frame.style.height = `${maxY - minY}px`;
}
export { showContextMenu, buildContextMenu, hideContextMenu, selectItem, updateSelectionUI, updateMultiSelectionFrame };

export { configureSelection };
