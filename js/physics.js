// Tephra advection-diffusion. No DOM here, so the tests import this directly.
//
// Formulation follows Suzuki (1983) as implemented in Tephra2
// (github.com/geoscience-community-codes/tephra2). Ground deposit mass per unit
// area is a sum of 2D Gaussians, one per (release height i, grain size j) pair:
//
//   M(x,y) = SUM_i SUM_j  m_ij / (2 pi s_ij^2)
//            * exp( -[ (x - dx_ij)^2 + (y - dy_ij)^2 ] / (2 s_ij^2) )
//
// Tephra2 writes the same kernel as (M / pi sigma) exp(-r^2 / sigma) with
// sigma = 4K(t + tau), which works out to a per-axis variance of 2K(t + tau).
// We use that convention so a K here means the same thing as a K in a
// published Tephra2 inversion.

import { G, MU, RHO0, HS, NPHI, NH, N, XW, YS, CELLX, CELLY, VENT_Z, P } from './params.js';

/** Air density at altitude z (m), exponential atmosphere. */
export function airRho(z) {
  return RHO0 * Math.exp(-z / HS);
}

/**
 * Terminal settling velocity, three-regime scheme after Bonadonna et al. (1998):
 * Stokes below Re 6, an intermediate law to Re 500, Newton above.
 * @param {number} d  particle diameter, m
 * @param {number} rp particle density, kg/m^3
 * @param {number} ra air density, kg/m^3
 */
export function vSettle(d, rp, ra) {
  const dr = rp - ra;
  const v1 = (G * d * d * dr) / (18 * MU);
  if ((ra * v1 * d) / MU < 6) return v1;
  const v2 = d * Math.cbrt((4 * G * G * dr * dr) / (225 * MU * ra));
  const re2 = (ra * v2 * d) / MU;
  if (re2 >= 6 && re2 < 500) return v2;
  return Math.sqrt((3.1 * G * d * dr) / ra);
}

// The two levels the wind is specified at, in metres above sea level.
export const WIND_LO = 2000;
export const WIND_HI = 12000;

/**
 * Wind at altitude z as east/north components, m/s.
 * Speed interpolates between the 2 km and 12 km values and is held constant
 * outside that range; direction rotates linearly by the shear angle over the
 * same range. P.dir is the direction the wind blows FROM, so travel is that
 * bearing plus 180 degrees.
 *
 * This used to interpolate from sea level (f = z / 12000), so the value the
 * panel labels "speed at 2 km" was really the speed at 0 km, and at 2 km the
 * wind was already a sixth of the way to the upper value.
 */
export function windAt(z) {
  const f = Math.max(0, Math.min((z - WIND_LO) / (WIND_HI - WIND_LO), 1));
  const spd = P.spd + (P.top - P.spd) * f;
  const t = ((P.dir + P.shear * f + 180) * Math.PI) / 180;
  return { u: spd * Math.sin(t), v: spd * Math.cos(t) };
}

/**
 * Integrate a particle down from release height to sea level in 100 m steps,
 * recomputing settling velocity as air density changes and accumulating wind
 * drift. Returns fall time (s) and horizontal drift (m).
 */
export function fallPath(H, d, rp) {
  const dz = 100;
  let t = 0, dx = 0, dy = 0, z = H;
  while (z > 0) {
    const st = Math.min(dz, z);
    const zm = z - st / 2;
    let vs = vSettle(d, rp, airRho(zm));
    if (!(vs > 0.0001)) vs = 0.0001;
    const dt = st / vs;
    const w = windAt(zm);
    t += dt; dx += w.u * dt; dy += w.v * dt; z -= st;
  }
  return { t, dx, dy };
}

/**
 * Mastin et al. (2009): H = 2.00 * Vdot^0.241, H in km above vent, Vdot in
 * m^3/s of dense-rock-equivalent magma. Inverted and multiplied by a DRE
 * density of 2500 kg/m^3 to give mass eruption rate in kg/s.
 */
export function mastinMER(Hkm) {
  return Math.pow(Math.max(Hkm, 0.05) / 2.0, 1 / 0.241) * 2500;
}

/** Time a particle has already spent diffusing inside the rising plume. */
export function plumeTau(htAboveVent) {
  return (0.0032 * htAboveVent * htAboveVent) / P.K;
}

/** Per-axis variance of the horizontal spread after fall time t. */
export function axisVar(t, tau) {
  return 2 * P.K * (t + tau);
}

// Box-Muller, cached pair.
let _g2 = null;
export function gauss() {
  if (_g2 !== null) { const g = _g2; _g2 = null; return g; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; }
  while (s === 0 || s >= 1);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  _g2 = v * m;
  return u * m;
}

