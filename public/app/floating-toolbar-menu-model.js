import { state } from './state.js';

function syncFloatingSelectPicker(select) {
  const wrapper = select?.closest('[data-floating-select-picker]');
  if (!wrapper) return;
  const menu = wrapper.querySelector('.floating-select-menu');
  if (menu) {
    const options = Array.from(select.options);
    const buttons = Array.from(menu.querySelectorAll('.sheet-select-option'));
    if (
      options.length !== buttons.length ||
      options.some((option, index) => option.value !== buttons[index]?.dataset.value)
    ) {
      menu.replaceChildren(...options.map((option) => wrapper.makeFloatingOptionButton(option)));
    }
  }
  const selected = select.options[select.selectedIndex];
  const label = wrapper.querySelector('[data-floating-select-label]');
  if (label) label.textContent = selected?.textContent || select.value;
  wrapper.querySelectorAll('.sheet-select-option').forEach((button) => {
    const active = button.dataset.value === select.value;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function animateFloatingToolbarControl(control) {
  const controls = control?.closest('.floating-format-controls');
  if (!controls || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const controlRect = control.getBoundingClientRect();
  const rootRect = controls.getBoundingClientRect();
  const bloom = document.createElement('span');
  bloom.className = 'floating-control-bloom';
  bloom.style.left = `${controlRect.left - rootRect.left}px`;
  bloom.style.top = `${controlRect.top - rootRect.top}px`;
  bloom.style.width = `${controlRect.width}px`;
  bloom.style.height = `${controlRect.height}px`;
  controls.appendChild(bloom);
  bloom
    .animate(
      [
        { opacity: 0, transform: 'scale(.62)', borderRadius: '18px' },
        { opacity: 0.9, transform: 'scale(1.06)', offset: 0.48, borderRadius: '11px' },
        { opacity: 0, transform: 'scale(1)', borderRadius: '10px' }
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)' }
    )
    .finished.finally(() => bloom.remove());
  control.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.34 }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(.2,.9,.2,1)'
  });
}

function isFormattingEditorActive(item) {
  if (!item) return false;
  if (item.type === 'mindmap') return state.mindmapEditing?.itemId === item.id;
  return ['text', 'note', 'table'].includes(item.type) && state.editingId === item.id;
}

function isFloatingToolbarTarget(item) {
  return Boolean(item && ['text', 'note', 'table', 'mindmap'].includes(item.type));
}

function floatingToolbarUsesTarget(item) {
  return state.textToolbarMode === 'floating' && isFloatingToolbarTarget(item) && isFormattingEditorActive(item);
}
export {
  syncFloatingSelectPicker,
  animateFloatingToolbarControl,
  isFormattingEditorActive,
  isFloatingToolbarTarget,
  floatingToolbarUsesTarget
};
