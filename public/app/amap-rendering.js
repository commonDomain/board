import { pushUndoSnapshot } from './history-controller.js';
import { amapRequest } from './amap-api.js';
import { showToast } from './interface-model.js';
import { upsertItem } from './items.js';
import { canMutateItem } from './layers-model.js';
import { renderItem } from './rendering.js';
import { markDirty } from './save-status.js';
import { state } from './state.js';
import { enqueueOperation } from './sync-queue.js';
import { cssEscape } from './utilities.js';
import {
  amapHeader,
  stopAmapControlPointer,
  bindAmapCardWheel,
  formatDistance,
  formatDuration,
  exitAmapInteraction,
  browserCoordinates,
  amapErrorMessage,
  amapRouteCity,
  amapFrameState
} from './amap-rendering-model.js';

const amapFrames = new Map();

function renderAmapMap(item) {
  const card = document.createElement('div');
  card.className = 'amap-card amap-map-card';
  const header = amapHeader('map-pinned', '地图', item.place?.name || '2D 街道地图');
  const actions = document.createElement('div');
  actions.className = 'amap-card-actions';
  const locate = document.createElement('button');
  locate.type = 'button';
  locate.className = 'amap-icon-button';
  locate.title = '定位';
  locate.setAttribute('aria-label', '定位当前位置');
  locate.innerHTML = '<i data-lucide="locate-fixed" aria-hidden="true"></i>';
  actions.append(locate);
  header.appendChild(actions);

  const mount = document.createElement('div');
  mount.className = 'amap-map-mount';
  const iframe = document.createElement('iframe');
  iframe.className = 'amap-map-frame';
  iframe.title = '高德地图';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.dataset.boardId = state.boardId;
  iframe.src = `/api/navigation/map-frame?boardId=${encodeURIComponent(state.boardId)}&itemId=${encodeURIComponent(item.id)}`;
  const shield = document.createElement('button');
  shield.type = 'button';
  shield.className = 'amap-map-shield';
  shield.innerHTML = '<i data-lucide="mouse-pointer-2" aria-hidden="true"></i><span>浏览地图</span>';
  shield.setAttribute('aria-label', '进入地图浏览模式');
  const status = document.createElement('div');
  status.className = 'amap-inline-status';
  status.hidden = true;
  mount.append(iframe, shield, status);
  card.append(header, mount);

  amapFrames.set(item.id, { iframe, nonce: null, status });
  locate.addEventListener('pointerdown', stopAmapControlPointer);
  shield.addEventListener('pointerdown', stopAmapControlPointer);
  locate.addEventListener('click', async (event) => {
    event.stopPropagation();
    await locateAmapItem(item.id, status, locate);
  });
  shield.addEventListener('click', (event) => {
    event.stopPropagation();
    enterAmapInteraction(item.id);
  });
  iframe.addEventListener('load', () => syncAmapFrame(item.id));
  return card;
}

function enterAmapInteraction(itemId) {
  exitAmapInteraction();
  state.amapInteractiveId = itemId;
  const node = document.querySelector(`.board-item[data-item-id="${cssEscape(itemId)}"]`);
  node?.classList.add('amap-interacting');
  node?.querySelector('.amap-map-frame')?.focus({ preventScroll: true });
  showToast('地图浏览模式，按 Esc 返回画布');
}

