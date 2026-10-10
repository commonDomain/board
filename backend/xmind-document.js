'use strict';

const crypto = require('node:crypto');
const MindMapMarkdown = require('../public/mindmap-markdown');

const MCP_PROVIDERS = Object.freeze({
  global: Object.freeze({
    id: 'global',
    label: '国际官网',
    mcpUrl: 'https://app.xmind.com/api/mcp',
    rootDomain: 'xmind.com'
  }),
  china: Object.freeze({
    id: 'china',
    label: '中文官网',
    mcpUrl: 'https://app.xmind.cn/api/mcp',
    rootDomain: 'xmind.cn'
  })
});

const MCP_URL = MCP_PROVIDERS.global.mcpUrl;

function providerConfig(value) {
  const provider = MCP_PROVIDERS[String(value || 'global').toLowerCase()];
  if (!provider) throw new XMindError('请选择有效的 XMind 站点', { code: 'XMIND_PROVIDER_INVALID', statusCode: 400 });
  return provider;
}

function isProviderHost(hostname, provider) {
  const host = String(hostname || '').toLowerCase();
  return host === provider.rootDomain || host.endsWith(`.${provider.rootDomain}`);
}

class XMindError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'XMindError';
    this.expose = true;
    this.code = options.code || 'XMIND_FAILED';
    this.statusCode = options.statusCode || 502;
    this.details = options.details;
  }
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseKey(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let key;
  try {
    key = Buffer.from(text, 'base64');
  } catch {
    return null;
  }
  return key.length === 32 ? key : null;
}

function keyId(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function toolText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((entry) => entry?.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();
}

function possibleJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced)
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  return null;
}

function safeThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (
      url.protocol !== 'https:' ||
      !Object.values(MCP_PROVIDERS).some((provider) => isProviderHost(url.hostname, provider))
    )
      return '';
    return url.href.slice(0, 2048);
  } catch {
    return '';
  }
}

const REMOTE_STYLE_ALIASES = Object.freeze({
  'svg:fill': 'fill',
  fillColor: 'fill',
  backgroundColor: 'fill',
  'fo:color': 'color',
  textColor: 'color',
  'fo:font-family': 'fontFamily',
  'fo:font-size': 'fontSize',
  'fo:font-weight': 'fontWeight',
  'fo:font-style': 'fontStyle',
  'fo:text-decoration': 'textDecoration',
  'border-line-color': 'borderColor',
  borderLineColor: 'borderColor',
  'border-line-width': 'borderWidth',
  borderLineWidth: 'borderWidth',
  'shape-class': 'shape',
  shapeClass: 'shape',
  'line-color': 'lineColor',
  lineColor: 'lineColor',
  'line-width': 'lineWidth',
  lineWidth: 'lineWidth',
  'line-pattern': 'linePattern',
  linePattern: 'linePattern',
  'branch-line-color': 'branchColor',
  branchLineColor: 'branchColor',
  'branch-line-width': 'branchWidth',
  branchLineWidth: 'branchWidth'
});

const REMOTE_STYLE_KEYS = new Set([
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
  'shape',
  'lineColor',
  'lineWidth',
  'linePattern',
  'branchColor',
  'branchWidth'
]);

function normalizeRemoteStyle(input) {
  const source = input?.properties && typeof input.properties === 'object' ? input.properties : input;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const style = {};
  for (const [key, raw] of Object.entries(source)) {
    const target = REMOTE_STYLE_KEYS.has(key) ? key : REMOTE_STYLE_ALIASES[key];
    if (!target) continue;
    if (typeof raw === 'string') {
      const numeric = raw.trim().match(/^(-?\d+(?:\.\d+)?)(?:px|pt)?$/i);
      style[target] =
        numeric && /(?:Width|Size|Radius)$/i.test(target)
          ? Math.max(0, Math.min(1000, Number(numeric[1])))
          : raw.slice(0, 128);
    } else if (Number.isFinite(raw)) style[target] = Math.max(0, Math.min(1000, raw));
    else if (typeof raw === 'boolean') style[target] = raw;
  }
  return Object.keys(style).length ? style : undefined;
}

