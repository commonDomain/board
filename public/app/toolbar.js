

import {
  DOCUMENT_BAR_COLLAPSED_KEY,
  SHAPES,
  STICKERS,
  STICKER_CATEGORIES,
  TEXT_TOOLBAR_MODE_KEY,
  TOOL_DOCK_COLLAPSED_KEY
} from './constants.js';
import { cancelConnectorDraft } from './drawing-model.js';
import { els } from './elements.js';

import { makeFormatGroup } from './format-controls-model.js';

import { cancelSurfaceMorph, captureElementRect, morphSurface, refreshIcons, showToast } from './interface-model.js';
import { interfaceEffects } from './interface.js';

import { drawShapeElement } from './shape-rendering.js';

import { state } from './state.js';
import { clamp, createSvg, cssEscape } from './utilities.js';

let redoLastChange, undoLastChange, isGuestMode, setBackgroundDrift, closeFloatingSelectPickers, setFloatingMoreOpen, focusNavigatorTarget, setShape, updateContextPanel, cancelActiveGesture, addStickerItem, openKdocsInsertDialog, renderLayerMenu, restoreIdleCursorState, invalidateInteractionViewportBounds, closePopovers, handleGlobalPointerDown, togglePopover, saveBoard, selectItem, addSheetItem;

function configureToolbar(callbacks) {
  ({redoLastChange,
undoLastChange,
isGuestMode,
setBackgroundDrift,
closeFloatingSelectPickers,
setFloatingMoreOpen,
focusNavigatorTarget,
setShape,
updateContextPanel,
cancelActiveGesture,
addStickerItem,
openKdocsInsertDialog,
renderLayerMenu,
restoreIdleCursorState,
invalidateInteractionViewportBounds,
closePopovers,
handleGlobalPointerDown,
togglePopover,
saveBoard,
selectItem,
addSheetItem} = callbacks);
}

function buildSelectMenu() {
  if (!els.selectMenu) {
    return;
  }
  els.selectMenu.textContent = '';
  [
    ['box', '框选'],
    ['lasso', '套索']
  ].forEach(([mode, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-btn';
    button.dataset.selectMode = mode;
    button.textContent = label;
    button.classList.toggle('active', state.selectionMode === mode);
    button.addEventListener('click', () => {
      setSelectMode(mode);
      closePopovers();
    });
    els.selectMenu.appendChild(button);
  });
}

function setSelectMode(mode) {
  state.selectionMode = ['box', 'lasso'].includes(mode) ? mode : 'box';
  if (els.selectLabel) {
    els.selectLabel.textContent = state.selectionMode === 'box' ? '选择' : '套索';
  }
  document.querySelectorAll('[data-select-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.selectMode === state.selectionMode);
  });
}

