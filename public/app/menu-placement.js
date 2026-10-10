import { chooseMenuPlacement } from './menu-placement-model.js';

const managed = new Map();
const preferredWidths = new WeakMap();
let frame = null, observer = null;
const supported = '.tool-popover,.context-menu,.canvas-menu,.brush-preset-menu,.note-originals-tray,.note-actions-panel';
const visibleRect = selector => {
  const element = document.querySelector(selector);
  if (!element || element.hidden) return null;
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height ? rect : null;
};

function position(menu, anchor) {
  const visual = window.visualViewport;
  const left = visual?.offsetLeft || 0, top = visual?.offsetTop || 0;
  const width = visual?.width || innerWidth, height = visual?.height || innerHeight;
  const mobile = document.documentElement.dataset.device === 'mobile';
  const style = getComputedStyle(document.documentElement);
  const safe = edge => Math.max(12, parseFloat(style.getPropertyValue(`--safe-${edge}`)) || 0);
  const bounds = { left: left + safe('left'), top: top + safe('top'), right: left + width - safe('right'), bottom: top + height - safe('bottom') };
  const header = visibleRect('.document-bar');
  if (header && header.bottom < bounds.bottom - 96) bounds.top = Math.max(bounds.top, header.bottom + 8);
  for (const selector of ['.tool-dock', '.touch-actions', '.canvas-view-controls']) {
    const rect = visibleRect(selector);
    if (!rect) continue;
    if (rect.width > rect.height && rect.top > bounds.top + 64) bounds.bottom = Math.min(bounds.bottom, rect.top - 8);
    else if (selector === '.tool-dock' && rect.width < rect.height) bounds.left = Math.max(bounds.left, rect.right + 8);
  }
  const rect = anchor?.getBoundingClientRect?.() || anchor;
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return;
  const anchorRect = { ...rect, left: rect.left, top: rect.top, right: rect.right ?? rect.left + (rect.width || 1), bottom: rect.bottom ?? rect.top + (rect.height || 1) };
  const dock = anchor?.closest?.('#toolDock')?.getBoundingClientRect();
  const preferred = dock ? (dock.width > dock.height ? 'above' : 'right') : 'below';
  const naturalWidth = preferredWidths.get(menu) || menu.offsetWidth || 320;
  const naturalHeight = Math.max(menu.scrollHeight, menu.offsetHeight);
  const placed = chooseMenuPlacement({ anchor: anchorRect, size: { width: Math.min(naturalWidth, mobile ? 480 : 600), height: naturalHeight }, bounds, preferred, sheet: mobile && width <= 600 });
  for (const [name, value] of Object.entries({ position: 'fixed', left: `${placed.x}px`, top: `${placed.y}px`, right: 'auto', bottom: 'auto', width: `${placed.width}px`, 'max-width': `${bounds.right - bounds.left}px`, 'max-height': `${placed.height}px`, 'min-height': '0px' })) {
    if (menu.style.getPropertyValue(name) !== value || menu.style.getPropertyPriority(name) !== 'important') menu.style.setProperty(name, value, 'important');
  }
  if (menu.dataset.menuPlacement !== placed.side) menu.dataset.menuPlacement = placed.side;
}

function schedule() {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    for (const [menu, anchor] of managed) {
      if (!menu.isConnected || menu.hidden || menu.dataset.menuClosing === 'true') { observer?.unobserve(menu); managed.delete(menu); continue; }
      position(menu, anchor);
    }
  });
}

export function placeAnchoredMenu(menu, anchor) {
  if (!menu?.matches(supported)) return;
  if(menu.matches('.tool-popover') && !menu.querySelector('.popover-heading,.tool-menu-heading')){
    const names={brushMenu:'画笔',eraserMenu:'橡皮',selectMenu:'选择',shapeMenu:'图形与贴纸',textMenu:'文本',tableMenu:'表格',layerMenu:'图层',navigationMenu:'地图导航',mindmapMenu:'脑图',backgroundMenu:'画板背景'};
    const title=names[menu.id];
    if(title){const heading=document.createElement('header');heading.className='tool-menu-heading';heading.textContent=title;menu.prepend(heading);}
  }
  if (!observer) {
    observer = new ResizeObserver(schedule);
    window.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('muse:device-change', schedule);
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
  }
  managed.set(menu, anchor);
  if (!preferredWidths.has(menu)) preferredWidths.set(menu, Math.max(280, menu.offsetWidth || 320));
  position(menu, anchor);
  observer.observe(menu);
}
