import { showToast } from './interface-model.js';
import { init } from './lifecycle.js';
import { state } from './state.js';
import { configureInteractions } from './composition/index.js';
import { initialize as initializeImpact } from './connector-impact.js';
import { initialize as initializeConnectors } from './connector/bootstrap.js';
import { installUiFeedback } from './ui-feedback.js';
import { initializePlanning } from './planning-bridge.js';

async function startApplication() {
  configureInteractions();
  initializeImpact();
  initializeConnectors();
  installUiFeedback();
  await initializePlanning().catch(error => showToast(`规划功能暂不可用：${error.message}`));
  await init();
}

startApplication().catch((error) => {
  state.initializationError = error.message;
  console.error('Whiteboard initialization failed', error);
  showToast('画板初始化失败，请刷新后重试');
});
