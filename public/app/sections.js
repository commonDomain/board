import { isPhoneViewer } from './phone-view-model.js';


import { currentCanvas } from './catalog-model.js';

import { els } from './elements.js';

import { formatExportTimestamp, safeExportFilename } from './export-model.js';
import { beginExportProgress } from './export-progress.js';
import { getRectBounds } from './geometry-model.js';

import { getGroupDescendantIds } from './groups-model.js';
import { refreshIcons, showToast } from './interface-model.js';

import { canMutateItem, normalizeClientSection } from './layers-model.js';
import { SECTION_BACKDROPS, SECTION_FRAME_STYLES } from './constants.js';

import { transformRuntime } from './runtime/transform.js';

import { getBoundsOfItems, getSelectedIds } from './selection-model.js';

import { state } from './state.js';
import { waitForGestureEditLease } from './element-edit-leases.js';
import { editOperationTargets } from './edit-lock-targets-model.js';
import { renderSectionEditLock } from './element-lock-ui.js';
import { canStartItemGesture, trackPointer } from './pan-model.js';

import { captureFields } from './transform-model.js';
import { translatedConnectorGeometry } from './connector/translation-model.js';

import { cssEscape, makeId } from './utilities.js';

let pushUndoPatch,
  pushUndoSnapshot,
  getBoardPoint,
  isTemporaryPanGestureEvent,
  buildExportPngBlob,
  downloadBlob,
  deleteOrganizationEntry,
  renameOrganizationEntry,
  setContainerFlags,
  setSectionFrameStyle,
  detachConnectorsFor,
  restoreIdleCursorState,
  setActiveCursorState,
  refreshOrganizationUi,
  captureViewportPointer,
  stopEdgePan,
  clearGuides,
  renderGuides,
  renderAll,
  markDirty,
  buildContextMenu,
  indexRemoveItem,
  enqueueOperation,
  restoreNavigationTool,
  refreshConnectorsFor,
  snapSectionMoveDelta,
  updateItemElementGeometry;

function configureSections(callbacks) {
  ({
    pushUndoPatch,
    pushUndoSnapshot,
    getBoardPoint,
    isTemporaryPanGestureEvent,
    buildExportPngBlob,
    downloadBlob,
    deleteOrganizationEntry,
    renameOrganizationEntry,
    setContainerFlags,
    setSectionFrameStyle,
    detachConnectorsFor,
    restoreIdleCursorState,
    setActiveCursorState,
    refreshOrganizationUi,
    captureViewportPointer,
    stopEdgePan,
    clearGuides,
    renderGuides,
    renderAll,
    markDirty,
    buildContextMenu,
    indexRemoveItem,
    enqueueOperation,
    restoreNavigationTool,
    refreshConnectorsFor,
    snapSectionMoveDelta,
    updateItemElementGeometry
  } = callbacks);
}

function renderSections() {
  transformRuntime.sectionSnapCache = null;
  if (!els.sectionLayer) return;
  els.sectionLayer.textContent = '';
  const sections = Array.from(state.sections.values())
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const section of sections) {
    try {
      renderSectionFrame(section);
    } catch (error) {
      console.warn('[render] Failed to render section', section.id, error);
    }
  }
  refreshIcons(els.sectionLayer);
}

