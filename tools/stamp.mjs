// Tag every module and data URL in index.html with the package version.
//
//   node tools/stamp.mjs
//
// GitHub Pages tells browsers to keep files for 10 minutes. After a release a
// browser can load the new index.html together with cached modules from the
// previous version, and the page then breaks on ids that no longer exist. Run
// this before every release, after bumping the version in package.json.
//
// The source files keep their plain relative imports. index.html gets an
// import map that sends each js/<name>.js to js/<name>.js?v=<version>, so a new
// version is a new set of URLs and nothing stale is reused. The data files get
// the same tag through the DATA_VERSION meta tag, which main.js reads.
//
// test/markup.mjs checks the stamp matches package.json and covers every
// module, so a forgotten stamp fails the tests.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const modules = readdirSync('js').filter((f) => f.endsWith('.js')).sort();

const map = { imports: Object.fromEntries(modules.map((m) => [`./js/${m}`, `./js/${m}?v=${version}`])) };
const block = '<!-- stamp:start (written by tools/stamp.mjs) -->\n'
  + `<meta name="data-version" content="${version}">\n`
  + `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n</script>\n`
  + '<!-- stamp:end -->';

let html = readFileSync('index.html', 'utf8');
if (html.includes('<!-- stamp:start')) {
  html = html.replace(/<!-- stamp:start[\s\S]*?<!-- stamp:end -->/, block);
} else {
  html = html.replace('</head>', block + '\n</head>');
}
html = html.replace(/<script type="module" src="js\/main\.js(\?v=[^"]*)?"><\/script>/,
  `<script type="module" src="js/main.js?v=${version}"></script>`);
writeFileSync('index.html', html);
console.log(`stamped index.html with v${version} for ${modules.length} modules`);
