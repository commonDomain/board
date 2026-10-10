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

  class SyncQueue {
    constructor(serialized) {
      this._entries = [];
      this._inflightOpId = null;
      if (serialized !== undefined && serialized !== null) this.restore(serialized);
    }

    get length() {
      return this._entries.length;
    }

    get inflightOpId() {
      return this._inflightOpId;
    }

    get blockedReason() { return this._entries[0]?.error || ''; }

    block(opId, reason) {
      const entry = this._entries.find((candidate) => candidate.opId === opId);
      if (!entry) return false;
      entry.baseRevision = null;
      if (this._inflightOpId === opId) this._inflightOpId = null;
      entry.error = String(reason || '操作被服务器拒绝').slice(0, 1000);
      return true;
    }

    resume() { if (this._entries[0]) delete this._entries[0].error; }

    restore(serialized) {
      this._entries = [];
      this._inflightOpId = null;
      if (!isPlainObject(serialized) || ![2, PERSISTENCE_VERSION].includes(serialized.version) || !Array.isArray(serialized.entries)) {
        return 0;
      }

      const ids = new Set();
      for (const candidate of serialized.entries) {
        try {
          if (!isPlainObject(candidate)) continue;
          assertSafeId(candidate.opId, 'Operation id');
          if (ids.has(candidate.opId)) continue;
          const operation = normalizeOperation(candidate.op);
          ids.add(candidate.opId);
          // A restored request is never considered in-flight. Its old base revision
          // may be stale, so the next send always rebases it against the snapshot.
          this._entries.push({ opId: candidate.opId, op: operation, baseRevision: null, ...(candidate.error ? { error: String(candidate.error).slice(0, 1000) } : {}) });
        } catch (_error) {
          // Corrupt or legacy entries are intentionally discarded independently.
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

      this._entries.push({ opId, op, baseRevision: null });
      return opId;
    }

    nextEnvelope(currentRevision) {
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw new TypeError('currentRevision must be a non-negative safe integer.');
      }
      if (this._inflightOpId !== null || this._entries.length === 0 || this.blockedReason) return null;

      const entry = this._entries[0];
      entry.baseRevision = currentRevision;
      this._inflightOpId = entry.opId;
      return {
        type: 'op',
        opId: entry.opId,
        baseRevision: entry.baseRevision,
        op: cloneJson(entry.op)
      };
    }

    ack(opId) {
      const entry = this._entries[0];
      if (!entry || entry.opId !== opId) return false;
      this._entries.shift();
      if (this._inflightOpId === opId) this._inflightOpId = null;
      return true;
    }

    retry(opId) {
      const entry = this._entries[0];
      if (!entry || entry.opId !== opId) return false;
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
          op: cloneJson(entry.op),
          baseRevision: entry.baseRevision,
          ...(entry.error ? { error: entry.error } : {})
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
