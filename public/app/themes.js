import { DEFAULT_THEME, THEMES, isThemeId, normalizeTheme, resolveCanvasTheme, sanitizeThemePreferences } from './theme-model.js';
import { refreshIcons, showToast, openMenuSurface, closeMenuSurface } from './interface-model.js';
import { closePopovers } from './popovers.js';
import { placeAnchoredMenu } from './menu-placement.js';
import { state } from './state.js';
import { initializeToolWheel } from './tool-wheel.js';

// Interface themes are personal (per account, per canvas). They only change the
// application shell; canvas content, sync and history are never touched.
const BOOT_KEY = 'wb:theme:boot';
const LABELS_KEY = 'wb:dock-labels';
const CACHE_PREFIX = 'wb:themes:v1:';
const root = document.documentElement;

let preferences = { default: DEFAULT_THEME, canvases: {} };
let accountKey = null;
let applied = root.dataset.theme || DEFAULT_THEME;
let sheetPromise = null;
let loadGeneration = 0;
let applyGeneration = 0;
let menu = null;
let trigger = null;
let labelsToggle = null;
let syncController = null;
let layoutResize = false;

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ } }

function currentAccountKey() {
  const account = window.MuseAccount;
  const id = account?.session?.user?.id;
  return !account?.isGuest?.() && id ? `user:${id}` : 'guest';
}
const signedIn = () => accountKey?.startsWith('user:');

function readCache(key) {
  try { return sanitizeThemePreferences(JSON.parse(storageGet(CACHE_PREFIX + key) || 'null')); }
  catch { return sanitizeThemePreferences(null); }
}
function writeCache() { if (accountKey) storageSet(CACHE_PREFIX + accountKey, JSON.stringify(preferences)); }

function themeSheetHref(fingerprinted = true) {
  const build = root.dataset.staticBuild;
  return fingerprinted && build ? `static/${build}/themes.css` : 'themes.css';
}

// One stylesheet holds every non-classic theme. It is loaded on first need and
// then served from the immutable fingerprinted cache.
function loadThemeSheet() {
  const existing = document.getElementById('museThemeSheet');
  if (existing?.sheet) return Promise.resolve();
  if (sheetPromise) return sheetPromise;
  const generation = ++loadGeneration;
  sheetPromise = new Promise((resolve, reject) => {
    const attach = (href, retry) => {
      const link = existing || document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'museThemeSheet';
      const done = () => { link.removeEventListener('error', failed); resolve(); };
      const failed = () => {
        link.removeEventListener('load', done);
        if (retry) { link.remove(); attach(themeSheetHref(false), false); }
        else reject(new Error('主题样式加载失败'));
      };
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', failed, { once: true });
      link.href = href;
      if (!link.isConnected) document.head.append(link);
    };
    if (existing && !existing.sheet) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => { existing.remove(); attach(themeSheetHref(false), false); }, { once: true });
      return;
    }
    attach(themeSheetHref(true), true);
  }).catch((error) => { if (generation === loadGeneration) sheetPromise = null; throw error; });
  return sheetPromise;
}

function setThemeColorMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.dataset.classicColor ||= meta.getAttribute('content') || '#f3f5f8';
  const colors = { paper: '#f7f5f0', focus: '#fafafa', workbench: '#eef0f3', night: '#161719' };
  meta.setAttribute('content', colors[theme] || meta.dataset.classicColor);
}

function commitTheme(theme) {
  root.dataset.theme = theme;
  if (theme === DEFAULT_THEME) delete root.dataset.ui;
  else root.dataset.ui = 'studio';
  setThemeColorMeta(theme);
  applied = theme;
  storageSet(BOOT_KEY, theme);
  syncMenuSelection();
  syncLabelsToggle();
  window.dispatchEvent(new CustomEvent('muse:theme-change', { detail: { theme } }));
  // Layout themes move the dock and controls; let position-aware parts (tool indicator,
  // pet, anchored menus, viewport bounds) re-measure once the new layout is in place.
  requestAnimationFrame(() => {
    layoutResize = true;
    try { window.dispatchEvent(new Event('resize')); } finally { layoutResize = false; }
  });
}

