import { canReadSharedNotebookAsset } from './notebook-sharing.js';

// Keep canvas writes and image reads on the same notebook/page permissions.
export function canReadNotebookAsset(db, userId, assetId) {
  return Boolean(db.prepare(`SELECT 1 FROM asset_references r JOIN independent_notebooks n ON n.id = r.owner_id
    WHERE r.owner_type = 'notebook' AND r.asset_id = ? AND n.owner_user_id = ?`).get(assetId, userId)) || canReadSharedNotebookAsset(db, userId, assetId);
}
