const MIN_ITEM_SIZE = 32;

const MAX_IMAGE_SIDE = 620;

const MAX_IMAGE_TRANSMIT_BYTES = 15 * 1024 * 1024;

const EXPORT_MAX_SCALE = 15;

const EXPORT_MAX_PIXELS = 160_000_000;

const EXPORT_MAX_SIDE = 30_720;

const EXPORT_TILE_PIXEL_SIDE = 4096;

const MAX_CANVASES = 10;

const MAX_CANVAS_NAME_LENGTH = 30;

const CANVAS_PREVIEW_BACKGROUND = '#050506';

const CANVAS_PREVIEW_STYLE_VERSION = 4;

const CANVAS_PREVIEW_REFRESH_DELAY = 700;

const CANVAS_CATALOG_FRESH_MS = 15_000;

const DOCUMENT_VERSION = 5;

const SNAPSHOT_DEFERRED_TYPES = new Set([
  'committed',
  'board-lock',
  'saved',
  'error',
  'sheet-lock-result',
  'sheet-lock-changed'
]);

const MAX_UNDO_STEPS = 40;

const MAX_UNDO_BYTES = 32 * 1024 * 1024;

const MIN_ZOOM = 0.1;

const MAX_ZOOM = 4;

const WHEEL_ZOOM_SMOOTHING_MS = 45;

const WHEEL_ZOOM_SETTLE_RATIO = 0.004;

const PAN_DRAG_THRESHOLD = 5;

const MIDDLE_DOUBLE_CLICK_DELAY = 420;

const MIDDLE_DOUBLE_CLICK_DISTANCE = 8;

const MIDDLE_FOCUS_SCREEN_PADDING = 64;

const MIDDLE_FOCUS_ZOOM_CAP = 2.4;

const DEFAULT_SHAPE_STROKE = 4;

const MIN_TABLE_COLUMN_WIDTH = 72;

const MIN_TABLE_HEIGHT = 44;

const TABLE_EDIT_MIN_ZOOM = 0.5;

const SNAP_ACQUIRE_DISTANCE_PX = 6;

const SNAP_RELEASE_DISTANCE_PX = 10;

const SNAP_GRID_MIN_SPACING_PX = 8;

const MAX_TABLE_ROWS = 200;

const MAX_TABLE_COLUMNS = 50;

const SPATIAL_INDEX_OBJECT_THRESHOLD = 500;

const VIEWPORT_VIRTUALIZATION_OBJECT_THRESHOLD = 2000;

const EXTREME_CANVAS_OBJECT_THRESHOLD = 10000;

const VIEWPORT_RENDER_MARGIN_PX = 300;

const VIEWPORT_RETAIN_MARGIN_PX = 450;

const TOOL_DOCK_COLLAPSED_KEY = 'wb:toolDockCollapsed';

const DOCUMENT_BAR_COLLAPSED_KEY = 'wb:documentBarCollapsed';

const TEXT_TOOLBAR_MODE_KEY = 'wb:textToolbarMode';

const FLOATING_TOOLBAR_GAP = 12;

const FLOATING_TOOLBAR_CARET_GAP = 32;

const FLOATING_TOOLBAR_SNAP_GAP = 12;

const FLOATING_TOOLBAR_SNAP_DISTANCE = 12;

const FLOATING_TOOLBAR_SNAP_RELEASE_DISTANCE = 20;

const TEXT_LIST_STYLES = new Set(['none', 'number', 'bullet', 'todo']);

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

const TEXT_DECORATIVE_BORDER_STYLES = new Set([
  'wave',
  'stars',
  'vine',
  'paws',
  'realistic-ivy',
  'realistic-wildflower',
  'realistic-shells',
  'realistic-woodland'
]);

const DEFAULT_TEXT_FILL = 'default';

const DEFAULT_TEXT_BORDER_COLOR = 'default';

const DEFAULT_NOTE_APPEARANCE = Object.freeze({
  noteFill: '#fff4b2',
  noteBorder: 'none',
  noteShadow: true,
  noteOpacity: 1
});

