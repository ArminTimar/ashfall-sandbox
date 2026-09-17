// The "?" explanations next to controls whose meaning is not obvious outside
// physical volcanology.
//
// Written for someone in an adjacent field — a seismologist, a hazard modeller,
// a meteorologist — so each entry says what the quantity is, what it does in
// this model, and what a sensible value looks like, without assuming the
// vocabulary. The text is authored here, never user input, so it is inserted
// as HTML.
//
// One popover serves every button and lives in <body> with fixed positioning.
// The control column scrolls with overflow: auto, which clips anything
// positioned inside it, and these need to spill left over the map.

import { VEI } from './vei.js';

const sup = (n) => String(n).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('');

const veiRows = VEI.map((c) => {
  const range = c.vei === 0 ? `&lt; 10${sup(4)}`
    : c.vei === 8 ? `&ge; 10${sup(12)}`
    : `10${sup(Math.log10(c.lo))}–10${sup(Math.log10(c.hi))}`;
  return `<tr><td>${c.vei}</td><td>${range}</td><td>${c.example}</td></tr>`;
}).join('');

export const HELP = {
  height: {
    title: 'Plume height above vent',
    html: `<p>Height of the top of the eruption column, measured from the vent — the
      Minamidake summit, about 1,060 m — not from sea level.</p>
      <p>Aviation advisories (VAAC) report plume tops above sea level and usually in
      feet. You can type <code>30000 ft</code> or <code>9000 m</code>; subtract the
      vent elevation first if the figure is above sea level.</p>`
  },
  vei: {
    title: 'Volcanic Explosivity Index',
    html: `<p>A logarithmic size class (Newhall &amp; Self, 1982). Above VEI 2 each step
      is ten times more erupted material. It is defined partly by column height too;
      this readout uses erupted volume only.</p>
      <p>Mass becomes volume through the <b>deposit bulk density</b> further down,
      so changing that density can move the class — a genuine ambiguity in the
      index, not a quirk of the sandbox.</p>
      <table class="vei-table"><thead><tr><th>VEI</th><th>Bulk tephra, m³</th><th>Example</th></tr></thead>
      <tbody>${veiRows}</tbody></table>`
  },
  duration: {
    title: 'Implied duration',
    html: `<p>How long the eruption would have to last to put out the chosen mass at a
      rate able to hold a column up to the chosen height.</p>
      <p>The rate comes from the empirical fit of Mastin et&nbsp;al. (2009),
      <i>H</i>&nbsp;=&nbsp;2.00&thinsp;<i>V̇</i><sup>0.241</sup>, with <i>H</i> in km
      above the vent and <i>V̇</i> in m³/s of dense rock, converted at 2,500 kg/m³.
      It turns amber or red when the height and mass are unlikely to belong to the
      same eruption — a very tall plume from very little mass, for instance.</p>`
  },
  phi: {
    title: 'Grain size in φ (phi)',
    html: `<p>Sedimentologists' log scale: <i>φ</i>&nbsp;=&nbsp;−log₂(diameter in mm).
      Each step of one halves the size, and <b>larger φ is finer</b>.</p>
      <table class="kv"><tr><td>φ −6</td><td>64 mm</td><td>lapilli / blocks boundary</td></tr>
      <tr><td>φ −1</td><td>2 mm</td><td>ash / lapilli boundary</td></tr>
      <tr><td>φ 0</td><td>1 mm</td><td></td></tr>
      <tr><td>φ 4</td><td>63 µm</td><td>fine ash below this</td></tr></table>
      <p>This is the median of the <i>total</i> grain-size distribution of everything
      erupted. You can type a size directly: <code>250 µm</code>, <code>0.5 mm</code>.</p>`
  },
  sigma: {
    title: 'Sorting (σφ)',
    html: `<p>The spread of the grain-size distribution: its standard deviation, in φ
      units. Small means the grains are all much the same size (well sorted); large
      means a wide mix of fine and coarse (poorly sorted).</p>
      <p>Verbal classes after Folk &amp; Ward (1957): under 0.5 well sorted, 0.5–1
      moderately, 1–2 poorly, 2–4 very poorly.</p>
      <p>A sample from one outcrop is usually better sorted than the whole eruption,
      because settling separates sizes with distance. This control is the whole
      eruption's spread.</p>`
  },
  suzuki: {
    title: 'Column mass peak (Suzuki A)',
    html: `<p>Where along the column the ash is released into the wind, after Suzuki
      (1983). The release profile peaks at 1&nbsp;−&nbsp;1/<i>A</i> of the column
      height: <i>A</i>&nbsp;=&nbsp;2 peaks halfway up, <i>A</i>&nbsp;=&nbsp;4 at three
      quarters.</p>
      <p>Large <i>A</i> concentrates release near the top, as in a strong plume
      feeding an umbrella cloud. Small <i>A</i> spreads it down the column, closer to
      a weak plume bent over by wind.</p>`
  },
  dir: {
    title: 'Wind from',
    html: `<p>Meteorological convention: the direction the wind blows <b>from</b>, in
      degrees clockwise from north. 270° is a westerly and carries ash <b>east</b>.</p>
      <p>This is the direction at 2&nbsp;km. See directional shear for how it turns
      with height. You can type a compass point such as <code>WSW</code>.</p>`
  },
  wind2: {
    title: 'Wind profile',
    html: `<p>The wind is set at two heights, 2&nbsp;km and 12&nbsp;km above sea level.
      Between them speed changes linearly with height; below 2&nbsp;km and above
      12&nbsp;km it is held constant.</p>
      <p>Two points is a coarse stand-in for a real sounding. You can type knots
      (<code>40 kt</code>) or <code>km/h</code>.</p>`
  },
  wind12: {
    title: 'Speed at 12 km',
    html: `<p>Roughly the cruising altitude of airliners and the level of the jet stream.
      Over southern Japan the winter subtropical jet at this height regularly exceeds
      50&nbsp;m/s, which is why tall winter plumes from Sakurajima are drawn out so
      far east.</p>`
  },
  shear: {
    title: 'Directional shear',
    html: `<p>How far the wind direction turns between 2&nbsp;km and 12&nbsp;km, in
      degrees. Positive is clockwise with height (veering), negative is
      anticlockwise (backing).</p>
      <p>Ash released at different heights then travels in different directions, so
      shear fans the deposit out instead of drawing a single straight lobe.</p>`
  },
  K: {
    title: 'Eddy diffusivity (K)',
    html: `<p>One number standing in for all the atmospheric turbulence that spreads
      the cloud sideways as it drifts. The sideways spread grows as
      σ²&nbsp;=&nbsp;2<i>Kt</i> with fall time <i>t</i>, so four times the
      diffusivity makes the deposit twice as wide.</p>
      <p>It cannot be measured directly. In practice it is tuned by fitting a mapped
      deposit, and fitted values range over orders of magnitude, from hundreds to
      tens of thousands of m²/s.</p>`
  },
  rho: {
    title: 'Deposit bulk density',
    html: `<p>Density of the ash layer as it lies on the ground, pore space included —
      far lower than the rock itself.</p>
      <p>It does not change where ash lands. It converts load (kg/m²) into
      thickness (mm), and erupted mass into volume for the VEI. Fresh fall deposits
      span roughly 500–2,000 kg/m³ depending on grain size, compaction and rain
      (Blong et&nbsp;al., 2017).</p>`
  },
  isopach: {
    title: 'Isopachs',
    html: `<p>Contour lines of equal deposit thickness — the standard way tephra fall
      is mapped in the field. Levels are chosen automatically to suit the current
      deposit.</p>`
  }
};

