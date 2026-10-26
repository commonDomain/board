import { state } from './state.js';
import { setTool } from './toolbar.js';
import { setBrush, setShape } from './format-actions.js';
import { BRUSHES, SHAPES } from './constants.js';
import { pasteClipboard } from './clipboard.js';
import { getBoardPoint } from './camera.js';
import { hitTestItem } from './rendering.js';
import { isPhoneViewer } from './phone-view-model.js';
import { closePopovers } from './popovers.js';
import { showToast } from './interface-model.js';

// Radial tool wheel for studio themes, rendered by Kando's pie-menu engine
// (public/kando-menu.js, built from frontend/kando-menu). Right-click empty canvas, or
// press and hold with a finger, to open it. Choosing a group moves the menu outwards to
// that item and fans its options around it; the path back stays visible.
const LONG_PRESS_MS = 520;
const LONG_PRESS_SLOP = 10;
let wheelModule = null;
let wheel = null;
let layer = null;
let loading = null;
let bypassContextMenu = false;
let lastPoint = null;
let longPress = null;

const BRUSH_ICONS = { brush: 'pen-tool', pencil: 'paintbrush', calligraphy: 'pencil', spray: 'sparkles', oil: 'paint-bucket', crayon: 'highlighter', marker: 'highlighter', 'normal-pencil': 'pencil', watercolor: 'palette' };
const SHAPE_ICONS = { rect: 'square', 'round-rect': 'square', ellipse: 'circle', line: 'minus', 'arrow-right': 'arrow-right', triangle: 'triangle', star: 'star', heart: 'heart' };
const brushName = (id) => BRUSHES.find((brush) => brush.id === id)?.name || id;
const shapeName = (id) => SHAPES.find((shape) => shape.id === id)?.name || id;
const click = (selector) => document.querySelector(selector)?.click();

function definition() {
  const brushes = BRUSHES.map((brush) => ({ id: `brush:${brush.id}`, label: brush.name, icon: BRUSH_ICONS[brush.id] || 'pen-tool' }));
  const brushItems = brushes.length > 7 ? [...brushes.slice(0, 6), { label: '更多笔刷', icon: 'ellipsis', children: brushes.slice(6) }] : brushes;
  const shapes = ['rect', 'ellipse', 'line', 'arrow-right', 'triangle', 'star']
    .filter((id) => SHAPES.some((shape) => shape.id === id))
    .map((id) => ({ id: `shape:${id}`, label: shapeName(id), icon: SHAPE_ICONS[id] || 'shapes' }));
  return [
    { id: 'tool:select', label: '选择', icon: 'mouse-pointer-2' },
    { label: '画笔', icon: 'pen-tool', children: brushItems },
    { id: 'tool:eraser', label: '橡皮', icon: 'eraser' },
    { label: '图形', icon: 'shapes', children: [...shapes, { id: 'open:shape', label: '全部图形', icon: 'layout-grid' }] },
    { id: 'tool:pan', label: '平移', icon: 'hand' },
    { id: 'tool:text', label: '文本', icon: 'type' },
    { id: 'tool:note', label: '便签', icon: 'sticky-note' },
    {
      label: '更多', icon: 'ellipsis',
      children: [
        { id: 'tool:connector', label: '连线', icon: 'workflow' },
        { id: 'tool:section', label: '画框', icon: 'panel-top' },
        { id: 'open:table', label: '表格', icon: 'table-2' },
        { id: 'open:mindmap', label: '脑图', icon: 'network' },
        { id: 'action:paste', label: '粘贴', icon: 'clipboard-paste' },
        { id: 'action:undo', label: '撤销', icon: 'undo-2' },
        { id: 'action:menu', label: '完整菜单', icon: 'menu' }
      ]
    }
  ];
}

function run(id) {
  const [kind, value] = id.split(':');
  closePopovers({ immediate: true });
  if (kind === 'tool') setTool(value);
  else if (kind === 'brush') { setBrush(value); setTool('pen'); showToast(`画笔：${brushName(value)}`); }
  else if (kind === 'shape') { setShape(value); setTool('shape'); }
  else if (kind === 'open') click(`#${value}Button`);
  else if (id === 'action:paste') pasteClipboard({ atPointer: true });
  else if (id === 'action:undo') click('#undoButton');
  // Wait for the selecting pointer-up to finish so it does not dismiss the new menu.
  else if (id === 'action:menu') setTimeout(openClassicMenu, 60);
}

