// Reads what people type into the numeric fields.
//
// Deliberately forgiving, because the people typing come from different
// habits: a volcanologist writes 2.5e10, a hazard report writes 2.5×10¹⁰ kg, an
// aviation advisory gives a plume top in feet, a meteorologist gives wind in
// knots and a direction as WSW, and half of Europe writes a decimal comma.
// No DOM, so it is tested directly in node — see test/inputs.mjs.

const SUPERSCRIPT = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+'
};

/** Normalise the string before any number is read out of it. */
function normalise(raw) {
  let s = String(raw).trim()
    .replace(/[−–—]/g, '-')                               // unicode minus signs
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^' + [...m].map((c) => SUPERSCRIPT[c]).join(''));
  // Thousands separators: a comma followed by exactly three digits and then
  // something that is not a digit. "2,500" is 2500; "2,5" is 2.5.
  s = s.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1').replace(/,/g, '.');
  return s;
}

/** Tidy a unit string so "Kg/m³", "kg / m^3" and "kg/m3" all compare equal. */
function tidyUnit(u) {
  return u.toLowerCase().replace(/\s+/g, '').replace(/\^/g, '')
    .replace(/[µμ]/g, 'u').replace(/\.$/, '');
}

/**
 * Split a typed quantity into a number and whatever unit follows it.
 * Accepts 2.5, -3, .5, 2.5e10, 2.5×10^10, 2.5x10¹⁰, 2.5*10^10, 10^10, 10¹⁰.
 * @returns {{value:number, unit:string}|null}
 */
export function splitQuantity(raw) {
  const s = normalise(raw);
  if (!s) return null;
  let rest = s, mant = null;

  // A bare power of ten has to be caught first, or "10^8" reads as the number
  // 10 followed by a unit called "8".
  const bare = rest.match(/^10\s*\^\s*([+-]?\d+)/);
  if (bare) {
    return { value: Math.pow(10, parseInt(bare[1], 10)), unit: tidyUnit(rest.slice(bare[0].length)) };
  }

  const m = rest.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i);
  if (!m) return null;
  mant = parseFloat(m[1]);
  rest = rest.slice(m[0].length);

  // "×10^n" after the mantissa.
  const pow = rest.match(/^\s*[x×*·]\s*10\s*\^\s*([+-]?\d+)/i);
  if (pow) {
    mant *= Math.pow(10, parseInt(pow[1], 10));
    rest = rest.slice(pow[0].length);
  }
  if (!Number.isFinite(mant)) return null;
  return { value: mant, unit: tidyUnit(rest) };
}

/**
 * Parse a quantity against a table of accepted units.
 * @param {string} raw   what the person typed
 * @param {object} units tidied unit -> function(number) returning the value in
 *                       the field's own unit; '' is the bare-number case
 * @returns {{value:number}|{error:string}}
 */
export function parseWith(raw, units) {
  const q = splitQuantity(raw);
  if (!q) return { error: 'not a number' };
  const conv = units[q.unit];
  if (!conv) {
    const known = Object.keys(units).filter(Boolean);
    return { error: `unknown unit "${q.unit}"` + (known.length ? `. Try ${known.slice(0, 4).join(', ')}` : '') };
  }
  const v = conv(q.value);
  if (!Number.isFinite(v)) return { error: 'out of range' };
  return { value: v };
}

// ---- unit tables, each converting into the unit the field displays --------

const id = (v) => v;

export const UNITS = {
  km:      { '': id, km: id, m: (v) => v / 1000, ft: (v) => v * 0.0003048, kft: (v) => v * 0.3048 },
  kg:      { '': id, kg: id, t: (v) => v * 1e3, kt: (v) => v * 1e6, mt: (v) => v * 1e9, gt: (v) => v * 1e12 },
  sigma:   { '': id },
  suzuki:  { '': id },
  speed:   { '': id, 'm/s': id, ms: id, kt: (v) => v * 0.514444, kn: (v) => v * 0.514444,
             knots: (v) => v * 0.514444, 'km/h': (v) => v / 3.6, kmh: (v) => v / 3.6,
             kph: (v) => v / 3.6, mph: (v) => v * 0.44704 },
  degrees: { '': id, '°': id, deg: id },
  diffus:  { '': id, 'm2/s': id },
  density: { '': id, 'kg/m3': id, 'g/cm3': (v) => v * 1000 },
  times:   { '': id, x: id, '×': id },
  minutes: { '': id, min: id, m: id, mins: id, s: (v) => v / 60, sec: (v) => v / 60,
             h: (v) => v * 60, hr: (v) => v * 60, hrs: (v) => v * 60, hour: (v) => v * 60, hours: (v) => v * 60 },
  // Grain size: a bare number is phi; a length is converted, phi = -log2(mm).
  phi:     { '': id, phi: id, 'φ': id,
             mm: (v) => (v > 0 ? -Math.log2(v) : NaN),
             um: (v) => (v > 0 ? -Math.log2(v / 1000) : NaN),
             cm: (v) => (v > 0 ? -Math.log2(v * 10) : NaN) }
};

const COMPASS = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse',
                 's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw'];

/** A wind direction: degrees, or a compass point such as WSW. Wrapped to 0-360. */
export function parseDirection(raw) {
  const s = String(raw).trim().toLowerCase();
  const k = COMPASS.indexOf(s);
  if (k >= 0) return { value: k * 22.5 };
  const r = parseWith(raw, UNITS.degrees);
  if ('error' in r) return r;
  return { value: ((r.value % 360) + 360) % 360 };
}

/** Grain size, allowing a leading φ or "phi" as well as a trailing unit. */
export function parsePhi(raw) {
  return parseWith(String(raw).trim().replace(/^(φ|phi)\s*/i, ''), UNITS.phi);
}

/** Suzuki A, allowing a leading "A". */
export function parseSuzuki(raw) {
  return parseWith(String(raw).trim().replace(/^a\s*=?\s*/i, ''), UNITS.suzuki);
}
