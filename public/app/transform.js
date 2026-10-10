import { cloneHistoryValue } from './history-controller-model.js';
import { pushUndoPatch } from './history-controller.js';

import {
  MIN_ITEM_SIZE,
  MIN_ZOOM,
  SNAP_ACQUIRE_DISTANCE_PX,
  SNAP_GRID_MIN_SPACING_PX,
  SNAP_RELEASE_DISTANCE_PX
} from './constants.js';
import { els } from './elements.js';
import { getGroupMemberItemIds } from './groups-model.js';
import { broadcastUpsert } from './items.js';
import { isTransformableItem } from './marquee-model.js';

import { getMindNodeAtPath } from './mindmap-editing-model.js';
import { fitMindMapItem, measureMindNodeWidth } from './mindmap-model.js';
import { canvasInteraction, captureViewportPointer, stopEdgePan } from './pan.js';

import { transformRuntime } from './runtime/transform.js';
import { markDirty } from './save-status.js';
import { reconcileSectionMembership } from './sections.js';

import { queryItemsInRect } from './spatial-index-model.js';
import { state } from './state.js';

import { cssEscape, normalizeAngle, radiansToDegrees } from './utilities.js';
import {
  interactionFieldsForMode,
  captureInteractionItems,
  interactionHistoryChanges,
  nearestSortedLine,
  resizeTableColumn,
  resizeItemFromHandle
} from './transform-model.js';

let getBoardPoint,
  restoreIdleCursorState,
  setActiveCursorState,
  clearGuides,
  renderGuides,
  renderItem,
  indexUpsertItem,
  enqueueOperation;

function configureTransform(callbacks) {
  ({
    getBoardPoint,
    restoreIdleCursorState,
    setActiveCursorState,
    clearGuides,
    renderGuides,
    renderItem,
    indexUpsertItem,
    enqueueOperation
  } = callbacks);
}

function restoreInteractionItems(interaction) {
  if (!interaction?.beforeById) return;
  const restoredIds = [];
  for (const [id, snapshot] of interaction.beforeById) {
    const item = state.items.get(id);
    if (!item) continue;
    Object.assign(item, cloneHistoryValue(snapshot.values));
    state.items.set(id, item);
    indexUpsertItem(item);
    renderItem(item);
    restoredIds.push(id);
  }
  refreshConnectorsFor(restoredIds);
}

function startTransform(event, itemElement, mode) {
  const item = state.items.get(itemElement.dataset.itemId);
  if (!isTransformableItem(item)) {
    return;
  }
  if (item.type === 'connector') {
    return;
  }
  if (item.type === 'ink' && mode !== 'move' && mode !== 'rotate') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const point = getBoardPoint(event);
  const center = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
  const groupedMoveIds = mode === 'move' && item.groupId ? getGroupMemberItemIds(item.groupId) : [];
  const moveIds =
    mode === 'move' && (state.selectedIds.size > 1 || groupedMoveIds.length > 1)
      ? (state.selectedIds.size > 1 ? Array.from(state.selectedIds) : groupedMoveIds).filter((id) => {
          const candidate = state.items.get(id);
          return candidate && candidate.type !== 'connector';
        })
      : null;
  const ownedIds = moveIds?.length ? moveIds : [item.id];
  state.interaction = {
    id: item.id,
    mode,
    moveIds,
    startPositions: moveIds
      ? new Map(moveIds.map((id) => [id, { x: state.items.get(id).x, y: state.items.get(id).y }]))
      : null,
    beforeById: captureInteractionItems(ownedIds, mode),
    ownedFields: interactionFieldsForMode(item, mode),
    startPoint: point,
    startItem: { ...item },
    changed: false,
    center,
    startAngle: Math.atan2(point.y - center.y, point.x - center.x),
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    snapState: { v: null, h: null }
  };
  state.gestureSession = {
    kind: mode === 'move' ? 'move' : mode === 'rotate' ? 'rotate' : 'resize',
    pointerId: event.pointerId,
    targetIds: ownedIds,
    latestEvent: null
  };
  const explicitMoveHandle = Boolean(event.target?.closest?.('.note-move-handle, .table-move-handle'));
  const cursor = canvasInteraction?.resolveCursorState({
    gesture: mode === 'move' ? (explicitMoveHandle ? 'move-handle' : 'move') : mode === 'rotate' ? 'rotate' : 'resize',
    handle: mode,
    rotation: (item.rotation || 0) + state.rotation
  });
  setActiveCursorState(cursor || (mode === 'move' ? 'move' : 'default'));
  if (mode === 'move') els.viewport.classList.add('moving-items');
  captureViewportPointer(event.pointerId);
}