function openClassicMenu() {
  if (!lastPoint) return;
  const target = document.elementFromPoint(lastPoint.x, lastPoint.y) || document.getElementById('viewport');
  bypassContextMenu = true;
  try {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lastPoint.x, clientY: lastPoint.y, button: 2 }));
  } finally {
    bypassContextMenu = false;
  }
}

// Icons are placeholders until the menu is in the document; the icon library only
// processes attached elements, so they are rendered right after show().
function renderIcon(name) {
  const glyph = document.createElement('i');
  glyph.dataset.lucide = name;
  return glyph;
}

function finish() {
  layer?.classList.remove('is-open');
}

async function ensureWheel() {
  if (wheel) return wheel;
  loading ||= (async () => {
    // Resolved next to this module, so it shares the fingerprinted, immutable cache path.
    wheelModule = await import('../kando-menu.js');
    layer = document.createElement('div');
    layer.className = 'tool-wheel-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', '圆盘工具盘');
    document.body.append(layer);
    wheel = wheelModule.createWheel(layer, { renderIcon, onSelect: run, onClose: finish });
    return wheel;
  })();
  try { return await loading; }
  catch (error) { loading = null; throw error; }
}

async function openAt(x, y) {
  try {
    const instance = await ensureWheel();
    if (instance.isOpen) return;
    lastPoint = { x, y };
    layer.classList.add('is-open');
    instance.show(definition(), x, y);
    try { window.MuseIcons?.renderIcons(layer); } catch { /* labels still identify every item */ }
  } catch (error) {
    finish();
    console.warn('Tool wheel unavailable', error);
  }
}

function eligible(event) {
  if (document.documentElement.dataset.ui !== 'studio' || isPhoneViewer()) return false;
  if (!state.boardId || state.editingId || state.selectedIds?.size || state.compatibilityReadOnly) return false;
  const target = event.target;
  if (!target?.closest?.('#viewport') || target.closest('.board-item, .section-titlebar, .canvas-start, input, textarea, [contenteditable="true"]')) return false;
  if (state.tool === 'select' || state.tool === 'eraser' || state.tool === 'pan') {
    try { if (hitTestItem(getBoardPoint(event))) return false; } catch { return false; }
  }
  return true;
}

function onContextMenu(event) {
  if (bypassContextMenu || !eligible(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openAt(event.clientX, event.clientY);
}

function cancelLongPress() {
  if (!longPress) return;
  clearTimeout(longPress.timer);
  longPress = null;
}

function onPointerDown(event) {
  cancelLongPress();
  if (event.pointerType !== 'touch' || !event.isPrimary || !['pan', 'select'].includes(state.tool) || !eligible(event)) return;
  const { pointerId, clientX, clientY } = event;
  longPress = {
    pointerId, x: clientX, y: clientY,
    timer: setTimeout(() => {
      if (!longPress || longPress.pointerId !== pointerId) return;
      longPress = null;
      navigator.vibrate?.(8);
      void openAt(clientX, clientY);
    }, LONG_PRESS_MS)
  };
}

function onPointerMove(event) {
  if (!longPress) return;
  if (event.pointerId !== longPress.pointerId) { cancelLongPress(); return; }
  if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_SLOP) cancelLongPress();
}

function closeWheel() {
  cancelLongPress();
  if (wheel?.isOpen) wheel.close();
}

export function initializeToolWheel() {
  const viewport = document.getElementById('viewport');
  if (!viewport || viewport.dataset.toolWheel) return;
  viewport.dataset.toolWheel = '';
  viewport.addEventListener('contextmenu', onContextMenu, true);
  viewport.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  for (const type of ['pointerup', 'pointercancel', 'wheel']) window.addEventListener(type, cancelLongPress, { passive: true, capture: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && wheel?.isOpen) { event.preventDefault(); event.stopPropagation(); wheel.close(); }
  }, true);
  for (const type of ['muse:account-changing', 'muse:logout', 'muse:theme-change', 'resize']) window.addEventListener(type, closeWheel);
}
