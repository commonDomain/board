(function (global) {
  'use strict';

  const SIDE = 418;
  const SIZE = 92;
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
  const SPAWN_DELAY_MS = [0, 180000];
  // Distances are CSS pixels at the 92px sprite size. One stride contains
  // both alternating contact poses; cadence is derived from distance moved.
  const GAITS = {
    walk: { speed: 100, stride: 40, ramp: 18, lift: 1.2, pitch: .5 },
    run: { speed: 155, stride: 52, ramp: 30, lift: 2.3, pitch: 1.1 },
    ascend: { speed: 84, stride: 36, ramp: 18, lift: .9, pitch: .5 },
    descend: { speed: 110, stride: 38, ramp: 20, lift: .8, pitch: .4 }
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
    // Keep decoded poses mounted. Reassigning src during a gait used to expose
    // an empty frame on slower devices even though the files were preloaded.
    const images = Object.fromEntries(Object.keys(POSES).map((pose) => {
      const img = document.createElement('img');
      img.className = 'toolbar-pet-image';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.src = assetUrl(pose);
      layer.appendChild(img);
      return [pose, img];
    }));
    const eyelids = document.createElement('span');
    eyelids.className = 'toolbar-pet-eyelids';
    layer.appendChild(eyelids);
    layer.prepend(shadow);
    layer.appendChild(groundLine);
    // Share the dock's stacking context so the rear sprite can sit behind it.
    host.appendChild(layer);
    return { layer, images };
  }

  class ToolbarPet {
    constructor(options) {
      this.dock = options.dock;
      this.showContextMenu = options.showContextMenu;
      this.rear = makeLayer('toolbar-pet-rear', this.dock.parentElement);
      this.front = makeLayer('toolbar-pet-front', this.dock.parentElement);
      this.bubble = document.createElement('span');
      this.bubble.className = 'toolbar-pet-bubble';
      this.bubble.textContent = '汪!';
      this.bubble.setAttribute('aria-hidden', 'true');
      this.front.layer.appendChild(this.bubble);
      this.layers = [this.rear, this.front];
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
      this.dismissed = false;
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
      document.addEventListener('contextmenu', this.onContextMenu, true);
      document.addEventListener('visibilitychange', this.onEnvironmentChange);
      global.addEventListener('resize', this.onEnvironmentChange, { passive: true });
      global.visualViewport?.addEventListener('resize', this.onGeometryChange, { passive: true });
      global.visualViewport?.addEventListener('scroll', this.onGeometryChange, { passive: true });
      this.dock.addEventListener('scroll', this.onGeometryChange, { passive: true });
      this.mobile.addEventListener('change', this.onEnvironmentChange);
      this.reducedMotion.addEventListener('change', this.onEnvironmentChange);
      this.observer = new MutationObserver(this.onEnvironmentChange);
      this.observer.observe(this.dock, { attributes: true, attributeFilter: ['hidden'] });
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      // A dock that starts at zero size must be rechecked when layout settles.
      this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this.onEnvironmentChange) : null;
      this.resizeObserver?.observe(this.dock);
      this.onEnvironmentChange();
    }

    isEligible() {
      const rect = this.dock.getBoundingClientRect();
      return !this.dismissed && !this.mobile.matches && document.visibilityState === 'visible' &&
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
      this.eligible = eligible;
      this.motionReduced = this.reducedMotion.matches;
      if (!eligible) {
        const interruptedMovement = Boolean(this.movement);
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
        if (interruptedMovement) {
          this.currentAction = '';
          this.sceneAnchor = null;
          this.anchor = { kind: 'top' };
          this.resetOnResume = true;
        }
        this.ledge.classList.remove('is-visible');
        this.pathTexture.classList.remove('is-visible');
        this.setVisible(false);
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
    }

    scheduleSpawn() {
      if (!this.eligible || this.appeared || this.spawnTimer) return;
      this.spawnStartedAt = Date.now();
      this.spawnTimer = setTimeout(() => this.spawn(), this.remainingSpawnMs);
    }

    onGeometryChange() {
      if (!this.eligible || !this.appeared) return;
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
      const button = this.anchor.button.getBoundingClientRect();
      const dock = this.dock.getBoundingClientRect();
      return button.bottom > dock.top + 10 && button.top < dock.bottom - 10;
    }

    visibleButtons() {
      const dock = this.dock.getBoundingClientRect();
      return Array.from(this.dock.querySelectorAll('.tool-button')).filter((button) => {
        const rect = button.getBoundingClientRect();
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
      if (anchor.kind === 'point') return anchor.point;
      const dock = this.dock.getBoundingClientRect();
      if (anchor.kind === 'top' || !anchor.button) {
        return { x: dock.left + dock.width / 2, y: dock.top + 16 };
      }
      const rect = anchor.button.getBoundingClientRect();
      const y = clamp(rect.top + 23, dock.top + 18, dock.bottom - 22);
      if (anchor.kind === 'icon') return { x: rect.left + rect.width / 2, y };
      if (anchor.kind === 'behind') return { x: dock.right - 10, y };
      if (anchor.kind === 'peek') return { x: dock.right + 26, y };
      return { x: dock.right + 18, y };
    }

    setPose(name) {
      if (name === this.pose) return;
      const previous = this.pose;
      this.pose = name;
      for (const { layer, images } of this.layers) {
        layer.dataset.pose = name;
        if (previous) images[previous].classList.remove('is-active');
        images[name].classList.add('is-active');
      }
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
      const left = this.point.x - ((bbox[0] + bbox[2]) / 2 / SIDE) * SIZE;
      const top = this.point.y - (bbox[3] / SIDE) * SIZE;
      const dock = this.dock.getBoundingClientRect();
      const shadowWidth = this.movement ? 38 : Math.max(30, (bbox[2] - bbox[0]) / SIDE * SIZE * .59);
      const gait = this.movement?.gait;
      const phase = this.movement?.gaitPhase || 0;
      const effort = this.movement?.effort || 0;
      const flight = (1 - Math.cos(4 * Math.PI * phase)) / 2;
      const bodyLift = gait ? -gait.lift * flight * effort : 0;
      const bodyPitch = gait ? gait.pitch * Math.sin(2 * Math.PI * phase) * effort : 0;
      const bodyScale = gait ? 1 + (.004 * flight - .007 * (1 - flight)) * effort : 1;
      for (const { layer } of this.layers) {
        layer.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        layer.style.setProperty('--pet-ground', `${bbox[3] / SIDE * SIZE - 3}px`);
        layer.style.setProperty('--pet-shadow-width', `${shadowWidth}px`);
        layer.style.setProperty('--pet-ground-width', Math.max(30, Math.min(52, shadowWidth * .9)) + 'px');
        layer.classList.toggle('is-moving', Boolean(this.movement));
        layer.style.setProperty('--pet-gait-y', `${bodyLift.toFixed(2)}px`);
        layer.style.setProperty('--pet-gait-angle', `${bodyPitch.toFixed(2)}deg`);
        layer.style.setProperty('--pet-gait-scale', bodyScale.toFixed(3));
        layer.style.setProperty('--pet-shadow-scale', gait ? String((1 - .11 * flight * effort).toFixed(3)) : '1');
        layer.style.setProperty('--pet-facing', this.movement?.direction === -1 ? '-1' : '1');
      }
      this.front.layer.style.setProperty('--pet-peek-cut', `${clamp(dock.right - left, 0, SIZE)}px`);
      this.renderLedge();
      this.renderPath();
    }

    renderLedge() {
      const anchor = this.sceneAnchor;
      if (!this.eligible || this.motionReduced || this.currentAction !== 'ledge' || !anchor?.button) {
        this.ledge.classList.remove('is-visible');
        return;
      }
      const button = anchor.button.getBoundingClientRect();
      const dock = this.dock.getBoundingClientRect();
      if (button.bottom <= dock.top + 10 || button.top >= dock.bottom - 10) {
        this.ledge.classList.remove('is-visible');
        return;
      }
      const point = this.resolveAnchor(anchor);
      this.ledge.style.left = `${point.x - 44}px`;
      this.ledge.style.top = `${point.y - 1}px`;
      this.ledge.classList.add('is-visible');
    }

    renderPath() {
      const movement = this.movement;
      if (!this.eligible || this.motionReduced || movement?.family !== 'rear' || !movement.gait) {
        this.pathTexture.classList.remove('is-visible');
        return;
      }
      this.pathTexture.style.left = `${this.point.x - 34}px`;
      this.pathTexture.style.top = `${this.point.y - 26}px`;
      this.pathTexture.style.backgroundPosition = `0 ${Math.round(movement.travelled)}px, 0 0`;
      this.pathTexture.classList.add('is-visible');
    }

    spawn() {
      this.spawnTimer = 0;
      this.remainingSpawnMs = 0;
      if (!this.isEligible()) {
        this.onEnvironmentChange();
        return;
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
        return;
      }
      this.moveTo(this.anchor, 1050, () => {
        this.setPose('sit');
        this.setMode('front');
        this.scheduleAction(5000);
        this.scheduleBlink();
      }, { style: 'emerge' });
    }

    scheduleAction(delay) {
      clearTimeout(this.actionTimer);
      if (!this.eligible || this.dismissed || this.reducedMotion.matches) return;
      this.actionTimer = setTimeout(() => this.runAction(), delay);
    }

    scheduleBlink() {
      clearTimeout(this.blinkTimer);
      if (!this.eligible || this.dismissed || this.reducedMotion.matches) return;
      this.blinkTimer = setTimeout(() => {
        if (this.pose === 'sit' || this.pose === 'stand') {
          for (const { layer } of this.layers) layer.classList.add('is-blinking');
          setTimeout(() => {
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
      if (!this.eligible) return;
      const action = this.pickAction();
      this.lastAction = action.name;
      this.currentAction = action.name;
      const anchor = this.chooseAnchor(action.anchor);
      const destination = this.resolveAnchor(anchor);
      const distance = Math.hypot(destination.x - this.point.x, destination.y - this.point.y);
      this.sceneAnchor = anchor;
      const settle = () => {
        if (!this.eligible) return;
        this.anchor = anchor;
        this.point = this.resolveAnchor(anchor);
        this.setPose(action.pose);
        this.setMode(action.mode);
        this.render();
        if (!this.currentAnchorVisible()) {
          this.onGeometryChange();
          return;
        }
        if (action.name === 'bark') this.bark();
        this.scheduleAction(randomBetween(...action.dwell));
      };
      if (distance < 4) { settle(); return; }
      // Keep travel in front; only the brief settled peek/hide uses the rear layer.
      this.setMode('front');
      this.travelTo(anchor, settle);
    }

    travelTo(anchor, onFinish) {
      const target = this.resolveAnchor(anchor);
      const dx = target.x - this.point.x;
      const dy = target.y - this.point.y;
      const distance = Math.hypot(dx, dy);
      const vertical = Math.abs(dy) > Math.abs(dx) * 3;
      const family = vertical ? dy < 0 ? 'rear' : 'front' : 'side';
      const style = family === 'rear'
        ? 'ascend'
        : family === 'front' ? 'descend' : distance > 160 ? 'run' : 'walk';
      this.setPose(family === 'rear' ? 'waddle' : family === 'front'
        ? 'walk-front' : style === 'run' ? 'run-right'
          : dx >= 0 ? 'walk-right' : 'walk-left');
      this.moveTo(anchor, 0, onFinish, { style, family });
    }

    updateGait(movement, now) {
      if (!movement.gait) return;
      const moved = Math.hypot(this.point.x - movement.lastPoint.x,
        this.point.y - movement.lastPoint.y);
      const elapsed = Math.max(now - movement.lastFrame, 1);
      movement.travelled += moved;
      movement.gaitPhase = (movement.travelled / movement.gait.stride) % 1;
      movement.effort = clamp(moved / elapsed * 1000 / movement.gait.speed, 0, 1);
      movement.lastPoint = { ...this.point };
      movement.lastFrame = now;
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
            const family = Math.abs(dy) > Math.abs(dx) * 3
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
        const ratio = movement.profile
          ? profileDistance(movement.profile, movement.elapsed) / distance
          : clamp(movement.elapsed / movement.duration, 0, 1);
        this.point = {
          x: from.x + (target.x - from.x) * ratio,
          y: from.y + (target.y - from.y) * ratio
        };
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

    bark() {
      this.bubble.classList.remove('is-barking');
      void this.bubble.offsetWidth;
      this.bubble.classList.add('is-barking');
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
      if (this.mode === 'peek' && event.clientX < this.dock.getBoundingClientRect().right) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.showContextMenu(event.clientX, event.clientY, () => this.dismiss());
    }

    dismiss() {
      this.dismissed = true;
      this.onEnvironmentChange();
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
