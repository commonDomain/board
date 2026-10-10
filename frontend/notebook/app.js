import { wireNotebookTouch, wirePageReorder } from './touch.js';
import { capturePagePositions, animatePagePositions, wireNativePageReorder, markPageDropTarget, clearPageDropTargets, findPageReorderTarget, clearPageReorderOffsets } from './reorder.js';
import { openTouchSettings } from '../../public/app/touch-preferences.js';
import { brainConnectorIds } from '../../public/app/planning-source-links.js';
import { createNotebook, createPage, createElement, textDoc, tableDoc, cloneTree, cloneElements, uid, clone, plainText, elementText, fromCanvas, toCanvas, sourceText, validateNotebook, resizeBounds, replaceDocTitle } from './model.js';
import { NotebookStore, request, localRecord, localBooks, clearLocalScope } from './storage.js';
import { renderText, editText } from './editor.js';
import { setupNotebookInterface, compactRibbon, materialPreview, renderRecoveryBanner } from './interface.js';
import { setupWorkflow, renderWorkflowTabs } from './workflow.js';
import { setupNotebookConnectors } from './connectors.js';
import { openNotebookMenu } from './menu.js';
import { setupNotebookContextMenus } from './context-menu.js';
import { setupNotebookPlanning, hydrateNotebookTasks } from './planning.js';
import { references as planningReferences, copyNotebookPlans } from '../planning/transfer.js';
import { exportPlanningScope, PlanningStore } from '../planning/store.js';
import { notebookIcon, renderNotebookIcons } from './icons.js';
import { penPalette } from './pen-palette.js';
import { noteSharingBadge, setNoteSharing } from './sharing.js';
import { setupTextToolbar } from './text-toolbar.js';
import { setControlAvailability } from '../../public/app/ui-feedback.js';
import { pageSummary } from './interface.js';
import { notebookReferences, regionItems, regionRevision } from '../../public/app/note-reference-model.js';

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
function button(label, icon, action, className = '') {
  const node = el('button', className); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
  if (icon) { const glyph = notebookIcon(icon) || el('i'); if (!glyph.classList.contains('nt-office-icon')) glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true'); node.append(glyph); }
  if (['笔记本操作', '分区操作', '笔记操作'].includes(label)) { node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-expanded', 'false'); }
  node.append(el('span', '', label)); node.addEventListener('click', async event => {
    if (node.disabled || node.getAttribute('aria-busy') === 'true') return;
    try {
      const result = action(event);
      if (result?.then) { node.setAttribute('aria-busy','true'); await result; }
    } catch (error) { if (error.name !== 'AbortError') window.dispatchEvent(new CustomEvent('muse:note-error', { detail: error.message })); }
    finally { node.removeAttribute('aria-busy'); }
  }); return node;
}
const icons = () => { const root=document.getElementById('independentNotebook');renderNotebookIcons(root);window.MuseIcons?.renderIcons(root); };
export class NotebookApp {
  constructor(bridge) {
    this.bridge = bridge; this.epoch = 0; this.gestures = new Set(); this.root = el('section', 'nt-app'); this.root.id = 'independentNotebook'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '独立笔记工作区');
    this.root.innerHTML = `<header class="nt-appbar"><div class="nt-brand"><i data-lucide="notebook-pen"></i><strong>Muse Notes</strong><span>笔记工作区</span></div><div class="nt-global-search"><i data-lucide="search"></i><input aria-label="搜索所有笔记" placeholder="搜索笔记、正文、标签…"></div><span class="nt-save" role="status"></span><div class="nt-app-actions"></div></header>
      <nav class="nt-ribbon-tabs" aria-label="笔记功能区"></nav><div class="nt-ribbon" role="toolbar" aria-label="笔记工具"></div>
      <div class="nt-workspace"><aside class="nt-library"><div class="nt-library-head"><strong>笔记本</strong></div><div class="nt-shortcuts"></div><div class="nt-books"></div><div class="nt-library-footer">独立保存 · 自由记录</div><div class="nt-sidebar-resize" data-resize="library"></div></aside>
      <aside class="nt-pages"><header><strong>全部笔记</strong></header><div class="nt-page-list"></div><div class="nt-sidebar-resize" data-resize="pages"></div></aside>
      <main class="nt-main"><div class="nt-tabs" role="tablist" aria-label="已打开的笔记"></div><div class="nt-scroll"><div class="nt-paper-wrap"><div class="nt-paper"><header class="nt-title-block"><input aria-label="笔记标题" maxlength="200" placeholder="未命名笔记"><div class="nt-page-meta"></div></header><div class="nt-surface" tabindex="0" aria-label="自由笔记页"><p class="nt-empty">点击任意位置，开始记录<span>写下想法，插入图片，或从右侧带入画布素材</span></p></div></div></div></div><footer class="nt-status"><span class="nt-status-hint">点击空白处输入</span><div class="nt-zoom"></div></footer></main>
      <aside class="nt-materials" hidden><header><strong>画布素材</strong></header><p>复制到笔记后独立编辑</p><select aria-label="选择画布" class="nt-material-board"><option value="">所有画布</option></select><input aria-label="搜索画布素材" placeholder="搜索素材内容"><select aria-label="筛选素材类型"><option value="">所有类型</option><option value="text">文本</option><option value="note">便签</option><option value="image">图片</option><option value="mindmap">脑图</option><option value="table">表格</option><option value="ink">笔迹</option><option value="shape">图形</option></select><div class="nt-material-list"></div></aside></div>
      <div class="nt-notice" role="status" hidden></div>`;
    document.body.append(this.root);
    this.$ = selector => this.root.querySelector(selector);
    this.surface = this.$('.nt-surface'); this.selection = new Set(); this.history = new Map(); this.redo = new Map(); this.tabs = []; this.views = new Map(); this.tab = '开始'; this.tool = 'text'; this.zoom = 1; this.readOnly = false;
    this.$('.nt-app-actions').append(button('回到画布', 'panels-top-left', () => this.hide()), button('画布素材', 'panel-right', () => this.toggleMaterials()));
    this.$('.nt-app-actions').append(button('完成编辑', 'check', () => { this.finishEdit(); document.activeElement?.blur(); }, 'nt-icon nt-done-editing touch-only'));
    this.$('.nt-app-actions').prepend(button('笔记目录', 'panel-left', () => this.toggleNavigation(), 'nt-mobile-nav'));
    this.$('.nt-library-head').append(button('新建笔记本', 'plus', () => this.newBook(), 'nt-icon'));
    this.$('.nt-pages header').append(button('新建笔记', 'plus', () => this.newPage(), 'nt-icon'));
    for (const [name, icon, filter] of [['所有笔记', 'files', 'all'], ['最近修改', 'clock-3', 'recent'], ['收藏', 'star', 'favorites'], ['共享笔记', 'users-round', 'shared'], ['回收站', 'trash-2', 'trash']]) {
      const shortcut=button(name, icon, () => { this.filter = filter; this.sectionId = null; this.pageLimit = 160; this.renderNavigation(); });shortcut.dataset.noteFilter=filter;this.$('.nt-shortcuts').append(shortcut);
    }
    for (const name of ['开始', '插入', '绘写', '视图']) this.$('.nt-ribbon-tabs').append(button(name, '', () => { this.tab = name; if(name!=='绘写'){this.touch?.cancel();this.tool='text';this.touchMultiSelect=false;} this.renderRibbon(); }));
    this.$('.nt-title-block input').addEventListener('input', event => { if (!this.writable()) return; this.remember('title'); this.page.title = event.target.value; this.changed(); this.renderNavigation(); this.renderTabs(); this.syncFormat(); });
    this.$('.nt-global-search input').addEventListener('input', event => { this.query = event.target.value; clearTimeout(this.queryTimer); this.queryTimer = setTimeout(() => this.searchNotes(), 200); });
    this.$('.nt-materials input').addEventListener('input', () => { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.loadMaterials(), 250); });
    for (const select of this.root.querySelectorAll('.nt-materials select')) select.addEventListener('change', () => { clearTimeout(this.searchTimer); this.pending = null; this.loadMaterials(); });
    this.$('.nt-materials header').append(button('收起素材', 'x', () => this.toggleMaterials(), 'nt-icon'));
    this.$('.nt-zoom').append(button('缩小', 'minus', () => this.setZoom(this.zoom - .1), 'nt-icon'), el('span', 'nt-zoom-label', '100%'), button('放大', 'plus', () => this.setZoom(this.zoom + .1), 'nt-icon'));
    setupNotebookInterface(this, button, el);
    setupWorkflow(this, button, el);
    setupNotebookContextMenus(this);
    setupNotebookPlanning(this);
    setupNotebookConnectors(this);
    this.$('.nt-scroll').addEventListener('scroll', () => { if (this.renderFrame) return; this.renderFrame = requestAnimationFrame(() => { this.renderFrame = null; this.renderElements(); icons(); }); }, {passive:true});
    this.resizeObserver = new ResizeObserver(() => { if (!this.root.hidden && this.page) { this.updateSize(); this.renderElements(); icons(); } });
    this.resizeObserver.observe(this.$('.nt-scroll'));
    this.measuredHeights = new WeakMap();
    this.contentObserver = new ResizeObserver(entries => {
      if (!this.page || this.root.hidden) return;
      for (const {target} of entries) {
        const node = target.closest('[data-element-id]');
        const element = this.page.elements.find(item => item.id === node?.dataset.elementId);
        if (!element || !node.isConnected) continue;
        const height = Math.max(48,target.scrollHeight); this.measuredHeights.set(element,height); node.style.minHeight = `${height}px`;
      }
      this.updateSize();
    });
    this.touch = wireNotebookTouch(this);
    this.surface.addEventListener('pointerdown', event => this.pointerDown(event));
    this.root.addEventListener('pointermove',event=>{if(this.page && event.target.closest('.nt-surface'))this.pasteTarget={pageId:this.page.id,point:this.point(event)};},{capture:true,passive:true});
    const completeWriting = event => {
      if (this.editor && !event.target.closest('.nt-element-body,.nt-ribbon,.nt-ribbon-tabs,.nt-selection-toolbar,.nt-content-more')) this.finishEdit();
    };
    this.root.addEventListener('pointerdown', completeWriting, {capture:true});
    this.root.addEventListener('focusin', completeWriting);
    setupTextToolbar(this,button,el);
    this.surface.addEventListener('dragover', event => event.preventDefault());
    this.surface.addEventListener('drop', event => this.drop(event));
    this.root.addEventListener('keydown', event => this.keyDown(event));
    this.root.addEventListener('paste', event => this.paste(event),{capture:true});
    this.root.addEventListener('copy', event => this.copy(event));
    this.root.addEventListener('cut', event => this.copy(event,true));
    this.$('.nt-ribbon').addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
    for (const handle of this.root.querySelectorAll('[data-resize]')) handle.addEventListener('pointerdown', event => {
      event.preventDefault(); this.root.classList.add('nt-resizing-navigation'); const x = event.clientX; const parent = handle.parentElement; const width = parent.offsetWidth;
      const move = next => this.root.style.setProperty(`--nt-${handle.dataset.resize}`, `${Math.max(150, Math.min(380, width + next.clientX - x))}px`);
      const up = () => { this.root.classList.remove('nt-resizing-navigation'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    });
    window.addEventListener('online', () => { if (this.store) this.store.nextDirectoryCheck = 0; this.store?.flush(); this.poll(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (this.store) this.store.nextDirectoryCheck = 0; this.poll(); } });
    this.$('.nt-save').tabIndex = 0; this.$('.nt-save').setAttribute('role','button');
    const retryOpen = () => { if (!this.page) this.show(); else this.workspaceMenu(this.$('.nt-save'), true); };
    this.$('.nt-save').addEventListener('click',retryOpen);
    this.$('.nt-save').addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); retryOpen(); } });
    window.addEventListener('muse:note-error', event => this.toast(event.detail));
    window.addEventListener('pagehide', () => { this.finishEdit(); this.store?.persist().catch(() => {}); });
    window.addEventListener('beforeunload', event => { if (this.store && [...this.store.dirty].some(id => this.store.durable.get(id) !== (this.store.generations.get(id) || 0))) { event.preventDefault(); event.returnValue = ''; } });
    for (const name of ['muse:account-changing', 'muse:logout', 'muse:auth-expired']) window.addEventListener(name, () => this.resetAccount());
    window.addEventListener('muse:sharing-changed',()=>{if(this.store){this.store.directoryVersion=null;this.store.nextDirectoryCheck=0;this.poll();}});
    window.addEventListener('beforeprint', () => { this.cancelMotion(); if (!this.root.hidden) { this.printing = true; this.renderElements(); } });
    window.addEventListener('afterprint', () => { this.printing = false; this.renderElements(); });
    this.pollTimer = setInterval(() => this.poll(), 4000);
    this.leaseWatchdog=setInterval(()=>{if(!this.root.hidden&&this.page&&!this.readOnly&&!this.store?.leaseValid(this.book.id,this.page.id)){this.readOnly=true;this.notify('编辑锁待确认 · 当前只读，草稿仍保留');}},500);
    icons();
  }
  toggleNavigation() { if(this.root.classList.contains('nt-navigation-open'))this.closeNavigation();else {this.showNavigation();this.$('.nt-navigation-header button')?.focus();} }
  get readOnly() { return Boolean(this._readOnly); }
  set readOnly(value) {
    if (value && !this._readOnly) this.touch?.cancel();
    this._readOnly = Boolean(value); this.editor?.setEditable(!this._readOnly && !this.page?.deleted && !this.book?.deleted);
    this.root?.classList.toggle('nt-readonly', this._readOnly);
    if (this.history) this.syncFormat();
    if (this.$) for (const input of this.root.querySelectorAll('.nt-title-block input,.nt-mind-node input')) input.readOnly = this._readOnly || Boolean(this.page?.deleted || this.book?.deleted);
    if (this.root) for (const control of this.root.querySelectorAll('.nt-reference-actions [aria-label="刷新预览"]')) setControlAvailability(control,this._readOnly || Boolean(this.page?.deleted || this.book?.deleted),'当前页面只读');
  }
  context() { return { store: this.store, epoch: this.epoch, bookId: this.book?.id, pageId: this.page?.id }; }
  current(context, page = true) { return context.epoch === this.epoch && context.store === this.store && this.store?.active() && (!page || context.pageId === this.page?.id && context.bookId === this.book?.id); }
  resetAccount() {
    this.planningEdit = null;
    this.formatPainter=null;
    this.syncFormatPainter?.();
    this.closeContextMenu?.();
    this.cancelMotion();
    this.touch?.cancel();
    this.contentObserver.disconnect(); this.showToken = null; this.epoch++; this.openToken = null;this.openingPageToken=null; this.materialToken = null;
    for (const cancel of this.gestures) cancel(); this.gestures.clear();
    clearTimeout(this.searchTimer); clearTimeout(this.queryTimer); clearTimeout(this.toastTimer);
    this.finishEdit(); this.saveView(); this.store?.dispose(); this.store = null;
    this.book = null; this.page = null; this.pending = null; this.clipboard = null; this.query = ''; this.remoteMatches = null;
    this.searchToken = null; this.searchHits = []; this.searchNext = null; this.searchLoading = false; this.$('.nt-search-results').hidden = true; this.returnContext = null;
    this.root.classList.remove('nt-search-open','nt-navigation-open','nt-materials-open','nt-tools-expanded','nt-editing');this.$('.nt-materials').hidden=true;this.syncMaterialSelection();
    this.history.clear(); this.redo.clear(); this.views.clear(); this.selection.clear(); this.tabs = []; this.scope = null;
    this.root.querySelectorAll('.nt-books,.nt-page-list,.nt-surface,.nt-material-list,.nt-tabs').forEach(node => node.replaceChildren());
    this.root.querySelectorAll('input:not([type=color]):not([type=range])').forEach(node => { node.value = ''; });
    this.$('.nt-search-clear').hidden = true;
    if(this.$('.nt-recovery-banner'))this.$('.nt-recovery-banner').hidden=true;
    document.querySelectorAll('.nt-dialog').forEach(dialog => { dialog.close('cancel'); dialog.remove(); });
    this.$('.nt-material-board').replaceChildren(new Option('所有画布', ''));
    this.root.hidden = true; document.documentElement.classList.remove('independent-notes-open'); window.__independentNotesActive = false; this.bridge.returnCanvas?.();
  }
  async searchNotes(more = false) {
    const context = this.context(); const query = this.query || ''; const token = uid(); this.searchToken = token;
    const offset = more ? this.searchNext : 0;
    if (!more) { this.searchHits = []; this.remoteMatches = null; this.searchNext = null; }
    this.searchLoading = true; this.searchLocalOnly = false; this.renderSearch();
    if (query.trim() && this.store && !this.store.guest) {
      try { const result = await this.store.api(`/search?q=${encodeURIComponent(query)}&offset=${offset || 0}`); if (!this.current(context, false) || query !== this.query || token !== this.searchToken) return; this.searchHits.push(...result.materials); this.remoteMatches = new Set(this.searchHits.map(item => item.pageId)); this.searchNext = result.next; }
      catch (error) { if (!this.current(context, false) || token !== this.searchToken) return; this.searchLocalOnly = true; }
    }
    if (this.current(context, false) && token === this.searchToken) { this.searchLoading = false; this.renderNavigation(); this.renderSearch(); }
  }
  notify(message) { const save=this.$('.nt-save');save.textContent=message;save.title=message;save.dataset.state=/失败|拒绝|冲突|不可用|只读|离线|草稿已保存|待确认/.test(message)?'attention':/正在|确认/.test(message)?'pending':/已同步|已保存到/.test(message)?'saved':'pending'; }
  // Fade only explicit navigation changes, never editor or scrolling updates.
  fadeIn(node) {
    this.motionAnimations ||= new Map();
    this.motionAnimations.get(node)?.cancel();
    if (this.root.hidden || this.printing || !node.animate) return;
    const animation = node.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 140, easing: 'cubic-bezier(.2,.7,.2,1)' });
    this.motionAnimations.set(node, animation);
    animation.onfinish = animation.oncancel = () => { if (this.motionAnimations.get(node) === animation) this.motionAnimations.delete(node); };
  }
  cancelMotion() {
    clearTimeout(this.navigationMotionTimer);
    this.root.classList.remove('nt-navigation-animating');
    for (const animation of this.motionAnimations?.values() || []) animation.cancel();
    this.motionAnimations?.clear();
  }
  animateNavigation(toggle) {
    clearTimeout(this.navigationMotionTimer);
    this.root.classList.add('nt-navigation-animating');
    this.$('.nt-library').getBoundingClientRect();
    toggle();
    this.navigationMotionTimer = setTimeout(() => this.root.classList.remove('nt-navigation-animating'), 180);
  }
  toast(message) { const node = this.$('.nt-notice'); node.textContent = message; node.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { node.hidden = true; }, 4500); }
  async ask(title, initial = '', validate) {
    const context = this.context(); const dialog = el('dialog', 'nt-dialog nt-owned-dialog'); const form = el('form'); form.method = 'dialog';
    const heading = el('h2', '', title); const input = el('input'); input.value = initial; input.maxLength = title==='链接地址'?2048:title==='笔记名称'?200:100; input.setAttribute('aria-label', title);
    const focus = document.activeElement;
    const error = el('p', 'nt-field-error'); error.hidden = true; error.setAttribute('role','alert');
    const submit = () => { const message=input.value.trim()?(validate?.(input.value.trim())||''):'请填写内容后再保存';if(!message)dialog.close('save');else { error.textContent = message; error.hidden = false; input.setAttribute('aria-invalid','true'); input.focus(); } };
    input.addEventListener('input',()=>{ error.hidden = true; input.removeAttribute('aria-invalid'); });
    const controls = el('div', 'nt-dialog-actions'); const cancel = button('取消', '', () => dialog.close('cancel')); const save = button(title.includes('永久删除') ? '确认永久删除' : title.includes('重新加载') ? '重新加载' : title.includes('链接') ? '应用链接' : '保存', '', submit);
    save.classList.add('nt-primary'); controls.append(cancel, save); form.append(heading, input, error, controls); dialog.append(form); document.body.append(dialog);
    form.addEventListener('submit', event => { event.preventDefault(); submit(); });
    dialog.showModal(); input.select();
    dialog.addEventListener('keydown',event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (!event.isComposing && event.keyCode !== 229) dialog.close('cancel'); });
    return new Promise(resolve => dialog.addEventListener('close', () => { dialog.remove(); if (this.current(context) && focus?.isConnected) focus.focus({preventScroll:true}); resolve(dialog.returnValue === 'save' && this.current(context, false) ? input.value.trim() : null); }, { once: true }));
  }
  async show() {
    const token = uid(); this.showToken = token;
    const opening = () => this.showToken === token && !this.root.hidden;
    this.root.hidden = false; document.documentElement.classList.add('independent-notes-open'); window.__independentNotesActive = true;
    this.bridge.leaveCanvas?.(); this.notify('正在打开笔记…');
    try {
      const scope = window.MuseAccount?.session?.user?.id || 'guest';
      if (!this.store || this.scope !== scope || !this.page || !this.book) {
        this.store?.dispose();
        this.scope = scope; this.store = new NotebookStore(scope, this.bridge.isGuest(), message => this.notify(message));
        const store = this.store; await store.load(); if (store !== this.store || store.disposed || !opening()) return;
        if (![...store.books.values()].some(book => !book.deleted)) { const book = createNotebook(); store.change(book); }
        const prefs = await localRecord(`${scope}:view`).catch(() => null); if (store !== this.store || !store.active() || !opening()) return;
        this.book = store.books.get(prefs?.bookId) || [...store.books.values()].find(book => !book.deleted);
        this.book = await store.getBook(this.book.id); if (store !== this.store || !store.active() || !opening()) return;
        this.page = this.book.pages.find(page => page.id === prefs?.pageId && !page.deleted) || this.book.pages.find(page => !page.deleted);
        if (!this.page) { this.page = createPage(this.book.sections[0].id); this.book.pages.push(this.page); store.change(this.book); }
        this.sectionId = this.page.sectionId; this.filter = 'all'; this.tabs = [{ bookId: this.book.id, pageId: this.page.id }];
      }
      const context = this.context(); this.readOnly=true;this.render();const writable = await this.store.lease(this.book.id,false,this.page.id); if (!this.current(context) || !opening()) { if (writable && context.store.active() && this.root.hidden) await context.store.lease(context.bookId,true,context.pageId); return; } this.readOnly = !writable; this.render();
      this.notify(this.readOnly ? '编辑锁被占用或尚未确认 · 当前只读' : this.store.summary());
      if (this.store.dirty.size && !this.readOnly) this.store.flush();
    } catch (error) { if (!opening()) return; this.book = null; this.page = null; this.notify('打开失败 · 点击重试'); this.toast(error.message); }
  }
  hide() { this.closeContextMenu?.(); this.cancelMotion(); this.showToken = null; this.touch?.cancel(); this.openToken = null;this.openingPageToken=null; for (const cancel of this.gestures) cancel(); this.finishEdit(); this.saveView(); const store = this.store, id = this.book?.id,pageId=this.page?.id; store?.flush().then(() => { if (id && !store.dirty.has(id) && (this.root.hidden || this.store !== store || this.book?.id !== id || this.page?.id!==pageId)) return store.lease(id,true,pageId); }); this.root.hidden = true; document.documentElement.classList.remove('independent-notes-open'); window.__independentNotesActive = false; this.bridge.returnCanvas?.(); }
  writable() { if (!this.store?.active() || this.readOnly || !this.store.leaseValid(this.book?.id,this.page?.id) || this.page?.deleted || this.book?.deleted) { this.toast('当前笔记只读'); return false; } return Boolean(this.page && this.book); }
  saveView() {
    if (!this.page || !this.scope) return;
    this.views.set(this.page.id, { x: this.$('.nt-scroll').scrollLeft, y: this.$('.nt-scroll').scrollTop, zoom: this.zoom });
    localRecord(`${this.scope}:view`, { bookId: this.book.id, pageId: this.page.id }).catch(() => {});
  }
  async poll() {
    if (this.root.hidden || !this.store || !this.book || document.hidden || this.polling || this.openingPageToken) return;
    this.polling = true;
    const store = this.store; const id = this.book.id,pageId=this.page.id;
    try {
      const wasReadOnly=this.readOnly;if(wasReadOnly&&!store.dirty.has(id))this.finishEdit();
      const writable=await store.lease(id,false,pageId,true,wasReadOnly);
      if(store!==this.store||id!==this.book?.id||pageId!==this.page?.id)return;
      // Keep a formerly blocked page read-only until its saved content is refreshed.
      if(this.readOnly&&!store.dirty.has(id))this.finishEdit();
      if(!writable||store.conflicts.has(id))this.readOnly=true;
      const directoryChanged = await store.syncDirectory(id);
      const fresh = await store.refresh(id, () => !this.editor && !this.gestures.size && store === this.store && id === this.book?.id && pageId === this.page?.id && !this.root.hidden);
      if (store !== this.store || id !== this.book?.id || pageId !== this.page?.id) return;
      if (store.remoteMissing.has(id)) { this.readOnly = true; this.finishEdit();this.renderRibbon(); this.notify(this.book.access?.received?'共享已取消或你已退出共享组 · 当前不可编辑':'此笔记本已在其他设备删除 · 可另存副本'); this.renderNavigation(); return; }
      if (directoryChanged) this.renderNavigation();
      if (fresh) { this.finishEdit(); this.readOnly=true; this.book = fresh; this.page = fresh.pages.find(page => page.id === this.page?.id) || fresh.pages[0]; this.render(); }
      if (store !== this.store || id !== this.book?.id || pageId!==this.page?.id) return; this.readOnly = !store.leaseValid(id,pageId)||store.conflicts.has(id);
      if(wasReadOnly&&!this.readOnly&&!fresh)this.renderPage();
      this.notify(this.readOnly ? '编辑锁被占用或尚未确认 · 当前只读' : store.summary());
      if(!this.readOnly&&store.dirty.size)store.flush();
    } catch (error) { if (store === this.store) this.toast(error.message); } finally { this.polling = false; }
  }
  changed() {
    this.page.updatedAt = Date.now(); this.store.change(this.book); this.updateSize();this.syncFormat();
    window.MusePlanning?.notify();
    if (this.store.guest && (this.book.deleted || this.page.deleted)) window.MusePlanning?.archiveHost({kind:'notebook',notebookId:this.book.id,...(this.book.deleted?{}:{pageId:this.page.id})}).catch(error=>this.toast(error.message));
    if(!this.navigationFrame){const context=this.context();this.navigationFrame=requestAnimationFrame(()=>{this.navigationFrame=null;if(this.current(context,false)&&!this.root.hidden)this.renderNavigation();});}
  }
  remember(group = '') {
    const now = Date.now(); const history = this.history.get(this.page.id) || [];
    if (!group || this.lastGroup !== `${this.page.id}:${group}` || now - this.lastHistory > 750) {
      this.historySizes ||= new WeakMap(); const snapshot = clone(this.page); this.historySizes.set(snapshot,JSON.stringify(snapshot).length); history.push(snapshot);
      let bytes = history.reduce((sum,entry) => sum + (this.historySizes.get(entry) || 0),0);
      while (history.length > 1 && (history.length > 40 || bytes > 8000000)) bytes -= this.historySizes.get(history.shift()) || 0; this.history.set(this.page.id, history); this.redo.set(this.page.id, []);
    }
    this.lastGroup = `${this.page.id}:${group}`; this.lastHistory = now;
  }
  undo(forward = false) {
    if (!this.writable() || !(forward ? this.redo : this.history).get(this.page.id)?.length) return; const editingId = this.editingId; const selection = this.editor?.state.selection; this.finishEdit();
    const source = (forward ? this.redo : this.history).get(this.page.id) || []; const targetMap = forward ? this.history : this.redo;
    if (!source.length) return;
    const target = targetMap.get(this.page.id) || []; const snapshot = clone(this.page); this.historySizes ||= new WeakMap(); this.historySizes.set(snapshot,JSON.stringify(snapshot).length); target.push(snapshot); targetMap.set(this.page.id, target);
    const restored = source.pop(); this.book.pages[this.book.pages.findIndex(page => page.id === restored.id)] = restored; this.page = restored; this.lastGroup = null; this.selection.clear(); this.changed(); this.render();
    const element = restored.elements.find(item => item.id === editingId);
    if (element) { this.startEdit(element, this.surface.querySelector(`[data-element-id="${element.id}"] .nt-element-body`)); if (selection) this.editor.commands.setTextSelection({ from: Math.min(selection.from, this.editor.state.doc.content.size), to: Math.min(selection.to, this.editor.state.doc.content.size) }); }
    else this.surface.focus();
  }
  async newBook() {
    const name = await this.ask('新建笔记本', '新笔记本'); if (!name) return;
    this.resetNavigationFilter();
    const book = createNotebook(name); this.store.change(book); await this.openPage(book, book.pages[0]);
  }
  resetNavigationFilter() {
    this.searchToken = null; this.searchHits = []; this.$('.nt-search-results').hidden = true; this.root.classList.remove('nt-search-open'); clearTimeout(this.queryTimer); this.filter = 'all'; this.query = ''; this.remoteMatches = null; this.searchNext = null; this.pageLimit = 160;
    this.$('.nt-global-search input').value = '';
    if(this.$('.nt-search-clear'))this.$('.nt-search-clear').hidden=true;
  }
  async newSection() {
    const name = await this.ask('新建分区', '新分区'); if (!name) return;
    const context=this.context(),book=this.book,token=uid();let page;
    this.openingPageToken=token;
    this.readOnly=true;
    try{
      await this.mutateBook(book,target=>{
        const section={id:uid('section'),title:name};target.sections.push(section);
        page=createPage(section.id);target.pages.push(page);
      });
      if(page&&this.current(context)){this.resetNavigationFilter();await this.openPage(this.book,page);}
    }finally{if(this.openingPageToken===token)this.openingPageToken=null;if(this.current(context))this.readOnly=!context.store.leaseValid(context.bookId,context.pageId)||context.store.conflicts.has(book.id);}
  }
  async newPage() {
    if (!this.store?.active()||!this.book||this.book.deleted) return this.toast('当前笔记本不可新建笔记');
    if (this.book.access?.received) return this.toast('请在自己的笔记本中新建笔记');
    this.resetNavigationFilter();
    const page = createPage(this.sectionId || this.book.sections[0].id); this.book.pages.push(page); this.store.change(this.book);
    const context=this.context();await this.openPage(this.book,page);
    if(this.current(context,false)&&this.page?.id===page.id&&!this.root.hidden&&!this.readOnly){const title=this.$('.nt-title-block input');title.focus({preventScroll:true});title.select();}
  }
  async openPage(book, page) {
    if(book===this.book&&page===this.page){this.closeNavigation();return;}
    this.closeContextMenu?.();
    this.touch?.cancel();
    const context = this.context(); const token = uid(); this.openToken = token;
    this.openingPageToken=token;
    const completeOpen=()=>{if(this.openingPageToken===token)this.openingPageToken=null;};
    this.finishEdit(); this.saveView();
    this.readOnly=true;
    if(this.book){context.store.flush().then(()=>{if(!context.store.dirty.has(context.bookId)&&(this.book?.id!==context.bookId||this.page?.id!==context.pageId))return context.store.lease(context.bookId,true,context.pageId);});}
    const lease=context.store.lease(book.id,false,page.id);
    const cached=context.store.books.get(book.id);
    if(cached?.unloaded)this.notify('正在读取笔记…');
    const releaseUnused=()=>lease.then(writable=>{
      if(writable&&(this.book?.id!==book.id||this.page?.id!==page.id))return context.store.lease(book.id,true,page.id);
    });
    let loaded;
    try{loaded=cached?.unloaded?await context.store.getBook(book.id):cached;}
    catch(error){completeOpen();releaseUnused();if(this.current(context,false)&&this.openToken===token){this.readOnly=!context.store.leaseValid(context.bookId,context.pageId);this.notify(context.store.summary());}throw error;}
    if (!this.current(context, false) || this.openToken !== token) {completeOpen();releaseUnused();return;}
    book = loaded; page = book.pages.find(entry => entry.id === page.id) || book.pages[0];
    this.book = book; this.page = page; this.sectionId = page.sectionId; this.selection.clear(); this.tool = 'text'; this.pending = null;
    if (!this.tabs.some(tab => tab.pageId === page.id)) this.tabs.push({ bookId: book.id, pageId: page.id });
    this.tabVisit = (this.tabVisit || 0) + 1;
    this.tabs.find(tab => tab.pageId === page.id).used = this.tabVisit;
    this.readOnly = true; this.closeNavigation();this.notify('确认编辑锁…');
    this.render(); const view = this.views.get(page.id); this.setZoom(view?.zoom || 1); this.$('.nt-scroll').scrollTo(view?.x || 0, view?.y || 0); this.saveView();
    if (context.bookId !== book.id || context.pageId !== page.id) this.fadeIn(this.$('.nt-paper-wrap'));
    let writable=await lease;
    if(writable&&!context.store.leaseValid(book.id,page.id)&&this.current(context,false)&&this.openToken===token)writable=await context.store.lease(book.id,false,page.id);
    completeOpen();
    if(!this.current(context,false)||this.openToken!==token){if(writable&&(this.book?.id!==book.id||this.page?.id!==page.id))await context.store.lease(book.id,true,page.id);return;}
    this.readOnly=!writable||!context.store.leaseValid(book.id,page.id)||context.store.conflicts.has(book.id);this.renderPage();this.notify(this.readOnly?'其他窗口正在编辑或编辑锁未确认 · 当前只读':context.store.summary());
  }
  render() { if (!this.page) return; this.renderNavigation(); this.renderRibbon(); this.renderTabs(); this.renderPage(); icons(); window.MusePlanning?.notify(); }
  renderNavigation() {
    if (!this.store || !this.book) return;
    if (this.pageReorder?.active) { this.navigationDeferred = true; return; }
    this.navigationDeferred = false;
    const previousPositions = capturePagePositions(this);
    const books = this.$('.nt-books'); books.replaceChildren();
    for (const book of this.store.books.values()) {
      if (this.store.remoteMissing.has(book.id)) continue;
      if (book.deleted && this.filter !== 'trash') continue;
      const row = el('div', 'nt-book-row'); row.dataset.bookId=book.id;
      const bookEntry = button(book.title + (book.deleted ? '（已删除）' : book.access?.received ? `（来自 ${book.access.ownerName}）` : ''), book.id === this.book.id ? 'book-open' : 'book', async () => { const page = book.id===this.book.id?this.page:book.pages.find(page => !page.deleted) || book.pages[0]; if (page) await this.openPage(book, page); if(matchMedia('(max-width:1100px)').matches)this.showNavigation('sections'); }, book.id === this.book.id ? 'active' : '');
      bookEntry.setAttribute('aria-expanded',String(book.id === this.book.id)); row.append(bookEntry);
      row.append(button('笔记本操作', 'ellipsis', event => this.bookMenu(book, event.currentTarget), 'nt-icon')); books.append(row);
      if (book.id === this.book.id) {
        const sections = el('div', 'nt-sections');
        for (const section of book.sections) {
          const sectionRow = el('div', 'nt-section-row'); sectionRow.dataset.sectionId=section.id;
          const entry = button(section.title, 'folder', () => { this.filter = 'all'; this.sectionId = section.id; this.renderNavigation(); if(matchMedia('(max-width:1100px)').matches)this.showNavigation('pages'); }, this.sectionId === section.id ? 'active' : '');
          entry.addEventListener('dragover', event => { event.preventDefault(); if (this.pageDrag?.bookId === book.id) markPageDropTarget(this, sectionRow); }); entry.addEventListener('drop', event => {
            clearPageDropTargets(this);
            event.preventDefault(); const id = event.dataTransfer.getData('application/muse-note-page');
            if (book.access?.received || !book.pages.some(page => page.id === id && !page.deleted) || book.id !== this.book.id || !this.writable()) return;
            this.mutateBook(book, target => {
              const page = target.pages.find(page => page.id === id);
              if (page && target.sections.some(entry => entry.id === section.id)) page.sectionId = section.id;
            }, id).catch(error => this.toast(error.message));
          });
          sectionRow.append(entry, button('分区操作', 'ellipsis', event => this.sectionMenu(section, event.currentTarget), 'nt-icon')); sections.append(sectionRow);
        }
        if (!book.access?.received) sections.append(button('添加分区', 'plus', () => this.newSection(), 'nt-add-section')); books.append(sections);
      }
    }
    const list = this.$('.nt-page-list'); list.replaceChildren();
    let entries = [...this.store.books.values()].flatMap(book => book.pages.map(page => ({ book, page })));
    const query = (this.query || '').trim().toLocaleLowerCase();
    entries = entries.filter(({ book, page }) => {
      if (this.store.remoteMissing.has(book.id)) return false;
      if (query) return !book.deleted && !page.deleted && (this.remoteMatches?.has(page.id) || `${book.title} ${page.title} ${page.elements.map(elementText).join(' ')}`.toLocaleLowerCase().includes(query));
      if (this.filter === 'trash') return page.deleted || book.deleted;
      if (book.deleted || page.deleted) return false;
      if (this.filter === 'favorites') return page.favorite;
      if (this.filter === 'shared') return Boolean(page.sharing);
      if (this.filter === 'recent') return true;
      return !this.sectionId || book.id === this.book.id && page.sectionId === this.sectionId;
    });
    if (this.filter === 'recent') entries.sort((a, b) => b.page.updatedAt - a.page.updatedAt);
    this.$('.nt-pages header strong').textContent = query ? `搜索结果 · ${entries.length}` : this.filter === 'shared' ? '共享笔记' : this.filter === 'trash' ? '回收站' : this.filter === 'favorites' ? '收藏' : this.filter === 'recent' ? '最近修改' : this.book.sections.find(section => section.id === this.sectionId)?.title || '全部笔记';
    setControlAvailability(this.$('.nt-pages header [aria-label="新建笔记"]'),Boolean(this.book.access?.received),'请先选择自己的笔记本，再新建笔记');
    this.$('.nt-navigation-path').textContent = `${this.book.title} / ${this.$('.nt-pages header strong').textContent}`;
    for (const control of this.$('.nt-shortcuts').children) {
      const active = !query && !this.sectionId && this.filter === control.dataset.noteFilter;
      control.classList.toggle('active', active); control.setAttribute('aria-pressed', String(active));
    }
    const titleCounts = new Map();
    for (const {page} of entries) titleCounts.set(page.title,(titleCounts.get(page.title)||0)+1);
    for (const { book, page } of entries.slice(0, this.pageLimit || 160)) {
      const row = el('div', `nt-page-entry${page.id === this.page?.id ? ' active' : ''}`); row.dataset.bookId=book.id;row.dataset.pageId=page.id;
      const entry = button(page.title || '未命名笔记', page.favorite ? 'star' : 'file-text', () => this.openPage(book, page));
      const path = `${book.title} / ${book.sections.find(section=>section.id===page.sectionId)?.title || '未命名分区'}`;
      entry.title = `${page.title || '未命名笔记'} · ${path}`;
      const sameName = titleCounts.get(page.title)>1;
      if (sameName || !this.sectionId) entry.append(el('small','nt-page-path',path));
      entry.append(el('small', '', pageSummary(page)));
      const badge=noteSharingBadge(page,el);if(badge){entry.append(badge);row.classList.add(page.sharing.received?'nt-shared-received':'nt-shared-owned');}
      wireNativePageReorder(this, row, book, page);
      row.addEventListener('drop', event => {
        clearPageDropTargets(this);
        event.preventDefault(); const id = event.dataTransfer.getData('application/muse-note-page');
        const placement = findPageReorderTarget(this, event.clientX, event.clientY);
        const neighborId = placement?.row.dataset.pageId;
        if (book.access?.received || !book.pages.some(item => item.id === id && !item.deleted) || !neighborId || id === neighborId || book.id !== this.book.id || !this.writable()) return;
        const after = placement.after, previewEntries = this.pageReorder?.entries;
        if (this.pageDrag) this.pageDrag.committed = true;
        this.mutateBook(book, target => {
          const moving = target.pages.find(item => item.id === id), neighbor = target.pages.find(item => item.id === neighborId);
          if (!moving || !neighbor || neighbor.deleted) return;
          target.pages = target.pages.filter(item => item !== moving); target.pages.splice(target.pages.indexOf(neighbor) + (after ? 1 : 0), 0, moving); moving.sectionId = neighbor.sectionId;
        }, id).catch(error => this.toast(error.message)).finally(() => {
          clearPageReorderOffsets(previewEntries);
          if (this.navigationDeferred && !this.pageReorder?.active) this.renderNavigation();
        });
      });
      const reorder = button('拖动排序笔记', 'grip-vertical', () => {}, 'nt-icon nt-reorder');
      if(book.access?.received){reorder.disabled=true;reorder.title='只有笔记所有者可以排序';}
      wirePageReorder(this, reorder, row, book, page);
      row.append(entry, reorder, button('笔记操作', 'ellipsis', event => this.pageMenu(book, page, event.currentTarget), 'nt-icon')); list.append(row);
    }
    if (!entries.length) list.append(el('p', 'nt-list-empty', query ? '没有找到匹配的笔记' : '这里还没有笔记'));
    if (query && this.searchNext != null) list.append(button('继续搜索', 'chevrons-down', async () => { const context = this.context(); const response = await this.store.api(`/search?q=${encodeURIComponent(query)}&offset=${this.searchNext}`); if (!this.current(context,false) || query !== (this.query || '').trim().toLocaleLowerCase()) return; for (const item of response.materials) this.remoteMatches.add(item.pageId); this.searchNext = response.next; this.renderNavigation(); }));
    if (entries.length > (this.pageLimit || 160)) list.append(button('加载更多', 'chevrons-down', () => { this.pageLimit = (this.pageLimit || 160) + 160; this.renderNavigation(); }));
    icons();
    animatePagePositions(this, previousPositions);
  }
  menu(title, actions, anchor = null, options = {}) { return openNotebookMenu(this,title,actions,anchor,button,el,options); }
  async mutateBook(book, action, pageId) {
    if (book.access?.received && !pageId) return this.toast('只有所有者可以管理此笔记本');
    const context = this.context(); const loaded = await this.store.getBook(book.id);
    if (!this.current(context, false)) return;
    if (!await this.store.lease(book.id,false,pageId) || !this.current(context, false)) return this.toast('其他窗口正在编辑，请另存副本');
    try {
      this.finishEdit(); await action(loaded); if (!this.current(context, false)) return;
      context.store.change(loaded); if (this.book.id === loaded.id) { this.book = loaded; this.page = loaded.pages.find(page => page.id === this.page.id) || loaded.pages[0]; }
      this.render();
      await context.store.flush();
      if (context.store.guest && window.MusePlanning) {
        if (loaded.deleted) await window.MusePlanning.archiveHost({ kind: 'notebook', notebookId: loaded.id });
        else for (const page of loaded.pages.filter(page => page.deleted)) await window.MusePlanning.archiveHost({ kind: 'notebook', notebookId: loaded.id, pageId: page.id });
      }
    } finally { if (context.store === this.store && (!pageId||loaded.id !== this.book?.id||pageId!==this.page?.id) && !context.store.dirty.has(loaded.id)) await context.store.lease(loaded.id,true,pageId); }
  }
  async restoreDeleted(book, page = null) {
    const context = this.context();
    await this.mutateBook(book, target => { if(page){const restored=target.pages.find(entry=>entry.id===page.id);if(restored)restored.deleted=false;}else target.deleted=false; },page?.id);
    if (!this.current(context)) return;
    if(this.store.dirty.has(book.id)){this.toast('恢复操作已保留为草稿，尚未完成保存，请重试');return;}
    const restored=this.store.books.get(book.id), target=page?restored?.pages.find(entry=>entry.id===page.id):restored?.pages.find(entry=>entry.id===context.pageId&&!entry.deleted)||restored?.pages.find(entry=>!entry.deleted);
    if(!restored || restored.deleted || !target || target.deleted)return;
    this.resetNavigationFilter();await this.openPage(restored,target);this.renderNavigation();this.toast(page?'笔记已恢复，可继续编辑':'笔记本已恢复，可继续编辑');
  }
  bookMenu(book, anchor, options) {
    if(book.access?.received)return this.menu(book.title,[['另存独立副本',()=>this.duplicateBook(book),{icon:'copy-plus',group:'transfer'}],['导出备份',()=>this.exportBook(book),{icon:'download',group:'transfer'}]],anchor,options);
    const actions = [
      ['重命名', async () => { const name = await this.ask('笔记本名称', book.title); if (name) return this.mutateBook(book, target => { target.title = name; }); },{icon:'pencil',group:'edit'}],
      ['另存独立副本', () => this.duplicateBook(book),{icon:'copy-plus',group:'edit'}], ['导出笔记备份', () => this.exportBook(book),{icon:'download',group:'transfer'}],
      [book.deleted ? '恢复笔记本' : `移入回收站${this.planningArchiveHint(book)}`, () => book.deleted?this.restoreDeleted(book):this.mutateBook(book, target => { target.deleted = true; }),{icon:book.deleted?'undo-2':'trash-2',danger:!book.deleted,group:'lifecycle'}]
    ];
    if (book.deleted) actions.push(['永久删除笔记本', async () => { const name = await this.ask(`输入笔记本名称以永久删除：${book.title}`); if (name !== book.title) return; const context = this.context(); await this.store.flush(); await this.store.purge(book.id); if (!this.current(context, false)) return; this.tabs = this.tabs.filter(tab => tab.bookId !== book.id); const next = [...this.store.books.values()].find(entry => !entry.deleted) || createNotebook(); if (!this.store.books.has(next.id)) this.store.change(next); await this.openPage(next, next.pages[0]); },{icon:'trash-2',danger:true,group:'lifecycle'}]);
    if (this.readOnly && book.id===this.book.id) for (const entry of actions) { if (entry[2].group==='edit' && entry[2].icon==='copy-plus' || entry[2].group==='transfer') continue; Object.assign(entry[2],{disabled:true,reason:'其他窗口正在编辑此笔记本，当前只读'}); }
    return this.menu(book.title, actions, anchor, options);
  }
  sectionMenu(section, anchor, options) {
    const book = this.book;
    if(book.access?.received)return this.menu(section.title,[['共享分区由所有者管理',()=>{},{icon:'users-round',disabled:true,reason:'可编辑共享笔记的内容和标题'}]],anchor,options);
    const actions = [
      ['重命名分区', async () => { const name = await this.ask('分区名称', section.title); if (name) return this.mutateBook(book, target => { target.sections.find(entry => entry.id === section.id).title = name; }); },{icon:'pencil',group:'edit'}],
      ['上移分区', () => this.mutateBook(book, target => { const index = target.sections.findIndex(entry => entry.id === section.id); if (index > 0) target.sections.splice(index - 1, 0, target.sections.splice(index, 1)[0]); }),{icon:'arrow-up',group:'edit',disabled:book.sections[0]===section,reason:'已经是第一个分区'}],
      ['删除分区及其中的笔记', async () => { if (await this.ask(`输入“删除”以删除分区：${section.title}（笔记移入回收站）`) !== '删除') return; return this.mutateBook(book, target => { if (target.sections.length === 1) return this.toast('请至少保留一个分区'); const next = target.sections.find(entry => entry.id !== section.id); target.pages.filter(page => page.sectionId === section.id).forEach(page => { page.deleted = true; page.sectionId = next.id; }); target.sections = target.sections.filter(entry => entry.id !== section.id); this.sectionId = next.id; }); },{icon:'trash-2',danger:true,group:'lifecycle',disabled:book.sections.length===1,reason:'请至少保留一个分区'}]
    ];
    if (this.readOnly) for (const entry of actions) Object.assign(entry[2],{disabled:true,reason:'其他窗口正在编辑此笔记本，当前只读'});
    return this.menu(section.title,actions,anchor,options);
  }
  pageMenu(book, page, anchor, options) {
    const change = action => this.mutateBook(book, target => { const current = target.pages.find(entry => entry.id === page.id); if (current) action(current, target); },page.id);
    const actions = [
      ['重命名', async () => { const title = await this.ask('笔记名称', page.title); if (title) return change(current => { current.title = title; }); },{icon:'pencil',group:'edit'}],
      ...(!book.access?.received ? [[page.favorite ? '取消收藏' : '收藏笔记', () => change(current => { current.favorite = !current.favorite; }),{icon:'star',group:'edit'}]] : [])
    ];
    if (!page.deleted && !book.access?.received) for (const [label, offset] of [['上移笔记', -1], ['下移笔记', 1]]) actions.push([label, () => change((current, target) => {
      const siblings = target.pages.filter(entry => !entry.deleted && entry.sectionId === current.sectionId);
      const neighbor = siblings[siblings.indexOf(current) + offset]; if (!neighbor) return;
      const from = target.pages.indexOf(current), to = target.pages.indexOf(neighbor);
      [target.pages[from], target.pages[to]] = [target.pages[to], target.pages[from]];
    }),{icon:offset<0?'arrow-up':'arrow-down',group:'order',disabled:(()=>{const pages=book.pages.filter(entry=>!entry.deleted&&entry.sectionId===page.sectionId);return !pages[pages.indexOf(page)+offset];})(),reason:offset<0?'已经是第一篇笔记':'已经是最后一篇笔记'}]);
    if(!book.access?.received)actions.push([page.deleted ? '恢复笔记' : `移入回收站${this.planningArchiveHint(book, page)}`, () => page.deleted?this.restoreDeleted(book,page):change(current => { current.deleted = true; }),{icon:page.deleted?'undo-2':'trash-2',danger:!page.deleted,group:'lifecycle'}]);
    if (page.deleted) actions.push(['永久删除笔记', async () => { if (await this.ask(`输入“删除”以永久删除：${page.title}`) !== '删除') return; return change((current, target) => { target.pages = target.pages.filter(entry => entry !== current); if (!target.pages.length) target.pages.push(createPage(target.sections[0].id)); this.tabs = this.tabs.filter(tab => tab.pageId !== current.id); }); },{icon:'trash-2',danger:true,group:'lifecycle'}]);
    if (this.readOnly && book.id===this.book.id && page.id===this.page.id) for (const entry of actions) Object.assign(entry[2],{disabled:true,reason:'其他窗口正在编辑这篇笔记，当前只读'});
    if (!page.deleted && !book.access?.received) actions.push([page.sharing?'取消共享':'共享笔记',()=>setNoteSharing(this,book,page,!page.sharing),{icon:'users-round',group:'sharing',disabled:this.store.guest,reason:'请登录并在账号设置中创建或加入共享组'}]);
    return this.menu(page.title, actions, anchor, options);
  }
  async duplicateBook(book) {
    const context = this.context(); book = await this.store.getBook(book.id); if (!this.current(context, false)) return;
    const copy = this.cloneBook(book);this.resetNavigationFilter(); this.store.change(copy); await this.openPage(copy, copy.pages[0]); return copy;
  }
  planningArchiveHint(book, page = null) { return [...(window.MusePlanning?.store?.plans.values() || [])].some(plan => !plan.archived && plan.host.kind === 'notebook' && plan.host.notebookId === book.id && (!page || plan.host.pageId === page.id)) ? ' · 规划将归档' : ''; }
  cloneBook(book) {
    const copy = clone(book); delete copy.unloaded; copy.id = uid('book'); copy.title = copy.title.slice(0, 94) + '（副本）'; copy.revision = 0; copy.deleted = false;
    delete copy.access;for(const page of copy.pages)delete page.sharing;
    const sections = new Map(); copy.sections.forEach(section => { const old = section.id; section.id = uid('section'); sections.set(old, section.id); });
    for (const page of copy.pages) { page.id = uid('page'); page.sectionId = sections.get(page.sectionId); page.elements = cloneElements(page.elements); }
    return copy;
  }
  renderTabs() { if(this.page&&!this.page.deleted&&!this.book?.deleted&&!this.tabs.some(tab=>tab.pageId===this.page.id))this.tabs.push({bookId:this.book.id,pageId:this.page.id});renderWorkflowTabs(this, button, el); icons(); }
  workspaceMenu(anchor, recovery = false) {
    const actions = [];
    const add = (label, icon, action) => actions.push([label, action,{icon,group:/备份|游客/.test(label)?'transfer':/存储/.test(label)?'settings':'recovery'}]);
      add('保存重试', 'cloud-upload', () => this.store.retry(this.book.id)); add('另存副本', 'copy-plus', () => this.duplicateBook(this.book));
      add('载入已保存版本', 'refresh-cw', async () => { const context = this.context(); if (await this.ask('输入“重新加载”，放弃本页所在笔记本的未保存修改') !== '重新加载' || !this.current(context)) return; this.finishEdit(); const book = await this.store.reloadBook(context.bookId); if (this.current(context,false)) await this.openPage(book, book.pages.find(page => page.id === context.pageId) || book.pages[0]); });
      add('导出备份', 'download', () => this.exportBook(this.book)); add('导入备份', 'upload', () => this.importFile());
      if (!this.store.guest) add('导入游客笔记', 'notebook-pen', () => this.importGuest());
      add('存储用量', 'database', async () => { const usage = await navigator.storage?.estimate?.(); this.toast(usage ? `此站点已用 ${(usage.usage / 1048576).toFixed(1)} MB，可用配额 ${(usage.quota / 1048576).toFixed(0)} MB；回收站内容会占用空间` : '当前浏览器无法提供存储用量'); });
    if (!recovery) actions.push(['触控设置', openTouchSettings,{icon:'hand',group:'settings'}]);
    this.menu(recovery ? this.store.failures.get(this.book.id) || this.store.summary() : '笔记工作区', recovery ? actions.slice(0,3) : actions, anchor);
  }
  renderRibbon() {
    this.surface.dataset.drawing=String(this.tool!=='text');
    const tabChanged = this.motionRibbonTab !== undefined && this.motionRibbonTab !== this.tab;
    this.motionRibbonTab = this.tab;
    this.ribbonTable = Boolean(this.editor?.isActive('table'));
    const ribbon = this.$('.nt-ribbon'); ribbon.replaceChildren();
    ribbon.classList.toggle('nt-view-ribbon',this.tab==='视图');
    ribbon.classList.toggle('nt-insert-ribbon',this.tab==='插入');
    this.$('.nt-ribbon-tabs').querySelectorAll('button').forEach(node => { node.classList.toggle('active', node.textContent === this.tab); node.setAttribute('aria-pressed', String(node.textContent === this.tab)); });
    const add = (label, icon, action, active = false) => { const node = button(label, icon, action, active ? 'active' : ''); if (['完成编辑', '多选内容', '取消操作'].includes(label)) node.classList.add('touch-only'); if (['加粗','斜体','下划线','高亮','项目列表','编号列表','待办清单','输入','移动页面','画笔','荧光笔','笔画橡皮','框选','矩形','椭圆','三角形','专注写作','显示目录','白纸','横线','方格','多选内容'].includes(label)) node.setAttribute('aria-pressed', String(active)); ribbon.append(node); };
    const command = name => { if (!this.editor || !this.writable()) return this.toast('先点击文字内容，再设置格式'); this.editor.chain().focus()[name]().run(); };
    if (this.tab === '开始') {
      add('撤销', 'undo-2', () => this.undo()); add('重做', 'redo-2', () => this.undo(true)); ribbon.append(el('span', 'nt-divider'));
      const select = el('select', 'nt-style-select'); select.setAttribute('aria-label', '段落样式'); for (const [label, value] of [['正文', '0'], ...[1,2,3,4,5,6].map(level => [`标题 ${level}`, String(level)])]) { const option = el('option', '', label); option.value = value; select.append(option); }
      select.addEventListener('change', () => { if (!this.editor || !this.writable()) return; const chain = this.editor.chain().focus(); Number(select.value) ? chain.toggleHeading({ level: Number(select.value) }).run() : chain.setParagraph().run(); }); ribbon.append(select);
      for (const [label, icon, name] of [['加粗', 'bold', 'toggleBold'], ['斜体', 'italic', 'toggleItalic'], ['下划线', 'underline', 'toggleUnderline'], ['高亮', 'highlighter', 'toggleHighlight'], ['项目列表', 'list', 'toggleBulletList'], ['编号列表', 'list-ordered', 'toggleOrderedList'], ['待办清单', 'list-checks', 'toggleTaskList']]) add(label, icon, () => command(name));
      const size = el('select'); size.setAttribute('aria-label', '字号'); for (const value of [12, 14, 16, 18, 20, 24, 32]) { const option = el('option', '', `${value}`); option.value = value; option.selected = value === 16; size.append(option); } size.addEventListener('change', () => { if (this.writable()) this.editor?.chain().focus().setFontSize(`${size.value}px`).run(); }); ribbon.append(size);
      const color = el('input'); color.type = 'color'; color.value = '#34313d'; color.title = '文字颜色'; color.setAttribute('aria-label', '文字颜色');
      const colorControl=el('label','nt-color-control');colorControl.dataset.toolLabel='文字颜色';colorControl.title='文字颜色';colorControl.append(notebookIcon('text-color'),color);
      color.addEventListener('input', () => { colorControl.style.setProperty('--nt-format-color',color.value); if (this.writable()) this.editor?.chain().focus().setColor(color.value).run(); }); ribbon.append(colorControl);
      add('插入链接', 'link', async () => { const editor = this.editor; const context = this.context(); const href = await this.ask('链接地址', editor?.getAttributes('link')?.href || 'https://',value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?'':'仅支持 http:// 或 https:// 链接';}catch{return '请输入完整的 http:// 或 https:// 链接';}}); if (this.current(context) && editor === this.editor && this.writable() && href) this.editor?.chain().focus().setLink({ href }).run(); });
      add('打开链接', 'external-link', () => { const href = this.editor?.getAttributes('link')?.href; if (/^https?:\/\//i.test(href || '')) window.open(href, '_blank', 'noopener,noreferrer'); else this.toast('请将光标放在链接中'); });
      add('移除链接', 'unlink', () => { if (this.writable()) this.editor?.chain().focus().unsetLink().run(); });
    } else if (this.tab === '插入') {
      for (const [label, icon, type] of [['文本', 'type', 'text'], ['强调便签', 'sticky-note', 'callout'], ['标签', 'tag', 'tag'], ['表格', 'table-2', 'table'], ['脑图', 'network', 'mindmap']]) add(label, icon, () => this.insert(type));
      if (this.editor?.isActive('table')) for (const [label, name] of [['增加行','addRowAfter'],['删除行','deleteRow'],['增加列','addColumnAfter'],['删除列','deleteColumn'],['合并单元格','mergeCells'],['拆分单元格','splitCell']]) add(label, 'table-2', () => command(name));
      add('图片', 'image', () => this.chooseImage()); add('画布素材', 'panels-top-left', () => this.toggleMaterials());
    } else if (this.tab === '绘写') {
      for (const [label, icon, tool] of [['输入', 'type-select', 'text'], ['移动页面', 'hand', 'pan'], ['画笔', 'pen-tool', 'pen'], ['荧光笔', 'highlighter', 'highlighter'], ['笔画橡皮', 'eraser', 'eraser'], ['框选', 'scan', 'lasso'], ['矩形', 'square', 'rect'], ['椭圆', 'circle', 'ellipse'], ['三角形', 'triangle', 'triangle']]) add(label, icon, () => { this.touch?.cancel(); this.finishEdit(); this.tool = tool; this.pending = null; this.selection.clear(); this.updateSelection(); this.surface.dataset.drawing = String(tool !== 'text'); this.renderRibbon(); this.$('.nt-status-hint').textContent = label === '输入' ? '单击输入文字 · 拖动空白处框选内容' : `${label} · Esc 返回输入`; }, this.tool === tool);
      const typing=ribbon.querySelector('[aria-label="输入"]');typing.classList.add('nt-type-switch');typing.title='类型切换：文本输入与选择';
      ribbon.append(penPalette(this,button,el));
      const size = el('input'); size.type = 'range'; size.min = 1; size.max = 16; size.value = this.penSize || 3; size.setAttribute('aria-label', '笔迹粗细'); size.addEventListener('input', () => { this.penSize = Number(size.value); }); ribbon.append(size);
    } else {
      add('专注写作', 'view-focus', () => { this.animateNavigation(() => this.root.classList.toggle('nt-focus')); this.syncFormat(); });
      add('显示目录', 'view-directory', () => { if (matchMedia('(max-width: 1100px)').matches) this.toggleNavigation(); else this.animateNavigation(() => this.root.classList.toggle('nt-hide-library')); this.syncFormat(); });
      add('适合页面', 'page-fit', () => { this.setZoom(Math.min(1, (this.$('.nt-scroll').clientWidth - 32) / this.pageWidth()), {x:0,y:0}); this.$('.nt-scroll').scrollLeft = 0; });
      add('恢复 100%', 'zoom-reset', () => this.setZoom(1));
      for (const [label, kind] of [['白纸', 'plain'], ['横线', 'lines'], ['方格', 'grid']]) add(label, `paper-${kind}`, () => { if (!this.writable() || this.page.background === kind) return; this.remember(); this.page.background = kind; this.changed(); this.renderPage(); this.syncFormat(); }, this.page?.background === kind);
      add('打印 / PDF', 'print-page', () => { this.finishEdit(); window.print(); });

    }
    add('完成编辑', 'check', () => { this.finishEdit(); document.activeElement?.blur(); });
    add('多选内容', 'list-checks', () => { this.touchMultiSelect = !this.touchMultiSelect; this.finishEdit(); this.renderRibbon(); }, this.touchMultiSelect);
    add('取消操作', 'x', () => { this.touch?.cancel(); this.pending = null; this.tool = 'text'; this.surface.dataset.drawing = 'false'; this.selection.clear(); this.updateSelection(); this.renderRibbon(); });
    compactRibbon(this, button); this.syncFormat(); icons();
    if (tabChanged) this.fadeIn(ribbon);
  }
  syncFormat() {
    this.updateTextToolbar?.();
    this.syncNavigationInteraction?.();
    this.root.classList.toggle('nt-editing',Boolean(this.editor));
    if(!this.pending)this.syncMaterialSelection?.();
    const editor = this.editor; const writable = Boolean(editor && !this.readOnly && !this.page?.deleted && !this.book?.deleted);
    const pageWritable = Boolean(this.page && !this.readOnly && !this.page.deleted && !this.book?.deleted);
    for (const [label, active] of [['白纸', (this.page?.background || 'plain') === 'plain'], ['横线', this.page?.background === 'lines'], ['方格', this.page?.background === 'grid'], ['专注写作', this.root.classList.contains('nt-focus')], ['显示目录', !this.root.classList.contains('nt-focus') && (matchMedia('(max-width: 1100px)').matches ? this.root.classList.contains('nt-navigation-open') : !this.root.classList.contains('nt-hide-library'))]]) {
      const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (!control) continue;
      control.classList.toggle('active', active); control.setAttribute('aria-pressed', String(active));
    }
    for (const label of ['文本', '强调便签', '标签', '表格', '脑图', '图片', '画笔', '荧光笔', '笔画橡皮', '矩形', '椭圆', '三角形', '白纸', '横线', '方格']) {
      const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (control) control.disabled = !pageWritable;
    }
    const names = { '加粗':'bold','斜体':'italic','下划线':'underline','高亮':'highlight','项目列表':'bulletList','编号列表':'orderedList','待办清单':'taskList' };
    for (const [label, name] of Object.entries(names)) { const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (control) { control.disabled = !writable; control.classList.toggle('active', Boolean(editor?.isActive(name))); control.setAttribute('aria-pressed', String(Boolean(editor?.isActive(name)))); } }
    const attrs = editor?.getAttributes('textStyle') || {};
    for (const [label, value] of [['段落样式',String(editor?.isActive('heading') ? editor.getAttributes('heading').level : 0)],['字号',String(parseFloat(attrs.fontSize) || 16)],['文字颜色',attrs.color || '#34313d']]) {
      const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (!control) continue; control.disabled = !writable;
      if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === value)) { const option = el('option','',value); option.value = value; control.append(option); }
      control.value = value;
      if(label==='文字颜色')control.parentElement.style.setProperty('--nt-format-color',value);
    }
    for (const label of ['插入链接','移除链接']) { const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (control) control.disabled = !writable || label === '移除链接' && !editor?.isActive('link'); }
    for (const [label,method] of [['增加行','addRowAfter'],['删除行','deleteRow'],['增加列','addColumnAfter'],['删除列','deleteColumn'],['合并单元格','mergeCells'],['拆分单元格','splitCell']]) { const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (control) control.disabled = !writable || !editor.can()[method](); }
    for (const [label,map] of [['撤销',this.history],['重做',this.redo]]) { const control = this.$(`.nt-ribbon [aria-label="${label}"]`); if (control) control.disabled = !pageWritable || !map.get(this.page?.id)?.length; }
    const reasons = new Set();
    for(const control of this.$('.nt-ribbon').querySelectorAll('button,select,input')) {
      const label=control.getAttribute('aria-label')||'';
      const reason=!pageWritable?'当前页面只读':/撤销|重做/.test(label)?`暂无可${label}的操作`:label==='移除链接'?'当前选区没有链接':/合并单元格/.test(label)?'请选择多个相邻单元格':/拆分单元格/.test(label)?'请选择已合并的单元格':/增加行|删除行|增加列|删除列/.test(label)?'先点击表格中的单元格':'先点击文字内容，再设置格式';
      setControlAvailability(control,control.disabled,reason);
      if(control.disabled && control.getClientRects().length && label==='加粗')reasons.add(reason);
    }
    const hint=this.$('.nt-ribbon-help'); if(hint){hint.textContent=[...reasons].join(' · ');hint.hidden=!hint.textContent;}
  }
  renderElements() {
    if (!this.page) return;
    const scroll = this.$('.nt-scroll'); const top = scroll.scrollTop / this.zoom - this.$('.nt-title-block').offsetHeight - 500; const bottom = top + scroll.clientHeight / this.zoom + 1000;
    const visible = this.page.elements.filter(element => this.printing || this.page.elements.length < 100 || element.y + (this.measuredHeights.get(element) || element.h) >= top && element.y <= bottom || this.selection.has(element.id) || element.id === this.editingId);
    const wanted = new Set(visible.map(element => element.id)); const mounted = new Map([...this.surface.querySelectorAll('[data-element-id]')].map(node => [node.dataset.elementId,node]));
    for (const [id,node] of mounted) if (!wanted.has(id)) { const body = node.querySelector('.nt-element-body'); if (body) this.contentObserver.unobserve(body); node.remove(); }
    for (const element of visible) if (!mounted.has(element.id)) this.renderElement(element);
  }
  async exportBook(book) {
    const context = this.context(); const copy = clone(await this.store.getBook(book.id)); if (!this.current(context,false)) return;
    const sources = new Map();
    for (const element of copy.pages.flatMap(page => page.elements)) {
      if (element.type !== 'image' || element.src.startsWith('data:')) continue;
      if (!sources.has(element.src)) {
        const response = await fetch(element.src, { signal: AbortSignal.any([context.store.controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error('图片备份失败，请恢复网络后重试');
        const blob = await response.blob(); const src = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); sources.set(element.src,src);
      }
      element.src = sources.get(element.src); delete element.assetId;
    }
    if (!this.current(context,false)) return;
    const needed=planningReferences(copy),planningStore=window.MusePlanning?.store;
    if(planningStore&&!planningStore.guest){await planningStore.refresh();if(!planningStore.cloud)throw new Error('规划未同步，完整备份尚未生成，请恢复网络后重试');}
    const include=plan=>(needed.has(plan.id)||plan.host.kind==='notebook'&&plan.host.notebookId===copy.id)&&!plan.deleted;
    let planning=planningStore?[...planningStore.plans.values()].filter(include):await exportPlanningScope(this.scope,include);
    if(planningStore&&!planningStore.guest)planning=await Promise.all(planning.map(plan=>planningStore.loadPlan(plan.id,true)));
    if(planning.some(plan=>!plan||plan.partial))throw new Error('规划正文尚未载入，备份未完成，请稍后重试');
    if(!this.current(context,false))return;
    const blob = new Blob([JSON.stringify({format:'muse-notebook',version:2,notebook:copy,planning})], {type:'application/json'});
    const url = URL.createObjectURL(blob); const anchor = el('a'); anchor.href = url; anchor.download = `${copy.title.replace(/[<>:"/\\|?*]/g,'_')}.muse-notes.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); this.toast('已发起备份下载，请在浏览器中确认文件已保存');
  }
  importFile() {
    const context = this.context(); const input = el('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => { try { const file = input.files[0]; if (!file) return; if (file.size > 128 * 1024 * 1024) throw new Error('备份超过 128 MB，请拆分后导入'); const data = JSON.parse(await file.text()); if (!this.current(context,false)) return; if (data.format !== 'muse-notebook' || ![1,2].includes(data.version)) throw new Error('不是支持的笔记备份');if(data.version===2&&data.planning?.length)this.menu('规划导入方式',[['复制为独立规划',()=>this.importBook(data.notebook,context,data.planning)],['继续引用原任务',()=>this.importBook(data.notebook,context)]]);else await this.importBook(data.notebook,context); } catch(error) { if(this.current(context,false)) this.toast(error.message); } }); input.click();
  }
  async importBook(source, context = this.context(), planning = []) {
    validateNotebook(source, {local:true}); const book = this.cloneBook(source);
    const snapshots=planning.length?copyNotebookPlans(planning,source,book,context.store.scope):[];
    const sources = new Map();
    for (const element of book.pages.flatMap(page => page.elements)) {
      if (element.type !== 'image' || context.store.guest || !element.src.startsWith('data:')) continue;
      if (!sources.has(element.src)) { const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(element.src); if (!match) throw new Error('备份中的图片格式无效'); const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); const blob = new Blob([bytes], {type:match[1]}); sources.set(element.src,await this.imageSource(blob,context)); }
      element.src = sources.get(element.src); delete element.assetId;
    }
    if (!this.current(context,false)) return;
    if(snapshots.length){if(context.store.guest){const planningStore=window.MusePlanning?.store||new PlanningStore(()=>{});try{await planningStore.importPlans(snapshots,context.store.clientId);}finally{if(planningStore!==window.MusePlanning?.store)planningStore.dispose();}}else context.store.pending.set(book.id,{notebook:clone(book),planning:snapshots,baseRevision:0,opId:uid('op'),clientId:context.store.clientId,ownerId:context.store.scope,pageScoped:true});}
    this.resetNavigationFilter();context.store.change(book); await context.store.flush();
    if (!this.current(context,false)) return;
    await this.openPage(book, book.pages.find(page => !page.deleted) || book.pages[0]);
    if (context.store.dirty.has(book.id)) throw new Error('导入内容已保留为草稿，尚未完成保存；原副本仍保留');
    if(snapshots.length&&!context.store.guest)await window.MusePlanning?.refresh();
    this.toast('已导入独立副本，原内容仍保留'); return book;
  }
  async importGuest() {
    const context = this.context(); const records = (await localBooks('guest')).filter(record => !record.book.deleted);
    if (!this.current(context,false)) return;
    if (!records.length) return this.toast('此设备没有游客笔记');
    const importOne = async record => {
      const key = `${context.store.scope}:guest-import:${record.book.id}:${record.version}`;
      if (await localRecord(key)) return this.toast('此版本的游客笔记已经导入');
      if (!this.current(context,false)) return;
      const needed=planningReferences(record.book);
      const planning=await exportPlanningScope('guest',plan=>(needed.has(plan.id)||plan.host.kind==='notebook'&&plan.host.notebookId===record.book.id)&&!plan.deleted);
      const book = await this.importBook(record.book,context,planning); if (book && this.current(context,false)) await localRecord(key,book.id);
    };
    this.menu('导入游客笔记（保留原副本）', [...records.map(record => [record.book.title,() => importOne(record)]), ['导入全部',async () => { for (const record of records) { if (!this.current(context,false)) break; await importOne(record); } }]]);
  }
  renderPage() {
    renderRecoveryBanner(this,button,el);
    this.finishEdit(); this.contentObserver.disconnect(); this.surface.replaceChildren(); this.$('.nt-title-block input').value = this.page.title; this.$('.nt-title-block input').readOnly = this.readOnly || this.page.deleted || this.book.deleted;
    this.$('.nt-page-meta').textContent = `${new Date(this.page.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}${this.page.deleted || this.book.deleted ? '  ·  已删除，可在回收站恢复' : ''}`;
    this.surface.dataset.background = this.page.background || 'plain';
    if (!this.page.elements.length) {
      const deleted=this.page.deleted||this.book.deleted;
      const empty = el('div', 'nt-empty'); empty.append(el('strong','',deleted?'这篇笔记还没有内容':'从一个想法开始'),el('span','',deleted?'恢复后可开始记录':this.readOnly?'当前页面只读，取得编辑权限后可开始记录':'点击空白处自由记录，或选择一种方式开始'));
      if(!deleted){const actions=el('div','nt-empty-actions');actions.append(button('写文字','type',()=>this.insert('text')),button('插入图片','image',()=>this.chooseImage()),button('从画布添加','panels-top-left',()=>this.toggleMaterials()));for(const action of actions.children)setControlAvailability(action,this.readOnly,'当前页面只读');empty.append(actions);}this.surface.append(empty);
    }
    this.renderElements(); this.updateSize(); this.updateSelection(); icons();
  }
  renderElement(element) {
    const readonly=this.readOnly || Boolean(this.page?.deleted || this.book?.deleted);
    const node = el('div', `nt-element nt-${element.type}`); node.dataset.elementId = element.id; this.positionElement(node, element);
    if (element.type === 'connector') { this.renderConnector(element, node); this.surface.append(node); return; }
    const text = ['text','callout','tag'].includes(element.type);
    const handle = text ? el('div','nt-container-drag-zone') : button('移动内容', 'grip-horizontal', () => {}, 'nt-move');
    handle.addEventListener('pointerdown', event => this.dragElement(event, element, node));
    const body = el('div', 'nt-element-body');
    node.append(handle, body);
    if (window.MusePlanning?.enabled) {
      const more = button('更多内容操作', 'ellipsis', () => this.openPlanningContentMenu(node), 'nt-content-more nt-icon');
      more.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); }); node.append(more);
    }
    const directions = text ? ['e','e'] : ['se','e','s','sw','w','nw','n','ne'];
    const names = {se:'右下角',e:'右侧',s:'下边',sw:'左下角',w:'左侧',nw:'左上角',n:'上边',ne:'右上角'};
    for (const [index,direction] of directions.entries()) {
      const resize = el('button', `nt-element-resize${index === 0 ? ' nt-resize-primary' : ''}`);
      resize.type = 'button'; resize.dataset.resizeDirection = direction; resize.tabIndex = -1;
      resize.setAttribute('aria-label',text ? '调整内容宽度' : `从${names[direction]}调整内容大小`);
      resize.title = text ? '拖动调整文字宽度' : element.type === 'image' && !element.origin.region ? '拖动等比调整图片大小' : '拖动调整大小 · Shift 保持比例';
      if (text && index === 0) { resize.classList.add('nt-text-width-handle'); resize.append(notebookIcon('resize-width')); }
      if (text && index === 1) resize.classList.add('nt-text-edge-resize');
      resize.addEventListener('pointerdown', event => this.resizeElement(event, element, node, direction)); node.append(resize);
    }
    if (element.origin.kind === 'canvas') {
      const source = button(element.origin.region ? '查看画布区域' : '查看画布来源', 'external-link', async () => { try { await this.bridge.locateSource(element.origin); } catch(error) { this.toast(error.message); } }, 'nt-origin');
      source.removeAttribute('title'); source.setAttribute('aria-description', `独立副本 · ${element.origin.label || '画布来源'} · 编辑副本不改变原稿`); node.append(source);
      if (element.origin.region) {
        node.classList.add('nt-reference-card'); source.remove();
        const controls = el('div', 'nt-reference-controls'); const status = el('span', 'nt-reference-status', '尚未检查更新'); status.setAttribute('role','status');
        const info=el('div','nt-reference-info');info.append(el('small','nt-reference-kind','区域快照 · 手动刷新'),el('strong','',element.origin.label||'画布区域'),status);
        const actions=el('div','nt-reference-actions');const refresh=button('刷新预览','image',()=>this.refreshRegion(element));setControlAvailability(refresh,readonly,'当前页面只读');actions.append(source,button('检查更新','refresh-cw',()=>this.checkRegion(element,status),'nt-reference-check'),refresh); source.className='nt-reference-source';
        controls.append(info,actions);node.append(controls);
        body.setAttribute('role', 'button'); body.tabIndex = 0; body.setAttribute('aria-label', '打开引用的画布区域');
        const locate = async () => { try { await this.bridge.locateSource(element.origin); } catch(error) { this.toast(error.message); } };
        body.addEventListener('click', locate);
        body.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); locate(); } });
        this.checkRegion(element, status);
      }
    }
    if (element.type === 'planning') {
      const controls = { move: event => this.dragElement(event, element, node), focus:()=>this.focusPlanningComponent(element.id), remove: () => { this.select(element.id); this.removeSelected(); }, writable: () => this.writable() };
      const changeView = view => { if (!this.writable()) return; this.remember(); element.planView = view; this.changed(); body.replaceChildren(window.MusePlanning.mount(element, changeView, controls)); };
      body.append(window.MusePlanning.mount(element, changeView, controls));
    } else if (element.taskRef && window.MusePlanning?.enabled) {
      body.append(window.MusePlanning.renderLinked(element.taskRef, plainText(element.doc)));
    } else if (['text', 'callout', 'tag'].includes(element.type)) {
      if (element.fill) node.style.backgroundColor = element.fill;
      renderText(element, body); this.contentObserver.observe(body); body.addEventListener('pointerdown', event => { if (event.button!==0 || this.tool !== 'text') return; event.stopPropagation(); if(event.shiftKey && this.editingId!==element.id || this.touchMultiSelect){event.preventDefault();this.finishEdit();this.select(element.id,true);this.surface.focus({preventScroll:true});return;} if(this.editingId!==element.id)event.preventDefault(); this.startEdit(element, body, event); });
    } else if (element.type === 'image') { const image = el('img'); image.src = element.src; image.alt = element.alt || '笔记图片'; image.draggable = false; image.loading = 'lazy'; image.addEventListener('error', () => { image.hidden = true; body.append(el('span', 'nt-image-error', '图片暂不可用，请检查网络后重新打开')); }); body.append(image); }
    else if (element.type === 'mindmap') this.renderMindmap(element, body);
    else if (element.type === 'shape') {
      if(element.shape==='triangle'){
        const shape=document.createElementNS('http://www.w3.org/2000/svg','svg');
        shape.classList.add('nt-shape-content','nt-shape-triangle');shape.setAttribute('viewBox','0 0 100 100');shape.setAttribute('preserveAspectRatio','none');
        const outline=document.createElementNS('http://www.w3.org/2000/svg','polygon');
        outline.setAttribute('points','50,1 99,99 1,99');outline.setAttribute('fill',element.fill||'none');outline.setAttribute('stroke',element.color);
        outline.setAttribute('stroke-width','2');outline.setAttribute('vector-effect','non-scaling-stroke');shape.append(outline);body.append(shape);
      }else{const shape = el('div', `nt-shape-content nt-shape-${element.shape}`); shape.style.backgroundColor = element.fill; shape.style.borderColor = element.color; body.append(shape);}
    }
    else if (element.type === 'ink') this.renderInk(element, body);
    node.addEventListener('pointerdown', event => { if (event.button!==0 || this.tool !== 'text' || event.target.closest('button,input,.tiptap')) return; this.finishEdit(); this.select(element.id, event.shiftKey || this.touchMultiSelect); this.surface.focus({preventScroll:true}); });
    this.surface.append(node); hydrateNotebookTasks(node); return node;
  }
  positionElement(node, element) { Object.assign(node.style, { left: `${element.x}px`, top: `${element.y}px`, width: `${element.w}px`, minHeight: `${element.h}px` }); if (!['text', 'tag', 'callout'].includes(element.type)) node.style.height = `${element.h}px`; }
  async checkRegion(element, status) {
    const context = this.context();
    const token = uid(); status.dataset.checkToken = token; status.textContent = '正在检查更新…'; status.setAttribute('aria-busy','true');
    try {
      const origin = element.origin; let result;
      if (this.store.guest) {
        const boards = await this.bridge.guestCanvases(); const board = boards.find(board => board.id === origin.boardId);
        if (!board) throw new Error('来源画布已删除或不可访问');
        const items = regionItems(board.snapshot?.items || [], origin.region.bounds); result = { revision: regionRevision(items), empty: !items.length };
      } else result = await this.store.api('/region-status', { boardId: origin.boardId, bounds: origin.region.bounds });
      if (this.current(context) && status.isConnected && status.dataset.checkToken===token) { status.dataset.state=result.empty?'warning':result.revision===origin.region.revision?'current':'warning'; status.textContent = result.empty ? '原区域已空 · 保留上次预览' : result.revision === origin.region.revision ? '预览已是最新' : '源区域有更新 · 点击刷新预览'; }
    } catch(error) { if (this.current(context) && status.isConnected && status.dataset.checkToken===token) {status.dataset.state='error';status.textContent = `${error.message} · 保留上次预览`;} }
    finally {if(status.dataset.checkToken===token)status.removeAttribute('aria-busy');}
  }
  async refreshRegion(element) {
    if (!this.writable() || this.refreshingRegion) return;
    this.refreshingRegion = true; const context = this.context();
    const nodeAtStart=[...this.surface.querySelectorAll('[data-element-id]')].find(node=>node.dataset.elementId===element.id);
    const initialStatus=nodeAtStart?.querySelector('.nt-reference-status');
    if(initialStatus){initialStatus.dataset.checkToken=uid();initialStatus.textContent='正在刷新预览…';initialStatus.setAttribute('aria-busy','true');}
    try {
      const result = await this.bridge.captureRegion(element.origin);
      if (!this.current(context)) return;
      if (this.root.hidden || !this.current(context) || !this.writable()) return;
      const src = await this.imageSource(result.blob, context);
      if (!this.current(context) || !this.writable() || !this.page.elements.includes(element)) return;
      this.remember(); element.src = src; element.origin = result.origin; this.changed();
      const node = [...this.surface.querySelectorAll('[data-element-id]')].find(node => node.dataset.elementId === element.id);
      if (node) {
        const image = node.querySelector('img'); if (image) image.src = src;
        const status = node.querySelector('.nt-reference-status'); if (status) {status.textContent = '预览已是最新';status.dataset.state='current';}
      }
    } catch(error) { if (this.current(context)) {if(initialStatus?.isConnected){initialStatus.textContent=`${error.message} · 保留上次预览`;initialStatus.dataset.state='error';}else this.toast(error.message);} }
    finally { this.refreshingRegion = false; initialStatus?.removeAttribute('aria-busy'); }
  }
  renderInk(element, body) {
    const canvas = el('canvas'); const ratio = Math.min(2, 2048 / Math.max(element.w, element.h), Math.sqrt(4000000 / (element.w * element.h))); canvas.width = Math.ceil(element.w * ratio); canvas.height = Math.ceil(element.h * ratio); canvas.style.width = '100%'; canvas.style.height = '100%'; body.append(canvas);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.strokeStyle = element.color || '#34313d'; ctx.lineWidth = element.size || 3; ctx.lineJoin = ctx.lineCap = 'round'; ctx.globalAlpha = element.highlighter ? .3 : element.opacity ?? 1; ctx.beginPath();
    element.points.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])); ctx.stroke();
  }
  renderMindmap(element, body) {
    const root = el('div', 'nt-mind-tree');
    const render = (node, parent) => {
      const branch = el('div', 'nt-mind-branch'); const box = el('div', 'nt-mind-node'); const input = el('input'); input.value = node.text; input.setAttribute('aria-label', '脑图节点'); input.readOnly = this.readOnly;
      input.addEventListener('focus', () => { this.finishEdit(); this.select(element.id); });
      box.dataset.planningNode = node.id;
      if (window.MusePlanning?.enabled) box.append(button('更多节点操作', 'ellipsis', () => this.openPlanningContentMenu(box), 'nt-icon'));
      if (node.taskRef && window.MusePlanning?.enabled) {
        input.value = window.MusePlanning.getTask(node.taskRef)?.title || '无权访问'; input.readOnly = true;
        input.addEventListener('click', () => window.MusePlanning.editTask(node.taskRef));
        const task = window.MusePlanning.getTask(node.taskRef), status = button(task?.deleted ? '已删除' : window.MusePlanning.statusLabel(task?.status) || '无权访问', '', async () => {
          const current = window.MusePlanning.getTask(node.taskRef); if (!this.writable() || !current || current.deleted) return;
          status.disabled = true;
          try { window.MusePlanning.chooseStatus(node.taskRef); } finally { status.disabled = !this.writable(); }
        }, 'nt-task-status');
        status.disabled = !this.writable() || !task || task.deleted; status.dataset.status = task?.status || ''; status.setAttribute('aria-label', `切换任务状态：${task?.title || node.text}`); box.dataset.status = task?.status || ''; box.append(status);
        box.append(button('任务详情', 'list-checks', () => window.MusePlanning.editTask(node.taskRef), 'nt-icon'));
      }
      this.fitMindmapInput(input);
      input.addEventListener('input', () => { if (!this.writable()) return; this.remember(`mind:${node.id}`); node.text = input.value; this.fitMindmapInput(input); this.fitMindmapFrame(element, body); this.changed(); });
      const add = sibling => { if (!this.writable()) return; this.remember(); const next = { id: uid('node'), text: '新节点', children: [] }; (sibling && parent ? parent : node).children.push(next); node.collapsed = false; this.changed(); this.renderPage(); const inputs = this.surface.querySelectorAll('.nt-mind-node input'); [...inputs].find(candidate => candidate.value === '新节点')?.select(); };
      input.addEventListener('keydown', event => { if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return; if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); add(event.key === 'Enter'); } });
      box.append(input, button('添加子节点', 'plus', () => add(false), 'nt-icon'));
      if (node.children.length) box.append(button(node.collapsed ? '展开分支' : '折叠分支', node.collapsed ? 'chevron-right' : 'chevron-down', () => { if (!this.writable()) return; this.remember(); node.collapsed = !node.collapsed; this.changed(); this.renderPage(); }, 'nt-icon'));
      if (parent) box.append(button('删除节点', 'x', () => { if (!this.writable()) return; this.remember(); parent.children = parent.children.filter(child => child !== node); this.changed(); this.renderPage(); }, 'nt-icon'));
      branch.append(box); if (!node.collapsed && node.children.length) { const children = el('div', 'nt-mind-children'); node.children.forEach(child => children.append(render(child, node))); branch.append(children); } return branch;
    };
    root.append(render(element.tree)); body.append(root);
    this.fitMindmapFrame(element, body);
  }
  fitMindmapInput(input) {
    const context = document.createElement('canvas').getContext('2d'); context.font = '13px system-ui, "Microsoft YaHei"';
    input.style.width = `${Math.max(130, Math.ceil(context.measureText(input.value).width) + 20)}px`;
  }
  fitMindmapFrame(element, body) {
    requestAnimationFrame(() => { if (!body.isConnected) return; element.w = Math.max(element.w, body.scrollWidth + 20); element.h = Math.max(element.h, body.querySelector('.nt-mind-tree')?.scrollHeight + 20 || 0); this.positionElement(body.parentElement, element); this.updateSize(); this.refreshConnectors?.(); });
  }
  startEdit(element, body, event, editLinkedSource = false) {
    if (element.taskRef && window.MusePlanning?.enabled && !editLinkedSource) { window.MusePlanning.editTask(element.taskRef); return; }
    if (!this.writable()) return;
    if (this.editingId === element.id) return;
    this.finishEdit(); this.select(element.id); this.editingId = element.id;
    const linked = element.taskRef && window.MusePlanning?.enabled ? window.MusePlanning.getTask(element.taskRef) : null;
    this.planningEdit = linked ? { ref: element.taskRef, task: clone(linked) } : null;
    if (element.taskRef && window.MusePlanning?.enabled && !linked) { this.editingId = null; return this.toast('无权访问任务'); }
    if (linked) element.doc = replaceDocTitle(element.doc, linked.title);
    this.editor = editText(element, body, { change: doc => { if (!this.writable()) return; this.remember(`text:${element.id}`); element.doc = doc; element.h = Math.max(48, body.scrollHeight); this.changed(); this.syncFormat(); }, undo: forward => this.undo(forward), selection: () => { const table = Boolean(this.editor?.isActive('table')); if (this.tab === '插入' && table !== this.ribbonTable) this.renderRibbon(); else this.syncFormat(); } });
    if (event) { const position = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY }); this.editor.commands.focus(position?.pos ?? 'end'); } else this.editor.commands.focus('end');
    body.parentElement.classList.add('nt-text-editing');
    if(element.type==='text' && !plainText(element.doc).trim() && element.doc?.content?.every(node=>node.type==='paragraph'))body.parentElement.classList.add('nt-text-draft');
    this.editor.view.focus(); this.renderRibbon();
  }
  finishEdit() {
    this.hideTextToolbar?.();
    if (!this.editor) return;
    const id = this.editingId; const element = this.page?.elements.find(element => element.id === id); const body = this.surface.querySelector(`[data-element-id="${id}"] .nt-element-body`);
    body?.parentElement.classList.remove('nt-text-editing','nt-text-draft'); this.editor.destroy(); this.editor = null; this.editingId = null; this.syncFormat();
    if (element && this.planningEdit) {
      const { ref, task } = this.planningEdit, title = plainText(element.doc).split('\n')[0].trim();
      if (title && title !== task.title) window.MusePlanning.updateTask(ref, { title }, task.revision).catch(error => this.toast(error.message));
      if (body) body.replaceChildren(window.MusePlanning.renderLinked(ref, plainText(element.doc))); this.planningEdit = null; return;
    }
    if (element && body) { renderText(element, body); if (!plainText(element.doc).trim() && element.doc?.content?.every(node => node.type === 'paragraph' && !node.content?.length)) { this.page.elements = this.page.elements.filter(entry => entry !== element); this.selection.delete(id); this.contentObserver.unobserve(body); body.parentElement.remove(); this.changed(); } }
  }
  select(id, additive = false) { if (!additive) this.selection.clear(); if (additive && this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this.updateSelection(); }
  updateSelection() { for (const node of this.surface.querySelectorAll('[data-element-id]')) node.classList.toggle('selected', this.selection.has(node.dataset.elementId)); }
  removeSelected() { if (!this.writable() || !this.selection.size) return; this.finishEdit(); this.remember(); const removed = new Set([...this.selection, ...brainConnectorIds(this.page.elements, this.selection)]); this.page.elements = this.page.elements.filter(element => !removed.has(element.id)); this.selection.clear(); this.changed(); this.renderPage(); }
  pageWidth() { const gutter=matchMedia('(max-width:1100px)').matches?20:72;return Math.max(Math.min(980, Math.max(280,this.$('.nt-scroll').clientWidth / this.zoom)), ...this.page.elements.map(element => element.x + element.w + gutter)); }
  updateSize() {
    if (!this.page) return; const width = Math.max(this.resizeExtent?.width || 0, this.pageWidth()); const height = Math.max(1000, this.resizeExtent?.height || 0, ...this.page.elements.map(element => element.y + (this.measuredHeights.get(element) || element.h) + 160));
    if (this.resizeExtent) Object.assign(this.resizeExtent, { width, height });
    this.$('.nt-paper').style.width = `${width}px`; this.surface.style.height = `${height}px`; this.$('.nt-paper-wrap').style.width = `${width * this.zoom}px`; this.$('.nt-paper-wrap').style.height = `${(height + this.$('.nt-title-block').offsetHeight) * this.zoom}px`;
  }
  setZoom(value, anchor = null) {
    const scroll = this.$('.nt-scroll'); const point = anchor || { x: scroll.clientWidth / 2, y: scroll.clientHeight / 2 };
    const x = (scroll.scrollLeft + point.x) / this.zoom, y = (scroll.scrollTop + point.y) / this.zoom;
    this.zoom = Math.max(.3, Math.min(2, value)); this.$('.nt-paper').style.transform = `scale(${this.zoom})`;
    this.surface.style.setProperty('--note-zoom', String(this.zoom));
    this.$('.nt-zoom-label').textContent = `${Math.round(this.zoom * 100)}%`; this.updateSize();
    scroll.scrollLeft = x * this.zoom - point.x; scroll.scrollTop = y * this.zoom - point.y;
    this.renderElements();
  }
  point(event) { const rect = this.surface.getBoundingClientRect(); return { x: Math.max(0, (event.clientX - rect.left) / this.zoom), y: Math.max(0, (event.clientY - rect.top) / this.zoom) }; }
  visiblePoint() { const point = { x: this.$('.nt-scroll').scrollLeft / this.zoom + 64, y: this.$('.nt-scroll').scrollTop / this.zoom + 48 }; for (let attempt = 0; attempt < 5000; attempt++) { const collision = this.page.elements.find(element => element.x < point.x + 420 && element.x + element.w > point.x && element.y < point.y + 120 && element.y + element.h > point.y); if (!collision) break; point.y = collision.y + collision.h + 32; } return point; }
  insert(type, point = this.visiblePoint()) {
    if(['text','callout','tag','table'].includes(type)){this.tool='text';this.touchMultiSelect=false;}
    if (!this.writable()) return; this.finishEdit(); this.remember(); const element = createElement(type === 'table' ? 'text' : type, point); if (innerWidth <= 1100 && ['text','callout','tag','table'].includes(type)) { element.x = Math.min(24,element.x); element.w = Math.max(200,this.$('.nt-scroll').clientWidth / this.zoom - 48); }
    if (type === 'table') element.doc = tableDoc(); if (type === 'tag') { element.doc = textDoc('标签'); element.w = 170; element.h = 48; }
    this.page.elements.push(element); this.changed(); this.selection = new Set([element.id]); this.renderPage();
    if (['text', 'callout', 'tag', 'table'].includes(type)) this.startEdit(element, this.surface.querySelector(`[data-element-id="${element.id}"] .nt-element-body`));
    return element;
  }
  pointerDown(event) {
    if (event.button !== 0 || !this.writable() || event.target.closest('button,input,.tiptap')) return;
    if (this.pending) { event.preventDefault(); const point = this.point(event); this.place(this.pending, point); this.pending = null; this.syncMaterialSelection(); this.tool = 'text'; this.$('.nt-status-hint').textContent = '已插入独立副本，可继续选择素材'; return; }
    if (this.tool === 'eraser') {
      event.preventDefault(); const ids = new Set();
      const collect = next => { const point = this.point(next); for (const element of this.page.elements) if (element.type === 'ink' && point.x >= element.x && point.x <= element.x + element.w && point.y >= element.y && point.y <= element.y + element.h) ids.add(element.id); };
      collect(event); this.track(event, collect, cancelled => { if (cancelled || !ids.size || !this.writable()) return; this.remember(); this.page.elements = this.page.elements.filter(element => !ids.has(element.id)); this.selection.clear(); this.changed(); this.renderPage(); }); return;
    }
    if (this.tool !== 'text') { this.draw(event); return; }
    if (event.target.closest('[data-element-id]')) return;
    event.preventDefault();
    // Touch taps are delivered after native pan/pinch recognition has already ended.
    if (event.pointerId === undefined) { this.insert('text', this.point(event)); return; }
    this.selectOrWrite(event);
  }
  selectOrWrite(event) {
    this.finishEdit();const start=this.point(event),previous=new Set(this.selection),base=event.shiftKey?previous:new Set();
    let dragging=false,preview=null;
    this.track(event,next=>{
      const end=this.point(next);
      if(!dragging&&Math.hypot(end.x-start.x,end.y-start.y)*this.zoom<6)return;
      dragging=true;
      preview ||= el('div','nt-selection-marquee');if(!preview.isConnected)this.surface.append(preview);
      const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y),w=Math.abs(end.x-start.x),h=Math.abs(end.y-start.y);
      Object.assign(preview.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});
      this.selection=new Set([...base,...this.page.elements.filter(e=>e.x+e.w>=x&&e.x<=x+w&&e.y+(this.measuredHeights.get(e)||e.h)>=y&&e.y<=y+h).map(e=>e.id)]);
      this.updateSelection();
    },cancelled=>{
      preview?.remove();
      if(cancelled){this.selection=previous;this.updateSelection();return;}
      if(dragging){this.renderElements();this.updateSelection();this.surface.focus({preventScroll:true});return;}
      this.insert('text',start);
    });
  }
  dragElement(event, element, node) {
    if (event.button !== 0 || !this.writable()) return; event.preventDefault(); event.stopPropagation(); this.finishEdit();
    if (!this.page.elements.includes(element)) return;
    if (!this.selection.has(element.id)) this.select(element.id, event.shiftKey); this.remember(); node.classList.add('nt-dragging');
    const start = this.point(event); const selected = this.page.elements.filter(element => this.selection.has(element.id)).map(element => ({ element, x: element.x, y: element.y }));
    const move = next => { const point = this.point(next); for (const entry of selected) { entry.element.x = Math.max(0, entry.x + point.x - start.x); entry.element.y = Math.max(0, entry.y + point.y - start.y); const target = this.surface.querySelector(`[data-element-id="${entry.element.id}"]`); if (target) this.positionElement(target, entry.element); } this.updateSize(); };
    this.track(event, move, cancelled => { node.classList.remove('nt-dragging'); if (cancelled) { for (const entry of selected) Object.assign(entry.element, {x:entry.x,y:entry.y}); this.renderPage(); } else this.changed(); });
  }
  resizeElement(event, element, node, direction = 'se') {
    if (event.button !== 0 || !this.writable()) return;
    event.preventDefault(); event.stopPropagation(); this.finishEdit(); this.select(element.id); this.remember();
    const scroll=this.$('.nt-scroll');
    this.resizeExtent = { width: parseFloat(this.$('.nt-paper').style.width), height: parseFloat(this.surface.style.height) };
    this.root.classList.add('nt-resizing-element');
    const start = {x:event.clientX,y:event.clientY,scrollX:scroll.scrollLeft,scrollY:scroll.scrollTop}, bounds = {x:element.x,y:element.y,w:element.w,h:element.h};
    const text = ['text','callout','tag'].includes(element.type);
    this.track(event, next => {
      const dx=(next.clientX-start.x+scroll.scrollLeft-start.scrollX)/this.zoom,dy=(next.clientY-start.y+scroll.scrollTop-start.scrollY)/this.zoom;
      Object.assign(element,resizeBounds(bounds,direction,dx,dy,{text,minWidth:element.origin.region ? 220 : text ? 100 : 24,minHeight:element.origin.region ? 220 : 24,proportional:element.type === 'image' && !element.origin.region || Boolean(next.shiftKey)}));
      this.positionElement(node,element); this.updateSize();
    }, cancelled => {
      this.resizeExtent = null; this.root.classList.remove('nt-resizing-element');
      if (cancelled) Object.assign(element,bounds);
      else {
        if (element.type === 'ink') {
          const sx=element.w/bounds.w, sy=element.h/bounds.h;
          element.points=element.points.map(([x,y,...rest])=>[x*sx,y*sy,...rest]);
          element.size=(element.size || 3)*Math.sqrt(sx*sy);
          const body=node.querySelector('.nt-element-body'); body.replaceChildren(); this.renderInk(element,body);
        }
        this.changed();
      }
      this.positionElement(node,element); this.updateSize();
    });
  }
  track(event, move, done) {
    const context = this.context(); const pointerId = event.pointerId;
    const target=event.target;
    try { target?.setPointerCapture?.(pointerId); } catch { /* Synthetic or already canceled pointer. */ }
    const update = next => { if (next.pointerId === pointerId && this.current(context)) move(next); };
    const cleanup = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape, true); this.gestures.delete(cancel); try { if(target?.hasPointerCapture?.(pointerId))target.releasePointerCapture(pointerId); } catch { /* Detached target. */ } };
    const cancel = event => { if (event && event.pointerId !== pointerId) return; cleanup(); done(true); };
    const up = next => { if (next.pointerId !== pointerId) return; cleanup(); done(!this.current(context)); };
    // Cancel a pointer operation before search/material panels consume Escape.
    // Otherwise closing a panel can leave the drag alive until pointerup commits.
    const escape = key => { if (key.key !== 'Escape' || key.isComposing || key.keyCode === 229) return; key.preventDefault(); key.stopImmediatePropagation(); for(const cancel of [...this.gestures])cancel(); };
    this.gestures.add(cancel); window.addEventListener('pointermove', update); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape, true);
  }
  draw(event) {
    event.preventDefault(); this.finishEdit(); const start = this.point(event); const kind = this.tool; const points = [[start.x, start.y, event.pressure || .5]];
      const preview = el('div', 'nt-draw-preview'); this.surface.append(preview);
    let end = start;
    const stroke = ['pen','highlighter'].includes(kind) ? document.createElementNS('http://www.w3.org/2000/svg','svg') : null;
    let path;
    if (stroke) { stroke.classList.add('nt-stroke-preview'); path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('fill','none'); path.setAttribute('stroke',this.penColor || '#7660bd'); path.setAttribute('stroke-width',String(kind === 'highlighter' ? 16 : this.penSize || 3)); path.setAttribute('stroke-linecap','round'); if (kind === 'highlighter') path.setAttribute('opacity','.3'); stroke.append(path); preview.append(stroke); preview.classList.add('nt-preview-ink'); }
    const paint = () => { if (stroke) { preview.style.cssText = 'inset:0;width:100%;height:100%;'; path.setAttribute('d', points.map((p,i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')); return; } Object.assign(preview.style, { left: `${Math.min(start.x, end.x)}px`, top: `${Math.min(start.y, end.y)}px`, width: `${Math.max(2, Math.abs(start.x - end.x))}px`, height: `${Math.max(2, Math.abs(start.y - end.y))}px` }); };
    this.track(event, next => { end = this.point(next); if (points.length < 100000) points.push([end.x, end.y, next.pressure || .5]); paint(); }, cancelled => {
      preview.remove(); if (cancelled || !this.writable()) return;
      if (kind === 'lasso') { this.selection = new Set(this.page.elements.filter(element => element.x + element.w >= Math.min(start.x, end.x) && element.x <= Math.max(start.x, end.x) && element.y + element.h >= Math.min(start.y, end.y) && element.y <= Math.max(start.y, end.y)).map(element => element.id)); this.updateSelection(); this.surface.focus({preventScroll:true}); return; }
      this.remember(); const isInk = ['pen', 'highlighter'].includes(kind); const x = isInk ? Math.min(...points.map(point => point[0])) : Math.min(start.x,end.x); const y = isInk ? Math.min(...points.map(point => point[1])) : Math.min(start.y,end.y); const element = createElement(isInk ? 'ink' : 'shape', { x, y });
      element.w = isInk ? Math.max(8, Math.max(...points.map(point => point[0])) - x + 8) : Math.max(8,Math.abs(end.x-start.x)+8); element.h = isInk ? Math.max(8, Math.max(...points.map(point => point[1])) - y + 8) : Math.max(8,Math.abs(end.y-start.y)+8);
      if (isInk) Object.assign(element, { points: points.map(point => [point[0] - x + 2, point[1] - y + 2, point[2]]), color: this.penColor || '#7660bd', size: kind === 'highlighter' ? 16 : this.penSize || 3, highlighter: kind === 'highlighter' });
      else { element.shape = kind; element.color = this.penColor || '#7660bd'; }
      this.page.elements.push(element); this.changed(); this.renderPage();
    });
  }
  place(elements, point, {reveal=true} = {}) {
    if (!this.writable()) return; this.finishEdit(); this.remember(); const left = Math.min(...elements.map(element => element.x)); const top = Math.min(...elements.map(element => element.y));
    const copies = cloneElements(elements, point.x - left, point.y - top);
    if(copies.length===1&&matchMedia('(max-width:1100px)').matches){
      const element=copies[0], available=Math.max(160,this.$('.nt-scroll').clientWidth/this.zoom-40);element.x=Math.min(20,element.x);
      if(element.w>available&&['text','callout','tag','image','mindmap'].includes(element.type)){const ratio=available/element.w;element.w=available;if(element.type==='image')element.h=Math.max(element.origin.region?240:80,element.h*ratio);}
    }
    this.page.elements.push(...copies); this.selection = new Set(copies.map(element => element.id)); this.changed(); this.renderPage();
    if(reveal)this.revealElement(copies[0]?.id);else this.surface.focus({preventScroll:true}); this.selection = new Set(copies.map(element => element.id)); this.updateSelection(); return copies;
  }
  toggleMaterials() { const panel = this.$('.nt-materials'); panel.hidden = !panel.hidden; this.root.classList.toggle('nt-materials-open',!panel.hidden); if (!panel.hidden) {this.dismissSearch?.();this.closeNavigation();this.loadMaterials();} }
  async loadMaterials(offset = 0) {
    const list = this.$('.nt-material-list'); if (!offset) { this.materialSelectionToken = null; this.pending = null; this.syncMaterialSelection(); } if (!offset) list.textContent = '正在读取画布素材…';
    const context = this.context(); const query = this.$('.nt-materials input').value; const type = this.$('[aria-label="筛选素材类型"]').value; const boardId = this.$('.nt-material-board').value; const token = uid(); this.materialToken = token;
    try {
      let response;
      if (this.store.guest) {
        const canvases = await this.bridge.guestCanvases(); const all = canvases.filter(canvas => !boardId || canvas.id === boardId).flatMap(canvas => (canvas.snapshot?.items || []).map(item => ({ id: item.id, boardId: canvas.id, boardName: canvas.name, type: item.type, label: sourceText(item), item })));
        const matches = all.filter(item => (!type || item.type === type) && `${item.boardName} ${item.label}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())); response = { canvases: canvases.map(({id,name}) => ({id,name})), materials: matches.slice(offset, offset + 80), next: offset + 80 < matches.length ? offset + 80 : null };
      } else response = await context.store.api(`/materials?boardId=${encodeURIComponent(boardId)}&q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&offset=${offset}`);
      if (!this.current(context, false) || this.materialToken !== token) return;
      const selector = this.$('.nt-material-board');
      selector.replaceChildren(new Option('所有画布', ''), ...(response.canvases || []).map(canvas => new Option(canvas.name || '未命名画布', canvas.id)));
      selector.value = boardId;
      if (boardId && !selector.value) { selector.value = ''; return this.loadMaterials(); }
      if (!offset) list.replaceChildren();
      for (const material of response.materials) {
        const row = button(material.label.slice(0, 65) || material.type, ({ image: 'image', mindmap: 'network', ink: 'pen-tool' })[material.type] || 'file-text', async () => {
          const target = this.context(); const selectionToken = uid(); this.materialSelectionToken = selectionToken; try { const elements = material.item ? [fromCanvas(material.item, { boardId: material.boardId, label: material.boardName })] : (await context.store.api('/materials/convert', { boardId: material.boardId, entityId: material.id, label: material.boardName })).elements;
            if (!this.current(target) || this.materialToken !== token || this.materialSelectionToken !== selectionToken) return; this.finishEdit(); this.pending = elements; this.tool = 'text'; this.$('.nt-status-hint').textContent = '已选择素材 · 可插入或取消'; this.toast(matchMedia('(max-width:1100px)').matches?'已选择素材，点击底部“插入可见区域”':'点击笔记页放置；也可使用下方“插入可见区域”');
            list.querySelectorAll('.nt-material').forEach(node=>{node.classList.toggle('active',node===row);node.setAttribute('aria-pressed',String(node===row));});this.syncMaterialSelection(material.label.slice(0,50)||'已选择素材');
          } catch (error) { this.toast(error.message); }
        }, 'nt-material'); row.append(el('small', '', material.boardName)); row.draggable = true; row.addEventListener('dragstart', event => event.dataTransfer.setData('application/muse-canvas-material', JSON.stringify(material))); list.append(row);
        row.setAttribute('aria-pressed','false');materialPreview(row,material,el);
      }
      if (!response.materials.length && !offset) list.append(el('p', 'nt-list-empty', boardId || query || type ? '没有符合筛选条件的素材，试试其他画布或清除筛选。' : '没有可用素材。你可以先在画布创建内容。'));
      if (response.next !== null) list.append(button('加载更多素材', 'chevrons-down', event => { event.currentTarget.remove(); this.loadMaterials(response.next); }));
      icons();
    } catch (error) { if (this.current(context, false) && this.materialToken === token) list.textContent = error.message; }
  }
  async drop(event) {
    event.preventDefault(); if (!this.writable()) return;
    const context = this.context(); const point = this.point(event); const data = event.dataTransfer.getData('application/muse-canvas-material');
    if (data) { try { const material = JSON.parse(data); const elements = material.item ? [fromCanvas(material.item, { boardId: material.boardId, label: material.boardName })] : (await context.store.api('/materials/convert', { boardId: material.boardId, entityId: material.id })).elements; if (this.current(context)) this.place(elements, point); } catch (error) { this.toast(error.message); } return; }
    for (const file of event.dataTransfer.files) { if (!this.current(context)) break; if (file.type.startsWith('image/')) await this.uploadImage(file, point); }
  }
  chooseImage() { const context = this.context(); const input = el('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = true; input.addEventListener('change', async () => { for (const file of input.files) { if (!this.current(context)) break; await this.uploadImage(file); } }); input.click(); }
  async uploadImage(file, point = this.visiblePoint()) {
    if (!this.writable()) return; const context = this.context();
    try {
      const element = createElement('image', point); element.src = await this.imageSource(file, context);
      if (!this.current(context)) return;
      const image = new Image(); image.src = element.src; await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('图片解码超时')), 15000))]);
      if (!this.current(context)) return;
      element.h = Math.max(8, Math.min(20000, element.w * image.naturalHeight / image.naturalWidth)); element.alt = file.name; this.place([element], point);
    } catch (error) { if (this.current(context) && error.name !== 'AbortError') this.toast('图片未插入：' + error.message); }
  }
  async imageSource(file, context) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('请选择不超过 15 MB 的 PNG、JPEG 或 WebP 图片');
    if (context.store.guest) return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
    if (!this.current(context, false)) throw new DOMException('操作已取消', 'AbortError');
    const response = await fetch('/api/assets', { method:'POST', signal:AbortSignal.any([context.store.controller.signal, AbortSignal.timeout(20000)]), headers:{'content-type':file.type,'x-csrf-token':window.MuseAccount?.csrfToken?.() || ''}, body:file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '图片上传失败'); return result.url || result.src;
  }
  copy(event,cut=false) { if (this.editor || event.target.closest('input,textarea') || !this.selection.size) return; event.preventDefault(); const elements = this.page.elements.filter(element => this.selection.has(element.id)); this.clipboard = clone(elements); event.clipboardData.setData('text/plain', elements.map(elementText).join('\n')); if(cut && this.writable())this.removeSelected(); }
  paste(event) {
    if (event.target.closest('input,textarea') || !this.writable()) return;
    const text = event.clipboardData.getData('text/plain');
    if(this.clipboard?.length && this.clipboard.map(elementText).join('\n')===text){
      event.preventDefault();event.stopPropagation();
      const point=this.pasteTarget?.pageId===this.page.id?this.pasteTarget.point:this.visiblePoint();
      this.place(this.clipboard,point,{reveal:false});return;
    }
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); event.stopPropagation(); files.forEach(file => this.uploadImage(file)); return; }
    if (this.editor) return;
    event.preventDefault(); event.stopPropagation();
    const element = createElement('text', this.visiblePoint()); element.doc = textDoc(text); this.place([element], this.visiblePoint());
  }
  keyDown(event) {
    if(event.defaultPrevented || event.isComposing || event.keyCode===229)return;
    event.stopPropagation(); if (event.isComposing) return;
    const input = event.target.closest('input,textarea,.tiptap'); const modifier = event.ctrlKey || event.metaKey;
    if(event.key==='Escape' && this.formatPainter){event.preventDefault();this.formatPainter=null;this.syncFormatPainter?.();this.$('.nt-status-hint').textContent='格式刷已取消';this.updateTextToolbar?.();return;}
    if (event.key === 'Escape') { this.formatPainter=null; for (const cancel of this.gestures) cancel(); this.root.classList.remove('nt-navigation-open'); this.surface.dataset.drawing = 'false'; this.finishEdit(); this.pending = null; this.tool = 'text'; this.selection.clear(); this.updateSelection(); this.renderRibbon(); }
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); this.store.flush(); }
    if (modifier && event.key.toLowerCase() === 'z' && !input) { event.preventDefault(); this.undo(event.shiftKey); }
    if (modifier && event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); this.newPage(); }
    if (!input && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); this.removeSelected(); }
    if (!input && modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); this.selection = new Set(this.page.elements.map(element => element.id)); this.updateSelection(); }
  }
}

