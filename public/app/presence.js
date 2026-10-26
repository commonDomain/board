import { isPhoneViewer } from './phone-view-model.js';
import { boardToScreen } from './camera-model.js';
import { getBoardPoint } from './camera.js';
import { els } from './elements.js';

import { canvasInteraction, getInteractionViewportClientBounds } from './pan.js';
import { state } from './state.js';
import { cursorColorFor, cursorNameFor } from './presence-model.js';
import { eventsRuntime } from './runtime/events.js';
import { createLatestPresenceSender, PRESENCE_BUFFER_LIMIT, CURSOR_IDLE_MS } from './presence-channel-model.js';

let renderFrame = null, expiryTimer = null, localCursorVisible = false;
const cursorSender = createLatestPresenceSender(({ socket, epoch, boardId, point }) => {
  if (socket !== state.socket || epoch !== state.canvasEpoch || boardId !== state.boardId ||
      !state.joined || document.hidden || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > PRESENCE_BUFFER_LIMIT) return;
  try {
    socket.send(JSON.stringify({ type: 'cursor', x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }));
    localCursorVisible = true;
  } catch { /* Pointer presence can be dropped; the reliable outbox owns edits. */ }
});

function scheduleCursorRender() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; renderCursors(); });
}

function armCursorExpiry() {
  if (!state.cursors.size) { clearTimeout(expiryTimer); expiryTimer = null; return; }
  if (expiryTimer !== null) return;
  const expiresAt = Math.min(...[...state.cursors.values()].map(cursor => cursor.lastSeen + CURSOR_IDLE_MS));
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    for (const [id, cursor] of state.cursors) if (Date.now() - cursor.lastSeen >= CURSOR_IDLE_MS) state.cursors.delete(id);
    scheduleCursorRender(); armCursorExpiry();
  }, Math.max(1, expiresAt - Date.now()));
}

function hideLocalCursor() {
  cursorSender.clear();
  if (localCursorVisible && state.socket?.readyState === WebSocket.OPEN && state.joined) {
    try { state.socket.send(JSON.stringify({ type: 'cursor', hidden: true })); } catch {}
  }
  localCursorVisible = false;
}

function resetCursorPresence() {
  cursorSender.clear(); localCursorVisible = false;
  clearTimeout(expiryTimer); expiryTimer = null;
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
  state.cursors.clear();
  els.cursorsLayer?.replaceChildren();
}

function wireCursorPresence() {
  eventsRuntime.resetCursorPresence = resetCursorPresence;
  els.viewport.addEventListener('pointerleave', hideLocalCursor);
  window.addEventListener('blur', hideLocalCursor);
  window.addEventListener('pagehide', hideLocalCursor);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideLocalCursor(); });
}

function updatePresence(clients, maxClients, clientIds, users = null, connectionIds = null) {
  els.presenceText.textContent = `${clients || 0}/${maxClients || 25}`;
  if (Array.isArray(users))
    state.presenceUsers = new Map(users.filter((user) => user?.id).map((user) => [user.id, user]));
  if (Array.isArray(clientIds)) {
    const active = new Set(connectionIds || clientIds);
    for (const id of Array.from(state.cursors.keys())) {
      if (!active.has(connectionIds ? id : state.cursors.get(id).userId || id)) {
        state.cursors.delete(id);
      }
    }
    scheduleCursorRender(); armCursorExpiry();
  }
  
}

function updateRemoteCursor(message) {
  if (!message || typeof message.from !== 'string') {
    return;
  }
  const id = message.cursorId || message.from;
  if (id === state.socketClientId) return;
  if (message.hidden) {
    state.cursors.delete(id);
    scheduleCursorRender(); armCursorExpiry();
    return;
  }
  const x = Number(message.x);
  const y = Number(message.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const existing = state.cursors.get(id);
  state.cursors.set(id, {
    x,
    y,
    userId: message.from,
    color: existing ? existing.color : cursorColorFor(message.from),
    name: existing ? existing.name : cursorNameFor(message.from),

    lastSeen: Date.now()
  });
  scheduleCursorRender(); armCursorExpiry();
}

function renderCursors() {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
  if (isPhoneViewer()) return;
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
    node.querySelector('.cursor-name').textContent = cursorNameFor(cursor.userId || id);
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
  if (event.target && !els.viewport.contains(event.target)) { hideLocalCursor(); return; }
  if (event.pointerType === 'touch' || document.hidden) {
    return;
  }
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }
  const point = getBoardPoint(event);
  cursorSender.push({ socket: state.socket, boardId: state.boardId, epoch: state.canvasEpoch, point });
}
export { updatePresence, updateRemoteCursor, renderCursors, renderGuides, clearGuides, sendCursorFromEvent, wireCursorPresence, resetCursorPresence, hideLocalCursor };
