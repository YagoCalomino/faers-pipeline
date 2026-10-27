// Checks a built site before it is committed to the gh-pages branch. Exit 1 on any problem.
//   sizes      total bytes, largest file and number of files within config/site.yaml limits (dist_*)
//   resources  nothing loaded from another origin: no http(s):// or protocol-relative URL in
//              src, link href, CSS url() or JS imports; no root-absolute URL ("/x" breaks under
//              the /<repo>/ base path of a GitHub Pages project site)
//   links      relative references in HTML and CSS point to files that exist; external
//              hyperlinks (also those in the JS bundle) start with an allowed prefix
//   data       data/manifest.json matches the copied files (size and sha256); every ingredient
//              of data/json/search.json has its file; .nojekyll exists
// Usage: node scripts/check-dist.mjs [dist]   (default dist; SITE_OUT also works)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const dist = resolve(SITE, process.argv[2] || process.env.SITE_OUT || 'dist');
const cfg = YAML.parse(readFileSync(resolve(SITE, '../config/site.yaml'), 'utf8'));
const limits = cfg.limits;
const allowed = cfg.site.allowed_link_prefixes;
// URLs that appear in the bundle as plain strings but are not loaded or linked.
const IGNORED_URLS = ['http://www.w3.org/2000/svg', 'http://x'];

const problems = [];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ path: relative(dist, p).split(sep).join('/'), bytes: st.size });
  }
})(dist);

// --- sizes
const total = files.reduce((s, f) => s + f.bytes, 0);
const largest = files.reduce((m, f) => (f.bytes > m.bytes ? f : m), { bytes: 0 });
if (total > limits.dist_max_total_bytes) problems.push(`total ${total} bytes > ${limits.dist_max_total_bytes}`);
if (largest.bytes > limits.dist_max_file_bytes) problems.push(`${largest.path} ${largest.bytes} bytes > ${limits.dist_max_file_bytes}`);
if (files.length > limits.dist_max_files) problems.push(`${files.length} files > ${limits.dist_max_files}`);

// --- resources and links
const isExternal = (u) => /^(https?:)?\/\//i.test(u);
const isSpecial = (u) => /^(#|data:|mailto:|javascript:void)/i.test(u) || u === '';
const allowedLink = (u) => allowed.some((p) => u.startsWith(p));
let checkedRefs = 0;

function checkRef(fromFile, url, kind) {
  if (isSpecial(url)) return;
  if (isExternal(url)) {
    if (kind === 'link' && allowedLink(url)) return;
    problems.push(`${fromFile}: external ${kind} ${url}`);
    return;
  }
  if (url.startsWith('/')) {
    problems.push(`${fromFile}: root-absolute ${kind} ${url} (breaks under ${cfg.site.base_path})`);
    return;
  }
  const clean = url.split(/[?#]/)[0];
  const target = posix.normalize(posix.join(posix.dirname(fromFile), clean));
  checkedRefs += 1;
  if (target.startsWith('..') || !existsSync(join(dist, target))) {
    problems.push(`${fromFile}: broken ${kind} ${url}`);
  }
}

for (const f of files.filter((x) => x.path.endsWith('.html'))) {
  const html = readFileSync(join(dist, f.path), 'utf8');
  for (const m of html.matchAll(/<(script|img|source|iframe)\b[^>]*\bsrc="([^"]*)"/gi)) checkRef(f.path, m[2], 'resource');
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const href = /\bhref="([^"]*)"/i.exec(m[1])?.[1] ?? '';
    checkRef(f.path, href, 'resource');
  }
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) checkRef(f.path, m[1], 'link');
  if (/@import|<style[^>]*>[^<]*url\(/i.test(html)) problems.push(`${f.path}: inline CSS import or url()`);
}
for (const f of files.filter((x) => x.path.endsWith('.css'))) {
  const css = readFileSync(join(dist, f.path), 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) checkRef(f.path, m[1], 'resource');
  if (/@import/i.test(css)) problems.push(`${f.path}: CSS @import`);
}
for (const f of files.filter((x) => x.path.endsWith('.js'))) {
  const js = readFileSync(join(dist, f.path), 'utf8');
  for (const m of js.matchAll(/\bimport\s*\(?\s*["'`]([^"'`]+)["'`]/g)) checkRef(f.path, m[1], 'resource');
  for (const m of js.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`<>)\\]*/gi)) {
    const url = m[0];
    if (IGNORED_URLS.some((i) => url.startsWith(i))) continue;
    if (!url.startsWith('http') || !allowedLink(url)) problems.push(`${f.path}: URL in bundle ${url}`);
  }
}

// Jekyll skips names starting with "_", "." or "#" (docs.github.com, About GitHub Pages and
// Jekyll); .nojekyll is the only such file allowed.
for (const f of files) {
  if (f.path.split('/').some((part) => /^[_.#]/.test(part)) && f.path !== '.nojekyll') {
    problems.push(`${f.path}: name starts with _, . or # (Jekyll would skip it)`);
  }
}

// --- data copy
if (!existsSync(join(dist, '.nojekyll'))) problems.push('.nojekyll missing (GitHub Pages would run Jekyll)');
const manifestPath = join(dist, 'data', 'manifest.json');
let dataFiles = 0;
if (!existsSync(manifestPath)) {
  problems.push('data/manifest.json missing');
} else {
  const listed = JSON.parse(readFileSync(manifestPath, 'utf8')).files;
  for (const f of listed) {
    const p = join(dist, 'data', f.path);
    if (!existsSync(p)) {
      problems.push(`data/${f.path} missing`);
      continue;
    }
    const buf = readFileSync(p);
    if (buf.length !== f.bytes || createHash('sha256').update(buf).digest('hex') !== f.sha256) {
      problems.push(`data/${f.path} differs from the export manifest`);
    }
    dataFiles += 1;
  }
  const onDisk = files.filter((f) => f.path.startsWith('data/') && f.path !== 'data/manifest.json').length;
  if (onDisk !== listed.length) problems.push(`data/ has ${onDisk} files, manifest lists ${listed.length}`);
  const search = JSON.parse(readFileSync(join(dist, 'data', 'json', 'search.json'), 'utf8'));
  const slugCol = search.columns.indexOf('slug');
  for (const row of search.rows) {
    if (!existsSync(join(dist, 'data', 'json', 'signals', `${row[slugCol]}.json`))) {
      problems.push(`no file for ingredient ${row[slugCol]}`);
    }
  }
}

const summary = {
  dist,
  files: files.length,
  total_bytes: total,
  largest_file: largest.path,
  largest_bytes: largest.bytes,
  relative_refs_checked: checkedRefs,
  data_files_verified: dataFiles,
  limits: { total: limits.dist_max_total_bytes, file: limits.dist_max_file_bytes, files: limits.dist_max_files },
  ok: problems.length === 0,
  problems,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(problems.length ? 1 : 0);
