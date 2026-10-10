import { state } from '../state.js';
import { makeId } from '../utilities.js';
import { showToast } from '../interface-model.js';
import { getWritableLayer, explainUnwritableLayer, canMutateItem } from '../layers-model.js';
import { pushUndoSnapshot } from '../history-controller.js';
import { snapshotItems } from '../history-controller-model.js';
import { enqueueOperation } from '../sync-queue.js';
import { markDirty } from '../save-status.js';
import { getSelectedIds } from '../selection-model.js';
import { renderItem } from '../rendering.js';
import { broadcastUpsert, upsertItem } from '../items.js';
import { effectiveRouteType, endpoints } from './binding.js';
import { enterTargetText } from './creation.js';
import { cancel } from './draft.js';
import { addLabel, batchStyle, change, readPreferences, savePreferences, writePreferences } from './editing.js';
import { stateRuntime } from './runtime/state.js';
import { C, button, cache } from './state.js';
import { schedule } from './controls.js';
import {
  selectControl,
  colorControl,
  menuSection,
  menuAction,
  lineTypes,
  lineWidths,
  lineDashes,
  markerTypes
} from './control-widgets.js';

function moreMenu() {
  const more = document.createElement('details'),
    summary = document.createElement('summary'),
    menu = document.createElement('div'),
    index = document.createElement('div');
  summary.textContent = '更多';
  summary.title = '连线样式、路径、端点、关系与工具设置';
  menu.className = 'connection-more';
  index.className = 'connection-menu-index';
  index.innerHTML = '<div class="connection-menu-title">连接线设置 <span>选择一项查看</span></div>';
  menu.append(index);
  more.append(summary, menu);
  stateRuntime.toolbar.append(more);
  return menu;
}

function openMenuSections(mode, key) {
  try {
    const previous = JSON.parse(stateRuntime.toolbar.dataset.signature || 'null');
    if (previous?.[0] !== mode || previous?.[1] !== key) return [];
  } catch {
    return [];
  }
  const menu = stateRuntime.toolbar.querySelector('.connection-more');
  return [
    stateRuntime.toolbar.querySelector('details[open] > summary') ? '更多' : null,
    menu?.dataset.page || null
  ].filter(Boolean);
}

function restoreMenuSections(titles) {
  if (!titles.length) return;
  const more = stateRuntime.toolbar.querySelector(':scope > details'),
    menu = more?.querySelector('.connection-more');
  if (more && titles.includes('更多')) more.open = true;
  if (menu) {
    const page = titles.find((title) => title !== '更多');
    if (page && [...menu.querySelectorAll('.connection-menu-side')].some((panel) => panel.dataset.title === page)) {
      menu.dataset.page = page;
      for (const panel of menu.querySelectorAll('.connection-menu-side')) panel.hidden = panel.dataset.title !== page;
    }
  }
}

function setToolPreference(key, value) {
  if (key === 'exactMode') stateRuntime.exactMode = value;
  else stateRuntime.continuous = value;
  writePreferences({ [key]: value });
  schedule();
  showToast(
    key === 'exactMode'
      ? value
        ? '精确热点已开启：新端点按点击位置连接'
        : '精确热点已关闭：新端点自动吸附对象边缘'
      : value
        ? '连续连接已开启：完成一条后继续使用连线工具'
        : '连续连接已关闭：完成一条后返回导航工具'
  );
}

function toggleLineJumps() {
  if (!getWritableLayer()) {
    showToast(explainUnwritableLayer());
    return;
  }
  pushUndoSnapshot();
  state.connectorLineJumps = !stateRuntime.lineJumps;
  stateRuntime.lineJumps = state.connectorLineJumps;
  enqueueOperation({ kind: 'settings', settings: { connectorLineJumps: stateRuntime.lineJumps } });
  markDirty(true);
  stateRuntime.jumpsDirty = true;
  schedule();
  showToast(stateRuntime.lineJumps ? '已在整个画布显示连接线交叉提示' : '已关闭整个画布的连接线交叉提示');
}

function toolSettings(menu) {
  const section = menuSection(menu, '连线工具与画布');
  menuAction(section, `精确热点：${stateRuntime.exactMode ? '开' : '关'}`, '新建或重绑端点时，按点击位置连接对象', () =>
    setToolPreference('exactMode', !stateRuntime.exactMode)
  );
  menuAction(section, `连续连接：${stateRuntime.continuous ? '开' : '关'}`, '完成一条连线后继续使用连线工具', () =>
    setToolPreference('continuous', !stateRuntime.continuous)
  );
  menuAction(
    section,
    `交叉提示：${stateRuntime.lineJumps ? '开' : '关'}`,
    '画布共享设置，在交叉处显示跨线提示',
    toggleLineJumps
  );
}

