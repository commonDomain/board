// Content copies are independent; source metadata enables navigation and region previews.
export const VERSION = 1;
export const uid = (prefix = 'nt') => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const clone = value => structuredClone(value);
export const textDoc = text => ({ type: 'doc', content: String(text || '').split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) });
export function plainText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  return (Array.isArray(node.content) ? node.content : []).map(plainText).join(['doc', 'bulletList', 'orderedList', 'taskList', 'table', 'tableRow'].includes(node.type) ? '\n' : '');
}
export function createPage(sectionId) {
  return { id: uid('page'), sectionId, title: '未命名笔记', createdAt: Date.now(), updatedAt: Date.now(), elements: [], background: 'plain', deleted: false, favorite: false };
}
export function createNotebook(name = '我的笔记本') {
  const section = { id: uid('section'), title: '日常笔记' };
  return { id: uid('book'), version: VERSION, title: name, revision: 0, sections: [section], pages: [createPage(section.id)] };
}
export function createElement(type = 'text', point = { x: 64, y: 64 }) {
  return { id: uid('element'), type, x: Math.max(0, point.x), y: Math.max(0, point.y), w: 420, h: 90, origin: { kind: 'native' },
    ...(type === 'text' || type === 'callout' || type === 'tag' ? { doc: textDoc('') } : {}),
    ...(type === 'image' ? { w: 360, h: 240, src: '', alt: '' } : {}),
    ...(type === 'shape' ? { w: 180, h: 100, shape: 'rect', color: '#7660bd', fill: '#f0ebfa' } : {}),
    ...(type === 'ink' ? { points: [], color: '#34313d', size: 3 } : {}),
    ...(type === 'mindmap' ? { w: 600, h: 280, tree: { id: uid('node'), text: '中心主题', children: [] } } : {}) };
}
export function tableDoc(rows = [['', '', ''], ['', '', ''], ['', '', '']]) {
  return { type: 'doc', content: [{ type: 'table', content: rows.map(row => ({ type: 'tableRow', content: row.map(cell => ({ type: 'tableCell', content: textDoc(cell).content })) })) }] };
}
export function cloneTree(tree, depth = 0) {
  if (depth > 32) return { id: uid('node'), text: '…', children: [] };
  return { id: uid('node'), text: String(tree?.text || tree?.title || tree?.topic || '').slice(0, 20000), collapsed: Boolean(tree?.collapsed), ...(tree?.status ? { status: tree.status } : {}), ...(tree?.taskRef ? { taskRef: clone(tree.taskRef) } : {}), children: (tree?.children || []).slice(0, 500).map(node => cloneTree(node, depth + 1)) };
}
export function cloneElements(elements, dx = 0, dy = 0) {
  const owners = new Map(), nodes = new Map();
  const copies = elements.map(source => {
    const element = clone(source); element.id = uid('element'); owners.set(source.id, element.id); element.x += dx; element.y += dy;
    const visit = node => { const old = node.id; node.id = uid('node'); nodes.set(old, node.id); (node.children || []).forEach(visit); }; if (element.tree) visit(element.tree);
    return element;
  });
  for (const element of copies) if (element.type === 'connector') {
    for (const terminal of [element.source, element.target]) {
      terminal.fallback.x += dx; terminal.fallback.y += dy;
      if (owners.has(terminal.binding?.id)) terminal.binding.id = owners.get(terminal.binding.id);
      if (nodes.has(terminal.binding?.content?.nodeId)) terminal.binding.content.nodeId = nodes.get(terminal.binding.content.nodeId);
    }
    for (const constraint of element.route.constraints) for (const p of [constraint.a, constraint.b]) { p.x += dx; p.y += dy; }
  }
  return copies;
}
export function treeText(tree, depth = 0) {
  return `${'  '.repeat(depth)}${tree?.text || ''}${(tree?.children || []).map(child => '\n' + treeText(child, depth + 1)).join('')}`;
}
export function elementText(element) {
  return element.type === 'mindmap' ? treeText(element.tree) : plainText(element.doc) || element.alt || element.text || element.type;
}
export function sourceText(item) {
  if (item.type === 'mindmap') return treeText(item.tree);
  if (Array.isArray(item.rows)) return item.rows.map(row => Array.isArray(row) ? row.map(cell => typeof cell === 'object' ? cell.text || cell.value || '' : cell).join('\t') : '').join('\n');
  if (item.type === 'sheet') {
    const cells = item.workbook?.sheets || item.sheets || item.cells;
    return [item.title || '工作表', cells ? JSON.stringify(cells).slice(0, 30000) : '工作表内容请在画布中查看'].join('\n');
  }
  return [item.text, item.name, item.title, item.label, item.url, item.address, item.origin?.name, item.destination?.name].filter(value => typeof value === 'string' && value).join('\n') || `${item.type || '元素'}：无可提取的文字`;
}
export function resizeBounds(bounds, direction, dx, dy, { text = false, minWidth = text ? 100 : 24, minHeight = 24, proportional = false } = {}) {
  const west = direction.includes('w'), north = direction.includes('n');
  const horizontal = west || direction.includes('e'), vertical = !text && (north || direction.includes('s'));
  const maxWidth = Math.min(20000, west ? bounds.x + bounds.w : proportional && !horizontal ? bounds.w + 2 * bounds.x : 20000);
  const maxHeight = Math.min(20000, north ? bounds.y + bounds.h : proportional && !vertical ? bounds.h + 2 * bounds.y : 20000);
  let w = horizontal ? Math.max(Math.min(minWidth,maxWidth), Math.min(maxWidth,bounds.w + (west ? -dx : dx))) : bounds.w;
  let h = vertical ? Math.max(Math.min(minHeight,maxHeight), Math.min(maxHeight,bounds.h + (north ? -dy : dy))) : bounds.h;
  if (proportional && !text && (horizontal || vertical)) {
    // Project onto the original size vector so mixed grow/shrink movements stay continuous.
    const dw = horizontal ? (west ? -dx : dx) : 0, dh = vertical ? (north ? -dy : dy) : 0;
    const scale = horizontal && vertical ? 1 + (dw * bounds.w + dh * bounds.h) / (bounds.w ** 2 + bounds.h ** 2)
      : horizontal ? 1 + dw / bounds.w : 1 + dh / bounds.h;
    const minimum = Math.max(Math.min(minWidth,maxWidth) / bounds.w,Math.min(minHeight,maxHeight) / bounds.h);
    const maximum = Math.min(maxWidth / bounds.w,maxHeight / bounds.h);
    const limited = Math.min(maximum,Math.max(minimum,scale));
    w = bounds.w * limited; h = bounds.h * limited;
  }
  return { x: west ? Math.max(0,bounds.x + bounds.w - w) : proportional && !horizontal && !text ? bounds.x + (bounds.w - w) / 2 : bounds.x,
    y: north ? Math.max(0,bounds.y + bounds.h - h) : proportional && !vertical && !text ? bounds.y + (bounds.h - h) / 2 : bounds.y, w, h };
}

