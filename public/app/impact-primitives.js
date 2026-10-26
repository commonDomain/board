import {els} from './elements.js';
import {state} from './state.js';
import {isItemVisible} from './layer-visibility.js';

const NS = 'http://www.w3.org/2000/svg';

const MAX_DEPTH = 3;

const MAX_MOTION_EDGES = 36;

const MAX_MOTION_NODES = 48;

const MAX_GRAPH_ROWS = 20;

const MIN_READABLE_ZOOM = 0.68;

const GOLD = '#f2c66d';

const CYAN = '#52d8df';

const sparkLengths = new WeakMap();

const sparkNodes = new Map();

const sparkPaths = new Map();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const escapeId = (id) => (window.CSS?.escape ? CSS.escape(String(id)) : String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const seedFor = (value) => {
  let hash = 0;
  for (const character of String(value)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return ((hash >>> 0) % 997) / 997;
};

const itemNode = (id) => els.board.querySelector(`.board-item[data-item-id="${escapeId(id)}"]`);

const sectionNode = (id) => els.sectionLayer?.querySelector(`.section-frame[data-section-id="${escapeId(id)}"]`);

const sparkNode = (id) => {
  let node = sparkNodes.get(id);
  if (!node?.isConnected) {
    node = state.sections.has(id) ? sectionNode(id) : itemNode(id);
    if (node) sparkNodes.set(id, node);
  }
  return node;
};

const sparkPath = (id) => {
  let path = sparkPaths.get(id);
  if (!path?.isConnected) {
    path = itemNode(id)?.querySelector('.impact-line-core');
    if (path) sparkPaths.set(id, path);
  }
  return path;
};

const entity = (id) => state.items.get(id) || state.sections.get(id);

const visible = (value) => value && (state.sections.has(value.id) ? !value.hidden : isItemVisible(value));

const boundIds = (line) => {
  if (line.connectorVersion) return [line.source?.binding?.id, line.target?.binding?.id];
  return [line.startId, line.endId];
};

const labelFor = (value) => {
  if (!value) return '未知元素';
  const label = [value.name, value.title, value.text, value.type === 'mindmap' ? value.tree?.text : null].find(
    (candidate) => typeof candidate === 'string' && candidate.trim()
  );
  return String(
    label ||
      { note: '便签', shape: '形状', image: '图片', table: '表格', sheet: '工作表', section: '画框' }[value.type] ||
      '画板元素'
  )
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
};
export {NS,MAX_DEPTH,MAX_MOTION_EDGES,MAX_MOTION_NODES,MAX_GRAPH_ROWS,MIN_READABLE_ZOOM,GOLD,CYAN,sparkLengths,sparkNodes,sparkPaths,reducedMotion,escapeId,svg,clamp,seedFor,itemNode,sectionNode,sparkNode,sparkPath,entity,visible,boundIds,labelFor};
