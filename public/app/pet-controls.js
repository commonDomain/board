import { els } from './elements.js';
import { isPhoneViewer } from './phone-view-model.js';
import { closePopovers } from './popovers.js';
import { buildContextMenu } from './selection.js';
import { state } from './state.js';

export function wirePetControls() {
  const feed = document.getElementById('feedPetButton');
  const ball = document.getElementById('throwPetBallButton');
  const feedback = document.getElementById('petFeedbackButton');
  const status = document.getElementById('petStatus');
  let pet = null;
  const update = () => {
    for (const [button, selected] of [[els.showPetButton, pet?.permanentlyHidden === false],
      [els.hidePetButton, pet?.permanentlyHidden === true], [feedback, pet?.feedbackEnabled === true]]) {
      button?.classList.toggle('active', selected);
      button?.setAttribute('aria-pressed', String(selected));
    }
    const ready = pet?.eligible && pet?.appeared;
    const available = ready && (!pet.busy || ['ambient', 'placement'].includes(pet.sequenceKind));
    if (feed) feed.disabled = !available;
    if (ball) ball.disabled = !available;
    if (feed) feed.textContent = pet?.placement?.kind === 'feed' ? '取消投喂' : '喂食';
    if (ball) ball.textContent = pet?.placement?.kind === 'ball' ? '取消扔球' : '扔球';
    if (feedback) feedback.disabled = !pet;
    if (status) status.textContent = !pet ? '宠物仅在桌面画板中显示'
        : pet.dismissed ? '点击显示宠物即可恢复陪伴'
          : pet.assetsFailed ? '宠物图片加载失败，点击显示宠物重试'
            : pet.loadingAssets ? '正在准备宠物，请稍候'
          : !ready ? '点击显示宠物，让它马上出现'
            : pet.placement ? '在画布点击投掷 · Esc 取消'
              : pet.busy && pet.sequenceKind === 'interaction' ? '正在互动，完成后可以继续'
              : '';
  };
  pet = isPhoneViewer() ? null : window.ToolbarPet?.init({
    dock: els.toolDock, viewport: els.viewport, onStateChange: update,
    getContext: () => `${state.boardId}:${state.canvasEpoch}`,
    showContextMenu: (x, y, hide) => buildContextMenu([
      { label: '喂食', action: () => pet.startPlacement('feed') },
      { label: '扔球', action: () => pet.startPlacement('ball') },
      { label: '暂时隐藏宠物', action: hide }
    ], x, y)
  });
  els.showPetButton?.addEventListener('click', () => { pet?.show(); update(); closePopovers(); });
  els.hidePetButton?.addEventListener('click', () => { pet?.hidePermanently(); update(); closePopovers(); });
  feed?.addEventListener('click', () => { pet?.startPlacement('feed'); closePopovers(); });
  ball?.addEventListener('click', () => { pet?.startPlacement('ball'); closePopovers(); });
  feedback?.addEventListener('click', () => pet?.setFeedbackEnabled(!pet.feedbackEnabled));
  update();
}
