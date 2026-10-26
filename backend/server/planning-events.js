import { clients } from './board-registry.js';
import { sendWs } from './websocket-transport.js';
import { servicesRuntime } from './runtime/services.js';

// Invalidate caches without broadcasting plan identities or private content.
export function invalidatePlanning(plan = null) {
  if(!plan)return;
  const account = servicesRuntime.accountService;
  for (const client of clients) {
    if (!client.userId || !account) continue;
    // General changes are already delivered through sharing/catalog events.
    // A plan-specific invalidation goes only to its owner and authorized readers.
    let allowed = plan?.ownerId === client.userId;
    if (!allowed && plan && !plan.archived && !plan.deleted) {
      if (plan.host.kind === 'canvas') allowed = account.canAccessBoard(client.userId,plan.host.boardId);
      else {
        const db=servicesRuntime.database, row=db.prepare('SELECT owner_user_id,deleted FROM independent_notebooks WHERE id=?').get(plan.host.notebookId);
        const group=account.sharingEnabled && account.groupForUser(client.userId)?.id;
        allowed=Boolean(row && !row.deleted && group && account.groupForUser(row.owner_user_id)?.id===group && db.prepare('SELECT 1 FROM notebook_page_shares WHERE notebook_id=? AND page_id=? AND group_id=?').get(plan.host.notebookId,plan.host.pageId,group));
      }
    }
    if (allowed) sendWs(client, { type: 'planning-changed', planId:plan.id, revision:plan.revision });
  }
}

export function invalidatePlanningAccess(ownerId){
  const account=servicesRuntime.accountService,group=account?.sharingEnabled&&account.groupForUser(ownerId)?.id;
  for(const client of clients)if(client.userId&&(client.userId===ownerId||group&&account.groupForUser(client.userId)?.id===group))sendWs(client,{type:'planning-access-changed'});
}

export function invalidateNotebookPlanning(notebookId){
  for(const row of servicesRuntime.database.prepare("SELECT document_json FROM planning_documents WHERE host_kind='notebook' AND host_id=?").all(notebookId)){
    try{invalidatePlanning(JSON.parse(row.document_json));}catch{ /* A damaged document must not interrupt the notebook save. */ }
  }
}
