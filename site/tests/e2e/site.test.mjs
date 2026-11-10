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
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    assert.match(banner, new RegExp(reEsc(`Data through ${META.last_quarter} · exported ${META.export_date} (UTC)`)), name);
    if (META.last_quarter_is_provisional) {
      assert.match(banner, new RegExp(reEsc(`Latest quarter (${META.provisional_quarter}) is provisional`)), name);
    }
    const notice = page.locator('aside.notice');
    assert.equal(await notice.getAttribute('aria-label'), 'Read before use', name);
    assert.match(
      (await notice.innerText()).replace(/\s+/g, ' ').trim(),
      /^Read before use\. These figures compare shares of reports\. They do not show that a medicine causes a reaction or how often it happens, and they are not medical advice\. How to read them$/,
      name,
    );
    assert.equal(await notice.locator('a').getAttribute('href'), '#/method', name);
    assert.equal(await page.locator('footer a', { hasText: SITE_CFG.site.author.name }).getAttribute('href'), SITE_CFG.site.author.url, name);
    assert.equal(await page.locator('footer .attribution').innerText(), ATTRIBUTION, name);
    assert.equal(await page.locator('footer .meddra').innerText(), MEDDRA, name);
    if (name === 'downloads') assert.equal(await page.locator('main .meddra').innerText(), MEDDRA);
    assert.match(await page.locator('footer').innerText(), /The FDA does not endorse this project\./, name);
    assert.match(await page.locator('footer').innerText(), new RegExp(`Data exported ${META.export_date} \\(UTC\\)`));
    assert.match(await page.locator('footer').innerText(), new RegExp(META.rxnorm_versions[0] ?? 'not recorded'));
    assert.deepEqual(problems, [], name);
    const text = (await page.locator('body').innerText()).toLowerCase();
    assert.ok(!text.includes('confirmed signal'), `${name}: wording`);
    await ctx.close();
  }
});

test('head: description and link-preview tags point at the public site; the image is small', async () => {
  const { ctx, page } = await open(ROUTES.home);
  const meta = (sel) => page.locator(`head meta[${sel}]`).getAttribute('content');
  const url = SITE_CFG.site.public_url;
  const desc = SITE_CFG.site.description;
  assert.equal(await meta('name="description"'), desc);
  assert.equal(await meta('property="og:description"'), desc);
  assert.equal(await meta('name="twitter:description"'), desc);
  assert.equal(await meta('property="og:title"'), SITE_CFG.site.title);
  assert.equal(await meta('property="og:url"'), url);
  assert.equal(await meta('property="og:image"'), `${url}og-image.jpg`);
  assert.equal(await meta('name="twitter:image"'), `${url}og-image.jpg`);
  assert.equal(await meta('name="twitter:card"'), 'summary_large_image');
  // The image ships with the site: 1200x630 JPEG under 100 KB.
  const img = readFileSync(resolve(DIST, 'og-image.jpg'));
  assert.ok(img.length < 100_000, `${img.length} bytes`);
  let i = 2;
  let size = null;
  while (i < img.length && !size) {
    const marker = img[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) size = [img.readUInt16BE(i + 7), img.readUInt16BE(i + 5)];
    i += 2 + img.readUInt16BE(i + 2);
  }
  assert.deepEqual(size, [1200, 630]);
  assert.equal(await meta('property="og:image:width"'), '1200');
  assert.equal(await meta('property="og:image:height"'), '630');
  await ctx.close();
});