async function applyTheme(theme, { animate = false } = {}) {
  theme = normalizeTheme(theme);
  const generation = ++applyGeneration;
  if (theme !== DEFAULT_THEME) {
    try { await loadThemeSheet(); }
    catch (error) { if (generation === applyGeneration) showToast(error.message); return false; }
  }
  if (generation !== applyGeneration) return false;
  if (theme === applied && root.dataset.theme === theme) return true;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce && typeof document.startViewTransition === 'function' && document.visibilityState === 'visible') {
    root.dataset.themeTransition = '';
    try { await document.startViewTransition(() => commitTheme(theme)).finished; }
    catch { if (root.dataset.theme !== theme) commitTheme(theme); }
    finally { delete root.dataset.themeTransition; }
  } else {
    commitTheme(theme);
  }
  return true;
}

function applyForBoard(options) {
  return applyTheme(resolveCanvasTheme(preferences, state.boardId), options);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store', ...options,
    headers: { 'content-type': 'application/json', 'x-csrf-token': window.MuseAccount?.csrfToken?.() || '', ...options.headers },
    signal: options.signal || AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '主题暂时无法同步'), { status: response.status });
  return data;
}

async function syncFromServer() {
  syncController?.abort();
  if (!signedIn()) return;
  const controller = new AbortController();
  syncController = controller;
  const owner = accountKey;
  try {
    const data = await request('/api/themes', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
    if (controller.signal.aborted || owner !== accountKey) return;
    preferences = sanitizeThemePreferences(data);
    writeCache();
    void applyForBoard();
  } catch (error) {
    // The cached copy keeps working offline; the next account refresh retries.
    if (error.name !== 'AbortError' && error.status !== 401) console.warn('Theme preferences unavailable', error);
  } finally {
    if (syncController === controller) syncController = null;
  }
}

function adoptAccount() {
  const next = currentAccountKey();
  if (next === accountKey) return;
  accountKey = next;
  preferences = readCache(accountKey);
  void applyForBoard();
  void syncFromServer();
}

async function persistCanvasTheme(boardId, theme) {
  const previous = preferences.canvases[boardId];
  preferences = { ...preferences, canvases: { ...preferences.canvases, [boardId]: theme } };
  writeCache();
  if (!signedIn()) return;
  const owner = accountKey;
  try {
    const data = await request(`/api/themes/canvases/${encodeURIComponent(boardId)}`, { method: 'PUT', body: JSON.stringify({ theme }) });
    if (owner === accountKey) { preferences = sanitizeThemePreferences(data); writeCache(); }
  } catch (error) {
    if (owner !== accountKey) return;
    if (error.status === 404 || error.status === 400) {
      const canvases = { ...preferences.canvases };
      if (previous) canvases[boardId] = previous; else delete canvases[boardId];
      preferences = { ...preferences, canvases };
      writeCache();
      void applyForBoard();
    }
    showToast(error.status === 404 ? '无法为此画布保存主题' : '主题已在本机应用，暂未同步到账号');
  }
}

async function persistDefaultTheme(theme) {
  preferences = { ...preferences, default: theme };
  writeCache();
  if (!signedIn()) return true;
  const owner = accountKey;
  try {
    const data = await request('/api/themes/default', { method: 'PUT', body: JSON.stringify({ theme }) });
    if (owner === accountKey) { preferences = sanitizeThemePreferences(data); writeCache(); }
    return true;
  } catch (error) {
    if (owner === accountKey) showToast('默认主题已在本机保存，暂未同步到账号');
    return false;
  }
}

function canvasName() {
  return state.canvases?.find?.((canvas) => canvas.id === state.boardId)?.name || '当前画布';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildMenu() {
  menu = element('div', 'tool-popover theme-menu');
  menu.id = 'themeMenu';
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '界面主题');
  const heading = element('div', 'theme-menu-heading');
  const title = element('strong', '', '界面主题');
  const scope = element('span', 'theme-menu-scope');
  scope.id = 'themeMenuScope';
  heading.append(title, scope);
  const list = element('div', 'theme-menu-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-labelledby', 'themeMenuScope');
  for (const theme of THEMES) {
    const option = element('button', 'theme-option');
    option.type = 'button';
    option.dataset.themeOption = theme.id;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', 'false');
    const preview = element('span', 'theme-preview');
    preview.dataset.previewTheme = theme.id;
    preview.setAttribute('aria-hidden', 'true');
    preview.append(element('span', 'tp-bar'), element('span', 'tp-dock'), element('span', 'tp-card'), element('span', 'tp-mark'));
    const copy = element('span', 'theme-option-copy');
    copy.append(element('strong', '', theme.name), element('small', '', theme.description));
    const check = element('i', 'theme-option-check');
    check.dataset.lucide = 'check';
    check.setAttribute('aria-hidden', 'true');
    option.append(preview, copy, check);
    option.addEventListener('click', () => chooseTheme(theme.id));
    list.append(option);
  }
  const footer = element('div', 'theme-menu-footer');
  const note = element('span', 'theme-menu-note');
  note.id = 'themeMenuNote';
  const makeDefault = element('button', 'theme-default-button', '设为新画布默认');
  makeDefault.type = 'button';
  makeDefault.id = 'themeDefaultButton';
  makeDefault.addEventListener('click', async () => {
    makeDefault.disabled = true;
    await persistDefaultTheme(applied);
    syncMenuSelection();
    showToast(`「${THEMES.find((theme) => theme.id === applied)?.name}」已设为默认主题`);
  });
  footer.append(note, makeDefault);
  const hint = element('p', 'theme-menu-hint', '非经典主题下，右键画布空白处或用手指长按，可打开圆盘工具盘。');
  menu.append(heading, list, hint, footer);
  menu.addEventListener('keydown', onMenuKeydown);
  document.body.append(menu);
  refreshIcons(menu);
}

function syncMenuSelection() {
  if (!menu) return;
  for (const option of menu.querySelectorAll('[data-theme-option]')) {
    const selected = option.dataset.themeOption === applied;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
  const scope = menu.querySelector('#themeMenuScope');
  if (scope) scope.textContent = state.boardId ? `仅对你在「${canvasName()}」生效` : '打开画布后可为它单独选择';
  const note = menu.querySelector('#themeMenuNote');
  const defaultName = THEMES.find((theme) => theme.id === preferences.default)?.name || '经典';
  if (note) note.textContent = signedIn() ? `默认：${defaultName} · 已保存到账号` : `默认：${defaultName} · 游客仅保存在此浏览器`;
  const makeDefault = menu.querySelector('#themeDefaultButton');
  if (makeDefault) makeDefault.disabled = preferences.default === applied;
}

async function chooseTheme(theme) {
  if (!isThemeId(theme)) return;
  if (!state.boardId) { showToast('请先打开画布'); return; }
  const boardId = state.boardId;
  const ok = await applyTheme(theme, { animate: true });
  if (!ok || boardId !== state.boardId) return;
  void persistCanvasTheme(boardId, theme);
  syncMenuSelection();
}

function onMenuKeydown(event) {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
  const options = [...menu.querySelectorAll('[data-theme-option]')];
  const index = options.indexOf(document.activeElement);
  let next = -1;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % options.length;
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  if (next >= 0) { event.preventDefault(); options[next].focus({ preventScroll: true }); }
}

function closeMenu(focusTrigger = false) {
  if (!menu || menu.hidden || menu.dataset.menuClosing === 'true') return;
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.classList.remove('active');
  closeMenuSurface(menu, () => { menu.hidden = true; }, { immediate: !focusTrigger });
  if (focusTrigger) trigger?.focus({ preventScroll: true });
}

async function openMenu() {
  closePopovers({ immediate: true });
  if (!menu) buildMenu();
  if (menu.dataset.menuClosing === 'true') closeMenuSurface(menu, () => { menu.hidden = true; }, { immediate: true });
  // Previews are drawn by the theme stylesheet; wait briefly so they never flash unstyled.
  await Promise.race([loadThemeSheet().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 600))]);
  syncMenuSelection();
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('active');
  placeAnchoredMenu(menu, trigger);
  openMenuSurface(menu, trigger);
  (menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-theme-option]'))?.focus({ preventScroll: true });
}

