// Controls, presets and the numeric readouts.
//
// Every numeric control is a pair: a slider for exploring, and a text box for
// entering an exact value. Both write the same parameter through one spec per
// field (FIELDS below), so their ranges, units and formatting cannot disagree.
// The text box accepts more than the slider covers — a slider has to stop
// somewhere sensible to drag across, a typed value only has to be physically
// meaningful — and the slider simply pins at its end.

import { P, PLACES, VENT_Z, applyPreset } from './params.js';
import { TOGGLES } from './vectors.js';
import { NP, clock } from './particles.js';
import { stats, sampleAt, mastinMER } from './physics.js';
import { UNITS, parseWith, parseDirection, parsePhi, parseSuzuki } from './parse.js';
import { veiOfMass } from './vei.js';
import { bindHelp } from './help.js';

const $ = (id) => document.getElementById(id);

export function fmtMM(mm) {
  if (mm < 0.0005) return '0';
  if (mm < 0.01) return mm.toFixed(3);
  if (mm < 1) return mm.toFixed(2);
  if (mm < 100) return mm.toFixed(1);
  return Math.round(mm).toLocaleString('en-US');
}

/** Loads below 1 kg/m2 read better as g/m2, which is how Japanese ashfall
 *  monitoring reports routine Sakurajima events. */
export function fmtLoad(L) {
  if (L < 0.0005) return '0 g/m²';
  if (L < 1) return (L * 1000).toFixed(L < 0.01 ? 1 : 0) + ' g/m²';
  return (L < 100 ? L.toFixed(1) : Math.round(L).toLocaleString('en-US')) + ' kg/m²';
}

