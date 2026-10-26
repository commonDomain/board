import { createHash } from 'node:crypto';
export function ensurePlanningSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS planning_documents (
    id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, host_kind TEXT NOT NULL,
    host_id TEXT NOT NULL, page_id TEXT, revision INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, document_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS planning_host ON planning_documents(host_kind, host_id, page_id);
  CREATE INDEX IF NOT EXISTS planning_owner_updated ON planning_documents(owner_user_id,updated_at,id);
  CREATE TABLE IF NOT EXISTS planning_operations (
    plan_id TEXT NOT NULL, actor_id TEXT NOT NULL, op_id TEXT NOT NULL,
    request_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(plan_id, actor_id, op_id),
    FOREIGN KEY(plan_id) REFERENCES planning_documents(id) ON DELETE CASCADE
  ) STRICT;`);
  // Keep durable idempotency receipts without retaining task bodies indefinitely.
  const update = db.prepare('UPDATE planning_operations SET request_json=? WHERE plan_id=? AND actor_id=? AND op_id=?');
  for (const row of db.prepare("SELECT plan_id,actor_id,op_id,request_json FROM planning_operations WHERE request_json NOT LIKE 'sha256:%'").all()) update.run(`sha256:${createHash('sha256').update(row.request_json).digest('hex')}`,row.plan_id,row.actor_id,row.op_id);
}
export function archiveHostPlans(db, kind, hostId, pageId = null) {
  const rows = db.prepare('SELECT * FROM planning_documents WHERE host_kind=? AND host_id=? AND archived=0').all(kind, hostId);
  for (const row of rows) {
    if (pageId && row.page_id !== pageId) continue;
    let plan; try { plan = JSON.parse(row.document_json); } catch { continue; } plan.archived = true; plan.revision++; plan.updatedAt = Date.now();
    db.prepare('UPDATE planning_documents SET archived=1,revision=?,document_json=?,updated_at=? WHERE id=?').run(plan.revision, JSON.stringify(plan), plan.updatedAt, plan.id);
  }
}
const lastPrune=new WeakMap();
export function prunePlanningSnapshots(db,now=Date.now()) {
  if(now-(lastPrune.get(db)||0)<86400000)return;
  const update=db.prepare('UPDATE planning_documents SET revision=?,document_json=?,updated_at=? WHERE id=?');
  for(const row of db.prepare("SELECT id,document_json FROM planning_documents WHERE document_json LIKE '%\"deletedTasks\"%' OR document_json LIKE '%\"deletedAt\"%'").all()){
    let plan;try{plan=JSON.parse(row.document_json);}catch{continue;}let changed=false;
    for(const record of plan.deletedTasks||[])if(now-record.deletedAt>30*86400000&&(record.snapshot||record.title!=='已清理的任务')){delete record.snapshot;record.title='已清理的任务';changed=true;}
    if(plan.deleted&&!plan.purged&&now-plan.deletedAt>30*86400000){plan.tasks=[];plan.deletedTasks=[];plan.milestones=[];plan.reviews=[];plan.name='已永久清理的规划';plan.goal='';plan.criteria='';plan.unit='';plan.current=null;plan.target=null;plan.purged=true;changed=true;}
    if(changed){plan.revision++;plan.updatedAt=now;update.run(plan.revision,JSON.stringify(plan),now,plan.id);}
  }
  lastPrune.set(db,now);
}
