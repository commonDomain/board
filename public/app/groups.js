import { pushUndoSnapshot } from './history-controller.js';
import { els } from './elements.js';
import { openAdaptiveDialog, setEffectBusy } from './interface.js';
import { showToast } from './interface-model.js';
import { canMutateItem, normalizeClientGroup } from './layers-model.js';

import { renderAll } from './rendering.js';
import { markDirty } from './save-status.js';
import { applyContainerDeletionLocally } from './sections.js';
import { getSelectedIds } from './selection-model.js';
import { updateSelectionUI } from './selection.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { refreshConnectorsFor, updateItemElementGeometry } from './transform.js';
import { cssEscape, makeId } from './utilities.js';
import { runLayoutWorker } from './groups-model.js';

let itemNavigatorLabel,
  refreshOrganizationUi;

function configureGroups(callbacks) {
  ({
    itemNavigatorLabel,
    refreshOrganizationUi
  } = callbacks);
}

function groupSelection() {
  const ids = getSelectedIds().filter((id) => canMutateItem(state.items.get(id)));
  if (ids.length < 2) {
    showToast('至少选择两个可编辑对象才能组合');
    return;
  }
  const items = ids.map((id) => state.items.get(id));
  const sections = new Set(items.map((item) => item.sectionId || null));
  if (sections.size !== 1) {
    showToast('组合中的对象必须位于同一画框');
    return;
  }
  const sectionId = items[0].sectionId || null;
  const selectedGroups = new Set(items.map((item) => item.groupId).filter(Boolean));
  const parentCandidates = new Set(Array.from(selectedGroups, (id) => state.groups.get(id)?.parentGroupId || null));
  const parentGroupId = parentCandidates.size === 1 ? Array.from(parentCandidates)[0] : null;
  const group = normalizeClientGroup(
    {
      id: makeId('group'),
      name: `分组 ${state.groups.size + 1}`,
      parentGroupId,
      sectionId
    },
    state.groups.size
  );
  pushUndoSnapshot();
  state.groups.set(group.id, group);
  const ops = [{ kind: 'group-upsert', group }];
  for (const selectedGroupId of selectedGroups) {
    const child = state.groups.get(selectedGroupId);
    if (!child || child.parentGroupId === group.id) continue;
    child.parentGroupId = group.id;
    ops.push({ kind: 'group-upsert', group: child });
  }
  const directIds = [];
  for (const item of items) {
    if (!item.groupId || !selectedGroups.has(item.groupId)) {
      item.groupId = group.id;
      directIds.push(item.id);
    }
  }
  if (directIds.length) ops.push({ kind: 'reparent', itemIds: directIds, sectionId, groupId: group.id });
  enqueueOperation({ kind: 'batch', ops });
  state.navigatorExpanded.add(`group:${group.id}`);
  markDirty(true);
  renderAll();
  showToast(`已组合 ${ids.length} 个对象`);
}

function ungroupSelection() {
  const groupIds = new Set(
    getSelectedIds()
      .map((id) => state.items.get(id)?.groupId)
      .filter(Boolean)
  );
  if (!groupIds.size) {
    showToast('所选对象不在分组中');
    return;
  }
  pushUndoSnapshot();
  const ops = [];
  for (const groupId of groupIds) {
    const group = state.groups.get(groupId);
    if (!group || group.locked) continue;
    for (const item of state.items.values()) if (item.groupId === groupId) item.groupId = group.parentGroupId || null;
    for (const child of state.groups.values())
      if (child.parentGroupId === groupId) child.parentGroupId = group.parentGroupId || null;
    state.groups.delete(groupId);
    ops.push({ kind: 'delete-container', targetType: 'group', id: groupId, cascade: false });
  }
  if (!ops.length) return;
  enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
  markDirty(true);
  renderAll();
  showToast('已取消一层组合');
}

function setContainerFlags(targetType, ids, flags) {
  const collection = targetType === 'section' ? state.sections : targetType === 'group' ? state.groups : state.items;
  const existing = ids.filter((id) => collection.has(id));
  if (!existing.length) return;
  pushUndoSnapshot();
  for (const id of existing) Object.assign(collection.get(id), flags);
  enqueueOperation({ kind: 'set-flags', targetType, ids: existing, flags });
  markDirty(true);
  renderAll();
}

async function renameOrganizationEntry(type, id) {
  const collection = type === 'section' ? state.sections : type === 'group' ? state.groups : state.items;
  const entry = collection.get(id);
  if (!entry || (type === 'item' ? !canMutateItem(entry) : entry.locked)) return;
  const currentName = type === 'item' ? entry.navigatorName || itemNavigatorLabel(entry) : entry.name;
  const promptLabel = type === 'section' ? '画框名称' : type === 'group' ? '分组名称' : '导航名称';
  const name = await openAdaptiveDialog({
    mode: 'prompt',
    title: `重命名${promptLabel.replace('名称', '')}`,
    message: '输入新的显示名称，画布内容和层级关系不会改变。',
    inputLabel: promptLabel,
    initialValue: currentName,
    maxLength: 100,
    confirmLabel: '保存'
  });
  if (name === null) return;
  const next = name.trim().slice(0, 100);
  const latestEntry = collection.get(id);
  if (!latestEntry || (type === 'item' ? !canMutateItem(latestEntry) : latestEntry.locked)) return;
  const latestName = type === 'item' ? latestEntry.navigatorName || itemNavigatorLabel(latestEntry) : latestEntry.name;
  if (!next || next === latestName) return;
  pushUndoSnapshot();
  if (type === 'item') {
    latestEntry.navigatorName = next;
    enqueueOperation({ kind: 'upsert', item: latestEntry });
  } else {
    latestEntry.name = next;
    enqueueOperation({ kind: type === 'section' ? 'section-upsert' : 'group-upsert', [type]: latestEntry });
  }
  markDirty(true);
  renderAll();
}

