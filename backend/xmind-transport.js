'use strict';
const MindMapMarkdown = require('../public/mindmap-markdown');
const {
  providerConfig,
  XMindError,
  sha256,
  toolText,
  possibleJson,
  extractStructuredDocument,
  normalizeSyncCapabilities,
  detectSyncCapabilities,
  normalizeMaps,
  propertyName,
  fineGrainedArgs,
  ensureRemoteTreeIds,
  applyFallbackXmindVisuals
} = require('./xmind-document');

async function withCallGuard(service, userId, callback) {
  const circuit = service.circuits.get(userId);
  if (circuit?.until > Date.now()) {
    throw new XMindError('XMind 服务暂时不可用，请稍后重试', { code: 'XMIND_CIRCUIT_OPEN', statusCode: 503 });
  }
  const active = service.inflight.get(userId) || 0;
  if (active >= 2)
    throw new XMindError('XMind 请求过多，请稍后重试', { code: 'XMIND_CONCURRENCY_LIMIT', statusCode: 429 });
  service.inflight.set(userId, active + 1);
  try {
    const result = await callback();
    service.circuits.delete(userId);
    return result;
  } catch (error) {
    if (['XMIND_MCP_FAILED', 'XMIND_TIMEOUT', 'XMIND_UNAVAILABLE'].includes(error?.code)) {
      const failures = (circuit?.failures || 0) + 1;
      service.circuits.set(userId, { failures, until: failures >= 3 ? Date.now() + 30_000 : 0 });
    }
    throw error;
  } finally {
    const remaining = (service.inflight.get(userId) || 1) - 1;
    if (remaining > 0) service.inflight.set(userId, remaining);
    else service.inflight.delete(userId);
  }
}

async function withClient(service, userId, callback, retriedAuthorization = false) {
  const row = service.tokenRow(userId);
  const provider = providerConfig(row.provider);
  const token = await service.accessToken(userId);
  const { Client, StreamableHTTPClientTransport, UnauthorizedError } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'muse-board', version: '3.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(provider.mcpUrl), {
    authProvider: { token: async () => token }
  });
  try {
    await client.connect(transport, { timeout: service.timeoutMs, maxTotalTimeout: service.timeoutMs });
    return await callback(client);
  } catch (error) {
    if (error instanceof UnauthorizedError || error?.statusCode === 401) {
      if (!retriedAuthorization) {
        try {
          await service.accessToken(userId, true);
        } catch {
          service.markReauthorize(userId);
          throw new XMindError('XMind 授权已失效，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
        }
        return service.withClient(userId, callback, true);
      }
      service.markReauthorize(userId);
      throw new XMindError('XMind 授权已失效，请重新授权', { code: 'XMIND_REAUTH_REQUIRED', statusCode: 401 });
    }
    if (error instanceof XMindError) throw error;
    if (error?.name === 'AbortError' || /timeout/i.test(String(error?.code || error?.message || ''))) {
      throw new XMindError('XMind 请求超时', { code: 'XMIND_TIMEOUT', statusCode: 504 });
    }
    throw new XMindError('XMind MCP 调用失败', { code: 'XMIND_MCP_FAILED' });
  } finally {
    try {
      await transport.terminateSession();
    } catch {}
    try {
      await client.close();
    } catch {}
  }
}

async function call(service, userId, kind, values = {}) {
  return service.withCallGuard(userId, () =>
    service.withClient(userId, async (client) => {
      const requestOptions = { timeout: service.timeoutMs, maxTotalTimeout: service.timeoutMs };
      const tools = (await client.listTools(undefined, requestOptions)).tools || [];
      service.syncCapabilityCache.set(userId, detectSyncCapabilities(tools));
      const pattern =
        kind === 'list'
          ? /xmind.*list.*mindmaps/i
          : kind === 'read'
            ? /xmind.*read.*mindmap/i
            : /xmind.*edit.*mindmap/i;
      const tool = tools.find((entry) => pattern.test(entry.name));
      if (!tool)
        throw new XMindError(`XMind MCP 缺少${kind === 'list' ? '列表' : kind === 'read' ? '读取' : '编辑'}能力`, {
          code: 'XMIND_CAPABILITY_MISSING',
          statusCode: 503
        });
      const args = {};
      if (kind !== 'list') args[propertyName(tool, ['file_id', 'fileId', 'mindmap_id', 'mindmapId', 'id'])] = values.id;
      if (kind === 'edit') {
        const instruction = String(values.instruction || '').trim();
        const properties = tool?.inputSchema?.properties || {};
        const instructionKey = ['instruction', 'instructions', 'prompt', 'request'].find((key) =>
          Object.hasOwn(properties, key)
        );
        if (instruction && instructionKey) {
          args[instructionKey] = instruction;
        } else {
          const contentKey = propertyName(tool, ['markdown', 'content', 'new_content']);
          args[contentKey] = ['content', 'new_content'].includes(contentKey)
            ? `Replace only the topic hierarchy with the following outline. Preserve every existing style, relationship, boundary, summary, image, task and layout setting that is not explicitly represented in the outline.\n\n${values.markdown}`
            : values.markdown;
        }
      }
      const result = await client.callTool(
        { name: tool.name, arguments: args },
        { ...requestOptions, toolDefinition: tool }
      );
      if (Buffer.byteLength(JSON.stringify(result || null), 'utf8') > service.maxResponseBytes) {
        throw new XMindError('XMind 响应过大', { code: 'XMIND_RESPONSE_TOO_LARGE' });
      }
      if (result?.isError)
        throw new XMindError(toolText(result) || 'XMind MCP 返回错误', { code: 'XMIND_TOOL_FAILED' });
      if (kind === 'edit' && Array.isArray(values.operations)) {
        const preciseOperations = values.operations
          .filter((operation) => operation.op === 'set-topic-style' || operation.op === 'set-topic-attrs')
          .slice(0, 200);
        for (const operation of preciseOperations) {
          const pattern =
            operation.op === 'set-topic-style' ? /xmind.*set.*topic.*style/i : /xmind.*set.*topic.*attrs/i;
          const preciseTool = tools.find((entry) => pattern.test(entry.name));
          if (!preciseTool) continue;
          const preciseArgs = fineGrainedArgs(preciseTool, values.id, operation);
          if (!preciseArgs) continue;
          const preciseResult = await client.callTool(
            { name: preciseTool.name, arguments: preciseArgs },
            { ...requestOptions, toolDefinition: preciseTool }
          );
          if (preciseResult?.isError) {
            throw new XMindError(
              `XMind 已应用结构修改，但精确${operation.op === 'set-topic-style' ? '样式' : '属性'}同步失败；请刷新远端核对`,
              { code: 'XMIND_FINE_GRAINED_FAILED', statusCode: 409 }
            );
          }
        }
      }
      return result;
    })
  );
}