/** Grain size bins: Gaussian in phi, truncated at phi 5 (31 um) and renormalised. */
export function grainBins() {
  const pMin = -5, pMax = 5, dphi = (pMax - pMin) / NPHI;
  const w = [], d = [], rho = [];
  let sum = 0;
  for (let j = 0; j < NPHI; j++) {
    const phi = pMin + dphi * (j + 0.5);
    const wj = Math.exp(-Math.pow(phi - P.phi, 2) / (2 * P.sig * P.sig));
    w.push(wj); sum += wj;
    d.push(Math.pow(2, -phi) / 1000);
    rho.push(1200 + 1200 * ((phi - pMin) / (pMax - pMin)));
  }
  return { w: w.map((x) => x / sum), d, rho };
}

/** Release heights with Suzuki mass distribution; peak sits at 1 - 1/A. */
export function heightBins() {
  const Htop = VENT_Z + P.H * 1000;
  const w = [], z = [];
  let sum = 0;
  for (let i = 0; i < NH; i++) {
    const zeta = (i + 0.5) / NH;
    const f = (1 - zeta) * Math.exp(P.suz * (zeta - 1));
    w.push(f); sum += f;
    z.push(VENT_Z + (Htop - VENT_Z) * zeta);
  }
  return { w: w.map((x) => x / sum), z };
}

// Deposit grid, stored SOUTH-UP: row 0 is the southern edge. The DEM and the
// texture are north-up, so anything drawing from this must flip first —
// see js/grid.js.
export const field = new Float64Array(N * N);
// A stable object mutated in place rather than a reassigned `let`, so importers
// keep a valid reference without relying on ES live bindings. That also lets
// tools/bundle.mjs flatten the modules for the single-file build.
export const stats = { total: 0, M: 1, max: 0, a1: 0, mmFac: 1 };

/** Recompute the deposit field and its summary statistics. */
export function compute() {
  field.fill(0);
  const M = Math.pow(10, P.logM);
  const g = grainBins();
  const h = heightBins();
  const sigFloor = Math.max(CELLX, CELLY) * 0.6;
  const x0m = XW * 1000, y0m = YS * 1000;

  for (let i = 0; i < NH; i++) {
    for (let j = 0; j < NPHI; j++) {
      const m = M * h.w[i] * g.w[j];
      if (m <= 0) continue;
      const fp = fallPath(h.z[i], g.d[j], g.rho[j]);
      // Floor sigma at ~0.6 of a cell so coarse near-vent clasts do not alias
      // into single-cell spikes.
      const sg = Math.max(Math.sqrt(axisVar(fp.t, plumeTau(h.z[i] - VENT_Z))), sigFloor);
      const cx = fp.dx, cy = fp.dy;
      const peak = m / (2 * Math.PI * sg * sg);
      const reach = 4 * sg;                       // evaluate only within 4 sigma
      const i0 = Math.max(0, Math.floor((cx - reach - x0m) / CELLX));
      const i1 = Math.min(N - 1, Math.ceil((cx + reach - x0m) / CELLX));
      const j0 = Math.max(0, Math.floor((cy - reach - y0m) / CELLY));
      const j1 = Math.min(N - 1, Math.ceil((cy + reach - y0m) / CELLY));
      if (i1 < i0 || j1 < j0) continue;
      const inv = 1 / (2 * sg * sg);
      for (let gy = j0; gy <= j1; gy++) {
        const yy = y0m + (gy + 0.5) * CELLY - cy;
        const y2 = yy * yy;
        const row = gy * N;
        for (let gx = i0; gx <= i1; gx++) {
          const xx = x0m + (gx + 0.5) * CELLX - cx;
          field[row + gx] += peak * Math.exp(-(xx * xx + y2) * inv);
        }
      }
    }
  }

  let total = 0, max = 0, a1 = 0;
  const cellA = CELLX * CELLY;
  const mmFac = 1000 / P.rho;
  for (let k = 0; k < field.length; k++) {
    const L = field[k];
    total += L * cellA;
    if (L > max) max = L;
    if (L * mmFac > 1) a1 += cellA;
  }
  Object.assign(stats, { total, M, max, a1: a1 / 1e6, mmFac });
  return stats;
}

/** Deposit load (kg/m^2) at a point given in km relative to the vent. */
export function sampleAt(xkm, ykm) {
  const gx = Math.floor(((xkm - XW) * 1000) / CELLX);
  const gy = Math.floor(((ykm - YS) * 1000) / CELLY);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return 0;
  return field[gy * N + gx];
}
