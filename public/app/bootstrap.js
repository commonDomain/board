import { showToast } from './interface-model.js';
import { init } from './lifecycle.js';
import { state } from './state.js';
import { configureInteractions } from './composition/index.js';
import { initialize as initializeImpact } from './connector-impact.js';
import { initialize as initializeConnectors } from './connector/bootstrap.js';
import { installUiFeedback } from './ui-feedback.js';
import { initializePlanning } from './planning-bridge.js';
import { initializeChat } from './chat.js';
import { initializeSideTools } from './side-tools.js';
import { initializeThemes } from './themes.js';
import { initializeDeviceProfile } from './device-profile.js';
import { isPhoneViewer } from './phone-view-model.js';
import { initializeAppVersion } from './app-version.js';
import { prepareCanvasReload } from './canvas-session.js';
import { createSafePageReload, verifyReloadEntry } from './page-reload-safety.js';

async function startApplication() {
  initializeDeviceProfile();
  window.MuseEffects?.configureForDevice?.();
  configureInteractions();
  if (!isPhoneViewer()) {
    initializeImpact();
    initializeConnectors();
  }
  installUiFeedback();
  await initializePlanning().catch(error => showToast(`规划功能暂不可用：${error.message}`));
  await init();
  initializeAppVersion({ prepareReload: createSafePageReload({
    checkEntry: verifyReloadEntry,
    getContext: () => JSON.stringify([window.MuseAccount?.session?.user?.id, window.MuseAccount?.mode,
      window.MuseAccount?.csrfToken?.(), state.boardId, state.canvasEpoch]),
    checkBusy: () => {
      if (document.querySelector('[data-transfer-busy="true"]')) throw new Error('文件正在传输，请完成或取消传输后再刷新。');
    },
    saves: [{ name: '笔记', run: options => window.MuseNotebook?.preparePageReload?.(options) },
      { name: '规划', run: options => window.MusePlanning?.preparePageReload?.(options) },
      { name: '画布', run: prepareCanvasReload }]
  }) });
  initializeChat();
  try { initializeThemes(); }
  catch(error) { console.error('Theme initialization failed', error); }
  try { initializeSideTools(); }
  catch(error) { showToast(`快传和五子棋暂不可用：${error.message}`); }
}

startApplication().catch((error) => {
  state.initializationError = error.message;
  console.error('Whiteboard initialization failed', error);
  showToast('画板初始化失败，请刷新后重试');
});