export function fmtDur(s) {
  if (s < 90) return s.toFixed(0) + ' s';
  if (s < 5400) return (s / 60).toFixed(0) + ' min';
  if (s < 172800) return (s / 3600).toFixed(1) + ' h';
  if (s < 3.15e7) return Math.round(s / 86400).toLocaleString('en-US') + ' days';
  return Math.round(s / 3.15e7).toLocaleString('en-US') + ' years';
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

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function expFmt(v) {
  const e = Math.floor(Math.log10(v));
  const m = v / Math.pow(10, e);
  if (m >= 9.95) return expFmt(Math.pow(10, e + 1));   // 9.96e8 -> 1.0×10⁹, not 10.0×10⁸
  const sup = String(e).split('').map((c) => (c === '-' ? '⁻' : SUP[+c])).join('');
  return m.toFixed(1) + '×10' + sup;
}
/** The same number as e-notation, which is easier to edit than superscripts. */
function eFmt(v) {
  const e = Math.floor(Math.log10(v));
  const m = v / Math.pow(10, e);
  return +m.toFixed(3) + 'e' + e;
}
/** Up to `dp` decimals, trailing zeros dropped. */
const trim = (v, dp = 2) => String(+v.toFixed(dp));
const grouped = (v) => Math.round(v).toLocaleString('en-US');

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dirName = (d) => COMPASS[Math.round(d / 22.5) % 16];

function grainHint(phi) {
  const mm = Math.pow(2, -phi);
  const size = mm >= 1 ? trim(mm, mm < 10 ? 1 : 0) + ' mm' : Math.round(mm * 1000) + ' µm';
  const cls = phi < -6 ? 'blocks and bombs' : phi < -1 ? 'lapilli' : phi < 4 ? 'coarse ash' : 'fine ash';
  return `${size} · ${cls}`;
}

/** Folk & Ward (1957) verbal sorting classes. */
function sortingHint(s) {
  if (s < 0.35) return 'very well sorted';
  if (s < 0.5) return 'well sorted';
  if (s < 0.71) return 'moderately well sorted';
  if (s < 1) return 'moderately sorted';
  if (s < 2) return 'poorly sorted';
  if (s < 4) return 'very poorly sorted';
  return 'extremely poorly sorted';
}

function volFmt(m3) {
  if (m3 >= 1e6) return trim(m3 / 1e9, m3 >= 1e9 ? 1 : 3) + ' km³';
  return expFmt(m3) + ' m³';
}

/**
 * One entry per numeric control.
 *   id        suffix of s-<id> (slider), n-<id> (text box), h-<id> (hint line)
 *   kind      'model' recomputes the deposit, 'exaggeration' re-drapes the
 *             terrain, 'display' only redraws labels
 *   get/set   the value in the unit the text box shows
 *   min/max   hard limits for a typed value; the slider's own range is in the markup
 *   toSlider/fromSlider  only where the slider is not the displayed value
 *   step      arrow-key nudge; mass nudges multiplicatively instead
 */
export const FIELDS = [
  { id: 'h', key: 'H', kind: 'model', min: 0.1, max: 40, step: 0.1,
    parse: (s) => parseWith(s, UNITS.km), fmt: (v) => v.toFixed(1),
    hint: (v) => `top at ${(v + VENT_Z / 1000).toFixed(1)} km above sea level` },
  { id: 'm', kind: 'model', min: 1e3, max: 1e15, log: true,
    get: () => Math.pow(10, P.logM), set: (v) => { P.logM = Math.log10(v); },
    toSlider: (v) => ((Math.log10(v) - 4) / 9) * 100,
    fromSlider: (x) => Math.pow(10, 4 + (x / 100) * 9),
    parse: (s) => parseWith(s, UNITS.kg), fmt: expFmt, edit: eFmt },
  { id: 'phi', key: 'phi', kind: 'model', min: -5, max: 5, step: 0.1,
    parse: parsePhi, fmt: (v) => v.toFixed(1), hint: grainHint },
  { id: 'sig', key: 'sig', kind: 'model', min: 0.2, max: 4, step: 0.1,
    parse: (s) => parseWith(s, UNITS.sigma), fmt: (v) => v.toFixed(1), hint: sortingHint },
  { id: 'suz', key: 'suz', kind: 'model', min: 1, max: 25, step: 0.5,
    parse: parseSuzuki, fmt: (v) => v.toFixed(1),
    hint: (v) => `release peaks ${Math.round((1 - 1 / v) * 100)}% of the way up the column` },
  { id: 'dir', key: 'dir', kind: 'model', min: 0, max: 360, step: 5, wrap: true,
    parse: parseDirection, fmt: (v) => trim(v, 1),
    hint: (v) => `${dirName(v)} wind — carries ash toward ${dirName((v + 180) % 360)}` },
  { id: 'spd', key: 'spd', kind: 'model', min: 0, max: 80, step: 1,
    parse: (s) => parseWith(s, UNITS.speed), fmt: (v) => trim(v, 1) },
  { id: 'top', key: 'top', kind: 'model', min: 0, max: 150, step: 1,
    parse: (s) => parseWith(s, UNITS.speed), fmt: (v) => trim(v, 1) },
  { id: 'shr', key: 'shear', kind: 'model', min: -180, max: 180, step: 5,
    parse: (s) => parseWith(s, UNITS.degrees), fmt: (v) => (v > 0 ? '+' : '') + trim(v, 1),
    hint: (v) => (Math.abs(v) < 0.5 ? 'same direction at every height'
      : v > 0 ? 'veers clockwise with height' : 'backs anticlockwise with height') },
  { id: 'rate', key: 'rate', kind: 'display', min: 1, max: 3600, step: 5,
    parse: (s) => parseWith(s, UNITS.times), fmt: (v) => trim(v, 1),
    hint: (v) => `1 s on screen is ${fmtDur(v)} of eruption` },
  { id: 'elen', kind: 'display', min: 1, max: 2880, step: 5,
    get: () => P.dur / 60, set: (v) => { P.dur = v * 60; },
    parse: (s) => parseWith(s, UNITS.minutes), fmt: (v) => trim(v, 1) },
  { id: 'ex', key: 'ex', kind: 'exaggeration', min: 1, max: 20, step: 0.5,
    parse: (s) => parseWith(s, UNITS.times), fmt: (v) => v.toFixed(1) },
  { id: 'k', key: 'K', kind: 'model', min: 10, max: 100000, step: 100,
    parse: (s) => parseWith(s, UNITS.diffus), fmt: grouped },
  { id: 'rho', key: 'rho', kind: 'model', min: 100, max: 3000, step: 50,
    parse: (s) => parseWith(s, UNITS.density), fmt: grouped }
];

for (const F of FIELDS) {
  F.get = F.get || (() => P[F.key]);
  F.set = F.set || ((v) => { P[F.key] = v; });
  F.toSlider = F.toSlider || ((v) => v);
  F.fromSlider = F.fromSlider || ((x) => x);
  F.edit = F.edit || F.fmt;
  F.note = '';          // a clamp or parse message, shown in place of the hint
  F.editing = false;
}

function renderField(F) {
  const v = F.get();
  const slider = $('s-' + F.id), box = $('n-' + F.id), hint = $('h-' + F.id);
  if (slider) slider.value = F.toSlider(v);
  if (box && !F.editing) {
    box.value = F.fmt(v);
    box.removeAttribute('aria-invalid');
  }
  if (hint) {
    hint.textContent = F.note || (F.hint ? F.hint(v) : '');
    hint.classList.toggle('warn', !!F.note);
  }
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

/** Refresh hints and the derived rows. Called on every parameter change. */
export function syncLabels() {
  for (const F of FIELDS) renderField(F);

  const kg = Math.pow(10, P.logM);
  const dur = kg / mastinMER(P.H);
  $('v-dur').textContent = fmtDur(dur);
  $('d-dur').setAttribute('data-s', durState(dur));

  const c = veiOfMass(kg, P.rho);
  $('v-vei').textContent = `${c.vei} · ${volFmt(kg / P.rho)} bulk`;
  $('v-vei-ex').textContent = 'Comparable: ' + c.example;
}

/** Push every parameter into its slider and text box, e.g. after a preset. */
export function syncInputs() {
  for (const F of FIELDS) { F.note = ''; renderField(F); }
  syncLabels();
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
    : Math.round(stats.a1).toLocaleString('en-US');
  $('r-bal').textContent = Math.round((stats.total / stats.M) * 100) + '% of mass landed in view';
}

/** Show a message in a field's hint line for a few seconds. */
function setNote(F, msg) {
  F.note = msg;
  clearTimeout(F.noteTimer);
  if (msg) F.noteTimer = setTimeout(() => { F.note = ''; renderField(F); }, 6000);
}

/**
 * Read a typed value into a field. Returns true if the parameter was set.
 * Out-of-range values are clamped rather than refused, with a note saying so:
 * someone typing 50 km plume height wants the tallest available, not an error.
 */
function commitTyped(F, text, fire) {
  const box = $('n-' + F.id);
  const r = F.parse(text);
  if ('error' in r) {
    setNote(F, `Couldn't read "${text.trim()}": ${r.error}`);
    box.setAttribute('aria-invalid', 'true');
    renderField(F);
    return false;
  }
  let v = r.value;
  if (F.wrap) v = ((v % 360) + 360) % 360;
  setNote(F, '');
  if (v < F.min || v > F.max) {
    v = Math.min(F.max, Math.max(F.min, v));
    setNote(F, `Limited to ${F.fmt(v)} — accepted range is ${F.fmt(F.min)} to ${F.fmt(F.max)}`);
  }
  F.set(v);
  box.removeAttribute('aria-invalid');
  fire(F);
  return true;
}

function nudge(F, dirn, big) {
  const v = F.get();
  let next;
  if (F.log) next = v * Math.pow(10, dirn * (big ? 1 : 0.1));
  else next = v + dirn * F.step * (big ? 10 : 1);
  if (F.wrap) next = ((next % 360) + 360) % 360;
  return Math.min(F.max, Math.max(F.min, next));
}

/**
 * Wire the controls.
 * @param {object} handlers
 *   { onModel, onExaggeration, onPreset, onView, onToggle, onLayer, onReplay }
 */
export function bindUI(handlers) {
  const fire = (F) => {
    renderField(F);
    if (F.kind === 'model') handlers.onModel();
    else if (F.kind === 'exaggeration') { syncLabels(); handlers.onExaggeration(); }
    else syncLabels();
  };

  for (const F of FIELDS) {
    const slider = $('s-' + F.id), box = $('n-' + F.id);
    if (!slider || !box) continue;

    slider.addEventListener('input', () => {
      F.note = '';
      F.set(F.fromSlider(parseFloat(slider.value)));
      fire(F);
    });

    let startText = '';
    box.addEventListener('focus', () => {
      F.editing = true;
      box.value = F.edit(F.get());
      startText = box.value;
      box.select();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (box.value === startText || commitTyped(F, box.value, fire)) box.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        F.note = '';
        box.value = startText;
        box.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        F.note = '';
        F.set(nudge(F, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey));
        box.value = F.edit(F.get());
        startText = box.value;
        fire(F);
      }
    });
    box.addEventListener('blur', () => {
      // Unchanged text is not re-parsed, so opening a box and leaving it never
      // rounds the stored value to the precision it happens to be displayed at.
      if (box.value !== startText && !commitTyped(F, box.value, fire)) {
        // Leave the complaint visible but restore the last good value.
        box.value = F.fmt(F.get());
      }
      F.editing = false;
      renderField(F);
    });
  }

  $('b-replay').addEventListener('click', () => handlers.onReplay());
  for (const b of document.querySelectorAll('button.p[data-mode]')) {
    b.addEventListener('click', () => {
      P.mode = b.dataset.mode;
      syncMode();
      handlers.onReplay();
    });
  }
  for (const b of document.querySelectorAll('button.p[data-preset]')) {
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

  bindHelp();
}