function createTrigger() {
  const dock = document.querySelector('#toolDock .toolbar-insert');
  if (!dock || document.getElementById('themeButton')) return;
  trigger = element('button', 'tool-button split-tool theme-tool-button');
  trigger.type = 'button';
  trigger.id = 'themeButton';
  trigger.dataset.boardIndependent = '';
  trigger.title = '界面主题';
  trigger.setAttribute('aria-label', '界面主题');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'themeMenu');
  trigger.setAttribute('aria-expanded', 'false');
  const icon = element('i');
  icon.dataset.lucide = 'palette';
  icon.setAttribute('aria-hidden', 'true');
  const chevron = element('i', 'tool-chevron');
  chevron.dataset.lucide = 'chevron-down';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(icon, element('span', 'tool-label', '主题'), chevron);
  // A menu that is still animating closed counts as closed, so a quick second click reopens it.
  const isOpen = () => menu && !menu.hidden && menu.dataset.menuClosing !== 'true';
  trigger.addEventListener('click', () => (isOpen() ? closeMenu() : void openMenu()));
  dock.append(trigger);
  refreshIcons(trigger);
}

// Tablets show icons only in studio themes; this toggle reveals the labels.
function createLabelsToggle() {
  const dock = document.getElementById('toolDock');
  if (!dock || document.getElementById('dockLabelsToggle')) return;
  labelsToggle = element('button', 'dock-labels-toggle');
  labelsToggle.type = 'button';
  labelsToggle.id = 'dockLabelsToggle';
  // Hidden by attribute so Classic never shows it, even before the theme stylesheet loads.
  labelsToggle.hidden = true;
  const icon = element('i');
  icon.dataset.lucide = 'panel-left';
  icon.setAttribute('aria-hidden', 'true');
  labelsToggle.append(icon);
  const sync = () => {
    const expanded = root.dataset.dockLabels === 'expanded';
    labelsToggle.setAttribute('aria-pressed', String(expanded));
    labelsToggle.title = expanded ? '只显示图标' : '显示工具名称';
    labelsToggle.setAttribute('aria-label', labelsToggle.title);
  };
  labelsToggle.addEventListener('click', () => {
    root.dataset.dockLabels = root.dataset.dockLabels === 'expanded' ? 'compact' : 'expanded';
    storageSet(LABELS_KEY, root.dataset.dockLabels);
    sync();
    window.dispatchEvent(new Event('resize'));
  });
  const collapse = document.getElementById('dockCollapseButton');
  dock.insertBefore(labelsToggle, collapse || null);
  sync();
  syncLabelsToggle();
  refreshIcons(labelsToggle);
}