function normalizeStructuredTopic(input, context, depth = 0, path = '0') {
  if (!input || typeof input !== 'object' || depth > 31 || context.count >= 5000) return null;
  context.count += 1;
  const rawText = String(input.title ?? input.text ?? input.name ?? '未命名主题');
  const text = MindMapMarkdown.cleanText(rawText, '未命名主题').slice(0, 500);
  const node = {
    id: String(
      input.id ||
        input.topicId ||
        input.topic_id ||
        MindMapMarkdown.topicIdentity(rawText) ||
        `xmind_${sha256(`${context.seed}:${path}:${text}`).slice(0, 16)}`
    ).slice(0, 128),
    text
  };
  const note = input.note?.plain ?? input.note?.content ?? input.note ?? input.notes?.plain ?? input.notes;
  if (typeof note === 'string' && note.trim()) node.note = note.slice(0, 4000);
  const labels = Array.isArray(input.labels) ? input.labels : Array.isArray(input.label) ? input.label : [];
  if (labels.length)
    node.labels = labels
      .map((value) => String(value?.text ?? value).slice(0, 64))
      .filter(Boolean)
      .slice(0, 20);
  const markers = Array.isArray(input.markers) ? input.markers : Array.isArray(input.markerIds) ? input.markerIds : [];
  if (markers.length)
    node.markers = markers
      .map((value) => String(value?.markerId ?? value?.id ?? value).slice(0, 64))
      .filter(Boolean)
      .slice(0, 20);
  const href = input.href ?? input.hyperlink ?? input.link;
  if (typeof href === 'string' && /^(?:https?:|mailto:)/i.test(href)) node.href = href.slice(0, 2048);
  if (input.status || input.todo?.status) node.status = String(input.status || input.todo.status).slice(0, 32);
  const side = String(input.side || input.position || input.direction || '').toLowerCase();
  if (side === 'left' || side === 'right') node.side = side;
  if (Number.isFinite(Number(input.width ?? input.w)))
    node.w = Math.max(90, Math.min(10000, Number(input.width ?? input.w)));
  if (Number.isFinite(Number(input.height ?? input.h)))
    node.h = Math.max(38, Math.min(1000, Number(input.height ?? input.h)));
  const style = normalizeRemoteStyle(input.style ?? input.topicStyle ?? input.topic_style ?? input.properties);
  if (style) node.style = style;
  const childSource =
    input.children?.attached || input.children?.topics || input.children || input.subtopics || input.topics || [];
  const children = Array.isArray(childSource) ? childSource : [];
  node.children = children
    .slice(0, 200)
    .map((child, index) => normalizeStructuredTopic(child, context, depth + 1, `${path}.${index}`))
    .filter(Boolean);
  return node;
}

function extractStructuredDocument(result, seed = '') {
  const rootValue = result?.structuredContent;
  if (!rootValue || typeof rootValue !== 'object') return null;
  const candidates = [
    rootValue.rootTopic,
    rootValue.root_topic,
    rootValue.topic,
    rootValue.tree,
    rootValue.mindmap?.rootTopic,
    rootValue.mindmap?.topic,
    rootValue.map?.rootTopic,
    rootValue.sheets?.[0]?.rootTopic,
    rootValue.sheets?.[0]?.topic,
    rootValue.data?.rootTopic,
    rootValue.data?.topic,
    rootValue.data?.tree,
    rootValue.document?.rootTopic,
    rootValue.document?.topic
  ];
  const root = candidates.find((value) => value && typeof value === 'object');
  if (!root) return null;
  const context = { count: 0, seed };
  const tree = normalizeStructuredTopic(root, context);
  if (!tree) return null;
  const relationSource =
    rootValue.relationships ||
    rootValue.relations ||
    rootValue.sheets?.[0]?.relationships ||
    rootValue.data?.relationships ||
    rootValue.document?.relationships ||
    [];
  const relations = (Array.isArray(relationSource) ? relationSource : [])
    .slice(0, 1000)
    .map((relation, index) => ({
      id: String(relation.id || `relation_${index + 1}`).slice(0, 128),
      startId: String(relation.startId || relation.end1Id || relation.end1 || relation.sourceTopicId || '').slice(
        0,
        128
      ),
      endId: String(relation.endId || relation.end2Id || relation.end2 || relation.targetTopicId || '').slice(0, 128),
      label: String(relation.label || relation.title || relation.text || '').slice(0, 200),
      ...(normalizeRemoteStyle(relation.style || relation.lineStyle || relation.properties)
        ? { lineStyle: normalizeRemoteStyle(relation.style || relation.lineStyle || relation.properties) }
        : {})
    }))
    .filter((relation) => relation.startId && relation.endId);
  const structure = String(
    rootValue.layoutMode ||
      rootValue.layout_mode ||
      rootValue.structureClass ||
      rootValue.mindmap?.layoutMode ||
      rootValue.mindmap?.structureClass ||
      rootValue.sheets?.[0]?.layoutMode ||
      rootValue.sheets?.[0]?.structureClass ||
      root.structureClass ||
      ''
  ).toLowerCase();
  const layoutMode = structure.includes('org')
    ? 'org-down'
    : structure.includes('tree') && structure.includes('left')
      ? 'tree-left'
      : structure.includes('tree')
        ? 'tree-right'
        : structure.includes('logic') && structure.includes('left')
          ? 'logic-left'
          : structure.includes('logic')
            ? 'logic-right'
            : structure.includes('timeline')
              ? 'timeline'
              : 'mindmap';
  return { tree, relations, layoutMode, branchStyle: 'curve' };
}

