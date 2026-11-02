// FAERS disproportionality explorer: hash-routed views over the site export (data/).
// Views: home (search), ingredient, pair, quality, validation, method, downloads.
import './style.css';
import { config, meta } from 'virtual:site-config';
import { trendSvg } from './lib/chart.js';
import {
  countryLabel,
  DASH,
  fmtCount,
  fmtInterval,
  fmtMetric,
  fmtPct,
  fmtRatio,
  fmtShare,
  fmtShareMin,
  rawValue,
} from './lib/format.js';
import {
  concentrationReasons,
  filterPairs,
  groupMetrics,
  MAG_MAX,
  MAG_TICKS,
  magnitude,
  magPos,
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

// Short text of each reason, next to the reporting-pattern badge.
function reasonShort(r) {
  if (r.kind === 'quarter') return `Mostly one quarter: ${fmtShare(r.share)} of cases in ${esc(r.quarter)}`;
  if (r.kind === 'country')
    return `Mostly one country: ${fmtShare(r.share)} of cases from ${esc(countryLabel(r.country))}; ingredient: ${fmtShareMin(r.ingredientShare)} ${esc(r.country)}`;
  return `Many reactions per report: median ${fmtCount(r.median)}`;
}

// Sentence of each reason, for the callout of the pair page.
function reasonLong(r) {
  if (r.kind === 'quarter') return `${fmtShare(r.share)} of these cases were first received in ${esc(r.quarter)}.`;
  if (r.kind === 'country')
    return `${fmtShare(r.share)} of these cases come from ${esc(countryLabel(r.country))}, against ${fmtShareMin(r.ingredientShare)} of all cases of the ingredient (its most frequent country is ${esc(countryLabel(r.ingredientTopCountry))}, ${fmtShare(r.ingredientTopShare)}).`;
  return `The reports of these cases list a median of ${fmtCount(r.median)} reactions each.`;
}

// Reporting-pattern badge: tint, dashed-circle glyph and words, so it never depends on color.
const PATTERN_GLYPH =
  '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.6"></circle></svg>';
const patternTag = () => `<span class="tag tag-pattern">${PATTERN_GLYPH}Reporting pattern</span>`;

// Badge and one-line reasons, shown in every flagged row and card.
function patternBadge(reasons) {
  if (!reasons.length) return '';
  return `<span class="pattern">${patternTag()} <span class="pattern-why">${reasons.map(reasonShort).join('; ')}</span></span>`;
}

// ---------------------------------------------------------------------------------- home

const SEARCH_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"></path></svg>';

async function viewHome() {
  setTitle('Search');
  main.innerHTML = `
    <section class="hero" aria-labelledby="home-h">
      <p class="kicker">FDA adverse-event reports · ${esc(meta.first_quarter)} to ${esc(meta.last_quarter)}</p>
      <h1 id="home-h" tabindex="-1">Which reactions are reported unusually often with a medicine?</h1>
      <p class="lede">Look up a medicine to see which reactions take up a larger share of its
        reports to the FDA than of other medicines' reports. It shows patterns in reporting, not
        proof that a medicine causes anything.</p>
      <div class="search">
        <label for="q">Search a medicine by its active ingredient (generic name)</label>
        <div class="combo">
          ${SEARCH_ICON}
          <input id="q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
            aria-controls="q-list" aria-describedby="q-help" autocomplete="off" spellcheck="false"
            placeholder="for example, atorvastatin" />
          <ul id="q-list" role="listbox" aria-label="Matching ingredients" hidden></ul>
        </div>
        <p id="q-help" class="help">Names are RxNorm ingredients; brand names are not in the
          list. Use ↑ ↓ and Enter to pick a suggestion.</p>
      </div>
      <div class="chips" id="chips" hidden><span>Try</span></div>
      <p class="stats">${fmtCount(meta.n_cases_all)} deduplicated cases ·
        ${fmtCount(meta.n_ingredients)} ingredients · ${fmtCount(meta.n_pairs)} ingredient–reaction
        pairs on this site</p>
    </section>
    <section class="band" aria-labelledby="steps-h">
      <h2 id="steps-h">How to read this site in 30 seconds</h2>
      <ol class="steps">
        <li><span class="n" aria-hidden="true">1</span><div><h3>Pick a medicine</h3>
          <p>Each page gathers the cases that name one active ingredient as a suspect.</p></div></li>
        <li><span class="n" aria-hidden="true">2</span><div><h3>Compare the share</h3>
          <p>For each reaction, see how much larger its share of this medicine's reports is than
          its share of other medicines' reports.</p></div></li>
        <li><span class="n" aria-hidden="true">3</span><div><h3>Read it as a lead</h3>
          <p>A larger share can come from who reports, when and why. It does not say how often a
          reaction happens or whether the medicine caused it.</p></div></li>
      </ol>
    </section>
    <section class="band" aria-labelledby="top-h">
      <h2 id="top-h">Browse the most-reported ingredients</h2>
      <p class="intro" id="top-help">Ranked by how many cases name them as a suspect. Reporting
        volume, not risk: counts depend on market size and on manufacturer and support-program
        reporting.</p>
      <ol class="top-list" id="top-list"><li class="loading">Loading…</li></ol>
      <p class="help">Grey bars show case counts. Numbers are cases, not people or prescriptions.</p>
    </section>
    <section class="band about" aria-labelledby="about-h">
      <h2 id="about-h">About this project</h2>
      <div>
        <p>An open data pipeline (Airflow, DuckDB, dbt) downloads the FDA quarterly files,
          removes superseded case versions and deleted cases, maps drug names to RxNorm
          ingredients and counts cases for every ingredient and reaction (MedDRA preferred
          term). Each ingredient page lists up to 30 reactions: the 20 with the highest lower
          bound of the reporting odds ratio and the 10 with the most cases among pairs that
          meet the Evans criterion.</p>
        <p>A pair is marked <strong>Reporting pattern</strong> when most of its cases come from
          one quarter or from one country unusual for the ingredient, or when their reports list
          very many reactions: patterns of how reports arrived rather than of the drug. The rule
          is on the <a href="#/method">Method &amp; limitations</a> page.</p>
      </div>
    </section>`;
  const rows = await loadSearch();
  const max = rows[0]?.cases || 1;
  document.getElementById('top-list').innerHTML = rows
    .slice(0, 12)
    .map(
      (r, i) =>
        `<li><span class="rank">${i + 1}</span><span class="name"><a href="${ingredientHref(r.slug)}">${esc(r.name)}</a><span class="vol" aria-hidden="true" style="width:${((r.cases / max) * 100).toFixed(1)}%"></span></span><span class="cases">${fmtCount(r.cases)} cases</span></li>`,
    )
    .join('');
  const known = new Set(rows.map((r) => r.slug));
  const examples = (config.site.home_examples ?? []).filter((s) => known.has(s));
  if (examples.length) {
    const chips = document.getElementById('chips');
    const names = new Map(rows.map((r) => [r.slug, r.name]));
    chips.insertAdjacentHTML('beforeend', examples.map((s) => `<a class="chip" href="${ingredientHref(s)}">${esc(names.get(s))}</a>`).join(''));
    chips.hidden = false;
  }
  setupCombobox(rows);
  announce('Ingredient list loaded');
}

// The typed text in bold inside a suggestion.
function markMatch(name, query) {
  const q = query.trim().toLowerCase();
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  if (i < 0) return esc(name);
  return `${esc(name.slice(0, i))}<strong>${esc(name.slice(i, i + q.length))}</strong>${esc(name.slice(i + q.length))}`;
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
      const none = `No ingredient matches “${esc(input.value.trim())}”. Try the generic name, for example “atorvastatin” rather than “Lipitor”.`;
      list.innerHTML = input.value.trim() ? `<li class="empty" role="option" aria-disabled="true">${none}</li>` : '';
      list.hidden = !input.value.trim();
      input.setAttribute('aria-expanded', String(!list.hidden));
      announce(input.value.trim() ? 'No ingredient found' : '');
      return;
    }
    list.innerHTML = items
      .map(
        (r, i) =>
          `<li id="q-opt-${i}" role="option" aria-selected="false" data-i="${i}"><span>${markMatch(r.name, input.value)}</span> <span class="muted">${fmtCount(r.cases)} cases${r.fallback ? ', name without RxNorm match' : ''}</span></li>`,
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
    return 'This name has no match in RxNorm, so it is shown as reported. Cases of the same drug under its RxNorm name are counted separately.';
  }
  return `RxNorm ingredient ${esc(ing.ingredient_id)} (${esc(ing.match_type)} match).`;
}

