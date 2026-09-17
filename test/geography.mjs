// Guards everything that has to agree about *where* things are.
//
// The model, the DEM and the OpenStreetMap layers each carry their own idea of
// the domain, and nothing at runtime complains if they disagree — the map just
// renders a coherent-looking picture with the roads in the wrong valley and a
// town label out in the water. These are the checks that catch that.
//
//   node test/geography.mjs

import { readFileSync, existsSync } from 'node:fs';
import { N, XW, XE, YS, YN, KMW, KMH, PLACES, lonToX, latToY,
         VENT_LON, VENT_LAT } from '../js/params.js';
import { decodeRGB } from './png.mjs';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

// --- 1. the DEM is the size params.js thinks it is --------------------------
const { w, h, rgb } = decodeRGB('data/terrain.png');
check(w === N && h === N, `terrain.png is ${w}x${h}, params.js says ${N}`);

/** Elevation in metres and land fraction at a point in km from the vent. */
function sample(xkm, ykm) {
  const gx = Math.round(((xkm - XW) / KMW) * (N - 1));
  const gy = Math.round(((ykm - YS) / KMH) * (N - 1));
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return null;
  const o = ((N - 1 - gy) * N + gx) * 3;        // the PNG is north-up
  return { elev: ((rgb[o] << 8) | rgb[o + 1]) / 10, land: rgb[o + 2] };
}

// --- 2. every labelled place is inside the domain, on land, and derived -----
//
// A settlement label sitting in Kagoshima Bay is the symptom that started
// this: the kilometre offsets were typed by hand and drifted from the towns
// they named. Holding lon/lat and deriving the offsets makes that unrepresent-
// able, and this confirms the derivation is actually what params.js ships.
console.log('               lon      lat        x       y   elev  land');
for (const p of PLACES) {
  const s = sample(p.x, p.y);
  const ok = s && s.land > 110;                 // same threshold as texture.js
  console.log(`  ${p.n.padEnd(18)}${p.lon.toFixed(4)} ${p.lat.toFixed(4)} `
    + `${p.x.toFixed(2).padStart(7)} ${p.y.toFixed(2).padStart(7)} `
    + `${s ? String(Math.round(s.elev)).padStart(5) : '  off'} `
    + `${s ? String(s.land).padStart(4) : '   -'}  ${ok ? '' : '<-- not on land'}`);
  check(s !== null, `${p.n} is outside the terrain window`);
  check(ok, `${p.n} is labelled but sits in the sea`);
  check(Math.abs(p.x - lonToX(p.lon)) < 1e-9 && Math.abs(p.y - latToY(p.lat)) < 1e-9,
    `${p.n} has a hand-set x/y that disagrees with its lon/lat`);
}

// The vent defines the origin, so it had better be at it.
const vent = PLACES.find((p) => p.kind === 'vent');
check(Math.abs(lonToX(VENT_LON)) < 1e-9 && Math.abs(latToY(VENT_LAT)) < 1e-9,
  'the vent longitude/latitude should project to the origin');
check(vent && Math.hypot(vent.x, vent.y) < 1e-9, 'the vent label is not at the origin');

// --- 3. the OpenStreetMap layers describe the same window -------------------
//
// tools/build_terrain.py and tools/build_vectors.py are run separately. Move
// the window in one and forget the other and every road lands in the wrong
// place, consistently enough to look deliberate.
if (!existsSync('data/vectors.json')) {
  console.log('\n  data/vectors.json missing — run: python3 tools/build_vectors.py');
  fail++;
} else {
  const doc = JSON.parse(readFileSync('data/vectors.json', 'utf8'));
  const [bx0, by0, bx1, by1] = doc.bbox_km;
  check(Math.abs(bx0 - XW) < 0.01 && Math.abs(by0 - YS) < 0.01
     && Math.abs(bx1 - XE) < 0.01 && Math.abs(by1 - YN) < 0.01,
    `vectors.json was built for [${doc.bbox_km}], params.js has [${XW},${YS},${XE},${YN}]`);

  // --- 4. every town label is inside the domain and on land ----------------
  //
  // A settlement node can sit right on the shore, where the 195 m grid cell
  // under it is sea, so a label passes if any cell within one step is land.
  const places = doc.places || [];
  check(places.length >= 30, `only ${places.length} place labels in vectors.json`);
  for (const t of [1, 2, 3]) {
    check(places.some((p) => p.tier === t), `no tier ${t} places in vectors.json`);
  }
  const cellKm = KMW / (N - 1);
  let wet = [];
  for (const p of places) {
    const inBox = p.x >= XW && p.x <= XE && p.y >= YS && p.y <= YN;
    check(inBox, `${p.n} is outside the domain`);
    let dry = false;
    for (let dx = -1; dx <= 1 && !dry; dx++) {
      for (let dy = -1; dy <= 1 && !dry; dy++) {
        const s = sample(p.x + dx * cellKm, p.y + dy * cellKm);
        if (s && s.land > 110) dry = true;
      }
    }
    if (!dry) wet.push(p.n);
  }
  check(wet.length === 0, `place labels in the sea: ${wet.join(', ')}`);
  const names = places.map((p) => p.n);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  check(dup.length === 0, `duplicate place names: ${dup.join(', ')}`);
  console.log(`
  ${places.length} place labels, `
    + [1, 2, 3].map((t) => `${places.filter((p) => p.tier === t).length} in tier ${t}`).join(', '));

  const EPS = 0.02;   // the build rounds to 10 m, so allow a rounding step out
  console.log('');
  for (const [name, lines] of Object.entries(doc.layers)) {
    let pts = 0, out = 0, degenerate = 0;
    for (const ln of lines) {
      if (ln.length < 2) degenerate++;
      for (const [x, y] of ln) {
        pts++;
        if (x < XW - EPS || x > XE + EPS || y < YS - EPS || y > YN + EPS) out++;
      }
    }
    console.log(`  ${name.padEnd(9)}${String(lines.length).padStart(5)} lines `
      + `${String(pts).padStart(7)} points${out ? `  ${out} OUTSIDE` : ''}`);
    check(lines.length > 0, `layer '${name}' is empty — did the Overpass query fail?`);
    check(out === 0, `layer '${name}' has ${out} points outside the domain`);
    check(degenerate === 0, `layer '${name}' has ${degenerate} lines with under two points`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nOK - places and map layers agree with the terrain');
process.exit(fail ? 1 : 0);
