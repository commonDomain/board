const mobile = () => matchMedia('(max-width:1100px)').matches;
const contentNames = {image:'图片',ink:'手写内容',shape:'图形',mindmap:'脑图',callout:'便签',tag:'标签',text:'文字'};
export function pageSummary(page) {
  const summary = page.elements?.map(element => {
    if (element.type === 'image') return element.alt || '图片';
    if (element.type === 'ink' || element.type === 'shape') return contentNames[element.type];
    if (element.type === 'mindmap') return element.tree?.text || '脑图';
    const read = node => node?.type === 'text' ? node.text || '' : (node?.content || []).map(read).join(' ');
    return read(element.doc).trim() || contentNames[element.type] || '内容';
  }).filter(Boolean).join(' · ');
  // Unloaded pages use the existing lightweight directory preview.
  return (summary || page.preview || '空白笔记').replace(/\b(image|ink|shape|mindmap|callout|tag)\b/g,name=>contentNames[name]).slice(0,72);
}
export function setupNotebookInterface(app, button, el) {
  const mode = el('div', 'nt-mode-switch'); mode.setAttribute('aria-label','工作方式');
  const canvas = button('画布','panels-top-left',()=>app.hide()); canvas.setAttribute('aria-pressed','false'); mode.append(canvas);
  const active=button('笔记','notebook-pen',()=>{}); active.setAttribute('aria-pressed','true'); mode.append(active);
  app.$('.nt-brand').after(mode);
  const save=app.$('.nt-save'), compact=matchMedia('(max-width:1100px)');
  const placeSave=()=>{if(compact.matches)app.$('.nt-status').prepend(save);else app.$('.nt-app-actions').before(save);};
  placeSave();compact.addEventListener('change',()=>{placeSave();app.syncNavigationInteraction();});
  app.$('.nt-app-actions [aria-label="回到画布"]').remove();
  app.$('.nt-mobile-nav span').textContent='目录';
  const materialsButton=app.$('.nt-app-actions [aria-label="画布素材"]');materialsButton.classList.add('nt-material-trigger');
  const nav=el('div','nt-navigation-header');
  nav.append(button('返回笔记本','chevron-left',()=>{ app.showNavigation(app.root.dataset.navigation==='pages'&&app.sectionId?'sections':'books'); }),el('span','nt-navigation-path','笔记目录'),button('关闭目录','x',()=>app.closeNavigation(),'nt-icon'));
  app.$('.nt-workspace').prepend(nav);
  const ribbonHelp=el('p','nt-ribbon-help');ribbonHelp.hidden=true;ribbonHelp.setAttribute('role','status');app.$('.nt-ribbon').after(ribbonHelp);
  app.syncNavigationInteraction=()=>{
    const open=app.root.classList.contains('nt-navigation-open'), stage=app.root.dataset.navigation;
    const collapsed=app.root.classList.contains('nt-hide-library')||app.root.classList.contains('nt-focus');
    app.$('.nt-library').inert=mobile()? !open||stage==='pages':collapsed;
    app.$('.nt-pages').inert=mobile()? !open||stage!=='pages':collapsed;
    nav.inert=!mobile()||!open;
  };
  app.closeNavigation=()=>{app.root.classList.remove('nt-navigation-open');app.$('.nt-mobile-nav').setAttribute('aria-expanded','false');app.syncNavigationInteraction();};
  app.showNavigation=(stage='pages')=>{ app.dismissSearch?.();app.$('.nt-materials').hidden=true;app.root.classList.remove('nt-materials-open'); app.root.dataset.navigation=stage;app.root.classList.add('nt-navigation-open');app.$('.nt-mobile-nav').setAttribute('aria-expanded','true');app.syncNavigationInteraction(); };
  app.$('.nt-shortcuts').addEventListener('click',()=>{if(mobile()) app.showNavigation('pages');});
  const panel=app.$('.nt-materials'); const filters=el('details','nt-material-filters'); const summary=el('summary','','筛选画布与类型');filters.append(summary);
  for(const select of panel.querySelectorAll('select'))filters.append(select);
  panel.querySelector('input').after(filters);
  const footer=el('footer','nt-material-footer');footer.append(el('span','nt-material-selection','选择素材后插入笔记'),button('插入可见区域','plus',()=>{
    if(!app.pending)return app.toast('请先选择一个素材');
    if(!app.writable())return;
    app.place(app.pending,app.visiblePoint());app.pending=null;app.syncMaterialSelection();app.$('.nt-status-hint').textContent='已插入独立副本';app.$('.nt-notice').hidden=true;if(mobile())app.toggleMaterials();
  }));panel.append(footer);
  app.syncMaterialSelection=(label='')=>{footer.querySelector('button').disabled=!app.pending;footer.querySelector('span').textContent=label||'选择素材后插入笔记';};app.syncMaterialSelection();
  app.root.addEventListener('keydown',event=>{
    if(event.defaultPrevented || event.isComposing || event.keyCode===229)return;
    if(event.key==='Escape'){
      const navigation=app.root.classList.contains('nt-navigation-open'), materials=!panel.hidden;
      app.closeNavigation();panel.hidden=true;app.root.classList.remove('nt-materials-open');
      if(navigation)app.$('.nt-mobile-nav').focus();else if(materials)materialsButton.focus();
      if(navigation||materials){event.preventDefault();event.stopImmediatePropagation();return;}
    }
    if(event.key!=='Tab'||!mobile())return;
    const navigation=app.root.classList.contains('nt-navigation-open');
    if(!navigation&&panel.hidden)return;
    const candidates=navigation?app.root.querySelectorAll('.nt-navigation-header button,.nt-library button,.nt-pages button'):panel.querySelectorAll('button,input,select,summary');
    const controls=[...candidates].filter(node=>!node.disabled&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
    const index=controls.indexOf(document.activeElement);
    if(controls.length&&(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1)){event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus();}
  });
}
export function renderRecoveryBanner(app, button, el) {
  let banner = app.$('.nt-recovery-banner');
  if (!banner) {
    banner = el('div','nt-recovery-banner');banner.setAttribute('role','status');
    const text=el('div');text.append(el('strong'),el('span'));banner.append(text,button('恢复并继续编辑','undo-2',()=>app.restoreDeleted(app.book,app.book.deleted?null:app.page)));
    app.$('.nt-main').prepend(banner);
  }
  banner.hidden = !app.book?.deleted && !app.page?.deleted;
  if (banner.hidden) return;
  banner.querySelector('strong').textContent = app.book.deleted ? '此笔记本已在回收站' : '此笔记已在回收站';
  banner.querySelector('div > span').textContent = '内容已保留，恢复后可继续编辑';
}
export function compactRibbon(app, button) {
  const ribbon=app.$('.nt-ribbon');
  const primary=app.tab==='开始'?['撤销','重做','段落样式','加粗','项目列表','快速插入','完成编辑']:app.tab==='插入'?['文本','图片','表格','画布素材','完成编辑']:app.tab==='绘写'?['输入','画笔','荧光笔','笔画橡皮','笔迹颜色','完成编辑']:['专注写作','显示目录','适合页面','完成编辑'];
  if(app.tab==='开始')ribbon.append(button('快速插入','plus',event=>app.menu('插入内容',[
    ['文本',()=>app.insert('text'),{icon:'type',group:'text',disabled:app.readOnly||Boolean(app.page?.deleted||app.book?.deleted),reason:'当前页面只读'}],['表格',()=>app.insert('table'),{icon:'table-2',group:'text',disabled:app.readOnly||Boolean(app.page?.deleted||app.book?.deleted),reason:'当前页面只读'}],
    ...(window.MusePlanning?.enabled ? [['插入规划',()=>app.insertPlanning(),{icon:'list-checks',group:'text',disabled:!app.writable(),reason:'当前页面只读'}]] : []),
    ['图片',()=>app.chooseImage(),{icon:'image',group:'media',disabled:app.readOnly||Boolean(app.page?.deleted||app.book?.deleted),reason:'当前页面只读'}],['脑图',()=>app.insert('mindmap'),{icon:'network',group:'media',disabled:app.readOnly||Boolean(app.page?.deleted||app.book?.deleted),reason:'当前页面只读'}],['画布素材',()=>app.toggleMaterials(),{icon:'panels-top-left',group:'source'}]
  ],event.currentTarget)));
  for(const control of ribbon.children)if(!primary.includes(control.getAttribute('aria-label')||control.dataset.toolLabel)&&!/^(增加行|删除行|增加列|删除列|合并单元格|拆分单元格)$/.test(control.getAttribute('aria-label')))control.classList.add('nt-secondary-tool');
  const more=button('更多工具','ellipsis',()=>{app.root.classList.toggle('nt-tools-expanded');more.setAttribute('aria-expanded',String(app.root.classList.contains('nt-tools-expanded')));},'nt-more-tools');
  more.setAttribute('aria-expanded',String(app.root.classList.contains('nt-tools-expanded')));ribbon.append(more);
  for(const control of ribbon.children){
    const label=control.getAttribute('aria-label')||control.dataset.toolLabel||'';
    control.dataset.toolGroup=/撤销|重做/.test(label)?'history':/段落|字号|颜色|加粗|斜体|下划线|高亮|列表|清单|链接/.test(label)?'format':/文本|图片|表格|脑图|便签|标签|素材|快速插入/.test(label)?'insert':'view';
  }
}
export function materialPreview(row, material, el) {
  const item=material.item||material.preview;
  if(material.type==='image'&&item?.src&&/^(\/assets\/|data:image\/)/.test(item.src)){
    const image=el('img','nt-material-preview');image.src=item.src;image.alt=material.label||'图片素材';image.loading='lazy';image.addEventListener('error',()=>image.remove());row.prepend(image);
  }else if(material.type==='mindmap'&&item?.tree){
    const preview=el('div','nt-material-mindmap');preview.append(el('strong','',item.tree.text||'脑图'));
    const children=el('div');for(const child of (item.tree.children||[]).slice(0,3))children.append(el('span','',child.text||''));preview.append(children);row.prepend(preview);
  }
}

