// Lagrangian view of the same model the field solution solves analytically.
//
// Each particle carries a real grain size and a release height drawn from the
// same Suzuki profile the deposit uses. It rides up the eruption column,
// leaves it gradually around its release height, and then falls with the same
// settling velocity, wind and diffusion as physics.compute().
//
// Leaving the column is continuous. Each particle has a support fraction S
// that starts at 1 in the column and decays to 0 across a detrainment layer
// below its release height:
//
//   vertical velocity    (W(z) + vs) * S - vs
//   horizontal velocity  wind * (1 - S * (1 - bend(z)))
//   turbulent spread     random walk with variance 2K * (1 - S) per second
//
// With S = 1 a particle moves with the column gas (updraft W, part of the
// wind). With S = 0 it settles at vs through the full wind and diffuses, which
// is exactly the fall the analytical deposit assumes. In between it slows,
// arcs over and starts to fall, the way ash leaves the margins of a real
// plume. S only ever decreases, so nothing is caught and lifted again.
//
// Two display modes:
//
//   'steady'    the eruption has been running long enough for the cloud to
//               reach a steady state. Particles are recycled forever. This is
//               the one that matches the deposit field.
//
//   'eruption'  one eruption of a set length, played at a set speed. Particles
//               are released over that window and then emission stops. It does
//               not feed the deposit field.

import { XW, XE, YS, YN, VENT_Z, P } from './params.js';
import { airRho, vSettle, windAt, gauss } from './physics.js';
import { elevAt } from './terrain.js';

// The number of particles scales with erupted mass: 4.5 times as many for
// every tenfold increase, between these limits. The buffers in scene.js are
// sized for the maximum.
export const NP_MIN = 120;
export const NP_MAX = 6000;

export function particleBudget(logM = P.logM) {
  const n = 150 * Math.pow(10, 0.22 * (logM - 5));
  return Math.round(Math.max(NP_MIN, Math.min(NP_MAX, n)));
}

// Mutated in place, never reassigned. See the note on `stats` in physics.js.
export const parts = [];

// Eruption-mode state, also mutated in place.
export const clock = { t: 0, released: 0, active: 0, done: false, budget: 0 };

const PHI_MIN = -5, PHI_MAX = 5;

// ---------------------------------------------------------------------------
// The column
// ---------------------------------------------------------------------------

const col = {
  key: '', top: VENT_Z, W0: 0, kappa: 0, delta: 0, hHeld: 3,
  cdf: new Float64Array(201)
};

/**
 * Column properties that depend only on the parameters, rebuilt when they
 * change.
 *
 * W0 is the updraft speed low in the column. It scales with the square root of
 * plume height: about 34 m/s for a 5 km plume and 50 m/s for 11 km. Those
 * plumes then take roughly 3 and 5 minutes to reach their tops, which is the
 * right order for filmed Sakurajima explosions and for larger eruptions.
 *
 * kappa sets how much of the wind the column gas has picked up by the top. A
 * plume with an updraft much faster than the wind stays nearly upright, and
 * one in a strong wind is bent over (Bonadonna & Phillips, 2003).
 */
function column() {
  const key = `${P.H}|${P.suz}|${P.spd}|${P.top}|${P.dir}|${P.shear}`;
  if (key === col.key) return col;
  col.key = key;
  col.top = VENT_Z + P.H * 1000;
  col.W0 = 15 * Math.sqrt(Math.max(P.H, 0.2));
  const wt = windAt(col.top);
  col.kappa = Math.max(0.25, Math.min(1, 0.25 + 1.2 * Math.hypot(wt.u, wt.v) / col.W0));
  col.delta = Math.max(0.25 * (col.top - VENT_Z), 400);
  // Time step inside the column: short enough to cross the detrainment layer
  // in about four steps at full updraft.
  col.hHeld = Math.max(2, Math.min(12, col.delta / (4 * col.W0)));

  // Cumulative Suzuki profile, (1 - zeta) exp(A (zeta - 1)), the same shape
  // physics.heightBins() uses for the deposit.
  const c = col.cdf, M = c.length - 1;
  c[0] = 0;
  for (let i = 1; i <= M; i++) {
    const zeta = (i - 0.5) / M;
    c[i] = c[i - 1] + (1 - zeta) * Math.exp(P.suz * (zeta - 1));
  }
  for (let i = 1; i <= M; i++) c[i] /= c[M];
  return col;
}

