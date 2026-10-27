// FAERS disproportionality explorer: hash-routed views over the site export (data/).
// Views: home (search), ingredient, pair, quality, validation, method, downloads.
import './style.css';
import { config, meta } from 'virtual:site-config';
import { trendSvg } from './lib/chart.js';
import {
  DASH,
  fmtCount,
  fmtInterval,
  fmtMetric,
  fmtPct,
  fmtRatio,
  fmtShare,
  rawValue,
} from './lib/format.js';
import {
  concentrationReasons,
  groupMetrics,
  ingredientHref,
  pairHref,
  parseRoute,
  searchIngredients,
  searchRows,
  SORT_KEYS,
  sortPairs,
  trendSeries,
} from './lib/logic.js';

const main = document.getElementById('main');
const status = document.getElementById('status');
const SITE_TITLE = config.site.title;

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Number cell: formatted text, full value in data-value (checked against the warehouse).
const num = (v, text, field) =>
  `<td class="num" data-field="${field}" data-value="${rawValue(v)}">${text}</td>`;

const cache = new Map();
function getJson(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`data/${path}`).then((r) => {
        if (!r.ok) throw Object.assign(new Error(`${path}: HTTP ${r.status}`), { status: r.status });
        return r.json();
      }),
    );
    cache.get(path).catch(() => cache.delete(path));
  }
  return cache.get(path);
}

let searchIndex;
async function loadSearch() {
  searchIndex ??= getJson('json/search.json').then(searchRows);
  return searchIndex;
}

function scrollTable(label, html) {
  return `<div class="table-scroll" role="region" aria-label="${esc(label)}" tabindex="0">${html}</div>`;
}

function alertBadge(reasons) {
  if (!reasons.length) return '';
  const text = reasons
    .map((r) =>
      r.kind === 'quarter'
        ? `${fmtShare(r.share)} of reports in ${esc(r.quarter)}`
        : `median ${fmtCount(r.median)} reactions per report`,
    )
    .join('; ');
  return `<span class="alert-badge"><span aria-hidden="true">⚠</span> ${text}</span>`;
}

// ---------------------------------------------------------------------------------- home

async function viewHome() {
  setTitle('Search');
  const rule = config.alert;
  main.innerHTML = `
    <h1 tabindex="-1">Find an ingredient</h1>
    <p class="lede">Reports to the FDA Adverse Event Reporting System (FAERS) from
      ${esc(meta.first_quarter)} to ${esc(meta.last_quarter)}, deduplicated to
      ${fmtCount(meta.n_cases_all)} cases. For each ingredient, the reactions reported
      disproportionately often with it, measured by the PRR and the ROR.</p>
    <div class="search">
      <label for="q">Ingredient name</label>
      <div class="combo">
        <input id="q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="q-list" aria-describedby="q-help" autocomplete="off" spellcheck="false"
          placeholder="for example atorvastatin" />
        <ul id="q-list" role="listbox" aria-label="Matching ingredients" hidden></ul>
      </div>
      <p id="q-help" class="help">Generic names, as mapped to RxNorm ingredients. Use the arrow
        keys to move through the suggestions and Enter to open one.</p>
    </div>
    <section aria-labelledby="top-h">
      <h2 id="top-h">Ingredients with the most reports</h2>
      <ol class="top-list" id="top-list"><li class="loading">Loading…</li></ol>
    </section>
    <section aria-labelledby="about-h">
      <h2 id="about-h">What this is</h2>
      <p>An open data pipeline (Airflow, DuckDB, dbt) downloads the FDA quarterly files,
        removes superseded case versions and deleted cases, maps drug names to RxNorm
        ingredients and counts reports for every ingredient and reaction (MedDRA preferred
        term). Each ingredient page lists up to 30 reactions: the 20 with the highest lower
        bound of the reporting odds ratio and the 10 with the most reports among pairs that
        meet the Evans criterion. ${fmtCount(meta.n_ingredients)} ingredients and
        ${fmtCount(meta.n_pairs)} pairs are included.</p>
      <p>A pair is marked <strong>concentrated</strong> when ${fmtShare(rule.min_top_quarter_share)}
        or more of its reports come from one quarter, or its reports list a median of
        ${fmtCount(rule.min_median_reactions_per_case)} or more reactions each: patterns of
        reporting clusters rather than of the drug.</p>
    </section>`;
  const rows = await loadSearch();
  document.getElementById('top-list').innerHTML = rows
    .slice(0, 12)
    .map(
      (r) =>
        `<li><a href="${ingredientHref(r.slug)}">${esc(r.name)}</a> <span class="muted">${fmtCount(r.cases)} reports</span></li>`,
    )
    .join('');
  setupCombobox(rows);
  announce('Ingredient list loaded');
}

