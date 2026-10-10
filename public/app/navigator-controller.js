import { els } from './elements.js';
import { updateContextPanel } from './format-panel.js';
import { arrangeSelection } from './groups.js';
import { renderNavigator } from './navigator-rendering.js';
import { closeGlobalSearch, onGlobalSearchKeyDown, openGlobalSearch, runGlobalSearch } from './search.js';
import { createSectionAroundSelection } from './sections.js';
import { getSelectedIds } from './selection-model.js';
import { state } from './state.js';
import { restoreNavigationTool } from './toolbar.js';
import { debounce, isImeEvent } from './utilities.js';

function setNavigatorSearchOpen(open, options = {}) {
  if (!els.navigatorSearch || !els.navigatorSearchInput) return;
  els.navigatorSearch.classList.toggle('is-open', open);
  els.navigatorPanel?.classList.toggle('is-searching', open);
  els.navigatorSearchButton?.setAttribute('aria-expanded', String(open));
  els.navigatorSearchButton?.setAttribute('aria-label', open ? '搜索当前画布内容' : '展开内容搜索');
  els.navigatorSearchInput.tabIndex = open ? 0 : -1;
  if (options.clear) {
    els.navigatorSearchInput.value = '';
    state.navigatorQuery = '';
    if (!els.navigatorPanel?.hidden) renderNavigator();
  }
  if (open) {
    requestAnimationFrame(() => els.navigatorSearchInput?.focus({ preventScroll: true }));
  } else if (options.restoreFocus !== false && !els.navigatorPanel?.hidden) {
    els.navigatorSearchButton?.focus({ preventScroll: true });
  }
}

function wireOrganizationFeatures() {
  els.navigatorButton?.addEventListener('click', () => setNavigatorOpen(els.navigatorPanel.hidden));
  els.navigatorCloseButton?.addEventListener('click', () => setNavigatorOpen(false));
  els.navigatorSearchButton?.addEventListener('click', () => {
    if (!els.navigatorSearch?.classList.contains('is-open')) setNavigatorSearchOpen(true);
    else els.navigatorSearchInput?.focus({ preventScroll: true });
  });
  els.navigatorSearchInput?.addEventListener('input', () => {
    state.navigatorQuery = els.navigatorSearchInput.value;
    if (els.navigatorTree) els.navigatorTree.scrollTop = 0;
    renderNavigator();
  });
  els.navigatorSearchInput?.addEventListener('keydown', (event) => {
    if (isImeEvent(event) || event.key !== 'Escape') return;
    event.preventDefault();
    setNavigatorSearchOpen(false, { clear: true });
  });
  els.navigatorExpandAll?.addEventListener('click', () => {
    if (state.navigatorQuery.trim()) {
      els.navigatorSearchInput.value = '';
      state.navigatorQuery = '';
      renderNavigator();
      els.navigatorSearchInput.focus({ preventScroll: true });
      return;
    }
    for (const section of state.sections.values()) state.navigatorExpanded.add(`section:${section.id}`);
    for (const group of state.groups.values()) state.navigatorExpanded.add(`group:${group.id}`);
    renderNavigator();
  });
  els.navigatorTree?.addEventListener('scroll', debounce(renderNavigator, 30));
  els.globalSearchButton?.addEventListener('click', openGlobalSearch);
  els.globalSearchDialog?.addEventListener('pointerdown', (event) => {
    if (event.target === els.globalSearchDialog) closeGlobalSearch();
  });
  els.globalSearchInput?.addEventListener('input', debounce(runGlobalSearch, 180));
  els.globalSearchInput?.addEventListener('keydown', onGlobalSearchKeyDown);
  document.querySelectorAll('[data-arrange]').forEach((button) => {
    button.addEventListener('click', () => arrangeSelection(button.dataset.arrange));
  });
  document.getElementById('sectionButton')?.addEventListener('click', () => {
    if (getSelectedIds().length) {
      createSectionAroundSelection();
      restoreNavigationTool();
    }
  });
}