function flattenTree(tree) {
  const result = new Map();
  const visit = (node, parentId = null, index = 0, path = '0') => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || '');
    const children = Array.isArray(node.children) ? node.children : [];
    result.set(id, {
      id,
      parentId,
      index,
      path,
      text: String(node.text || ''),
      note: String(node.note || ''),
      labels: Array.isArray(node.labels) ? node.labels : [],
      markers: Array.isArray(node.markers) ? node.markers : [],
      href: String(node.href || ''),
      status: String(node.status || ''),
      style: node.style && typeof node.style === 'object' ? node.style : {},
      depth: path.split('.').length - 1
    });
    children.forEach((child, childIndex) => visit(child, id, childIndex, `${path}.${childIndex}`));
  };
  visit(tree);
  return result;
}

function normalizeSyncCapabilities(value) {
  return { note: value?.note === true, status: value?.status === true };
}

function remoteMarkdown(tree, capabilities) {
  if (normalizeSyncCapabilities(capabilities).note) return MindMapMarkdown.toMarkdown(tree);
  const withoutLocalNotes = (node) => {
    if (!node || typeof node !== 'object') return node;
    const { note, children, ...rest } = node;
    return { ...rest, children: (Array.isArray(children) ? children : []).map(withoutLocalNotes) };
  };
  return MindMapMarkdown.toMarkdown(withoutLocalNotes(tree));
}

function detectSyncCapabilities(tools) {
  const attributeTools = (Array.isArray(tools) ? tools : []).filter((tool) =>
    /xmind.*set.*topic.*attrs/i.test(String(tool?.name || ''))
  );
  const schemaText = JSON.stringify(attributeTools.map((tool) => tool.inputSchema || {})).toLowerCase();
  return {
    note: /"(?:note|notes|note_content|notecontent)"/.test(schemaText),
    status: /"(?:status|task_status|taskstatus|todo|completed)"/.test(schemaText)
  };
}

function buildStructuredPatch(beforeTree, afterTree, beforeRelations = [], afterRelations = [], capabilities = {}) {
  const supported = normalizeSyncCapabilities(capabilities);
  const before = flattenTree(beforeTree);
  const after = flattenTree(afterTree);
  const operations = [];
  [...before.values()]
    .filter((node) => !after.has(node.id))
    .sort((a, b) => b.depth - a.depth)
    .forEach((node) => operations.push({ op: 'remove-topic', topicId: node.id, path: node.path, title: node.text }));
  [...after.values()]
    .filter((node) => !before.has(node.id))
    .sort((a, b) => a.depth - b.depth)
    .forEach((node) =>
      operations.push({
        op: 'add-topic',
        topicId: node.id,
        parentTopicId: node.parentId,
        index: node.index,
        path: node.path,
        attrs: {
          title: node.text,
          labels: node.labels,
          markers: node.markers,
          hyperlink: node.href,
          ...(supported.note ? { note: node.note } : {}),
          ...(supported.status ? { status: node.status } : {})
        },
        style: node.style
      })
    );
  for (const [id, node] of after) {
    const previous = before.get(id);
    if (!previous) continue;
    if (previous.parentId !== node.parentId || previous.index !== node.index)
      operations.push({
        op: 'move-topic',
        topicId: id,
        parentTopicId: node.parentId,
        index: node.index,
        path: node.path,
        title: node.text
      });
    const attrs = {};
    const comparableAttributes = ['text', 'labels', 'markers', 'href'];
    if (supported.note) comparableAttributes.push('note');
    if (supported.status) comparableAttributes.push('status');
    for (const key of comparableAttributes) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(node[key]))
        attrs[key === 'text' ? 'title' : key === 'href' ? 'hyperlink' : key] = node[key];
    }
    if (Object.keys(attrs).length)
      operations.push({ op: 'set-topic-attrs', topicId: id, path: node.path, title: previous.text, attrs });
    if (JSON.stringify(previous.style) !== JSON.stringify(node.style))
      operations.push({ op: 'set-topic-style', topicId: id, path: node.path, title: node.text, style: node.style });
  }
  const beforeRelationMap = new Map((beforeRelations || []).map((relation) => [String(relation.id || ''), relation]));
  const afterRelationMap = new Map((afterRelations || []).map((relation) => [String(relation.id || ''), relation]));
  for (const [id, relation] of beforeRelationMap)
    if (!afterRelationMap.has(id)) operations.push({ op: 'remove-relationship', relationshipId: id });
  for (const [id, relation] of afterRelationMap) {
    if (!beforeRelationMap.has(id)) operations.push({ op: 'add-relationship', relationship: relation });
    else if (JSON.stringify(beforeRelationMap.get(id)) !== JSON.stringify(relation))
      operations.push({ op: 'update-relationship', relationshipId: id, relationship: relation });
  }
  return operations;
}