function continueTransform(event) {
  const interaction = state.interaction;
  const item = state.items.get(interaction.id);
  if (!item) {
    return;
  }
  event.preventDefault();
  const point = getBoardPoint(event);
  const start = interaction.startItem;
  const dx = point.x - interaction.startPoint.x;
  const dy = point.y - interaction.startPoint.y;
  const next = { ...start };

  if (interaction.mode === 'mind-node-resize') {
    const mindNode = getMindNodeAtPath(item.tree, interaction.mindPath);
    if (!mindNode) return;
    const minimumWidth = measureMindNodeWidth(mindNode.text, interaction.mindPath.length === 0);
    if (interaction.mindHandle.includes('e')) {
      mindNode.w = Math.max(minimumWidth, Math.round(interaction.mindStartWidth + dx));
    }
    if (interaction.mindHandle.includes('s')) {
      mindNode.h = Math.max(38, Math.round(interaction.mindStartHeight + dy));
    }
    fitMindMapItem(item);
    state.items.set(item.id, item);
    renderItem(item);
    refreshConnectorsFor([item.id]);
    interaction.changed = true;
    return;
  }

  if (interaction.mode === 'table-column') {
    resizeTableColumn(next, interaction, dx);
  } else if (interaction.mode === 'move') {
    interaction.disableSectionCapture = Boolean(event.altKey);
    const moving = new Set(interaction.moveIds || [interaction.id]);
    const targetRect = {
      x: interaction.startItem.x + dx - 600,
      y: interaction.startItem.y + dy - 600,
      w: interaction.startItem.w + 1200,
      h: interaction.startItem.h + 1200
    };
    const others = queryItemsInRect(targetRect).filter((candidate) => !moving.has(candidate.id));
    const snapped = event.altKey
      ? { dx, dy, v: null, h: null, snapState: { v: null, h: null } }
      : snapMoveDelta(interaction.startItem, others, dx, dy, interaction.snapState);
    interaction.snapState = snapped.snapState;
    state.guides = { v: snapped.v, h: snapped.h };
    renderGuides();
    if (interaction.moveIds && interaction.moveIds.length > 1) {
      for (const id of interaction.moveIds) {
        const target = state.items.get(id);
        const startPosition = interaction.startPositions.get(id);
        if (!target || !startPosition) {
          continue;
        }
        target.x = startPosition.x + snapped.dx;
        target.y = startPosition.y + snapped.dy;
        state.items.set(id, target);
        updateItemElementGeometry(target);
      }
    } else {
      next.x = start.x + snapped.dx;
      next.y = start.y + snapped.dy;
    }
  } else if (interaction.mode === 'rotate') {
    const angle = Math.atan2(point.y - interaction.center.y, point.x - interaction.center.x);
    next.rotation = normalizeAngle(start.rotation + radiansToDegrees(angle - interaction.startAngle));
  } else {
    resizeItemFromHandle(next, interaction.mode, dx, dy, start);
  }

  if (interaction.mode !== 'move' || !interaction.moveIds || interaction.moveIds.length <= 1) {
    state.items.set(next.id, next);
    updateItemElementGeometry(next);
  }
  refreshConnectorsFor(interaction.moveIds?.length ? interaction.moveIds : [interaction.id]);
  interaction.changed = true;
}