const BRUSHES = [
  {
    id: 'brush',
    name: '钢笔',
    width: 1,
    opacity: 1,
    smooth: 0.25,
    pressureAmount: 0.3,
    grain: 0.5,
    jitter: 0,
    spacing: 1,
    pad: 1.2
  },
  {
    id: 'pencil',
    name: '毛笔',
    width: 1.35,
    opacity: 0.95,
    pressure: true,
    smooth: 0.4,
    pressureAmount: 0.85,
    grain: 0.7,
    jitter: 0.08,
    spacing: 0.85,
    pad: 1.6
  },
  {
    id: 'calligraphy',
    name: '书写笔',
    width: 1.8,
    opacity: 0.98,
    nibAngle: -55,
    smooth: 0.35,
    pressureAmount: 0.4,
    grain: 0.5,
    jitter: 0,
    spacing: 1,
    pad: 1.3
  },
  {
    id: 'spray',
    name: '喷枪',
    width: 1.7,
    opacity: 0.45,
    smooth: 0.2,
    pressureAmount: 0.3,
    grain: 0.8,
    jitter: 0.35,
    spacing: 0.75,
    pad: 2.4
  },
  {
    id: 'oil',
    name: '油画笔',
    width: 2.1,
    opacity: 0.92,
    pressure: true,
    smooth: 0.3,
    pressureAmount: 0.7,
    grain: 0.85,
    jitter: 0.12,
    spacing: 0.8,
    pad: 2
  },
  {
    id: 'crayon',
    name: '蜡笔',
    width: 1.5,
    opacity: 0.9,
    smooth: 0.3,
    pressureAmount: 0.5,
    grain: 0.9,
    jitter: 0.2,
    spacing: 0.85,
    pad: 1.8
  },
  {
    id: 'marker',
    name: '记号笔',
    width: 2.3,
    opacity: 0.55,
    smooth: 0.3,
    pressureAmount: 0.3,
    grain: 0.4,
    jitter: 0,
    spacing: 1,
    pad: 1.5
  },
  {
    id: 'normal-pencil',
    name: '铅笔',
    width: 0.75,
    opacity: 0.8,
    pressure: true,
    smooth: 0.3,
    pressureAmount: 0.75,
    grain: 0.8,
    jitter: 0.1,
    spacing: 0.9,
    pad: 1.4
  },
  {
    id: 'watercolor',
    name: '水彩',
    width: 2,
    opacity: 0.5,
    pressure: true,
    smooth: 0.45,
    pressureAmount: 0.6,
    grain: 0.9,
    jitter: 0.15,
    spacing: 0.8,
    pad: 2.8
  }
];

const SHAPES = [
  { id: 'line', name: '直线' },
  { id: 'curve', name: '曲线' },
  { id: 'ellipse', name: '椭圆' },
  { id: 'rect', name: '矩形' },
  { id: 'round-rect', name: '圆角矩形' },
  { id: 'triangle', name: '三角形' },
  { id: 'right-triangle', name: '直角三角形' },
  { id: 'diamond', name: '菱形' },
  { id: 'pentagon', name: '五边形' },
  { id: 'hexagon', name: '六边形' },
  { id: 'octagon', name: '八边形' },
  { id: 'trapezoid', name: '梯形' },
  { id: 'parallelogram', name: '平行四边形' },
  { id: 'cross', name: '十字形' },
  { id: 'arrow-right', name: '右箭头' },
  { id: 'arrow-left', name: '左箭头' },
  { id: 'arrow-up', name: '上箭头' },
  { id: 'arrow-down', name: '下箭头' },
  { id: 'star', name: '五角星' },
  { id: 'speech', name: '对话框' },
  { id: 'cloud', name: '云形' },
  { id: 'cylinder', name: '圆柱体' },
  { id: 'document', name: '文档' },
  { id: 'heart', name: '心形' },
  { id: 'lightning', name: '闪电' }
];

