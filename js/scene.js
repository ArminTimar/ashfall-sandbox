// three.js scene: level-of-detail terrain, sea and sky, particle clouds,
// camera controls and HTML labels.
//
// Axes: +x east, +y up, +z south, in kilometres of EPSG:6670. So a point at
// easting E and northing N metres sits at (E / 1000, height, -N / 1000).

import { GRID, P, LANDMARKS } from './params.js';
import { elevAtSmooth } from './terrain.js';
import { NP_TOTAL, stepCloud } from './particles.js';
import { getCanvas, PALETTE } from './texture.js';
import { initTerrainMesh, updateTerrainLOD, invalidateTerrain, terrainStats } from './terrainmesh.js';
import { buildVectors, updateVectorHeights, updateVectorView, setLayerVisible, setVectorTheme } from './vectors.js';
import { VOLCANOES } from './volcanoes.js';

// Module-private and assigned in initScene. Reach them through the functions
// below, so tools/bundle.mjs never has to deal with reassigned exports.
let scene, cam, renderer, tex, points, sea, sky, ambient, keyLight, fillLight;
let pgeo, ppos, pcol, host;
const labelEls = [];
const _v = new THREE.Vector3();

// Camera: orbit around a target. `focus` is a volcano id the target follows,
// or null for free movement. `goal` holds a view the camera is flying to.
export const orbit = { az: -0.5, el: 0.42, dist: 90, tx: 0, tz: 0, focus: 'sakurajima' };
let goal = null;
let onFocusChange = () => {};

const DIST_MIN = 2, DIST_MAX = 620;

function mapCentre() {
  return { x: (GRID.west + GRID.east) / 2000, z: -(GRID.south + GRID.north) / 2000 };
}

export function initScene(hostEl, opts = {}) {
  host = hostEl;
  if (opts.onFocusChange) onFocusChange = opts.onFocusChange;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c1014, 200, 900);
  cam = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);

  // preserveDrawingBuffer keeps the last frame readable, so the canvas can be
  // saved as an image.
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.insertBefore(renderer.domElement, host.firstChild);

  tex = new THREE.CanvasTexture(getCanvas());
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const terrainMat = new THREE.MeshLambertMaterial({
    map: tex, side: THREE.DoubleSide,
    // Push the ground a hair away from the camera so draped lines win the
    // depth test against the surface they follow.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  initTerrainMesh(scene, terrainMat);

  // Sea to the horizon. It sits just below sea level so the terrain's own sea
  // cells, which carry any ash that fell on water, draw on top of it.
  const c = mapCentre();
  sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshLambertMaterial({ color: 0x122029 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(c.x, -0.01, c.z);
  scene.add(sea);

  // Sky: a gradient dome that moves with the camera and ignores fog.
  sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0c1014) }, horizon: { value: new THREE.Color(0x0c1014) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); '
      + 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { '
      + 'float t = pow(clamp(vDir.y, 0.0, 1.0), 0.5); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }'
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  ambient = new THREE.AmbientLight(0x8095a8, 0.62);
  scene.add(ambient);
  keyLight = new THREE.DirectionalLight(0xfff0dd, 0.95);
  keyLight.position.set(-40, 55, 30);
  scene.add(keyLight);
  fillLight = new THREE.DirectionalLight(0x5f7f9c, 0.3);
  fillLight.position.set(35, 20, -40);
  scene.add(fillLight);

  pgeo = new THREE.BufferGeometry();
  ppos = new Float32Array(NP_TOTAL * 3);
  pcol = new Float32Array(NP_TOTAL * 3);
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
  points = new THREE.Points(pgeo, new THREE.PointsMaterial({
    size: 0.42, vertexColors: true, transparent: true, opacity: 0.72,
    sizeAttenuation: true, depthWrite: false
  }));
  points.frustumCulled = false;
  scene.add(points);

  const v = VOLCANOES.find((x) => x.id === orbit.focus);
  if (v) { orbit.tx = v.E / 1000; orbit.tz = -v.N / 1000; }

  applyTheme(P.theme);
  bindControls();
  buildLabels();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);
  resize();
  // The scene's size comes from the flex layout, which changes without a
  // window resize, so watch the element itself.
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
}

/** Colours, lights and blending for 'dark' or 'light'. */
export function applyTheme(theme) {
  P.theme = theme;
  const dark = theme === 'dark';
  const C = PALETTE[theme];
  const seaCol = new THREE.Color(`rgb(${C.sea[0]},${C.sea[1]},${C.sea[2]})`);
  const skyTop = new THREE.Color(dark ? 0x0c1014 : 0x4f8fd0);
  const horizon = new THREE.Color(dark ? 0x10161c : 0xcfe2f1);
  scene.background = horizon;
  scene.fog.color.copy(horizon);
  sky.material.uniforms.top.value.copy(skyTop);
  sky.material.uniforms.horizon.value.copy(horizon);
  sea.material.color.copy(seaCol);
  ambient.color.setHex(dark ? 0x8095a8 : 0xdde6ee);
  ambient.intensity = dark ? 0.62 : 0.72;
  keyLight.intensity = dark ? 0.95 : 0.85;
  fillLight.intensity = dark ? 0.3 : 0.25;
  const pm = points.material;
  pm.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
  pm.opacity = dark ? 0.72 : 0.85;
  pm.needsUpdate = true;
  setVectorTheme(theme);
  host.dataset.theme = theme;
}

export function applyExaggeration() {
  invalidateTerrain();
  updateVectorHeights();
}

export function markTextureDirty() { if (tex) tex.needsUpdate = true; }

/** Add the OpenStreetMap layers and settlement labels. */
export function addVectors(doc) {
  addPlaceLabels(doc.places);
  return buildVectors(doc, scene);
}

export function setVectorLayer(id, on) { setLayerVisible(id, on); }

export function setPlumeVisible(v) { if (points) points.visible = v; }

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function clampOrbit() {
  const m = 15;
  orbit.tx = Math.max(GRID.west / 1000 - m, Math.min(GRID.east / 1000 + m, orbit.tx));
  orbit.tz = Math.max(-GRID.north / 1000 - m, Math.min(-GRID.south / 1000 + m, orbit.tz));
  orbit.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, orbit.dist));
  orbit.el = Math.max(0.05, Math.min(1.5, orbit.el));
}

