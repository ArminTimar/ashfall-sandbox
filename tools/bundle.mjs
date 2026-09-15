// Build dist/index.html: one self-contained file that works by double-click.
//
//   node tools/bundle.mjs
//
// The modular source needs an http server, because browsers refuse to load ES
// modules over file:// and refuse to read the terrain PNG into a canvas. This
// flattens everything into a single inline module — no imports left to fetch,
// the stylesheet inlined, the DEM as a data URI and three.js embedded — so the
// result opens straight from disk and works offline.
//
// The flattening relies on no module reassigning an exported binding (see the
// notes on `stats` and `parts` in the source); each module becomes an IIFE
// returning its exports, so name collisions between modules cannot happen.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');
const CACHE = join(ROOT, 'tools', '.cache');
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

// Dependency order. params.js has no imports; main.js is the entry point.
const ORDER = [
  'params.js', 'physics.js', 'grid.js', 'terrain.js',
  'texture.js', 'particles.js', 'scene.js', 'ui.js', 'main.js'
];

/**
 * Rewrite one ES module into an IIFE that returns its exports.
 * Returns the code plus the names it exports and the names it imports, so the
 * caller can cross-check them — a rewriter that quietly drops an export
 * produces a bundle that loads fine and computes nothing, which is exactly the
 * failure this check exists to prevent.
 */
function wrapModule(name, src) {
  const exported = [];
  const imported = [];

  // import { a, b } from './x.js';   (may span several lines)
  let code = src.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([\w.-]+)['"];?\s*$/gm,
    (_, names, mod) => {
      const list = names.split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of list) imported.push({ from: mod, id });
      return `const { ${list.join(', ')} } = __M['${mod}'];`;
    }
  );

  // export const/let/var/function/class NAME  ->  drop the keyword, keep NAME
  code = code.replace(
    /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_, kind, id) => { exported.push(id); return `${kind} ${id}`; }
  );

  if (/^export\s/m.test(code)) {
    throw new Error(`${name}: unsupported export form, bundler needs updating`);
  }

  const tail = exported.map((id) => `  __e.${id} = ${id};`).join('\n');
  return {
    code: `__M['${name}'] = (function () {\n  const __e = {};\n${code}\n${tail}\n  return __e;\n})();`,
    exported,
    imported
  };
}

async function getThree() {
  const cached = join(CACHE, 'three.min.js');
  if (existsSync(cached)) return readFile(cached, 'utf8');
  process.stdout.write('fetching three.js … ');
  try {
    const res = await fetch(THREE_URL);
    if (!res.ok) throw new Error(String(res.status));
    const txt = await res.text();
    await mkdir(CACHE, { recursive: true });
    await writeFile(cached, txt);
    console.log(`${(txt.length / 1024).toFixed(0)} KB, cached`);
    return txt;
  } catch (e) {
    console.log(`failed (${e.message}) — falling back to the CDN script tag`);
    return null;
  }
}

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const css = await readFile(join(ROOT, 'css', 'style.css'), 'utf8');
const terrain = await readFile(join(ROOT, 'data', 'terrain.png'));
const three = await getThree();

const wrapped = new Map();
for (const name of ORDER) {
  wrapped.set(name, wrapModule(name, await readFile(join(ROOT, 'js', name), 'utf8')));
}

// Every name someone imports must actually be exported by the module it comes
// from. Without this a dropped export just becomes `undefined` at runtime and
// the bundle silently computes zeros.
const missing = [];
for (const [name, m] of wrapped) {
  for (const { from, id } of m.imported) {
    const src = wrapped.get(from);
    if (!src) { missing.push(`${name}: imports from unknown module ${from}`); continue; }
    if (!src.exported.includes(id)) missing.push(`${name}: '${id}' is not exported by ${from}`);
  }
}
if (missing.length) {
  console.error('bundle aborted — export/import mismatch:');
  for (const m of missing) console.error('  ' + m);
  console.error('\n(a common cause is `export const A = 1, B = 2;` — the rewriter\n'
    + ' handles one declarator per statement, so split it)');
  process.exit(1);
}

const modules = ORDER.map((n) => wrapped.get(n).code);

const terrainUrl = 'data:image/png;base64,' + terrain.toString('base64');
const bundle = [
  'const __M = {};',
  `const __TERRAIN_URL = ${JSON.stringify(terrainUrl)};`,
  ...modules
].join('\n\n').replace(/loadTerrain\((['"])data\/terrain\.png\1\)/g, 'loadTerrain(__TERRAIN_URL)');

let out = html
  .replace(/<link rel="stylesheet" href="css\/style\.css">/,
    `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="js\/main\.js"><\/script>/,
    `<script type="module">\n${bundle}\n</script>`);

if (three) {
  out = out.replace(
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/[^"]+"><\/script>/,
    `<script>\n${three}\n</script>`
  );
}

// The file:// warning is pointless once the page actually works from file://.
out = out.replace(/<!-- Classic script[\s\S]*?<\/script>/, '');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'index.html'), out);
console.log(`wrote dist/index.html  ${(out.length / 1024 / 1024).toFixed(2)} MB`
  + `  (terrain ${(terrain.length / 1024).toFixed(0)} KB`
  + `${three ? `, three.js ${(three.length / 1024).toFixed(0)} KB` : ', three.js from CDN'})`);
console.log('opens straight from disk — no server needed');
