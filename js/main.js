// Wiring. Load terrain, build the texture, start the scene, connect the UI.

import { P } from './params.js';
import { field, stats, compute } from './physics.js';
import { loadTerrain } from './terrain.js';
import { initTexture, paintTexture, fieldTex } from './texture.js';
import { seedParticles, replayEruption, parts, partXY, clock } from './particles.js';
import { initScene, renderFrame, resize, setView, applyExaggeration, markTextureDirty, setPlumeVisible, addVectors, setVectorLayer, setPlacesVisible, orbit } from './scene.js';
import { loadVectors } from './vectors.js';
import { bindUI, syncInputs, syncLabels, syncMode, updateClock, updateReadout } from './ui.js';

const $ = (id) => document.getElementById(id);
const showContours = () => $('t-cont').checked;

function recompute({ reseed = true } = {}) {
  compute();
  paintTexture(showContours());
  markTextureDirty();
  updateReadout();
  syncLabels();
  // The deposit is a steady-state solution and snaps to the new parameters at
  // once. A steady cloud carries drift accumulated under the previous wind, so
  // without a reseed it keeps pointing the old way while the ground below it
  // already shows the new answer.
  //
  // An eruption run is deliberately left alone: it is a single event playing
  // out in time, and restarting it on every slider movement would make it
  // impossible to watch. Use Replay to start a new one under the new numbers.
  if (reseed && P.mode !== 'eruption' && parts.length) seedParticles();
}

let pending = null;
function schedule() {
  syncLabels();
  if (pending) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => { pending = null; recompute(); });
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  renderFrame(dt, { spin: $('t-spin').checked });
  if (P.mode === 'eruption') updateClock();
  requestAnimationFrame(frame);
}

// The map layers are optional decoration for a physics model, so they are
// fetched alongside the terrain but never allowed to block it: if Overpass
// output is missing or malformed the sandbox still runs, minus the roads.
Promise.all([
  loadTerrain('data/terrain.png'),
  loadVectors('data/vectors.json').catch((err) => {
    console.warn('map layers unavailable:', err.message);
    return null;
  })
]).then(([, vectors]) => {
  initTexture();
  initScene($('scene'));
  if (vectors) addVectors(vectors);
  syncInputs();
  syncMode();
  recompute({ reseed: false });
  seedParticles();
  $('loading').classList.add('gone');
  window.addEventListener('resize', resize);

  bindUI({
    onModel: schedule,
    onExaggeration: applyExaggeration,
    onPreset: () => recompute(),
    onView: setView,
    onReplay: () => {
      if (P.mode === 'eruption') replayEruption(); else seedParticles();
    },
    onToggle: () => {
      const on = $('t-part').checked;
      setPlumeVisible(on);
      if (on) seedParticles();
      paintTexture(showContours());
      markTextureDirty();
    },
    onLayer: (layers, on) => { for (const id of layers) setVectorLayer(id, on); },
    onPlaces: setPlacesVisible
  });

  requestAnimationFrame(frame);

  // Dev hook: lets you check that the field, the drawn copy and the particle
  // cloud agree. See test/ for the automated versions.
  window.__ash = {
    P, field, fieldTex, parts: () => parts, partXY, clock,
    stats: () => stats, recompute, seedParticles, replayEruption, orbit
  };
}).catch((err) => {
  $('loading').textContent = 'Terrain failed to load. Is the page being served over http?';
  console.error(err);
});
