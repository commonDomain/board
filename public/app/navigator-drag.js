import { pushUndoSnapshot } from './history-controller.js';
import { dragRetreatMagnitude } from './catalog-drag-model.js';
import { els } from './elements.js';
import { buildNavigatorRows } from './navigator-data.js';
import { renderNavigator } from './navigator-rendering.js';
import { navigatorRenderingRuntime } from './runtime/navigator-rendering.js';
import { markDirty } from './save-status.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { cssEscape } from './utilities.js';

function clearNavigatorDropIndicators(options = {}) {
  if (!els.navigatorTree) return;
  delete els.navigatorTree.dataset.dragPreviewKey;
  els.navigatorTree.querySelectorAll('.is-drop-before, .is-drop-after').forEach((entry) => {
    entry.classList.remove('is-drop-before', 'is-drop-after');
  });
  clearTimeout(navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer);
  navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer = null;
  const displaced = Array.from(els.navigatorTree.querySelectorAll('.is-drag-displaced'));
  displaced.forEach((entry) => {
    if (options.immediate) {
      entry.classList.remove('is-drag-displaced');
      entry.style.removeProperty('--navigator-retreat');
    } else {
      entry.style.setProperty('--navigator-retreat', '0px');
    }
  });
  if (!options.immediate && displaced.length) {
    navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer = setTimeout(() => {
      navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer = null;
      displaced.forEach((entry) => {
        if (entry.style.getPropertyValue('--navigator-retreat') !== '0px') return;
        entry.classList.remove('is-drag-displaced');
        entry.style.removeProperty('--navigator-retreat');
      });
    }, 220);
  }
}

function previewNavigatorDrop(source, target, position, targetElement) {
  if (!els.navigatorTree) return;
  const previewKey = `${source.type}:${source.id}>${target.type}:${target.id}:${position}`;
  if (els.navigatorTree.dataset.dragPreviewKey === previewKey) return;
  clearTimeout(navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer);
  navigatorRenderingRuntime.navigatorDropPreviewCleanupTimer = null;
  els.navigatorTree.querySelectorAll('.is-drop-before, .is-drop-after').forEach((entry) => {
    entry.classList.remove('is-drop-before', 'is-drop-after');
  });
  els.navigatorTree.dataset.dragPreviewKey = previewKey;
  targetElement.classList.add(position === 'before' ? 'is-drop-before' : 'is-drop-after');
  const siblings = buildNavigatorRows().filter(
    (entry) => entry.parentKey === target.parentKey && entry.type !== 'root'
  );
  const sourceIndex = siblings.findIndex((entry) => entry.type === source.type && entry.id === source.id);
  let targetIndex = siblings.findIndex((entry) => entry.type === target.type && entry.id === target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const reordered = siblings.slice();
  const [moved] = reordered.splice(sourceIndex, 1);
  targetIndex = reordered.findIndex((entry) => entry.type === target.type && entry.id === target.id);
  reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
  const destinationIndex = reordered.indexOf(moved);
  if (destinationIndex === sourceIndex) return;
  const direction = destinationIndex > sourceIndex ? -1 : 1;
  const rangeStart = Math.min(sourceIndex, destinationIndex);
  const rangeEnd = Math.max(sourceIndex, destinationIndex);
  const affected = siblings
    .slice(rangeStart, rangeEnd + 1)
    .filter((entry) => entry.type !== source.type || entry.id !== source.id);
  const retreats = new Map();
  affected.forEach((entry, index) => {
    const distanceFromTarget = direction < 0 ? affected.length - index - 1 : index;
    const element = els.navigatorTree.querySelector(
      `.navigator-row[data-type="${cssEscape(entry.type)}"][data-id="${cssEscape(entry.id)}"]`
    );
    if (!element) return;
    retreats.set(element, direction * dragRetreatMagnitude(distanceFromTarget, element.offsetHeight));
  });
  const previewElements = new Set([...els.navigatorTree.querySelectorAll('.is-drag-displaced'), ...retreats.keys()]);
  previewElements.forEach((element) => {
    element.classList.add('is-drag-displaced');
    element.style.setProperty('--navigator-retreat', `${(retreats.get(element) || 0).toFixed(1)}px`);
  });
}

function reorderNavigatorEntry(source, target, position) {
  if (!source?.id || source.parentKey !== target.parentKey || (source.type === target.type && source.id === target.id))
    return;
  const siblings = buildNavigatorRows().filter((row) => row.parentKey === target.parentKey && row.type !== 'root');
  const sourceIndex = siblings.findIndex((row) => row.type === source.type && row.id === source.id);
  let targetIndex = siblings.findIndex((row) => row.type === target.type && row.id === target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = siblings.splice(sourceIndex, 1);
  targetIndex = siblings.findIndex((row) => row.type === target.type && row.id === target.id);
  siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
  const newIndex = siblings.indexOf(moved);
  const previousOrder = newIndex > 0 ? siblings[newIndex - 1].sortOrder : null;
  const nextOrder = newIndex < siblings.length - 1 ? siblings[newIndex + 1].sortOrder : null;
  let nextNavigatorOrder =
    previousOrder === null ? nextOrder - 1 : nextOrder === null ? previousOrder + 1 : (previousOrder + nextOrder) / 2;
  if (nextNavigatorOrder === previousOrder || nextNavigatorOrder === nextOrder) {
    const targetOrder = Number(target.sortOrder) || 0;
    const epsilon = Math.max(1e-9, Math.abs(targetOrder) * 1e-9);
    nextNavigatorOrder = targetOrder + (position === 'before' ? -epsilon : epsilon);
  }
  const collection = source.type === 'section' ? state.sections : source.type === 'group' ? state.groups : state.items;
  const entry = collection.get(source.id);
  if (!entry) return;
  pushUndoSnapshot();
  entry.navigatorOrder = nextNavigatorOrder;
  const operation =
    source.type === 'section'
      ? { kind: 'section-upsert', section: entry }
      : source.type === 'group'
        ? { kind: 'group-upsert', group: entry }
        : { kind: 'upsert', item: entry };
  enqueueOperation(operation);
  markDirty(true);
  state.navigatorAnimationUntil = performance.now() + 420;
  return renderNavigator(true, `${source.type}:${source.id}`)?.get(`${source.type}:${source.id}`) || null;
}
export { clearNavigatorDropIndicators, previewNavigatorDrop, reorderNavigatorEntry };
