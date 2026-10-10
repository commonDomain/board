'use strict';

const Formula = typeof window === 'object' ? window.SheetFormula : require('../../public/sheet-formula.js');
const {
  FILL_SWATCHES,
  FONT_FAMILIES,
  FONT_SIZES,
  NUMBER_FORMATS,
  TEXT_SWATCHES,
  element,
  formatIdFromPattern,
  textButton
} = require('./controls');

function createToolbarPickers({ labeledTool, menuChevron, toolbar, referenceGlyph }) {
  function actionMenu(icon, label, className, choices) {
    const wrapper = element('span', `sheet-menu-picker ${className || ''}`.trim());
    const button = labeledTool(icon, label);
    button.classList.add('sheet-menu-trigger');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(menuChevron());
    const menu = element('div', 'sheet-action-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    for (const choice of choices) {
      if (!choice) {
        menu.appendChild(element('div', 'sheet-action-menu-separator'));
        continue;
      }
      const [action, choiceIcon, choiceLabel] = choice;
      const item = element('button', 'sheet-action-menu-item');
      item.type = 'button';
      item.dataset.action = action;
      item.setAttribute('role', 'menuitem');
      const glyph = element('i');
      glyph.dataset.lucide = choiceIcon;
      glyph.setAttribute('aria-hidden', 'true');
      item.append(glyph, element('span', null, choiceLabel));
      menu.appendChild(item);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const opening = menu.hidden;
      closeToolbarMenus(menu);
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
    });
    wrapper.append(button, menu);
    return wrapper;
  }

  function syncSelectMenu(select) {
    const wrapper = select.closest('.sheet-select-picker');
    if (!wrapper) return;
    const option = select.options[select.selectedIndex] || select.options[0];
    const label = wrapper.querySelector('[data-role="picker-label"]');
    if (label) label.textContent = option?.textContent || '';
    wrapper.querySelectorAll('.sheet-select-option').forEach((item) => {
      const selected = item.dataset.value === select.value;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-checked', String(selected));
    });
  }

  function selectMenu(select) {
    const wrapper = element('span', 'sheet-menu-picker sheet-select-picker');
    wrapper.dataset.picker = select.dataset.action || '';
    select.classList.add('sheet-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const labelText = select.getAttribute('aria-label') || select.title || '';
    const button = element('button', 'sheet-tool sheet-tool-labeled sheet-menu-trigger sheet-select-trigger');
    button.type = 'button';
    button.title = labelText;
    button.setAttribute('aria-label', labelText);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const current = element('span', null, '');
    current.dataset.role = 'picker-label';
    button.append(current, menuChevron());
    const menu = element('div', 'sheet-action-menu sheet-select-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    Array.from(select.options).forEach((option) => {
      const item = element('button', 'sheet-action-menu-item sheet-select-option', option.textContent || '');
      item.type = 'button';
      item.dataset.value = option.value;
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        select.value = option.value;
        syncSelectMenu(select);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(item);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const opening = menu.hidden;
      closeToolbarMenus(menu);
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
    });
    wrapper.append(select, button, menu);
    syncSelectMenu(select);
    return wrapper;
  }

  function closeToolbarMenus(except = null) {
    toolbar.querySelectorAll('.sheet-color-menu, .sheet-border-menu, .sheet-action-menu').forEach((menu) => {
      if (menu === except) return;
      menu.hidden = true;
      menu
        .closest('.sheet-color, .sheet-border-picker, .sheet-menu-picker')
        ?.querySelector('[aria-expanded]')
        ?.setAttribute('aria-expanded', 'false');
    });
  }

  function swatchPicker(className, iconName, action, swatches, label) {
    const wrapper = element('span', `sheet-color ${className}`);
    const button = element('button', 'sheet-tool sheet-tool-labeled');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const glyph = element('i');
    glyph.dataset.lucide = iconName;
    glyph.setAttribute('aria-hidden', 'true');
    const bar = element('span', 'sheet-color-bar');
    button.append(glyph, element('span', null, label), menuChevron(), bar);
    const menu = element('div', 'sheet-color-menu');
    menu.hidden = true;
    for (const color of swatches) {
      const swatch = element('button', 'sheet-swatch');
      swatch.type = 'button';
      swatch.dataset.color = color;
      swatch.dataset.action = action;
      swatch.style.background = color;
      swatch.title = color;
      swatch.setAttribute('aria-label', color);
      menu.appendChild(swatch);
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeToolbarMenus(menu);
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
    });
    wrapper.append(button, menu);
    return wrapper;
  }

  function borderPicker() {
    const wrapper = element('span', 'sheet-border-picker');
    const button = element('button', 'sheet-tool sheet-tool-labeled sheet-border-trigger');
    button.type = 'button';
    button.title = '边框';
    button.setAttribute('aria-label', '边框');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const borderGlyph = referenceGlyph('border');
    borderGlyph.classList.add('sheet-border-glyph');
    button.append(borderGlyph, element('span', null, '边框'), menuChevron());
    const menu = element('div', 'sheet-border-menu');
    menu.hidden = true;
    const choices = [
      ['border-clear', '无框线', 'none'],
      ['border-all', '所有框线', 'all'],
      ['border-outer', '外侧框线', 'outer'],
      ['border-thick-outer', '粗框框线', 'thick'],
      ['border-bottom', '下框线', 'bottom'],
      ['border-top', '上框线', 'top'],
      ['border-left', '左框线', 'left'],
      ['border-right', '右框线', 'right']
    ];
    menu.appendChild(element('strong', 'sheet-border-menu-title', '边框'));
    for (const [action, label, mode] of choices) {
      const item = textButton('', 'sheet-border-option');
      item.dataset.action = action;
      item.title = label;
      item.setAttribute('aria-label', label);
      const mark = element('span', 'sheet-border-mark');
      mark.dataset.borderMode = mode;
      if (mode === 'all') {
        for (let index = 0; index < 4; index += 1) mark.appendChild(element('span', 'sheet-border-cell'));
      }
      item.append(mark, element('span', null, label));
      menu.append(item);
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeToolbarMenus(menu);
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
    });
    wrapper.append(button, menu);
    return wrapper;
  }

  function trackPickerPointer(event) {
    const select = event.target.closest?.('[data-action="format"]');
    if (!select) return;
    select.dataset.pointer = event.type === 'pointerdown' ? 'down' : 'up';
    if (event.type === 'pointerup') {
      setTimeout(() => {
        delete select.dataset.pointer;
      }, 0);
    }
  }

  function resetPickerPointer() {
    const select = toolbar.querySelector('[data-action="format"]');
    if (select) delete select.dataset.pointer;
  }
  return {
    actionMenu,
    syncSelectMenu,
    selectMenu,
    closeToolbarMenus,
    swatchPicker,
    borderPicker,
    trackPickerPointer,
    resetPickerPointer
  };
}
module.exports = { createToolbarPickers };