function buildCreationToolbar() {
  const preferences = readPreferences(),
    defaults = C.normalize({ connectorVersion: 1, style: preferences.style, route: { type: preferences.type } });
  const signature = JSON.stringify([
    'create',
    state.boardId,
    defaults.route.type,
    defaults.style,
    stateRuntime.exactMode,
    stateRuntime.continuous,
    stateRuntime.lineJumps
  ]);
  if (stateRuntime.toolbar.dataset.signature === signature) return;
  const openSections = openMenuSections('create', state.boardId);
  stateRuntime.toolbar.dataset.signature = signature;
  stateRuntime.toolbar.classList.add('connection-create-mode');
  stateRuntime.toolbar.replaceChildren();
  selectControl(
    stateRuntime.toolbar,
    '新连线线型',
    lineTypes,
    defaults.route.type,
    (type) => {
      writePreferences({ type });
      schedule();
      showToast(`新连线将使用${lineTypes.find(([key]) => key === type)?.[1]}，预览会同步更新`);
    },
    '决定下一条连线的形状'
  );
  selectControl(stateRuntime.toolbar, '新连线终点标记', markerTypes, defaults.style.end, (end) => {
    writePreferences({ style: { ...defaults.style, end } });
    schedule();
    showToast(`新连线的终点标记已设为${markerTypes.find(([key]) => key === end)?.[1]}`);
  });
  colorControl(stateRuntime.toolbar, defaults.style.color, (color) => {
    writePreferences({ style: { ...defaults.style, color } });
    schedule();
    showToast('新连线颜色已更新');
  });
  const menu = moreMenu(),
    style = menuSection(menu, '新连线样式');
  selectControl(
    style,
    '线宽',
    lineWidths,
    defaults.style.width,
    (width) => {
      writePreferences({ style: { ...defaults.style, width: Number(width) } });
      schedule();
      showToast('新连线线宽已更新');
    },
    '用于随后创建的连线',
    true
  );
  selectControl(
    style,
    '线条',
    lineDashes,
    defaults.style.dash,
    (dash) => {
      writePreferences({ style: { ...defaults.style, dash } });
      schedule();
      showToast('新连线线条样式已更新');
    },
    '用于随后创建的连线',
    true
  );
  selectControl(
    style,
    '起点标记',
    markerTypes,
    defaults.style.start,
    (start) => {
      writePreferences({ style: { ...defaults.style, start } });
      schedule();
      showToast('新连线起点标记已更新');
    },
    '用于随后创建的连线',
    true
  );
  toolSettings(menu);
  restoreMenuSections(openSections);
}

function toolbarSignature(item, editable, selectedType) {
  return JSON.stringify([
    'edit',
    item.id,
    item.style,
    item.route,
    selectedType,
    item.labels,
    item.relation,
    item.source.binding?.id,
    item.source.binding?.content?.kind,
    item.source.status,
    item.target.binding?.id,
    item.target.binding?.content?.kind,
    item.target.status,
    stateRuntime.exactMode,
    stateRuntime.continuous,
    stateRuntime.lineJumps,
    Boolean(stateRuntime.styleClipboard),
    editable
  ]);
}

function buildPrimaryControls(item, editable, selectedType) {
  selectControl(
    stateRuntime.toolbar,
    '线型',
    lineTypes,
    item.route.type,
    (type) => {
      const items = getSelectedIds()
        .map((id) => state.items.get(id))
        .filter((current) => current?.type === 'connector' && current.route.type !== type && canMutateItem(current));
      if (!items.length) return;
      pushUndoSnapshot();
      for (const current of items) {
        const next = C.clone(current);
        next.route = { ...next.route, type, constraints: [], locked: false };
        C.apply(next);
        state.items.set(next.id, next);
        renderItem(next);
        broadcastUpsert(next);
        savePreferences(next);
      }
      markDirty(true);
      schedule();
      showToast(`已切换 ${items.length} 条连线的线型，旧线型的折点已清除`);
    },
    '智能会按两端元素、距离与方向自动选线型；切换时清除旧线型折点',
    false,
    !editable
  );
  if (item.route.type === 'smart') {
    const hint = document.createElement('span');
    hint.className = 'connection-route-hint';
    hint.textContent = `→ ${lineTypes.find(([type]) => type === selectedType)?.[1] || '直线'}`;
    hint.title = '智能线型会随连接对象和位置变化';
    stateRuntime.toolbar.append(hint);
  }
  selectControl(
    stateRuntime.toolbar,
    '终点标记',
    markerTypes,
    item.style.end,
    (value) => {
      if (batchStyle('end', value)) showToast(`终点标记已设为${markerTypes.find(([key]) => key === value)?.[1]}`);
    },
    '修改所选连线的终点标记',
    false,
    !editable
  );
  colorControl(
    stateRuntime.toolbar,
    item.style.color,
    (value) => {
      if (batchStyle('color', value)) showToast('连接颜色已更新');
    },
    !editable
  );
  button(
    item.labels.length ? `标签 ${item.labels.length}` : '标签',
    () => addLabel(state.items.get(item.id)),
    stateRuntime.toolbar,
    '标签：再次点击会载入已保存的标签；双击线条可新增'
  ).disabled = !editable;
}