function renderSectionFrame(section) {
  const frame = document.createElement('div');
  frame.className = `section-frame${section.collapsed ? ' is-collapsed' : ''}${section.hidden ? ' is-hidden' : ''}`;
  frame.dataset.sectionId = section.id;
  if (section.style.frame) frame.dataset.frameStyle = section.style.frame;
  window.ConnectorImpact?.decorateSection(frame, section);
  frame.style.left = `${section.x}px`;
  frame.style.top = `${section.y}px`;
  frame.style.width = `${section.w}px`;
  frame.style.height = `${section.collapsed ? 44 : section.h}px`;
  frame.style.setProperty('--section-fill', section.style.fill);
  frame.style.setProperty('--section-stroke', section.style.stroke);
  frame.style.setProperty('--section-title', section.style.titleColor);
  if (section.style.frame) frame.style.setProperty('--frame-scale', sectionFrameScale(section));
  if (section.style.backdrop) {
    // A separate first child, so the backdrop sits over the frame's fill and under its controls,
    // and the frame's ::before/::after stay free for highlight effects.
    frame.dataset.frameBackdrop = section.style.backdrop;
    const surface = document.createElement('div');
    surface.className = 'section-surface';
    frame.appendChild(surface);
  }

  if (!section.locked) {
    const topDragHandle = document.createElement('div');
    topDragHandle.className = 'section-top-drag-handle';
    topDragHandle.title = `拖动画框：${section.name}`;
    topDragHandle.addEventListener('pointerdown', (event) => startSectionInteraction(event, section.id, 'move'));
    frame.appendChild(topDragHandle);
  }

  const titlebar = document.createElement('div');
  titlebar.className = 'section-titlebar';
  titlebar.title = section.locked ? `${section.name}（已锁定）` : `拖动画框：${section.name}`;
  const name = document.createElement('span');
  name.textContent = section.name;
  name.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    renameOrganizationEntry('section', section.id);
  });
  titlebar.appendChild(name);
  const addButton = (icon, title, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    const iconNode = document.createElement('i');
    iconNode.dataset.lucide = icon;
    iconNode.setAttribute('aria-hidden', 'true');
    button.appendChild(iconNode);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action(event);
    });
    titlebar.appendChild(button);
  };
  addButton(
    section.collapsed ? 'chevrons-up-down' : 'chevrons-down-up',
    section.collapsed ? '展开画框' : '折叠画框',
    () => setContainerFlags('section', [section.id], { collapsed: !section.collapsed })
  );
  addButton(section.lockChildren ? 'shield-check' : 'shield', section.lockChildren ? '解锁内容' : '锁定内容', () =>
    setContainerFlags('section', [section.id], { lockChildren: !section.lockChildren })
  );
  addButton('palette', '画框样式', (event) => openSectionFrameStyleMenu(section.id, event.currentTarget));
  addButton('download', '导出此画框', () => exportSectionPng(section.id));
  addButton('trash-2', '删除画框（保留内容）', () => deleteOrganizationEntry('section', section.id, false));
  titlebar.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    buildContextMenu(
      [
        { label: '重命名画框', action: () => renameOrganizationEntry('section', section.id) },
        { label: '导出此画框', action: () => exportSectionPng(section.id) },
        { type: 'separator' },
        { label: '删除画框（保留内容）', action: () => deleteOrganizationEntry('section', section.id, false) },
        { label: '删除画框及其中内容', action: () => deleteOrganizationEntry('section', section.id, true) }
      ],
      event.clientX,
      event.clientY
    );
  });
  titlebar.addEventListener('pointerdown', (event) => startSectionInteraction(event, section.id, 'move'));
  frame.appendChild(titlebar);

  if (!section.collapsed && !section.locked) {
    const resize = document.createElement('div');
    resize.className = 'section-resize-handle';
    resize.title = '调整画框大小';
    resize.addEventListener('pointerdown', (event) => startSectionInteraction(event, section.id, 'resize'));
    frame.appendChild(resize);
  }
  els.sectionLayer.appendChild(frame);
  renderSectionEditLock(frame);
}

// Mouldings are sized for a section about 400px on its short side; smaller ones get a slimmer frame.
function sectionFrameScale(section) {
  return Math.min(1, Math.max(0.5, Math.min(section.w, section.h) / 400)).toFixed(3);
}

