// Lagrangian view of the same model the field solution solves analytically.
//
// Each particle carries a real grain size, rises through the column to its own
// release height, then falls using the same settling velocity, the same wind
// and the same diffusion as physics.compute(). The random walk's variance grows
// at dV/dt = 2K, which is the derivative of the field's sigma^2, so the cloud
// spreads at the same rate as the analytical answer.
//
// Particles are re-seeded along their true trajectories whenever a parameter
// changes: the deposit is a steady-state solution and snaps at once, while a
// cloud left alone carries drift from the previous wind for minutes.

import { N, XW, XE, YS, YN, VENT_Z, P } from './params.js';
import { airRho, vSettle, windAt, fallPath, plumeTau, axisVar, gauss } from './physics.js';
import { elevAt } from './terrain.js';

export const NP = 1800;
// Mutated in place, never reassigned — see the note on `stats` in physics.js.
export const parts = [];

const PHI_MIN = -5, PHI_MAX = 5;

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

/** Column radius grows with height, roughly 13% of the rise. */
function colRadius(p) {
  return (0.13 * (p.z - VENT_Z) + 130) * p.rad;
}

export function partXY(p) {
  if (!p.rising) return [p.dx, p.dy];
  const r = colRadius(p);
  return [p.dx + Math.cos(p.ang) * r, p.dy + Math.sin(p.ang) * r];
}

export function seedParticles() {
  parts.length = 0;
  for (let i = 0; i < NP; i++) {
    const p = newPart();
    if (Math.random() < 0.9) {
      // A particle spends far longer falling than rising, so a steady-state
      // cloud is mostly falling particles. Place each at a random point along
      // its own real trajectory rather than all at the vent.
      p.rising = false;
      const want = fallPath(p.rel, p.d, p.rp).t * Math.random();
      let z = p.rel, acc = 0;
      while (z > 0 && acc < want) {
        const st = Math.min(100, z);
        const zm = z - st / 2;
        let vs = vSettle(p.d, p.rp, airRho(zm));
        if (!(vs > 0.0001)) vs = 0.0001;
        const dt = st / vs;
        const w = windAt(zm);
        acc += dt; p.dx += w.u * dt; p.dy += w.v * dt; z -= st;
      }
      const rr = colRadius({ z: p.rel, rad: p.rad });
      p.dx += Math.cos(p.ang) * rr;
      p.dy += Math.sin(p.ang) * rr;
      // Diffusive spread it would have accumulated by this age, in one draw.
      const sd = Math.sqrt(axisVar(acc, plumeTau(p.rel - VENT_Z)));
      p.dx += gauss() * sd; p.dy += gauss() * sd;
      p.z = Math.max(z, 1);
    } else {
      p.z = VENT_Z + Math.random() * (p.rel - VENT_Z);
    }
    parts.push(p);
  }
  return parts;
}

/**
 * Advance every particle by dt model seconds and write display buffers.
 * @param {number} dt model seconds
 * @param {Float32Array} pos xyz per particle, km / km(exaggerated) / km
 * @param {Float32Array} col rgb per particle
 */
export function stepParticles(dt, pos, col) {
  for (let i = 0; i < NP; i++) {
    const p = parts[i];
    if (p.rising) {
      const sp = (p.z - VENT_Z) / Math.max(p.rel - VENT_Z, 1);
      p.z += 9 * (1.15 - 0.75 * sp) * dt;
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

    const xy = partXY(p);
    const xk = xy[0] / 1000, yk = xy[1] / 1000;
    if (p.z <= elevAt(xk, yk) || xk < XW || xk > XE || yk < YS || yk > YN) {
      parts[i] = newPart();
      continue;
    }
    const o = i * 3;
    pos[o] = xk;
    pos[o + 1] = (p.z / 1000) * P.ex;
    pos[o + 2] = -yk;                       // scene -Z is north
    const hot = Math.max(0, Math.min(1, (p.z - VENT_Z) / Math.max(P.H * 1000, 1)));
    const dim = p.rising ? 0.55 : 1;        // keep the column from blowing out
    col[o] = 0.92 * dim;
    col[o + 1] = (0.50 + 0.30 * hot) * dim;
    col[o + 2] = (0.28 + 0.44 * hot) * dim;
  }
}