async function locateAmapItem(itemId, status, button) {
  const item = state.items.get(itemId);
  if (!item) return;
  button.disabled = true;
  status.hidden = false;
  status.textContent = '正在定位…';
  try {
    const coordinates = await browserCoordinates();
    const result = await amapRequest('/api/navigation/locate', { itemId, ...(coordinates ? { coordinates } : {}) });
    const current = state.items.get(itemId);
    if (!current || !result.place) return;
    upsertItem(
      { ...current, center: result.place.location, zoom: result.mode === 'ip' ? 11 : 16, place: result.place },
      { select: true }
    );
    status.hidden = true;
    showToast(result.mode === 'ip' ? '已根据网络定位到当前城市' : '定位完成');
  } catch (error) {
    status.textContent = amapErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}

function renderAmapSearch(item) {
  const card = document.createElement('div');
  card.className = 'amap-card amap-search-card';
  card.appendChild(amapHeader('search', '地点搜索', item.selectedPoi?.name || `${item.results?.length || 0} 条结果`));
  const form = document.createElement('form');
  form.className = 'amap-search-form';
  const input = document.createElement('input');
  input.type = 'search';
  input.value = item.query || '';
  input.placeholder = '搜索地点、地址或商户';
  input.maxLength = 80;
  input.setAttribute('aria-label', '搜索地点');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.innerHTML = '<i data-lucide="search" aria-hidden="true"></i><span>搜索</span>';
  form.append(input, submit);
  const status = document.createElement('div');
  status.className = 'amap-inline-status';
  status.hidden = true;
  const results = document.createElement('div');
  results.className = 'amap-poi-results';
  results.setAttribute('role', 'listbox');
  for (const poi of item.results || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'amap-poi-result';
    button.classList.toggle('active', poi.id && poi.id === item.selectedPoi?.id);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(poi.id && poi.id === item.selectedPoi?.id));
    const name = document.createElement('strong');
    name.textContent = poi.name;
    const address = document.createElement('span');
    address.textContent = poi.address || poi.district || '暂无详细地址';
    const meta = document.createElement('small');
    meta.textContent =
      poi.distance === null || poi.distance === undefined ? poi.type || '' : formatDistance(poi.distance);
    button.append(name, address, meta);
    button.addEventListener('pointerdown', stopAmapControlPointer);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      selectAmapPoi(item.id, poi);
    });
    results.appendChild(button);
  }
  if (!item.results?.length) {
    const empty = document.createElement('div');
    empty.className = 'amap-empty-state';
    empty.innerHTML = '<i data-lucide="map-pin" aria-hidden="true"></i><span>输入关键词查找地点</span>';
    results.appendChild(empty);
  }
  form.addEventListener('pointerdown', stopAmapControlPointer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const query = input.value.trim();
    if (query.length < 2) {
      status.hidden = false;
      status.textContent = '至少输入 2 个字符';
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = '正在搜索…';
    try {
      const mapPlace = Array.from(state.items.values()).find((entry) => entry.type === 'amap-map')?.place;
      const city = item.city || mapPlace?.citycode || mapPlace?.adcode || mapPlace?.district || '';
      const result = await amapRequest('/api/navigation/search', { itemId: item.id, query, city });
      const current = state.items.get(item.id);
      if (current) {
        upsertItem(
          { ...current, query: result.query, city, results: result.pois || [], selectedPoi: result.pois?.[0] || null },
          { select: true }
        );
        syncAllAmapFrames();
      }
    } catch (error) {
      status.textContent = amapErrorMessage(error);
    } finally {
      submit.disabled = false;
    }
  });
  card.append(form, status, results);
  bindAmapCardWheel(card, results);
  return card;
}

function commitLinkedAmapItems(items) {
  const valid = items.filter((item) => item && state.items.has(item.id) && canMutateItem(state.items.get(item.id)));
  if (!valid.length) return;
  pushUndoSnapshot();
  for (const item of valid) {
    state.items.set(item.id, item);
    renderItem(item);
  }
  enqueueOperation({ kind: 'batch', ops: valid.map((item) => ({ kind: 'upsert', item })) });
  markDirty(true);
  syncAllAmapFrames();
}

function selectAmapPoi(searchItemId, poi) {
  const search = state.items.get(searchItemId);
  if (!search) return;
  const updates = [{ ...search, selectedPoi: poi }];
  const map = Array.from(state.items.values()).find((item) => item.type === 'amap-map');
  if (map) updates.push({ ...map, center: poi.location, zoom: 16, place: poi });
  commitLinkedAmapItems(updates);
}

