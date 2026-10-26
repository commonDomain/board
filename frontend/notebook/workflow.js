import { elementText } from './model.js';

export function setupWorkflow(app, button, el) {
  const search = el('section', 'nt-search-results'); search.hidden = true;
  search.setAttribute('aria-label', '搜索结果');
  const header = el('header'); header.append(el('strong', '', '搜索结果'), button('关闭搜索', 'x', () => app.closeSearch(), 'nt-icon'));
  const status = el('p', 'nt-search-status'); status.setAttribute('role', 'status');
  const results = el('div', 'nt-search-list'); search.append(header, status, results); app.$('.nt-workspace').append(search);
  app.dismissSearch = () => { search.hidden = true; app.root.classList.remove('nt-search-open'); };
  app.closeSearch = () => { app.dismissSearch(); (matchMedia('(max-width:1100px)').matches ? app.$('.nt-search-trigger') : app.surface).focus({ preventScroll:true }); };
  app.openSearch = () => { app.closeNavigation(); app.$('.nt-materials').hidden = true; app.root.classList.remove('nt-materials-open'); app.root.classList.add('nt-search-open'); search.hidden = false; app.$('.nt-global-search input').focus(); app.renderSearch(); };
  app.$('.nt-app-actions').prepend(button('搜索笔记', 'search', () => app.openSearch(), 'nt-icon nt-search-trigger'));
  app.$('.nt-global-search input').addEventListener('focus', () => { app.root.classList.add('nt-search-open'); search.hidden = false; });
  const clear = button('清空搜索', 'x', () => {
    clearTimeout(app.queryTimer); app.searchToken = null; app.query = ''; app.searchHits = []; app.remoteMatches = null; app.searchNext = null; app.searchLoading = false; app.searchLocalOnly = false;
    app.$('.nt-global-search input').value = ''; app.renderNavigation(); app.renderSearch(); app.$('.nt-global-search input').focus();
  }, 'nt-icon nt-search-clear');
  clear.hidden = true; app.$('.nt-global-search').append(clear);
  app.renderSearch = () => {
    clear.hidden = !app.$('.nt-global-search input').value;
    results.replaceChildren();
    const query = (app.query || '').trim().toLocaleLowerCase();
    status.textContent = !query ? '输入标题或正文查找笔记' : app.searchLoading ? '正在搜索…' : app.searchLocalOnly ? '云端搜索暂不可用，以下为本地结果' : '搜索结果';
    if (!query) return;
    const hits = new Map();
    for (const hit of app.searchHits || []) hits.set(`${hit.notebookId}:${hit.pageId}:${hit.id}`, hit);
    for (const book of app.store?.books.values() || []) {
      if (book.deleted) continue;
      for (const page of book.pages) {
        if (page.deleted) continue;
        const label = `${book.title} / ${book.sections.find(section => section.id === page.sectionId)?.title || ''} / ${page.title || '未命名笔记'}`;
        if (`${book.title} ${page.title}`.toLocaleLowerCase().includes(query)) hits.set(`${book.id}:${page.id}:`, { notebookId: book.id, pageId: page.id, id: '', label, text: page.title });
        for (const element of page.elements) {
          const text = elementText(element), offset = text.toLocaleLowerCase().indexOf(query);
          if (offset >= 0) hits.set(`${book.id}:${page.id}:${element.id}`, { notebookId: book.id, pageId: page.id, id: element.id, label, text: text.slice(Math.max(0, offset - 36), offset + query.length + 100) });
        }
      }
    }
    if(!app.searchLoading&&!app.searchLocalOnly)status.textContent=hits.size?`找到 ${hits.size} 条结果${app.searchNext!=null?' · 可继续加载':''}`:'没有找到匹配的笔记';
    for (const hit of hits.values()) {
      const row = button(hit.label, '', async () => {
        const context = app.context(), book = await app.store.getBook(hit.notebookId);
        if (!app.current(context, false)) return;
        const page = book.pages.find(page => page.id === hit.pageId && !page.deleted);
        if (book.deleted || !page) return app.toast('此笔记已删除');
        await app.openPage(book, page);
        if (!app.current(context, false) || app.page.id !== hit.pageId) return;
        app.closeSearch(); app.revealElement(hit.id);
      });
      row.append(el('small', '', hit.text || '标题匹配')); results.append(row);
    }
    if (!hits.size && !app.searchLoading) results.append(el('p', '', '试试更短的关键词，或搜索笔记标题与正文'));
    if (app.searchNext != null) results.append(button('继续搜索', 'chevrons-down', () => app.searchNotes(true)));
  };
  app.revealElement = (id) => {
    const element = app.page.elements.find(element => element.id === id), scroll = app.$('.nt-scroll');
    if (!element) { scroll.scrollTo(0, 0); app.$('.nt-title-block input').focus({ preventScroll: true }); return; }
    scroll.scrollTo(Math.max(0, element.x * app.zoom - 24), Math.max(0, (element.y + app.$('.nt-title-block').offsetHeight) * app.zoom - 60));
    app.selection = new Set([id]); app.renderElements(); app.updateSelection();
    const node = [...app.surface.querySelectorAll('[data-element-id]')].find(node => node.dataset.elementId === id);
    node?.classList.add('nt-located'); setTimeout(() => node?.classList.remove('nt-located'), 1600);
    app.surface.focus({ preventScroll: true });
  };
  app.$('.nt-app-actions').append(button('工作区菜单', 'ellipsis', event => app.workspaceMenu(event.currentTarget), 'nt-icon'));
  app.$('.nt-app-actions').append(button('显示或收起目录', 'panel-left', () => { app.animateNavigation(() => app.root.classList.toggle('nt-hide-library')); app.syncFormat(); }, 'nt-icon nt-desktop-nav'));
  const cancel = button('取消放置', 'x', () => { app.pending = null; app.materialSelectionToken = null; app.tool = 'text'; app.syncMaterialSelection(); app.$('.nt-status-hint').textContent = '已取消放置'; }, 'nt-cancel-placement');
  app.$('.nt-status').append(cancel);
  const sync = app.syncMaterialSelection;
  app.syncMaterialSelection = label => { sync(label); cancel.hidden = !app.pending; };
  app.syncMaterialSelection();
  app.root.addEventListener('keydown', event => {
    if (search.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); app.closeSearch(); }
    if (event.key === 'Tab' && matchMedia('(max-width:1100px)').matches) {
      const controls = [app.$('.nt-global-search input'), ...search.querySelectorAll('button:not(:disabled)')];
      const index = controls.indexOf(document.activeElement);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) {
        event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
    }
  });
}

