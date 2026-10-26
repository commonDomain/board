import { impactState } from './impact-state.js';
import { decorateConnector } from './impact-effects.js';
import { decorateSection } from './impact-effects.js';
import { decorateNode } from './impact-effects.js';
import { els } from './elements.js';
import { state } from './state.js';
import { selectItem } from './selection.js';
import { collect, graphSignature } from './impact-graph.js';
import { refreshMounted, rerenderEdges, startSparks, stopSparks } from './impact-effects.js';
import { button, renderPanel, refreshPanelLabels } from './impact-panel.js';
import { fitNetwork } from './impact-camera.js';
import { reducedMotion, itemNode, sectionNode, entity } from './impact-primitives.js';

function finish() {
  if (!impactState.active) return;
  const oldEdges = [...impactState.active.edges.keys()];
  impactState.active = null;
  clearTimeout(impactState.phaseTimer);
  clearTimeout(impactState.readyTimer);
  clearTimeout(impactState.refreshTimer);
  if (!els.viewport.classList.contains('impact-camera-moving')) {
    clearTimeout(impactState.cameraTimer);
    els.board.style.transition = '';
  }
  delete els.viewport.dataset.impactPhase;
  els.viewport.classList.remove('impact-active', 'impact-lightweight', 'impact-connector-editing');
  document.body.classList.remove('impact-mode', 'impact-properties-open');
  if (impactState.returnButton) impactState.returnButton.hidden = true;
  impactState.panel?.remove();
  impactState.panel = null;
  stopSparks();
  refreshMounted();
  rerenderEdges(oldEdges);
  syncTrigger();
}

function start() {
  const selected = impactState.selectedSectionId
    ? state.sections.get(impactState.selectedSectionId)
    : state.items.get(state.selectedId);
  if (!selected || selected.type === 'connector' || !state.connectorIndex.get(selected.id)?.size) return;
  if (impactState.active) finish();
  impactState.cameraMode = 'all';
  impactState.active = collect(selected.id);
  if (impactState.active.nodes.size < 2) {
    impactState.active = null;
    return;
  }
  impactState.trigger.hidden = true;
  els.viewport.classList.add('impact-active');
  els.viewport.classList.toggle('impact-lightweight', els.board.querySelectorAll('.board-item').length > 180);
  document.body.classList.add('impact-mode');
  els.viewport.dataset.impactPhase = 'fitting';
  refreshMounted();
  rerenderEdges(impactState.active.edges.keys());
  renderPanel();
  fitNetwork();
  startSparks();
  impactState.phaseTimer = setTimeout(
    () => {
      if (!impactState.active) return;
      els.viewport.dataset.impactPhase = reducedMotion() ? 'ready' : 'intro';
    },
    reducedMotion() ? 0 : 580
  );
  impactState.readyTimer = setTimeout(
    () => {
      if (impactState.active) els.viewport.dataset.impactPhase = 'ready';
    },
    reducedMotion() ? 0 : 2020
  );
}

function syncTrigger() {
  if (impactState.triggerFrame) return;
  impactState.triggerFrame = requestAnimationFrame(() => {
    impactState.triggerFrame = 0;
    if (!impactState.trigger) return;
    if (impactState.active && impactState.active.boardId !== state.boardId) finish();
    const selected =
      !impactState.active &&
      (impactState.selectedSectionId
        ? state.sections.get(impactState.selectedSectionId)
        : state.items.get(state.selectedId));
    if (
      !selected ||
      selected.type === 'connector' ||
      !state.connectorIndex.get(selected.id)?.size ||
      state.editingId ||
      els.viewport.classList.contains('impact-camera-moving')
    ) {
      impactState.trigger.hidden = true;
      return;
    }
    const node = state.sections.has(selected.id) ? sectionNode(selected.id) : itemNode(selected.id);
    if (!node) {
      impactState.trigger.hidden = true;
      return;
    }
    const box = node.getBoundingClientRect();
    const view = els.viewport.getBoundingClientRect();
    if (box.right < view.left || box.left > view.right || box.bottom < view.top || box.top > view.bottom) {
      impactState.trigger.hidden = true;
      return;
    }
    const buttonHalfWidth = 62;
    const buttonHeight = 27;
    const bottomY = box.bottom + 6;
    impactState.trigger.dataset.side = bottomY + buttonHeight <= view.bottom - 4 ? 'bottom' : 'top';
    impactState.trigger.style.left = `${Math.max(view.left + buttonHalfWidth + 4, Math.min(view.right - buttonHalfWidth - 4, box.left + box.width / 2))}px`;
    impactState.trigger.style.top = `${impactState.trigger.dataset.side === 'bottom' ? bottomY : Math.max(view.top + 4, box.top - buttonHeight - 6)}px`;
    impactState.trigger.hidden = false;
  });
}

function invalidate() {
  if (!impactState.active || impactState.refreshTimer) return;
  impactState.refreshTimer = setTimeout(() => {
    impactState.refreshTimer = 0;
    if (!impactState.active) return;
    if (!entity(impactState.active.rootId)) {
      finish();
      return;
    }
    const previous = impactState.active;
    impactState.active = collect(previous.rootId);
    const topologyChanged = graphSignature(previous) !== graphSignature(impactState.active);
    if (!topologyChanged) {
      refreshPanelLabels();
      return;
    }
    refreshMounted();
    rerenderEdges(new Set([...previous.edges.keys(), ...impactState.active.edges.keys()]));
    renderPanel(true);
  }, 180);
}

function initialize() {
  impactState.trigger = button('✦ 影响分析', start, 'impact-trigger');
  impactState.trigger.hidden = true;
  impactState.trigger.setAttribute('aria-label', '影响分析');
  document.body.append(impactState.trigger);
  impactState.returnButton = button(
    '← 返回关系图',
    () => {
      document.body.classList.remove('impact-properties-open');
      impactState.returnButton.hidden = true;
    },
    'impact-return'
  );
  impactState.returnButton.hidden = true;
  document.body.append(impactState.returnButton);
  document.addEventListener(
    'pointerdown',
    (event) => {
      const frame = event.target.closest?.('.section-frame[data-section-id]');
      if (frame && state.connectorIndex.get(frame.dataset.sectionId)?.size) {
        impactState.selectedSectionId = frame.dataset.sectionId;
        if (state.selectedId) selectItem(null);
        syncTrigger();
      } else if (impactState.selectedSectionId && els.viewport.contains(event.target)) {
        impactState.selectedSectionId = null;
        syncTrigger();
      }
    },
    true
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && impactState.active && !event.target.closest('input,textarea,[contenteditable=true]'))
      finish();
  });
  syncTrigger();
}

window.ConnectorImpact = {
  decorateNode,
  decorateSection,
  decorateConnector,
  rerenderEdges,
  syncTrigger,
  invalidate,
  start,
  finish
};

export { finish, start, syncTrigger, invalidate, initialize };