test('home: search by keyboard opens the ingredient', async () => {
  const { ctx, page } = await open(ROUTES.home);
  const name = FIRST_DOC.ingredient.ingredient_name;
  const input = page.getByRole('combobox', { name: 'Search a medicine by its active ingredient (generic name)' });
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

// Default order written out independently of src/lib/logic.js: ror_lcl descending, nulls last,
// ties by PT, then reaction key; first pairs_page_size rows.
function defaultOrder(pairs) {
  const ok = (v) => v != null && Number.isFinite(v);
  return [...pairs]
    .sort((x, y) => {
      if (ok(x.ror_lcl) !== ok(y.ror_lcl)) return ok(x.ror_lcl) ? -1 : 1;
      if (ok(x.ror_lcl) && x.ror_lcl !== y.ror_lcl) return y.ror_lcl - x.ror_lcl;
      return x.reaction_pt.localeCompare(y.reaction_pt, 'en') || x.reaction_key.localeCompare(y.reaction_key);
    })
    .slice(0, SITE_CFG.site.pairs_page_size)
    .map((p) => p.reaction_key);
}

test('ingredient: default order, sort select, filters and reporting-pattern badges follow the config rule', async () => {
  const { ctx, page } = await open(ROUTES.ingredient);
  const keys = () => page.locator('table.pairs tbody tr[data-reaction-key]').evaluateAll((rs) => rs.map((r) => r.dataset.reactionKey));
  const values = async (field) =>
    page.locator(`table.pairs tr[data-reaction-key] td[data-field="${field}"]`).evaluateAll((tds) => tds.map((td) => td.dataset.value));
  const sort = page.getByRole('combobox', { name: 'Sort by' });
  assert.equal(await sort.inputValue(), 'ror_lcl');
  assert.deepEqual(await keys(), defaultOrder(FIRST_DOC.pairs));
  await sort.selectOption('prr');
  const prr = (await values('prr')).filter((v) => v !== '').map(Number);
  assert.deepEqual(prr, [...prr].sort((a, b) => b - a));
  await sort.selectOption('a');
  const a = (await values('a')).map(Number);
  assert.deepEqual(a, [...a].sort((x, y) => y - x));
  await sort.selectOption('name');
  const pts = await page.locator('table.pairs tbody th [data-pt]').allInnerTexts();
  assert.deepEqual(pts, [...pts].sort((x, y) => x.localeCompare(y, 'en')));
  assert.match(await page.locator('#pairs-summary').innerText(), /sorted by name, A to Z\.$/);
  // Every flagged pair has the badge in its row (never only in Details), with words and glyph.
  const expected = FIRST_DOC.pairs.filter((p) => flagged(p).length);
  assert.equal(await page.locator('table.pairs tbody th .tag-pattern').count(), Math.min(expected.length, 30));
  for (const p of expected.slice(0, 30)) {
    const th = page.locator(`table.pairs tr[data-reaction-key="${p.reaction_key}"] th`);
    assert.equal(await th.locator('.tag-pattern').innerText(), 'Reporting pattern');
    assert.equal(await th.locator('.tag-pattern svg[aria-hidden="true"]').count(), 1);
  }
  // Filters: pattern radio and text.
  const total = FIRST_DOC.pairs.length;
  await page.getByRole('radio', { name: `With pattern (${expected.length})` }).check();
  assert.equal((await keys()).length, Math.min(expected.length, 30));
  await page.getByRole('radio', { name: `Without (${total - expected.length})` }).check();
  assert.equal(await page.locator('table.pairs tbody th .tag-pattern').count(), 0);
  await page.getByRole('radio', { name: `All (${total})` }).check();
  const word = FIRST_DOC.pairs[0].reaction_pt.split(' ')[0].toLowerCase();
  await page.getByRole('searchbox', { name: 'Filter reactions' }).fill(word);
  const want = FIRST_DOC.pairs.filter((p) => p.reaction_pt.toLowerCase().includes(word)).length;
  assert.equal((await keys()).length, Math.min(want, 30));
  assert.match(await page.locator('#pairs-summary').innerText(), new RegExp(`^Showing ${Math.min(want, 30)} of ${total} reactions`));
  await ctx.close();
});

test('ingredient: "Show all numbers" adds the interval, ROR and criteria columns; Details opens a row', async () => {
  const { ctx, page } = await open(ROUTES.ingredient);
  const head = () => page.locator('table.pairs thead th').allInnerTexts();
  assert.ok(!(await head()).some((t) => t.includes('ROR 95% CI')));
  await page.getByRole('checkbox', { name: 'Show all numbers' }).check();
  const h = (await head()).map((t) => t.trim());
  for (const col of ['PRR 95% CI', 'ROR', 'ROR 95% CI', 'Criteria met']) assert.ok(h.includes(col), col);
  const p = FIRST_DOC.pairs.find((x) => x.reaction_key === (defaultOrder(FIRST_DOC.pairs)[0]));
  const row = page.locator(`table.pairs tr[data-reaction-key="${p.reaction_key}"]`);
  assert.equal(Number(await row.locator('td[data-field="ror_ci"]').getAttribute('data-lcl')), p.ror_lcl);
  const criteria = [p.is_signal_evans ? 'Evans' : '', p.is_signal_ror ? 'ROR' : ''].filter(Boolean).join(', ') || '—';
  assert.equal((await row.locator('td').nth(-2).innerText()).trim(), criteria);
  // Details: aria-expanded and aria-controls point at the row that opens.
  const det = row.getByRole('button', { name: new RegExp(`^Details for ${reEsc(p.reaction_pt)}$`) });
  assert.equal(await det.getAttribute('aria-expanded'), 'false');
  const target = page.locator(`#${await det.getAttribute('aria-controls')}`);
  assert.equal(await target.isVisible(), false);
  await det.click();
  assert.equal(await det.getAttribute('aria-expanded'), 'true');
  assert.match(await target.innerText(), new RegExp(reEsc(`Screening rules met`)));
  assert.equal(await target.locator(`a[href$="/${p.reaction_key}"]`).count(), 1);
  // The magnitude bar is decorative: the PRR has its own cell.
  assert.equal(await row.locator('.mag').getAttribute('aria-hidden'), 'true');
  // The toggletip opens on click and closes with Esc, focus back on its button.
  const tip = page.getByRole('button', { name: 'What is this?' });
  await tip.click();
  assert.equal(await tip.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#mag-tip').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mag-tip').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('tip')), true);
  await ctx.close();
});

test('ingredient on a phone: one card per reaction, badge visible, Details with a 44 px target', async () => {
  const { ctx, page } = await open(ROUTES.ingredient, AXE_VIEWPORTS.mobile);
  assert.equal(await page.locator('table.pairs').isVisible(), false);
  const cards = page.locator('.pair-cards > li');
  assert.equal(await cards.count(), Math.min(FIRST_DOC.pairs.length, 30));
  const flaggedPairs = FIRST_DOC.pairs.filter((p) => flagged(p).length);
  for (const p of flaggedPairs.slice(0, 30)) {
    assert.equal(await page.locator(`.pair-cards li[data-reaction-key="${p.reaction_key}"] .tag-pattern`).isVisible(), true);
  }
  const det = cards.first().locator('button.det');
  assert.ok((await det.boundingBox()).height >= 44);
  await det.click();
  assert.equal(await page.locator(`#${await det.getAttribute('aria-controls')}`).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scroll');
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
  const text = `Mostly one country: ${pct(p.top_country_share)} of cases from ${country(p.top_country)}; ingredient: ${ingPct} ${p.top_country}`;
  const ing = await open(`#/ingredient/${slug}`);
  const row = ing.page.locator(`table.pairs tbody tr[data-reaction-key="${p.reaction_key}"]`);
  const badge = await row.locator('th .pattern').innerText();
  assert.match(badge, /^Reporting pattern\s/);
  assert.ok(badge.includes(text), `badge "${badge}" lacks "${text}"`);
  // The same reason on the phone card.
  assert.ok((await ing.page.locator(`.pair-cards li[data-reaction-key="${p.reaction_key}"] .pattern-why`).textContent()).includes(text));
  assert.match(
    (await ing.page.locator('#alert-legend').innerText()).replace(/\s+/g, ' '),
    /^Reporting pattern Most of the pair's cases come from one quarter, or from one country unusual for this ingredient, or their reports list very many reactions\. It describes how reports arrived, not the medicine\.$/,
  );
  const axeIng = await new AxeBuilder({ page: ing.page }).withTags(AXE_TAGS).analyze();
  assert.deepEqual(axeIng.violations.map((v) => v.id), [], 'axe on the ingredient page');
  await ing.ctx.close();
  const pair = await open(`#/ingredient/${slug}/${p.reaction_key}`);
  // Same badge and one-line reasons as the ingredient row, under the headline.
  assert.ok((await pair.page.locator('.page-head .pattern').innerText()).includes(text));
  const detail = await pair.page.locator('.pattern-detail').innerText();
  assert.match(detail, /^Reporting pattern\s/);
  assert.match(detail, new RegExp(esc(`${pct(p.top_country_share)} of these cases come from ${country(p.top_country)}`)));
  assert.match(detail, new RegExp(esc(`most frequent country is ${country(p.ingredient_top_country)}`)));
  assert.match(detail, /without a pharmacological cause\.$/);
  // Where the cases come from: the pair's top country against the same country in the ingredient.
  assert.equal(
    await pair.page.locator('[data-field="top_country"]').innerText(),
    `${country(p.top_country)}, ${pct(p.top_country_share)} of cases`,
  );
  assert.match(await pair.page.locator('.country-compare').innerText(), new RegExp(esc(ingPct)));
  const axePair = await new AxeBuilder({ page: pair.page }).withTags(AXE_TAGS).analyze();
  assert.deepEqual(axePair.violations.map((v) => v.id), [], 'axe on the pair page');
  await pair.ctx.close();
});

// Formats written here, independently of src/lib/format.js.
const COUNT_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const SHARE2_FMT = new Intl.NumberFormat('en-US', { style: 'percent', minimumSignificantDigits: 2, maximumSignificantDigits: 2 });
const ABOUT_FMT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 });
const ratioText = (v) =>
  Math.abs(v) >= 1000 ? COUNT_FMT.format(v) : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(v);

test('pair: headline and two shares from the 2×2 counts; 2×2 table and formulas behind <details>', async () => {
  const { ctx, page } = await open(ROUTES.pair);
  const p = FIRST_DOC.pairs[0];
  const ing = FIRST_DOC.ingredient.ingredient_name;
  const nOther = p.n_total - p.n_drug;
  const [sDrug, sOther] = [SHARE2_FMT.format(p.a / p.n_drug), SHARE2_FMT.format(p.c / nOther)];
  assert.ok(p.prr > 1, 'the first fixture pair has a larger share');
  assert.equal(await page.locator('main h1').innerText(), `${p.reaction_pt} appears in a larger share of ${ing} reports`);
  assert.equal(
    (await page.locator('#pair-lede').innerText()).replace(/\s+/g, ' '),
    `It is named in ${sDrug} of ${ing} cases (${COUNT_FMT.format(p.a)} of ${COUNT_FMT.format(p.n_drug)}), compared with ${sOther} of cases for all other medicines (${COUNT_FMT.format(p.c)} of ${COUNT_FMT.format(nOther)}): a share about ${ABOUT_FMT.format(p.prr)} times larger.`,
  );
  assert.match(await page.locator('.page-head .caution').innerText(), /^This describes reports, not how often .+ happens to people taking /);
  const rows = await page.locator('.share-row .share-val').allInnerTexts();
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes(`${COUNT_FMT.format(p.a)} name`) && rows[0].includes(`(${sDrug})`), rows[0]);
  assert.ok(rows[1].includes(`${COUNT_FMT.format(p.c)} name`) && rows[1].includes(`(${sOther})`), rows[1]);
  assert.match(await page.locator('#division').innerText(), new RegExp(reEsc(`gives the PRR, ${ratioText(p.prr)} `)));
  // Bar lengths follow the shares on one scale (the larger share fills the track).
  const widths = await page.locator('.share-fill').evaluateAll((fs) => fs.map((f) => parseFloat(f.style.getPropertyValue('--w'))));
  assert.equal(widths[0], 100);
  assert.ok(Math.abs(widths[1] - (100 * (p.c / nOther)) / (p.a / p.n_drug)) < 0.01, `${widths[1]}`);
  // The 2×2 table is closed by default and holds the full counts once opened.
  const t22 = page.locator('table.two-by-two');
  assert.equal(await t22.isVisible(), false);
  await page.locator('details.t22 > summary').click();
  assert.equal(await t22.isVisible(), true);
  const v = async (f) => Number(await page.locator(`table.two-by-two td[data-field="${f}"]`).getAttribute('data-value'));
  const [a, b, c, d, n] = [await v('a'), await v('b'), await v('c'), await v('d'), await v('n_total')];
  assert.equal(a + b + c + d, n);
  assert.deepEqual([a, b, c, d, n, await v('n_drug'), await v('n_reac')], [p.a, p.b, p.c, p.d, p.n_total, p.n_drug, p.n_reac]);
  const formulas = await page.locator('ul.formulas').innerText();
  assert.ok(formulas.includes(`(${COUNT_FMT.format(p.a)} / ${COUNT_FMT.format(p.n_drug)}) / (${COUNT_FMT.format(p.c)} / ${COUNT_FMT.format(nOther)}) = ${ratioText(p.prr)}`), formulas);
  // Measures: plain labels with the technical name, values from the export.
  assert.equal(Number(await page.locator('table.measures td[data-field="prr"]').getAttribute('data-value')), p.prr);
  assert.deepEqual(
    (await page.locator('table.measures tbody th').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')),
    ['How much larger the share is (PRR)', 'Same comparison as odds (ROR)', 'Distance from equal shares (chi-square, χ²)'],
  );
  assert.equal(await page.locator('[data-field="is_signal_evans"]').innerText(), p.is_signal_evans ? 'Yes' : 'No');
  assert.equal(await page.locator('svg').filter({ has: page.locator('rect') }).count(), 0, 'no SVG chart');
  await ctx.close();
});

test('pair: quarterly chart in CSS bars, provisional quarter hatched with *, table fallback', async () => {
  const { ctx, page } = await open(ROUTES.pair);
  const p = FIRST_DOC.pairs[0];
  const counts = new Map(p.trend.map((t) => [t.period_key, t.a]));
  const chart = page.locator('.qchart .qbars[role="img"]');
  assert.equal(await chart.count(), 1);
  const alt = await chart.getAttribute('aria-label');
  for (const q of META.quarters) {
    const prov = META.last_quarter_is_provisional && q === META.provisional_quarter ? ' (provisional)' : '';
    assert.ok(alt.includes(`${q}${prov}: ${counts.has(q) ? counts.get(q) : 'fewer than 3'}`), `${q} in "${alt}"`);
  }
  assert.equal(await page.locator('.qcol').count(), META.quarters.length);
  assert.equal(await page.locator('.qcol.none').count(), META.quarters.filter((q) => !counts.has(q)).length);
  for (const t of await page.locator('.qcol.none .qval').allInnerTexts()) assert.equal(t, '<3');
  if (META.last_quarter_is_provisional) {
    const col = page.locator('.qcol.provisional');
    assert.equal(await col.count(), 1);
    assert.match(await col.locator('.qlab').innerText(), /\*/);
    if (counts.has(META.provisional_quarter)) {
      assert.match(await col.locator('.qbar').evaluate((b) => getComputedStyle(b).backgroundImage), /repeating-linear-gradient/);
    }
    assert.match(await page.locator('.qchart figcaption').innerText(), new RegExp(reEsc(`Hatched, with *: ${META.provisional_quarter} is provisional.`)));
  }
  // Bars of counted quarters: the tallest fills the scale; height grows with the count.
  const hs = await page.locator('.qcol:not(.none)').evaluateAll((cs) => cs.map((c) => parseFloat(c.style.getPropertyValue('--h'))));
  if (hs.length) assert.equal(Math.max(...hs), 100);
  const table = page.locator('details.trend-details table.trend-table');
  assert.equal(await table.isVisible(), false);
  await page.locator('details.trend-details > summary').click();
  assert.equal(await table.locator('tbody tr').count(), META.quarters.length);
  assert.equal(await table.locator('caption').count(), 1);
  await ctx.close();
});

test('pair: neutral reporting-pattern state, and no validation block outside the reference pairs', async () => {
  let found;
  for (const row of SEARCH.rows) {
    const slug = row[SEARCH.columns.indexOf('slug')];
    const doc = JSON.parse(readFileSync(resolve(DIST, `data/json/signals/${slug}.json`), 'utf8'));
    const p = doc.pairs.find((x) => !flagged(x).length);
    if (p) {
      found = { slug, p, doc };
      break;
    }
  }
  assert.ok(found, 'the export has a pair without a reporting pattern');
  const refs = JSON.parse(readFileSync(resolve(DIST, 'data/json/known_signals.json'), 'utf8'));
  const isRef = refs.some((r) => r.ingredient_name === found.doc.ingredient.ingredient_name && r.reaction_pt === found.p.reaction_pt);
  const { ctx, page } = await open(`#/ingredient/${found.slug}/${found.p.reaction_key}`);
  assert.equal(await page.locator('.page-head .tag-pattern').count(), 0);
  assert.equal(await page.locator('.pattern-detail .tag-none').innerText(), 'No reporting pattern');
  assert.match(await page.locator('.pattern-detail p').innerText(), /^None of the three checks flags this pair/);
  assert.equal(await page.locator('.ref-pair').count(), isRef ? 1 : 0);
  await ctx.close();
});

test('pair: the validation block shows the joined known_signals row (test double of the file)', async () => {
  // TEST DOUBLE. The fixture has no reference pair among its exported pairs, so this test (and
  // only this test) intercepts the request and serves a modified copy of known_signals.json: the
  // first row is renamed to the first fixture pair, every other field is the file's own. It
  // checks the join on ingredient_name + reaction_pt and the rendering only. The site has no
  // test hook: it always reads data/json/known_signals.json exactly as exported, and every other
  // test (including the Validation page test) reads that real file.
  const rows = JSON.parse(readFileSync(resolve(DIST, 'data/json/known_signals.json'), 'utf8'));
  const p = FIRST_DOC.pairs[0];
  const double = rows.map((r, i) => (i === 0 ? { ...r, ingredient_name: FIRST_DOC.ingredient.ingredient_name, reaction_pt: p.reaction_pt } : r));
  const ctx = await browser.newContext();
  await ctx.route('**/data/json/known_signals.json', (route) => route.fulfill({ json: double }));
  const page = await ctx.newPage();
  await page.goto(BASE + ROUTES.pair);
  const block = page.locator('.ref-pair');
  await block.waitFor();
  const text = (await block.innerText()).replace(/\s+/g, ' ');
  assert.ok(text.includes(`One of the ${rows.length} pairs used to check the pipeline`), text);
  assert.ok(text.includes(double[0].reference), text);
  const result = await block.locator('[data-field="passed"]').innerText();
  if (double[0].passed) assert.equal(result, 'As expected');
  else assert.match(result, /^Not as expected/);
  assert.ok(text.includes(double[0].expected === 'positive' ? 'Stands out:' : 'Does not meet the Evans rule'), text);
  assert.equal(await block.locator('a').getAttribute('href'), '#/validation');
  const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  assert.deepEqual(res.violations.map((v) => v.id), [], 'axe with the validation block');
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
  // Expected and Result, row by row, from the file (written out here, not taken from the page code).
  const heads = await page.locator('table.known').first().locator('thead th').allInnerTexts();
  assert.deepEqual(heads, ['Ingredient', 'Reaction (PT)', 'Cases', 'PRR', 'ROR lower bound', 'χ²', 'Evans', 'Expected', 'Result', 'Reference']);
  const shown = await page.locator('table.known tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      ing: tr.querySelector('th').textContent.trim(),
      pt: tr.querySelectorAll('td')[0].textContent.trim(),
      a: Number(tr.querySelector('td[data-field="a"]').dataset.value),
      expected: tr.querySelector('td.expected').textContent.trim(),
      result: tr.querySelector('td[data-field="passed"]').textContent.trim(),
    })),
  );
  assert.equal(shown.length, rows.length);
  for (const r of rows) {
    const row = shown.find((x) => x.ing === r.ingredient_name && x.pt === r.reaction_pt);
    assert.ok(row, `${r.ingredient_name} / ${r.reaction_pt} missing`);
    assert.equal(row.a, r.a);
    assert.equal(row.expected, r.expected === 'positive' ? 'Stands out' : 'Does not meet the Evans rule');
    if (r.passed) assert.equal(row.result, 'As expected');
    else assert.match(row.result, /^Not as expected/);
  }
  const npos = rows.filter((r) => r.expected === 'positive').length;
  assert.equal(await page.locator('#kinds-pos-h').innerText(), `${npos} positive pairs`);
  assert.equal(await page.locator('#kinds-neg-h').innerText(), `${rows.length - npos} negative controls`);
  const lede = await page.locator('.page-head .lede').innerText();
  assert.equal(lede.replace(/\s+/g, ' '), `${rows.filter((r) => r.passed).length} of ${rows.length} reference pairs behave as expected in all loaded cases.`);
  assert.match(await page.locator('.page-head .caution').innerText(), /^A sanity check of the pipeline .*not a validation of disproportionality as a method/);
  assert.match(await page.locator('section[aria-labelledby="kinds-neg-h"]').innerText(), /Pairs the label does not list/);
  assert.match(await page.locator('section[aria-labelledby="kinds-pos-h"]').innerText(), /Expected: at least 3 cases, PRR ≥ 2 and a ROR lower bound above 1\./);
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
    /^Ranked by how many cases name them as a suspect\. Reporting volume, not risk: counts depend on market size and on manufacturer and support-program reporting\.$/
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

test('quality: the steps come from dq_metrics.json, and every metric shown has one plain line', async () => {
  const { ctx, page } = await open(ROUTES.quality);
  const dq = JSON.parse(readFileSync(resolve(DIST, 'data/json/dq_metrics.json'), 'utf8'));
  const allOf = (group, metric) => dq.find((r) => r.period_basis === 'all' && r.metric_group === group && r.metric === metric);
  const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const steps = await page.locator('ol.dq-steps li').evaluateAll((lis) => lis.map((li) => ({ t: li.querySelector('h3').textContent, v: li.querySelector('.dq-val').textContent })));
  assert.deepEqual(steps, [
    { t: 'Case versions loaded', v: COUNT.format(allOf('deduplication', 'demo_rows').value) },
    { t: 'Superseded versions removed', v: COUNT.format(allOf('deduplication', 'superseded_versions_removed').value) },
    { t: 'Deleted cases removed', v: COUNT.format(allOf('deduplication', 'deleted_cases_removed').value) },
    { t: 'Cases counted', v: COUNT.format(allOf('deduplication', 'cases_after_deduplication').value) },
    { t: 'PS/SS drug lines mapped to RxNorm', v: COUNT.format(allOf('rxnorm_coverage', 'signal_role_lines').value) },
  ]);
  // Every column or row label of the metric tables has its line under the table, and no more.
  // Metric names are the column heads (after the period column), or the row heads of the
  // key-value table.
  const labels = await page.locator('table.metrics').evaluateAll((ts) =>
    ts.flatMap((t) => [...t.querySelectorAll(t.classList.contains('kv') ? 'tbody th' : 'thead th:not(:first-child)')].map((th) => th.textContent.trim())),
  );
  const shown = new Set(labels);
  const help = await page.locator('dl.metric-help dt').allInnerTexts();
  assert.deepEqual([...new Set(help)].sort(), [...shown].sort());
  for (const dd of await page.locator('dl.metric-help dd').allInnerTexts()) assert.ok(dd.trim().length > 10, dd);
  const checks = await page.locator('#checks-help').innerText();
  assert.match(checks, /reconciled with the lake/);
  assert.match(checks, /Approximate RxNorm matching is off/);
  assert.match(checks, /at least 3 cases \(a ≥ 3\)/);
  await ctx.close();
});

test('unknown routes show not found', async () => {
  const { ctx, page } = await open('#/ingredient/no-such-ingredient');
  await page.getByRole('heading', { level: 1, name: 'Not found' }).waitFor();
  await ctx.close();
});

// Desktop and phone widths; the phone profile also has touch, where target sizes matter most.
const AXE_VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 900 } },
  mobile: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
};

