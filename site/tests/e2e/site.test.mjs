// Browser tests of a built site (default dist-ci, the fixture build; SITE_OUT=dist for the real
// one), served under /faers-pipeline/ like a GitHub Pages project site. Headless Chromium from
// Playwright; accessibility rules from axe-core (WCAG 2.0/2.1 A and AA tags).
// Run: npm run test:e2e   (PLAYWRIGHT_BROWSERS_PATH=.pw-browsers)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';
import YAML from 'yaml';
import { startServer } from '../../scripts/serve.mjs';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = resolve(SITE, process.env.SITE_OUT || 'dist-ci');
const PREFIX = '/faers-pipeline/';
const PORT = 8310;
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;
const RXNORM = YAML.parse(readFileSync(resolve(SITE, '../config/rxnorm.yaml'), 'utf8'));
const ATTRIBUTION = RXNORM.attribution_text.split(/\s+/).join(' ');
const SITE_CFG = YAML.parse(readFileSync(resolve(SITE, '../config/site.yaml'), 'utf8'));
const MEDDRA = SITE_CFG.site.meddra_notice;
const META = JSON.parse(readFileSync(resolve(DIST, 'data/meta.json'), 'utf8'));
const SEARCH = JSON.parse(readFileSync(resolve(DIST, 'data/json/search.json'), 'utf8'));
const FIRST = SEARCH.rows[0][SEARCH.columns.indexOf('slug')];
const FIRST_DOC = JSON.parse(readFileSync(resolve(DIST, `data/json/signals/${FIRST}.json`), 'utf8'));
const PAIR_KEY = FIRST_DOC.pairs[0].reaction_key;
const ROUTES = {
  home: '',
  ingredient: `#/ingredient/${FIRST}`,
  pair: `#/ingredient/${FIRST}/${PAIR_KEY}`,
  quality: '#/quality',
  validation: '#/validation',
  method: '#/method',
  downloads: '#/downloads',
};
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let server;
let browser;
const report = { axe: {}, keyboard: [] };

before(async () => {
  server = await startServer({ root: DIST, port: PORT, prefix: PREFIX, gzip: false });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
  console.log(`E2E_REPORT ${JSON.stringify(report)}`);
});

