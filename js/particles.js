// Lagrangian view of the same model the field solution solves analytically.
//
// Each particle carries a real grain size, rises through the column to its own
// release height, then falls using the same settling velocity, the same wind
// and the same diffusion as physics.compute(). The random walk's variance grows
// at dV/dt = 2K, which is the derivative of the field's sigma^2, so the cloud
// spreads at the same rate as the analytical answer.
//
// Two display modes, because they answer different questions:
//
//   'steady'    the eruption has been running long enough for the cloud to
//               reach a steady state. Particles are recycled forever and the
//               picture does not change in character over time. This is the one
//               that matches the deposit field, which is itself a steady-state
//               solution.
//
//   'eruption'  a single eruption of a set length, played at a set speed.
//               Particles are released over that window and then nothing more
//               is emitted, so the column dies back, the cloud drifts away and
//               the sky empties. This is a time-domain view of the same
//               physics; it does not feed the deposit field.

import { XW, XE, YS, YN, VENT_Z, P } from './params.js';
import { airRho, vSettle, windAt, plumeTau, axisVar, gauss } from './physics.js';
import { elevAt } from './terrain.js';

export const NP = 1800;
// Mutated in place, never reassigned — see the note on `stats` in physics.js.
export const parts = [];

// Eruption-mode state, also mutated in place.
export const clock = { t: 0, released: 0, active: 0, done: false };

const PHI_MIN = -5, PHI_MAX = 5;

// Rise law, shared by the integrator and the closed-form rise time below so the
// two cannot drift apart: dz/dt = V0 * (A - B * s), where s is the fraction of
// the climb completed, so a particle decelerates towards its release height
// rather than stopping dead.
const RISE_V0 = 9, RISE_A = 1.15, RISE_B = 0.75;