async function deleteOrganizationEntry(type, id, cascade = false) {
  const entry = (type === 'section' ? state.sections : state.groups).get(id);
  if (!entry) return;
  const detail = cascade ? '以及其中全部内容' : '，其中内容会保留在画布上';
  const confirmed = await openAdaptiveDialog({
    mode: 'confirm',
    title: `删除${type === 'section' ? '画框' : '分组'}？`,
    message: `删除“${entry.name}”${detail}。`,
    confirmLabel: '删除',
    danger: true
  });
  const latestEntry = (type === 'section' ? state.sections : state.groups).get(id);
  if (!confirmed || !latestEntry || latestEntry.locked) return;
  pushUndoSnapshot();
  applyContainerDeletionLocally(type, id, cascade);
  enqueueOperation({ kind: 'delete-container', targetType: type, id, cascade });
  markDirty(true);
  renderAll();
}

function commitItemLayout(items, direction = '') {
  if (!items.length) return;
  pushUndoSnapshot();
  const changes = items.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotation: item.rotation || 0
  }));
  enqueueOperation({ kind: 'layout', direction, items: changes });
  markDirty(true);
  for (const item of items) updateItemElementGeometry(item);
  refreshConnectorsFor(items.map((item) => item.id));
  updateSelectionUI();
  refreshOrganizationUi();
}

function arrangeSelection(action) {
  const items = getSelectedIds()
    .map((id) => state.items.get(id))
    .filter((item) => item && item.type !== 'connector' && canMutateItem(item));
  if (action === 'group') return groupSelection();
  if (action === 'ungroup') return ungroupSelection();
  if (items.length < 2) {
    showToast('至少选择两个可编辑对象');
    return;
  }
  if (action.startsWith('layout-')) {
    runAutoLayout(action, items);
    return;
  }
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.x + item.w));
  const top = Math.min(...items.map((item) => item.y));
  const bottom = Math.max(...items.map((item) => item.y + item.h));
  if (action === 'align-left')
    items.forEach((item) => {
      item.x = left;
    });
  if (action === 'align-center-x')
    items.forEach((item) => {
      item.x = (left + right - item.w) / 2;
    });
  if (action === 'align-right')
    items.forEach((item) => {
      item.x = right - item.w;
    });
  if (action === 'align-top')
    items.forEach((item) => {
      item.y = top;
    });
  if (action === 'align-center-y')
    items.forEach((item) => {
      item.y = (top + bottom - item.h) / 2;
    });
  if (action === 'align-bottom')
    items.forEach((item) => {
      item.y = bottom - item.h;
    });
  if (action === 'distribute-x') {
    if (items.length < 3) return showToast('等间距分布至少需要三个对象');
    items.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const gap = (right - left - items.reduce((sum, item) => sum + item.w, 0)) / (items.length - 1);
    let cursor = left;
    items.forEach((item) => {
      item.x = cursor;
      cursor += item.w + gap;
    });
  }
  if (action === 'distribute-y') {
    if (items.length < 3) return showToast('等间距分布至少需要三个对象');
    items.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    const gap = (bottom - top - items.reduce((sum, item) => sum + item.h, 0)) / (items.length - 1);
    let cursor = top;
    items.forEach((item) => {
      item.y = cursor;
      cursor += item.h + gap;
    });
  }
  commitItemLayout(items, action);
}

async function runAutoLayout(action, items) {
  const epoch = state.canvasEpoch;
  const before = new Map(items.map((item) => [item.id, JSON.stringify([item.x, item.y, item.w, item.h])]));
  const payload = {
    action,
    items: items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    connectors: Array.from(state.items.values())
      .filter((item) => item.type === 'connector')
      .map(({ startId, endId }) => ({ startId, endId }))
  };
  const actionButton = document.querySelector(`[data-arrange="${cssEscape(action)}"]`);
  actionButton?.classList.add('muse-beam', 'is-beam-active');
  setEffectBusy(actionButton, true);
  try {
    const result = await runLayoutWorker(payload);
    if (
      epoch !== state.canvasEpoch ||
      items.some(
        (item) =>
          state.items.get(item.id) !== item ||
          !canMutateItem(item) ||
          before.get(item.id) !== JSON.stringify([item.x, item.y, item.w, item.h])
      )
    )
      return;
    const byId = new Map(result.map((entry) => [entry.id, entry]));
    for (const item of items) {
      const next = byId.get(item.id);
      if (next) Object.assign(item, { x: next.x, y: next.y });
    }
    commitItemLayout(items, action);
  } catch (error) {
    console.error(error);
    showToast('自动布局失败，请重试');
  } finally {
    actionButton?.classList.remove('is-beam-active');
    setEffectBusy(actionButton, false);
  }
}

function updateArrangeBar() {
  if (!els.arrangeBar) return;
  const count = getSelectedIds().filter((id) => canMutateItem(state.items.get(id))).length;
  els.arrangeBar.hidden = count < 2;
  if (els.arrangeCount) els.arrangeCount.textContent = `${count} 个对象`;
}
export {
  groupSelection,
  ungroupSelection,
  setContainerFlags,
  renameOrganizationEntry,
  deleteOrganizationEntry,
  commitItemLayout,
  arrangeSelection,
  runAutoLayout,
  updateArrangeBar
};

export { configureGroups };
