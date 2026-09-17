// Lagrangian view of the same model the field solution solves analytically.
//
// Every erupting volcano has its own cloud. Each particle carries a real grain
// size and a release height drawn from the same Suzuki profile the deposit
// uses. It rides up the eruption column, leaves it gradually around its
// release height, and then falls with the same settling velocity, wind and
// diffusion as physics.computeField().
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
// arcs over and starts to fall. S only ever decreases.
//
// Two display modes:
//
//   'steady'    the eruption has been running long enough for the cloud to
//               reach a steady state. Particles are recycled forever. This is
//               the one that matches the deposit field.
//
//   'eruption'  one eruption of a set length, played at a set speed. Particles
//               are released over that window and then emission stops.
//
// Particle positions are metres relative to the vent (x east, y north). The
// cloud stores the vent it belongs to.

import { GRID, P } from './params.js';
import { airRho, vSettle, windAt, gauss } from './physics.js';
import { elevAt } from './terrain.js';

// The number of particles scales with erupted mass: 4.5 times as many for
// every tenfold increase, between these limits. The display buffers in
// scene.js hold NP_TOTAL, shared by all erupting volcanoes.
export const NP_MIN = 120;
export const NP_MAX = 6000;
export const NP_TOTAL = 16000;

export function particleBudget(logM) {
  const n = 150 * Math.pow(10, 0.22 * (logM - 5));
  return Math.round(Math.max(NP_MIN, Math.min(NP_MAX, n)));
}

/** A new, empty cloud for a vent. */
export function makeCloud(ventE, ventN, ventZ) {
  return {
    ventE, ventN, ventZ,
    parts: [],
    clock: { t: 0, released: 0, active: 0, done: false, budget: 0 },
    col: { key: '', top: ventZ, W0: 0, kappa: 0, delta: 0, hHeld: 3, cdf: new Float64Array(201) }
  };
}

const PHI_MIN = -5, PHI_MAX = 5;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// The column
// ---------------------------------------------------------------------------

/**
 * Column properties that depend only on the parameters, rebuilt when they
 * change.
 *
 * W0 is the updraft speed low in the column. It scales with the square root of
 * plume height: about 34 m/s for a 5 km plume and 50 m/s for 11 km. Those
 * plumes then take roughly 3 and 5 minutes to reach their tops.
 *
 * kappa sets how much of the wind the column gas has picked up by the top. A
 * plume with an updraft much faster than the wind stays nearly upright, and
 * one in a strong wind is bent over (Bonadonna & Phillips, 2003).
 */
function column(cloud, p) {
  const C = cloud.col, base = cloud.ventZ;
  const key = `${p.H}|${p.suz}|${p.spd}|${p.top}|${p.dir}|${p.shear}|${base}`;
  if (key === C.key) return C;
  C.key = key;
  C.base = base;
  C.top = base + p.H * 1000;
  C.W0 = 15 * Math.sqrt(Math.max(p.H, 0.2));
  const wt = windAt(p, C.top);
  C.kappa = Math.max(0.25, Math.min(1, 0.25 + 1.2 * Math.hypot(wt.u, wt.v) / C.W0));
  C.delta = Math.max(0.25 * (C.top - base), 400);
  // Time step inside the column: short enough to cross the detrainment layer
  // in about four steps at full updraft.
  C.hHeld = Math.max(2, Math.min(12, C.delta / (4 * C.W0)));

  // Cumulative Suzuki profile, (1 - zeta) exp(A (zeta - 1)), the same shape
  // physics.heightBins() uses for the deposit.
  const c = C.cdf, M = c.length - 1;
  c[0] = 0;
  for (let i = 1; i <= M; i++) {
    const zeta = (i - 0.5) / M;
    c[i] = c[i - 1] + (1 - zeta) * Math.exp(p.suz * (zeta - 1));
  }
  for (let i = 1; i <= M; i++) c[i] /= c[M];
  return C;
}

