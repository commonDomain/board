// Museboard adapter around Kando's pie-menu renderer (https://github.com/kando-menu/kando).
// The renderer files under ./vendor are taken from Kando (MIT) with small, marked patches;
// see ./README.md. This module exposes a tiny browser API for the whiteboard.

import { Menu } from './vendor/menu-renderer/menu';
import { MenuTheme } from './vendor/menu-renderer/menu-theme';
import { CenterText } from './vendor/menu-renderer/center-text';
import { IconThemeRegistry } from './vendor/common/icon-themes/icon-theme-registry';
import { MenuInteractionType, type MenuItem, type MenuThemeDescription } from './vendor/common';

export type WheelItem = {
  id?: string;
  label: string;
  icon: string;
  children?: WheelItem[];
};

type Options = {
  renderIcon: (name: string) => HTMLElement;
  onSelect: (id: string) => void;
  onClose?: () => void;
};

// Kando's defaults (general-settings-v1) except where a browser host needs different ones.
const SETTINGS = {
  enableSelectionWedges: false,
  underlineQuickSelectKey: false,
  drawQuickSelectKey: false,
  fadeInDuration: 120,
  fadeOutDuration: 140,
  enableMenuAnimations: true,
  enablePointerReactiveEffects: true,
  windowsInkWorkaround: false,
  // Kando's pie is infinite by default; a bound lets a click far away dismiss the menu.
  maxSelectionRadius: 230,
  centerDeadZone: 34,
  minParentDistance: 120,
  dragThreshold: 12,
  keepInputFocus: false,
  enableMarkingMode: true,
  enableTurboMode: false,
  warpMouse: false,
  hoverModeNeedsConfirmation: false,
  triggerCenterClickOnKeyRelease: false,
  gestureMinStrokeLength: 120,
  gestureMinStrokeAngle: 20,
  gestureJitterThreshold: 10,
  gesturePauseTimeout: 120,
  fixedStrokeLength: 0,
  rmbSelectsParent: false,
  enableGamepad: false,
  gamepadBackButton: 1,
  gamepadCloseButton: 2,
};

// The visual theme lives in Museboard's theme stylesheet (frontend/styles/themes/wheel.css).
const THEME: MenuThemeDescription = {
  id: 'museboard',
  directory: '',
  name: 'Museboard',
  author: 'Museboard',
  license: 'CC0-1.0',
  themeVersion: '1.0',
  engineVersion: 1,
  maxMenuRadius: 190,
  centerTextWrapWidth: 70,
  drawChildrenBelow: true,
  drawCenterText: true,
  drawSelectionWedges: false,
  drawWedgeSeparators: false,
  colors: {},
  layers: [
    { class: 'label-layer', content: 'name' },
    { class: 'icon-layer', content: 'icon' },
  ],
};

let theme: MenuTheme | null = null;

function toMenuItem(item: WheelItem, root = false): MenuItem & { museId?: string } {
  const children = item.children?.map((child) => toMenuItem(child));
  return {
    type: root ? 'root' : children?.length ? 'submenu' : 'button',
    name: item.label,
    icon: item.icon,
    iconTheme: 'lucide',
    ...(children?.length ? { children } : {}),
    museId: item.id,
  };
}

export function createWheel(host: HTMLElement, options: Options) {
  const container = document.createElement('div');
  container.className = 'hidden';
  container.id = 'kando-menu';
  host.appendChild(container);

  IconThemeRegistry.getInstance().setRenderer((_theme, icon) => options.renderIcon(icon));
  if (!theme) {
    theme = new MenuTheme();
    theme.loadDescription(THEME);
  }
  const centerText = new CenterText(container);
  centerText.setDiameter(theme.centerTextWrapWidth);
  centerText.setEnabled(theme.drawCenterText);

  const menu = new Menu(container, theme, centerText, SETTINGS);
  let root: (MenuItem & { museId?: string }) | null = null;
  let open = false;

  const itemAt = (path: number[]) => {
    let item = root;
    for (const index of path) item = (item?.children?.[index] as typeof item) ?? null;
    return item;
  };

  menu.on('interaction', (type: MenuInteractionType, path: number[]) => {
    if (type === MenuInteractionType.eSelectButton) {
      const id = itemAt(path)?.museId;
      menu.triggerInteraction(MenuInteractionType.eCloseMenu);
      if (id) queueMicrotask(() => options.onSelect(id));
    } else if (type === MenuInteractionType.eActivateMenu) {
      // A click on the root centre simply dismisses the menu.
      if (path.length === 0) menu.triggerInteraction(MenuInteractionType.eCloseMenu);
    } else if (type === MenuInteractionType.eCloseMenu) {
      if (open) {
        open = false;
        options.onClose?.();
      }
    }
  });

  return {
    show(items: WheelItem[], x: number, y: number) {
      root = toMenuItem({ label: '', icon: 'x', children: items }, true);
      open = true;
      menu.show(root as never, {
        mousePosition: { x, y },
        windowSize: { x: window.innerWidth, y: window.innerHeight },
        zoomFactor: 1,
        useFixedPosition: false,
        fixedMenuPosition: { x: 0.5, y: 0.5 },
        anchoredMode: false,
        hoverMode: false,
      });
    },
    close() {
      if (open) menu.triggerInteraction(MenuInteractionType.eCloseMenu);
    },
    get isOpen() {
      return open;
    },
  };
}
