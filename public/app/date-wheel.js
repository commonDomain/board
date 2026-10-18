// Shared date control for chat filters and planning forms.
const ROW_HEIGHT = 36;
const pad = value => String(value).padStart(2, '0');
const localToday = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
};
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const format = parts => `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createDateWheel({ label, value = '', placeholder = '选择日期' }) {
  const root = element('div', 'date-wheel-control');
  const input = element('input', 'date-wheel-value');
  input.type = 'hidden';
  input.setAttribute('aria-label', label);
  const trigger = element('button', 'date-wheel-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  const caption = element('span', 'date-wheel-caption');
  const glyph = element('span', 'date-wheel-glyph', '▾');
  glyph.setAttribute('aria-hidden', 'true');
  trigger.append(caption, glyph);
  const popup = element('div', 'date-wheel-popup');
  popup.id = `date-wheel-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
  popup.setAttribute('popover', 'auto');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', `选择${label}`);
  trigger.setAttribute('aria-controls', popup.id);
  const heading = element('div', 'date-wheel-heading', label);
  const wheels = element('div', 'date-wheel-columns');
  const preview = element('p', 'date-wheel-preview');
  preview.setAttribute('aria-live', 'polite');
  const actions = element('div', 'date-wheel-actions');
  popup.append(heading, wheels, preview, actions);
  root.append(input, trigger, popup);

  // Keep reset and restored form drafts in sync with the visible button.
  const valueProperty = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    get() { return valueProperty.get.call(input); },
    set(next) {
      valueProperty.set.call(input, next ?? '');
      caption.textContent = input.value ? input.value.replaceAll('-', ' / ') : placeholder;
      trigger.setAttribute('aria-label', `${label}：${input.value || placeholder}`);
      trigger.classList.toggle('is-empty', !input.value);
    }
  });
  input.value = value;
  let selected = localToday();
  const columns = [];
  const isOpen = () => popup.matches(':popover-open');
  function close() { if (isOpen()) popup.hidePopover(); }
  function commit(next) {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    trigger.focus({ preventScroll: true });
  }
  function position() {
    if (!isOpen()) return;
    const rect = trigger.getBoundingClientRect();
    const width = popup.offsetWidth, height = popup.offsetHeight;
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - height - 8))}px`;
  }
  function mark(column) {
    const index = selected[column.part] - column.min;
    for (const option of column.list.children) option.setAttribute('aria-selected', String(Number(option.dataset.value) === selected[column.part]));
    column.list.setAttribute('aria-activedescendant', column.list.children[index].id);
    preview.textContent = `${selected[0]} 年 ${selected[1]} 月 ${selected[2]} 日`;
  }
  function pick(column, next, align = true) {
    const previousDays = daysInMonth(selected[0], selected[1]);
    selected[column.part] = Math.max(column.min, Math.min(column.max, next));
    selected[2] = Math.min(selected[2], daysInMonth(selected[0], selected[1]));
    if (previousDays !== daysInMonth(selected[0], selected[1])) fill(columns[2], 1, daysInMonth(selected[0], selected[1]));
    mark(column);
    if (align) column.list.scrollTop = (selected[column.part] - column.min) * ROW_HEIGHT;
  }
  function fill(column, min, max) {
    column.min = min; column.max = max;
    column.list.replaceChildren();
    for (let item = min; item <= max; item++) {
      const option = element('div', 'date-wheel-option', `${item}${column.suffix}`);
      option.id = `${popup.id}-${column.part}-${item}`;
      option.dataset.value = item;
      option.setAttribute('role', 'option');
      column.list.append(option);
    }
    mark(column);
    column.list.scrollTop = (selected[column.part] - min) * ROW_HEIGHT;
  }
  function endDrag(column) {
    const drag = column.drag;
    if (!drag) return;
    column.drag = null;
    column.list.classList.remove('is-dragging');
    if (column.list.hasPointerCapture(drag.pointerId)) column.list.releasePointerCapture(drag.pointerId);
    if (drag.moved) {
      column.suppressClick = true;
      clearTimeout(column.timer);
      if (isOpen()) pick(column, column.min + Math.round(column.list.scrollTop / ROW_HEIGHT));
    }
  }
  for (const [part, suffix] of ['年', '月', '日'].entries()) {
    const wrap = element('div', 'date-wheel-column');
    const list = element('div', 'date-wheel-list');
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', `${label} · ${suffix}`);
    wrap.append(element('span', 'date-wheel-column-label', suffix), list);
    wheels.append(wrap);
    const column = { part, suffix, list, timer: null, min: 1, max: 1, drag: null, suppressClick: false };
    columns.push(column);
    // Touch uses native scrolling; a mouse can grab and slide the same wheel.
    list.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      column.suppressClick = false;
      clearTimeout(column.timer);
      column.drag = { pointerId: event.pointerId, y: event.clientY, scrollTop: list.scrollTop, moved: false };
      list.focus({ preventScroll: true });
    });
    list.addEventListener('pointermove', event => {
      const drag = column.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) { endDrag(column); return; }
      const delta = drag.y - event.clientY;
      if (!drag.moved && Math.abs(delta) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        list.classList.add('is-dragging');
        list.setPointerCapture(event.pointerId);
      }
      event.preventDefault(); event.stopPropagation();
      list.scrollTop = drag.scrollTop + delta;
      pick(column, column.min + Math.round(list.scrollTop / ROW_HEIGHT), false);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) list.addEventListener(type, event => {
      if (column.drag?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      endDrag(column);
    });
    list.addEventListener('pointerleave', () => { if (column.drag && !column.drag.moved) endDrag(column); });
    list.addEventListener('click', event => {
      if (column.suppressClick) { column.suppressClick = false; event.preventDefault(); return; }
      const option = event.target.closest('.date-wheel-option');
      if (option) pick(column, Number(option.dataset.value));
      list.focus({ preventScroll: true });
    });
    list.addEventListener('scroll', () => {
      clearTimeout(column.timer);
      if (column.drag?.moved) return;
      column.timer = setTimeout(() => {
        if (isOpen()) pick(column, column.min + Math.round(list.scrollTop / ROW_HEIGHT), false);
      }, 100);
    });
    list.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      if (event.deltaY) pick(column, selected[part] + Math.sign(event.deltaY));
    }, { passive: false });
    list.addEventListener('keydown', event => {
      const offsets = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
      if (Object.hasOwn(offsets, event.key) || ['Home', 'End'].includes(event.key)) {
        event.preventDefault();
        pick(column, event.key === 'Home' ? column.min : event.key === 'End' ? column.max : selected[part] + offsets[event.key]);
      }
      if (event.key === 'Enter') { event.preventDefault(); confirm(); }
    });
  }
  function render() {
    const currentYear = localToday()[0];
    fill(columns[0], Math.min(1900, currentYear - 100, selected[0]), Math.max(2100, currentYear + 100, selected[0]));
    fill(columns[1], 1, 12);
    fill(columns[2], 1, daysInMonth(selected[0], selected[1]));
  }
  function confirm() {
    // Include touch scrolling that has not reached the debounce callback yet.
    for (const column of columns) pick(column, column.min + Math.round(column.list.scrollTop / ROW_HEIGHT), false);
    commit(format(selected));
  }
  for (const [name, action] of [
    ['今天', () => { selected = localToday(); render(); }],
    ['清除', () => commit('')],
    ['取消', () => { close(); trigger.focus({ preventScroll: true }); }],
    ['确定', confirm]
  ]) {
    const button = element('button', `date-wheel-action${name === '确定' ? ' is-primary' : ''}`, name);
    button.type = 'button'; button.addEventListener('click', action); actions.append(button);
  }
  trigger.addEventListener('click', () => {
    if (isOpen()) { close(); return; }
    selected = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value.split('-').map(Number) : localToday();
    popup.showPopover(); render(); position();
    columns[0].list.focus({ preventScroll: true });
  });
  popup.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus({ preventScroll: true }); }
  });
  const onScroll = event => { if (!popup.contains(event.target)) position(); };
  popup.addEventListener('toggle', () => {
    const open = isOpen();
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      window.addEventListener('resize', position);
      document.addEventListener('scroll', onScroll, true);
    } else {
      for (const column of columns) { endDrag(column); clearTimeout(column.timer); }
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    }
  });
  return { root, input, close };
}
