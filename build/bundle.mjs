// Bundles the app into dist/: JS (esbuild), CSS, data, vendor font, icons, manifest and service worker.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

await build({ entryPoints: [path.join(ROOT, 'src/main.js')], bundle: true, minify: true, format: 'esm', target: ['chrome110'], outfile: path.join(DIST, 'app.js') });

const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(DIST, to)), { recursive: true }); fs.copyFileSync(path.join(ROOT, from), path.join(DIST, to)); };
copy('src/app.css', 'app.css');
copy('public/data/cards.json', 'data/cards.json');
copy('public/data/rules.json', 'data/rules.json');
copy('node_modules/mana-font/css/mana.min.css', 'vendor/mana.min.css');
for (const f of ['mana.woff2', 'mana.woff', 'mana.ttf']) copy(`node_modules/mana-font/fonts/${f}`, `fonts/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'public/icons'))) copy(`public/icons/${f}`, `icons/${f}`);
copy('public/manifest.webmanifest', 'manifest.webmanifest');
copy('public/robots.txt', 'robots.txt');
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// version = hash of everything that matters
const h = crypto.createHash('sha1');
for (const f of ['app.js', 'app.css', 'data/cards.json', 'data/rules.json']) h.update(fs.readFileSync(path.join(DIST, f)));
const VERSION = h.digest('hex').slice(0, 10);

const stamp = (file, extra = {}) => { let s = fs.readFileSync(file, 'utf8').replaceAll('__VERSION__', VERSION); for (const [k, v] of Object.entries(extra)) s = s.replaceAll(k, v); return s; };
fs.writeFileSync(path.join(DIST, 'index.html'), stamp(path.join(ROOT, 'src/index.html')));
fs.writeFileSync(path.join(DIST, 'app.js'), fs.readFileSync(path.join(DIST, 'app.js'), 'utf8').replaceAll('__VERSION__', VERSION));
const precache = ['./', 'index.html', 'app.js', 'app.css', 'data/cards.json', 'data/rules.json', 'vendor/mana.min.css', 'fonts/mana.woff2', 'fonts/mana.woff', 'fonts/mana.ttf', 'manifest.webmanifest', ...fs.readdirSync(path.join(DIST, 'icons')).map(f => 'icons/' + f)];
fs.writeFileSync(path.join(DIST, 'sw.js'), stamp(path.join(ROOT, 'src/sw.js'), { __PRECACHE__: JSON.stringify(precache) }));
console.log('built', VERSION, fs.readdirSync(DIST));
