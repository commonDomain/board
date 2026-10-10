import FontFamilies from '../../public/font-families.js';

const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const OP_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,128}$/;

const ITEM_TYPES = new Set([
  'planning',
  'ink',
  'image',
  'shape',
  'text',
  'note',
  'table',
  'mindmap',
  'connector',
  'sticker',
  'kdocs',
  'sheet',
  'amap-map',
  'amap-search',
  'amap-route'
]);

const AMAP_ITEM_TYPES = new Set(['amap-map', 'amap-search', 'amap-route']);

const STICKER_TYPES = new Set([
  'star',
  'heart',
  'check',
  'cross',
  'flag',
  'bulb',
  'lightning',
  'smile',
  'alert',
  'question',
  'arrow',
  'progress',
  'approved',
  'agree',
  'disagree',
  'bookmark',
  'pin',
  'target',
  'trophy',
  'rocket',
  'briefcase',
  'home',
  'todo',
  'document',
  'presentation',
  'bug',
  'repair',
  'announcement',
  'package',
  'comment',
  'meeting',
  'phone',
  'team',
  'email',
  'link',
  'bell',
  'clock',
  'calendar',
  'deadline',
  'waiting',
  'start',
  'pause',
  'leaf',
  'coffee',
  'music',
  'camera',
  'location',
  'gift',
  'travel'
]);

const TEXT_FONT_FAMILIES = new Set([
  ...FontFamilies.options.map(({ value }) => value),
  // Preserve font values stored by older clients.
  '"Microsoft YaHei", sans-serif',
  '"PingFang SC", sans-serif',
  '"Noto Sans SC", sans-serif',
  'serif',
  'monospace'
]);

const TEXT_BORDER_STYLES = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'wave',
  'stars',
  'vine',
  'paws',
  'realistic-ivy',
  'realistic-wildflower',
  'realistic-shells',
  'realistic-woodland'
]);
export {
  BOARD_ID_PATTERN,
  OP_ID_PATTERN,
  ITEM_TYPES,
  AMAP_ITEM_TYPES,
  STICKER_TYPES,
  TEXT_FONT_FAMILIES,
  TEXT_BORDER_STYLES
};
