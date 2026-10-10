import { state } from './state.js';

import { normalizeClientGroup, normalizeClientSection } from './layers-model.js';
import { normalizeClientLayers } from './layer-visibility.js';

import { getBackgroundPreset } from './background-model.js';

import { renderSections } from './sections.js';

import { restorePendingCut } from './clipboard.js';

import { wallpaperDriftDefault } from './preferences.js';
import { clearMindNodeSelection } from './mindmap-editing-model.js';

import { buildBackgroundMenu } from './toolbar-model.js';

import { els } from './elements.js';
import {
  serializeItems,
  serializeDocument,
  isPatchHistoryEntry,
  historyEntryBytes,
  cloneHistoryValue,
  trimHistoryStack,
  popHistoryState
} from './history-controller-model.js';

let renderLayerMenu,
  applyBackground,
  indexUpsertItem,
  renderAll,
  renderItem,
  refreshConnectorsFor,
  refreshOrganizationUi,
  markDirty,
  selectItem,
  enqueueOperation;

function configureHistoryController(callbacks) {
  ({
    renderLayerMenu,
    applyBackground,
    indexUpsertItem,
    renderAll,
    renderItem,
    refreshConnectorsFor,
    refreshOrganizationUi,
    markDirty,
    selectItem,
    enqueueOperation
  } = callbacks);
}

('use strict');

function scheduleHistoryCompaction() {
  if (!state.undoStack.some((entry) => !isPatchHistoryEntry(entry))) return;
  const epoch = state.canvasEpoch;
  if (state.historyFinalizer?.epoch === epoch) return;
  const token = { epoch };
  state.historyFinalizer = token;
  queueMicrotask(() => {
    if (state.historyFinalizer !== token) return;
    state.historyFinalizer = null;
    if (state.canvasEpoch !== epoch) return;
    const previous = state.undoStack;
    const patches = window.WhiteboardHistory.convert(previous, snapshotDocument(), 'undo');
    // A snapshot captured ahead of an asynchronous mutation remains an anchor
    // until that mutation has actually happened; do not discard empty diffs.
    state.undoStack = patches.map((entry, index) => (entry.changes.length ? entry : previous[index]));
    state.undoBytes = state.undoStack.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
    trimHistoryStack('undo');
  });
}

function snapshotDocument(items = Array.from(state.items.values())) {
  const sourceItems = items.slice();
  if (state.pendingCut?.boardId === state.boardId) {
    const capturedIds = new Set(sourceItems.map((item) => item.id));
    for (const item of state.pendingCut.items) {
      if (!capturedIds.has(item.id)) sourceItems.push(item);
    }
  }
  const canonicalItems = sourceItems.map((item) =>
    item
  );
  const canonicalSections = Array.from(state.sections.values(), (section) =>
    section
  );
  return {items: JSON.parse(JSON.stringify(canonicalItems)),
sections: JSON.parse(JSON.stringify(canonicalSections)),
groups: JSON.parse(JSON.stringify(Array.from(state.groups.values()))),
layers: JSON.parse(JSON.stringify(state.layers)),
activeLayerId: state.activeLayerId,
background: state.background,
backgroundDrift: state.backgroundDrift,
connectorLineJumps: state.connectorLineJumps};
}

function normalizeDocumentSnapshot(snapshot) {
  if (Array.isArray(snapshot)) {
    return snapshotDocument(snapshot);
  }
  if (snapshot && Array.isArray(snapshot.items)) {
    return {items: JSON.parse(JSON.stringify(snapshot.items)),
sections: JSON.parse(JSON.stringify(Array.isArray(snapshot.sections) ? snapshot.sections : [])),
groups: JSON.parse(JSON.stringify(Array.isArray(snapshot.groups) ? snapshot.groups : [])),
layers: normalizeClientLayers(snapshot.layers),
activeLayerId: snapshot.activeLayerId || state.activeLayerId,
background: getBackgroundPreset(snapshot.background).type,
backgroundDrift: snapshot.backgroundDrift,
connectorLineJumps: snapshot.connectorLineJumps === true};
  }
  return snapshotDocument();
}

