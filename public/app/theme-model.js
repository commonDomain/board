// Shared by the browser and the server. Theme ids are persisted per account and canvas.
export const DEFAULT_THEME = 'classic';

export const THEMES = Object.freeze([
  { id: 'classic', name: '经典', description: '原有紫色玻璃界面与布局' },
  { id: 'focus', name: '专注', description: '底部工具岛，角落浮岛，黑白留白' },
  { id: 'workbench', name: '工作台', description: '标题栏、贴边工具栏与状态栏' },
  { id: 'paper', name: '文具', description: '纸白、蓝黑墨水与荧光笔' },
  { id: 'night', name: '夜灯', description: '深石墨界面与暖色灯光' }
]);

export const THEME_IDS = Object.freeze(THEMES.map((theme) => theme.id));

// Retired ids map to their closest successor so saved choices keep working.
const ALIASES = Object.freeze({ drafting: 'workbench', inkviolet: 'focus' });

export function isThemeId(value) {
  return typeof value === 'string' && THEME_IDS.includes(value);
}

export function normalizeTheme(value, fallback = DEFAULT_THEME) {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(ALIASES, value)) return ALIASES[value];
  return isThemeId(value) ? value : fallback;
}

// A canvas without its own choice uses the account default.
export function resolveCanvasTheme(preferences, boardId) {
  const canvases = preferences?.canvases || {};
  const own = boardId && Object.prototype.hasOwnProperty.call(canvases, boardId) ? canvases[boardId] : null;
  return normalizeTheme(own, normalizeTheme(preferences?.default));
}

export function sanitizeThemePreferences(value) {
  const result = { default: normalizeTheme(value?.default), canvases: {} };
  const canvases = value && typeof value.canvases === 'object' && value.canvases ? value.canvases : {};
  for (const [boardId, theme] of Object.entries(canvases).slice(0, 500)) {
    const normalized = normalizeTheme(theme, null);
    if (typeof boardId === 'string' && boardId.length > 0 && boardId.length <= 128 && normalized) {
      result.canvases[boardId] = normalized;
    }
  }
  return result;
}
