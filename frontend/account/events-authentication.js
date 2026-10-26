import { setAuthIntent, setOtherAuthMethodsExpanded } from './auth-view.js';
import { byId } from './dom.js';
import { changeEmailAddress, pollEmailClaim, resendEmailMagicLink, sendEmailMagicLink } from './email.js';
import { resetEmailAuthState } from './email-state.js';
import { cancelPairing, startPasskeyAuth } from './passkey.js';
import { copyText } from './recovery.js';
import { enterGuest } from './session.js';
import { state } from './state.js';
import { setError } from './view.js';

function wireAuthenticationEvents() {
  byId('registerPasskeyButton').addEventListener('click', (event) => startPasskeyAuth('register', event.currentTarget));
  byId('loginPasskeyButton').addEventListener('click', (event) => startPasskeyAuth('login', event.currentTarget));
  byId('authLoginTab').addEventListener('click', () => setAuthIntent('login'));
  byId('authRegisterTab').addEventListener('click', () => setAuthIntent('register'));
  byId('otherAuthMethodsToggle').addEventListener('click', () => {
    const overlay = byId('authDialog');
    const scrollTop = overlay.scrollTop;
    const expanded = byId('otherAuthMethodsToggle').getAttribute('aria-expanded') === 'true';
    setOtherAuthMethodsExpanded(!expanded);
    requestAnimationFrame(() => {
      overlay.scrollTop = scrollTop;
    });
  });
  byId('authLoginTab').parentElement.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const intent = event.key === 'ArrowRight' || event.key === 'End' ? 'register' : 'login';
    setAuthIntent(intent);
    byId(state.authIntent === 'register' ? 'authRegisterTab' : 'authLoginTab').focus();
  });
  byId('emailAuthForm').addEventListener('submit', sendEmailMagicLink);
  byId('resendEmailButton').addEventListener('click', () => {
    void resendEmailMagicLink();
  });
  byId('changeEmailButton').addEventListener('click', changeEmailAddress);
  byId('confirmEmailAccountSwitch').addEventListener('click', () => {
    byId('emailAccountSwitchState').hidden = true;
    void pollEmailClaim(true);
  });
  byId('cancelEmailAccountSwitch').addEventListener('click', () => {
    resetEmailAuthState();
    byId('authEmail').focus({ preventScroll: true });
  });
  byId('continueGuestButton').addEventListener('click', enterGuest);
  byId('openRecoveryButton').addEventListener('click', (event) => startPasskeyAuth('recovery', event.currentTarget));
  byId('cancelPairingButton').addEventListener('click', () => {
    void cancelPairing();
  });
  byId('copyPairingLinkButton').addEventListener('click', () => {
    if (state.pairing?.pairUrl)
      copyText(state.pairing.pairUrl).catch(() => setError(byId('pairingError'), '复制失败，请使用手机相机扫描。'));
  });
}
export { wireAuthenticationEvents };
