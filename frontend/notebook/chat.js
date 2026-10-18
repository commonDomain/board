import { createNotebook,createElement,textDoc } from './model.js';

export async function addChatMessage(app,material,read){
  if(!app)throw new Error('笔记工作区暂不可用');await app.show();read.assertCurrent?.();
  if(!app.store||app.root.hidden)throw new Error('笔记工作区未能打开');
  const context=app.context(),dialog=document.createElement('dialog');dialog.className='nt-dialog nt-owned-dialog';dialog.setAttribute('aria-label','加入笔记');
  const head=document.createElement('h2');head.textContent='加入笔记';const form=document.createElement('form'),target=document.createElement('select'),hint=document.createElement('p'),error=document.createElement('p'),foot=document.createElement('div'),cancel=document.createElement('button'),save=document.createElement('button');
  target.setAttribute('aria-label','目标笔记');target.append(new Option('新建私有笔记本「聊天摘录」','new'));
  const targets=[];for(const book of app.store.books.values())for(const page of book.pages)if(!book.deleted&&!page.deleted){const key=String(targets.length);targets.push({bookId:book.id,pageId:page.id});target.append(new Option(`${book.title} / ${page.title||'未命名笔记'}${page.sharing||book.access?.received?'（共享）':''}`,key));}
  hint.textContent='复制文字和图片，保留来源入口。目标笔记的共享成员将能查看复制的内容。视频保留来源入口。';
  error.className='nt-notice';error.setAttribute('role','status');cancel.type='button';cancel.textContent='取消';save.type='submit';save.className='nt-primary';save.textContent='加入笔记';foot.className='nt-target-actions';foot.append(cancel,save);form.append(target,hint,error,foot);dialog.append(head,form);document.body.append(dialog);
  let inserted=null;
  const assertCurrent=()=>{if(!dialog.open||!app.current(context,false)||app.root.hidden)throw new DOMException('笔记操作已取消','AbortError');read.assertCurrent?.();};
  cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('keydown',event=>event.stopPropagation());
  const stop=()=>dialog.close();for(const name of ['muse:account-changing','muse:logout','muse:auth-expired'])window.addEventListener(name,stop);
  form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;const destination=target.value;target.disabled=true;
    try{
      assertCurrent();
      if(inserted){await context.store.retry(inserted.bookId);assertCurrent();if(context.store.dirty.has(inserted.bookId))throw new Error('内容已保存在草稿中，云端尚未确认，请重试保存');dialog.close();return;}
      const fresh=await read();assertCurrent();
      let book,page;
      if(destination==='new'){book=createNotebook('聊天摘录');page=book.pages[0];page.title=material.title;}
      else{const chosen=targets[Number(destination)];if(!chosen)throw new Error('请选择目标笔记');book=await context.store.getBook(chosen.bookId);assertCurrent();page=book.pages.find(p=>p.id===chosen.pageId&&!p.deleted);if(!page||book.deleted)throw new Error('目标笔记已删除');}
      if(page.elements.length+(fresh.image?2:1)>5000)throw new Error('目标笔记内容已达到上限');
      const content=createElement('text');content.chatSource=material.source;content.doc=textDoc(fresh.text||material.title);
      content.doc.content.push({type:'paragraph',content:[{type:'text',text:'打开来源聊天',marks:[{type:'link',attrs:{href:material.sourceUrl,target:'_blank'}}]}]});
      const elements=[content];if(fresh.image){const image=createElement('image',{x:64,y:190});image.src=fresh.image;image.alt='聊天图片';image.chatSource=material.source;elements.push(image);}
      if(destination==='new'){
        page.elements=elements;app.store.change(book);inserted={bookId:book.id};target.disabled=true;await app.openPage(book,page);
      }else{
        await app.openPage(book,page);assertCurrent();if(app.book?.id!==book.id||app.page?.id!==page.id||!app.writable())throw new Error('目标笔记正在编辑或没有编辑权限');
        const copies=app.place(elements,app.visiblePoint());if(!copies?.length)throw new Error('笔记副本未能插入');
      }
      inserted={bookId:book.id};target.disabled=true;save.textContent='重试保存';assertCurrent();await context.store.persistBook(book.id);await context.store.flush();assertCurrent();
      if(context.store.dirty.has(book.id))throw new Error('内容已保存在草稿中，云端尚未确认，请重试保存');app.toast('消息已加入笔记');dialog.close();
    }catch(e){if(e.name!=='AbortError')error.textContent=e.message;}finally{save.disabled=false;target.disabled=Boolean(inserted);}
  });
  await new Promise(resolve=>{dialog.addEventListener('close',()=>{for(const name of ['muse:account-changing','muse:logout','muse:auth-expired'])window.removeEventListener(name,stop);dialog.remove();resolve();},{once:true});dialog.showModal();});
}
