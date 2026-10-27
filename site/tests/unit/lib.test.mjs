// Unit tests of the DOM-free modules (node --test). Values from the real export where possible.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trendSvg } from '../../src/lib/chart.js';
import { fmtCount, fmtInterval, fmtPct, fmtRatio, fmtShare, fmtShareMin, rawValue } from '../../src/lib/format.js';
import {
  concentrationReasons,
  groupMetrics,
  parseRoute,
  searchIngredients,
  searchRows,
  sortPairs,
  trendSeries,
} from '../../src/lib/logic.js';
import { wrapTables } from '../../src/lib/markdown.js';

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

test('trend chart: bars, "<3" gaps, provisional mark, escaped text', () => {
  const svg = trendSvg(
    [{ quarter: '2026Q1', a: 12 }, { quarter: '2026Q2', a: null }, { quarter: '2026Q3', a: 4 }],
    { provisionalQuarter: '2026Q3', titleId: 't', descId: 'd', title: 'A & B', desc: 'x<y' },
  );
  assert.equal((svg.match(/<rect class="bar/g) || []).length, 2);
  assert.match(svg, /&lt;3/);
  assert.match(svg, /2026Q3\*/);
  assert.match(svg, /<title id="t">A &amp; B<\/title>/);
  assert.match(svg, /<desc id="d">x&lt;y<\/desc>/);
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
