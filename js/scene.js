// three.js scene: displaced terrain mesh, draped texture, particle cloud,
// hand-rolled orbit controls and HTML place labels.
//
// Axes: +X east, +Y up, -Z north. The plane's row 0 is the northern edge and
// carries UV v = 1, which with the default flipY on a CanvasTexture maps to
// canvas row 0 — hence the north-up texture convention in js/grid.js.

import { N, KMW, KMH, XW, XE, YS, YN, PLACES, P } from './params.js';
import { elev } from './terrain.js';
import { elevAtSmooth } from './terrain.js';
import { NP_MAX, seedParticles, stepParticles } from './particles.js';
import { getCanvas } from './texture.js';
import { buildVectors, updateVectorHeights, setLayerVisible } from './vectors.js';

// Module-private and assigned in initScene. Deliberately not exported: these
// are reassigned after load, and exporting a binding that changes forces
// consumers (and tools/bundle.mjs) to care about ES live bindings. Reach them
// through the functions below instead.
let scene, cam, renderer, terrain, tex, points;
let pgeo, ppos, pcol, host, labelEls = [];
let dragging = null;
const _v = new THREE.Vector3();

// The domain is 100 km across. The oblique view frames the inner 60 km or so,
// where nearly every deposit worth looking at lies, and Plan shows it all.
export const orbit = { az: -0.62, el: 0.36, dist: 96, tx: 2, ty: 4.0, tz: -2 };

export const VIEWS = {
  oblique: { az: -0.62, el: 0.36, dist: 96, tx: 2, ty: 4.0, tz: -2 },
  top:     { az: 0,     el: 1.48, dist: 128, tx: 3.4, ty: 0,  tz: -6.5 },
  city:    { az: 1.46,  el: 0.12, dist: 30, tx: -4, ty: 3.0, tz: 0 }
};

export function initScene(hostEl) {
  host = hostEl;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1014);
  scene.fog = new THREE.Fog(0x0c1014, 120, 290);
  cam = new THREE.PerspectiveCamera(42, 1, 0.5, 700);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.insertBefore(renderer.domElement, host.firstChild);

  const geo = new THREE.PlaneGeometry(KMW, KMH, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const offX = (XW + XE) / 2, offZ = -(YS + YN) / 2;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + offX);
    pos.setZ(i, pos.getZ(i) + offZ);
  }
  terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    // Push the filled surface a hair away from the camera so the roads and
    // railways draped on it are not in a depth fight with the ground they
    // follow.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  }));
  scene.add(terrain);

  tex = new THREE.CanvasTexture(getCanvas());
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  terrain.material.map = tex;
  terrain.material.needsUpdate = true;

  scene.add(new THREE.AmbientLight(0x8095a8, 0.62));
  const key = new THREE.DirectionalLight(0xfff0dd, 0.95);
  key.position.set(-40, 55, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x5f7f9c, 0.3);
  fill.position.set(35, 20, -40);
  scene.add(fill);

  pgeo = new THREE.BufferGeometry();
  ppos = new Float32Array(NP_MAX * 3);
  pcol = new Float32Array(NP_MAX * 3);
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
  points = new THREE.Points(pgeo, new THREE.PointsMaterial({
    size: 0.42, vertexColors: true, transparent: true, opacity: 0.72,
    sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  scene.add(points);

  seedParticles();
  applyExaggeration();
  bindControls();
  buildLabels();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);
  resize();
  // The scene's height comes from the flex layout, which changes without a
  // window resize — web fonts arriving, the readout row reflowing — so watch
  // the element itself or the canvas ends up stretched.
  if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
}

export function applyExaggeration() {
  const pos = terrain.geometry.attributes.position;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      pos.setY(y * N + x, (elev[y * N + x] / 1000) * P.ex);
    }
  }
  pos.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
  updateVectorHeights();
}

export function markTextureDirty() { if (tex) tex.needsUpdate = true; }

/** Add the OpenStreetMap layers. Safe to skip; the scene works without them. */
export function addVectors(doc) {
  addPlaceLabels(doc.places);
  return buildVectors(doc, scene);
}

/** Show or hide one vector layer by id. */
export function setVectorLayer(id, on) { setLayerVisible(id, on); }

/** Show or hide the falling-particle cloud. */
export function setPlumeVisible(v) { if (points) points.visible = v; }
export function isPlumeVisible() { return !!points && points.visible; }