test('axe: no WCAG 2.2 A/AA violations, light and dark, desktop and mobile', async () => {
  const all = [];
  for (const [vname, vopts] of Object.entries(AXE_VIEWPORTS)) {
    for (const scheme of ['light', 'dark']) {
      for (const [name, route] of Object.entries(ROUTES)) {
        const { ctx, page } = await open(route, { ...vopts, colorScheme: scheme });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), scheme, `${vname}:${scheme}:${name} theme`);
        await page.locator('details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
        const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        report.axe[`${vname}:${scheme}:${name}`] = { violations: res.violations.length, passes: res.passes.length };
        for (const v of res.violations) all.push(`${vname}:${scheme}:${name} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target}`);
        await ctx.close();
      }
    }
  }
  assert.deepEqual(all, []);
});

test('theme: the switch overrides the system setting, is saved, and passes axe', async () => {
  const { ctx, page } = await open(ROUTES.home, { colorScheme: 'light' });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const toggle = page.locator('#theme-toggle');
  assert.equal(await theme(), 'light');
  assert.equal(await toggle.getAttribute('aria-label'), 'Switch to dark theme');
  await toggle.click();
  assert.equal(await theme(), 'dark');
  assert.equal(await toggle.getAttribute('aria-label'), 'Switch to light theme');
  assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'dark');
  // The saved choice wins over the system setting on the next load, before first paint.
  await page.reload();
  await page.locator('main h1').waitFor();
  assert.equal(await theme(), 'dark');
  const all = [];
  for (const [name, route] of Object.entries(ROUTES)) {
    await page.goto(BASE + route);
    await page.reload();
    await page.locator('main h1').first().waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await theme(), 'dark', name);
    const res = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    for (const v of res.violations) all.push(`manual-dark:${name} ${v.id} x${v.nodes.length}: ${v.nodes[0]?.target}`);
  }
  assert.deepEqual(all, []);
  await ctx.close();
  // Without a saved choice the page follows the system, also when it changes.
  const sys = await open(ROUTES.home, { colorScheme: 'dark' });
  assert.equal(await sys.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await sys.page.emulateMedia({ colorScheme: 'light' });
  await sys.page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await sys.ctx.close();
});

