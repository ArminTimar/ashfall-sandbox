// Wiring. Load terrain, build the texture, start the scene, connect the UI.

import { P } from './params.js';
import { field, stats, compute } from './physics.js';
import { loadTerrain } from './terrain.js';
import { initTexture, paintTexture, fieldTex } from './texture.js';
import { seedParticles, parts, partXY } from './particles.js';
import { initScene, renderFrame, resize, setView, applyExaggeration, markTextureDirty, setPlumeVisible } from './scene.js';
import { bindUI, syncInputs, syncLabels, updateReadout } from './ui.js';

const $ = (id) => document.getElementById(id);
const showContours = () => $('t-cont').checked;

function recompute({ reseed = true } = {}) {
  compute();
  paintTexture(showContours());
  markTextureDirty();
  updateReadout();
  syncLabels();
  // The deposit is a steady-state solution and snaps to the new parameters at
  // once. Particles carry drift accumulated under the previous wind, so without
  // a reseed the cloud keeps pointing the old way while the ground below it
  // already shows the new answer.
  if (reseed && parts.length) seedParticles();
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
  requestAnimationFrame(frame);
}

loadTerrain('data/terrain.png').then(() => {
  initTexture();
  initScene($('scene'));
  syncInputs();
  recompute({ reseed: false });
  seedParticles();
  $('loading').classList.add('gone');
  window.addEventListener('resize', resize);

  bindUI({
    onModel: schedule,
    onExaggeration: applyExaggeration,
    onPreset: () => recompute(),
    onView: setView,
    onToggle: () => {
      const on = $('t-part').checked;
      setPlumeVisible(on);
      if (on) seedParticles();
      paintTexture(showContours());
      markTextureDirty();
    }
  });

  requestAnimationFrame(frame);

  // Dev hook: lets you check that the field, the drawn copy and the particle
  // cloud agree. See test/ for the automated versions.
  window.__ash = {
    P, field, fieldTex, parts: () => parts, partXY,
    stats: () => stats, recompute
  };
}).catch((err) => {
  $('loading').textContent = 'Terrain failed to load — is this being served over http?';
  console.error(err);
});
