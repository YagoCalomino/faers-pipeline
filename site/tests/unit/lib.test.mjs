// Unit tests of the DOM-free modules (node --test). Values from the real export where possible.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryLabel, fmtAbout, fmtCount, fmtInterval, fmtPct, fmtRatio, fmtShare, fmtShare2, fmtShareMin, rawValue } from '../../src/lib/format.js';
import {
  concentrationReasons,
  filterPairs,
  groupMetrics,
  MAG_MAX,
  MAG_TICKS,
  magnitude,
  magPos,
  pairShares,
  parseRoute,
  ptInline,
  quarterBars,
  quarterBarsText,
  referenceFor,
  searchIngredients,
  searchRows,
  shareDirection,
  SORT_KEYS,
  sortPairs,
  trendSeries,
} from '../../src/lib/logic.js';
import { dropTitle, linkRepoPaths, selectSections, wrapTables } from '../../src/lib/markdown.js';

const RULE = {
  min_top_quarter_share: 0.8,
  min_cases_for_quarter_rule: 10,
  min_median_reactions_per_case: 40,
  min_top_country_share: 0.9,
  min_cases_for_country_rule: 10,
};

test('number formats', () => {
  assert.equal(fmtCount(2858073), '2,858,073');
  assert.equal(fmtCount(null), '—');
  assert.equal(fmtRatio(40.56316781), '40.6');
  assert.equal(fmtRatio(0.997), '0.997');
  assert.equal(fmtRatio(397.52), '398');
  assert.equal(fmtRatio(27957.8), '27,958');
  assert.equal(fmtRatio(99.96), '100');
  assert.equal(fmtInterval(424.1, 937.2), '424 to 937');
  assert.equal(fmtInterval(null, 3), '—');
  assert.equal(fmtShare(0.333333), '33%');
  assert.equal(fmtShareMin(0.004), '<1%');
  assert.equal(fmtShareMin(0.083), '8%');
  assert.equal(fmtShareMin(0), '0%');
  assert.equal(countryLabel('CA'), 'Canada (CA)');
  assert.equal(countryLabel('XX'), 'XX'); // no known name: the code alone
  assert.equal(countryLabel(null), '—');
  assert.equal(fmtPct(0.601664), '0.60%');
  assert.equal(fmtPct(2), '2.0%');
  assert.equal(fmtPct(39.4815), '39.5%');
  assert.equal(rawValue(1 / 3), '0.3333333333333333');
  assert.equal(Number(rawValue(40.56316781234567)), 40.56316781234567);
});

test('concentration alert: quarter share and long reports; country share alone is not a reason', () => {
  // All from the US, like the ingredient: no alert.
  assert.deepEqual(
    concentrationReasons({ a: 50, top_quarter_share: 0.79, median_reactions_per_case: 39.5, top_country: 'US', top_country_share: 1, ingredient_top_country: 'US' }, RULE),
    [],
  );
  // Few reports: one quarter holding all 7 is not an alert.
  assert.deepEqual(concentrationReasons({ a: 7, top_quarter: '2024Q4', top_quarter_share: 1, median_reactions_per_case: 5 }, RULE), []);
  const r = concentrationReasons({ a: 10, top_quarter: '2026Q1', top_quarter_share: 0.8, median_reactions_per_case: 40 }, RULE);
  assert.deepEqual(r.map((x) => x.kind), ['quarter', 'long_reports']);
  assert.deepEqual(concentrationReasons({ top_quarter_share: null, median_reactions_per_case: null }, RULE), []);
});