function sampleRelease(C) {
  const u = Math.random(), c = C.cdf, M = c.length - 1;
  let lo = 0, hi = M;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < u) lo = mid; else hi = mid; }
  const f = c[hi] > c[lo] ? (u - c[lo]) / (c[hi] - c[lo]) : 0;
  return VENT_Z + (C.top - VENT_Z) * ((lo + f) / M);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Column updraft at height z, m/s. It slows with height, keeps a fifth of its
 * low-level speed up to the plume top so particles released there still get
 * there, and dies away within a few hundred metres above the top.
 */
function updraft(C, z) {
  const zeta = Math.max((z - VENT_Z) / Math.max(C.top - VENT_Z, 1), 0);
  if (zeta <= 1) return C.W0 * (0.2 + 0.8 * Math.sqrt(1 - zeta));
  return C.W0 * 0.2 * Math.exp(-(zeta - 1) / 0.05);
}

/** Fraction of the wind the column gas has picked up at height z. */
function bend(C, z) {
  const zeta = clamp01((z - VENT_Z) / Math.max(C.top - VENT_Z, 1));
  return Math.min(1, C.kappa * Math.sqrt(zeta));
}

/**
 * Plume radius at height z, m. 0.08 of the height climbed matches the spread
 * the deposit model gives the cloud at release: a per-axis variance of
 * 2K * plumeTau = 0.0064 h^2, whatever K is.
 */
