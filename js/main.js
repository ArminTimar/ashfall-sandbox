// Wiring. Load terrain and map data, build the texture, start the scene,
// connect the UI.

import { P } from './params.js';
import { makeField, computeField, clearField } from './physics.js';
import { loadTerrain } from './terrain.js';
import { initTexture, paintTexture, rampCSS } from './texture.js';
import { makeCloud, seedCloud, replayCloud, particleBudget, NP_TOTAL } from './particles.js';
import {
  initScene, renderFrame, resize, setView, flyTo, setFocus, applyExaggeration, markTextureDirty,
  setPlumeVisible, setTrailsVisible, addVectors, setVectorLayer, setLabelClasses, applyTheme, refreshVentLabels,
  orbit, getRenderCanvas, debugStats
} from './scene.js';
import { loadVectors } from './vectors.js';
import { VOLCANOES } from './volcanoes.js';
import {
  bindUI, syncLabels, syncMode, updateClock, updateReadout, selectedVolcano, setPlaces,
  syncFocus, syncTheme
} from './ui.js';

const $ = (id) => document.getElementById(id);
const showContours = () => $('t-cont').checked;

function readTheme() {
  try {
    const t = localStorage.getItem('ashfall-theme');
    if (t === 'dark' || t === 'light') return t;
  } catch (e) { /* storage blocked: use the default */ }
  return 'dark';
}

/** Particle budget for one volcano, shared out when several are erupting. */
function budgetFor(v) {
  const n = VOLCANOES.filter((x) => x.erupting).length;
  return Math.min(particleBudget(v.p.logM), Math.floor(NP_TOTAL / Math.max(n, 1)));
}

function ensure(v) {
  if (!v.field) v.field = makeField();
  if (!v.cloud) v.cloud = makeCloud(v.E, v.N, v.ventZ);
}

function computeVolcano(v) {
  if (v.erupting) {
    ensure(v);
    computeField(v.p, v.E, v.N, v.ventZ, v.field);
  } else if (v.field) {
    clearField(v.field);
  }
}

function repaint() {
  const fields = VOLCANOES.filter((v) => v.field).map((v) => v.field);
  const maxMM = paintTexture(fields, showContours());
  markTextureDirty();
  updateReadout(maxMM);
}

function restartCloud(v) {
  if (!v.erupting) { if (v.cloud) v.cloud.parts.length = 0; return; }
  ensure(v);
  if (P.mode === 'eruption') replayCloud(v.cloud, v.p, budgetFor(v));
  else seedCloud(v.cloud, v.p, budgetFor(v));
}

function recompute(v = selectedVolcano(), { reseed = true } = {}) {
  computeVolcano(v);
  repaint();
  syncLabels();
  // The deposit is a steady-state solution and jumps to the new parameters at
  // once, so a steady cloud is re-seeded to match. An eruption run is left
  // alone, so it can be watched while settings change. Replay starts a new one.
  if (reseed && v.erupting && P.mode !== 'eruption') seedCloud(v.cloud, v.p, budgetFor(v));
}

// While a slider is dragged the deposit updates every frame, but the cloud is
// only re-seeded once the value has stopped changing for a moment. Seeding a
// large cloud takes tens of milliseconds and would otherwise halve the frame
// rate of the drag.
let pending = null, reseedTimer = null;
function schedule() {
  syncLabels();
  const v = selectedVolcano();
  if (pending) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => { pending = null; recompute(v, { reseed: false }); });
  clearTimeout(reseedTimer);
  reseedTimer = setTimeout(() => {
    if (v.erupting && v.cloud && P.mode !== 'eruption') seedCloud(v.cloud, v.p, budgetFor(v));
  }, 180);
}

function setTheme(t) {
  applyTheme(t);
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ashfall-theme', t); } catch (e) { /* not saved */ }
  document.querySelector('.ramp .bar').style.background = rampCSS(t);
  repaint();
  syncTheme();
}

function saveImage() {
  const v = selectedVolcano();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  getRenderCanvas().toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ashfall-${v.id}-${stamp}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  renderFrame(dt, { spin: $('t-spin').checked });
  if (P.mode === 'eruption') updateClock();
  requestAnimationFrame(frame);
}

// Data files carry the release version so a browser never pairs new code with
// cached data from an older release. tools/stamp.mjs writes the meta tag.
const DATA_V = (document.querySelector('meta[name="data-version"]') || {}).content;
const dataUrl = (f) => (DATA_V ? `${f}?v=${DATA_V}` : f);

P.theme = readTheme();
document.documentElement.dataset.theme = P.theme;

// The map layers are optional decoration for a physics model, so they never
// block the terrain. If they fail to load the sandbox still runs without roads.
Promise.all([
  loadTerrain(dataUrl('data/terrain.png'), dataUrl('data/terrain.json')),
  loadVectors(dataUrl('data/vectors.json')).catch((err) => {
    console.warn('map layers unavailable:', err.message);
    return null;
  })
]).then(([, vectors]) => {
  initTexture();
  initScene($('scene'), { onFocusChange: syncFocus });
  if (vectors) { addVectors(vectors); setPlaces(vectors.places); } else setPlaces([]);
  refreshVentLabels();
  document.querySelector('.ramp .bar').style.background = rampCSS(P.theme);

  for (const v of VOLCANOES) computeVolcano(v);
  repaint();
  for (const v of VOLCANOES) restartCloud(v);
  $('loading').classList.add('gone');
  window.addEventListener('resize', resize);

  bindUI({
    onModel: schedule,
    onExaggeration: applyExaggeration,
    onPreset: (v) => recompute(v),
    onSelect: () => { syncLabels(); updateReadout(); repaint(); },
    onErupt: (v) => {
      computeVolcano(v);
      repaint();
      refreshVentLabels();
      for (const x of VOLCANOES) restartCloud(x);
    },
    onFly: (id) => { flyTo(id); syncFocus(id); },
    onFocus: (id) => { if (id) flyTo(id); else setFocus(null); },
    onTheme: setTheme,
    onSave: saveImage,
    onView: setView,
    onReplay: () => { for (const v of VOLCANOES) restartCloud(v); },
    onToggle: () => {
      const on = $('t-part').checked;
      setPlumeVisible(on);
      setTrailsVisible($('t-trail').checked);
      if (on) for (const v of VOLCANOES) restartCloud(v);
      repaint();
    },
    onLayer: (layers, on) => { for (const id of layers) setVectorLayer(id, on); },
    onLabels: setLabelClasses
  });
  syncMode();
  syncTheme();
  syncFocus(orbit.focus);

  requestAnimationFrame(frame);

  // Dev hook for checking state from the console. See test/ for the
  // automated versions.
  window.__ash = { P, VOLCANOES, orbit, recompute, repaint, debugStats, setView, flyTo };
}).catch((err) => {
  $('loading').textContent = 'Terrain failed to load. Is the page being served over http?';
  console.error(err);
});