test('concentration alert: country rule against the ingredient (atorvastatin pairs of the export)', () => {
  // atorvastatin: most frequent country GB (27.5% of its reports), 8.3% from CA, 2.3% from DE.
  const ing = { ingredient_top_country: 'GB', ingredient_top_country_share: 0.275 };
  const heart = { ...ing, a: 18, top_country: 'CA', top_country_share: 1, ingredient_country_share: 0.083, top_quarter_share: 0.222, median_reactions_per_case: 32 };
  const r = concentrationReasons(heart, RULE);
  assert.deepEqual(r, [{ kind: 'country', country: 'CA', share: 1, ingredientShare: 0.083, ingredientTopCountry: 'GB', ingredientTopShare: 0.275 }]);
  const genital = { ...ing, a: 13, top_country: 'DE', top_country_share: 1, ingredient_country_share: 0.023, top_quarter_share: 0.769, median_reactions_per_case: 7 };
  assert.deepEqual(concentrationReasons(genital, RULE).map((x) => x.kind), ['country']);
  // Thresholds: share just below, too few reports, or the ingredient's own top country.
  assert.deepEqual(concentrationReasons({ ...heart, top_country_share: 0.89 }, RULE), []);
  assert.deepEqual(concentrationReasons({ ...heart, a: 9 }, RULE), []);
  assert.deepEqual(concentrationReasons({ ...heart, top_country: 'GB' }, RULE), []);
  // No known country on either side: no country reason.
  assert.deepEqual(concentrationReasons({ ...heart, top_country: null, top_country_share: 0 }, RULE), []);
  assert.deepEqual(concentrationReasons({ ...heart, ingredient_top_country: null }, RULE), []);
  // With the long-reports rule too (Carotid artery thrombosis: 96% CA, median 53).
  const carotid = { ...ing, a: 123, top_country: 'CA', top_country_share: 0.959, ingredient_country_share: 0.083, top_quarter_share: 0.13, median_reactions_per_case: 53 };
  assert.deepEqual(concentrationReasons(carotid, RULE).map((x) => x.kind), ['long_reports', 'country']);
});

test('sortPairs: nulls last both ways, ties by PT', () => {
  const pairs = [
    { reaction_pt: 'B', reaction_key: '2', ror_lcl: null, prr: 5, a: 3 },
    { reaction_pt: 'A', reaction_key: '1', ror_lcl: 10, prr: 5, a: 9 },
    { reaction_pt: 'C', reaction_key: '3', ror_lcl: 2, prr: 7, a: 4 },
  ];
  assert.deepEqual(sortPairs(pairs, 'ror_lcl', 'desc').map((p) => p.reaction_pt), ['A', 'C', 'B']);
  assert.deepEqual(sortPairs(pairs, 'ror_lcl', 'asc').map((p) => p.reaction_pt), ['C', 'A', 'B']);
  assert.deepEqual(sortPairs(pairs, 'prr', 'desc').map((p) => p.reaction_pt), ['C', 'A', 'B']);
  assert.deepEqual(sortPairs(pairs, 'a', 'asc').map((p) => p.reaction_pt), ['B', 'C', 'A']);
  assert.equal(pairs[0].reaction_pt, 'B'); // input untouched
});

test('sortPairs: default directions, name A to Z, ties by reaction key, non-finite last', () => {
  const pairs = [
    { reaction_pt: 'b', reaction_key: '2', ror_lcl: 4, prr: Infinity, a: 3 },
    { reaction_pt: 'A', reaction_key: '9', ror_lcl: 4, prr: 5, a: 9 },
    { reaction_pt: 'A', reaction_key: '1', ror_lcl: 4, prr: 7, a: 4 },
  ];
  // Default of ror_lcl is descending; equal values fall back to PT, then reaction key.
  assert.deepEqual(sortPairs(pairs, 'ror_lcl').map((p) => p.reaction_key), ['1', '9', '2']);
  assert.deepEqual(sortPairs(pairs, 'name').map((p) => p.reaction_key), ['1', '9', '2']);
  // An infinite PRR sorts with the nulls, last.
  assert.deepEqual(sortPairs(pairs, 'prr').map((p) => p.reaction_key), ['1', '9', '2']);
  assert.deepEqual(Object.keys(SORT_KEYS), ['ror_lcl', 'prr', 'a', 'name']);
});