test('theme: a blocked localStorage does not break the page or the switch', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.locator('#top-list li a').first().waitFor();
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('masthead: the menu button folds the nav on a phone; nav order follows the design', async () => {
  const { ctx, page } = await open(ROUTES.home, AXE_VIEWPORTS.mobile);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const menu = page.getByRole('button', { name: 'Menu' });
  assert.equal(await nav.isVisible(), false);
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await menu.click();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await nav.locator('a').allInnerTexts(), ['Search', 'Method & limitations', 'Validation', 'Quality', 'Downloads']);
  for (const box of await nav.locator('a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))) assert.ok(box >= 44, `nav target ${box}px`);
  await nav.getByRole('link', { name: 'Quality' }).click();
  await page.waitForURL(/#\/quality$/);
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await ctx.close();
  const desk = await open(ROUTES.home);
  assert.equal(await desk.page.getByRole('button', { name: 'Menu' }).isVisible(), false);
  assert.equal(await desk.page.getByRole('navigation', { name: 'Main' }).isVisible(), true);
  await desk.ctx.close();
});

test('home: example chips exist in the export, the list reads as volume, footer has three sections', async () => {
  const { ctx, page } = await open(ROUTES.home);
  const slugs = new Set(SEARCH.rows.map((r) => r[SEARCH.columns.indexOf('slug')]));
  const chips = await page.locator('#chips a.chip').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const expected = SITE_CFG.site.home_examples.filter((s) => slugs.has(s)).map((s) => `#/ingredient/${s}`);
  assert.deepEqual(chips, expected);
  assert.equal(await page.locator('#chips').isVisible(), expected.length > 0);
  const top = await page.locator('#top-list li').count();
  assert.equal(top, Math.min(12, SEARCH.rows.length));
  assert.match(await page.locator('main').innerText(), new RegExp(reEsc(`${META.n_cases_all.toLocaleString('en-US')} deduplicated cases`)));
  assert.deepEqual(await page.locator('footer h2').allInnerTexts(), ['Data', 'Drug names', 'Reaction terms (MedDRA PT)']);
  await ctx.close();
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

const squash = (t) => t.replace(/\s+/g, ' ').trim();

test('method page: plain layer from config/site.yaml, then the configured sections collapsed', async () => {
  const { ctx, page } = await open(ROUTES.method);
  await page.locator('article.prose').waitFor();
  const plain = SITE_CFG.method_page.plain;
  assert.deepEqual(await page.locator('main h1').allInnerTexts(), ['What the numbers on this site mean'], 'one h1');
  assert.equal(await page.title(), `Method & limitations · ${SITE_CFG.site.title}`);
  // A heading keeps the menu name, for the links that say "Method & limitations".
  assert.equal(await page.locator('main h2#method-limitations').innerText(), 'Method & limitations');
  assert.deepEqual(await page.locator('main > section > h2, main > div > section > h2').allInnerTexts(), [
    'What this can tell you',
    'What this cannot tell you',
    'Why a larger share is not proof',
    'How to read a pair in 30 seconds',
    'Glossary',
    'Method & limitations',
  ]);
  assert.equal(squash(await page.locator('.page-head .lede').innerText()), squash(plain.intro));
  const items = async (sel) => (await page.locator(sel).allInnerTexts()).map(squash);
  assert.deepEqual(await items('section[aria-labelledby="can-h"] li'), plain.can.map(squash));
  assert.deepEqual(await items('section[aria-labelledby="cannot-h"] li'), plain.cannot.map(squash));
  assert.deepEqual(await items('section[aria-labelledby="proof-h"] li'), plain.not_proof.reasons.map(squash));
  assert.deepEqual(await items('ol.read-steps li'), plain.read_pair.map(squash));
  assert.deepEqual(await items('dl.glossary dt'), plain.glossary.map((g) => g.term));
  assert.deepEqual(await items('dl.glossary dd'), plain.glossary.map((g) => squash(g.definition)));
  for (const term of ['PRR', 'ROR', 'SDR', 'Case', 'Report', 'Share of reports', '95% CI', 'Evans rule', 'ROR rule', 'Reporting pattern', 'MedDRA PT', 'RxNorm ingredient', 'Provisional quarter']) {
    assert.ok(plain.glossary.some((g) => g.term.startsWith(term)), `glossary: ${term}`);
  }
  // The detailed sections: one per configured heading, each collapsed under its heading.
  const h3 = await page.locator('article.prose section.doc-section > h3').allInnerTexts();
  assert.deepEqual(h3.map((t) => t.trim()), SITE_CFG.method_page.sections);
  assert.equal(await page.locator('article.prose section.doc-section > details.doc-details:not([open])').count(), SITE_CFG.method_page.sections.length);
  assert.equal(await page.locator('article.prose h2').count(), 0, 'section headings are one level below the page h2');
  const text = await page.locator('article.prose').textContent();
  assert.ok(!text.includes('Operational limits'), 'operational limits stay in the repository');
  assert.match(text, /a case is one FAERS case ID/);
  // The biases, the five layers of validation and the MedDRA notice, word for word.
  assert.match(text, /Confounding by indication and co-medication\./);
  assert.match(squash(text), /The numbers are checked in five places\. Only the second is independent of the warehouse/);
  assert.ok(squash(text).includes(squash(MEDDRA)), 'MedDRA notice as in config/site.yaml');
  const covers = await page.locator('section.doc-section').first().locator('.doc-covers').innerText();
  assert.match(covers, /Limits of the signals/);
  assert.match(covers, /Layers of validation/);
  // Opening a section shows its text.
  const first = page.locator('details.doc-details').first();
  await first.locator('summary').click();
  assert.equal(await first.getAttribute('open'), '');
  assert.ok(await first.locator('h4', { hasText: 'Layers of validation' }).isVisible());
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
      await page.locator('details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
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

// The reporting-pattern badge and its reasons wrap inside the row header: at a wide viewport the
// pairs table fits the page, with or without "Show all numbers", so no badge is cut off at the
// edge of its scroll region.
test('ingredient: reporting-pattern badges are not cut off at wide viewports', async () => {
  const slug = SEARCH.rows
    .map((r) => r[SEARCH.columns.indexOf('slug')])
    .find((s) => JSON.parse(readFileSync(resolve(DIST, `data/json/signals/${s}.json`), 'utf8')).pairs.some((p) => flagged(p).length));
  assert.ok(slug, 'the export has an ingredient with a reporting-pattern badge');
  for (const width of [1440, 1668]) {
    for (const expert of [false, true]) {
      const { ctx, page } = await open(`#/ingredient/${slug}`, { viewport: { width, height: 900 } });
      if (expert) await page.getByRole('checkbox', { name: 'Show all numbers' }).check();
      // The fixture's reasons are short; the longest real one has two reasons.
      await page.locator('table.pairs .pattern-why').first().evaluate((b) => {
        b.textContent = 'Many reactions per report: median 53; Mostly one country: 96% of cases from Canada (CA); ingredient: 8% CA';
      });
      const where = `${width} px${expert ? ', all numbers' : ''}`;
      const region = page.locator('.table-scroll:has(table.pairs)');
      const fits = await region.evaluate((e) => e.scrollWidth <= e.clientWidth);
      assert.ok(fits, `${where}: the pairs table scrolls sideways`);
      const box = await region.boundingBox();
      const badges = await page.locator('table.pairs .pattern').evaluateAll((bs) =>
        bs.map((b) => {
          const r = b.getBoundingClientRect();
          return { right: r.right, text: b.textContent };
        })
      );
      assert.ok(badges.length > 0, `${where}: no badge on the page`);
      for (const b of badges) assert.ok(b.right <= box.x + box.width + 0.5, `${where}: badge cut off: ${b.text}`);
      await ctx.close();
    }
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
  assert.ok(seen.some((e) => e.tag === 'select'), 'sort select reachable');
  assert.ok(seen.some((e) => e.tag === 'input' && e.text === ''), 'filter and controls reachable');
  // The sort select works from the keyboard: arrows change the order, focus stays on it.
  const sort = page.locator('#srt');
  await sort.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await sort.inputValue(), 'prr');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'srt');
  const prr = await page
    .locator('table.pairs tr[data-reaction-key] td[data-field="prr"]')
    .evaluateAll((tds) => tds.map((td) => td.dataset.value).filter((v) => v !== '').map(Number));
  assert.deepEqual(prr, [...prr].sort((a, b) => b - a));
  await page.keyboard.press('ArrowDown');
  assert.equal(await sort.inputValue(), 'a');
  // Enter on a Details button opens its row and keeps focus on the button.
  const det = page.locator('table.pairs button.det').first();
  await det.focus();
  await page.keyboard.press('Enter');
  assert.equal(await det.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('det')), true);
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
