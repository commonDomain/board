import { state } from './state.js';
import { getViewportRect } from './viewport-rect.js';
import { els } from './elements.js';
import { boardToScreen } from './camera-model.js';

let guide, handle, boardId;
function fromScreen(x, y) {
  const angle = -state.rotation * Math.PI / 180;
  const dx = (x - state.camera.x) / state.zoom, dy = (y - state.camera.y) / state.zoom;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}
export function centerSymmetryOrigin() {
  const rect = els.viewport.getBoundingClientRect();
  state.symmetryOrigin = fromScreen(rect.width / 2, rect.height / 2);
  updateSymmetryGuide();
}
export function updateSymmetryGuide() {
  if (!els.viewport) return;
  if (boardId !== state.boardId) { boardId = state.boardId; state.symmetryOrigin = null; }
  const visible = state.symmetry !== 'off' && state.symmetryAnchorMode === 'fixed' && state.tool === 'pen';
  if (!visible) { guide?.remove(); handle?.remove(); guide = handle = null; return; }
  if (!state.symmetryOrigin) {
    const rect = getViewportRect();
    state.symmetryOrigin = fromScreen(rect.width / 2, rect.height / 2);
  }
  if (!guide) {
    guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    guide.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:29;overflow:hidden';
    guide.setAttribute('aria-hidden', 'true'); els.viewport.append(guide);
    handle = document.createElement('button'); handle.type = 'button'; handle.textContent = '⊕';
    handle.setAttribute('aria-label', '对称轴心：拖动或方向键移动');
    handle.style.cssText = 'position:absolute;width:28px;height:28px;border-radius:50%;background:white;color:#7660bd;border:1px solid currentColor;z-index:31;touch-action:none;transform:translate(-50%,-50%)';
    handle.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      if (state.symmetryLocked || state.currentPath) return;
      event.currentTarget.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      event.stopPropagation();
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || state.symmetryLocked || state.currentPath) return;
      const rect = els.viewport.getBoundingClientRect();
      state.symmetryOrigin = fromScreen(event.clientX - rect.left, event.clientY - rect.top); updateSymmetryGuide();
    });
    for (const name of ['pointerup', 'pointercancel']) handle.addEventListener(name, event => {
      event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    });
    handle.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      if (state.symmetryLocked || state.currentPath) return;
      const p = boardToScreen(state.symmetryOrigin), step = event.shiftKey ? 10 : 1;
      state.symmetryOrigin = fromScreen(p.x + delta[0] * step, p.y + delta[1] * step); updateSymmetryGuide();
    });
    els.viewport.append(handle);
  }
  const p = boardToScreen(state.symmetryOrigin), angle = state.rotation * Math.PI / 180;
  const length = Math.hypot(els.viewport.clientWidth, els.viewport.clientHeight) + Math.hypot(p.x, p.y);
  guide.replaceChildren();
  for (const vertical of [true, false]) {
    if (state.symmetry !== 'cross' && state.symmetry !== (vertical ? 'vertical' : 'horizontal')) continue;
    const dx = Math.cos(angle + (vertical ? Math.PI / 2 : 0)) * length;
    const dy = Math.sin(angle + (vertical ? Math.PI / 2 : 0)) * length;
    const line = document.createElementNS(guide.namespaceURI, 'line');
    for (const [key, value] of Object.entries({ x1: p.x - dx, y1: p.y - dy, x2: p.x + dx, y2: p.y + dy, stroke: '#7660bd', 'stroke-dasharray': '5 5', 'stroke-opacity': '.65' })) line.setAttribute(key, value);
    guide.append(line);
  }
  handle.style.left = `${p.x}px`; handle.style.top = `${p.y}px`;
  handle.style.cursor = state.symmetryLocked ? 'default' : 'move';
  handle.title = state.symmetryLocked ? '对称轴心已锁定' : '拖动对称轴心；方向键微调';
}