test('filterPairs: text in the PT and reporting-pattern filter', () => {
  const pairs = [
    { reaction_pt: 'Rhabdomyolysis', flagged: false },
    { reaction_pt: 'Autoimmune myositis', flagged: true },
    { reaction_pt: 'Necrotising myositis', flagged: false },
  ];
  const has = (p) => p.flagged;
  assert.equal(filterPairs(pairs, { text: ' MYOS ' }, has).length, 2);
  assert.deepEqual(filterPairs(pairs, { pattern: 'with' }, has).map((p) => p.reaction_pt), ['Autoimmune myositis']);
  assert.equal(filterPairs(pairs, { text: 'myositis', pattern: 'without' }, has).length, 1);
  assert.equal(filterPairs(pairs, {}, has).length, 3);
});

test('magnitude bar: log scale from 1x to 30,000x, clamped at both ends, no bar without a PRR', () => {
  assert.deepEqual(MAG_TICKS, [1, 10, 100, 1000, 10000]);
  assert.equal(magPos(1).pos, 0);
  assert.equal(magPos(MAG_MAX).pos, 100);
  assert.ok(Math.abs(magPos(10).pos - 100 / Math.log10(MAG_MAX)) < 1e-9);
  // Real extremes of the export: PRR 2,858,069 and 0.466.
  assert.deepEqual(magPos(2858069), { pos: 100, below: false, above: true });
  assert.deepEqual(magPos(0.466), { pos: 0, below: true, above: false });
  for (const v of [null, undefined, NaN, Infinity, -1, 0]) assert.equal(magPos(v), null, String(v));
  // Rhabdomyolysis with atorvastatin: PRR 40.6 (37.8 to 43.5).
  const m = magnitude({ prr: 40.56, prr_lcl: 37.78, prr_ucl: 43.55 });
  assert.ok(m.lo < m.dot && m.dot < m.hi && !m.above && !m.below);
  // Interval beyond the scale: the range is clamped and flagged.
  assert.equal(magnitude({ prr: 2547, prr_lcl: 333, prr_ucl: 1e6 }).above, true);
  assert.equal(magnitude({ prr: null, prr_lcl: 1, prr_ucl: 2 }), null);
  assert.equal(magnitude({ prr: Infinity }), null);
});

test('search: prefix matches first, then substring, in case order', () => {
  const rows = searchRows({
    columns: ['ingredient_name', 'slug', 'n_cases_ps_ss', 'n_pairs', 'is_fallback'],
    rows: [
      ['dupilumab', 'dupilumab', 244455, 26, false],
      ['atorvastatin', 'atorvastatin', 14516, 29, false],
      ['rosuvastatin', 'rosuvastatin', 9000, 30, false],
      ['ATORVASTATIN CALCIUM', 'atorvastatin-calcium', 10, 3, true],
    ],
  });
  assert.deepEqual(searchIngredients(rows, 'ator').map((r) => r.slug), ['atorvastatin', 'atorvastatin-calcium']);
  assert.deepEqual(searchIngredients(rows, 'VASTATIN').map((r) => r.slug), ['atorvastatin', 'rosuvastatin', 'atorvastatin-calcium']);
  assert.deepEqual(searchIngredients(rows, '  '), []);
  assert.equal(searchIngredients(rows, 'a', 2).length, 2);
});

test('routes', () => {
  const key = 'cd6f0d67546ec5d4ea6d7e0c28f20a6a';
  assert.deepEqual(parseRoute(''), { page: 'home' });
  assert.deepEqual(parseRoute('#/'), { page: 'home' });
  assert.deepEqual(parseRoute('#/ingredient/atorvastatin'), { page: 'ingredient', slug: 'atorvastatin' });
  assert.deepEqual(parseRoute(`#/ingredient/atorvastatin/${key}`), { page: 'pair', slug: 'atorvastatin', reactionKey: key });
  assert.deepEqual(parseRoute('#/quality'), { page: 'quality' });
  assert.equal(parseRoute('#/ingredient/../x').page, 'not_found');
  assert.equal(parseRoute('#/ingredient/atorvastatin/notakey').page, 'not_found');
  assert.equal(parseRoute('#/nope').page, 'not_found');
});

test('trend series fills quarters below the minimum with null', () => {
  const s = trendSeries([{ period_key: '2024Q4', a: 4, prr: 283.8 }], ['2024Q3', '2024Q4']);
  assert.deepEqual(s, [
    { quarter: '2024Q3', a: null, prr: null },
    { quarter: '2024Q4', a: 4, prr: 283.8 },
  ]);
  assert.equal(trendSeries(null, ['2026Q2'])[0].a, null);
});

