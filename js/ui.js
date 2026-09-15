// Sliders, presets and the numeric readouts.

import { P, PLACES, applyPreset } from './params.js';
import { TOGGLES } from './vectors.js';
import { NP, clock } from './particles.js';
import { stats, sampleAt, mastinMER } from './physics.js';

const $ = (id) => document.getElementById(id);

const SLIDERS = [
  ['s-h', 'H'], ['s-phi', 'phi'], ['s-sig', 'sig'], ['s-suz', 'suz'],
  ['s-dir', 'dir'], ['s-spd', 'spd'], ['s-top', 'top'], ['s-shr', 'shear'],
  ['s-k', 'K'], ['s-rho', 'rho']
];

export function fmtMM(mm) {
  if (mm < 0.0005) return '0';
  if (mm < 0.01) return mm.toFixed(3);
  if (mm < 1) return mm.toFixed(2);
  if (mm < 100) return mm.toFixed(1);
  return Math.round(mm).toLocaleString();
}

/** Loads below 1 kg/m2 read better as g/m2, which is how Japanese ashfall
 *  monitoring reports routine Sakurajima events. */
export function fmtLoad(L) {
  if (L < 0.0005) return '0 g/m²';
  if (L < 1) return (L * 1000).toFixed(L < 0.01 ? 1 : 0) + ' g/m²';
  return (L < 100 ? L.toFixed(1) : Math.round(L).toLocaleString()) + ' kg/m²';
}

export function fmtDur(s) {
  if (s < 90) return s.toFixed(0) + ' s';
  if (s < 5400) return (s / 60).toFixed(0) + ' min';
  if (s < 172800) return (s / 3600).toFixed(1) + ' h';
  if (s < 3.15e7) return Math.round(s / 86400).toLocaleString() + ' days';
  return Math.round(s / 3.15e7).toLocaleString() + ' years';
}

function durState(s) {
  if (s >= 60 && s <= 259200) return '';        // 1 min to 3 days
  if (s >= 10 && s <= 2.6e6) return 'warn';     // out to 30 days
  return 'bad';
}

function badge(mm) {
  if (mm < 0.001) return ['', '', ''];
  if (mm < 0.1) return ['Trace', '#2f3a42', '#93a6b2'];
  if (mm < 1) return ['Nuisance', '#38454e', '#a5b8c4'];
  if (mm < 10) return ['Disruption', '#4a3b22', '#d2ab5e'];
  if (mm < 100) return ['Cleanup cost', '#5a3a18', '#e0a050'];
  if (mm < 200) return ['Structural concern', '#6a3418', '#ef9560'];
  if (mm < 500) return ['Damage likely', '#7a2c18', '#f08f68'];
  return ['Collapse risk', '#8a2418', '#fa9c78'];
}

function setBadge(id, mm) {
  const [txt, bg, fg] = badge(mm);
  const el = $(id);
  el.textContent = txt;
  el.style.background = bg;
  el.style.color = fg;
  el.style.padding = txt ? '1px 5px' : '0';
}