// State of the ingredient page controls. Sort and "Show all numbers" persist across
// ingredients; text, pattern filter and open Details reset on each new ingredient.
const listState = { key: 'ror_lcl', all: false, expert: false, text: '', pattern: 'all', open: new Set(), slug: null };

const INFO_ICON =
  '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"></path></svg>';
const CHEVRON =
  '<svg class="chev" width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"></path></svg>';

// "Evans, ROR", or a dash when no screening rule is met.
const criteriaText = (p) => [p.is_signal_evans ? 'Evans' : '', p.is_signal_ror ? 'ROR' : ''].filter(Boolean).join(', ') || DASH;

// Plain line of a pair: "40.6× larger share", from the PRR as the table shows it.
function shareText(prr) {
  if (prr == null || !Number.isFinite(prr)) return 'Share ratio not available';
  const shown = fmtRatio(prr);
  if (shown === '1') return 'Same share as in other medicines’ reports';
  return prr > 1 ? `${shown}× larger share` : `${shown}× the share (smaller)`;
}

// Magnitude bar (decorative: the PRR is in its own cell).
function magBar(p) {
  const m = magnitude(p);
  if (!m) return '<span class="mag mag-none" aria-hidden="true"></span>';
  const cls = ['mag', m.above ? 'mag-above' : '', m.below ? 'mag-below' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}" aria-hidden="true" style="--dot:${m.dot.toFixed(2)}%;--lo:${m.lo.toFixed(2)}%;--hi:${m.hi.toFixed(2)}%"><span class="mag-ci"></span><span class="mag-dot"></span></span>`;
}

