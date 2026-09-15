// Loads the packed elevation model.
//
// data/terrain.png encodes a 320x320 grid, north-up:
//   R,G  elevation in decimetres, big-endian  (elev_m = ((R << 8) | G) / 10)
//   B    land fraction, 0 = sea, 255 = land
// Built by tools/build_terrain.py from GSI 標高タイル (Geospatial Information
// Authority of Japan), zoom 12, 36 tiles, resampled.

import { N, XW, YS, KMW, KMH } from './params.js';

export const elev = new Float32Array(N * N);   // metres, north-up
export const land = new Uint8Array(N * N);     // 0-255 land fraction, north-up
export let maxElev = 0;

/** Decode the packed PNG. Resolves once elev/land are populated. */
export function loadTerrain(url = 'data/terrain.png') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = N; c.height = N;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, N, N).data;
      for (let k = 0; k < N * N; k++) {
        elev[k] = ((d[k * 4] << 8) | d[k * 4 + 1]) / 10;
        land[k] = d[k * 4 + 2];
        if (elev[k] > maxElev) maxElev = elev[k];
      }
      resolve({ elev, land, maxElev });
    };
    img.onerror = () => reject(new Error('could not load ' + url));
    img.src = url;
  });
}

/** Ground elevation in metres at a point given in km relative to the vent. */
export function elevAt(xkm, ykm) {
  const gx = Math.round(((xkm - XW) / KMW) * (N - 1));
  const gy = Math.round(((ykm - YS) / KMH) * (N - 1));   // gy 0 = south
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return 0;
  return elev[(N - 1 - gy) * N + gx];                    // elev is north-up
}

/**
 * Bilinearly interpolated ground elevation, in metres.
 *
 * elevAt snaps to the nearest cell, which is fine for sampling the deposit but
 * not for anything that has to sit *on* the rendered surface: the terrain mesh
 * interpolates between vertices, so a nearest-cell height leaves labels and
 * draped lines floating over valleys and buried in ridges by up to a cell of
 * relief. Anything positioned against the visible ground should use this.
 */
export function elevAtSmooth(xkm, ykm) {
  const fx = ((xkm - XW) / KMW) * (N - 1);
  const fy = ((ykm - YS) / KMH) * (N - 1);               // fy 0 = south
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const cx = (i) => Math.max(0, Math.min(N - 1, i));
  const cy = (j) => Math.max(0, Math.min(N - 1, j));
  const at = (i, j) => elev[(N - 1 - cy(j)) * N + cx(i)];
  const s = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const n = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return s + (n - s) * ty;
}
