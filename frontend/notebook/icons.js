// Notebook vectors drawn to match the supplied Office-style toolbar references.
// Static SVG only: existing labels, commands and menu semantics remain unchanged.
const blue = 'var(--nt-icon-blue,#1683cf)';
const orange = 'var(--nt-icon-orange,#e88725)';
const glyph = (letter, attrs = '') => `<text x="12" y="19" text-anchor="middle" fill="currentColor" stroke="none" ${attrs.includes('font-family=') ? '' : 'font-family="Arial,Microsoft YaHei,sans-serif"'} ${attrs.includes('font-size=') ? '' : 'font-size="21"'} ${attrs}>${letter}</text>`;
const definitions = {
  contact:'<circle cx="7" cy="7" r="3"/><path d="M2 20v-3a5 5 0 0 1 10 0v3m3-14h7m-7 5h7m-7 5h7"/>',
  house:'<path d="m2 11 10-9 10 9M5 9v13h5v-8h4v8h5V9"/>',
  film:'<rect x="3" y="2" width="18" height="20"/><path d="M7 2v20M17 2v20M3 6h4m-4 6h4m-4 6h4m10-12h4m-4 6h4m-4 6h4"/>',
  music:`<path d="M10 19V3l10-2v16M10 5l10-2" stroke="${blue}"/><ellipse cx="6" cy="19" rx="4" ry="3" stroke="${blue}"/><ellipse cx="16" cy="17" rx="4" ry="3" stroke="${blue}"/>`,
  'message-square':'<path d="M2 3h20v15H9l-6 5v-5H2z"/>',
  send:'<path d="m2 2 21 10L2 22l4-10zM6 12h17"/>',
  'calendar-check':`<rect x="3" y="4" width="18" height="18"/><path d="M7 1v6m10-6v6M3 9h18"/><path d="m7 15 3 3 7-6" stroke="${blue}"/>`,
  'remove-formatting':`${glyph('A','font-size="20"')}<path d="m15 14 7 5-4 5-7-5z" stroke="#b13fcc"/>`,
  'note-tags':`<rect x="2" y="3" width="14" height="15"/><path d="m5 9 3 3 6-7"/><path d="m17 12 2 4 4 .5-3 3 .7 4-3.7-2-3.7 2 .7-4-3-3 4-.5z" fill="${orange}" fill-opacity=".15" stroke="${orange}"/>`,
  'tag-remove':'<rect x="2" y="3" width="14" height="15"/><path d="m5 9 3 3 6-7M16 16l6 6m0-6-6 6" stroke="#e84b59"/>',
  'text-style':`${glyph('A','font-size="20"')}<path d="m11 21 7-12 3 2-7 11zM10 22h4" stroke="${blue}"/><path d="m20 4 2 2 2-2"/>`,
  'resize-width':'<path d="m8 8-4 4 4 4m8-8 4 4-4 4M4 12h16"/>',
  'format-brush':`<path d="m14 2 4 3-5 6-4-3zM5 7l9 8-5 6-7-6zM6 17l4-5"/><path d="m2 15 3-4 6 5-2 5z" fill="${orange}" fill-opacity=".3" stroke="${orange}"/>`,
  'view-focus':'<path d="M7 2H2v5m15-5h5v5M2 17v5h5m15-5v5h-5"/><rect x="7" y="5" width="10" height="14"/><path d="M9 9h6m-6 4h6"/>',
  'view-directory':`<rect x="2" y="3" width="20" height="18"/><path d="M9 3v18M4 7h3m-3 4h3m-3 4h3" stroke="${blue}"/>`,
  'page-fit':`<rect x="7" y="3" width="10" height="18"/><path d="M1 12h5m-3-3-3 3 3 3m20-3h-5m3-3 3 3-3 3" stroke="${blue}"/>`,
  'zoom-reset':'<text x="12" y="15" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="currentColor" stroke="none">1:1</text><path d="M3 6h4m-4 0V2M3 6a10 10 0 1 1-1 10"/>',
  'paper-plain':'<path d="M5 2h10l4 4v16H5zM15 2v5h4"/>',
  'paper-lines':`<path d="M5 2h10l4 4v16H5zM15 2v5h4"/><path d="M8 10h8m-8 4h8m-8 4h8" stroke="${blue}"/>`,
  'paper-grid':`<path d="M5 2h10l4 4v16H5zM15 2v5h4"/><path d="M8 10h8v9H8zM12 10v9m-4-5h8" stroke="${blue}"/>`,
  'print-page':'<path d="M6 7V2h12v5M5 18H2V8h20v10h-3M6 14h12v8H6zM5 11h2m2 6h6m-6 3h6"/>',
  'undo-2':'<path d="M4 3v8h8M4 11l5-5a7 7 0 0 1 10 10l-7 6"/>',
  'redo-2':'<path d="M20 3v8h-8m8 0-5-5A7 7 0 0 0 5 16l7 6"/>',
  bold:glyph('B','font-weight="700"'),
  italic:glyph('I','font-family="Georgia,serif" font-style="italic"'),
  underline:`${glyph('U','font-size="19"')}<path d="M5 22h14"/>`,
  highlighter:'<path d="m6 15 9-11a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 18Zm0 0-3 4h6l1-1M14 5l5 5"/><path d="M2 22h20" stroke="var(--nt-icon-highlight,#eeed00)" stroke-width="3"/>',
  'text-color':`${glyph('A','font-size="20"')}<path d="M2 22h20" stroke="var(--nt-format-color,#d92e35)" stroke-width="3"/>`,
  list:`<path d="M9 5h13M9 12h13M9 19h13"/><path d="M2 3h4v4H2zm0 7h4v4H2zm0 7h4v4H2z" fill="${blue}" stroke="none"/>`,
  'list-ordered':`<path d="M9 5h13M9 12h13M9 19h13"/><g fill="${blue}" stroke="none" font-family="Arial,sans-serif" font-size="8"><text x="1" y="7">1</text><text x="1" y="14">2</text><text x="1" y="22">3</text></g>`,
  'list-checks':`<path d="M9 5h13M9 12h13M9 19h13"/><path d="m1 5 2 2 3-4m-5 9 2 2 3-4m-5 9 2 2 3-4" stroke="${blue}"/>`,
  'table-2':'<rect x="2" y="2" width="20" height="20" rx=".5"/><path d="M2 7h20M2 12h20M2 17h20M8 7v15m7-15v15"/><path d="M2.5 2.5h19v4h-19z" fill="currentColor" fill-opacity=".12" stroke="none"/>',
  image:`<rect x="2" y="4" width="20" height="16" rx=".5"/><path d="m3 19 7-8 6 6 3-3 2 3" fill="${blue}" fill-opacity=".28" stroke="${blue}"/><circle cx="17" cy="8" r="1.7" fill="${orange}" stroke="none"/>`,
  link:'<path d="M9 7H6a5 5 0 0 0 0 10h4m4-10h4a5 5 0 0 1 0 10h-3M8 12h9"/>',
  unlink:'<path d="M8 7H6a5 5 0 0 0 0 10h2m8-10h2a5 5 0 0 1 0 10h-2M3 2l18 20"/>',
  clipboard:'<path d="M8 5H4v17h16V5h-4"/><path d="M9 2h6v2h2v4H7V4h2z"/>',
  'clipboard-paste':'<path d="M8 5H4v17h7m5-17h4v5M9 2h6v2h2v4H7V4h2z"/><path d="M13 12h9v10h-9zM16 15h3m-3 3h3"/>',
  'pen-tool':`<path d="m5 17 10-13 5 4L10 20l-6 2zM14 5l5 4M5 17l5 3"/><path d="m4 22 2-5 4 3z" fill="${blue}" fill-opacity=".35"/>`,
  eraser:`<path d="m4 15 9-12 8 7-9 12H9zM8 10l8 7"/><path d="m4 15 4-5 8 7-4 5H9z" fill="var(--nt-icon-purple,#b549cb)" fill-opacity=".2"/>`,
  type:`${glyph('A','font-size="20"')}<path d="M4 22h16" stroke="${blue}"/>`,
  'text-cursor':'<path d="M2 4h14M9 4v16m-4 0h8m6-17h3m-1 0v18m-2 0h3"/>',
  'type-select':'<path d="m2 11 1 11 3-4 4 2zM8 14l3-10 4 10m-6-3h5m3-7h5m-2.5 0v14m-2.5 0h5"/>',
  palette:`<path d="M12 2a10 10 0 1 0 0 20h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a4 4 0 0 0 4-4c0-5-5-9-10-9z"/><circle cx="6" cy="10" r="1.3" fill="${blue}" stroke="none"/><circle cx="10" cy="6" r="1.3" fill="${orange}" stroke="none"/><circle cx="16" cy="7" r="1.3" fill="#c82536" stroke="none"/>`,
  'sticky-note':`<path d="M3 3h18v13l-5 6H3zM16 22v-6h5"/><path d="M3.5 3.5h17v12h-5v6h-12z" fill="${orange}" fill-opacity=".13" stroke="none"/>`,
  tag:`<path d="M3 3h10l9 9-10 10-9-9z"/><path d="M4 4h8l8.5 8.5-8 8L4 12z" fill="${orange}" fill-opacity=".12" stroke="none"/><circle cx="7.5" cy="7.5" r="1.2"/>`,
  check:`<rect x="3" y="3" width="18" height="18"/><path d="m7 12 3 3 7-8" stroke="${blue}"/>`,
  files:'<path d="M5 5h16v16H5zM2 18V2h16M8 8h10v10H8z"/>',
  search:'<circle cx="14" cy="9" r="7"/><path d="m9 14-7 8"/>',
  ellipsis:'<g fill="currentColor" stroke="none"><circle cx="4" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="20" cy="12" r="1.4"/></g>',
  'grip-vertical':'<g fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></g>',
  'copy-plus':'<path d="M7 3h14v14M3 7h14v14H3zM7 14h6m-3-3v6"/>',
  'users-round':'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5"/>'
};

export function notebookIcon(name) {
  const markup=definitions[name];
  if(!markup)return null;
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');
  icon.setAttribute('stroke-width','1.2');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
  icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
  icon.classList.add('nt-office-icon');icon.dataset.notebookIcon=name;
  icon.innerHTML=markup;
  return icon;
}

export function renderNotebookIcons(root) {
  if(!root)return;
  for(const placeholder of root.querySelectorAll('i[data-lucide]')) {
    const icon=notebookIcon(placeholder.dataset.lucide);
    if(icon)placeholder.replaceWith(icon);
  }
}
