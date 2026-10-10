import { cloneHistoryValue } from './history-controller-model.js';

import { applyBackground } from './background.js';
import { getBackgroundPreset } from './background-model.js';
import { restorePendingCut } from './clipboard.js';
import { cancelActiveGesture } from './gestures.js';
import { showToast } from './interface-model.js';
import { isItemVisible, normalizeClientLayers } from './layer-visibility.js';
import { reconcileLayerInteractionState, renderLayerMenu } from './layers.js';
import { normalizeClientGroup, normalizeClientSection } from './layers-model.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';
import { refreshOrganizationUi } from './navigator-controller.js';

import { canvasInteraction } from './pan.js';
import { getVisibleWorldRect, removeItemElement, renderAll, renderItem } from './rendering.js';
import { intersectsRect } from './rendering-model.js';
import { applyContainerDeletionLocally } from './sections.js';
import { selectItem, updateSelectionUI } from './selection.js';
import { getSheetRecord, hasPendingSheetSave } from './sheet-store.js';
import { indexRemoveItem, indexUpsertItem, refreshAdaptiveCanvasModes } from './spatial-index.js';
import { state } from './state.js';
import { buildBackgroundMenu } from './toolbar-model.js';
import { refreshConnectorsFor } from './transform.js';
import { cssEscape } from './utilities.js';
import { rememberXmindContent } from './xmind-connection-model.js';

function rebaseInteractionItem(remoteItem) {
  const interaction = state.interaction;
  const snapshot = interaction?.beforeById?.get(remoteItem?.id);
  const current = remoteItem?.id ? state.items.get(remoteItem.id) : null;
  if (!interaction || !snapshot || !current) return remoteItem;
  if (remoteItem.hidden || remoteItem.locked) {
    cancelActiveGesture();
    showToast('对象已被其他协作者锁定或隐藏');
    return remoteItem;
  }
  const result = canvasInteraction?.rebaseOwnedFields
    ? canvasInteraction.rebaseOwnedFields({
        remote: remoteItem,
        current,
        base: snapshot.values,
        fields: snapshot.fields
      })
    : { conflict: false, item: { ...remoteItem }, base: snapshot.values };
  if (result.conflict) {
    cancelActiveGesture();
    showToast('对象已被其他协作者修改，本次操作已取消');
    return remoteItem;
  }
  const rebased = result.item;
  snapshot.values = result.base;
  if (interaction.startItem?.id === remoteItem.id) {
    for (const field of snapshot.fields) interaction.startItem[field] = cloneHistoryValue(remoteItem[field]);
  }
  if (interaction.startPositions?.has(remoteItem.id)) {
    interaction.startPositions.set(remoteItem.id, { x: remoteItem.x, y: remoteItem.y });
  }
  return rebased;
}