function createAmapRouteAutocomplete(item, endpoint, label, placeholder) {
  const field = document.createElement('div');
  field.className = 'amap-route-field';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = 80;
  input.autocomplete = 'off';
  input.value = item[endpoint]?.name || '';
  input.setAttribute('aria-label', label);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  const listId = `amap-route-${item.id}-${endpoint}-suggestions`;
  list.id = listId;
  list.className = 'amap-route-suggestions';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `${label}地址选项`);
  list.hidden = true;
  input.setAttribute('aria-controls', listId);
  field.append(input, list);

  let suggestions = [];
  let activeIndex = -1;
  let requestSequence = 0;
  let debounceTimer = null;
  let selectedPoi = item[endpoint]?.location ? item[endpoint] : null;

  const close = () => {
    clearTimeout(debounceTimer);
    requestSequence += 1;
    suggestions = [];
    activeIndex = -1;
    list.hidden = true;
    list.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const setActive = (index) => {
    if (!suggestions.length) return;
    activeIndex = (index + suggestions.length) % suggestions.length;
    const options = Array.from(list.querySelectorAll('[role="option"]'));
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
    const activeOption = options[activeIndex];
    if (activeOption) {
      input.setAttribute('aria-activedescendant', activeOption.id);
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  };
  const selectPoi = (poi) => {
    if (!poi?.location) return;
    selectedPoi = poi;
    input.value = poi.name;
    close();
    input.focus({ preventScroll: true });
  };
  const renderSuggestions = (message = '') => {
    list.textContent = '';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    if (message) {
      const status = document.createElement('div');
      status.className = 'amap-route-suggestion-status';
      status.setAttribute('role', 'status');
      status.textContent = message;
      list.appendChild(status);
      return;
    }
    suggestions.forEach((poi, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `${listId}-${index}`;
      option.className = 'amap-route-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const name = document.createElement('strong');
      name.textContent = poi.name;
      const address = document.createElement('span');
      address.textContent = poi.address || poi.district || '暂无详细地址';
      option.append(name, address);
      option.addEventListener('pointerdown', stopAmapControlPointer);
      option.addEventListener('pointerenter', () => setActive(index));
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        selectPoi(poi);
      });
      list.appendChild(option);
    });
    if (!suggestions.length) renderSuggestions('没有匹配的地址');
  };
  const loadSuggestions = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      close();
      return;
    }
    const sequence = ++requestSequence;
    renderSuggestions('正在查找地址…');
    try {
      const result = await amapRequest('/api/navigation/suggest', {
        itemId: item.id,
        query,
        city: amapRouteCity(item)
      });
      if (sequence !== requestSequence || !input.isConnected || input.value.trim() !== query) return;
      suggestions = (result.suggestions || []).filter((poi) => poi?.location).slice(0, 8);
      activeIndex = -1;
      renderSuggestions();
    } catch (error) {
      if (sequence !== requestSequence || !input.isConnected) return;
      suggestions = [];
      activeIndex = -1;
      renderSuggestions(amapErrorMessage(error));
    }
  };
  const scheduleSuggestions = (delay = 320) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadSuggestions, delay);
  };
  input.addEventListener('input', () => {
    if (input.value.trim() === selectedPoi?.name) return close();
    selectedPoi = null;
    scheduleSuggestions();
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) scheduleSuggestions(0);
  });
  input.addEventListener('blur', () =>
    setTimeout(() => {
      if (!field.contains(document.activeElement)) close();
    }, 120)
  );
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      event.preventDefault();
      event.stopPropagation();
      selectPoi(suggestions[activeIndex]);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });

  return { field, input, selectPoi, getPoi: () => selectedPoi };
}