function wireToolbar() {
  els.canvasStart?.querySelectorAll('[data-start-tool]').forEach((button) => {
    button.addEventListener('click', () => activateStarterTool(button.dataset.startTool));
  });
  const splitToolIds = new Set([
    'brushButton',
    'eraserButton',
    'selectButton',
    'shapeButton',
    'textButton',
    'tableButton',
    'mindmapButton'
  ]);
  document.querySelectorAll('[data-tool]').forEach((button) => {
    if (splitToolIds.has(button.id)) {
      return;
    }
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  els.brushButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('pen');
    togglePopover(els.brushMenu, els.brushButton);
  });
  els.eraserButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('eraser');
    togglePopover(els.eraserMenu, els.eraserButton);
  });
  els.selectButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('select');
    togglePopover(els.selectMenu, els.selectButton);
  });
  els.layerButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePopover(els.layerMenu, els.layerButton);
    renderLayerMenu();
  });
  els.shapeButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('pan');
    els.shapeMenuPanel?.querySelectorAll('[data-shape]').forEach((button) => {
      button.classList.remove('active');
    });
    setShapeLibraryTab('shape');
    togglePopover(els.shapeMenu, els.shapeButton);
  });
  els.textButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('text');
    if (state.textToolbarMode === 'panel') {
      togglePopover(els.textMenu, els.textButton);
    } else {
      closePopovers();
    }
  });
  els.tableButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('pan');
    togglePopover(els.tableMenu, els.tableButton);
  });
  els.mindmapButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setTool('pan');
    togglePopover(els.mindmapMenu, els.mindmapButton);
  });
  els.navigationButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isGuestMode()) {
      window.MuseAccount?.showAuth?.();
      showToast('登录后才能使用导航工具');
      return;
    }
    if (!state.amapCapabilities?.enabled) {
      showToast('导航服务尚未配置或暂时不可用');
      return;
    }
    togglePopover(els.navigationMenu, els.navigationButton);
  });
  els.navigationMenu?.querySelectorAll('[data-navigation-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.navigationAction;
      const existing = Array.from(state.items.values()).find((item) => item.type === type);
      closePopovers();
      if (existing) {
        selectItem(existing.id);
        focusNavigatorTarget(existing);
        showToast('当前画布已经有这个导航组件');
        return;
      }
      setTool(type);
      showToast('点击画布放置组件');
    });
  });
  els.backgroundButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePopover(els.backgroundMenu, els.backgroundButton);
  });
  els.backgroundDriftToggle?.addEventListener('click', () => {
    setBackgroundDrift(state.backgroundDrift !== true);
  });
  els.dockCollapseButton?.addEventListener('click', () => setToolDockCollapsed(true));
  els.dockExpandButton?.addEventListener('click', () => setToolDockCollapsed(false));
  els.documentBarToggle?.addEventListener('click', () => setDocumentBarCollapsed(!state.documentBarCollapsed));
  window.addEventListener('pointerdown', handleGlobalPointerDown, true);
  window.addEventListener('blur', closePopovers);
  els.undoButton?.addEventListener('click', undoLastChange);
  els.redoButton?.addEventListener('click', redoLastChange);
  els.saveButton.addEventListener('click', saveBoard);
}

function setDocumentBarCollapsed(collapsed) {
  const documentBar = document.querySelector('.document-bar');
  const anchorRect = captureElementRect(els.documentBarToggle);
  const wasCollapsed = documentBar?.classList.contains('is-collapsed') === true;
  state.documentBarCollapsed = Boolean(collapsed);
  try {
    localStorage.setItem(DOCUMENT_BAR_COLLAPSED_KEY, String(state.documentBarCollapsed));
  } catch {
    // Keep the selected layout for this session when storage is unavailable.
  }
  closePopovers();
  applyDocumentBarVisibility();
  if (wasCollapsed !== state.documentBarCollapsed && anchorRect && documentBar) {
    morphSurface(documentBar, anchorRect);
  }
  requestAnimationFrame(() => els.documentBarToggle?.focus({ preventScroll: true }));
}

function applyDocumentBarVisibility() {
  const documentBar = document.querySelector('.document-bar');
  if (!documentBar || !els.documentBarToggle || !els.documentBarContent) return;
  const collapsed = state.documentBarCollapsed;
  documentBar.classList.toggle('is-collapsed', collapsed);
  els.documentBarContent.setAttribute('aria-hidden', String(collapsed));
  els.documentBarToggle.setAttribute('aria-expanded', String(!collapsed));
  els.documentBarToggle.title = collapsed ? '展开顶部栏' : '收起顶部栏';
  els.documentBarToggle.setAttribute('aria-label', collapsed ? '展开顶部栏' : '收起顶部栏');
  invalidateInteractionViewportBounds();
}

function setTextToolbarMode(mode) {
  const resolvedMode = mode === 'panel' ? 'panel' : 'floating';
  state.textToolbarMode = resolvedMode;
  try {
    localStorage.setItem(TEXT_TOOLBAR_MODE_KEY, resolvedMode);
  } catch {
    // Keep the selected layout for this session when storage is unavailable.
  }
  setFloatingMoreOpen(false, { immediate: true });
  closeFloatingSelectPickers();
  closePopovers({ immediate: true });
  updateContextPanel();
}

