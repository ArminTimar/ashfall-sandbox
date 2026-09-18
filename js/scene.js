// three.js scene: terrain, sea and sky, particle clouds, camera controls and
// HTML labels.
//
// Axes: +x east, +y up, +z south, in kilometres of EPSG:6670. So a point at
// easting E and northing N metres sits at (E / 1000, height, -N / 1000).

import { GRID, P, LANDMARKS } from './params.js';
import { elevAtSmooth } from './terrain.js';
import { NP_TOTAL, stepCloud } from './particles.js';
import { getCanvas, PALETTE } from './texture.js';
import { initTerrainMesh, terrainStats } from './terrainmesh.js';
import { buildVectors, updateVectorView, setLayerVisible, setVectorTheme } from './vectors.js';
import { VOLCANOES } from './volcanoes.js';

// Module-private and assigned in initScene. Reach them through the functions
// below, so tools/bundle.mjs never has to deal with reassigned exports.
let scene, cam, renderer, tex, points, sea, sky, ambient, keyLight, fillLight, world;
let pgeo, ppos, pcol, host;
const labelEls = [];
const _v = new THREE.Vector3();

// Camera: orbit around a target. `focus` is a volcano id the target follows,
// or null for free movement. `goal` holds a view the camera is flying to.
export const orbit = { az: -0.5, el: 0.42, dist: 90, tx: 0, tz: 0, focus: 'sakurajima' };
let goal = null;
let onFocusChange = () => {};

const DIST_MIN = 2, DIST_MAX = 620;
// The sea plane sits below sea level, so ground at 0 m still covers it. The
// terrain's own sea cells carry any ash that fell on water and draw on top.
const SEA_DEPTH = -0.02;

function mapCentre() {
  return { x: (GRID.west + GRID.east) / 2000, z: -(GRID.south + GRID.north) / 2000 };
}

