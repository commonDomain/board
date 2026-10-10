function isWechatWebView() {
  return (
    /MicroMessenger/i.test(navigator.userAgent || '') ||
    new URLSearchParams(window.location.search).get('shell') === 'wechat'
  );
}

function refreshIcons(root = document) {
  try {
    window.MuseIcons?.renderIcons(root);
  } catch (error) {
    console.warn('Could not render interface icons', error);
  }
}

function setOrbActive(controller, active, stateName) {
  if (!controller) return;
  if (stateName) controller.setState(stateName);
  controller.setActive(active);
}

function captureElementRect(element) {
  if (!element?.getBoundingClientRect) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function morphSurface(surface, anchor) {
  if (!surface || !anchor) return null;
  return window.MuseEffects?.morphPopover(surface, anchor) || null;
}

function cancelSurfaceMorph(surface) {
  window.MuseEffects?.cancelPopoverMorph(surface);
}

function openMenuSurface(surface, anchor) {
  return window.MuseEffects?.openMenu(surface, anchor) || null;
}

function cancelMenuSurface(surface) {
  window.MuseEffects?.cancelMenuMotion(surface);
}

function closeMenuSurface(surface, onFinish, options = {}) {
  if (!surface) return null;
  if (options.immediate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    cancelMenuSurface(surface);
    onFinish?.();
    return null;
  }
  if (typeof window.MuseEffects?.closeMenu !== 'function') {
    onFinish?.();
    return null;
  }
  return window.MuseEffects.closeMenu(surface, onFinish);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) {
    existing.remove();
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}
export {
  isWechatWebView,
  refreshIcons,
  setOrbActive,
  captureElementRect,
  morphSurface,
  cancelSurfaceMorph,
  openMenuSurface,
  cancelMenuSurface,
  closeMenuSurface,
  showToast
};
