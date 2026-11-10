// Build of the static site from the site export (src/faers_pipeline/export.py).
//
// Inputs, read at build time only:
//   SITE_EXPORT (default ../data/site_export)  meta.json, manifest.json, json/, parquet/
//   ../config/site.yaml                         site settings, concentration alert, downloads
//   ../config/faers.yaml                        FDA landing page (footer link)
//   ../docs/limitations.md                      sections rendered into the Method & limitations page
//                                               (config/site.yaml method_page.sections), after
//                                               the plain layer (method_page.plain)
// Output: SITE_OUT (default dist): index.html, assets/, and data/ (a copy of the export).
// base './': every URL in the build is relative, so it works under any sub-path
// (GitHub Pages project sites live under /<repo>/).
import { execFileSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import YAML from 'yaml';
import { collapseSections, dropTitle, linkRepoPaths, selectSections, wrapTables } from './src/lib/markdown.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const EXPORT_DIR = resolve(HERE, process.env.SITE_EXPORT || '../data/site_export');
const OUT_DIR = resolve(HERE, process.env.SITE_OUT || 'dist');
const EXPORT_SCHEMA_VERSION = 2;
// Link-preview image (Open Graph, Twitter), made by scripts/readme-shots.mjs from the home page.
const OG_IMAGE = { src: 'src/og/og-image.jpg', out: 'og-image.jpg', width: 1200, height: 630 };
const DATA_ENTRIES = ['meta.json', 'manifest.json', 'json', 'parquet'];
// Branch the Method page links to on GitHub.
const SOURCE_BRANCH = 'main';

const readYaml = (rel) => YAML.parse(readFileSync(join(REPO, rel), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadInputs() {
  const metaPath = join(EXPORT_DIR, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`site export not found: ${metaPath} (run make export)`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (meta.schema_version !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`export schema_version ${meta.schema_version}, expected ${EXPORT_SCHEMA_VERSION}`);
  }
  if (!meta.formats.includes('json')) throw new Error('the site needs the json export format');
  const manifest = JSON.parse(readFileSync(join(EXPORT_DIR, 'manifest.json'), 'utf8'));
  const siteCfg = readYaml('config/site.yaml');
  const faersCfg = readYaml('config/faers.yaml');
  const parquet = manifest.files
    .filter((f) => f.path.startsWith('parquet/'))
    .map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 }));
  return {
    meta,
    config: {
      // Only what the pages use (the bundle is checked for unexpected URLs).
      site: {
        title: siteCfg.site.title,
        repo_url: siteCfg.site.repo_url,
        fda_source_name: siteCfg.site.fda_source_name,
        meddra_notice: siteCfg.site.meddra_notice,
        pairs_page_size: siteCfg.site.pairs_page_size,
        author: siteCfg.site.author,
        home_examples: siteCfg.site.home_examples,
      },
      alert: siteCfg.concentration_alert,
      downloads: siteCfg.downloads,
      fdaUrl: faersCfg.source.landing_page,
      parquet,
    },
    // Head tags only: kept out of the bundle, whose URLs must start with an allowed link prefix.
    head: { public_url: siteCfg.site.public_url, description: siteCfg.site.description },
  };
}

// The header banner, notice and footer are part of the static HTML: they show before any data
// loads and without JavaScript.
function shellHtml(meta, config, head) {
  // Dashed tag: the shared "provisional" motif (dashed tag here, hatched bar and * in charts).
  const provisional = meta.last_quarter_is_provisional
    ? ` <span class="tag tag-provisional" title="Its cases are still growing as later FAERS files arrive">Latest quarter (${esc(meta.provisional_quarter)}) is provisional</span>`
    : '';
  const rxnorm = meta.rxnorm_versions.length ? meta.rxnorm_versions.join(', ') : 'not recorded';
  const author = config.site.author;
  return {
    '<!--BANNER-->': `<span>Data through <strong>${esc(meta.last_quarter)}</strong> · exported ${esc(meta.export_date)} (UTC)</span>${provisional}`,
    // Legal texts keep their wording; only the layout is in three columns.
    '<!--FOOTER-->': [
      '<div class="footer-cols">',
      `<section aria-labelledby="ft-data"><h2 id="ft-data">Data</h2><p>Source: <a href="${esc(config.fdaUrl)}" rel="noopener">${esc(config.site.fda_source_name)}</a>, quarterly files ${esc(meta.first_quarter)} to ${esc(meta.last_quarter)}. The FDA does not endorse this project.</p></section>`,
      `<section aria-labelledby="ft-drugs"><h2 id="ft-drugs">Drug names</h2><p>Drug names mapped with RxNorm (release ${esc(rxnorm)}); the mapping is not updated with later RxNorm releases and may not reflect the most current or accurate data available from NLM.</p>`,
      `<p class="attribution">${esc(meta.rxnav_attribution)}</p></section>`,
      `<section aria-labelledby="ft-terms"><h2 id="ft-terms">Reaction terms (MedDRA PT)</h2><p class="meddra">${esc(config.site.meddra_notice)}</p></section>`,
      '</div>',
      `<p class="footer-last">Data exported ${esc(meta.export_date)} (UTC). Not medical advice. Static site: no tracking, no external requests. <a href="#/method">Method &amp; limitations</a> · <a href="#/downloads">Downloads</a> · <a href="${esc(config.site.repo_url)}" rel="noopener">Source code</a> · Built by <a href="${esc(author.url)}" rel="noopener">${esc(author.name)}</a></p>`,
    ].join('\n'),
    '<!--TITLE-->': esc(config.site.title),
    // Description and link previews. Absolute URLs, as Open Graph requires; nothing is loaded
    // from them by the page.
    '<!--META-->': [
      `<meta name="description" content="${esc(head.description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(config.site.title)}" />`,
      `<meta property="og:title" content="${esc(config.site.title)}" />`,
      `<meta property="og:description" content="${esc(head.description)}" />`,
      `<meta property="og:url" content="${esc(head.public_url)}" />`,
      `<meta property="og:image" content="${esc(head.public_url + OG_IMAGE.out)}" />`,
      `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
      `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
      `<meta property="og:image:alt" content="${esc(`Home page of the ${config.site.title}`)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(config.site.title)}" />`,
      `<meta name="twitter:description" content="${esc(head.description)}" />`,
      `<meta name="twitter:image" content="${esc(head.public_url + OG_IMAGE.out)}" />`,
    ].join('\n    '),
  };
}