function openSectionFrameStyleMenu(sectionId, anchor) {
  const section = state.sections.get(sectionId);
  if (!section) return;
  const rect = anchor.getBoundingClientRect();
  const options = (field, list) => {
    const current = section.style[field] || 'default';
    return list.map((option) => ({
      label: option.label,
      icon: option.id === current ? 'check' : null,
      disabled: section.locked,
      reason: '画框已锁定',
      hideReason: true,
      action: () => setSectionFrameStyle(sectionId, option.id, field)
    }));
  };
  buildContextMenu(
    [
      ...(section.locked ? [{ type: 'heading', label: '画框已锁定', detail: '解锁后可切换样式和背景' }] : []),
      {
        type: 'columns',
        width: 340,
        columns: [
          { label: '画框样式', items: options('frame', SECTION_FRAME_STYLES) },
          { label: '画框背景', items: options('backdrop', SECTION_BACKDROPS) }
        ]
      }
    ],
    rect.left,
    rect.bottom + 6
  );
}

function startSectionDraft(event) {
  if (isPhoneViewer()) return;
  event.preventDefault();
  const start = getBoardPoint(event);
  const preview = document.createElement('div');
  preview.className = 'section-frame section-draft';
  preview.style.left = `${start.x}px`;
  preview.style.top = `${start.y}px`;
  preview.style.width = '1px';
  preview.style.height = '1px';
  els.sectionLayer.appendChild(preview);
  state.sectionDraft = { start, current: start, preview, pointerId: event.pointerId, pointerType: event.pointerType || 'mouse' };
  captureViewportPointer(event.pointerId);
}

function continueSectionDraft(event) {
  const draft = state.sectionDraft;
  draft.current = getBoardPoint(event);
  const bounds = getRectBounds(draft.start, draft.current);
  draft.preview.style.left = `${bounds.x}px`;
  draft.preview.style.top = `${bounds.y}px`;
  draft.preview.style.width = `${bounds.w}px`;
  draft.preview.style.height = `${bounds.h}px`;
}

function finishSectionDraft(event) {
  const draft = state.sectionDraft;
  if (!draft) return;
  continueSectionDraft(event);
  state.sectionDraft = null;
  draft.preview.remove();
  const bounds = getRectBounds(draft.start, draft.current);
  if (bounds.w < 40 || bounds.h < 40) {
    bounds.x = draft.start.x - 480;
    bounds.y = draft.start.y - 270;
    bounds.w = 960;
    bounds.h = 540;
  }
  createSection(bounds, []);
  restoreNavigationTool();
}

function createSection(bounds, itemIds = []) {
  const section = normalizeClientSection(
    {
      id: makeId('section'),
      name: `画框 ${state.sections.size + 1}`,
      ...bounds,
      order: state.sections.size,
      style: { fill: '#ffffff', stroke: '#94a3b8', titleColor: '#334155' }
    },
    state.sections.size
  );
  pushUndoSnapshot();
  state.sections.set(section.id, section);
  const ids = itemIds.filter((id) => state.items.has(id));
  for (const id of ids) {
    const item = state.items.get(id);
    item.sectionId = section.id;
    item.groupId = null;
  }
  const ops = [{ kind: 'section-upsert', section }];
  if (ids.length) ops.push({ kind: 'reparent', itemIds: ids, sectionId: section.id, groupId: null });
  enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
  markDirty(true);
  renderAll();
  state.navigatorExpanded.add(`section:${section.id}`);
  refreshOrganizationUi();
  return section;
}

function createSectionAroundSelection() {
  const ids = getSelectedIds().filter((id) => canMutateItem(state.items.get(id)));
  const bounds = getBoundsOfItems(ids);
  if (!bounds) {
    showToast('请先选择要放入画框的内容');
    return null;
  }
  return createSection({ x: bounds.x - 60, y: bounds.y - 70, w: bounds.w + 120, h: bounds.h + 130 }, ids);
}

