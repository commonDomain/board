import { wireTouchControls } from './touch-controls.js';
import { updateRedoButton, updateUndoButton } from './history-controller.js';

import { isGuestMode, wireAccountLifecycle, wireNetworkLifecycle } from './account-lifecycle.js';
import { refreshAmapCapabilities } from './amap-api.js';
import { wireAmapMessages } from './amap-rendering.js';
import { applyBackground } from './background.js';
import { buildBrushMenu, buildEraserMenu } from './brush-menu.js';
import { centerOnOrigin, scheduleCameraApply } from './camera.js';
import { updateZoomLabel } from './camera-model.js';
import { handlePageHide, restoreLocalBoardStateAndConnect } from './canvas-session.js';
import { clearLegacyCanvasRoute } from './catalog-model.js';
import { loadCanvasCatalog, wireCanvasControls } from './catalog.js';
import { setConnection } from './connection.js';
import { els } from './elements.js';
import { wireBoard, wireClipboard, wireExtras } from './events.js';
import { scheduleFloatingToolbarPosition } from './floating-toolbar-menu.js';
import { setBrushSize, updateFormatControls } from './format-actions-model.js';
import { buildFloatingFormatBar } from './format-controls.js';
import { buildContextPanel, updateContextPanel } from './format-panel.js';
import {
  configureWebViewRuntime,
  initializeInterfaceEffects,
  updateViewportHeight,
  wireAdaptiveDialog
} from './interface.js';
import { refreshIcons } from './interface-model.js';
import { buildLayerMenu } from './layers.js';
import { wireOrganizationFeatures } from './navigator-controller.js';

import { buildContextMenu } from './selection.js';
import { state } from './state.js';
import { wireNotesWorkspace } from './notes-bridge.js';
import {
  applyDocumentBarVisibility,
  applyToolDockVisibility,
  buildSelectMenu,
  buildShapeMenu,
  buildStickerMenu,
  buildTableMenu,
  buildTextMenu,
  setTool,
  wireToolbar
} from './toolbar.js';
import { buildBackgroundMenu } from './toolbar-model.js';
import { refreshXmindConnectionStatus } from './xmind-connection.js';
import { scheduleXmindRemoteCheck } from './xmind-sync.js';

async function init() {
  configureWebViewRuntime();
  wireAccountLifecycle();
  await window.MuseAccount?.initialize();
  // Navigation availability is independent from loading the current canvas.
  // Let it resolve alongside the editor bootstrap so a slow upstream check
  // cannot delay the canvas catalog, cached snapshot, or WebSocket join.
  void refreshAmapCapabilities();
  void refreshXmindConnectionStatus();
  buildBrushMenu();
  buildEraserMenu();
  buildSelectMenu();
  buildLayerMenu();
  buildShapeMenu();
  buildStickerMenu();
  buildBackgroundMenu();
  buildTextMenu();
  buildTableMenu();
  buildContextPanel();
  buildFloatingFormatBar();
  wireAdaptiveDialog();
  wireToolbar();
  applyDocumentBarVisibility();
  applyToolDockVisibility();
  wireCanvasControls();
  wireBoard();
  wireClipboard();
  wireExtras();
  wireAmapMessages();
  wireOrganizationFeatures();
  wireNotesWorkspace();
  wireTouchControls();
  
  initializeInterfaceEffects();
  setTool(state.tool);
  setBrushSize(state.size);
  updateFormatControls();
  updateContextPanel();
  updateUndoButton();
  updateRedoButton();
  updateZoomLabel();
  applyBackground();
  centerOnOrigin();
  window.addEventListener('resize', () => {
    applyToolDockVisibility();
    // The wallpaper drift is measured from the viewport centre, so a new viewport
    // box needs a fresh camera apply.
    scheduleCameraApply();
    scheduleFloatingToolbarPosition();
  });
  window.addEventListener('focus', () => {
    if (!isGuestMode()) {
      void refreshXmindConnectionStatus();
      scheduleXmindRemoteCheck(500, true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isGuestMode()) {
      void refreshXmindConnectionStatus();
      scheduleXmindRemoteCheck(500, true);
    }
  });
  window.addEventListener('orientationchange', updateViewportHeight);
  window.visualViewport?.addEventListener('resize', updateViewportHeight);
  window.visualViewport?.addEventListener('scroll', updateViewportHeight);
  document.addEventListener('focusin', updateViewportHeight);
  document.addEventListener('focusout', () => requestAnimationFrame(updateViewportHeight));
  window.addEventListener('pagehide', handlePageHide);
  wireNetworkLifecycle();
  clearLegacyCanvasRoute();
  await loadCanvasCatalog({ selectFirst: true, forceRender: true });
  state.initialized = true;
  window.ToolbarPet?.init({
    dock: els.toolDock,
    showContextMenu: (x, y, hide) => buildContextMenu([{ label: '暂时隐藏柯基', action: hide }], x, y)
  });
  if (state.boardId) await restoreLocalBoardStateAndConnect();
  else setConnection('idle');
  refreshIcons();
}

export { init };

