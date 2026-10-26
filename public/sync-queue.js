(function attachSyncQueue(globalScope) {
  'use strict';

  const PERSISTENCE_VERSION = 3;
  const SAFE_ID = /^[\w.-]{1,128}$/;
  const OP_KINDS = new Set([
    'upsert', 'delete', 'clear', 'layers', 'settings', 'batch', 'section-upsert', 'group-upsert',
    'reparent', 'transform', 'layout', 'set-flags', 'delete-container', 'sheet-command',
  ]);

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    // The queue is also exercised across VM/iframe realms, where Object.prototype
    // identity differs even though the value is still a plain record.
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function cloneJson(value, seen = new Set(), depth = 0) {
    if (depth > 64) throw new TypeError('Operation is nested too deeply.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Operation contains a non-finite number.');
      return value;
    }
    if (typeof value !== 'object' || seen.has(value)) {
      throw new TypeError('Operation must contain only acyclic JSON values.');
    }

    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map((entry) => cloneJson(entry, seen, depth + 1));
    } else {
      if (!isPlainObject(value)) throw new TypeError('Operation contains a non-plain object.');
      result = Object.create(null);
      for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          throw new TypeError('Operation contains an unsafe property.');
        }
        result[key] = cloneJson(value[key], seen, depth + 1);
      }
    }
    seen.delete(value);
    return result;
  }

  function assertSafeId(value, label) {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) {
      throw new TypeError(`${label} must be 1-128 safe characters.`);
    }
  }

  function assertOperation(operation, depth = 0) {
    if (!isPlainObject(operation) || !OP_KINDS.has(operation.kind) || depth > 32) {
      throw new TypeError('Invalid operation.');
    }

    switch (operation.kind) {
      case 'upsert':
        if (!isPlainObject(operation.item)) throw new TypeError('Upsert requires an item.');
        assertSafeId(operation.item.id, 'Item id');
        if (typeof operation.item.type !== 'string' || !operation.item.type) {
          throw new TypeError('Upsert item requires a type.');
        }
        break;
      case 'delete':
        if (!Array.isArray(operation.ids) || !operation.ids.length) {
          throw new TypeError('Delete requires at least one item id.');
        }
        operation.ids.forEach((id) => assertSafeId(id, 'Item id'));
        break;
      case 'layers':
        if (!Array.isArray(operation.layers) || !operation.layers.length) {
          throw new TypeError('Layers operation requires layers.');
        }
        operation.layers.forEach((layer) => {
          if (!isPlainObject(layer)) throw new TypeError('Invalid layer.');
          assertSafeId(layer.id, 'Layer id');
        });
        break;
      case 'settings':
        if (!isPlainObject(operation.settings)) throw new TypeError('Settings operation requires settings.');
        break;
      case 'batch':
        if (!Array.isArray(operation.ops) || !operation.ops.length || operation.ops.length > 5000) {
          throw new TypeError('Batch requires between 1 and 5000 operations.');
        }
        operation.ops.forEach((entry) => assertOperation(entry, depth + 1));
        break;
      case 'section-upsert':
        if (!isPlainObject(operation.section)) throw new TypeError('Section upsert requires a section.');
        assertSafeId(operation.section.id, 'Section id');
        break;
      case 'group-upsert':
        if (!isPlainObject(operation.group)) throw new TypeError('Group upsert requires a group.');
        assertSafeId(operation.group.id, 'Group id');
        break;
      case 'reparent':
        if (!Array.isArray(operation.itemIds) || !operation.itemIds.length) throw new TypeError('Reparent requires item ids.');
        operation.itemIds.forEach((id) => assertSafeId(id, 'Item id'));
        break;
      case 'transform':
      case 'layout':
        if (!Array.isArray(operation.items) || !operation.items.length) throw new TypeError('Transform requires items.');
        operation.items.forEach((item) => {
          if (!isPlainObject(item)) throw new TypeError('Invalid transform item.');
          assertSafeId(item.id, 'Item id');
        });
        break;
      case 'set-flags':
        if (!Array.isArray(operation.ids) || !operation.ids.length || !isPlainObject(operation.flags)) {
          throw new TypeError('Set flags requires ids and flags.');
        }
        operation.ids.forEach((id) => assertSafeId(id, 'Target id'));
        break;
      case 'delete-container':
        assertSafeId(operation.id, 'Container id');
        break;
      case 'sheet-command':
        assertSafeId(operation.itemId, 'Spreadsheet item id');
        if (!isPlainObject(operation.command)) throw new TypeError('Spreadsheet command is required.');
        break;
      case 'clear':
        break;
      default:
        throw new TypeError('Invalid operation.');
    }
  }

  function normalizeOperation(operation) {
    const copy = cloneJson(operation);
    assertOperation(copy);
    return copy;
  }

  function operationsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createOperationId() {
    const cryptoApi = globalScope.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `op_${cryptoApi.randomUUID()}`;
    const random = Math.random().toString(36).slice(2);
    return `op_${Date.now().toString(36)}_${random}`.slice(0, 128);
  }

  // Only reorder operations whose complete dependencies are known. Structural
  // edits (layers, containers, clear, sheets, connectors) remain order barriers.
  function isolatedDraftEffects(op) {
    if (op.kind === 'batch') {
      const children = op.ops.map(isolatedDraftEffects);
      if (children.some(child => !child)) return null;
      return { keys: new Set(children.flatMap(child => [...child.keys])),
        hasImage: children.some(child => child.hasImage) };
    }
    if (op.kind === 'upsert' && ['image', 'text', 'note'].includes(op.item.type) && !op.item.taskRef) {
      return { keys: new Set([`item:${op.item.id}`]), hasImage: op.item.type === 'image' };
    }
    if (op.kind === 'settings') {
      return { keys: new Set(Object.keys(op.settings).map(key => `setting:${key}`)), hasImage: false };
    }
    return null;
  }

  function selectSendableEntry(entries) {
    const head = entries[0];
    if (!head?.error) return head;
    // A server-identified inaccessible image is retained for recovery. It must
    // not prevent unrelated text/background edits from reaching the server.
    if (!head.errorImage) return null;
    const first = isolatedDraftEffects(head.op);
    if (!first?.hasImage) return null;
    const withheld = first.keys;
    for (const entry of entries.slice(1)) {
      const effects = isolatedDraftEffects(entry.op);
      if (!effects || entry.error && !entry.errorImage) return null;
      if (!entry.error && !effects.hasImage && ![...effects.keys].some(key => withheld.has(key))) return entry;
      for (const key of effects.keys) withheld.add(key);
    }
    return null;
  }

  class SyncQueue {
    constructor(serialized) {
      this._entries = [];
      this._inflightOpId = null;
      this._recoveryPaused = false;
      this.restoreIssueCount = 0;
      if (serialized !== undefined && serialized !== null) this.restore(serialized);
    }

    get length() {
      return this._entries.length;
    }

    get inflightOpId() {
      return this._inflightOpId;
    }

    get blockedReason() { return this._entries[0]?.error || ''; }

    get requiresResolution() {
      return this._entries.some(entry => entry.error && !entry.errorImage);
    }

    pause() { this._recoveryPaused = true; }
    unpause() { this._recoveryPaused = false; }

    block(opId, reason, image) {
      const entry = this._entries.find((candidate) => candidate.opId === opId);
      if (!entry) return false;
      entry.baseRevision = null;
      if (this._inflightOpId === opId) this._inflightOpId = null;
      entry.error = String(reason || '操作被服务器拒绝').slice(0, 1000);
      if (image && typeof image.itemId === 'string' && SAFE_ID.test(image.itemId) && typeof image.assetId === 'string' && /^[a-f0-9]{64}$/.test(image.assetId)) {
        entry.errorImage = { itemId: image.itemId, assetId: image.assetId };
      } else delete entry.errorImage;
      return true;
    }

    resume() {
      this._recoveryPaused = false;
      if (this._entries[0]) { delete this._entries[0].error; delete this._entries[0].errorImage; }
    }

    replaceBlockedImage(source, asset) {
      const head = this._entries[0];
      if (!head?.error || this._inflightOpId) throw new Error('请等待图片操作暂停后再恢复。');
      if (!/^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(source) ||
          !/^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(asset?.url) ||
          asset.assetId !== asset.url.slice(8, 72) || !(asset.width > 0) || !(asset.height > 0)) throw new Error('图片恢复数据无效。');
      const sourceId = source.slice(8, 72).toLowerCase();
      const contains = op => op?.kind === 'batch' ? op.ops.some(contains) :
        op?.kind === 'upsert' && op.item?.type === 'image' && /^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/i.test(op.item.src) && op.item.src.slice(8, 72).toLowerCase() === sourceId;
      if (!contains(head.op) || head.errorImage && head.errorImage.assetId !== sourceId) throw new Error('这张图片不是当前失败操作的图片。');
      let count = 0;
      const replace = op => {
        if (op.kind === 'batch') return op.ops.forEach(replace);
        if (!contains(op)) return;
        Object.assign(op.item, { src: asset.url, assetId: asset.assetId, naturalWidth: asset.width, naturalHeight: asset.height });
        count++;
      };
      const next = this._entries.map(entry => {
        if (!contains(entry.op)) return entry;
        const updated = { ...entry, opId: createOperationId(), op: cloneJson(entry.op), baseRevision: null };
        replace(updated.op);
        delete updated.errorImage;
        return updated;
      });
      // Keep the queue paused until the caller has durably saved the replacement.
      this._recoveryPaused = true;
      this._entries = next;
      return count;
    }

    restore(serialized) {
      this._entries = [];
      this._inflightOpId = null;
      this._recoveryPaused = false;
      this.restoreIssueCount = 0;
      if (!isPlainObject(serialized) || ![2, PERSISTENCE_VERSION].includes(serialized.version) || !Array.isArray(serialized.entries)) {
        this.restoreIssueCount++;
        return 0;
      }

      const ids = new Set();
      for (const candidate of serialized.entries) {
        try {
          if (!isPlainObject(candidate)) { this.restoreIssueCount++; continue; }
          assertSafeId(candidate.opId, 'Operation id');
          if (ids.has(candidate.opId)) continue;
          const operation = normalizeOperation(candidate.op);
          ids.add(candidate.opId);
          // A restored request is never considered in-flight. Its old base revision
          // may be stale, so the next send always rebases it against the snapshot.
          this._entries.push({ opId: candidate.opId, op: operation, baseRevision: null,
            attempted: candidate.attempted !== false,
            ...(candidate.error ? { error: String(candidate.error).slice(0, 1000) } : {}),
            ...(candidate.error && typeof candidate.errorImage?.itemId === 'string' && SAFE_ID.test(candidate.errorImage.itemId) && typeof candidate.errorImage?.assetId === 'string' && /^[a-f0-9]{64}$/.test(candidate.errorImage.assetId)
              ? { errorImage: { itemId: candidate.errorImage.itemId, assetId: candidate.errorImage.assetId } } : {}) });
        } catch (_error) {
          this.restoreIssueCount++;
        }
      }
      return this._entries.length;
    }

    enqueue(operation, optionalOpId) {
      const op = normalizeOperation(operation);
      const opId = optionalOpId === undefined ? createOperationId() : optionalOpId;
      assertSafeId(opId, 'Operation id');

      const existing = this._entries.find((entry) => entry.opId === opId);
      if (existing) {
        if (!operationsEqual(existing.op, op)) throw new Error(`Operation id ${opId} is already queued.`);
        return opId;
      }

      const last = this._entries[this._entries.length - 1];
      if (optionalOpId === undefined && last && !last.error && !last.attempted && last.opId !== this._inflightOpId &&
          op.kind === 'upsert' && last.op.kind === 'upsert' &&
          ['text', 'note', 'table'].includes(op.item.type) && last.op.item.type === op.item.type &&
          last.op.item.id === op.item.id && !op.item.taskRef && !last.op.item.taskRef &&
          (op.baseContentVersion ?? op.item.contentVersion ?? 0) === (last.op.baseContentVersion ?? last.op.item.contentVersion ?? 0) &&
          operationsEqual(op.expectedMutations || {}, last.op.expectedMutations || {}) &&
          Object.keys(op).every(key => ['kind', 'item', 'baseContentVersion', 'connectorCapabilities', 'expectedMutations'].includes(key)) &&
          Object.keys(last.op).every(key => ['kind', 'item', 'baseContentVersion', 'connectorCapabilities', 'expectedMutations'].includes(key))) {
        // Replace only a never-sent full text snapshot. An attempted operation's
        // ID/payload must remain immutable for server receipt deduplication.
        last.op = op;
        last.opId = opId;
        return last.opId;
      }

      this._entries.push({ opId, op, baseRevision: null, attempted: false });
      return opId;
    }

    nextEnvelope(currentRevision) {
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw new TypeError('currentRevision must be a non-negative safe integer.');
      }
      if (this._inflightOpId !== null || this._recoveryPaused) return null;

      const entry = selectSendableEntry(this._entries);
      if (!entry) return null;
      entry.baseRevision = currentRevision;
      entry.attempted = true;
      this._inflightOpId = entry.opId;
      return {
        type: 'op',
        opId: entry.opId,
        baseRevision: entry.baseRevision,
        op: cloneJson(entry.op)
      };
    }

    peekOperation() {
      const entry = selectSendableEntry(this._entries);
      return entry ? cloneJson(entry.op) : null;
    }

    ack(opId, canonicalOperation) {
      const index = this._entries.findIndex(entry => entry.opId === opId);
      if (index < 0) return false;
      const acknowledged = this._entries[index];
      this._entries.splice(index, 1);
      if (this._inflightOpId === opId) this._inflightOpId = null;
      if (canonicalOperation) {
        const before = new Map(), after = new Map();
        const collect = (op, result) => {
          if (op?.kind === 'batch') { op.ops.forEach(child => collect(child, result)); return; }
          if (op?.kind === 'upsert' && ['text', 'note', 'table', 'mindmap', 'sheet'].includes(op.item?.type))
            result.set(op.item.id, op.baseContentVersion ?? op.item.contentVersion ?? 0);
        };
        collect(acknowledged.op, before); collect(canonicalOperation, after);
        for (const entry of this._entries.slice(index)) {
          if (entry.attempted || entry.error) continue;
          let changed = false;
          const mutations = canonicalOperation.mutations || {}, expected = acknowledged.op.expectedMutations || {};
          const rebaseMutations = op => {
            for (const [key, version] of Object.entries(op.expectedMutations || {})) {
              if (Object.hasOwn(expected, key) && Object.hasOwn(mutations, key) && version === expected[key]) {
                op.expectedMutations[key] = mutations[key]; changed = true;
              }
            }
            for (const [entity, prefix] of [[op.item, ''], [op.section, 'section:'], [op.group, 'group:']]) {
              const key = entity && prefix + entity.id;
              if (entity && Object.hasOwn(expected, key) && Object.hasOwn(mutations, key) &&
                  (entity.mutationVersion ?? null) === expected[key]) {
                if (mutations[key] === null) delete entity.mutationVersion; else entity.mutationVersion = mutations[key];
                changed = true;
              }
            }
            if (op.kind === 'batch') op.ops.forEach(rebaseMutations);
          };
          rebaseMutations(entry.op);
          const rebase = op => {
            if (op.kind === 'batch') { op.ops.forEach(rebase); return; }
            const id = op.item?.id;
            if (op.kind !== 'upsert' || !before.has(id) || !after.has(id) || before.get(id) === after.get(id)) return;
            if ((op.baseContentVersion ?? op.item.contentVersion ?? 0) !== before.get(id)) return;
            op.item.contentVersion = after.get(id);
            if (Object.hasOwn(op, 'baseContentVersion')) op.baseContentVersion = after.get(id);
            changed = true;
          };
          rebase(entry.op);
          if (changed) entry.opId = createOperationId();
        }
      }
      return true;
    }

    retry(opId) {
      const entry = this._entries.find(entry => entry.opId === opId);
      if (!entry) return false;
      entry.baseRevision = null;
      if (this._inflightOpId === opId) this._inflightOpId = null;
      return true;
    }

    replace(opId, operation) {
      const entry = this._entries.find((candidate) => candidate.opId === opId);
      if (!entry) return false;
      entry.op = normalizeOperation(operation);
      entry.baseRevision = null;
      delete entry.error;
      delete entry.errorImage;
      if (this._inflightOpId === opId) this._inflightOpId = null;
      return true;
    }

    fatal(opId) {
      return this.ack(opId);
    }

    discard(opIds) {
      const ids = new Set(Array.isArray(opIds) ? opIds : [opIds]);
      ids.delete(undefined);
      ids.delete(null);
      if (!ids.size) return 0;
      const before = this._entries.length;
      this._entries = this._entries.filter((entry) => !ids.has(entry.opId));
      if (this._inflightOpId && ids.has(this._inflightOpId)) this._inflightOpId = null;
      return before - this._entries.length;
    }

    serialize() {
      return {
        version: PERSISTENCE_VERSION,
        entries: this._entries.map((entry) => ({
          opId: entry.opId,
          attempted: entry.attempted !== false,
          op: cloneJson(entry.op),
          baseRevision: entry.baseRevision,
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.errorImage ? { errorImage: cloneJson(entry.errorImage) } : {})
        }))
      };
    }

    static restore(serialized) {
      return new SyncQueue(serialized);
    }
  }

  Object.defineProperty(SyncQueue, 'VERSION', { value: PERSISTENCE_VERSION, enumerable: true });
  globalScope.WhiteboardSyncQueue = SyncQueue;
})(typeof window !== 'undefined' ? window : globalThis);
