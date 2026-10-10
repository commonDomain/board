'use strict';

(function exposeXMindParser(root, factory) {
  const zip = typeof module === 'object' && module.exports ? require('fflate') : root.FFlate;
  const saxes = typeof module === 'object' && module.exports ? require('saxes') : root.Saxes;
  const api = factory(zip, saxes);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XMindParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (zip, saxes) => {
  const LIMITS = Object.freeze({ compressed: 20 * 1024 * 1024, inflated: 128 * 1024 * 1024, files: 2048, sheets: 64, nodes: 5000, depth: 32, children: 200 });
  const SAFE_STYLE_KEYS = new Set(['fill', 'background', 'backgroundColor', 'color', 'textColor', 'borderColor', 'borderWidth', 'borderRadius', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'shape', 'lineColor', 'lineWidth', 'linePattern', 'branchColor', 'branchWidth']);

  function decode(bytes) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
  function localName(name) { return String(name || '').split(':').at(-1); }
  function clean(value, maximum = 200, fallback = '') { return (String(value ?? '').replace(/\0/g, '').trim() || fallback).slice(0, maximum); }
  function safeId(value, fallback) { return /^[a-zA-Z0-9_.:-]{1,128}$/.test(String(value || '')) ? String(value) : fallback; }
  function safeUrl(value) {
    const text = clean(value, 2048);
    if (!text) return '';
    try { const url = new URL(text); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }

  function inspectArchive(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || 0);
    if (bytes.byteLength > LIMITS.compressed) throw new Error(`XMind 文件不能超过 ${Math.floor(LIMITS.compressed / 1024 / 1024)} MB`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let files = 0;
    let inflated = 0;
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const size = view.getUint32(offset + 24, true);
      const name = decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
      if (!name || name.startsWith('/') || /(^|\/)\.\.?($|\/)/.test(name) || /^[a-zA-Z]:/.test(name)) throw new Error('XMind 包含不安全的文件路径');
      files += 1;
      inflated += size;
      if (files > LIMITS.files) throw new Error(`XMind 压缩包文件数超过 ${LIMITS.files}`);
      if (inflated > LIMITS.inflated) throw new Error('XMind 解压后体积过大');
      offset += 45 + nameLength + extraLength + commentLength;
    }
    if (!files) throw new Error('不是有效的 XMind/ZIP 文件');
  }

  function normalizeStyle(input) {
    const source = input?.properties && typeof input.properties === 'object' ? input.properties : input;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
    const style = {};
    const aliases = {
      'svg:fill': 'fill', fillColor: 'fill', backgroundColor: 'fill',
      'fo:color': 'color', textColor: 'color',
      'fo:font-family': 'fontFamily', 'fo:font-size': 'fontSize',
      'fo:font-weight': 'fontWeight', 'fo:font-style': 'fontStyle',
      'fo:text-decoration': 'textDecoration',
      'border-line-color': 'borderColor', borderLineColor: 'borderColor',
      'border-line-width': 'borderWidth', borderLineWidth: 'borderWidth',
      'shape-class': 'shape', shapeClass: 'shape',
      'line-color': 'lineColor', lineColor: 'lineColor',
      'line-width': 'lineWidth', lineWidth: 'lineWidth',
      'line-pattern': 'linePattern', linePattern: 'linePattern',
      'branch-line-color': 'branchColor', branchLineColor: 'branchColor',
      'branch-line-width': 'branchWidth', branchLineWidth: 'branchWidth'
    };
    for (const [key, raw] of Object.entries(source)) {
      const target = SAFE_STYLE_KEYS.has(key) ? key : aliases[key];
      if (!target) continue;
      if (typeof raw === 'string') {
        const numeric = raw.trim().match(/^(-?\d+(?:\.\d+)?)(?:px|pt)?$/i);
        style[target] = numeric && /(?:Width|Size|Radius)$/i.test(target)
          ? Math.max(0, Math.min(1000, Number(numeric[1])))
          : clean(raw, 128);
      } else if (Number.isFinite(raw)) style[target] = Math.max(0, Math.min(1000, raw));
      else if (typeof raw === 'boolean') style[target] = raw;
    }
    return Object.keys(style).length ? style : undefined;
  }

  function parseStyleIndex(bytes, warnings) {
    const styles = new Map();
    if (!bytes) return styles;
    let document;
    try { document = JSON.parse(decode(bytes)); } catch {
      warnings.push('XMind 样式表损坏，已继续导入结构内容');
      return styles;
    }
    const visit = (value, key = '') => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const id = clean(value.id || value.styleId || key, 128);
        if (id && value.properties && typeof value.properties === 'object') styles.set(id, value);
      }
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    };
    visit(document);
    return styles;
  }

  function referencedStyle(input, styles) {
    const reference = typeof input === 'string' ? input : input?.id || input?.styleId || input?.['style-id'];
    const stored = reference ? styles?.get(String(reference)) : null;
    if (!stored) return input;
    const inline = input && typeof input === 'object' ? input.properties : null;
    return inline ? { properties: { ...(stored.properties || {}), ...inline } } : stored;
  }

  function childTopics(topic) {
    const children = topic?.children;
    if (Array.isArray(children)) return children;
    if (Array.isArray(children?.attached)) return children.attached;
    if (Array.isArray(children?.topics)) return children.topics;
    return [];
  }

  function normalizeLayout(value) {
    const structure = String(value || '').toLowerCase();
    if (structure.includes('org')) return 'org-down';
    if (structure.includes('tree') && structure.includes('left')) return 'tree-left';
    if (structure.includes('tree')) return 'tree-right';
    if (structure.includes('logic') && structure.includes('left')) return 'logic-left';
    if (structure.includes('logic')) return 'logic-right';
    if (structure.includes('timeline')) return 'timeline';
    return 'mindmap';
  }

  function markerStatus(markers) {
    const values = (Array.isArray(markers) ? markers : []).map((marker) => String(marker?.markerId || marker?.['marker-id'] || marker || '').toLowerCase());
    if (values.some((value) => /task-done|task-8of8|checked/.test(value))) return 'done';
    if (values.some((value) => /task-(?:3|4|5|6|7)of8|doing/.test(value))) return 'doing';
    if (values.some((value) => /task|todo/.test(value))) return 'todo';
    return '';
  }

  function jsonTopic(input, context, depth = 0, side = '') {
    if (!input || typeof input !== 'object' || depth > LIMITS.depth) throw new Error(`XMind 节点层级超过 ${LIMITS.depth}`);
    if (++context.nodes > LIMITS.nodes) throw new Error(`XMind 节点超过 ${LIMITS.nodes} 个`);
    const rawChildren = childTopics(input);
    if (rawChildren.length > LIMITS.children) throw new Error(`单个 XMind 节点的子节点超过 ${LIMITS.children} 个`);
    const id = safeId(input.id, `xm_${context.nodes}`);
    if (context.ids.has(id)) throw new Error(`XMind 包含重复节点 ID：${id}`);
    context.ids.add(id);
    const node = { id, text: clean(input.title ?? input.text, 200, '主题'), collapsed: Boolean(input.branch === 'folded' || input.collapsed), children: [] };
    const note = input.notes?.plain?.content ?? input.notes?.html?.content ?? input.note;
    if (note) node.note = clean(note, 4000);
    const labels = Array.isArray(input.labels) ? input.labels.map((entry) => clean(entry, 64)).filter(Boolean).slice(0, 20) : [];
    if (labels.length) node.labels = labels;
    const markers = Array.isArray(input.markers) ? input.markers.map((entry) => clean(entry?.markerId || entry, 64)).filter(Boolean).slice(0, 20) : [];
    if (markers.length) node.markers = markers;
    const status = markerStatus(input.markers);
    if (status) node.status = status;
    const href = safeUrl(input.href || input.hyperlink);
    if (href) node.href = href;
    const style = normalizeStyle(referencedStyle(input.style, context.styles));
    if (style) node.style = style;
    if (side) node.side = side;
    node.children = rawChildren.map((child, index) => jsonTopic(child, context, depth + 1, depth === 0 ? (child.position === 'left' || child.side === 'left' ? 'left' : 'right') : side));
    return node;
  }

  function parseJson(bytes, warnings, styles) {
    let content;
    try { content = JSON.parse(decode(bytes)); } catch { throw new Error('XMind content.json 无法解析'); }
    const rawSheets = Array.isArray(content) ? content : Array.isArray(content?.sheets) ? content.sheets : content?.rootTopic ? [content] : [];
    if (!rawSheets.length) throw new Error('XMind 中没有 Sheet');
    if (rawSheets.length > LIMITS.sheets) throw new Error(`XMind Sheet 数超过 ${LIMITS.sheets}`);
    let totalNodes = 0;
    const sheets = rawSheets.map((sheet, index) => {
      const context = { nodes: 0, ids: new Set(), styles };
      const root = jsonTopic(sheet.rootTopic || sheet.topic, context);
      totalNodes += context.nodes;
      if (totalNodes > LIMITS.nodes) throw new Error(`XMind 总节点超过 ${LIMITS.nodes} 个`);
      const relations = (Array.isArray(sheet.relationships) ? sheet.relationships : []).map((relation) => ({
        id: safeId(relation.id, `rel_${index}_${Math.random().toString(36).slice(2)}`),
        startId: safeId(relation.end1Id || relation.startId, ''),
        endId: safeId(relation.end2Id || relation.endId, ''),
        label: clean(relation.title || relation.label, 200),
        lineStyle: normalizeStyle(referencedStyle(relation.style, styles))
      })).filter((relation) => relation.startId && relation.endId && context.ids.has(relation.startId) && context.ids.has(relation.endId));
      const title = clean(sheet.title, 100, `Sheet ${index + 1}`);
      const layoutMode = normalizeLayout(sheet.rootTopic?.structureClass || sheet.structureClass);
      if (sheet.floatingTopics?.length || sheet.boundaries?.length || sheet.summaries?.length) warnings.push(`「${title}」含浮动主题、边界或概要，已保留可映射的层级内容`);
      if (layoutMode === 'org-down' || layoutMode === 'timeline') warnings.push(`「${title}」的纵向结构已按可编辑横向层级近似排版`);
      return { id: safeId(sheet.id, `sheet_${index + 1}`), title, layoutMode, tree: root, relations };
    });
    return sheets;
  }

  function parseXml(bytes, warnings) {
    const Parser = saxes?.SaxesParser;
    if (!Parser) throw new Error('旧版 XMind XML 解析器不可用');
    const sheets = [];
    let sheet = null;
    let topicStack = [];
    let capture = null;
    let text = '';
    let totalNodes = 0;
    let sheetIds = new Set();
    let relationship = null;
    const parser = new Parser({ xmlns: true, fragment: false });
    parser.on('opentag', (tag) => {
      const name = tag.local || localName(tag.name);
      if (name === 'sheet') {
        sheet = { id: safeId(tag.attributes?.id?.value, `sheet_${sheets.length + 1}`), title: `Sheet ${sheets.length + 1}`, layoutMode: 'mindmap', tree: null, relations: [] };
        sheetIds = new Set();
      }
      if (name === 'topic') {
        if (++totalNodes > LIMITS.nodes) throw new Error(`XMind 总节点超过 ${LIMITS.nodes} 个`);
        if (topicStack.length > LIMITS.depth) throw new Error(`XMind 节点层级超过 ${LIMITS.depth}`);
        const attributes = Object.fromEntries(Object.entries(tag.attributes || {}).map(([key, value]) => [localName(key), value.value]));
        const node = { id: safeId(attributes.id, `xm_${totalNodes}`), text: '主题', collapsed: attributes.branch === 'folded', children: [] };
        if (sheetIds.has(node.id)) throw new Error(`XMind 包含重复节点 ID：${node.id}`);
        sheetIds.add(node.id);
        if (attributes.href) node.href = safeUrl(attributes.href);
        if (attributes.position === 'left' || attributes.side === 'left') node.side = 'left';
        else if (attributes.position === 'right' || attributes.side === 'right') node.side = 'right';
        if (attributes['structure-class'] && !topicStack.length && sheet) sheet.layoutMode = normalizeLayout(attributes['structure-class']);
        if (topicStack.length) {
          const parent = topicStack.at(-1);
          if (parent.children.length >= LIMITS.children) throw new Error(`单个 XMind 节点的子节点超过 ${LIMITS.children} 个`);
          parent.children.push(node);
        } else if (sheet) sheet.tree = node;
        topicStack.push(node);
      }
      if (['title', 'plain', 'label'].includes(name)) { capture = name; text = ''; }
      if (name === 'marker-ref' && topicStack.length) {
        const marker = tag.attributes?.['marker-id']?.value || tag.attributes?.markerId?.value;
        if (marker) (topicStack.at(-1).markers ||= []).push(clean(marker, 64));
      }
      if (name === 'relationship' && sheet) {
        const attributes = Object.fromEntries(Object.entries(tag.attributes || {}).map(([key, value]) => [localName(key), value.value]));
        relationship = {
          id: safeId(attributes.id, `rel_${sheet.relations.length + 1}`),
          startId: safeId(attributes.end1 || attributes.end1Id, ''),
          endId: safeId(attributes.end2 || attributes.end2Id, ''),
          label: ''
        };
      }
    });
    parser.on('text', (value) => { if (capture) text += value; });
    parser.on('cdata', (value) => { if (capture) text += value; });
    parser.on('closetag', (tag) => {
      const name = tag.local || localName(tag.name);
      if (name === 'title') {
        if (relationship) relationship.label = clean(text, 200);
        else if (topicStack.length) topicStack.at(-1).text = clean(text, 200, '主题');
        else if (sheet) sheet.title = clean(text, 100, sheet.title);
      } else if (name === 'plain' && topicStack.length && clean(text)) topicStack.at(-1).note = clean(text, 4000);
      else if (name === 'label' && topicStack.length && clean(text)) (topicStack.at(-1).labels ||= []).push(clean(text, 64));
      if (capture === name) { capture = null; text = ''; }
      if (name === 'topic') {
        const node = topicStack.pop();
        const status = markerStatus(node.markers);
        if (status) node.status = status;
      }
      if (name === 'relationship' && sheet && relationship) {
        if (relationship.startId && relationship.endId) sheet.relations.push(relationship);
        relationship = null;
      }
      if (name === 'sheet' && sheet) {
        sheet.relations = sheet.relations.filter((entry) => sheetIds.has(entry.startId) && sheetIds.has(entry.endId));
        if (sheet.tree) sheets.push(sheet);
        sheet = null;
      }
    });
    parser.onerror = (error) => { throw error; };
    try { parser.write(decode(bytes)).close(); } catch (error) { throw new Error(`旧版 XMind XML 无法解析：${error.message}`); }
    if (!sheets.length) throw new Error('XMind 中没有可导入的 Sheet');
    warnings.push('旧版 XMind 的部分高级样式无法可靠映射，已保留层级、备注、标签和任务标记');
    return sheets;
  }

  function parseXMind(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    inspectArchive(bytes);
    let files;
    try { files = zip.unzipSync(bytes); } catch { throw new Error('XMind 压缩包损坏或使用了不支持的加密方式'); }
    const warnings = [];
    const styleIndex = parseStyleIndex(files['styles.json'], warnings);
    const sheets = files['content.json'] ? parseJson(files['content.json'], warnings, styleIndex)
      : files['content.xml'] ? parseXml(files['content.xml'], warnings)
        : (() => { throw new Error('XMind 中缺少 content.json 或 content.xml'); })();
    if (Object.keys(files).some((name) => /(^|\/)(?:resources|attachments|media)\//i.test(name))) warnings.push('主题图片、附件和音频不会随原文件持久化，已跳过这些资源');
    return { format: files['content.json'] ? 'zen' : 'legacy', sheets, warnings: [...new Set(warnings)] };
  }

  return { LIMITS, inspectArchive, parseXMind };
});
