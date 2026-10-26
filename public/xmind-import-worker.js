'use strict';

importScripts('vendor/fflate.min.js', 'vendor/saxes.min.js', 'xmind-parser.js', 'mindmap-layout.js');

self.onmessage = (event) => {
  try {
    const bytes = new Uint8Array(event.data);
    const result = self.XMindParser.parseXMind(bytes);
    result.sheets = result.sheets.map((sheet) => {
      const measured = self.MindMapLayout.measureMindTree(sheet.tree, { layoutMode: sheet.layoutMode });
      const width = Math.max(360, Math.min(6000, measured.width));
      const height = Math.max(220, Math.min(1400, measured.height));
      const layout = self.MindMapLayout.layoutMindTree(sheet.tree, width, height, { layoutMode: sheet.layoutMode });
      const nodes = layout.nodes.map(({ parent, childEntries, ...node }) => node);
      const links = layout.links.map((link) => ({ fromId: link.from.id, toId: link.to.id, siblingCount: link.siblingCount }));
      return { ...sheet, precomputedLayout: { width, height, nodes, links } };
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'XMind 解析失败' });
  }
};
