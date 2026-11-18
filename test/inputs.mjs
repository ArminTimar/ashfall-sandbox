// Guards the typed-input parser and the VEI classes.
//
//   node test/inputs.mjs

import { splitQuantity, parseWith, parseDirection, parsePhi, parseSuzuki, UNITS } from '../js/parse.js';
import { VEI, veiOfMass, veiOfVolume } from '../js/vei.js';

let fail = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

function expect(label, got, want) {
  if (want === null) {
    check(got && 'error' in got, `${label}: expected an error, got ${JSON.stringify(got)}`);
  } else {
    check(got && 'value' in got && close(got.value, want),
      `${label}: expected ${want}, got ${JSON.stringify(got)}`);
  }
}

// --- number forms ------------------------------------------------------------
const forms = [
  ['2.5', 2.5], ['-3', -3], ['.5', 0.5], ['2.5e10', 2.5e10], ['2.5E10', 2.5e10],
  ['2.5×10^10', 2.5e10], ['2.5x10^10', 2.5e10], ['2.5*10^10', 2.5e10],
  ['2.5 × 10¹⁰', 2.5e10], ['2.5·10⁻³', 2.5e-3], ['10^8', 1e8], ['10⁸', 1e8],
  ['−15', -15], ['2,5', 2.5], ['2,500', 2500], ['20,000', 20000], ['1,234,567', 1234567],
  // A decimal comma followed by three digits is still a decimal comma when
  // the whole part cannot be a thousands group.
  ['0,125', 0.125], ['0,5', 0.5], ['2,5e10', 2.5e10], ['1234,567', 1234.567], ['2,500.5', 2500.5]
];
for (const [s, v] of forms) {
  const q = splitQuantity(s);
  check(q && close(q.value, v) && q.unit === '', `"${s}" should read as ${v}, got ${JSON.stringify(q)}`);
}
for (const bad of ['', 'abc', 'e8', '×10^3']) {
  check(splitQuantity(bad) === null, `"${bad}" should not parse`);
}

// --- units -------------------------------------------------------------------
expect('mass kg',         parseWith('2e8 kg', UNITS.kg), 2e8);
expect('mass t',          parseWith('500 t', UNITS.kg), 5e5);
expect('mass Mt',         parseWith('200 Mt', UNITS.kg), 2e11);
expect('mass Gt',         parseWith('1.5 Gt', UNITS.kg), 1.5e12);
expect('mass bad unit',   parseWith('3 lb', UNITS.kg), null);
expect('height m',        parseWith('5500 m', UNITS.km), 5.5);
expect('height ft',       parseWith('30000 ft', UNITS.km), 9.144);
expect('speed knots',     parseWith('40 kt', UNITS.speed), 40 * 0.514444);
expect('speed km/h',      parseWith('36 km/h', UNITS.speed), 10);
expect('density g/cm³',   parseWith('1.2 g/cm³', UNITS.density), 1200);
expect('density kg/m³',   parseWith('1200 kg/m³', UNITS.density), 1200);
expect('K m²/s',          parseWith('2,500 m²/s', UNITS.diffus), 2500);
expect('minutes h',       parseWith('1.5 h', UNITS.minutes), 90);
expect('minutes s',       parseWith('300 s', UNITS.minutes), 5);

// --- grain size --------------------------------------------------------------
expect('phi bare',        parsePhi('2'), 2);
expect('phi prefixed',    parsePhi('φ 2.5'), 2.5);
expect('phi 250 µm',      parsePhi('250 µm'), 2);
expect('phi 250 um',      parsePhi('250um'), 2);
expect('phi 2 mm',        parsePhi('2 mm'), -1);
expect('phi 63 µm',       parsePhi('62.5 µm'), 4);
expect('phi zero size',   parsePhi('0 mm'), null);
expect('phi 0,125 mm',    parsePhi('0,125 mm'), 3);

// --- direction ---------------------------------------------------------------
expect('dir degrees',     parseDirection('270'), 270);
expect('dir with °',      parseDirection('45°'), 45);
expect('dir wraps',       parseDirection('370'), 10);
expect('dir negative',    parseDirection('-90'), 270);
expect('dir WSW',         parseDirection('WSW'), 247.5);
expect('dir lower n',     parseDirection('n'), 0);

expect('suzuki A=4',      parseSuzuki('A=4'), 4);
expect('suzuki bare',     parseSuzuki('5.5'), 5.5);

// --- VEI ---------------------------------------------------------------------
check(VEI.length === 9 && VEI.every((c, i) => c.vei === i), 'VEI table should run 0 to 8 in order');
for (let i = 1; i < VEI.length; i++) {
  check(VEI[i].lo === VEI[i - 1].hi, `VEI ${i} should start where VEI ${i - 1} ends`);
}
const cases = [[5e3, 0], [1e4, 1], [9.9e5, 1], [1e6, 2], [5e7, 3], [4e8, 4], [1e12, 8], [1e15, 8]];
for (const [v, want] of cases) {
  check(veiOfVolume(v).vei === want, `${v} m³ should be VEI ${want}, got ${veiOfVolume(v).vei}`);
}
// The sandbox presets should land where their names say.
check(veiOfMass(10 ** 11.6, 1000).vei === 4, 'the Taishō-scale preset should read VEI 4, as 1914 was');
check(veiOfMass(10 ** 7.5, 1000).vei <= 2, 'the routine-vulcanian preset should be VEI 2 or less');
// Denser deposit, same mass, smaller volume: the class can only go down.
check(veiOfMass(2e9, 2000).vei <= veiOfMass(2e9, 500).vei, 'raising density should never raise the VEI');

console.log(fail ? `\n${fail} FAILED` : 'OK - typed inputs parse and VEI classes are consistent');
process.exit(fail ? 1 : 0);
