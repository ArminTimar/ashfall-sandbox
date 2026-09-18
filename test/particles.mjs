// Guards the particle clouds:
//
//   a re-seed matches the cloud it replaces. Every slider movement re-seeds the
//   steady cloud, so any difference shows up as a jump on every drag.
//
//   particles leave the column smoothly. Vertical velocity changes gradually
//   from the updraft to settling, with no step from one to the other.
//
//   the cloud lands where the analytical deposit is.
//
//   two volcanoes' clouds stay independent.
//
// The terrain is flat sea-level ground on a synthetic 300 km grid, so the
// question is only whether implementations of the same physics agree.
//
//   node test/particles.mjs

import { P, GRID, NPHI } from '../js/params.js';
import { setDEM } from '../js/terrain.js';
import { NP_MAX, NP_TOTAL, makeCloud, seedCloud, replayCloud, stepCloud, partXY,
         particleBudget } from '../js/particles.js';
import { makeField, computeField, grainBins } from '../js/physics.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

const META = { west: -150000, south: -150000, east: 150000, north: 150000, cell: 500, nx: 600, ny: 600 };
setDEM(META, new Uint8Array(META.nx * META.ny * 3));

const pos = new Float32Array(NP_TOTAL * 3);
const col = new Float32Array(NP_TOTAL * 3);
const tint = () => {};
const VENT = [2000, -3000, 1000];

const BASE = { H: 5, logM: 8.3, phi: 2.0, sig: 1.5, suz: 4,
               dir: 100, spd: 12, top: 24, shear: -15, K: 2500, rho: 1000, dur: 1800 };

function census(cloud) {
  const parts = cloud.parts;
  const rising = parts.filter((q) => q.rising);
  const radii = rising.map((q) => { const xy = partXY(q); return Math.hypot(xy[0], xy[1]); });
  radii.sort((a, b) => a - b);
  return {
    risingFrac: rising.length / Math.max(parts.length, 1),
    medianRiseRadius: radii.length ? radii[Math.floor(radii.length / 2)] : 0
  };
}
const run = (cloud, p, steps, dt) => { for (let i = 0; i < steps; i++) stepCloud(cloud, p, dt, pos, col, 0, tint); };

// --- 1. a re-seed matches the running cloud --------------------------------
//
// The largest cloud (6,000 particles), averaged over ten snapshots of the
// running cloud and three seeds. Only a few per cent of the cloud is rising,
// so a single small snapshot scatters by 30% or more on its own.
console.log('                    running seed   ratio    rise radius (m)');
P.mode = 'steady';
for (const [name, over] of [
  ['default',   {}],
  ['fine ash',  { phi: 4 }],
  ['lapilli',   { phi: -1 }],
  ['tall windy', { H: 12, phi: 1.8, spd: 20, top: 48 }]
]) {
  const p = Object.assign({}, BASE, over, { logM: 13 });
  const cloud = makeCloud(...VENT);
  const mean = (list) => ({
    risingFrac: list.reduce((a, c) => a + c.risingFrac, 0) / list.length,
    medianRiseRadius: list.reduce((a, c) => a + c.medianRiseRadius, 0) / list.length
  });
  seedCloud(cloud, p);
  run(cloud, p, 900, 20);
  const snaps = [];
  for (let k = 0; k < 10; k++) { run(cloud, p, 30, 20); snaps.push(census(cloud)); }
  const r = mean(snaps);
  const seeds = [];
  for (let k = 0; k < 3; k++) { seedCloud(cloud, p); seeds.push(census(cloud)); }
  const sd = mean(seeds);

  const ratio = sd.risingFrac / Math.max(r.risingFrac, 1e-9);
  console.log(`  ${name.padEnd(12)}${(r.risingFrac * 100).toFixed(1).padStart(8)}%`
    + `${(sd.risingFrac * 100).toFixed(1).padStart(6)}%${ratio.toFixed(2).padStart(8)}`
    + `${Math.round(r.medianRiseRadius).toString().padStart(8)} vs ${Math.round(sd.medianRiseRadius)}`);
  // Averaged like this the ratio stays within about 10%. 0.8 to 1.25 still
  // catches the biases this test was written after (0.71, and 1.5 for
  // seeding that ignored lifetimes).
  check(ratio > 0.8 && ratio < 1.25, `${name}: seeded rising fraction is ${ratio.toFixed(2)}x the running one`);
  check(sd.medianRiseRadius > r.medianRiseRadius * 0.4,
    `${name}: seeded climbers sit ${Math.round(sd.medianRiseRadius)} m from the axis, `
    + `the running cloud has them at ${Math.round(r.medianRiseRadius)} m`);
}

