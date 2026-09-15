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

console.log(fail ? `\n${fail} FAILED` : '\nOK - markup and module lookups agree');
process.exit(fail ? 1 : 0);