function bindControls() {
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.views')) return;
    dragging = { x: e.clientX, y: e.clientY };
    host.classList.add('drag');
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit.az -= (e.clientX - dragging.x) * 0.006;
    orbit.el += (e.clientY - dragging.y) * 0.005;
    dragging = { x: e.clientX, y: e.clientY };
  });
  const end = () => { dragging = null; host.classList.remove('drag'); };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = Math.max(9, Math.min(260, orbit.dist * (1 + Math.sign(e.deltaY) * 0.09)));
  }, { passive: false });
}

export function setView(name) {
  const v = VIEWS[name];
  if (v) for (const k in v) orbit[k] = v[k];
}

export function isDragging() { return !!dragging; }

function updateCam() {
  const ce = Math.max(0.06, Math.min(1.50, orbit.el));
  cam.position.set(
    orbit.tx + orbit.dist * Math.cos(ce) * Math.sin(orbit.az),
    orbit.ty + orbit.dist * Math.sin(ce),
    orbit.tz + orbit.dist * Math.cos(ce) * Math.cos(orbit.az)
  );
  cam.lookAt(orbit.tx, orbit.ty, orbit.tz);
}

// Label ranks, most important first. When two labels would overlap on screen,
// the lower-ranked one is hidden, so zooming in reveals smaller places. The
// vent and cities over 50,000 are always shown.
const RANK = { vent: 0, t1: 1, peak: 2, airport: 2, t2: 3, t3: 4 };

function addLabel(wrap, name, x, y, cls) {
  const el = document.createElement('div');
  el.className = 'pin ' + cls;
  el.textContent = name;
  wrap.appendChild(el);
  labelEls.push({ el, x, y, rank: RANK[cls], lift: cls === 'vent' || cls === 'peak' ? 0.4 : 0.15, w: 0, h: 0 });
}

function buildLabels() {
  const wrap = document.getElementById('labels');
  for (const pl of PLACES) {
    if (pl.kind === 'readout') continue;     // drawn from the data file instead
    addLabel(wrap, pl.n, pl.x, pl.y, pl.kind);
  }
  sortLabels();
  measureLabels();
}

/** Towns and cities from data/vectors.json. */
function addPlaceLabels(places) {
  const wrap = document.getElementById('labels');
  for (const p of places || []) addLabel(wrap, p.n, p.x, p.y, 't' + p.tier);
  sortLabels();
  measureLabels();
}

function sortLabels() { labelEls.sort((a, b) => a.rank - b.rank); }

/** Label boxes are measured once, and again when web fonts arrive. */
function measureLabels() {
  for (const L of labelEls) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
}

export function setPlacesVisible(on) {
  showPlaces = !!on;
}
let showPlaces = true;

const placed = [];
function updateLabels() {
  const w = host.clientWidth, h = host.clientHeight;
  placed.length = 0;
  for (const L of labelEls) {
    const e = (elevAtSmooth(L.x, L.y) / 1000) * P.ex;
    _v.set(L.x, e + L.lift, -L.y).project(cam);
    let vis = _v.z < 1 && Math.abs(_v.x) < 1.02 && Math.abs(_v.y) < 1.02;
    if (vis && !showPlaces && L.rank > 0) vis = false;
    const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
    if (vis) {
      const x0 = sx - L.w / 2 - 3, x1 = sx + L.w / 2 + 3, y0 = sy - L.h - 1, y1 = sy + 3;
      for (const r of placed) {
        if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { vis = L.rank <= 1; break; }
      }
      if (vis) placed.push([x0, y0, x1, y1]);
    }
    if (L.on !== vis) { L.el.classList.toggle('on', vis); L.on = vis; }
    if (vis) {
      L.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

export function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

/** One animation frame. dt is wall-clock seconds. */
export function renderFrame(dt, opts) {
  if (opts.spin && !dragging) orbit.az += dt * 0.09;
  if (points.visible) {
    // An eruption run empties the sky, so only the written slots are drawn;
    // the rest of the buffer holds stale positions and must not be rendered.
    const n = stepParticles(dt * P.rate, ppos, pcol);
    pgeo.setDrawRange(0, n);
    pgeo.attributes.position.needsUpdate = true;
    pgeo.attributes.color.needsUpdate = true;
  }
  updateCam();
  updateLabels();
  renderer.render(scene, cam);
}
