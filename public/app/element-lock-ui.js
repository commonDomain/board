import { state } from './state.js';
import { isRemoteBoardLocked } from './connection-model.js';
import { editOperationTargets } from './edit-lock-targets-model.js';
import { canMutateItem } from './layers-model.js';

const previousInert = new WeakMap();

function setEditLockSurface(node, locked) {
  // The outer shell must remain a pointer target. Making it inert causes
  // hit-testing to fall through and suppresses the forbidden cursor.
  if (node.inert) node.inert = false;
  if (node.hasAttribute('data-editing-by-other') !== locked) node.toggleAttribute('data-editing-by-other', locked);
  if (locked) { if (node.getAttribute('aria-disabled') !== 'true') node.setAttribute('aria-disabled', 'true'); }
  else if (node.hasAttribute('aria-disabled')) node.removeAttribute('aria-disabled');
  for (const child of node.children) {
    if (locked) {
      if (!previousInert.has(child)) previousInert.set(child, child.hasAttribute('inert'));
      if (!child.inert) child.setAttribute('inert', '');
    } else if (previousInert.has(child)) {
      child.toggleAttribute('inert', previousInert.get(child));
      previousInert.delete(child);
    }
  }
}

function renderItemEditLock(node) {
  setEditLockSurface(node, isRemoteBoardLocked(node.dataset.itemId));
  const locked = String(!canMutateItem(state.items.get(node.dataset.itemId)));
  if (node.dataset.locked !== locked) node.dataset.locked = locked;
}

function renderSectionEditLock(frame) {
  const section = state.sections.get(frame.dataset.sectionId);
  const targets = editOperationTargets({ kind: 'section-upsert', section }, state);
  const locked = [...targets].some(isRemoteBoardLocked);
  // The frame's empty interior stays transparent to pointer events.
  for (const handle of frame.querySelectorAll('.section-titlebar,.section-top-drag-handle,.section-resize-handle'))
    setEditLockSurface(handle, locked);
}

export { renderItemEditLock, renderSectionEditLock };
