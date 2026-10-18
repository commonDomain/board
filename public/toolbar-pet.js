(function (global) {
  'use strict';

  const SIDE = 418;
  const SIZE = 92;
  const HIDDEN_KEY = 'wb:toolbarPetHidden';
  const FEEDBACK_KEY = 'wb:toolbarPetFeedback';

  function loadHiddenPreference() {
    try {
      return global.localStorage.getItem(HIDDEN_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveHiddenPreference(hidden) {
    try {
      global.localStorage.setItem(HIDDEN_KEY, String(hidden));
    } catch {
      // Visibility still changes for this session if storage is unavailable.
    }
  }
  const POSES = {
    'walk-right': [35, 58, 383, 343],
    'walk-right-alt': [27, 57, 389, 344],
    'walk-left': [41, 57, 389, 344],
    'walk-left-alt': [32, 57, 391, 344],
    'run-right': [25, 62, 390, 330],
    'run-right-alt': [25, 62, 390, 330],
    stand: [61, 27, 410, 400],
    'walk-front': [61, 27, 410, 400],
    'walk-front-alt': [61, 27, 410, 400],
    sit: [96, 28, 354, 397],
    'sit-splayed': [47, 33, 371, 393],
    lie: [48, 97, 353, 338],
    sploot: [23, 189, 395, 393],
    sleep: [10, 125, 417, 334],
    bark: [88, 20, 347, 372],
    peek: [68, 74, 340, 333],
    play: [31, 9, 374, 342],
    waddle: [57, 33, 361, 393],
    'waddle-alt': [57, 33, 361, 393],
    scratch: [34, 53, 384, 393],
    ledge: [49, 118, 369, 393],
    toy: [35, 33, 383, 393]
  };
  const ACTIONS = [
    { name: 'sit', pose: 'sit', anchor: 'icon', mode: 'front', weight: 3, dwell: [5000, 11000] },
    { name: 'rest', pose: 'lie', anchor: 'edge', mode: 'front', weight: 3, dwell: [6500, 13000] },
    { name: 'nap', pose: 'sleep', anchor: 'top', mode: 'front', weight: 2, dwell: [12000, 26000] },
    { name: 'peek', pose: 'peek', anchor: 'peek', mode: 'peek', weight: 1, dwell: [2500, 4500] },
    { name: 'behind', pose: 'stand', anchor: 'behind', mode: 'behind', weight: .5, dwell: [1500, 3000] },
    { name: 'play', pose: 'play', anchor: 'edge', mode: 'front', weight: 2, dwell: [3500, 8000] },
    { name: 'bark', pose: 'bark', anchor: 'icon', mode: 'front', weight: 1, dwell: [1800, 3200] },
    { name: 'top', pose: 'sit', anchor: 'top', mode: 'front', weight: 2, dwell: [5500, 12000] },
    { name: 'sploot', pose: 'sploot', anchor: 'edge', mode: 'front', weight: 2, dwell: [7500, 15000] },
    { name: 'splayed', pose: 'sit-splayed', anchor: 'icon', mode: 'front', weight: 2, dwell: [5500, 11000] },
    { name: 'ledge', pose: 'ledge', anchor: 'edge', mode: 'front', weight: 2, dwell: [4200, 9000] },
    { name: 'toy', pose: 'toy', anchor: 'edge', mode: 'front', weight: 2, dwell: [6000, 12000] },
    { name: 'scratch', pose: 'scratch', anchor: 'edge', mode: 'front', weight: 2, dwell: [4500, 9500] }
  ];

  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  const mixPoint = (from, to, t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  // Mouth coordinates belong to the artwork, before foot registration and gait transforms.
  const MOUTHS = {
    stand: [301, 213], sit: [230, 212], lie: [250, 305], play: [136, 253],
    'walk-right': [362, 184], 'walk-right-alt': [368, 184],
    'walk-left': [58, 184], 'walk-left-alt': [49, 184],
    'run-right': [374, 185], 'run-right-alt': [374, 185],
    'walk-front': [301, 213], 'walk-front-alt': [301, 213],
    waddle: [334, 205], 'waddle-alt': [334, 205]
  };
  const SPAWN_DELAY_MS = [0, 180000];
  // Distances are CSS pixels at the 92px sprite size. One stride contains
  // both alternating contact poses; cadence is derived from distance moved.
  const GAITS = {
    walk: { speed: 76, stride: 48, ramp: 22, lift: .7, pitch: .35 },
    carry: { speed: 88, stride: 56, ramp: 28, lift: .8, pitch: .4 },
    run: { speed: 116, stride: 64, ramp: 36, lift: 1, pitch: .55 },
    ascend: { speed: 66, stride: 36, ramp: 18, lift: .9, pitch: .5 },
    descend: { speed: 76, stride: 38, ramp: 20, lift: .8, pitch: .4 }
  };

  function motionProfile(distance, gait) {
    const rampDistance = Math.min(gait.ramp, distance / 2);
    const speedPerMs = gait.speed / 1000;
    const rampMs = 2 * rampDistance / speedPerMs;
    return { distance, rampDistance, rampMs, speedPerMs,
      duration: distance / speedPerMs + rampMs };
  }

  function profileDistance(profile, elapsed) {
    const time = clamp(elapsed, 0, profile.duration);
    if (time < profile.rampMs) {
      return profile.rampDistance * (time / profile.rampMs) ** 2;
    }
    if (time > profile.duration - profile.rampMs) {
      return profile.distance - profile.rampDistance *
        ((profile.duration - time) / profile.rampMs) ** 2;
    }
    return profile.rampDistance + profile.speedPerMs * (time - profile.rampMs);
  }

  // Inline values only: these reads do not measure layout. Avoid redundant DOM mutations.
  const styleValues = new WeakMap();
  function setStyle(element, name, value) {
    let values = styleValues.get(element);
    if (!values) { values = new Map(); styleValues.set(element, values); }
    const actual = element.style.getPropertyValue(name), previous = values.get(name);
    if (previous?.value === value && previous.actual === actual) return;
    if (actual !== value) element.style.setProperty(name, value);
    values.set(name, { value, actual: element.style.getPropertyValue(name) });
  }

  function toggleClass(element, name, enabled) {
    if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled);
  }

  function gaitTransform(movement, facing) {
    const gait = movement?.gait;
    const phase = movement?.gaitPhase || 0, effort = movement?.effort || 0;
    const flight = (1 - Math.cos(4 * Math.PI * phase)) / 2;
    return {
      lift: gait ? -gait.lift * flight * effort : 0,
      pitch: gait ? gait.pitch * Math.sin(2 * Math.PI * phase) * effort * facing : 0,
      scale: gait ? 1 + (.004 * flight - .007 * (1 - flight)) * effort : 1,
      shadow: gait ? 1 - .11 * flight * effort : 1
    };
  }

  function assetUrl(name) {
    const buildId = document.documentElement.dataset.staticBuild;
    const path = `pet/corgi-${name}.webp`;
    return buildId ? `static/${encodeURIComponent(buildId)}/${path}` : path;
  }

  function makeLayer(className, host) {
    const layer = document.createElement('div');
    layer.className = `toolbar-pet-layer ${className}`;
    layer.setAttribute('aria-hidden', 'true');
    const shadow = document.createElement('span');
    shadow.className = 'toolbar-pet-shadow';
    const groundLine = document.createElement('span');
    groundLine.className = 'toolbar-pet-ground-line';
    const body = document.createElement('div');
    body.className = 'toolbar-pet-body';
    layer.appendChild(body);
    // Keep decoded poses mounted. Reassigning src during a gait used to expose
    // an empty frame on slower devices even though the files were preloaded.
    const images = Object.fromEntries(Object.keys(POSES).map((pose) => {
      const img = document.createElement('img');
      img.className = 'toolbar-pet-image';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      const bounds = POSES[pose];
      img.style.left = `${SIZE / 2 - (bounds[0] + bounds[2]) / 2 / SIDE * SIZE}px`;
      img.style.top = `${SIZE - bounds[3] / SIDE * SIZE}px`;
      img.style.setProperty('--pet-foot-origin', `${(bounds[0] + bounds[2]) / 2 / SIDE * 100}% ${bounds[3] / SIDE * 100}%`);
      body.appendChild(img);
      return [pose, img];
    }));
    const eyelids = document.createElement('span');
    eyelids.className = 'toolbar-pet-eyelids';
    body.appendChild(eyelids);
    const motion = document.createElement('span');
    motion.className = 'toolbar-pet-motion';
    body.appendChild(motion);
    const affection = document.createElement('span');
    affection.className = 'toolbar-pet-affection';
    layer.appendChild(affection);
    layer.prepend(shadow);
    layer.appendChild(groundLine);
    // Share the dock's stacking context so the rear sprite can sit behind it.
    host.appendChild(layer);
    return { layer, body, images, motion };
  }

  class ToolbarPet {
    constructor(options) {
      this.dock = options.dock;
      this.showContextMenu = options.showContextMenu;
      this.onStateChange = options.onStateChange || (() => {});
      this.rear = makeLayer('toolbar-pet-rear', this.dock.parentElement);
      this.front = makeLayer('toolbar-pet-front', this.dock.parentElement);
      this.bubble = document.createElement('span');
      this.bubble.className = 'toolbar-pet-bubble';
      this.bubble.textContent = '汪!';
      this.bubble.setAttribute('aria-hidden', 'true');
      this.front.layer.appendChild(this.bubble);
      this.layers = [this.rear, this.front];
      this.prop = document.createElement('span');
      this.prop.className = 'toolbar-pet-prop';
      this.prop.setAttribute('aria-hidden', 'true');
      this.propArt = document.createElement('span');
      this.propArt.className = 'toolbar-pet-prop-art';
      this.prop.appendChild(this.propArt);
      this.propShadow = document.createElement('span');
      this.propShadow.className = 'toolbar-pet-prop-shadow';
      this.propShadow.setAttribute('aria-hidden', 'true');
      this.dock.parentElement.appendChild(this.propShadow);
      this.dock.parentElement.appendChild(this.prop);
      this.propPoint = null;
      this.propRotation = 0;
      this.bodyMotion = { x: 0, y: 0, angle: 0 };
      this.facing = 1;
      this.interactionStage = '';
      this.viewport = options.viewport || document.getElementById('viewport');
      this.getContext = options.getContext || (() => '');
      this.placementHint = document.createElement('span');
      this.placementHint.className = 'toolbar-pet-placement-hint';
      this.placementHint.setAttribute('role', 'status');
      this.placementHint.hidden = true;
      this.dock.parentElement.appendChild(this.placementHint);
      this.sequence = 0;
      this.waiters = new Map();
      this.busy = false;
      this.carried = false;
      this.assetsLoaded = false;
      this.buttonRects = new WeakMap();
      this.feedbackEnabled = true;
      try { this.feedbackEnabled = global.localStorage.getItem(FEEDBACK_KEY) !== 'false'; } catch {}
      this.lastFeedbackAt = -Infinity;
      this.feedbackIds = new Map();
      this.bubbleTimer = 0;
      this.blinkEndTimer = 0;
      this.ledge = document.createElement('span');
      this.ledge.className = 'toolbar-pet-ledge';
      this.ledge.setAttribute('aria-hidden', 'true');
      this.dock.parentElement.appendChild(this.ledge);
      this.pathTexture = document.createElement('span');
      this.pathTexture.className = 'toolbar-pet-path';
      this.pathTexture.setAttribute('aria-hidden', 'true');
      this.dock.parentElement.appendChild(this.pathTexture);
      this.pose = '';
      this.mode = 'behind';
      this.anchor = { kind: 'top' };
      this.point = null;
      this.movement = null;
      this.eligible = false;
      this.appeared = false;
      this.permanentlyHidden = loadHiddenPreference();
      this.dismissed = this.permanentlyHidden;
      this.resetOnResume = false;
      this.remainingSpawnMs = Math.floor(randomBetween(...SPAWN_DELAY_MS));
      this.spawnStartedAt = 0;
      this.spawnTimer = 0;
      this.actionTimer = 0;
      this.blinkTimer = 0;
      this.frame = 0;
      this.lastAction = '';
      this.currentAction = '';
      this.sceneAnchor = null;
      this.reducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
      this.motionReduced = this.reducedMotion.matches;
      this.mobile = global.matchMedia('(max-width: 1024px), (pointer: coarse)');
      this.setPose('peek');
      this.setMode('behind');
      this.onContextMenu = this.onContextMenu.bind(this);
      this.onEnvironmentChange = this.onEnvironmentChange.bind(this);
      this.onGeometryChange = this.onGeometryChange.bind(this);
      this.onPlacementPointerDown = this.onPlacementPointerDown.bind(this);
      this.onPlacementKeyDown = event => {
        if (this.placement && event.key === 'Escape' && !event.isComposing) {
          event.preventDefault(); event.stopImmediatePropagation(); this.cancelPlacement();
        }
      };
      this.onPlacementContextMenu = event => {
        if (this.placement && this.viewport?.contains(event.target)) {
          event.preventDefault(); event.stopImmediatePropagation(); this.cancelPlacement();
        }
      };
      this.onPlacementPointerEnd = event => {
        if (event.pointerId === this.placedPointerId) {
          event.preventDefault(); event.stopImmediatePropagation(); this.placedPointerId = null;
        }
      };
      this.onPlacementClick = event => {
        if (this.placedClick && performance.now() < this.placedClick.until && event.pointerId === this.placedClick.id) {
          event.preventDefault(); event.stopImmediatePropagation(); this.placedClick = null;
        }
      };
      this.onPlacementDoubleClick = event => {
        const last = this.lastPlacement;
        if (last && performance.now() - last.at < 700 && this.viewport?.contains(event.target) &&
          Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      };
      this.onPlacementPointerMove = () => {
        if (this.placement && this.placement.context !== this.getContext()) this.cancelPlacement();
      };
      document.addEventListener('pointerdown', this.onPlacementPointerDown, true);
      document.addEventListener('pointerup', this.onPlacementPointerEnd, true);
      document.addEventListener('pointercancel', this.onPlacementPointerEnd, true);
      document.addEventListener('click', this.onPlacementClick, true);
      document.addEventListener('dblclick', this.onPlacementDoubleClick, true);
      document.addEventListener('keydown', this.onPlacementKeyDown, true);
      document.addEventListener('contextmenu', this.onPlacementContextMenu, true);
      document.addEventListener('pointermove', this.onPlacementPointerMove, { passive: true });
      this.onFeedback = event => this.feedback(event.detail?.type, event.detail?.id);
      global.addEventListener('muse:pet-feedback', this.onFeedback);
      this.onPageHide = () => { this.pageSuspended = true; this.onEnvironmentChange(); };
      this.onPageShow = () => { this.pageSuspended = false; this.onEnvironmentChange(); };
      global.addEventListener('pagehide', this.onPageHide);
      global.addEventListener('pageshow', this.onPageShow);
      document.addEventListener('contextmenu', this.onContextMenu, true);
      document.addEventListener('visibilitychange', this.onEnvironmentChange);
      global.addEventListener('resize', this.onEnvironmentChange, { passive: true });
      global.visualViewport?.addEventListener('resize', this.onGeometryChange, { passive: true });
      global.visualViewport?.addEventListener('scroll', this.onGeometryChange, { passive: true });
      this.dock.addEventListener('scroll', this.onGeometryChange, { passive: true });
      this.mobile.addEventListener('change', this.onEnvironmentChange);
      this.reducedMotion.addEventListener('change', this.onEnvironmentChange);
      this.observer = new MutationObserver(this.onEnvironmentChange);
      this.observer.observe(this.dock, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden'] });
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      // A dock that starts at zero size must be rechecked when layout settles.
      this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this.onEnvironmentChange) : null;
      this.resizeObserver?.observe(this.dock);
      this.onEnvironmentChange();
    }

    isEligible() {
      const rect = this.dock.getBoundingClientRect();
      return !this.pageSuspended && !this.dismissed && !this.mobile.matches && document.visibilityState === 'visible' &&
        !document.documentElement.classList.contains('independent-notes-open') && !this.dock.hidden &&
        rect.width > 0 && rect.height > rect.width * 2;
    }

    onEnvironmentChange() {
      const eligible = this.isEligible();
      if (eligible === this.eligible) {
        if (eligible && !this.appeared) this.scheduleSpawn();
        if (eligible && this.appeared && this.motionReduced !== this.reducedMotion.matches) {
          this.motionReduced = this.reducedMotion.matches;
          if (this.motionReduced) {
            this.cancelSequence();
            clearTimeout(this.actionTimer);
            clearTimeout(this.blinkTimer);
            cancelAnimationFrame(this.frame);
            this.movement = null;
            this.ledge.classList.remove('is-visible');
            this.pathTexture.classList.remove('is-visible');
            this.currentAction = '';
            this.sceneAnchor = null;
            this.anchor = { kind: 'top' };
            this.point = this.resolveAnchor(this.anchor);
            this.setPose('sit');
            this.setMode('front');
            this.render();
          } else {
            this.scheduleAction(1200);
            this.scheduleBlink();
          }
        }
        if (eligible) this.onGeometryChange();
        return;
      }
      this.refreshGeometry();
      this.eligible = eligible;
      this.motionReduced = this.reducedMotion.matches;
      if (!eligible) {
        const interruptedMovement = Boolean(this.movement);
        const interruptedSequence = this.busy;
        this.cancelSequence();
        this.pendingFeedback = null;
        if (!this.appeared && this.spawnTimer) {
          this.remainingSpawnMs = Math.max(0, this.remainingSpawnMs - (Date.now() - this.spawnStartedAt));
        }
        clearTimeout(this.spawnTimer);
        clearTimeout(this.actionTimer);
        clearTimeout(this.blinkTimer);
        cancelAnimationFrame(this.frame);
        this.spawnTimer = 0;
        this.actionTimer = 0;
        this.blinkTimer = 0;
        this.frame = 0;
        this.movement = null;
        if (interruptedMovement || interruptedSequence) {
          this.currentAction = '';
          this.sceneAnchor = null;
          this.anchor = { kind: 'top' };
          this.resetOnResume = true;
        }
        this.ledge.classList.remove('is-visible');
        this.pathTexture.classList.remove('is-visible');
        this.setVisible(false);
        this.onStateChange();
        return;
      }
      if (!this.appeared) {
        this.scheduleSpawn();
      } else {
        if (!this.currentAnchorVisible()) this.anchor = { kind: 'top' };
        this.point = this.resolveAnchor(this.anchor);
        if (this.resetOnResume || this.reducedMotion.matches) {
          this.setPose('sit');
          this.setMode('front');
          this.resetOnResume = false;
        }
        this.setVisible(true);
        this.render();
        if (!this.reducedMotion.matches) this.scheduleAction(1200);
        if (!this.reducedMotion.matches) this.scheduleBlink();
      }
      this.onStateChange();
    }

    refreshGeometry() {
      this.dockRect = this.dock.getBoundingClientRect();
      this.buttonRects = new WeakMap();
      this.viewportWidth = global.innerWidth;
      this.viewportHeight = global.innerHeight;
      this.dockScroll = this.dock.scrollTop;
    }

    buttonRect(button) {
      if (!this.buttonRects.has(button)) this.buttonRects.set(button, button.getBoundingClientRect());
      return this.buttonRects.get(button);
    }

    scheduleSpawn() {
      if (!this.eligible || this.appeared || this.spawnTimer || this.loadingAssets || this.assetsFailed) return;
      this.spawnStartedAt = Date.now();
      this.spawnTimer = setTimeout(() => this.spawn(), this.remainingSpawnMs);
    }

    onGeometryChange() {
      const previous = this.dockRect;
      const width = this.viewportWidth, height = this.viewportHeight, scroll = this.dockScroll;
      this.refreshGeometry();
      if (!this.eligible || !this.appeared) return;
      if (previous.left === this.dockRect.left && previous.top === this.dockRect.top &&
        previous.width === this.dockRect.width && previous.height === this.dockRect.height &&
        width === this.viewportWidth && height === this.viewportHeight && scroll === this.dockScroll) return;
      if (this.busy) {
        // Cancel invalid props, then return continuously from the current position.
        this.cancelSequence();
        this.anchor = { kind: 'top' };
        this.setPose('stand');
        this.setMode('front');
      }
      if (this.movement) return;
      const nextAnchor = this.currentAnchorVisible() ? this.anchor : { kind: 'top' };
      const next = this.resolveAnchor(nextAnchor);
      if (Math.hypot(next.x - this.point.x, next.y - this.point.y) < 3 || this.motionReduced) {
        this.anchor = nextAnchor;
        this.point = next;
        this.render();
        return;
      }
      const restingPose = nextAnchor === this.anchor ? this.pose : 'sit';
      const restingMode = nextAnchor === this.anchor ? this.mode : 'front';
      clearTimeout(this.actionTimer);
      this.currentAction = '';
      this.sceneAnchor = null;
      this.setMode('front');
      this.travelTo(nextAnchor, () => {
        this.anchor = nextAnchor;
        this.setPose(restingPose);
        this.setMode(restingMode);
        this.render();
        this.scheduleAction(1800);
      });
    }

    currentAnchorVisible() {
      if (!this.anchor.button) return true;
      const button = this.buttonRect(this.anchor.button);
      const dock = this.dockRect;
      return button.bottom > dock.top + 10 && button.top < dock.bottom - 10;
    }

    visibleButtons() {
      const dock = this.dockRect;
      return Array.from(this.dock.querySelectorAll('.tool-button')).filter((button) => {
        const rect = this.buttonRect(button);
        return rect.width > 0 && rect.bottom > dock.top + 14 && rect.top < dock.bottom - 18;
      });
    }

    chooseAnchor(kind) {
      if (kind === 'top') return { kind };
      const buttons = this.visibleButtons();
      if (!buttons.length) return { kind: 'top' };
      return { kind, button: buttons[Math.floor(Math.random() * buttons.length)] };
    }

    resolveAnchor(anchor) {
      const dock = this.dockRect;
      if (anchor.kind === 'scene') return anchor.point;
      if (anchor.kind === 'point') return {
        x: clamp(anchor.point.x, SIZE / 2 + 8, Math.max(SIZE / 2 + 8, this.viewportWidth - SIZE / 2 - 8)),
        y: clamp(anchor.point.y, SIZE + 8, Math.max(SIZE + 8, this.viewportHeight - 20))
      };
      if (anchor.kind === 'top' || !anchor.button) {
        return { x: dock.left + dock.width / 2, y: dock.top + 16 };
      }
      const rect = this.buttonRect(anchor.button);
      const y = clamp(rect.top + 23, dock.top + 18, dock.bottom - 22);
      if (anchor.kind === 'icon') return { x: rect.left + rect.width / 2, y };
      if (anchor.kind === 'behind') return { x: dock.right - 10, y };
      if (anchor.kind === 'peek') return { x: dock.right + 26, y };
      return { x: dock.right + 18, y };
    }

    setPose(name) {
      this.clearMotionFrame();
      if (this.assetsLoaded && !this.availablePoses.has(name)) {
        name = this.availablePoses.has(this.pose) ? this.pose : this.availablePoses.values().next().value;
      }
      if (name === this.pose) return;
      const previous = this.pose;
      this.pose = name;
      for (const { layer, images } of this.layers) {
        layer.dataset.pose = name;
        if (previous) images[previous].classList.remove('is-active');
        images[name].classList.add('is-active');
      }
      // Every pose shares a foot anchor; render before a crossfade can begin.
      if (this.point && !this.movement) this.render();
    }

    clearMotionFrame() {
      if (!this.motionFrame) return;
      this.motionFrame = null;
      for (const { layer, images } of this.layers) {
        layer.classList.remove('has-motion-frame');
        images[this.pose]?.classList.add('is-active');
      }
    }

    setMotionFrame(action, frame) {
      if (!this.motionReady) return false;
      const index = clamp(Math.floor(frame), 0, 5);
      if (this.motionFrame?.action === action && this.motionFrame.index === index &&
          this.motionFrame.facing === this.facing) return true;
      const row = { run: 4, pickup: 1, eat: 2, roll: 3, walk: 4, turn: 5 }[action];
      if (!this.motionFrame) for (const { images } of this.layers) images[this.pose]?.classList.remove('is-active');
      this.motionFrame = { action, index, facing: this.facing };
      for (const { layer, motion } of this.layers) {
        layer.classList.add('has-motion-frame');
        layer.dataset.motion = action;
        motion.style.backgroundPosition = `${-index * SIZE}px ${-row * SIZE}px`;
        motion.style.transform = `translateY(var(--pet-gait-y, 0px)) rotate(var(--pet-gait-angle, 0deg)) scale(${this.facing}, var(--pet-gait-scale, 1))`;
      }
      return true;
    }

    setMode(mode) {
      this.mode = mode;
      this.rear.layer.classList.toggle('is-revealed', mode !== 'front');
      this.front.layer.classList.toggle('is-revealed', mode !== 'behind');
      this.front.layer.classList.toggle('is-peeking', mode === 'peek');
    }

    setVisible(visible) {
      for (const { layer } of this.layers) layer.classList.toggle('is-present', visible);
      if (!visible) {
        this.ledge.classList.remove('is-visible');
        this.pathTexture.classList.remove('is-visible');
      }
    }

    render() {
      if (!this.point || !this.pose) return;
      const bbox = POSES[this.pose];
      const left = this.point.x - SIZE / 2;
      const top = this.point.y - SIZE;
      const dock = this.dockRect;
      const shadowWidth = this.movement ? 38 : Math.max(30, (bbox[2] - bbox[0]) / SIDE * SIZE * .59);
      const { lift: bodyLift, pitch: bodyPitch, scale: bodyScale, shadow } = gaitTransform(this.movement, this.facing);
      for (const { layer } of this.layers) {
        setStyle(layer, 'transform', `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0px)`);
        setStyle(layer, '--pet-ground', `${SIZE - 3}px`);
        setStyle(layer, '--pet-shadow-width', `${shadowWidth}px`);
        setStyle(layer, '--pet-ground-width', Math.max(30, Math.min(52, shadowWidth * .9)) + 'px');
        toggleClass(layer, 'is-moving', Boolean(this.movement));
        toggleClass(layer, 'is-carrying', this.carried);
        setStyle(layer, '--pet-gait-y', `${bodyLift.toFixed(2)}px`);
        setStyle(layer, '--pet-gait-angle', `${bodyPitch.toFixed(2)}deg`);
        setStyle(layer, '--pet-gait-scale', bodyScale.toFixed(3));
        setStyle(layer, '--pet-shadow-scale', shadow.toFixed(3));
        setStyle(layer, '--pet-facing', String(this.facing));
      }
      setStyle(this.front.layer, '--pet-peek-cut', `${clamp(dock.right - left, 0, SIZE)}px`);
      this.renderLedge();
      this.renderPath();
      if (this.carried) {
        this.placeProp(this.mouthPoint(), { groundY: this.point.y - 1, scale: .82 });
      }
    }

    renderLedge() {
      const anchor = this.sceneAnchor;
      if (!this.eligible || this.motionReduced || this.currentAction !== 'ledge' || !anchor?.button) {
        toggleClass(this.ledge, 'is-visible', false);
        return;
      }
      const button = this.buttonRect(anchor.button);
      const dock = this.dockRect;
      if (button.bottom <= dock.top + 10 || button.top >= dock.bottom - 10) {
        toggleClass(this.ledge, 'is-visible', false);
        return;
      }
      const point = this.resolveAnchor(anchor);
      setStyle(this.ledge, 'left', `${point.x - 44}px`);
      setStyle(this.ledge, 'top', `${point.y - 1}px`);
      toggleClass(this.ledge, 'is-visible', true);
    }

    renderPath() {
      const movement = this.movement;
      if (!this.eligible || this.motionReduced || movement?.family !== 'rear' || !movement.gait) {
        toggleClass(this.pathTexture, 'is-visible', false);
        return;
      }
      setStyle(this.pathTexture, 'transform', `translate3d(${(this.point.x - 34).toFixed(2)}px, ${(this.point.y - 26).toFixed(2)}px, 0px) perspective(90px) rotateX(50deg)`);
      toggleClass(this.pathTexture, 'is-visible', true);
    }

    async spawn() {
      this.spawnTimer = 0;
      this.remainingSpawnMs = 0;
      if (!this.isEligible()) {
        this.onEnvironmentChange();
        return;
      }
      if (!this.assetsLoaded) {
        if (this.loadingAssets || this.destroyed || this.assetsFailed) return;
        this.loadingAssets = true;
        this.onStateChange();
        for (const { images } of this.layers) {
          for (const [pose, img] of Object.entries(images)) {
            img.src = assetUrl(pose) + (this.assetAttempt ? `?petRetry=${this.assetAttempt}` : '');
          }
        }
        const motionImage = new Image();
        this.motionImage = motionImage;
        motionImage.src = assetUrl('motion-atlas') + (this.assetAttempt ? `?petRetry=${this.assetAttempt}` : '');
        const motionDecoded = motionImage.decode().then(() => true, () => false);
        const decoded = await Promise.all(Object.keys(POSES).map(async pose => {
          try {
            await Promise.all(this.layers.map(({ images }) => images[pose].decode()));
            return pose;
          } catch { return null; }
        }));
        // One shared decoded atlas; no requests, canvas work or layout reads during playback.
        this.motionReady = await motionDecoded;
        if (this.motionReady) {
          for (const { motion } of this.layers) motion.style.backgroundImage = `url("${motionImage.src}")`;
        }
        this.loadingAssets = false;
        this.availablePoses = new Set(decoded.filter(Boolean));
        this.assetsLoaded = this.availablePoses.size > 0;
        this.assetsFailed = !this.assetsLoaded;
        this.onStateChange();
        if (this.destroyed || !this.isEligible() || this.assetsFailed) return;
      }
      this.appeared = true;
      this.anchor = { kind: 'top' };
      const top = this.resolveAnchor(this.anchor);
      this.point = { x: top.x, y: top.y + 64 };
      this.setPose('peek');
      this.setMode('behind');
      this.setVisible(true);
      this.render();
      if (this.reducedMotion.matches) {
        this.point = top;
        this.setPose('sit');
        this.setMode('front');
        this.render();
        this.onStateChange();
        return;
      }
      this.moveTo(this.anchor, 1050, () => {
        this.setPose('sit');
        this.setMode('front');
        this.scheduleAction(5000);
        this.scheduleBlink();
      }, { style: 'emerge' });
      this.onStateChange();
    }

    scheduleAction(delay) {
      clearTimeout(this.actionTimer);
      this.actionTimer = 0;
      if (!this.eligible || this.dismissed || this.reducedMotion.matches || this.busy) return;
      this.actionTimer = setTimeout(() => this.runAction(), delay);
    }

    scheduleBlink() {
      clearTimeout(this.blinkTimer);
      if (!this.eligible || this.dismissed || this.reducedMotion.matches) return;
      this.blinkTimer = setTimeout(() => {
        if (this.pose === 'sit' || this.pose === 'stand') {
          for (const { layer } of this.layers) layer.classList.add('is-blinking');
          this.blinkEndTimer = setTimeout(() => {
            for (const { layer } of this.layers) layer.classList.remove('is-blinking');
          }, 150);
        }
        this.scheduleBlink();
      }, randomBetween(3600, 8800));
    }

    pickAction() {
      const choices = ACTIONS.filter((action) => action.name !== this.lastAction);
      let roll = Math.random() * choices.reduce((sum, action) => sum + action.weight, 0);
      for (const action of choices) {
        roll -= action.weight;
        if (roll <= 0) return action;
      }
      return choices[choices.length - 1];
    }

    runAction() {
      this.actionTimer = 0;
      if (!this.eligible || this.busy) return;
      const action = this.pickAction();
      void this.performAction(action).catch(error => this.recoverSequence(error));
    }

    async performAction(action) {
      const token = this.beginSequence();
      this.lastAction = action.name;
      this.currentAction = action.name;
      const anchor = this.chooseAnchor(action.anchor);
      const destination = this.resolveAnchor(anchor);
      this.sceneAnchor = anchor;
      if (!await this.wake(token)) return;
      this.setMode('front');
      if (Math.hypot(destination.x - this.point.x, destination.y - this.point.y) >= 4) {
        if (!await this.travel(anchor, token)) return;
      }
      this.anchor = anchor;
      this.point = this.resolveAnchor(anchor);
      if (!await this.settlePose(action.pose, token)) return;
      this.setMode(action.mode);
      this.render();
      if (action.name === 'bark') this.bark();
      this.finishSequence(token, randomBetween(...action.dwell));
    }

    validSequence(token) {
      return token === this.sequence && this.eligible && !this.dismissed;
    }

    cancelSequence() {
      this.clearPlacement();
      this.sequence++;
      for (const [timer, resolve] of this.waiters) { clearTimeout(timer); resolve(false); }
      this.waiters.clear();
      this.pendingMove?.(false);
      this.pendingMove = null;
      clearTimeout(this.bubbleTimer);
      clearTimeout(this.blinkEndTimer);
      clearTimeout(this.actionTimer);
      this.actionTimer = 0;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.movement = null;
      this.busy = false;
      this.carried = false;
      this.clearMotionFrame();
      this.prop.className = 'toolbar-pet-prop';
      this.propShadow.classList.remove('is-visible');
      this.setStage('');
      this.setBodyMotion();
      this.bubble.classList.remove('is-barking');
      for (const { layer } of this.layers) {
        layer.classList.remove('is-moving', 'is-carrying', 'is-blinking', 'is-eating', 'is-celebrating', 'is-rolling');
        delete layer.dataset.reaction;
      }
      for (const { body } of this.layers) body.style.transformOrigin = '';
      this.onStateChange();
    }

    beginSequence(kind = 'ambient') {
      this.cancelSequence();
      this.busy = true;
      this.sequenceKind = kind;
      this.currentAction = '';
      this.sceneAnchor = null;
      this.render();
      this.onStateChange();
      return this.sequence;
    }

    finishSequence(token, delay = 5500) {
      if (!this.validSequence(token)) return;
      this.busy = false;
      this.carried = false;
      this.prop.className = 'toolbar-pet-prop';
      this.propShadow.classList.remove('is-visible');
      this.setStage('');
      this.setBodyMotion();
      for (const { layer } of this.layers) delete layer.dataset.reaction;
      for (const { layer } of this.layers) layer.classList.remove('is-eating', 'is-celebrating');
      this.render();
      this.scheduleAction(delay);
      if (this.pendingFeedback) {
        const pending = this.pendingFeedback;
        this.pendingFeedback = null;
        if (performance.now() - pending.at < 15000) this.feedback(pending.type, pending.id);
      }
      this.onStateChange();
    }

    wait(ms, token) {
      if (!this.validSequence(token)) return Promise.resolve(false);
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          this.waiters.delete(timer);
          resolve(this.validSequence(token));
        }, ms);
        this.waiters.set(timer, resolve);
      });
    }

    async poseStep(pose, ms, token) {
      if (!this.validSequence(token)) return false;
      this.setPose(pose);
      return this.wait(this.motionReduced ? 0 : ms, token);
    }

    async wake(token) {
      if (this.pose === 'sleep' && !await this.poseStep('lie', 650, token)) return false;
      if (['lie', 'sploot', 'sit-splayed'].includes(this.pose) && !await this.poseStep('sit', 480, token)) return false;
      if (this.pose !== 'stand' && !await this.poseStep('stand', 280, token)) return false;
      return this.validSequence(token);
    }

    async settlePose(pose, token) {
      if (['lie', 'sleep', 'sploot', 'sit-splayed'].includes(pose)) {
        if (!await this.poseStep('sit', 400, token)) return false;
        if (pose === 'sleep' && !await this.poseStep('lie', 750, token)) return false;
      }
      return this.poseStep(pose, 200, token);
    }

    travel(anchor, token, run = false) {
      if (!this.validSequence(token)) return Promise.resolve(false);
      if (this.motionReduced) {
        this.point = this.resolveAnchor(anchor);
        this.anchor = anchor;
        this.render();
        return Promise.resolve(true);
      }
      return new Promise(resolve => {
        this.pendingMove = resolve;
        this.travelTo(anchor, () => {
          this.pendingMove = null;
          this.anchor = anchor;
          resolve(this.validSequence(token));
        }, run);
      });
    }

    setStage(stage) {
      this.interactionStage = stage;
      for (const { layer } of this.layers) {
        if (stage) layer.dataset.interactionStage = stage; else delete layer.dataset.interactionStage;
      }
    }

    setBodyMotion(x = 0, y = 0, angle = 0) {
      this.bodyMotion = { x, y, angle };
      for (const { body } of this.layers) setStyle(body, 'transform', `translate3d(${x}px, ${y}px, 0px) rotate(${angle}deg)`);
    }

    mouthPoint() {
      let x, y;
      if (this.motionFrame) {
        const { action, index, facing } = this.motionFrame;
        const pickup = [[30, -35], [29, -21], [28, -11], [26, -4.5], [24, -6], [30, -34]];
        const mouth = action === 'pickup' ? pickup[index] : action === 'eat' ? [26, -5]
          : action === 'turn' ? [[35, -36], [24, -36], [8, -36], [-8, -36], [-24, -36], [-35, -36]][index]
            : [35, -36];
        x = mouth[0] * facing; y = mouth[1];
      } else {
        const bbox = POSES[this.pose], mouth = MOUTHS[this.pose] || MOUTHS.stand;
        x = (mouth[0] - (bbox[0] + bbox[2]) / 2) / SIDE * SIZE;
        y = (mouth[1] - bbox[3]) / SIDE * SIZE;
        if (this.pose.startsWith('run-right')) x *= this.facing;
      }
      const gait = gaitTransform(this.movement, this.facing);
      // Use the same rounded values as the CSS transform.
      y *= Number(gait.scale.toFixed(3));
      const pitch = Number(gait.pitch.toFixed(2)) * Math.PI / 180;
      const rotatedX = x * Math.cos(pitch) - y * Math.sin(pitch);
      y = x * Math.sin(pitch) + y * Math.cos(pitch) + Number(gait.lift.toFixed(2));
      x = rotatedX;
      const angle = this.bodyMotion.angle * Math.PI / 180;
      return { x: this.point.x + x * Math.cos(angle) - y * Math.sin(angle) + this.bodyMotion.x,
        y: this.point.y + x * Math.sin(angle) + y * Math.cos(angle) + this.bodyMotion.y };
    }

    placeProp(point, options = {}) {
      this.propPoint = { ...point };
      if (options.angle !== undefined) this.propRotation = options.angle;
      const scale = options.scale ?? 1;
      setStyle(this.prop, 'transform', `translate3d(${(point.x - 8).toFixed(2)}px, ${(point.y - 8).toFixed(2)}px, 0px)`);
      setStyle(this.propArt, 'transform', `rotate(${this.propRotation}deg) scale(${scale})`);
      const groundY = options.groundY ?? point.y + 8;
      const height = Math.max(0, groundY - point.y - 8);
      setStyle(this.propShadow, 'transform', `translate3d(${(point.x - 10).toFixed(2)}px, ${groundY.toFixed(2)}px, 0px) scaleX(${clamp(1 - height / 180, .45, 1).toFixed(3)})`);
      setStyle(this.propShadow, 'opacity', String(clamp(.28 - height / 600, .08, .28)));
    }

    animate(duration, token, update) {
      if (!this.validSequence(token)) return Promise.resolve(false);
      if (this.motionReduced) { update(1, duration, performance.now()); return Promise.resolve(true); }
      return new Promise(resolve => {
        this.pendingMove = resolve;
        let elapsed = 0, last = performance.now();
        update(0, 0, last);
        const step = now => {
          if (!this.validSequence(token)) return;
          elapsed += clamp(now - last, 0, 50);
          last = now;
          const t = clamp(elapsed / duration, 0, 1);
          update(t, Math.min(elapsed, duration), now);
          if (t < 1) this.frame = requestAnimationFrame(step);
          else { this.frame = 0; this.pendingMove = null; resolve(true); }
        };
        this.frame = requestAnimationFrame(step);
      });
    }

    moveProp(to, duration, token, options = {}) {
      const from = { ...this.propPoint }, angle = this.propRotation;
      return this.animate(duration, token, t => {
        const point = mixPoint(from, to, smooth(t));
        point.y -= Math.sin(Math.PI * t) * (options.arc || 0);
        this.placeProp(point, { ...options, angle: angle + (options.spin || 0) * smooth(t),
          scale: (options.fromScale ?? 1) + ((options.scale ?? 1) - (options.fromScale ?? 1)) * smooth(t) });
      });
    }

    async turnWithProp(direction, token) {
      if (direction === this.facing) return true;
      if (!await this.animate(660, token, t => {
        this.setMotionFrame('turn', Math.min(5, Math.floor(t * 6)));
        this.render();
      })) return false;
      this.facing = direction;
      // The last turn frame already faces the destination; normalize artwork and
      // facing together before rendering the carried item again.
      if (!this.setMotionFrame('walk', 0)) this.setPose(direction > 0 ? 'walk-right' : 'walk-left');
      this.render();
      return true;
    }

    startPlacement(kind) {
      if (!['feed', 'ball'].includes(kind) || !this.viewport || !this.eligible || !this.appeared ||
        (this.busy && !['ambient', 'placement'].includes(this.sequenceKind))) return false;
      if (this.placement?.kind === kind) { this.cancelPlacement(); return true; }
      this.beginSequence('placement');
      this.placement = { kind, context: this.getContext(), behavior: kind === 'feed' ? Math.random() < .5 ? 'carry' : 'roll' : null };
      this.setStage('placement');
      this.viewport.dataset.petPlacement = kind;
      this.placementHint.textContent = `点击画布投掷${kind === 'feed' ? '零食' : '球'} · Esc 取消`;
      this.placementHint.hidden = false;
      this.onStateChange();
      return true;
    }

    clearPlacement() {
      this.placement = null;
      if (this.viewport) delete this.viewport.dataset.petPlacement;
      this.placementHint.hidden = true;
    }

    cancelPlacement() {
      if (!this.placement) return;
      this.cancelSequence();
      this.render(); this.scheduleAction(3500);
    }

    onPlacementPointerDown(event) {
      const last = this.lastPlacement;
      if (!this.placement && last && performance.now() - last.at < 450 && event.button === 0 &&
        this.viewport?.contains(event.target) && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.placedPointerId = event.pointerId;
        this.placedClick = { id: event.pointerId, until: performance.now() + 500 };
        return;
      }
      if (!this.placement || event.button !== 0 || !event.isPrimary || !this.viewport?.contains(event.target)) return;
      if (event.target.closest('button,input,textarea,select,[contenteditable="true"],[role="dialog"],.floating-format-bar,.tool-popover,.context-menu,.planning-toplevel,.amap-map-frame')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.placedPointerId = event.pointerId;
      this.placedClick = { id: event.pointerId, until: performance.now() + 1000 };
      const placement = this.placement;
      if (placement.context !== this.getContext()) { this.cancelPlacement(); return; }
      const point = { x: event.clientX, y: event.clientY };
      this.lastPlacement = { ...point, at: performance.now() };
      this.clearPlacement();
      this.busy = false;
      this.interact(placement.kind, point, placement.behavior);
    }

    interact(kind, point = null, behavior = null) {
      if (!['feed', 'ball'].includes(kind) || !this.eligible || !this.appeared ||
        (this.busy && this.sequenceKind !== 'ambient')) return false;
      if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
      const selected = kind === 'feed' ? ['carry', 'roll'].includes(behavior) ? behavior : Math.random() < .5 ? 'carry' : 'roll' : null;
      void this.performInteraction(kind, point, selected).catch(error => this.recoverSequence(error));
      return true;
    }

    recoverSequence(error) {
      console.warn('Pet action interrupted', error);
      this.cancelSequence();
      if (this.eligible) { this.setPose('sit'); this.setMode('front'); this.render(); this.scheduleAction(5000); }
    }

    async react(name, duration, token) {
      for (const { layer } of this.layers) layer.dataset.reaction = name;
      const completeDuration = Math.max(duration, name === 'expecting' ? 440 : name === 'delighted' ? 900 : 0);
      const valid = await this.wait(this.motionReduced ? Math.min(duration, 150) : completeDuration, token);
      if (valid) for (const { layer } of this.layers) delete layer.dataset.reaction;
      return valid;
    }

    ballFlight(from, to, elapsed, duration) {
      const direction = to.x >= from.x ? 1 : -1;
      const impact = { x: to.x - direction * 20, y: to.y };
      let point;
      if (elapsed <= duration) {
        const t = clamp(elapsed / duration, 0, 1);
        point = mixPoint(from, impact, t);
        point.y -= 4 * clamp(Math.hypot(to.x - from.x, to.y - from.y) * .18, 42, 140) * t * (1 - t);
      } else {
        const time = elapsed - duration;
        if (time < 200) {
          const t = time / 200;
          point = { x: impact.x + direction * 10 * t, y: to.y - 18 * Math.sin(Math.PI * t) };
        } else if (time < 350) {
          const t = (time - 200) / 150;
          point = { x: impact.x + direction * (10 + 7 * t), y: to.y - 6 * Math.sin(Math.PI * t) };
        } else point = { x: impact.x + direction * (17 + 3 * smooth((time - 350) / 150)), y: to.y };
      }
      return point;
    }

    async chaseBall(ballTarget, dogTarget, token) {
      this.setStage('chase');
      const from = { ...this.point }, to = this.resolveAnchor(dogTarget), origin = this.mouthPoint();
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const flightMs = clamp(Math.hypot(ballTarget.x - origin.x, ballTarget.y - origin.y) * 1.7, 520, 1500);
      const gait = GAITS.run, profile = motionProfile(distance, gait);
      const started = performance.now(), dx = to.x - from.x, dy = to.y - from.y;
      const family = Math.abs(dy) > Math.abs(dx) * 1.15 ? dy < 0 ? 'rear' : 'front' : 'side';
      const movement = { from, to, gait, profile, family, style: 'run', direction: dx >= 0 ? 1 : -1,
        travelled: 0, gaitPhase: 0, effort: 0, lastPoint: from, lastFrame: started };
      this.facing = movement.direction;
      this.movement = movement;
      const duration = Math.max(flightMs + 500, profile.duration + 160);
      if (!await this.animate(duration, token, (_t, elapsed, now) => {
        const ratio = distance > .5 ? profileDistance(profile, Math.max(0, elapsed - 160)) / distance : 1;
        const previous = { ...this.point };
        this.point = mixPoint(from, to, ratio);
        if (Math.hypot(this.point.x - previous.x, this.point.y - previous.y) > .001) this.updateGait(movement, now);
        else { movement.effort = 0; movement.lastFrame = now; }
        this.render();
        const ball = this.ballFlight(origin, ballTarget, elapsed, flightMs);
        this.placeProp(ball, { groundY: ballTarget.y + 8, angle: (ball.x - origin.x) / 8 * 180 / Math.PI });
      })) return false;
      this.movement = null;
      this.point = to; this.anchor = dogTarget; this.render();
      return true;
    }

    dockHome() {
      const buttons = this.visibleButtons();
      return buttons.length ? { kind: 'edge', button: buttons[Math.min(1, buttons.length - 1)] } : { kind: 'top' };
    }

    async eatTreat(token) {
      this.setStage('sniff');
      if (!await this.lowerHead(token, this.propPoint)) return false;
      this.setStage('eat');
      for (const { layer } of this.layers) layer.classList.add('is-eating');
      this.prop.classList.add('is-nibbled');
      // Each mouthful has a bite, two small chews, then a closed-mouth pause.
      const mouthful = [0, 1, 2, 3, 2, 3, 5, 3];
      if (!await this.animate(3300, token, (_t, elapsed) => {
        const bite = Math.min(2, Math.floor(elapsed / 1100));
        const local = elapsed - bite * 1100;
        this.setMotionFrame('eat', mouthful[Math.min(7, Math.floor(local / 135))]);
        const eaten = [270, 1370, 2470].reduce((sum, start) => sum + smooth((elapsed - start) / 240), 0) / 3;
        this.propArt.style.setProperty('--pet-food-left', String(1 - eaten));
      })) return false;
      for (const { layer } of this.layers) layer.classList.remove('is-eating');
      this.prop.classList.remove('is-nibbled');
      this.prop.classList.add('is-consumed');
      this.propShadow.classList.remove('is-visible');
      this.setMotionFrame('eat', 5);
      if (!await this.wait(this.motionReduced ? 0 : 260, token) || !await this.liftHead(token)) return false;
      this.setStage('reward');
      this.bark('好吃，谢谢你～');
      return this.react('delighted', 360, token);
    }

    lowerHead(token, target) {
      const from = { ...this.point };
      const contact = { x: target.x - 24 * this.facing, y: target.y + 6 };
      if (!this.motionReady) this.setPose('lie');
      return this.animate(480, token, t => {
        this.point = mixPoint(from, contact, smooth(t));
        this.setMotionFrame('pickup', Math.min(4, Math.floor(t * 5)));
        this.render();
      });
    }

    liftHead(token) {
      return this.animate(360, token, t => {
        this.setMotionFrame('pickup', Math.max(0, 4 - Math.floor(t * 5)));
        this.render();
      });
    }

    async retrieveProp(token, meal = false) {
      this.setStage('pickup');
      if (!await this.lowerHead(token, this.propPoint)) return false;
      this.carried = true;
      if (!await this.liftHead(token)) return false;
      const home = this.dockHome();
      const homePoint = this.resolveAnchor(home);
      if (!await this.turnWithProp(homePoint.x >= this.point.x ? 1 : -1, token)) return false;
      this.setMotionFrame('walk', 0);
      this.setStage('return');
      if (!await this.travel(home, token, { style: 'carry', curve: 7 })) return false;
      this.setStage('drop');
      const drop = { x: this.point.x + 32 * this.facing, y: this.point.y - 5 };
      if (!await this.lowerHead(token, drop)) return false;
      this.carried = false;
      if (!await this.moveProp(drop, 160, token,
        { arc: 0, spin: 0, fromScale: .82, groundY: this.point.y })) return false;
      if (meal) {
        this.propRotation = 0;
        this.placeProp(this.propPoint, { groundY: this.point.y, angle: 0 });
        return this.eatTreat(token);
      }
      if (!await this.poseStep('sit', 240, token)) return false;
      this.setStage('reward');
      this.bark('捡回来啦，再玩一次？');
      return this.react('delighted', 1000, token);
    }

    async rollHome(token) {
      this.setStage('return');
      const home = this.dockHome(), from = { ...this.point }, to = this.resolveAnchor(home);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (!this.motionReady) return this.travel(home, token, { style: 'walk' });
      // One or two small, complete rolls; travelling a whole screen by somersault
      // looks mechanical. Pause on the paws, then walk the remaining way home.
      if (!await this.turnWithProp(to.x >= from.x ? 1 : -1, token)) return false;
      const turns = distance > 220 ? 2 : 1;
      const rollDistance = Math.min(distance, turns * 54);
      const end = mixPoint(from, to, distance > .5 ? rollDistance / distance : 0);
      this.setBodyMotion();
      for (const { layer } of this.layers) layer.classList.add('is-rolling');
      for (let turn = 0; turn < turns; turn++) {
        if (!await this.animate(1250, token, t => {
          // Crouch and landing take time; the back passes through more quickly.
          const phase = t < .2 ? 0 : t < .36 ? 1 : t < .49 ? 2 : t < .63 ? 3 : t < .82 ? 4 : 5;
          const advance = smooth((t - .14) / .7);
          this.point = mixPoint(from, end, (turn + advance) / turns);
          this.setMotionFrame('roll', phase);
          this.render();
        })) return false;
        if (!await this.wait(this.motionReduced ? 0 : 220, token)) return false;
      }
      for (const { layer } of this.layers) layer.classList.remove('is-rolling');
      this.setBodyMotion();
      if (!await this.poseStep('lie', 180, token) || !await this.wake(token)) return false;
      if (!await this.travel(home, token, { style: 'walk' })) return false;
      return true;
    }

    async performInteraction(kind, placedPoint, behavior) {
      const token = this.beginSequence('interaction');
      this.setMode('front');
      const ground = placedPoint || this.resolveAnchor({ kind: 'point', point: {
        x: this.dockRect.right + (kind === 'ball' ? 210 : 65), y: Math.max(this.point.y, this.dockRect.top + 115)
      } });
      const propTarget = { x: ground.x, y: ground.y - (kind === 'ball' ? 8 : 5) };
      const approachFacing = ground.x >= this.point.x ? 1 : -1;
      const destination = { kind: 'scene', point: { x: ground.x - 32 * approachFacing, y: ground.y } };
      this.propKind = kind;
      this.propRotation = 0;
      this.propArt.style.setProperty('--pet-food-left', '1');
      if (kind !== 'ball') {
        this.prop.className = 'toolbar-pet-prop is-visible is-food is-dropping';
        this.placeProp(propTarget, { groundY: ground.y });
        this.propShadow.classList.add('is-visible');
      }
      if (!await this.wake(token)) return;
      this.setStage('expect');
      if (!await this.react('expecting', 220, token)) return;
      this.prop.classList.remove('is-dropping');
      this.propShadow.classList.add('is-visible');
      if (kind === 'ball') {
        this.prop.className = 'toolbar-pet-prop is-visible is-ball';
        if (!await this.chaseBall(propTarget, destination, token) || !await this.retrieveProp(token)) return;
      } else {
        this.setStage('chase');
        if (!await this.travel(destination, token, { style: 'run' })) return;
        this.placeProp(propTarget, { groundY: ground.y, angle: 0 });
        if (behavior === 'carry') {
          if (!await this.retrieveProp(token, true)) return;
        } else if (!await this.eatTreat(token) || !await this.rollHome(token)) return;
      }
      this.setStage('settle');
      if (!await this.settlePose('sit', token)) return;
      this.finishSequence(token);
    }

    setFeedbackEnabled(enabled) {
      this.feedbackEnabled = Boolean(enabled);
      if (!this.feedbackEnabled) {
        this.pendingFeedback = null;
        if (this.busy && this.sequenceKind === 'feedback') {
          this.cancelSequence();
          this.setPose('sit'); this.render(); this.scheduleAction(5000);
        }
      }
      try { global.localStorage.setItem(FEEDBACK_KEY, String(this.feedbackEnabled)); } catch {}
      this.onStateChange();
    }

    feedback(type, id) {
      if (!['task', 'save', 'export'].includes(type) || !this.feedbackEnabled ||
        !this.eligible || !this.appeared) return false;
      const now = performance.now();
      const key = id == null ? null : `${type}:${id}`;
      if ((key && this.feedbackIds.has(key)) || (now - this.lastFeedbackAt < 30000)) return false;
      if (this.busy) {
        if (!this.pendingFeedback || type === 'task') this.pendingFeedback = { type, id, at: now };
        return false;
      }
      if (key) {
        this.feedbackIds.set(key, now);
        if (this.feedbackIds.size > 64) this.feedbackIds.delete(this.feedbackIds.keys().next().value);
      }
      this.lastFeedbackAt = now;
      void this.celebrate(type).catch(error => this.recoverSequence(error));
      return true;
    }

    async celebrate(type) {
      const token = this.beginSequence('feedback');
      if (!await this.wake(token)) return;
      this.setMode('front');
      if (!await this.poseStep(this.motionReduced ? 'sit' : 'play', 200, token)) return;
      if (!this.motionReduced) for (const { layer } of this.layers) layer.classList.add('is-celebrating');
      this.bark({ task: '又完成一件！', save: '保存好啦！', export: '图片准备好啦！' }[type]);
      if (!await this.wait(2300, token) || !await this.poseStep('sit', 200, token)) return;
      this.finishSequence(token, 8000);
    }

    travelTo(anchor, onFinish, run = false) {
      const options = typeof run === 'object' ? run : {};
      const target = this.resolveAnchor(anchor);
      const dx = target.x - this.point.x;
      const dy = target.y - this.point.y;
      const distance = Math.hypot(dx, dy);
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.15;
      const family = vertical ? dy < 0 ? 'rear' : 'front' : 'side';
      const style = options.style || (family === 'rear'
        ? 'ascend'
        : family === 'front' ? 'descend' : run === true || distance > 160 ? 'run' : 'walk');
      this.setPose(family === 'rear' ? 'waddle' : family === 'front'
        ? 'walk-front' : style === 'run' ? 'run-right'
          : dx >= 0 ? 'walk-right' : 'walk-left');
      this.moveTo(anchor, 0, onFinish, { ...options, style, family });
    }

    updateGait(movement, now) {
      if (!movement.gait) return;
      const dx = this.point.x - movement.lastPoint.x, dy = this.point.y - movement.lastPoint.y;
      const moved = Math.hypot(dx, dy);
      if (moved > .01) {
        const vertical = Math.abs(dy) > Math.abs(dx) * (movement.family === 'side' ? 1.2 : .85);
        movement.family = vertical ? dy < 0 ? 'rear' : 'front' : 'side';
        if (Math.abs(dx) > .01) movement.direction = dx >= 0 ? 1 : -1;
      }
      const elapsed = clamp(now - movement.lastFrame, 1, 50);
      movement.travelled += moved;
      movement.gaitPhase = (movement.travelled / movement.gait.stride) % 1;
      movement.effort = clamp(moved / elapsed * 1000 / movement.gait.speed, 0, 1);
      movement.lastPoint = { ...this.point };
      movement.lastFrame = now;
      this.facing = movement.direction;
      if (movement.family === 'side' && this.setMotionFrame(movement.style === 'run' ? 'run' : 'walk', movement.gaitPhase * 6)) return;
      const alternate = Math.floor(movement.travelled / (movement.gait.stride / 2)) % 2;
      if (movement.family === 'side') {
        const pose = movement.style === 'run' ? 'run-right'
          : movement.direction === 1 ? 'walk-right' : 'walk-left';
        this.setPose(pose + (alternate ? '-alt' : ''));
      } else if (movement.family === 'rear') {
        this.setPose(alternate ? 'waddle-alt' : 'waddle');
      } else {
        this.setPose(alternate ? 'walk-front-alt' : 'walk-front');
      }
    }

    moveTo(anchor, duration, onFinish, options = {}) {
      cancelAnimationFrame(this.frame);
      const from = { ...this.point };
      const to = this.resolveAnchor(anchor);
      const started = performance.now();
      const style = options.style || 'walk';
      const gait = GAITS[style] || null;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance < .5 && gait) {
        this.point = to;
        this.render();
        onFinish();
        return;
      }
      const profile = gait ? motionProfile(distance, gait) : null;
      const movement = { anchor, from, to, started, duration: profile?.duration || duration,
        style, gait, profile, family: options.family || 'side',
        direction: options.direction || (to.x >= from.x ? 1 : -1), segment: 0,
        travelled: 0, gaitPhase: 0, effort: 0,
        lastPoint: from, lastFrame: started, lastTick: started, elapsed: 0 };
      this.movement = movement;
      this.facing = movement.direction;
      const finish = () => {
        this.point = this.resolveAnchor(anchor);
        this.movement = null;
        this.frame = 0;
        this.render();
        onFinish();
      };
      const step = (now) => {
        if (!this.eligible || this.movement !== movement) return;
        if (movement.finishing) {
          const liveTarget = this.resolveAnchor(anchor);
          const drift = Math.hypot(liveTarget.x - this.point.x, liveTarget.y - this.point.y);
          if (drift <= 2) {
            finish();
            return;
          }
          if (drift > 10) {
            const dx = liveTarget.x - this.point.x;
            const dy = liveTarget.y - this.point.y;
            const family = Math.abs(dy) > Math.abs(dx) * 1.15
              ? dy < 0 ? 'rear' : 'front' : 'side';
            if (!movement.gait || movement.family !== family ||
              (family === 'side' && movement.direction !== (dx >= 0 ? 1 : -1))) {
              movement.family = family;
              movement.style = family === 'rear' ? 'ascend'
                : family === 'front' ? 'descend' : 'walk';
              movement.gait = GAITS[movement.style];
              movement.direction = dx >= 0 ? 1 : -1;
              movement.lastPoint = { ...this.point };
            }
          }
          const elapsed = clamp(now - movement.lastFrame, 1, 50);
          const advance = Math.min(drift, (movement.gait?.speed || 85) * elapsed / 1000);
          const follow = advance / drift;
          this.point = {
            x: this.point.x + (liveTarget.x - this.point.x) * follow,
            y: this.point.y + (liveTarget.y - this.point.y) * follow
          };
          this.updateGait(movement, now);
          if (!movement.gait) movement.lastFrame = now;
          this.render();
          this.frame = requestAnimationFrame(step);
          return;
        }
        movement.elapsed += clamp(now - movement.lastTick, 0, 50);
        movement.lastTick = now;
        const target = movement.to;
        const progress = clamp(movement.elapsed / movement.duration, 0, 1);
        const ratio = movement.profile
          ? profileDistance(movement.profile, movement.elapsed) / distance
          : progress * progress * (3 - 2 * progress);
        this.point = {
          x: from.x + (target.x - from.x) * ratio,
          y: from.y + (target.y - from.y) * ratio
        };
        if (options.curve && distance) {
          const arc = Math.sin(Math.PI * ratio) * options.curve;
          this.point.x -= (target.y - from.y) / distance * arc;
          this.point.y += (target.x - from.x) / distance * arc;
        }
        this.updateGait(movement, now);
        this.render();
        if (ratio < 1) this.frame = requestAnimationFrame(step);
        else {
          const liveTarget = this.resolveAnchor(anchor);
          const drift = Math.hypot(liveTarget.x - this.point.x, liveTarget.y - this.point.y);
          if (drift > 2) {
            movement.finishing = true;
            movement.lastFrame = now;
            this.frame = requestAnimationFrame(step);
            return;
          }
          finish();
        }
      };
      this.frame = requestAnimationFrame(step);
    }

    bark(message = '汪!') {
      clearTimeout(this.bubbleTimer);
      this.bubble.textContent = message;
      this.bubble.classList.remove('is-barking');
      this.bubbleTimer = setTimeout(() => {
        if (this.eligible) {
          this.bubble.classList.add('is-barking');
          this.bubbleTimer = setTimeout(() => this.bubble.classList.remove('is-barking'), 2300);
        }
      }, 20);
    }

    onContextMenu(event) {
      if (!this.eligible || !this.appeared || this.mode === 'behind' || !this.point) return;
      const bbox = POSES[this.pose];
      const left = this.point.x - ((bbox[0] + bbox[2]) / 2 / SIDE) * SIZE;
      const top = this.point.y - (bbox[3] / SIDE) * SIZE;
      const padding = 4;
      if (event.clientX < left + bbox[0] / SIDE * SIZE - padding ||
          event.clientX > left + bbox[2] / SIDE * SIZE + padding ||
          event.clientY < top + bbox[1] / SIDE * SIZE - padding ||
          event.clientY > top + bbox[3] / SIDE * SIZE + padding) return;
      if (this.mode === 'peek' && event.clientX < this.dockRect.right) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.showContextMenu(event.clientX, event.clientY, () => this.dismiss());
    }

    dismiss() {
      this.dismissed = true;
      this.onEnvironmentChange();
    }

    hidePermanently() {
      this.permanentlyHidden = true;
      saveHiddenPreference(true);
      this.dismiss();
    }

    show() {
      this.cancelSequence();
      if (this.assetsFailed) this.assetAttempt = (this.assetAttempt || 0) + 1;
      this.assetsFailed = false;
      this.permanentlyHidden = false;
      saveHiddenPreference(false);
      this.dismissed = false;
      this.remainingSpawnMs = 0;
      clearTimeout(this.spawnTimer);
      this.spawnTimer = 0;
      if (this.appeared) {
        clearTimeout(this.actionTimer);
        clearTimeout(this.blinkTimer);
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.movement = null;
        this.currentAction = '';
        this.sceneAnchor = null;
        this.anchor = { kind: 'top' };
        this.point = this.resolveAnchor(this.anchor);
        this.resetOnResume = false;
        this.setPose('sit');
        this.setMode('front');
      }
      this.onEnvironmentChange();
      if (this.eligible && !this.appeared) {
        clearTimeout(this.spawnTimer);
        this.spawn();
      } else if (this.eligible) {
        this.setVisible(true);
        this.render();
        this.scheduleAction(5000);
        this.scheduleBlink();
      }
    }

    destroy() {
      this.destroyed = true;
      this.dismissed = true;
      this.cancelSequence();
      clearTimeout(this.spawnTimer);
      clearTimeout(this.actionTimer);
      clearTimeout(this.blinkTimer);
      document.removeEventListener('pointerdown', this.onPlacementPointerDown, true);
      document.removeEventListener('pointerup', this.onPlacementPointerEnd, true);
      document.removeEventListener('pointercancel', this.onPlacementPointerEnd, true);
      document.removeEventListener('click', this.onPlacementClick, true);
      document.removeEventListener('dblclick', this.onPlacementDoubleClick, true);
      document.removeEventListener('keydown', this.onPlacementKeyDown, true);
      document.removeEventListener('contextmenu', this.onPlacementContextMenu, true);
      document.removeEventListener('pointermove', this.onPlacementPointerMove);
      document.removeEventListener('contextmenu', this.onContextMenu, true);
      document.removeEventListener('visibilitychange', this.onEnvironmentChange);
      global.removeEventListener('resize', this.onEnvironmentChange);
      global.removeEventListener('muse:pet-feedback', this.onFeedback);
      global.removeEventListener('pagehide', this.onPageHide);
      global.removeEventListener('pageshow', this.onPageShow);
      global.visualViewport?.removeEventListener('resize', this.onGeometryChange);
      global.visualViewport?.removeEventListener('scroll', this.onGeometryChange);
      this.dock.removeEventListener('scroll', this.onGeometryChange);
      this.mobile.removeEventListener('change', this.onEnvironmentChange);
      this.reducedMotion.removeEventListener('change', this.onEnvironmentChange);
      this.observer.disconnect();
      this.resizeObserver?.disconnect();
      for (const { layer } of this.layers) layer.remove();
      this.ledge.remove(); this.pathTexture.remove(); this.prop.remove(); this.propShadow.remove(); this.placementHint.remove();
      if (instance === this) instance = null;
    }
  }

  let instance = null;
  global.ToolbarPet = {
    init(options) {
      if (!instance && options?.dock && typeof options.showContextMenu === 'function') {
        instance = new ToolbarPet(options);
      }
      return instance;
    }
  };
})(window);
