import { byId } from './dom.js';

function openAccountMenu() {
  const menu = byId('accountMenu');
  menu.hidden = false;
  byId('accountButton').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => menu.querySelector('button:not([hidden])')?.focus({ preventScroll: true }));
}

function closeAccountMenu() {
  byId('accountMenu').hidden = true;
  byId('accountButton').setAttribute('aria-expanded', 'false');
}
export { openAccountMenu, closeAccountMenu };