async function open(route, opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && problems.push(`console ${m.text()}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['127.0.0.1'].includes(u.hostname) && u.protocol !== 'data:') problems.push(`external request ${r.url()}`);
  });
  await page.goto(BASE + route);
  await page.locator('main h1').first().waitFor();
  await page.waitForLoadState('networkidle');
  return { ctx, page, problems };
}

test('every page renders its heading, banner, notice and footer, with no external request', async () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    const { ctx, page, problems } = await open(route);
    assert.equal(await page.locator('main h1').count() >= 1, true, name);
    const banner = await page.locator('#data-banner').innerText();
    assert.match(banner, new RegExp(`Data through ${META.last_quarter}`), name);
    if (META.last_quarter_is_provisional) assert.match(banner, /latest quarter is provisional/, name);
    assert.match(await page.locator('.notice').innerText(), /do not show that the drug causes the reaction/);
    assert.equal(await page.locator('footer .attribution').innerText(), ATTRIBUTION, name);
    assert.equal(await page.locator('footer .meddra').innerText(), MEDDRA, name);
    if (name === 'downloads') assert.equal(await page.locator('main .meddra').innerText(), MEDDRA);
    assert.match(await page.locator('footer').innerText(), /The FDA does not endorse this project\./, name);
    assert.match(await page.locator('footer').innerText(), new RegExp(`Data exported ${META.export_date}`));
    assert.match(await page.locator('footer').innerText(), new RegExp(META.rxnorm_versions[0] ?? 'not recorded'));
    assert.deepEqual(problems, [], name);
    const text = (await page.locator('body').innerText()).toLowerCase();
    assert.ok(!text.includes('confirmed signal'), `${name}: wording`);
    await ctx.close();
  }
});

test('home: search by keyboard opens the ingredient', async () => {
  const { ctx, page } = await open(ROUTES.home);
  const name = FIRST_DOC.ingredient.ingredient_name;
  const input = page.getByRole('combobox', { name: 'Ingredient name' });
  await input.focus();
  await page.keyboard.type(name.slice(0, 4));
  await page.getByRole('listbox').waitFor();
  assert.equal(await input.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await input.getAttribute('aria-activedescendant'), 'q-opt-0');
  await page.keyboard.press('Enter');
  await page.waitForURL(`**${ROUTES.ingredient}`);
  await page.getByRole('heading', { level: 1, name }).waitFor();
  await ctx.close();
});

// The alert rule written out independently of src/lib/logic.js (config/site.yaml).
const ALERT = YAML.parse(readFileSync(resolve(SITE, '../config/site.yaml'), 'utf8')).concentration_alert;
function flagged(p) {
  const out = [];
  if (p.a >= ALERT.min_cases_for_quarter_rule && p.top_quarter_share >= ALERT.min_top_quarter_share) out.push('quarter');
  if (p.median_reactions_per_case >= ALERT.min_median_reactions_per_case) out.push('long_reports');
  if (
    p.a >= ALERT.min_cases_for_country_rule &&
    p.top_country_share >= ALERT.min_top_country_share &&
    p.top_country != null &&
    p.ingredient_top_country != null &&
    p.top_country !== p.ingredient_top_country
  )
    out.push('country');
  return out;
}

test('ingredient: sortable columns and concentration alerts follow the config rule', async () => {
  const { ctx, page } = await open(ROUTES.ingredient);
  const values = async (field) =>
    page.locator(`table.pairs td[data-field="${field}"]`).evaluateAll((tds) => tds.map((td) => td.dataset.value));
  await page.getByRole('button', { name: /^PRR/ }).click();
  assert.equal(await page.locator('th:has(button[data-sort="prr"])').getAttribute('aria-sort'), 'descending');
  const prr = (await values('prr')).filter((v) => v !== '').map(Number);
  assert.deepEqual(prr, [...prr].sort((a, b) => b - a));
  await page.getByRole('button', { name: /^PRR/ }).click();
  assert.equal(await page.locator('th:has(button[data-sort="prr"])').getAttribute('aria-sort'), 'ascending');
  await page.getByRole('button', { name: /^Cases/ }).click();
  const a = (await values('a')).map(Number);
  assert.deepEqual(a, [...a].sort((x, y) => y - x));
  const expected = FIRST_DOC.pairs.filter((p) => flagged(p).length).length;
  assert.equal(await page.locator('table.pairs .alert-badge').count(), Math.min(expected, 30));
  await ctx.close();
});

test('country alert: the badge and the pair page give the country and the ingredient share', async () => {
  // The first pair of the export flagged by the country rule (the fixture holds atorvastatin's).
  let found;
  for (const row of SEARCH.rows) {
    const slug = row[SEARCH.columns.indexOf('slug')];
    const doc = JSON.parse(readFileSync(resolve(DIST, `data/json/signals/${slug}.json`), 'utf8'));
    const p = doc.pairs.find((x) => flagged(x).includes('country'));
    if (p) {
      found = { slug, p };
      break;
    }
  }
  assert.ok(found, 'the export has a pair flagged by the country rule');
  const { slug, p } = found;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const ingPct = p.ingredient_country_share > 0 && p.ingredient_country_share < 0.005 ? '<1%' : pct(p.ingredient_country_share);
  const regions = new Intl.DisplayNames(['en'], { type: 'region' });
  const country = (code) => `${regions.of(code)} (${code})`;
  const esc = (t) => t.replace(/[()]/g, '\\$&');
  const text = `${pct(p.top_country_share)} of cases from ${country(p.top_country)}; ingredient: ${ingPct} ${p.top_country}`;
  const ing = await open(`#/ingredient/${slug}`);
  const row = ing.page.locator('table.pairs tbody tr', { has: ing.page.locator(`a[href$="/${p.reaction_key}"]`) });
  const badge = await row.locator('.alert-badge').innerText();
  assert.ok(badge.includes(text), `badge "${badge}" lacks "${text}"`);
  assert.match(await ing.page.locator('#alert-legend').innerText(), /^Concentration alert: /);
  const axeIng = await new AxeBuilder({ page: ing.page }).withTags(AXE_TAGS).analyze();
  assert.deepEqual(axeIng.violations.map((v) => v.id), [], 'axe on the ingredient page');
  await ing.ctx.close();
  const pair = await open(`#/ingredient/${slug}/${p.reaction_key}`);
  const callout = await pair.page.locator('.callout.warn').innerText();
  assert.match(callout, new RegExp(esc(`${pct(p.top_country_share)} of these cases come from ${country(p.top_country)}`)));
  assert.match(callout, new RegExp(esc(`most frequent country is ${country(p.ingredient_top_country)}`)));
  const axePair = await new AxeBuilder({ page: pair.page }).withTags(AXE_TAGS).analyze();
  assert.deepEqual(axePair.violations.map((v) => v.id), [], 'axe on the pair page');
  await pair.ctx.close();
});