function rebaseRemoteOperationForActiveGesture(op) {
  if ((!state.interaction && !state.sectionInteraction) || !op || typeof op !== 'object') return;
  if (op.kind === 'batch' && Array.isArray(op.ops)) {
    for (const subOp of op.ops) rebaseRemoteOperationForActiveGesture(subOp);
    return;
  }
  const activeIds = new Set([
    ...(state.interaction?.beforeById?.keys() || []),
    ...(state.sectionInteraction?.childIds || [])
  ]);
  const cancelForAccessChange = () => {
    cancelActiveGesture();
    showToast('对象权限或可见状态已由其他协作者更改');
  };
  if (op.kind === 'set-flags' && (op.flags?.locked || op.flags?.hidden)) {
    const affectsItem = op.targetType === 'item' && op.ids?.some((id) => activeIds.has(id));
    const affectsSection = op.targetType === 'section' && op.ids?.includes(state.sectionInteraction?.sectionId);
    if (affectsItem || affectsSection) {
      cancelForAccessChange();
      return;
    }
  }
  if (op.kind === 'section-upsert') {
    const affectsSection =
      op.section?.id === state.sectionInteraction?.sectionId && (op.section.locked || op.section.hidden);
    const affectsChild =
      op.section?.lockChildren && Array.from(activeIds).some((id) => state.items.get(id)?.sectionId === op.section.id);
    if (affectsSection || affectsChild) {
      cancelForAccessChange();
      return;
    }
  }
  if (
    op.kind === 'group-upsert' &&
    op.group?.locked &&
    Array.from(activeIds).some((id) => state.items.get(id)?.groupId === op.group.id)
  ) {
    cancelForAccessChange();
    return;
  }
  if (op.kind === 'delete' && op.ids?.some((id) => activeIds.has(id))) {
    cancelActiveGesture();
    showToast('正在操作的对象已被其他协作者删除');
    return;
  }
  if (op.kind === 'delete-container' && op.targetType === 'section' && op.id === state.sectionInteraction?.sectionId) {
    cancelActiveGesture();
    showToast('正在操作的画框已被其他协作者删除');
    return;
  }
  if (op.kind === 'section-upsert' && op.section?.id === state.sectionInteraction?.sectionId) {
    const interaction = state.sectionInteraction;
    const current = state.sections.get(op.section.id);
    const fields = interaction.mode === 'move' ? ['x', 'y'] : ['x', 'y', 'w', 'h'];
    const rebased = { ...op.section };
    for (const field of fields) {
      const base = interaction.startSection[field];
      if ([base, current?.[field], op.section[field]].every(Number.isFinite)) {
        rebased[field] = op.section[field] + (current[field] - base);
        interaction.startSection[field] = op.section[field];
        interaction.beforeSection[field] = op.section[field];
      }
    }
    op.section = rebased;
    return;
  }
  const rebaseSectionChild = (remoteItem) => {
    const interaction = state.sectionInteraction;
    const start = interaction?.startPositions.get(remoteItem?.id);
    const current = remoteItem?.id ? state.items.get(remoteItem.id) : null;
    if (!start || !current) return remoteItem;
    const rebased = { ...remoteItem, x: remoteItem.x + (current.x - start.x), y: remoteItem.y + (current.y - start.y) };
    interaction.startPositions.set(remoteItem.id, { x: remoteItem.x, y: remoteItem.y });
    return rebased;
  };
  if (op.kind === 'upsert' && activeIds.has(op.item?.id)) {
    op.item = state.interaction?.beforeById?.has(op.item.id)
      ? rebaseInteractionItem(op.item)
      : rebaseSectionChild(op.item);
  } else if ((op.kind === 'transform' || op.kind === 'layout') && Array.isArray(op.items)) {
    op.items = op.items.map((change) => {
      if (!activeIds.has(change.id)) return change;
      const current = state.items.get(change.id);
      const remoteItem = { ...current, ...change };
      return state.interaction?.beforeById?.has(change.id)
        ? rebaseInteractionItem(remoteItem)
        : rebaseSectionChild(remoteItem);
    });
  }
}

