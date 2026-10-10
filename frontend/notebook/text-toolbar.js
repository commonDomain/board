import { noteTags,openTextPalette,readFormat,applyFormat } from './text-formatting.js';

export function setupTextToolbar(app,button,el) {
  const bar=el('div','nt-selection-toolbar');bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','选中文字工具条');app.root.append(bar);
  const top=el('div','nt-selection-toolbar-row'),bottom=el('div','nt-selection-toolbar-row');bar.append(top,bottom);
  const dropdown=(label,icon,action,className='nt-text-tool')=>{
    const control=button(label,icon,action,`${className} nt-text-dropdown`);control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-expanded','false');
    const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 12 12');arrow.setAttribute('aria-hidden','true');arrow.classList.add('nt-dropdown-arrow');arrow.innerHTML='<path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>';control.append(arrow);return control;
  };
  const font=el('select');font.setAttribute('aria-label','选中文字字体');
  for(const name of ['宋体','Microsoft YaHei','Arial','Calibri','Georgia'])font.append(new Option(name==='Microsoft YaHei'?'微软雅黑':name,name));
  const size=el('select');size.setAttribute('aria-label','选中文字字号');for(const value of [10,11,12,14,16,18,20,24,28,32])size.append(new Option(String(value),String(value)));
  top.append(font,size);
  const run=command=>{const editor=app.editor;if(!editor||!app.writable())return;command(editor.chain().focus()).run();app.syncFormat();};
  font.addEventListener('change',()=>run(chain=>chain.setFontFamily(font.value)));
  size.addEventListener('change',()=>run(chain=>chain.setFontSize(`${size.value}px`)));
  const painter=button('格式刷','format-brush',()=>{const editor=app.editor;if(!editor)return;app.formatPainter=app.formatPainter?null:{editor,from:editor.state.selection.from,to:editor.state.selection.to,format:readFormat(editor)};painter.classList.toggle('active',!!app.formatPainter);painter.setAttribute('aria-pressed',String(!!app.formatPainter));app.$('.nt-status-hint').textContent=app.formatPainter?'格式刷已启用 · 选中目标文字应用格式 · Esc 取消':'格式刷已取消';},'nt-text-tool');
  top.append(painter);
  app.syncFormatPainter=()=>{const active=!!app.formatPainter;app.root.classList.toggle('nt-format-painting',active);painter.classList.toggle('active',active);painter.setAttribute('aria-pressed',String(active));};
  painter.addEventListener('click',app.syncFormatPainter);
  top.append(button('待办清单','check',()=>run(chain=>chain.toggleTaskList()),'nt-text-tool'));
  top.append(dropdown('标记','note-tags',event=>app.menu('标记',[
    {label:'删除标记',icon:'tag-remove',group:'remove',run:()=>run(chain=>chain.updateAttributes('paragraph',{noteTag:null}).updateAttributes('heading',{noteTag:null}))},
    ...noteTags.map(([id,label,,color,icon])=>({label,icon,group:'tags',run:()=>run(chain=>chain.updateAttributes('paragraph',{noteTag:id}).updateAttributes('heading',{noteTag:id})),color}))
  ],event.currentTarget,{className:'nt-text-tags-menu',cancel:false,restoreEditor:true,decorate:dialog=>{for(const [i,control] of [...dialog.querySelectorAll('.nt-menu-item')].entries())if(i)control.style.setProperty('--nt-icon-blue',noteTags[i-1][3]);}}),'nt-text-tool'));
  const styleChoices=[['常规',chain=>chain.setParagraph().unsetAllMarks()],...[1,2,3,4,5,6].map(level=>[`标题 ${level}`,chain=>chain.setHeading({level})]),['标题',chain=>chain.setParagraph().unsetAllMarks().setFontSize('30px')],['引文',chain=>chain.setParagraph().setBlockquote()],['引用',chain=>chain.setParagraph().setItalic().setColor('#595959')],['代码',chain=>chain.setCodeBlock()]];
  const style=button('样式','text-style',event=>app.menu('样式',[...styleChoices.map(([label,command])=>({label,group:'styles',run:()=>run(command)})),{label:'清除格式',icon:'remove-formatting',group:'clear',run:()=>run(chain=>chain.unsetAllMarks().clearNodes())}],event.currentTarget,{className:'nt-text-styles-menu',width:660,cancel:false,restoreEditor:true,decorate:dialog=>{for(const [i,control] of [...dialog.querySelectorAll('.nt-menu-item')].entries())control.dataset.textStyle=String(i);}}),'nt-text-style-tool');
  bar.append(style);
  const marks=[];
  for(const [label,icon,method,mark] of [['加粗','bold','toggleBold','bold'],['斜体','italic','toggleItalic','italic'],['下划线','underline','toggleUnderline','underline'],['项目列表','list','toggleBulletList','bulletList'],['编号列表','list-ordered','toggleOrderedList','orderedList']]){
    const control=button(label,icon,()=>run(chain=>chain[method]()),'nt-text-tool');marks.push([control,mark]);bottom.append(control);
  }
  const colorControl=dropdown('选中文字颜色','text-color',event=>openTextPalette(app,event.currentTarget,'color',value=>run(chain=>value?chain.setColor(value):chain.unsetColor()),el),'nt-text-tool nt-text-color-control');
  const highlight=dropdown('高亮','highlighter',event=>openTextPalette(app,event.currentTarget,'highlight',value=>run(chain=>value?chain.setHighlight({color:value}):chain.unsetHighlight()),el),'nt-text-tool nt-text-color-control');
  bottom.insertBefore(highlight,bottom.children[3]);bottom.insertBefore(colorControl,bottom.children[4]);
  bar.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
  let frame=null,selecting=false;
  const hide=()=>{bar.hidden=true;};
  const update=()=>{
    const editor=app.editor,selection=editor?.state.selection;
    if(!selecting && app.formatPainter && app.writable() && selection && !selection.empty && (editor!==app.formatPainter.editor || selection.from!==app.formatPainter.from || selection.to!==app.formatPainter.to)){
      const format=app.formatPainter.format;app.formatPainter=null;applyFormat(editor,format);app.$('.nt-status-hint').textContent='已应用文字格式';
    }
    app.syncFormatPainter();
    if(!editor||editor.isDestroyed||editor.view.composing||app.readOnly||app.root.hidden||!selection||selection.empty||selection.to-selection.from<2||!editor.state.doc.textBetween(selection.from,selection.to,'').trim())return hide();
    if(document.querySelector('.nt-owned-dialog[open]'))return;
    const attrs=editor.getAttributes('textStyle'),family=attrs.fontFamily||'Microsoft YaHei',fontSize=String(parseFloat(attrs.fontSize)||16);
    for(const [control,value] of [[font,family],[size,fontSize]]) {if(![...control.options].some(option=>option.value===value))control.append(new Option(value,value));control.value=value;}
    style.title=editor.isActive('heading')?`当前样式：标题 ${editor.getAttributes('heading').level}`:'当前样式：正文';
    for(const [control,mark] of marks){const active=editor.isActive(mark);control.classList.toggle('active',active);control.setAttribute('aria-pressed',String(active));}
    colorControl.style.setProperty('--nt-format-color',attrs.color||'#d93035');highlight.style.setProperty('--nt-icon-highlight',editor.getAttributes('highlight').color||'#eeed00');
    const coords=editor.view.coordsAtPos(selection.to);
    bar.hidden=false;const rect=bar.getBoundingClientRect(),v=window.visualViewport;
    const left=v?.offsetLeft||0,topEdge=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;
    bar.style.left=`${Math.max(left+8,Math.min(coords.left,left+width-rect.width-8))}px`;
    const above=coords.top-rect.height-8;
    bar.style.top=`${Math.max(topEdge+8,Math.min(above>=topEdge+8?above:coords.bottom+8,topEdge+height-rect.height-8))}px`;
  };
  app.updateTextToolbar=()=>{if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;update();});};
  app.hideTextToolbar=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;hide();};
  app.root.addEventListener('pointerdown',event=>{if(event.button===0 && event.target.closest('.nt-element-body'))selecting=true;},{capture:true});
  window.addEventListener('pointerup',()=>{selecting=false;app.updateTextToolbar();});
  window.addEventListener('pointercancel',()=>{selecting=false;app.updateTextToolbar();});
  window.addEventListener('blur',()=>{selecting=false;});
  window.addEventListener('resize',app.updateTextToolbar);
  app.$('.nt-scroll').addEventListener('scroll',app.updateTextToolbar,{passive:true});
  window.visualViewport?.addEventListener('resize',app.updateTextToolbar);
  app.root.addEventListener('contextmenu',app.hideTextToolbar);
  bar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();app.formatPainter=null;app.syncFormatPainter();hide();app.editor?.view.focus();}});
}
