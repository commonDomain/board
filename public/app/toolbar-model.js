import { STICKERS } from './constants.js';
import { state } from './state.js';

function getSticker(stickerId) {
  return STICKERS.find((sticker) => sticker.id === stickerId) || null;
}

function buildBackgroundMenu() {
  document.querySelectorAll('[data-background]').forEach((button) => {
    const active = button.dataset.background === state.background;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
export { getSticker, buildBackgroundMenu };