function snapMoveDelta(item, others, dx, dy, previous = null) {
  const grid = 18;
  const targetX = item.x + dx;
  const targetY = item.y + dy;
  const xEdges = [targetX, targetX + item.w / 2, targetX + item.w];
  const yEdges = [targetY, targetY + item.h / 2, targetY + item.h];
  const vCandidates = [];
  const hCandidates = [];
  for (const other of others) {
    if (other.type === 'connector') {
      continue;
    }
    const otherX = [other.x, other.x + other.w / 2, other.x + other.w];
    const otherY = [other.y, other.y + other.h / 2, other.y + other.h];
    for (let index = 0; index < 3; index += 1) {
      vCandidates.push({
        key: `item:${other.id}:v:${index}`,
        line: otherX[index],
        sourceIndex: index,
        priority: 0,
        showGuide: true
      });
      hCandidates.push({
        key: `item:${other.id}:h:${index}`,
        line: otherY[index],
        sourceIndex: index,
        priority: 0,
        showGuide: true
      });
    }
  }
  const sectionLines = getSectionSnapLines();
  for (let index = 0; index < 3; index += 1) {
    const vertical = nearestSortedLine(sectionLines.v[index], xEdges[index]);
    const horizontal = nearestSortedLine(sectionLines.h[index], yEdges[index]);
    if (vertical !== null) {
      vCandidates.push({
        key: `section:v:${index}:${vertical}`,
        line: vertical,
        sourceIndex: index,
        priority: 1,
        showGuide: true
      });
    }
    if (horizontal !== null) {
      hCandidates.push({
        key: `section:h:${index}:${horizontal}`,
        line: horizontal,
        sourceIndex: index,
        priority: 1,
        showGuide: true
      });
    }
  }
  if (grid * state.zoom >= SNAP_GRID_MIN_SPACING_PX) {
    for (let index = 0; index < 3; index += 1) {
      const vertical = Math.round(xEdges[index] / grid) * grid;
      const horizontal = Math.round(yEdges[index] / grid) * grid;
      vCandidates.push({
        key: `grid:v:${index}:${vertical}`,
        line: vertical,
        sourceIndex: index,
        priority: 2,
        showGuide: false
      });
      hCandidates.push({
        key: `grid:h:${index}:${horizontal}`,
        line: horizontal,
        sourceIndex: index,
        priority: 2,
        showGuide: false
      });
    }
  }
  const acquire = SNAP_ACQUIRE_DISTANCE_PX / Math.max(state.zoom, MIN_ZOOM);
  const release = SNAP_RELEASE_DISTANCE_PX / Math.max(state.zoom, MIN_ZOOM);
  const bestV = canvasInteraction.resolveAxisSnap(xEdges, vCandidates, previous?.v, { acquire, release });
  const bestH = canvasInteraction.resolveAxisSnap(yEdges, hCandidates, previous?.h, { acquire, release });
  return {
    dx: dx + bestV.delta,
    dy: dy + bestH.delta,
    v: bestV.line,
    h: bestH.line,
    snapState: {
      v: bestV.snap?.showGuide === false ? null : bestV.snap,
      h: bestH.snap?.showGuide === false ? null : bestH.snap
    }
  };
}

function snapSectionMoveDelta(section, dx, dy, previous = null) {
  const targetX = section.x + dx;
  const targetY = section.y + dy;
  const xEdges = [targetX, targetX + section.w / 2, targetX + section.w];
  const yEdges = [targetY, targetY + section.h / 2, targetY + section.h];
  const vCandidates = [];
  const hCandidates = [];
  for (const other of state.sections.values()) {
    if (other.id === section.id || other.hidden) continue;
    const otherX = [other.x, other.x + other.w / 2, other.x + other.w];
    const otherY = [other.y, other.y + other.h / 2, other.y + other.h];
    for (let index = 0; index < 3; index += 1) {
      vCandidates.push({
        key: `section:${other.id}:v:${index}`,
        line: otherX[index],
        sourceIndex: index,
        priority: 0,
        showGuide: true
      });
      hCandidates.push({
        key: `section:${other.id}:h:${index}`,
        line: otherY[index],
        sourceIndex: index,
        priority: 0,
        showGuide: true
      });
    }
  }
  const acquire = SNAP_ACQUIRE_DISTANCE_PX / Math.max(state.zoom, MIN_ZOOM);
  const release = SNAP_RELEASE_DISTANCE_PX / Math.max(state.zoom, MIN_ZOOM);
  const bestV = canvasInteraction.resolveAxisSnap(xEdges, vCandidates, previous?.v, { acquire, release });
  const bestH = canvasInteraction.resolveAxisSnap(yEdges, hCandidates, previous?.h, { acquire, release });
  return {
    dx: dx + bestV.delta,
    dy: dy + bestH.delta,
    v: bestV.line,
    h: bestH.line,
    snapState: { v: bestV.snap, h: bestH.snap }
  };
}