function expFmt(v) {
  const e = Math.floor(Math.log10(v));
  const m = v / Math.pow(10, e);
  const sup = String(e).split('').map((c) => (c === '-' ? '⁻' : '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c])).join('');
  return m.toFixed(1) + '×10' + sup;
}

function dirName(d) {
  const nm = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return nm[Math.round(d / 22.5) % 16];
}

const MODE_NOTE = {
  steady: 'A cloud that has been erupting long enough to reach a steady state. '
        + 'This is the one that matches the deposit below, which is itself a '
        + 'steady-state solution.',
  eruption: 'One eruption of a set length, played out in time. The column dies '
        + 'back when it ends and the sky empties. The deposit below still shows '
        + 'the steady-state answer, not this run.'
};

/** Show the mode switch, and grey out the controls the other mode ignores. */
export function syncMode() {
  for (const b of document.querySelectorAll('button.p[data-mode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === P.mode));
  }
  $('mode-note').textContent = MODE_NOTE[P.mode] || '';
  for (const el of document.querySelectorAll('.erupt-only')) {
    el.classList.toggle('off', P.mode !== 'eruption');
  }
  updateClock();
}

/** The eruption run clock. Cheap, so main.js calls it every frame. */
export function updateClock() {
  const el = $('v-clock');
  if (!el) return;
  if (P.mode !== 'eruption') { el.textContent = ''; return; }
  const pct = Math.min(100, Math.round((clock.released / NP) * 100));
  el.textContent = clock.done
    ? 'settled at ' + fmtDur(clock.t)
    : `${fmtDur(clock.t)} · ${pct}% released · ${clock.active} aloft`;
}

export function syncLabels() {
  $('v-h').textContent = P.H.toFixed(1) + ' km';
  $('v-m').textContent = expFmt(Math.pow(10, P.logM)) + ' kg';

  const dur = Math.pow(10, P.logM) / mastinMER(P.H);
  $('v-dur').textContent = fmtDur(dur);
  $('d-dur').setAttribute('data-s', durState(dur));

  const dmm = Math.pow(2, -P.phi);
  $('v-phi').textContent = 'φ ' + P.phi.toFixed(1) + ' · ' +
    (dmm >= 1 ? dmm.toFixed(1) + ' mm' : Math.round(dmm * 1000) + ' µm');
  $('v-sig').textContent = P.sig.toFixed(1);
  $('v-suz').textContent = 'A ' + P.suz.toFixed(1) + ' · ' + Math.round((1 - 1 / P.suz) * 100) + '% height';
  $('v-dir').textContent = P.dir + '° ' + dirName(P.dir);
  $('v-spd').textContent = P.spd + ' m/s';
  $('v-top').textContent = P.top + ' m/s';
  $('v-shr').textContent = (P.shear > 0 ? '+' : '') + P.shear + '°';
  $('v-k').textContent = P.K.toLocaleString() + ' m²/s';
  $('v-rho').textContent = P.rho + ' kg/m³';
  $('v-ex').textContent = '×' + P.ex.toFixed(1);
  $('v-rate').textContent = '×' + P.rate + ' · 1 s = ' + fmtDur(P.rate);
  $('v-elen').textContent = fmtDur(P.dur);
}

export function syncInputs() {
  for (const [id, key] of SLIDERS) $(id).value = P[key];
  $('s-ex').value = P.ex;
  $('s-rate').value = P.rate;
  $('s-elen').value = P.dur;
  $('s-m').value = ((P.logM - 5) / 7) * 100;
}

export function updateReadout() {
  const f = stats.mmFac;
  for (const key of ['kago', 'air']) {
    const pl = PLACES.find((p) => p.key === key);
    const L = sampleAt(pl.x, pl.y);
    const mm = L * f;
    $('r-' + key).textContent = fmtMM(mm);
    $('r-' + key + '-l').textContent = fmtLoad(L);
    setBadge('r-' + key + '-d', mm);
  }
  const mxmm = stats.max * f;
  $('r-max').textContent = fmtMM(mxmm);
  $('r-max-l').textContent = fmtLoad(stats.max);
  setBadge('r-max-d', mxmm);

  $('r-a1').textContent = stats.a1 < 0.05 ? '0'
    : stats.a1 < 10 ? stats.a1.toFixed(1)
    : Math.round(stats.a1).toLocaleString();
  $('r-bal').textContent = Math.round((stats.total / stats.M) * 100) + '% of mass landed in view';
}

/**
 * Wire the controls.
 * @param {object} handlers
 *   { onModel, onExaggeration, onPreset, onView, onToggle, onLayer, onReplay }
 */
export function bindUI(handlers) {
  for (const [id, key] of SLIDERS) {
    $(id).addEventListener('input', function () {
      P[key] = parseFloat(this.value);
      handlers.onModel();
    });
  }
  $('s-m').addEventListener('input', function () {
    P.logM = 5 + (parseFloat(this.value) / 100) * 7;
    handlers.onModel();
  });
  $('s-ex').addEventListener('input', function () {
    P.ex = parseFloat(this.value);
    syncLabels();
    handlers.onExaggeration();
  });
  // Playback speed and eruption length are presentation, not physics: they
  // change how the cloud is animated and nothing the deposit field depends on,
  // so neither triggers a recompute.
  $('s-rate').addEventListener('input', function () {
    P.rate = parseFloat(this.value);
    syncLabels();
  });
  $('s-elen').addEventListener('input', function () {
    P.dur = parseFloat(this.value);
    syncLabels();
  });
  $('b-replay').addEventListener('click', () => handlers.onReplay());
  for (const b of document.querySelectorAll('button.p[data-mode]')) {
    b.addEventListener('click', () => {
      P.mode = b.dataset.mode;
      syncMode();
      handlers.onReplay();
    });
  }
  for (const b of document.querySelectorAll('button.p')) {
    b.addEventListener('click', () => {
      if (applyPreset(b.dataset.preset)) { syncInputs(); handlers.onPreset(); }
    });
  }
  for (const b of document.querySelectorAll('.views button')) {
    b.addEventListener('click', () => handlers.onView(b.dataset.v));
  }
  $('t-cont').addEventListener('change', handlers.onToggle);
  $('t-part').addEventListener('change', handlers.onToggle);

  for (const t of TOGGLES) {
    const box = $(t.id);
    if (!box) continue;
    box.addEventListener('change', () => handlers.onLayer(t.layers, box.checked));
    handlers.onLayer(t.layers, box.checked);   // honour the markup's initial state
  }
}