function newPart() {
  let phi = P.phi + P.sig * (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
  phi = Math.max(PHI_MIN, Math.min(PHI_MAX, phi));
  const Htop = VENT_Z + P.H * 1000;
  const rel = VENT_Z + (Htop - VENT_Z) * (1 - Math.pow(Math.random(), 1 / Math.max(P.suz * 0.35, 0.6)));
  return {
    dx: 0, dy: 0, z: VENT_Z, rel, rising: true,
    ang: Math.random() * Math.PI * 2,
    rad: Math.sqrt(Math.random()),
    d: Math.pow(2, -phi) / 1000,
    rp: 1200 + 1200 * ((phi - PHI_MIN) / (PHI_MAX - PHI_MIN)),
    phi
  };
}

/**
 * Seconds to climb from the vent to `rel`, in closed form.
 *
 * Integrating dt = dz / (V0 * (A - B*s)) over the whole climb gives
 * (Z / (V0*B)) * ln(A / (A - B)), with Z the height gained.
 */
function riseTime(rel) {
  const Z = Math.max(rel - VENT_Z, 1);
  return (Z / (RISE_V0 * RISE_B)) * Math.log(RISE_A / (RISE_A - RISE_B));
}

/** Fraction of the climb completed after a fraction `u` of the rise time. */
function riseFrac(u) {
  return (RISE_A / RISE_B) * (1 - Math.pow((RISE_A - RISE_B) / RISE_A, u));
}

/** Column radius grows with height, roughly 13% of the rise. */
function colRadius(p) {
  return (0.13 * (p.z - VENT_Z) + 130) * p.rad;
}

export function partXY(p) {
  if (!p.rising) return [p.dx, p.dy];
  const r = colRadius(p);
  return [p.dx + Math.cos(p.ang) * r, p.dy + Math.sin(p.ang) * r];
}

/** Walk a particle up its rise to fraction `s`, accumulating wind drift. */
function windUpRise(p, s) {
  const Z = p.rel - VENT_Z;
  const STEPS = 12;
  let prev = 0;
  for (let k = 1; k <= STEPS; k++) {
    const su = (s * k) / STEPS;
    const mid = (prev + su) / 2;
    // Slice duration from the same rise law the integrator uses.
    const dt = (Z * (su - prev)) / (RISE_V0 * (RISE_A - RISE_B * mid));
    const w = windAt(VENT_Z + Z * mid);
    const f = mid * mid;                    // the integrator's sp*sp weighting
    p.dx += w.u * dt * f;
    p.dy += w.v * dt * f;
    prev = su;
  }
  p.z = VENT_Z + Z * s;
}

// Scratch trajectory for the seeding walk below, reused across particles so
// re-seeding 1800 of them allocates nothing.
const _tt = [], _tx = [], _ty = [], _tz = [];
let _tn = 0;
const MAX_FALL_STEPS = 4000;

/**
 * Walk a particle's entire fall once, recording the trajectory, and return the
 * time it spends inside the domain.
 *
 * Diffusion is included because for fine ash it is the thing that ends the
 * particle's visible life: at phi 4 the settling velocity is a few tens of cm/s
 * and a 100 m step lasts minutes, so the random walk moves it kilometres per
 * step and carries it out of a 50 km box long before it reaches the ground.
 * Leaving it out made the seeding think fine ash lingers, and a re-seed then
 * emptied a column that the running cloud kept full.
 */
function recordFall(rel, d, rp, ox, oy) {
  let z = rel, acc = 0, dx = ox, dy = oy, k = 0;
  _tt[0] = 0; _tx[0] = dx; _ty[0] = dy; _tz[0] = z;
  while (z > 0 && k < MAX_FALL_STEPS) {
    let vs = vSettle(d, rp, airRho(z));
    if (!(vs > 0.0001)) vs = 0.0001;
    const w = windAt(z);
    const wspd = Math.hypot(w.u, w.v);
    // Step in time, bounding both the drop and the sideways move. Stepping a
    // fixed 100 m of altitude instead looks reasonable until the wind is
    // strong and the particle is slow: at 48 m/s aloft a 100 m drop can take
    // long enough to carry it three to five kilometres sideways, so the walk
    // leaps clean over the edge of a 50 km domain and counts the whole
    // overshoot as time spent inside it.
    let dt = Math.min(100 / vs, 400 / Math.max(wspd, 0.5), 120);
    if (vs * dt > z) dt = z / vs;
    const sw = Math.sqrt(2 * P.K * dt);
    acc += dt;
    dx += w.u * dt + gauss() * sw;
    dy += w.v * dt + gauss() * sw;
    z -= vs * dt;
    k++;
    _tt[k] = acc; _tx[k] = dx; _ty[k] = dy; _tz[k] = Math.max(z, 1);
    const xk = dx / 1000, yk = dy / 1000;
    // Same exit test stepParticles uses.
    if (xk < XW || xk > XE || yk < YS || yk > YN || z <= elevAt(xk, yk)) break;
  }
  _tn = k + 1;
  return acc;
}

/** Put p at time `want` along the trajectory recorded by the last recordFall. */
function sampleFall(p, want) {
  let i = 1;
  while (i < _tn - 1 && _tt[i] < want) i++;
  const t0 = _tt[i - 1], t1 = _tt[i];
  const f = t1 > t0 ? Math.max(0, Math.min(1, (want - t0) / (t1 - t0))) : 0;
  p.dx = _tx[i - 1] + (_tx[i] - _tx[i - 1]) * f;
  p.dy = _ty[i - 1] + (_ty[i] - _ty[i - 1]) * f;
  p.z = Math.max(_tz[i - 1] + (_tz[i] - _tz[i - 1]) * f, 1);
}

/**
 * Place one particle where a steady-state cloud would have it.
 *
 * This is what a slider drag calls, once per particle, many times a second, so
 * it has to land on the same distribution the running cloud is already in.
 * Where it did not, you saw a burst.
 *
 * Two things were wrong before. The split between rising and falling was a flat
 * 90/10, when it has to be the ratio of the time spent in each phase — in a
 * steady state the population of a phase is its residence time times the
 * release rate, and measured against the running cloud the true rising share
 * runs from about a fifth for ash to about half for lapilli, which fall fast
 * enough to still be climbing. More visibly, the particles that were put in the
 * column were given dx = dy = 0, parking all of them within one column radius
 * of the vent axis — under 800 m for a 5 km plume — when the running cloud has
 * them drifted 2 to 4 km downwind. So every re-seed collapsed the column into a
 * bright, tight blob at the vent that then smeared back out over a second or
 * two. That collapse is the flash, and it fired on every slider movement.
 */
function placeSteady(p) {
  const tr = riseTime(p.rel);

  // Where the particle enters its fall. Three pieces, in the order
  // stepParticles applies them: the drift it picked up on the way up, the rim
  // of the column at release, and the spread the plume already had.
  //
  // The climb drift is not a detail. A 12 km column takes half an hour to
  // climb, and in a 48 m/s jet the particle is already a dozen kilometres
  // downwind when it starts to fall — a quarter of the domain. Starting its
  // fall over the vent instead handed it far more room to cross before it left
  // the box, so the seeding thought ash lingered about twice as long as it does
  // and put only half as many particles in the column as the running cloud has.
  const top = { dx: 0, dy: 0, rel: p.rel, z: 0 };
  windUpRise(top, 1);

  const rr = colRadius({ z: p.rel, rad: p.rad });
  const s0 = Math.sqrt(axisVar(0, plumeTau(p.rel - VENT_Z)));
  const ox = top.dx + Math.cos(p.ang) * rr + gauss() * s0;
  const oy = top.dy + Math.sin(p.ang) * rr + gauss() * s0;

  // Fall residence is the time spent *inside the domain*, not the full fall to
  // sea level: stepParticles recycles a particle the moment it lands or crosses
  // an edge, so the truncated time is what sets the steady population. Using
  // the untruncated fall time is what made a re-seed disagree with the cloud it
  // was replacing.
  const tf = recordFall(p.rel, p.d, p.rp, ox, oy);

  if (Math.random() * (tr + tf) < tr) {
    p.rising = true;
    windUpRise(p, riseFrac(Math.random()));   // uniform in time, not in height
    return;
  }
  p.rising = false;
  sampleFall(p, tf * Math.random());
}

/** Re-seed for the current mode. */
export function seedParticles() {
  parts.length = 0;
  clock.t = 0; clock.released = 0; clock.done = false; clock.active = 0;
  if (P.mode === 'eruption') return parts;   // nothing in the sky until t = 0+
  for (let i = 0; i < NP; i++) {
    const p = newPart();
    placeSteady(p);
    parts.push(p);
  }
  clock.active = parts.length;
  return parts;
}

/** Restart an eruption run from t = 0. */
export function replayEruption() {
  parts.length = 0;
  clock.t = 0; clock.released = 0; clock.active = 0; clock.done = false;
  return parts;
}

/**
 * Advance every particle by dt model seconds and write the display buffers.
 * @param {number} dt model seconds
 * @param {Float32Array} pos xyz per particle, km / km(exaggerated) / km
 * @param {Float32Array} col rgb per particle
 * @returns {number} how many slots of pos/col were written
 */
export function stepParticles(dt, pos, col) {
  const erupting = P.mode === 'eruption';

  if (erupting) {
    clock.t += dt;
    // Spread the particle budget evenly over the eruption, then stop emitting.
    const want = Math.min(NP, Math.floor(NP * Math.min(1, clock.t / Math.max(P.dur, 1))));
    while (clock.released < want) { parts.push(newPart()); clock.released++; }
  }

  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (p.rising) {
      const sp = (p.z - VENT_Z) / Math.max(p.rel - VENT_Z, 1);
      p.z += RISE_V0 * (RISE_A - RISE_B * sp) * dt;
      const wr = windAt(p.z);
      p.dx += wr.u * dt * sp * sp;
      p.dy += wr.v * dt * sp * sp;
      if (p.z >= p.rel) {
        p.rising = false;
        const r0 = colRadius(p);
        p.dx += Math.cos(p.ang) * r0;
        p.dy += Math.sin(p.ang) * r0;
        const s0 = Math.sqrt(axisVar(0, plumeTau(p.rel - VENT_Z)));
        p.dx += gauss() * s0; p.dy += gauss() * s0;
      }
    } else {
      const ra = airRho(Math.max(p.z, 0));
      const vs = vSettle(p.d, p.rp, ra);
      const w = windAt(Math.max(p.z, 0));
      p.z -= vs * dt;
      p.dx += w.u * dt;
      p.dy += w.v * dt;
      const sw = Math.sqrt(2 * P.K * dt);
      p.dx += gauss() * sw; p.dy += gauss() * sw;
    }

    let xy = partXY(p);
    let xk = xy[0] / 1000, yk = xy[1] / 1000;
    if (p.z <= elevAt(xk, yk) || xk < XW || xk > XE || yk < YS || yk > YN) {
      // Landed, or blown out of the domain. A steady cloud replaces it at the
      // vent; an eruption run lets the sky empty, which is the whole point of
      // that mode.
      if (erupting) continue;
      p = parts[i] = newPart();
      xy = partXY(p);
      xk = xy[0] / 1000; yk = xy[1] / 1000;
    }

    parts[n] = p;
    const o = n * 3;
    pos[o] = xk;
    pos[o + 1] = (p.z / 1000) * P.ex;
    pos[o + 2] = -yk;                       // scene -Z is north
    const hot = Math.max(0, Math.min(1, (p.z - VENT_Z) / Math.max(P.H * 1000, 1)));
    const dim = p.rising ? 0.55 : 1;        // keep the column from blowing out
    col[o] = 0.92 * dim;
    col[o + 1] = (0.50 + 0.30 * hot) * dim;
    col[o + 2] = (0.28 + 0.44 * hot) * dim;
    n++;
  }

  parts.length = n;
  clock.active = n;
  if (erupting) clock.done = clock.released >= NP && n === 0;
  return n;
}
