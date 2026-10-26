// SPDX-FileCopyrightText: Simon Schneegans <code@simonschneegans.de>
// SPDX-License-Identifier: MIT
//
// [Museboard] Reduced stand-in for Kando's src/common/index.ts. The menu renderer only
// needs these runtime enums and type shapes; the Electron-specific settings schemata,
// IPC and action registries are intentionally not included.

export type Vec2 = { x: number; y: number };

export type TypedEventEmitter<Events extends Record<string, unknown[]>> = {
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean;
};

/** Enum for the different things a user can do in a menu. */
export enum MenuInteractionType {
  eOpenMenu = 'openMenu',
  eOpenSubmenu = 'openSubmenu',
  eCloseMenu = 'closeMenu',
  eCloseSubmenu = 'closeSubmenu',
  eHoverParent = 'hoverParent',
  eHoverCenter = 'hoverCenter',
  eHoverButton = 'hoverButton',
  eHoverSubmenu = 'hoverSubmenu',
  eSelectButton = 'selectButton',
  eActivateMenu = 'activateMenu',
}

/** Where a selection came from. */
export enum SelectionSource {
  eUnknown = 'unknown',
  eClick = 'click',
  eKeyboard = 'keyboard',
  eGesture = 'gesture',
  eGamepad = 'gamepad',
}

type Workflow = { quickSelectKey?: string };

export type MenuItem = {
  type: 'root' | 'submenu' | 'button';
  name: string;
  icon: string;
  iconTheme: string;
  angle?: number;
  children?: ChildMenuItem[];
  activateWorkflow?: Workflow;
  selectWorkflow?: Workflow;
  openWorkflow?: Workflow;
  hoverWorkflow?: Workflow;
  [key: string]: unknown;
};
export type RootMenuItem = MenuItem & { type: 'root' };
export type SubmenuMenuItem = MenuItem & { type: 'submenu' };
export type ChildMenuItem = MenuItem;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeneralSettings = Record<string, any>;

export type ShowMenuOptions = {
  readonly mousePosition: Vec2;
  readonly windowSize: Vec2;
  readonly zoomFactor: number;
  useFixedPosition: boolean;
  readonly fixedMenuPosition: Vec2;
  readonly anchoredMode: boolean;
  readonly hoverMode: boolean;
  readonly systemIconsChanged?: boolean;
};

export type MenuThemeDescription = {
  id: string;
  directory: string;
  readonly name: string;
  readonly author: string;
  readonly themeVersion: string;
  readonly engineVersion: number;
  readonly license: string;
  readonly maxMenuRadius: number;
  readonly centerTextWrapWidth: number;
  readonly drawChildrenBelow: boolean;
  readonly drawCenterText?: boolean;
  readonly drawSelectionWedges?: boolean;
  readonly drawWedgeSeparators?: boolean;
  readonly colors: Record<string, string>;
  readonly layers: { class: string; content: 'none' | 'name' | 'icon' | 'quick-select-key' }[];
};
