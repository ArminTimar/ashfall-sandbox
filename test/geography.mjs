// Guards everything that has to agree about where things are.
//
// The elevation model, the OpenStreetMap layers, the volcano catalogue and the
// landmarks each carry their own idea of the map, and nothing at runtime
// complains if they disagree. The map just draws roads in the wrong valley or
// a vent in the sea. These checks catch that.
//
//   node test/geography.mjs

import { readFileSync, existsSync } from 'node:fs';
import { LANDMARKS } from '../js/params.js';
import { VOLCANOES } from '../js/volcanoes.js';
import { toEN, toLonLat } from '../js/proj.js';
import { decodeRGB } from './png.mjs';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

// --- 1. the DEM is the grid terrain.json describes ---------------------------
const META = JSON.parse(readFileSync('data/terrain.json', 'utf8'));
const { w, h, rgb } = decodeRGB('data/terrain.png');
check(w === META.nx && h === META.ny, `terrain.png is ${w}x${h}, terrain.json says ${META.nx}x${META.ny}`);
check(META.epsg === 6670, `terrain.json is in EPSG:${META.epsg}, expected 6670`);
check((META.east - META.west) === META.nx * META.cell && (META.north - META.south) === META.ny * META.cell,
  'terrain.json edges do not match its cell size and dimensions');
check(META.west % META.cell === 0 && META.south % META.cell === 0,
  'grid edges should sit on multiples of the cell size so exports line up in GIS');

/** Elevation and land fraction at a point in metres, nearest cell. */
function sample(E, N) {
  const i = Math.floor((E - META.west) / META.cell);
  const r = Math.floor((META.north - N) / META.cell);
  if (i < 0 || r < 0 || i >= META.nx || r >= META.ny) return null;
  const o = (r * META.nx + i) * 3;
  return { elev: ((rgb[o] << 8) | rgb[o + 1]) / 10, land: rgb[o + 2] };
}
/** True if the cell or a neighbour is land, for points right on the shore. */
function nearLand(E, N) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const s = sample(E + dx * META.cell, N + dy * META.cell);
    if (s && s.land > 110) return true;
  }
  return false;
}

// --- 2. the map covers what it should, and not what it shouldn't ------------
const inside = (lon, lat) => { const [E, N] = toEN(lon, lat); return sample(E, N) !== null; };
for (const [name, lon, lat] of [
  ['Kitakyushu', 130.8752, 33.8834], ['Nagasaki', 129.8737, 32.7503], ['Cape Sata', 130.6619, 30.9942],
  ['Oita', 131.6126, 33.2382], ['Hirado', 129.5535, 33.3679], ['Amakusa', 130.1929, 32.4585]
]) check(inside(lon, lat), `${name} should be on the map`);
for (const [name, lon, lat] of [
  ['Tsushima', 129.29, 34.20], ['Fukue, Goto', 128.84, 32.70], ['Tanegashima', 130.99, 30.73],
  ['Satsuma-Iojima', 130.31, 30.79]
]) check(!inside(lon, lat), `${name} should be off the map`);

// --- 3. vents and landmarks are on land, at plausible heights ----------------
console.log('                        lon       lat          E          N   vent z   DEM');
for (const v of VOLCANOES) {
  const s = sample(v.E, v.N);
  console.log(`  ${v.name.padEnd(18)}${v.lon.toFixed(4).padStart(9)} ${v.lat.toFixed(4).padStart(9)} `
    + `${Math.round(v.E).toString().padStart(10)} ${Math.round(v.N).toString().padStart(10)} `
    + `${String(v.ventZ).padStart(7)} ${s ? String(Math.round(s.elev)).padStart(5) : '  off'}`);
  check(s && s.land > 110, `${v.name} vent is not on land`);
  // The 200 m DEM smooths summits and craters, so allow a few hundred metres.
  check(s && Math.abs(s.elev - v.ventZ) < 350, `${v.name}: vent at ${v.ventZ} m but the DEM says ${s && Math.round(s.elev)} m`);
  const [lo, la] = toLonLat(v.E, v.N);
  check(Math.abs(lo - v.lon) < 1e-8 && Math.abs(la - v.lat) < 1e-8, `${v.name}: E/N do not round-trip to its lon/lat`);
  check(v.refs.length === 2, `${v.name} should name two reference places for the readouts`);
}
for (const a of LANDMARKS) check(nearLand(a.E, a.N), `${a.n} is not on land`);

