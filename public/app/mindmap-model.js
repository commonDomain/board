import { showToast } from './interface-model.js';
import { clamp, makeId } from './utilities.js';
import { nextZ } from './canvas-state.js';

function createMindMapItem(point, tree, options = {}) {
  let normalizedTree;
  try {
    normalizedTree = ensureMindNodeIds(tree || makeSampleTree());
  } catch (error) {
    showToast(error.message || '脑图结构无效');
    return null;
  }
  const item = {
    id: makeId('mindmap'),
    type: 'mindmap',
    x: point.x,
    y: point.y,
    w: 460,
    h: 280,
    rotation: 0,
    z: nextZ(),
    branchStyle: options.branchStyle || 'smart',
    layoutMode: options.layoutMode || 'mindmap',
    tree: normalizedTree,
    ...(Array.isArray(options.relations) && options.relations.length ? { relations: options.relations } : {}),
    ...(options.source ? { source: options.source } : {})
  };
  if (options.precomputedLayout?.nodes?.length) {
    const precomputedLayout = normalizePrecomputedMindMapLayout(options.precomputedLayout);
    item.w = clamp(precomputedLayout.width, 360, 1_000_000);
    item.h = clamp(precomputedLayout.height, 220, 1_000_000);
    Object.defineProperty(item, '_precomputedLayout', {
      value: precomputedLayout,
      configurable: true,
      writable: true
    });
  } else {
    fitMindMapItem(item);
  }
  return item;
}

function normalizePrecomputedMindMapLayout(layout) {
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  if (!nodes.length) return { nodes: [], links: [], width: 460, height: 280 };
  const padding = 24;
  const minX = Math.min(...nodes.map((node) => Number(node.x) || 0));
  const minY = Math.min(...nodes.map((node) => Number(node.y) || 0));
  const offsetX = minX < padding ? padding - minX : 0;
  const offsetY = minY < padding ? padding - minY : 0;
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    x: (Number(node.x) || 0) + offsetX,
    y: (Number(node.y) || 0) + offsetY
  }));
  const right = Math.max(...normalizedNodes.map((node) => node.x + Math.max(1, Number(node.w) || 90)));
  const bottom = Math.max(...normalizedNodes.map((node) => node.y + Math.max(1, Number(node.h) || 38)));
  return {
    ...layout,
    nodes: normalizedNodes,
    links: Array.isArray(layout.links) ? layout.links : [],
    width: Math.max(Number(layout.width) || 0, right + padding),
    height: Math.max(Number(layout.height) || 0, bottom + padding)
  };
}

function countMindNodes(tree) {
  let count = 0;
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    count += 1;
    stack.push(...(Array.isArray(node.children) ? node.children : []));
  }
  return count;
}

function planningMindTree(tree) {
  if (window.MusePlanning?.enabled) {
    const project = node => {
      const children = (node.children || []).map(project), task = node.taskRef && window.MusePlanning.getTask(node.taskRef);
      if (node.taskRef) return { ...node, text: task?.title || '无权访问', status: task?.status || '', children };
      return children.some((child, i) => child !== node.children[i]) ? { ...node, children } : node;
    };
    tree = project(tree);
  }
  return tree;
}
function layoutMindTree(tree, width, height, branchStyle = 'smart', layoutMode = 'mindmap') {
  tree = planningMindTree(tree);
  return window.MindMapLayout.layoutMindTree(tree, width, height, {
    style: branchStyle,
    layoutMode,
    measureWidth: measureMindNodeWidth,
    measureHeight: measureMindNodeHeight
  });
}

