'use strict';

(function exposeMindMapMarkdown(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MindMapMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MAX_NODES = 5000;
  const MAX_DEPTH = 32;

  function topicIdentity(value) {
    const match = String(value ?? '').match(/<!--\s*t:([a-zA-Z0-9_.:-]{1,128})\s*-->/i);
    return match ? match[1] : '';
  }

  function visibleTopicText(value) {
    return String(value ?? '')
      .replace(/<!--[^>]*-->/g, '')
      .replace(/<![^>]*>/g, '')
      .replace(/\0/g, '')
      .trim();
  }

  function cleanText(value, fallback = '主题') {
    const text = visibleTopicText(value);
    return (text || fallback).slice(0, 200);
  }

  function parseMarkdown(input, options = {}) {
    const maxNodes = Math.min(MAX_NODES, Math.max(1, Number(options.maxNodes) || MAX_NODES));
    const maxDepth = Math.min(MAX_DEPTH, Math.max(1, Number(options.maxDepth) || MAX_DEPTH));
    const text = String(input ?? '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
    if (text.includes('\0')) throw Object.assign(new Error('Markdown 包含二进制内容'), { line: 1 });
    const lines = text.split('\n');
    const root = { id: '', text: '', collapsed: false, children: [] };
    const stack = [{ level: -1, node: root }];
    let nodeCount = 0;
    let inFence = false;
    let lastNode = null;
    let paragraph = [];

    const flushParagraph = () => {
      const value = paragraph.join(' ').trim();
      paragraph = [];
      if (!value) return;
      if (!lastNode) {
        const node = { id: '', text: cleanText(value), collapsed: false, children: [] };
        root.children.push(node);
        lastNode = node;
        nodeCount += 1;
      } else {
        lastNode.note = [lastNode.note, value].filter(Boolean).join('\n').slice(0, 4000);
      }
    };

    const appendNode = (level, value, lineNumber) => {
      flushParagraph();
      if (level > maxDepth) throw Object.assign(new Error(`Markdown 层级超过 ${maxDepth} 层`), { line: lineNumber });
      if (++nodeCount > maxNodes) throw Object.assign(new Error(`Markdown 节点超过 ${maxNodes} 个`), { line: lineNumber });
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      const parent = stack.at(-1)?.node || root;
      const node = { id: topicIdentity(value), text: cleanText(value), collapsed: false, children: [] };
      parent.children.push(node);
      stack.push({ level, node });
      lastNode = node;
    };

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        paragraph.push(line.replace(/^\s*```[^\s]*/, '').trim());
        return;
      }
      if (inFence) {
        paragraph.push(line.trim());
        return;
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        appendNode(heading[1].length - 1, heading[2], lineNumber);
        return;
      }
      const list = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/);
      if (list) {
        const indent = list[1].replace(/\t/g, '  ').length;
        const parentLevel = stack.at(-1)?.level ?? -1;
        const level = Math.max(0, Math.min(maxDepth, Math.floor(indent / 2) + (parentLevel < 0 ? 0 : 1)));
        appendNode(level, list[2], lineNumber);
        return;
      }
      if (!line.trim()) flushParagraph();
      else paragraph.push(line.trim());
    });
    if (inFence) throw Object.assign(new Error('Markdown 代码块没有结束'), { line: lines.length });
    flushParagraph();
    if (!root.children.length) throw Object.assign(new Error('Markdown 中没有可导入的内容'), { line: 1 });
    if (root.children.length === 1) return { tree: root.children[0], warnings: [] };
    return {
      tree: { id: '', text: cleanText(options.fallbackTitle || '导入的脑图'), collapsed: false, children: root.children },
      warnings: ['源文件包含多个顶级主题，已使用文件名作为中心主题']
    };
  }

  function toMarkdown(tree) {
    const lines = [];
    const visit = (node, depth) => {
      const text = cleanText(node?.text).replace(/\s+/g, ' ');
      if (depth === 0) lines.push(`# ${text}`);
      else lines.push(`${'  '.repeat(depth - 1)}- ${text}`);
      if (node?.note) lines.push(`${'  '.repeat(depth)}${String(node.note).replace(/\n+/g, ' ')}`);
      for (const child of Array.isArray(node?.children) ? node.children : []) visit(child, depth + 1);
    };
    visit(tree || { text: '主题', children: [] }, 0);
    return `${lines.join('\n')}\n`;
  }

  return { MAX_DEPTH, MAX_NODES, cleanText, parseMarkdown, toMarkdown, topicIdentity, visibleTopicText };
});