// --- 4. the OpenStreetMap layers and places describe the same map -----------
if (!existsSync('data/vectors.json')) {
  console.log('\n  data/vectors.json missing, run: python3 tools/build_vectors.py');
  fail++;
} else {
  const doc = JSON.parse(readFileSync('data/vectors.json', 'utf8'));
  const [bx0, by0, bx1, by1] = doc.bbox_km;
  check(doc.epsg === 6670, `vectors.json is in EPSG:${doc.epsg}, expected 6670`);
  check(Math.abs(bx0 * 1000 - META.west) < 1 && Math.abs(by0 * 1000 - META.south) < 1
     && Math.abs(bx1 * 1000 - META.east) < 1 && Math.abs(by1 * 1000 - META.north) < 1,
    `vectors.json was built for [${doc.bbox_km}] km, terrain.json has `
    + `[${META.west / 1000},${META.south / 1000},${META.east / 1000},${META.north / 1000}]`);

  const EPS = 0.02;   // the build rounds to 10 m
  console.log('');
  for (const [name, lines] of Object.entries(doc.layers)) {
    let pts = 0, out = 0, degenerate = 0;
    for (const ln of lines) {
      if (ln.length < 2) degenerate++;
      for (const [x, y] of ln) {
        pts++;
        if (x < bx0 - EPS || x > bx1 + EPS || y < by0 - EPS || y > by1 + EPS) out++;
      }
    }
    console.log(`  ${name.padEnd(9)}${String(lines.length).padStart(6)} lines ${String(pts).padStart(8)} points`
      + `${out ? `  ${out} OUTSIDE` : ''}`);
    check(lines.length > 0, `layer '${name}' is empty, did the Overpass query fail?`);
    check(out === 0, `layer '${name}' has ${out} points outside the map`);
    check(degenerate === 0, `layer '${name}' has ${degenerate} lines with under two points`);
  }

  const places = doc.places || [];
  for (const t of [1, 2, 3]) check(places.some((p) => p.tier === t), `no tier ${t} places`);
  const wet = places.filter((p) => !nearLand(p.x * 1000, p.y * 1000)).map((p) => p.n);
  // A few district nodes sit on reclaimed land or piers newer than the DEM.
  check(wet.length <= Math.max(3, places.length * 0.01), `place labels in the sea: ${wet.join(', ')}`);
  const names = new Map();
  for (const p of places) names.set(p.n, (names.get(p.n) || 0) + 1);
  const dup = [...names].filter(([, c]) => c > 1).map(([n]) => n);
  console.log(`\n  ${places.length} place labels, `
    + [1, 2, 3].map((t) => `${places.filter((p) => p.tier === t).length} in tier ${t}`).join(', ')
    + (wet.length ? `, ${wet.length} on the shore line: ${wet.join(', ')}` : '')
    + (dup.length ? `, ${dup.length} names used twice` : ''));
  for (const t of ['Fukuoka', 'Kumamoto', 'Kagoshima', 'Nagasaki', 'Oita', 'Miyazaki']) {
    check(places.some((p) => p.n === t && p.tier === 1), `${t} should be a tier 1 city`);
  }
  const known = new Set([...places.map((p) => p.n), ...LANDMARKS.map((a) => a.n)]);
  for (const v of VOLCANOES) for (const r of v.refs) {
    check(known.has(r), `${v.name} readout place '${r}' is not in the place list`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nOK - terrain, vents, places and map layers agree');
process.exit(fail ? 1 : 0);
