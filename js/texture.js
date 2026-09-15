// Builds the canvas texture draped over the terrain: base land/sea colours with
// the ash deposit composited on top, plus isopach lines.

import { N, P } from './params.js';
import { field, stats } from './physics.js';
import { elev, land } from './terrain.js';
import { flipToNorthUp, niceLevels, contour } from './grid.js';

export const FLOOR = 0.001;      // mm, below this nothing is drawn

// Sequential warm ramp with monotonically increasing luminance, so it reads
// correctly against the dark terrain panel.
const STOPS = [
  [0.003,  52,  32,  44],
  [0.03,   92,  42,  45],
  [0.3,   140,  58,  34],
  [3,     184,  85,  24],
  [30,    217, 121,  26],
  [200,   237, 164,  62],
  [1000,  248, 210, 113]
];
const LSPAN = Math.log(1000) - Math.log(FLOOR);

/**
 * Colour and opacity for a deposit thickness in mm.
 * Opacity tracks magnitude across the whole six-decade scale so a trace
 * dusting stays translucent and the ground reads through it.
 */
export function ramp(mm) {
  if (mm <= FLOOR) return null;
  let a = Math.min(1, Math.max(0, (Math.log(mm) - Math.log(FLOOR)) / LSPAN));
  a = 0.10 + 0.90 * Math.pow(a, 0.85);
  let r, g, b;
  if (mm <= STOPS[0][0]) {
    [, r, g, b] = STOPS[0];
  } else {
    let done = false;
    for (let i = 0; i < STOPS.length - 1; i++) {
      const s = STOPS[i], e = STOPS[i + 1];
      if (mm <= e[0]) {
        const t = (Math.log(mm) - Math.log(s[0])) / (Math.log(e[0]) - Math.log(s[0]));
        r = s[1] + (e[1] - s[1]) * t;
        g = s[2] + (e[2] - s[2]) * t;
        b = s[3] + (e[3] - s[3]) * t;
        done = true;
        break;
      }
    }
    if (!done) { const l = STOPS[STOPS.length - 1]; r = l[1]; g = l[2]; b = l[3]; }
  }
  return [r, g, b, a];
}

let cv = null, ctx = null, baseImg = null, workImg = null;
export const fieldTex = new Float64Array(N * N);   // north-up copy for drawing

export function initTexture() {
  cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  ctx = cv.getContext('2d');
  baseImg = ctx.createImageData(N, N);
  workImg = ctx.createImageData(N, N);
  const d = baseImg.data;
  for (let k = 0; k < N * N; k++) {
    const e = elev[k];
    const isLand = land[k] > 110;
    let r, g, b;
    if (!isLand) {
      const dep = Math.min(1, e / 30);
      r = 18 + 6 * dep; g = 31 + 8 * dep; b = 41 + 9 * dep;
    } else if (e < 8) {
      r = 64; g = 68; b = 58;
    } else {
      const t = Math.min(1, e / 900);
      r = 49 + 30 * t; g = 63 + 27 * t; b = 54 + 24 * t;
    }
    const o = k * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  return cv;
}

export function getCanvas() { return cv; }

/** Redraw base + deposit + isopachs. Call after physics.compute(). */
export function paintTexture(showContours = true) {
  flipToNorthUp(field, fieldTex, N);
  const src = baseImg.data;
  const d = workImg.data;
  const f = stats.mmFac;
  d.set(src);
  for (let k = 0; k < N * N; k++) {
    const c = ramp(fieldTex[k] * f);
    if (!c) continue;
    const o = k * 4;
    const a = c[3];
    d[o]     = src[o]     + (c[0] - src[o])     * a;
    d[o + 1] = src[o + 1] + (c[1] - src[o + 1]) * a;
    d[o + 2] = src[o + 2] + (c[2] - src[o + 2]) * a;
  }
  ctx.putImageData(workImg, 0, 0);
  if (showContours) drawContours();
}

function drawContours() {
  const f = stats.mmFac;
  const levels = niceLevels(stats.max * f, FLOOR);
  ctx.lineWidth = 1;
  ctx.font = '500 9px monospace';
  for (let L = 0; L < levels.length; L++) {
    const segs = contour(fieldTex, N, levels[L][0], f);
    if (!segs.length) continue;
    ctx.strokeStyle = `rgba(250,246,240,${0.26 + 0.13 * L})`;
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s[0][0], s[0][1]);
      ctx.lineTo(s[1][0], s[1][1]);
    }
    ctx.stroke();
  }
}