export function initScene(hostEl, opts = {}) {
  host = hostEl;
  if (opts.onFocusChange) onFocusChange = opts.onFocusChange;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c1014, 200, 900);
  cam = new THREE.PerspectiveCamera(42, 1, 0.5, 2000);

  // preserveDrawingBuffer keeps the last frame readable, so the canvas can be
  // saved as an image.
  // logarithmicDepthBuffer because the view spans a few hundred metres to
  // hundreds of kilometres. With an ordinary depth buffer there is no
  // precision left at that range, and flat ground a few metres above sea level
  // loses the depth test against the sea, so the Saga and Kurume plains
  // flickered underwater.
  renderer = new THREE.WebGLRenderer({
    antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.insertBefore(renderer.domElement, host.firstChild);

  tex = new THREE.CanvasTexture(getCanvas());
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  // Everything that lives on the map goes in one group whose vertical scale
  // is the exaggeration. Heights are stored in real kilometres, so moving that
  // slider is a scale change and nothing is rebuilt.
  world = new THREE.Group();
  scene.add(world);

  // No polygon offset here. It used to push the ground away from the camera so
  // draped roads would win the depth test, but at a shallow viewing angle the
  // offset grows with the depth slope and pushed low ground behind the sea.
  // The roads lift themselves in their own shader instead.
  const terrainMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  initTerrainMesh(world, terrainMat);

  // Sea to the horizon. It sits just below sea level so the terrain's own sea
  // cells, which carry any ash that fell on water, draw on top of it.
  const c = mapCentre();
  sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshLambertMaterial({ color: 0x122029 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(c.x, SEA_DEPTH, c.z);
  world.add(sea);

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
  world.add(points);


  const v = VOLCANOES.find((x) => x.id === orbit.focus);
  if (v) { orbit.tx = v.E / 1000; orbit.tz = -v.N / 1000; }

  applyTheme(P.theme);
  applyExaggeration();
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

/** Vertical exaggeration is the vertical scale of the world group. */
export function applyExaggeration() {
  world.scale.y = P.ex;
}

export function markTextureDirty() { if (tex) tex.needsUpdate = true; }

/** Add the OpenStreetMap layers and settlement labels. */
export function addVectors(doc) {
  addPlaceLabels(doc.places);
  return buildVectors(doc, world);
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
  // Keep the depth range as tight as the view allows.
  const near = Math.max(0.05, Math.min(orbit.dist * 0.02, 4));
  const far = orbit.dist * 8 + 600;
  if (cam.near !== near || cam.far !== far) {
    cam.near = near; cam.far = far;
    cam.updateProjectionMatrix();
  }
  sky.position.copy(cam.position);
  scene.fog.near = orbit.dist * 1.1;
  scene.fog.far = orbit.dist * 4 + 250;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// Every label is a dot at the projected point plus a text box that can move
// around it. Labels never overlap: a name that cannot find a free spot beside
// its dot is hidden, and the text shrinks as the camera pulls back.
//
// Places are grouped by size. Each group has its own switch and its own
// distance beyond which it disappears, so zooming out leaves only the largest
// cities. Places near a volcano can be kept regardless of their size, because
// they are the ones an ashfall map is about.

export const NEAR_KM = 30;

export const LABEL_CLASSES = [
  { id: 'major',    name: 'Major cities, 300k+', rank: 1, maxDist: Infinity, on: true },
  { id: 'city',     name: 'Cities, 100k+',       rank: 2, maxDist: 340, on: true },
  { id: 'airport',  name: 'Airports',            rank: 3, maxDist: 200, on: true },
  { id: 'town',     name: 'Towns, 10k+',         rank: 4, maxDist: 150, on: false },
  { id: 'village',  name: 'Villages',            rank: 5, maxDist: 70,  on: false },
  { id: 'district', name: 'Districts',           rank: 6, maxDist: 45,  on: false }
];
const CLASS = Object.fromEntries(LABEL_CLASSES.map((c) => [c.id, c]));
const VENT = { rank: 0, maxDist: Infinity, on: true };
// Near a volcano, small places stay on and stay visible from farther away.
let showNear = true;
const NEAR_DIST = 160;

/** Which size group a place belongs to. */
function placeClass(p) {
  if (p.tier === 3) return 'district';
  const pop = p.pop || 0;
  if (pop >= 300000) return 'major';
  if (pop >= 100000) return 'city';
  if (pop >= 10000) return 'town';
  return 'village';
}

function addLabel(wrap, name, E, N, cls, extra = {}) {
  const dot = document.createElement('i');
  dot.className = 'pin-dot ' + cls;
  wrap.appendChild(dot);
  const el = document.createElement('div');
  el.className = 'pin ' + cls;
  el.textContent = name;
  wrap.appendChild(el);
  const spec = cls === 'vent' ? VENT : CLASS[cls];
  labelEls.push(Object.assign({
    el, dot, E, N, cls, rank: spec.rank, maxDist: spec.maxDist,
    lift: cls === 'vent' ? 0.4 : 0.05, near: false, w: 0, h: 0, on: undefined
  }, extra));
}

function buildLabels() {
  const wrap = labelWrap = document.getElementById('labels');
  for (const v of VOLCANOES) addLabel(wrap, v.name, v.E, v.N, 'vent', { volcano: v });
  for (const a of LANDMARKS) addLabel(wrap, a.n, a.E, a.N, 'airport');
  sortLabels();
  measureLabels();
}

function addPlaceLabels(places) {
  const wrap = document.getElementById('labels');
  for (const p of places || []) {
    const E = p.x * 1000, N = p.y * 1000;
    const near = VOLCANOES.some((v) => Math.hypot(v.E - E, v.N - N) < NEAR_KM * 1000);
    addLabel(wrap, p.n, E, N, placeClass(p), { near, pop: p.pop || 0 });
  }
  sortLabels();
  measureLabels();
}

// Vents first, then by group, then by population, so the biggest place wins a
// contested spot.
function sortLabels() {
  labelEls.sort((a, b) => a.rank - b.rank || (b.pop || 0) - (a.pop || 0));
}

function measureLabels() {
  for (const L of labelEls) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
}

/** Turn place groups on or off: { major: true, town: false, near: true, ... } */
export function setLabelClasses(cfg) {
  for (const c of LABEL_CLASSES) if (c.id in cfg) c.on = !!cfg[c.id];
  if ('near' in cfg) showNear = !!cfg.near;
}

/** Mark which volcanoes are erupting, for the label style. */
export function refreshVentLabels() {
  for (const L of labelEls) if (L.volcano) L.el.classList.toggle('erupting', !!L.volcano.erupting);
}

// Where the text may sit relative to its dot: above it first, then beside it,
// then below. dx and dy are pixels, ax and ay are percentages of the text box.
const SPOTS = [
  [0, -7, -50, -100],
  [9, 0, 0, -50],
  [-9, 0, -100, -50],
  [0, 9, -50, 0],
  [9, -7, 0, -100],
  [-9, -7, -100, -100]
];

const placed = [];
let fontScale = 0;
// The scale lives on the label layer itself: #labels declares the variable, so
// setting it on an ancestor would be shadowed and nothing would change size.
let labelWrap = null;

function updateLabels() {
  const w = host.clientWidth, h = host.clientHeight;
  // Smaller text when zoomed out, which also leaves room for more names.
  const wantScale = Math.max(0.72, Math.min(1, 1.12 - orbit.dist / 900));
  if (Math.abs(wantScale - fontScale) > 0.02) {
    fontScale = wantScale;
    if (labelWrap) labelWrap.style.setProperty('--pin-scale', wantScale.toFixed(2));
  }
  placed.length = 0;
  for (const L of labelEls) {
    const spec = L.cls === 'vent' ? VENT : CLASS[L.cls];
    const near = showNear && L.near;
    let vis = (spec.on || near) && orbit.dist <= (near ? Math.max(spec.maxDist, NEAR_DIST) : spec.maxDist);
    let sx = 0, sy = 0;
    if (vis) {
      const e = (elevAtSmooth(L.E, L.N) / 1000) * P.ex;
      _v.set(L.E / 1000, e + L.lift, -L.N / 1000).project(cam);
      vis = _v.z < 1 && Math.abs(_v.x) < 1.02 && Math.abs(_v.y) < 1.02;
      sx = (_v.x * 0.5 + 0.5) * w; sy = (-_v.y * 0.5 + 0.5) * h;
    }
    let spot = null;
    if (vis) {
      const lw = L.w * fontScale, lh = L.h * fontScale;
      for (const [dx, dy, ax, ay] of SPOTS) {
        const x0 = sx + dx + (lw * ax) / 100 - 2, y0 = sy + dy + (lh * ay) / 100 - 1;
        const x1 = x0 + lw + 4, y1 = y0 + lh + 2;
        let clash = false;
        for (const r of placed) {
          if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { clash = true; break; }
        }
        if (!clash) { spot = [dx, dy, ax, ay]; placed.push([x0, y0, x1, y1]); break; }
      }
      vis = !!spot;
    }
    if (L.on !== vis) {
      L.el.classList.toggle('on', vis);
      L.dot.classList.toggle('on', vis);
      L.on = vis;
    }
    if (vis) {
      L.dot.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      L.el.style.transform = `translate(${(sx + spot[0]).toFixed(1)}px, ${(sy + spot[1]).toFixed(1)}px) `
        + `translate(${spot[2]}%, ${spot[3]}%)`;
    }
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

/** Scene graph handles, for the dev console. */
export function sceneHandles() { return { scene, cam, world, points }; }
