// The projection has to match what GIS software computes, or exported maps
// land in the wrong place. Reference values are from pyproj 3.8 (PROJ),
// EPSG:6668 to EPSG:6670, and are pasted here so the test needs no Python.
//
//   node test/proj.mjs

import { toEN, toLonLat } from '../js/proj.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

const REF = [
  // lon, lat, E, N  (pyproj)
  [131, 33, 0.0000, 0.0000],
  [130.6575, 31.5931, -32502.8479, -155947.5109],
  [129.35, 34.1, -152248.6940, 123222.7769],
  [132.15, 30.9, 109936.8658, -232270.6632],
  [131.1042, 32.8844, 9749.5310, -12814.3409],
  [130.2994, 32.7575, -65645.9617, -26673.9470]
];

console.log('     lon      lat              E              N    error (mm)');
for (const [lon, lat, E, N] of REF) {
  const [e, nn] = toEN(lon, lat);
  const err = Math.hypot(e - E, nn - N) * 1000;
  console.log(`  ${lon.toFixed(4)} ${lat.toFixed(4)} ${e.toFixed(3).padStart(14)} ${nn.toFixed(3).padStart(14)}   ${err.toFixed(3)}`);
  check(err < 1, `toEN(${lon}, ${lat}) is ${err.toFixed(2)} mm from pyproj`);
  const [lo, la] = toLonLat(E, N);
  // 1e-8 degrees is about 1 mm.
  check(Math.abs(lo - lon) < 1e-8 && Math.abs(la - lat) < 1e-8,
    `toLonLat(${E}, ${N}) gave ${lo}, ${la}, expected ${lon}, ${lat}`);
}

// pyproj inverse at a corner of the map
const [lo, la] = toLonLat(-120000, -250000);
check(Math.abs(lo - 129.74683259493307) < 1e-8 && Math.abs(la - 30.73912777610694) < 1e-8,
  `toLonLat(-120000, -250000) gave ${lo}, ${la}`);

// Round trips over a grid covering the whole map
let worst = 0;
for (let lon = 129.2; lon <= 132.3; lon += 0.1) {
  for (let lat = 30.8; lat <= 34.2; lat += 0.1) {
    const [e, nn] = toEN(lon, lat);
    const [lo2, la2] = toLonLat(e, nn);
    const [e2, n2] = toEN(lo2, la2);
    worst = Math.max(worst, Math.hypot(e2 - e, n2 - nn));
  }
}
console.log(`\n  worst round trip over Kyushu: ${(worst * 1000).toFixed(4)} mm`);
check(worst < 1e-3, `round trip error ${worst} m`);

console.log(fail ? `\n${fail} FAILED` : '\nOK - projection matches pyproj');
process.exit(fail ? 1 : 0);
