// Wiring. Load terrain and map data, build the texture, start the scene,
// connect the UI.

import { P } from './params.js';
import { makeField, computeField, clearField } from './physics.js';
import { loadTerrain } from './terrain.js';
import { initTexture, paintTexture, rampCSS } from './texture.js';
import { makeCloud, seedCloud, replayCloud, particleBudget, NP_TOTAL } from './particles.js';
import {
  initScene, renderFrame, resize, setView, flyTo, setFocus, applyExaggeration, markTextureDirty,
  setPlumeVisible, addVectors, setVectorLayer, setLabelClasses, applyTheme, refreshVentLabels,
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

/**
 * How many particles to draw for one volcano.
 *
 * On its own, a volcano gets a count that grows slowly with erupted mass, so a
 * small eruption is still visible. When several erupt at once the largest sets
 * the scale and the rest are drawn in proportion to their mass, because a
 * count that compressed four decades of mass into a factor of eight made a
 * phreatic puff look like Taisho. A floor of 30 keeps a small eruption from
 * disappearing entirely.
 */
function budgetFor(v) {
  const on = VOLCANOES.filter((x) => x.erupting);
  if (!v.erupting || !on.length) return 0;
  const maxLog = Math.max(...on.map((x) => x.p.logM));
  const lead = particleBudget(maxLog);
  const share = Math.round(lead * Math.pow(10, v.p.logM - maxLog));
  return Math.min(Math.max(30, share), Math.floor(NP_TOTAL / on.length));
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

// The combined deposit figures from the last repaint, kept so the readouts can
// be redrawn for another volcano without painting the map again.
let lastStats = { maxMM: 0, maxLoad: 0, area1: 0 };

function repaint() {
  const fields = VOLCANOES.filter((v) => v.field).map((v) => v.field);
  lastStats = paintTexture(fields, showContours());
  markTextureDirty();
  updateReadout(lastStats);
}

function restartCloud(v) {
  if (!v.erupting) { if (v.cloud) v.cloud.parts.length = 0; return; }
  ensure(v);
  if (P.mode === 'eruption') replayCloud(v.cloud, v.p, budgetFor(v));
  else seedCloud(v.cloud, v.p, budgetFor(v));
}

/**
 * Re-seed a steady cloud after its volcano's parameters changed.
 *
 * When several volcanoes erupt, each one's particle count is its share of the
 * largest eruption, so changing one mass changes what the others are owed.
 * Those are re-seeded too, but only if their count really moved. An eruption
 * run is never touched: it keeps the count it started with until Replay.
 */
function reseed(v) {
  if (P.mode === 'eruption') return;
  for (const x of VOLCANOES) {
    if (!x.erupting || !x.cloud) continue;
    const n = budgetFor(x);
    if (x === v || x.cloud.clock.budget !== n) seedCloud(x.cloud, x.p, n);
  }
}

function recompute(v = selectedVolcano(), opts = {}) {
  computeVolcano(v);
  repaint();
  syncLabels();
  // The deposit is a steady-state solution and jumps to the new parameters at
  // once, so a steady cloud is re-seeded to match. An eruption run is left
  // alone, so it can be watched while settings change. Replay starts a new one.
  if (opts.reseed !== false) reseed(v);
}

// While a slider is dragged the deposit updates every frame, but the cloud is
// only re-seeded once the value has stopped changing for a moment. Seeding a
// large cloud takes tens of milliseconds and would otherwise halve the frame
// rate of the drag.
//
// Both steps remember which volcanoes they owe work to. Holding only the
// latest one meant that switching volcano inside the 180 ms and changing a
// value there cancelled the first volcano's re-seed for good.
let pending = null, reseedTimer = null;
const toCompute = new Set(), toSeed = new Set();
function schedule() {
  syncLabels();
  const v = selectedVolcano();
  toCompute.add(v);
  toSeed.add(v);
  if (!pending) {
    pending = requestAnimationFrame(() => {
      pending = null;
      for (const x of toCompute) computeVolcano(x);
      toCompute.clear();
      repaint();
      syncLabels();
    });
  }
  clearTimeout(reseedTimer);
  reseedTimer = setTimeout(() => {
    for (const x of toSeed) reseed(x);
    toSeed.clear();
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
// The map panel too, so the loading screen already has the saved theme's
// colours. scene.js sets this again once the scene exists.
if ($('scene')) $('scene').dataset.theme = P.theme;

/** Say what the page is waiting for, until the scene replaces it. */
function loadingText(t) {
  const el = $('loading');
  if (el && !el.classList.contains('gone')) el.textContent = t;
}

// The map layers are optional decoration for a physics model, so they never
// block the terrain. If they fail to load the sandbox still runs without roads.
// `stage` records how far the start-up got, so a failure is reported as what
// it was. Everything used to be blamed on the terrain, including a browser
// with WebGL switched off.
let stage = 'load';
Promise.all([
  loadTerrain(dataUrl('data/terrain.png'), dataUrl('data/terrain.json')),
  loadVectors(dataUrl('data/vectors.json')).catch((err) => {
    console.warn('map layers unavailable:', err.message);
    return null;
  })
]).then(([, vectors]) => {
  stage = 'build';
  loadingText('Building the surface…');
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
    // Nothing on the map changes when another volcano is selected, only which
    // two places and which mass balance the readouts show.
    onSelect: () => updateReadout(lastStats),
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
    // Two separate switches. They used to share one handler, so turning the
    // isopachs on or off also re-seeded every cloud and, in eruption mode,
    // started the run again from zero.
    onContours: repaint,
    onPlume: () => {
      const on = $('t-part').checked;
      setPlumeVisible(on);
      // Clouds are not stepped while hidden, so start them fresh when shown.
      if (on) for (const v of VOLCANOES) restartCloud(v);
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
  const el = $('loading');
  el.classList.remove('gone');
  el.textContent = stage === 'load'
    ? 'Terrain failed to load. Is the page being served over http?'
    : 'The map could not be drawn. This browser may have WebGL switched off. '
      + 'The browser console has the details.';
  console.error(err);
});