function renderAmapRoute(item) {
  const card = document.createElement('div');
  card.className = 'amap-card amap-route-card';
  const selected = (item.routes || []).find((route) => route.id === item.selectedRouteId) || item.routes?.[0];
  card.appendChild(
    amapHeader(
      'route',
      '路线规划',
      selected ? `${formatDistance(selected.distance)} · ${formatDuration(selected.duration)}` : '设置起点和终点'
    )
  );
  const form = document.createElement('form');
  form.className = 'amap-route-form';
  const mode = document.createElement('select');
  mode.className = 'studio-select amap-route-mode';
  mode.setAttribute('aria-label', '出行方式');
  for (const [value, label] of [
    ['driving', '驾车'],
    ['transit', '公交'],
    ['walking', '步行'],
    ['riding', '骑行']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = item.mode === value;
    mode.appendChild(option);
  }
  const originAutocomplete = createAmapRouteAutocomplete(item, 'origin', '路线起点', '输入起点');
  const destinationAutocomplete = createAmapRouteAutocomplete(item, 'destination', '路线终点', '输入终点');
  const origin = originAutocomplete.input;
  const destination = destinationAutocomplete.input;
  const selectedPoi = Array.from(state.items.values()).find((entry) => entry.type === 'amap-search')?.selectedPoi;
  if (selectedPoi) {
    const useSelected = document.createElement('button');
    useSelected.type = 'button';
    useSelected.className = 'amap-use-selected';
    useSelected.textContent = `终点使用“${selectedPoi.name}”`;
    useSelected.addEventListener('pointerdown', stopAmapControlPointer);
    useSelected.addEventListener('click', (event) => {
      event.stopPropagation();
      destinationAutocomplete.selectPoi(selectedPoi);
    });
    form.append(mode, originAutocomplete.field, destinationAutocomplete.field, useSelected);
  } else {
    form.append(mode, originAutocomplete.field, destinationAutocomplete.field);
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'amap-route-submit';
  submit.innerHTML = '<i data-lucide="navigation" aria-hidden="true"></i><span>开始规划</span>';
  form.appendChild(submit);
  const status = document.createElement('div');
  status.className = 'amap-inline-status';
  status.hidden = true;
  const alternatives = document.createElement('div');
  alternatives.className = 'amap-route-alternatives';
  for (const route of item.routes || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'amap-route-option';
    button.classList.toggle('active', route.id === (item.selectedRouteId || item.routes[0]?.id));
    button.innerHTML = `<strong>${formatDuration(route.duration)}</strong><span>${formatDistance(route.distance)}</span>`;
    button.addEventListener('pointerdown', stopAmapControlPointer);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = state.items.get(item.id);
      if (current) upsertItem({ ...current, selectedRouteId: route.id }, { select: true });
      syncAllAmapFrames(true);
    });
    alternatives.appendChild(button);
  }
  if (selected?.steps?.length) {
    const steps = document.createElement('ol');
    steps.className = 'amap-route-steps';
    for (const step of selected.steps.slice(0, 20)) {
      const row = document.createElement('li');
      row.textContent = step.instruction || step.road;
      steps.appendChild(row);
    }
    alternatives.appendChild(steps);
  }
  form.addEventListener('pointerdown', stopAmapControlPointer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const originName = origin.value.trim();
    const destinationName = destination.value.trim();
    if (originName.length < 2 || destinationName.length < 2) {
      status.hidden = false;
      status.textContent = '请输入至少 2 个字符的起点和终点';
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = '正在查找起终点…';
    try {
      const current = state.items.get(item.id);
      const resolvePoi = async (name, existing, selectedPoi) => {
        if (selectedPoi?.name === name && selectedPoi.location) return selectedPoi;
        if (existing?.name === name && existing.location) return existing;
        const response = await amapRequest('/api/navigation/search', { itemId: item.id, query: name });
        if (!response.pois?.length) throw new Error(`没有找到“${name}”`);
        return response.pois[0];
      };
      const [originPoi, destinationPoi] = await Promise.all([
        resolvePoi(originName, current?.origin, originAutocomplete.getPoi()),
        resolvePoi(destinationName, current?.destination, destinationAutocomplete.getPoi())
      ]);
      status.textContent = '正在规划路线…';
      const response = await amapRequest('/api/navigation/routes', {
        itemId: item.id,
        mode: mode.value,
        origin: originPoi.location,
        destination: destinationPoi.location,
        originId: originPoi.id || '',
        destinationId: destinationPoi.id || '',
        city1: originPoi.citycode || originPoi.adcode || originPoi.district || '',
        city2: destinationPoi.citycode || destinationPoi.adcode || destinationPoi.district || ''
      });
      const latest = state.items.get(item.id);
      if (latest)
        upsertItem(
          {
            ...latest,
            mode: response.mode,
            origin: originPoi,
            destination: destinationPoi,
            routes: response.routes || [],
            selectedRouteId: response.routes?.[0]?.id || ''
          },
          { select: true }
        );
      syncAllAmapFrames(true);
    } catch (error) {
      status.textContent = amapErrorMessage(error);
    } finally {
      submit.disabled = false;
    }
  });
  card.append(form, status, alternatives);
  bindAmapCardWheel(card, alternatives);
  return card;
}

