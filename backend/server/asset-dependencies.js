// Read dependencies from the exact database snapshot, never from an older cache.
export function assetDependencyIds(db) {
  const ids = new Set(db.prepare('SELECT DISTINCT asset_id FROM asset_references').all().map(row => row.asset_id));
  for (const row of db.prepare('SELECT avatar_asset_id FROM user_accounts WHERE avatar_asset_id IS NOT NULL').all()) ids.add(row.avatar_asset_id);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const [table, column] of [['boards','state_json'],['independent_notebooks','document_json'],['state_v2_archives','state_json'],['state_v3_archives','state_json'],['state_v4_archives','state_json'],['connector_migration_archives','state_json']]) {
    if (!tables.has(table)) continue;
    for (const row of db.prepare(`SELECT ${column} AS document FROM ${table}`).all()) {
      // Validate before publishing a backup; an unreadable document must fail closed.
      JSON.parse(row.document);
      for (const match of row.document.matchAll(/\/assets\/([a-f0-9]{64})\.(?:png|jpg|webp)/g)) ids.add(match[1]);
    }
  }
  return ids;
}
