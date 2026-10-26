// One-way retirement of the old canvas-backed notebook view. Canvas objects stay intact.
export function retireCanvasNotebooks(db) {
  const marker = 'independent-notes-cleanup-v2';
  if (db.prepare('SELECT 1 FROM runtime_state WHERE key = ?').get(marker)) return 0;
  let changed = 0;
  // Archive exact original rows in the same transaction before retiring metadata.
  db.exec(`CREATE TABLE IF NOT EXISTS legacy_notebook_recovery (
    source_table TEXT NOT NULL, source_row INTEGER NOT NULL, payload TEXT NOT NULL,
    archived_at INTEGER NOT NULL, PRIMARY KEY(source_table,source_row)
  ) STRICT`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['boards', 'state_v2_archives', 'state_v3_archives', 'state_v4_archives', 'connector_migration_archives']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
      db.prepare(`INSERT OR IGNORE INTO legacy_notebook_recovery SELECT ?, rowid, state_json, ? FROM ${table} WHERE json_valid(state_json) AND json_type(state_json, '$.notebook') IS NOT NULL`).run(table, Date.now());
      const result = db.prepare(`UPDATE ${table} SET state_json = json_remove(state_json, '$.notebook') WHERE json_valid(state_json) AND json_type(state_json, '$.notebook') IS NOT NULL`).run();
      changed += Number(result.changes);
    }
    const retire = op => {
      if (!op || /^(note-(upsert|reorder|place|delete|unlink|delete-content)|canvas-place)$/.test(op.kind)) return null;
      delete op.notebook;
      if (op.kind === 'batch') { op.ops = (op.ops || []).map(retire).filter(Boolean); if (!op.ops.length) return null; }
      return op;
    };
    for (const row of db.prepare('SELECT rowid, canonical_op FROM operations').iterate()) {
      const op = retire(JSON.parse(row.canonical_op));
      if (!op || JSON.stringify(op) !== row.canonical_op) db.prepare('INSERT OR IGNORE INTO legacy_notebook_recovery VALUES(?,?,?,?)').run('operations', row.rowid, row.canonical_op, Date.now());
      if (op) {
        const json = JSON.stringify(op);
        if (json !== row.canonical_op) db.prepare('UPDATE operations SET canonical_op = ? WHERE rowid = ?').run(json, row.rowid);
      } else {
        // Receipts contain only acknowledgement IDs, never note content; retain them for retry deduplication.
        db.prepare('DELETE FROM operations WHERE rowid = ?').run(row.rowid);
      }
    }
    db.prepare("DELETE FROM search_index WHERE document_id LIKE 'note:%'").run();
    db.prepare("DELETE FROM search_documents WHERE document_id LIKE 'note:%'").run();
    db.prepare('INSERT INTO runtime_state(key, value, updated_at) VALUES(?, ?, ?)').run(marker, 'complete', Date.now());
    db.exec('COMMIT'); return changed;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
