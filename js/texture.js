// The canvas texture draped over the terrain: land and sea colours with the
// combined ash deposit of every erupting volcano on top, plus isopach lines.
//
// The canvas is one pixel per 200 m grid cell, north-up. Only the rectangle
// that has or had ash is repainted after a change, so an eruption at one
// volcano does not repaint all of Kyushu.

import { GRID, P } from './params.js';
import { DEM } from './terrain.js';
import { niceLevels, contour } from './grid.js';

export const FLOOR = 0.001;      // mm, below this nothing is drawn

// Colour ramps by thickness in mm, one per theme. Both brighten or darken
// steadily with thickness so they read in order against their ground.
const RAMPS = {
  // warm, getting lighter, against dark ground
  dark: [
    [0.003,  52,  32,  44],
    [0.03,   92,  42,  45],
    [0.3,   140,  58,  34],
    [3,     184,  85,  24],
    [30,    217, 121,  26],
    [200,   237, 164,  62],
    [1000,  248, 210, 113]
  ],
  // ash grey, getting darker, against light ground
  light: [
    [0.003, 196, 194, 190],
    [0.03,  170, 168, 164],
    [0.3,   138, 136, 132],
    [3,     104, 102,  99],
    [30,     72,  70,  68],
    [200,    44,  43,  42],
    [1000,   22,  22,  22]
  ]
};

// Sea and land colours by theme, for the base layer and the sea plane.
export const PALETTE = {
  dark: {
    // Low ground has to read as land next to the sea. It used to be 64,68,58,
    // close enough to the sea colour that the Saga and Chikugo plains looked
    // like water, and land just above sea level was darker still.
    sea: [18, 31, 41], seaDeep: [24, 39, 50],
    low: [68, 82, 64], landLo: [64, 80, 62], landHi: [92, 102, 84], rock: [112, 112, 102],
    contour: [250, 246, 240]
  },
  light: {
    sea: [88, 150, 196], seaDeep: [70, 132, 182],
    low: [178, 190, 150], landLo: [150, 176, 122], landHi: [124, 146, 104], rock: [168, 160, 146],
    contour: [30, 30, 30]
  }
};

const LUT_N = 1024, LOG_LO = Math.log10(FLOOR), LOG_HI = 3;
const LUT = { dark: null, light: null };

