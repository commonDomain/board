import { DEFAULT_TEXT_BORDER_COLOR, DEFAULT_TEXT_FILL } from './constants.js';
import { els } from './elements.js';

import {getActiveTextLineStyle} from './text-list.js';
import { normalizeFontFamily, updateFormatControls } from './format-actions-model.js';
import { getSelectedOrEditingItem } from './format-panel.js';
import { normalizeNoteFill, normalizeTextAppearanceColor, normalizeTextBorderStyle } from './format-panel-model.js';
import { getMindNodeAtPath } from './mindmap-editing-model.js';
import { cameraRuntime } from './runtime/camera.js';
import { floatingToolbarMenuRuntime } from './runtime/floating-toolbar-menu.js';
import { floatingToolbarPositionRuntime } from './runtime/floating-toolbar-position.js';
import { state } from './state.js';
import { clamp, cssEscape } from './utilities.js';
import { syncFloatingSelectPicker, floatingToolbarUsesTarget } from './floating-toolbar-menu-model.js';

let floatingToolbarSafeRect,
  positionFloatingToolbar;

function configureFloatingToolbarMenu(callbacks) {
  ({
    floatingToolbarSafeRect,
    positionFloatingToolbar
  } = callbacks);
}

let floatingToolbarPositionFrame = null;

let floatingMoreAnimation = null;

let floatingMoreAnimationGeneration = 0;

let floatingMoreState = 'closed';

function setupFloatingSelectPicker(select) {
  const wrapper = select.closest('[data-floating-select-picker]');
  if (!wrapper) return;
  // The native select stores the value; the following trigger is the sole keyboard control.
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'floating-select-trigger sheet-tool sheet-tool-labeled';
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '选择');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML =
    '<span data-floating-select-label></span><i class="sheet-menu-chevron" data-lucide="chevron-down" aria-hidden="true"></i>';
  const menu = document.createElement('div');
  menu.className = 'floating-select-menu sheet-action-menu';
  menu.id = `floating-select-menu-${select.dataset.format}`;
  menu.setAttribute('role', 'listbox');
  trigger.setAttribute('aria-controls', menu.id);
  menu.hidden = true;
  const makeOptionButton = (option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-action-menu-item sheet-select-option';
    button.dataset.value = option.value;
    button.disabled = option.disabled;
    button.setAttribute('role', 'option');
    button.textContent = option.textContent;
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncFloatingSelectPicker(select);
      closeFloatingSelectPickers();
      trigger.focus({ preventScroll: true });
    });
    return button;
  };
  const focusOption = (index) => {
    const options = Array.from(menu.querySelectorAll('.sheet-select-option:not(:disabled)'));
    const option = options[Math.max(0, Math.min(index, options.length - 1))];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  };
  const openMenu = (focusSelected = false) => {
    closeFloatingSelectPickers(wrapper);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const selectedIndex = Math.max(0, select.selectedIndex);
    if (focusSelected) focusOption(selectedIndex);
    else menu.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  };
  Array.from(select.options).forEach((option) => menu.appendChild(makeOptionButton(option)));
  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeFloatingSelectPickers();
  });
  trigger.addEventListener('keydown', (event) => {
    if(event.isComposing || event.keyCode===229)return;
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      closeFloatingSelectPickers();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    openMenu(true);
    if (event.key === 'Home') focusOption(0);
    else if (event.key === 'End') focusOption(menu.children.length - 1);
    else if (event.key === 'ArrowUp') focusOption(Math.max(0, select.selectedIndex - 1));
  });
  menu.addEventListener('keydown', (event) => {
    if(event.isComposing || event.keyCode===229)return;
    const options = Array.from(menu.querySelectorAll('.sheet-select-option:not(:disabled)'));
    const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFloatingSelectPickers();
      trigger.focus({ preventScroll: true });
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : index + (event.key === 'ArrowDown' ? 1 : -1);
      focusOption(nextIndex);
    }
  });
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) closeFloatingSelectPickers();
  });
  wrapper.append(trigger, menu);
  wrapper.makeFloatingOptionButton = makeOptionButton;
  syncFloatingSelectPicker(select);
}

function closeFloatingSelectPickers(except = null) {
  els.floatingFormatBar?.querySelectorAll('[data-floating-select-picker]').forEach((wrapper) => {
    if (wrapper === except) return;
    const menu = wrapper.querySelector('.floating-select-menu');
    const trigger = wrapper.querySelector('.floating-select-trigger');
    if (menu) menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  });
}

function setFloatingColorPaletteOpen(open) {
  const bar = els.floatingFormatBar;
  const panel = bar?.querySelector('[data-floating-color-panel]');
  const button = bar?.querySelector('[data-floating-color]');
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) {
    setFloatingMoreOpen(false, { immediate: true, keepColorPalette: true });
    closeFloatingSelectPickers();
  }
  scheduleFloatingToolbarPosition();
}

