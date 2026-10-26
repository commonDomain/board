import {
  normalizeNoteFill,
  noteFillTone,
  noteHighlightStrength,
  normalizeNoteStyle,
  normalizeTextAppearanceColor,
  normalizeTextFill,
  normalizeTextOpacity
} from './format-panel-model.js';
import { clamp } from './utilities.js';

// A note's paper layer: the card plus everything that belongs to the sheet (theme decorations, curl
// shadows). Opacity lives here so tape, clips and shadows fade together with the paper, while the
// selection frame stays outside on the item root.
function renderNotePaper(item, card) {
  const paper = document.createElement('div');
  paper.className = 'note-paper';
  // Empty layer whose pseudo-elements cast the lifted-curl shadows behind the card.
  const lift = document.createElement('i');
  lift.className = 'note-lift';
  lift.setAttribute('aria-hidden', 'true');
  paper.append(lift, card);
  applyNotePaperAppearance(paper, item);
  return paper;
}

function applyNotePaperAppearance(paper, item) {
  if (!paper) return;
  paper.dataset.noteStyle = normalizeNoteStyle(item.noteStyle);
  paper.dataset.noteShadow = String(item.noteShadow !== false);
  paper.dataset.noteBorder = item.noteBorder === 'solid' ? 'solid' : 'none';
  paper.style.setProperty('--note-fill', normalizeNoteFill(item.noteFill));
  paper.dataset.noteTone = noteFillTone(item.noteFill);
  paper.style.setProperty('--note-hi', String(noteHighlightStrength(item.noteFill)));
  setNotePaperOpacity(paper, Number.isFinite(Number(item.noteOpacity)) ? Number(item.noteOpacity) : 1);
}

function setNotePaperOpacity(paper, opacity) {
  if (paper) paper.style.opacity = String(clamp(opacity, 0, 1));
}

// Reflect a text box's fill-panel effects (plain text, shadow, opacity) in a menu's controls.
function syncTextBoxEffectControls(root, item) {
  if (!root || item?.type !== 'text') return;
  const current = {
    fill: normalizeTextFill(item.textFill),
    border: normalizeTextAppearanceColor(item.textBorderColor, 'default')
  };
  const plain = current.fill === 'none';
  root.querySelectorAll('.text-swatch-row').forEach((row) => {
    let matched = false;
    row.querySelectorAll('[data-text-swatch]').forEach((swatch) => {
      const active = swatch.dataset.value === current[swatch.dataset.textSwatch];
      matched ||= active;
      swatch.classList.toggle('active', active);
      swatch.setAttribute('aria-pressed', String(active));
    });
    const more = row.querySelector('[data-text-color-more]');
    if (!more) return;
    const value = current[more.dataset.textColorMore];
    more.classList.toggle('active', !matched);
    more.style.setProperty('--swatch', !matched && value.startsWith('#') ? value : 'transparent');
  });
  root.querySelectorAll('[data-text-shadow]').forEach((toggle) => {
    toggle.setAttribute('aria-checked', String(item.textShadow !== false));
    toggle.disabled = plain;
  });
  const percent = Math.round(normalizeTextOpacity(item.textOpacity) * 100);
  root.querySelectorAll('[data-text-opacity]').forEach((input) => (input.value = String(percent)));
  root.querySelectorAll('[data-text-opacity-value]').forEach((output) => (output.textContent = `${percent}%`));
}

export { renderNotePaper, applyNotePaperAppearance, setNotePaperOpacity, syncTextBoxEffectControls };