function pushUndoPatch(changes) {
  const normalized = (changes || [])
    .filter((change) => change?.id && change?.targetType && change.before && change.after)
    .map((change) => ({
      targetType: change.targetType,
      id: change.id,
      fields: Array.from(new Set(change.fields || Object.keys(change.before))),
      before: cloneHistoryValue(change.before),
      after: cloneHistoryValue(change.after)
    }))
    .filter((change) =>
      change.fields.some((field) => JSON.stringify(change.before[field]) !== JSON.stringify(change.after[field]))
    );
  if (!normalized.length) return;
  const entry = { __historyType: 'patch', changes: normalized };
  state.undoStack.push(entry);
  state.undoBytes += historyEntryBytes(entry);
  trimHistoryStack('undo');
  state.redoStack = [];
  state.redoBytes = 0;
  updateUndoButton();
  updateRedoButton();
}

function pushUndoSnapshot(documentSnapshot = snapshotDocument()) {
  const snapshot = normalizeDocumentSnapshot(documentSnapshot);
  const serialized = serializeDocument(snapshot);
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && serializeDocument(last) === serialized) {
    return;
  }
  state.undoStack.push(snapshot);
  state.undoBytes += serialized.length * 2;
  trimHistoryStack('undo', true);
  state.redoStack = [];
  state.redoBytes = 0;
  updateUndoButton();
  updateRedoButton();
}

function pushHistoryState(kind, documentSnapshot) {
  const stack = kind === 'undo' ? state.undoStack : state.redoStack;
  const bytesKey = kind === 'undo' ? 'undoBytes' : 'redoBytes';
  const entry = isPatchHistoryEntry(documentSnapshot)
    ? cloneHistoryValue(documentSnapshot)
    : normalizeDocumentSnapshot(documentSnapshot);
  stack.push(entry);
  state[bytesKey] += historyEntryBytes(entry);
  trimHistoryStack(kind);
}

function applyHistoryPatch(entry, direction) {
  if (
    entry.changes.some(
      (change) => ['group', 'document'].includes(change.targetType) || change.fields.includes('__entity')
    )
  ) {
    const next = window.WhiteboardHistory.apply(snapshotDocument(), entry, direction);
    const ops = documentDiffOps(next);
    applyDocumentState(next);
    sendOpsPayload(ops);
    return;
  }
  const key = direction === 'redo' ? 'after' : 'before';
  const ops = [];
  const itemIds = [];
  let sectionsChanged = false;
  for (const change of entry.changes) {
    const collection = change.targetType === 'section' ? state.sections : state.items;
    const target = collection.get(change.id);
    if (!target) continue;
    for (const field of change.fields) {
      if (Object.prototype.hasOwnProperty.call(change[key], field))
        target[field] = cloneHistoryValue(change[key][field]);
      else delete target[field];
    }
    collection.set(change.id, target);
    if (change.targetType === 'section') {
      sectionsChanged = true;
      ops.push({ kind: 'section-upsert', section: target });
    } else {
      itemIds.push(change.id);
      indexUpsertItem(target);
      renderItem(target);
      ops.push({ kind: 'upsert', item: target });
    }
  }
  if (sectionsChanged) renderSections();
  if (itemIds.length) refreshConnectorsFor(itemIds);
  refreshOrganizationUi();
  sendOpsPayload(ops);
}

function undoLastChange() {
  if (state.pendingCut) {
    restorePendingCut();
    return;
  }
  const previous = popHistoryState('undo');
  if (!previous) {
    updateUndoButton();
    return;
  }
  if (isPatchHistoryEntry(previous)) {
    pushHistoryState('redo', previous);
    applyHistoryPatch(previous, 'undo');
  } else {
    const ops = documentDiffOps(previous);
    pushHistoryState('redo', snapshotDocument());
    applyDocumentState(previous);
    sendOpsPayload(ops);
  }
  markDirty(true);
  updateUndoButton();
  updateRedoButton();
  window.MusePlanning?.notify();
}

function redoLastChange() {
  if (state.pendingCut) return;
  const next = popHistoryState('redo');
  if (!next) {
    updateRedoButton();
    return;
  }
  if (isPatchHistoryEntry(next)) {
    pushHistoryState('undo', next);
    applyHistoryPatch(next, 'redo');
  } else {
    const ops = documentDiffOps(next);
    pushHistoryState('undo', snapshotDocument());
    applyDocumentState(next);
    sendOpsPayload(ops);
  }
  markDirty(true);
  updateUndoButton();
  updateRedoButton();
  window.MusePlanning?.notify();
}

