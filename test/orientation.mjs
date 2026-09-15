// Guards the south-up / north-up boundary.
//
// physics.field is south-up; the DEM and the drawn texture are north-up. Get
// that wrong and the deposit renders mirrored against the terrain while every
// numeric readout stays correct, which is a genuinely unpleasant bug to find by
// eye - a deposit blown due west looks almost identical mirrored, so it hides
// until the wind has a north-south component.
//
//   node test/orientation.mjs

import { N, XW, XE, YS, YN, KMW, KMH, P } from '../js/params.js';
import { field, compute, sampleAt } from '../js/physics.js';
import { flipToNorthUp } from '../js/grid.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

// --- 1. flipToNorthUp is its own inverse and actually reverses rows ---------
{
  const n = 4;
  const src = Float64Array.from({ length: n * n }, (_, i) => i);
  const once = flipToNorthUp(src, new Float64Array(n * n), n);
  const twice = flipToNorthUp(once, new Float64Array(n * n), n);
  check(once[0] === src[(n - 1) * n], 'north-up row 0 should be south-up last row');
  check(twice.every((v, i) => v === src[i]), 'flipping twice should be identity');
}

// --- 2. the flipped grid puts mass on the correct side ----------------------
// Drive the wind to each cardinal direction and confirm the centroid of the
// drawn (north-up) copy lands in the same place as the physics (south-up) one.
const tex = new Float64Array(N * N);

function centroids() {
  flipToNorthUp(field, tex, N);
  let fx = 0, fy = 0, fw = 0, tx = 0, ty = 0, tw = 0;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const x = XW + ((gx + 0.5) / N) * KMW;
      const a = field[gy * N + gx];                 // row 0 = south
      if (a > 0) { fw += a; fx += a * x; fy += a * (YS + ((gy + 0.5) / N) * KMH); }
      const b = tex[gy * N + gx];                   // row 0 = north
      if (b > 0) { tw += b; tx += b * x; ty += b * (YN - ((gy + 0.5) / N) * KMH); }
    }
  }
  return { f: [fx / fw, fy / fw], t: [tx / tw, ty / tw] };
}

Object.assign(P, { H: 6, logM: 8.7, phi: 1.8, sig: 1.6, suz: 4,
                   spd: 16, top: 34, shear: 0, K: 3000, rho: 1000 });

const CASES = [
  ['ash to N', 180, [0, +1]],
  ['ash to E', 270, [+1, 0]],
  ['ash to S',   0, [0, -1]],
  ['ash to W',  90, [-1, 0]]
];

console.log('             field centroid      texture centroid     delta');
for (const [name, dir, expect] of CASES) {
  P.dir = dir;
  compute();
  const c = centroids();
  const d = Math.hypot(c.t[0] - c.f[0], c.t[1] - c.f[1]);
  const fmt = (a) => `(${a[0].toFixed(1).padStart(6)},${a[1].toFixed(1).padStart(6)})`;
  console.log(`${name.padEnd(10)} ${fmt(c.f)}    ${fmt(c.t)}   ${d.toFixed(3)} km`);
  check(d < 0.01, `${name}: texture centroid must equal field centroid`);
  // and the deposit must actually be downwind, not upwind
  const along = c.f[0] * expect[0] + c.f[1] * expect[1];
  check(along > 1, `${name}: deposit should lie downwind (got ${along.toFixed(1)} km along)`);
}

// --- 3. sampleAt agrees with the raw array ---------------------------------
{
  P.dir = 270; compute();
  const gx = 200, gy = 140;
  const x = XW + ((gx + 0.5) / N) * KMW;
  const y = YS + ((gy + 0.5) / N) * KMH;
  check(Math.abs(sampleAt(x, y) - field[gy * N + gx]) < 1e-9,
    'sampleAt should read the same cell the compute loop wrote');
}

console.log(fail ? `\n${fail} check(s) failed` : '\nOK - grid orientation consistent');
process.exit(fail ? 1 : 0);
