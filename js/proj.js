// Map projection: JGD2011 / Japan Plane Rectangular CS II (EPSG:6670).
//
// Every position in the sandbox, from the terrain grid to vents, roads, labels
// and deposits, is held in this system: metres east (E) and north (N) of the
// zone II origin at 33°N 131°E. It is the official survey grid for most of
// Kyushu, so anything exported from here lines up in QGIS without reprojecting.
//
// Japanese survey convention calls northing X and easting Y. This code uses E
// and N throughout to avoid that trap, and the scene uses x = E, z = -N.
//
// The projection is transverse Mercator on the GRS80 ellipsoid with scale
// factor 0.9999, computed with the Krüger series to sixth order in n
// (Karney 2011, the same method GSI documents). Round trips agree with pyproj
// to well under a millimetre across Kyushu. See test/proj.mjs.
//
// No imports, so tools and tests can load it without a DOM.

export const EPSG = 6670;
export const CRS_NAME = 'JGD2011 / Japan Plane Rectangular CS II';

const A_AXIS = 6378137;
const FLAT = 1 / 298.257222101;
const K0 = 0.9999;
const LON0 = (131 * Math.PI) / 180;
const LAT0 = (33 * Math.PI) / 180;

const n = FLAT / (2 - FLAT);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const AA = (A_AXIS / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400
];
const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800
];
const DELTA = [
  2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45 + (26 * n5) / 45 - (2854 * n6) / 675,
  (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45 + (2704 * n5) / 315 + (2323 * n6) / 945,
  (56 * n3) / 15 - (136 * n4) / 35 - (1262 * n5) / 105 + (73814 * n6) / 2835,
  (4279 * n4) / 630 - (332 * n5) / 35 - (399572 * n6) / 14175,
  (4174 * n5) / 315 - (144838 * n6) / 6237,
  (601676 * n6) / 22275
];

const E2N = (2 * Math.sqrt(n)) / (1 + n);

function conformal(lat) {
  const s = Math.sin(lat);
  return Math.sinh(Math.atanh(s) - E2N * Math.atanh(E2N * s));
}

function arc(lat) {
  // Meridian distance from the equator, scaled by K0.
  const xi = Math.atan(conformal(lat));
  let sum = xi;
  for (let j = 1; j <= 6; j++) sum += ALPHA[j - 1] * Math.sin(2 * j * xi);
  return K0 * AA * sum;
}
const S0 = arc(LAT0);

/** Longitude and latitude in degrees (JGD2011) to [E, N] in metres. */
export function toEN(lon, lat) {
  const phi = (lat * Math.PI) / 180, dl = (lon * Math.PI) / 180 - LON0;
  const t = conformal(phi);
  const xi = Math.atan(t / Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = xi, y = eta;
  for (let j = 1; j <= 6; j++) {
    x += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    y += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return [K0 * AA * y, K0 * AA * x - S0];
}

/** [E, N] in metres to [longitude, latitude] in degrees (JGD2011). */
export function toLonLat(E, N) {
  const xi = (N + S0) / (K0 * AA), eta = E / (K0 * AA);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 6; j++) {
    xp -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let lat = chi;
  for (let j = 1; j <= 6; j++) lat += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon = LON0 + Math.atan2(Math.sinh(ep), Math.cos(xp));
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** WKT for the .prj sidecar of exported rasters and vectors. */
export const PRJ_WKT = 'PROJCS["JGD2011 / Japan Plane Rectangular CS II",'
  + 'GEOGCS["JGD2011",DATUM["Japanese_Geodetic_Datum_2011",'
  + 'SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],'
  + 'UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
  + 'PARAMETER["latitude_of_origin",33],PARAMETER["central_meridian",131],'
  + 'PARAMETER["scale_factor",0.9999],PARAMETER["false_easting",0],'
  + 'PARAMETER["false_northing",0],UNIT["metre",1]]';
