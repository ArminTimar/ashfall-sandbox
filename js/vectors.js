// Cultural features draped over the terrain: the Kagoshima city limit, the
// trunk road network and the railways.
//
// data/vectors.json is built by tools/build_vectors.py from OpenStreetMap
// (© OpenStreetMap contributors, ODbL 1.0) and already carries kilometres in
// the model's vent-relative frame, so the only work left here is making the
// lines follow the ground.
//
// They are drawn as three.js line segments rather than painted into the
// deposit texture. The texture is 512 px across a 100 km domain, 195 m per
// pixel, so a road painted there would be a blurry band 195 m wide. It would
// also have to be composited under the ash on every parameter change.
// Real geometry stays sharp at any zoom and costs nothing per frame.

import { P } from './params.js';
import { elevAtSmooth } from './terrain.js';

// Resample interval along a line, in km. Lines are simplified in the build
// script to within 50 m of the true geometry, which leaves long straight runs
// that would otherwise cut through hills between their endpoints.
const STEP = 0.3;

// Drawing order matters: later layers win the depth test at equal height, so
// the city limit sits above the roads it crosses.
export const LAYERS = [
  { id: 'minor',    src: ['minor'],           color: 0x9aa7ae, opacity: 0.40, lift: 0.010 },
  { id: 'major',    src: ['major'],           color: 0xd9cfbe, opacity: 0.62, lift: 0.013 },
  { id: 'rail',     src: ['rail'],            color: 0x7fc7e8, opacity: 0.70, lift: 0.016 },
  { id: 'boundary', src: ['boundary'],        color: 0xf0b45c, opacity: 0.85, lift: 0.019 }
];

// What the checkboxes control. Roads are one switch over two drawn layers so
// the primary and secondary networks can still be styled apart.
export const TOGGLES = [
  { id: 't-road', layers: ['major', 'minor'], label: 'Roads' },
  { id: 't-rail', layers: ['rail'],           label: 'Rail' },
  { id: 't-city', layers: ['boundary'],       label: 'City limit' }
];

const built = new Map();   // layer id -> { obj, xs, zs, pos, lift }

/**
 * Fetch the vector file. Accepts an already-parsed object so the standalone
 * bundle can inline it — fetch() cannot read a file:// URL.
 */
export function loadVectors(src = 'data/vectors.json') {
  if (typeof src !== 'string') return Promise.resolve(src);
  return fetch(src).then((r) => {
    if (!r.ok) throw new Error('could not load ' + src);
    return r.json();
  });
}

/**
 * Walk a list of polylines and emit line-segment endpoint pairs, resampled so
 * no piece is longer than STEP. Returns the x and y (northing) components; the
 * heights are filled in separately because they change with exaggeration.
 */
function resample(lines) {
  const xs = [], zs = [];
  for (const ln of lines) {
    for (let i = 1; i < ln.length; i++) {
      const x0 = ln[i - 1][0], y0 = ln[i - 1][1];
      const x1 = ln[i][0], y1 = ln[i][1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
      let px = x0, py = y0;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const qx = x0 + (x1 - x0) * t;
        const qy = y0 + (y1 - y0) * t;
        xs.push(px, qx);
        zs.push(py, qy);
        px = qx; py = qy;
      }
    }
  }
  return { xs, zs };
}

/** Build the line meshes and add them to the scene. Returns vertex count. */
export function buildVectors(doc, scene) {
  let total = 0;
  for (const L of LAYERS) {
    const lines = L.src.flatMap((k) => doc.layers[k] || []);
    if (!lines.length) continue;
    const { xs, zs } = resample(lines);
    const n = xs.length;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: L.color, transparent: true, opacity: L.opacity, depthWrite: false
    }));
    obj.renderOrder = 1;
    scene.add(obj);
    built.set(L.id, { obj, xs: Float32Array.from(xs), zs: Float32Array.from(zs), pos, lift: L.lift });
    total += n;
  }
  updateVectorHeights();
  return total;
}

/**
 * Re-drape every line on the terrain. Cheap enough to call outright whenever
 * the vertical exaggeration changes.
 *
 * The lift is scaled by the exaggeration because the relief it has to clear
 * grows with it: a fixed offset that clears a ridge at ×1 disappears into the
 * hillside at ×12.
 */
export function updateVectorHeights() {
  for (const B of built.values()) {
    const { xs, zs, pos } = B;
    const lift = B.lift * P.ex;
    for (let i = 0; i < xs.length; i++) {
      pos[i * 3] = xs[i];
      pos[i * 3 + 1] = (elevAtSmooth(xs[i], zs[i]) / 1000) * P.ex + lift;
      pos[i * 3 + 2] = -zs[i];
    }
    B.obj.geometry.attributes.position.needsUpdate = true;
    B.obj.geometry.computeBoundingSphere();
  }
}

/** Show or hide one drawn layer by id. */
export function setLayerVisible(id, on) {
  const B = built.get(id);
  if (B) B.obj.visible = !!on;
}

export function hasVectors() { return built.size > 0; }