function applyRemoteOperation(op, options = {}) {
  if (!op || typeof op !== 'object') {
    return;
  }
  if (op.kind === 'batch' && Array.isArray(op.ops)) {
    for (const subOp of op.ops) {
      applyRemoteOperation(subOp, options);
    }
    return;
  }
  const cutIds = state.pendingCut?.boardId === state.boardId ? state.pendingCut.ids : null;
  if (
    cutIds &&
    (op.kind === 'clear' ||
      (op.kind === 'upsert' && cutIds.has(op.item?.id)) ||
      (op.kind === 'sheet-command' && cutIds.has(op.itemId)) ||
      (op.kind === 'delete' && op.ids?.some((id) => cutIds.has(id))) ||
      (op.kind === 'note-delete-content' && op.itemIds?.some((id) => cutIds.has(id))) ||
      (op.kind === 'reparent' && op.itemIds?.some((id) => cutIds.has(id))) ||
      (op.kind === 'set-flags' && op.targetType === 'item' && op.ids?.some((id) => cutIds.has(id))) ||
      ((op.kind === 'transform' || op.kind === 'layout') && op.items?.some((item) => cutIds.has(item.id))))
  ) {
    restorePendingCut();
    showToast('元素已发生同步变更，剪切内容已自动还原');
  }
  if (options.rebaseGesture !== false) rebaseRemoteOperationForActiveGesture(op);

  if (op.kind === 'sheet-command' && op.itemId && op.command) {
    const item = state.items.get(op.itemId);
    if (!item || item.type !== 'sheet' || !window.SheetProtocol) return;
    if (op.command.type === 'replace-workbook' && op.command.workbook) {
      const keepNewerLocalWorkbook = options.acknowledged && hasPendingSheetSave(op.itemId);
      if (!keepNewerLocalWorkbook) item.workbook = structuredClone(op.command.workbook);
      item.sheetEditedAt = Math.max(Number(item.sheetEditedAt) || 0, Number(op.command.editedAt) || 0);
      if (Number.isInteger(op.contentVersion)) item.contentVersion = op.contentVersion;
      else
        item.contentVersion = Math.max(
          Number(item.contentVersion) || 0,
          Number(op.command.expectedContentVersion) + 1 || 0
        );
      const record = getSheetRecord(item);
      if (record && Number.isInteger(op.contentVersion)) {
        record.serverStructureVersion = Math.max(0, Number(op.command.workbook.structureVersion) || 0);
      }
      record?.previewController?.requestDraw?.();
      return;
    }
    const record = getSheetRecord(item);
    const sheetIndex =
      record?.store?.workbook?.sheets?.findIndex((sheet) => sheet.sheetId === op.command.sheetId) ?? -1;
    const changes = op.command.type === 'set-cell' ? [op.command] : op.command.cells;
    if (record && sheetIndex >= 0 && Array.isArray(changes)) {
      const cells = [];
      for (const change of changes) {
        const currentVersion = record.store.getCellVersion(sheetIndex, change.row, change.column);
        const desiredVersion = Number.isInteger(change.version)
          ? change.version
          : Number.isInteger(change.localVersion)
            ? change.localVersion
            : change.expectedCellVersion + 1;
        if (currentVersion >= desiredVersion) continue;
        cells.push({
          row: change.row,
          column: change.column,
          expectedVersion: currentVersion,
          version: desiredVersion,
          cell: change.cell
        });
      }
      if (cells.length) record.store.applyRemotePatch({ sheetId: op.command.sheetId, cells });
      item.sheetEditedAt = Math.max(Number(item.sheetEditedAt) || 0, Number(op.command.editedAt) || 0);
      if (Number.isInteger(op.contentVersion)) item.contentVersion = op.contentVersion;
      record.previewController?.requestDraw?.();
    }
    return;
  }
  if (op.kind === 'upsert' && op.item && op.item.id) {
    if (op.connectorPatch && state.items.get(op.item.id)?.type === 'connector') {
      const merged = structuredClone(state.items.get(op.item.id));
      for (const [field, value] of Object.entries(op.connectorPatch.fields || {})) {
        merged[field] = structuredClone(value);
        merged.fieldVersions[field] = (op.connectorPatch.expected?.[field] || 0) + 1;
      }
      op = { ...op, item: window.ConnectorCore.apply(merged) };
    }
    op.item.locked = Boolean(op.item.locked);
    op.item.hidden = Boolean(op.item.hidden);
    state.items.set(op.item.id, op.item);
    const acceptedItem = state.items.get(op.item.id);
    if (
      acceptedItem?.source?.provider === 'xmind' &&
      (acceptedItem.source.syncState === 'synced' || !state.xmindSyncFingerprints.has(acceptedItem.id))
    ) {
      rememberXmindContent(acceptedItem);
    }
    window.ConnectorUI?.accepted(acceptedItem);
    indexUpsertItem(acceptedItem);
    state.zCounter = Math.max(state.zCounter, Number(op.item.z || 1) + 1);
    if (state.editingId !== op.item.id) {
      const mounted = document.querySelector(`.board-item[data-item-id="${cssEscape(op.item.id)}"]`);
      if (!state.viewportVirtualizationEnabled || mounted || intersectsRect(op.item, getVisibleWorldRect())) {
        if (isItemVisible(acceptedItem)) renderItem(acceptedItem);
      }
    }
    refreshConnectorsFor([op.item.id]);
    refreshOrganizationUi();
  } else if (op.kind === 'section-upsert' && op.section?.id) {
    const canonical = normalizeClientSection(op.section, state.sections.size);
    
    state.sections.set(op.section.id, canonical);
    reconcileLayerInteractionState();
    renderAll();
  } else if (op.kind === 'group-upsert' && op.group?.id) {
    state.groups.set(op.group.id, normalizeClientGroup(op.group, state.groups.size));
    reconcileLayerInteractionState();
    refreshOrganizationUi();
  } else if (op.kind === 'reparent' && Array.isArray(op.itemIds)) {
    for (const id of op.itemIds) {
      const item = state.items.get(id);
      if (item) Object.assign(item, { sectionId: op.sectionId || null, groupId: op.groupId || null });
    }
    reconcileLayerInteractionState();
    renderAll();
  } else if ((op.kind === 'transform' || op.kind === 'layout') && Array.isArray(op.items)) {
    for (const change of op.items) {
      const item = state.items.get(change.id);
      if (!item) continue;
      Object.assign(item, change);
    }
    renderAll();
  } else if (op.kind === 'set-flags' && Array.isArray(op.ids) && op.flags) {
    const collection =
      op.targetType === 'section' ? state.sections : op.targetType === 'group' ? state.groups : state.items;
    for (const id of op.ids) {
      const entry = collection.get(id);
      if (entry) Object.assign(entry, op.flags);
    }
    reconcileLayerInteractionState();
    renderAll();
  } else if (op.kind === 'delete-container' && op.id) {
    applyContainerDeletionLocally(op.targetType, op.id, Boolean(op.cascade));
    renderAll();
  } else if (op.kind === 'layers' && Array.isArray(op.layers)) {
    state.layers = normalizeClientLayers(op.layers);
    if (!state.layers.some((layer) => layer.id === state.activeLayerId)) {
      state.activeLayerId = state.layers[0].id;
    }
    const fallbackLayerId = state.layers[0].id;
    for (const item of state.items.values()) {
      if (!state.layers.some((layer) => layer.id === (item.layerId || 'layer_default'))) {
        item.layerId = fallbackLayerId;
      }
    }
    reconcileLayerInteractionState();
    renderAll();
    renderLayerMenu();
  } else if (op.kind === 'settings' && op.settings) {
    let backgroundChanged = false;
    if (typeof op.settings.connectorLineJumps === 'boolean') {
      state.connectorLineJumps = op.settings.connectorLineJumps;
      window.ConnectorUI?.schedule();
    }
    if (typeof op.settings.backgroundDrift === 'boolean') {
      state.backgroundDrift = op.settings.backgroundDrift;
      backgroundChanged = true;
    }
    if (op.settings.background) {
      state.background = getBackgroundPreset(op.settings.background).type;
      backgroundChanged = true;
    }
    if (backgroundChanged) {
      applyBackground();
      buildBackgroundMenu();
    }
  } else if (op.kind === 'delete' && Array.isArray(op.ids)) {
    let selectionChanged = false;
    for (const id of op.ids) {
      state.items.delete(id);
      state.xmindSyncFingerprints.delete(id);
      state.xmindRemoteAlerts.delete(id);
      
      indexRemoveItem(id);
      removeItemElement(id);
      if (state.selectedIds.delete(id)) {
        selectionChanged = true;
      }
      if (state.mindmapSelection && state.mindmapSelection.itemId === id) {
        clearMindNodeSelection();
      }
      if (state.editingId === id) {
        state.editingId = null;
        state.editSnapshot = null;
        state.draftEditableId = null;
        document.querySelectorAll('.board-item.editing').forEach((node) => node.classList.remove('editing'));
      }
    }
    if (selectionChanged) {
      if (!state.selectedIds.size) {
        state.selectedId = null;
      } else if (!state.selectedIds.has(state.selectedId)) {
        state.selectedId = Array.from(state.selectedIds)[0];
      }
      updateSelectionUI();
    }
    refreshConnectorsFor(op.ids);

  } else if (op.kind === 'clear') {
    clearMindNodeSelection();
    state.selectedIds.clear();
    state.selectedId = null;
    if (state.editingId) {
      state.editingId = null;
      state.editSnapshot = null;
      state.draftEditableId = null;
    }
    state.items.clear();
    state.spatialIndex.clear();
    refreshAdaptiveCanvasModes();
    state.sections.clear();
    state.groups.clear();

    renderAll();
    selectItem(null);
  }
}

export { applyRemoteOperation, rebaseInteractionItem, rebaseRemoteOperationForActiveGesture };

