// Guards the two particle display modes and the properties that make the cloud
// look right:
//
//   a re-seed matches the cloud it replaces. Every slider movement re-seeds the
//   steady cloud, so any difference shows up as a jump on every drag.
//
//   particles leave the column smoothly. Vertical velocity changes gradually
//   from the updraft to settling, with no step from one to the other.
//
//   the cloud lands where the analytical deposit is.
//
// The terrain is all zeros here (js/terrain.js allocates it empty and nothing
// loads a DEM in node), so particles land at sea level. That is fine: the
// question is whether two implementations of the same steady state agree, and
// both see the same flat ground.
//
//   node test/particles.mjs

import { P, VENT_Z, N, XW, YS, CELLX, CELLY } from '../js/params.js';
import { NP_MAX, parts, clock, seedParticles, replayEruption, stepParticles, partXY,
         particleBudget } from '../js/particles.js';
import { compute, field } from '../js/physics.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

const pos = new Float32Array(NP_MAX * 3);
const col = new Float32Array(NP_MAX * 3);

const BASE = { H: 5, logM: 8.3, phi: 2.0, sig: 1.5, suz: 4,
               dir: 100, spd: 12, top: 24, shear: -15, K: 2500, rho: 1000, ex: 4 };

/** Fraction of the cloud still climbing, and how far the climbers have drifted. */
function census() {
  const rising = parts.filter((p) => p.rising);
  const radii = rising.map((p) => { const xy = partXY(p); return Math.hypot(xy[0], xy[1]); });
  radii.sort((a, b) => a - b);
  return {
    n: parts.length,
    risingFrac: rising.length / Math.max(parts.length, 1),
    medianRiseRadius: radii.length ? radii[Math.floor(radii.length / 2)] : 0
  };
}

/** Run the steady scheme forward until its own population stops trending. */
function runToEquilibrium(steps, dt) {
  for (let i = 0; i < steps; i++) stepParticles(dt, pos, col);
}

// --- 1. a re-seed matches the running cloud --------------------------------
console.log('                    running seed   ratio    rise radius (m)');
for (const [name, over] of [
  ['default',   {}],
  ['fine ash',  { phi: 4 }],
  ['lapilli',   { phi: -1 }],
  ['tall windy', { H: 12, phi: 1.8, spd: 20, top: 48 }]
]) {
  // The largest cloud (6,000 particles), with the running cloud averaged over
  // ten snapshots and the seed over three seeds. Only a few per cent of the
  // cloud is rising, so a single snapshot of a few hundred particles counts
  // just tens of climbers and the ratio scatters by 30% or more on its own.
  Object.assign(P, BASE, over, { logM: 13, mode: 'steady' });
  const mean = (list) => ({
    risingFrac: list.reduce((a, c) => a + c.risingFrac, 0) / list.length,
    medianRiseRadius: list.reduce((a, c) => a + c.medianRiseRadius, 0) / list.length
  });
  seedParticles();
  runToEquilibrium(900, 20);          // 5 model hours
  const snaps = [];
  for (let k = 0; k < 10; k++) { runToEquilibrium(30, 20); snaps.push(census()); }
  const run = mean(snaps);
  const seeds = [];
  for (let k = 0; k < 3; k++) { seedParticles(); seeds.push(census()); }
  const sd = mean(seeds);

  const ratio = sd.risingFrac / Math.max(run.risingFrac, 1e-9);
  console.log(`  ${name.padEnd(12)}${(run.risingFrac * 100).toFixed(1).padStart(8)}%`
    + `${(sd.risingFrac * 100).toFixed(1).padStart(6)}%${ratio.toFixed(2).padStart(8)}`
    + `${Math.round(run.medianRiseRadius).toString().padStart(8)} vs ${Math.round(sd.medianRiseRadius)}`);

  // Averaged like this the ratio stays within about 10%. 0.8 to 1.25 sits
  // clear of that and still catches the biases this test was written after,
  // which landed around 0.71, and the unweighted seeding, around 1.5.
  check(ratio > 0.8 && ratio < 1.25,
    `${name}: seeded rising fraction is ${ratio.toFixed(2)}x the running one`);
  // The old bug put every climber on the vent axis. Both numbers should be
  // comparable and neither should collapse to nearly zero.
  check(sd.medianRiseRadius > run.medianRiseRadius * 0.4,
    `${name}: seeded climbers sit ${Math.round(sd.medianRiseRadius)} m from the axis, `
    + `the running cloud has them at ${Math.round(run.medianRiseRadius)} m`);
}

