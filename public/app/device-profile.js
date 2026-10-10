// Device identity is independent of window width and the last pointer used.
// An iPad with a trackpad remains mobile; a narrow desktop window remains desktop.
export function classifyDevice({ userAgent = '', platform = '', mobileHint = false, touchPoints = 0, coarse = false, hover = true } = {}) {
  if (mobileHint || /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Tablet/i.test(userAgent)) return 'mobile';
  if (/Mac/i.test(platform + userAgent) && touchPoints > 1) return 'mobile';
  if (/Win|CrOS|X11|Linux x86_64/i.test(platform + userAgent)) return 'desktop';
  return touchPoints > 0 && coarse && !hover ? 'mobile' : 'desktop';
}

export function updateDeviceProfile() {
  const device = classifyDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    mobileHint: navigator.userAgentData?.mobile === true,
    touchPoints: navigator.maxTouchPoints || 0,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hover: window.matchMedia('(hover: hover)').matches
  });
  const root = document.documentElement;
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