function syncAmapFrame(itemId, fitRoute = false) {
  const frame = amapFrames.get(itemId);
  const item = state.items.get(itemId);
  if (!frame?.nonce || !frame.iframe.contentWindow || item?.type !== 'amap-map') return;
  frame.iframe.contentWindow.postMessage(
    {
      type: 'muse-amap-state',
      itemId,
      instanceNonce: frame.nonce,
      state: { ...amapFrameState(item), fitRoute }
    },
    location.origin
  );
}

function syncAllAmapFrames(fitRoute = false) {
  for (const itemId of amapFrames.keys()) syncAmapFrame(itemId, fitRoute);
}

function wireAmapMessages() {
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || !String(data.type || '').startsWith('muse-amap-')) return;
    const frame = amapFrames.get(data.itemId);
    if (!frame || event.source !== frame.iframe.contentWindow) return;
    if (data.type === 'muse-amap-ready') {
      frame.nonce = data.instanceNonce;
      syncAmapFrame(data.itemId);
      return;
    }
    if (data.instanceNonce !== frame.nonce) return;
    if (data.type === 'muse-amap-error') {
      frame.status.hidden = false;
      frame.status.textContent = '地图加载失败，已保留地点与路线信息';
      return;
    }
    if (data.type === 'muse-amap-view' && state.amapInteractiveId === data.itemId) {
      clearTimeout(state.amapViewTimers.get(data.itemId));
      state.amapViewTimers.set(
        data.itemId,
        setTimeout(() => {
          state.amapViewTimers.delete(data.itemId);
          const item = state.items.get(data.itemId);
          if (!item || item.type !== 'amap-map') return;
          upsertItem(
            {
              ...item,
              center: data.view?.center || item.center,
              zoom: Number(data.view?.zoom) || item.zoom,
              pitch: 0,
              heading: Number(data.view?.heading) || 0,
              viewMode: '2D'
            },
            { history: false, rerender: false }
          );
        }, 750)
      );
    }
  });
}

function destroyAmapFrame(itemId) {
  const timer = state.amapViewTimers.get(itemId);
  if (timer) clearTimeout(timer);
  state.amapViewTimers.delete(itemId);
  amapFrames.delete(itemId);
  if (state.amapInteractiveId === itemId) state.amapInteractiveId = null;
}

function destroyAllAmapFrames() {
  for (const itemId of Array.from(amapFrames.keys())) destroyAmapFrame(itemId);
}
export {
  amapFrames,
  renderAmapMap,
  enterAmapInteraction,
  locateAmapItem,
  renderAmapSearch,
  commitLinkedAmapItems,
  selectAmapPoi,
  createAmapRouteAutocomplete,
  renderAmapRoute,
  syncAmapFrame,
  syncAllAmapFrames,
  wireAmapMessages,
  destroyAmapFrame,
  destroyAllAmapFrames
};
