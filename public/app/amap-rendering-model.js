import { state } from './state.js';
import { cssEscape } from './utilities.js';

function amapHeader(icon, title, subtitle) {
  const header = document.createElement('div');
  header.className = 'amap-card-header';
  const identity = document.createElement('div');
  identity.className = 'amap-card-identity';
  identity.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
  const copy = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = subtitle;
  copy.append(strong, small);
  identity.appendChild(copy);
  header.appendChild(identity);
  return header;
}

function stopAmapControlPointer(event) {
  event.stopPropagation();
}

function getAmapWheelCard(event, explicitCard = null) {
  if (explicitCard?.matches?.('.amap-search-card, .amap-route-card')) return explicitCard;
  const targetCard =
    event.target instanceof Element ? event.target.closest('.amap-search-card, .amap-route-card') : null;
  if (targetCard) return targetCard;
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  return (
    document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.amap-search-card, .amap-route-card') || null
  );
}

function handleAmapCardWheel(event, explicitCard = null, primaryScroller = null) {
  const card = getAmapWheelCard(event, explicitCard);
  if (!card) return false;
  const target = event.target instanceof Element ? event.target : null;
  const hitTarget =
    Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
  const pointerTarget = target?.closest('.amap-search-card, .amap-route-card') === card ? target : hitTarget;
  const directScroller = pointerTarget?.closest?.(
    '.amap-route-suggestions, .amap-poi-results, .amap-route-alternatives'
  );
  const fieldSuggestions = pointerTarget
    ?.closest?.('.amap-route-field')
    ?.querySelector('.amap-route-suggestions:not([hidden])');
  const openSuggestions = card.querySelector('.amap-route-suggestions:not([hidden])');
  const fallbackScroller = primaryScroller || card.querySelector('.amap-poi-results, .amap-route-alternatives');
  const scroller = directScroller || fieldSuggestions || openSuggestions || fallbackScroller;
  event.stopPropagation();
  event.preventDefault();
  if (!scroller || event.ctrlKey || event.metaKey) return true;
  const lineScale = event.deltaMode === 1 ? 16 : 1;
  const pageScale = event.deltaMode === 2 ? Math.max(1, scroller.clientHeight) : lineScale;
  scroller.scrollTop += event.deltaY * pageScale;
  scroller.scrollLeft += event.deltaX * pageScale;
  return true;
}

function bindAmapCardWheel(card, primaryScroller) {
  card.addEventListener(
    'wheel',
    (event) => {
      handleAmapCardWheel(event, card, primaryScroller);
    },
    { passive: false }
  );
}

function formatDistance(meters) {
  const value = Number(meters) || 0;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} 公里` : `${Math.round(value)} 米`;
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function updateAmapMapChrome(node, item) {
  const subtitle = node.querySelector('.amap-card-identity small');
  if (subtitle) subtitle.textContent = item.place?.name || '2D 街道地图';
}

function exitAmapInteraction() {
  if (!state.amapInteractiveId) return;
  document
    .querySelector(`.board-item[data-item-id="${cssEscape(state.amapInteractiveId)}"]`)
    ?.classList.remove('amap-interacting');
  state.amapInteractiveId = null;
}

async function browserCoordinates() {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lng: position.coords.longitude, lat: position.coords.latitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60_000 }
    );
  });
}

function amapErrorMessage(error) {
  if (error?.code === 'AMAP_QUOTA_EXCEEDED' && error.resetAt) {
    return `额度已用完，将于 ${new Date(error.resetAt).toLocaleString()} 恢复`;
  }
  return error?.message || '导航服务暂时不可用';
}

function amapRouteCity(item) {
  const mapPlace = Array.from(state.items.values()).find((entry) => entry.type === 'amap-map')?.place;
  const search = Array.from(state.items.values()).find((entry) => entry.type === 'amap-search');
  return item.city || mapPlace?.citycode || mapPlace?.adcode || search?.city || search?.selectedPoi?.citycode || '';
}

function amapFrameState(item) {
  const search = Array.from(state.items.values()).find((entry) => entry.type === 'amap-search');
  const routeItem = Array.from(state.items.values()).find((entry) => entry.type === 'amap-route');
  const route =
    (routeItem?.routes || []).find((entry) => entry.id === routeItem.selectedRouteId) || routeItem?.routes?.[0] || null;
  return {
    map: { ...item, viewMode: '2D', pitch: 0 },
    selectedPoi: search?.selectedPoi || item.place || null,
    route
  };
}
export {
  amapHeader,
  stopAmapControlPointer,
  getAmapWheelCard,
  handleAmapCardWheel,
  bindAmapCardWheel,
  formatDistance,
  formatDuration,
  updateAmapMapChrome,
  exitAmapInteraction,
  browserCoordinates,
  amapErrorMessage,
  amapRouteCity,
  amapFrameState
};