export function fromCanvas(item, source = {}, point = { x: 64, y: 64 }) {
  const type = ({ text: 'text', note: 'callout', image: 'image', table: 'text', mindmap: 'mindmap', ink: 'ink', shape: 'shape', planning: 'planning' })[item.type] || 'text';
  const element = createElement(type, point);
  if (type === 'planning') Object.assign(element, { planRef: item.planRef, planView: item.planView || 'list' });
  if (item.taskRef) element.taskRef = clone(item.taskRef);
  element.origin = { kind: 'canvas', boardId: source.boardId || '', entityId: item.id, label: source.label || '' };
  element.w = Math.min(1100, Math.max(160, Number(item.w) || element.w));
  element.h = Math.min(1600, Math.max(60, Number(item.h) || element.h));
  if (type === 'image') Object.assign(element, { src: item.src, alt: item.alt || '', assetId: item.assetId });
  else if (type === 'mindmap') element.tree = cloneTree(item.tree);
  else if (type === 'ink') Object.assign(element, { points: (item.pts || []).map(p => [p.x * element.w / (item.baseW || item.w || element.w), p.y * element.h / (item.baseH || item.h || element.h), p.pressure ?? 0.5]), color: item.stroke || '#34313d', size: item.strokeWidth || 3, opacity: item.opacity ?? 1, brushType: item.brushType || 'brush' });
  else if (type === 'shape') Object.assign(element, { shape: ['rect', 'ellipse', 'triangle'].includes(item.shape) ? item.shape : 'rect', color: item.stroke || '#7660bd', fill: item.fill || '#f0ebfa' });
  else {
    element.doc = item.type === 'table' && Array.isArray(item.rows) ? tableDoc(item.rows.map(row => row.map(cell => typeof cell === 'object' ? cell.text || cell.value || '' : String(cell)))) : textDoc(sourceText(item));
    if (Array.isArray(item.richText) && item.richText.length) {
      const content = []; let paragraph = { type: 'paragraph', content: [] }; content.push(paragraph);
      for (const run of item.richText) {
        const marks = []; if (run.bold) marks.push({ type:'bold' });
        const attrs = {}; if (run.color) attrs.color = run.color; if (run.fontSize) attrs.fontSize = `${run.fontSize}px`; if (run.fontFamily) attrs.fontFamily = run.fontFamily;
        if (Object.keys(attrs).length) marks.push({ type:'textStyle', attrs });
        String(run.text || '').split('\n').forEach((text,index) => { if (index) { paragraph = {type:'paragraph',content:[]}; content.push(paragraph); } if (text) paragraph.content.push({type:'text',text,marks}); });
      }
      element.doc = {type:'doc',content};
    }
    if (item.type === 'note') element.fill = item.noteFill || '#fff4cf';
  }
  return element;
}
export function toCanvas(element, point = { x: 0, y: 0 }) {
  const type = ({ callout: 'note', tag: 'note', text: 'text', mindmap: 'mindmap', ink: 'ink', image: 'image', shape: 'shape', planning: 'planning' })[element.type] || 'text';
  const item = { id: uid(type), type, x: point.x, y: point.y, w: element.w, h: element.h, rotation: 0, z: 1, color: '#34313d', fontSize: 18, text: elementText(element) };
  if (['text','note'].includes(type) && element.doc) {
    const runs = [];
    const walk = node => {
      if (node.type === 'text') { const marks = node.marks || []; const style = marks.find(mark => mark.type === 'textStyle')?.attrs || {}; runs.push({text:node.text,bold:marks.some(mark => mark.type === 'bold'),color:style.color || '#34313d',fontSize:parseFloat(style.fontSize) || 18,...(style.fontFamily ? {fontFamily:style.fontFamily} : {})}); }
      else if (node.type === 'hardBreak') runs.push({text:'\n'});
      else { (node.content || []).forEach(walk); if (['paragraph','heading','codeBlock'].includes(node.type)) runs.push({text:'\n'}); }
    };
    walk(element.doc); if (runs.at(-1)?.text === '\n') runs.pop(); item.richText = runs; item.text = runs.map(run => run.text).join('');
  }
  if (type === 'mindmap') item.tree = cloneTree(element.tree);
  if (type === 'planning') Object.assign(item, { planRef: element.planRef, planView: element.planView || 'list' });
  if (element.taskRef) item.taskRef = clone(element.taskRef);
  if (type === 'image') Object.assign(item, { src: element.src, assetId: element.assetId, naturalWidth: element.w, naturalHeight: element.h });
  if (type === 'ink') Object.assign(item, { pts: element.points.map(p => ({ x: p[0], y: p[1], pressure: p[2] ?? 0.5 })), baseW: element.w, baseH: element.h, stroke: element.color, strokeWidth: element.size, opacity: element.opacity ?? 1, brushType: element.brushType || 'brush' });
  if (type === 'shape') Object.assign(item, { shape: element.shape, stroke: element.color, strokeWidth: 2, fill: element.fill });
  if (type === 'text' && element.doc?.content?.length === 1 && element.doc.content[0].type === 'table') Object.assign(item, { type: 'table', rows: element.doc.content[0].content.map(row => row.content.map(plainText)) });
  if (type === 'note') item.noteFill = element.fill || '#fff4cf';
  return item;
}
const ids = /^[a-zA-Z0-9_-]{1,80}$/;
const types = new Set(['text', 'callout', 'tag', 'mindmap', 'ink', 'image', 'shape', 'planning', 'connector']);
export function validateRichDoc(doc) {
  let count = 0;
  const nodes = new Set(['doc','paragraph','heading','text','hardBreak','bulletList','orderedList','listItem','taskList','taskItem','blockquote','codeBlock','horizontalRule','table','tableRow','tableCell','tableHeader']);
  const marks = new Set(['bold','italic','strike','underline','code','link','highlight','textStyle']);
  const fail = () => { throw Object.assign(new Error('文字结构无效或超过限制'), { statusCode: 400, code: 'INVALID_NOTEBOOK' }); };
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 32 || ++count > 20000 || !nodes.has(node.type)) fail();
    if (node.type === 'text' && (typeof node.text !== 'string' || node.text.length > 100000)) fail();
    if (node.content !== undefined && !Array.isArray(node.content)) fail();
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 10)) fail();
    if (node.attrs !== undefined && (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs) || JSON.stringify(node.attrs).length > 4096)) fail();
    if (node.attrs?.taskRef && (!ids.test(node.attrs.taskRef.planId || '') || !ids.test(node.attrs.taskRef.taskId || ''))) fail();
    for (const mark of node.marks || []) {
      if (!marks.has(mark?.type) || (mark.attrs && JSON.stringify(mark.attrs).length > 4096)) fail();
      if (mark.type === 'link' && !/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href || '')) fail();
    }
    if (['text','hardBreak','horizontalRule'].includes(node.type) && node.content?.length) fail();
    const allowed = { doc: ['paragraph','heading','bulletList','orderedList','taskList','blockquote','codeBlock','horizontalRule','table'], paragraph:['text','hardBreak'], heading:['text','hardBreak'], codeBlock:['text'], bulletList:['listItem'], orderedList:['listItem'], taskList:['taskItem'], table:['tableRow'], tableRow:['tableCell','tableHeader'] }[node.type];
    for (const child of node.content || []) { if (allowed && !allowed.includes(child?.type)) fail(); visit(child, depth + 1); }
    for (const key of ['colspan','rowspan']) if (node.attrs?.[key] !== undefined && (!Number.isInteger(node.attrs[key]) || node.attrs[key] < 1 || node.attrs[key] > 200)) fail();
  };
  if (doc?.type !== 'doc') fail(); visit(doc);
  if (JSON.stringify(doc).length > 2000000) fail();
  return doc;
}
export function validateNotebook(book, { local = false } = {}) {
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_NOTEBOOK' }); };
  if (!book || typeof book.id !== 'string' || !ids.test(book.id) || book.version !== VERSION || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 100) fail('笔记本格式无效');
  if (!Array.isArray(book.sections) || !book.sections.length || book.sections.length > 1000 || !Array.isArray(book.pages) || !book.pages.length || book.pages.length > 10000) fail('笔记目录超过限制');
  const allIds = new Set([book.id]);
  const takeId = id => { if (typeof id !== 'string' || !ids.test(id) || allIds.has(id)) fail('笔记 ID 无效或重复'); allIds.add(id); };
  for (const section of book.sections) { takeId(section?.id); if (typeof section.title !== 'string' || section.title.length > 100) fail('分区名称无效'); }
  const sections = new Set(book.sections.map(section => section.id));
  for (const page of book.pages) {
    takeId(page?.id);
    if (!sections.has(page.sectionId) || typeof page.title !== 'string' || page.title.length > 200 || !Array.isArray(page.elements) || page.elements.length > 5000) fail('笔记页面无效');
    for (const element of page.elements) {
      takeId(element?.id);
      if (!types.has(element.type) || !['native', 'canvas'].includes(element.origin?.kind)) fail('笔记元素类型无效');
      if (element.type === 'planning' && (!ids.test(element.planRef || '') || !['list', 'kanban', 'calendar'].includes(element.planView))) fail('规划组件无效');
      if (element.type === 'connector') {
        if (element.connectorVersion !== 1 || !['smart','straight','curve','orthogonal'].includes(element.route?.type) || !Array.isArray(element.route.constraints) || element.route.constraints.length > 24 || !/^#[a-f\d]{3,8}$/i.test(element.style?.color || '') || !Number.isFinite(element.style?.width) || element.style.width < .5 || element.style.width > 16) fail('连接线无效');
        for (const end of [element.source, element.target]) {
          if (!end || !['x','y'].every(key => Number.isFinite(end.fallback?.[key]) && Math.abs(end.fallback[key]) <= 1000000)) fail('连接端点无效');
          if (end.binding && (end.binding.kind !== 'item' || !ids.test(end.binding.id || ''))) fail('连接对象无效');
          const content = end.binding?.content;
          if (content && !(content.kind === 'mind-node' && ids.test(content.nodeId || '') || content.kind === 'plan-task' && ids.test(content.planId || '') && ids.test(content.taskId || ''))) fail('连接内容无效');
        }
        for (const constraint of element.route.constraints) if (!['segment','curve'].includes(constraint?.kind) || ![constraint.a, constraint.b].every(p => p && ['x','y'].every(key => Number.isFinite(p[key]) && Math.abs(p[key]) <= 1000000))) fail('连线路径无效');
      }
      if (element.taskRef && (!ids.test(element.taskRef.planId || '') || !ids.test(element.taskRef.taskId || ''))) fail('任务引用无效');
      if (element.origin.region) {
        const region = element.origin.region;
        if (element.type !== 'image' || element.origin.kind !== 'canvas' || !ids.test(element.origin.boardId || '') || !region.bounds || ['x','y','w','h'].some(key => !Number.isFinite(region.bounds[key]) || Math.abs(region.bounds[key]) > 1000000) || region.bounds.w <= 0 || region.bounds.h <= 0 || !Array.isArray(region.entityIds) || region.entityIds.length > 5000 || region.entityIds.some(id => typeof id !== 'string' || !ids.test(id)) || typeof region.revision !== 'string' || region.revision.length > 80) fail('画布区域引用无效');
      }
      if (['x', 'y', 'w', 'h'].some(key => !Number.isFinite(element[key]) || element[key] < 0 || element[key] > 1000000) || element.w < 8 || element.h < 8) fail('笔记元素位置无效');
      if (element.type === 'image' && !(local && /^data:image\/(png|jpeg|webp);base64,/.test(element.src || '')) && !/^\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(element.src || '')) fail('图片必须使用已上传的资源');
      if (['text','callout','tag'].includes(element.type) || element.doc) validateRichDoc(element.doc);
      if (element.w > 20000 || (!['text','callout','tag'].includes(element.type) && element.h > 20000)) fail('内容尺寸超过限制');
      if (element.type === 'ink' && (!Array.isArray(element.points) || element.points.length > 100000 || element.points.some(p => !Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite) || p.some(value => Math.abs(value) > 1000000)))) fail('笔迹无效');
      if (element.type === 'mindmap') { let count = 0; const visit = (node, depth = 0) => { if (++count > 5000 || depth > 32 || typeof node?.text !== 'string' || node.text.length > 20000 || !Array.isArray(node.children)) fail('脑图结构无效'); if (node.taskRef && (!ids.test(node.taskRef.planId || '') || !ids.test(node.taskRef.taskId || ''))) fail('任务引用无效'); takeId(node.id); node.children.forEach(child => visit(child, depth + 1)); }; visit(element.tree); }
    }
  }
  return book;
}
export function notebookImages(book) { return book.pages.flatMap(page => page.elements.filter(element => element.type === 'image')); }
export function replaceDocTitle(doc, title) {
  const copy = clone(doc);
  const visit = value => {
    if (['paragraph','heading'].includes(value.type)) {
      const content = value.content || [], first = content.find(node => node.type === 'text'), boundary = content.findIndex(node => node.type === 'hardBreak');
      value.content = [{ type: 'text', text: title, ...(first?.marks ? { marks: clone(first.marks) } : {}) }, ...(boundary >= 0 ? content.slice(boundary) : [])]; return true;
    }
    return (value.content || []).some(visit);
  };
  if (!visit(copy)) copy.content = [{ type: 'paragraph', content: [{ type: 'text', text: title }] }, ...(copy.content || [])];
  return copy;
}