function applyDocumentState(documentSnapshot) {
  const snapshot = normalizeDocumentSnapshot(documentSnapshot);
  
  state.items = new Map(snapshot.items.map((item) => [item.id, item]));
  state.sections = new Map(
    snapshot.sections.map((section, index) => [section.id, normalizeClientSection(section, index)])
  );
  state.groups = new Map(snapshot.groups.map((group, index) => [group.id, normalizeClientGroup(group, index)]));
  
  state.layers = normalizeClientLayers(snapshot.layers);
  state.activeLayerId = state.layers.some((layer) => layer.id === snapshot.activeLayerId)
    ? snapshot.activeLayerId
    : state.layers[state.layers.length - 1].id;
  state.background = getBackgroundPreset(snapshot.background).type;
  state.backgroundDrift =
    typeof snapshot.backgroundDrift === 'boolean' ? snapshot.backgroundDrift : wallpaperDriftDefault();
  state.connectorLineJumps = snapshot.connectorLineJumps === true;
  state.zCounter = 1;
  for (const item of snapshot.items) {
    state.zCounter = Math.max(state.zCounter, Number(item.z || 1) + 1);
  }
  state.editSnapshot = null;
  clearMindNodeSelection();
  selectItem(null);
  
  renderAll();
  renderLayerMenu();
  applyBackground();
  buildBackgroundMenu();
}

function documentDiffOps(documentSnapshot) {
  const snapshot = normalizeDocumentSnapshot(documentSnapshot);
  const target = new Map(snapshot.items.map((item) => [item.id, item]));
  const targetSections = new Map(snapshot.sections.map((section) => [section.id, section]));
  const targetGroups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const ops = [];
  if (snapshot.connectorLineJumps !== state.connectorLineJumps) {
    ops.push({ kind: 'settings', settings: { connectorLineJumps: snapshot.connectorLineJumps === true } });
  }
  if (snapshot.backgroundDrift !== state.backgroundDrift) {
    ops.push({ kind: 'settings', settings: { backgroundDrift: snapshot.backgroundDrift === true } });
  }
  if (JSON.stringify(snapshot.layers) !== JSON.stringify(state.layers)) {
    ops.push({ kind: 'layers', layers: snapshot.layers });
  }
  if (snapshot.background !== state.background) {
    ops.push({ kind: 'settings', settings: { background: getBackgroundPreset(snapshot.background) } });
  }
  for (const [id, section] of targetSections) {
    const current = state.sections.get(id);
    if (!current || JSON.stringify(current) !== JSON.stringify(section)) ops.push({ kind: 'section-upsert', section });
  }
  for (const [id, group] of targetGroups) {
    const current = state.groups.get(id);
    if (!current || JSON.stringify(current) !== JSON.stringify(group)) ops.push({ kind: 'group-upsert', group });
  }
  for (const id of state.items.keys()) {
    if (!target.has(id)) {
      ops.push({ kind: 'delete', ids: [id] });
    }
  }
  for (const [id, targetItem] of target) {
    const currentItem = state.items.get(id);
    if (!currentItem || serializeItems([targetItem]) !== serializeItems([currentItem])) {
      ops.push({ kind: 'upsert', item: targetItem });
    }
  }
  for (const id of state.groups.keys()) {
    if (!targetGroups.has(id)) ops.push({ kind: 'delete-container', targetType: 'group', id, cascade: false });
  }
  for (const id of state.sections.keys()) {
    if (!targetSections.has(id)) ops.push({ kind: 'delete-container', targetType: 'section', id, cascade: false });
  }

  return ops;
}

function sendOpsPayload(ops) {
  if (!ops.length) {
    return;
  }
  enqueueOperation(
    ops.length === 1 ? {...ops[0]} : {kind: 'batch',
ops}
  );
}

function updateUndoButton() {
  if (!els.undoButton) {
    return;
  }
  els.undoButton.disabled = state.undoStack.length === 0 && !state.pendingCut;
  els.undoButton.classList.toggle('disabled', state.undoStack.length === 0 && !state.pendingCut);
}

function updateRedoButton() {
  if (!els.redoButton) {
    return;
  }
  els.redoButton.disabled = state.redoStack.length === 0 || Boolean(state.pendingCut);
  els.redoButton.classList.toggle('disabled', state.redoStack.length === 0 || Boolean(state.pendingCut));
}
export {
  scheduleHistoryCompaction,
  snapshotDocument,
  normalizeDocumentSnapshot,
  pushUndoPatch,
  pushUndoSnapshot,
  pushHistoryState,
  applyHistoryPatch,
  undoLastChange,
  redoLastChange,
  applyDocumentState,
  documentDiffOps,
  sendOpsPayload,
  updateUndoButton,
  updateRedoButton
};

export { configureHistoryController };
