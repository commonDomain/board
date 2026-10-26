import { brainChanges, reconcileBrainSources } from '../../frontend/planning/sources.js';
import { planningHostAccess } from './planning.js';

// Called inside the authoritative source save transaction, never on a failed save.
export function reconcileSavedBrains(db, host, before, after, actorId) {
  const changes = brainChanges(host, before, after), updated = [];
  if (!changes.removed.size && !changes.removedEntities.size && !changes.restored.length) return updated;
  const save = db.prepare('UPDATE planning_documents SET revision=?,document_json=?,updated_at=? WHERE id=?');
  const hostId = host.boardId || host.notebookId;
  for (const row of db.prepare('SELECT document_json FROM planning_documents WHERE host_id=? OR instr(document_json,?)>0').all(hostId, JSON.stringify(hostId))) {
    let plan; try { plan = JSON.parse(row.document_json); } catch { continue; }
    let restore = false;
    try { restore = !plan.deleted && (plan.ownerId === actorId || !plan.archived && Boolean(planningHostAccess(db, plan.host, actorId))); } catch { /* Cleanup is safe; restoration requires access to the task's host. */ }
    const next = reconcileBrainSources(plan, changes, restore);
    if (next) { save.run(next.revision, JSON.stringify(next), next.updatedAt, next.id); updated.push(next); }
  }
  return updated;
}