function setupCombobox(rows) {
  const input = document.getElementById('q');
  const list = document.getElementById('q-list');
  let items = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `q-opt-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const go = (i) => {
    if (items[i]) location.hash = ingredientHref(items[i].slug);
  };
  input.addEventListener('input', () => {
    items = searchIngredients(rows, input.value, 10);
    if (!items.length) {
      list.innerHTML = input.value.trim()
        ? '<li class="empty" role="option" aria-disabled="true">No ingredient found</li>'
        : '';
      list.hidden = !input.value.trim();
      input.setAttribute('aria-expanded', String(!list.hidden));
      announce(input.value.trim() ? 'No ingredient found' : '');
      return;
    }
    list.innerHTML = items
      .map(
        (r, i) =>
          `<li id="q-opt-${i}" role="option" aria-selected="false" data-i="${i}">${esc(r.name)} <span class="muted">${fmtCount(r.cases)} reports${r.fallback ? ', name without RxNorm match' : ''}</span></li>`,
      )
      .join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
    announce(`${items.length} suggestions`);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      highlight(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      highlight(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) go(+li.dataset.i);
  });
  input.addEventListener('blur', close);
}

// ---------------------------------------------------------------------------- ingredient

async function loadIngredient(slug) {
  try {
    return await getJson(`json/signals/${slug}.json`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

function notFound(what) {
  setTitle('Not found');
  main.innerHTML = `<h1 tabindex="-1">Not found</h1><p>${esc(what)}</p><p><a href="#/">Back to the search</a></p>`;
}

function ingredientNote(ing) {
  if (ing.is_fallback) {
    return 'This name has no match in RxNorm, so it is shown as reported. Reports of the same drug under its RxNorm name are counted separately.';
  }
  return `RxNorm ingredient ${esc(ing.ingredient_id)} (${esc(ing.match_type)} match).`;
}

const sortState = { key: 'ror_lcl', dir: 'desc', all: false };

async function viewIngredient(slug) {
  const doc = await loadIngredient(slug);
  if (!doc) return notFound(`No ingredient "${slug}" in this export.`);
  const ing = doc.ingredient;
  setTitle(ing.ingredient_name);
  main.innerHTML = `
    <p class="crumbs"><a href="#/">Search</a> <span aria-hidden="true">/</span> ${esc(ing.ingredient_name)}</p>
    <h1 tabindex="-1">${esc(ing.ingredient_name)}</h1>
    <p class="lede">${fmtCount(ing.n_cases_ps_ss)} reports name ${esc(ing.ingredient_name)} as primary
      or secondary suspect. ${ingredientNote(ing)}</p>
    <p>Reactions with the highest disproportionality across all loaded reports. Open a reaction
      for its 2×2 table, intervals and quarterly trend.</p>
    <div id="pairs"></div>`;
  renderPairsTable(doc);
  announce(`${doc.pairs.length} reactions for ${ing.ingredient_name}`);
}

function renderPairsTable(doc) {
  const { key, dir } = sortState;
  const sorted = sortPairs(doc.pairs, key, dir);
  const size = config.site.pairs_page_size;
  const shown = sortState.all ? sorted : sorted.slice(0, size);
  const slug = doc.ingredient.slug;
  const th = (k, label) => {
    const on = k === key;
    const ariaSort = on ? (dir === 'desc' ? 'descending' : 'ascending') : 'none';
    const arrow = on ? (dir === 'desc' ? '▼' : '▲') : '↕';
    return `<th scope="col" class="num" aria-sort="${ariaSort}"><button type="button" class="sort" data-sort="${k}">${label} <span aria-hidden="true">${arrow}</span></button></th>`;
  };
  const rows = shown
    .map((p) => {
      const reasons = concentrationReasons(p, config.alert);
      const criteria =
        [p.is_signal_evans ? 'Evans' : '', p.is_signal_ror ? 'ROR' : ''].filter(Boolean).join(', ') ||
        DASH;
      return `<tr data-reaction-key="${p.reaction_key}">
        <th scope="row"><a href="${pairHref(slug, p.reaction_key)}">${esc(p.reaction_pt)}</a></th>
        ${num(p.a, fmtCount(p.a), 'a')}
        ${num(p.prr, fmtRatio(p.prr), 'prr')}
        <td class="num ci" data-field="prr_ci" data-lcl="${rawValue(p.prr_lcl)}" data-ucl="${rawValue(p.prr_ucl)}">${fmtInterval(p.prr_lcl, p.prr_ucl)}</td>
        ${num(p.ror, fmtRatio(p.ror), 'ror')}
        <td class="num ci" data-field="ror_ci" data-lcl="${rawValue(p.ror_lcl)}" data-ucl="${rawValue(p.ror_ucl)}">${fmtInterval(p.ror_lcl, p.ror_ucl)}</td>
        <td>${criteria}</td>
        <td>${alertBadge(reasons)}</td>
      </tr>`;
    })
    .join('');
  const flagged = doc.pairs.filter((p) => concentrationReasons(p, config.alert).length).length;
  const more =
    sorted.length > size
      ? `<p><button type="button" class="link-button" id="show-all">${sortState.all ? `Show the first ${size}` : `Show all ${sorted.length} reactions`}</button></p>`
      : '';
  document.getElementById('pairs').innerHTML = `
    <p class="table-summary" id="pairs-summary">${sorted.length} reactions, sorted by ${SORT_KEYS[key].label} (${dir === 'desc' ? 'highest first' : 'lowest first'}).
      ${flagged ? `${flagged} marked concentrated.` : ''}</p>
    ${scrollTable(
      'Reactions',
      `<table class="pairs" aria-describedby="pairs-summary">
        <caption class="sr-only">Reactions reported with ${esc(doc.ingredient.ingredient_name)}</caption>
        <thead><tr>
          <th scope="col">Reaction (MedDRA PT)</th>
          ${th('a', 'Reports')}
          ${th('prr', 'PRR')}
          <th scope="col" class="num">PRR 95% CI</th>
          <th scope="col" class="num">ROR</th>
          ${th('ror_lcl', 'ROR 95% CI')}
          <th scope="col">Criteria met</th>
          <th scope="col">Concentration alert</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    )}
    ${more}
    <p class="help">Sorting by ROR 95% CI uses its lower bound. Criteria: Evans (at least 3
      reports, PRR ≥ 2, χ² ≥ 4); ROR (at least 3 reports, lower bound above 1). Meeting a
      criterion flags a pair for review; it does not confirm an effect of the drug.</p>`;
  for (const b of document.querySelectorAll('button.sort')) {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      sortState.dir = sortState.key === k && sortState.dir === 'desc' ? 'asc' : 'desc';
      sortState.key = k;
      renderPairsTable(doc);
      document.querySelector(`button.sort[data-sort="${k}"]`).focus();
      announce(`Sorted by ${SORT_KEYS[k].label}, ${sortState.dir === 'desc' ? 'highest' : 'lowest'} first`);
    });
  }
  document.getElementById('show-all')?.addEventListener('click', () => {
    sortState.all = !sortState.all;
    renderPairsTable(doc);
    document.getElementById('show-all')?.focus();
  });
}

