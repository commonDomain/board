import { setBackground } from './background.js';
import { fitZoom, onViewportWheel, resetRotation, resetZoom, setZoom, zoomBy } from './camera.js';
import { preventBrowserKeyboardZoom, preventBrowserWheelZoom, zoomSliderLevels } from './camera-model.js';
import { handleCopyEvent } from './clipboard.js';
import { isRemoteBoardLocked } from './connection-model.js';
import { sendBoardEditActivity } from './connection.js';
import { DEFAULT_NOTE_APPEARANCE } from './constants.js';
import { cancelConnectorDraft } from './drawing-model.js';
import { finishEditing, onEditableInput, onEditableInputImmediate } from './editing.js';
import { els } from './elements.js';
import { exportBoardPng } from './export.js';
import {
  closeFloatingSelectPickers,
  getEditingMindNodeContext,
  setFloatingAppearanceTab,
  setFloatingColorPaletteOpen,
  setFloatingMenuView,
  setFloatingMoreOpen
} from './floating-toolbar-menu.js';
import {applyMindNodeTextFormat,setMindMapBranchStyle,setMindNodeStyle} from './mindmap-format.js';
import {resetTextBoxAppearance,resetTextFormatting,setColor,setFontFamily,setFontSize,setTextAlign,setTextBoxBorderColor,setTextBoxBorderStyle,setTextBoxFill,toggleBold,toggleConnectorOption} from './format-actions.js';
import {toggleTextListMode} from './text-list.js';
import { setBrushSize } from './format-actions-model.js';
import { selectTextAppearanceTab } from './format-controls.js';
import { applyNotePanelPatch, getSelectedOrEditingItem, updateContextPanel } from './format-panel.js';
import { normalizeNoteFill } from './format-panel-model.js';
import { getViewportDropPoint } from './geometry.js';
import { cancelActiveGesture } from './gestures.js';
import { setContainerFlags } from './groups.js';
import { showToast } from './interface-model.js';
import { deleteItems } from './items.js';
import { onKeyDown, onKeyUp } from './keyboard.js';
import { moveSelectionZ } from './layers.js';
import { restoreIdleCursorState } from './marquee.js';
import { getMindNodeAtPath } from './mindmap-editing-model.js';
import {addMindMapItem,closeMindmapImportDialog,confirmMindmapImport,importMindmapMarkdownFile,importXmindFile,updateMindmapImportActionState} from './mindmap-import.js';
import {makeMindMapTemplate} from './mindmap-model.js';
import { observeInteractionViewportBounds } from './pan.js';
import { dataTransferContainsImage } from './paste-model.js';
import { handleFileDrop, handlePasteEvent } from './paste.js';
import { ensureReadableToolZoom, onBoardDoubleClick, onBoardPointerDown } from './pointer-down.js';
import {
  hideSectionHoverLabel,
  onWindowPointerCancel,
  onWindowPointerMove,
  onWindowPointerUp
} from './pointer-move.js';
import { closePopovers } from './popovers.js';
import { eventsRuntime } from './runtime/events.js';
import { hideContextMenu, selectItem, showContextMenu } from './selection.js';
import { state } from './state.js';
import { addTableDimension, deleteTableDimension, onTableCellFocus } from './table-rendering.js';
import { rememberTextSelection } from './text-input.js';
import { restoreNavigationTool, setTextToolbarMode } from './toolbar.js';
import { clamp, cssEscape, debounce } from './utilities.js';
import {
  closeXmindBrowser,
  closeXmindProviderDialog,
  disconnectXmind,
  openXmindBrowser,
  openXmindConnection,
  openXmindProviderDialog,
  renderXmindMaps,
  setMindmapPlacementLoading,
  startXmindOAuth
} from './xmind-connection.js';