function setNavigatorOpen(open) {
  if (!els.navigatorPanel) return;
  els.navigatorPanel.hidden = !open;
  els.navigatorButton?.setAttribute('aria-expanded', String(open));
  if (open) {
    if (els.contextPanel) els.contextPanel.hidden = true;
    renderNavigator();
  } else {
    setNavigatorSearchOpen(false, { clear: true, restoreFocus: false });
    updateContextPanel();
  }
}

let organizationRefreshFrame = null;

let organizationRefreshTimer = null;

function refreshOrganizationUi() {
  const animationDelay = Math.max(0, Number(state.navigatorAnimationUntil || 0) - performance.now());
  if (animationDelay > 0) {
    clearTimeout(organizationRefreshTimer);
    organizationRefreshTimer = setTimeout(() => {
      organizationRefreshTimer = null;
      refreshOrganizationUi();
    }, animationDelay + 18);
    return;
  }
  if (organizationRefreshFrame) return;
  organizationRefreshFrame = requestAnimationFrame(() => {
    organizationRefreshFrame = null;
    if (!els.navigatorPanel?.hidden) renderNavigator();
  });
}

const NAVIGATOR_ICON_ART = {
  section:
    '<rect x="3" y="4" width="22" height="20" rx="3" fill="#faf9ff" stroke="#aaa5d7"/><path d="M3 7a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v3H3z" fill="#7465da"/><circle cx="6" cy="7" r="1" fill="#d8d2ff"/><path d="M7 14h14M7 18h10" stroke="#b6b0d9" stroke-width="1.6" stroke-linecap="round"/>',
  group:
    '<rect x="3" y="7" width="19" height="16" rx="2" fill="#b6a2ee" stroke="#836cc5"/><path d="M4 6a2 2 0 0 1 2-2h6l2 3H4z" fill="#d8ccfa"/><rect x="8" y="10" width="17" height="14" rx="2" fill="#efe9ff" stroke="#8a70c9"/><path d="M11 14h11M11 18h8" stroke="#baa9e8" stroke-width="1.5"/>',
  root: '<path d="M4 8h20v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#b9c4d3" stroke="#788699"/><path d="M4 8l3-4h14l3 4" fill="#e6ebf1" stroke="#788699"/><path d="M4 15h6l2 3h4l2-3h6" fill="none" stroke="#fff" stroke-width="1.8"/>',
  text: '<rect x="5" y="3" width="18" height="22" rx="2" fill="#fffdf8" stroke="#c1bcb4"/><path d="M8 9h12M8 12h11M8 15h12M8 18h8" stroke="#a9a49b" stroke-width="1.3" stroke-linecap="round"/><path d="M9 6h9" stroke="#555f78" stroke-width="2" stroke-linecap="round"/>',
  note: '<path d="M4 4h20v15l-5 5H4z" fill="#ffe68a" stroke="#d8b857"/><path d="M19 24v-5h5" fill="#f6c95e" stroke="#d8b857"/><path d="M8 10h12M8 14h10M8 18h6" stroke="#b18a37" stroke-width="1.5" stroke-linecap="round"/>',
  table:
    '<rect x="3" y="4" width="22" height="20" rx="2" fill="#f7fffb" stroke="#70ae9e"/><path d="M4 5h20v5H4z" fill="#42a58d"/><path d="M10 10v13M17 10v13M4 16h20" stroke="#83bba9" stroke-width="1.4"/><path d="M7 7h10" stroke="#eafff8" stroke-width="1.2"/>',
  mindmap:
    '<rect x="2" y="3" width="24" height="22" rx="3" fill="#fffdf9" stroke="#d8c9bd"/><path d="M10 14h5m0 0V8h3m-3 6v6h3" fill="none" stroke="#a49aaf" stroke-width="1.5"/><rect x="4" y="10" width="7" height="8" rx="2" fill="#f3b47a" stroke="#cf8758"/><rect x="18" y="5" width="6" height="6" rx="2" fill="#89b8e8" stroke="#6298cc"/><rect x="18" y="17" width="6" height="6" rx="2" fill="#b49adc" stroke="#9277c6"/>',
  kdocs:
    '<path d="M6 2h11l5 5v18H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fafdff" stroke="#8fa8c4"/><path d="M17 2v5h5" fill="#d4e5f7" stroke="#8fa8c4"/><path d="M8 12h11M8 16h11M8 20h8" stroke="#7a9bbf" stroke-width="1.5" stroke-linecap="round"/>',
  ink: '<path d="M19 3l6 6-14 14-6 2 2-6z" fill="#d8c7f0" stroke="#8566aa"/><path d="M16 6l6 6" stroke="#74548f" stroke-width="2"/><path d="M7 19l4 4-6 2z" fill="#554c66"/><path d="M3 26h19" stroke="#9d84ba" stroke-width="1.5" stroke-linecap="round"/>',
  image:
    '<rect x="2" y="4" width="24" height="20" rx="3" fill="#fff" stroke="#aebccc"/><path d="M4 7h20v14H4z" fill="#9ad3f0"/><path d="M4 18l7-7 6 6 3-3 4 4v3H4z" fill="#619b70"/><path d="M4 20l9-7 7 8H4z" fill="#477e61"/><circle cx="19" cy="10" r="2.4" fill="#ffe1a0"/><path d="M4 21h20" stroke="#6c8e73" stroke-width="1"/>',
  shape:
    '<circle cx="9" cy="10" r="6" fill="#f7b972" stroke="#d78a4a"/><rect x="13" y="13" width="12" height="11" rx="2" fill="#8dbde3" stroke="#6698c2"/><path d="M4 24l6-10 6 10z" fill="#a59bdb" stroke="#8275bd"/>',
  connector:
    '<path d="M8 9h7a4 4 0 0 1 4 4v6" fill="none" stroke="#7d95b8" stroke-width="2.4"/><circle cx="7" cy="9" r="4" fill="#b9d1ef" stroke="#6e92bc"/><circle cx="20" cy="20" r="4" fill="#ffe0ad" stroke="#d2a462"/><circle cx="7" cy="9" r="1.5" fill="#fff"/><circle cx="20" cy="20" r="1.5" fill="#fff"/>',
  sticker:
    '<path d="M14 2l3.1 7.7L25 10l-6 5 2 8-7-4.4L7 23l2-8-6-5 7.9-.3z" fill="#f7cd67" stroke="#d5a64a"/><path d="M10 9l4-5 2 6" fill="#fff1bf" opacity=".7"/>',
  'amap-map':
    '<path d="M2 6l8-3 8 3 8-3v18l-8 3-8-3-8 3z" fill="#eaf5dc" stroke="#91ad7e"/><path d="M10 3v18M18 6v18" stroke="#a2b99c" stroke-width="1.3"/><path d="M4 17l7-5 7 4 6-7" fill="none" stroke="#e8b47c" stroke-width="2"/><circle cx="18" cy="10" r="2" fill="#d7786f"/>',
  'amap-search':
    '<path d="M18 18l7 7" stroke="#735f54" stroke-width="3.5" stroke-linecap="round"/><circle cx="12" cy="12" r="8" fill="#d8eff8" stroke="#879eac" stroke-width="2.6"/><path d="M8 13l3-4 3 2 3-3" fill="none" stroke="#69a989" stroke-width="1.8"/><circle cx="16" cy="8" r="1.4" fill="#e7a571"/>',
  'amap-route':
    '<path d="M7 7v12a4 4 0 0 0 4 4h7a4 4 0 0 0 4-4V9" fill="none" stroke="#97b1a2" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 2"/><path d="M7 3a4 4 0 0 0-4 4c0 3 4 7 4 7s4-4 4-7a4 4 0 0 0-4-4z" fill="#e88a73" stroke="#bf6454"/><circle cx="7" cy="7" r="1.3" fill="#fff"/><circle cx="22" cy="20" r="3.5" fill="#86b6db" stroke="#6190ba"/>',
  fallback: '<rect x="4" y="4" width="20" height="20" rx="4" fill="#e8eaf0" stroke="#a3aaba"/>'
};
export {
  setNavigatorSearchOpen,
  wireOrganizationFeatures,
  setNavigatorOpen,
  organizationRefreshFrame,
  organizationRefreshTimer,
  refreshOrganizationUi,
  NAVIGATOR_ICON_ART
};
