import { byId } from './dom.js';
import { resetEmailAuthState } from './email-state.js';
import { closeAccountMenu } from './account-menu.js';
import { state } from './state.js';
import { refreshIcons, setError } from './view.js';

function showAuth(message = '') {
  closeAccountMenu();
  byId('pairingDialog').hidden = true;
  byId('authDialog').hidden = false;
  setError(byId('authError'), message);
  renderAuthProviders();
  requestAnimationFrame(() => {
    const target = state.authProviders.email
      ? !byId('emailAccountSwitchState').hidden
        ? byId('confirmEmailAccountSwitch')
        : byId('emailSentState').hidden
          ? byId('authEmail')
          : byId('changeEmailButton')
      : state.authProviders.passkey !== false
        ? byId('loginPasskeyButton')
        : byId('continueGuestButton');
    target?.focus({ preventScroll: true });
  });
}

function renderAuthProviders() {
  const emailEnabled = Boolean(state.authProviders.email);
  const passkeyEnabled = state.authProviders.passkey !== false;
  const registrationEnabled = state.authProviders.registration !== false;
  const guestEnabled = state.authProviders.guest !== false;
  const authIcon = byId('authDialog')?.querySelector('.account-card-icon');
  const authIconName = emailEnabled ? 'mail' : 'key-round';
  if (authIcon && authIcon.dataset.iconName !== authIconName) {
    authIcon.dataset.iconName = authIconName;
    authIcon.innerHTML = `<i data-lucide="${authIconName}" aria-hidden="true"></i>`;
    refreshIcons(authIcon);
  }
  if (!registrationEnabled && state.authIntent === 'register') state.authIntent = 'login';
  byId('emailAuthForm').hidden =
    !emailEnabled || !byId('emailSentState').hidden || !byId('emailAccountSwitchState').hidden;
  byId('authLoginTab').parentElement.hidden = !emailEnabled;
  byId('authRegisterTab').hidden = !registrationEnabled;
  byId('registerPasskeyButton').hidden =
    !passkeyEnabled || !registrationEnabled || (emailEnabled && state.authIntent !== 'register');
  byId('loginPasskeyButton').hidden = !passkeyEnabled || (emailEnabled && state.authIntent !== 'login');
  byId('openRecoveryButton').hidden = !passkeyEnabled || (emailEnabled && state.authIntent !== 'login');
  const otherEnabled = passkeyEnabled;
  byId('otherAuthMethodsToggle').querySelector('span').textContent = emailEnabled ? '其他登录方式' : 'Passkey 安全访问';
  byId('otherAuthMethods').hidden = !otherEnabled;
  setOtherAuthMethodsExpanded(otherEnabled && !emailEnabled);
  byId('guestAuthDivider').hidden = !guestEnabled;
  byId('continueGuestButton').hidden = !guestEnabled;
  byId('guestAuthFootnote').hidden = !guestEnabled;
  if (!emailEnabled) {
    byId('emailSentState').hidden = true;
    byId('authDescription').textContent = registrationEnabled
      ? '使用 Passkey 安全登录或创建账号。'
      : '使用 Passkey 安全进入你的账号。';
    byId('authDescription').hidden = false;
  } else {
    byId('authDescription').textContent = state.authIntent === 'register' ? '验证邮箱后创建账号，无需设置密码。' : '';
    byId('authDescription').hidden = state.authIntent === 'login';
  }
}

function setOtherAuthMethodsExpanded(expanded) {
  const methods = byId('otherAuthMethods');
  const toggle = byId('otherAuthMethodsToggle');
  const content = byId('otherAuthMethodsContent');
  const isExpanded = Boolean(expanded);
  methods.classList.toggle('is-open', isExpanded);
  toggle.setAttribute('aria-expanded', String(isExpanded));
  content.setAttribute('aria-hidden', String(!isExpanded));
  content.inert = !isExpanded;
}

function setAuthIntent(intent) {
  const nextIntent = intent === 'register' && state.authProviders.registration !== false ? 'register' : 'login';
  if (state.authIntent !== nextIntent && !byId('emailSentState').hidden) resetEmailAuthState();
  state.authIntent = nextIntent;
  byId('authLoginTab').setAttribute('aria-selected', String(state.authIntent === 'login'));
  byId('authRegisterTab').setAttribute('aria-selected', String(state.authIntent === 'register'));
  byId('authLoginTab').tabIndex = state.authIntent === 'login' ? 0 : -1;
  byId('authRegisterTab').tabIndex = state.authIntent === 'register' ? 0 : -1;
  byId('emailAuthSubmit').querySelector('span').textContent =
    state.authIntent === 'register' ? '发送注册链接' : '发送登录链接';
  setError(byId('authError'), '');
  renderAuthProviders();
}
export { showAuth, renderAuthProviders, setOtherAuthMethodsExpanded, setAuthIntent };