test('pair: 2x2 cells add up and match the export', async () => {
  const { ctx, page } = await open(ROUTES.pair);
  const v = async (f) => Number(await page.locator(`table.two-by-two td[data-field="${f}"]`).getAttribute('data-value'));
  const [a, b, c, d, n] = [await v('a'), await v('b'), await v('c'), await v('d'), await v('n_total')];
  assert.equal(a + b + c + d, n);
  const p = FIRST_DOC.pairs[0];
  assert.deepEqual([a, b, c, d, n], [p.a, p.b, p.c, p.d, p.n_total]);
  assert.equal(Number(await page.locator('table.measures td[data-field="prr"]').getAttribute('data-value')), p.prr);
  assert.equal(await page.locator('svg.trend').count(), 1);
  // The provisional quarter's bar (if drawn) uses the hatch pattern, not the plain bar color.
  const fills = await page.locator('svg.trend rect.bar.provisional').evaluateAll((rs) => rs.map((r) => getComputedStyle(r).fill));
  for (const f of fills) assert.match(f, /url\(/);
  await ctx.close();
});

test('validation: every pair shows its label reference, with the three caveats', async () => {
  const { ctx, page } = await open(ROUTES.validation);
  const rows = JSON.parse(readFileSync(resolve(DIST, 'data/json/known_signals.json'), 'utf8'));
  assert.equal(rows.length, 12);
  const cells = await page.locator('table.known tbody tr td:last-child').allInnerTexts();
  assert.equal(cells.length, rows.length);
  for (const r of rows) {
    assert.ok(r.reference, `${r.ingredient_name} / ${r.reaction_pt} has no reference`);
    assert.ok(cells.some((c) => c.includes(r.reference)), r.reference);
  }
  // Captions repeat the section headings, so they are for screen readers only.
  for (const c of await page.locator('table.known caption').all()) assert.match(await c.getAttribute('class'), /sr-only/);
  assert.equal(await page.locator('table.known thead th').nth(2).innerText(), 'Cases');
  const text = await page.locator('main').innerText();
  assert.match(text, /not that the drug is proven not to cause it/);
  assert.match(text, /For warfarin, an increased INR is a monitoring result/);
  assert.match(text, /read in copies of the FDA labels, consulted on \d{4}-\d{2}-\d{2}/);
  await ctx.close();
});

test('reading notes: home volume caption, deleted ids on Quality, PS/SS share on the pair', async () => {
  const home = await open(ROUTES.home);
  assert.match(
    await home.page.locator('#top-help').innerText(),
    /^Reporting volume, not risk: counts depend on market size and on manufacturer and support-program reporting\.$/
  );
  await home.ctx.close();
  const quality = await open(ROUTES.quality);
  const note = await quality.page.locator('#deleted-help').innerText();
  assert.match(note, /an id can appear in more than one deletion list, so the per-file sum can exceed the number of removed cases/);
  assert.match(note, /"—" means none found\.$/);
  await quality.ctx.close();
  const pair = await open(ROUTES.pair);
  const trend = await pair.page.locator('section[aria-labelledby="trend-h"] .help').first();
  assert.match(await trend.innerText(), /The PS\/SS share changes by quarter \(see the Quality page\)\.$/);
  assert.equal(await trend.locator('a').getAttribute('href'), '#/quality');
  await pair.ctx.close();
});

test('unknown routes show not found', async () => {
  const { ctx, page } = await open('#/ingredient/no-such-ingredient');
  await page.getByRole('heading', { level: 1, name: 'Not found' }).waitFor();
  await ctx.close();
});

test('axe: no WCAG A/AA violations, light and dark', async () => {
  const all = [];
  for (const scheme of ['light', 'dark']) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const { ctx, page } = await open(route, { colorScheme: scheme });
      await page.locator('details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
      const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      report.axe[`${scheme}:${name}`] = { violations: res.violations.length, passes: res.passes.length };
      for (const v of res.violations) all.push(`${scheme}:${name} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target}`);
      await ctx.close();
    }
  }
  assert.deepEqual(all, []);
});

