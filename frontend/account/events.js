import { wireNavigationEvents } from './events-navigation.js';
import { wireAuthenticationEvents } from './events-authentication.js';
import { wireRecoveryEvents } from './events-recovery.js';
import { wireProfileEvents } from './events-profile.js';
import { wireAvatarEvents } from './events-avatar.js';
import { wireSecurityEvents } from './events-security.js';
import { wireSharingEvents } from './events-sharing.js';

function wireUi() {
  if (document.documentElement.dataset.accountWired === 'true') return;
  document.documentElement.dataset.accountWired = 'true';
  wireNavigationEvents();
  wireAuthenticationEvents();
  wireRecoveryEvents();
  wireProfileEvents();
  wireAvatarEvents();
  wireSecurityEvents();
  wireSharingEvents();
}
export { wireUi };
