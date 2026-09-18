// Guards the seam between index.html and the modules that reach into it.
//
// Nothing here is clever: it checks that no element id is used twice, and that
// every id the JavaScript looks up by a literal string actually exists in the
// page. Both failures are silent at runtime — getElementById returns the wrong
// element or null, and you find out when a readout quietly stops updating or a
// listener is never attached. Adding a second element with an existing id is
// especially easy to do while adding a control block.
//
//   node test/markup.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { HELP } from '../js/help.js';
import { FIELDS } from '../js/ui.js';

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.log('  FAIL ' + msg); fail++; } };

const html = readFileSync('index.html', 'utf8');

// --- 1. no duplicate ids ----------------------------------------------------
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const seen = new Set(), dupes = new Set();
for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
for (const d of dupes) check(false, `id "${d}" is used ${ids.filter((i) => i === d).length} times`);
console.log(`  ${ids.length} ids, ${seen.size} distinct`);

// --- 2. every literal id the JS looks up exists -----------------------------
const files = readdirSync('js').filter((f) => f.endsWith('.js'));
let looked = 0, dynamic = 0;
for (const f of files) {
  const src = readFileSync(`js/${f}`, 'utf8');
  // $('x') and getElementById('x'), literal arguments only
  for (const m of src.matchAll(/(?:\$|getElementById)\(\s*'([^']+)'\s*\)/g)) {
    looked++;
    check(seen.has(m[1]), `js/${f} looks up #${m[1]}, which is not in index.html`);
  }
  // Concatenated ids can't be checked from here; count them so the number
  // below is honest about what this test does and does not cover.
  dynamic += [...src.matchAll(/(?:\$|getElementById)\(\s*'[^']*'\s*\+/g)].length;
}
console.log(`  ${looked} literal lookups checked across ${files.length} modules`
  + `  (${dynamic} built by concatenation, not checked)`);

// --- 3. ids the modules declare they will bind ------------------------------
// vectors.js names its own checkbox ids, so a layer added there without markup
// would silently never bind.
const vsrc = readFileSync('js/vectors.js', 'utf8');
for (const m of vsrc.matchAll(/id:\s*'(t-[\w-]+)'/g)) {
  check(seen.has(m[1]), `vectors.js declares toggle #${m[1]}, which is not in index.html`);
}

// --- 4. every numeric field has its slider, text box and hint line ----------
// ui.js builds these ids by concatenation, which section 2 cannot see.
for (const F of FIELDS) {
  for (const pre of ['s-', 'n-', 'h-']) {
    check(seen.has(pre + F.id), `ui.js field "${F.id}" expects #${pre}${F.id}, which is not in index.html`);
  }
}
console.log(`  ${FIELDS.length} numeric fields, each with slider, text box and hint`);

// --- 5. help buttons and help text match one to one --------------------------
const helpKeys = [...html.matchAll(/data-help="([^"]+)"/g)].map((m) => m[1]);
for (const k of helpKeys) check(k in HELP, `a help button asks for "${k}", which js/help.js does not define`);
for (const k of Object.keys(HELP)) check(helpKeys.includes(k), `js/help.js defines "${k}" but no button uses it`);
console.log(`  ${helpKeys.length} help buttons, ${Object.keys(HELP).length} entries`);

// --- 6. the cache-busting stamp is current ---------------------------------
//
// GitHub Pages keeps files for 10 minutes, so after a release a browser can
// load the new index.html together with cached modules from the previous
// version and break on ids that no longer exist. tools/stamp.mjs tags every
// module and the data files with the version, which makes them new URLs.
{
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const mods = readdirSync('js').filter((f) => f.endsWith('.js'));
  check(html.includes(`<meta name="data-version" content="${version}">`),
    `index.html is not stamped with v${version}, run: node tools/stamp.mjs`);
  check(html.includes(`src="js/main.js?v=${version}"`),
    `the module script tag is not stamped with v${version}, run: node tools/stamp.mjs`);
  for (const m of mods) {
    check(html.includes(`"./js/${m}": "./js/${m}?v=${version}"`),
      `the import map is missing js/${m} at v${version}, run: node tools/stamp.mjs`);
  }
  console.log(`  stamped v${version}, import map covers ${mods.length} modules`);
}

console.log(fail ? `\n${fail} FAILED` : '\nOK - markup and module lookups agree');
process.exit(fail ? 1 : 0);
