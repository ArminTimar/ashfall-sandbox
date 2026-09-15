// Domain constants, tunable state and scenario presets.
// Deliberately free of imports so every other module and the tests can depend
// on it without pulling in the DOM.

export const G = 9.81;            // m/s^2
export const MU = 1.8e-5;         // Pa s, dynamic viscosity of air
export const RHO0 = 1.225;        // kg/m^3, air density at sea level
export const HS = 8200;           // m, atmospheric scale height

export const NPHI = 12;           // grain size bins
export const NH = 16;             // release height bins
export const N = 320;             // grid cells per side (matches data/terrain.png)

// Terrain extents in km relative to Minamidake (31.5931 N, 130.6575 E).
// These come from the GSI tile bounds; see tools/build_terrain.py.
// One binding per statement: tools/bundle.mjs rewrites `export` declarations
// and only handles a single declarator each.
export const XW = -21.60;
export const XE = 28.40;
export const YS = -18.18;
export const YN = 31.45;
export const KMW = XE - XW;
export const KMH = YN - YS;
export const CELLX = (KMW * 1000) / N;
export const CELLY = (KMH * 1000) / N;

export const VENT_Z = 1060;       // m a.s.l., Minamidake summit

// The geographic anchor of the whole model. Everything downstream is in
// kilometres east and north of this point, so these four numbers have to agree
// with tools/build_terrain.py and tools/build_vectors.py or the terrain, the
// vectors and the physics end up in three slightly different places.
export const VENT_LON = 130.6575;
export const VENT_LAT = 31.5931;
export const KM_PER_DEG_LAT = 110.574;
export const KM_PER_DEG_LON = 111.320 * Math.cos((VENT_LAT * Math.PI) / 180);

/** Longitude in degrees to kilometres east of the vent. */
export function lonToX(lon) { return (lon - VENT_LON) * KM_PER_DEG_LON; }

/** Latitude in degrees to kilometres north of the vent. */
export function latToY(lat) { return (lat - VENT_LAT) * KM_PER_DEG_LAT; }

// Labelled places, held as longitude/latitude so each one can be checked
// against a map; the kilometre offsets are derived and never typed by hand.
// They used to be typed by hand, which is how Tarumizu ended up 1.5 km south
// of the town, out towards the middle of Kagoshima Bay.
//
// Settlement and airport positions are OpenStreetMap; the vent is the
// Minamidake summit that defines the origin.
export const PLACES = [
  { n: 'Minamidake',        lon: 130.65750, lat: 31.59310, vent: true },
  { n: 'Kagoshima',         lon: 130.55719, lat: 31.59679, key: 'kago' },
  { n: 'Kagoshima Airport', lon: 130.71944, lat: 31.80325, key: 'air' },
  { n: 'Tarumizu',          lon: 130.70123, lat: 31.49269 },
  { n: 'Kirishima',         lon: 130.76324, lat: 31.74101 }
].map((p) => Object.assign(p, { x: lonToX(p.lon), y: latToY(p.lat) }));

/**
 * Live model parameters. Mutated in place by the UI so every module sees the
 * same object; treat it as the single source of truth.
 *   H      plume height above vent, km
 *   logM   log10 of erupted mass, kg
 *   phi    median grain size, phi units
 *   sig    grain size sorting, phi units
 *   suz    Suzuki column parameter A (mass peaks at 1 - 1/A of the height)
 *   dir    wind direction it blows FROM, degrees
 *   spd    wind speed at 2 km, m/s
 *   top    wind speed at 12 km, m/s
 *   shear  directional shear between those levels, degrees
 *   K      eddy diffusivity, m^2/s
 *   rho    deposit bulk density, kg/m^3 (thickness conversion only)
 *   ex     vertical exaggeration for display only
 */
export const P = {
  H: 5, logM: 8.3, phi: 2.0, sig: 1.5, suz: 4,
  dir: 100, spd: 12, top: 24, shear: -15,
  K: 2500, rho: 1000, ex: 4
};

export const PRESETS = {
  routine: { H: 3.5, logM: 7.5, phi: 2.2, sig: 1.4, suz: 4, dir: 270, spd: 12, top: 26, shear:  10, K: 2000 },
  large:   { H: 6.0, logM: 8.7, phi: 1.8, sig: 1.6, suz: 4, dir: 280, spd: 16, top: 34, shear:  15, K: 3000 },
  taisho:  { H: 11.0, logM: 11.6, phi: 0.5, sig: 2.0, suz: 5, dir: 290, spd: 20, top: 48, shear: 25, K: 6000 },
  summer:  { H: 4.5, logM: 8.0, phi: 2.0, sig: 1.5, suz: 4, dir: 105, spd: 11, top: 22, shear: -15, K: 2500 }
};

export function applyPreset(name) {
  const pr = PRESETS[name];
  if (!pr) return false;
  for (const k in pr) P[k] = pr[k];
  return true;
}