let pop = null, openBtn = null, pinned = false;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'help-pop';
  pop.className = 'help-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  document.body.appendChild(pop);
  // Keep it open while the pointer is over it, so links and tables can be read.
  pop.addEventListener('pointerenter', () => { pop.dataset.hover = '1'; });
  pop.addEventListener('pointerleave', () => { delete pop.dataset.hover; if (!pinned) close(); });
  return pop;
}

function place() {
  if (!pop || !openBtn) return;
  const b = openBtn.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, M = 10;
  pop.style.maxWidth = Math.min(340, vw - 2 * M) + 'px';
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  let left, top;
  if (b.bottom + 6 + h <= vh - M) {
    // Below, right-aligned to the button, spilling left over the map.
    top = b.bottom + 6;
    left = clamp(b.right - w, M, vw - w - M);
  } else if (b.top - h - 6 >= M) {
    top = b.top - h - 6;
    left = clamp(b.right - w, M, vw - w - M);
  } else {
    // Too tall for either: beside the button, so it never covers the control
    // it explains.
    left = clamp(b.left - w - 8, M, vw - w - M);
    top = clamp(b.top + b.height / 2 - h / 2, M, vh - h - M);
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function open(btn) {
  const entry = HELP[btn.dataset.help];
  if (!entry) return;
  ensurePop();
  if (openBtn && openBtn !== btn) openBtn.setAttribute('aria-expanded', 'false');
  openBtn = btn;
  pop.innerHTML = `<div class="hp-title">${entry.title}</div>${entry.html}`;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'help-pop');
  place();
}

function close() {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pinned = false;
  if (openBtn) {
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.removeAttribute('aria-describedby');
  }
  openBtn = null;
}

/** Wire every .help[data-help] button on the page. */
export function bindHelp(root = document) {
  for (const btn of root.querySelectorAll('button.help[data-help]')) {
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'help-pop');
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !pinned) open(btn); });
    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || pinned) return;
      // Give the pointer a moment to cross onto the popover itself.
      setTimeout(() => { if (!pinned && !(pop && pop.dataset.hover)) close(); }, 120);
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openBtn === btn && pinned) { close(); return; }
      open(btn);
      pinned = true;
    });
    btn.addEventListener('focus', () => { if (!pinned) open(btn); });
    btn.addEventListener('blur', () => { if (!pinned) close(); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openBtn) { const b = openBtn; close(); b.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!openBtn) return;
    if (e.target.closest('button.help') || (pop && pop.contains(e.target))) return;
    close();
  });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);   // capture: the control column scrolls too
}