test('quarter bars: heights from the tallest count, "<3" quarters without a bar, provisional flag', () => {
  // Rhabdomyolysis with atorvastatin, first quarters of the real export, plus a quarter under 3.
  const bars = quarterBars(
    [{ quarter: '2024Q3', a: 104, prr: 48.7 }, { quarter: '2024Q4', a: 73, prr: 35.3 }, { quarter: '2025Q1', a: null, prr: null }, { quarter: '2026Q2', a: 52, prr: 30 }],
    '2026Q2',
  );
  assert.deepEqual(bars.map((b) => b.height), [100, (100 * 73) / 104, 0, 50]);
  assert.deepEqual(bars.map((b) => b.provisional), [false, false, false, true]);
  assert.equal(bars[2].a, null);
  assert.equal(quarterBars([{ quarter: '2026Q2', a: 5 }], null)[0].provisional, false);
  assert.deepEqual(quarterBars([{ quarter: '2026Q2', a: null }], '2026Q2').map((b) => b.height), [0]);
  assert.equal(
    quarterBarsText(bars, 'Cases per quarter'),
    'Cases per quarter. 2024Q3: 104; 2024Q4: 73; 2025Q1: fewer than 3; 2026Q2 (provisional): 52.',
  );
});

test('pair shares: a / n_drug and c / (n_total - n_drug), whose ratio is the PRR', () => {
  // Rhabdomyolysis with atorvastatin in the real export.
  const p = { a: 873, b: 13643, c: 4216, d: 2839341, n_drug: 14516, n_total: 2858073, prr: 40.56286482350431 };
  const s = pairShares(p);
  assert.equal(s.nOther, p.c + p.d);
  assert.equal(s.drug, 873 / 14516);
  assert.equal(s.other, 4216 / 2843557);
  assert.ok(Math.abs(s.drug / s.other - p.prr) < 1e-9);
  assert.deepEqual([fmtShare2(s.drug), fmtShare2(s.other), fmtAbout(p.prr)], ['6.0%', '0.15%', '41']);
  assert.equal(pairShares({ a: 1, c: 0, n_drug: 0, n_total: 0 }).drug, null);
  assert.equal(pairShares({ a: 1, c: 0, n_drug: 5, n_total: 5 }).other, null);
});

test('share and "about" formats: 2 significant digits at every size', () => {
  assert.deepEqual([0.0603, 0.001483, 0.30927, 1, 0, 0.00005, null].map(fmtShare2), ['6.0%', '0.15%', '31%', '100%', '0%', '0.0050%', '—']);
  assert.deepEqual([40.56, 630.5, 2546.6, 13034.6, 2.34, Infinity, null].map(fmtAbout), ['41', '630', '2,500', '13,000', '2.3', '—', '—']);
});

test('share direction follows the PRR as shown', () => {
  assert.equal(shareDirection(40.6, fmtRatio(40.6)), 'larger');
  assert.equal(shareDirection(0.42, fmtRatio(0.42)), 'smaller');
  assert.equal(shareDirection(1.0004, fmtRatio(1.0004)), 'same');
  assert.equal(shareDirection(null, '—'), null);
  assert.equal(shareDirection(Infinity, '∞'), null);
});

test('reference pair: joined by ingredient name and reaction PT, null otherwise', () => {
  const rows = [
    { ingredient_name: 'atorvastatin', reaction_pt: 'Rhabdomyolysis', expected: 'positive', passed: true },
    { ingredient_name: 'atorvastatin', reaction_pt: 'Pneumonia', expected: 'negative', passed: true },
  ];
  assert.equal(referenceFor(rows, 'atorvastatin', 'Rhabdomyolysis'), rows[0]);
  assert.equal(referenceFor(rows, 'atorvastatin', 'Myalgia'), null);
  assert.equal(referenceFor(rows, 'simvastatin', 'Rhabdomyolysis'), null);
  assert.equal(referenceFor(null, 'atorvastatin', 'Rhabdomyolysis'), null);
});

