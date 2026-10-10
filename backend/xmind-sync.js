'use strict';
const { XMindError, remoteMarkdown, buildStructuredPatch } = require('./xmind-document');

async function sync(service, userId, boardId, itemId, expectedHash, tree, relations = [], force = false) {
  return service.withLinkMutation(boardId, itemId, () =>
    service.syncUnlocked(userId, boardId, itemId, expectedHash, tree, relations, force)
  );
}

async function syncUnlocked(service, userId, boardId, itemId, expectedHash, tree, relations = [], force = false) {
  if (typeof relations === 'boolean') {
    force = relations;
    relations = [];
  }
  const link = service.assertCanMutate(userId, boardId, itemId);
  if (!link) throw new XMindError('XMind 连接不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
  const remote = await service.readMap(userId, link.remote_map_id);
  if (service.stagedLinkMatches(boardId, itemId, tree, relations, remote.hash, remote.syncCapabilities)) {
    service.commitStagedLink(boardId, itemId, tree, relations, remote.hash, remote.syncCapabilities);
    return {
      hash: link.pending_remote_hash,
      syncedAt: Number(link.pending_synced_at) || Date.now(),
      pendingCommit: true,
      syncCapabilities: remote.syncCapabilities
    };
  }
  if (!force && remote.hash !== link.remote_hash) {
    if (!buildStructuredPatch(remote.tree, tree, remote.relations || [], relations, remote.syncCapabilities).length) {
      const recovered = service.stageLinkState(boardId, itemId, remote.hash, tree, relations);
      service.commitStagedLink(boardId, itemId, tree, relations, remote.hash);
      return { ...recovered, pendingCommit: true, syncCapabilities: remote.syncCapabilities };
    }
    throw new XMindError('XMind 远端已有新修改', {
      code: 'XMIND_REMOTE_CONFLICT',
      statusCode: 409,
      details: { remoteHash: remote.hash }
    });
  }
  let baseline;
  let baselineRelations = [];
  try {
    baseline = JSON.parse(link.baseline_tree_json);
  } catch {
    baseline = null;
  }
  try {
    baselineRelations = JSON.parse(link.baseline_relations_json || '[]');
  } catch {}
  const operations = buildStructuredPatch(baseline, tree, baselineRelations, relations, remote.syncCapabilities);
  if (operations.length) {
    const instruction = [
      'Apply the following JSON patch to this mind map. This is a loss-minimizing incremental update, not a request to recreate the map.',
      'Use topic and relationship IDs when they resolve; otherwise use the supplied path and title only to locate the existing object.',
      'Preserve every property not explicitly changed, including theme, topic/branch/line/font styles, free positioning, structure, relationships, boundaries, summaries, images, attachments, links, markers, tasks, numbering, folding and all unknown metadata.',
      'Do not replace a sheet or rebuild the whole map. Do not remove any object unless an explicit remove operation names it.',
      JSON.stringify({ version: 1, operations })
    ].join('\n');
    await service.call(userId, 'edit', {
      id: link.remote_map_id,
      instruction,
      markdown: remoteMarkdown(tree, remote.syncCapabilities),
      operations
    });
  }
  const latest = await service.readMap(userId, link.remote_map_id);
  const expectedStructure = remoteMarkdown(tree, remote.syncCapabilities);
  const actualStructure = remoteMarkdown(latest.tree, remote.syncCapabilities);
  if (expectedStructure !== actualStructure) {
    throw new XMindError('XMind 已处理请求，但回读结构与画板不一致；已停止推进同步基线，请刷新远端后核对', {
      code: 'XMIND_VERIFICATION_FAILED',
      statusCode: 409
    });
  }
  const staged = service.stageLinkState(boardId, itemId, latest.hash, tree, relations);
  // The remote write has been verified. Advance the baseline independently of
  // the board item so edits made during the MCP call can be diffed next time.
  service.commitStagedLink(boardId, itemId, tree, relations, latest.hash);
  service.listCache.delete(userId);
  service.remoteCheckCache.delete(`${userId}:${link.provider}:${link.remote_map_id}`);
  return { ...staged, pendingCommit: true, syncCapabilities: latest.syncCapabilities };
}

async function acceptRemote(service, userId, boardId, itemId) {
  return service.withLinkMutation(boardId, itemId, () => service.acceptRemoteUnlocked(userId, boardId, itemId));
}

async function acceptRemoteUnlocked(service, userId, boardId, itemId) {
  const link = service.assertCanMutate(userId, boardId, itemId);
  if (!link) throw new XMindError('XMind 连接不存在', { code: 'XMIND_LINK_NOT_FOUND', statusCode: 404 });
  const latest = await service.readMap(userId, link.remote_map_id);
  const syncedAt = Date.now();
  service.stageLinkState(boardId, itemId, latest.hash, latest.tree, latest.relations || [], syncedAt);
  return { ...latest, syncedAt, pendingCommit: true };
}
module.exports = { sync, syncUnlocked, acceptRemote, acceptRemoteUnlocked };
