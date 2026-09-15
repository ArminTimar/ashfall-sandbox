// Guards the two particle display modes, and above all the property that made
// the old seeding look wrong: a re-seed has to be indistinguishable from the
// cloud it replaces.
//
// Every slider movement re-seeds the steady cloud. If the seeded distribution
// differs from the one the running simulation maintains, that difference shows
// up as a visible jump at the vent on every drag — which is exactly what the
// flat 90/10 rising split and the dx=dy=0 column placement used to produce.
//
// The terrain is all zeros here (js/terrain.js allocates it empty and nothing
// loads a DEM in node), so particles land at sea level. That is fine: the
// question is whether two implementations of the same steady state agree, and
// both see the same flat ground.
//
//   node test/particles.mjs

import { P, VENT_Z } from '../js/params.js';
import { NP, parts, clock, seedParticles, replayEruption, stepParticles, partXY }
  from '../js/particles.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

const pos = new Float32Array(NP * 3);
const col = new Float32Array(NP * 3);

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
  Object.assign(P, BASE, over, { mode: 'steady' });
  seedParticles();
  runToEquilibrium(900, 20);          // 5 model hours
  const run = census();
  seedParticles();
  const sd = census();

  const ratio = sd.risingFrac / Math.max(run.risingFrac, 1e-9);
  console.log(`  ${name.padEnd(12)}${(run.risingFrac * 100).toFixed(1).padStart(8)}%`
    + `${(sd.risingFrac * 100).toFixed(1).padStart(6)}%${ratio.toFixed(2).padStart(8)}`
    + `${Math.round(run.medianRiseRadius).toString().padStart(8)} vs ${Math.round(sd.medianRiseRadius)}`);

  // With 1800 particles the Monte Carlo noise on this ratio is a few per cent.
  // 0.8-1.25 sits clear of that while still catching the two biases this test
  // was written after: a seeding walk that overshot the domain edge, and one
  // that started the fall over the vent instead of where the climb ended. Both
  // landed around 0.71.
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
seedParticles();
check(parts.length === NP, `steady seeding made ${parts.length} particles, expected ${NP}`);
runToEquilibrium(400, 30);
check(parts.length === NP, `steady cloud drifted to ${parts.length} particles, expected ${NP}`);

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
check(releasedAtEnd === NP, `by the end of the eruption ${releasedAtEnd} of ${NP} were released`);
check(peak > NP * 0.2, `only ${peak} particles were ever aloft at once, expected a real column`);

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

console.log(fail ? `\n${fail} FAILED` : '\nOK - particle modes behave, re-seeding matches the running cloud');
process.exit(fail ? 1 : 0);