function normalizeMaps(result) {
  const text = toolText(result);
  const parsed = result?.structuredContent || possibleJson(text);
  const values = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.maps)
      ? parsed.maps
      : Array.isArray(parsed?.mindmaps)
        ? parsed.mindmaps
        : [];
  if (values.length)
    return values
      .slice(0, 100)
      .map((entry) => {
        const thumbnailUrl = safeThumbnailUrl(
          entry.thumbnailUrl || entry.thumbnail_url || entry.previewUrl || entry.thumbnail?.url
        );
        return {
          id: String(entry.id || entry.fileId || entry.file_id || entry.mindmapId || ''),
          name: String(entry.name || entry.title || entry.filename || '未命名脑图').slice(0, 200),
          lastOpenedAt: entry.lastOpenedAt || entry.last_opened_at || entry.updatedAt || null,
          ...(thumbnailUrl ? { thumbnailUrl } : {})
        };
      })
      .filter((entry) => entry.id);
  return String(text)
    .split('\n')
    .map((line) => {
      const match = line.match(/(?:^|[-*]\s+)(.+?)\s*(?:\(|\[)?(?:id|ID)[:：=\s]+([a-zA-Z0-9_.:-]+)[)\]]?/);
      return match
        ? {
            id: match[2],
            name: match[1]
              .replace(/^[#*\s-]+/, '')
              .trim()
              .slice(0, 200),
            lastOpenedAt: null
          }
        : null;
    })
    .filter(Boolean)
    .slice(0, 100);
}

function propertyName(tool, candidates) {
  const properties = tool?.inputSchema?.properties || {};
  return candidates.find((candidate) => Object.hasOwn(properties, candidate)) || candidates[0];
}

function assignKnownArgument(tool, args, candidates, value) {
  const properties = tool?.inputSchema?.properties || {};
  const key = candidates.find((candidate) => Object.hasOwn(properties, candidate));
  if (!key) return false;
  args[key] = value;
  return true;
}

function fineGrainedArgs(tool, mapId, operation) {
  const args = {};
  assignKnownArgument(tool, args, ['file_id', 'fileId', 'mindmap_id', 'mindmapId', 'map_id', 'mapId', 'id'], mapId);
  if (!assignKnownArgument(tool, args, ['topic_id', 'topicId', 'target_topic_id', 'targetTopicId'], operation.topicId))
    return null;
  if (operation.op === 'set-topic-style') {
    if (
      !assignKnownArgument(tool, args, ['style', 'topic_style', 'topicStyle', 'attributes', 'attrs'], operation.style)
    ) {
      const properties = tool?.inputSchema?.properties || {};
      let assigned = false;
      for (const [key, value] of Object.entries(operation.style || {})) {
        if (Object.hasOwn(properties, key)) {
          args[key] = value;
          assigned = true;
        }
      }
      if (!assigned) return null;
    }
  } else if (operation.op === 'set-topic-attrs') {
    if (!assignKnownArgument(tool, args, ['attrs', 'attributes', 'topic_attrs', 'topicAttrs'], operation.attrs)) {
      const properties = tool?.inputSchema?.properties || {};
      let assigned = false;
      for (const [key, value] of Object.entries(operation.attrs || {})) {
        const aliases =
          key === 'hyperlink' ? ['hyperlink', 'href', 'link'] : key === 'title' ? ['title', 'text', 'name'] : [key];
        const target = aliases.find((alias) => Object.hasOwn(properties, alias));
        if (target) {
          args[target] = value;
          assigned = true;
        }
      }
      if (!assigned) return null;
    }
  }
  return args;
}

function isAuthorizationFailure(error) {
  const code = String(error?.code || error?.error || '').toLowerCase();
  const status = Number(error?.statusCode || error?.status || error?.response?.status);
  const message = String(error?.message || '').toLowerCase();
  return (
    status === 401 ||
    code === 'invalid_grant' ||
    code === 'invalid_token' ||
    error?.name === 'UnauthorizedError' ||
    /\b(?:invalid_grant|invalid token|token revoked)\b/.test(message)
  );
}

function treeNodeMap(tree, capabilities = { note: true, status: true }) {
  const supported = normalizeSyncCapabilities(capabilities);
  const result = new Map();
  const stack = tree ? [tree] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const children = Array.isArray(node.children) ? node.children : [];
    const comparable = { ...node, children: undefined };
    delete comparable.taskRef;
    if (!supported.note) delete comparable.note;
    if (!supported.status) delete comparable.status;
    result.set(String(node.id || ''), JSON.stringify(comparable));
    stack.push(...children);
  }
  return result;
}

