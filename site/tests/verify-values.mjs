// Stage 3 check of the site's numbers, part 2: rendered page = warehouse.
// Reads expected.json from scripts/verify_site_values.py (warehouse values and the text each
// must show) and checks the built site in headless Chromium: on each ingredient page (all rows
// shown) and on every pair page, each number cell's data-value (full double) differs from the
// warehouse by at most TOL and its visible text equals the expected text exactly.
// Usage: node tests/verify-values.mjs <expected.json> [dist]   (exit 1 on any difference)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [expectedPath, distArg = 'dist'] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const TOL = 1e-9;
const PORT = 8320;
const BASE = `http://127.0.0.1:${PORT}/faers-pipeline/`;
const server = await startServer({ root: resolve(SITE, distArg), port: PORT, prefix: '/faers-pipeline/' });
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
let checked = 0;

function compare(where, field, got, want, text, wantText) {
  checked += 1;
  const g = got === '' ? null : Number(got);
  if ((g === null) !== (want === null) || (g !== null && Math.abs(g - want) > TOL)) {
    failures.push(`${where} ${field}: page ${got} warehouse ${want}`);
  }
  if (text !== wantText) failures.push(`${where} ${field}: page text "${text}" expected "${wantText}"`);
}

const cellInfo = (loc) => loc.evaluate((td) => ({ v: td.dataset.value ?? '', l: td.dataset.lcl ?? '', u: td.dataset.ucl ?? '', t: td.textContent.trim() }));

for (const [slug, ing] of Object.entries(expected)) {
  await page.goto(`${BASE}#/ingredient/${slug}`);
  await page.locator('table.pairs tbody tr').first().waitFor();
  const showAll = page.locator('#show-all');
  if ((await showAll.count()) && /Show all/.test(await showAll.innerText())) await showAll.click();
  const rows = await page.locator('table.pairs tbody tr').count();
  if (rows !== ing.pairs.length) failures.push(`${slug}: ${rows} rows on the page, ${ing.pairs.length} expected`);
  for (const p of ing.pairs) {
    const row = page.locator(`table.pairs tr[data-reaction-key="${p.reaction_key}"]`);
    const where = `${slug}/${p.reaction_pt} (table)`;
    if ((await row.locator('th').innerText()).trim() !== p.reaction_pt) failures.push(`${where}: PT text`);
    for (const f of ['a', 'prr', 'ror']) {
      const c = await cellInfo(row.locator(`td[data-field="${f}"]`));
      compare(where, f, c.v, p.values[f], c.t, p.text[f]);
    }
    for (const [f, lo, hi] of [['prr_ci', 'prr_lcl', 'prr_ucl'], ['ror_ci', 'ror_lcl', 'ror_ucl']]) {
      const c = await cellInfo(row.locator(`td[data-field="${f}"]`));
      compare(where, lo, c.l, p.values[lo], c.t, p.text[f]);
      compare(where, hi, c.u, p.values[hi], c.t, p.text[f]);
    }
  }
  for (const p of ing.pairs) {
    await page.goto(`${BASE}#/ingredient/${slug}/${p.reaction_key}`);
    await page.locator('table.two-by-two td[data-field="a"]').waitFor();
    const where = `${slug}/${p.reaction_pt} (pair)`;
    for (const f of ['a', 'b', 'c', 'd', 'n_total', 'n_drug', 'n_reac']) {
      const c = await cellInfo(page.locator(`table.two-by-two td[data-field="${f}"]`));
      compare(where, f, c.v, p.values[f], c.t, p.text[f]);
    }
    for (const f of ['prr', 'prr_lcl', 'prr_ucl', 'ror', 'ror_lcl', 'ror_ucl', 'chi2']) {
      const c = await cellInfo(page.locator(`table.measures td[data-field="${f}"]`));
      compare(where, f, c.v, p.values[f], c.t, p.text[f]);
    }
  }
  console.log(`${slug}: ${ing.pairs.length} pairs checked on the ingredient page and ${ing.pairs.length} pair pages`);
}
await browser.close();
server.close();
console.log(`cells checked: ${checked}; differences: ${failures.length}`);
for (const f of failures.slice(0, 30)) console.log('DIFFERENCE', f);
process.exit(failures.length ? 1 : 0);
