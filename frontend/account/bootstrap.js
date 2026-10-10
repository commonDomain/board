import { showAuth } from './auth-view.js';
import { initialize } from './lifecycle.js';
import { refreshProfile, refreshSharing } from './profile.js';
import { expireSession } from './session.js';
import { global, state } from './state.js';

global.MuseAccount = Object.freeze({
  initialize,
  get mode() {
    return state.mode;
  },
  get session() {
    return state.session;
  },
  isGuest() {
    return state.mode === 'guest';
  },
  csrfToken() {
    return state.session?.csrfToken || null;
  },
  showAuth,
  expireSession,
  refreshProfile,
  refreshSharing
});