// Elements that scroll horizontally must be reachable by keyboard (axe scrollable-region-focusable).
// A narrow viewport makes the wide tables overflow on any platform, so the check does not depend
// on the fonts of the machine.
const VIEWPORTS = { narrow: { width: 360, height: 800 }, wide: { width: 1440, height: 900 } };
// Every element that scrolls horizontally, with whether it can take keyboard focus.
function horizontalScrollers(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => {
        const ox = getComputedStyle(e).overflowX;
        return (ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth;
      })
      .map((e) => ({ tag: e.tagName.toLowerCase(), cls: e.className, focusable: e.tabIndex >= 0 }))
  );
}

test('method page: only the configured sections of limitations.md, with the case definition', async () => {
  const { ctx, page } = await open(ROUTES.method);
  await page.locator('article.prose').waitFor();
  const h2 = await page.locator('article.prose h2').allInnerTexts();
  assert.deepEqual(h2.map((t) => t.trim()), SITE_CFG.method_page.sections);
  const text = await page.locator('article.prose').innerText();
  assert.ok(!text.includes('Operational limits'), 'operational limits stay in the repository');
  assert.match(text, /a case is one FAERS case ID/);
  assert.deepEqual(await page.locator('main h1').allInnerTexts(), ['Method & limitations'], 'one h1, named as in the menu');
  // Repository paths are links to GitHub, under an allowed prefix.
  const repo = SITE_CFG.site.repo_url;
  const hrefs = await page.locator('main a:has(code)').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const path of ['docs/limitations.md', 'docs/calibration/rxnorm_calibration_sample.csv', 'tests/unit/test_signal_known_values.py']) {
    assert.ok(hrefs.includes(`${repo}/blob/main/${path}`), `no link to ${path}`);
  }
  for (const h of hrefs) assert.ok(SITE_CFG.site.allowed_link_prefixes.some((pre) => h.startsWith(pre)), h);
  const unlinked = await page
    .locator('article.prose code')
    .evaluateAll((cs) => cs.filter((c) => !c.closest('a') && /^[\w.-]+(\/[\w.-]+)+\/?$/.test(c.textContent)).map((c) => c.textContent));
  assert.deepEqual(unlinked, [], 'repository paths left as plain text');
  await ctx.close();
});

test('method page: axe and focusable scroll regions at narrow and wide viewports', async () => {
  const all = [];
  let scrolledNarrow = 0;
  for (const [vname, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await open(ROUTES.method, { viewport, colorScheme: scheme });
      await page.locator('article.prose').waitFor();
      const tables = await page.locator('article.prose table').count();
      assert.ok(tables > 0, 'the method page has tables');
      const wrapped = await page.locator('article.prose .table-scroll[role="region"][tabindex="0"][aria-label] > table').count();
      if (wrapped !== tables) all.push(`${vname}:${scheme} ${tables - wrapped} of ${tables} tables outside a focusable region`);
      const scrollers = await horizontalScrollers(page);
      if (vname === 'narrow') scrolledNarrow = Math.max(scrolledNarrow, scrollers.length);
      for (const s of scrollers.filter((x) => !x.focusable)) all.push(`${vname}:${scheme} not focusable: ${s.tag}.${s.cls}`);
      const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      for (const v of res.violations) all.push(`${vname}:${scheme} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target}`);
      await ctx.close();
    }
  }
  assert.ok(scrolledNarrow > 0, 'at 360 px some table scrolls (the case under test happens)');
  assert.deepEqual(all, []);
});