// --- 2. the steady cloud keeps its population, and it follows the mass ------
{
  const p = Object.assign({}, BASE);
  const NB = particleBudget(p.logM);
  const cloud = makeCloud(...VENT);
  seedCloud(cloud, p);
  check(cloud.parts.length === NB, `steady seeding made ${cloud.parts.length} particles, expected ${NB}`);
  run(cloud, p, 400, 30);
  check(cloud.parts.length === NB, `steady cloud drifted to ${cloud.parts.length} particles, expected ${NB}`);
  const small = particleBudget(6), big = particleBudget(11);
  check(small < NB && NB < big, `particle count should grow with mass: ${small}, ${NB}, ${big}`);
  check(particleBudget(20) === NP_MAX, 'the particle count should stop at its maximum');
  seedCloud(cloud, p, 500);
  check(cloud.parts.length === 500, 'an explicit budget should override the mass-based one');
  console.log(`\n  particle count: ${small} at 10^6 kg, ${NB} at 10^8.3 kg, ${big} at 10^11 kg`);
}

// --- 3. an eruption starts empty, fills, then empties again ----------------
{
  P.mode = 'eruption';
  const p = Object.assign({}, BASE, { dur: 600 });
  const NB = particleBudget(p.logM);
  const cloud = makeCloud(...VENT);
  seedCloud(cloud, p);
  check(cloud.parts.length === 0, 'an eruption should start with nothing in the sky');
  let peak = 0;
  for (let i = 0; i < 40; i++) { run(cloud, p, 1, 15); peak = Math.max(peak, cloud.parts.length); }
  const releasedAtEnd = cloud.clock.released;
  check(releasedAtEnd === NB, `by the end of the eruption ${releasedAtEnd} of ${NB} were released`);
  check(peak > NB * 0.2, `only ${peak} particles were ever aloft at once`);
  for (let i = 0; i < 4000 && cloud.parts.length; i++) run(cloud, p, 1, 30);
  check(cloud.clock.released === releasedAtEnd, 'the eruption kept emitting after it ended');
  check(cloud.parts.length === 0, `${cloud.parts.length} particles never cleared the map`);
  check(cloud.clock.done, 'the run never reported itself finished');
  console.log(`  eruption: peak ${peak} aloft, ${releasedAtEnd} released, `
    + `cleared after ${Math.round(cloud.clock.t / 60)} model minutes`);
  replayCloud(cloud, p);
  check(cloud.parts.length === 0 && cloud.clock.t === 0 && !cloud.clock.done, 'replay did not reset the run');
}

// --- 4. leaving the column is smooth ---------------------------------------
//
// The old scheme climbed at a fixed speed and switched to falling in a single
// step. Followed at 1 s steps, its vertical velocity changed by up to 8.6 m/s
// (fine ash) and 26.8 m/s (lapilli) in one second, and a particle moved up to
// 1.4 km sideways at release.
for (const [name, over] of [['fine ash', { phi: 3.5 }], ['lapilli', { phi: -2, sig: 0.5 }]]) {
  P.mode = 'eruption';
  const p = Object.assign({}, BASE, over, { dur: 60 });
  const cloud = makeCloud(...VENT);
  replayCloud(cloud, p);
  const track = new Map();
  let worst = 0, hop = 0, turned = 0;
  for (let i = 0; i < 1500; i++) {
    run(cloud, p, 1, 1);
    for (const q of cloud.parts) {
      const r = track.get(q);
      const xy = partXY(q);
      if (!r) { track.set(q, { z: q.z, x: xy[0], y: xy[1] }); continue; }
      const vz = q.z - r.z;
      if (r.vz !== undefined) {
        worst = Math.max(worst, Math.abs(vz - r.vz));
        if (r.vz > 0 && vz <= 0) turned++;
      }
      hop = Math.max(hop, Math.hypot(xy[0] - r.x, xy[1] - r.y));
      Object.assign(r, { z: q.z, vz, x: xy[0], y: xy[1] });
    }
  }
  console.log(`  ${name}: ${turned} turned over; in any 1 s vertical velocity changed by at most `
    + `${worst.toFixed(2)} m/s and a particle moved at most ${Math.round(hop)} m sideways`);
  check(turned > 20, `${name}: only ${turned} particles were seen turning over`);
  check(worst < 4, `${name}: vertical velocity jumped by ${worst.toFixed(1)} m/s in one second`);
  check(hop < 700, `${name}: a particle jumped ${Math.round(hop)} m sideways in one second`);
}