/** Colour and opacity for a thickness in mm, straight from the ramp. */
export function ramp(mm, theme = 'dark') {
  if (mm <= FLOOR) return null;
  const STOPS = RAMPS[theme];
  const LSPAN = Math.log(1000) - Math.log(FLOOR);
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

function lut(theme) {
  if (LUT[theme]) return LUT[theme];
  const t = new Float32Array(LUT_N * 4);
  for (let k = 0; k < LUT_N; k++) {
    const mm = Math.pow(10, LOG_LO + ((k + 0.5) / LUT_N) * (LOG_HI - LOG_LO));
    const c = ramp(mm, theme);
    t.set(c, k * 4);
  }
  return (LUT[theme] = t);
}

/** The CSS gradient matching the ramp, for the on-map legend. */
export function rampCSS(theme) {
  return 'linear-gradient(90deg, ' + RAMPS[theme]
    .map((s) => `rgb(${s[1]},${s[2]},${s[3]})`).join(', ') + ')';
}

let cv = null, ctx = null, baseImg = null, workImg = null, baseTheme = '';
let painted = null;              // [i0, i1, r0, r1] north-up area painted with ash last time
let mmGrid = new Float32Array(0);

export function initTexture() {
  cv = document.createElement('canvas');
  cv.width = GRID.nx; cv.height = GRID.ny;
  ctx = cv.getContext('2d', { willReadFrequently: true });
  baseImg = ctx.createImageData(GRID.nx, GRID.ny);
  workImg = ctx.createImageData(GRID.nx, GRID.ny);
  buildBase(P.theme);
  return cv;
}

export function getCanvas() { return cv; }

function buildBase(theme) {
  const C = PALETTE[theme];
  const d = baseImg.data;
  const n = GRID.nx * GRID.ny;
  for (let k = 0; k < n; k++) {
    const e = DEM.elev[k];
    const isLand = DEM.land[k] > 110;
    let r, g, b;
    if (!isLand) {
      [r, g, b] = C.sea;
    } else if (e < 8) {
      [r, g, b] = C.low;
    } else if (e < 900) {
      const t = e / 900;
      r = C.landLo[0] + (C.landHi[0] - C.landLo[0]) * t;
      g = C.landLo[1] + (C.landHi[1] - C.landLo[1]) * t;
      b = C.landLo[2] + (C.landHi[2] - C.landLo[2]) * t;
    } else {
      const t = Math.min(1, (e - 900) / 800);
      r = C.landHi[0] + (C.rock[0] - C.landHi[0]) * t;
      g = C.landHi[1] + (C.rock[1] - C.landHi[1]) * t;
      b = C.landHi[2] + (C.rock[2] - C.landHi[2]) * t;
    }
    const o = k * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  workImg.data.set(d);
  ctx.putImageData(workImg, 0, 0);
  baseTheme = theme;
  painted = null;
}

/** North-up rectangle covering every field's ash, or null. */
function unionBox(fields) {
  let box = null;
  const ny = GRID.ny;
  for (const f of fields) {
    if (!f || !f.bbox) continue;
    const [i0, i1, j0, j1] = f.bbox;
    const r0 = ny - 1 - j1, r1 = ny - 1 - j0;
    if (!box) box = [i0, i1, r0, r1];
    else { box[0] = Math.min(box[0], i0); box[1] = Math.max(box[1], i1); box[2] = Math.min(box[2], r0); box[3] = Math.max(box[3], r1); }
  }
  return box;
}

/**
 * Redraw the ash of every field given, plus isopachs. Call after the fields
 * change or the theme does.
 * @param {object[]} fields deposit fields from physics.makeField, with rho set
 *   through field.stats.mmFac
 * @returns {number} the combined maximum thickness in mm
 */
export function paintTexture(fields, showContours = true) {
  if (baseTheme !== P.theme) buildBase(P.theme);
  const { nx, ny } = GRID;
  const now = unionBox(fields);
  let box = now;
  if (painted) {
    box = box ? [Math.min(box[0], painted[0]), Math.max(box[1], painted[1]),
      Math.min(box[2], painted[2]), Math.max(box[3], painted[3])] : painted;
  }
  painted = now;
  if (!box) return 0;

  const [i0, i1, r0, r1] = box;
  const w = i1 - i0 + 1, h = r1 - r0 + 1;
  if (mmGrid.length < w * h) mmGrid = new Float32Array(w * h);
  mmGrid.fill(0, 0, w * h);
  let maxMM = 0;
  const live = fields.filter((f) => f && f.bbox);
  for (const f of live) {
    const [fi0, fi1, fj0, fj1] = f.bbox;
    const fac = f.stats.mmFac;
    for (let j = fj0; j <= fj1; j++) {
      const r = ny - 1 - j;
      const src = j * nx, dst = (r - r0) * w - i0;
      for (let i = fi0; i <= fi1; i++) {
        const v = f.data[src + i];
        if (v > 0) {
          const m = (mmGrid[dst + i] += v * fac);
          if (m > maxMM) maxMM = m;
        }
      }
    }
  }

  const base = baseImg.data, d = workImg.data, L = lut(P.theme);
  const scale = LUT_N / (LOG_HI - LOG_LO);
  for (let r = r0; r <= r1; r++) {
    for (let i = i0; i <= i1; i++) {
      const o = (r * nx + i) * 4;
      const mm = mmGrid[(r - r0) * w + (i - i0)];
      if (mm <= FLOOR) {
        d[o] = base[o]; d[o + 1] = base[o + 1]; d[o + 2] = base[o + 2];
        continue;
      }
      let k = Math.floor((Math.log10(mm) - LOG_LO) * scale);
      if (k >= LUT_N) k = LUT_N - 1;
      const c = k * 4, a = L[c + 3];
      d[o] = base[o] + (L[c] - base[o]) * a;
      d[o + 1] = base[o + 1] + (L[c + 1] - base[o + 1]) * a;
      d[o + 2] = base[o + 2] + (L[c + 2] - base[o + 2]) * a;
    }
  }
  ctx.putImageData(workImg, 0, 0, i0, r0, w, h);

  if (showContours && maxMM > 0) {
    // Marching squares over millions of cells at four levels is most of the
    // cost of a repaint, so large deposits are contoured on every 2nd or 3rd
    // cell. Isopachs of a deposit that big are tens of kilometres long, and a
    // 400 or 600 m step does not show.
    const stride = Math.max(1, Math.ceil(Math.sqrt((w * h) / 300000)));
    let grid = mmGrid, gw = w, gh = h;
    if (stride > 1) {
      gw = Math.ceil(w / stride); gh = Math.ceil(h / stride);
      grid = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++) {
        const src = y * stride * w, dst = y * gw;
        for (let x = 0; x < gw; x++) grid[dst + x] = mmGrid[src + x * stride];
      }
    }
    const levels = niceLevels(maxMM, FLOOR);
    const col = PALETTE[P.theme].contour;
    ctx.save();
    ctx.beginPath();
    ctx.rect(i0, r0, w, h);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let k = 0; k < levels.length; k++) {
      const segs = contour(grid, gw, levels[k][0], 1, gh);
      if (!segs.length) continue;
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.26 + 0.13 * k})`;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(i0 + s[0][0] * stride + 0.5, r0 + s[0][1] * stride + 0.5);
        ctx.lineTo(i0 + s[1][0] * stride + 0.5, r0 + s[1][1] * stride + 0.5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  return maxMM;
}
