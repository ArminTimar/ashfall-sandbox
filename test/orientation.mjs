// Guards the south-up / north-up boundary, and the multi-resolution deposit.
//
// Deposit fields are south-up. The DEM and the drawn texture are north-up. Get
// that wrong and the deposit renders mirrored against the terrain while every
// numeric readout stays correct. A deposit blown due west looks almost the same
// mirrored, so the bug hides until the wind has a north or south component.
//
// computeField also samples wide Gaussians on coarse lattices and interpolates
// them up to the grid. Section 3 compares that with a brute-force sum of every
// Gaussian at every cell.
//
//   node test/orientation.mjs

import { setGrid, GRID, NH, NPHI } from '../js/params.js';
import { makeField, computeField, sampleField, grainBins, heightBins, fallPath,
         axisVar, plumeTau } from '../js/physics.js';
import { flipToNorthUp } from '../js/grid.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

// A synthetic grid: 200 km square, 500 m cells, vent near the middle.
setGrid({ west: -100000, south: -100000, east: 100000, north: 100000, cell: 500, nx: 400, ny: 400 });
const VENT = { E: 1000, N: -2000, Z: 1000 };
const { nx, ny, cell } = GRID;
const cE = (i) => GRID.west + (i + 0.5) * cell;
const cN = (j) => GRID.south + (j + 0.5) * cell;

// --- 1. flipToNorthUp is its own inverse and actually reverses rows ---------
{
  const w = 3, h = 4;
  const src = Float64Array.from({ length: w * h }, (_, i) => i);
  const once = flipToNorthUp(src, new Float64Array(w * h), w, h);
  const twice = flipToNorthUp(once, new Float64Array(w * h), w, h);
  check(once[0] === src[(h - 1) * w], 'north-up row 0 should be south-up last row');
  check(twice.every((v, i) => v === src[i]), 'flipping twice should be identity');
}

// --- 2. the flipped grid puts mass on the correct side ----------------------
const p = { H: 6, logM: 8.7, phi: 1.8, sig: 1.6, suz: 4, dir: 0,
            spd: 16, top: 34, shear: 0, K: 3000, rho: 1000 };
const f = makeField();
const tex = new Float64Array(nx * ny);

function centroids() {
  flipToNorthUp(f.data, tex, nx, ny);
  let fx = 0, fy = 0, fw = 0, tx = 0, ty = 0, tw = 0;
  for (let r = 0; r < ny; r++) {
    for (let i = 0; i < nx; i++) {
      const a = f.data[r * nx + i];                 // row 0 = south
      if (a > 0) { fw += a; fx += a * cE(i); fy += a * cN(r); }
      const b = tex[r * nx + i];                    // row 0 = north
      if (b > 0) { tw += b; tx += b * cE(i); ty += b * cN(ny - 1 - r); }
    }
  }
  return { f: [fx / fw / 1000, fy / fw / 1000], t: [tx / tw / 1000, ty / tw / 1000] };
}

const CASES = [
  ['ash to N', 180, [0, +1]],
  ['ash to E', 270, [+1, 0]],
  ['ash to S',   0, [0, -1]],
  ['ash to W',  90, [-1, 0]]
];

console.log('             field centroid      texture centroid     delta');
for (const [name, dir, expect] of CASES) {
  p.dir = dir;
  computeField(p, VENT.E, VENT.N, VENT.Z, f);
  const c = centroids();
  const d = Math.hypot(c.t[0] - c.f[0], c.t[1] - c.f[1]);
  const fmt = (a) => `(${a[0].toFixed(1).padStart(6)},${a[1].toFixed(1).padStart(6)})`;
  console.log(`${name.padEnd(10)} ${fmt(c.f)}    ${fmt(c.t)}   ${d.toFixed(3)} km`);
  check(d < 0.01, `${name}: texture centroid must equal field centroid`);
  const along = (c.f[0] - VENT.E / 1000) * expect[0] + (c.f[1] - VENT.N / 1000) * expect[1];
  check(along > 1, `${name}: deposit should lie downwind (got ${along.toFixed(1)} km along)`);
}