async function listMaps(service, userId, options = {}) {
  const cached = service.listCache.get(userId);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.maps;
  const maps = normalizeMaps(await service.call(userId, 'list'));
  service.listCache.set(userId, { maps, expiresAt: Date.now() + 30_000 });
  return maps;
}

async function thumbnail(service, userId, id) {
  const maps = await service.listMaps(userId);
  const map = maps.find((entry) => entry.id === id);
  if (!map?.thumbnailUrl)
    throw new XMindError('XMind 未提供缩略图', { code: 'XMIND_THUMBNAIL_NOT_FOUND', statusCode: 404 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(service.timeoutMs, 8_000));
  try {
    const response = await fetch(map.thumbnailUrl, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg' }
    });
    const contentType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const allowed = new Set(['image/avif', 'image/webp', 'image/png', 'image/jpeg']);
    const declared = Number(response.headers.get('content-length'));
    if (!response.ok || !allowed.has(contentType))
      throw new XMindError('XMind 缩略图不可用', { code: 'XMIND_THUMBNAIL_FAILED', statusCode: 502 });
    if (Number.isFinite(declared) && declared > 512 * 1024)
      throw new XMindError('XMind 缩略图过大', { code: 'XMIND_THUMBNAIL_TOO_LARGE', statusCode: 413 });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 512 * 1024)
      throw new XMindError('XMind 缩略图过大', { code: 'XMIND_THUMBNAIL_TOO_LARGE', statusCode: 413 });
    return { body, contentType };
  } catch (error) {
    if (error instanceof XMindError) throw error;
    if (error?.name === 'AbortError')
      throw new XMindError('XMind 缩略图请求超时', { code: 'XMIND_TIMEOUT', statusCode: 504 });
    throw new XMindError('XMind 缩略图不可用', { code: 'XMIND_THUMBNAIL_FAILED', statusCode: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function readMap(service, userId, id) {
  const result = await service.call(userId, 'read', { id });
  const markdown = toolText(result) || String(result?.structuredContent?.markdown || '');
  const decoded = result?.structuredContent || possibleJson(markdown);
  const structured = extractStructuredDocument({ structuredContent: decoded }, id);
  if (!structured && !markdown)
    throw new XMindError('XMind 脑图没有可读取的内容', { code: 'XMIND_EMPTY_MAP', statusCode: 422 });
  const parsed = structured || {
    ...MindMapMarkdown.parseMarkdown(markdown, { fallbackTitle: 'XMind 脑图' }),
    relations: []
  };
  const tree = ensureRemoteTreeIds(parsed.tree, id);
  const relations = Array.isArray(parsed.relations) ? parsed.relations : [];
  const fidelity = structured ? 'native-structured' : 'hierarchy-fallback';
  if (!structured) applyFallbackXmindVisuals(tree);
  const hash = sha256(structured ? JSON.stringify({ tree, relations }) : markdown);
  const syncCapabilities = normalizeSyncCapabilities(service.syncCapabilityCache.get(userId));
  return {
    markdown,
    tree,
    relations,
    hash,
    title: tree.text,
    layoutMode: parsed.layoutMode || 'mindmap',
    branchStyle: parsed.branchStyle || 'curve',
    fidelity,
    syncCapabilities
  };
}
module.exports = { withCallGuard, withClient, call, listMaps, thumbnail, readMap };