function measureMindNodeWidth(text, isRoot = false, node = null) {
  const value = String(text || '主题');
  const style = node?.style && typeof node.style === 'object' ? node.style : {};
  const fontSize = clamp(Number(style.fontSize) || 12, 8, 96);
  const fontWeight =
    style.fontWeight === 'bold' || Number(style.fontWeight) >= 600 || (isRoot && !style.fontWeight) ? 700 : 400;
  const fontFamily =
    typeof style.fontFamily === 'string' && style.fontFamily
      ? style.fontFamily
      : 'Inter, "Microsoft YaHei", sans-serif';
  let measuredWidth = 0;
  if (typeof document !== 'undefined') {
    const canvas = measureMindNodeWidth.canvas || (measureMindNodeWidth.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      measuredWidth = context.measureText(value).width;
    }
  }
  if (!measuredWidth) {
    const scale = fontSize / 12;
    measuredWidth = Array.from(value).reduce(
      (sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 12 : 7) * scale,
      0
    );
  }
  return Math.min(360, Math.max(isRoot ? 118 : 90, Math.ceil(measuredWidth + 30)));
}
function measureMindNodeHeight(node, width, isRoot) {
  measureMindNodeWidth(node.text, isRoot, node);
  const context = measureMindNodeWidth.canvas?.getContext('2d'), fontSize = clamp(Number(node.style?.fontSize) || 12, 8, 96), available = Math.max(24, width - 32);
  let lines = 1, used = 0;
  // Preserve Latin word boundaries as CSS does; CJK and oversized words can break anywhere.
  for (const token of String(node.text || '主题').match(/\n|[a-zA-Z0-9_]+|[^a-zA-Z0-9_\n]/gu) || []) {
    if (token === '\n') { lines++; used = 0; continue; }
    const length = context?.measureText(token).width || Array.from(token).length * fontSize;
    if (length <= available) { if (used && used + length > available) { lines++; used = 0; } used += length; }
    else for (const character of Array.from(token)) {
      const width = context?.measureText(character).width || fontSize;
      if (used && used + width > available) { lines++; used = 0; } used += width;
    }
  }
  return Math.ceil(lines * fontSize * 1.55 + 18);
}

function estimateMindNodeWidth(text, isRoot = false) {
  let units = 0;
  for (const character of Array.from(String(text || '主题'))) {
    if (/\s/.test(character)) units += 3.5;
    else if (/[\u2e80-\u9fff\uf900-\ufaff]/.test(character)) units += 12;
    else if (/[A-Z0-9]/.test(character)) units += 7.5;
    else units += 6.5;
  }
  return Math.max(isRoot ? 118 : 90, Math.ceil(units + 28));
}

function createMindNode(text, children = [], options = {}) {
  const node = {
    id: makeId('mn'),
    text: String(text || '主题').slice(0, 200),
    collapsed: Boolean(options.collapsed),
    children: Array.isArray(children) ? children : []
  };
  if (options.status) node.status = String(options.status).slice(0, 64);
  if (options.note) node.note = String(options.note).slice(0, 4000);
  if (Number.isFinite(options.w)) node.w = Math.max(90, Math.round(options.w));
  if (Number.isFinite(options.h)) node.h = Math.max(38, Math.round(options.h));
  if (['left', 'right', 'auto'].includes(options.side)) node.side = options.side;
  return node;
}

