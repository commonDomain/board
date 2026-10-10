import { applyOperation, createPlan, fail, id, planIndex, sameHost } from './model.js';

const scopeNow = () => window.MuseAccount?.session?.user?.id || 'guest';
let database;
function db() {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('muse-planning', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
    request.onsuccess = () => { request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database=null;reject(new Error('请关闭旧窗口后重试规划保存')); };
  });
  return database;
}
async function local(scope, action, mode = 'readwrite') {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('records', mode), records = tx.objectStore('records'); let result, failure;
    try { result = action(records, `${scope}:`, tx); } catch (error) { failure = error; tx.abort(); }
    tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('本地规划保存失败，当前输入仍保留'));
  });
}
const readLocal = scope => local(scope, (records, prefix) => {
  const plans = records.getAll(IDBKeyRange.bound(`${prefix}plan:`, `${prefix}plan:\uffff`)), drafts = records.getAll(IDBKeyRange.bound(`${prefix}draft:`, `${prefix}draft:\uffff`)), inputs=records.getAll(IDBKeyRange.bound(`${prefix}input:`,`${prefix}input:\uffff`));
  return () => [...plans.result, ...drafts.result,...inputs.result];
}, 'readonly');
async function maintainGuest(scope){
  const rows=await local(scope,(records,prefix)=>{const request=records.getAll(IDBKeyRange.bound(prefix,`${prefix}\uffff`));return ()=>request.result;},'readonly'),updates=[],original=new Map(rows.map(row=>[row.key,JSON.stringify(row)]));
  for(const row of rows){
    if(row.signature&&!row.signature.startsWith('sha256:')){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.signature));row.signature=`sha256:${[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')}`;updates.push(row);}
    if(row.plan){const plan=row.plan,now=Date.now();let changed=false;for(const record of plan.deletedTasks||[])if(now-record.deletedAt>30*86400000&&(record.snapshot||record.title!=='已清理的任务')){delete record.snapshot;record.title='已清理的任务';record.status='todo';changed=true;}
      if(plan.deleted&&!plan.purged&&now-plan.deletedAt>30*86400000){Object.assign(plan,{tasks:[],deletedTasks:[],milestones:[],reviews:[],name:'已永久清理的规划',goal:'',criteria:'',unit:'',current:null,target:null,purged:true});changed=true;}
      if(changed){plan.revision++;plan.updatedAt=now;updates.push(row);}
    }
  }
  if(updates.length)await local(scope,records=>updates.forEach(row=>{const request=records.get(row.key);request.onsuccess=()=>{if(JSON.stringify(request.result)===original.get(row.key))records.put(row);};}));
}
export const exportPlanningScope=async(scope,predicate)=> (await readLocal(scope)).filter(record=>record.plan&&predicate(record.plan)).map(record=>record.plan);
export class PlanningStore {
  constructor(notify) {
    this.scope = scopeNow(); this.guest = this.scope === 'guest'; this.notify = notify;
    this.plans = new Map(); this.drafts = new Map(); this.members = [{ id: this.scope, username: this.guest ? '我' : window.MuseAccount?.session?.user?.username || '我' }];
    this.inputs=new Map();this.tails=new Map();this.issues=[];this.remoteVersions={};
    this.loadingPlans=new Map();
    this.downloads=0;this.downloadQueue=[];this.visibilityGeneration=0;
    this.clientId = id('planning'); this.controller = new AbortController(); this.cloud = false; this.disposed = false; this.mutationEpoch = 0;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`muse-planning:${this.scope}`) : null;
    if (this.channel) this.channel.onmessage = () => this.refresh().catch(() => {});
  }
  active() { return !this.disposed && this.scope === scopeNow(); }
  dispose() { this.disposed = true; this.controller.abort(); this.channel?.close(); this.plans.clear(); this.drafts.clear();this.inputs.clear(); }
  async saveInput(key,input) { if(!this.active())return;this.inputs.set(key,input);try{await local(this.scope,(records,prefix)=>records.put({key:`${prefix}input:${key}`,input,inputId:key}));}catch(error){this.cacheError=error.name==='QuotaExceededError'?'此设备存储空间不足，输入暂存于当前窗口':error.message;this.notify();} }
  async clearInput(key) { this.inputs.delete(key);try{await local(this.scope,(records,prefix)=>records.delete(`${prefix}input:${key}`));}catch(error){this.cacheError=`修改已提交，此设备输入记录尚未清理：${error.message}`;this.notify();} }
  async importPlans(plans,clientId) {
    if(!this.active())throw new Error('账号已切换');
    let imported=plans;
    if(!this.guest) imported=(await this.api('/import',{plans,clientId:clientId||this.clientId})).plans;
    await local(this.scope,(records,prefix)=>{for(const plan of imported)records.put({key:`${prefix}plan:${plan.id}`,plan});});
    for(const plan of imported)this.plans.set(plan.id,plan);this.channel?.postMessage({changed:true});this.notify();return imported;
  }
  async loadPlan(planId,force=false) {
    const current=this.plans.get(planId);if(!current||this.guest||!force&&!current.partial)return current;
    if(this.loadingPlans.has(planId))return this.loadingPlans.get(planId);
    const generation=this.visibilityGeneration;
    const work=(async()=>{await new Promise(resolve=>{if(this.downloads<4){this.downloads++;resolve();}else this.downloadQueue.push(resolve);});try{const data=await this.api(`/${planId}`);if(!this.active()||generation!==this.visibilityGeneration&&!Object.hasOwn(this.remoteVersions,planId))return;const previous=this.plans.get(planId);if(previous&&previous.revision>data.plan.revision||this.remoteVersions[planId]>data.plan.revision)return previous;this.plans.set(planId,data.plan);this.remoteVersions[planId]=data.plan.revision;try{await local(this.scope,(records,prefix)=>records.put({key:`${prefix}plan:${planId}`,plan:data.plan}));}catch(error){this.cacheError=`服务器内容已载入，此设备缓存失败：${error.message}`;}this.notify();return data.plan;}catch(error){if([403,404].includes(error.statusCode)){this.plans.delete(planId);delete this.remoteVersions[planId];this.visibilityGeneration++;try{await local(this.scope,(records,prefix)=>records.delete(`${prefix}plan:${planId}`));}catch(cacheError){this.cacheError=cacheError.message;}this.notify();}throw error;}finally{if(this.downloadQueue.length)this.downloadQueue.shift()();else this.downloads--;}})();
    this.loadingPlans.set(planId,work);try{return await work;}finally{this.loadingPlans.delete(planId);}
  }
  async api(path, body) {
    if (!this.active()) throw new DOMException('账号已切换', 'AbortError');
    const timeout = AbortSignal.timeout(15000), response = await fetch(`/api/plans${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.any([timeout, this.controller.signal]), headers: { 'content-type': 'application/json', 'x-csrf-token': window.MuseAccount?.csrfToken?.() || '' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!this.active()) throw new DOMException('账号已切换', 'AbortError');
    const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || '规划保存失败'), { statusCode: response.status, code: data.code });
    return data;
  }
  async load() {
    if(this.guest)await maintainGuest(this.scope);
    const records = await readLocal(this.scope);
    if (!this.active()) return;
    for (const record of records) { if (record.plan) this.plans.set(record.plan.id, record.plan); if (record.draft) this.drafts.set(record.draft.opId, record.draft);if(record.input)this.inputs.set(record.inputId,record.input); }
    await this.refresh();
  }
  async refresh(options={}) {
    if (!this.active()) return;
    if (this.refreshing) { this.refreshQueued = true; return; }
    this.refreshing = true;
    const epoch = this.mutationEpoch;
    try {
      if (this.guest) {
        const records = await readLocal(this.scope);
        if (!this.active()) return;
        if(epoch!==this.mutationEpoch){this.refreshQueued=true;return;}
        this.plans = new Map(records.filter(r => r.plan).map(r => [r.plan.id, r.plan]));
        this.drafts = new Map(records.filter(r => r.draft).map(r => [r.draft.opId, r.draft]));
      } else {
        const delta=options.incremental&&Object.keys(this.remoteVersions).length&&Date.now()-(this.reconciledAt||0)<60000;
        const suffix=delta?`&versions=${encodeURIComponent(JSON.stringify(this.remoteVersions))}`:'';
        let data;
        for(let attempt=0;attempt<3;attempt++){
          data=await this.api(`?limit=50&summary=1${suffix}`);let cursor=data.nextCursor,consistent=true;
          while(cursor){const page=await this.api(`?limit=50&summary=1&cursor=${encodeURIComponent(cursor)}${suffix}`);if(page.directoryToken!==data.directoryToken){consistent=false;break;}data.plans.push(...page.plans);data.issues?.push(...page.issues||[]);cursor=page.nextCursor;}
          if(consistent)break;if(attempt===2)throw new Error('规划目录持续更新，当前内容保留，请稍后刷新');
        }
        if (!this.active()) return;
        if (epoch !== this.mutationEpoch) { this.refreshQueued = true; return; }
        this.members = data.members; this.cloud = true;this.issues=data.issues||[];this.remoteVersions=data.versions||Object.fromEntries(data.plans.map(p=>[p.id,p.revision]));this.visibilityGeneration++;if(!delta)this.reconciledAt=Date.now();
        const previous=[...this.plans.keys()],next=new Map(data.incremental?this.plans:[]),protectedIds=new Set(this.issues.map(issue=>issue.id)),changed=[],reload=[];
        for(const key of protectedIds)if(this.plans.has(key))next.set(key,this.plans.get(key));
        for(const plan of data.plans){const old=this.plans.get(plan.id);if(plan.partial&&old&&!old.partial&&old.revision===plan.revision){next.set(plan.id,old);if(!delta)reload.push(plan.id);continue;}if(plan.partial&&old&&!old.partial)reload.push(plan.id);if(!old||JSON.stringify([old.revision,old.tasks.map(t=>[t.id,t.linked,t.linkState,t.sources])])!==JSON.stringify([plan.revision,plan.tasks.map(t=>[t.id,t.linked,t.linkState,t.sources])]))changed.push(plan);next.set(plan.id,plan);}
        if(data.incremental)for(const key of previous)if(!Object.hasOwn(this.remoteVersions,key))next.delete(key);
        this.plans=next;
        try{await local(this.scope, (store, prefix) => {
          for (const key of previous) if (!this.plans.has(key)) store.delete(`${prefix}plan:${key}`);
          for (const plan of changed) store.put({ key: `${prefix}plan:${plan.id}`, plan });
        });}catch(error){this.cacheError=`服务器内容已载入，此设备缓存失败：${error.message}`;}
        for(const id of reload)this.loadPlan(id,true).catch(()=>{});
      }
    } catch (error) {
      this.cloud = false;this.lastError=error.message;
      if ([401, 403].includes(error.statusCode)) {
        this.plans.clear();this.remoteVersions={};this.visibilityGeneration++; this.notify();
        const records = await readLocal(this.scope);
        await local(this.scope, recordsStore => { for (const record of records) if (record.plan) recordsStore.delete(record.key); });
        throw error;
      }
      if (this.guest) throw error;
    } finally {
      this.refreshing = false;
      if (this.active()) { this.notify(); if (this.refreshQueued) { this.refreshQueued = false; setTimeout(() => this.refresh().catch(() => {}), 0); } }
    }
  }
  task(ref) { const plan = ref && this.plans.get(ref.planId);if(plan?.partial)this.loadPlan(plan.id).catch(()=>{});return plan && !plan.archived && !plan.deleted ? planIndex(plan).byId.get(ref.taskId) : null; }
  async create(host, name, clientId, planId = id('plan')) {
    const pending = [...this.drafts.values()].find(draft => draft.planId === planId && draft.plan);
    return this.commit(pending || { opId: id('op'), clientId: clientId || this.clientId, planId, plan: { id: planId, host, name } });
  }
  async operate(planId, operation, clientId, capturedValues=null) {
    const pending = [...this.drafts.values()].find(draft => draft.planId === planId && JSON.stringify(draft.operation) === JSON.stringify(operation));
    const plan=this.plans.get(planId),entity=plan&&operation.type==='task.update'?planIndex(plan).byId.get(operation.id):operation.type==='plan.update'?plan:null;
    const baseValues=capturedValues||(entity&&operation.baseRevision===entity.revision?Object.fromEntries(Object.keys(operation.patch||{}).map(key=>[key,structuredClone(entity[key]??null)])):null);
    return this.commit(pending || { opId: id('op'), clientId: clientId || this.clientId, planId, operation,baseValues });
  }
  async rebaseDraft(draft) {
    const patch=draft.operation?.patch;if(!draft.baseValues||!patch||!['task.update','plan.update'].includes(draft.operation.type)||Object.keys(patch).some(key=>['sources','linked','host','archived','order','parentTaskId','dependsOn'].includes(key)))return false;
    let latest;if(this.guest)latest=(await readLocal(this.scope)).find(r=>r.plan?.id===draft.planId)?.plan;else latest=(await this.api(`/${draft.planId}`)).plan;
    if(!latest)return false;const entity=draft.operation.type==='task.update'?latest.tasks.find(t=>t.id===draft.operation.id):latest;
    if(!entity||Object.entries(patch).some(([key,value])=>JSON.stringify(entity[key]??null)!==JSON.stringify(draft.baseValues[key])&&JSON.stringify(entity[key]??null)!==JSON.stringify(value)))return false;
    draft.operation={...draft.operation,baseRevision:entity.revision};delete draft.error;this.plans.set(latest.id,latest);return true;
  }
  async commit(draft) {
    const previous=this.tails.get(draft.planId)||Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{try{return await this.commitNow(draft);}catch(error){if(error.code==='PLAN_CONFLICT'&&await this.rebaseDraft(draft))return this.commitNow(draft);throw error;}});this.tails.set(draft.planId,work);
    try{return await work;}finally{if(this.tails.get(draft.planId)===work)this.tails.delete(draft.planId);}
  }
  async commitNow(draft) {
    if (!this.active()) throw new DOMException('账号已切换', 'AbortError');
    this.drafts.set(draft.opId, draft); this.notify();
    try{await local(this.scope, (store, prefix) => store.put({ key: `${prefix}draft:${draft.opId}`, draft }));}catch(error){draft.error=error.name==='QuotaExceededError'?'此设备存储空间不足，输入仍保留在当前窗口':error.message;this.notify();throw new Error(draft.error);}
    let plan;
    if (this.guest) {
      let result, problem;
      const rawSignature=JSON.stringify(draft.plan||draft.operation),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawSignature));
      const signature=`sha256:${[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')}`;
      await local(this.scope, (records, prefix, tx) => {
        const request = records.get(`${prefix}plan:${draft.planId}`);
        request.onsuccess = () => {
          const receipt = records.get(`${prefix}receipt:${draft.opId}`);
          receipt.onsuccess = () => {
          try {
            if (receipt.result) { if (![signature,rawSignature].includes(receipt.result.signature) || receipt.result.planId !== draft.planId) throw fail('操作标识已用于其他请求', 409); result = request.result?.plan; if (!result) throw fail('规划不存在', 404);if(receipt.result.signature!==signature)records.put({...receipt.result,signature});return; }
            if (draft.plan) { if (request.result) throw fail('规划已存在', 409); result = createPlan(draft.plan, 'guest'); }
            else { if (!request.result) throw fail('规划不存在', 404); result = applyOperation(request.result.plan, draft.operation, ['guest']); }
            records.put({ key: `${prefix}plan:${result.id}`, plan: result });
            records.put({ key: `${prefix}receipt:${draft.opId}`, planId: draft.planId, signature });
          } catch (error) { problem = error; tx.abort(); }
          };
        };
        return () => result;
      }).catch(error => { throw problem || error; });
      plan = result;
    } else {
      try { const response = await this.api(draft.plan ? '' : `/${draft.planId}/operations`, draft); plan = response.plan; }
      catch (error) { draft.error = error.message; this.notify(); throw error; }
    }
    if (!this.active()) throw new DOMException('账号已切换', 'AbortError');
    this.mutationEpoch++;
    this.plans.set(plan.id,plan);this.cloud=!this.guest;this.remoteVersions[plan.id]=plan.revision;
    // Keep the batch recoverable until its brain/source document is durable.
    const completed = draft.operation?.type === 'task.decompose' ? [] : [draft.opId];
    if (draft.operation?.type === 'task.create') for (const pending of this.drafts.values()) if (pending.planId === draft.planId && pending.operation?.type === 'task.create' && pending.operation.id === draft.operation.id) completed.push(pending.opId);
    if (draft.operation?.type === 'task.delete') for (const pending of this.drafts.values()) if (pending.planId === draft.planId && pending.operation?.type?.startsWith('task.') && pending.operation.id === draft.operation.id) completed.push(pending.opId);
    try{await local(this.scope, (records, prefix) => { if (!this.guest) records.put({ key: `${prefix}plan:${plan.id}`, plan }); for (const opId of completed) records.delete(`${prefix}draft:${opId}`); });this.cacheError='';}catch(error){this.cacheError=`已保存到服务器，此设备缓存失败：${error.message}`;draft.serverConfirmed=true;this.notify();return plan;}
    if (!this.active()) throw new DOMException('账号已切换', 'AbortError');
    this.plans.set(plan.id, plan); for (const opId of completed) this.drafts.delete(opId); this.channel?.postMessage({ changed: true }); this.notify();
    return plan;
  }
  async discard(opId) { await local(this.scope, (records, prefix) => records.delete(`${prefix}draft:${opId}`)); this.drafts.delete(opId); this.notify(); }
  async detachSources(exists, references = []) {
    if (!this.guest || !this.active() || this.detaching) return;
    this.detaching = true;
    try {
      for (const plan of this.plans.values()) for (const task of plan.tasks) {
        const ref={planId:plan.id,taskId:task.id},sources=task.sources.filter(source=>exists(source,ref)!==false),retained=sources.length;
        for(const value of references)if(value.taskRef.planId===plan.id&&value.taskRef.taskId===task.id&&sources.length<100&&!sources.some(source=>sameHost(source,value.source)&&source.entityId===value.source.entityId&&source.nodeId===value.source.nodeId))sources.push(value.source);
        const states=sources.map(source=>exists(source,ref)),linked=sources.length>0&&!states.includes('pending')&&(task.linked||sources.length>retained&&states.every(state=>state===true));
        if (JSON.stringify(sources)!==JSON.stringify(task.sources)||task.linked!==linked) await this.operate(plan.id, { type: 'task.update', id: task.id, baseRevision: task.revision, patch: { sources, linked } });
      }
    } finally { this.detaching = false; }
  }
  async archiveHost(host) {
    if (!this.guest) { await this.refresh(); return; }
    for (const plan of this.plans.values()) if (!plan.archived && plan.host.kind === host.kind && (host.kind === 'canvas' ? plan.host.boardId === host.boardId : plan.host.notebookId === host.notebookId && (!host.pageId || plan.host.pageId === host.pageId))) await this.operate(plan.id, { type: 'plan.update', baseRevision: plan.revision, patch: { archived: true } });
  }
}
