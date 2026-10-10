// Shared Office-style text/highlight palettes and persistent paragraph tags.
export const noteTags=[
  ['todo','待办事项','☑','#1683cf','list-checks'],['important','重要','☆','#424242','star'],['question','问题','?','#bf36cc','circle-help'],['follow-up','后续工作','A','#1683cf','text-color'],['definition','定义','A','#1683cf','text-color'],['highlight','高亮颜色','▱','#ec263d','highlighter'],['contact','联系人','♙','#555555','contact'],['address','地址','⌂','#555555','house'],['phone','电话号码','☎','#555555','phone'],['website','要访问的网站','↗','#555555','link'],['idea','创意','♧','#555555','lightbulb'],['password','密码','♙','#555555','lock-keyhole'],['critical','关键','!','#ec263d','circle-alert'],['project-a','项目 A','■','#ec263d','square'],['project-b','项目 B','■','#ffbe16','square'],['movie','要看的电影','▤','#555555','film'],['book','要读的书','▥','#555555','book-open'],['music','要听的音乐','♪','#1683cf','music'],['source','文章来源','↗','#555555','link'],['blog','博客题材','▱','#555555','message-square'],['person-a','与 <人员 A> 讨论','☑','#1683cf','list-checks'],['person-b','与 <人员 B> 讨论','☑','#1683cf','list-checks'],['manager','与经理讨论','☑','#1683cf','list-checks'],['email','通过电子邮件发送','➤','#555555','send'],['meeting','安排会议','☑','#1683cf','calendar-check'],['callback','回拨','☑','#1683cf','phone'],['priority-1','优先待办事项 1','☑','#1683cf','list-ordered'],['priority-2','优先待办事项 2','☑','#1683cf','list-ordered'],['customer','客户要求','☑','#1683cf','list-checks']
];
const columns=[
  ['#ffffff','#f2f2f2','#d9d9d9','#bfbfbf','#a6a6a6','#808080'],['#000000','#808080','#595959','#404040','#262626','#0d0d0d'],['#eeece1','#ddd9c3','#c4bd97','#948a54','#494529','#1d1b11'],['#1f497d','#c6d9f1','#8db3e2','#548dd4','#17365d','#0f243e'],['#4f81bd','#dce6f1','#b8cce4','#95b3d7','#366092','#244061'],['#c0504d','#f2dcdb','#e6b8b7','#d99694','#953735','#632523'],['#9bbb59','#ebf1de','#d8e4bc','#c4d79b','#76923c','#4f6228'],['#8064a2','#e4dfec','#ccc1d9','#b2a1c7','#604a7b','#403151'],['#4bacc6','#dbeef3','#b7dee8','#92cddc','#31859b','#205867'],['#f79646','#fde9d9','#fbd5b5','#fac090','#e36c09','#974806']
];
const standard=['#c00000','#ff0000','#ffc000','#ffff00','#92d050','#00b050','#00b0f0','#0070c0','#002060','#7030a0'];
export function openTextPalette(app,anchor,kind,apply,el) {
  const highlight=kind==='highlight';
  const current=app.editor?.getAttributes(highlight?'highlight':'textStyle').color;
  const actions=[{label:highlight?'无颜色':'自动',group:'auto',checked:!current,run:()=>apply(null)}];
  for(let row=0;row<6;row++)for(let col=0;col<10;col++){const color=columns[col][row];actions.push({label:`主题色 ${row+1}-${col+1}`,group:'theme',checked:current===color,run:()=>apply(color),color});}
  for(const [index,color] of standard.entries())actions.push({label:`标准色 ${index+1}`,group:'standard',checked:current===color,run:()=>apply(color),color});
  return app.menu(highlight?'高亮颜色':'文字颜色',actions,anchor,{className:'nt-text-color-palette',cancel:false,width:310,restoreEditor:true,decorate:dialog=>{
    dialog.querySelector('h2').hidden=true;
    const items=[...dialog.querySelectorAll('.nt-menu-item')];
    items[0].classList.add('nt-color-automatic');
    for(let i=1;i<items.length;i++){items[i].classList.add('nt-text-color-swatch');items[i].style.setProperty('--nt-swatch',actions[i].color);items[i].title=actions[i].color;}
    const heading=el('strong','nt-standard-colors','标准颜色');dialog.insertBefore(heading,items[61]);
  }});
}
export function readFormat(editor) {
  const marks=['bold','italic','underline','strike','code','highlight','textStyle'].flatMap(type=>editor.isActive(type)?[{type,attrs:{...editor.getAttributes(type)}}]:[]);
  return {marks};
}
export function applyFormat(editor,format) {
  const chain=editor.chain().focus();
  for(const type of ['bold','italic','underline','strike','code','highlight','textStyle'])chain.unsetMark(type);
  for(const mark of format.marks)chain.setMark(mark.type,mark.attrs);
  chain.run();
}
