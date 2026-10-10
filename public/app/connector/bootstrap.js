import { els } from '../elements.js';
import { state } from '../state.js';
import { renderItem } from '../rendering.js';
import { trackPointer, getActiveTouchPointerIds, untrackPointer } from '../pan-model.js';
import { startPinch } from '../gestures.js';
import { setTool } from '../toolbar.js';

import { endpoints, resolve } from './binding.js';
import { schedule } from './controls.js';
import { captureTextSelection } from './creation.js';
import { cancel, candidate, finish, preview, start } from './draft.js';
import { endEdit, moveEdit, refreshLabels } from './editing.js';
import { render } from './rendering.js';
import { disableRouteWorker, dispatchRoute, markRouteFailure, notifyRouteFailure } from './routing.js';
import { stateRuntime } from './runtime/state.js';
import { cache, mounted, pending, staticAssetUrl, svg } from './state.js';
import {
  accepted,
  edgeGesture,
  edgeReplay,
  hitTest,
  invalidate,
  observe,
  prepareBroadcast,
  prepareExport,
  prepareOperation,
  preserveConflict,
  showConflictDrafts
} from './sync.js';

function initialize() {
  let suppressPointerClick = false;
  document.addEventListener('click', event => {
    if (!suppressPointerClick || event.detail === 0) return;
    suppressPointerClick = false;
    if (els.viewport.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  stateRuntime.internalLayer = svg('svg', { class: 'connection-internal-layer', 'aria-hidden': 'true' });
  els.board.append(stateRuntime.internalLayer);
  stateRuntime.overlay = document.createElement('div');
  stateRuntime.overlay.className = 'connection-controls';
  els.board.append(stateRuntime.overlay);
  stateRuntime.toolbar = document.createElement('div');
  stateRuntime.toolbar.className = 'connection-toolbar';
  stateRuntime.toolbar.hidden = true;
  stateRuntime.toolbar.setAttribute('role', 'toolbar');
  stateRuntime.toolbar.setAttribute('aria-label', '连接线设置');
  document.body.append(stateRuntime.toolbar);
  stateRuntime.selectionBar = document.createElement('div');
  stateRuntime.selectionBar.className = 'connection-text-toolbar';
  stateRuntime.selectionBar.hidden = true;
  document.body.append(stateRuntime.selectionBar);
  stateRuntime.targetBadge = document.createElement('div');
  stateRuntime.targetBadge.className = 'connection-target-badge';
  stateRuntime.targetBadge.hidden = true;
  document.body.append(stateRuntime.targetBadge);
  try {
    stateRuntime.worker = new Worker(staticAssetUrl('connector-worker.js'));
    stateRuntime.worker.onmessage = ({ data }) => {
      if (stateRuntime.workerBusy?.id !== data.id || stateRuntime.workerBusy.revision !== data.revision) return;
      clearTimeout(stateRuntime.workerTimer);
      stateRuntime.workerTimer = 0;
      stateRuntime.workerBusy = null;
      const latest = pending.get(data.id);
      if (latest?.revision === data.revision) pending.delete(data.id);
      else if (latest) {
        // Give other connectors a turn before computing this connector's latest position.
        pending.delete(data.id);
        pending.set(data.id, latest);
      }
      dispatchRoute();
      const entry = cache.get(data.id);
      if (!entry || entry.revision !== data.revision) return;
      if (data.result) {
        entry.result = data.result;
        const item = state.items.get(data.id);
        if (item && mounted(data.id)) renderItem(item);
      } else if (data.error) {
        markRouteFailure(data.id, '避障计算失败，当前显示临时路径');
        notifyRouteFailure('避障计算失败，当前显示临时路径');
      }
    };
    stateRuntime.worker.onerror = () => disableRouteWorker('避障计算不可用，当前显示临时路径');
    stateRuntime.worker.onmessageerror = () => disableRouteWorker('避障结果无法读取，当前显示临时路径');
  } catch {}
  document.addEventListener('selectionchange', () => requestAnimationFrame(captureTextSelection));
  document.addEventListener('compositionstart', () => {
    stateRuntime.composing = true;
  });
  document.addEventListener('compositionend', () => {
    stateRuntime.composing = false;
    captureTextSelection();
  });
  document.addEventListener(
    'pointermove',
    (e) => {
      stateRuntime.lastPointer = e;
      if (stateRuntime.edit) {
        if (stateRuntime.edit.pointerId === e.pointerId) {
          e.stopPropagation();
          moveEdit(e);
        }
        return;
      }
      if (stateRuntime.draft) {
        preview(e);
        return;
      }
      if (!e.buttons && !state.editingId && state.tool === 'connector' && !e.target.closest('.connection-controls')) {
        const c = candidate(e),
          item = c.terminal.binding?.kind === 'item' ? state.items.get(c.terminal.binding.id) : null,
          section = c.terminal.binding?.kind === 'section' ? state.sections.get(c.terminal.binding.id) : null;
        const next = c.terminal.binding ? { item, section, rect: c.rect, binding: c.terminal.binding } : null;
        if (JSON.stringify(stateRuntime.hovered?.binding) !== JSON.stringify(next?.binding)) {
          stateRuntime.hovered = next;
          schedule();
        }
      } else if (state.tool !== 'connector' && stateRuntime.hovered) {
        stateRuntime.hovered = null;
        schedule();
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      suppressPointerClick = false;
      stateRuntime.lastPointer = e;
      if (stateRuntime.draft && stateRuntime.targetTextMode) return;
      if (
        e.target.closest('.connection-text-toolbar,.connection-toolbar,.connection-controls') ||
        !els.viewport.contains(e.target) ||
        state.spacePan ||
        e.button !== 0
      )
        return;
      if (e.pointerType === 'touch' && (stateRuntime.draft || state.tool === 'connector')) {
        trackPointer(e);
        const ids = getActiveTouchPointerIds();
        if (ids.length === 2) {
          cancel();
          startPinch(
            ids.find((id) => id !== e.pointerId),
            e
          );
          e.stopImmediatePropagation();
          return;
        }
      }
      if (stateRuntime.draft && !stateRuntime.draft.dragging) {
        suppressPointerClick = true;
        e.stopImmediatePropagation();
        e.preventDefault();
        finish(e);
      } else if (state.tool === 'connector' && !e.target.closest('[contenteditable="true"],.connector-item')) {
        suppressPointerClick = true;
        e.stopImmediatePropagation();
        trackPointer(e);
        start(e);
      }
    },
    true
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      if (stateRuntime.edit?.pointerId === e.pointerId) {
        e.stopImmediatePropagation();
        untrackPointer(e);
        endEdit();
        return;
      }
      if (stateRuntime.draft?.pointerId === e.pointerId) {
        if (
          stateRuntime.draft.dragging ||
          Math.hypot(e.clientX - stateRuntime.draft.down.x, e.clientY - stateRuntime.draft.down.y) > 5
        ) {
          e.stopImmediatePropagation();
          suppressPointerClick = true;
          finish(e);
        } else stateRuntime.draft.pointerId = null;
      }
      schedule();
    },
    true
  );
  document.addEventListener(
    'pointercancel',
    () => {
      endEdit(true);
      cancel();
    },
    true
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        endEdit(true);
        cancel();
      }
      if (e.key === ' ') {
        schedule();
      }
      if (
        e.key.toLowerCase() === 'l' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.target.closest('input,textarea,[contenteditable="true"]')
      ) {
        setTool('connector');
        schedule();
      }
    },
    true
  );
  window.addEventListener('blur', () => {
    endEdit(true);
    cancel();
  });
  const observer = new MutationObserver(() => {
    if (!els.board.contains(stateRuntime.internalLayer)) els.board.append(stateRuntime.internalLayer);
    if (!els.board.contains(stateRuntime.overlay)) els.board.append(stateRuntime.overlay);
    schedule();
  });
  observer.observe(els.board, { attributes: true, attributeFilter: ['style', 'data-tool'], childList: true });
  const existing = document.getElementById('contextConnectorSection');
  if (existing) existing.hidden = true;
  schedule();
}

window.ConnectorUI = {
  render,
  refreshLabels,
  endpoints,
  start,
  preview,
  finish,
  cancel,
  invalidate,
  schedule,
  observe,
  accepted,
  prepareBroadcast,
  prepareOperation,
  resolve,
  preserveConflict,
  showConflictDrafts,
  prepareExport,
  hitTest,
  edgeGesture,
  edgeReplay
};

export { initialize };
