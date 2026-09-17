// Physical constants, the map grid, display settings and fixed landmarks.
// Free of DOM access so every other module and the tests can depend on it.

import { toEN } from './proj.js';

export const G = 9.81;            // m/s^2
export const MU = 1.8e-5;         // Pa s, dynamic viscosity of air
export const RHO0 = 1.225;        // kg/m^3, air density at sea level
export const HS = 8200;           // m, atmospheric scale height

export const NPHI = 12;           // grain size bins
export const NH = 16;             // release height bins

/**
 * The map grid, in metres of JGD2011 / Japan Plane Rectangular CS II
 * (EPSG:6670). Filled from data/terrain.json by terrain.js, or by a test.
 * Cell (i, j) with j counted from the south has its centre at
 * E = west + (i + 0.5) * cell, N = south + (j + 0.5) * cell.
 */
export const GRID = {
  epsg: 6670, west: 0, south: 0, east: 0, north: 0, cell: 200, nx: 0, ny: 0
};

export function setGrid(meta) {
  for (const k of Object.keys(GRID)) if (k in meta) GRID[k] = meta[k];
  return GRID;
}

/**
 * Display settings shared by every volcano.
 *   ex     vertical exaggeration
 *   mode   particle display: 'steady' or 'eruption'
 *   rate   model seconds per wall-clock second
 *   theme  'dark' or 'light'
 */
export const P = { ex: 3, mode: 'steady', rate: 45, theme: 'dark' };

// Airports, from OpenStreetMap. Settlements come from data/vectors.json.
export const LANDMARKS = [
  { n: 'Kagoshima Airport', lon: 130.71944, lat: 31.80325 },
  { n: 'Kumamoto Airport',  lon: 130.85239, lat: 32.83625 },
  { n: 'Fukuoka Airport',   lon: 130.44945, lat: 33.58681 },
  { n: 'Oita Airport',      lon: 131.73522, lat: 33.48012 },
  { n: 'Miyazaki Airport',  lon: 131.44794, lat: 31.87606 },
  { n: 'Nagasaki Airport',  lon: 129.91350, lat: 32.91718 },
  { n: 'Saga Airport',      lon: 130.30450, lat: 33.14942 },
  { n: 'Kitakyushu Airport', lon: 131.03331, lat: 33.83897 }
].map((p) => { const [E, N] = toEN(p.lon, p.lat); return Object.assign(p, { E, N, kind: 'airport' }); });
