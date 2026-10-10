import { clone, createElement, elementText, textDoc } from './model.js';

// Context actions use existing editor/store operations; no persistent menu state.
export function setupNotebookContextMenus(app) {
  let opened = null;
  const writable = () => !app.readOnly && !app.page?.deleted && !app.book?.deleted && app.store?.active() && app.store.leaseValid(app.book?.id,app.page?.id);
  const item = (label, icon, run, group, extra = {}) => ({label,icon,run,group,...extra});
  const write = extra => ({disabled:!writable(),reason:'当前页面只读',...extra});
  const control = label => app.$(`.nt-ribbon [aria-label="${label}"]`)?.click();
  const fit = () => { app.setZoom(Math.min(1,(app.$('.nt-scroll').clientWidth-32)/app.pageWidth()),{x:0,y:0}); app.$('.nt-scroll').scrollLeft=0; };
  const viewActions = () => [
    item('适合页面','scan',fit,'zoom'),
    ...[50,100,150].map(value=>item(`缩放 ${value}%`,'zoom-in',()=>app.setZoom(value/100),'zoom',{checked:Math.round(app.zoom*100)===value})),
    item(app.root.classList.contains('nt-focus')?'退出专注写作':'专注写作','maximize',()=>{app.animateNavigation(()=>app.root.classList.toggle('nt-focus'));app.syncFormat();},'view')
  ];
  const historyActions = () => [
    item('撤销','undo-2',()=>app.undo(false),'history',write({disabled:!writable()||!app.history.get(app.page.id)?.length,reason:!writable()?'当前页面只读':'暂无可撤销的操作',shortcut:'$mod Z'})),
    item('重做','redo-2',()=>app.undo(true),'history',write({disabled:!writable()||!app.redo.get(app.page.id)?.length,reason:!writable()?'当前页面只读':'暂无可重做的操作',shortcut:'$mod Shift Z'}))
  ];
  const clipboardFailure = () => app.toast('浏览器未允许访问剪贴板，请使用键盘复制或粘贴；当前内容已保留');
  const open = (title, actions, target, options) => {
    opened?.close();
    const context=app.context();
    const guarded=actions.map(action=>({...action,run:()=>{if(app.current(context)&&!app.root.hidden)return action.run();}}));
    opened=app.menu(title,guarded,target,options);
    const dialog=opened;dialog.addEventListener('close',()=>{if(opened===dialog)opened=null;},{once:true});
    return dialog;
  };
  const pasteText = async (point, editor = null) => {
    const context=app.context();
    const selected=editor ? {from:editor.state.selection.from,to:editor.state.selection.to,doc:editor.state.doc} : null;
    try {
      const text=await navigator.clipboard.readText();
      if(!text || !app.current(context) || app.root.hidden || !writable())return;
      if(editor){if(editor!==app.editor||editor.isDestroyed)return;if(editor.state.doc!==selected.doc || editor.state.selection.from!==selected.from || editor.state.selection.to!==selected.to)return app.toast('文字或选区已改变，请重新粘贴');const doc=textDoc(text);editor.chain().focus().insertContent(doc.content).run();}
      else {const element=createElement('text',point);element.doc=textDoc(text);app.place([element],point);}
    } catch {if(app.current(context))clipboardFailure();}
  };
  const textActions = editor => {
    const {from,to}=editor.state.selection, empty=from===to;
    const doc=editor.state.doc;
    const text=editor.state.doc.textBetween(from,to,'\n');
    const copy = async cut => {
      const context=app.context();
      try {
        await navigator.clipboard.writeText(text);
        if(cut && app.current(context) && editor===app.editor && !editor.isDestroyed && writable() && editor.state.doc===doc && editor.state.selection.from===from && editor.state.selection.to===to)editor.chain().focus().deleteSelection().run();
      } catch {if(app.current(context))clipboardFailure();}
    };
    const actions=[
      item('剪切文字','scissors',()=>copy(true),'clipboard',write({disabled:empty||!writable(),reason:!writable()?'当前页面只读':'请先选中文字',shortcut:'$mod X'})),
      item('复制文字','copy',()=>copy(false),'clipboard',{disabled:empty,reason:'请先选中文字',shortcut:'$mod C'}),
      item('粘贴纯文本','clipboard-paste',()=>pasteText(null,editor),'clipboard',write()),
      ...historyActions()
    ];
    for(const [label,icon,command,mark] of [['加粗','bold','toggleBold','bold'],['斜体','italic','toggleItalic','italic'],['下划线','underline','toggleUnderline','underline'],['高亮','highlighter','toggleHighlight','highlight'],['项目列表','list','toggleBulletList','bulletList'],['编号列表','list-ordered','toggleOrderedList','orderedList']]) {
      actions.push(item(label,icon,()=>{if(writable()&&editor===app.editor)editor.chain().focus()[command]().run();},'format',write({checked:editor.isActive(mark)})));
    }
    if(editor.isActive('link'))actions.push(item('移除链接','unlink',()=>{if(writable()&&editor===app.editor)editor.chain().focus().unsetLink().run();},'link',write()));
    if(editor.isActive('table')) {
      for(const [label,command] of [['增加行','addRowAfter'],['增加列','addColumnAfter'],['合并单元格','mergeCells'],['拆分单元格','splitCell'],['删除行','deleteRow'],['删除列','deleteColumn']])actions.push(item(label,'table-2',()=>{if(writable()&&editor===app.editor)editor.chain().focus()[command]().run();},'table',write({disabled:!writable()||!editor.can()[command](),reason:!writable()?'当前页面只读':'当前表格选区不适用',danger:command==='deleteRow'||command==='deleteColumn'})));
    }
    const id=app.editingId;
    actions.push(item('完成文字编辑','check',()=>app.finishEdit(),'object'));
    actions.push(item('删除整个内容对象','trash-2',()=>{
      if(!writable() || !app.page.elements.some(element=>element.id===id))return;
      app.finishEdit();app.select(id);app.removeSelected();
    },'danger',write({danger:true})));
    return actions;
  };
  const objectActions = (element,point) => {
    const selected=app.page.elements.filter(entry=>app.selection.has(entry.id));
    const copies=clone(selected), ids=selected.map(entry=>entry.id);
    const selectTargets=()=>{app.selection=new Set(ids.filter(id=>app.page.elements.some(entry=>entry.id===id)));app.updateSelection();};
    const copyObjects=async cut=>{
      const context=app.context();app.clipboard=clone(copies);
      try {
        await navigator.clipboard.writeText(copies.map(elementText).join('\n'));
        if(cut&&app.current(context)&&!app.root.hidden&&writable()) {
          if(copies.some(copy=>JSON.stringify(app.page.elements.find(entry=>entry.id===copy.id))!==JSON.stringify(copy)))return app.toast('内容已改变，已复制但未剪切，请重新选择');
          selectTargets();app.removeSelected();
        }
      }
      catch {if(app.current(context))app.toast('已复制到笔记内部，可通过右键菜单粘贴；浏览器未允许系统剪贴板，原内容已保留');}
    };
    const actions=[
      item('复制内容对象','copy',()=>copyObjects(false),'clipboard',{shortcut:'$mod C'}),
      item('剪切内容对象','scissors',()=>{if(writable())return copyObjects(true);},'clipboard',write()),
      item('粘贴内容对象','clipboard-paste',()=>{if(writable()&&app.clipboard?.length)app.place(app.clipboard,point,{reveal:false});},'clipboard',write({disabled:!writable()||!app.clipboard?.length,reason:!writable()?'当前页面只读':'请先复制笔记中的内容对象'})),
      item('创建独立副本','copy-plus',()=>{if(writable())app.place(copies,{x:Math.min(...copies.map(e=>e.x))+24,y:Math.min(...copies.map(e=>e.y))+24});},'object',write())
    ];
    if(selected.length===1 && ['text','callout','tag'].includes(element.type))actions.push(item('编辑文字','text-cursor',()=>{if(writable())app.startEdit(element,app.surface.querySelector(`[data-element-id="${element.id}"] .nt-element-body`));},'object',write()));
    if(selected.length===1 && element.origin?.kind==='canvas') {
      actions.push(item(element.origin.region?'查看画布区域':'查看画布来源','external-link',()=>app.bridge.locateSource(element.origin),'source'));
      if(element.origin.region)actions.push(item('刷新区域快照','refresh-cw',()=>app.refreshRegion(element),'source',write()));
    }
    actions.push(...historyActions(),item(ids.length>1?`删除 ${ids.length} 个内容对象`:'删除整个内容对象','trash-2',()=>{if(writable()){selectTargets();app.removeSelected();}},'danger',write({danger:true})));
    return actions;
  };
  const show = event => {
    const target=event.target;
    if(!app.page || app.root.hidden || target.closest('input,textarea,select,[contenteditable=true]:not(.tiptap)') || app.editor?.view.composing)return;
    const keyboard=event.type==='keydown' || (event.clientX===0&&event.clientY===0), rect=target.getBoundingClientRect();
    const x=keyboard?rect.left+Math.min(24,rect.width/2):event.clientX, y=keyboard?rect.top+Math.min(24,rect.height/2):event.clientY;
    const options={point:{x,y},restoreEditor:true};
    let title,actions;
    if(target.closest('.nt-ribbon,.nt-ribbon-tabs')) {
      title='功能区';actions=[item(app.root.classList.contains('nt-tools-expanded')?'收起更多工具':'展开更多工具','ellipsis',()=>control('更多工具'),'ribbon'),...['开始','插入','绘写','视图'].map(tab=>item(`${tab}工具`,'panel-top',()=>{app.tab=tab;app.renderRibbon();},'tabs',{checked:app.tab===tab}))];
    } else if(target.closest('.nt-status,.nt-save')) {
      title='状态与视图';actions=[...viewActions(),item('保存与恢复选项','cloud-upload',()=>app.workspaceMenu(app.$('.nt-save')),'save')];
    } else if(target.closest('.nt-tab')) {
      const id=target.closest('.nt-tab').dataset.pageId,tab=app.tabs.find(entry=>entry.pageId===id),book=tab&&app.store.books.get(tab.bookId),page=book?.pages.find(entry=>entry.id===id);
      if(!page)return;
      title='笔记标签页';actions=[item('切换到此笔记','file-text',()=>app.openPage(book,page),'tab',{checked:app.page.id===id}),item('关闭此标签页','x',()=>app.closeNotebookTab(tab),'close',{disabled:app.tabs.length<=1,reason:'请至少保留当前笔记'}),item('关闭其他标签页','panel-top',async()=>{if(app.page.id!==id)await app.openPage(book,page);if(app.page.id===id){app.tabs=app.tabs.filter(entry=>entry.pageId===id);app.renderTabs();}},'close',{disabled:app.tabs.length<=1,reason:'没有其他标签页'})];
    } else if(target.closest('.nt-page-entry')) {
      const row=target.closest('.nt-page-entry'),book=app.store.books.get(row.dataset.bookId),page=book?.pages.find(e=>e.id===row.dataset.pageId);
      if(!page)return;event.preventDefault();opened?.close();opened=app.pageMenu(book,page,row,options);return;
    } else if(target.closest('.nt-book-row')) {
      const row=target.closest('.nt-book-row'),book=app.store.books.get(row.dataset.bookId);if(!book)return;event.preventDefault();opened?.close();opened=app.bookMenu(book,row,options);return;
    } else if(target.closest('.nt-section-row')) {
      const row=target.closest('.nt-section-row'),section=app.book.sections.find(e=>e.id===row.dataset.sectionId);if(!section)return;event.preventDefault();opened?.close();opened=app.sectionMenu(section,row,options);return;
    } else if(target.closest('.nt-surface,.nt-paper-wrap')) {
      const node=target.closest('[data-element-id]'),element=app.page.elements.find(e=>e.id===node?.dataset.elementId) || (!node && app.page.elements.find(e=>app.selection.has(e.id)));
      const point=keyboard?app.visiblePoint():app.point({clientX:x,clientY:y});
      if(target.closest('.tiptap') && app.editor && app.editingId===element?.id) {title=app.editor.isActive('table')?'文字与表格':'文字编辑';actions=textActions(app.editor);}
      else if(element) {
        app.finishEdit();if(!app.selection.has(element.id))app.select(element.id);
        title=app.selection.size>1?`${app.selection.size} 个内容对象`:'内容对象';actions=objectActions(element,point);
      } else {
        title='页面空白处';actions=[item('粘贴内容对象','clipboard-paste',()=>{if(writable()&&app.clipboard?.length)app.place(app.clipboard,point,{reveal:false});},'clipboard',write({disabled:!writable()||!app.clipboard?.length,reason:!writable()?'当前页面只读':'请先复制笔记中的内容对象'})),item('粘贴纯文本','clipboard',()=>pasteText(point),'clipboard',write()),...['text','table','callout'].map((type,index)=>item(['在此输入文字','在此插入表格','在此插入便签'][index],['type','table-2','sticky-note'][index],()=>app.insert(type,point),'insert',write())),item('从画布添加','panels-top-left',()=>app.toggleMaterials(),'source'),...historyActions(),item('选择所有内容对象','scan',()=>{app.finishEdit();app.selection=new Set(app.page.elements.map(e=>e.id));app.updateSelection();},'select',{disabled:!app.page.elements.length,reason:'当前页面没有内容对象'})];
      }
    } else return;
    if (target.closest('.nt-surface,.nt-paper-wrap') && app.planningContextActions) {
      const point = keyboard ? app.visiblePoint() : app.point({clientX:x,clientY:y});
      const planningActions = event.type === 'planning-menu' ? app.planningContentActions : app.planningContextActions;
      actions.push(...(planningActions?.(target, point) || []));
    }
    event.preventDefault();event.stopPropagation();open(title,actions,target,options);
  };
  app.root.addEventListener('contextmenu',show);
  app.openPlanningContentMenu = target => {
    const node = target.closest('[data-element-id]'), rect = target.getBoundingClientRect();
    const selected = app.editor?.state.selection.$from;
    if (selected && !target.closest('[data-planning-node]')) for (let depth = selected.depth; depth > 0; depth--) if (selected.node(depth).type.name === 'taskItem') { target = app.editor.view.nodeDOM(selected.before(depth)) || node; break; }
    if (!selected && !target.closest('[data-planning-node]') && node?.querySelectorAll('li[data-type="taskItem"]').length === 1) target = node.querySelector('li[data-type="taskItem"]');
    show({ target, type: 'planning-menu', clientX: rect.left + rect.width / 2, clientY: rect.bottom, preventDefault() {}, stopPropagation() {} });
  };
  app.closeContextMenu=()=>opened?.close();
  app.root.addEventListener('keydown',event=>{if(event.defaultPrevented||event.isComposing)return;if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')show(event);},{capture:true});
  // Page/account changes must not leave a menu bound to stale content.
  for(const name of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(name,()=>opened?.close());
}