function syncLabelsToggle() {
  if (!labelsToggle) return;
  labelsToggle.hidden = !(root.dataset.ui === 'studio' && root.dataset.device === 'mobile' && root.dataset.formFactor !== 'phone');
}

// state.boardId is assigned in several places; observe it without touching them.
function watchBoard() {
  let value = state.boardId;
  const descriptor = Object.getOwnPropertyDescriptor(state, 'boardId');
  if (!descriptor || !descriptor.configurable || descriptor.get) return false;
  Object.defineProperty(state, 'boardId', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: () => value,
    set(next) {
      const changed = next !== value;
      value = next;
      if (changed) queueMicrotask(() => { if (state.boardId === next) { void applyForBoard(); syncMenuSelection(); } });
    }
  });
  return true;
}

export function initializeThemes() {
  if (!root.dataset.dockLabels) root.dataset.dockLabels = storageGet(LABELS_KEY) === 'expanded' ? 'expanded' : 'compact';
  createTrigger();
  createLabelsToggle();
  try { initializeToolWheel(); } catch (error) { console.warn('Tool wheel unavailable', error); }
  if (!watchBoard()) {
    // Fallback: a light poll only if the property cannot be observed.
    let last = state.boardId;
    setInterval(() => { if (state.boardId !== last) { last = state.boardId; void applyForBoard(); } }, 500);
  }
  adoptAccount();
  for (const type of ['muse:login', 'muse:logout', 'muse:auth-expired', 'muse:identity-changed']) {
    window.addEventListener(type, () => { closeMenu(); queueMicrotask(adoptAccount); });
  }
  window.addEventListener('muse:account-changing', () => closeMenu());
  window.addEventListener('muse:device-change', syncLabelsToggle);
  window.addEventListener('muse:sharing-changed', () => void syncFromServer());
  document.addEventListener('pointerdown', (event) => {
    if (menu && !menu.hidden && !menu.contains(event.target) && !trigger?.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => { if (!layoutResize) closeMenu(); });
  window.addEventListener('storage', (event) => {
    if (event.key === CACHE_PREFIX + accountKey) { preferences = readCache(accountKey); void applyForBoard(); }
  });
  // Warm the cache while idle so the first switch is instant.
  const warm = () => {
    if (document.getElementById('museThemeSheet') || document.getElementById('museThemePrefetch')) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'style';
    link.id = 'museThemePrefetch';
    link.href = themeSheetHref(true);
    document.head.append(link);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 8000 }); else setTimeout(warm, 4000);
  window.MuseTheme = Object.freeze({
    get current() { return applied; },
    apply: (theme, options = {}) => (options.persist === false ? applyTheme(theme) : chooseTheme(theme)),
    themes: THEMES
  });
}