const BACKGROUND_PRESETS = Object.freeze({
  blank: { type: 'blank', color: '#ffffff', spacing: 24, opacity: 1 },
  dots: { type: 'dots', color: '#ffffff', spacing: 18, opacity: 1 },
  grid: { type: 'grid', color: '#ffffff', spacing: 18, opacity: 1 },
  lines: { type: 'lines', color: '#ffffff', spacing: 36, opacity: 1 },
  dark: { type: 'dark', color: '#1e232e', spacing: 18, opacity: 1 },
  warm: { type: 'warm', color: '#faf2e5', spacing: 22, opacity: 1 },
  blueprint: { type: 'blueprint', color: '#183d65', spacing: 20, opacity: 1 },
  isometric: { type: 'isometric', color: '#fbfcfe', spacing: 18, opacity: 1 },
  paper: { type: 'paper', color: '#f8f6f0', spacing: 20, opacity: 1 },
  cross: { type: 'cross', color: '#fbfcfe', spacing: 24, opacity: 1 },
  graph: { type: 'graph', color: '#f8fbff', spacing: 16, opacity: 1 },
  rice: { type: 'rice', color: '#fffdf8', spacing: 72, opacity: 1 },
  mist: { type: 'mist', color: '#edf4f8', spacing: 20, opacity: 1 },
  sage: { type: 'sage', color: '#edf2ea', spacing: 20, opacity: 1 },
  dawn: { type: 'dawn', color: '#fff6f2', spacing: 240, opacity: 1 },
  'alpine-lake': { type: 'alpine-lake', color: '#dbe9ef', spacing: 24, opacity: 1 },
  coastline: { type: 'coastline', color: '#e9e9db', spacing: 24, opacity: 1 },
  'sage-watercolor': { type: 'sage-watercolor', color: '#eef2e9', spacing: 24, opacity: 1 },
  'twilight-sky': { type: 'twilight-sky', color: '#645d86', spacing: 24, opacity: 1 },
  'botanical-paper': { type: 'botanical-paper', color: '#f3eee3', spacing: 24, opacity: 1 },
  'desert-dunes': { type: 'desert-dunes', color: '#e8b18f', spacing: 24, opacity: 1 },
  'navy-night': { type: 'navy-night', color: '#09132b', spacing: 24, opacity: 1 },
  'thousand-li': { type: 'thousand-li', color: '#9a8155', spacing: 24, opacity: 1 },
  calligraphy: { type: 'calligraphy', color: '#c7ad84', spacing: 24, opacity: 1 },
  starfield: { type: 'starfield', color: '#050507', spacing: 24, opacity: 1 },
  'great-wave': { type: 'great-wave', color: '#c9d4d4', spacing: 24, opacity: 1 },
  'water-lilies': { type: 'water-lilies', color: '#708d96', spacing: 24, opacity: 1 }
});

// Image backgrounds are cover-fitted to the viewport and never scaled by the
// board zoom. When drift is on, panning slides the crop window across the photo's
// own surplus pixels; the framing is anchored to the bottom edge so the crop falls
// on the top of the picture. `WALLPAPER_DRIFT_REACH` is the fraction of the
// viewport the camera must travel for the drift to approach its limit.
const WALLPAPER_DRIFT_REACH = 0.6;

// `width`/`height` record each source's native aspect at one quarter scale: the
// reference frame the bundled assets are sized for.
const BACKGROUND_IMAGE_PRESETS = Object.freeze({
  'alpine-lake': { asset: 'backgrounds/alpine-lake.webp', width: 640, height: 360, wash: 'rgba(245,249,251,.12)' },
  coastline: { asset: 'backgrounds/coastline.webp', width: 640, height: 360, wash: 'rgba(255,255,255,.12)' },
  'sage-watercolor': {
    asset: 'backgrounds/sage-watercolor.webp',
    width: 640,
    height: 360,
    wash: 'rgba(255,255,255,.08)'
  },
  'twilight-sky': { asset: 'backgrounds/twilight-sky.webp', width: 640, height: 360, wash: 'rgba(255,244,251,.08)' },
  'botanical-paper': {
    asset: 'backgrounds/botanical-paper.webp',
    width: 640,
    height: 360,
    wash: 'rgba(255,255,255,.04)'
  },
  'desert-dunes': { asset: 'backgrounds/desert-dunes.webp', width: 640, height: 360, wash: 'rgba(255,246,236,.1)' },
  'navy-night': { asset: 'backgrounds/navy-night.webp', width: 640, height: 360, wash: 'rgba(3,7,20,.06)' },
  'thousand-li': { asset: 'backgrounds/thousand-li.webp', width: 1330, height: 397, wash: 'rgba(255,249,235,.12)' },
  calligraphy: { asset: 'backgrounds/lantingxu.webp', width: 1120, height: 368, wash: 'rgba(255,250,239,.16)' },
  starfield: { asset: 'backgrounds/webb-deep-field.webp', width: 1130, height: 1152, wash: 'rgba(3,4,8,.08)' },
  'great-wave': { asset: 'backgrounds/great-wave.webp', width: 1080, height: 744, wash: 'rgba(255,255,255,.1)' },
  'water-lilies': { asset: 'backgrounds/water-lilies.webp', width: 1200, height: 1244, wash: 'rgba(245,249,250,.14)' }
});

