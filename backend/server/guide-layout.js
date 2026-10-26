import crypto from 'node:crypto';
import { migrateGuideLayout } from '../../public/app/guide-layout-model.js';
import { stampMutationVersions } from '../../public/app/mutation-versions-model.js';
import { normalizeStoredState } from './document-validation.js';
import { servicesRuntime } from './runtime/services.js';
import { rebuildDerivedIndexes } from './search-index.js';

// Run before clients connect. Each changed guide gets a normal revision and
// canonical operation so cached/offline clients cannot miss the upgrade.
function migrateStoredGuideLayouts() {
  const database = servicesRuntime.database;
  const rows = database.prepare(`SELECT b.id, b.revision, b.state_json FROM boards b
    JOIN guide_canvases g ON g.board_id = b.id`).all();
  for (const row of rows) {
    const raw = JSON.parse(row.state_json);
    // A guide customized with uncheckpointed worksheet deltas is not pristine.
    if (Number(raw.revision) !== Number(row.revision)) continue;
    const previous = normalizeStoredState(raw, row.id, Number(row.revision));
    const next = structuredClone(previous), changed = migrateGuideLayout(next);
    if (!changed.length) continue;
    const op = { kind: 'batch', ops: changed.map(id => ({ kind: 'upsert', item: next.items.find(item => item.id === id) })) };
    stampMutationVersions(previous, next, op);
    next.revision = previous.revision + 1;
    next.updatedAt = Date.now();
    const opId = `guide-layout_${crypto.randomUUID()}`, serialized = JSON.stringify(op);
    database.exec('BEGIN IMMEDIATE');
    try {
      const updated = database.prepare('UPDATE boards SET revision = ?, state_json = ?, updated_at = ? WHERE id = ? AND revision = ?')
        .run(next.revision, JSON.stringify(next), next.updatedAt, row.id, previous.revision);
      if (Number(updated.changes) !== 1) throw new Error(`Guide revision changed for ${row.id}`);
      database.prepare('INSERT INTO operations (board_id, op_id, revision, canonical_op, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.id, opId, next.revision, serialized, 'system', next.updatedAt);
      database.prepare('INSERT INTO operation_receipts (board_id, op_id, revision, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, opId, next.revision, 'system', next.updatedAt);
      database.prepare('UPDATE canvas_catalog SET preview_style_version = 0 WHERE board_id = ?').run(row.id);
      rebuildDerivedIndexes(row.id, next);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export { migrateStoredGuideLayouts };