function startSectionInteraction(event, sectionId, mode) {
  if (isPhoneViewer()) return;
  if (!canStartItemGesture(event)) return;
  if (isTemporaryPanGestureEvent(event)) return;
  const section = state.sections.get(sectionId);
  if (!section || section.locked || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  trackPointer(event);
  const childIds = Array.from(state.items.values())
    .filter((item) => item.sectionId === sectionId)
    .map((item) => item.id);
  state.sectionInteraction = {
    sectionId,
    mode,
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    startPoint: getBoardPoint(event),
    startSection: { ...section, style: { ...section.style } },
    startPositions: new Map(childIds.map((id) => {
      const item = state.items.get(id);
      if (item.type === 'connector') window.ConnectorCore?.apply(item);
      return [id, captureFields(item, item.type === 'connector' ? ['x', 'y', 'source', 'target', 'route'] : ['x', 'y'])];
    })),
    childIds,
    beforeSection: captureFields(section, mode === 'move' ? ['x', 'y'] : ['x', 'y', 'w', 'h']),
    changed: false,
    snapState: { v: null, h: null }
  };
  state.gestureSession = {
    kind: mode === 'move' ? 'section-move' : 'resize',
    pointerId: event.pointerId,
    targetIds: childIds,
    sectionId
  };
  setActiveCursorState(mode === 'move' ? 'grabbing' : 'nwse-resize');
  if (mode === 'move') els.viewport.classList.add('moving-section');
  else els.sectionLayer.querySelector(`[data-section-id="${cssEscape(sectionId)}"]`)?.classList.add('is-resizing');
  captureViewportPointer(event.pointerId);
  const interaction = state.sectionInteraction;
  const targets = [...editOperationTargets({ kind: 'section-upsert', section }, state)];
  state.gestureSession.targetIds = targets;
  waitForGestureEditLease(interaction, targets, () => state.sectionInteraction === interaction, () => {
    const current = state.sections.get(sectionId);
    if (!current) return;
    interaction.startSection = structuredClone(current);
    interaction.beforeSection = captureFields(current, mode === 'move' ? ['x', 'y'] : ['x', 'y', 'w', 'h']);
    interaction.startPositions = new Map(childIds.filter(id => state.items.has(id)).map(id => {
      const child = state.items.get(id);
      return [id, captureFields(child, child.type === 'connector' ? ['x', 'y', 'source', 'target', 'route'] : ['x', 'y'])];
    }));
    if (interaction.latestEvent) continueSectionInteraction(interaction.latestEvent);
  });
}

function continueSectionInteraction(event) {
  const interaction = state.sectionInteraction;
  if (interaction.leasePending) { interaction.latestEvent = event; return; }
  if (interaction.editSession && !interaction.editSession.current()) return;
  const section = state.sections.get(interaction.sectionId);
  if (!section) return;
  event.preventDefault();
  const point = getBoardPoint(event);
  const dx = point.x - interaction.startPoint.x;
  const dy = point.y - interaction.startPoint.y;
  if (!interaction.changed && dx === 0 && dy === 0) return;
  if (interaction.mode === 'resize') {
    section.w = Math.max(80, interaction.startSection.w + dx);
    section.h = Math.max(60, interaction.startSection.h + dy);
  } else {
    const snapped = event.altKey
      ? { dx, dy, v: null, h: null, snapState: { v: null, h: null } }
      : snapSectionMoveDelta(interaction.startSection, dx, dy, interaction.snapState);
    interaction.snapState = snapped.snapState;
    state.guides = { v: snapped.v, h: snapped.h };
    renderGuides();
    section.x = interaction.startSection.x + snapped.dx;
    section.y = interaction.startSection.y + snapped.dy;
    for (const id of interaction.childIds) {
      const item = state.items.get(id);
      const start = interaction.startPositions.get(id);
      if (!item || !start) continue;
      item.x = start.x + snapped.dx;
      item.y = start.y + snapped.dy;
      if (item.type === 'connector') {
        const geometry = translatedConnectorGeometry(start, snapped.dx, snapped.dy, binding =>
            (binding.kind === 'item' && interaction.startPositions.has(binding.id)) ||
            (binding.kind === 'section' && binding.id === section.id));
        Object.assign(item, geometry);
        window.ConnectorCore?.apply(item);
      }
      updateItemElementGeometry(item);
    }
  }
  interaction.changed = true;
  transformRuntime.sectionSnapCache = null;
  const frame = els.sectionLayer.querySelector(`[data-section-id="${cssEscape(section.id)}"]`);
  if (frame) {
    frame.style.left = `${section.x}px`;
    frame.style.top = `${section.y}px`;
    frame.style.width = `${section.w}px`;
    frame.style.height = `${section.h}px`;
    if (section.style.frame) frame.style.setProperty('--frame-scale', sectionFrameScale(section));
  }
  refreshConnectorsFor(interaction.childIds);
}

function finishSectionInteraction() {
  const interaction = state.sectionInteraction;
  stopEdgePan();
  clearGuides();
  state.sectionInteraction = null;
  state.gestureSession = null;
  restoreIdleCursorState();
  els.viewport.classList.remove('moving-section');
  els.sectionLayer.querySelector('.section-frame.is-resizing')?.classList.remove('is-resizing');
  if (!interaction?.changed) { interaction?.editSession?.release(); return; }
  const section = state.sections.get(interaction.sectionId);
  const sectionFields = interaction.mode === 'move' ? ['x', 'y'] : ['x', 'y', 'w', 'h'];
  const changes = [
    {
      targetType: 'section',
      id: section.id,
      fields: sectionFields,
      before: interaction.beforeSection,
      after: captureFields(section, sectionFields)
    }
  ];
  if (interaction.mode === 'move') {
    for (const id of interaction.childIds) {
      const item = state.items.get(id);
      const before = interaction.startPositions.get(id);
      if (item && before)
        changes.push({
          targetType: 'item',
          id,
          fields: Object.keys(before),
          before,
          after: captureFields(item, Object.keys(before))
        });
    }
  }
  pushUndoPatch(changes);
  const ops = [{ kind: 'section-upsert', section }];
  if (interaction.mode === 'move' && interaction.childIds.length) {
    const transformed = interaction.childIds.map(id => state.items.get(id))
      .filter(item => item && item.type !== 'connector')
      .map(item => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation || 0 }));
    if (transformed.length) ops.push({ kind: 'transform', items: transformed });
    for (const id of interaction.childIds) {
      const item = state.items.get(id);
      if (item?.type === 'connector') ops.push({ kind: 'upsert', item });
    }
  }
  enqueueOperation({ kind: 'batch', ops });
  markDirty(true);
  refreshOrganizationUi();
  interaction.editSession?.release();
}