test('PT inside a sentence: lower first letter, acronyms kept', () => {
  assert.equal(ptInline('Rhabdomyolysis'), 'rhabdomyolysis');
  assert.equal(ptInline('International normalised ratio increased'), 'international normalised ratio increased');
  assert.equal(ptInline('INR increased'), 'INR increased');
});

test('groupMetrics nests by basis, group, period', () => {
  const g = groupMetrics([
    { period_basis: 'all', period_key: 'ALL', metric_group: 'raw_rows', metric: 'demo', value: 1, unit: 'rows' },
    { period_basis: 'file_quarter', period_key: '2026Q2', metric_group: 'raw_rows', metric: 'demo', value: 2, unit: 'rows' },
  ]);
  assert.equal(g.all.raw_rows.ALL.demo.value, 1);
  assert.equal(g.file_quarter.raw_rows['2026Q2'].demo.value, 2);
});

test('wrapTables: every table in a focusable region named after the heading before it', () => {
  const html = [
    '<table><tr><td>1</td></tr></table>',
    '<h3 id="y">Continuity correction (<code>Yates</code>) &amp; "bands"</h3>',
    '<table>\n<thead><tr><th>a</th></tr></thead></table>',
    '<p>x</p><table><tr><td>2</td></tr></table>',
  ].join('');
  const out = wrapTables(html);
  const regions = [...out.matchAll(/<div class="table-scroll" role="region" aria-label="([^"]*)" tabindex="0"><table[\s>]/g)];
  assert.deepEqual(regions.map((m) => m[1]), [
    'Table 1',
    'Continuity correction (Yates) &amp; &quot;bands&quot;',
    'Continuity correction (Yates) &amp; &quot;bands&quot;, table 2',
  ]);
  assert.equal((out.match(/<\/table><\/div>/g) || []).length, 3);
  assert.equal(wrapTables('<p>no table</p>'), '<p>no table</p>');
});

test('selectSections: keeps the preamble and the listed level-2 sections, in file order', () => {
  const NL = String.fromCharCode(10);
  const md = [
    '# Title', 'intro', '## A', 'a text', '### A.1', 'a1', '```', '## not a heading', '```',
    '## Operational limits', 'local paths', '## B', 'b text',
  ].join(NL);
  const out = selectSections(md, ['B', 'A']);
  assert.equal(out, ['# Title', 'intro', '## A', 'a text', '### A.1', 'a1', '```', '## not a heading', '```', '## B', 'b text'].join(NL));
  assert.ok(!out.includes('local paths'));
  assert.throws(() => selectSections(md, ['A', 'Missing']), /Missing/);
});

test('linkRepoPaths: known repository paths become GitHub links, the rest stays code', () => {
  const kinds = { 'docs/a.md': 'file', 'dbt/tests': 'dir' };
  const html =
    '<p><code>docs/a.md</code>, <code>dbt/tests/</code>, <code>dbt/**/_*.yml</code>, <code>x.sql</code>, ' +
    '<code>docs/missing.md</code> and <a href="#/m"><code>docs/a.md</code></a></p>';
  const out = linkRepoPaths(html, 'https://github.com/o/r', 'main', (p) => kinds[p] ?? null);
  assert.equal(
    out,
    '<p><a href="https://github.com/o/r/blob/main/docs/a.md" rel="noopener"><code>docs/a.md</code></a>, ' +
      '<a href="https://github.com/o/r/tree/main/dbt/tests" rel="noopener"><code>dbt/tests/</code></a>, ' +
      '<code>dbt/**/_*.yml</code>, <code>x.sql</code>, <code>docs/missing.md</code> and ' +
      '<a href="#/m"><code>docs/a.md</code></a></p>'
  );
});

test('dropTitle: removes only a leading level-1 heading', () => {
  assert.equal(dropTitle('<h1 id="k">Known limitations</h1>\n<p>x</p><h1>y</h1>'),'<p>x</p><h1>y</h1>');
  assert.equal(dropTitle('<p>x</p>'), '<p>x</p>');
});