function magScale() {
  return `<span class="mag-scale" aria-hidden="true">${MAG_TICKS.map((t) => `<span style="left:${magPos(t).pos.toFixed(2)}%">${fmtCount(t)}×</span>`).join('')}</span>`;
}

const hasPattern = (p) => concentrationReasons(p, config.alert).length > 0;

async function viewIngredient(slug) {
  const doc = await loadIngredient(slug);
  if (!doc) return notFound(`No ingredient "${slug}" in this export.`);
  const ing = doc.ingredient;
  if (listState.slug !== slug) Object.assign(listState, { text: '', pattern: 'all', open: new Set(), all: false, slug });
  setTitle(ing.ingredient_name);
  const withPattern = doc.pairs.filter(hasPattern).length;
  const total = doc.pairs.length;
  const radio = (value, label) =>
    `<label class="seg-opt"><input type="radio" name="pat" value="${value}"${listState.pattern === value ? ' checked' : ''}><span>${label}</span></label>`;
  main.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Search</a> <span aria-hidden="true">/</span> ${esc(ing.ingredient_name)}</nav>
    <section class="page-head" aria-labelledby="ing-h">
      <p class="kicker">${ing.is_fallback ? 'Ingredient · name without RxNorm match' : `Ingredient · RxNorm ${esc(ing.ingredient_id)}`}</p>
      <h1 id="ing-h" tabindex="-1">${esc(ing.ingredient_name)}</h1>
      <p class="lede"><strong>${fmtCount(ing.n_cases_ps_ss)} cases</strong> name ${esc(ing.ingredient_name)} as a
        suspect medicine (primary or secondary suspect). Below, each reaction's share of these
        reports is compared with its share of reports for other medicines.</p>
      <p class="caution">A larger share is a reason to look closer, not evidence that the medicine
        causes the reaction. ${ingredientNote(ing)} Open a reaction for its 2×2 table and quarterly
        trend.</p>
    </section>
    <div class="controls">
      <div class="control-row">
        <div class="field"><label for="flt">Filter reactions</label>
          <input id="flt" type="search" autocomplete="off" spellcheck="false" placeholder="for example, myositis" value="${esc(listState.text)}" /></div>
        <div class="field"><label for="srt">Sort by</label>
          <select id="srt">${Object.entries(SORT_KEYS)
            .map(([k, s]) => `<option value="${k}"${k === listState.key ? ' selected' : ''}>${esc(s.label)}</option>`)
            .join('')}</select></div>
        <fieldset class="seg"><legend>Reporting pattern</legend>
          ${radio('all', `All (${total})`)}${radio('with', `With pattern (${withPattern})`)}${radio('without', `Without (${total - withPattern})`)}
        </fieldset>
        <label class="check"><input type="checkbox" id="expert"${listState.expert ? ' checked' : ''}> Show all numbers</label>
      </div>
      <p class="table-summary" id="pairs-summary" aria-live="polite"></p>
      <p class="legend" id="alert-legend">${patternTag()} <span>Most of the pair's cases come from one
        quarter, or from one country unusual for this ingredient, or their reports list very many
        reactions. It describes how reports arrived, not the medicine.</span></p>
    </div>
    <div id="pairs"></div>
    <div class="list-foot">
      <p id="show-all-wrap"></p>
      <p class="help">Up to 30 reactions per ingredient: the 20 with the highest ROR lower bound,
        plus the 10 with the most cases among pairs that meet the Evans rule. Screening rules:
        Evans (at least 3 cases, PRR ≥ 2, χ² ≥ 4); ROR (at least 3 cases, lower bound of the
        ROR range above 1). Meeting a rule flags a pair for review; it does not confirm an effect
        of the drug.</p>
    </div>`;
  const rerender = () => renderPairs(doc);
  document.getElementById('flt').addEventListener('input', (e) => {
    listState.text = e.target.value;
    rerender();
  });
  document.getElementById('srt').addEventListener('change', (e) => {
    listState.key = e.target.value;
    rerender();
  });
  for (const r of document.querySelectorAll('input[name="pat"]')) {
    r.addEventListener('change', () => {
      listState.pattern = r.value;
      rerender();
    });
  }
  document.getElementById('expert').addEventListener('change', (e) => {
    listState.expert = e.target.checked;
    rerender();
  });
  rerender();
  announce(`${total} reactions for ${ing.ingredient_name}`);
}

function renderPairs(doc) {
  const slug = doc.ingredient.slug;
  const { key, expert } = listState;
  const filtered = filterPairs(doc.pairs, listState, hasPattern);
  const sorted = sortPairs(filtered, key);
  const size = config.site.pairs_page_size;
  const shown = listState.all ? sorted : sorted.slice(0, size);
  const sortName = { ror_lcl: 'most clearly larger share first (ROR lower bound)', prr: 'largest PRR first', a: 'most cases first', name: 'name, A to Z' }[key];
  document.getElementById('pairs-summary').textContent =
    `Showing ${shown.length} of ${doc.pairs.length} reactions, sorted by ${sortName}.`;
  const cols = expert ? 9 : 5;
  const rows = shown
    .map((p, i) => {
      const reasons = concentrationReasons(p, config.alert);
      const id = `det-${i}`;
      const open = listState.open.has(p.reaction_key);
      return `<tr data-reaction-key="${p.reaction_key}" class="${open ? 'is-open' : ''}">
        <th scope="row"><a href="${pairHref(slug, p.reaction_key)}"><span data-pt>${esc(p.reaction_pt)}</span></a>${patternBadge(reasons)}</th>
        ${num(p.a, fmtCount(p.a), 'a')}
        <td class="mag-cell">${magBar(p)}</td>
        ${num(p.prr, fmtRatio(p.prr), 'prr')}
        ${
          expert
            ? `<td class="num ci" data-field="prr_ci" data-lcl="${rawValue(p.prr_lcl)}" data-ucl="${rawValue(p.prr_ucl)}">${fmtInterval(p.prr_lcl, p.prr_ucl)}</td>
        ${num(p.ror, fmtRatio(p.ror), 'ror')}
        <td class="num ci" data-field="ror_ci" data-lcl="${rawValue(p.ror_lcl)}" data-ucl="${rawValue(p.ror_ucl)}">${fmtInterval(p.ror_lcl, p.ror_ucl)}</td>
        <td class="nowrap">${criteriaText(p)}</td>`
            : ''
        }
        <td class="det-cell"><button type="button" class="btn-ghost det" aria-expanded="${open}" aria-controls="${id}" data-key="${p.reaction_key}">Details<span class="sr-only"> for ${esc(p.reaction_pt)}</span>${CHEVRON}</button></td>
      </tr>
      <tr class="det-row" id="${id}"${open ? '' : ' hidden'}><td colspan="${cols}">${detailsHtml(slug, p, reasons, 'Open the 2×2 table, quarterly trend and countries')}</td></tr>`;
    })
    .join('');
  const cards = shown
    .map((p, i) => {
      const reasons = concentrationReasons(p, config.alert);
      const id = `cdet-${i}`;
      const open = listState.open.has(p.reaction_key);
      return `<li data-reaction-key="${p.reaction_key}">
        <div class="card-head"><a href="${pairHref(slug, p.reaction_key)}"><span data-pt>${esc(p.reaction_pt)}</span></a>
          <span class="card-cases"><span data-field="a" data-value="${rawValue(p.a)}">${fmtCount(p.a)}</span> cases</span></div>
        <div class="card-mag">${magBar(p)}<span class="times">${p.prr != null && Number.isFinite(p.prr) ? `${fmtRatio(p.prr)}×` : DASH}</span></div>
        <p class="card-line">${shareText(p.prr)} (PRR <span data-field="prr" data-value="${rawValue(p.prr)}">${fmtRatio(p.prr)}</span>, range ${fmtInterval(p.prr_lcl, p.prr_ucl)})</p>
        ${patternBadge(reasons)}
        <button type="button" class="btn-ghost det" aria-expanded="${open}" aria-controls="${id}" data-key="${p.reaction_key}">Details<span class="sr-only"> for ${esc(p.reaction_pt)}</span>${CHEVRON}</button>
        <div class="card-det" id="${id}"${open ? '' : ' hidden'}>${detailsHtml(slug, p, reasons, 'Open the 2×2 table and trend')}</div>
      </li>`;
    })
    .join('');
  const empty = shown.length ? '' : '<p class="empty">No reaction matches these filters.</p>';
  document.getElementById('pairs').innerHTML = `
    ${empty}
    <div class="pairs-desktop">${scrollTable(
      'Reactions',
      `<table class="pairs${expert ? ' expert' : ''}">
        <caption class="sr-only">Reactions reported with ${esc(doc.ingredient.ingredient_name)}, with how much larger their share of reports is</caption>
        <thead><tr>
          <th scope="col" class="col-pt">Reaction (MedDRA PT)</th>
          <th scope="col" class="num">Cases</th>
          <th scope="col" class="col-mag"><span class="tip-wrap">How much larger the share is (PRR)
            <button type="button" class="tip" aria-label="What is this?" aria-expanded="false" aria-controls="mag-tip">${INFO_ICON}</button>
            <span class="tip-body" id="mag-tip" role="status" hidden>The PRR (proportional reporting ratio) divides the reaction's share of this medicine's reports by its share of all other reports. Dot: best estimate. Line: plausible range (95% CI). Each step on the scale is 10 times larger; values beyond the ends are drawn at the edge with an arrow.</span></span>
            ${magScale()}</th>
          <th scope="col" class="num">PRR</th>
          ${expert ? '<th scope="col" class="num">PRR 95% CI</th><th scope="col" class="num">ROR</th><th scope="col" class="num">ROR 95% CI</th><th scope="col">Criteria met</th>' : ''}
          <th scope="col" class="det-cell"><span class="sr-only">Details</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    )}</div>
    <div class="pairs-mobile">
      <p class="mag-note" aria-hidden="true">Scale: 1× to ${fmtCount(MAG_MAX)}× larger share (PRR), log scale</p>
      <ul class="pair-cards" aria-label="Reactions reported with ${esc(doc.ingredient.ingredient_name)}">${cards}</ul>
    </div>`;
  const more = document.getElementById('show-all-wrap');
  more.innerHTML =
    sorted.length > size
      ? `<button type="button" class="btn" id="show-all">${listState.all ? `Show the first ${size}` : `Show all ${sorted.length} reactions`}</button>`
      : '';
  document.getElementById('show-all')?.addEventListener('click', () => {
    listState.all = !listState.all;
    renderPairs(doc);
    document.getElementById('show-all')?.focus();
  });
  for (const b of document.querySelectorAll('#pairs button.det')) {
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      // Table and card of the same pair share the state.
      for (const twin of document.querySelectorAll(`#pairs button.det[data-key="${b.dataset.key}"]`)) {
        twin.setAttribute('aria-expanded', String(open));
        document.getElementById(twin.getAttribute('aria-controls')).hidden = !open;
        twin.closest('tr')?.classList.toggle('is-open', open);
      }
      if (open) listState.open.add(b.dataset.key);
      else listState.open.delete(b.dataset.key);
    });
  }
  setupToggletip(document.querySelector('#pairs .tip'));
}

