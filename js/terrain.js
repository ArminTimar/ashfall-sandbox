// Loads the packed elevation model and answers height queries.
//
// data/terrain.png is a north-up grid described by data/terrain.json:
//   R,G  elevation in decimetres, big-endian  (elev_m = ((R << 8) | G) / 10)
//   B    land fraction, 0 = sea, 255 = land
// Built by tools/build_terrain.py from GSI 標高タイル (Geospatial Information
// Authority of Japan) on a 200 m grid in EPSG:6670.
//
// Positions are metres of EPSG:6670 easting (E) and northing (N).

import { GRID, setGrid } from './params.js';

// Mutated in place, never reassigned, so importers keep valid references.
export const DEM = { elev: new Float32Array(0), land: new Uint8Array(0), maxElev: 0 };

/** Fill DEM from already-decoded RGBA pixels (used by the browser and tests). */
export function setDEM(meta, rgba) {
  setGrid(meta);
  const n = GRID.nx * GRID.ny;
  DEM.elev = new Float32Array(n);
  DEM.land = new Uint8Array(n);
  let max = 0;
  const step = rgba.length / n;          // 3 for RGB, 4 for RGBA
  for (let k = 0; k < n; k++) {
    const o = k * step;
    const e = ((rgba[o] << 8) | rgba[o + 1]) / 10;
    DEM.elev[k] = e;
    DEM.land[k] = rgba[o + 2];
    if (e > max) max = e;
  }
  DEM.maxElev = max;
  return DEM;
}

/** Load terrain.json and terrain.png. Resolves once DEM is populated. */
export function loadTerrain(pngUrl = 'data/terrain.png', meta = 'data/terrain.json') {
  const metaP = typeof meta === 'string' ? fetch(meta).then((r) => r.json()) : Promise.resolve(meta);
  return metaP.then((m) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = m.nx; c.height = m.ny;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      resolve(setDEM(m, g.getImageData(0, 0, m.nx, m.ny).data));
    };
    img.onerror = () => reject(new Error('could not load ' + pngUrl));
    img.src = pngUrl;
  }));
}

/** Fractional grid position of a point: column from the west, row from the north. */
function gridPos(E, N) {
  return [(E - GRID.west) / GRID.cell - 0.5, (GRID.north - N) / GRID.cell - 0.5];
}

/** Ground elevation in metres at the nearest cell. 0 outside the map. */
export function elevAt(E, N) {
  const [fx, fy] = gridPos(E, N);
  const i = Math.round(fx), r = Math.round(fy);
  if (i < 0 || r < 0 || i >= GRID.nx || r >= GRID.ny) return 0;
  return DEM.elev[r * GRID.nx + i];
}

/** Land fraction 0 to 255 at the nearest cell. 0 outside the map. */
export function landAt(E, N) {
  const [fx, fy] = gridPos(E, N);
  const i = Math.round(fx), r = Math.round(fy);
  if (i < 0 || r < 0 || i >= GRID.nx || r >= GRID.ny) return 0;
  return DEM.land[r * GRID.nx + i];
}

/**
 * Bilinearly interpolated ground elevation in metres. Anything that has to sit
 * on the drawn surface (labels, roads) should use this, since the mesh
 * interpolates between vertices too.
 */
export function elevAtSmooth(E, N) {
  const { nx, ny } = GRID;
  const [fx, fy] = gridPos(E, N);
  if (fx < -1 || fy < -1 || fx > nx || fy > ny) return 0;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const cx = (i) => (i < 0 ? 0 : i >= nx ? nx - 1 : i);
  const cy = (j) => (j < 0 ? 0 : j >= ny ? ny - 1 : j);
  const at = (i, j) => DEM.elev[cy(j) * nx + cx(i)];
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}
