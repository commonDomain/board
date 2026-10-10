'use strict';
(function (global) {
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const collections = { item: 'items', section: 'sections', group: 'groups' };
  function diff(before, after) {
    const changes = [];
    for (const [targetType, key] of Object.entries(collections)) {
      const left = new Map((before[key] || []).map((entry) => [entry.id, entry]));
      const right = new Map((after[key] || []).map((entry) => [entry.id, entry]));
      for (const id of new Set([...left.keys(), ...right.keys()])) {
        const a = left.get(id), b = right.get(id);
        if (!a || !b) {
          changes.push({ targetType, id, fields: ['__entity'], before: { __entity: clone(a || null) }, after: { __entity: clone(b || null) } });
          continue;
        }
        const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => field !== 'id' && !equal(a[field], b[field]));
        if (fields.length) changes.push({ targetType, id, fields,
          before: Object.fromEntries(fields.map((field) => [field, clone(a[field])])),
          after: Object.fromEntries(fields.map((field) => [field, clone(b[field])])) });
      }
    }
    const fields = ['layers', 'background', 'backgroundDrift', 'connectorLineJumps'].filter((field) => !equal(before[field], after[field]));
    if (fields.length) changes.push({ targetType: 'document', id: 'document', fields,
      before: Object.fromEntries(fields.map((field) => [field, clone(before[field])])),
      after: Object.fromEntries(fields.map((field) => [field, clone(after[field])])) });
    return { __historyType: 'patch', changes };
  }
  function apply(snapshot, entry, direction) {
    const result = clone(snapshot);
    for (const change of entry.changes) {
      const values = change[direction === 'redo' ? 'after' : 'before'];
      if (change.targetType === 'document') {
        for (const field of change.fields) result[field] = clone(values[field]);
        continue;
      }
      const key = collections[change.targetType];
      if (!key) continue;
      const entities = new Map((result[key] || []).map((entity) => [entity.id, entity]));
      if (change.fields.includes('__entity')) {
        if (values.__entity) entities.set(change.id, clone(values.__entity));
        else entities.delete(change.id);
      } else {
        const entity = entities.get(change.id);
        if (entity) for (const field of change.fields) {
          if (values[field] === undefined) delete entity[field];
          else entity[field] = clone(values[field]);
        }
      }
      result[key] = [...entities.values()];
    }
    return result;
  }
  function convert(stack, current, direction = 'undo') {
    const result = stack.slice();
    const firstSnapshot = result.findIndex(entry => entry.__historyType !== 'patch');
    if (firstSnapshot < 0) return result;
    let cursor = clone(current);
    for (let index = result.length - 1; index >= firstSnapshot; index--) {
      const entry = result[index];
      const patch = entry.__historyType === 'patch' ? entry
        : direction === 'undo' ? diff(entry, cursor) : diff(cursor, entry);
      result[index] = patch;
      if (index > firstSnapshot) cursor = apply(cursor, patch, direction);
    }
    return result;
  }
  global.WhiteboardHistory = Object.freeze({ diff, apply, convert });
})(typeof window === 'undefined' ? globalThis : window);