// 'file', 'dir' or null for a repository path: only versioned files are linked, so a link never
// points to a local file that is not on GitHub. Without git, files on disk are used instead.
function repoPathKind() {
  let tracked = null;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    tracked = null;
  }
  if (!tracked) {
    return (p) => {
      const f = join(REPO, p);
      if (!existsSync(f)) return null;
      return statSync(f).isDirectory() ? 'dir' : 'file';
    };
  }
  const files = new Set(tracked);
  const dirs = new Set(tracked.flatMap((t) => t.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  return (p) => (files.has(p) ? 'file' : dirs.has(p) ? 'dir' : null);
}

function serveExport(req, res, next) {
  const url = new URL(req.url, 'http://x');
  const m = /\/data\/(.*)$/.exec(url.pathname);
  if (!m) return next();
  const file = normalize(join(EXPORT_DIR, decodeURIComponent(m[1])));
  if (!file.startsWith(EXPORT_DIR) || !existsSync(file) || statSync(file).isDirectory()) return next();
  res.setHeader('Content-Type', extname(file) === '.json' ? 'application/json' : 'application/octet-stream');
  createReadStream(file).pipe(res);
}

function siteData() {
  let inputs;
  const virt = { 'virtual:site-config': '\0site-config', 'virtual:limitations': '\0limitations' };
  return {
    name: 'faers-site-data',
    buildStart() {
      inputs = loadInputs();
      this.addWatchFile(join(REPO, 'docs/limitations.md'));
      this.addWatchFile(join(REPO, 'config/site.yaml'));
    },
    resolveId(id) {
      return virt[id];
    },
    load(id) {
      if (id === '\0site-config') {
        return `export const meta = ${JSON.stringify(inputs.meta)};\nexport const config = ${JSON.stringify(inputs.config)};`;
      }
      if (id === '\0limitations') {
        // Tables go in focusable scroll regions (src/lib/markdown.js): a wide table must not be a
        // scroll container the keyboard cannot reach (axe scrollable-region-focusable).
        // Only the sections listed in config/site.yaml method_page; the rest stays in the repository.
        const siteCfg = readYaml('config/site.yaml');
        const md = selectSections(readFileSync(join(REPO, 'docs/limitations.md'), 'utf8'), siteCfg.method_page.sections);
        // The document's own title is dropped (the page has its own), and repository paths
        // written as code become links to GitHub (config/site.yaml allowed_link_prefixes).
        const html = wrapTables(linkRepoPaths(dropTitle(marked.parse(md, { gfm: true })), siteCfg.site.repo_url, SOURCE_BRANCH, repoPathKind()));
        // Each section collapsed under its heading; the plain layer travels in the same chunk, so
        // the main bundle of the other pages does not carry it.
        const { lead, sections } = collapseSections(html);
        return `export const lead = ${JSON.stringify(lead)};
export const sections = ${JSON.stringify(sections)};
export const plain = ${JSON.stringify(siteCfg.method_page.plain)};`;
      }
      return null;
    },
    transformIndexHtml(html) {
      inputs = inputs || loadInputs();
      let out = html;
      for (const [k, v] of Object.entries(shellHtml(inputs.meta, inputs.config, inputs.head))) out = out.replaceAll(k, v);
      return out;
    },
    configureServer(server) {
      server.middlewares.use(serveExport);
    },
    closeBundle() {
      // GitHub Pages runs Jekyll on branch deployments unless .nojekyll exists, and Jekyll
      // drops files whose names start with "_" (such as Vite's chunk for a virtual module).
      writeFileSync(join(OUT_DIR, '.nojekyll'), '');
      // The SIL OFL requires the license to travel with the font files (Source Serif 4).
      cpSync(join(HERE, 'src/fonts/OFL.txt'), join(OUT_DIR, 'fonts/OFL.txt'));
      cpSync(join(HERE, OG_IMAGE.src), join(OUT_DIR, OG_IMAGE.out));
      for (const entry of DATA_ENTRIES) {
        const src = join(EXPORT_DIR, entry);
        if (existsSync(src)) cpSync(src, join(OUT_DIR, 'data', entry), { recursive: true });
      }
    },
  };
}

export default {
  base: './',
  publicDir: false,
  plugins: [siteData()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // Jekyll (GitHub Pages branch builds) skips files whose names start with "_"; the chunk of a
    // virtual module would otherwise be named "_limitations-<hash>.js".
    rolldownOptions: {
      output: { chunkFileNames: (chunk) => `assets/${chunk.name.replace(/^[_.]+/, '')}-[hash].js` },
    },
  },
};
