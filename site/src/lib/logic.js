// Logic of the pages that does not touch the DOM (unit-tested with node --test).

// Concentration alert of a pair (config/site.yaml concentration_alert). Returns the reasons that
// hold; an empty list means no alert. A country share alone is never a reason (most reports are
// from the US): the country rule needs the pair's top country to differ from the ingredient's.
export function concentrationReasons(pair, rule) {
  const reasons = [];
  if (
    pair.top_quarter_share != null &&
    pair.a >= rule.min_cases_for_quarter_rule &&
    pair.top_quarter_share >= rule.min_top_quarter_share
  ) {
    reasons.push({ kind: 'quarter', quarter: pair.top_quarter, share: pair.top_quarter_share });
  }
  if (
    pair.median_reactions_per_case != null &&
    pair.median_reactions_per_case >= rule.min_median_reactions_per_case
  ) {
    reasons.push({ kind: 'long_reports', median: pair.median_reactions_per_case });
  }
  if (
    pair.top_country != null &&
    pair.ingredient_top_country != null &&
    pair.a >= rule.min_cases_for_country_rule &&
    pair.top_country_share >= rule.min_top_country_share &&
    pair.top_country !== pair.ingredient_top_country
  ) {
    reasons.push({
      kind: 'country',
      country: pair.top_country,
      share: pair.top_country_share,
      ingredientShare: pair.ingredient_country_share,
      ingredientTopCountry: pair.ingredient_top_country,
      ingredientTopShare: pair.ingredient_top_country_share,
    });
  }
  return reasons;
}

// Sort options of the ingredient page (plain label first, technical name in parentheses). The
// first is the default; "name" sorts A to Z, the others highest first.
export const SORT_KEYS = {
  ror_lcl: { label: 'Most clearly larger share (ROR lower bound)', short: 'ROR lower bound', field: 'ror_lcl', dir: 'desc' },
  prr: { label: 'Largest share ratio (PRR)', short: 'PRR', field: 'prr', dir: 'desc' },
  a: { label: 'Most cases', short: 'cases', field: 'a', dir: 'desc' },
  name: { label: 'Name, A to Z', short: 'name', field: 'reaction_pt', dir: 'asc' },
};

const byPt = (x, y) => x.reaction_pt.localeCompare(y.reaction_pt, 'en') || x.reaction_key.localeCompare(y.reaction_key);

// Sorted copy; nulls (and non-finite values) last in both directions; ties by reaction PT, then
// reaction key.
export function sortPairs(pairs, key, dir = SORT_KEYS[key]?.dir ?? 'desc') {
  if (key === 'name') return [...pairs].sort((x, y) => (dir === 'asc' ? byPt(x, y) : byPt(y, x)));
  const field = SORT_KEYS[key]?.field ?? key;
  const sign = dir === 'asc' ? 1 : -1;
  const ok = (v) => v != null && Number.isFinite(v);
  return [...pairs].sort((x, y) => {
    const a = x[field];
    const b = y[field];
    if (!ok(a) && ok(b)) return 1;
    if (!ok(b) && ok(a)) return -1;
    if (ok(a) && ok(b) && a !== b) return sign * (a - b);
    return byPt(x, y);
  });
}

// Pairs kept by the ingredient page filters: text in the PT, and reporting pattern
// ('all', 'with', 'without').
export function filterPairs(pairs, { text = '', pattern = 'all' }, hasPattern) {
  const q = text.trim().toLowerCase();
  return pairs.filter(
    (p) =>
      (!q || p.reaction_pt.toLowerCase().includes(q)) &&
      (pattern === 'all' || (pattern === 'with') === hasPattern(p)),
  );
}

// Magnitude bar on a log scale from 1x to MAG_MAX: position in percent of the bar. Values
// beyond the scale are clamped and flagged; null, non-finite or non-positive values have no
// position.
export const MAG_MAX = 30000;
export const MAG_TICKS = [1, 10, 100, 1000, 10000];
export function magPos(v) {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  const raw = (Math.log10(v) / Math.log10(MAG_MAX)) * 100;
  return { pos: Math.min(100, Math.max(0, raw)), below: raw < 0, above: raw > 100 };
}

// Dot (PRR) and range (95% CI) of a pair; null when the PRR has no position.
export function magnitude(p) {
  const dot = magPos(p.prr);
  if (!dot) return null;
  const lo = magPos(p.prr_lcl);
  const hi = magPos(p.prr_ucl);
  return {
    dot: dot.pos,
    lo: lo ? lo.pos : dot.pos,
    hi: hi ? hi.pos : dot.pos,
    above: dot.above || Boolean(hi?.above),
    below: dot.below || Boolean(lo?.below),
  };
}

