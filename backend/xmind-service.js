'use strict';
const {
  MCP_PROVIDERS,
  MCP_URL,
  XMindError,
  parseKey,
  extractStructuredDocument,
  buildStructuredPatch,
  normalizeMaps
} = require('./xmind-document');
const { initializeSchema } = require('./xmind-schema');
const { encrypt, decrypt, status, disconnect, tokenRow, accessToken, markReauthorize } = require('./xmind-tokens');
const { boundedOAuthFetch, oauthServerInfo, clientInfo, startOAuth, finishOAuth } = require('./xmind-oauth');
const { withCallGuard, withClient, call, listMaps, thumbnail, readMap } = require('./xmind-transport');
const {
  registerLink,
  link,
  checkRemoteChanges,
  withLinkMutation,
  stageLinkState,
  stagedLinkMatches,
  commitStagedLink,
  assertCanMutate,
  syncSummary
} = require('./xmind-links');
const { sync, syncUnlocked, acceptRemote, acceptRemoteUnlocked } = require('./xmind-sync');

class XMindService {
  constructor(options) {
    this.database = options.database;
    this.enabled = Boolean(options.enabled);
    this.keys = [options.encryptionKey, ...String(options.previousEncryptionKeys || '').split(',')]
      .map(parseKey)
      .filter((key, index, values) => key && values.findIndex((candidate) => candidate.equals(key)) === index);
    this.key = this.keys[0] || null;
    this.publicBaseUrl = new URL(options.publicBaseUrl);
    this.callbackUrl = new URL('/api/xmind/oauth/callback', this.publicBaseUrl).href;
    this.timeoutMs = options.timeoutMs || 15_000;
    this.maxResponseBytes = options.maxResponseBytes || 4 * 1024 * 1024;
    this.listCache = new Map();
    this.remoteCheckCache = new Map();
    this.syncCapabilityCache = new Map();
    this.linkMutationTails = new Map();
    this.inflight = new Map();
    this.circuits = new Map();
    if (this.enabled && !this.key)
      throw new Error('XMIND_MCP_ENABLED requires XMIND_TOKEN_ENCRYPTION_KEY to be a base64-encoded 32-byte key');
    this.initializeSchema();
  }

  initializeSchema() {
    return initializeSchema(this);
  }

  encrypt(value, aad) {
    return encrypt(this, value, aad);
  }

  decrypt(value, aad) {
    return decrypt(this, value, aad);
  }

  status(userId) {
    return status(this, userId);
  }

  async boundedOAuthFetch(url, options = {}) {
    return boundedOAuthFetch(this, url, options);
  }

  async oauthServerInfo(providerId = 'global') {
    return oauthServerInfo(this, providerId);
  }

  async clientInfo(serverInfo = null) {
    return clientInfo(this, serverInfo);
  }

  async startOAuth(userId, providerId = 'global') {
    return startOAuth(this, userId, providerId);
  }

  async finishOAuth(params) {
    return finishOAuth(this, params);
  }

  disconnect(userId) {
    return disconnect(this, userId);
  }

  tokenRow(userId) {
    return tokenRow(this, userId);
  }

  async accessToken(userId, forceRefresh = false) {
    return accessToken(this, userId, forceRefresh);
  }

  markReauthorize(userId) {
    return markReauthorize(this, userId);
  }

  async withCallGuard(userId, callback) {
    return withCallGuard(this, userId, callback);
  }

  async withClient(userId, callback, retriedAuthorization = false) {
    return withClient(this, userId, callback, retriedAuthorization);
  }

  async call(userId, kind, values = {}) {
    return call(this, userId, kind, values);
  }

  async listMaps(userId, options = {}) {
    return listMaps(this, userId, options);
  }

  async thumbnail(userId, id) {
    return thumbnail(this, userId, id);
  }

  async readMap(userId, id) {
    return readMap(this, userId, id);
  }

  registerLink({ boardId, itemId, userId, remoteMapId, remoteName, hash, tree, relations = [] }) {
    return registerLink(this, { boardId, itemId, userId, remoteMapId, remoteName, hash, tree, relations });
  }

  link(boardId, itemId) {
    return link(this, boardId, itemId);
  }

  async checkRemoteChanges(userId, boardId, itemIds = [], options = {}) {
    return checkRemoteChanges(this, userId, boardId, itemIds, options);
  }

  async withLinkMutation(boardId, itemId, callback) {
    return withLinkMutation(this, boardId, itemId, callback);
  }

  stageLinkState(boardId, itemId, hash, tree, relations = [], syncedAt = Date.now()) {
    return stageLinkState(this, boardId, itemId, hash, tree, relations, syncedAt);
  }

  stagedLinkMatches(boardId, itemId, tree, relations, sourceHash, capabilities = {}) {
    return stagedLinkMatches(this, boardId, itemId, tree, relations, sourceHash, capabilities);
  }

  commitStagedLink(boardId, itemId, tree, relations, sourceHash, capabilities = {}) {
    return commitStagedLink(this, boardId, itemId, tree, relations, sourceHash, capabilities);
  }

  assertCanMutate(userId, boardId, itemId) {
    return assertCanMutate(this, userId, boardId, itemId);
  }

  syncSummary(userId, boardId, itemId, tree, relations = []) {
    return syncSummary(this, userId, boardId, itemId, tree, relations);
  }

  async sync(userId, boardId, itemId, expectedHash, tree, relations = [], force = false) {
    return sync(this, userId, boardId, itemId, expectedHash, tree, relations, force);
  }

  async syncUnlocked(userId, boardId, itemId, expectedHash, tree, relations = [], force = false) {
    return syncUnlocked(this, userId, boardId, itemId, expectedHash, tree, relations, force);
  }

  async acceptRemote(userId, boardId, itemId) {
    return acceptRemote(this, userId, boardId, itemId);
  }

  async acceptRemoteUnlocked(userId, boardId, itemId) {
    return acceptRemoteUnlocked(this, userId, boardId, itemId);
  }
}

module.exports = {
  XMindService,
  XMindError,
  MCP_URL,
  MCP_PROVIDERS,
  parseKey,
  normalizeMaps,
  extractStructuredDocument,
  buildStructuredPatch
};