function ensureRemoteTreeIds(tree, seed = '') {
  const visit = (node, path = '0') => {
    if (!node || typeof node !== 'object') return node;
    const normalized = { ...node };
    normalized.id =
      String(node.id || '').trim() || `xmind_${sha256(`${seed}:${path}:${String(node.text || '')}`).slice(0, 16)}`;
    normalized.children = (Array.isArray(node.children) ? node.children : []).map((child, index) =>
      visit(child, `${path}.${index}`)
    );
    return normalized;
  };
  return visit(tree);
}

function applyFallbackXmindVisuals(tree) {
  if (!tree || typeof tree !== 'object') return tree;
  tree.style = {
    ...(tree.style || {}),
    fill: 'transparent',
    color: '#111111',
    borderWidth: 0,
    fontSize: 24,
    fontWeight: 'bold'
  };
  const palette = [
    { fill: '#fecaca', lineColor: '#ff5d5d' },
    { fill: '#fed7aa', lineColor: '#ff8a4c' },
    { fill: '#bbf7d0', lineColor: '#77c8a2' },
    { fill: '#bfdbfe', lineColor: '#60a5fa' },
    { fill: '#ddd6fe', lineColor: '#8b5cf6' }
  ];
  const children = Array.isArray(tree.children) ? tree.children : [];
  const rightCount = Math.ceil(children.length / 2);
  children.forEach((child, index) => {
    const colors = palette[index % palette.length];
    child.side ||= index < rightCount ? 'right' : 'left';
    child.style = { borderRadius: 8, fontWeight: 'bold', ...(child.style || {}), ...colors };
    const stack = [...(Array.isArray(child.children) ? child.children : [])];
    while (stack.length) {
      const node = stack.pop();
      node.style = { ...(node.style || {}), lineColor: node.style?.lineColor || colors.lineColor };
      stack.push(...(Array.isArray(node.children) ? node.children : []));
    }
  });
  return tree;
}

module.exports = {
  MCP_PROVIDERS,
  MCP_URL,
  providerConfig,
  isProviderHost,
  XMindError,
  base64url,
  sha256,
  parseKey,
  keyId,
  toolText,
  possibleJson,
  safeThumbnailUrl,
  REMOTE_STYLE_ALIASES,
  REMOTE_STYLE_KEYS,
  normalizeRemoteStyle,
  normalizeStructuredTopic,
  extractStructuredDocument,
  flattenTree,
  normalizeSyncCapabilities,
  remoteMarkdown,
  detectSyncCapabilities,
  buildStructuredPatch,
  normalizeMaps,
  propertyName,
  assignKnownArgument,
  fineGrainedArgs,
  isAuthorizationFailure,
  treeNodeMap,
  ensureRemoteTreeIds,
  applyFallbackXmindVisuals
};
