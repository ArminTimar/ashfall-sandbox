// three.js scene: displaced terrain mesh, draped texture, particle cloud,
// hand-rolled orbit controls and HTML place labels.
//
// Axes: +X east, +Y up, -Z north. The plane's row 0 is the northern edge and
// carries UV v = 1, which with the default flipY on a CanvasTexture maps to
// canvas row 0 — hence the north-up texture convention in js/grid.js.

import { N, KMW, KMH, XW, XE, YS, YN, PLACES, P } from './params.js';
import { elev } from './terrain.js';
import { elevAtSmooth } from './terrain.js';
import { NP, seedParticles, stepParticles } from './particles.js';
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

export const orbit = { az: -0.62, el: 0.34, dist: 74, tx: 0, ty: 5.0, tz: 0 };

export const VIEWS = {
  oblique: { az: -0.62, el: 0.34, dist: 74, tx: 0, ty: 5.0, tz: 0 },
  top:     { az: 0,     el: 1.48, dist: 64, tx: 3, ty: 0,   tz: -6 },
  city:    { az: 1.46,  el: 0.12, dist: 30, tx: -4, ty: 3.0, tz: 0 }
};

export function initScene(hostEl) {
  host = hostEl;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1014);
  scene.fog = new THREE.Fog(0x0c1014, 70, 150);
  cam = new THREE.PerspectiveCamera(42, 1, 0.5, 400);

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
  ppos = new Float32Array(NP * 3);
  pcol = new Float32Array(NP * 3);
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
  resize();
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
export function addVectors(doc) { return buildVectors(doc, scene); }

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
    orbit.dist = Math.max(9, Math.min(150, orbit.dist * (1 + Math.sign(e.deltaY) * 0.09)));
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

function buildLabels() {
  const wrap = document.getElementById('labels');
  labelEls = PLACES.map((pl) => {
    const el = document.createElement('div');
    el.className = 'pin' + (pl.vent ? ' vent' : '');
    el.textContent = pl.n;
    wrap.appendChild(el);
    return { el, pl };
  });
}

function updateLabels() {
  const w = host.clientWidth, h = host.clientHeight;
  for (const L of labelEls) {
    const e = (elevAtSmooth(L.pl.x, L.pl.y) / 1000) * P.ex;
    _v.set(L.pl.x, e + (L.pl.vent ? 0.4 : 0.15), -L.pl.y).project(cam);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
    L.el.classList.toggle('on', vis);
    if (vis) {
      L.el.style.left = (_v.x * 0.5 + 0.5) * w + 'px';
      L.el.style.top = (-_v.y * 0.5 + 0.5) * h + 'px';
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
