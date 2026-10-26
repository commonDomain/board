// Fill each device-pixel tile once. This retains union opacity at intersections
// without the quadratic rasterization cost of one enormous compound path.
export function tiledRects(ctx, color, alpha) {
  const matrix = ctx.getTransform(), tiles = new Map(), side = 128;
  function addShape(corners, circle) {
      const pixels = corners.map(p => ({ x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f }));
      const left = Math.max(0, Math.floor((Math.min(...pixels.map(p => p.x)) - 1) / side));
      const top = Math.max(0, Math.floor((Math.min(...pixels.map(p => p.y)) - 1) / side));
      const right = Math.min(Math.ceil(ctx.canvas.width / side) - 1, Math.floor((Math.max(...pixels.map(p => p.x)) + 1) / side));
      const bottom = Math.min(Math.ceil(ctx.canvas.height / side) - 1, Math.floor((Math.max(...pixels.map(p => p.y)) + 1) / side));
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        const key = row * Math.ceil(ctx.canvas.width / side) + col;
        let tile = tiles.get(key);
        if (!tile) { tile = { col, row, path: new Path2D() }; tiles.set(key, tile); }
        if (circle) { tile.path.moveTo(circle.x + circle.r, circle.y); tile.path.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2); }
        else {
          tile.path.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < corners.length; i++) tile.path.lineTo(corners[i].x, corners[i].y);
          tile.path.closePath();
        }
      }
  }
  return {
    polygon: addShape,
    circle(x, y, r) { addShape([{ x:x-r,y:y-r },{ x:x+r,y:y-r },{ x:x+r,y:y+r },{ x:x-r,y:y+r }], {x,y,r}); },
    add(x, y, width, height, angle) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const corners = [[-width, -height], [width, -height], [width, height], [-width, height]]
        .map(([a, b]) => ({ x: x + a * c - b * s, y: y + a * s + b * c }));
      addShape(corners);
    },
    fill() {
      ctx.fillStyle = color; ctx.globalAlpha = alpha;
      for (const { col, row, path } of tiles.values()) {
        ctx.save(); ctx.resetTransform(); ctx.beginPath();
        ctx.rect(col * side, row * side, side, side); ctx.clip();
        ctx.setTransform(matrix); ctx.fill(path); ctx.restore();
      }
    }
  };
}
