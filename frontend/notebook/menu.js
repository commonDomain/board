import { chooseMenuPlacement } from '../../public/app/menu-placement-model.js';
import { platformShortcut, setControlAvailability } from '../../public/app/ui-feedback.js';

// Legacy [label, run] entries remain supported; semantics are explicit metadata.
export function openNotebookMenu(app, title, actions, anchor, button, el, options = {}) {
  const context = app.context(), editor = app.editor;
  const selection = editor?.state.selection.getBookmark(), documentAtOpen=editor?.state.doc;
  const focus = anchor || document.activeElement;
  const dialog = el('dialog', 'nt-dialog nt-owned-dialog nt-menu');
  if(options.className)dialog.classList.add(options.className);
  dialog.setAttribute('aria-label', title);
  const heading = el('h2', '', title); dialog.append(heading);
  let previousGroup = null;
  let actionRan = false;
  const close = () => dialog.close();
  for (const entry of actions) {
    const option = Array.isArray(entry) ? {label:entry[0], run:entry[1], ...entry[2]} : entry;
    if (previousGroup !== null && option.group && option.group !== previousGroup) {
      const separator = el('div', 'nt-menu-separator'); separator.setAttribute('role','separator'); dialog.append(separator);
    }
    previousGroup = option.group || previousGroup;
    const item = button(option.label, option.icon || '', async () => {
      if (item.disabled || !app.current(context, false)) return;
      actionRan = true;
      close();
      if (editor && editor === app.editor && app.current(context) && !editor.isDestroyed && editor.state.doc===documentAtOpen) editor.view.dispatch(editor.state.tr.setSelection(selection.resolve(editor.state.doc)));
      return option.run();
    }, 'nt-menu-item');
    if (option.danger) item.classList.add('nt-danger');
    if (option.checked !== undefined) item.setAttribute('aria-pressed',String(option.checked));
    setControlAvailability(item, Boolean(option.disabled), option.reason);
    if (option.shortcut) item.append(el('kbd','nt-menu-shortcut',platformShortcut(option.shortcut)));
    if (option.disabled && option.reason) item.append(el('small','nt-menu-reason',option.reason));
    dialog.append(item);
  }
  if(options.cancel!==false)dialog.append(el('div','nt-menu-separator'), button('取消','',close,'nt-menu-cancel'));
  options.decorate?.(dialog);
  if (anchor) { dialog.classList.add('nt-menu-anchored'); anchor.setAttribute('aria-expanded','true'); }
  document.body.append(dialog); window.MuseIcons?.renderIcons(dialog); dialog.showModal();
  let frame = null;
  let anchorRect=anchor?.getBoundingClientRect();
  const position = () => {
    if (!dialog.open) return;
    if (anchor && !anchor.isConnected) return close();
    const v = window.visualViewport, left = v?.offsetLeft || 0, top = v?.offsetTop || 0;
    const width = v?.width || innerWidth, height = v?.height || innerHeight;
    const sheet = matchMedia('(pointer:coarse)').matches && width <= 1100;
    dialog.classList.toggle('nt-menu-sheet', sheet);
    const bounds = {left:left+8, top:top+8, right:left+width-8, bottom:top+height-8};
    dialog.style.maxWidth = `${Math.max(1,width-16)}px`; dialog.style.maxHeight = `${Math.max(1,height-16)}px`;
    if (!anchor && !sheet) return;
    const currentRect=anchor?.getBoundingClientRect();
    if(currentRect?.width && currentRect?.height)anchorRect=currentRect;
    const rect = options.point ? {left:options.point.x,right:options.point.x,top:options.point.y,bottom:options.point.y} : anchorRect || {left:left+width/2, right:left+width/2, top, bottom:top};
    const size = {width:sheet ? width-16 : Math.min(options.width||320,width-16), height:Math.min(dialog.scrollHeight+2,height-16)};
    const placed = chooseMenuPlacement({anchor:rect,size,bounds,sheet});
    dialog.dataset.side = placed.side;
    Object.assign(dialog.style,{left:`${placed.x}px`,top:`${placed.y}px`,width:`${placed.width}px`,maxHeight:`${placed.height}px`});
  };
  const schedule = event => { if(event?.type==='scroll' && dialog.contains(event.target))return; if(options.point && event?.type==='scroll' && event.target!==window.visualViewport)return close(); if (frame === null) frame = requestAnimationFrame(() => { frame = null; position(); }); };
  position();
  window.addEventListener('resize',schedule); document.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.visualViewport?.addEventListener('resize',schedule); window.visualViewport?.addEventListener('scroll',schedule);
  dialog.addEventListener('click',event => {
    const r=dialog.getBoundingClientRect();
    if(event.target===dialog && (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)) close();
  });
  dialog.addEventListener('cancel',event => { if (event.isComposing) event.preventDefault(); });
  dialog.addEventListener('keydown',event => {
    if (event.isComposing || event.keyCode === 229) return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault(); const items=[...dialog.querySelectorAll('button:not(:disabled)')], index=items.indexOf(document.activeElement);
    items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  });
  dialog.addEventListener('close',() => {
    if(frame!==null)cancelAnimationFrame(frame);
    window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);
    window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
    anchor?.setAttribute('aria-expanded','false');dialog.getAnimations().forEach(animation=>animation.cancel());dialog.remove();
    if(app.current(context) && !document.querySelector('.nt-dialog[open]') && (!actionRan || document.activeElement===document.body || dialog.contains(document.activeElement))) {
      if(options.restoreEditor && editor===app.editor && editor && !editor.isDestroyed)editor.view.focus();
      else if(focus?.isConnected)focus.focus({preventScroll:true});
    }
  },{once:true});
  return dialog;
}
