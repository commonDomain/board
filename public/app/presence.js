import { boardToScreen } from './camera-model.js';
import { getBoardPoint } from './camera.js';
import { els } from './elements.js';

import { canvasInteraction, getInteractionViewportClientBounds } from './pan.js';
import { state } from './state.js';
import { cursorColorFor, cursorNameFor } from './presence-model.js';

function updatePresence(clients, maxClients, clientIds, users = null) {
  els.presenceText.textContent = `${clients || 0}/${maxClients || 25}`;
  if (Array.isArray(users))
    state.presenceUsers = new Map(users.filter((user) => user?.id).map((user) => [user.id, user]));
  if (Array.isArray(clientIds)) {
    const active = new Set(clientIds);
    for (const id of Array.from(state.cursors.keys())) {
      if (!active.has(id)) {
        state.cursors.delete(id);
      }
    }
    renderCursors();
  }
  
}

function updateRemoteCursor(message) {
  if (!message || typeof message.from !== 'string') {
    return;
  }
  const x = Number(message.x);
  const y = Number(message.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const existing = state.cursors.get(message.from);
  state.cursors.set(message.from, {
    x,
    y,
    color: existing ? existing.color : cursorColorFor(message.from),
    name: existing ? existing.name : cursorNameFor(message.from),

    lastSeen: Date.now()
  });
  renderCursors();
}

function renderCursors() {
  if (!els.cursorsLayer) {
    return;
  }
  const existing = new Map(Array.from(els.cursorsLayer.children).map((node) => [node.dataset.cursorId, node]));
  for (const [id, cursor] of state.cursors) {
    let node = existing.get(id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'cursor-chip';
      node.dataset.cursorId = id;
      const dot = document.createElement('span');
      dot.className = 'cursor-dot';
      const name = document.createElement('span');
      name.className = 'cursor-name';
      node.append(dot, name);
      els.cursorsLayer.appendChild(node);
    }
    node.querySelector('.cursor-dot').style.background = cursor.color;
    node.querySelector('.cursor-name').textContent = cursor.name;
    const screen = boardToScreen(cursor);
    node.style.left = `${screen.x}px`;
    node.style.top = `${screen.y}px`;
    existing.delete(id);
  }
  for (const node of existing.values()) {
    node.remove();
  }
}

function renderGuides() {
  if (!els.guidesLayer) {
    return;
  }
  els.guidesLayer.textContent = '';
  const hasVertical = state.guides.v !== null && Number.isFinite(state.guides.v);
  const hasHorizontal = state.guides.h !== null && Number.isFinite(state.guides.h);
  if (!hasVertical && !hasHorizontal) return;
  const viewportBounds = getInteractionViewportClientBounds();
  const guideOptions = {
    camera: state.camera,
    zoom: state.zoom,
    rotation: state.rotation,
    viewportWidth: viewportBounds.viewportWidth,
    viewportHeight: viewportBounds.viewportHeight
  };
  if (hasVertical) {
    const line = document.createElement('div');
    line.className = 'guide-line-v';
    const segment = canvasInteraction?.getGuideSegment?.({ ...guideOptions, axis: 'v', value: state.guides.v });
    if (segment) {
      line.style.left = `${segment.x}px`;
      line.style.top = `${segment.y - segment.length / 2}px`;
      line.style.height = `${segment.length}px`;
      line.style.transform = `rotate(${segment.rotation}deg)`;
      line.style.transformOrigin = '50% 50%';
      els.guidesLayer.appendChild(line);
    }
  }
  if (hasHorizontal) {
    const line = document.createElement('div');
    line.className = 'guide-line-h';
    const segment = canvasInteraction?.getGuideSegment?.({ ...guideOptions, axis: 'h', value: state.guides.h });
    if (segment) {
      line.style.left = `${segment.x - segment.length / 2}px`;
      line.style.top = `${segment.y}px`;
      line.style.width = `${segment.length}px`;
      line.style.transform = `rotate(${segment.rotation}deg)`;
      line.style.transformOrigin = '50% 50%';
      els.guidesLayer.appendChild(line);
    }
  }
}

function clearGuides() {
  state.guides = { v: null, h: null };
  renderGuides();
}

function sendCursorFromEvent(event) {
  if (event.pointerType && event.pointerType !== 'mouse') {
    return;
  }
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }
  const point = getBoardPoint(event);
  const now = Date.now();
  if (
    state.lastCursorSent &&
    now - state.lastCursorSent.time < 40 &&
    Math.hypot(point.x - state.lastCursorSent.x, point.y - state.lastCursorSent.y) < 4
  ) {
    return;
  }
  state.lastCursorSent = { x: point.x, y: point.y, time: now };
  state.socket.send(
    JSON.stringify({
      type: 'cursor',
      clientId: state.clientId,
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,

    })
  );
}
export { updatePresence, updateRemoteCursor, renderCursors, renderGuides, clearGuides, sendCursorFromEvent };