function wireBoard() {
  observeInteractionViewportBounds();
  window.addEventListener('orientationchange', () => { cancelActiveGesture(); state.pointerPositions.clear(); });
  // Intercept browser zoom before a nested control can stop the wheel event
  // from reaching the viewport's canvas-zoom handler.
  window.addEventListener('wheel', preventBrowserWheelZoom, { capture: true, passive: false });
  window.addEventListener('keydown', preventBrowserKeyboardZoom, true);
  els.viewport.addEventListener('pointerdown', onBoardPointerDown);
  els.viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || isRemoteBoardLocked()) return;
      const itemId = event.target.closest?.('.board-item')?.dataset?.itemId || null;
      state.localBoardEditGesture = state.tool !== 'pan' && (state.tool !== 'select' || Boolean(itemId));
      if (state.localBoardEditGesture) sendBoardEditActivity(itemId);
    },
    true
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      if (state.localBoardEditGesture && event.buttons) sendBoardEditActivity();
    },
    { passive: true }
  );
  window.addEventListener('pointerup', () => {
    state.localBoardEditGesture = false;
  });
  window.addEventListener('pointercancel', () => {
    state.localBoardEditGesture = false;
  });
  document.addEventListener(
    'input',
    (event) => {
      if (
        els.viewport.contains(event.target) ||
        els.backgroundMenu?.contains(event.target) ||
        event.target.closest?.('#navigatorTree')
      ) {
        sendBoardEditActivity(event.target.closest?.('.board-item')?.dataset?.itemId || null);
      }
    },
    true
  );
  els.viewport.addEventListener('pointerleave', hideSectionHoverLabel);
  els.viewport.addEventListener('dblclick', onBoardDoubleClick);
  els.viewport.addEventListener('wheel', onViewportWheel, { passive: false });
  els.viewport.addEventListener('dragover', (event) => {
    const acceptsImages = dataTransferContainsImage(event.dataTransfer);
    els.viewport.classList.toggle('drag-over', acceptsImages);
    if (acceptsImages) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }
  });
  els.viewport.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget || !els.viewport.contains(event.relatedTarget)) {
      els.viewport.classList.remove('drag-over');
    }
  });
  els.viewport.addEventListener('drop', (event) => {
    els.viewport.classList.remove('drag-over');
    if (dataTransferContainsImage(event.dataTransfer)) {
      event.preventDefault();
      handleFileDrop(event);
    }
  });
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
  els.viewport.addEventListener('lostpointercapture', onWindowPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('selectionchange', rememberTextSelection);
  window.addEventListener('blur', () => {
    state.localBoardEditGesture = false;
    hideSectionHoverLabel();
    state.spacePan = false;
    els.viewport.classList.remove('space-pan');
    restoreIdleCursorState();
    state.internalClipboardPreferred = false;
    state.tableCellDrag = null;
    cancelActiveGesture();
    cancelConnectorDraft();
    state.pointerPositions.clear();
  });
  eventsRuntime.editableInputHandler = debounce(onEditableInput, 160);
  els.itemsLayer.addEventListener('input', onEditableInputImmediate);
  els.itemsLayer.addEventListener('input', eventsRuntime.editableInputHandler);
  els.itemsLayer.addEventListener('focusin', onTableCellFocus);
}

function wireClipboard() {
  window.addEventListener('copy', handleCopyEvent);
  window.addEventListener('paste', handlePasteEvent);
}

