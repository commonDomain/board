import { els } from './elements.js';
import { initializeDeviceProfile } from './device-profile.js';
import { scheduleFloatingToolbarPosition } from './floating-toolbar-menu.js';
import { interfaceRuntime } from './runtime/interface.js';
import { state } from './state.js';
import {
  isWechatWebView,
  setOrbActive,
  captureElementRect,
  morphSurface,
  cancelSurfaceMorph
} from './interface-model.js';

const interfaceEffects = {
  connectionOrb: null,
  searchOrb: null,
  exportOrb: null,
  toolLiquid: null,
  canvasLiquid: null
};

const effectDisabledStates = new WeakMap();

function updateViewportHeight() {
  const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight);
  document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
  const visual = window.visualViewport;
  document.documentElement.style.setProperty('--viewport-top', `${visual?.offsetTop || 0}px`);
  document.documentElement.style.setProperty('--viewport-left', `${visual?.offsetLeft || 0}px`);
  document.documentElement.style.setProperty('--viewport-width', `${visual?.width || window.innerWidth}px`);
  const focused = Boolean(document.activeElement?.matches('input,textarea,[contenteditable="true"]'));
  if (!focused) interfaceRuntime.unobscuredViewportHeight = window.innerHeight;
  const keyboard = focused && Math.max(window.innerHeight, interfaceRuntime.unobscuredViewportHeight || 0) - viewportHeight > 120;
  document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - (visual?.offsetTop || 0) - viewportHeight)}px`);
  document.documentElement.classList.toggle('soft-keyboard-open', keyboard);
  scheduleFloatingToolbarPosition();
}

function configureWebViewRuntime() {
  initializeDeviceProfile();
  document.documentElement.classList.toggle('wechat-webview', isWechatWebView());
  updateViewportHeight();
}

function initializeInterfaceEffects() {
  const effects = window.MuseEffects;
  if (!effects) return;
  try {
    els.saveButton?.classList.add('muse-beam');
    els.exportPngButton?.classList.add('muse-beam');
    els.canvasSwitcherButton?.classList.add('muse-beam');
    document.querySelector('.search-command')?.classList.add('muse-beam-line');
    interfaceEffects.connectionOrb = effects.mountOrb(els.connectionOrb, {
      state: 'connecting',
      size: 20,
      active: false
    });
    interfaceEffects.searchOrb = effects.mountOrb(els.searchOrb, { state: 'searching', size: 20, active: false });
    interfaceEffects.exportOrb = effects.mountOrb(els.exportOrb, { state: 'shaping', size: 20, active: false });
    interfaceEffects.toolLiquid = effects.createToolLiquid(els.toolDock);
    interfaceEffects.canvasLiquid = effects.createLiquidMove(els.canvasList, {
      activeSelector: '.canvas-list-item.active',
      className: 'liquid-canvas-indicator'
    });
    updateSaveEffect();
  } catch (error) {
    console.warn('Interface effects are unavailable; continuing without animation.', error);
  }
}

function finishAdaptiveDialog(confirmed) {
  const request = interfaceRuntime.adaptiveDialogRequest;
  if (!request || !els.adaptiveDialog) return;
  if (confirmed && request.mode === 'prompt' && typeof request.validate === 'function') {
    const validationMessage = request.validate(els.adaptiveDialogInput.value);
    if (validationMessage) {
      els.adaptiveDialogError.textContent = String(validationMessage);
      els.adaptiveDialogError.hidden = false;
      els.adaptiveDialogInput.setAttribute('aria-invalid', 'true');
      els.adaptiveDialogInput.focus({ preventScroll: true });
      return;
    }
  }
  interfaceRuntime.adaptiveDialogRequest = null;
  cancelSurfaceMorph(els.adaptiveDialogForm);
  els.adaptiveDialog.hidden = true;
  const result = request.mode === 'prompt' ? (confirmed ? els.adaptiveDialogInput.value : null) : Boolean(confirmed);
  request.resolve(result);
  request.restoreFocus?.focus?.({ preventScroll: true });
}

function openAdaptiveDialog(options = {}) {
  if (!els.adaptiveDialog || interfaceRuntime.adaptiveDialogRequest) {
    return Promise.resolve(options.mode === 'prompt' ? null : false);
  }
  const mode = options.mode === 'prompt' ? 'prompt' : 'confirm';
  const danger = Boolean(options.danger);
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const anchorRect = captureElementRect(restoreFocus);
  els.adaptiveDialog.setAttribute('role', danger ? 'alertdialog' : 'dialog');
  els.adaptiveDialogTitle.textContent = options.title || (mode === 'prompt' ? '请输入内容' : '操作确认');
  els.adaptiveDialogMessage.textContent = options.message || '';
  els.adaptiveDialogMessage.hidden = !options.message;
  els.adaptiveDialogInputLabel.textContent = options.inputLabel || '名称';
  els.adaptiveDialogInputLabel.hidden = mode !== 'prompt';
  els.adaptiveDialogInput.hidden = mode !== 'prompt';
  els.adaptiveDialogInput.value = mode === 'prompt' ? String(options.initialValue || '') : '';
  els.adaptiveDialogInput.maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 100;
  els.adaptiveDialogInput.type = mode === 'prompt' && options.inputType === 'url' ? 'url' : 'text';
  els.adaptiveDialogInput.inputMode = mode === 'prompt' && options.inputMode ? options.inputMode : 'text';
  els.adaptiveDialogInput.placeholder = mode === 'prompt' ? String(options.placeholder || '') : '';
  els.adaptiveDialogInput.setAttribute('aria-invalid', 'false');
  els.adaptiveDialogError.textContent = '';
  els.adaptiveDialogError.hidden = true;
  els.adaptiveDialogCancel.textContent = options.cancelLabel || '取消';
  els.adaptiveDialogConfirm.textContent = options.confirmLabel || '确定';
  els.adaptiveDialogConfirm.classList.toggle('danger', danger);
  els.adaptiveDialogConfirm.classList.toggle('primary', !danger);
  els.adaptiveDialogIcon.classList.toggle('danger', danger);
  els.adaptiveDialog.hidden = false;
  morphSurface(els.adaptiveDialogForm, anchorRect || els.adaptiveDialogConfirm);
  return new Promise((resolve) => {
    interfaceRuntime.adaptiveDialogRequest = {
      mode,
      resolve,
      restoreFocus,
      keepBrushMenuOpen: Boolean(options.keepBrushMenuOpen),
      validate: options.validate
    };
    requestAnimationFrame(() => {
      if (els.adaptiveDialog.hidden) return;
      if (mode === 'prompt') {
        els.adaptiveDialogInput.focus({ preventScroll: true });
        els.adaptiveDialogInput.select();
      } else {
        (danger ? els.adaptiveDialogCancel : els.adaptiveDialogConfirm).focus({ preventScroll: true });
      }
    });
  });
}

function wireAdaptiveDialog() {
  if (!els.adaptiveDialog) return;
  els.adaptiveDialogForm.addEventListener('submit', (event) => {
    event.preventDefault();
    finishAdaptiveDialog(true);
  });
  els.adaptiveDialogCancel.addEventListener('click', () => finishAdaptiveDialog(false));
  els.adaptiveDialogInput.addEventListener('input', () => {
    els.adaptiveDialogError.textContent = '';
    els.adaptiveDialogError.hidden = true;
    els.adaptiveDialogInput.setAttribute('aria-invalid', 'false');
  });
  els.adaptiveDialog.addEventListener('click', (event) => {
    if (event.target === els.adaptiveDialog) finishAdaptiveDialog(false);
  });
  document.addEventListener('keydown', (event) => {
    if (els.adaptiveDialog.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishAdaptiveDialog(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(els.adaptiveDialogForm.querySelectorAll('input:not([hidden]), button:not([disabled])'));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function setEffectBusy(control, active) {
  if (!control) return;
  if (active) {
    if (!effectDisabledStates.has(control)) effectDisabledStates.set(control, control.disabled);
    control.disabled = true;
    return;
  }
  if (!effectDisabledStates.has(control)) return;
  control.disabled = effectDisabledStates.get(control);
  effectDisabledStates.delete(control);
}

function updateSaveEffect() {
  if (!els.saveButton) return;
  const active = Boolean(state.saveInFlight || state.saveQueued || state.syncQueue.length);
  els.saveButton.classList.toggle('is-beam-active', active);
  els.saveButton.classList.toggle('is-beam-dirty', !active && state.dirty);
}

function setExportEffect(active) {
  els.exportPngButton?.classList.toggle('is-processing', active);
  els.exportPngButton?.classList.toggle('is-beam-active', active);
  setEffectBusy(els.exportPngButton, active);
  setOrbActive(interfaceEffects.exportOrb, active, 'shaping');
}
export {
  interfaceEffects,
  effectDisabledStates,
  updateViewportHeight,
  configureWebViewRuntime,
  initializeInterfaceEffects,
  finishAdaptiveDialog,
  openAdaptiveDialog,
  wireAdaptiveDialog,
  setEffectBusy,
  updateSaveEffect,
  setExportEffect
};
