let listenersReady = false;

function closeMenus(event) {
  for (const popup of document.querySelectorAll('.planning-row-menu-popup:popover-open')) {
    if (!popup.contains(event.target)) popup.hidePopover();
  }
}

function positionMenu(popup, toggle, point = null) {
  const anchor = toggle.getBoundingClientRect(), margin = 8, gap = 6;
  popup.style.maxHeight = `${Math.max(0, innerHeight - margin * 2)}px`;
  const rect = popup.getBoundingClientRect();
  const left = Math.max(margin, Math.min(point ? point.x : anchor.right - rect.width, innerWidth - rect.width - margin));
  const below = anchor.bottom + gap;
  const top = point ? point.y : below + rect.height <= innerHeight - margin ? below : anchor.top - gap - rect.height;
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(margin, Math.min(top, innerHeight - rect.height - margin))}px`;
}

export function createTaskMenu(title, actions, taskRow = null) {
  if (!listenersReady) {
    listenersReady = true;
    // Capture also sees scrolling inside components whose events do not bubble.
    document.addEventListener('scroll', closeMenus, true);
    document.addEventListener('wheel', closeMenus, { capture: true, passive: true });
    window.addEventListener('resize', closeMenus);
  }
  const root = document.createElement('div'); root.className = 'planning-row-menu';
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.className = 'planning-row-menu-toggle'; toggle.textContent = '更多';
  toggle.setAttribute('aria-label', `更多任务操作：${title}`);
  toggle.setAttribute('aria-expanded', 'false');
  const popup = document.createElement('div');
  popup.className = 'planning-row-menu-popup planning-toplevel';
  popup.popover = 'auto'; popup.setAttribute('aria-label', `任务操作：${title}`);
  popup.append(...actions); root.append(toggle, popup);
  toggle.addEventListener('click', event => {
    popup.togglePopover({ source: toggle });
    if (popup.matches(':popover-open')) {
      positionMenu(popup, toggle);
      if (event.detail === 0) popup.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }
  });
  popup.addEventListener('beforetoggle', event => toggle.setAttribute('aria-expanded', String(event.newState === 'open')));
  popup.addEventListener('click', event => {
    if (event.target.closest('button:not(:disabled)') && popup.matches(':popover-open')) popup.hidePopover();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && popup.matches(':popover-open')) {
      event.preventDefault(); event.stopPropagation(); popup.hidePopover(); toggle.focus({ preventScroll: true });
    }
  });
  if (taskRow) {
    const openContext = event => {
      if (event.target.closest('textarea,select,input:not([type=checkbox]),[contenteditable=true]')) return;
      event.preventDefault(); event.stopPropagation();
      const keyboard = event.type === 'keydown' || event.clientX === 0 && event.clientY === 0;
      const rect = event.target.getBoundingClientRect();
      const point = keyboard ? { x: rect.left + Math.min(24, rect.width / 2), y: rect.bottom } : { x: event.clientX, y: event.clientY };
      const open = () => {
        if (!taskRow.isConnected) return;
        if (!popup.matches(':popover-open')) popup.showPopover({ source: toggle });
        positionMenu(popup, toggle, point);
        // Keep Escape inside the menu even when right-clicking a task title.
        (popup.querySelector('button:not(:disabled)') || toggle).focus({ preventScroll: true });
      };
      // WebKit dispatches contextmenu before finishing pointerdown dismissal.
      // Open after that native processing so the new popover stays visible.
      if (keyboard) open(); else requestAnimationFrame(open);
    };
    taskRow.addEventListener('contextmenu', openContext);
    taskRow.addEventListener('keydown', event => {
      if (!event.isComposing && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) openContext(event);
    });
  }
  return root;
}
