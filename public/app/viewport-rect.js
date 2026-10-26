import { els } from './elements.js';

// Pointer, camera and virtualization code read the viewport rectangle on every
// gesture frame. Reading it after DOM writes forces a synchronous layout of the
// whole canvas, so keep the last rectangle until the viewport can have moved:
// a resize (observer, window or visual viewport), a scroll, or a short expiry
// as a backstop for shell changes that move it without resizing it.
const MAX_AGE_MS = 250;
let cached = null;
let cachedAt = 0;
let installed = false;

function invalidateViewportRect() {
  cached = null;
}

function install() {
  installed = true;
  if (typeof ResizeObserver === 'function' && els.viewport) new ResizeObserver(invalidateViewportRect).observe(els.viewport);
  window.addEventListener('resize', invalidateViewportRect, { passive: true });
  window.addEventListener('scroll', invalidateViewportRect, { passive: true, capture: true });
  window.visualViewport?.addEventListener('resize', invalidateViewportRect, { passive: true });
  window.visualViewport?.addEventListener('scroll', invalidateViewportRect, { passive: true });
}

function getViewportRect() {
  if (!installed) install();
  const now = performance.now();
  if (!cached || now - cachedAt > MAX_AGE_MS) {
    const rect = els.viewport.getBoundingClientRect();
    cached = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, x: rect.x, y: rect.y };
    cachedAt = now;
  }
  return cached;
}

export { getViewportRect, invalidateViewportRect };
