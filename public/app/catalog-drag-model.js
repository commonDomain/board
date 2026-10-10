import { clamp } from './utilities.js';

function untransformedVerticalRect(element) {
  const rect = element.getBoundingClientRect();
  const transform = getComputedStyle(element).transform;
  let translateY = 0;
  if (transform && transform !== 'none') {
    const values =
      transform
        .match(/^matrix(?:3d)?\((.+)\)$/)?.[1]
        .split(',')
        .map(Number) || [];
    translateY = values.length === 16 ? values[13] : values.length === 6 ? values[5] : 0;
  }
  return { top: rect.top - translateY, bottom: rect.bottom - translateY, height: rect.height };
}

function dragRetreatMagnitude(distanceFromTarget, rowHeight) {
  const floor = Math.max(8, rowHeight * 0.2);
  const peak = Math.min(28, Math.max(22, rowHeight * 0.6));
  return floor + (peak - floor) * Math.exp(-distanceFromTarget * 0.48);
}

function createCanvasDragGhost(row, event) {
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.className = 'canvas-list-item canvas-drag-ghost';
  ghost.removeAttribute('data-canvas-id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1;
  });
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
  document.body.appendChild(ghost);
  const ghostState = {
    element: ghost,
    originRect: rect,
    startX: event.clientX,
    startY: event.clientY,
    deltaX: 0,
    deltaY: 0,
    liftFrame: null,
    settled: false
  };
  ghostState.liftFrame = requestAnimationFrame(() => {
    ghostState.liftFrame = null;
    if (!ghostState.settled && ghost.isConnected) ghost.classList.add('is-lifted');
  });
  return ghostState;
}

function moveCanvasDragGhost(ghostState, event) {
  if (!ghostState?.element?.isConnected) return;
  ghostState.deltaX = Math.round((event.clientX - ghostState.startX) * 1.2) / 10;
  ghostState.deltaY = Math.round((event.clientY - ghostState.startY) * 10) / 10;
  const bendAngle = clamp(ghostState.deltaX * 0.045, -2.5, 2.5);
  const bendSkew = clamp(ghostState.deltaY * -0.012, -1.8, 1.8);
  ghostState.element.style.setProperty('--drag-bend-angle', `${bendAngle}deg`);
  ghostState.element.style.setProperty('--drag-bend-skew', `${bendSkew}deg`);
  ghostState.element.style.transform = `translate3d(${ghostState.deltaX}px, ${ghostState.deltaY}px, 0) rotate(${bendAngle}deg) skewX(${bendSkew}deg) scale(1.018)`;
}

function settleCanvasDragGhost(ghostState, destinationRect = null) {
  if (!ghostState || ghostState.settled) return;
  ghostState.settled = true;
  if (ghostState.liftFrame !== null) cancelAnimationFrame(ghostState.liftFrame);
  ghostState.liftFrame = null;
  if (!ghostState.element?.isConnected) return;
  const destination = destinationRect || ghostState.originRect;
  ghostState.element.classList.add('is-settling');
  ghostState.element.style.setProperty('--drag-bend-angle', '0deg');
  ghostState.element.style.setProperty('--drag-bend-skew', '0deg');
  ghostState.element.style.transform = `translate3d(${destination.left - ghostState.originRect.left}px, ${destination.top - ghostState.originRect.top}px, 0) scale(1)`;
  ghostState.element.style.opacity = '0';
  setTimeout(() => ghostState.element.remove(), 260);
}
export {
  untransformedVerticalRect,
  dragRetreatMagnitude,
  createCanvasDragGhost,
  moveCanvasDragGhost,
  settleCanvasDragGhost
};
