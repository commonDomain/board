import { byId } from './dom.js';
import { appendLockIconAnimation, appendUnlockIconAnimation } from './sharing.js';
import { gsap, state } from './state.js';

function resetPrivacyTimer() {
  if (byId('privacyShield').hidden === false) return;
  state.lastActivityAt = Date.now();
  clearTimeout(state.privacyTimer);
  state.privacyTimer = setTimeout(lockPrivacy, Number(state.authProviders.privacyLockIdleMs) || 15 * 60 * 1000);
}

function lockPrivacy() {
  const remaining =
    (Number(state.authProviders.privacyLockIdleMs) || 15 * 60 * 1000) - (Date.now() - state.lastActivityAt);
  if (remaining > 0) {
    state.privacyTimer = setTimeout(lockPrivacy, remaining);
    return;
  }
  const shield = byId('privacyShield');
  const closedLock = shield.querySelector('.privacy-lock-closed');
  const openLock = shield.querySelector('.privacy-lock-open');
  gsap?.set(closedLock, { autoAlpha: 1, x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'transform' });
  gsap?.set(openLock, { autoAlpha: 0, x: 0, y: 0, rotation: 0, scale: 1, clearProps: 'transform' });
  shield.hidden = false;
  document.documentElement.classList.add('privacy-locked');
  if (gsap) {
    state.privacyTimeline?.kill();
    state.privacyTimeline = gsap
      .timeline()
      .fromTo(shield, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28, ease: 'power2.out' }, 0);
    appendLockIconAnimation(state.privacyTimeline, closedLock, openLock, 0.06);
  }
  shield.focus({ preventScroll: true });
}

function unlockPrivacy() {
  const shield = byId('privacyShield');
  if (shield.hidden) return;
  const closedLock = shield.querySelector('.privacy-lock-closed');
  const openLock = shield.querySelector('.privacy-lock-open');
  state.privacyTimeline?.kill();
  const finish = () => {
    shield.hidden = true;
    document.documentElement.classList.remove('privacy-locked');
    gsap?.set([shield, closedLock, openLock], { clearProps: 'transform,opacity,visibility,willChange' });
    resetPrivacyTimer();
  };
  if (!gsap) {
    finish();
    return;
  }
  state.privacyTimeline = appendUnlockIconAnimation(gsap.timeline({ onComplete: finish }), closedLock, openLock)
    .to(shield, { scale: 1, duration: 0.32 })
    .to(shield, { autoAlpha: 0, scale: 1.015, duration: 0.22, ease: 'power2.in' });
}

function wirePrivacy() {
  const shield = byId('privacyShield');
  const activity = (event) => {
    if (event.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    resetPrivacyTimer();
  };
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
    document.addEventListener(type, activity, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lockPrivacy();
  });
  shield.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  shield.addEventListener('click', (event) => {
    event.stopPropagation();
    unlockPrivacy();
  });
  shield.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      unlockPrivacy();
    }
  });
  resetPrivacyTimer();
}

export { lockPrivacy, resetPrivacyTimer, unlockPrivacy, wirePrivacy };
