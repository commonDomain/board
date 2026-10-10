'use strict';

(function installSpatialIndex(global) {
  const DEFAULT_LEVELS = [512, 4096, 32768, 262144, 2097152];
  const MAX_CELLS_PER_ENTRY = 64;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function toAabb(rect) {
    const x = finite(rect?.x);
    const y = finite(rect?.y);
    const w = Math.max(0, finite(rect?.w));
    const h = Math.max(0, finite(rect?.h));
    const rotation = finite(rect?.rotation);
    if (!rotation || !w || !h) return { x, y, w, h };
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const rotatedWidth = w * cos + h * sin;
    const rotatedHeight = w * sin + h * cos;
    return {
      x: x + (w - rotatedWidth) / 2,
      y: y + (h - rotatedHeight) / 2,
      w: rotatedWidth,
      h: rotatedHeight
    };
  }

  function intersects(left, right) {
    return (
      left.x <= right.x + right.w &&
      left.x + left.w >= right.x &&
      left.y <= right.y + right.h &&
      left.y + left.h >= right.y
    );
  }

  class SpatialIndex {
    constructor(cellSize = 512) {
      this.levels = Array.from(new Set([cellSize, ...DEFAULT_LEVELS]))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right);
      this.levelCells = this.levels.map(() => new Map());
      this.entries = new Map();
      this.overflow = new Set();
      this.cells = this.levelCells[0];
    }

    clear() {
      for (const cells of this.levelCells) cells.clear();
      this.entries.clear();
      this.overflow.clear();
    }

    cellRange(rect, cellSize) {
      const minX = Math.floor(rect.x / cellSize);
      const maxX = Math.floor((rect.x + Math.max(0, rect.w)) / cellSize);
      const minY = Math.floor(rect.y / cellSize);
      const maxY = Math.floor((rect.y + Math.max(0, rect.h)) / cellSize);
      return { minX, maxX, minY, maxY, count: (maxX - minX + 1) * (maxY - minY + 1) };
    }

    keysFor(rect, cellSize = this.levels[0]) {
      const range = this.cellRange(rect, cellSize);
      const keys = [];
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) keys.push(`${x}:${y}`);
      }
      return keys;
    }

    chooseLevel(rect) {
      for (let index = 0; index < this.levels.length; index += 1) {
        if (this.cellRange(rect, this.levels[index]).count <= MAX_CELLS_PER_ENTRY) return index;
      }
      return -1;
    }

    upsert(id, rect, value = null) {
      this.remove(id);
      const bounds = toAabb(rect);
      const entry = { id, ...bounds, value, level: this.chooseLevel(bounds), keys: [] };
      this.entries.set(id, entry);
      if (entry.level < 0) {
        this.overflow.add(id);
        return;
      }
      entry.keys = this.keysFor(entry, this.levels[entry.level]);
      const cells = this.levelCells[entry.level];
      for (const key of entry.keys) {
        if (!cells.has(key)) cells.set(key, new Set());
        cells.get(key).add(id);
      }
    }

    remove(id) {
      const entry = this.entries.get(id);
      if (!entry) return;
      if (entry.level < 0) {
        this.overflow.delete(id);
      } else {
        const cells = this.levelCells[entry.level];
        for (const key of entry.keys) {
          const bucket = cells.get(key);
          bucket?.delete(id);
          if (bucket && !bucket.size) cells.delete(key);
        }
      }
      this.entries.delete(id);
    }

    rebuild(entries) {
      this.clear();
      for (const entry of entries) this.upsert(entry.id, entry, entry.value);
    }

    search(rect) {
      const query = toAabb(rect);
      const ids = new Set(this.overflow);
      for (let level = 0; level < this.levels.length; level += 1) {
        const cells = this.levelCells[level];
        for (const key of this.keysFor(query, this.levels[level])) {
          for (const id of cells.get(key) || []) ids.add(id);
        }
      }
      const results = [];
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (entry && intersects(entry, query)) results.push(entry.value || entry);
      }
      return results;
    }

    searchPoint(point, radius = 0) {
      const safeRadius = Math.max(0, finite(radius));
      return this.search({
        x: finite(point?.x) - safeRadius,
        y: finite(point?.y) - safeRadius,
        w: safeRadius * 2,
        h: safeRadius * 2
      });
    }
  }

  global.WhiteboardSpatialIndex = SpatialIndex;
})(window);
