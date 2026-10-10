import { clone, uid } from './model.js';
import { notebookPatch, mergeNotebookDraft } from './concurrency.js';

const aborted = () => new DOMException('笔记操作已取消', 'AbortError');
const accountId = () => window.MuseAccount?.session?.user?.id || 'guest';
export async function request(path, body, method = body ? 'POST' : 'GET', options = {}) {
  const scope = options.scope || accountId();
  if (options.signal?.aborted || scope !== accountId()) throw aborted();
  const controller = new AbortController(); const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, options.timeout || 20000);
  try {
    const response = await fetch(`/api/notebooks${path}`, { method, signal: controller.signal, cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-notebook-owner': scope, 'x-csrf-token': window.MuseAccount?.csrfToken?.() || '' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (options.signal?.aborted || scope !== accountId()) throw aborted();
    let data; try { data = await response.json(); } catch { throw new Error('服务器响应无法读取，请重试'); }
    if (options.signal?.aborted || scope !== accountId()) throw aborted();
    if (response.status === 401 && scope === accountId()) window.MuseAccount?.expireSession?.();
    if (!response.ok) {
      const transportInterrupted = ['API_ENCRYPTION_REPLAYED','API_ENCRYPTION_SESSION_EXPIRED'].includes(data.code);
      // A browser may resend a packet after losing its response. Keep nonce
      // protection intact, then replay the notebook opId in a freshly encrypted
      // request instead of treating the transport's HTTP 409 as an edit conflict.
      throw Object.assign(new Error(transportInterrupted ? '网络确认中断，正在重新确认保存结果' : data.error || '笔记请求失败'), { status: transportInterrupted ? 408 : response.status, code: data.code });
    }
    return data;
  } catch (error) { if (controller.signal.aborted && !options.signal?.aborted && scope === accountId()) throw Object.assign(new Error('请求超时，请检查网络后重试'), {status:408}); throw error; } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
const volatileDrafts = new Map();
export function draftWriterActive(draft,scope,held,saved={}){
  if(draft.liveClient&&held)return held.has(`muse-note-client:${scope}:${draft.writer}`);
  return saved.leaseClient===draft.writer||Boolean(saved.pageLeases?.some(lease=>lease.clientId===draft.writer&&(!lease.userId||lease.userId===scope)));
}
let dbPromise;
function database() {
  dbPromise ||= new Promise((resolve, reject) => {
    const open = indexedDB.open('muse-independent-notes', 2);
    open.onupgradeneeded = () => { for (const name of ['records', 'books']) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name); };
    open.onblocked = () => reject(new Error('请关闭旧版笔记窗口后重试'));
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; db.onversionchange = () => { db.close(); dbPromise = null; }; resolve(db); };
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
async function transaction(name, action, mode = 'readwrite') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode); let result; let failure;
    tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('本地存储事务中止'));
    try { result = action(tx.objectStore(name), error => { failure = error; tx.abort(); }); }
    catch (error) { failure = error; tx.abort(); }
  });
}
export function localRecord(key, value) {
  return transaction('records', store => { const op = value === undefined ? store.get(key) : store.put(clone(value), key); return () => op.result; }, value === undefined ? 'readonly' : 'readwrite');
}
export function localBook(scope, id) { return transaction('books', store => { const op = store.get(`${scope}:${id}`); return () => op.result; }, 'readonly'); }
export async function clearLocalScope(scope) {
  volatileDrafts.delete(scope);
  await transaction('books', store => store.delete(IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`)));
  await transaction('records', store => store.delete(IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`)));
}
export async function localBooks(scope) {
  const migrated = await localRecord(`${scope}:migrated-v2`);
  const legacy = migrated ? null : await localRecord(`${scope}:library`);
  if (legacy) {
    await transaction('books', store => {
      for (const book of legacy.books || []) {
        const key = `${scope}:${book.id}`; const get = store.get(key);
        get.onsuccess = () => { if (!get.result) store.put({ book, version: 1, dirty: legacy.dirty?.includes(book.id), pending: new Map(legacy.pending || []).get(book.id) }, key); };
      }
    });
    await localRecord(`${scope}:migrated-v2`, true);
  }
  return transaction('books', store => { const op = store.getAll(IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`)); return () => op.result; }, 'readonly');
}
export class NotebookStore {
  constructor(scope, guest, notify) {
    this.scope = scope; this.guest = guest; this.notify = notify; this.books = new Map(); this.dirty = new Set(); this.pending = new Map(); this.failures = new Map();
    this.versions = new Map(); this.generations = new Map(); this.durable = new Map(); this.writes = new Map(); this.baselines = new Map(); this.conflicts = new Set(); this.rejected = new Map(); this.remoteMissing = new Set(); this.cloudAvailable = guest;
    this.clientId = uid('client'); this.disposed = false; this.controller = new AbortController(); this.retryDelay = 1000; this.localLeases = new Set(); this.heldLocks = new Map(); this.acquiringLocks = new Map(); this.remoteChanges = new Set();
    this.localSnapshots = new Map(); this.loadingBooks = new Map(); this.remoteLeases = new Map(); this.leaseRequests = new Map();this.recoveredDrafts=new Map();this.leaseTails=new Map();this.releasingLeases=new Set();this.desiredLeases=new Set();
    // A window's outbox remains private while that window is alive, even if offline.
    this.liveClient=false;
    if(typeof navigator!=='undefined'&&navigator.locks) navigator.locks.request(`muse-note-client:${scope}:${this.clientId}`,async()=>{
      if(!this.active())return;
      this.liveClient=true;await new Promise(resolve=>{this.releaseClient=resolve;});this.liveClient=false;
    }).catch(()=>{});
    if (typeof BroadcastChannel !== 'undefined') { this.channel = new BroadcastChannel(`muse-notebooks:${scope}`); this.channel.onmessage = event => { if (!this.disposed && event.data?.writer !== this.clientId && typeof event.data?.id === 'string') this.remoteChanges.add(event.data.id); }; }
  }
  active() { return !this.disposed && accountId() === this.scope; }
  api(path, body, method) { if (!this.active()) return Promise.reject(aborted()); return request(path, body, method, { scope: this.scope, signal: this.controller.signal }); }
  summary() {
    if (this.localUnavailable) return '本地存储不可用 · 请及时导出草稿';
    if (this.conflicts.size) return '编辑冲突 · 请另存副本或载入已保存版本';
    if (this.rejected.size) return '保存被拒绝 · 请修正内容后重试';
    if (this.dirty.size) return [...this.dirty].some(id => this.durable.get(id) !== (this.generations.get(id) || 0)) ? '正在保存草稿…' : '本地草稿已保存 · 等待同步';
    return this.guest ? '已保存到此设备' : this.cloudAvailable ? '已同步到云端' : '离线 · 显示此设备缓存';
  }
  status(message) { if (this.active()) this.notify(message); }
  async load() {
    let drafts=[];
    try {
      for (const record of await localBooks(this.scope)) {
        if(record.draft){drafts.push(record);continue;}
        this.books.set(record.book.id, record.book); this.versions.set(record.book.id, record.version);
        this.localSnapshots.set(record.book.id,clone(record.book));
        if (record.dirty) this.dirty.add(record.book.id); else this.baselines.set(record.book.id, clone(record.book));
        if (record.pending) this.pending.set(record.book.id, record.pending);
      }
    } catch { this.status('本地存储不可用 · 请及时导出草稿'); this.localUnavailable = true; }
    if (!this.guest) {
      try {
        const { notebooks, directoryVersion } = await this.api(''); this.cloudAvailable = true; this.directoryVersion = directoryVersion;
        for (const entry of notebooks) if (!this.dirty.has(entry.id) && (!this.books.has(entry.id) || this.books.get(entry.id).revision < entry.revision || this.books.get(entry.id).access?.version !== entry.access?.version)) this.books.set(entry.id, entry);
        const remote = new Set(notebooks.map(book => book.id));
        for (const [id, book] of this.books) if (book.revision && !remote.has(id) && !this.dirty.has(id)) { this.books.delete(id); await this.removeLocal(id); }
      } catch (error) { this.cloudAvailable = false; this.status('离线草稿 · ' + error.message); }
      // Recover abandoned windows; a live editor's private outbox stays with that editor.
      const recovery=new Map();
      let liveWriters;
      try{if(typeof navigator!=='undefined'&&navigator.locks)liveWriters=new Set((await navigator.locks.query()).held.map(lock=>lock.name));}catch{}
      for(const draft of drafts){
        const id=draft.book.id;
        if(draft.liveClient&&liveWriters&&draftWriterActive(draft,this.scope,liveWriters))continue;
        try{
          if(!recovery.has(id))recovery.set(id,await this.api(`/${id}`));
          const saved=recovery.get(id);
          if(draftWriterActive(draft,this.scope,liveWriters,saved))continue;
          const current=this.dirty.has(id)?this.books.get(id):saved.notebook;
          const recovered=mergeNotebookDraft(draft.base,draft.book,current);
          this.books.set(id,recovered);this.baselines.set(id,clone(saved.notebook));this.dirty.add(id);
          const keys=this.recoveredDrafts.get(id)||[];keys.push(`${this.scope}:${id}:draft:${draft.writer}`);this.recoveredDrafts.set(id,keys);
        }catch{
          // Unreachable server or overlapping edits: keep a separately exportable copy.
          const copy=clone(draft.book),id=uid('book');copy.id=id;copy.revision=0;copy.title=`${copy.title.slice(0,85)}（恢复草稿）`;
          this.books.set(id,copy);this.dirty.add(id);
          this.recoveredDrafts.set(id,[`${this.scope}:${draft.book.id}:draft:${draft.writer}`]);
        }
      }
    }
    for (const book of volatileDrafts.get(this.scope) || []) { this.books.set(book.id,book); this.dirty.add(book.id); this.generations.set(book.id,1); }
    volatileDrafts.delete(this.scope);
    return this.books;
  }
  async getBook(id) {
    const book = this.books.get(id); if (!book?.unloaded) return book;
    if(this.loadingBooks.has(id))return this.loadingBooks.get(id);
    const loading=(async()=>{
      const { notebook } = await this.api(`/${id}`); if (!this.active()) throw aborted();
      this.books.set(id, notebook); this.baselines.set(id, clone(notebook));
      // Cache persistence is independent of displaying an already downloaded note.
      this.persistBook(id).catch(() => { this.localUnavailable = true; }); return notebook;
    })();
    this.loadingBooks.set(id,loading);
    try{return await loading;}finally{this.loadingBooks.delete(id);}
  }
  persistBook(id) {
    const previous = this.writes.get(id) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      const book = this.books.get(id); if (!book || book.unloaded) return;
      const generation = this.generations.get(id) || 0; const version = this.versions.get(id) || 0;
      const record = { book: clone(book), version: version + 1, dirty: this.dirty.has(id), pending: clone(this.pending.get(id)), writer: this.clientId };
      const captured=clone(record.book);let sharedSnapshot,mergedRemote=false;
      await transaction('books', (store, fail) => {
        const key = `${this.scope}:${id}`; const get = store.get(key);
        get.onsuccess = () => {
          const saved=get.result;
          if(!this.guest&&record.dirty){
            store.put({...record,base:clone(this.baselines.get(id)),draft:true,liveClient:this.liveClient},`${this.scope}:${id}:draft:${this.clientId}`);
            record.version=saved?.version||0;sharedSnapshot=saved?.book;return;
          }
          if ((saved?.version || 0) !== version) {
            try { if(this.guest||saved.book.revision>record.book.revision){record.book=mergeNotebookDraft(this.localSnapshots.get(id),record.book,saved.book);mergedRemote=true;} record.version=saved.version+1; }
            catch(error){return fail(error);}
          }
          // Each window keeps its own durable pending request, even when another page saves.
          const draftKey=`${this.scope}:${id}:draft:${this.clientId}`;
          store.delete(draftKey);
          if(!record.dirty)for(const draftKey of this.recoveredDrafts.get(id)||[])store.delete(draftKey);
          store.put(record, key);
          sharedSnapshot=record.book;
        };
      });
      this.versions.set(id, record.version); if(sharedSnapshot)this.localSnapshots.set(id,clone(sharedSnapshot));
      if(this.guest){const current=this.books.get(id);if(current===book&&mergedRemote){
        const merged=generation===(this.generations.get(id)||0)?record.book:mergeNotebookDraft(captured,book,record.book);
        const own=new Map(book.pages.map(page=>[page.id,page]));merged.pages=merged.pages.map(page=>{const existing=own.get(page.id);if(existing){Object.assign(existing,page);return existing;}return page;});
        Object.assign(book,merged);
      }this.baselines.set(id,clone(record.book));}
      this.durable.set(id, generation); this.localUnavailable = false; this.channel?.postMessage({id,writer:this.clientId});
    });
    this.writes.set(id, work); return work;
  }
  persist() { return Promise.all([...this.dirty].map(id => this.persistBook(id))); }
  change(book) {
    if (!this.active() || book.unloaded) return;
    this.rejected.delete(book.id); this.books.set(book.id, book); this.dirty.add(book.id); this.generations.set(book.id, (this.generations.get(book.id) || 0) + 1);
    this.status('正在保存草稿…'); clearTimeout(this.timer); clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => this.persist().catch(error => this.failed(error)), 150);
    this.timer = setTimeout(() => this.flush(), 500);
  }
  failed(error, id) {
    if (id) this.failures.set(id, error.message);
    if ([409, 423].includes(error.status) && id) this.conflicts.add(id);
    if (this.rejected.has(id) && this.durable.get(id) === (this.generations.get(id) || 0)) { this.status(`保存被拒绝 · ${error.message} · 本地草稿仍保留`); return; }
    this.status(error.local || !id || this.durable.get(id) !== (this.generations.get(id) || 0)
      ? '草稿仅在内存 · 请勿关闭页面，请导出备份'
      : [409, 423].includes(error.status) ? '编辑冲突 · 本地草稿已保留，可另存副本' : '云端同步失败 · 本地草稿已保存');
  }
  async flush() {
    if (!this.active()) return;
    if (this.saving) return this.saving;
    this.saving = this.flushQueue();
    try { await this.saving; } finally { this.saving = null; }
  }
  async retry(id) {
    // An unacknowledged operation can be replayed safely: the server checks its
    // receipt before checking versions. A real version conflict still rejects it.
    if (this.conflicts.has(id) && !this.pending.has(id)) throw new Error('此笔记存在冲突，请另存副本或载入已保存版本');
    this.conflicts.delete(id); this.rejected.delete(id);
    await this.flush();
  }
  async flushQueue() {
    let retry = false;
    for (const id of [...this.dirty]) {
      if (!this.active()) return;
      if (this.conflicts.has(id) || this.rejected.has(id)) continue;
      try {
        const book = this.books.get(id); if (!book) continue;
        const generation = this.generations.get(id) || 0;
        if (!this.guest && !this.pending.has(id)) this.pending.set(id, { notebook: clone(book), baseRevision: book.revision, opId: uid('op'), clientId: this.clientId, ownerId: this.scope, pageScoped:true,
          leasePageIds:[...this.localLeases].filter(key=>key.startsWith(id+':')).map(key=>key.slice(id.length+1)) });
        await this.persistBook(id); if (!this.active()) return;
        if (!this.guest) {
          const pending = this.pending.get(id); pending.clientId = this.clientId;
          pending.leasePageIds=[...this.desiredLeases].filter(key=>key.startsWith(id+':')).map(key=>key.slice(id.length+1));
          const baseline = this.baselines.get(id); let payload = pending; let method = 'PUT';
          if (baseline?.revision === pending.baseRevision && pending.baseRevision > 0) {
            payload = { ...pending, notebook: undefined, patch:notebookPatch(baseline,pending.notebook) }; method = 'PATCH';
          }
          const saveStarted=Date.now();const result = await this.api(`/${id}`, payload, method); if (!this.active()) return;
          if (!Number.isInteger(result.revision) || result.revision < pending.baseRevision + 1) throw new Error('保存响应无效，请重试');
          this.cloudAvailable = true;
          if(!result.duplicate)for(const pageId of result.leasedPageIds||((payload.patch?.pages||pending.notebook.pages).map(page=>page.id)))this.remoteLeases.set(this.leaseKey(id,pageId),saveStarted+11000);
          const same = JSON.stringify({ ...book, revision: pending.notebook.revision }) === JSON.stringify(pending.notebook);
          const acknowledged=result.notebook || {...clone(pending.notebook),revision:result.revision};
          if(result.catalogRevision!==undefined)acknowledged.catalogRevision=result.catalogRevision;
          for(const page of acknowledged.pages)if(result.pageRevisions?.[page.id]!==undefined)page.revision=result.pageRevisions[page.id];
          if(result.notebook) {
            const merged=mergeNotebookDraft(pending.notebook,book,acknowledged);
            const own=new Map(book.pages.map(page=>[page.id,page]));
            merged.pages=merged.pages.map(page=>{const existing=own.get(page.id);if(existing){Object.assign(existing,page);return existing;}return page;});
            Object.assign(book,merged);
          } else {
            book.revision=result.revision;book.catalogRevision=acknowledged.catalogRevision;
            for(const page of book.pages)if(result.pageRevisions?.[page.id]!==undefined)page.revision=result.pageRevisions[page.id];
          }
          this.baselines.set(id,clone(acknowledged)); this.pending.delete(id); this.failures.delete(id);
          if (same && generation === (this.generations.get(id) || 0)) this.dirty.delete(id);
        } else if (generation === (this.generations.get(id) || 0)) this.dirty.delete(id);
        try { await this.persistBook(id); } catch (error) { this.dirty.add(id); throw error; }
      } catch (error) {
        if (!this.active()) return;
        if ([400,403,413,422].includes(error.status)) {
          const rejected = this.pending.get(id); this.pending.delete(id);
          if (!rejected || JSON.stringify(this.books.get(id)) === JSON.stringify(rejected.notebook)) this.rejected.set(id,error.message);
          await this.persistBook(id).catch(() => {});
        }
        if (error.status === 404) { this.remoteMissing.add(id); this.conflicts.add(id); }
        if (!error.status || error.status >= 500 || error.status === 408) this.cloudAvailable = false;
        this.failed(error, id);
        if (error.status === 401) { this.controller.abort(); return; }
        if (![400, 403, 404, 409, 413, 423].includes(error.status)) retry = true;
      }
    }
    if (!this.active()) return;
    if (!this.dirty.size) { this.retryDelay = 1000; this.status(this.summary()); }
    else if (retry || [...this.dirty].some(id => !this.conflicts.has(id) && !this.rejected.has(id) && !this.pending.has(id))) {
      clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.retryDelay); this.retryDelay = Math.min(30000, this.retryDelay * 2);
    }
  }
  async refresh(id, canApply = () => true) {
    if (!this.active() || this.dirty.has(id) || this.saving) return null;
    try {
      if (this.guest) {
        const record = await localBook(this.scope,id);
        if (!record && this.versions.has(id)) { this.remoteMissing.add(id); this.conflicts.add(id); return null; }
        if (canApply() && record && record.version > (this.versions.get(id) || 0) && !this.dirty.has(id)) { this.versions.set(id, record.version); this.localSnapshots.set(id,clone(record.book));this.baselines.set(id,clone(record.book));this.books.set(id, record.book); return record.book; }
        return null;
      }
      const response = await this.api(`/${id}?revision=${this.books.get(id)?.revision || 0}&viewVersion=${encodeURIComponent(this.books.get(id)?.access?.version || '')}`);
      this.cloudAvailable = true;
      if (!this.active() || !canApply() || this.dirty.has(id) || response.unchanged) return null;
      this.books.set(id, response.notebook); this.baselines.set(id,clone(response.notebook)); await this.persistBook(id); return this.dirty.has(id) || !canApply() ? null : response.notebook;
    } catch (error) { this.cloudAvailable = false; if (error.status === 404) { this.remoteMissing.add(id); this.conflicts.add(id); } if (error.status === 401) this.status('登录已失效 · 请重新登录'); return null; }
  }
  leaseKey(id,pageId){return pageId?`${id}:${pageId}`:id;}
  leaseValid(id,pageId){const key=this.leaseKey(id,pageId),base=this.baselines.get(id);
    const local=!this.books.get(id)?.access?.received&&(this.guest||!this.books.get(id)?.revision||pageId&&base&&!base.pages.some(page=>page.id===pageId));
    return !this.releasingLeases.has(key)&&(local&&this.heldLocks.has(key)||(this.remoteLeases.get(key)||0)>Date.now());}
  async lease(id, release = false, pageId, renew = false, syncPage = !renew) {
    if (!this.active()) return false;
    const key=this.leaseKey(id,pageId);
    if(release)this.desiredLeases.delete(key);else this.desiredLeases.add(key);
    if(release){this.remoteLeases.delete(key);this.leaseRequests.delete(key);this.heldLocks.get(key)?.();this.heldLocks.delete(key);this.localLeases.delete(key);}
    const baseline=this.baselines.get(id);
    const local=!this.books.get(id)?.access?.received&&(this.guest || !this.books.get(id)?.revision || pageId&&baseline&&!baseline.pages.some(page=>page.id===pageId));
    if(!release&&!renew&&this.leaseValid(id,pageId))return true;
    if(!release&&this.leaseRequests.has(key))return this.leaseRequests.get(key);
    if(release)this.releasingLeases.add(key);
    const previous=this.leaseTails.get(key)||Promise.resolve();
    const work=previous.catch(()=>{}).then(async()=>{
      if(!this.active())return false;
      const started=Date.now();if(release)this.remoteLeases.delete(key);
      try {
        if(local)return await this.localLease(key,release);
        const response=await this.api(`/${id}/lease`, { clientId: this.clientId, release, ...(pageId?{pageId,includePage:syncPage}:{}) });
        if(!this.active())return false;
        if(!release){
          this.remoteLeases.set(key,started+Math.min(response.leaseMs||12000,12000)-1000);
          this.heldLocks.get(key)?.();this.heldLocks.delete(key);this.localLeases.delete(key);
          if(syncPage&&response.page&&!this.dirty.has(id)){
            const book=this.books.get(id),page=book?.pages.find(page=>page.id===pageId);
            if(page){Object.assign(page,response.page);if(!response.page.sharing)delete page.sharing;}
            const base=this.baselines.get(id),before=base?.pages.findIndex(page=>page.id===pageId);
            if(before>=0)base.pages[before]=clone(response.page);
          }
        }
        return release||this.leaseValid(id,pageId);
      } catch { this.remoteLeases.delete(key);return false; }
    }).finally(()=>{if(release)this.releasingLeases.delete(key);});
    this.leaseTails.set(key,work);
    if(!release)this.leaseRequests.set(key,work);
    try{return await work;}finally{if(this.leaseRequests.get(key)===work)this.leaseRequests.delete(key);if(this.leaseTails.get(key)===work)this.leaseTails.delete(key);}
  }
  async localLease(id, release = false) {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      if (release) { this.heldLocks.get(id)?.(); this.heldLocks.delete(id); this.localLeases.delete(id); return true; }
      if (this.heldLocks.has(id)) return true;
      if (this.acquiringLocks.has(id)) return this.acquiringLocks.get(id);
      const bookId=id.split(':')[0],prefix=`muse-note:${this.scope}:`;
      const attempt=navigator.locks.request(`muse-note-gate:${this.scope}:${bookId}`,async()=>{
        const state=await navigator.locks.query();
        const blocked=state.held.some(lock=>{
          if(!lock.name.startsWith(prefix))return false;
          const other=lock.name.slice(prefix.length);
          return !this.heldLocks.has(other)&&(other===id||other===bookId||id===bookId&&other.startsWith(bookId+':'));
        });
        if(blocked||!this.active())return false;
        return new Promise(resolve=>{
          navigator.locks.request(prefix+id,{ifAvailable:true},async lock=>{
            if(!lock||!this.active()){resolve(false);return;}
            let releaseLock;const held=new Promise(done=>{releaseLock=done;});
            this.heldLocks.set(id,releaseLock);this.localLeases.add(id);resolve(true);await held;
          }).catch(()=>resolve(false));
        });
      }).catch(()=>false);
      this.acquiringLocks.set(id,attempt);
      try { return await attempt; } finally { this.acquiringLocks.delete(id); }
    }
    let allowed = false;
    try {
      await transaction('records', store => { const key = `${this.scope}:lease:${id}`,bookId=id.split(':')[0],prefix=`${this.scope}:lease:`;
        const get = store.getAll(IDBKeyRange.bound(prefix+bookId,prefix+bookId+'\uffff')); get.onsuccess = () => {
        const blocked=get.result.some(current=>{
          const other=current.id||bookId;
          return current.client!==this.clientId&&current.until>Date.now()&&(release?other===id:other===id||other===bookId||id===bookId&&other.startsWith(bookId+':'));
        });if(blocked)return;
        allowed = true; if (release) store.delete(key); else store.put({id,client:this.clientId,until:Date.now()+12000},key);
      }; });
      if (allowed && !release) {this.localLeases.add(id);this.remoteLeases.set(id,Date.now()+11000);} if (release) {this.localLeases.delete(id);this.remoteLeases.delete(id);} return allowed;
    } catch { return false; }
  }
  async syncDirectory(currentId) {
    let changed = false;
    if (!this.guest && Date.now() >= (this.nextDirectoryCheck || 0)) {
      this.nextDirectoryCheck = Date.now() + 15000;
      try {
        const response = await this.api(`?directoryVersion=${encodeURIComponent(this.directoryVersion || '')}`);
        if (!this.active()) return false; this.cloudAvailable = true;
        if (!response.unchanged) {
          this.directoryVersion = response.directoryVersion; const remote = new Set(response.notebooks.map(book => book.id));
          for (const entry of response.notebooks) {
            const old = this.books.get(entry.id);
            if (this.remoteMissing.has(entry.id) && !this.dirty.has(entry.id)) {this.remoteMissing.delete(entry.id);this.conflicts.delete(entry.id);changed=true;}
            if (entry.id !== currentId && !this.dirty.has(entry.id) && (!old || entry.revision > old.revision || old.access?.version !== entry.access?.version)) { this.books.set(entry.id,entry); changed = true; }
          }
          for (const [id, book] of this.books) if (book.revision && !remote.has(id)) {
            if (id === currentId || this.dirty.has(id)) { this.remoteMissing.add(id); this.conflicts.add(id); }
            else { this.books.delete(id); await this.removeLocal(id); } changed = true;
          }
        }
      } catch { this.cloudAvailable = false; }
    }
    for (const id of [...this.remoteChanges]) {
      if (id === currentId || this.dirty.has(id)) continue;
      this.remoteChanges.delete(id); const record = await localBook(this.scope,id); if (!this.active()) return false;
      if (record) { this.books.set(id,record.book); this.versions.set(id,record.version);this.localSnapshots.set(id,clone(record.book));this.baselines.set(id,clone(record.book)); } else this.books.delete(id);
      changed = true;
    }
    return changed;
  }
  async removeLocal(id) { await transaction('books', store => {store.delete(`${this.scope}:${id}`);store.delete(IDBKeyRange.bound(`${this.scope}:${id}:draft:`,`${this.scope}:${id}:draft:\uffff`));}); this.channel?.postMessage({id,writer:this.clientId}); }
  async purge(id) {
    if (!this.active()) throw aborted();
    await this.flush(); await this.writes.get(id)?.catch(() => {});
    if (!this.active()) throw aborted();
    if (this.dirty.has(id)) throw new Error('请先解决保存失败或冲突，再永久删除笔记本');
    if (!this.guest && this.books.get(id)?.revision) await this.api(`/${id}`, { clientId: this.clientId, baseRevision: this.books.get(id).revision }, 'DELETE');
    await this.removeLocal(id); this.books.delete(id); this.dirty.delete(id); this.pending.delete(id); this.conflicts.delete(id);
  }
  async reloadBook(id) {
    if (!this.active()) throw aborted();
    await this.saving; await this.writes.get(id)?.catch(() => {});
    const record = await localBook(this.scope,id);
    const book = this.guest ? record?.book : (await this.api(`/${id}`)).notebook;
    if (!this.active() || !book) throw new Error('没有可恢复的已保存版本');
    this.dirty.delete(id); this.pending.delete(id); this.conflicts.delete(id); this.rejected.delete(id); this.remoteMissing.delete(id); this.versions.set(id,record?.version || 0); this.books.set(id,book); this.baselines.set(id,clone(book));
    if (!this.guest) await this.persistBook(id); return book;
  }
  dispose() {
    this.disposed = true;this.releaseClient?.(); this.controller.abort(); this.channel?.close(); this.channel = null; for (const id of this.localLeases) this.localLease(id,true); clearTimeout(this.timer); clearTimeout(this.localTimer);
    return this.persist().catch(() => { volatileDrafts.set(this.scope,[...this.dirty].map(id => clone(this.books.get(id))).filter(Boolean)); });
  }
}