function setToolDockCollapsed(collapsed) {
  const wasCollapsed = els.toolDock?.hidden === true;
  const anchorRect = captureElementRect(wasCollapsed ? els.dockExpandButton : els.dockCollapseButton);
  state.toolDockCollapsed = Boolean(collapsed);
  try {
    localStorage.setItem(TOOL_DOCK_COLLAPSED_KEY, String(state.toolDockCollapsed));
  } catch {
    // The toolbar still works when storage is unavailable.
  }
  closePopovers();
  applyToolDockVisibility({ animate: true, anchorRect, wasCollapsed });
  requestAnimationFrame(() => {
    (state.toolDockCollapsed ? els.dockExpandButton : els.dockCollapseButton)?.focus({ preventScroll: true });
  });
}

function applyToolDockVisibility(options = {}) {
  if (!els.toolDock || !els.dockExpandButton) {
    return;
  }
  const collapsed = state.toolDockCollapsed && !window.matchMedia('(max-width: 1100px)').matches;
  const changed = options.wasCollapsed !== undefined && options.wasCollapsed !== collapsed;
  cancelSurfaceMorph(els.toolDock);
  cancelSurfaceMorph(els.dockExpandButton);
  els.toolDock.hidden = collapsed;
  els.dockExpandButton.hidden = !collapsed;
  els.dockCollapseButton?.setAttribute('aria-expanded', String(!collapsed));
  els.dockExpandButton.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed) interfaceEffects.toolLiquid?.hide();
  else interfaceEffects.toolLiquid?.refresh();
  if (options.animate && changed && options.anchorRect) {
    morphSurface(collapsed ? els.dockExpandButton : els.toolDock, options.anchorRect);
  }
}

function buildShapeMenu() {
  if (!els.shapeMenuPanel) {
    return;
  }
  els.shapeMenuPanel.textContent = '';
  SHAPES.forEach((shape) => {
    const button = document.createElement('button');
    button.className = 'shape-choice';
    button.type = 'button';
    button.dataset.shape = shape.id;
    button.title = shape.name;

    const icon = createSvg('svg');
    icon.setAttribute('viewBox', '0 0 36 28');
    drawShapeElement(icon, {
      type: 'shape',
      shape: shape.id,
      w: 36,
      h: 28,
      stroke: '#111111',
      strokeWidth: 2,
      fill: 'none'
    });
    button.appendChild(icon);
    button.addEventListener('click', () => {
      setShape(shape.id);
      setTool('shape');
      closePopovers();
    });
    els.shapeMenuPanel.appendChild(button);
  });
  els.shapeLibraryTab?.addEventListener('click', () => setShapeLibraryTab('shape'));
  els.stickerLibraryTab?.addEventListener('click', () => setShapeLibraryTab('sticker'));
  setShapeLibraryTab('shape');
  setShape(state.shapeType);
}

function setShapeLibraryTab(tab) {
  const showStickers = tab === 'sticker';
  if (!els.shapeMenuPanel || !els.stickerMenu) return;
  els.shapeMenuPanel.hidden = showStickers;
  els.stickerMenu.hidden = !showStickers;
  els.shapeLibraryTab?.classList.toggle('active', !showStickers);
  els.stickerLibraryTab?.classList.toggle('active', showStickers);
  els.shapeLibraryTab?.setAttribute('aria-selected', String(!showStickers));
  els.stickerLibraryTab?.setAttribute('aria-selected', String(showStickers));
  if (showStickers) requestAnimationFrame(() => els.stickerMenu.querySelector('input')?.focus({ preventScroll: true }));
}

