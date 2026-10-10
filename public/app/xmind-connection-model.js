import { state } from './state.js';

async function xmindRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(options.method || 'GET') && window.MuseAccount?.csrfToken()
        ? { 'x-csrf-token': window.MuseAccount.csrfToken() }
        : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'XMind 服务请求失败');
    error.code = result.code;
    error.details = result;
    throw error;
  }
  return result;
}

function xmindContentFingerprint(item) {
  if (!item || item.type !== 'mindmap') return '';
  const localOnlyFields = new Set(
    Array.isArray(item.source?.localOnlyFields) ? item.source.localOnlyFields : ['note', 'status']
  );
  const comparableTree = item.tree ? structuredClone(item.tree) : null;
  const stack = comparableTree ? [comparableTree] : [];
  while (stack.length) {
    const node = stack.pop();
    delete node.taskRef;
    for (const field of localOnlyFields) delete node[field];
    stack.push(...(Array.isArray(node.children) ? node.children : []));
  }
  return JSON.stringify({ tree: comparableTree, relations: Array.isArray(item.relations) ? item.relations : [] });
}

function rememberXmindContent(item) {
  if (item?.source?.provider === 'xmind') state.xmindSyncFingerprints.set(item.id, xmindContentFingerprint(item));
}

function safeLocaleDate(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
export { xmindRequest, xmindContentFingerprint, rememberXmindContent, safeLocaleDate };