// ---------------------------------------------------------------------------------- pair

async function viewPair(slug, reactionKey) {
  const doc = await loadIngredient(slug);
  const p = doc?.pairs.find((x) => x.reaction_key === reactionKey);
  if (!doc || !p) return notFound('This ingredient and reaction pair is not in this export.');
  const ing = doc.ingredient;
  setTitle(`${p.reaction_pt} with ${ing.ingredient_name}`);
  const reasons = concentrationReasons(p, config.alert);
  const series = trendSeries(p.trend, meta.quarters);
  const cell = (v, field) => `<td class="num" data-field="${field}" data-value="${rawValue(v)}">${fmtCount(v)}</td>`;
  const yes = (v) => (v ? 'Yes' : 'No');
  const alertHtml = reasons.length
    ? `<div class="callout warn" role="note"><p><strong>Reporting concentration.</strong>
        ${reasons
          .map((r) =>
            r.kind === 'quarter'
              ? `${fmtShare(r.share)} of these reports were first received in ${esc(r.quarter)}.`
              : `These reports list a median of ${fmtCount(r.median)} reactions each.`,
          )
          .join(' ')}
        Clusters of reports (litigation, publicity, one reporter sending many long reports) can
        produce strong disproportionality without a pharmacological cause.</p></div>`
    : '';
  const chartTitle = `Reports of ${p.reaction_pt} with ${ing.ingredient_name} per quarter`;
  const chartDesc = series
    .map((s) => `${s.quarter}: ${s.a == null ? 'fewer than 3' : s.a}`)
    .join('; ');
  main.innerHTML = `
    <p class="crumbs"><a href="#/">Search</a> <span aria-hidden="true">/</span>
      <a href="${ingredientHref(slug)}">${esc(ing.ingredient_name)}</a> <span aria-hidden="true">/</span> ${esc(p.reaction_pt)}</p>
    <h1 tabindex="-1">${esc(p.reaction_pt)} <span class="h1-sub">with ${esc(ing.ingredient_name)}</span></h1>
    ${alertHtml}
    <section aria-labelledby="t22-h">
      <h2 id="t22-h">Reports, all loaded quarters</h2>
      ${scrollTable(
        '2 by 2 table',
        `<table class="two-by-two">
          <caption>Distinct reports (cases) with and without ${esc(ing.ingredient_name)} (as primary or secondary suspect) and ${esc(p.reaction_pt)}.</caption>
          <thead><tr><td></td><th scope="col" class="num">With the reaction</th><th scope="col" class="num">Without</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody>
            <tr><th scope="row">With the ingredient</th>${cell(p.a, 'a')}${cell(p.b, 'b')}${cell(p.n_drug, 'n_drug')}</tr>
            <tr><th scope="row">Without</th>${cell(p.c, 'c')}${cell(p.d, 'd')}${cell(p.n_total - p.n_drug, 'n_without_drug')}</tr>
            <tr><th scope="row">Total</th>${cell(p.n_reac, 'n_reac')}${cell(p.n_total - p.n_reac, 'n_without_reac')}${cell(p.n_total, 'n_total')}</tr>
          </tbody>
        </table>`,
      )}
      <p class="help">Cells: a = ${fmtCount(p.a)}, b = ${fmtCount(p.b)}, c = ${fmtCount(p.c)}, d = ${fmtCount(p.d)}.</p>
    </section>
    <section aria-labelledby="dp-h">
      <h2 id="dp-h">Disproportionality</h2>
      ${scrollTable(
        'Disproportionality measures',
        `<table class="measures">
          <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Value</th><th scope="col" class="num">95% CI lower</th><th scope="col" class="num">95% CI upper</th></tr></thead>
          <tbody>
            <tr><th scope="row">PRR</th>${num(p.prr, fmtRatio(p.prr), 'prr')}${num(p.prr_lcl, fmtRatio(p.prr_lcl), 'prr_lcl')}${num(p.prr_ucl, fmtRatio(p.prr_ucl), 'prr_ucl')}</tr>
            <tr><th scope="row">ROR</th>${num(p.ror, fmtRatio(p.ror), 'ror')}${num(p.ror_lcl, fmtRatio(p.ror_lcl), 'ror_lcl')}${num(p.ror_ucl, fmtRatio(p.ror_ucl), 'ror_ucl')}</tr>
            <tr><th scope="row">χ²</th>${num(p.chi2, fmtRatio(p.chi2), 'chi2')}<td></td><td></td></tr>
          </tbody>
        </table>`,
      )}
      <dl class="flags">
        <div><dt>Evans criterion (a ≥ 3, PRR ≥ 2, χ² ≥ 4)</dt><dd data-field="is_signal_evans">${yes(p.is_signal_evans)}</dd></div>
        <div><dt>ROR criterion (a ≥ 3, ROR lower bound &gt; 1)</dt><dd data-field="is_signal_ror">${yes(p.is_signal_ror)}</dd></div>
      </dl>
      <details class="formulas">
        <summary>Formulas</summary>
        <ul>
          <li>PRR = [a/(a+b)] / [c/(c+d)]; 95% CI = exp(ln PRR ± 1.96·SE), SE = √(1/a − 1/(a+b) + 1/c − 1/(c+d)).</li>
          <li>ROR = (a·d) / (b·c); 95% CI = exp(ln ROR ± 1.96·SE), SE = √(1/a + 1/b + 1/c + 1/d).</li>
          <li>χ² = N(ad − bc)² / [(a+b)(c+d)(a+c)(b+d)], Pearson, 1 degree of freedom, no continuity correction.</li>
        </ul>
      </details>
    </section>
    <section aria-labelledby="conc-h">
      <h2 id="conc-h">Where the reports come from</h2>
      <dl class="facts">
        <div><dt>Most frequent reporter country</dt><dd>${p.top_country ? `${esc(p.top_country)}, ${fmtShare(p.top_country_share)} of reports` : DASH}</dd></div>
        <div><dt>Most frequent first-receipt quarter</dt><dd>${p.top_quarter ? `${esc(p.top_quarter)}, ${fmtShare(p.top_quarter_share)} of reports` : DASH}</dd></div>
        <div><dt>Median reactions per report</dt><dd>${p.median_reactions_per_case == null ? DASH : fmtCount(p.median_reactions_per_case)}</dd></div>
      </dl>
      <p class="help">Most FAERS reports come from the United States, so a high country share is
        not unusual by itself. The pair is marked concentrated only by the quarter share
        (${fmtShare(config.alert.min_top_quarter_share)} or more) or the median number of
        reactions (${fmtCount(config.alert.min_median_reactions_per_case)} or more).</p>
    </section>
    <section aria-labelledby="trend-h">
      <h2 id="trend-h">Reports per quarter</h2>
      <p class="help">Quarter in which the FDA first received each report.${meta.last_quarter_is_provisional ? ` ${esc(meta.provisional_quarter)}* is provisional: its count grows as later files arrive.` : ''} Quarters with fewer than 3 reports show “&lt;3”. Reports received before ${esc(meta.first_quarter)} count in the totals above but not here.</p>
      <figure class="chart">${trendSvg(series, { provisionalQuarter: meta.provisional_quarter, titleId: 'trend-title', descId: 'trend-desc', title: chartTitle, desc: chartDesc })}</figure>
      ${scrollTable(
        'Reports per quarter',
        `<table class="trend-table">
          <thead><tr><th scope="col">Quarter</th><th scope="col" class="num">Reports</th><th scope="col" class="num">PRR</th></tr></thead>
          <tbody>${series
            .map(
              (s) =>
                `<tr><th scope="row">${esc(s.quarter)}${s.quarter === meta.provisional_quarter && meta.last_quarter_is_provisional ? '*' : ''}</th>${s.a == null ? '<td class="num">&lt;3</td><td class="num">—</td>' : `${num(s.a, fmtCount(s.a), 'trend_a')}${num(s.prr, fmtRatio(s.prr), 'trend_prr')}`}</tr>`,
            )
            .join('')}</tbody>
        </table>`,
      )}
    </section>`;
  announce(`${p.reaction_pt} with ${ing.ingredient_name}`);
}

