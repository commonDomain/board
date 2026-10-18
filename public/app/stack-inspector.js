import { state } from './state.js';
import { els } from './elements.js';
import { canMutateItem, compareRenderItems, getLayer } from './layers-model.js';
import { isItemVisible } from './layer-visibility.js';
import { getItemRectBounds, intersectsRect, pointHitsItemBounds } from './rendering-model.js';
import { queryItemsAtPoint, queryItemsInRect } from './spatial-index-model.js';

let toggle;
let outline;
let isolated = null;
let isolationStyle;

function focusCanvas() {
  els.viewport.tabIndex = -1;
  els.viewport.focus({ preventScroll: true });
}

function isolate(item) {
  isolated = item ? { id: item.id, boardId: state.boardId, epoch: state.canvasEpoch } : null;
  if (!isolationStyle) { isolationStyle = document.createElement('style'); document.head.append(isolationStyle); }
  isolationStyle.textContent = item ? `#board.stack-isolating .board-item:not([data-item-id="${CSS.escape(item.id)}"]), #board.stack-isolating .connection-internal-layer { visibility: hidden !important; pointer-events: none !important; }` : '';
  els.board.classList.toggle('stack-isolating', Boolean(item));
  if (toggle && item) { toggle.hidden = false; toggle.textContent = '退出单独查看 · 恢复叠放显示'; }
}

export function isStackIsolatedItem(item) {
  return !isolated || isolated.boardId !== state.boardId || isolated.epoch !== state.canvasEpoch || item.id === isolated.id;
}
const types = { ink: '笔迹', connector: '连接线', shape: '形状', text: '文字', note: '便签', image: '图片',
  table: '表格', sheet: '工作表', mindmap: '脑图', sticker: '贴纸', planning: '规划', kdocs: '云文档',
  'amap-map': '地图', 'amap-search': '地点搜索', 'amap-route': '路线' };

export function stackItemsAtPoint(point) {
  return queryItemsAtPoint(point).filter(item => isItemVisible(item) && pointHitsItemBounds(item, point))
    .sort((a, b) => compareRenderItems(b, a));
}

function overlapping(item) {
  const bounds = getItemRectBounds(item);
  return queryItemsInRect(bounds).filter(other => isItemVisible(other) && intersectsRect(other, bounds))
    .sort((a, b) => compareRenderItems(b, a));
}

export function openStackInspector(items, point, menu, select, page = 0) {
  const current = state.items.get(state.selectedId);
  const perPage = 20;
  const actions = [{ type: 'heading', label: `叠放内容 · ${items.length} 项`, detail: '从上到下排列，点击选择内容' }];
  if (current && canMutateItem(current)) actions.push({ label: '单独查看选中内容', icon: 'scan',
    detail: '暂时移开遮挡，可直接拖动或双击编辑；不改变层级',
    action: () => { if (state.items.get(current.id) === current && canMutateItem(current)) { isolate(current); focusCanvas(); } } });
  for (const item of items.slice(page * perPage, (page + 1) * perPage)) {
    const name = String(item.navigatorName || item.text || item.title || item.tree?.text || types[item.type] || '元素').replace(/\s+/g, ' ').slice(0, 40);
    const relation = current?.id === item.id ? '当前选中' : current ? compareRenderItems(item, current) > 0 ? '位于上方' : '位于下方' : '';
    actions.push({ label: name === types[item.type] ? name : `${types[item.type] || '元素'} · ${name}`, icon: 'layers',
      detail: [getLayer(item.layerId)?.name || '图层', relation, !canMutateItem(item) ? '已锁定或只读' : ''].filter(Boolean).join(' · '),
      disabled: !canMutateItem(item), reason: '请先在图层或内容导航中解锁',
      action: () => { if (state.items.get(item.id) === item && canMutateItem(item)) { select(item.id); focusCanvas(); } } });
  }
  if (page > 0) actions.push({ label: '上一页', action: () => openStackInspector(items, point, menu, select, page - 1) });
  if ((page + 1) * perPage < items.length) actions.push({ label: '下一页', action: () => openStackInspector(items, point, menu, select, page + 1) });
  menu(actions, point.x, point.y);
}

export function updateStackInspector(menu, select) {
  const item = state.selectedIds.size === 1 && state.items.get(state.selectedId);
  if (isolated && (!item || item.id !== isolated.id || isolated.boardId !== state.boardId || isolated.epoch !== state.canvasEpoch || !canMutateItem(item))) isolate(null);
  if (!item || !isItemVisible(item)) { if (toggle) toggle.hidden = true; if (outline) outline.hidden = true; return; }
  const items = overlapping(item);
  if (!toggle) {
    toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'stack-inspector-toggle';
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.addEventListener('pointerdown', event => event.stopPropagation());
    toggle.addEventListener('click', () => {
      if (isolated) { isolate(null); updateStackInspector(menu, select); focusCanvas(); return; }
      const selected = state.items.get(state.selectedId); if (!selected) return;
      const rect = toggle.getBoundingClientRect();
      openStackInspector(overlapping(selected), { x: rect.left, y: rect.top }, menu, select);
    });
    els.viewport.append(toggle);
    const documentBar = document.querySelector('.document-bar');
    if (documentBar) {
      const position = () => toggle.style.setProperty('--stack-inspector-top', `${Math.max(12, documentBar.getBoundingClientRect().bottom - els.viewport.getBoundingClientRect().top + 8)}px`);
      const observer = new ResizeObserver(position);
      observer.observe(documentBar);
      observer.observe(els.viewport);
      position();
    }
  }
  toggle.hidden = items.length < 2;
  const below = items.filter(other => compareRenderItems(other, item) < 0).length;
  const above = items.filter(other => compareRenderItems(other, item) > 0).length;
  if (!outline && above) {
    outline = document.createElement('div'); outline.className = 'stack-selection-outline';
    outline.setAttribute('aria-hidden', 'true'); els.board.append(outline);
  }
  if (outline) { outline.hidden = !above; updateStackOutline(item); }
  toggle.textContent = `叠放检查 · 上方 ${above} 项 / 下方 ${below} 项`;
  toggle.title = '查看与选中内容外框重叠的对象，按从上到下的顺序选择';
  if (isolated) { toggle.hidden = false; toggle.textContent = '退出单独查看 · 恢复叠放显示'; }
}

export function updateStackOutline(item) {
  if (!outline || outline.hidden || item.id !== state.selectedId) return;
  Object.assign(outline.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px`, height: `${item.h}px`, transform: `rotate(${item.rotation || 0}deg)` });
}