function buildStickerMenu() {
  if (!els.stickerMenu) {
    return;
  }
  els.stickerMenu.textContent = '';
  const heading = document.createElement('div');
  heading.className = 'popover-heading';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'popover-eyebrow';
  eyebrow.textContent = '轻量标注';
  const title = document.createElement('strong');
  title.textContent = '背景贴纸';
  heading.append(eyebrow, title);

  const searchRow = document.createElement('div');
  searchRow.className = 'sticker-search-row';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'sticker-search';
  search.placeholder = '搜索贴纸';
  search.setAttribute('aria-label', '搜索贴纸');
  searchRow.appendChild(search);

  const categories = document.createElement('div');
  categories.className = 'sticker-categories';
  const grid = document.createElement('div');
  grid.className = 'sticker-grid';
  let activeCategory = 'all';

  const renderChoices = () => {
    const query = search.value.trim().toLocaleLowerCase('zh-CN');
    grid.textContent = '';
    const matches = STICKERS.filter((sticker) => {
      const inCategory = activeCategory === 'all' || sticker.category === activeCategory;
      const haystack = `${sticker.name} ${sticker.keywords} ${sticker.id}`.toLocaleLowerCase('zh-CN');
      return inCategory && (!query || haystack.includes(query));
    });
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'sticker-empty';
      empty.textContent = '没有匹配的贴纸';
      grid.appendChild(empty);
      return;
    }
    for (const sticker of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sticker-choice';
      button.dataset.sticker = sticker.id;
      button.title = sticker.name;
      button.setAttribute('aria-label', `插入${sticker.name}贴纸`);
      const icon = document.createElement('i');
      icon.dataset.lucide = sticker.icon;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'sticker-choice-label';
      label.textContent = sticker.name;
      button.append(icon, label);
      button.addEventListener('click', () => {
        if (addStickerItem(sticker.id)) {
          closePopovers();
        }
      });
      grid.appendChild(button);
    }
    refreshIcons(grid);
  };

  for (const category of STICKER_CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sticker-category';
    button.textContent = category.name;
    button.classList.toggle('active', category.id === activeCategory);
    button.setAttribute('aria-pressed', String(category.id === activeCategory));
    button.addEventListener('click', () => {
      activeCategory = category.id;
      categories.querySelectorAll('.sticker-category').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === button);
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      renderChoices();
    });
    categories.appendChild(button);
  }
  search.addEventListener('input', renderChoices);
  els.stickerMenu.append(heading, searchRow, categories, grid);
  renderChoices();
}

function buildTextMenu() {
  if (!els.textMenu) {
    return;
  }
  els.textMenu.textContent = '';
  els.textMenu.appendChild(makeFormatGroup());
}

