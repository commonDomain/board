'use strict';

(() => {
  const root = document.documentElement;
  const itemId = root.dataset.itemId;
  const instanceNonce = root.dataset.instanceNonce;
  const key = root.dataset.amapKey;
  const serviceHost = root.dataset.serviceHost;
  const status = document.getElementById('status');
  let AMapApi = null;
  let map = null;
  let pendingState = null;
  let applying = false;
  let marker = null;
  let routeLine = null;
  let readyPosted = false;
  let readyTimer = null;

  function post(type, payload = {}) {
    window.parent.postMessage({ type, itemId, instanceNonce, ...payload }, location.origin);
  }

  function setStatus(message) {
    status.textContent = message || '';
    status.hidden = !message;
  }

  function locationArray(value) {
    const lng = Number(value?.lng);
    const lat = Number(value?.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  function announceMapReady(createdMap) {
    if (readyPosted || map !== createdMap) return;
    readyPosted = true;
    clearTimeout(readyTimer);
    readyTimer = null;
    setStatus('');
    post('muse-amap-ready');
  }

  function scheduleMapTimeout(createdMap) {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (readyPosted || map !== createdMap) return;
      setStatus('底图加载失败，请检查 JS Key、安全密钥与域名配置');
      post('muse-amap-error', { code: 'BASE_MAP_TIMEOUT' });
    }, 10_000);
  }

  function createMap(state) {
    if (map) return;
    marker = null;
    routeLine = null;
    const center = locationArray(state?.map?.center) || [116.397428, 39.90923];
    map = new AMapApi.Map('map', {
      viewMode: '2D',
      center,
      zoom: Number(state?.map?.zoom) || 11,
      pitch: 0,
      rotation: Number(state?.map?.heading) || 0,
      resizeEnable: true,
      showLabel: true
    });
    const createdMap = map;
    map.on('complete', () => announceMapReady(createdMap));
    scheduleMapTimeout(createdMap);
    map.on('moveend', publishView);
    map.on('zoomend', publishView);
    map.on('rotatechange', publishView);
  }

  function publishView() {
    if (!map || applying) return;
    const center = map.getCenter();
    post('muse-amap-view', {
      view: {
        center: { lng: Number(center.lng.toFixed(6)), lat: Number(center.lat.toFixed(6)) },
        zoom: map.getZoom(),
        pitch: 0,
        heading: typeof map.getRotation === 'function' ? map.getRotation() : 0,
        viewMode: '2D'
      }
    });
  }

  function applyState(state) {
    pendingState = state;
    if (!AMapApi) return;
    applying = true;
    try {
      createMap(state);
      const center = locationArray(state?.map?.center);
      if (center) map.setCenter(center, true);
      if (Number.isFinite(Number(state?.map?.zoom))) map.setZoom(Number(state.map.zoom), true);
      if (Number.isFinite(Number(state?.map?.heading))) map.setRotation(Number(state.map.heading), true);

      const selected = state?.selectedPoi;
      const selectedLocation = locationArray(selected?.location);
      if (marker) {
        map.remove(marker);
        marker = null;
      }
      if (selectedLocation) {
        marker = new AMapApi.Marker({ position: selectedLocation, title: String(selected.name || '选中地点').slice(0, 120) });
        map.add(marker);
      }

      if (routeLine) {
        map.remove(routeLine);
        routeLine = null;
      }
      const routePath = (state?.route?.polyline || []).map(locationArray).filter(Boolean);
      if (routePath.length > 1) {
        routeLine = new AMapApi.Polyline({
          path: routePath,
          strokeColor: '#6957f5',
          strokeWeight: 7,
          strokeOpacity: 0.9,
          showDir: true,
          lineJoin: 'round'
        });
        map.add(routeLine);
        if (state.fitRoute) map.setFitView([routeLine], false, [48, 48, 48, 48], 18);
      }
    } finally {
      requestAnimationFrame(() => { applying = false; });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'muse-amap-state' || data.itemId !== itemId || data.instanceNonce !== instanceNonce) return;
    applyState(data.state || {});
  });

  window._AMapSecurityConfig = { serviceHost };
  const script = document.createElement('script');
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&callback=__museAmapLoaded`;
  script.async = true;
  script.onerror = () => {
    setStatus('地图加载失败，请检查网络或配置');
    post('muse-amap-error', { code: 'LOAD_FAILED' });
  };
  window.__museAmapLoaded = () => {
    AMapApi = window.AMap;
    if (!AMapApi) {
      setStatus('地图初始化失败');
      post('muse-amap-error', { code: 'INIT_FAILED' });
      return;
    }
    applyState(pendingState || {});
  };
  document.head.appendChild(script);
})();
