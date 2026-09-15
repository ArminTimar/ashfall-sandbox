// Does the Lagrangian particle cloud land where the analytical field says it
// should? The two are separate implementations of the same model, so agreeing
// is a real check rather than a tautology.
//
//   node test/montecarlo.mjs
//
// The analytical moments use the law of total variance over the (release
// height, grain size) mixture: each component contributes its own diffusive
// variance plus the spread of the component means about the overall mean.

import { NH, NPHI, VENT_Z, P } from '../js/params.js';
import {
  airRho, vSettle, windAt, fallPath, plumeTau, axisVar, gauss,
  grainBins, heightBins
} from '../js/physics.js';

Object.assign(P, { H: 6, logM: 8.7, phi: 1.8, sig: 1.6, suz: 4,
                   dir: 280, spd: 16, top: 34, shear: 15, K: 3000 });

function analytic() {
  const g = grainBins(), h = heightBins();
  let mx = 0, my = 0, W = 0;
  const comp = [];
  for (let i = 0; i < NH; i++) {
    for (let j = 0; j < NPHI; j++) {
      const w = h.w[i] * g.w[j];
      const fp = fallPath(h.z[i], g.d[j], g.rho[j]);
      const s2 = axisVar(fp.t, plumeTau(h.z[i] - VENT_Z));
      comp.push({ w, dx: fp.dx, dy: fp.dy, s2 });
      W += w; mx += w * fp.dx; my += w * fp.dy;
    }
  }
  mx /= W; my /= W;
  let vx = 0, vy = 0;
  for (const c of comp) {
    vx += c.w * (c.s2 + (c.dx - mx) ** 2);
    vy += c.w * (c.s2 + (c.dy - my) ** 2);
  }
  return { mx: mx / 1000, my: my / 1000,
           sx: Math.sqrt(vx / W) / 1000, sy: Math.sqrt(vy / W) / 1000 };
}

function monteCarlo(n, dtModel) {
  const g = grainBins(), h = heightBins();
  const cum = (a) => { let s = 0; return a.map((w) => (s += w)); };
  const cumH = cum(h.w), cumG = cum(g.w);
  const pick = (c) => { const r = Math.random();
    for (let i = 0; i < c.length; i++) if (r <= c[i]) return i;
    return c.length - 1; };

  const xs = [], ys = [];
  for (let k = 0; k < n; k++) {
    const i = pick(cumH), j = pick(cumG);
    let z = h.z[i], dx = 0, dy = 0;
    const s0 = Math.sqrt(axisVar(0, plumeTau(z - VENT_Z)));
    dx += gauss() * s0; dy += gauss() * s0;
    while (z > 0) {
      let vs = vSettle(g.d[j], g.rho[j], airRho(Math.max(z, 0)));
      if (!(vs > 0.0001)) vs = 0.0001;
      const w = windAt(Math.max(z, 0));
      const dt = Math.min(dtModel, z / vs);
      z -= vs * dt; dx += w.u * dt; dy += w.v * dt;
      const sw = Math.sqrt(2 * P.K * dt);
      dx += gauss() * sw; dy += gauss() * sw;
    }
    xs.push(dx / 1000); ys.push(dy / 1000);
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const std = (v) => { const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };
  return { mx: mean(xs), my: mean(ys), sx: std(xs), sy: std(ys) };
}

const A = analytic();
const pad = (x) => x.toFixed(2).padStart(9);
let fail = 0;

console.log('                mean x    mean y   spread x  spread y   (km)');
console.log(`analytic  ${pad(A.mx)}${pad(A.my)}${pad(A.sx)}${pad(A.sy)}`);
for (const dt of [20, 5]) {
  const M = monteCarlo(20000, dt);
  console.log(`dt=${String(dt).padStart(2)}s    ${pad(M.mx)}${pad(M.my)}${pad(M.sx)}${pad(M.sy)}`);
  // 2% on position, 3% on spread: loose enough for 20k samples of a
  // heavy-tailed mixture, tight enough to catch a wrong constant.
  const rel = (a, b, scale) => Math.abs(a - b) / scale;
  const scale = Math.hypot(A.sx, A.sy);
  for (const [name, a, b, tol] of [
    ['mean x', M.mx, A.mx, 0.02], ['mean y', M.my, A.my, 0.02],
    ['spread x', M.sx, A.sx, 0.03], ['spread y', M.sy, A.sy, 0.03]
  ]) {
    if (rel(a, b, scale) > tol) {
      console.log(`  FAIL ${name} at dt=${dt}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);
      fail++;
    }
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nOK - particle cloud matches the analytical deposit');
process.exit(fail ? 1 : 0);
