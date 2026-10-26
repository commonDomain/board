function createNavigatorDragGhost(element, event) {
  const rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true);
  ghost.className = 'navigator-row navigator-drag-ghost';
  ghost.removeAttribute('data-type');
  ghost.removeAttribute('data-id');
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
  requestAnimationFrame(() => ghost.classList.add('is-lifted'));
  return { element: ghost, originRect: rect, startX: event.clientX, startY: event.clientY, deltaX: 0, deltaY: 0 };
}

function moveNavigatorDragGhost(ghostState, event) {
  if (!ghostState?.element?.isConnected) return;
  ghostState.deltaX = Math.round((event.clientX - ghostState.startX) * 1.2) / 10;
  ghostState.deltaY = Math.round((event.clientY - ghostState.startY) * 10) / 10;
  ghostState.element.style.transform = `translate3d(${ghostState.deltaX}px, ${ghostState.deltaY}px, 0) scale(1.018)`;
}

function settleNavigatorDragGhost(ghostState, destinationRect = null) {
  if (!ghostState?.element?.isConnected) return;
  const destination = destinationRect || ghostState.originRect;
  const translateX = destination.left - ghostState.originRect.left;
  const translateY = destination.top - ghostState.originRect.top;
  ghostState.element.classList.add('is-settling');
  ghostState.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(1)`;
  ghostState.element.style.opacity = '0';
  setTimeout(() => ghostState.element.remove(), 260);
}
export { createNavigatorDragGhost, moveNavigatorDragGhost, settleNavigatorDragGhost };