function sampleRelease(C) {
  const u = Math.random(), c = C.cdf, M = c.length - 1;
  let lo = 0, hi = M;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < u) lo = mid; else hi = mid; }
  const f = c[hi] > c[lo] ? (u - c[lo]) / (c[hi] - c[lo]) : 0;
  return C.base + (C.top - C.base) * ((lo + f) / M);
}

/**
 * Column updraft at height z, m/s. It slows with height, keeps a fifth of its
 * low-level speed up to the plume top so particles released there still get
 * there, and dies away within a few hundred metres above the top.
 */
function updraft(C, z) {
  const zeta = Math.max((z - C.base) / Math.max(C.top - C.base, 1), 0);
  if (zeta <= 1) return C.W0 * (0.2 + 0.8 * Math.sqrt(1 - zeta));
  return C.W0 * 0.2 * Math.exp(-(zeta - 1) / 0.05);
}

/** Fraction of the wind the column gas has picked up at height z. */
function bend(C, z) {
  const zeta = clamp01((z - C.base) / Math.max(C.top - C.base, 1));
  return Math.min(1, C.kappa * Math.sqrt(zeta));
}

/**
 * Plume radius at height z, m. 0.08 of the height climbed matches the spread
 * the deposit model gives the cloud at release: a per-axis variance of
 * 2K * plumeTau = 0.0064 h^2, whatever K is.
 */
