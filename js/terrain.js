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
