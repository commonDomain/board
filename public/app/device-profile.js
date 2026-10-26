// Device identity is independent of window width and the last pointer used.
// An iPad with a trackpad remains mobile; a narrow desktop window remains desktop.
export function classifyDevice({ userAgent = '', platform = '', mobileHint = false, touchPoints = 0, coarse = false, hover = true } = {}) {
  if (mobileHint || /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Tablet/i.test(userAgent)) return 'mobile';
  if (/Mac/i.test(platform + userAgent) && touchPoints > 1) return 'mobile';
  if (/Win|CrOS|X11|Linux x86_64/i.test(platform + userAgent)) return 'desktop';
  return touchPoints > 0 && coarse && !hover ? 'mobile' : 'desktop';
}

export function classifyFormFactor(profile = {}) {
  if (classifyDevice(profile) !== 'mobile') return 'desktop';
  const ua = profile.userAgent || '';
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return 'phone';
  if (/iPad|Tablet/i.test(ua) || (/MacIntel|Macintosh/i.test((profile.platform || '') + ua) && profile.touchPoints > 1)) return 'tablet';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet';
  return profile.screenShortSide > 0 && profile.screenShortSide < 600 ? 'phone' : 'tablet';
}

export function updateDeviceProfile() {
  const profile = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    mobileHint: navigator.userAgentData?.mobile === true,
    touchPoints: navigator.maxTouchPoints || 0,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hover: window.matchMedia('(hover: hover)').matches,
    screenShortSide: Math.min(window.screen.width, window.screen.height)
  };
  const device = classifyDevice(profile);
  const formFactor = classifyFormFactor(profile);
  const root = document.documentElement;
  root.dataset.formFactor = formFactor;
  if (root.dataset.device !== device) {
    root.dataset.device = device;
    window.dispatchEvent(new CustomEvent('muse:device-change', { detail: device }));
  }
  return device;
}

let initialized = false;
export function initializeDeviceProfile() {
  if (initialized) return;
  initialized = true;
  updateDeviceProfile();
  for (const query of ['(pointer: coarse)', '(hover: hover)']) window.matchMedia(query).addEventListener('change', updateDeviceProfile);
  window.addEventListener('pageshow', updateDeviceProfile);
  window.addEventListener('resize', updateDeviceProfile, { passive: true });
}
