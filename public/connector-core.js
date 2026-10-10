"use strict";
(function install(root) {
  const VERSION = 1;
  const idPattern = /^[\w.-]{1,128}$/;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Math.max(-1e8, Math.min(1e8, Number(v))) : fallback;
  const point = (p) => ({ x: number(p?.x), y: number(p?.y) });
  const unit = (n) => Math.max(0, Math.min(1, number(n, 0.5)));
  const text = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
  const chars = (s) => Array.from(text(s));
  const safeId = (v) => typeof v === "string" && idPattern.test(v);
  const enumValue = (v, values, fallback) => values.includes(v) ? v : fallback;
  function terminal(input, fallback = {}) {
    input ||= {};
    const binding = input.binding;
    let target = null;
    if (binding && safeId(binding.id) && ["item", "section"].includes(binding.kind)) {
      target = { kind: binding.kind, id: binding.id };
      const c = binding.content;
      if (c && binding.kind === "item") {
        if (c.kind === "mind-node" && safeId(c.nodeId)) target.content = { kind: c.kind, nodeId: c.nodeId };
        if (c.kind === "plan-task" && safeId(c.planId) && safeId(c.taskId)) target.content = { kind: c.kind, planId: c.planId, taskId: c.taskId };
        if (c.kind === "table-cell" && safeId(c.rowId) && safeId(c.columnId)) target.content = { kind: c.kind, rowId: c.rowId, columnId: c.columnId };
        if (c.kind === "text-range" && safeId(c.anchorId)) {
          target.content = {
            kind: c.kind,
            anchorId: c.anchorId,
            start: Math.max(0, Math.trunc(number(c.start))),
            end: Math.max(0, Math.trunc(number(c.end))),
            quote: text(c.quote).slice(0, 1e5),
            prefix: text(c.prefix).slice(-64),
            suffix: text(c.suffix).slice(0, 64),
            version: Math.max(0, Math.trunc(number(c.version)))
          };
          for (const key of ["nodeId", "rowId", "columnId"]) if (safeId(c[key])) target.content[key] = c[key];
        }
      }
    }
    return {
      binding: target,
      anchor: {
        mode: enumValue(input.anchor?.mode, ["auto", "edge", "exact"], "auto"),
        side: enumValue(input.anchor?.side, ["top", "right", "bottom", "left"], "right"),
        u: unit(input.anchor?.u ?? 0.5),
        v: unit(input.anchor?.v ?? 0.5)
      },
      fallback: point(input.fallback || fallback),
      status: enumValue(input.status, ["normal", "orphan"], "normal")
    };
  }
  function normalize(item) {
    const legacy = !item.connectorVersion;
    const routeType = enumValue(item.route?.type, ["smart", "straight", "orthogonal", "curve"], legacy ? "straight" : "smart");
    const result = {
      connectorVersion: VERSION,
      source: terminal(legacy ? { binding: item.startId ? { kind: "item", id: item.startId } : null } : item.source, { x: item.startX, y: item.startY }),
      target: terminal(legacy ? { binding: item.endId ? { kind: "item", id: item.endId } : null } : item.target, { x: item.endX, y: item.endY }),
      route: {
        type: routeType,
        locked: !["smart", "straight"].includes(routeType) && Boolean(item.route?.locked),
        avoidance: item.route?.avoidance !== false,
        startStub: Math.max(0, Math.min(96, number(item.route?.startStub, 16))),
        endStub: Math.max(0, Math.min(96, number(item.route?.endStub, 16))),
        constraints: (Array.isArray(item.route?.constraints) ? item.route.constraints : []).slice(0, 32).filter((c) => safeId(c.id) && (routeType === "curve" ? c.kind === "curve" : routeType === "orthogonal" && c.kind !== "curve")).map((c) => ({
          id: c.id,
          kind: enumValue(c.kind, ["point", "segment", "curve"], "point"),
          a: point(c.a),
          b: point(c.b)
        }))
      },
      style: {
        color: typeof item.style?.color === "string" ? item.style.color.slice(0, 64) : item.stroke || "#475569",
        width: Math.max(0.5, Math.min(16, number(item.style?.width ?? item.strokeWidth, legacy ? 3 : 2))),
        dash: enumValue(item.style?.dash, ["solid", "dash", "dot"], item.dasharray ? "dash" : "solid"),
        start: enumValue(item.style?.start, ["none", "arrow", "open", "dot", "diamond", "square"], item.arrowStart ? "arrow" : "none"),
        end: enumValue(item.style?.end, ["none", "arrow", "open", "dot", "diamond", "square"], item.arrowEnd === false ? "none" : "arrow")
      },
      labels: (Array.isArray(item.labels) ? item.labels : []).slice(0, 12).filter((l) => safeId(l.id)).map((l) => ({ id: l.id, text: text(l.text).slice(0, 500), position: unit(l.position), offset: number(l.offset) })),
      relation: text(item.relation || "关联").slice(0, 200),
      fieldVersions: Object.fromEntries(["source", "target", "route", "style", "labels", "relation"].map((k) => [k, Math.max(0, Math.trunc(number(item.fieldVersions?.[k])))]))
    };
    return result;
  }
  function chooseRouteType(item, ends, context = {}) {
    if (item.route?.type !== "smart") return item.route?.type || "straight";
    const sourceType = ends.source?.owner?.type, targetType = ends.target?.owner?.type;
    const dx = Math.abs(ends.end.x - ends.start.x), dy = Math.abs(ends.end.y - ends.start.y);
    const span = Math.max(dx, dy), ratio = span ? Math.min(dx, dy) / span : 0;
    if (item.source?.binding?.id && item.source.binding.kind === item.target?.binding?.kind && item.source.binding.id === item.target.binding.id) return "curve";
    if (item.source?.binding?.content?.kind === "mind-node" || item.target?.binding?.content?.kind === "mind-node" || sourceType === "mindmap" || targetType === "mindmap") return "curve";
    if (!item.source?.binding || !item.target?.binding) return "straight";
    // A small offset across a long span still reads as a straight connection.
    if (Math.hypot(dx, dy) < 140 || Math.min(dx, dy) <= 18 || ratio <= 0.15 || context.previousType === "straight" && ratio <= 0.19) return "straight";
    if (item.source.binding.content?.kind === "text-range" || item.target.binding.content?.kind === "text-range") return "curve";
    if (sourceType === "table" || targetType === "table" || item.source.binding.kind === "section" || item.target.binding.kind === "section") return "orthogonal";
    const votes = typeof context.relatedTypes === "function" ? context.relatedTypes() : context.relatedTypes || {};
    const winner = ["straight", "curve", "orthogonal"].sort((a, b) => (votes[b] || 0) - (votes[a] || 0))[0];
    if ((votes[winner] || 0) >= 2 && (votes[winner] || 0) >= 2 * Math.max(...["straight", "curve", "orthogonal"].filter((type) => type !== winner).map((type) => votes[type] || 0))) {
      if (winner === "straight" && ratio <= 0.3) return "straight";
      if (winner === "orthogonal" && ratio >= 0.2 && span / Math.min(dx, dy) >= 1.3) return "orthogonal";
      if (winner === "curve") return "curve";
    }
    if (sourceType === "shape" && targetType === "shape" && (dx > dy * 1.8 || dy > dx * 1.8)) return "orthogonal";
    return "curve";
  }
  function pathIntersectsRect(points, rect) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
      let low = 0, high = 1, outside = false;
      for (const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]]) {
        if (Math.abs(p) < 1e-8) {
          if (q < 0) { outside = true; break; }
        } else {
          const t = q / p;
          if (p < 0) low = Math.max(low, t);
          else high = Math.min(high, t);
          if (low > high) { outside = true; break; }
        }
      }
      if (!outside) return true;
    }
    return false;
  }
  function apply(item) {
    Object.assign(item, normalize(item));
    item.startId = item.source.binding?.kind === "item" ? item.source.binding.id : null;
    item.endId = item.target.binding?.kind === "item" ? item.target.binding.id : null;
    item.startX = item.source.fallback.x;
    item.startY = item.source.fallback.y;
    item.endX = item.target.fallback.x;
    item.endY = item.target.fallback.y;
    item.stroke = item.style.color;
    item.strokeWidth = item.style.width;
    item.arrowStart = item.style.start !== "none";
    item.arrowEnd = item.style.end !== "none";
    item.dasharray = item.style.dash === "solid" ? "" : item.style.dash === "dot" ? "2 4" : "6 4";
    return item;
  }
  function ensureTableIds(item) {
    if (item.type !== "table") return item;
    for (const [key, count, prefix] of [["rowIds", item.rows?.length || 1, "r"], ["columnIds", Math.max(1, ...(item.rows || []).map((r) => r.length)), "c"]]) {
      const seen = /* @__PURE__ */ new Set();
      item[key] = Array.from({ length: count }, (_, i) => {
        let id = item[key]?.[i];
        if (!safeId(id) || seen.has(id)) id = `${item.id.slice(0, 100)}_${prefix}_${i}`;
        while (seen.has(id)) id += "_";
        seen.add(id);
        return id;
      });
    }
    return item;
  }
  function findNode(tree, id, parents = []) {
    if (!tree) return null;
    if (tree.id === id) return { node: tree, parents };
    for (const child of tree.children || []) {
      const result = findNode(child, id, [...parents, tree]);
      if (result) return result;
    }
    return null;
  }
  function contentText(item, locator = {}) {
    if (!item) return null;
    if (locator.nodeId) return findNode(item.tree, locator.nodeId)?.node.text ?? null;
    if (locator.rowId) {
      ensureTableIds(item);
      const r = item.rowIds.indexOf(locator.rowId), c = item.columnIds.indexOf(locator.columnId);
      return r < 0 || c < 0 ? null : text(item.rows[r]?.[c]);
    }
    return ["text", "note"].includes(item.type) ? text(item.text) : null;
  }
  function quoteRange(value, start, end, id, version = 0, scope = {}) {
    const a = chars(value);
    return { ...scope, kind: "text-range", anchorId: id, start, end, quote: a.slice(start, end).join(""), prefix: a.slice(Math.max(0, start - 32), start).join(""), suffix: a.slice(end, end + 32).join(""), version };
  }
  function editSpans(before, after) {
    const a = chars(before), b = chars(after);
    let prefix = 0, suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    const x = a.slice(prefix, a.length - suffix), y = b.slice(prefix, b.length - suffix);
    if (!x.length && !y.length) return [];
    if (x.length * y.length > 25e4) return [{ start: prefix, end: a.length - suffix, inserted: y.length }];
    const rows = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i2 = x.length - 1; i2 >= 0; i2--) for (let j2 = y.length - 1; j2 >= 0; j2--) rows[i2][j2] = x[i2] === y[j2] ? rows[i2 + 1][j2 + 1] + 1 : Math.max(rows[i2 + 1][j2], rows[i2][j2 + 1]);
    const edits = [];
    let i = 0, j = 0, span = null;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        if (span) {
          edits.push(span);
          span = null;
        }
        i++;
        j++;
      } else {
        span ||= { start: prefix + i, end: prefix + i, inserted: 0 };
        if (j < y.length && (i === x.length || rows[i][j + 1] > rows[i + 1][j])) {
          j++;
          span.inserted++;
        } else {
          i++;
          span.end++;
        }
      }
    }
    if (span) edits.push(span);
    return edits;
  }
  function mapRange(locator, before, after, version) {
    if (text(before) === text(after)) return { locator: { ...locator, version }, orphan: false };
    let s = locator.start, e = locator.end, shift = 0, remaining = e - s;
    const edits = editSpans(before, after);
    for (const edit of edits) remaining -= Math.max(0, Math.min(e, edit.end) - Math.max(s, edit.start));
    if (remaining <= 0) return { locator, orphan: true };
    for (const edit of edits) {
      const a = edit.start + shift, b = edit.end + shift, delta = edit.inserted - (b - a);
      if (b <= s) {
        s += delta;
        e += delta;
      } else if (a < e) {
        const nextS = s < a ? s : a + edit.inserted;
        const nextE = e > b ? e + delta : a;
        s = nextS;
        e = Math.max(s, nextE);
      }
      shift += delta;
    }
    if (e <= s) return { locator, orphan: true };
    return { locator: quoteRange(after, s, e, locator.anchorId, version, locator), orphan: false };
  }
  function reconcile(connectors, before, after) {
    const changed = [];
    for (const connector of connectors) {
      if (connector.type !== "connector" || !connector.connectorVersion) continue;
      apply(connector);
      let dirty = false;
      for (const key of ["source", "target"]) {
        let endpointChanged = false;
        const t = connector[key];
        if (t.binding?.kind !== "item" || t.binding.id !== before?.id || t.status === "orphan") continue;
        const c = t.binding.content;
        if (!after) {
          t.status = "orphan";
          endpointChanged = true;
        } else if (c?.kind === "text-range") {
          const oldText = contentText(before, c), nextText = contentText(after, c);
          if (oldText !== nextText) {
            const mapped = oldText == null || nextText == null ? { orphan: true, locator: c } : mapRange(c, oldText, nextText, after.contentVersion || 0);
            t.binding.content = mapped.locator;
            if (mapped.orphan) t.status = "orphan";
            endpointChanged = true;
          }
        } else if (c && (c.nodeId && !findNode(after.tree, c.nodeId) || c.rowId && contentText(after, c) == null)) {
          t.status = "orphan";
          endpointChanged = true;
        }
        if (endpointChanged) {
          connector.fieldVersions[key]++;
          dirty = true;
        }
      }
      if (dirty) {
        apply(connector);
        changed.push(connector);
      }
    }
    return changed;
  }
  function rotate(p, rect, inverse = false) {
    const angle = (rect.rotation || 0) * Math.PI / 180 * (inverse ? -1 : 1), cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    return { x: cx + (p.x - cx) * Math.cos(angle) - (p.y - cy) * Math.sin(angle), y: cy + (p.x - cx) * Math.sin(angle) + (p.y - cy) * Math.cos(angle) };
  }
  function anchor(rect, toward, options = {}) {
    const other = rotate(toward, rect, true), cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let p;
    if (options.mode === "exact") p = { x: rect.x + rect.w * options.u, y: rect.y + rect.h * options.v };
    else if (options.mode === "edge") p = { x: rect.x + rect.w * (options.side === "left" ? 0 : options.side === "right" ? 1 : options.u), y: rect.y + rect.h * (options.side === "top" ? 0 : options.side === "bottom" ? 1 : options.v) };
    else {
      const dx = other.x - cx || 1e-6, dy = other.y - cy, hw = Math.max(0.1, rect.w / 2), hh = Math.max(0.1, rect.h / 2);
      const shape = rect.shape || rect.shapeType;
      const scale = ["ellipse", "circle"].includes(shape) ? 1 / Math.sqrt(dx * dx / (hw * hw) + dy * dy / (hh * hh)) : shape === "diamond" ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : Math.min(hw / Math.abs(dx), hh / Math.max(1e-6, Math.abs(dy)));
      p = { x: cx + dx * scale, y: cy + dy * scale };
    }
    return rotate(p, rect);
  }
  function bounds(points, padding = 0) {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
    return { x: x - padding, y: y - padding, w: Math.max(...xs) - x + padding * 2, h: Math.max(...ys) - y + padding * 2 };
  }
  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function pointAt(points, position) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let remaining = lengths.reduce((a, b) => a + b, 0) * unit(position);
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const t = remaining / (lengths[i] || 1);
        return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
      }
      remaining -= lengths[i];
    }
    return points[0];
  }
  function outlineAnchor(rect, toward, outline) {
    const local = rotate(toward, rect, true), origin = { x: rect.w / 2, y: rect.h / 2 }, direction = { x: local.x - rect.x - origin.x, y: local.y - rect.y - origin.y };
    let nearest = Infinity, intersection = null;
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1], b = outline[i], segment = { x: b.x - a.x, y: b.y - a.y }, offset = { x: a.x - origin.x, y: a.y - origin.y };
      const determinant = direction.x * segment.y - direction.y * segment.x;
      if (Math.abs(determinant) < 1e-8) continue;
      const t = (offset.x * segment.y - offset.y * segment.x) / determinant, u = (offset.x * direction.y - offset.y * direction.x) / determinant;
      if (t >= 0 && u >= 0 && u <= 1 && t < nearest) {
        nearest = t;
        intersection = { x: rect.x + origin.x + direction.x * t, y: rect.y + origin.y + direction.y * t };
      }
    }
    return intersection ? rotate(intersection, rect) : anchor(rect, toward);
  }
  const api = { VERSION, clone, point, text, chars, terminal, normalize, chooseRouteType, pathIntersectsRect, apply, ensureTableIds, findNode, contentText, quoteRange, editSpans, mapRange, reconcile, rotate, anchor, outlineAnchor, bounds, distanceToSegment, pointAt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConnectorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
