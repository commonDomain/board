import { placeAnchoredMenu } from './menu-placement.js';
import { closeBrushPresetMenu } from './brush-menu-model.js';
import { closeCanvasMenu } from './catalog.js';
import { deleteDraftEditable, finishEditing } from './editing.js';
import { els } from './elements.js';
import {
  closeFloatingSelectPickers,
  setFloatingColorPaletteOpen,
  setFloatingMoreOpen
} from './floating-toolbar-menu.js';
import { closeMenuSurface, openMenuSurface } from './interface-model.js';
import { interfaceEffects } from './interface.js';
import { interfaceRuntime } from './runtime/interface.js';
import { state } from './state.js';
import { rememberTextSelection } from './text-input.js';
import { cssEscape } from './utilities.js';

function handleGlobalPointerDown(event) {
  if (interfaceRuntime.adaptiveDialogRequest?.keepBrushMenuOpen && els.adaptiveDialog?.contains(event.target)) return;
  if (!event.target.closest?.('.floating-format-bar')) {
    setFloatingMoreOpen(false);
    setFloatingColorPaletteOpen(false);
  }
  if (!event.target.closest?.('[data-floating-select-picker]')) closeFloatingSelectPickers();
  const inContextPanel = Boolean(
    (typeof event.composedPath === 'function' && event.composedPath().includes(els.contextPanel)) ||
    (typeof event.composedPath === 'function' && event.composedPath().includes(els.floatingFormatBar)) ||
    event.target.closest?.('.context-panel, .floating-format-bar')
  );
  if (!event.target.closest('.canvas-menu, .canvas-switcher-button, .canvas-preview-card')) {
    closeCanvasMenu({ restoreFocus: false });
  }
  if (!event.target.closest('.brush-preset-menu, .preset-trigger')) closeBrushPresetMenu();
  if (!event.target.closest('.tool-popover, .split-tool, .brush-preset-menu')) {
    closePopovers();
  }
  if (state.draftEditableId && !state.editingId) {
    const draftRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(state.draftEditableId)}"]`);
    if (!draftRoot || !draftRoot.contains(event.target)) {
      deleteDraftEditable(state.draftEditableId);
      if (state.tool === 'pen' || state.tool === 'shape' || state.tool === 'text' || state.tool === 'note') {
        state.skipPointerId = event.pointerId;
        clearSkipPointerAfterEvent(event.pointerId);
      }
      return;
    }
  }
  if (!state.editingId) {
    if (state.mindmapEditing) {
      const inMindEditor = Boolean(
        event.target.closest?.('.mind-node-text.editing, .floating-format-bar, .context-panel')
      );
      if (!inMindEditor) state.mindmapEditing.finish?.(true);
    }
    return;
  }
  const editingItem = state.items.get(state.editingId);
  if (
    (editingItem?.type === 'text' || editingItem?.type === 'note') &&
    (inContextPanel || event.target.closest('.text-menu'))
  ) {
    // Line styles are paragraph-level state. Keep the line explicitly chosen in
    // the editor instead of replacing it with a stale DOM selection when the
    // toolbar itself receives the pointer event.
    if (!event.target.closest('[data-list-mode]')) {
      rememberTextSelection();
    }
    return;
  }
  if (editingItem?.type === 'table' && inContextPanel) {
    return;
  }
  const editingRoot = document.querySelector(`.board-item[data-item-id="${cssEscape(state.editingId)}"]`);
  if (editingRoot && editingRoot.contains(event.target)) {
    return;
  }
  const editingType = state.editingId ? state.items.get(state.editingId)?.type : null;
  finishEditing();
  const shouldSkip =
    state.tool === 'pen' ||
    state.tool === 'shape' ||
    (state.tool === 'text' && editingType === 'text') ||
    (state.tool === 'note' && editingType === 'note');
  if (shouldSkip) {
    state.skipPointerId = event.pointerId;
    clearSkipPointerAfterEvent(event.pointerId);
  }
}

function clearSkipPointerAfterEvent(pointerId) {
  setTimeout(() => {
    if (state.skipPointerId === pointerId) {
      state.skipPointerId = null;
    }
  }, 0);
}

function togglePopover(popover, anchor) {
  if (!popover || !anchor) {
    return;
  }
  const willOpen = popover.hidden || popover.dataset.menuClosing === 'true';
  closePopovers({ immediate: willOpen });
  if (!willOpen) {
    return;
  }
  popover.hidden = false;
  delete popover.dataset.menuClosing;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute(
    'aria-label',
    anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent.trim() || '工具选项'
  );
  anchor.setAttribute('aria-expanded', 'true');
  state.popoverAnchor = anchor;
  if (anchor.closest('#toolDock')) {
    interfaceEffects.toolLiquid?.update(anchor);
  }
  placeAnchoredMenu(popover, anchor);
  openMenuSurface(popover, anchor);
  requestAnimationFrame(() => {
    if (popover.hidden) return;
    popover
      .querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ?.focus({ preventScroll: true });
  });
}

function closePopovers(options = {}) {
  closeBrushPresetMenu();
  let shouldRestoreFocus = false;
  [
    els.brushMenu,
    els.eraserMenu,
    els.selectMenu,
    els.shapeMenu,
    els.textMenu,
    els.tableMenu,
    els.layerMenu,
    els.mindmapMenu,
    els.navigationMenu,
    els.backgroundMenu
  ].forEach((popover) => {
    if (popover) {
      shouldRestoreFocus ||= popover.contains(document.activeElement);
      const isOpen = !popover.hidden && popover.dataset.menuClosing !== 'true';
      if (isOpen) {
        closeMenuSurface(
          popover,
          () => {
            popover.hidden = true;
            popover.removeAttribute('style');
          },
          { immediate: options.immediate }
        );
      } else if (options.immediate && popover.dataset.menuClosing === 'true') {
        closeMenuSurface(
          popover,
          () => {
            popover.hidden = true;
            popover.removeAttribute('style');
          },
          { immediate: true }
        );
      }
      document.querySelectorAll(`[aria-controls="${popover.id}"]`).forEach((anchor) => {
        anchor.setAttribute('aria-expanded', 'false');
      });
    }
  });
  if (shouldRestoreFocus) {
    state.popoverAnchor?.focus({ preventScroll: true });
  }
  state.popoverAnchor = null;
  interfaceEffects.toolLiquid?.update(document.querySelector(`[data-tool="${cssEscape(state.tool)}"].active`));
}

export { clearSkipPointerAfterEvent, closePopovers, handleGlobalPointerDown, togglePopover };