function buildStyleMenu(menu, item, editable) {
  const style = menuSection(menu, '样式');
  selectControl(
    style,
    '线宽',
    lineWidths,
    item.style.width,
    (value) => {
      if (batchStyle('width', Number(value))) showToast('连接线宽已更新');
    },
    '改变线条粗细',
    true,
    !editable
  );
  selectControl(
    style,
    '线条',
    lineDashes,
    item.style.dash,
    (value) => {
      if (batchStyle('dash', value)) showToast('线条样式已更新');
    },
    '实线、虚线或点线',
    true,
    !editable
  );
  selectControl(
    style,
    '起点标记',
    markerTypes,
    item.style.start,
    (value) => {
      if (batchStyle('start', value)) showToast(`起点标记已设为${markerTypes.find(([key]) => key === value)?.[1]}`);
    },
    '显示当前起点标记并直接选择',
    true,
    !editable
  );
  menuAction(style, '复制样式', '复制颜色、线宽、线条和两端标记', () => {
    stateRuntime.styleClipboard = C.clone(item.style);
    schedule();
    showToast('已复制连接样式');
  });
  menuAction(
    style,
    '粘贴样式',
    '将复制的样式应用到选中连线',
    () => {
      if (stateRuntime.styleClipboard && batchStyle(stateRuntime.styleClipboard)) showToast('已粘贴连接样式');
    },
    !stateRuntime.styleClipboard || !editable
  );
  if (item.labels.length)
    menuAction(
      style,
      '新增标签',
      '另加一个气泡标签，现有文字保持不变',
      () => addLabel(state.items.get(item.id), true),
      !editable
    );
}

function buildPathMenu(menu, item, editable, selectedType) {
  const resolvedType = selectedType;
  if (resolvedType === 'orthogonal' || item.route.type === 'curve') {
    const path = menuSection(menu, '路径与引线');
    const resolvedEnds = resolvedType === 'orthogonal' ? endpoints(item) : null;
    if (resolvedType === 'orthogonal')
      for (const [key, name] of [
        ['startStub', '起点'],
        ['endStub', '终点']
      ]) {
        const endpoint = resolvedEnds[name === '起点' ? 'source' : 'target'];
        if (!item[name === '起点' ? 'source' : 'target'].binding || !endpoint?.rect || endpoint.status === 'orphan')
          continue;
        const values = [0, 8, 16, 24, 32, 48];
        if (!values.includes(item.route[key])) values.push(item.route[key]);
        values.sort((a, b) => a - b);
        selectControl(
          path,
          `${name}引线`,
          values.map((n) => [String(n), n ? `${n} 单位` : '无引线']),
          item.route[key],
          (value) => {
            const current = state.items.get(item.id);
            if (current && change(current, 'route', { ...current.route, [key]: Number(value) }))
              showToast(`${name}引线已设为${value === '0' ? '无' : `${value} 单位`}`);
          },
          '设为无可去掉端点旁的短弯钩',
          true,
          !editable
        );
      }
    if (item.route.constraints.length || item.route.locked)
      menuAction(
        path,
        '恢复自动路径',
        '清除手动折点并解锁；引线长度保持当前设置',
        () => {
          const current = state.items.get(item.id);
          if (current && change(current, 'route', { ...current.route, constraints: [], locked: false }))
            showToast('已清除手动折点，连接线恢复自动寻路');
        },
        !editable
      );
    if (item.route.type !== 'smart')
      menuAction(
        path,
        item.route.locked ? '解锁折点' : '锁定折点',
        '固定当前折点并停用拖动；端点移动后路径仍会重算',
        () => {
          const current = state.items.get(item.id),
            result = cache.get(item.id)?.result;
          if (!current) return;
          let constraints = current.route.constraints;
          if (!current.route.locked && result)
            constraints =
              current.route.type === 'curve'
                ? [{ id: makeId('constraint'), kind: 'curve', ...result.control }]
                : result.points
                    .slice(1, -1)
                    .map((point) => ({ id: makeId('constraint'), kind: 'point', a: point, b: point }));
          if (change(current, 'route', { ...current.route, constraints, locked: !current.route.locked }))
            showToast(current.route.locked ? '折点已解锁，可继续拖动' : '当前折点已锁定；端点移动时路径仍会重算');
        },
        !editable
      );
  }
}