let instance;
export function initialize(bridge) { instance ||= new NotebookApp(bridge); return instance; }
export function show() { return instance?.show(); }
export function hide() { return instance?.hide(); }
export function rememberSourceReturn() {
  if (!instance?.page || instance.root.hidden) return;
  instance.saveView();
  instance.returnContext = { scope: instance.scope, bookId: instance.book.id, pageId: instance.page.id, view: { ...instance.views.get(instance.page.id) }, selection: [...instance.selection] };
}
export async function returnToNote() {
  const saved = instance?.returnContext;
  if (!saved || saved.scope !== (window.MuseAccount?.session?.user?.id || 'guest')) return;
  await instance.show();
  const context = instance.context(), book = await instance.store.getBook(saved.bookId);
  if (!instance.current(context, false) || instance.root.hidden) return;
  const page = book.pages.find(page => page.id === saved.pageId && !page.deleted);
  if (book.deleted || !page) { instance.returnContext = null; return instance.toast('原笔记已删除'); }
  await instance.openPage(book, page);
  if (!instance.current(context, false) || instance.page.id !== saved.pageId) return;
  instance.setZoom(saved.view.zoom); instance.$('.nt-scroll').scrollTo(saved.view.x, saved.view.y);
  instance.selection = new Set(saved.selection); instance.updateSelection(); instance.saveView(); instance.returnContext = null;
}
export async function regionSnapshot(origin) {
  const context = instance.context();
  if (!instance.bridge.isGuest()) return instance.store.api('/region-preview', { boardId: origin.boardId, bounds: origin.region.bounds });
  const boards = await instance.bridge.guestCanvases();
  if (!instance.current(context, false)) throw new Error('账号已切换');
  const board = boards.find(board => board.id === origin.boardId);
  if (!board) throw new Error('来源画布已删除或不可访问');
  const items = regionItems(board.snapshot?.items || [], origin.region.bounds);
  return { items, layers: board.snapshot?.layers, background: board.snapshot?.background, revision: regionRevision(items), empty: !items.length };
}
export async function chooseRegionTarget() {
  await instance.show();
  if (!instance.store || instance.root.hidden || !instance.page) return null;
  const context = instance.context();
  const dialog = el('dialog', 'nt-dialog nt-owned-dialog nt-target-dialog'); dialog.setAttribute('aria-label', '引用到笔记');
  const heading = el('h2', '', '引用到笔记');
  const select = el('select'); select.setAttribute('aria-label', '目标笔记');
  const targets = [];
  for (const book of instance.store.books.values()) for (const page of book.pages) if (!book.deleted && !page.deleted) {
    const index = targets.push({ bookId: book.id, pageId: page.id }) - 1;
    select.append(new Option(`${book.title} / ${page.title || '未命名笔记'}`, String(index), false, page.id === instance.page.id));
  }
  const newPage = el('input'); newPage.placeholder = '新笔记标题'; newPage.setAttribute('aria-label', '新笔记标题'); newPage.maxLength = 200; newPage.hidden = true;
  select.append(new Option('在当前分区新建笔记', 'new'));
  select.addEventListener('change', () => { newPage.hidden = select.value !== 'new'; if (!newPage.hidden) newPage.focus(); });
  const actions = el('div', 'nt-target-actions');
  actions.append(button('取消', '', () => dialog.close('cancel')), button('引用到此笔记', '', () => dialog.close('insert'), 'nt-primary'));
  dialog.append(heading, el('p', '', '插入可刷新预览；画布原内容保持独立。'), select, newPage, actions);
  document.body.append(dialog); dialog.showModal();
  const accepted = await new Promise(resolve => dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'insert'); dialog.remove(); }, { once: true }));
  if (!accepted || !instance.current(context, false)) return null;
  if (select.value === 'new') {
    if (!instance.writable()) return null;
    const page = createPage(instance.sectionId || instance.book.sections[0].id); page.title = newPage.value.trim() || '未命名笔记';
    instance.book.pages.push(page); instance.store.change(instance.book); await instance.openPage(instance.book, page);
    return { bookId: instance.book.id, pageId: page.id };
  }
  return targets[Number(select.value)] || null;
}
export async function checkSource(origin) {
  if (instance.bridge.isGuest()) return;
  if (origin.region) await request('/region-status', { boardId: origin.boardId, bounds: origin.region.bounds });
  else await request('/materials/convert', { boardId: origin.boardId, entityId: origin.entityId });
}
export async function insertRegion(result, target = null) {
  const scope = window.MuseAccount?.session?.user?.id || 'guest';
  if (result.scope !== scope) return;
  await instance.show();
  if (target && scope === instance.scope) {
    const context = instance.context(), book = await instance.store.getBook(target.bookId);
    if (!instance.current(context, false)) return;
    const page = book.pages.find(page => page.id === target.pageId && !page.deleted);
    if (book.deleted || !page) throw new Error('目标笔记已删除，请重新选择');
    await instance.openPage(book, page);
  }
  if (scope !== instance.scope || !instance.writable()) return;
  const context = instance.context(); const src = await instance.imageSource(result.blob, context);
  if (!instance.current(context) || !instance.writable()) return;
  const element = createElement('image'); element.src = src; element.alt = '画布区域引用'; element.origin = result.origin;
  element.w = 560; element.h = Math.max(80, Math.min(1600, 560 * (result.origin.region.bounds.h + 80) / (result.origin.region.bounds.w + 80)));
  instance.place([element], instance.visiblePoint()); await instance.store.persist();
}
export async function references(boardId, entityIds) {
  if (instance?.store) { instance.finishEdit(); await instance.store.flush(); }
  if (!instance.bridge.isGuest()) {
    const found = (await request('/references', {boardId, entityIds})).references;
    const loaded = [...(instance.store?.books.values() || [])].filter(book => !book.unloaded);
    return [...found.filter(ref => !loaded.some(book => book.id === ref.notebookId)), ...loaded.flatMap(book => notebookReferences(book, boardId, entityIds))];
  }
  return (await localBooks('guest')).flatMap(record => notebookReferences(record.book, boardId, entityIds));
}
export async function openReference(reference) {
  await instance.show(); const context = instance.context();
  if (!instance.store || instance.root.hidden) return;
  const book = await instance.store.getBook(reference.notebookId);
  if (!instance.current(context, false)) return;
  const page = book.pages.find(page => page.id === reference.pageId && !page.deleted);
  const element = page?.elements.find(element => element.id === reference.id);
  if (book.deleted || !element) throw new Error('引用笔记已删除');
  await instance.openPage(book, page);
  if (instance.page?.id !== page.id || !instance.current(context, false)) return;
  instance.$('.nt-scroll').scrollTo(Math.max(0, element.x * instance.zoom - 40), Math.max(0, element.y * instance.zoom - 80));
  instance.selection = new Set([element.id]); instance.renderElements(); instance.updateSelection();
}
export async function prepareAccountExit() {
  if (!instance?.store) return; instance.finishEdit(); await instance.store.persist();
}
export async function clearAccount(scope) {
  const store = instance?.scope === scope ? instance.store : null;
  if (store) { instance.resetAccount(); await Promise.allSettled([...store.writes.values()]); }
  await clearLocalScope(scope);
}
export async function originals(offset = 0, query = '') {
  if (!instance) return [];
  if (!instance.bridge.isGuest()) { const response = await request(`/originals?offset=${offset}&q=${encodeURIComponent(query.slice(0,100))}`); const result = response.materials; result.next = response.next; return result; }
  const scope = window.MuseAccount?.session?.user?.id || 'guest';
  const cached = await localBooks(scope);
  const all = cached.map(record => record.book).filter(book => !book.deleted).flatMap(book => book.pages.filter(page => !page.deleted).flatMap(page => page.elements.filter(element => element.origin.kind === 'native').map(element => ({ notebookId: book.id, pageId: page.id, id: element.id, type: element.type, label: `${book.title} / ${page.title}`, text: elementText(element), element }))));
  const filtered = all.filter(material => !query || `${material.text} ${material.label}`.toLocaleLowerCase().includes(query.slice(0,100).toLocaleLowerCase()));
  const result = filtered.slice(offset, offset + 80); result.next = offset + 80 < filtered.length ? offset + 80 : null; return result;
}
export async function originalItem(material) { return material.element ? toCanvas(material.element) : (await request('/originals/convert', { notebookId: material.notebookId, pageId: material.pageId, elementId: material.id })).item; }