const backgroundImageLoads = new Map();

const STICKER_CATEGORIES = Object.freeze([
  { id: 'all', name: '全部' },
  { id: 'marks', name: '标记' },
  { id: 'work', name: '工作' },
  { id: 'collab', name: '协作' },
  { id: 'time', name: '时间' },
  { id: 'life', name: '生活' }
]);

const STICKERS = Object.freeze(
  [
    ['star', '星标', 'marks', 'star', '星星 重点 收藏'],
    ['heart', '喜欢', 'marks', 'heart', '爱心 喜欢 关注'],
    ['check', '完成', 'marks', 'check-circle-2', '完成 正确 勾选'],
    ['cross', '阻塞', 'marks', 'x-circle', '错误 取消 阻塞'],
    ['flag', '旗标', 'marks', 'flag', '旗帜 里程碑'],
    ['bulb', '灵感', 'marks', 'lightbulb', '灯泡 灵感 想法'],
    ['lightning', '紧急', 'marks', 'zap', '闪电 紧急 快速'],
    ['smile', '微笑', 'marks', 'smile', '表情 开心'],
    ['alert', '提醒', 'marks', 'triangle-alert', '警告 注意'],
    ['question', '疑问', 'marks', 'circle-help', '问题 帮助'],
    ['arrow', '方向', 'marks', 'arrow-right', '箭头 下一步'],
    ['progress', '进行中', 'marks', 'circle-dashed', '处理中 进度 状态'],
    ['approved', '已审核', 'marks', 'shield-check', '审核 通过 安全'],
    ['agree', '赞同', 'marks', 'thumbs-up', '同意 支持 点赞'],
    ['disagree', '反对', 'marks', 'thumbs-down', '不同意 否决 踩'],
    ['bookmark', '书签', 'work', 'bookmark', '书签 保存'],
    ['pin', '固定', 'work', 'pin', '图钉 固定 地址'],
    ['target', '目标', 'work', 'target', '目标 OKR'],
    ['trophy', '成果', 'work', 'trophy', '奖杯 成果'],
    ['rocket', '启动', 'work', 'rocket', '火箭 发布 启动'],
    ['briefcase', '工作', 'work', 'briefcase-business', '公文包 项目'],
    ['home', '主页', 'work', 'home', '房屋 首页'],
    ['todo', '待办', 'work', 'list-todo', '任务 清单 checklist'],
    ['document', '文档', 'work', 'file-text', '文件 资料 说明'],
    ['presentation', '演示', 'work', 'presentation', '汇报 幻灯片 PPT'],
    ['bug', '问题', 'work', 'bug', '缺陷 故障 bug'],
    ['repair', '修复', 'work', 'wrench', '工具 维修 处理'],
    ['announcement', '公告', 'work', 'megaphone', '广播 宣传 通知'],
    ['package', '交付', 'work', 'package', '包裹 交付 成果'],
    ['comment', '评论', 'collab', 'message-circle', '消息 反馈 对话'],
    ['meeting', '会议', 'collab', 'video', '视频会议 沟通'],
    ['phone', '电话', 'collab', 'phone', '联系 通话 手机'],
    ['team', '团队', 'collab', 'users-round', '成员 协作 人员'],
    ['email', '邮件', 'collab', 'mail', '邮箱 信件 联系'],
    ['link', '链接', 'collab', 'link-2', '网址 关联 分享'],
    ['bell', '通知', 'time', 'bell', '铃铛 提醒'],
    ['clock', '时间', 'time', 'clock-3', '时钟 时间'],
    ['calendar', '日期', 'time', 'calendar-days', '日历 日期 计划'],
    ['deadline', '截止', 'time', 'timer', '截止时间 倒计时 期限'],
    ['waiting', '等待', 'time', 'hourglass', '稍后 排队 延迟'],
    ['start', '开始', 'time', 'play', '启动 播放 执行'],
    ['pause', '暂停', 'time', 'pause', '停止 等待 中止'],
    ['leaf', '自然', 'life', 'leaf', '叶子 环保'],
    ['coffee', '休息', 'life', 'coffee', '咖啡 休息'],
    ['music', '音乐', 'life', 'music-2', '音乐 音符'],
    ['camera', '照片', 'life', 'camera', '相机 图片'],
    ['location', '地点', 'life', 'map-pin', '位置 地址 地图'],
    ['gift', '礼物', 'life', 'gift', '赠送 惊喜 庆祝'],
    ['travel', '出行', 'life', 'plane', '旅行 飞机 航班']
  ].map(([id, name, category, icon, keywords]) => Object.freeze({ id, name, category, icon, keywords }))
);