// --- 2. the steady cloud keeps its population ------------------------------
Object.assign(P, BASE, { mode: 'steady' });
const NB = particleBudget();
seedParticles();
check(parts.length === NB, `steady seeding made ${parts.length} particles, expected ${NB}`);
runToEquilibrium(400, 30);
check(parts.length === NB, `steady cloud drifted to ${parts.length} particles, expected ${NB}`);

// --- 2b. the particle count follows the erupted mass -----------------------
const small = particleBudget(6), big = particleBudget(11);
check(small < NB && NB < big, `particle count should grow with mass: ${small}, ${NB}, ${big}`);
check(particleBudget(20) === NP_MAX, 'the particle count should stop at the buffer size');
Object.assign(P, BASE, { logM: 11, mode: 'steady' });
seedParticles();
check(parts.length === big, `a 10^11 kg eruption seeded ${parts.length}, expected ${big}`);
console.log(`\n  particle count: ${small} at 10^6 kg, ${NB} at 10^8.3 kg, ${big} at 10^11 kg`);

// --- 3. an eruption starts empty, fills, then empties again ----------------
Object.assign(P, BASE, { mode: 'eruption', dur: 600 });
seedParticles();
check(parts.length === 0, 'an eruption should start with nothing in the sky');
check(clock.t === 0 && clock.released === 0, 'the run clock should start at zero');

let peak = 0, releasedAtEnd = 0;
for (let i = 0; i < 40; i++) {           // 40 * 15 s = 600 s, the whole eruption
  stepParticles(15, pos, col);
  peak = Math.max(peak, parts.length);
}
releasedAtEnd = clock.released;
check(releasedAtEnd === NB, `by the end of the eruption ${releasedAtEnd} of ${NB} were released`);
check(peak > NB * 0.2, `only ${peak} particles were ever aloft at once, expected a real column`);

const releasedBefore = clock.released;
for (let i = 0; i < 4000 && parts.length; i++) stepParticles(30, pos, col);
check(clock.released === releasedBefore,
  'the eruption kept emitting after it ended');
check(parts.length === 0, `${parts.length} particles never cleared the domain`);
check(clock.done, 'the run never reported itself finished');
console.log(`\n  eruption: peak ${peak} aloft, ${releasedAtEnd} released, `
  + `cleared after ${Math.round(clock.t / 60)} model minutes`);

// --- 4. replay resets the run ----------------------------------------------
replayEruption();
check(parts.length === 0 && clock.t === 0 && clock.released === 0 && !clock.done,
  'replay did not reset the run');

// --- 5. nothing is emitted below the vent ----------------------------------
Object.assign(P, BASE, { mode: 'steady' });
seedParticles();
check(parts.every((p) => p.z >= 0), 'a particle was seeded below sea level');
check(parts.every((p) => p.rel >= VENT_Z && p.rel <= VENT_Z + P.H * 1000 + 1),
  'a particle was given a release height outside the column');

