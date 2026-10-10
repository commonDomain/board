"use strict";
(function install(root) {
  const inside = (p, r) => p.x > r.x + 0.01 && p.x < r.x + r.w - 0.01 && p.y > r.y + 0.01 && p.y < r.y + r.h - 0.01;
  function blocked(a, b, obstacles) {
    return obstacles.some((r) => Math.abs(a.x - b.x) < 0.01 ? a.x > r.x + 0.01 && a.x < r.x + r.w - 0.01 && Math.max(a.y, b.y) > r.y + 0.01 && Math.min(a.y, b.y) < r.y + r.h - 0.01 : a.y > r.y + 0.01 && a.y < r.y + r.h - 0.01 && Math.max(a.x, b.x) > r.x + 0.01 && Math.min(a.x, b.x) < r.x + r.w - 0.01);
  }
  function simplify(points) {
    const result = [];
    for (const p of points) {
      const b = result.at(-1), a = result.at(-2);
      if (b && p.x === b.x && p.y === b.y) continue;
      if (a && (a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0 || a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0)) result.pop();
      result.push(p);
    }
    return result;
  }
  class Heap {
    constructor() {
      this.a = [];
    }
    push(v) {
      let i = this.a.length;
      this.a.push(v);
      while (i) {
        const p = i - 1 >> 1;
        if (this.a[p].f < v.f || this.a[p].f === v.f && this.a[p].key <= v.key) break;
        this.a[i] = this.a[p];
        i = p;
      }
      this.a[i] = v;
    }
    pop() {
      const first = this.a[0], last = this.a.pop();
      if (this.a.length) {
        let i = 0;
        while (i * 2 + 1 < this.a.length) {
          let c = i * 2 + 1;
          if (c + 1 < this.a.length && (this.a[c + 1].f < this.a[c].f || this.a[c + 1].f === this.a[c].f && this.a[c + 1].key < this.a[c].key)) c++;
          if (last.f < this.a[c].f || last.f === this.a[c].f && last.key <= this.a[c].key) break;
          this.a[i] = this.a[c];
          i = c;
        }
        this.a[i] = last;
      }
      return first;
    }
  }
  function leg(start, end, obstacles, maxVisits) {
    const fallback = [start, { x: end.x, y: start.y }, end];
    if (start.x === end.x && start.y === end.y) return { points: [start], conflict: false };
    const candidates = [fallback, [start, { x: start.x, y: end.y }, end]];
    for (const p of candidates) if (p.slice(1).every((v, i) => !blocked(p[i], v, obstacles))) return { points: simplify(p), conflict: false };
    const xs = [.../* @__PURE__ */ new Set([start.x, end.x, ...obstacles.flatMap((r) => [r.x, r.x + r.w])])].sort((a, b) => a - b);
    const ys = [.../* @__PURE__ */ new Set([start.y, end.y, ...obstacles.flatMap((r) => [r.y, r.y + r.h])])].sort((a, b) => a - b);
    const sx = xs.indexOf(start.x), sy = ys.indexOf(start.y), ex = xs.indexOf(end.x), ey = ys.indexOf(end.y);
    const keyOf = (x, y, d) => (y * xs.length + x) * 3 + d;
    const heap = new Heap(), best = /* @__PURE__ */ new Map(), records = /* @__PURE__ */ new Map();
    const first = { x: sx, y: sy, d: 0, g: 0, f: 0, key: keyOf(sx, sy, 0), parent: null };
    heap.push(first);
    best.set(first.key, 0);
    records.set(first.key, first);
    let visits = 0;
    while (heap.a.length && visits++ < maxVisits) {
      const current = heap.pop();
      if (current.g !== best.get(current.key)) continue;
      if (current.x === ex && current.y === ey) {
        const points = [];
        let node = current;
        while (node) {
          points.push({ x: xs[node.x], y: ys[node.y] });
          node = node.parent === null ? null : records.get(node.parent);
        }
        return { points: simplify(points.reverse()), conflict: false };
      }
      for (const [dx, dy, d] of [[1, 0, 1], [0, 1, 2], [-1, 0, 1], [0, -1, 2]]) {
        const x = current.x + dx, y = current.y + dy;
        if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
        const a = { x: xs[current.x], y: ys[current.y] }, b = { x: xs[x], y: ys[y] };
        if (obstacles.some((r) => inside(b, r)) || blocked(a, b, obstacles)) continue;
        const g = current.g + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (current.d && current.d !== d ? 24 : 0), key = keyOf(x, y, d);
        if (g >= (best.get(key) ?? Infinity)) continue;
        const next = { x, y, d, g, key, f: g + Math.abs(b.x - end.x) + Math.abs(b.y - end.y), parent: current.key };
        best.set(key, g);
        records.set(key, next);
        heap.push(next);
      }
    }
    return { points: simplify(fallback), conflict: true };
  }
  function roundedPath(points, radius = 10) {
    if (!points.length) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], p = points[i], b = points[i + 1], l1 = Math.hypot(p.x - a.x, p.y - a.y), l2 = Math.hypot(b.x - p.x, b.y - p.y), r = Math.min(radius, l1 / 2, l2 / 2);
      if (!l1 || !l2) continue;
      const u = { x: p.x + (a.x - p.x) * r / l1, y: p.y + (a.y - p.y) * r / l1 }, v = { x: p.x + (b.x - p.x) * r / l2, y: p.y + (b.y - p.y) * r / l2 };
      d += ` L ${u.x} ${u.y} Q ${p.x} ${p.y} ${v.x} ${v.y}`;
    }
    const last = points.at(-1);
    return `${d} L ${last.x} ${last.y}`;
  }
  function route(input) {
    if ((input.startPort || input.endPort) && input.route?.type === "orthogonal") {
      const middle = route({ ...input, start: input.startPort || input.start, end: input.endPort || input.end, startPort: null, endPort: null });
      const points2 = simplify([input.start, ...middle.points, input.end]);
      return { ...middle, points: points2, path: roundedPath(points2) };
    }
    const { start, end } = input, options = input.route || {}, raw = input.obstacles || [];
    const obstacles = options.avoidance === false ? [] : raw.slice().sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0).slice(0, 64).map((r) => ({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 24 })).filter((r) => !inside(start, r) && !inside(end, r));
    const constrained = options.constraints || [];
    if (options.type === "curve") {
      const control = constrained.find((c) => c.kind === "curve"), dx = end.x - start.x, dy = end.y - start.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy), distance = horizontal ? dx : dy;
      const offset = Math.max(48, Math.abs(distance) * 0.45) * (Math.sign(distance) || 1);
      const a = control?.a || (horizontal ? { x: start.x + offset, y: start.y } : { x: start.x, y: start.y + offset });
      const b = control?.b || (horizontal ? { x: end.x - offset, y: end.y } : { x: end.x, y: end.y - offset });
      const points2 = Array.from({ length: 33 }, (_, i) => {
        const t = i / 32, u = 1 - t;
        return { x: u * u * u * start.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * end.x, y: u * u * u * start.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * end.y };
      });
      return { points: points2, control: { a, b }, path: `M ${start.x} ${start.y} C ${a.x} ${a.y} ${b.x} ${b.y} ${end.x} ${end.y}`, conflict: false };
    }
    if (options.type === "straight" && Math.hypot(start.x - end.x, start.y - end.y) > 1) return { points: [start, end], path: roundedPath([start, end], 0), conflict: false };
    let points = [start], conflict = options.avoidance !== false && raw.length > 64;
    const checkpoints = constrained.filter((c) => c.kind !== "curve");
    if (!checkpoints.length && Math.hypot(start.x - end.x, start.y - end.y) < 2) checkpoints.push({ kind: "segment", a: { x: start.x + 64, y: start.y - 64 }, b: { x: start.x - 32, y: start.y - 64 } });
    const limit = Math.max(100, Math.floor(6e3 / (checkpoints.length * 2 + 1)));
    for (const c of checkpoints) {
      const next2 = leg(points.at(-1), c.a, obstacles, limit);
      points.push(...next2.points.slice(1));
      conflict ||= next2.conflict;
      if (c.kind === "segment") {
        points.push(c.b);
        conflict ||= blocked(c.a, c.b, obstacles);
      }
    }
    const next = leg(points.at(-1), end, obstacles, limit);
    points.push(...next.points.slice(1));
    conflict ||= next.conflict;
    points = simplify(points);
    return { points, path: roundedPath(points), conflict: conflict || raw.length > 64 };
  }
  const api = { route, roundedPath, simplify, blocked };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConnectorRouter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
