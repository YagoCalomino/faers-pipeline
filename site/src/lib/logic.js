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

export const SORT_KEYS = {
  ror_lcl: { label: 'ROR lower bound', field: 'ror_lcl' },
  prr: { label: 'PRR', field: 'prr' },
  a: { label: 'Reports', field: 'a' },
};

// Sorted copy; nulls last in both directions; ties by reaction PT, then reaction key.
export function sortPairs(pairs, key, dir = 'desc') {
  const field = SORT_KEYS[key]?.field ?? key;
  const sign = dir === 'asc' ? 1 : -1;
  return [...pairs].sort((x, y) => {
    const a = x[field];
    const b = y[field];
    if (a == null && b != null) return 1;
    if (b == null && a != null) return -1;
    if (a != null && b != null && a !== b) return sign * (a - b);
    return (
      x.reaction_pt.localeCompare(y.reaction_pt, 'en') || x.reaction_key.localeCompare(y.reaction_key)
    );
  });
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
// reports that quarter (absent from mart_signals).
export function trendSeries(trend, quarters) {
  const byQuarter = new Map((trend || []).map((t) => [t.period_key, t]));
  return quarters.map((q) => {
    const t = byQuarter.get(q);
    return { quarter: q, a: t ? t.a : null, prr: t ? t.prr : null };
  });
}

// Data-quality rows -> { [period_basis]: { [metric_group]: { [period_key]: { metric: row } } } }
export function groupMetrics(rows) {
  const out = {};
  for (const r of rows) {
    const g = ((out[r.period_basis] ??= {})[r.metric_group] ??= {});
    (g[r.period_key] ??= {})[r.metric] = r;
  }
  return out;
}
