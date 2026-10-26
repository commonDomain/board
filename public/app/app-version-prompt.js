function captureFocus() {
  const target = document.activeElement;
  let selection;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    selection = { start: target.selectionStart, end: target.selectionEnd, direction: target.selectionDirection };
  }
  const range = target?.isContentEditable && window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
  return () => {
    if (!(target instanceof HTMLElement) || !target.isConnected || target.inert || target === document.body) return false;
    target.focus({ preventScroll: true });
    if (selection?.start !== null && selection?.start !== undefined) target.setSelectionRange(selection.start, selection.end, selection.direction);
    if (range && target.contains(range.commonAncestorContainer)) {
      const current = window.getSelection(); current.removeAllRanges(); current.addRange(range);
    }
    return document.activeElement === target;
  };
}

// Event-driven deferral only; this never makes requests or polls for idle state.
function createUpdatePrompt() {
  const pointers = new Set();
  let composing = false, dragging = false, requested = null, timer = null, stopped = false, windowActive = true;
  const types = ['pointerdown', 'pointerup', 'pointercancel', 'compositionstart', 'compositionend', 'dragstart', 'dragend', 'drop', 'focusin', 'focusout', 'visibilitychange', 'close'];
  const editable = () => document.activeElement?.matches('textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),[contenteditable]:not([contenteditable=false]),[role=textbox]') || document.activeElement?.isContentEditable;
  function cancel() {
    stopped = true; requested = null; clearTimeout(timer);
    for (const type of types) document.removeEventListener(type, onInteraction, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    observer.disconnect();
  }
  function attempt() {
    timer = null;
    if (!requested || stopped || !windowActive || document.hidden || composing || dragging || pointers.size || editable() ||
        document.querySelector('dialog[open]') || document.documentElement.classList.contains('privacy-locked')) return;
    const show = requested, restore = captureFocus();
    cancel();
    show(restore);
  }
  function schedule() {
    if (!requested || stopped) return;
    clearTimeout(timer); timer = setTimeout(attempt, 250);
  }
  function onBlur() { windowActive = false; pointers.clear(); dragging = false; composing = false; clearTimeout(timer); timer = null; }
  function onFocus() { windowActive = true; schedule(); }
  function onInteraction(event) {
    if (event.type === 'pointerdown') pointers.add(event.pointerId);
    if (event.type === 'pointerup' || event.type === 'pointercancel') pointers.delete(event.pointerId);
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    if (event.type === 'dragstart') dragging = true;
    if (event.type === 'dragend' || event.type === 'drop') dragging = false;
    schedule();
  }
  const observer = new MutationObserver(schedule);
  for (const type of types) document.addEventListener(type, onInteraction, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return { request(show) { if (!stopped) {
    requested = show;
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
    attempt();
  } }, cancel };
}

export { createUpdatePrompt };
