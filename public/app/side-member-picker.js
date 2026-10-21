import { node,action } from './side-tools-ui.js';

export function memberAvatar(user) {
  const avatar=node('span','side-member-avatar',Array.from(user?.username||'成员')[0]);
  avatar.setAttribute('aria-hidden','true');
  // Account avatars are authenticated same-origin resources; never fetch arbitrary URLs.
  if(typeof user?.avatarUrl==='string'&&/^\/api\/avatars\/[a-zA-Z0-9_-]+$/.test(user.avatarUrl)){
    const img=node('img');img.alt='';img.width=28;img.height=28;img.loading='lazy';img.decoding='async';
    img.addEventListener('error',()=>img.remove(),{once:true});img.src=user.avatarUrl;avatar.append(img);
  }
  return avatar;
}

export function memberPicker(select,label,dialog,resolveUser) {
  select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const wrapper=node('div','side-member-picker'),trigger=action('',()=>menu.hidden?open():close(),'side-picker-trigger');
  const menu=node('div','side-picker-menu sheet-action-menu');menu.hidden=true;menu.id=`${select.id}-menu`;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);
  trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',menu.id);trigger.setAttribute('aria-expanded','false');
  wrapper.append(select,trigger,menu);
  let signature='';
  function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function enabled(){return [...menu.children].filter(option=>!option.disabled);}
  function open(){
    if(trigger.disabled)return;
    menu.hidden=false;trigger.setAttribute('aria-expanded','true');
    // Anchor inside the wrapper. A glass dialog creates a containing block for
    // fixed descendants, so viewport coordinates would offset and clip the menu.
    const rect=trigger.getBoundingClientRect(),origin=wrapper.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();
    const left=Math.max(12,bounds.left+12),right=Math.min(innerWidth-12,bounds.right-12),top=Math.max(12,dialog.querySelector('.side-tool-header')?.getBoundingClientRect().bottom||bounds.top+12),bottom=Math.min(innerHeight-12,bounds.bottom-12);
    const below=Math.max(0,bottom-rect.bottom-4),above=Math.max(0,rect.top-top-4),height=Math.min(260,menu.scrollHeight);
    const width=Math.min(Math.max(rect.width,220),right-left),down=below>=height||below>=above,maxHeight=Math.min(260,down?below:above);
    menu.style.position='absolute';menu.style.width=`${width}px`;
    menu.style.left=`${Math.max(left,Math.min(rect.left,right-width))-origin.left}px`;
    menu.style.maxHeight=`${maxHeight}px`;
    menu.style.top=`${(down?rect.bottom+4:rect.top-Math.min(height,maxHeight)-4)-origin.top}px`;
    (enabled().find(option=>option.dataset.value===select.value)||enabled()[0])?.focus({preventScroll:true});
  }
  function sync(){
    const options=[...select.options],key=JSON.stringify([select.value,select.disabled,options.map(o=>[o.value,o.textContent,o.disabled,resolveUser(o.value)])]);
    if(key===signature)return;signature=key;close();trigger.disabled=select.disabled;
    const selected=options.find(o=>o.value===select.value),text=node('span','side-picker-text',selected?.textContent||'暂无成员');
    trigger.replaceChildren();const person=resolveUser(select.value);if(person)trigger.append(memberAvatar(person));
    const chevron=node('span','side-picker-chevron');chevron.setAttribute('aria-hidden','true');
    trigger.append(text,chevron);menu.replaceChildren();
    for(const option of options){
      const item=action('',()=>{select.value=option.value;close(true);select.dispatchEvent(new Event('change',{bubbles:true}));sync();},'sheet-action-menu-item side-picker-option');
      item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.value===select.value));item.dataset.value=option.value;item.disabled=option.disabled;item.tabIndex=-1;
      const user=resolveUser(option.value);if(user)item.append(memberAvatar(user));item.append(node('span','side-picker-text',option.textContent));menu.append(item);
    }
  }
  wrapper.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();if(menu.hidden){open();return;}
    const options=enabled(),index=options.indexOf(document.activeElement);
    options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length]?.focus({preventScroll:true});
  });
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close();});
  dialog.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();},true);
  dialog.addEventListener('scroll',event=>{if(event.target!==menu)close();},true);
  dialog.addEventListener('close',()=>close());window.addEventListener('resize',()=>close());
  select.addEventListener('change',sync);
  return {element:wrapper,sync,close};
}
