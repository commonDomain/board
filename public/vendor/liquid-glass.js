/*!
 * Adapted from deepika-builds/liquid-glass
 * https://github.com/deepika-builds/liquid-glass
 *
 * MIT License
 * Copyright (c) 2026 Deepika Rao
 *
 * This adaptation deliberately has no frosted-glass fallback. Unsupported
 * browsers receive no filter or material class.
 */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  let svgDefs = null;

  const supported = (() => {
    const userAgent = navigator.userAgent || '';
    const isSafari = /Safari/.test(userAgent) && !/Chrome|Chromium|Edg/.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    if (isSafari || isFirefox || !global.ResizeObserver) return false;
    if (!global.CSS?.supports?.('backdrop-filter', 'url(#lg)')) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  })();

  function ensureDefs() {
    if (svgDefs) return svgDefs;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    svgDefs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(svgDefs);
    document.body.appendChild(svg);
    return svgDefs;
  }

  function makeDisplacementMap(width, height, radius, border, mapBlur) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext('2d');

    const horizontal = context.createLinearGradient(0, 0, canvas.width, 0);
    horizontal.addColorStop(0, 'rgb(0,0,0)');
    horizontal.addColorStop(1, 'rgb(255,0,0)');
    context.fillStyle = horizontal;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const vertical = context.createLinearGradient(0, 0, 0, canvas.height);
    vertical.addColorStop(0, 'rgb(0,0,0)');
    vertical.addColorStop(1, 'rgb(0,0,255)');
    context.globalCompositeOperation = 'difference';
    context.fillStyle = vertical;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalCompositeOperation = 'source-over';
    const inset = border * Math.min(canvas.width, canvas.height);
    context.filter = `blur(${mapBlur}px)`;
    context.fillStyle = 'rgba(128,128,128,0.93)';
    context.beginPath();
    context.roundRect(
      inset,
      inset,
      Math.max(1, canvas.width - inset * 2),
      Math.max(1, canvas.height - inset * 2),
      Math.max(radius - inset, 2)
    );
    context.fill();
    context.filter = 'none';
    return canvas.toDataURL();
  }

  function buildFilter(id, scales) {
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const map = document.createElementNS(SVG_NS, 'feImage');
    map.setAttribute('x', '0');
    map.setAttribute('y', '0');
    map.setAttribute('result', 'map');
    map.setAttribute('preserveAspectRatio', 'none');
    filter.appendChild(map);

    const channelMatrices = [
      '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
    ];
    const channels = [];
    for (let index = 0; index < 3; index += 1) {
      const displacement = document.createElementNS(SVG_NS, 'feDisplacementMap');
      displacement.setAttribute('in', 'SourceGraphic');
      displacement.setAttribute('in2', 'map');
      displacement.setAttribute('scale', String(scales[index]));
      displacement.setAttribute('xChannelSelector', 'R');
      displacement.setAttribute('yChannelSelector', 'B');
      displacement.setAttribute('result', `displaced-${index}`);
      filter.appendChild(displacement);

      const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
      matrix.setAttribute('in', `displaced-${index}`);
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', channelMatrices[index]);
      matrix.setAttribute('result', `channel-${index}`);
      filter.appendChild(matrix);
      channels.push(`channel-${index}`);
    }

    const firstBlend = document.createElementNS(SVG_NS, 'feBlend');
    firstBlend.setAttribute('in', channels[0]);
    firstBlend.setAttribute('in2', channels[1]);
    firstBlend.setAttribute('mode', 'screen');
    firstBlend.setAttribute('result', 'channels-01');
    filter.appendChild(firstBlend);

    const secondBlend = document.createElementNS(SVG_NS, 'feBlend');
    secondBlend.setAttribute('in', 'channels-01');
    secondBlend.setAttribute('in2', channels[2]);
    secondBlend.setAttribute('mode', 'screen');
    filter.appendChild(secondBlend);

    ensureDefs().appendChild(filter);
    return { filter, map };
  }

  function resolveRadius(element, width, height, override) {
    if (override != null) return override;
    const raw = getComputedStyle(element).borderTopLeftRadius || '0px';
    const value = parseFloat(raw) || 0;
    return raw.trim().endsWith('%') ? (value / 100) * Math.min(width, height) : value;
  }

  function liquidGlass(element, options = {}) {
    if (!supported || !element) {
      return { supported: false, refresh() {}, destroy() {} };
    }

    const settings = Object.assign(
      { scale: -112, chroma: 6, border: 0.07, mapBlur: 12, blur: 3, saturate: 1.5, radius: null },
      options
    );
    const id = `lg-filter-${++uid}`;
    const filterParts = buildFilter(id, [
      settings.scale,
      settings.scale + settings.chroma,
      settings.scale + settings.chroma * 2
    ]);

    function refresh() {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!width || !height) return;
      const radius = resolveRadius(element, width, height, settings.radius);
      filterParts.map.setAttribute(
        'href',
        makeDisplacementMap(width, height, radius, settings.border, settings.mapBlur)
      );
      filterParts.map.setAttribute('width', String(width));
      filterParts.map.setAttribute('height', String(height));
    }

    refresh();
    element.style.backdropFilter =
      `url(#${id}) blur(${settings.blur}px) saturate(${settings.saturate})`;

    let timer = null;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    });
    resizeObserver.observe(element);

    return {
      supported: true,
      refresh,
      destroy() {
        resizeObserver.disconnect();
        clearTimeout(timer);
        filterParts.filter.remove();
        element.style.backdropFilter = '';
      }
    };
  }

  liquidGlass.supported = supported;
  global.liquidGlass = liquidGlass;
})(window);
