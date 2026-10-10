// Delegated feedback for editor controls. No document observers or content scans.
const shortcuts = {
  '撤销': '$mod Z', '重做': '$mod Shift Z', '保存': '$mod S'
};
const editorShortcuts = {'加粗':'$mod B','斜体':'$mod I','下划线':'$mod U'};
export function platformShortcut(value) {
  return String(value || '').replaceAll('$mod', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl');
}
export function setControlAvailability(control, disabled, reason = '') {
  if (!control) return;
  control.disabled = disabled;
  if (disabled && reason) {
    control.dataset.disabledReason = reason;
    control.setAttribute('aria-description', reason);
  } else {
    delete control.dataset.disabledReason;
    control.removeAttribute('aria-description');
  }
}
function hasVisibleControlText(control) {
  if(control.matches('select'))return true;
  if(control.matches('input')&&control.type!=='color'&&control.type!=='range'&&(control.placeholder||control.labels?.length))return true;
  return [control,...control.querySelectorAll('span,small,strong,label')].some(node=>{
    if(!node.getClientRects().length)return false;
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    if(style.visibility==='hidden'||rect.width<8||rect.height<8)return false;
    if(parseFloat(style.fontSize)>0&&[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()))return true;
    return ['::before','::after'].some(pseudo=>{const style=getComputedStyle(node,pseudo);return !['none','normal','""'].includes(style.content)&&parseFloat(style.fontSize)>0;});
  });
}
export function installUiFeedback() {
  const tooltip = document.createElement('div');
  tooltip.className = 'muse-tooltip'; tooltip.id = 'muse-control-tooltip';
  tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  tooltip.setAttribute('popover','manual');
  document.body.append(tooltip);
  let active = null, timer = null, originalTitle = '', descriptions = '';
  const hide = () => {
    clearTimeout(timer); if(tooltip.hidePopover && tooltip.matches(':popover-open'))tooltip.hidePopover(); tooltip.hidden = true;
    if (active) {
      if (originalTitle && !active.title && !hasVisibleControlText(active)) active.title = originalTitle;
      if (descriptions) active.setAttribute('aria-describedby', descriptions);
      else active.removeAttribute('aria-describedby');
    }
    active = null;
  };
  const show = () => {
    if (!active?.isConnected || !active.getClientRects().length || active.closest('[hidden]')) return hide();
    const label = active.dataset.tooltip || originalTitle || active.getAttribute('aria-label');
    const explained=hasVisibleControlText(active),reason=active.disabled?active.dataset.disabledReason:'';
    if(explained&&!reason)return hide();
    const shortcut = platformShortcut(active.dataset.shortcut || shortcuts[label] || (active.closest('.nt-app') && editorShortcuts[label]));
    tooltip.replaceChildren(document.createTextNode(explained?reason:label || ''));
    if (!explained&&shortcut) { const key = document.createElement('kbd'); key.textContent = shortcut; tooltip.append(key); }
    if (!explained&&reason) {
      const reason = document.createElement('span'); reason.className = 'muse-tooltip-reason';
      reason.textContent = active.dataset.disabledReason; tooltip.append(reason);
    }
    tooltip.dataset.mode = active.closest('.nt-app,.nt-owned-dialog') ? 'notebook' : 'canvas';
    tooltip.hidden = false;
    tooltip.showPopover?.();
    const r = active.getBoundingClientRect(), box = tooltip.getBoundingClientRect(), v = window.visualViewport;
    const left = v?.offsetLeft || 0, top = v?.offsetTop || 0, width = v?.width || innerWidth, height = v?.height || innerHeight;
    tooltip.style.left = `${Math.max(left + 8, Math.min(r.left + (r.width - box.width) / 2, left + width - box.width - 8))}px`;
    tooltip.style.top = `${Math.max(top + 8, Math.min(r.top - box.height - 8 >= top + 8 ? r.top - box.height - 8 : r.bottom + 8, top + height - box.height - 8))}px`;
    active.setAttribute('aria-describedby', `${descriptions} ${tooltip.id}`.trim());
  };
  const enter = (event, keyboard) => {
    if (!keyboard && (event.pointerType === 'touch' || !matchMedia('(hover:hover)').matches)) return;
    const control = event.target.closest?.('button,select,input,summary,[data-tooltip],[role=button]');
    if (!control || control.closest('.tiptap,.nt-title-block') || !(control.title || control.dataset.tooltip || control.getAttribute('aria-label'))) return;
    if(hasVisibleControlText(control)&&!(control.disabled&&control.dataset.disabledReason)) {hide();control.removeAttribute('title');return;}
    if (control === active) return;
    hide(); active = control; originalTitle = control.title; descriptions = control.getAttribute('aria-describedby') || '';
    control.removeAttribute('title');
    if (keyboard) show(); else timer = setTimeout(show, 400);
  };
  document.addEventListener('pointerover', event => enter(event, false));
  document.addEventListener('focusin', event => enter(event, true));
  document.addEventListener('pointerout', event => { if (active && !active.contains(event.relatedTarget)) hide(); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, {capture:true, passive:true});
  window.addEventListener('resize', hide);
  window.visualViewport?.addEventListener('resize', hide);
  window.visualViewport?.addEventListener('scroll', hide);
  document.addEventListener('close', hide, true);
  document.addEventListener('visibilitychange', hide);
}