// ------------------------------------------------------------------------------- quality

const METRIC_LABELS = {
  demo: 'DEMO (cases)',
  drug: 'DRUG',
  reac: 'REAC',
  outc: 'OUTC',
  indi: 'INDI',
  demo_rows: 'Case versions (DEMO rows)',
  winning_versions: 'Latest versions from this file',
  deleted_ids_listed: 'Case ids in the deletion list',
  deleted_ids_found_in_demo: 'Deleted ids found in loaded cases',
  distinct_caseids: 'Distinct case ids',
  superseded_versions_removed: 'Superseded versions removed',
  deleted_cases_removed: 'Deleted cases removed',
  cases_after_deduplication: 'Cases after deduplication',
  pct_duplicate_rows_removed: 'Superseded versions, share of rows',
  pct_demo_rows_removed_total: 'All removed, share of rows',
  pct_lines_exact: 'Exact match',
  pct_lines_normalized_layer: 'Normalized match',
  pct_lines_fallback: 'No match (fallback)',
  pct_lines_normalized: 'Mapped (exact + normalized)',
  generic_fallback_lines: 'Generic fallback lines',
  signal_role_lines: 'PS/SS drug lines',
  cases: 'Cases',
  pct_cases_reporter_country_missing: 'Reporter country missing',
  pct_cases_age_missing: 'Age missing',
  pct_cases_sex_unknown: 'Sex unknown',
  pct_cases_event_date_missing: 'Event date missing',
  pct_drug_lines_without_prod_ai: 'Drug lines without active ingredient text',
  pct_reaction_lines_without_pt: 'Reaction lines without PT',
  pct_PS: 'PS',
  pct_SS: 'SS',
  pct_C: 'C',
  pct_I: 'I',
  pct_DN: 'DN',
};

