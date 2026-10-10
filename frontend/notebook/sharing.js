import { clone } from './model.js';
import { notebookIcon } from './icons.js';

export function noteSharingBadge(page, el) {
  if (!page.sharing) return null;
  const badge = el('small', `nt-page-sharing${page.sharing.received ? ' nt-page-sharing-received' : ''}`);
  badge.append(notebookIcon('users-round'), el('span','',page.sharing.received ? `来自 ${page.sharing.ownerName}` : '已共享'));
  badge.title = page.sharing.received ? '共享组成员的笔记 · 可获取编辑锁后编辑' : '已共享给当前共享组 · 成员可获取编辑锁后编辑';
  return badge;
}
export async function setNoteSharing(app, book, page, shared) {
  if (app.store.guest) return app.toast('请登录并在账号设置中创建或加入共享组');
  if (book.access?.received) return app.toast('只有笔记所有者可以修改共享设置');
  if (app.sharingBusy) return;
  const context = app.context(); app.sharingBusy = true;
  try {
    app.finishEdit(); await context.store.flush();
    if (!app.current(context,false)) return;
    if (context.store.dirty.has(book.id)) return app.toast('请先完成笔记保存，再修改共享设置');
    const response = await context.store.api(`/${book.id}/pages/${page.id}/sharing`,{shared});
    if (!app.current(context,false)) return;
    const local=context.store.books.get(book.id), saved=response.notebook;
    if (!context.store.dirty.has(book.id) && !app.editor && !app.gestures.size) {
      context.store.books.set(book.id,saved);context.store.baselines.set(book.id,clone(saved));
      if (app.book.id===book.id) {app.book=saved;app.page=saved.pages.find(entry=>entry.id===app.page.id)||saved.pages[0];app.render();}
      await context.store.persistBook(book.id);
    } else {
      const current=local?.pages.find(entry=>entry.id===page.id),fresh=saved.pages.find(entry=>entry.id===page.id);
      if (current) {if (fresh.sharing)current.sharing=clone(fresh.sharing);else delete current.sharing;}
    }
    context.store.nextDirectoryCheck=0;context.store.directoryVersion=null;app.renderNavigation();
    app.toast(shared ? '已共享给当前共享组，成员可使用编辑锁协作' : '已取消共享，其他成员不再有访问和编辑权限');
  } catch (error) {if (app.current(context,false))app.toast(error.message);}
  finally {app.sharingBusy=false;}
}
