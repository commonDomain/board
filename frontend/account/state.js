const global = window;

const EMAIL_CLAIM_STORAGE_KEY = 'muse.email-auth-claim.v1';

const ACCOUNT_REQUEST_TIMEOUT_MS = 15_000;

const webAuthn = global.SimpleWebAuthnBrowser;

const gsap = global.MuseGsap?.gsap || global.MuseGsap?.default || global.MuseGsap;

const nativeFetch = global.fetch.bind(global);

const state = {
  mode: 'pending',
  session: null,
  resolveStartup: null,
  startupPromise: null,
  recoveryKit: null,
  authProviders: {
    email: false,
    passkey: true,
    registration: true,
    guest: true,
    sharing: true,
    sharingMaxMembers: 5,
    maxAvatarSize: 5242880,
    maxPasskeys: 10,
    maxSessions: 20,
    privacyLockIdleMs: 900000
  },
  authIntent: 'login',
  pendingEmail: '',
  emailResendTimer: null,
  emailClaim: null,
  emailClaimTimer: null,
  pairing: null,
  pairingTimer: null,
  sharing: null,
  removal: null,
  avatarCrop: null,
  pendingAvatar: null,
  pendingSession: null,
  recentAuth: null,
  lockTimeline: null,
  privacyTimeline: null,
  privacyTimer: null,
  lastActivityAt: Date.now()
};

export { ACCOUNT_REQUEST_TIMEOUT_MS, EMAIL_CLAIM_STORAGE_KEY, global, gsap, nativeFetch, state, webAuthn };