function metricTable(caption, byPeriod, metrics, periodLabel) {
  const periods = Object.keys(byPeriod).sort();
  const head = metrics.map((m) => `<th scope="col" class="num">${esc(METRIC_LABELS[m] ?? m)}</th>`).join('');
  const body = periods
    .map((pk) => {
      const cells = metrics
        .map((m) => {
          const r = byPeriod[pk][m];
          return r ? num(r.value, fmtMetric(r.value, r.unit), m) : `<td class="num">${DASH}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${esc(pk)}</th>${cells}</tr>`;
    })
    .join('');
  return scrollTable(
    caption,
    `<table class="metrics"><caption>${esc(caption)}</caption><thead><tr><th scope="col">${esc(periodLabel)}</th>${head}</tr></thead><tbody>${body}</tbody></table>`,
  );
}

function keyValueTable(caption, rows, metrics) {
  const body = metrics
    .filter((m) => rows[m])
    .map((m) => `<tr><th scope="row">${esc(METRIC_LABELS[m] ?? m)}</th>${num(rows[m].value, fmtMetric(rows[m].value, rows[m].unit), m)}</tr>`)
    .join('');
  return scrollTable(
    caption,
    `<table class="metrics kv"><caption>${esc(caption)}</caption><tbody>${body}</tbody></table>`,
  );
}

async function viewQuality() {
  setTitle('Data quality');
  main.innerHTML = '<h1 tabindex="-1">Data quality</h1><p class="loading">Loading…</p>';
  const g = groupMetrics(await getJson('json/dq_metrics.json'));
  const fq = g.file_quarter ?? {};
  const iq = g.init_quarter ?? {};
  const all = g.all ?? {};
  const allOf = (group) => all[group]?.ALL ?? {};
  main.innerHTML = `
    <h1 tabindex="-1">Data quality</h1>
    <p class="lede">Measured by the pipeline on every build (dbt model <code>mart_dq_metrics</code>).
      File quarter is the FAERS file a row came from; first-receipt quarter is when the FDA first
      received the case.</p>
    <section aria-labelledby="raw-h"><h2 id="raw-h">Raw rows per file</h2>
      ${metricTable('Rows loaded per FAERS file quarter', fq.raw_rows ?? {}, ['demo', 'drug', 'reac', 'outc', 'indi'], 'File quarter')}
    </section>
    <section aria-labelledby="dedup-h"><h2 id="dedup-h">Deduplication</h2>
      <p>A case keeps only its latest version; cases in the FDA deletion lists are removed.</p>
      ${keyValueTable('All loaded files', allOf('deduplication'), ['demo_rows', 'distinct_caseids', 'superseded_versions_removed', 'deleted_cases_removed', 'cases_after_deduplication', 'pct_duplicate_rows_removed', 'pct_demo_rows_removed_total'])}
      ${metricTable('Per FAERS file quarter', fq.deduplication ?? {}, ['demo_rows', 'winning_versions', 'deleted_ids_listed', 'deleted_ids_found_in_demo'], 'File quarter')}
    </section>
    <section aria-labelledby="rx-h"><h2 id="rx-h">RxNorm coverage of drug names</h2>
      <p>Share of primary and secondary suspect (PS/SS) drug lines by match type. Names without a
        match stay as their own ingredient (fallback).</p>
      ${metricTable('Per first-receipt quarter, and all cases', { ...iq.rxnorm_coverage, ALL: allOf('rxnorm_coverage') }, ['signal_role_lines', 'pct_lines_exact', 'pct_lines_normalized_layer', 'pct_lines_fallback', 'generic_fallback_lines'], 'Quarter')}
    </section>
    <section aria-labelledby="miss-h"><h2 id="miss-h">Missing values</h2>
      ${metricTable('Share of cases (or lines) per first-receipt quarter', { ...iq.missing_values, ALL: allOf('missing_values') }, ['cases', 'pct_cases_reporter_country_missing', 'pct_cases_age_missing', 'pct_cases_sex_unknown', 'pct_cases_event_date_missing', 'pct_drug_lines_without_prod_ai', 'pct_reaction_lines_without_pt'], 'Quarter')}
      <p class="help">Reporter country counts "COUNTRY NOT SPECIFIED" as missing.</p>
    </section>
    <section aria-labelledby="role-h"><h2 id="role-h">Drug roles per file</h2>
      <p>Share of drug lines by role: PS primary suspect, SS secondary suspect, C concomitant,
        I interacting, DN not administered. Only PS and SS count for disproportionality, so a
        change in this mix changes the universe of each quarter.</p>
      ${metricTable('Share of drug lines per FAERS file quarter', { ...fq.role_mix, ALL: allOf('role_mix') }, ['pct_PS', 'pct_SS', 'pct_C', 'pct_I', 'pct_DN'], 'File quarter')}
    </section>`;
  announce('Data quality loaded');
}

// ---------------------------------------------------------------------------- validation

async function viewValidation() {
  setTitle('Validation');
  main.innerHTML = '<h1 tabindex="-1">Validation against known pairs</h1><p class="loading">Loading…</p>';
  const rows = await getJson('json/known_signals.json');
  const pos = rows.filter((r) => r.expected === 'positive');
  const neg = rows.filter((r) => r.expected !== 'positive');
  const table = (caption, list) =>
    scrollTable(
      caption,
      `<table class="known"><caption>${esc(caption)}</caption>
        <thead><tr><th scope="col">Ingredient</th><th scope="col">Reaction (PT)</th><th scope="col" class="num">Reports</th><th scope="col" class="num">PRR</th><th scope="col" class="num">ROR lower bound</th><th scope="col" class="num">χ²</th><th scope="col">Evans</th><th scope="col">Result</th><th scope="col">Reference</th></tr></thead>
        <tbody>${list
          .map(
            (r) => `<tr>
              <th scope="row">${esc(r.ingredient_name)}</th><td>${esc(r.reaction_pt)}</td>
              ${num(r.a, fmtCount(r.a), 'a')}${num(r.prr, fmtRatio(r.prr), 'prr')}${num(r.ror_lcl, fmtRatio(r.ror_lcl), 'ror_lcl')}${num(r.chi2, fmtRatio(r.chi2), 'chi2')}
              <td>${r.is_signal_evans ? 'Yes' : 'No'}</td>
              <td>${r.passed ? '<span class="ok">As expected</span>' : `<span class="bad">Not as expected</span>${r.failure_reason ? ` (${esc(r.failure_reason)})` : ''}`}</td>
              <td>${r.reference ? esc(r.reference) : '<span class="muted">reference pending</span>'}</td>
            </tr>`,
          )
          .join('')}</tbody></table>`,
    );
  const passed = rows.filter((r) => r.passed).length;
  main.innerHTML = `
    <h1 tabindex="-1">Validation against known pairs</h1>
    <p class="lede">${passed} of ${rows.length} reference pairs behave as expected in all loaded
      reports. A sanity check of the pipeline (drug-name mapping, deduplication, counting), not a
      validation of disproportionality as a method.</p>
    <p>Positive pairs have an established association and are expected to have at least 3
      reports, PRR ≥ 2 and a ROR lower bound above 1. Negative controls were chosen for clinical
      implausibility and are expected not to meet the Evans criterion. With large counts, a small
      excess can still put a control's ROR lower bound above 1.</p>
    <section aria-labelledby="pos-h"><h2 id="pos-h">Positive pairs</h2>${table('Positive pairs', pos)}</section>
    <section aria-labelledby="neg-h"><h2 id="neg-h">Negative controls</h2>${table('Negative controls', neg)}</section>
    <p class="help">The references (label or publication) of the pairs are still to be filled in
      by the project owner.</p>`;
  announce('Validation loaded');
}

// -------------------------------------------------------------------------------- method

async function viewMethod() {
  setTitle('Method & limitations');
  main.innerHTML = '<h1 tabindex="-1">Method &amp; limitations</h1><p class="loading">Loading…</p>';
  const { html } = await import('virtual:limitations');
  main.innerHTML = `<p class="crumbs">From <code>docs/limitations.md</code> in the repository.</p><article class="prose">${html}</article>`;
  const h1 = main.querySelector('h1');
  if (h1) h1.tabIndex = -1;
  announce('Method and limitations loaded');
}

// ----------------------------------------------------------------------------- downloads

function fmtBytes(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

function viewDownloads() {
  setTitle('Downloads');
  const sections = config.parquet
    .map((f) => {
      const name = f.path.replace(/^parquet\//, '').replace(/\.parquet$/, '');
      const d = config.downloads[name] ?? { description: '', columns: {} };
      const cols = Object.entries(d.columns)
        .map(([c, text]) => `<tr><th scope="row"><code>${esc(c)}</code></th><td>${esc(text)}</td></tr>`)
        .join('');
      return `<section aria-labelledby="dl-${name}">
        <h2 id="dl-${name}"><code>${esc(name)}.parquet</code></h2>
        <p>${esc(d.description)}</p>
        <p><a href="data/${esc(f.path)}" download>Download ${esc(name)}.parquet</a> (${fmtBytes(f.bytes)}, Parquet with zstd compression)</p>
        <p class="help">sha256 <code class="hash">${esc(f.sha256)}</code></p>
        <details><summary>Columns of ${esc(name)}</summary>
          ${scrollTable(`Columns of ${name}`, `<table class="columns"><thead><tr><th scope="col">Column</th><th scope="col">Description</th></tr></thead><tbody>${cols}</tbody></table>`)}
        </details>
      </section>`;
    })
    .join('');
  main.innerHTML = `
    <h1 tabindex="-1">Downloads</h1>
    <p class="lede">The tables behind this site, as open data. Exported ${esc(meta.export_date)}
      from the build with data through ${esc(meta.last_quarter)}. The same rows are also in
      <code>data/json/</code>, one file per ingredient.</p>
    ${sections}
    <p class="help">Any Parquet reader opens these files, for example DuckDB:
      <code>select * from 'signals_top.parquet' where ingredient_name = 'atorvastatin'</code>.</p>`;
}

// -------------------------------------------------------------------------------- router

function setTitle(title) {
  document.title = `${title} · ${SITE_TITLE}`;
}

function announce(text) {
  status.textContent = text;
}

function markCurrentNav(page) {
  const target = { home: '#/', ingredient: '#/', pair: '#/' }[page] ?? `#/${page}`;
  for (const a of document.querySelectorAll('nav a')) {
    if (a.getAttribute('href') === target) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

let firstRender = true;
async function render() {
  const route = parseRoute(location.hash);
  markCurrentNav(route.page);
  try {
    if (route.page === 'home') await viewHome();
    else if (route.page === 'ingredient') await viewIngredient(route.slug);
    else if (route.page === 'pair') await viewPair(route.slug, route.reactionKey);
    else if (route.page === 'quality') await viewQuality();
    else if (route.page === 'validation') await viewValidation();
    else if (route.page === 'method') await viewMethod();
    else if (route.page === 'downloads') viewDownloads();
    else notFound('There is no page at this address.');
  } catch (e) {
    console.error(e);
    setTitle('Error');
    main.innerHTML = `<h1 tabindex="-1">Could not load the data</h1><p>${esc(e.message)}</p><p><a href="#/">Back to the search</a></p>`;
  }
  if (!firstRender) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  }
  firstRender = false;
}

window.addEventListener('hashchange', render);
// The skip link targets #main, which would otherwise be read as a route.
document.querySelector('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});
render();