export function renderWorkflowTabs(app, button, el) {
  const host = app.$('.nt-tabs'); host.replaceChildren();
  const label = (book, page) => `${page.title || '未命名笔记'} · ${book.title} / ${book.sections.find(section => section.id === page.sectionId)?.title || ''}`;
  const close = tab => {
    app.tabs = app.tabs.filter(entry => entry !== tab);
    if (tab.pageId !== app.page.id) return app.renderTabs();
    const next = [...app.tabs].sort((a, b) => (b.used || 0) - (a.used || 0))[0], book = app.store.books.get(next.bookId);
    return app.openPage(book, book.pages.find(page => page.id === next.pageId));
  };
  app.closeNotebookTab = close;
  const entries = app.tabs.flatMap(tab => {
    const book = app.store.books.get(tab.bookId), page = book?.pages.find(page => page.id === tab.pageId && !page.deleted);
    return book && !book.deleted && page ? [{ tab, book, page }] : [];
  });
  app.tabs = entries.map(entry => entry.tab);
  for (const { tab, book, page } of entries) {
    const row = el('div', 'nt-tab' + (page.id === app.page.id ? ' active' : ''));
    row.dataset.pageId=page.id;
    const open = button(page.title || '未命名笔记', 'file-text', () => app.openPage(book, page));
    open.title = label(book, page); open.setAttribute('role', 'tab'); open.setAttribute('aria-selected', String(page.id === app.page.id)); row.append(open);
    if (entries.length > 1) row.append(button('关闭标签页', 'x', () => close(tab), 'nt-icon'));
    host.append(row);
  }
  host.append(button('切换笔记', 'chevrons-up-down', event => app.menu('已打开的笔记', entries.map(({ book, page }) => [label(book, page), () => app.openPage(book, page)]), event.currentTarget), 'nt-tab-switch'));
  if (entries.length > 1) host.append(button('标签页操作', 'ellipsis', event => app.menu('标签页', [
    ['关闭其他标签页', () => { app.tabs = app.tabs.filter(tab => tab.pageId === app.page.id); app.renderTabs(); }],
    ['关闭全部标签页（保留当前）', () => { app.tabs = app.tabs.filter(tab => tab.pageId === app.page.id); app.renderTabs(); }]
  ], event.currentTarget), 'nt-icon nt-tab-actions'));
  requestAnimationFrame(() => { const active = host.querySelector('.nt-tab.active'); if (active) { if (active.offsetLeft < host.scrollLeft) host.scrollLeft = active.offsetLeft; else if (active.offsetLeft + active.offsetWidth > host.scrollLeft + host.clientWidth) host.scrollLeft = active.offsetLeft + active.offsetWidth - host.clientWidth; } });
}