function plumeRadius(z) {
  return 80 + 0.08 * Math.max(z - VENT_Z, 0);
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function newPart(C) {
  let phi = P.phi + P.sig * gauss();
  phi = Math.max(PHI_MIN, Math.min(PHI_MAX, phi));
  const gx = gauss(), gy = gauss();
  return {
    x: 0, y: 0, z: VENT_Z,
    rel: sampleRelease(C),
    S: 1,                     // support by the column: 1 inside it, 0 falling freely
    rs: plumeRadius(VENT_Z),  // widest plume radius reached so far
    top: VENT_Z,              // highest point reached so far
    gx, gy,                   // fixed place in the plume cross-section
    // The updraft is fastest on the axis and slower towards the edge.
    wf: (0.6 + 0.4 * Math.exp(-(gx * gx + gy * gy) / 2)) * (0.9 + 0.2 * Math.random()),
    d: Math.pow(2, -phi) / 1000,
    rp: 1200 + 1200 * ((phi - PHI_MIN) / (PHI_MAX - PHI_MIN)),
    phi,
    rising: true
  };
}

export function partXY(p) {
  return [p.x + p.gx * p.rs, p.y + p.gy * p.rs];
}

/**
 * Advance one particle by a single step of at most hMax seconds and return the
 * step taken. `coarse` allows longer steps, for the seeding walk.
 */
function stepOnce(C, p, hMax, coarse) {
  let vs = vSettle(p.d, p.rp, airRho(Math.max(p.z, 0)));
  if (!(vs > 1e-4)) vs = 1e-4;
  const held = p.S > 0;

  let h;
  if (held) h = Math.min(hMax, coarse ? 2 * C.hHeld : C.hHeld);
  else h = Math.min(hMax, coarse ? 150 : 60, (coarse ? 400 : 250) / vs);

  let vz, carry;
  if (held) {
    vz = (updraft(C, p.z) * p.wf + vs) * p.S - vs;
    carry = 1 - p.S * (1 - bend(C, p.z));
  } else {
    vz = -vs;
    carry = 1;
  }

  // Wind at the middle of the step, as physics.fallPath samples it.
  const w = windAt(Math.max(p.z + (vz * h) / 2, 0));
  p.x += w.u * carry * h;
  p.y += w.v * carry * h;
  const free = 1 - p.S;
  if (free > 0) {
    const sw = Math.sqrt(2 * P.K * h * free);
    p.x += gauss() * sw;
    p.y += gauss() * sw;
  }
  p.z += vz * h;

  if (held) {
    p.rs = Math.max(p.rs, plumeRadius(p.z));
    p.top = Math.max(p.top, p.z);
    // Detrainment: no loss below the layer, rising smoothly to a fast loss at
    // the release height and above it. The rate follows the highest point the
    // particle has reached, so a particle that starts to let go and then sinks
    // below the layer keeps letting go. With the current height instead, it
    // kept part of its support for the rest of its life and drifted for tens
    // of kilometres half-carried by a column it had left.
    const t = clamp01((p.top - (p.rel - C.delta)) / C.delta);
    const k = (t * t * (3 - 2 * t) * 2 * Math.max(updraft(C, p.rel), 0.2 * C.W0)) / C.delta;
    p.S *= Math.exp(-k * h);
    if (p.S < 0.02) p.S = 0;
  }
  p.rising = p.S > 0.5;
  return h;
}

function outside(p) {
  const xy = partXY(p);
  const xk = xy[0] / 1000, yk = xy[1] / 1000;
  return xk < XW || xk > XE || yk < YS || yk > YN || p.z <= elevAt(xk, yk);
}

// Traced lives for seeding, stored end to end in flat buffers that are reused
// between re-seeds.
const TCAP = 400000;
const TT = new Float64Array(TCAP), TX = new Float64Array(TCAP), TY = new Float64Array(TCAP);
const TZ = new Float32Array(TCAP), TS = new Float32Array(TCAP), TRS = new Float32Array(TCAP);
const TTOP = new Float32Array(TCAP);
const MAX_TRACE = 3000;
const POOL = 1500;

/**
 * Walk a copy of a fresh particle through its whole life, from the vent until
 * it lands or leaves the domain, writing it into the buffers from index `at`.
 * Returns the number of points written, or 0 if the buffers are full.
 */
function trace(C, p, at) {
  const q = Object.assign({}, p);
  let t = 0, k = 0;
  const put = (i) => {
    TT[i] = t; TX[i] = q.x; TY[i] = q.y; TZ[i] = q.z; TS[i] = q.S; TRS[i] = q.rs; TTOP[i] = q.top;
  };
  if (at + 2 > TCAP) return 0;
  put(at);
  while (k < MAX_TRACE && at + k + 1 < TCAP) {
    t += stepOnce(C, q, Infinity, true);
    k++;
    put(at + k);
    if (outside(q)) break;
  }
  return k + 1;
}

/**
 * Fill the steady cloud.
 *
 * In a steady state the number of particles at a given stage of life is the
 * release rate times the time spent in that stage. Two things follow. Within
 * one particle's life, the place to put it is at a uniformly random time. And
 * across particles, a long-lived kind (fine ash drifting for an hour) must be
 * picked more often than a short-lived one (a lapillus that lands in minutes),
 * in proportion to its lifetime. Picking every traced particle once, as an
 * earlier version did, over-represents the short lives, which crowds the
 * sky near the column.
 *
 * So a pool of lives is traced, and the cloud is drawn from the pool with
 * probability proportional to lifetime. Tracing is most of the cost of a
 * re-seed, which runs on every slider movement, so the pool stops at 1,500 and
 * large clouds reuse lives. Each reuse gets its own random time along the
 * life and its own place in the plume cross-section.
 */
function fillSteady(C, count) {
  const m = Math.min(count, POOL);
  const start = new Int32Array(m), len = new Int32Array(m), cum = new Float64Array(m);
  const src = [];
  let used = 0, total = 0, got = 0;
  for (let c = 0; c < m; c++) {
    const p = newPart(C);
    const n = trace(C, p, used);
    if (!n) break;
    start[got] = used; len[got] = n; used += n;
    total += TT[start[got] + n - 1];
    cum[got] = total;
    src.push(p);
    got++;
  }
  for (let i = 0; i < count && got; i++) {
    // Pick a life with probability proportional to its length.
    const u = Math.random() * total;
    let lo = 0, hi = got - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    const c = lo, s0 = start[c], n = len[c];
    const T = TT[s0 + n - 1];

    const p = newPart(C);
    const q = src[c];
    p.rel = q.rel; p.d = q.d; p.rp = q.rp; p.phi = q.phi; p.wf = q.wf;
    if (i < got) { p.gx = q.gx; p.gy = q.gy; }

    const want = T * Math.random();
    let j = s0 + 1;
    while (j < s0 + n - 1 && TT[j] < want) j++;
    const t0 = TT[j - 1], t1 = TT[j];
    const f = t1 > t0 ? clamp01((want - t0) / (t1 - t0)) : 0;
    const lerp = (a) => a[j - 1] + (a[j] - a[j - 1]) * f;
    p.x = lerp(TX); p.y = lerp(TY); p.z = Math.max(lerp(TZ), 1);
    p.rs = lerp(TRS);
    p.top = Math.max(TTOP[j - 1], p.z);
    // S jumps to zero at the end of detrainment, so take it from the start of
    // the step instead of interpolating across that jump.
    p.S = TS[j - 1];
    p.rising = p.S > 0.5;
    parts.push(p);
  }
}

/** Re-seed for the current mode. */
export function seedParticles() {
  parts.length = 0;
  clock.t = 0; clock.released = 0; clock.done = false; clock.active = 0;
  const C = column();
  clock.budget = particleBudget();
  if (P.mode === 'eruption') return parts;   // nothing in the sky until t = 0+
  fillSteady(C, clock.budget);
  clock.active = parts.length;
  return parts;
}

/** Restart an eruption run from t = 0. */
export function replayEruption() {
  parts.length = 0;
  clock.t = 0; clock.released = 0; clock.active = 0; clock.done = false;
  clock.budget = particleBudget();
  return parts;
}

/**
 * Advance every particle by dt model seconds and write the display buffers.
 * @param {number} dt model seconds
 * @param {Float32Array} pos xyz per particle, km / km(exaggerated) / km
 * @param {Float32Array} colr rgb per particle
 * @returns {number} how many slots of pos/colr were written
 */
export function stepParticles(dt, pos, colr) {
  const C = column();
  const erupting = P.mode === 'eruption';
  const cap = Math.floor(pos.length / 3);

  if (erupting) {
    clock.t += dt;
    if (!clock.budget) clock.budget = particleBudget();
    // Spread the particle budget evenly over the eruption, then stop emitting.
    const frac = Math.min(1, clock.t / Math.max(P.dur, 1));
    const want = Math.min(clock.budget, Math.floor(clock.budget * frac));
    while (clock.released < want) { parts.push(newPart(C)); clock.released++; }
  }

  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    // Sub-step so a fast playback rate cannot carry a particle straight
    // through its detrainment layer. After 24 steps the rest is taken at once.
    let left = dt;
    for (let s = 0; left > 1e-6 && s < 24; s++) {
      left -= stepOnce(C, p, left, s >= 12);
    }

    if (outside(p)) {
      // Landed, or blown out of the domain. A steady cloud replaces it at the
      // vent. An eruption run lets the sky empty, which is the point of it.
      if (erupting) continue;
      p = parts[i] = newPart(C);
    }
    if (n >= cap) break;

    parts[n] = p;
    const xy = partXY(p);
    const o = n * 3;
    pos[o] = xy[0] / 1000;
    pos[o + 1] = (p.z / 1000) * P.ex;
    pos[o + 2] = -xy[1] / 1000;             // scene -Z is north
    const hot = clamp01((p.z - VENT_Z) / Math.max(P.H * 1000, 1));
    const dim = 1 - 0.45 * p.S;             // keep the dense column from blowing out
    colr[o] = 0.92 * dim;
    colr[o + 1] = (0.50 + 0.30 * hot) * dim;
    colr[o + 2] = (0.28 + 0.44 * hot) * dim;
    n++;
  }

  parts.length = n;
  clock.active = n;
  if (erupting) clock.done = clock.released >= clock.budget && n === 0;
  return n;
}