function buildTableMenu() {
  if (!els.tableMenu) {
    return;
  }
  els.tableMenu.textContent = '';
  const heading = document.createElement('div');
  heading.className = 'popover-heading table-menu-heading';
  heading.innerHTML = '<span class="popover-eyebrow">表格工具</span><strong>选择插入类型</strong>';

  const choices = document.createElement('div');
  choices.className = 'table-tool-choices';
  const makeChoice = (icon, label, description, className = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `table-tool-choice ${className}`.trim();
    button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i><span><strong>${label}</strong><small>${description}</small></span>`;
    return button;
  };
  const sheetChoice = makeChoice('file-spreadsheet', '工作表', '公式、筛选与多工作表编辑', 'table-tool-choice-sheet');
  sheetChoice.dataset.insertKind = 'sheet';
  sheetChoice.addEventListener('click', () => {
    closePopovers({ immediate: true });
    addSheetItem();
  });
  const wpsChoice = makeChoice('link-2', '共享文档', '粘贴链接并嵌入最新内容', 'table-tool-choice-wps');
  wpsChoice.dataset.insertKind = 'kdocs';
  wpsChoice.addEventListener('click', () => {
    closePopovers({ immediate: true });
    void openKdocsInsertDialog();
  });
  choices.append(sheetChoice, wpsChoice);

  const form = document.createElement('form');
  form.className = 'table-create-form';
  const title = document.createElement('div');
  title.className = 'table-create-title';
  title.innerHTML = '<i data-lucide="table-2" aria-hidden="true"></i><span>普通表格</span>';
  const fields = document.createElement('div');
  fields.className = 'table-size-fields';
  const makeField = (labelText, name, value, maximum) => {
    const label = document.createElement('label');
    label.className = 'table-size-field';
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = name;
    input.min = '1';
    input.max = String(maximum);
    input.step = '1';
    input.value = String(value);
    input.required = true;
    input.inputMode = 'numeric';
    label.append(text, input);
    return label;
  };
  fields.append(makeField('行数', 'rows', 3, 50), makeField('列数', 'columns', 3, 20));
  const hint = document.createElement('p');
  hint.className = 'table-create-hint';
  hint.textContent = '确认后在画布上点击放置，单元格初始为空。';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'context-btn table-create-submit';
  submit.textContent = '确认尺寸';
  form.append(title, fields, hint, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const rows = clamp(Math.trunc(Number(data.get('rows'))) || 3, 1, 50);
    const columns = clamp(Math.trunc(Number(data.get('columns'))) || 3, 1, 20);
    state.tableDraft = { rows, columns };
    setTool('table');
    closePopovers();
    showToast(`已设置 ${rows} × ${columns} 表格，请在画布点击放置`);
  });
  els.tableMenu.append(heading, choices, form);
  window.renderLucideIcons?.(els.tableMenu);
}

function setTool(tool) {
  if (state.compatibilityReadOnly && !['pan', 'select'].includes(tool)) return;
  if (tool !== state.tool) {
    cancelActiveGesture();
    cancelConnectorDraft();
  }
  if (tool !== 'table') {
    state.tableDraft = null;
  }
  state.tool = tool;
  if (tool === 'pan' || tool === 'select') {
    state.lastNavigationTool = tool;
  }
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  
  els.navigationButton?.classList.toggle('active', tool.startsWith('amap-'));
  els.navigationButton?.setAttribute('aria-pressed', String(tool.startsWith('amap-')));
  els.board.dataset.tool = tool;
  els.viewport.dataset.tool = tool;
  window.ConnectorUI?.schedule();
  restoreIdleCursorState();
  interfaceEffects.toolLiquid?.update(document.querySelector(`[data-tool="${cssEscape(tool)}"].active`));
  updateCanvasStartState();
}

function restoreNavigationTool() {
  setTool(state.lastNavigationTool === 'select' ? 'select' : 'pan');
}

function updateCanvasStartState() {
  if (!els.canvasStart) return;
  const withoutCanvas = !state.boardId && state.canvasCatalogLoadedAt > 0;
  if (els.noCanvasStart) els.noCanvasStart.hidden = !withoutCanvas;
  const description = document.getElementById('noCanvasStartDescription');
  if (description)
    description.textContent = isGuestMode()
      ? '创建“画布 1”，开始记录你的想法。'
      : '创建“画布 1”，开始记录和分享你的想法。';
  const empty = state.items.size === 0 && state.sections.size === 0 && state.groups.size === 0 && !state.pendingCut;
  const neutralTool = state.tool === 'pan' || state.tool === 'select';
  els.canvasStart.hidden = !state.boardId || !(empty && neutralTool && !state.switchingCanvas);
}

function activateStarterTool(tool, options = {}) {
  closePopovers();
  setTool(tool);
  if (options.closeNavigator && els.navigatorPanel) {
    els.navigatorPanel.hidden = true;
    els.navigatorButton?.setAttribute('aria-expanded', 'false');
  }
  if (tool === 'pen') {
    togglePopover(els.brushMenu, els.brushButton);
  }
}
export {
  buildSelectMenu,
  setSelectMode,
  wireToolbar,
  setDocumentBarCollapsed,
  applyDocumentBarVisibility,
  setTextToolbarMode,
  setToolDockCollapsed,
  applyToolDockVisibility,
  buildShapeMenu,
  setShapeLibraryTab,
  buildStickerMenu,
  buildTextMenu,
  buildTableMenu,
  setTool,
  restoreNavigationTool,
  updateCanvasStartState,
  activateStarterTool
};

export { configureToolbar };