// --- 3. multi-resolution splatting matches a brute-force sum -----------------
//
// Fine ash with a strong wind gives sigmas from a few hundred metres to tens
// of kilometres, so every lattice level is used.
{
  const q = { H: 10, logM: 10, phi: 2.5, sig: 2, suz: 4, dir: 250,
              spd: 15, top: 40, shear: 20, K: 4000, rho: 1000 };
  const st = computeField(q, VENT.E, VENT.N, VENT.Z, f);
  const ref = new Float64Array(nx * ny);
  const g = grainBins(q), h = heightBins(q, VENT.Z);
  const M = Math.pow(10, q.logM);
  let refTotal = 0;
  for (let a = 0; a < NH; a++) {
    for (let b = 0; b < NPHI; b++) {
      const m = M * h.w[a] * g.w[b];
      const fp = fallPath(q, h.z[a], g.d[b], g.rho[b]);
      const sg = Math.max(Math.sqrt(axisVar(q, fp.t, plumeTau(q, h.z[a] - VENT.Z))), cell * 0.6);
      const cx = VENT.E + fp.dx, cy = VENT.N + fp.dy;
      const peak = m / (2 * Math.PI * sg * sg), inv = 1 / (2 * sg * sg);
      for (let r = 0; r < ny; r++) {
        const dy = cN(r) - cy;
        if (Math.abs(dy) > 5 * sg) continue;
        for (let i = 0; i < nx; i++) {
          const dx = cE(i) - cx;
          ref[r * nx + i] += peak * Math.exp(-(dx * dx + dy * dy) * inv);
        }
      }
    }
  }
  let refMax = 0, worst = 0, cx1 = 0, cy1 = 0, cx2 = 0, cy2 = 0, w1 = 0, w2 = 0;
  for (let k = 0; k < nx * ny; k++) if (ref[k] > refMax) refMax = ref[k];
  for (let r = 0; r < ny; r++) {
    for (let i = 0; i < nx; i++) {
      const k = r * nx + i, a = f.data[k], b = ref[k];
      refTotal += b;
      w1 += a; cx1 += a * cE(i); cy1 += a * cN(r);
      w2 += b; cx2 += b * cE(i); cy2 += b * cN(r);
      if (b > refMax * 0.01) worst = Math.max(worst, Math.abs(a - b) / b);
    }
  }
  refTotal *= cell * cell;
  const massErr = Math.abs(st.total - refTotal) / refTotal;
  const shift = Math.hypot(cx1 / w1 - cx2 / w2, cy1 / w1 - cy2 / w2);
  const peakErr = Math.abs(st.max - refMax) / refMax;
  console.log(`\n  multi-resolution vs brute force: mass ${(100 * massErr).toFixed(2)}%, `
    + `peak ${(100 * peakErr).toFixed(2)}%, centroid ${shift.toFixed(0)} m, `
    + `worst cell above 1% of peak ${(100 * worst).toFixed(1)}%`);
  check(massErr < 0.01, `mass differs by ${(100 * massErr).toFixed(2)}%`);
  check(peakErr < 0.03, `peak differs by ${(100 * peakErr).toFixed(2)}%`);
  check(shift < 250, `centroid shifted ${shift.toFixed(0)} m`);
  check(worst < 0.08, `a cell above 1% of the peak differs by ${(100 * worst).toFixed(1)}%`);
}

// --- 4. sampleField agrees with the raw array -------------------------------
{
  const i = 230, j = 190;
  const v = sampleField(f, cE(i), cN(j));
  check(Math.abs(v - f.data[j * nx + i]) < 1e-9, 'sampleField should read the cell the compute loop wrote');
}

console.log(fail ? `\n${fail} check(s) failed` : '\nOK - grid orientation consistent, multi-resolution deposit matches brute force');
process.exit(fail ? 1 : 0);
