import { byId } from './dom.js';
import { manageAccountDialogKeyboard } from './dialog-keyboard.js';
import { scheduleEmailClaimPoll } from './email.js';
import { schedulePairingPoll } from './passkey.js';
import { closeAccountMenu, openAccountMenu } from './account-menu.js';
import { global, state } from './state.js';
import { refreshIcons } from './view.js';

function wireNavigationEvents() {
  global.addEventListener('online', () => {
    if (state.emailClaim) scheduleEmailClaimPoll(100);
    if (state.pairing) schedulePairingPoll(100);
  });
  global.addEventListener('offline', () => {
    if (state.emailClaim?.intent === 'bind')
      byId('emailManageStatus').textContent = '网络已断开，恢复后将自动继续确认。';
    else if (state.emailClaim) byId('emailSentTitle').textContent = '等待网络恢复';
    if (state.pairing) byId('pairingStatus').textContent = '网络已断开，二维码仍然有效。';
  });
  byId('accountButton').addEventListener('click', () =>
    byId('accountMenu').hidden ? openAccountMenu() : closeAccountMenu()
  );
  document.addEventListener('pointerdown', (event) => {
    if (
      !byId('accountMenu').hidden &&
      !byId('accountMenu').contains(event.target) &&
      !byId('accountButton').contains(event.target)
    )
      closeAccountMenu();
  });
  document.addEventListener('keydown', manageAccountDialogKeyboard, true);
  refreshIcons();
}
export { wireNavigationEvents };