/** Move the target in screen directions by a number of pixels. */
function pan(dxPx, dyPx) {
  const scale = (orbit.dist * 2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(host.clientHeight, 1);
  const rx = Math.cos(orbit.az), rz = -Math.sin(orbit.az);    // screen right on the ground
  const fx = -Math.sin(orbit.az), fz = -Math.cos(orbit.az);   // screen up on the ground
  const k = scale / Math.max(Math.sin(orbit.el), 0.35);
  orbit.tx -= (rx * dxPx) * scale - (fx * dyPx) * k;
  orbit.tz -= (rz * dxPx) * scale - (fz * dyPx) * k;
  goal = null;
  setFocus(null);
}

function bindControls() {
  const el = host;
  const pointers = new Map();
  let mode = null, pinch = null;

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.views, .legend-box')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    goal = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      mode = 'pinch';
    } else {
      mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit';
    }
  });
  el.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch.d > 0) orbit.dist *= pinch.d / Math.max(d, 1);
      pan(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
    } else if (mode === 'pan') {
      pan(cur.x - prev.x, cur.y - prev.y);
    } else if (mode === 'orbit') {
      orbit.az -= (cur.x - prev.x) * 0.006;
      orbit.el += (cur.y - prev.y) * 0.005;
    }
    clampOrbit();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { mode = null; el.classList.remove('drag'); }
    else if (pointers.size === 1) { mode = 'orbit'; pinch = null; }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal = null;
    orbit.dist *= 1 + Math.sign(e.deltaY) * 0.1;
    clampOrbit();
  }, { passive: false });
}

/** Follow a volcano with the camera target, or pass null to move freely. */
export function setFocus(id) {
  if (orbit.focus === id) return;
  orbit.focus = id;
  onFocusChange(id);
}