function findSectionForItem(item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return (
    Array.from(state.sections.values())
      .filter(
        (section) =>
          !section.hidden &&
          !section.locked &&
          !section.lockChildren &&
          cx >= section.x &&
          cx <= section.x + section.w &&
          cy >= section.y &&
          cy <= section.y + section.h
      )
      .sort((left, right) => left.w * left.h - right.w * right.h || right.order - left.order)[0] || null
  );
}

function reconcileSectionMembership(ids, disableCapture = false) {
  const changed = [];
  changed.groupChanges = [];
  if (disableCapture) return changed;
  const moving = new Set(ids);
  const processed = new Set();
  for (const id of ids) {
    const item = state.items.get(id);
    if (!item || item.type === 'connector') continue;
    if (item.groupId) {
      let root = state.groups.get(item.groupId);
      const seen = new Set();
      while (root?.parentGroupId && !seen.has(root.id)) {
        seen.add(root.id);
        root = state.groups.get(root.parentGroupId) || root;
      }
      if (!root || processed.has(root.id)) continue;
      processed.add(root.id);
      const groupIds = new Set([root.id, ...getGroupDescendantIds(root.id)]);
      const members = Array.from(state.items.values()).filter((entry) => groupIds.has(entry.groupId));
      // A partial selection must never split a group or silently change its parent.
      if (!members.length || members.some((entry) => !moving.has(entry.id) || !canMutateItem(entry))) continue;
      const bounds = getBoundsOfItems(members.map((entry) => entry.id));
      const sectionId = findSectionForItem(bounds)?.id || null;
      for (const groupId of groupIds) {
        const group = state.groups.get(groupId);
        if (!group || (group.sectionId || null) === sectionId) continue;
        changed.groupChanges.push({
          targetType: 'group',
          id: groupId,
          fields: ['sectionId'],
          before: { sectionId: group.sectionId || null },
          after: { sectionId }
        });
        group.sectionId = sectionId;
      }
      for (const member of members)
        if ((member.sectionId || null) !== sectionId) {
          member.sectionId = sectionId;
          changed.push(member.id);
        }
      continue;
    }
    const sectionId = findSectionForItem(item)?.id || null;
    if (sectionId !== (item.sectionId || null)) {
      item.sectionId = sectionId;
      changed.push(id);
    }
  }
  return changed;
}

