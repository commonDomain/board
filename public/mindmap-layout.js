'use strict';

(function exposeMindMapLayout(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MindMapLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
  const COLUMN_GAP = 54;
  const ROOT_GAP = 40;
  const ROW_GAP = 18;
  const OUTER_PADDING = 24;
  const VALID_STYLES = new Set(['smart', 'curve', 'elbow']);

  function normalizeStyle(style) {
    return VALID_STYLES.has(style) ? style : 'smart';
  }

  function fallbackWidth(text, isRoot = false) {
    const value = String(text || '主题');
    const width = Array.from(value).reduce(
      (sum, character) => sum + (/[^\x00-\xff]/.test(character) ? 12 : 7),
      0
    );
    return Math.max(isRoot ? 118 : 90, Math.ceil(width + 30));
  }

  function nodeSize(node, depth, measureWidth, measureHeight) {
    const hasMeta = Boolean(node?.status || node?.note);
    const fontSize = Math.max(8, Math.min(96, Number(node?.style?.fontSize) || 12));
    const measuredWidth = typeof measureWidth === 'function'
      ? measureWidth(node?.text, depth === 0, node)
      : fallbackWidth(node?.text, depth === 0);
    const w = Math.max(measuredWidth, Number(node?.w) || 0);
    return { w, h: Math.max(hasMeta ? 50 : 38, typeof measureHeight === 'function' ? measureHeight(node, w, depth === 0) : Math.ceil(fontSize * 1.55 + 18), Number(node?.h) || 0) };
  }

  function buildModel(tree, measureWidth, layoutMode = 'mindmap', measureHeight) {
    const nodes = [];
    const links = [];
    const columnWidths = new Map();
    const rootNode = tree && typeof tree === 'object' ? tree : { text: '中心主题', children: [] };

    function visit(node, depth, path, side, parent = null) {
      const size = nodeSize(node, depth, measureWidth, measureHeight);
      const entry = {
        id: node.id || `path_${path.join('_') || 'root'}`,
        path: [...path],
        text: node.text || '主题',
        status: node.status || '',
        note: node.note || '',
        labels: Array.isArray(node.labels) ? node.labels : [],
        markers: Array.isArray(node.markers) ? node.markers : [],
        href: node.href || '',
        visualStyle: node.style && typeof node.style === 'object' ? node.style : null,
        depth,
        side,
        w: size.w,
        h: size.h,
        children: Array.isArray(node.children) ? node.children.length : 0,
        collapsed: Boolean(node.collapsed),
        childEntries: [],
        parent
      };
      nodes.push(entry);
      if (depth > 0) {
        const key = `${side}:${depth}`;
        columnWidths.set(key, Math.max(columnWidths.get(key) || 0, entry.w));
      }
      if (!entry.collapsed) {
        (Array.isArray(node.children) ? node.children : []).forEach((child, index) => {
          let childSide = side;
          if (depth === 0) {
            if (layoutMode === 'logic-left' || layoutMode === 'tree-left') childSide = 'left';
            else if (layoutMode === 'logic-right' || layoutMode === 'tree-right' || layoutMode === 'org-down' || layoutMode === 'timeline') childSide = 'right';
            else childSide = child.side === 'left' ? 'left' : 'right';
          }
          const childEntry = visit(child, depth + 1, [...path, index], childSide, entry);
          entry.childEntries.push(childEntry);
          links.push({ from: entry, to: childEntry });
        });
      }
      return entry;
    }

    const rootEntry = visit(rootNode, 0, [], 'root');
    return { rootEntry, nodes, links, columnWidths };
  }

  function sideSpan(columnWidths, side) {
    const depths = Array.from(columnWidths.keys())
      .filter((key) => key.startsWith(`${side}:`))
      .map((key) => Number(key.split(':')[1]));
    const maxDepth = Math.max(0, ...depths);
    let span = maxDepth ? ROOT_GAP : 0;
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      span += columnWidths.get(`${side}:${depth}`) || 0;
      if (depth < maxDepth) span += COLUMN_GAP;
    }
    return span;
  }

  function setHorizontalPositions(model, width) {
    const { rootEntry, nodes, columnWidths } = model;
    const leftSpan = sideSpan(columnWidths, 'left');
    const rightSpan = sideSpan(columnWidths, 'right');
    rootEntry.x = Math.max(OUTER_PADDING, (width - (leftSpan + rootEntry.w + rightSpan)) / 2 + leftSpan);

    for (const node of nodes) {
      if (node.depth === 0) continue;
      let previousSpan = 0;
      for (let previousDepth = 1; previousDepth < node.depth; previousDepth += 1) {
        previousSpan += (columnWidths.get(`${node.side}:${previousDepth}`) || 0) + COLUMN_GAP;
      }
      node.x = node.side === 'left'
        ? rootEntry.x - ROOT_GAP - previousSpan - node.w
        : rootEntry.x + rootEntry.w + ROOT_GAP + previousSpan;
    }
  }

  function subtreeHeight(entry) {
    if (!entry.childEntries.length) {
      entry.branchHeight = entry.h;
      return entry.branchHeight;
    }
    const childHeight = entry.childEntries.reduce((sum, child) => sum + subtreeHeight(child), 0)
      + Math.max(0, entry.childEntries.length - 1) * ROW_GAP;
    entry.branchHeight = Math.max(entry.h, childHeight);
    return entry.branchHeight;
  }

  function forestHeight(entries) {
    return entries.reduce((sum, entry) => sum + subtreeHeight(entry), 0)
      + Math.max(0, entries.length - 1) * ROW_GAP;
  }

  function placeSubtree(entry, top) {
    if (!entry.childEntries.length) {
      entry.centerY = top + entry.branchHeight / 2;
      entry.y = entry.centerY - entry.h / 2;
      return;
    }
    const childHeight = entry.childEntries.reduce((sum, child) => sum + child.branchHeight, 0)
      + Math.max(0, entry.childEntries.length - 1) * ROW_GAP;
    let childTop = top + (entry.branchHeight - childHeight) / 2;
    entry.childEntries.forEach((child) => {
      placeSubtree(child, childTop);
      childTop += child.branchHeight + ROW_GAP;
    });
    entry.centerY = (entry.childEntries[0].centerY + entry.childEntries.at(-1).centerY) / 2;
    entry.y = entry.centerY - entry.h / 2;
  }

  function placeSmart(model, height) {
    const { rootEntry } = model;
    rootEntry.y = (height - rootEntry.h) / 2;
    rootEntry.centerY = rootEntry.y + rootEntry.h / 2;
    for (const side of ['left', 'right']) {
      const entries = rootEntry.childEntries.filter((entry) => entry.side === side);
      if (!entries.length) continue;
      const totalHeight = forestHeight(entries);
      let top = Math.max(14, (height - totalHeight) / 2);
      entries.forEach((entry) => {
        placeSubtree(entry, top);
        top += entry.branchHeight + ROW_GAP;
      });
    }
  }

  function placeLegacy(model, height) {
    const { rootEntry, nodes } = model;
    rootEntry.y = (height - rootEntry.h) / 2;
    const groups = new Map();
    nodes.forEach((node) => {
      if (node.depth === 0) return;
      const key = `${node.side}:${node.depth}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    });
    for (const group of groups.values()) {
      const totalHeight = group.reduce((sum, node) => sum + node.h, 0) + Math.max(0, group.length - 1) * ROW_GAP;
      let y = Math.max(14, (height - totalHeight) / 2);
      group.forEach((node) => {
        node.y = y;
        node.centerY = y + node.h / 2;
        y += node.h + ROW_GAP;
      });
    }
  }

  function layoutMindTree(tree, width, height, options = {}) {
    const style = normalizeStyle(options.style);
    const model = buildModel(tree, options.measureWidth, options.layoutMode, options.measureHeight);
    setHorizontalPositions(model, width);
    if (style === 'curve') placeLegacy(model, height);
    else placeSmart(model, height);
    model.links.forEach((link) => {
      link.siblingCount = link.from.childEntries.length;
    });
    return { nodes: model.nodes, links: model.links };
  }

  function measureMindTree(tree, options = {}) {
    const style = normalizeStyle(options.style);
    const model = buildModel(tree, options.measureWidth, options.layoutMode, options.measureHeight);
    const leftSpan = sideSpan(model.columnWidths, 'left');
    const rightSpan = sideSpan(model.columnWidths, 'right');
    let contentHeight;
    if (style === 'curve') {
      const groups = new Map();
      model.nodes.forEach((node) => {
        if (node.depth === 0) return;
        const key = `${node.side}:${node.depth}`;
        groups.set(key, (groups.get(key) || 0) + node.h + ROW_GAP);
      });
      contentHeight = Math.max(model.rootEntry.h, ...Array.from(groups.values(), (value) => Math.max(0, value - ROW_GAP)));
    } else {
      const left = model.rootEntry.childEntries.filter((entry) => entry.side === 'left');
      const right = model.rootEntry.childEntries.filter((entry) => entry.side === 'right');
      contentHeight = Math.max(model.rootEntry.h, forestHeight(left), forestHeight(right));
    }
    return {
      width: model.rootEntry.w + leftSpan + rightSpan + OUTER_PADDING * 2,
      height: contentHeight + 42
    };
  }

  function curvedPath({ startX, startY, endX, endY }) {
    const midX = (startX + endX) / 2;
    return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
  }

  function elbowPath({ startX, startY, endX, endY }) {
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.abs(dy) <= 1) return `M ${startX} ${startY} L ${endX} ${endY}`;
    const directionX = Math.sign(dx) || 1;
    const directionY = Math.sign(dy) || 1;
    const branchX = startX + dx * 0.48;
    const radius = Math.min(10, Math.abs(dx) * 0.12, Math.abs(dy) / 2);
    return [
      `M ${startX} ${startY}`,
      `L ${branchX - directionX * radius} ${startY}`,
      `Q ${branchX} ${startY} ${branchX} ${startY + directionY * radius}`,
      `L ${branchX} ${endY - directionY * radius}`,
      `Q ${branchX} ${endY} ${branchX + directionX * radius} ${endY}`,
      `L ${endX} ${endY}`
    ].join(' ');
  }

  function createLinkPath(link, requestedStyle) {
    const style = normalizeStyle(requestedStyle);
    const verticalGap = Math.abs(link.endY - link.startY);
    const horizontalGap = Math.abs(link.endX - link.startX);
    if (style === 'curve') return { kind: 'curve', d: curvedPath(link) };
    if (style === 'elbow') return { kind: verticalGap <= 1 ? 'horizontal' : 'elbow', d: elbowPath(link) };
    if (verticalGap <= 6) {
      return { kind: 'horizontal', d: `M ${link.startX} ${link.startY} L ${link.endX} ${link.endY}` };
    }
    const crowded = Number(link.siblingCount) >= 4;
    const steep = verticalGap > Math.max(44, horizontalGap * 0.8);
    if (crowded || steep) return { kind: 'elbow', d: elbowPath(link) };
    return { kind: 'curve', d: curvedPath(link) };
  }

  return { createLinkPath, layoutMindTree, measureMindTree, normalizeStyle };
});
