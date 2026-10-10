'use strict';
const { element, iconButton } = require('./controls');
function createToolbarControls(doc) {
  function referenceGlyph(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('sheet-reference-glyph', `is-${kind}`);
    const add = (name, attrs) => {
      const node = doc.createElementNS(ns, name);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      svg.appendChild(node);
    };
    if (kind === 'formula') {
      add('path', {
        d: 'M18 4H6l6 8-6 8h12',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
    } else if (kind === 'sort') {
      add('path', {
        d: 'M4 6h8M4 11h6M4 16h4M17 4v15m0 0-3-3m3 3 3-3',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.45',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
    } else if (kind === 'filter') {
      add('path', {
        d: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.45',
        'stroke-linejoin': 'round'
      });
    } else if (kind === 'freeze') {
      add('rect', {
        x: '3.5',
        y: '3.5',
        width: '17',
        height: '17',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.25'
      });
      add('path', {
        d: 'M10 4v16M4 10h16',
        fill: 'none',
        stroke: '#168455',
        'stroke-width': '1.35'
      });
      add('path', {
        d: 'M4 4h6v6H4Z',
        fill: 'rgba(22,132,85,.11)',
        stroke: 'none'
      });
    } else if (kind === 'border') {
      add('rect', {
        x: '3.5',
        y: '3.5',
        width: '17',
        height: '17',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.35'
      });
      add('path', {
        d: 'M12 4v16M4 12h16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.05'
      });
    }
    return svg;
  }

  function menuChevron() {
    const chevron = element('i', 'sheet-menu-chevron');
    chevron.dataset.lucide = 'chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    return chevron;
  }

  function labeledTool(icon, label, showChevron = false) {
    const custom = String(icon).startsWith('sheet:');
    const button = custom
      ? element('button', 'sheet-tool sheet-tool-labeled')
      : iconButton(icon, label, 'sheet-tool sheet-tool-labeled');
    if (custom) {
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.appendChild(referenceGlyph(String(icon).slice(6)));
    }
    button.appendChild(element('span', null, label));
    if (showChevron) button.appendChild(menuChevron());
    return button;
  }
  return { labeledTool, menuChevron, referenceGlyph };
}
module.exports = { createToolbarControls };