function plumeRadius(C, z) {
  return 80 + 0.08 * Math.max(z - C.base, 0);
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function newPart(C, p) {
  let phi = p.phi + p.sig * gauss();
  phi = Math.max(PHI_MIN, Math.min(PHI_MAX, phi));
  const gx = gauss(), gy = gauss();
  return {
    x: 0, y: 0, z: C.base,
    rel: sampleRelease(C),
    S: 1,                       // support by the column: 1 inside it, 0 falling freely
    rs: plumeRadius(C, C.base), // widest plume radius reached so far
    top: C.base,                // highest point reached so far
    gx, gy,                     // fixed place in the plume cross-section
    // The updraft is fastest on the axis and slower towards the edge.
    wf: (0.6 + 0.4 * Math.exp(-(gx * gx + gy * gy) / 2)) * (0.9 + 0.2 * Math.random()),
    d: Math.pow(2, -phi) / 1000,
    rp: 1200 + 1200 * ((phi - PHI_MIN) / (PHI_MAX - PHI_MIN)),
    phi,
    rising: true
  };
}

/** Particle position relative to its vent, m. */
export function partXY(q) {
  return [q.x + q.gx * q.rs, q.y + q.gy * q.rs];
}

/**
 * Advance one particle by a single step of at most hMax seconds and return the
 * step taken. `coarse` allows longer steps, for the seeding walk.
 */
function stepOnce(C, p, q, hMax, coarse) {
  let vs = vSettle(q.d, q.rp, airRho(Math.max(q.z, 0)));
  if (!(vs > 1e-4)) vs = 1e-4;
  const held = q.S > 0;

  let h;
  if (held) h = Math.min(hMax, coarse ? 2 * C.hHeld : C.hHeld);
  else h = Math.min(hMax, coarse ? 150 : 60, (coarse ? 400 : 250) / vs);

  let vz, carry;
  if (held) {
    vz = (updraft(C, q.z) * q.wf + vs) * q.S - vs;
    carry = 1 - q.S * (1 - bend(C, q.z));
  } else {
    vz = -vs;
    carry = 1;
  }

  // Wind at the middle of the step, as physics.fallPath samples it.
  const w = windAt(p, Math.max(q.z + (vz * h) / 2, 0));
  q.x += w.u * carry * h;
  q.y += w.v * carry * h;
  const free = 1 - q.S;
  if (free > 0) {
    const sw = Math.sqrt(2 * p.K * h * free);
    q.x += gauss() * sw;
    q.y += gauss() * sw;
  }
  q.z += vz * h;

  if (held) {
    q.rs = Math.max(q.rs, plumeRadius(C, q.z));
    q.top = Math.max(q.top, q.z);
    // Detrainment: no loss below the layer, rising smoothly to a fast loss at
    // the release height and above it. The rate follows the highest point the
    // particle has reached, so a particle that starts to let go and then sinks
    // below the layer keeps letting go.
    const t = clamp01((q.top - (q.rel - C.delta)) / C.delta);
    const k = (t * t * (3 - 2 * t) * 2 * Math.max(updraft(C, q.rel), 0.2 * C.W0)) / C.delta;
    q.S *= Math.exp(-k * h);
    if (q.S < 0.02) q.S = 0;
  }
  q.rising = q.S > 0.5;
  return h;
}

function outside(cloud, q) {
  const xy = partXY(q);
  const E = cloud.ventE + xy[0], N = cloud.ventN + xy[1];
  return E < GRID.west || E > GRID.east || N < GRID.south || N > GRID.north
    || q.z <= elevAt(E, N);
}

// Traced lives for seeding, stored end to end in flat buffers that are reused
// between re-seeds (and between volcanoes, which are seeded one at a time).
const TCAP = 400000;
const TT = new Float64Array(TCAP), TX = new Float64Array(TCAP), TY = new Float64Array(TCAP);
const TZ = new Float32Array(TCAP), TS = new Float32Array(TCAP), TRS = new Float32Array(TCAP);
const TTOP = new Float32Array(TCAP);
const MAX_TRACE = 3000;
const POOL = 800;

/**
 * Walk a copy of a fresh particle through its whole life, from the vent until
 * it lands or leaves the map, writing it into the buffers from index `at`.
 * Returns the number of points written, or 0 if the buffers are full.
 */
function trace(cloud, C, p, q0, at) {
  const q = Object.assign({}, q0);
  let t = 0, k = 0;
  const put = (i) => {
    TT[i] = t; TX[i] = q.x; TY[i] = q.y; TZ[i] = q.z; TS[i] = q.S; TRS[i] = q.rs; TTOP[i] = q.top;
  };
  if (at + 2 > TCAP) return 0;
  put(at);
  while (k < MAX_TRACE && at + k + 1 < TCAP) {
    t += stepOnce(C, p, q, Infinity, true);
    k++;
    put(at + k);
    if (outside(cloud, q)) break;
  }
  return k + 1;
}

/**
 * Fill a steady cloud.
 *
 * In a steady state the number of particles at a given stage of life is the
 * release rate times the time spent in that stage. Within one particle's life,
 * the place to put it is at a uniformly random time. Across particles, a
 * long-lived kind (fine ash drifting for an hour) must be picked more often
 * than a short-lived one (a lapillus that lands in minutes), in proportion to
 * its lifetime.
 *
 * So a pool of lives is traced, and the cloud is drawn from the pool with
 * probability proportional to lifetime. Tracing is most of the cost of a
 * re-seed, which runs on every slider movement, so the pool stops at 800 and
 * large clouds reuse lives, each reuse at its own random time.
 */
function fillSteady(cloud, C, p, count) {
  const m = Math.min(count, POOL);
  const start = new Int32Array(m), len = new Int32Array(m), cum = new Float64Array(m);
  const src = [];
  let used = 0, total = 0, got = 0;
  for (let c = 0; c < m; c++) {
    const q = newPart(C, p);
    const n = trace(cloud, C, p, q, used);
    if (!n) break;
    start[got] = used; len[got] = n; used += n;
    total += TT[start[got] + n - 1];
    cum[got] = total;
    src.push(q);
    got++;
  }
  for (let i = 0; i < count && got; i++) {
    const u = Math.random() * total;
    let lo = 0, hi = got - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    const c = lo, s0 = start[c], n = len[c];
    const T = TT[s0 + n - 1];

    const q = newPart(C, p);
    const o = src[c];
    q.rel = o.rel; q.d = o.d; q.rp = o.rp; q.phi = o.phi; q.wf = o.wf;
    if (i < got) { q.gx = o.gx; q.gy = o.gy; }

    const want = T * Math.random();
    let j = s0 + 1;
    while (j < s0 + n - 1 && TT[j] < want) j++;
    const t0 = TT[j - 1], t1 = TT[j];
    const f = t1 > t0 ? clamp01((want - t0) / (t1 - t0)) : 0;
    const lerp = (a) => a[j - 1] + (a[j] - a[j - 1]) * f;
    q.x = lerp(TX); q.y = lerp(TY); q.z = Math.max(lerp(TZ), 1);
    q.rs = lerp(TRS);
    q.top = Math.max(TTOP[j - 1], q.z);
    // S jumps to zero at the end of detrainment, so take it from the start of
    // the step instead of interpolating across that jump.
    q.S = TS[j - 1];
    q.rising = q.S > 0.5;
    cloud.parts.push(q);
  }
}

/** Re-seed one cloud for the current mode. */
export function seedCloud(cloud, p, budget = particleBudget(p.logM)) {
  const k = cloud.clock;
  cloud.parts.length = 0;
  k.t = 0; k.released = 0; k.done = false; k.active = 0;
  k.budget = budget;
  const C = column(cloud, p);
  if (P.mode === 'eruption') return cloud;   // nothing in the sky until t = 0+
  fillSteady(cloud, C, p, budget);
  k.active = cloud.parts.length;
  return cloud;
}

/** Restart an eruption run from t = 0. */
export function replayCloud(cloud, p, budget = particleBudget(p.logM)) {
  const k = cloud.clock;
  cloud.parts.length = 0;
  k.t = 0; k.released = 0; k.active = 0; k.done = false;
  k.budget = budget;
  return cloud;
}

/**
 * Advance one cloud by dt model seconds and write it into the display buffers
 * from slot `from`.
 * @param {object} cloud from makeCloud
 * @param {object} p eruption parameters (p.dur is the eruption length, s)
 * @param {number} dt model seconds
 * @param {Float32Array} pos xyz per particle in scene km (x east, y up, z south)
 * @param {Float32Array} colr rgb per particle
 * @param {number} from first slot to write
 * @param {function} tint (hot, S, out, o) writes the colour for one particle
 * @returns {number} the next free slot
 */
export function stepCloud(cloud, p, dt, pos, colr, from, tint) {
  const C = column(cloud, p);
  const k = cloud.clock, parts = cloud.parts;
  const erupting = P.mode === 'eruption';
  const cap = Math.floor(pos.length / 3);
  if (!k.budget) k.budget = particleBudget(p.logM);

  if (erupting) {
    k.t += dt;
    // Spread the particle budget evenly over the eruption, then stop emitting.
    const frac = Math.min(1, k.t / Math.max(p.dur, 1));
    const want = Math.min(k.budget, Math.floor(k.budget * frac));
    while (k.released < want) { parts.push(newPart(C, p)); k.released++; }
  }

  let n = 0, slot = from;
  const ex = P.ex, e0 = cloud.ventE, n0 = cloud.ventN;
  for (let i = 0; i < parts.length; i++) {
    let q = parts[i];
    // Sub-step so a fast playback rate cannot carry a particle straight
    // through its detrainment layer. After 24 steps the rest is dropped.
    let left = dt;
    for (let s = 0; left > 1e-6 && s < 24; s++) {
      left -= stepOnce(C, p, q, left, s >= 12);
    }

    if (outside(cloud, q)) {
      // Landed, or blown off the map. A steady cloud replaces it at the vent.
      // An eruption run lets the sky empty, which is the point of it.
      if (erupting) continue;
      q = parts[i] = newPart(C, p);
    }
    parts[n++] = q;
    if (slot >= cap) continue;

    const xy = partXY(q);
    const o = slot * 3;
    pos[o] = (e0 + xy[0]) / 1000;
    pos[o + 1] = (q.z / 1000) * ex;
    pos[o + 2] = -(n0 + xy[1]) / 1000;      // scene z points south
    tint(clamp01((q.z - C.base) / Math.max(p.H * 1000, 1)), q.S, colr, o);
    slot++;
  }

  parts.length = n;
  k.active = n;
  if (erupting) k.done = k.released >= k.budget && n === 0;
  return slot;
}
