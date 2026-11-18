// The "?" explanations next to controls whose meaning is not obvious outside
// physical volcanology.
//
// Written for someone in a neighbouring field, such as a seismologist, a hazard
// modeller or a meteorologist. Each entry says what the quantity is, what it
// does in this model and what a sensible value looks like. The text is authored here, never user input, so it is inserted
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
    : `10${sup(Math.log10(c.lo))} to 10${sup(Math.log10(c.hi))}`;
  return `<tr><td>${c.vei}</td><td>${range}</td><td>${c.example}</td></tr>`;
}).join('');

export const HELP = {
  height: {
    title: 'Plume height above vent',
    html: `<p>Height of the top of the eruption column, measured from the vent. The
      vent height of the selected volcano is shown under its name.</p>
      <p>Aviation ash advisories (VAAC) give plume tops above sea level, usually in
      feet. You can type <code>30000 ft</code> or <code>9000 m</code>. Subtract the
      vent height first if your number is above sea level.</p>`
  },
  vei: {
    title: 'Volcanic Explosivity Index',
    html: `<p>A size class for eruptions on a log scale (Newhall &amp; Self, 1982).
      From VEI 2 upward, each step means ten times more erupted material. The
      original index also uses column height. This readout uses erupted volume
      only.</p>
      <p>Mass is turned into volume with the <b>deposit bulk density</b> set
      further down, so changing the density can change the class. The index has
      the same problem in real use.</p>
      <table class="vei-table"><thead><tr><th>VEI</th><th>Bulk tephra, m³</th><th>Example</th></tr></thead>
      <tbody>${veiRows}</tbody></table>`
  },
  duration: {
    title: 'Implied duration',
    html: `<p>How long the eruption would have to last to produce the chosen mass at
      an eruption rate that can hold a column at the chosen height.</p>
      <p>The rate comes from the empirical fit of Mastin et&nbsp;al. (2009),
      <i>H</i>&nbsp;=&nbsp;2.00&thinsp;<i>V̇</i><sup>0.241</sup>, with <i>H</i> in km
      above the vent and <i>V̇</i> in m³/s of dense rock, converted at 2,500 kg/m³.
      The row turns amber or red when height and mass are unlikely to belong to
      the same eruption, for example a very tall plume from very little mass.</p>`
  },
  phi: {
    title: 'Grain size in φ (phi)',
    html: `<p>The log scale sedimentologists use: <i>φ</i>&nbsp;=&nbsp;−log₂(diameter
      in mm). Each step of 1 halves the size, so <b>a larger φ means finer
      grains</b>.</p>
      <table class="kv"><tr><td>φ −6</td><td>64 mm</td><td>lapilli and blocks meet</td></tr>
      <tr><td>φ −1</td><td>2 mm</td><td>ash and lapilli meet</td></tr>
      <tr><td>φ 0</td><td>1 mm</td><td></td></tr>
      <tr><td>φ 4</td><td>63 µm</td><td>fine ash below this</td></tr></table>
      <p>This is the median of the <i>total</i> grain size distribution, meaning
      everything the eruption produced. You can type a size directly, such as
      <code>250 µm</code> or <code>0.5 mm</code>.</p>`
  },
  sigma: {
    title: 'Sorting (σφ)',
    html: `<p>How spread out the grain sizes are: the standard deviation of the
      distribution in φ units. A small value means the grains are all about the
      same size (well sorted). A large value means a wide mix of fine and coarse
      grains (poorly sorted).</p>
      <p>Folk &amp; Ward (1957) name the ranges: below 0.35 very well sorted, 0.35
      to 0.5 well sorted, 0.5 to 0.71 moderately well sorted, 0.71 to 1 moderately
      sorted, 1 to 2 poorly sorted, 2 to 4 very poorly sorted, and above 4
      extremely poorly sorted. The line under the slider uses the same names.</p>
      <p>A sample from a single outcrop is usually better sorted than the eruption
      as a whole, because grains of different sizes land at different distances.
      This control sets the sorting of the whole eruption.</p>`
  },
  suzuki: {
    title: 'Column mass peak (Suzuki A)',
    html: `<p>Sets where along the column the ash leaves it and enters the wind,
      after Suzuki (1983). The release peaks at 1&nbsp;−&nbsp;1/<i>A</i> of the
      column height, so <i>A</i>&nbsp;=&nbsp;2 peaks halfway up and
      <i>A</i>&nbsp;=&nbsp;4 three quarters of the way up.</p>
      <p>A large <i>A</i> puts most of the release near the top, as in a strong
      plume that spreads out as an umbrella cloud. A small <i>A</i> spreads it down
      the column, which is closer to a weak plume bent over by the wind.</p>`
  },
  dir: {
    title: 'Wind from',
    html: `<p>Weather report convention: the direction the wind blows <b>from</b>, in
      degrees clockwise from north. 270° is a westerly wind, and it carries ash
      <b>east</b>.</p>
      <p>This is the direction at 2&nbsp;km. Directional shear sets how it turns
      with height. You can type a compass point such as <code>WSW</code>.</p>`
  },
  wind2: {
    title: 'Wind profile',
    html: `<p>Wind speed is set at two heights above sea level, 2&nbsp;km and
      12&nbsp;km. Between them it changes in a straight line with height. Below
      2&nbsp;km and above 12&nbsp;km it stays at the nearest set value.</p>
      <p>Two heights are a rough stand-in for a real weather balloon profile. You
      can type knots (<code>40 kt</code>) or <code>km/h</code>.</p>`
  },
  wind12: {
    title: 'Speed at 12 km',
    html: `<p>About the cruising height of airliners and the level of the jet
      stream. Over southern Japan in winter the jet at this height often blows
      faster than 50&nbsp;m/s. That is why tall winter plumes from Kyushu volcanoes
      are stretched so far to the east.</p>`
  },
  shear: {
    title: 'Directional shear',
    html: `<p>How many degrees the wind direction turns between 2&nbsp;km and
      12&nbsp;km. Positive values turn clockwise with height (veering). Negative
      values turn anticlockwise (backing).</p>
      <p>Ash released at different heights then travels in different directions,
      so shear fans the deposit out into a wider, curved shape.</p>`
  },
  K: {
    title: 'Eddy diffusivity (K)',
    html: `<p>A single number that stands for the air turbulence spreading the ash
      cloud sideways as it drifts. The sideways spread grows as
      σ²&nbsp;=&nbsp;2<i>Kt</i>, where <i>t</i> is the fall time. Four times the
      diffusivity makes the deposit twice as wide.</p>
      <p>K can't be measured directly. It is usually found by fitting the model to
      a mapped deposit. Published values run from a few hundred to tens of
      thousands of m²/s.</p>`
  },
  rho: {
    title: 'Deposit bulk density',
    html: `<p>The density of the ash layer as it lies on the ground, including the
      air between the grains. It is much lower than the density of the rock
      itself.</p>
      <p>Changing it leaves the ash where it is. The model uses it in two places:
      to turn load (kg/m²) into thickness (mm), and to turn erupted mass into
      volume for the VEI. Fresh fall deposits are roughly 500 to 2,000 kg/m³,
      depending on grain size, compaction and rain (Blong et&nbsp;al., 2017).</p>`
  },
  isopach: {
    title: 'Isopachs',
    html: `<p>Contour lines of equal deposit thickness. This is the usual way to map
      tephra fall in the field. The contour levels are picked automatically to
      suit the current deposit.</p>`
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