/**
 * Fly to a named view. Around the focus volcano: 'oblique' and 'plan'.
 * 'kyushu' shows the whole island.
 */
export function setView(name) {
  const v = VOLCANOES.find((x) => x.id === orbit.focus);
  const c = mapCentre();
  const tx = v ? v.E / 1000 : orbit.tx, tz = v ? -v.N / 1000 : orbit.tz;
  if (name === 'oblique') goal = { az: -0.5, el: 0.42, dist: 90, tx, tz };
  else if (name === 'plan') goal = { az: 0, el: 1.48, dist: 150, tx, tz };
  else if (name === 'kyushu') {
    goal = { az: -0.25, el: 0.95, dist: 520, tx: c.x, tz: c.z };
    setFocus(null);
  }
}

/** Fly the target to a volcano and follow it. */
export function flyTo(id) {
  const v = VOLCANOES.find((x) => x.id === id);
  if (!v) return;
  setFocus(id);
  goal = { az: orbit.az, el: Math.max(orbit.el, 0.3), dist: Math.min(orbit.dist, 110), tx: v.E / 1000, tz: -v.N / 1000 };
}

function updateCam(dt) {
  if (goal) {
    const k = 1 - Math.exp(-dt * 3.5);
    let daz = goal.az - orbit.az;
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    orbit.az += daz * k;
    for (const key of ['el', 'tx', 'tz']) orbit[key] += (goal[key] - orbit[key]) * k;
    orbit.dist = Math.exp(Math.log(orbit.dist) + (Math.log(goal.dist) - Math.log(orbit.dist)) * k);
    if (Math.abs(daz) < 1e-3 && Math.abs(goal.dist / orbit.dist - 1) < 1e-3
        && Math.hypot(goal.tx - orbit.tx, goal.tz - orbit.tz) < 0.01) goal = null;
  } else if (orbit.focus) {
    const v = VOLCANOES.find((x) => x.id === orbit.focus);
    if (v) {
      const k = 1 - Math.exp(-dt * 3.5);
      orbit.tx += (v.E / 1000 - orbit.tx) * k;
      orbit.tz += (-v.N / 1000 - orbit.tz) * k;
    }
  }
  clampOrbit();
  const ground = (elevAtSmooth(orbit.tx * 1000, -orbit.tz * 1000) / 1000) * P.ex;
  const ty = ground + Math.min(orbit.dist * 0.06, 6);
  const ce = orbit.el;
  cam.position.set(
    orbit.tx + orbit.dist * Math.cos(ce) * Math.sin(orbit.az),
    ty + orbit.dist * Math.sin(ce),
    orbit.tz + orbit.dist * Math.cos(ce) * Math.cos(orbit.az)
  );
  // Never under the ground.
  const under = (elevAtSmooth(cam.position.x * 1000, -cam.position.z * 1000) / 1000) * P.ex + 0.2;
  if (cam.position.y < under) cam.position.y = under;
  cam.lookAt(orbit.tx, ty, orbit.tz);
  sky.position.copy(cam.position);
  scene.fog.near = orbit.dist * 1.1;
  scene.fog.far = orbit.dist * 4 + 250;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// Ranks, most important first. When two labels overlap on screen the lower
// rank is hidden. maxDist hides a rank entirely when the camera is farther
// than that many km, so small places only appear when zoomed in.
const RANK = {
  vent:    { rank: 0, maxDist: Infinity, lift: 0.4 },
  t1:      { rank: 1, maxDist: Infinity, lift: 0.15 },
  airport: { rank: 2, maxDist: 220, lift: 0.15 },
  t2:      { rank: 3, maxDist: 260, lift: 0.15 },
  t3:      { rank: 4, maxDist: 70, lift: 0.15 }
};
let showPlaces = true;

function addLabel(wrap, name, E, N, cls, extra = {}) {
  const el = document.createElement('div');
  el.className = 'pin ' + cls;
  el.textContent = name;
  wrap.appendChild(el);
  labelEls.push(Object.assign({ el, E, N, cls, w: 0, h: 0, on: undefined }, RANK[cls], extra));
}

function buildLabels() {
  const wrap = document.getElementById('labels');
  for (const v of VOLCANOES) addLabel(wrap, v.name, v.E, v.N, 'vent', { volcano: v });
  for (const a of LANDMARKS) addLabel(wrap, a.n, a.E, a.N, 'airport');
  sortLabels();
  measureLabels();
}

function addPlaceLabels(places) {
  const wrap = document.getElementById('labels');
  for (const p of places || []) addLabel(wrap, p.n, p.x * 1000, p.y * 1000, 't' + p.tier);
  sortLabels();
  measureLabels();
}

function sortLabels() { labelEls.sort((a, b) => a.rank - b.rank); }

function measureLabels() {
  for (const L of labelEls) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
}

export function setPlacesVisible(on) { showPlaces = !!on; }

/** Mark which volcanoes are erupting, for the label style. */
export function refreshVentLabels() {
  for (const L of labelEls) if (L.volcano) L.el.classList.toggle('erupting', !!L.volcano.erupting);
}

const placed = [];
function updateLabels() {
  const w = host.clientWidth, h = host.clientHeight;
  placed.length = 0;
  for (const L of labelEls) {
    let vis = orbit.dist <= L.maxDist && (showPlaces || L.rank === 0);
    let sx = 0, sy = 0;
    if (vis) {
      const e = (elevAtSmooth(L.E, L.N) / 1000) * P.ex;
      _v.set(L.E / 1000, e + L.lift, -L.N / 1000).project(cam);
      vis = _v.z < 1 && Math.abs(_v.x) < 1.02 && Math.abs(_v.y) < 1.02;
      sx = (_v.x * 0.5 + 0.5) * w; sy = (-_v.y * 0.5 + 0.5) * h;
    }
    if (vis) {
      const x0 = sx - L.w / 2 - 3, x1 = sx + L.w / 2 + 3, y0 = sy - L.h - 1, y1 = sy + 3;
      for (const r of placed) {
        if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { vis = L.rank <= 1; break; }
      }
      if (vis) placed.push([x0, y0, x1, y1]);
    }
    if (L.on !== vis) { L.el.classList.toggle('on', vis); L.on = vis; }
    if (vis) L.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

const TINT = {
  dark: (hot, S, c, o) => {
    const dim = 1 - 0.45 * S;               // keep the dense column from blowing out
    c[o] = 0.92 * dim; c[o + 1] = (0.50 + 0.30 * hot) * dim; c[o + 2] = (0.28 + 0.44 * hot) * dim;
  },
  light: (hot, S, c, o) => {
    const g = 0.16 + 0.22 * hot + 0.08 * (1 - S);
    c[o] = g; c[o + 1] = g * 0.98; c[o + 2] = g * 0.95;
  }
};

/**
 * One animation frame.
 * @param {number} dt wall-clock seconds
 * @param {object} opts { spin }
 */
export function renderFrame(dt, opts) {
  if (opts.spin) {
    orbit.az += dt * 0.09;
    if (goal) goal.az += dt * 0.09;     // keep turning while flying somewhere
  }
  updateCam(dt);
  updateTerrainLOD(cam, host.clientHeight);
  updateVectorView(orbit.dist);
  if (points.visible) {
    let slot = 0;
    const tint = TINT[P.theme];
    for (const v of VOLCANOES) {
      if (!v.erupting || !v.cloud) continue;
      slot = stepCloud(v.cloud, v.p, dt * P.rate, ppos, pcol, slot, tint);
    }
    pgeo.setDrawRange(0, slot);
    pgeo.attributes.position.needsUpdate = true;
    pgeo.attributes.color.needsUpdate = true;
  }
  updateLabels();
  renderer.render(scene, cam);
}

/** The WebGL canvas, for saving images. */
export function getRenderCanvas() { return renderer.domElement; }

export function debugStats() {
  return { orbit: Object.assign({}, orbit), terrain: terrainStats(), labels: labelEls.filter((l) => l.on).length };
}