function ensureMindNodeIds(tree) {
  const seen = new Set();
  const normalizeNode = (input, depth = 0) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const proposedId = typeof source.id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(source.id) ? source.id : '';
    const id = proposedId && !seen.has(proposedId) ? proposedId : makeId('mn');
    seen.add(id);
    const node = {
      id,
      text: String(source.text || '主题').slice(0, 200),
      collapsed: Boolean(source.collapsed),
      children: []
    };
    if (typeof source.note === 'string' && source.note.trim()) node.note = source.note.slice(0, 4000);
    if (typeof source.status === 'string' && source.status.trim()) node.status = source.status.slice(0, 64);
    if (source.taskRef) node.taskRef = { planId: source.taskRef.planId, taskId: source.taskRef.taskId };
    if (Array.isArray(source.labels))
      node.labels = source.labels
        .map((value) => String(value).slice(0, 64))
        .filter(Boolean)
        .slice(0, 20);
    if (Array.isArray(source.markers))
      node.markers = source.markers
        .map((value) => String(value).slice(0, 64))
        .filter(Boolean)
        .slice(0, 20);
    if (typeof source.href === 'string') {
      try {
        const url = new URL(source.href);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol)) node.href = url.href.slice(0, 2048);
      } catch {}
    }
    if (source.style && typeof source.style === 'object' && !Array.isArray(source.style)) {
      const allowed = new Set([
        'fill',
        'background',
        'backgroundColor',
        'color',
        'textColor',
        'borderColor',
        'borderWidth',
        'borderRadius',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'textDecoration',
        'textAlign',
        'shape',
        'lineColor',
        'lineWidth',
        'linePattern',
        'branchColor',
        'branchWidth'
      ]);
      node.style = Object.fromEntries(
        Object.entries(source.style)
          .filter(([key, value]) => allowed.has(key) && ['string', 'number', 'boolean'].includes(typeof value))
          .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 128) : value])
      );
    }
    if (Number.isFinite(source.w)) node.w = Math.max(90, Math.round(source.w));
    if (Number.isFinite(source.h)) node.h = Math.max(38, Math.round(source.h));
    if (['left', 'right', 'auto'].includes(source.side)) node.side = source.side;
    const rawChildren = Array.isArray(source.children) ? source.children : [];
    if (rawChildren.length > 200) {
      throw new TypeError('每个脑图节点最多包含 200 个子节点');
    }
    if (depth >= 31 && rawChildren.length) {
      throw new TypeError('脑图最多支持 32 层节点');
    }
    node.children = rawChildren.map((child) => normalizeNode(child, depth + 1));
    return node;
  };
  return normalizeNode(tree);
}

function fitMindMapItem(item) {
  const size = window.MindMapLayout.measureMindTree(planningMindTree(item.tree || createMindNode('中心主题')), {
    style: item.branchStyle,
    layoutMode: item.layoutMode,
    measureWidth: measureMindNodeWidth,
    measureHeight: measureMindNodeHeight
  });
  item.w = clamp(size.width, 360, 1_000_000);
  item.h = clamp(size.height, 220, 1_000_000);
  return item;
}

function makeMindMapTemplate(kind) {
  if (kind === 'blank') {
    return createMindNode('中心主题');
  }
  if (kind === 'task') {
    return createMindNode('项目目标', [
      createMindNode('待办', [createMindNode('明确范围', [], { status: 'todo' })], { status: 'todo' }),
      createMindNode('进行中', [createMindNode('推进关键任务', [], { status: 'doing' })], { status: 'doing' }),
      createMindNode('已完成', [createMindNode('记录成果', [], { status: 'done' })], { status: 'done' })
    ]);
  }
  if (kind === 'balanced') {
    return createMindNode('规划主题', [
      createMindNode('背景与现状', [createMindNode('已有条件')], { side: 'left' }),
      createMindNode('风险与约束', [createMindNode('需要验证')], { side: 'left' }),
      createMindNode('目标与路径', [createMindNode('下一步行动', [], { status: 'todo' })], { side: 'right' }),
      createMindNode('衡量标准', [createMindNode('完成定义')], { side: 'right' })
    ]);
  }
  return createMindNode('主题', [
    createMindNode('想法', [createMindNode('素材')]),
    createMindNode('任务', [], { status: 'todo' }),
    createMindNode('结论')
  ]);
}

function makeSampleTree() {
  return makeMindMapTemplate('sample');
}
export {
  createMindMapItem,
  normalizePrecomputedMindMapLayout,
  countMindNodes,
  layoutMindTree,
  measureMindNodeWidth,
  estimateMindNodeWidth,
  createMindNode,
  ensureMindNodeIds,
  fitMindMapItem,
  makeMindMapTemplate,
  makeSampleTree
};
