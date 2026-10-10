const key = 'wb:touch-preferences';
let fallback = { penOnly: false, rotate: false };
export function touchPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return { penOnly: saved?.penOnly === true, rotate: saved?.rotate === true };
  } catch { return { ...fallback }; }
}
export function setTouchPreference(name, value) {
  if (!['penOnly', 'rotate'].includes(name)) return;
  const preferences = { ...touchPreferences(), [name]: Boolean(value) };
  fallback = preferences;
  try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Storage can be unavailable in private sessions. */ }
  window.dispatchEvent(new CustomEvent('muse:touch-preferences', { detail: preferences }));
}
export function openTouchSettings() {
  const existing = document.querySelector('.touch-settings');
  if (existing) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'touch-settings';
  dialog.setAttribute('aria-label', '触控设置');
  const heading = document.createElement('h2'); heading.textContent = '触控设置'; dialog.append(heading);
  const prefs = touchPreferences();
  for (const [name, title, hint] of [
    ['penOnly', '仅手写笔绘制', '开启后，绘写工具下用手指移动视图；关闭时也可用手指绘画。'],
    ['rotate', '双指旋转画布', '默认双指只移动与缩放；此选项不旋转笔记页。']
  ]) {
    const label = document.createElement('label'); const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = prefs[name]; input.addEventListener('change', () => setTouchPreference(name, input.checked));
    const text = document.createElement('span'); text.textContent = title;
    const small = document.createElement('small'); small.textContent = hint; text.append(small); label.append(input, text); dialog.append(label);
  }
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '完成';
  close.addEventListener('click', () => dialog.close()); dialog.append(close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
}