// The concentration badge wraps inside its cell: at a wide viewport the pairs table fits the page,
// so no badge is cut off at the edge of its scroll region.
test('ingredient: concentration badges are not cut off at wide viewports', async () => {
  const slug = SEARCH.rows
    .map((r) => r[SEARCH.columns.indexOf('slug')])
    .find((s) => JSON.parse(readFileSync(resolve(DIST, `data/json/signals/${s}.json`), 'utf8')).pairs.some((p) => flagged(p).length));
  assert.ok(slug, 'the export has an ingredient with a concentration badge');
  for (const width of [1440, 1668]) {
    const { ctx, page } = await open(`#/ingredient/${slug}`, { viewport: { width, height: 900 } });
    // The fixture's badges are short; the longest real one has three reasons.
    await page.locator('table.pairs .alert-badge').first().evaluate((b) => {
      b.textContent = '⚠ median 53 reactions per report; 96% of cases from Canada (CA); ingredient: 8% CA';
    });
    const region = page.locator('.table-scroll:has(table.pairs)');
    const fits = await region.evaluate((e) => e.scrollWidth <= e.clientWidth);
    assert.ok(fits, `${width} px: the pairs table scrolls sideways`);
    const box = await region.boundingBox();
    const badges = await page.locator('table.pairs .alert-badge').evaluateAll((bs) =>
      bs.map((b) => {
        const r = b.getBoundingClientRect();
        return { right: r.right, text: b.textContent };
      })
    );
    assert.ok(badges.length > 0, `${width} px: no badge on the page`);
    for (const b of badges) assert.ok(b.right <= box.x + box.width + 0.5, `${width} px: badge cut off: ${b.text}`);
    await ctx.close();
  }
});

test('every page: elements that scroll horizontally are focusable, narrow and wide', async () => {
  const bad = [];
  for (const [vname, viewport] of Object.entries(VIEWPORTS)) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const { ctx, page } = await open(route, { viewport });
      await page.locator('details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
      for (const s of (await horizontalScrollers(page)).filter((x) => !x.focusable)) bad.push(`${vname}:${name} ${s.tag}.${s.cls}`);
      await ctx.close();
    }
  }
  assert.deepEqual(bad, []);
});

test('keyboard: the ingredient page is usable with Tab and Enter only', async () => {
  const { ctx, page } = await open(ROUTES.ingredient);
  await page.locator('body').focus();
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const el = await page.evaluate(() => {
      const e = document.activeElement;
      const r = e.getBoundingClientRect();
      const style = getComputedStyle(e);
      return {
        tag: e.tagName.toLowerCase(),
        text: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        visible: r.width > 0 && r.height > 0,
        outline: style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
      };
    });
    seen.push(el);
    if (el.tag === 'body') break;
  }
  report.keyboard = seen.map((e) => `${e.tag}:${e.text}${e.outline ? '' : ' [no outline]'}`);
  assert.equal(seen[0].text, 'Skip to content');
  for (const e of seen.filter((x) => x.tag !== 'body')) {
    assert.ok(e.visible, `focused element not visible: ${e.text}`);
    assert.ok(e.outline, `no focus indicator: ${e.tag} ${e.text}`);
  }
  assert.ok(seen.some((e) => e.text.startsWith('PRR')), 'sort button reachable');
  // Enter on a focused sort button sorts and keeps focus on it.
  await page.locator('button.sort[data-sort="a"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.sort), 'a');
  assert.equal(await page.locator('th:has(button[data-sort="a"])').getAttribute('aria-sort'), 'descending');
  // Enter on a reaction link opens the pair.
  await page.locator('table.pairs tbody th a').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/ingredient\/[^/]+\/[a-f0-9]{32}$/);
  // After navigation, focus moves to the new heading.
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1', null, { timeout: 5000 });
  // Skip link moves focus to main.
  await page.goto(BASE + ROUTES.ingredient);
  await page.reload(); // a hash-only goto keeps the document and its focus
  await page.locator('main h1').waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  await ctx.close();
});

test('downloads: only the tables without reaction terms, with an example on ingredients', async () => {
  const { ctx, page } = await open(ROUTES.downloads);
  const files = await page.locator('main section h2').allInnerTexts();
  assert.deepEqual(files.sort(), ['dq_metrics.parquet', 'ingredients.parquet']);
  const links = await page.locator('main a[download]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.deepEqual(links.sort(), ['data/parquet/dq_metrics.parquet', 'data/parquet/ingredients.parquet']);
  const text = await page.locator('main').innerText();
  assert.match(text, /Tables with reaction terms are not offered for download/);
  assert.match(text, /from 'ingredients\.parquet'/);
  assert.ok(!/signals_top|known_signals|reaction_pt|data\/json/.test(text), 'no table with reaction terms');
  // The pair tables are not copied into the site as Parquet either.
  for (const name of ['signals_top', 'known_signals']) {
    const res = await page.request.get(`${BASE}data/parquet/${name}.parquet`);
    assert.equal(res.status(), 404, name);
  }
  await ctx.close();
});