const PALETTE_COLORS = [
  '#000000',
  '#666666',
  '#a41520',
  '#f0282f',
  '#ff7a24',
  '#ffe600',
  '#30b957',
  '#178fcd',
  '#4054c8',
  '#9343a7',
  '#ffffff',
  '#c9c9c9',
  '#a46d51',
  '#f6a3b5',
  '#ffc628',
  '#f3df9a',
  '#a9dd37',
  '#8ecbe8',
  '#6b8fb7',
  '#b9add9'
];

const TEXT_FONT_FAMILIES =
  window.MuseFontFamilies?.options || Object.freeze([{ value: 'system-ui, sans-serif', label: '系统默认' }]);

export {
  BACKGROUND_IMAGE_PRESETS,
  BACKGROUND_PRESETS,
  BRUSHES,
  CANVAS_CATALOG_FRESH_MS,
  CANVAS_PREVIEW_BACKGROUND,
  CANVAS_PREVIEW_REFRESH_DELAY,
  CANVAS_PREVIEW_STYLE_VERSION,
  DEFAULT_NOTE_APPEARANCE,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_TEXT_BORDER_COLOR,
  DEFAULT_TEXT_FILL,
  DOCUMENT_BAR_COLLAPSED_KEY,
  DOCUMENT_VERSION,
  EXPORT_MAX_PIXELS,
  EXPORT_MAX_SCALE,
  EXPORT_MAX_SIDE,
  EXPORT_TILE_PIXEL_SIDE,
  EXTREME_CANVAS_OBJECT_THRESHOLD,
  FLOATING_TOOLBAR_CARET_GAP,
  FLOATING_TOOLBAR_GAP,
  FLOATING_TOOLBAR_SNAP_DISTANCE,
  FLOATING_TOOLBAR_SNAP_GAP,
  FLOATING_TOOLBAR_SNAP_RELEASE_DISTANCE,
  MAX_CANVASES,
  MAX_CANVAS_NAME_LENGTH,
  MAX_IMAGE_SIDE,
  MAX_IMAGE_TRANSMIT_BYTES,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_UNDO_BYTES,
  MAX_UNDO_STEPS,
  MAX_ZOOM,
  MIDDLE_DOUBLE_CLICK_DELAY,
  MIDDLE_DOUBLE_CLICK_DISTANCE,
  MIDDLE_FOCUS_SCREEN_PADDING,
  MIDDLE_FOCUS_ZOOM_CAP,
  MIN_ITEM_SIZE,
  MIN_TABLE_COLUMN_WIDTH,
  MIN_TABLE_HEIGHT,
  MIN_ZOOM,
  PALETTE_COLORS,
  PAN_DRAG_THRESHOLD,
  SHAPES,
  SNAPSHOT_DEFERRED_TYPES,
  SNAP_ACQUIRE_DISTANCE_PX,
  SNAP_GRID_MIN_SPACING_PX,
  SNAP_RELEASE_DISTANCE_PX,
  SPATIAL_INDEX_OBJECT_THRESHOLD,
  STICKERS,
  STICKER_CATEGORIES,
  TABLE_EDIT_MIN_ZOOM,
  TEXT_BORDER_STYLES,
  TEXT_DECORATIVE_BORDER_STYLES,
  TEXT_FONT_FAMILIES,
  TEXT_LIST_STYLES,
  TEXT_TOOLBAR_MODE_KEY,
  TOOL_DOCK_COLLAPSED_KEY,
  VIEWPORT_RENDER_MARGIN_PX,
  VIEWPORT_RETAIN_MARGIN_PX,
  VIEWPORT_VIRTUALIZATION_OBJECT_THRESHOLD,
  WALLPAPER_DRIFT_REACH,
  WHEEL_ZOOM_SETTLE_RATIO,
  WHEEL_ZOOM_SMOOTHING_MS,
  backgroundImageLoads
};
