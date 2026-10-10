import { global } from './state.js';

function setError(element, message) {
  if (!element) return;
  element.textContent = message || '';
  element.hidden = !message;
}

function refreshIcons(root = document) {
  try {
    global.MuseIcons?.renderIcons(root);
  } catch {}
}

function avatarMarkup(user, fallback = 'user') {
  if (user?.avatarUrl) return `<img src="${escapeAttribute(user.avatarUrl)}" alt="">`;
  const first = Array.from(user?.username || '')[0];
  return first ? escapeHtml(first.toUpperCase()) : `<i data-lucide="${fallback}" aria-hidden="true"></i>`;
}

function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
  );
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export { avatarMarkup, escapeAttribute, escapeHtml, refreshIcons, setError };
