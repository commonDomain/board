import { byId } from './dom.js';
import { renderProfile } from './profile.js';
import { copyText, downloadRecoveryKit, recoveryKitText } from './recovery.js';
import { state } from './state.js';

function wireRecoveryEvents() {
  byId('copyRecoveryKitButton').addEventListener('click', () =>
    copyText(recoveryKitText(), byId('recoveryCopyStatus'), '恢复资料已复制').catch(() => {})
  );
  byId('downloadRecoveryKitButton').addEventListener('click', downloadRecoveryKit);
  byId('recoveryKitAcknowledged').addEventListener('change', (event) => {
    byId('finishRecoveryKitButton').disabled = !event.target.checked;
  });
  byId('finishRecoveryKitButton').addEventListener('click', () => {
    const recoveryKit = state.recoveryKit;
    byId('recoveryKitDialog').hidden = true;
    if (recoveryKit?.reopenProfile && state.session) {
      byId('profileDialog').hidden = false;
      renderProfile();
      requestAnimationFrame(() => byId('rotateRecoveryButton')?.focus({ preventScroll: true }));
    }
    recoveryKit?.resolve?.();
    state.recoveryKit = null;
  });
}
export { wireRecoveryEvents };
