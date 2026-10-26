import { byId } from './dom.js';
import { state } from './state.js';

function recoveryKitText(code = state.recoveryKit?.code) {
  const user = state.session?.user;
  return `Muse Board 账号恢复资料\n\n账号 ID：${user?.accountId || ''}\n当前用户名：${user?.username || ''}\n恢复码：${code || ''}\n\n请妥善保存，不要发送给他人。\n`;
}

function showRecoveryKit(code) {
  const reopenProfile = byId('profileDialog').hidden === false;
  if (reopenProfile) byId('profileDialog').hidden = true;
  state.recoveryKit = { code, reopenProfile };
  byId('recoveryKitAccountId').textContent = state.session.user.accountId;
  byId('recoveryKitUsername').textContent = state.session.user.username;
  byId('recoveryKitCode').textContent = code;
  byId('recoveryKitAcknowledged').checked = false;
  byId('finishRecoveryKitButton').disabled = true;
  byId('recoveryKitDialog').hidden = false;
  requestAnimationFrame(() => byId('copyRecoveryKitButton')?.focus({ preventScroll: true }));
  return new Promise((resolve) => {
    state.recoveryKit.resolve = resolve;
  });
}

async function copyText(text, statusElement = null, successMessage = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    if (statusElement) statusElement.textContent = successMessage;
  } catch (error) {
    if (statusElement) statusElement.textContent = '复制失败，请手动复制。';
    throw error;
  }
}

function downloadRecoveryKit() {
  const blob = new Blob([recoveryKitText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `muse-board-${state.session.user.accountId}-recovery.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export { copyText, downloadRecoveryKit, recoveryKitText, showRecoveryKit };