// --- 5. the cloud lands where the deposit is -------------------------------
//
// Particles drift a little during the climb, which the analytical deposit
// leaves out. Compare the centre of the deposit with the mean landing point,
// both relative to the vent. They should agree within a kilometre or 15% of
// the distance from the vent.
{
  P.mode = 'eruption';
  const p = Object.assign({}, BASE, { dur: 1, logM: 11, phi: 1, dir: 250, spd: 8, top: 16, shear: 0 });
  const f = makeField();
  computeField(p, VENT[0], VENT[1], VENT[2], f);
  let ax = 0, ay = 0, W = 0;
  for (let j = 0; j < GRID.ny; j++) for (let i = 0; i < GRID.nx; i++) {
    const L = f.data[j * GRID.nx + i];
    ax += L * (GRID.west + (i + 0.5) * GRID.cell - VENT[0]);
    ay += L * (GRID.south + (j + 0.5) * GRID.cell - VENT[1]);
    W += L;
  }
  ax /= W; ay /= W;

  const cloud = makeCloud(...VENT);
  replayCloud(cloud, p);
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const before = cloud.parts.slice();
    run(cloud, p, 1, 10);
    const after = new Set(cloud.parts);
    for (const q of before) {
      if (!after.has(q) && q.z < 50) { const xy = partXY(q); sx += xy[0]; sy += xy[1]; n++; }
    }
    if (cloud.clock.done) break;
  }
  const mx = sx / n, my = sy / n;
  const off = Math.hypot(mx - ax, my - ay), dist = Math.hypot(ax, ay);
  console.log(`\n  landing centre from the vent: particles (${(mx / 1000).toFixed(1)}, ${(my / 1000).toFixed(1)}) km, `
    + `deposit (${(ax / 1000).toFixed(1)}, ${(ay / 1000).toFixed(1)}) km, ${n} landed`);
  check(n > 500, `only ${n} particles landed on the map`);
  check(off < Math.max(1000, 0.15 * dist), `particles land ${(off / 1000).toFixed(1)} km from the deposit centre`);
}

// --- 6. particles carry the deposit's grain sizes --------------------------
//
// The deposit splits its mass over 12 phi bins, a Gaussian truncated at +/-5
// and renormalised. Particles have to be released with the same mix. Clamping
// a Gaussian draw to the range instead of redrawing piles the whole tail onto
// exactly phi 5, the finest and longest-lived size, which then takes over the
// sky: for a distribution centred at phi 3.5 that was 16% of every particle.
{
  P.mode = 'eruption';
  const p = Object.assign({}, BASE, { phi: 3.5, sig: 1.5, dur: 60 });
  const bins = grainBins(p).w;
  const W = 10 / NPHI;
  const counts = new Array(NPHI).fill(0);
  let total = 0;
  for (let rep = 0; rep < 8; rep++) {
    const cloud = makeCloud(...VENT);
    replayCloud(cloud, p, 600);
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      stepCloud(cloud, p, 10, pos, col, 0, tint);
      for (const q of cloud.parts) {
        if (seen.has(q)) continue;
        seen.add(q);
        let k = Math.floor((q.phi + 5) / W);
        if (k < 0) k = 0;
        if (k >= NPHI) k = NPHI - 1;
        counts[k]++; total++;
      }
    }
  }
  let worst = 0, worstBin = 0;
  for (let j = 0; j < NPHI; j++) {
    const got = counts[j] / total, want = bins[j];
    if (Math.abs(got - want) > worst) { worst = Math.abs(got - want); worstBin = -5 + W * (j + 0.5); }
  }
  console.log(`\n  grain sizes at release match the deposit within ${(100 * worst).toFixed(1)} `
    + `points (worst at phi ${worstBin.toFixed(2)}, ${total} particles)`);
  check(worst < 0.03, `the release grain mix is ${(100 * worst).toFixed(1)} points off the deposit at phi ${worstBin.toFixed(2)}`);
  // The finest bin is the one clamping used to inflate.
  const finest = counts[NPHI - 1] / total;
  check(Math.abs(finest - bins[NPHI - 1]) < 0.03,
    `the finest bin holds ${(100 * finest).toFixed(1)}% of particles but ${(100 * bins[NPHI - 1]).toFixed(1)}% of deposit mass`);
}