function getSectionSnapLines() {
  if (transformRuntime.sectionSnapCache) return transformRuntime.sectionSnapCache;
  const v = [[], [], []];
  const h = [[], [], []];
  for (const section of state.sections.values()) {
    if (section.hidden) continue;
    v[0].push(section.x);
    v[1].push(section.x + section.w / 2);
    v[2].push(section.x + section.w);
    h[0].push(section.y);
    h[1].push(section.y + section.h / 2);
    h[2].push(section.y + section.h);
  }
  for (const lines of [...v, ...h]) lines.sort((a, b) => a - b);
  transformRuntime.sectionSnapCache = { v, h };
  return transformRuntime.sectionSnapCache;
}

function finishTransform() {
  const interaction = state.interaction;
  stopEdgePan();
  state.interaction = null;
  state.gestureSession = null;
  restoreIdleCursorState();
  els.viewport.classList.remove('moving-items');
  if (interaction && interaction.changed) {
    const movedIds = interaction.moveIds && interaction.moveIds.length > 1 ? interaction.moveIds : [interaction.id];
    const membership = reconcileSectionMembership(movedIds, interaction.disableSectionCapture);
    pushUndoPatch([...interactionHistoryChanges(interaction), ...membership.groupChanges]);
    if (interaction.moveIds && interaction.moveIds.length > 1) {
      const ops = membership.groupChanges.map((change) => ({
        kind: 'group-upsert',
        group: state.groups.get(change.id)
      }));
      for (const id of interaction.moveIds) {
        const item = state.items.get(id);
        if (!item) {
          continue;
        }
        renderItem(item);
        ops.push({ kind: 'upsert', item });
      }
      if (ops.length) {
        enqueueOperation(ops.length === 1 ? ops[0] : { kind: 'batch', ops });
      }
    } else {
      const item = state.items.get(interaction.id);
      if (item) {
        const ops = membership.groupChanges.map((change) => ({
          kind: 'group-upsert',
          group: state.groups.get(change.id)
        }));
        if (ops.length) enqueueOperation({ kind: 'batch', ops: [...ops, { kind: 'upsert', item }] });
        else broadcastUpsert(item);
        renderItem(item);
      }
    }
    refreshConnectorsFor(
      interaction.moveIds && interaction.moveIds.length > 1 ? interaction.moveIds : [interaction.id]
    );
    markDirty(true);
  }
  clearGuides();
}

function refreshConnectorsFor(ids) {
  if (window.ConnectorUI) return window.ConnectorUI.invalidate(ids);
  if (!ids || !ids.length) {
    return;
  }
  const connectorIds = new Set();
  for (const id of ids) {
    for (const connectorId of state.connectorIndex.get(id) || []) connectorIds.add(connectorId);
  }
  for (const connectorId of connectorIds) {
    const connector = state.items.get(connectorId);
    if (connector) renderItem(connector);
  }
}

function updateItemElementGeometry(item) {
  indexUpsertItem(item);
  const node = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  if (!node) {
    return;
  }
  node.style.left = `${item.x}px`;
  node.style.top = `${item.y}px`;
  node.style.width = `${Math.max(MIN_ITEM_SIZE, item.w || 120)}px`;
  node.style.height = `${Math.max(MIN_ITEM_SIZE, item.h || 80)}px`;
  node.style.setProperty('--rotation', `${item.rotation || 0}deg`);
  node.style.setProperty('--z', item.z || 1);
}
export {
  restoreInteractionItems,
  startTransform,
  continueTransform,
  snapMoveDelta,
  snapSectionMoveDelta,
  getSectionSnapLines,
  finishTransform,
  refreshConnectorsFor,
  updateItemElementGeometry
};

export { configureTransform };