function wireExtras() {
  const zoomSlider = document.getElementById('canvasZoomSlider');
  zoomSlider?.addEventListener('input', () => {
    const levels = zoomSliderLevels();
    setZoom(levels[Number(zoomSlider.value)]);
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-list-mode]') && state.editingId) {
      event.preventDefault();
    }
  });
  document.querySelectorAll('[data-zoom]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.zoom;
      if (action === 'out') {
        zoomBy(1 / 1.25);
      } else if (action === 'in') {
        zoomBy(1.25);
      } else if (action === 'reset') {
        if (Math.abs(state.zoom - 1) < 0.005) fitZoom();
        else resetZoom();
      } else if (action === 'fit') {
        fitZoom();
      } else if (action === 'rotate') {
        resetRotation();
      }
      if (action !== 'in' && action !== 'out') closePopovers();
    });
  });
  els.exportPngButton?.addEventListener('click', () => {
    exportBoardPng().catch((error) => {
      console.error(error);
      showToast('导出失败，请重试');
    });
  });
  document.querySelectorAll('[data-mindmap-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.mindmapAction;
      const tree = makeMindMapTemplate(action);
      setMindmapPlacementLoading(true, '正在放置脑图…');
      try {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        ensureReadableToolZoom('mindmap');
        if (addMindMapItem(getViewportDropPoint(), tree)) {
          closePopovers();
          restoreNavigationTool();
        }
      } finally {
        setMindmapPlacementLoading(false);
      }
    });
  });
  els.importXmindButton?.addEventListener('click', () => els.xmindFileInput?.click());
  els.importMarkdownButton?.addEventListener('click', () => els.mindmapMarkdownInput?.click());
  els.xmindFileInput?.addEventListener('change', () => {
    const file = els.xmindFileInput.files?.[0];
    els.xmindFileInput.value = '';
    if (file) void importXmindFile(file);
  });
  els.mindmapMarkdownInput?.addEventListener('change', () => {
    const file = els.mindmapMarkdownInput.files?.[0];
    els.mindmapMarkdownInput.value = '';
    if (file) void importMindmapMarkdownFile(file);
  });
  els.closeMindmapImportButton?.addEventListener('click', closeMindmapImportDialog);
  els.cancelMindmapImportButton?.addEventListener('click', closeMindmapImportDialog);
  els.confirmMindmapImportButton?.addEventListener('click', confirmMindmapImport);
  els.selectAllMindmapSheetsButton?.addEventListener('click', () => {
    els.mindmapImportSheets.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = true;
    });
    updateMindmapImportActionState();
  });
  els.clearMindmapSheetsButton?.addEventListener('click', () => {
    els.mindmapImportSheets.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    updateMindmapImportActionState();
  });
  els.mindmapImportSheets?.addEventListener('change', updateMindmapImportActionState);
  els.connectXmindButton?.addEventListener('click', openXmindConnection);
  els.closeXmindBrowserButton?.addEventListener('click', closeXmindBrowser);
  els.xmindSearchInput?.addEventListener('input', renderXmindMaps);
  els.refreshXmindMapsButton?.addEventListener('click', () => void openXmindBrowser({ force: true }));
  els.reauthorizeXmindButton?.addEventListener('click', openXmindProviderDialog);
  els.disconnectXmindButton?.addEventListener('click', disconnectXmind);
  els.closeXmindProviderButton?.addEventListener('click', closeXmindProviderDialog);
  els.xmindProviderDialog?.addEventListener('click', (event) => {
    if (event.target === els.xmindProviderDialog) closeXmindProviderDialog();
  });
  document.querySelectorAll('[data-xmind-provider]').forEach((button) => {
    button.addEventListener('click', () => void startXmindOAuth(button.dataset.xmindProvider));
  });
  document.querySelectorAll('[data-background]').forEach((button) => {
    button.addEventListener('click', () => {
      setBackground(button.dataset.background);
      closePopovers();
    });
  });
  els.viewport?.addEventListener('contextmenu', showContextMenu);
  document.addEventListener('input', (event) => {
    if (!event.target.matches('input[data-note-opacity]')) return;
    const value = clamp(Number(event.target.value), 0, 100);
    const panel = event.target.closest('.context-panel, .floating-format-bar');
    const output = panel?.querySelector('[data-note-opacity-value]');
    if (output) output.textContent = `${Math.round(value)}%`;
    const item = getSelectedOrEditingItem();
    const card =
      item?.type === 'note'
        ? document.querySelector(`.board-item[data-item-id="${cssEscape(item.id)}"] .note-card`)
        : null;
    if (card) card.style.opacity = String(value / 100);
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('input[data-note-fill]')) {
      applyNotePanelPatch({ noteFill: normalizeNoteFill(event.target.value) });
    } else if (event.target.matches('select[data-note-border]')) {
      applyNotePanelPatch({ noteBorder: event.target.value === 'solid' ? 'solid' : 'none' });
    } else if (event.target.matches('input[data-note-opacity]')) {
      applyNotePanelPatch({ noteOpacity: clamp(Number(event.target.value) / 100, 0, 1) });
    } else if (event.target.matches('input[data-mind-node-color]')) {
      setMindNodeStyle({ [event.target.dataset.mindNodeColor]: event.target.value });
    } else if (event.target.matches('input[data-color-picker]')) {
      setColor(event.target.value, { custom: true });
      if (event.target.closest('.floating-format-bar')) setFloatingColorPaletteOpen(false);
      updateContextPanel();
    } else if (event.target.matches('input[data-text-fill-color]')) {
      setTextBoxFill(event.target.value);
    } else if (event.target.matches('input[data-text-border-color]')) {
      setTextBoxBorderColor(event.target.value);
    } else if (event.target.matches('input[data-size-picker]')) {
      setBrushSize(Number(event.target.value));
    } else if (event.target.matches('select[data-format="size"]')) {
      setFontSize(Number(event.target.value));
    } else if (event.target.matches('select[data-format="family"]')) {
      setFontFamily(event.target.value);
    }
  });
  document.addEventListener('click', (event) => {
    const floatingColorButton = event.target.closest('[data-floating-color]');
    if (floatingColorButton) {
      const panel = els.floatingFormatBar?.querySelector('[data-floating-color-panel]');
      setFloatingColorPaletteOpen(Boolean(panel?.hidden));
      return;
    }
    const floatingMenuTarget = event.target.closest('[data-floating-menu-target]');
    if (floatingMenuTarget) {
      setFloatingMenuView(floatingMenuTarget.dataset.floatingMenuTarget);
      return;
    }
    const floatingAppearanceTab = event.target.closest('[data-floating-appearance-tab]');
    if (floatingAppearanceTab) {
      setFloatingAppearanceTab(floatingAppearanceTab.dataset.floatingAppearanceTab);
      return;
    }
    const floatingMenuBack = event.target.closest('[data-floating-menu-back]');
    if (floatingMenuBack) {
      setFloatingMenuView('root');
      return;
    }
    if (event.target.closest('[data-floating-color-panel] [data-color]')) {
      setFloatingColorPaletteOpen(false);
    }
    const toolbarModeButton = event.target.closest('[data-text-toolbar-mode]');
    if (toolbarModeButton) {
      setTextToolbarMode(toolbarModeButton.dataset.textToolbarMode);
      return;
    }
    const floatingMoreButton = event.target.closest('[data-floating-more]');
    if (floatingMoreButton) {
      const panel = els.floatingFormatBar?.querySelector('[data-floating-more-panel]');
      if (panel) {
        closeFloatingSelectPickers();
        setFloatingMoreOpen(panel.hidden);
      }
      return;
    }
    if (event.target.closest('[data-context-panel-close]')) {
      selectItem(null);
      return;
    }
    if (event.target.closest('[data-note-appearance-reset]')) {
      applyNotePanelPatch({ ...DEFAULT_NOTE_APPEARANCE });
      return;
    }
    if (event.target.closest('[data-note-shadow]')) {
      const item = getSelectedOrEditingItem();
      if (item?.type === 'note') applyNotePanelPatch({ noteShadow: item.noteShadow === false });
      return;
    }
    if (event.target.closest('[data-note-lock]')) {
      const item = getSelectedOrEditingItem();
      if (item?.type === 'note') setContainerFlags('item', [item.id], { locked: !item.locked });
      return;
    }
    if (event.target.closest('[data-note-delete]')) {
      const item = getSelectedOrEditingItem();
      if (item?.type === 'note') {
        const itemId = item.id;
        finishEditing();
        deleteItems([itemId]);
      }
      return;
    }
    const noteFormatButton = event.target.closest('[data-note-format]');
    if (noteFormatButton) {
      const item = getSelectedOrEditingItem();
      const format = noteFormatButton.dataset.noteFormat;
      const mindContext = getEditingMindNodeContext();
      if (mindContext && (format === 'italic' || format === 'underline')) {
        const style = mindContext.node.style || {};
        applyMindNodeTextFormat(
          format === 'italic'
            ? { fontStyle: style.fontStyle === 'italic' ? null : 'italic' }
            : { textDecoration: style.textDecoration === 'underline' ? null : 'underline' }
        );
      } else if (item?.type === 'note' && (format === 'italic' || format === 'underline')) {
        applyNotePanelPatch({ [format]: !item[format] });
      }
      return;
    }
    const appearanceTab = event.target.closest('[data-text-appearance-tab]');
    if (appearanceTab) {
      selectTextAppearanceTab(appearanceTab.dataset.textAppearanceTab);
      return;
    }
    const borderStyleButton = event.target.closest('[data-text-border-style]');
    if (borderStyleButton) {
      setTextBoxBorderStyle(borderStyleButton.dataset.textBorderStyle);
      return;
    }
    const appearanceReset = event.target.closest('[data-text-appearance-reset]');
    if (appearanceReset) {
      resetTextBoxAppearance(appearanceReset.dataset.textAppearanceReset);
      return;
    }
    const formatButton = event.target.closest('[data-format]');
    if (formatButton) {
      if (formatButton.dataset.format === 'bold') {
        toggleBold();
      } else if (formatButton.dataset.format === 'align') {
        setTextAlign(formatButton.dataset.value);
      } else if (formatButton.dataset.format === 'reset') {
        resetTextFormatting();
      }
      return;
    }
    const listButton = event.target.closest('[data-list-mode]');
    if (listButton) {
      toggleTextListMode(listButton.dataset.listMode);
      return;
    }
    const layerButton = event.target.closest('[data-layer-action]');
    if (layerButton) {
      const action = layerButton.dataset.layerAction;
      moveSelectionZ(action);
      if (layerButton.closest('.floating-format-bar')) setFloatingMoreOpen(false);
      return;
    }
    const connectorButton = event.target.closest('[data-connector-action]');
    if (connectorButton) {
      toggleConnectorOption(connectorButton.dataset.connectorAction);
      return;
    }
    const tableButton = event.target.closest('[data-table-action]');
    if (tableButton) {
      const item = getSelectedOrEditingItem();
      const action = tableButton.dataset.tableAction;
      if (action === 'delete-row' || action === 'delete-column') {
        const focus = state.tableFocus?.itemId === item?.id ? state.tableFocus : null;
        deleteTableDimension(item, action === 'delete-row' ? 'row' : 'column', focus);
      } else {
        addTableDimension(item, action);
      }
      return;
    }
    const mindmapBranchButton = event.target.closest('[data-mindmap-branch-style]');
    if (mindmapBranchButton) {
      setMindMapBranchStyle(mindmapBranchButton.dataset.mindmapBranchStyle);
      return;
    }
    const mindNodeStyleButton = event.target.closest('[data-mind-node-style]');
    if (mindNodeStyleButton) {
      const action = mindNodeStyleButton.dataset.mindNodeStyle;
      if (action === 'reset') {
        setMindNodeStyle(null, { reset: true });
      } else {
        const item = getSelectedOrEditingItem();
        const selection = state.mindmapSelection?.itemId === item?.id ? state.mindmapSelection : null;
        const node = selection ? getMindNodeAtPath(item.tree, selection.path) : null;
        const active =
          action === 'bold'
            ? node?.style?.fontWeight === 'bold' || Number(node?.style?.fontWeight) >= 600
            : node?.style?.fontStyle === 'italic';
        setMindNodeStyle({ [action === 'bold' ? 'fontWeight' : 'fontStyle']: active ? 'normal' : action });
      }
    }
  });
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button === 0 && !event.target.closest('.context-menu')) {
        hideContextMenu();
      }
    },
    true
  );
  window.addEventListener('wheel', hideContextMenu, { passive: true });
  window.addEventListener('blur', hideContextMenu);
}

export { wireBoard, wireClipboard, wireExtras };