function setFloatingAppearanceTab(tab = 'fill') {
  const bar = els.floatingFormatBar;
  if (!bar) return;
  const nextTab = tab === 'border' ? 'border' : 'fill';
  bar.querySelectorAll('[data-floating-appearance-tab]').forEach((button) => {
    const active = button.dataset.floatingAppearanceTab === nextTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  bar.querySelectorAll('[data-floating-appearance-content]').forEach((panel) => {
    panel.hidden = panel.dataset.floatingAppearanceContent !== nextTab;
  });
  requestAnimationFrame(positionFloatingSubmenu);
}

function positionFloatingSubmenu() {
  const bar = els.floatingFormatBar;
  const more = bar?.querySelector('[data-floating-more-panel]');
  const submenu = more?.querySelector('.floating-menu-subpanel:not([hidden])');
  if (!bar || !more || !submenu || more.hidden) {
    bar?.classList.remove('floating-submenu-left');
    return;
  }
  const safe = floatingToolbarSafeRect();
  if (safe.right - safe.left < 640) {
    bar.classList.remove('floating-submenu-left');
    submenu.style.top = '0px';
    return;
  }
  const moreRect = more.getBoundingClientRect();
  const submenuRect = submenu.getBoundingClientRect();
  const gap = 9;
  const roomRight = safe.right - moreRect.right;
  const roomLeft = moreRect.left - safe.left;
  const openLeft = roomRight < submenuRect.width + gap && roomLeft > roomRight;
  bar.classList.toggle('floating-submenu-left', openLeft);
  const maxRelativeTop = Math.max(0, safe.bottom - moreRect.top - submenuRect.height);
  const relativeTop = clamp(safe.top - moreRect.top, 0, maxRelativeTop);
  submenu.style.top = `${Math.round(relativeTop)}px`;
}

function setFloatingMenuView(view = 'root') {
  const bar = els.floatingFormatBar;
  const root = bar?.querySelector('[data-floating-menu-view="root"]');
  const requested = view === 'root' ? null : bar?.querySelector(`[data-floating-menu-view="${cssEscape(view)}"]`);
  const item = getSelectedOrEditingItem();
  const resolved =
    requested && (!requested.classList.contains('floating-note-only') || item?.type === 'note') ? requested : null;
  if (!bar || !root) return;
  root.hidden = false;
  bar.querySelectorAll('.floating-menu-subpanel').forEach((panel) => {
    panel.hidden = panel !== resolved;
  });
  bar.querySelectorAll('[data-floating-menu-target]').forEach((button) => {
    const active = Boolean(resolved && button.dataset.floatingMenuTarget === resolved.dataset.floatingMenuView);
    button.classList.toggle('active', active);
    button.setAttribute('aria-expanded', String(active));
  });
  if (resolved?.dataset.floatingMenuView === 'appearance') setFloatingAppearanceTab('fill');
  if (!resolved) bar.classList.remove('floating-submenu-left');
  requestAnimationFrame(() => {
    positionFloatingSubmenu();
    scheduleFloatingToolbarPosition();
  });
}

function setFloatingMoreOpen(open, options = {}) {
  if(!open)options={...options,immediate:true};
  const bar = els.floatingFormatBar;
  const panel = bar?.querySelector('[data-floating-more-panel]');
  const button = bar?.querySelector('[data-floating-more]');
  if (!panel || !button) return;
  const generation = ++floatingMoreAnimationGeneration;
  const wasHidden = panel.hidden;
  const computed = wasHidden ? null : getComputedStyle(panel);
  const currentOpacity = computed?.opacity || (open ? '0' : '1');
  const currentTransform =
    computed?.transform && computed.transform !== 'none'
      ? computed.transform
      : open
        ? 'translateY(-5px) scale(.96)'
        : 'translateY(0) scale(1)';
  floatingMoreAnimation?.cancel?.();
  floatingMoreAnimation = null;
  button.setAttribute('aria-expanded', String(open));
  if (!options.keepColorPalette) setFloatingColorPaletteOpen(false);
  if (options.immediate) {
    panel.hidden = !open;
    panel.classList.toggle('is-open', open);
    floatingMoreState = open ? 'open' : 'closed';
    if (!open) setFloatingMenuView('root');
    scheduleFloatingToolbarPosition();
    return;
  }
  if (open) {
    if (floatingMoreState === 'open' && !panel.hidden) return;
    setFloatingMenuView('root');
    panel.hidden = false;
    panel.classList.add('is-open');
    floatingMoreState = 'opening';
    scheduleFloatingToolbarPosition();
    floatingMoreAnimation = panel.animate(
      [
        { opacity: currentOpacity, transform: currentTransform },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ],
      { duration: wasHidden ? 210 : 150, easing: 'cubic-bezier(.2,.82,.2,1)', fill: 'both' }
    );
    floatingMoreAnimation.finished
      .then(() => {
        if (generation !== floatingMoreAnimationGeneration) return;
        floatingMoreState = 'open';
        floatingMoreAnimation = null;
        panel.getAnimations().forEach((animation) => animation.cancel());
        scheduleFloatingToolbarPosition();
      })
      .catch(() => {});
  } else if (!panel.hidden) {
    if (floatingMoreState === 'closed') return;
    floatingMoreState = 'closing';
    floatingMoreAnimation = panel.animate(
      [
        { opacity: currentOpacity, transform: currentTransform },
        { opacity: 0, transform: 'translateY(-4px) scale(.96)' }
      ],
      { duration: 135, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' }
    );
    floatingMoreAnimation.finished
      .then(() => {
        if (generation !== floatingMoreAnimationGeneration) return;
        panel.hidden = true;
        panel.classList.remove('is-open');
        floatingMoreState = 'closed';
        floatingMoreAnimation = null;
        panel.getAnimations().forEach((animation) => animation.cancel());
        setFloatingMenuView('root');
        scheduleFloatingToolbarPosition();
      })
      .catch(() => {});
  } else {
    floatingMoreState = 'closed';
  }
}

function getEditingMindNodeContext() {
  const editing = state.mindmapEditing;
  if (!editing) return null;
  const item = state.items.get(editing.itemId);
  const node = item?.type === 'mindmap' ? getMindNodeAtPath(item.tree, editing.path) : null;
  if (!item || !node) return null;
  const root = document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"]`);
  const element = root?.querySelector(`[data-mn-path="${cssEscape(editing.path.join('.'))}"]`);
  const editable = element?.querySelector('.mind-node-text[contenteditable="true"]');
  return { editing, item, node, root, element, editable };
}

function updateFloatingFormatBar(item = getSelectedOrEditingItem()) {
  const bar = els.floatingFormatBar;
  if (!bar) return;
  const visible = floatingToolbarUsesTarget(item);
  bar.hidden = !visible;
  if (!visible) {
    floatingToolbarPositionRuntime.floatingToolbarCommittedCaret = null;
    floatingToolbarPositionRuntime.floatingToolbarTextOverlapObserver?.disconnect();
    floatingToolbarPositionRuntime.floatingToolbarTextOverlapObserver = null;
    floatingToolbarPositionRuntime.floatingToolbarTextOverlapRoot = null;
    floatingToolbarPositionRuntime.floatingToolbarTextOverlapCache = null;
    setFloatingMoreOpen(false, { immediate: true });
    setFloatingColorPaletteOpen(false);
    return;
  }
  const mindContext = item.type === 'mindmap' ? getEditingMindNodeContext() : null;
  const toolbarTargetId = mindContext ? `${item.id}:${mindContext.node.id}` : item.id;
  if (state.floatingToolbarTargetId && state.floatingToolbarTargetId !== toolbarTargetId) {
    floatingToolbarPositionRuntime.floatingToolbarCommittedCaret = null;
    floatingToolbarPositionRuntime.floatingToolbarManualPosition = null;
    setFloatingMoreOpen(false, { immediate: true });
    setFloatingColorPaletteOpen(false);
  }
  state.floatingToolbarTargetId = toolbarTargetId;
  bar.classList.toggle('is-mind-node-toolbar', Boolean(mindContext));
  bar.querySelectorAll('.floating-note-only').forEach((control) => {
    if (control.matches('[data-floating-menu-view]')) {
      if (item.type !== 'note') control.hidden = true;
    } else {
      control.hidden = item.type !== 'note';
    }
  });
  bar.querySelectorAll('.floating-emphasis-only').forEach((control) => {
    control.hidden = item.type !== 'note' && item.type !== 'mindmap';
  });
  bar.querySelectorAll('.floating-container-only').forEach((control) => {
    control.hidden = item.type === 'mindmap';
  });
  bar.querySelectorAll('.floating-text-only').forEach((control) => {
    control.hidden = item.type !== 'text';
  });
  bar.querySelectorAll('.floating-list-only').forEach((control) => {
    control.hidden = item.type === 'table' || item.type === 'mindmap';
  });
  const textStyle = mindContext?.node.style || null;
  const colorPicker = bar.querySelector('input[data-color-picker]');
  if (colorPicker) {
    colorPicker.value = textStyle?.color || textStyle?.textColor || item.color || '#111111';
    bar.style.setProperty('--floating-text-color', colorPicker.value);
  }
  bar.querySelectorAll('[data-color]').forEach((button) => {
    const active = button.dataset.color.toLowerCase() === (colorPicker?.value || '').toLowerCase();
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const noteFill = bar.querySelector('input[data-note-fill]');
  if (noteFill && item.type === 'note') noteFill.value = normalizeNoteFill(item.noteFill);
  const noteBorder = bar.querySelector('select[data-note-border]');
  if (noteBorder && item.type === 'note') noteBorder.value = item.noteBorder === 'solid' ? 'solid' : 'none';
  const opacity = clamp(Number.isFinite(Number(item.noteOpacity)) ? Number(item.noteOpacity) : 1, 0, 1);
  const opacityInput = bar.querySelector('input[data-note-opacity]');
  if (opacityInput) opacityInput.value = String(Math.round(opacity * 100));
  const opacityValue = bar.querySelector('[data-note-opacity-value]');
  if (opacityValue) opacityValue.textContent = `${Math.round(opacity * 100)}%`;
  bar.querySelectorAll('[data-note-format]').forEach((button) => {
    const format = button.dataset.noteFormat;
    const active = mindContext
      ? format === 'italic'
        ? textStyle?.fontStyle === 'italic'
        : textStyle?.textDecoration === 'underline'
      : Boolean(item[format]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const shadow = bar.querySelector('[data-note-shadow]');
  if (shadow) {
    const active = item.noteShadow !== false;
    shadow.classList.toggle('active', active);
    shadow.setAttribute('aria-checked', String(active));
  }
  const lock = bar.querySelector('[data-note-lock]');
  if (lock) {
    lock.classList.toggle('active', Boolean(item.locked));
    lock.setAttribute('aria-pressed', String(Boolean(item.locked)));
    const label = lock.querySelector('[data-note-lock-label]');
    if (label) label.textContent = item.locked ? '解锁' : '锁定';
  }
  if (mindContext) {
    state.fontSize = clamp(Number(textStyle?.fontSize) || 12, 8, 96);
    state.fontFamily = normalizeFontFamily(textStyle?.fontFamily);
    state.bold = textStyle?.fontWeight === 'bold' || Number(textStyle?.fontWeight) >= 600;
    state.align = ['left', 'center', 'right'].includes(textStyle?.textAlign) ? textStyle.textAlign : 'center';
  } else if (item.type !== 'table') {
    updateTextListControlsForRoot(bar, item);
  }
  if (item.type === 'text') {
    const fill = normalizeTextAppearanceColor(item.textFill, DEFAULT_TEXT_FILL);
    const borderColor = normalizeTextAppearanceColor(item.textBorderColor, DEFAULT_TEXT_BORDER_COLOR);
    const fillInput = bar.querySelector('[data-text-fill-color]');
    const borderInput = bar.querySelector('[data-text-border-color]');
    if (fillInput) fillInput.value = fill === 'default' ? '#ffffff' : fill;
    if (borderInput) borderInput.value = borderColor === 'default' ? '#313846' : borderColor;
    const borderStyle = normalizeTextBorderStyle(item.textBorderStyle);
    bar.querySelectorAll('[data-text-border-style]').forEach((button) => {
      const active = button.dataset.textBorderStyle === borderStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  bar.querySelectorAll('[data-text-toolbar-mode]').forEach((button) => {
    const active = button.dataset.textToolbarMode === state.textToolbarMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateFormatControls();
  scheduleFloatingToolbarPosition();
}

function updateTextListControlsForRoot(root, item) {
  if (!root || !item || (item.type !== 'text' && item.type !== 'note')) return;
  const activeLineStyle = getActiveTextLineStyle(item);
  root.querySelectorAll('[data-list-mode]').forEach((button) => {
    const active = button.dataset.listMode === activeLineStyle;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function scheduleFloatingToolbarPosition() {
  if (floatingToolbarPositionFrame || els.floatingFormatBar?.hidden) return;
  if (state.panning?.active || state.pinch || cameraRuntime.wheelZoomFrame) {
    floatingToolbarMenuRuntime.floatingToolbarPositionPending = true;
    return;
  }
  floatingToolbarMenuRuntime.floatingToolbarPositionPending = false;
  floatingToolbarPositionFrame = requestAnimationFrame(() => {
    floatingToolbarPositionFrame = null;
    positionFloatingToolbar();
  });
}
export {
  floatingToolbarPositionFrame,
  floatingMoreAnimation,
  floatingMoreAnimationGeneration,
  floatingMoreState,
  setupFloatingSelectPicker,
  closeFloatingSelectPickers,
  setFloatingColorPaletteOpen,
  setFloatingAppearanceTab,
  positionFloatingSubmenu,
  setFloatingMenuView,
  setFloatingMoreOpen,
  getEditingMindNodeContext,
  updateFloatingFormatBar,
  updateTextListControlsForRoot,
  scheduleFloatingToolbarPosition
};

export { configureFloatingToolbarMenu };
