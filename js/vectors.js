// Roads, railways and prefecture borders draped over the terrain.
//
// data/vectors.json is built by tools/build_vectors.py from OpenStreetMap
// (© OpenStreetMap contributors, ODbL 1.0) and holds kilometres of EPSG:6670,
// the same system as the terrain grid.
//
// The lines are three.js line segments, not paint in the deposit texture. The
// texture is one pixel per 200 m, so a painted road would be a blurry band.
//
// Far from the camera the terrain is drawn with fewer vertices than the lines
// follow, so lines would dip under ridges. Each layer is lifted in the vertex
// shader by an amount that grows with camera distance, which keeps them on top
// without rebuilding any geometry.

import { P } from './params.js';
import { elevAtSmooth } from './terrain.js';

// Resample interval along a line, in km, so long straight runs follow the hills.
const STEP = 0.4;

// Drawing order matters: later layers win at equal height, so borders sit above
// the roads they cross. maxDist hides a layer when the camera is farther away
// than that many km.
export const LAYERS = [
  { id: 'minor',    color: { dark: 0x9aa7ae, light: 0x6f6a60 }, opacity: 0.40, lift: 0.010, maxDist: 90 },
  { id: 'major',    color: { dark: 0xd9cfbe, light: 0x8a5a3c }, opacity: 0.62, lift: 0.013, maxDist: Infinity },
  { id: 'rail',     color: { dark: 0x7fc7e8, light: 0x2c4f8f }, opacity: 0.70, lift: 0.016, maxDist: Infinity },
  { id: 'boundary', color: { dark: 0xf0b45c, light: 0x8e3b8e }, opacity: 0.75, lift: 0.019, maxDist: Infinity }
];

// What the checkboxes control. Roads are one switch over two drawn layers.
export const TOGGLES = [
  { id: 't-road', layers: ['major', 'minor'], label: 'Roads' },
  { id: 't-rail', layers: ['rail'],           label: 'Rail' },
  { id: 't-pref', layers: ['boundary'],       label: 'Prefecture borders' }
];

const built = new Map();   // layer id -> { obj, xs, zs, pos, spec, uniforms, on }

/**
 * Fetch the vector file. Accepts an already-parsed object so the standalone
 * bundle can inline it, since fetch() cannot read a file:// URL.
 */
export function loadVectors(src = 'data/vectors.json') {
  if (typeof src !== 'string') return Promise.resolve(src);
  return fetch(src).then((r) => {
    if (!r.ok) throw new Error('could not load ' + src);
    return r.json();
  });
}

/** Line-segment endpoint pairs, resampled so no piece is longer than STEP. */
function resample(lines) {
  const xs = [], ys = [];
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
        ys.push(py, qy);
        px = qx; py = qy;
      }
    }
  }
  return { xs, ys };
}

function liftedMaterial(color, opacity) {
  const uniforms = { uLift: { value: 0 } };
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLift = uniforms.uLift;
    shader.vertexShader = 'uniform float uLift;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += uLift;');
  };
  return { mat, uniforms };
}

/** Build the line meshes and add them to the scene. Returns vertex count. */
export function buildVectors(doc, scene) {
  let total = 0;
  for (const L of LAYERS) {
    const lines = doc.layers[L.id] || [];
    if (!lines.length) continue;
    const { xs, ys } = resample(lines);
    const n = xs.length;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const { mat, uniforms } = liftedMaterial(L.color[P.theme], L.opacity);
    const obj = new THREE.LineSegments(geo, mat);
    obj.renderOrder = 1;
    obj.frustumCulled = false;
    scene.add(obj);
    built.set(L.id, { obj, xs: Float32Array.from(xs), ys: Float32Array.from(ys), pos, spec: L, uniforms, on: true });
    total += n;
  }
  updateVectorHeights();
  return total;
}

/** Re-drape every line on the terrain, after the vertical exaggeration changes. */
export function updateVectorHeights() {
  for (const B of built.values()) {
    const { xs, ys, pos } = B;
    for (let i = 0; i < xs.length; i++) {
      pos[i * 3] = xs[i];
      pos[i * 3 + 1] = elevAtSmooth(xs[i] * 1000, ys[i] * 1000) / 1000;
      pos[i * 3 + 2] = -ys[i];
    }
    B.obj.geometry.attributes.position.needsUpdate = true;
    B.obj.geometry.computeBoundingSphere();
  }
}

/** Per-frame: lift with camera distance, hide detail layers when far away. */
export function updateVectorView(camDist) {
  for (const B of built.values()) {
    // The lift is a distance on screen, so it is divided by the vertical
    // scale the world group applies.
    B.uniforms.uLift.value = (B.spec.lift + camDist * 0.0008) / Math.max(P.ex, 0.01);
    B.obj.visible = B.on && camDist <= B.spec.maxDist;
  }
}

/** Show or hide one drawn layer by id. */
export function setLayerVisible(id, on) {
  const B = built.get(id);
  if (B) { B.on = !!on; B.obj.visible = B.on; }
}

/** Recolour the layers for a theme. */
export function setVectorTheme(theme) {
  for (const B of built.values()) B.obj.material.color.setHex(B.spec.color[theme]);
}

export function hasVectors() { return built.size > 0; }
