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
//
// Every function takes the eruption's parameters explicitly (an object with
// H, logM, phi, sig, suz, dir, spd, top, shear, K, rho), because each volcano
// on the map has its own eruption and its own wind.

import { G, MU, RHO0, HS, NPHI, NH, GRID } from './params.js';

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
 * outside that range. Direction turns evenly by the shear angle over the same
 * range. p.dir is the direction the wind blows FROM, so travel is that bearing
 * plus 180 degrees.
 */
export function windAt(p, z) {
  const f = Math.max(0, Math.min((z - WIND_LO) / (WIND_HI - WIND_LO), 1));
  const spd = p.spd + (p.top - p.spd) * f;
  const t = ((p.dir + p.shear * f + 180) * Math.PI) / 180;
  return { u: spd * Math.sin(t), v: spd * Math.cos(t) };
}

/**
 * Integrate a particle down from release height to sea level in 100 m steps,
 * recomputing settling velocity as air density changes and accumulating wind
 * drift. Returns fall time (s) and horizontal drift (m).
 */
export function fallPath(p, H, d, rp) {
  const dz = 100;
  let t = 0, dx = 0, dy = 0, z = H;
  while (z > 0) {
    const st = Math.min(dz, z);
    const zm = z - st / 2;
    let vs = vSettle(d, rp, airRho(zm));
    if (!(vs > 0.0001)) vs = 0.0001;
    const dt = st / vs;
    const w = windAt(p, zm);
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
export function plumeTau(p, htAboveVent) {
  return (0.0032 * htAboveVent * htAboveVent) / p.K;
}

/** Per-axis variance of the horizontal spread after fall time t. */
export function axisVar(p, t, tau) {
  return 2 * p.K * (t + tau);
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
export function grainBins(p) {
  const pMin = -5, pMax = 5, dphi = (pMax - pMin) / NPHI;
  const w = [], d = [], rho = [];
  let sum = 0;
  for (let j = 0; j < NPHI; j++) {
    const phi = pMin + dphi * (j + 0.5);
    const wj = Math.exp(-Math.pow(phi - p.phi, 2) / (2 * p.sig * p.sig));
    w.push(wj); sum += wj;
    d.push(Math.pow(2, -phi) / 1000);
    rho.push(1200 + 1200 * ((phi - pMin) / (pMax - pMin)));
  }
  return { w: w.map((x) => x / sum), d, rho };
}

/** Release heights with Suzuki mass distribution. The peak sits at 1 - 1/A. */
export function heightBins(p, ventZ) {
  const Htop = ventZ + p.H * 1000;
  const w = [], z = [];
  let sum = 0;
  for (let i = 0; i < NH; i++) {
    const zeta = (i + 0.5) / NH;
    const f = (1 - zeta) * Math.exp(p.suz * (zeta - 1));
    w.push(f); sum += f;
    z.push(ventZ + (Htop - ventZ) * zeta);
  }
  return { w: w.map((x) => x / sum), z };
}

// ---------------------------------------------------------------------------
// Deposit fields
// ---------------------------------------------------------------------------
//
// Each erupting volcano has a field covering the whole map grid, stored
// SOUTH-UP (row 0 is the southern edge) as kg/m^2 at cell centres. The DEM and
// the texture are north-up, so anything drawing from a field must flip rows.
// See js/grid.js.
//
// A field is only ever non-zero inside its bbox, which is cleared before each
// recompute. Painting and statistics only visit that box.
//
// Spreading a Gaussian with a sigma of tens of kilometres over 200 m cells
// would mean millions of evaluations per kernel. Instead each kernel is
// sampled on a coarser lattice whose spacing is at most a third of its sigma (every
// 2nd, 4th ... 64th cell), and each lattice is interpolated back up to 200 m
// once, after all kernels are in. Sampling a Gaussian at a third of a sigma and
// interpolating linearly is accurate to about 1% at the peak and keeps
// the total mass.

const MAX_STRIDE = 64;
const levels = new Map();   // stride -> { nx, ny, data, bbox }

function level(st) {
  let L = levels.get(st);
  const nx = Math.floor((GRID.nx - 1) / st) + 2;
  const ny = Math.floor((GRID.ny - 1) / st) + 2;
  if (!L || L.nx !== nx || L.ny !== ny) {
    L = { nx, ny, data: new Float32Array(nx * ny), bbox: null };
    levels.set(st, L);
  }
  return L;
}

function grow(b, i0, i1, j0, j1) {
  if (!b) return [i0, i1, j0, j1];
  b[0] = Math.min(b[0], i0); b[1] = Math.max(b[1], i1);
  b[2] = Math.min(b[2], j0); b[3] = Math.max(b[3], j1);
  return b;
}

/** An empty field for the current grid. */
export function makeField() {
  return {
    data: new Float32Array(GRID.nx * GRID.ny),
    bbox: null,                   // [i0, i1, j0, j1] inclusive, south-up rows
    stats: { total: 0, M: 1, max: 0, a1: 0, mmFac: 1 }
  };
}

/** Zero a field inside its bbox. */
export function clearField(f) {
  if (!f.bbox) return;
  const [i0, i1, j0, j1] = f.bbox;
  const nx = GRID.nx;
  for (let j = j0; j <= j1; j++) f.data.fill(0, j * nx + i0, j * nx + i1 + 1);
  f.bbox = null;
}

/**
 * Recompute one eruption's deposit.
 * @param {object} p eruption parameters
 * @param {number} ventE vent easting, m (EPSG:6670)
 * @param {number} ventN vent northing, m
 * @param {number} ventZ vent elevation, m
 * @param {object} f field from makeField(), reused
 */
export function computeField(p, ventE, ventN, ventZ, f) {
  clearField(f);
  const { nx, ny, cell, west, south } = GRID;
  const M = Math.pow(10, p.logM);
  const g = grainBins(p);
  const h = heightBins(p, ventZ);
  const sigFloor = cell * 0.6;
  // Vent in fractional cell-centre index coordinates.
  const vx = (ventE - west) / cell - 0.5;
  const vy = (ventN - south) / cell - 0.5;
  const gxs = new Float64Array(512), gys = new Float64Array(512);
  const used = new Set();

  for (let i = 0; i < NH; i++) {
    for (let j = 0; j < NPHI; j++) {
      const m = M * h.w[i] * g.w[j];
      if (!(m > 0)) continue;
      const fp = fallPath(p, h.z[i], g.d[j], g.rho[j]);
      const sg = Math.max(Math.sqrt(axisVar(p, fp.t, plumeTau(p, h.z[i] - ventZ))), sigFloor);
      let st = 1;
      while (st < MAX_STRIDE && st * 2 * cell <= sg / 3) st *= 2;
      const L = st === 1 ? null : level(st);
      const Lnx = L ? L.nx : nx, Lny = L ? L.ny : ny;
      const cx = vx + fp.dx / cell, cy = vy + fp.dy / cell;
      const reach = (4 * sg) / cell;
      const a0 = Math.max(0, Math.ceil((cx - reach) / st));
      const a1 = Math.min(Lnx - 1, Math.floor((cx + reach) / st));
      const b0 = Math.max(0, Math.ceil((cy - reach) / st));
      const b1 = Math.min(Lny - 1, Math.floor((cy + reach) / st));
      if (a1 < a0 || b1 < b0 || a1 - a0 >= 512 || b1 - b0 >= 512) continue;
      const inv = (cell * cell) / (2 * sg * sg);
      for (let a = a0; a <= a1; a++) { const d = a * st - cx; gxs[a - a0] = Math.exp(-d * d * inv); }
      for (let b = b0; b <= b1; b++) { const d = b * st - cy; gys[b - b0] = Math.exp(-d * d * inv); }
      const peak = m / (2 * Math.PI * sg * sg);
      const arr = L ? L.data : f.data;
      for (let b = b0; b <= b1; b++) {
        const wy = peak * gys[b - b0];
        const row = b * Lnx;
        for (let a = a0; a <= a1; a++) arr[row + a] += wy * gxs[a - a0];
      }
      if (L) { L.bbox = grow(L.bbox, a0, a1, b0, b1); used.add(st); }
      else f.bbox = grow(f.bbox, a0, a1, b0, b1);
    }
  }

  // Interpolate every coarse lattice up to the 200 m grid, then clear it.
  for (const st of used) {
    const L = levels.get(st);
    const [a0, a1, b0, b1] = L.bbox;
    const i0 = a0 * st, i1 = Math.min(nx - 1, a1 * st);
    const j0 = b0 * st, j1 = Math.min(ny - 1, b1 * st);
    for (let jj = j0; jj <= j1; jj++) {
      const b = Math.min(Math.floor(jj / st), L.ny - 2), ty = (jj - b * st) / st;
      const r0 = b * L.nx, r1 = r0 + L.nx, out = jj * nx;
      for (let ii = i0; ii <= i1; ii++) {
        const a = Math.min(Math.floor(ii / st), L.nx - 2), tx = (ii - a * st) / st;
        const top = L.data[r0 + a] + (L.data[r0 + a + 1] - L.data[r0 + a]) * tx;
        const bot = L.data[r1 + a] + (L.data[r1 + a + 1] - L.data[r1 + a]) * tx;
        f.data[out + ii] += top + (bot - top) * ty;
      }
    }
    for (let b = b0; b <= b1; b++) L.data.fill(0, b * L.nx + a0, b * L.nx + a1 + 1);
    L.bbox = null;
    f.bbox = grow(f.bbox, i0, i1, j0, j1);
  }

  let total = 0, max = 0, a1 = 0;
  const cellA = cell * cell;
  const mmFac = 1000 / p.rho;
  if (f.bbox) {
    const [i0, i1, j0, j1] = f.bbox;
    for (let jj = j0; jj <= j1; jj++) {
      const row = jj * nx;
      for (let ii = i0; ii <= i1; ii++) {
        const Lv = f.data[row + ii];
        total += Lv;
        if (Lv > max) max = Lv;
        if (Lv * mmFac > 1) a1++;
      }
    }
  }
  Object.assign(f.stats, { total: total * cellA, M, max, a1: (a1 * cellA) / 1e6, mmFac });
  return f.stats;
}

/** Deposit load (kg/m^2) of one field at a point in metres. */
export function sampleField(f, E, N) {
  if (!f || !f.bbox) return 0;
  const i = Math.floor((E - GRID.west) / GRID.cell);
  const j = Math.floor((N - GRID.south) / GRID.cell);
  const [i0, i1, j0, j1] = f.bbox;
  if (i < i0 || i > i1 || j < j0 || j > j1) return 0;
  return f.data[j * GRID.nx + i];
}
