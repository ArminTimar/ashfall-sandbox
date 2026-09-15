// Grid orientation and contouring. Pure functions, no DOM, so they are testable.
//
// ORIENTATION, the thing that bit us once:
//   physics.field is SOUTH-UP  - row 0 is the southern edge, which is the
//                                natural orientation for the maths.
//   the DEM and the texture are NORTH-UP - canvas row 0 is the northern edge,
//                                which is what the plane's UVs expect.
// Drawing the field without flipping renders the deposit mirrored north-south
// against the terrain while every numeric readout stays correct, which is an
// unpleasant way to be wrong. flipToNorthUp is the only bridge between them.

/**
 * Copy a south-up grid into a north-up one.
 * @param {ArrayLike<number>} src south-up, length n*n
 * @param {Float64Array} dst north-up, length n*n
 * @param {number} n side length
 */
export function flipToNorthUp(src, dst, n) {
  for (let y = 0; y < n; y++) {
    const s = (n - 1 - y) * n;
    const d = y * n;
    for (let x = 0; x < n; x++) dst[d + x] = src[s + x];
  }
  return dst;
}

/** Format a contour level for labelling. */
export function mmLabel(v) {
  if (v >= 100) return String(Math.round(v));
  if (v >= 1) return String(v % 1 === 0 ? v : v.toFixed(1));
  if (v >= 0.01) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Pick up to four contour levels snapped to a 1-3-10 sequence, sized to the
 * data rather than fixed, so a trace dusting and a Plinian deposit both get
 * useful isopachs.
 */
export function niceLevels(maxMM, floor = 0.001) {
  const c = [];
  for (let e = -3; e <= 3; e++) {
    c.push(Math.pow(10, e));
    c.push(3 * Math.pow(10, e));
  }
  const keep = c.filter((v) => v < maxMM * 0.7 && v >= floor).slice(-4);
  return keep.map((v, i) => [v, mmLabel(v) + (i === keep.length - 1 ? ' mm' : '')]);
}

/**
 * Marching squares over a north-up grid. Returns line segments in grid
 * coordinates, ready to stroke straight onto a canvas of the same size.
 * @param {ArrayLike<number>} grid north-up values
 * @param {number} n side length
 * @param {number} level threshold
 * @param {number} scale multiplier applied to grid values before comparing
 */
export function contour(grid, n, level, scale = 1) {
  const segs = [];
  const ip = (p, q, vp, vq) => p + (q - p) * ((level - vp) / (vq - vp));
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const a = grid[y * n + x] * scale;
      const b = grid[y * n + x + 1] * scale;
      const c = grid[(y + 1) * n + x + 1] * scale;
      const d = grid[(y + 1) * n + x] * scale;
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = [ip(x, x + 1, a, b), y];
      const R = [x + 1, ip(y, y + 1, b, c)];
      const B = [ip(x, x + 1, d, c), y + 1];
      const L = [x, ip(y, y + 1, a, d)];
      if (idx === 5) { segs.push([T, R], [L, B]); continue; }
      if (idx === 10) { segs.push([T, L], [B, R]); continue; }
      const m = { 1: [L, B], 2: [B, R], 3: [L, R], 4: [T, R], 6: [T, B], 7: [T, L],
                  8: [T, L], 9: [T, B], 11: [T, R], 12: [L, R], 13: [B, R], 14: [L, B] };
      if (m[idx]) segs.push(m[idx]);
    }
  }
  return segs;
}