function applyContainerDeletionLocally(targetType, id, cascade) {
  if (targetType === 'section') {
    if (cascade) {
      const removedIds = Array.from(state.items.values())
        .filter((item) => item.sectionId === id)
        .map((item) => item.id);
      detachConnectorsFor(removedIds);
      for (const itemId of removedIds) {
        state.items.delete(itemId);
        indexRemoveItem(itemId);
      }
    } else {
      for (const item of state.items.values())
        if (item.sectionId === id) Object.assign(item, { sectionId: null, groupId: null });
    }
    for (const [groupId, group] of state.groups) if (group.sectionId === id) state.groups.delete(groupId);
    state.sections.delete(id);
  } else {
    const descendants = getGroupDescendantIds(id);
    const group = state.groups.get(id);
    if (cascade) {
      const removedIds = Array.from(state.items.values())
        .filter((item) => descendants.has(item.groupId))
        .map((item) => item.id);
      detachConnectorsFor(removedIds);
      for (const itemId of removedIds) {
        state.items.delete(itemId);
        indexRemoveItem(itemId);
      }
      for (const groupId of descendants) state.groups.delete(groupId);
    } else {
      for (const item of state.items.values()) if (item.groupId === id) item.groupId = group?.parentGroupId || null;
      for (const entry of state.groups.values())
        if (entry.parentGroupId === id) entry.parentGroupId = group?.parentGroupId || null;
      state.groups.delete(id);
    }
  }
}

async function exportSectionPng(sectionId) {
  const section = state.sections.get(sectionId);
  if (!section) return;
  const ids = new Set(
    Array.from(state.items.values())
      .filter((item) => item.sectionId === sectionId)
      .map((item) => item.id)
  );
  const finishProgress = beginExportProgress('正在导出画框…');
  try {
    const blob = await buildExportPngBlob({ x: section.x, y: section.y, w: section.w, h: section.h }, ids, sectionId);
    if (!blob) throw new Error('Section export failed');
    await downloadBlob(
      blob,
      `${safeExportFilename(currentCanvas()?.name || '未命名画布')}-${formatExportTimestamp(new Date())}.png`
    );
    showToast('画框已导出');
  } catch (error) {
    console.error(error);
    showToast('画框导出失败，请重试');
  } finally {
    finishProgress();
  }
}

export {
  applyContainerDeletionLocally,
  continueSectionDraft,
  continueSectionInteraction,
  createSection,
  createSectionAroundSelection,
  exportSectionPng,
  findSectionForItem,
  finishSectionDraft,
  finishSectionInteraction,
  reconcileSectionMembership,
  renderSectionFrame,
  renderSections,
  startSectionDraft,
  startSectionInteraction
};

export { configureSections };
