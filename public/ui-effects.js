'use strict';

(function initializeMuseEffects(global) {
  const doc = global.document;
  const instances = new Set();
  const popoverAnimations = new WeakMap();
  const menuAnimations = new WeakMap();
  const menuOrigins = new WeakMap();
  const overflowHintedMenus = new Set();
  const panelOverflowStates = new WeakMap();
  const pendingOverflowMenus = new Set();
  const OVERFLOW_MENU_SELECTOR = [
    '.context-panel',
    '[role="menu"]',
    '.tool-popover',
    '.brush-preset-menu',
    '.profile-card',
    '.sheet-formula-suggestions',
    '.sheet-cell-formula-assist',
    '.amap-route-suggestions'
  ].join(',');
  let overflowHint = null;
  let overflowHintTimer = null;
  let overflowHintFrame = null;
  let overflowHintMenu = null;
  let overflowHintSurface = null;
  let animationFrame = null;
  let lastPaintAt = 0;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function point(x, y, alpha = 1, radius = 1) {
    return { x, y, alpha: clamp(alpha, 0, 1), radius: Math.max(0.2, radius) };
  }

  function orbitPoint(angle, radiusX, radiusY, rotation = 0) {
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
  }

  function polygonRadius(angle, sides) {
    const sector = (Math.PI * 2) / sides;
    return Math.min(1.38, Math.cos(Math.PI / sides) / Math.cos(((angle + Math.PI / sides) % sector) - Math.PI / sides));
  }

  function computeOrbPoints(state, size = 20, time = 0) {
    const normalizedState = ORB_STATES.includes(state) ? state : 'working';
    const large = Number(size) >= 40;
    const count = large ? 24 : 12;
    const extent = Number(size) * 0.34;
    const phase = Number(time) * 0.001;
    const dots = [];

    if (normalizedState === 'working') {
      for (let index = 0; index < count; index += 1) {
        const band = index % 3;
        const angle = (index / count) * Math.PI * 6 + phase * (1.25 + band * 0.12);
        const value = orbitPoint(angle, extent * (0.7 + band * 0.12), extent * 0.28, -0.55 + band * 0.52);
        dots.push(point(value.x, value.y, 0.42 + 0.58 * ((Math.sin(angle) + 1) / 2), large ? 1.15 : 0.78));
      }
    } else if (normalizedState === 'searching') {
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        const sweep = Math.cos(angle - phase * 1.8);
        dots.push(point(Math.cos(angle) * extent, Math.sin(angle) * extent, 0.32 + 0.68 * Math.max(0, sweep), large ? 1.15 : 0.76));
      }
      const meridianCount = large ? 12 : 6;
      for (let index = 0; index < meridianCount; index += 1) {
        const angle = (index / meridianCount) * Math.PI * 2;
        dots.push(point(Math.cos(angle) * extent * 0.38, Math.sin(angle) * extent, 0.45 + 0.45 * Math.sin(phase + angle) ** 2, large ? 0.9 : 0.62));
      }
    } else if (normalizedState === 'solving') {
      for (let index = 0; index < count; index += 1) {
        const row = index % (large ? 4 : 3);
        const column = Math.floor(index / (large ? 4 : 3));
        const columns = Math.ceil(count / (large ? 4 : 3));
        const settle = (Math.sin(phase * 2.4 + row * 1.7) + 1) * 0.5;
        const x = ((column / Math.max(1, columns - 1)) * 2 - 1) * extent;
        const y = ((row / (large ? 3 : 2)) * 2 - 1) * extent * 0.72 + Math.sin(phase * 3 + index) * extent * 0.18 * settle;
        dots.push(point(x, y, 0.45 + 0.5 * (1 - settle), large ? 1.05 : 0.7));
      }
    } else if (normalizedState === 'listening') {
      for (let index = 0; index < count; index += 1) {
        const x = ((index / Math.max(1, count - 1)) * 2 - 1) * extent;
        const envelope = 1 - Math.abs(x / extent) * 0.55;
        const y = Math.sin(index * 1.1 - phase * 4) * extent * 0.54 * envelope;
        dots.push(point(x, y, 0.45 + envelope * 0.5, large ? 1.1 : 0.72));
      }
    } else if (normalizedState === 'connecting') {
      const nodes = large ? 10 : 7;
      for (let index = 0; index < nodes; index += 1) {
        const angle = (index / nodes) * Math.PI * 2 + Math.sin(phase * 0.7 + index) * 0.16;
        const radius = extent * (0.58 + 0.32 * Math.sin(index * 2.2 + phase) ** 2);
        dots.push(point(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.45 + 0.55 * Math.sin(phase * 2 + index) ** 2, large ? 1.35 : 0.86));
      }
    } else if (normalizedState === 'weaving') {
      for (let index = 0; index < count; index += 1) {
        const strand = index % 3;
        const progress = Math.floor(index / 3) / Math.max(1, Math.ceil(count / 3) - 1);
        const x = (progress * 2 - 1) * extent;
        const y = Math.sin(progress * Math.PI * 3 + phase * 2 + strand * Math.PI * 2 / 3) * extent * 0.48;
        dots.push(point(x, y, 0.4 + 0.2 * strand + 0.3 * Math.sin(phase + index) ** 2, large ? 1 : 0.68));
      }
    } else if (normalizedState === 'composing') {
      for (let index = 0; index < count; index += 1) {
        const progress = index / Math.max(1, count - 1);
        const x = (progress * 2 - 1) * extent;
        const y = Math.sin(progress * Math.PI * 2.5 - phase * 2.2) * extent * 0.38 + Math.sin(progress * 8 + phase) * extent * 0.1;
        dots.push(point(x, y, 0.38 + 0.6 * progress, large ? 1.12 : 0.74));
      }
    } else if (normalizedState === 'breathing') {
      const radius = extent * (0.84 + Math.sin(phase * 1.6) * 0.12);
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        dots.push(point(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.42 + 0.5 * Math.sin(phase * 1.6 + angle) ** 2, large ? 1.12 : 0.76));
      }
    } else {
      const shapePhase = (phase * 0.42) % 3;
      const fromSides = [32, 3, 4][Math.floor(shapePhase)];
      const toSides = [3, 4, 32][Math.floor(shapePhase)];
      const mix = shapePhase - Math.floor(shapePhase);
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const fromRadius = fromSides > 8 ? 1 : polygonRadius(angle, fromSides);
        const toRadius = toSides > 8 ? 1 : polygonRadius(angle, toSides);
        const radius = extent * (fromRadius + (toRadius - fromRadius) * mix);
        dots.push(point(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.82, large ? 1.12 : 0.75));
      }
    }
    return dots;
  }

  function paintOrb(instance, now) {
    const canvas = instance.canvas;
    if (!canvas?.isConnected || !instance.active || !instance.visible) return;
    const size = instance.size;
    const ratio = Math.min(2, global.devicePixelRatio || 1);
    const pixels = Math.max(1, Math.round(size * ratio));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    const points = computeOrbPoints(instance.state, size, now * instance.speed);
    const color = instance.color || global.getComputedStyle?.(canvas)?.color || '#6957f5';
    context.fillStyle = color;
    const center = size / 2;

    if (instance.state === 'connecting' && points.length > 1 && size >= 40) {
      context.save();
      context.strokeStyle = color;
      context.globalAlpha = 0.16;
      context.lineWidth = 0.8;
      context.beginPath();
      points.forEach((value, index) => {
        const next = points[(index + 1) % points.length];
        context.moveTo(center + value.x, center + value.y);
        context.lineTo(center + next.x, center + next.y);
      });
      context.stroke();
      context.restore();
    }

    for (const value of points) {
      context.globalAlpha = value.alpha;
      context.beginPath();
      context.arc(center + value.x, center + value.y, value.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function shouldAnimate() {
    if (doc?.hidden) return false;
    return Array.from(instances).some((instance) => instance.active && instance.visible && instance.canvas?.isConnected);
  }

  function tick(now) {
    animationFrame = null;
    if (now - lastPaintAt >= 30) {
      lastPaintAt = now;
      for (const instance of instances) paintOrb(instance, now);
    }
    if (shouldAnimate()) animationFrame = global.requestAnimationFrame(tick);
  }

  function requestTick() {
    if (animationFrame === null && shouldAnimate()) animationFrame = global.requestAnimationFrame(tick);
  }

  function syncAnimationLoop() {
    if (!shouldAnimate() && animationFrame !== null) {
      global.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      return;
    }
    requestTick();
  }

  function mountOrb(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const instance = {
      canvas,
      state: ORB_STATES.includes(options.state) ? options.state : 'working',
      size: Number(options.size) >= 40 ? 64 : 20,
      speed: clamp(options.speed || 1, 0.2, 3),
      active: options.active !== false,
      visible: true,
      color: options.color || ''
    };
    canvas.classList?.add('thinking-orb');
    canvas.setAttribute?.('aria-hidden', 'true');
    let observer = null;
    if (typeof global.IntersectionObserver === 'function') {
      observer = new global.IntersectionObserver((entries) => {
        instance.visible = entries[0]?.isIntersecting !== false;
        paintOrb(instance, performance.now());
        requestTick();
      });
      observer.observe(canvas);
    }
    instances.add(instance);
    paintOrb(instance, performance.now());
    requestTick();
    let destroyed = false;
    return {
      setState(nextState) {
        if (destroyed || !ORB_STATES.includes(nextState) || instance.state === nextState) return;
        instance.state = nextState;
        paintOrb(instance, performance.now());
        requestTick();
      },
      setActive(active) {
        if (destroyed) return;
        const nextActive = Boolean(active);
        canvas.hidden = !nextActive;
        if (instance.active === nextActive) return;
        instance.active = nextActive;
        if (instance.active) paintOrb(instance, performance.now());
        syncAnimationLoop();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        observer?.disconnect();
        instances.delete(instance);
        syncAnimationLoop();
      }
    };
  }

  function createLiquidMove(dock, options = {}) {
    if (!dock) return null;
    const indicator = doc.createElement('span');
    indicator.className = options.className || 'liquid-tool-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    dock.prepend(indicator);
    let previous = null;
    let scheduled = null;
    let immediateCleanup = null;
    let activeButton = null;
    let destroyed = false;

    const isDockUnavailable = () => (
      dock.hidden ||
      dock.isConnected === false ||
      (typeof dock.getClientRects === 'function' && dock.getClientRects().length === 0)
    );

    const cancelFrames = () => {
      if (scheduled !== null) global.cancelAnimationFrame(scheduled);
      if (immediateCleanup !== null) global.cancelAnimationFrame(immediateCleanup);
      scheduled = null;
      immediateCleanup = null;
    };

    const hide = () => {
      if (destroyed) return;
      cancelFrames();
      previous = null;
      indicator.classList.remove('is-visible', 'is-immediate');
    };

    const update = (button, immediate = false) => {
      if (destroyed) return;
      activeButton = button || null;
      if (!button?.isConnected || isDockUnavailable()) {
        hide();
        return;
      }
      if (scheduled !== null) global.cancelAnimationFrame(scheduled);
      scheduled = global.requestAnimationFrame(() => {
        scheduled = null;
        if (!indicator.isConnected && dock.isConnected) dock.prepend(indicator);
        if (destroyed || !activeButton?.isConnected || isDockUnavailable()) {
          hide();
          return;
        }
        const dockRect = dock.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();
        const scaleX = dock.offsetWidth && dockRect.width ? dockRect.width / dock.offsetWidth : 1;
        const scaleY = dock.offsetHeight && dockRect.height ? dockRect.height / dock.offsetHeight : 1;
        const x = (buttonRect.left - dockRect.left) / scaleX + dock.scrollLeft;
        const y = (buttonRect.top - dockRect.top) / scaleY + dock.scrollTop;
        const width = activeButton.offsetWidth || buttonRect.width / scaleX;
        const height = activeButton.offsetHeight || buttonRect.height / scaleY;
        const dx = previous ? x - previous.x : 0;
        const dy = previous ? y - previous.y : 0;
        indicator.style.setProperty('--liquid-x', `${x}px`);
        indicator.style.setProperty('--liquid-y', `${y}px`);
        indicator.style.setProperty('--liquid-w', `${width}px`);
        indicator.style.setProperty('--liquid-h', `${height}px`);
        indicator.style.setProperty('--liquid-trail-x', `${clamp(-dx * 0.22, -16, 16)}px`);
        indicator.style.setProperty('--liquid-trail-y', `${clamp(-dy * 0.22, -16, 16)}px`);
        indicator.classList.toggle('is-immediate', immediate);
        indicator.classList.add('is-visible');
        if (immediate) {
          if (immediateCleanup !== null) global.cancelAnimationFrame(immediateCleanup);
          immediateCleanup = global.requestAnimationFrame(() => {
            immediateCleanup = null;
            if (!destroyed) indicator.classList.remove('is-immediate');
          });
        }
        previous = { x, y };
      });
    };

    const refresh = () => update(dock.querySelector(options.activeSelector || '[data-tool].active') || activeButton, true);
    dock.addEventListener('scroll', refresh, { passive: true });
    global.addEventListener('resize', refresh, { passive: true });
    global.addEventListener('orientationchange', refresh, { passive: true });
    return {
      update,
      refresh,
      hide,
      destroy() {
        if (destroyed) return;
        cancelFrames();
        destroyed = true;
        dock.removeEventListener('scroll', refresh);
        global.removeEventListener('resize', refresh);
        global.removeEventListener('orientationchange', refresh);
        indicator.remove();
      }
    };
  }

  function createToolLiquid(dock) {
    return createLiquidMove(dock, {
      activeSelector: '[data-tool].active',
      className: 'liquid-tool-indicator'
    });
  }

  function cancelPopoverMorph(popover) {
    if (!popover) return;
    const animation = popoverAnimations.get(popover);
    if (!animation) return;
    popoverAnimations.delete(popover);
    try {
      animation.cancel();
    } catch {}
  }

  function cancelMenuMotion(menu) {
    if (!menu) return;
    const animation = menuAnimations.get(menu);
    menuAnimations.delete(menu);
    delete menu.dataset?.menuClosing;
    if (!animation) return;
    try {
      animation.cancel();
    } catch {}
  }

  function menuMotionOrigin(menu, anchor) {
    const menuRect = menu.getBoundingClientRect();
    const anchorRect = typeof anchor?.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
    if (!menuRect.width || !menuRect.height || ![anchorRect?.left, anchorRect?.top].every(Number.isFinite)) return null;
    const anchorX = anchorRect.left + Math.max(1, Number(anchorRect.width) || 1) / 2;
    const anchorY = anchorRect.top + Math.max(1, Number(anchorRect.height) || 1) / 2;
    const x = clamp(((anchorX - menuRect.left) / menuRect.width) * 100, 0, 100);
    const y = clamp(((anchorY - menuRect.top) / menuRect.height) * 100, 0, 100);
    return {
      css: `${x.toFixed(2)}% ${y.toFixed(2)}%`,
      offsetX: clamp(anchorX - (menuRect.left + menuRect.width / 2), -8, 8),
      offsetY: clamp(anchorY - (menuRect.top + menuRect.height / 2), -8, 8)
    };
  }

  function menuOverflowHintKey(menu) {
    if (menu.id) return `id:${menu.id}`;
    const label = menu.getAttribute?.('aria-label') || '';
    const classes = Array.from(menu.classList || [])
      .filter((name) => !['menu-viewport-overflow', 'is-visible'].includes(name))
      .sort()
      .join('.');
    return `menu:${classes}:${label}`;
  }

  function removeMenuOverflowHint() {
    if (overflowHintTimer !== null) {
      global.clearTimeout?.(overflowHintTimer);
      overflowHintTimer = null;
    }
    overflowHint?.remove?.();
    overflowHint = null;
    overflowHintMenu = null;
    overflowHintSurface = null;
  }

  function fitMenuToVisualViewport(menu) {
    const viewport = global.visualViewport;
    const viewportTop = Number(viewport?.offsetTop) || 0;
    const viewportHeight = Number(viewport?.height) || Number(global.innerHeight) || 0;
    const viewportBottom = viewportTop + viewportHeight;
    const rect = menu.getBoundingClientRect?.();
    if (!rect?.height || !viewportHeight) return false;
    const availableHeight = Math.max(80, viewportBottom - Math.max(rect.top, viewportTop + 8) - 8);
    if (menu.classList?.contains?.('menu-viewport-overflow')) {
      if (Number(menu.scrollHeight) <= availableHeight + 2) {
        menu.classList.remove('menu-viewport-overflow');
        menu.style?.removeProperty?.('--menu-viewport-max-height');
        return false;
      }
      menu.style?.setProperty?.('--menu-viewport-max-height', `${Math.floor(availableHeight)}px`);
      return true;
    }
    if (rect.bottom <= viewportBottom - 8) return false;
    menu.style?.setProperty?.('--menu-viewport-max-height', `${Math.floor(availableHeight)}px`);
    menu.classList?.add?.('menu-viewport-overflow');
    return true;
  }

  function menuScrollSurface(menu) {
    const candidates = [menu, ...(menu.querySelectorAll?.('*') || [])];
    return candidates.find((candidate) => {
      if (!(Number(candidate.scrollHeight) - Number(candidate.clientHeight) > 2)) return false;
      const overflowY = global.getComputedStyle?.(candidate)?.overflowY || '';
      return candidate === menu || overflowY === 'auto' || overflowY === 'scroll';
    }) || menu;
  }

  function positionMenuOverflowHint(hint, rect, direction) {
    const left = `${clamp(rect.left + rect.width / 2, 24, Math.max(24, (global.innerWidth || rect.right) - 24))}px`;
    const visualBottom = (Number(global.visualViewport?.offsetTop) || 0) + (Number(global.visualViewport?.height) || Number(global.innerHeight) || rect.bottom);
    const top = direction === 'up'
      ? `${Math.max(rect.top, Number(global.visualViewport?.offsetTop) || 0) + 4}px`
      : `${Math.min(rect.bottom, visualBottom - 8) - 30}px`;
    if (hint.style.left !== left) hint.style.left = left;
    if (hint.style.top !== top) hint.style.top = top;
  }

  function showMenuOverflowHint(menu) {
    if (!menu?.isConnected || menu.hidden || menu.dataset?.menuClosing === 'true') {
      if (menu) panelOverflowStates.delete(menu);
      if (overflowHintMenu === menu) removeMenuOverflowHint();
      return false;
    }
    const rect = menu.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) {
      panelOverflowStates.delete(menu);
      if (overflowHintMenu === menu) removeMenuOverflowHint();
      return false;
    }
    fitMenuToVisualViewport(menu);
    // fitMenuToVisualViewport may have just introduced scrolling. Read layout
    // again before deciding whether any content is actually hidden.
    const fittedRect = menu.getBoundingClientRect();
    const scrollSurface = menuScrollSurface(menu);
    const canScrollUp = Number(scrollSurface.scrollTop || 0) > 2;
    const canScrollDown = Number(scrollSurface.scrollHeight) - Number(scrollSurface.scrollTop || 0) - Number(scrollSurface.clientHeight) > 2;
    if (!canScrollUp && !canScrollDown) {
      panelOverflowStates.delete(menu);
      if (overflowHintMenu === menu) removeMenuOverflowHint();
      return false;
    }
    const menuKey = menuOverflowHintKey(menu);
    const direction = canScrollDown ? 'down' : 'up';
    if (menu.classList.contains('context-panel')) {
      // The same panel hosts notes and text. Each opening/type gets both scroll directions.
      const kind = menu.querySelector('.context-title-text')?.textContent || '';
      let panelState = panelOverflowStates.get(menu);
      if (!panelState || panelState.kind !== kind) {
        panelState = { kind, directions: new Set() };
        panelOverflowStates.set(menu, panelState);
        if (overflowHintMenu === menu) removeMenuOverflowHint();
      }
      if (overflowHintMenu === menu) {
        if (overflowHint.classList.contains(`is-${direction}`)) {
          positionMenuOverflowHint(overflowHint, fittedRect, direction);
          return false;
        }
        removeMenuOverflowHint();
      }
      if (panelState.directions.has(direction)) return false;
      panelState.directions.add(direction);
    } else {
      if (overflowHintedMenus.has(menuKey)) return false;
      overflowHintedMenus.add(menuKey);
    }

    removeMenuOverflowHint();
    const hint = doc.createElement('span');
    hint.className = `menu-overflow-swipe-hint is-${direction}`;
    hint.setAttribute('aria-hidden', 'true');
    positionMenuOverflowHint(hint, fittedRect, direction);
    (doc.body || doc.documentElement)?.appendChild?.(hint);
    overflowHint = hint;
    overflowHintMenu = menu;
    overflowHintSurface = scrollSurface;
    overflowHintTimer = global.setTimeout?.(removeMenuOverflowHint, 5500) ?? null;
    return true;
  }

  function dismissMenuOverflowHintAtBoundary(menu, scrollSurface) {
    if (!overflowHint || overflowHintMenu !== menu || overflowHintSurface !== scrollSurface) return;
    const scrollTop = Number(scrollSurface.scrollTop || 0);
    const canScrollUp = scrollTop > 2;
    const canScrollDown = Number(scrollSurface.scrollHeight) - scrollTop - Number(scrollSurface.clientHeight) > 2;
    if ((overflowHint.classList?.contains?.('is-up') && !canScrollUp)
      || (overflowHint.classList?.contains?.('is-down') && !canScrollDown)) {
      removeMenuOverflowHint();
    }
  }

  function flushMenuOverflowHints() {
    overflowHintFrame = null;
    const menus = Array.from(pendingOverflowMenus);
    pendingOverflowMenus.clear();
    for (const menu of menus) {
      if (showMenuOverflowHint(menu)) break;
    }
  }

  function scheduleMenuOverflowHint(menu) {
    if (!menu) return;
    pendingOverflowMenus.add(menu);
    if (overflowHintFrame !== null) return;
    // Two paints let hidden menus finish their opening layout and async menu
    // builders append their rows without forcing synchronous layout here.
    overflowHintFrame = global.requestAnimationFrame?.(() => {
      overflowHintFrame = global.requestAnimationFrame?.(flushMenuOverflowHints) ?? null;
    }) ?? null;
  }

  function scanVisibleMenus() {
    for (const menu of doc.querySelectorAll?.(OVERFLOW_MENU_SELECTOR) || []) {
      scheduleMenuOverflowHint(menu);
    }
  }

  function installMenuOverflowHints() {
    if (!doc?.documentElement || typeof global.MutationObserver !== 'function') return;
    const observer = new global.MutationObserver(scanVisibleMenus);
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
      childList: true,
      subtree: true
    });
    doc.addEventListener?.('scroll', (event) => {
      const menu = event.target?.closest?.(OVERFLOW_MENU_SELECTOR);
      if (!menu) return;
      const scrollSurface = menuScrollSurface(menu);
      if (event.target === scrollSurface) dismissMenuOverflowHintAtBoundary(menu, scrollSurface);
      scheduleMenuOverflowHint(menu);
    }, true);
    global.addEventListener?.('resize', scanVisibleMenus, { passive: true });
    global.visualViewport?.addEventListener?.('resize', scanVisibleMenus, { passive: true });
    scanVisibleMenus();
  }

  function openMenu(menu, anchor) {
    if (!menu || !anchor) return null;
    cancelMenuMotion(menu);
    scheduleMenuOverflowHint(menu);
    const origin = menuMotionOrigin(menu, anchor);
    if (!origin) return null;
    menuOrigins.set(menu, origin);
    menu.style.transformOrigin = origin.css;
    if (typeof menu.animate !== 'function') return null;
    let animation;
    try {
      animation = menu.animate([
        { opacity: 0, transform: `translate3d(${origin.offsetX}px, ${origin.offsetY}px, 0) scale(.985)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
      ], {
        duration: 350,
        easing: 'cubic-bezier(.22,1,.36,1)'
      });
    } catch {
      return null;
    }
    menuAnimations.set(menu, animation);
    const cleanup = () => {
      if (menuAnimations.get(menu) === animation) menuAnimations.delete(menu);
    };
    animation.addEventListener?.('finish', cleanup, { once: true });
    animation.addEventListener?.('cancel', cleanup, { once: true });
    return animation;
  }

  function closeMenu(menu, onFinish) {
    if (!menu) return null;
    const computed = global.getComputedStyle?.(menu);
    const startOpacity = computed?.opacity || '1';
    const startTransform = computed?.transform && computed.transform !== 'none' ? computed.transform : 'none';
    cancelMenuMotion(menu);
    menu.dataset.menuClosing = 'true';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      delete menu.dataset.menuClosing;
      onFinish?.();
    };
    if (typeof menu.animate !== 'function') {
      finish();
      return null;
    }
    const origin = menuOrigins.get(menu) || { css: '50% 0%', offsetX: 0, offsetY: -4 };
    menu.style.transformOrigin = origin.css;
    let animation;
    try {
      animation = menu.animate([
        { opacity: startOpacity, transform: startTransform },
        { opacity: 0, transform: `translate3d(${origin.offsetX * .45}px, ${origin.offsetY * .45}px, 0) scale(.992)` }
      ], {
        duration: 220,
        easing: 'cubic-bezier(.4,0,.2,1)'
      });
    } catch {
      finish();
      return null;
    }
    menuAnimations.set(menu, animation);
    animation.addEventListener?.('finish', () => {
      if (menuAnimations.get(menu) !== animation) return;
      menuAnimations.delete(menu);
      finish();
    }, { once: true });
    animation.addEventListener?.('cancel', () => {
      if (menuAnimations.get(menu) === animation) menuAnimations.delete(menu);
    }, { once: true });
    return animation;
  }

  function morphPopover(popover, anchor) {
    if (!popover || !anchor) return null;
    cancelPopoverMorph(popover);
    if (typeof popover.animate !== 'function') return null;
    const anchorRect = typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
    if (![anchorRect?.left, anchorRect?.top].every(Number.isFinite)) return null;
    const popoverRect = popover.getBoundingClientRect();
    if (!popoverRect.width || !popoverRect.height) return null;
    const anchorWidth = Math.max(1, Number(anchorRect.width) || 1);
    const anchorHeight = Math.max(1, Number(anchorRect.height) || 1);
    const deltaX = anchorRect.left + anchorWidth / 2 - (popoverRect.left + popoverRect.width / 2);
    const deltaY = anchorRect.top + anchorHeight / 2 - (popoverRect.top + popoverRect.height / 2);
    const scaleX = clamp(anchorWidth / popoverRect.width, .2, .88);
    const scaleY = clamp(anchorHeight / popoverRect.height, .2, .88);
    const distance = Math.hypot(deltaX, deltaY);
    const duration = clamp(340 + distance * .06, 360, 440);
    const endRadius = global.getComputedStyle?.(popover)?.borderRadius || 'var(--radius-lg)';
    let animation;
    try {
      animation = popover.animate([
        { opacity: .14, borderRadius: '999px', transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`, filter: 'blur(1.2px)', transformOrigin: 'center' },
        { opacity: .88, borderRadius: '34px', transform: `translate3d(${deltaX * .14}px, ${deltaY * .14}px, 0) scale(1.012, .982)`, filter: 'blur(.18px)', transformOrigin: 'center', offset: .56 },
        { opacity: 1, borderRadius: endRadius, transform: 'scale(.995, 1.006)', filter: 'none', transformOrigin: 'center', offset: .82 },
        { opacity: 1, borderRadius: endRadius, transform: 'none', filter: 'none', transformOrigin: 'center' }
      ], {
        duration,
        easing: 'cubic-bezier(.2,.72,.24,1)'
      });
    } catch {
      return null;
    }
    popoverAnimations.set(popover, animation);
    const cleanup = () => {
      if (popoverAnimations.get(popover) === animation) popoverAnimations.delete(popover);
    };
    animation.addEventListener?.('finish', cleanup, { once: true });
    animation.addEventListener?.('cancel', cleanup, { once: true });
    return animation;
  }

  function revealPreview(surface) {
    if (!surface) return null;
    cancelPopoverMorph(surface);
    if (!surface.animate) return null;
    const animation = surface.animate([
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 200, easing: 'cubic-bezier(.22,.61,.36,1)' });
    popoverAnimations.set(surface, animation);
    const cleanup = () => {
      if (popoverAnimations.get(surface) === animation) popoverAnimations.delete(surface);
    };
    animation.addEventListener('finish', cleanup, { once: true });
    animation.addEventListener('cancel', cleanup, { once: true });
    return animation;
  }

  function handleVisibilityChange() {
    doc?.documentElement?.classList.toggle('effects-page-hidden', Boolean(doc.hidden));
    syncAnimationLoop();
  }

  const ORB_STATES = ['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'];
  doc?.addEventListener('visibilitychange', handleVisibilityChange);
  installMenuOverflowHints();
  global.MuseEffects = Object.freeze({
    ORB_STATES,
    cancelMenuMotion,
    computeOrbPoints,
    cancelPopoverMorph,
    closeMenu,
    createLiquidMove,
    createToolLiquid,
    mountOrb,
    morphPopover,
    revealPreview,
    openMenu,
    showMenuOverflowHint
  });
})(window);