// --- 7. particles land at the same distances as the deposit ----------------
//
// The deposit is what the isopachs draw, so the cloud has to put the same
// share of its mass at the same distances. This compares the fraction of
// deposit mass beyond a ring with the fraction of particles landing beyond it.
{
  P.mode = 'eruption';
  const p = Object.assign({}, BASE, { dur: 1, logM: 11, H: 9, phi: 1.5, dir: 250, spd: 12, top: 30 });
  const f = makeField();
  const st = computeField(p, VENT[0], VENT[1], VENT[2], f);
  const RINGS = [10, 25, 50];
  const massBeyond = RINGS.map(() => 0);
  let mass = 0;
  const [bi0, bi1, bj0, bj1] = f.bbox;
  for (let j = bj0; j <= bj1; j++) {
    for (let i = bi0; i <= bi1; i++) {
      const L = f.data[j * GRID.nx + i];
      if (L <= 0) continue;
      const E = GRID.west + (i + 0.5) * GRID.cell, N = GRID.south + (j + 0.5) * GRID.cell;
      const r = Math.hypot(E - VENT[0], N - VENT[1]) / 1000;
      mass += L;
      RINGS.forEach((R, k) => { if (r > R) massBeyond[k] += L; });
    }
  }

  const cloud = makeCloud(...VENT);
  replayCloud(cloud, p, 900);
  const dists = [];
  for (let i = 0; i < 6000; i++) {
    const before = cloud.parts.slice();
    stepCloud(cloud, p, 20, pos, col, 0, tint);
    const alive = new Set(cloud.parts);
    for (const q of before) {
      if (alive.has(q)) continue;
      const xy = partXY(q);
      const E = VENT[0] + xy[0], N = VENT[1] + xy[1];
      const onMap = E > GRID.west && E < GRID.east && N > GRID.south && N < GRID.north;
      if (onMap) dists.push(Math.hypot(xy[0], xy[1]) / 1000);
    }
    if (!cloud.parts.length && cloud.clock.released >= cloud.clock.budget) break;
  }
  console.log('\n  beyond    deposit mass   landed particles');
  RINGS.forEach((R, k) => {
    const dep = (100 * massBeyond[k]) / mass;
    const par = (100 * dists.filter((d) => d > R).length) / Math.max(dists.length, 1);
    console.log(`  ${String(R).padStart(4)} km ${dep.toFixed(1).padStart(12)}% ${par.toFixed(1).padStart(15)}%`);
    check(Math.abs(dep - par) < 8,
      `beyond ${R} km the deposit has ${dep.toFixed(1)}% of its mass but ${par.toFixed(1)}% of particles land there`);
  });
  check(dists.length > 400, `only ${dists.length} particles landed on the map`);
}

// --- 8. two volcanoes, two independent clouds ------------------------------
{
  P.mode = 'steady';
  const pa = Object.assign({}, BASE, { dir: 270 });
  const pb = Object.assign({}, BASE, { dir: 90 });
  const a = makeCloud(-60000, 0, 1000), b = makeCloud(60000, 0, 1000);
  seedCloud(a, pa, 400); seedCloud(b, pb, 400);
  let slot = stepCloud(a, pa, 5, pos, col, 0, tint);
  const split = slot;
  slot = stepCloud(b, pb, 5, pos, col, slot, tint);
  check(slot === 800 && split === 400, `two clouds should fill 400 + 400 slots, got ${split} and ${slot}`);
  // Cloud a blows east from x = -60 km, cloud b west from x = +60 km.
  let meanA = 0, meanB = 0;
  for (let k = 0; k < 400; k++) meanA += pos[k * 3];
  for (let k = 400; k < 800; k++) meanB += pos[k * 3];
  meanA /= 400; meanB /= 400;
  // Each cloud is judged against its own vent. How far a seeded cloud has
  // spread downwind varies a lot, so only the direction is checked.
  console.log(`  two clouds: mean x ${meanA.toFixed(1)} km (vent -60) and ${meanB.toFixed(1)} km (vent +60)`);
  check(meanA > -60, `cloud a should drift east of its vent at -60 km, mean x ${meanA.toFixed(1)}`);
  check(meanB < 60, `cloud b should drift west of its vent at +60 km, mean x ${meanB.toFixed(1)}`);
  check(meanA < meanB + 120, 'the two clouds should not be the same particles');
}

console.log(fail ? `\n${fail} FAILED` : '\nOK - particle clouds behave, re-seeding matches the running cloud, the column lets go smoothly');
process.exit(fail ? 1 : 0);