function buildEndpointMenu(menu, item, editable) {
  const endpointsMenu = menuSection(menu, '端点');
  for (const [key, name] of [
    ['source', '起点'],
    ['target', '终点']
  ]) {
    menuAction(
      endpointsMenu,
      `${name}重绑为文字`,
      '选择文字片段后确认，保留连接样式和标签',
      () => {
        const current = state.items.get(item.id);
        if (!current || !canMutateItem(current)) return;
        cancel();
        stateRuntime.textRebind = { id: current.id, key };
        stateRuntime.draft = {
          source: C.clone(current[key === 'source' ? 'target' : 'source']),
          target: C.clone(current[key]),
          layerId: current.layerId,
          pointerId: null
        };
        enterTargetText();
        showToast(`请选择${name}要关联的文字片段`);
      },
      !editable
    );
    if (item[key].binding)
      menuAction(
        endpointsMenu,
        `断开${name}`,
        '固定在当前位置，不再跟随原对象移动',
        () => {
          const current = state.items.get(item.id);
          if (
            current &&
            change(current, key, C.terminal({ fallback: endpoints(current)[key === 'source' ? 'start' : 'end'] }))
          )
            showToast(`${name}已固定在当前位置，不再跟随原对象移动`);
        },
        !editable
      );
    if (item[key].binding?.content)
      menuAction(
        endpointsMenu,
        `${name}改连整体`,
        '取消文字、节点或单元格定位，连接到整个对象',
        () => {
          const current = state.items.get(item.id);
          if (
            current &&
            change(current, key, {
              ...current[key],
              binding: { kind: current[key].binding.kind, id: current[key].binding.id },
              status: 'normal'
            })
          )
            showToast(`${name}已改连整个对象`);
        },
        !editable
      );
  }
  const relation = menuSection(menu, '方向与关系');
  menuAction(
    relation,
    '反转方向',
    '交换起点与终点，标签位置随之反转',
    () => {
      const current = state.items.get(item.id);
      if (!current || !canMutateItem(current)) return;
      const next = C.clone(current),
        before = snapshotItems();
      [next.source, next.target] = [next.target, next.source];
      [next.route.startStub, next.route.endStub] = [next.route.endStub, next.route.startStub];
      next.labels = next.labels.map((label) => ({ ...label, position: 1 - label.position }));
      next.route.constraints = next.route.constraints
        .slice()
        .reverse()
        .map((constraint) =>
          constraint.kind === 'segment' || constraint.kind === 'curve'
            ? { ...constraint, a: constraint.b, b: constraint.a }
            : constraint
        );
      if (upsertItem(C.apply(next), { select: true, historySnapshot: before })) showToast('已交换连接线的起点和终点');
    },
    !editable
  );
}

function buildToolbar(item) {
  const editable = canMutateItem(item);
  const selectedType = effectiveRouteType(item, endpoints(item));
  const signature = toolbarSignature(item, editable, selectedType);
  if (stateRuntime.toolbar.dataset.signature === signature) return;
  const openSections = openMenuSections('edit', item.id);
  stateRuntime.toolbar.dataset.signature = signature;
  stateRuntime.toolbar.classList.remove('connection-create-mode');
  stateRuntime.toolbar.replaceChildren();
  buildPrimaryControls(item, editable, selectedType);
  const menu = moreMenu();
  buildStyleMenu(menu, item, editable);
  buildPathMenu(menu, item, editable, selectedType);
  buildEndpointMenu(menu, item, editable);
  toolSettings(menu);
  restoreMenuSections(openSections);
}
export {
  moreMenu,
  openMenuSections,
  restoreMenuSections,
  setToolPreference,
  toggleLineJumps,
  toolSettings,
  buildCreationToolbar,
  buildToolbar,
  toolbarSignature,
  buildPrimaryControls,
  buildStyleMenu,
  buildPathMenu,
  buildEndpointMenu
};