// Search over json/search.json rows ([name, slug, n_cases, n_pairs, is_fallback], ordered by
// cases). Names starting with the query come first, then names containing it; each group keeps
// the order by cases.
export function searchIngredients(index, query, limit = 10) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const row of index) {
    const name = row.name.toLowerCase();
    if (name.startsWith(q)) starts.push(row);
    else if (name.includes(q)) contains.push(row);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function searchRows(searchJson) {
  const col = Object.fromEntries(searchJson.columns.map((c, i) => [c, i]));
  return searchJson.rows.map((r) => ({
    name: r[col.ingredient_name],
    slug: r[col.slug],
    cases: r[col.n_cases_ps_ss],
    pairs: r[col.n_pairs],
    fallback: r[col.is_fallback],
  }));
}

const SLUG = /^[a-z0-9-]+$/;
const KEY = /^[a-f0-9]{32}$/;

// '#/ingredient/<slug>[/<reaction_key>]', '#/quality', ... -> { page, ...params }.
export function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { page: 'home' };
  const [page, slug, key] = parts;
  if (page === 'ingredient' && slug && SLUG.test(slug)) {
    if (key === undefined) return { page: 'ingredient', slug };
    if (KEY.test(key) && parts.length === 3) return { page: 'pair', slug, reactionKey: key };
  }
  if (['quality', 'validation', 'method', 'downloads'].includes(page) && parts.length === 1) {
    return { page };
  }
  return { page: 'not_found' };
}

export const ingredientHref = (slug) => `#/ingredient/${slug}`;
export const pairHref = (slug, reactionKey) => `#/ingredient/${slug}/${reactionKey}`;

// One point per window quarter; a is null where the pair had fewer than signal_min_cases
// cases that quarter (absent from mart_signals).
export function trendSeries(trend, quarters) {
  const byQuarter = new Map((trend || []).map((t) => [t.period_key, t]));
  return quarters.map((q) => {
    const t = byQuarter.get(q);
    return { quarter: q, a: t ? t.a : null, prr: t ? t.prr : null };
  });
}

// The two shares behind the PRR of a pair: the reaction's share of the ingredient's cases,
// a / n_drug (n_drug = a + b), and its share of all other cases, c / (n_total - n_drug)
// (= c + d). Null where a denominator is 0 or missing.
export function pairShares(p) {
  const nOther = p.n_total != null && p.n_drug != null ? p.n_total - p.n_drug : null;
  return {
    drug: p.n_drug ? p.a / p.n_drug : null,
    other: nOther ? p.c / nOther : null,
    nOther,
  };
}

// Direction of a PRR as the page words it: 'larger', 'smaller', 'same' (shown as 1) or null.
export function shareDirection(prr, shown) {
  if (prr == null || !Number.isFinite(prr)) return null;
  if (shown === '1') return 'same';
  return prr > 1 ? 'larger' : 'smaller';
}

// Bars of the quarterly chart: height in percent of the tallest count; quarters without a count
// (fewer than signal_min_cases) have no bar. The provisional quarter is flagged.
export function quarterBars(series, provisionalQuarter) {
  const max = Math.max(0, ...series.map((s) => s.a ?? 0));
  return series.map((s) => ({
    quarter: s.quarter,
    a: s.a,
    prr: s.prr,
    height: s.a == null || max === 0 ? 0 : (100 * s.a) / max,
    provisional: provisionalQuarter != null && s.quarter === provisionalQuarter,
  }));
}

// Text alternative of the quarterly chart: every quarter with its count.
export function quarterBarsText(bars, title) {
  const parts = bars.map(
    (b) => `${b.quarter}${b.provisional ? ' (provisional)' : ''}: ${b.a == null ? 'fewer than 3' : b.a}`,
  );
  return `${title}. ${parts.join('; ')}.`;
}

// Row of json/known_signals.json for a pair (joined by ingredient name and reaction PT), or null.
export function referenceFor(rows, ingredientName, reactionPt) {
  return (rows || []).find((r) => r.ingredient_name === ingredientName && r.reaction_pt === reactionPt) ?? null;
}

// MedDRA PT inside a sentence: first letter lowered unless the term starts with an acronym
// ("Rhabdomyolysis" -> "rhabdomyolysis", "INR increased" stays).
export const ptInline = (pt) => (/^[A-Z][a-z]/.test(pt) ? pt[0].toLowerCase() + pt.slice(1) : pt);

// Data-quality rows ->{ [period_basis]: { [metric_group]: { [period_key]: { metric: row } } } }
export function groupMetrics(rows) {
  const out = {};
  for (const r of rows) {
    const g = ((out[r.period_basis] ??= {})[r.metric_group] ??= {});
    (g[r.period_key] ??= {})[r.metric] = r;
  }
  return out;
}