// --- 6. leaving the column is smooth ---------------------------------------
//
// The old scheme climbed at a fixed speed and switched to falling in a single
// step. Followed at 1 s steps, its vertical velocity changed by up to 8.6 m/s
// (fine ash) and 26.8 m/s (lapilli) in one second, and a particle moved up to
// 1.4 km sideways at the moment of release, when the plume spread was added
// all at once. Follow the same eruption and check neither happens now.
for (const [name, over] of [['fine ash', { phi: 3.5 }], ['lapilli', { phi: -2, sig: 0.5 }]]) {
  Object.assign(P, BASE, over, { mode: 'eruption', dur: 60 });
  replayEruption();
  const track = new Map();
  const turns = [];
  let worst = 0, hop = 0;
  for (let i = 0; i < 1500; i++) {
    stepParticles(1, pos, col);
    for (const p of parts) {
      const r = track.get(p);
      const xy = partXY(p);
      if (!r) { track.set(p, { z: p.z, x: xy[0], y: xy[1], vmax: 0, half: -1, done: false }); continue; }
      const vz = p.z - r.z;
      if (r.vz !== undefined) worst = Math.max(worst, Math.abs(vz - r.vz));
      hop = Math.max(hop, Math.hypot(xy[0] - r.x, xy[1] - r.y));
      r.z = p.z; r.vz = vz; r.x = xy[0]; r.y = xy[1];
      if (r.done) continue;
      if (vz > r.vmax) { r.vmax = vz; r.half = -1; }
      if (r.half < 0 && r.vmax > 2 && vz < r.vmax / 2) r.half = i;
      if (r.half >= 0 && vz <= 0) { turns.push(i - r.half); r.done = true; }
    }
  }
  turns.sort((x, y) => x - y);
  const med = turns.length ? turns[turns.length >> 1] : 0;
  const p10 = turns.length ? turns[Math.floor(turns.length * 0.1)] : 0;
  console.log(`  ${name}: ${turns.length} turned over, median turn ${med} s, `
    + `10th percentile ${p10} s`);
  console.log(`    in any 1 s: vertical velocity changed by at most ${worst.toFixed(2)} m/s, `
    + `a particle moved at most ${Math.round(hop)} m sideways`);
  check(turns.length > 20, `${name}: only ${turns.length} particles were seen turning over`);
  check(worst < 4, `${name}: vertical velocity jumped by ${worst.toFixed(1)} m/s in one second`);
  check(hop < 700, `${name}: a particle jumped ${Math.round(hop)} m sideways in one second`);
}

// --- 7. the cloud lands where the deposit is -------------------------------
//
// Particles drift a little during the climb, which the analytical deposit
// leaves out, so this is a loose check. It compares the centre of the deposit
// grid with the mean landing point of the particles, both inside the domain.
// They should agree within a kilometre or 15% of the distance from the vent,
// whichever is larger.
{
  Object.assign(P, BASE, { mode: 'eruption', dur: 1, logM: 11, phi: 1, dir: 250, spd: 8, top: 16 });
  compute();
  let ax = 0, ay = 0, W = 0;
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    const L = field[gy * N + gx];
    ax += L * (XW * 1000 + (gx + 0.5) * CELLX); ay += L * (YS * 1000 + (gy + 0.5) * CELLY); W += L;
  }
  ax /= W; ay /= W;

  replayEruption();
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const before = parts.slice();
    stepParticles(10, pos, col);
    const after = new Set(parts);
    for (const p of before) {
      if (!after.has(p) && p.z < 50) { const xy = partXY(p); sx += xy[0]; sy += xy[1]; n++; }
    }
    if (clock.done) break;
  }
  const mx = sx / n, my = sy / n;
  const off = Math.hypot(mx - ax, my - ay), dist = Math.hypot(ax, ay);
  console.log(`
  landing centre: particles (${(mx / 1000).toFixed(1)}, ${(my / 1000).toFixed(1)}) km, `
    + `deposit (${(ax / 1000).toFixed(1)}, ${(ay / 1000).toFixed(1)}) km, ${n} landed`);
  check(n > 500, `only ${n} particles landed inside the domain`);
  check(off < Math.max(1000, 0.15 * dist),
    `particles land ${(off / 1000).toFixed(1)} km from the deposit centre`);
}

console.log(fail ? `\n${fail} FAILED` : '\nOK - particle modes behave, re-seeding matches the running cloud, the column lets go smoothly');
process.exit(fail ? 1 : 0);