// Details of a pair: numbers with their ranges, rules met, the full pattern sentence, the link.
function detailsHtml(slug, p, reasons, linkText) {
  return `<dl class="det-list">
      <div><dt>How much larger the share is (PRR)</dt><dd><strong>${fmtRatio(p.prr)}</strong> · plausible range (95% CI) ${fmtInterval(p.prr_lcl, p.prr_ucl)}</dd></div>
      <div><dt>Same comparison as odds (ROR)</dt><dd><strong>${fmtRatio(p.ror)}</strong> · plausible range (95% CI) ${fmtInterval(p.ror_lcl, p.ror_ucl)}</dd></div>
      <div><dt>Screening rules met</dt><dd>${criteriaText(p)}</dd></div>
    </dl>
    ${reasons.length ? `<p class="det-pattern"><strong>Reporting pattern:</strong> ${reasons.map(reasonLong).join(' ')}</p>` : ''}
    <a href="${pairHref(slug, p.reaction_key)}">${linkText} <span aria-hidden="true">→</span></a>`;
}

// Click-toggled tips (not hover-only). One pair of document listeners closes an open tip on Esc
// (focus back on its button) or on a click outside it.
function setTip(button, open) {
  button.setAttribute('aria-expanded', String(open));
  document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
}
function setupToggletip(button) {
  button?.addEventListener('click', (e) => {
    e.stopPropagation();
    setTip(button, button.getAttribute('aria-expanded') !== 'true');
  });
}
const OPEN_TIPS = 'button.tip[aria-expanded="true"]';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const b of document.querySelectorAll(OPEN_TIPS)) {
    setTip(b, false);
    b.focus();
  }
});
document.addEventListener('click', (e) => {
  for (const b of document.querySelectorAll(OPEN_TIPS)) {
    if (!document.getElementById(b.getAttribute('aria-controls')).contains(e.target)) setTip(b, false);
  }
});

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
        ${reasons.map(reasonLong).join(' ')}
        Clusters of reports (litigation, publicity, one reporter sending many long reports) can
        produce strong disproportionality without a pharmacological cause.</p></div>`
    : '';
  const chartTitle = `Cases of ${p.reaction_pt} with ${ing.ingredient_name} per quarter`;
  const chartDesc = series
    .map((s) => `${s.quarter}: ${s.a == null ? 'fewer than 3' : s.a}`)
    .join('; ');
  main.innerHTML = `
    <p class="crumbs"><a href="#/">Search</a> <span aria-hidden="true">/</span>
      <a href="${ingredientHref(slug)}">${esc(ing.ingredient_name)}</a> <span aria-hidden="true">/</span> ${esc(p.reaction_pt)}</p>
    <h1 tabindex="-1">${esc(p.reaction_pt)} <span class="h1-sub">with ${esc(ing.ingredient_name)}</span></h1>
    ${alertHtml}
    <section aria-labelledby="t22-h">
      <h2 id="t22-h">Cases, all loaded quarters</h2>
      ${scrollTable(
        '2 by 2 table',
        `<table class="two-by-two">
          <caption>Distinct cases with and without ${esc(ing.ingredient_name)} (as primary or secondary suspect) and ${esc(p.reaction_pt)}.</caption>
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
      <h2 id="conc-h">Where the cases come from</h2>
      <dl class="facts">
        <div><dt>Most frequent reporter country</dt><dd>${p.top_country ? `${esc(p.top_country)}, ${fmtShare(p.top_country_share)} of cases` : DASH}</dd></div>
        <div><dt>Same country, all cases of the ingredient</dt><dd>${p.top_country ? `${fmtShareMin(p.ingredient_country_share)} ${esc(p.top_country)}` : DASH}</dd></div>
        <div><dt>Ingredient's most frequent country</dt><dd>${p.ingredient_top_country ? `${esc(p.ingredient_top_country)}, ${fmtShare(p.ingredient_top_country_share)} of its cases` : DASH}</dd></div>
        <div><dt>Most frequent first-receipt quarter</dt><dd>${p.top_quarter ? `${esc(p.top_quarter)}, ${fmtShare(p.top_quarter_share)} of cases` : DASH}</dd></div>
        <div><dt>Median reactions per report</dt><dd>${p.median_reactions_per_case == null ? DASH : fmtCount(p.median_reactions_per_case)}</dd></div>
      </dl>
      <p class="help">Most FAERS reports come from the United States, so a high country share is
        not unusual by itself. The rule that marks a pair as concentrated is on the
        <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>
    <section aria-labelledby="trend-h">
      <h2 id="trend-h">Cases per quarter</h2>
      <p class="help">Quarter in which the FDA first received each case.${meta.last_quarter_is_provisional ? ` ${esc(meta.provisional_quarter)}* is provisional: its count grows as later files arrive.` : ''} Quarters with fewer than 3 cases show "&lt;3". Cases first received before ${esc(meta.first_quarter)} count in the totals above but not here. The PS/SS share changes by quarter (see the <a href="#/quality">Quality</a> page).</p>
      <figure class="chart">${trendSvg(series, { provisionalQuarter: meta.provisional_quarter, titleId: 'trend-title', descId: 'trend-desc', title: chartTitle, desc: chartDesc })}</figure>
      ${scrollTable(
        'Cases per quarter',
        `<table class="trend-table">
          <thead><tr><th scope="col">Quarter</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th></tr></thead>
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
  demo: 'DEMO (case versions)',
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
      <p class="help" id="deleted-help">Deleted ids found in loaded cases: an id can appear in more
        than one deletion list, so the per-file sum can exceed the number of removed cases;
        "${DASH}" means none found.</p>
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

// Plain-language names of seed_known_signals.reference_status.
const REFERENCE_STATUS = {
  label_boxed_warning: 'Boxed warning',
  label_warning: 'Warnings and precautions',
  label_monitoring: 'Monitoring, not a listed reaction',
  label_not_listed: 'Not listed in the label',
};

async function viewValidation() {
  setTitle('Validation');
  main.innerHTML = '<h1 tabindex="-1">Validation against known pairs</h1><p class="loading">Loading…</p>';
  const rows = await getJson('json/known_signals.json');
  const pos = rows.filter((r) => r.expected === 'positive');
  const neg = rows.filter((r) => r.expected !== 'positive');
  const table = (caption, list) =>
    scrollTable(
      caption,
      `<table class="known"><caption class="sr-only">${esc(caption)}</caption>
        <thead><tr><th scope="col">Ingredient</th><th scope="col">Reaction (PT)</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th><th scope="col" class="num">ROR lower bound</th><th scope="col" class="num">χ²</th><th scope="col">Evans</th><th scope="col">Result</th><th scope="col">Reference</th></tr></thead>
        <tbody>${list
          .map(
            (r) => `<tr>
              <th scope="row">${esc(r.ingredient_name)}</th><td>${esc(r.reaction_pt)}</td>
              ${num(r.a, fmtCount(r.a), 'a')}${num(r.prr, fmtRatio(r.prr), 'prr')}${num(r.ror_lcl, fmtRatio(r.ror_lcl), 'ror_lcl')}${num(r.chi2, fmtRatio(r.chi2), 'chi2')}
              <td>${r.is_signal_evans ? 'Yes' : 'No'}</td>
              <td>${r.passed ? '<span class="ok">As expected</span>' : `<span class="bad">Not as expected</span>${r.failure_reason ? ` (${esc(r.failure_reason)})` : ''}`}</td>
              <td>${esc(REFERENCE_STATUS[r.reference_status] ?? r.reference_status ?? '')}<br><span class="muted">${esc(r.reference ?? '')}</span></td>
            </tr>`,
          )
          .join('')}</tbody></table>`,
    );
  const passed = rows.filter((r) => r.passed).length;
  main.innerHTML = `
    <h1 tabindex="-1">Validation against known pairs</h1>
    <p class="lede">${passed} of ${rows.length} reference pairs behave as expected in all loaded
      cases. A sanity check of the pipeline (drug-name mapping, deduplication, counting), not a
      validation of disproportionality as a method.</p>
    <p>Positive pairs have an established association and are expected to have at least 3
      cases, PRR ≥ 2 and a ROR lower bound above 1. Negative controls were chosen for clinical
      implausibility and are expected not to meet the Evans criterion. With large counts, a small
      excess can still put a control's ROR lower bound above 1.</p>
    <section aria-labelledby="pos-h"><h2 id="pos-h">Positive pairs</h2>${table('Positive pairs', pos)}</section>
    <section aria-labelledby="neg-h"><h2 id="neg-h">Negative controls</h2>${table('Negative controls', neg)}</section>
    <section aria-labelledby="ref-h"><h2 id="ref-h">References</h2>
      <p>Each pair cites the FDA label behind its expected result and where the pair stands in it.</p>
      <ul>
        <li>A negative control means the reaction is not listed in the label's adverse reactions,
          not that the drug is proven not to cause it.</li>
        <li>For warfarin, an increased INR is a monitoring result that the label anticipates, not an
          adverse reaction listed in the label.</li>
        <li>The references were read in copies of the FDA labels, consulted on 2026-10-29.</li>
      </ul>
    </section>`;
  announce('Validation loaded');
}

// -------------------------------------------------------------------------------- method

async function viewMethod() {
  setTitle('Method & limitations');
  main.innerHTML = '<h1 tabindex="-1">Method &amp; limitations</h1><p class="loading">Loading…</p>';
  const { html } = await import('virtual:limitations');
  const doc = `<a href="${esc(config.site.repo_url)}/blob/main/docs/limitations.md" rel="noopener"><code>docs/limitations.md</code></a>`;
  main.innerHTML = `<h1 tabindex="-1">Method &amp; limitations</h1><p class="crumbs">Method and limitations of the results, from ${doc}; the operational limits of the pipeline are in that file in the repository.</p><article class="prose">${html}</article>`;
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
    <p class="lede">The ingredient list and the data-quality metrics of this site, as open
      data. Exported ${esc(meta.export_date)} (UTC) from the build with data through
      ${esc(meta.last_quarter)}. Tables with reaction terms are not offered for download:
      the terms are MedDRA terms, owned by ICH.</p>
    <p class="meddra">${esc(config.site.meddra_notice)}</p>
    ${sections}
    <p class="help">Any Parquet reader opens these files, for example DuckDB:
      <code>select ingredient_name, n_cases_ps_ss from 'ingredients.parquet' order by n_cases_ps_ss desc limit 10</code>.</p>`;
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

// Theme switch. index.html sets data-theme before first paint; a choice made here is saved, and
// without one the page follows the system setting when it changes.
function setupTheme() {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const label = button.querySelector('.theme-label');
  const show = () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    label.textContent = next === 'dark' ? 'Dark' : 'Light';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
  };
  let saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    saved = null;
  }
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', (e) => {
    if (saved !== 'light' && saved !== 'dark') {
      root.dataset.theme = e.matches ? 'dark' : 'light';
      show();
    }
  });
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    saved = root.dataset.theme;
    try {
      localStorage.setItem('theme', saved);
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
    }
    show();
    announce(`${saved === 'dark' ? 'Dark' : 'Light'} theme`);
  });
  show();
  button.hidden = false;
}

// Menu button on narrow screens (the nav folds behind it only when JavaScript runs).
function setupMenu() {
  const button = document.getElementById('menu-toggle');
  const nav = document.getElementById('site-nav');
  const set = (open) => {
    nav.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => e.target.closest('a') && set(false));
  button.hidden = false;
}

setupTheme();
setupMenu();
window.addEventListener('hashchange', render);
// The skip link targets #main, which would otherwise be read as a route.
document.querySelector('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});
render();
