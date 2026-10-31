var e={schema_version:2,export_date:`2026-10-31`,first_quarter:`2024Q3`,last_quarter:`2026Q2`,provisional_quarter:`2026Q2`,last_quarter_is_provisional:!0,quarters:[`2024Q3`,`2024Q4`,`2025Q1`,`2025Q2`,`2025Q3`,`2025Q4`,`2026Q1`,`2026Q2`],n_cases_all:2858073,n_cases_in_window:2638448,rxnorm_versions:[`05-Oct-2026`],rxnav_attribution:`This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.`,n_ingredients:3229,n_pairs:61618,formats:[`parquet`,`json`]},t={site:{title:`FAERS disproportionality explorer`,repo_url:`https://github.com/YagoCalomino/faers-pipeline`,fda_source_name:`FDA Adverse Event Reporting System (FAERS), now the FDA Adverse Event Monitoring System (AEMS)`,meddra_notice:`Reaction terms are MedDRA® Preferred Terms as reported in FDA FAERS. MedDRA® is a registered trademark of the International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use (ICH). This project does not distribute the MedDRA dictionary and does not offer a downloadable dataset of MedDRA terms. Reaction terms (Preferred Terms) are shown on the site pages as they appear in FAERS.`,pairs_page_size:30},alert:{min_top_quarter_share:.8,min_cases_for_quarter_rule:10,min_median_reactions_per_case:40,min_top_country_share:.9,min_cases_for_country_rule:10},downloads:{ingredients:{description:`One row per ingredient shown on the site (generic fallbacks left out).`,columns:{ingredient_key:`Surrogate key of the ingredient (dim_ingredient).`,ingredient_id:`RxNorm ingredient RxCUI, or FB:<text> for a name without an RxNorm match.`,ingredient_name:`Ingredient name (RxNorm), or the cleaned FAERS text for a fallback.`,slug:`URL-safe name used in the site's links (#/ingredient/<slug>).`,match_type:`Best RxNorm match observed for the ingredient: exact, normalized or fallback.`,is_fallback:`True when the ingredient has no RxNorm match.`,is_generic_fallback:`True for a class of products (HERBALS, VITAMINS, ...).`,n_cases_ps_ss:`Distinct cases with the ingredient as primary or secondary suspect.`,n_pairs:`Number of pairs of the ingredient shown on the site.`}},dq_metrics:{description:`Data-quality metrics of the pipeline (raw rows, deduplication, missing values, RxNorm coverage, drug role mix).`,columns:{period_basis:`all, file_quarter (quarter of the FAERS file) or init_quarter (first receipt by FDA).`,period_key:`Quarter (YYYYQn) or ALL.`,metric_group:`raw_rows, deduplication, missing_values, rxnorm_coverage or role_mix.`,metric:`Metric name.`,value:`Metric value.`,unit:`rows, cases, lines or pct.`}}},fdaUrl:`https://www.fda.gov/drugs/fda-adverse-event-monitoring-system-aems/fda-adverse-event-monitoring-system-aems-latest-quarterly-data-files`,parquet:[{path:`parquet/dq_metrics.parquet`,bytes:3929,sha256:`cd42244fa14dc75b4b700f6b1e90e6fe307c69460eacf3f2322be3853ede09a0`},{path:`parquet/ingredients.parquet`,bytes:133748,sha256:`eaa3e6a03ea6affd75cd6c6969867eedc996b4014e2658cc3437d41651f23f7f`}]},n=640,r=220,i={top:16,right:12,bottom:40,left:48},a=e=>String(e).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]);function o(e){if(e<=5)return 5;let t=10**Math.floor(Math.log10(e));for(let n of[1,2,2.5,5,10])if(n*t>=e)return n*t;return 10*t}function s(e,{provisionalQuarter:t,titleId:s,descId:c,title:l,desc:u}){let d=o(Math.max(3,...e.map(e=>e.a??0))),f=n-i.left-i.right,p=r-i.top-i.bottom,m=f/Math.max(e.length,1),h=Math.min(48,m*.7),g=e=>i.top+p-e/d*p,_=[0,d/2,d],v=[];v.push(`<svg class="trend" viewBox="0 0 ${n} ${r}" role="img" aria-labelledby="${s} ${c}" preserveAspectRatio="xMidYMid meet">`,`<title id="${s}">${a(l)}</title><desc id="${c}">${a(u)}</desc>`,`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="bar-provisional-bg"/><line x1="0" y1="0" x2="0" y2="6" class="bar-provisional-line"/></pattern></defs>`);for(let e of _)v.push(`<line class="grid" x1="${i.left}" x2="${n-i.right}" y1="${g(e)}" y2="${g(e)}"/>`,`<text class="tick" x="${i.left-6}" y="${g(e)+4}" text-anchor="end">${e}</text>`);return e.forEach((e,n)=>{let o=i.left+m*n+m/2,s=e.quarter===t;if(e.a==null)v.push(`<text class="none" x="${o}" y="${g(0)-6}" text-anchor="middle">&lt;3</text>`);else{let t=g(e.a);v.push(`<rect class="${s?`bar provisional`:`bar`}" x="${o-h/2}" y="${t}" width="${h}" height="${g(0)-t}"${s?` fill="url(#hatch)"`:``}/>`,`<text class="value" x="${o}" y="${t-4}" text-anchor="middle">${e.a}</text>`)}v.push(`<text class="tick" x="${o}" y="${r-i.bottom+16}" text-anchor="middle">${a(e.quarter)}${s?`*`:``}</text>`)}),v.push(`<text class="axis" x="12" y="${i.top+p/2}" transform="rotate(-90 12 ${i.top+p/2})" text-anchor="middle">Cases</text>`,`</svg>`),v.join(``)}var c=new Intl.NumberFormat(`en-US`,{maximumFractionDigits:0}),l=new Intl.NumberFormat(`en-US`,{maximumSignificantDigits:3}),u=new Intl.NumberFormat(`en-US`,{maximumFractionDigits:0}),d=new Intl.NumberFormat(`en-US`,{style:`percent`,maximumFractionDigits:0}),f=new Intl.NumberFormat(`en-US`,{minimumSignificantDigits:2,maximumSignificantDigits:2}),p=new Intl.NumberFormat(`en-US`,{minimumFractionDigits:1,maximumFractionDigits:1}),m=e=>e==null||Number.isNaN(e);function h(e){return m(e)?`—`:c.format(e)}function g(e){return m(e)?`—`:Math.abs(e)>=1e3?u.format(e):l.format(e)}function _(e,t){return m(e)||m(t)?`—`:`${g(e)} to ${g(t)}`}function v(e){return m(e)?`—`:d.format(e)}function y(e){return!m(e)&&e>0&&e<.005?`<1%`:v(e)}var b;function x(e){if(m(e)||e===``)return`—`;try{b??=new Intl.DisplayNames([`en`],{type:`region`,fallback:`none`});let t=b.of(String(e).toUpperCase());return t?`${t} (${e})`:String(e)}catch{return String(e)}}function S(e){return m(e)?`—`:`${Math.abs(e)>=10?p.format(e):f.format(e)}%`}function C(e,t){return t===`pct`?S(e):h(e)}function w(e){return m(e)?``:String(e)}function T(e,t){let n=[];return e.top_quarter_share!=null&&e.a>=t.min_cases_for_quarter_rule&&e.top_quarter_share>=t.min_top_quarter_share&&n.push({kind:`quarter`,quarter:e.top_quarter,share:e.top_quarter_share}),e.median_reactions_per_case!=null&&e.median_reactions_per_case>=t.min_median_reactions_per_case&&n.push({kind:`long_reports`,median:e.median_reactions_per_case}),e.top_country!=null&&e.ingredient_top_country!=null&&e.a>=t.min_cases_for_country_rule&&e.top_country_share>=t.min_top_country_share&&e.top_country!==e.ingredient_top_country&&n.push({kind:`country`,country:e.top_country,share:e.top_country_share,ingredientShare:e.ingredient_country_share,ingredientTopCountry:e.ingredient_top_country,ingredientTopShare:e.ingredient_top_country_share}),n}var E={ror_lcl:{label:`ROR lower bound`,field:`ror_lcl`},prr:{label:`PRR`,field:`prr`},a:{label:`Cases`,field:`a`}};function ee(e,t,n=`desc`){let r=E[t]?.field??t,i=n===`asc`?1:-1;return[...e].sort((e,t)=>{let n=e[r],a=t[r];return n==null&&a!=null?1:a==null&&n!=null?-1:n!=null&&a!=null&&n!==a?i*(n-a):e.reaction_pt.localeCompare(t.reaction_pt,`en`)||e.reaction_key.localeCompare(t.reaction_key)})}function D(e,t,n=10){let r=t.trim().toLowerCase();if(!r)return[];let i=[],a=[];for(let t of e){let e=t.name.toLowerCase();if(e.startsWith(r)?i.push(t):e.includes(r)&&a.push(t),i.length>=n)break}return[...i,...a].slice(0,n)}function O(e){let t=Object.fromEntries(e.columns.map((e,t)=>[e,t]));return e.rows.map(e=>({name:e[t.ingredient_name],slug:e[t.slug],cases:e[t.n_cases_ps_ss],pairs:e[t.n_pairs],fallback:e[t.is_fallback]}))}var k=/^[a-z0-9-]+$/,A=/^[a-f0-9]{32}$/;function j(e){let t=(e||``).replace(/^#\/?/,``).split(`/`).filter(Boolean).map(decodeURIComponent);if(t.length===0)return{page:`home`};let[n,r,i]=t;if(n===`ingredient`&&r&&k.test(r)){if(i===void 0)return{page:`ingredient`,slug:r};if(A.test(i)&&t.length===3)return{page:`pair`,slug:r,reactionKey:i}}return[`quality`,`validation`,`method`,`downloads`].includes(n)&&t.length===1?{page:n}:{page:`not_found`}}var M=e=>`#/ingredient/${e}`,te=(e,t)=>`#/ingredient/${e}/${t}`;function ne(e,t){let n=new Map((e||[]).map(e=>[e.period_key,e]));return t.map(e=>{let t=n.get(e);return{quarter:e,a:t?t.a:null,prr:t?t.prr:null}})}function re(e){let t={};for(let n of e){let e=(t[n.period_basis]??={})[n.metric_group]??={};(e[n.period_key]??={})[n.metric]=n}return t}var ie=(function(){let e=typeof document<`u`&&document.createElement(`link`).relList;return e&&e.supports&&e.supports(`modulepreload`)?`modulepreload`:`preload`})(),ae=function(e,t){return new URL(e,t).href},oe={},se=function(e){return e.pathname.endsWith(`.css`)},ce=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},le=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=ae(t,n);let r=s(t),i=se(r);return ce(oe,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:ie,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},N=document.getElementById(`main`),ue=document.getElementById(`status`),de=t.site.title,P=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]),F=(e,t,n)=>`<td class="num" data-field="${n}" data-value="${w(e)}">${t}</td>`,I=new Map;function L(e){return I.has(e)||(I.set(e,fetch(`data/${e}`).then(t=>{if(!t.ok)throw Object.assign(Error(`${e}: HTTP ${t.status}`),{status:t.status});return t.json()})),I.get(e).catch(()=>I.delete(e))),I.get(e)}var R;async function z(){return R??=L(`json/search.json`).then(O),R}function B(e,t){return`<div class="table-scroll" role="region" aria-label="${P(e)}" tabindex="0">${t}</div>`}function V(e){return e.kind===`quarter`?`${v(e.share)} of cases in ${P(e.quarter)}`:e.kind===`country`?`${v(e.share)} of cases from ${P(x(e.country))}; ingredient: ${y(e.ingredientShare)} ${P(e.country)}`:`median ${h(e.median)} reactions per report`}function H(e){return e.kind===`quarter`?`${v(e.share)} of these cases were first received in ${P(e.quarter)}.`:e.kind===`country`?`${v(e.share)} of these cases come from ${P(x(e.country))}, against ${y(e.ingredientShare)} of all cases of the ingredient (its most frequent country is ${P(x(e.ingredientTopCountry))}, ${v(e.ingredientTopShare)}).`:`The reports of these cases list a median of ${h(e.median)} reactions each.`}function fe(e){return e.length?`<span class="alert-badge"><span aria-hidden="true">⚠</span> ${e.map(V).join(`; `)}</span>`:``}async function pe(){X(`Search`),N.innerHTML=`
    <h1 tabindex="-1">Find an ingredient</h1>
    <p class="lede">Reports to the FDA Adverse Event Reporting System (FAERS) from
      ${P(e.first_quarter)} to ${P(e.last_quarter)}, deduplicated to
      ${h(e.n_cases_all)} cases. For each ingredient, the reactions reported
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
      <h2 id="top-h">Ingredients with the most cases</h2>
      <p class="help" id="top-help">Reporting volume, not risk: counts depend on market size and on
        manufacturer and support-program reporting.</p>
      <ol class="top-list" id="top-list"><li class="loading">Loading…</li></ol>
    </section>
    <section aria-labelledby="about-h">
      <h2 id="about-h">What this is</h2>
      <p>An open data pipeline (Airflow, DuckDB, dbt) downloads the FDA quarterly files,
        removes superseded case versions and deleted cases, maps drug names to RxNorm
        ingredients and counts cases for every ingredient and reaction (MedDRA preferred
        term). Each ingredient page lists up to 30 reactions: the 20 with the highest lower
        bound of the reporting odds ratio and the 10 with the most cases among pairs that
        meet the Evans criterion. ${h(e.n_ingredients)} ingredients and
        ${h(e.n_pairs)} pairs are included.</p>
      <p>A pair is marked <strong>concentrated</strong> when most of its cases come from one
        quarter or from one country unusual for the ingredient, or when their reports list very many
        reactions: patterns of reporting clusters rather than of the drug. The rule is on the
        <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>`;let t=await z();document.getElementById(`top-list`).innerHTML=t.slice(0,12).map(e=>`<li><a href="${M(e.slug)}">${P(e.name)}</a> <span class="muted">${h(e.cases)} cases</span></li>`).join(``),me(t),Z(`Ingredient list loaded`)}function me(e){let t=document.getElementById(`q`),n=document.getElementById(`q-list`),r=[],i=-1,a=()=>{n.hidden=!0,t.setAttribute(`aria-expanded`,`false`),t.removeAttribute(`aria-activedescendant`),i=-1},o=e=>{i=e,[...n.children].forEach((t,n)=>t.setAttribute(`aria-selected`,String(n===e))),e>=0?t.setAttribute(`aria-activedescendant`,`q-opt-${e}`):t.removeAttribute(`aria-activedescendant`)},s=e=>{r[e]&&(location.hash=M(r[e].slug))};t.addEventListener(`input`,()=>{r=D(e,t.value,10),r.length?(n.innerHTML=r.map((e,t)=>`<li id="q-opt-${t}" role="option" aria-selected="false" data-i="${t}">${P(e.name)} <span class="muted">${h(e.cases)} cases${e.fallback?`, name without RxNorm match`:``}</span></li>`).join(``),n.hidden=!1,t.setAttribute(`aria-expanded`,`true`),o(-1),Z(`${r.length} suggestions`)):(n.innerHTML=t.value.trim()?`<li class="empty" role="option" aria-disabled="true">No ingredient found</li>`:``,n.hidden=!t.value.trim(),t.setAttribute(`aria-expanded`,String(!n.hidden)),Z(t.value.trim()?`No ingredient found`:``))}),t.addEventListener(`keydown`,e=>{e.key===`ArrowDown`&&r.length?(e.preventDefault(),o(Math.min(i+1,r.length-1))):e.key===`ArrowUp`&&r.length?(e.preventDefault(),o(Math.max(i-1,0))):e.key===`Enter`?(e.preventDefault(),s(i>=0?i:0)):e.key===`Escape`&&a()}),n.addEventListener(`mousedown`,e=>e.preventDefault()),n.addEventListener(`click`,e=>{let t=e.target.closest(`[data-i]`);t&&s(+t.dataset.i)}),t.addEventListener(`blur`,a)}async function U(e){try{return await L(`json/signals/${e}.json`)}catch(e){if(e.status===404)return null;throw e}}function W(e){X(`Not found`),N.innerHTML=`<h1 tabindex="-1">Not found</h1><p>${P(e)}</p><p><a href="#/">Back to the search</a></p>`}function he(e){return e.is_fallback?`This name has no match in RxNorm, so it is shown as reported. Cases of the same drug under its RxNorm name are counted separately.`:`RxNorm ingredient ${P(e.ingredient_id)} (${P(e.match_type)} match).`}var G={key:`ror_lcl`,dir:`desc`,all:!1};async function ge(e){let t=await U(e);if(!t)return W(`No ingredient "${e}" in this export.`);let n=t.ingredient;X(n.ingredient_name),N.innerHTML=`
    <p class="crumbs"><a href="#/">Search</a> <span aria-hidden="true">/</span> ${P(n.ingredient_name)}</p>
    <h1 tabindex="-1">${P(n.ingredient_name)}</h1>
    <p class="lede">${h(n.n_cases_ps_ss)} cases name ${P(n.ingredient_name)} as primary
      or secondary suspect. ${he(n)}</p>
    <p>Reactions with the highest disproportionality across all loaded cases. Open a reaction
      for its 2×2 table, intervals and quarterly trend.</p>
    <div id="pairs"></div>`,K(t),Z(`${t.pairs.length} reactions for ${n.ingredient_name}`)}function K(e){let{key:n,dir:r}=G,i=ee(e.pairs,n,r),a=t.site.pairs_page_size,o=G.all?i:i.slice(0,a),s=e.ingredient.slug,c=(e,t)=>{let i=e===n;return`<th scope="col" class="num" aria-sort="${i?r===`desc`?`descending`:`ascending`:`none`}"><button type="button" class="sort" data-sort="${e}">${t} <span aria-hidden="true">${i?r===`desc`?`▼`:`▲`:`↕`}</span></button></th>`},l=o.map(e=>{let n=T(e,t.alert),r=[e.is_signal_evans?`Evans`:``,e.is_signal_ror?`ROR`:``].filter(Boolean).join(`, `)||`—`;return`<tr data-reaction-key="${e.reaction_key}">
        <th scope="row"><a href="${te(s,e.reaction_key)}">${P(e.reaction_pt)}</a></th>
        ${F(e.a,h(e.a),`a`)}
        ${F(e.prr,g(e.prr),`prr`)}
        <td class="num ci" data-field="prr_ci" data-lcl="${w(e.prr_lcl)}" data-ucl="${w(e.prr_ucl)}">${_(e.prr_lcl,e.prr_ucl)}</td>
        ${F(e.ror,g(e.ror),`ror`)}
        <td class="num ci" data-field="ror_ci" data-lcl="${w(e.ror_lcl)}" data-ucl="${w(e.ror_ucl)}">${_(e.ror_lcl,e.ror_ucl)}</td>
        <td>${r}</td>
        <td>${fe(n)}</td>
      </tr>`}).join(``),u=e.pairs.filter(e=>T(e,t.alert).length).length,d=i.length>a?`<p><button type="button" class="link-button" id="show-all">${G.all?`Show the first ${a}`:`Show all ${i.length} reactions`}</button></p>`:``;document.getElementById(`pairs`).innerHTML=`
    <p class="help" id="alert-legend"><strong>Concentration alert:</strong> most of the pair's cases
      come from one quarter or from one country unusual for the ingredient, or their reports list
      very many reactions, which points to a reporting pattern rather than to the drug.</p>
    <p class="table-summary" id="pairs-summary">${i.length} reactions, sorted by ${E[n].label} (${r===`desc`?`highest first`:`lowest first`}).
      ${u?`${u} marked concentrated.`:``}</p>
    ${B(`Reactions`,`<table class="pairs" aria-describedby="pairs-summary">
        <caption class="sr-only">Reactions reported with ${P(e.ingredient.ingredient_name)}</caption>
        <thead><tr>
          <th scope="col">Reaction (MedDRA PT)</th>
          ${c(`a`,`Cases`)}
          ${c(`prr`,`PRR`)}
          <th scope="col" class="num">PRR 95% CI</th>
          <th scope="col" class="num">ROR</th>
          ${c(`ror_lcl`,`ROR 95% CI`)}
          <th scope="col">Criteria met</th>
          <th scope="col">Concentration alert</th>
        </tr></thead>
        <tbody>${l}</tbody>
      </table>`)}
    ${d}
    <p class="help">Sorting by ROR 95% CI uses its lower bound. Criteria: Evans (at least 3
      cases, PRR ≥ 2, χ² ≥ 4); ROR (at least 3 cases, lower bound above 1). Meeting a
      criterion flags a pair for review; it does not confirm an effect of the drug.</p>`;for(let t of document.querySelectorAll(`button.sort`))t.addEventListener(`click`,()=>{let n=t.dataset.sort;G.dir=G.key===n&&G.dir===`desc`?`asc`:`desc`,G.key=n,K(e),document.querySelector(`button.sort[data-sort="${n}"]`).focus(),Z(`Sorted by ${E[n].label}, ${G.dir===`desc`?`highest`:`lowest`} first`)});document.getElementById(`show-all`)?.addEventListener(`click`,()=>{G.all=!G.all,K(e),document.getElementById(`show-all`)?.focus()})}async function _e(n,r){let i=await U(n),a=i?.pairs.find(e=>e.reaction_key===r);if(!i||!a)return W(`This ingredient and reaction pair is not in this export.`);let o=i.ingredient;X(`${a.reaction_pt} with ${o.ingredient_name}`);let c=T(a,t.alert),l=ne(a.trend,e.quarters),u=(e,t)=>`<td class="num" data-field="${t}" data-value="${w(e)}">${h(e)}</td>`,d=e=>e?`Yes`:`No`,f=c.length?`<div class="callout warn" role="note"><p><strong>Reporting concentration.</strong>
        ${c.map(H).join(` `)}
        Clusters of reports (litigation, publicity, one reporter sending many long reports) can
        produce strong disproportionality without a pharmacological cause.</p></div>`:``,p=`Cases of ${a.reaction_pt} with ${o.ingredient_name} per quarter`,m=l.map(e=>`${e.quarter}: ${e.a==null?`fewer than 3`:e.a}`).join(`; `);N.innerHTML=`
    <p class="crumbs"><a href="#/">Search</a> <span aria-hidden="true">/</span>
      <a href="${M(n)}">${P(o.ingredient_name)}</a> <span aria-hidden="true">/</span> ${P(a.reaction_pt)}</p>
    <h1 tabindex="-1">${P(a.reaction_pt)} <span class="h1-sub">with ${P(o.ingredient_name)}</span></h1>
    ${f}
    <section aria-labelledby="t22-h">
      <h2 id="t22-h">Cases, all loaded quarters</h2>
      ${B(`2 by 2 table`,`<table class="two-by-two">
          <caption>Distinct cases with and without ${P(o.ingredient_name)} (as primary or secondary suspect) and ${P(a.reaction_pt)}.</caption>
          <thead><tr><td></td><th scope="col" class="num">With the reaction</th><th scope="col" class="num">Without</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody>
            <tr><th scope="row">With the ingredient</th>${u(a.a,`a`)}${u(a.b,`b`)}${u(a.n_drug,`n_drug`)}</tr>
            <tr><th scope="row">Without</th>${u(a.c,`c`)}${u(a.d,`d`)}${u(a.n_total-a.n_drug,`n_without_drug`)}</tr>
            <tr><th scope="row">Total</th>${u(a.n_reac,`n_reac`)}${u(a.n_total-a.n_reac,`n_without_reac`)}${u(a.n_total,`n_total`)}</tr>
          </tbody>
        </table>`)}
      <p class="help">Cells: a = ${h(a.a)}, b = ${h(a.b)}, c = ${h(a.c)}, d = ${h(a.d)}.</p>
    </section>
    <section aria-labelledby="dp-h">
      <h2 id="dp-h">Disproportionality</h2>
      ${B(`Disproportionality measures`,`<table class="measures">
          <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Value</th><th scope="col" class="num">95% CI lower</th><th scope="col" class="num">95% CI upper</th></tr></thead>
          <tbody>
            <tr><th scope="row">PRR</th>${F(a.prr,g(a.prr),`prr`)}${F(a.prr_lcl,g(a.prr_lcl),`prr_lcl`)}${F(a.prr_ucl,g(a.prr_ucl),`prr_ucl`)}</tr>
            <tr><th scope="row">ROR</th>${F(a.ror,g(a.ror),`ror`)}${F(a.ror_lcl,g(a.ror_lcl),`ror_lcl`)}${F(a.ror_ucl,g(a.ror_ucl),`ror_ucl`)}</tr>
            <tr><th scope="row">χ²</th>${F(a.chi2,g(a.chi2),`chi2`)}<td></td><td></td></tr>
          </tbody>
        </table>`)}
      <dl class="flags">
        <div><dt>Evans criterion (a ≥ 3, PRR ≥ 2, χ² ≥ 4)</dt><dd data-field="is_signal_evans">${d(a.is_signal_evans)}</dd></div>
        <div><dt>ROR criterion (a ≥ 3, ROR lower bound &gt; 1)</dt><dd data-field="is_signal_ror">${d(a.is_signal_ror)}</dd></div>
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
        <div><dt>Most frequent reporter country</dt><dd>${a.top_country?`${P(a.top_country)}, ${v(a.top_country_share)} of cases`:`—`}</dd></div>
        <div><dt>Same country, all cases of the ingredient</dt><dd>${a.top_country?`${y(a.ingredient_country_share)} ${P(a.top_country)}`:`—`}</dd></div>
        <div><dt>Ingredient's most frequent country</dt><dd>${a.ingredient_top_country?`${P(a.ingredient_top_country)}, ${v(a.ingredient_top_country_share)} of its cases`:`—`}</dd></div>
        <div><dt>Most frequent first-receipt quarter</dt><dd>${a.top_quarter?`${P(a.top_quarter)}, ${v(a.top_quarter_share)} of cases`:`—`}</dd></div>
        <div><dt>Median reactions per report</dt><dd>${a.median_reactions_per_case==null?`—`:h(a.median_reactions_per_case)}</dd></div>
      </dl>
      <p class="help">Most FAERS reports come from the United States, so a high country share is
        not unusual by itself. The rule that marks a pair as concentrated is on the
        <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>
    <section aria-labelledby="trend-h">
      <h2 id="trend-h">Cases per quarter</h2>
      <p class="help">Quarter in which the FDA first received each case.${e.last_quarter_is_provisional?` ${P(e.provisional_quarter)}* is provisional: its count grows as later files arrive.`:``} Quarters with fewer than 3 cases show "&lt;3". Cases first received before ${P(e.first_quarter)} count in the totals above but not here. The PS/SS share changes by quarter (see the <a href="#/quality">Quality</a> page).</p>
      <figure class="chart">${s(l,{provisionalQuarter:e.provisional_quarter,titleId:`trend-title`,descId:`trend-desc`,title:p,desc:m})}</figure>
      ${B(`Cases per quarter`,`<table class="trend-table">
          <thead><tr><th scope="col">Quarter</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th></tr></thead>
          <tbody>${l.map(t=>`<tr><th scope="row">${P(t.quarter)}${t.quarter===e.provisional_quarter&&e.last_quarter_is_provisional?`*`:``}</th>${t.a==null?`<td class="num">&lt;3</td><td class="num">—</td>`:`${F(t.a,h(t.a),`trend_a`)}${F(t.prr,g(t.prr),`trend_prr`)}`}</tr>`).join(``)}</tbody>
        </table>`)}
    </section>`,Z(`${a.reaction_pt} with ${o.ingredient_name}`)}var q={demo:`DEMO (case versions)`,drug:`DRUG`,reac:`REAC`,outc:`OUTC`,indi:`INDI`,demo_rows:`Case versions (DEMO rows)`,winning_versions:`Latest versions from this file`,deleted_ids_listed:`Case ids in the deletion list`,deleted_ids_found_in_demo:`Deleted ids found in loaded cases`,distinct_caseids:`Distinct case ids`,superseded_versions_removed:`Superseded versions removed`,deleted_cases_removed:`Deleted cases removed`,cases_after_deduplication:`Cases after deduplication`,pct_duplicate_rows_removed:`Superseded versions, share of rows`,pct_demo_rows_removed_total:`All removed, share of rows`,pct_lines_exact:`Exact match`,pct_lines_normalized_layer:`Normalized match`,pct_lines_fallback:`No match (fallback)`,pct_lines_normalized:`Mapped (exact + normalized)`,generic_fallback_lines:`Generic fallback lines`,signal_role_lines:`PS/SS drug lines`,cases:`Cases`,pct_cases_reporter_country_missing:`Reporter country missing`,pct_cases_age_missing:`Age missing`,pct_cases_sex_unknown:`Sex unknown`,pct_cases_event_date_missing:`Event date missing`,pct_drug_lines_without_prod_ai:`Drug lines without active ingredient text`,pct_reaction_lines_without_pt:`Reaction lines without PT`,pct_PS:`PS`,pct_SS:`SS`,pct_C:`C`,pct_I:`I`,pct_DN:`DN`};function J(e,t,n,r){let i=Object.keys(t).sort(),a=n.map(e=>`<th scope="col" class="num">${P(q[e]??e)}</th>`).join(``),o=i.map(e=>{let r=n.map(n=>{let r=t[e][n];return r?F(r.value,C(r.value,r.unit),n):`<td class="num">—</td>`}).join(``);return`<tr><th scope="row">${P(e)}</th>${r}</tr>`}).join(``);return B(e,`<table class="metrics"><caption>${P(e)}</caption><thead><tr><th scope="col">${P(r)}</th>${a}</tr></thead><tbody>${o}</tbody></table>`)}function ve(e,t,n){let r=n.filter(e=>t[e]).map(e=>`<tr><th scope="row">${P(q[e]??e)}</th>${F(t[e].value,C(t[e].value,t[e].unit),e)}</tr>`).join(``);return B(e,`<table class="metrics kv"><caption>${P(e)}</caption><tbody>${r}</tbody></table>`)}async function ye(){X(`Data quality`),N.innerHTML=`<h1 tabindex="-1">Data quality</h1><p class="loading">Loading…</p>`;let e=re(await L(`json/dq_metrics.json`)),t=e.file_quarter??{},n=e.init_quarter??{},r=e.all??{},i=e=>r[e]?.ALL??{};N.innerHTML=`
    <h1 tabindex="-1">Data quality</h1>
    <p class="lede">Measured by the pipeline on every build (dbt model <code>mart_dq_metrics</code>).
      File quarter is the FAERS file a row came from; first-receipt quarter is when the FDA first
      received the case.</p>
    <section aria-labelledby="raw-h"><h2 id="raw-h">Raw rows per file</h2>
      ${J(`Rows loaded per FAERS file quarter`,t.raw_rows??{},[`demo`,`drug`,`reac`,`outc`,`indi`],`File quarter`)}
    </section>
    <section aria-labelledby="dedup-h"><h2 id="dedup-h">Deduplication</h2>
      <p>A case keeps only its latest version; cases in the FDA deletion lists are removed.</p>
      ${ve(`All loaded files`,i(`deduplication`),[`demo_rows`,`distinct_caseids`,`superseded_versions_removed`,`deleted_cases_removed`,`cases_after_deduplication`,`pct_duplicate_rows_removed`,`pct_demo_rows_removed_total`])}
      ${J(`Per FAERS file quarter`,t.deduplication??{},[`demo_rows`,`winning_versions`,`deleted_ids_listed`,`deleted_ids_found_in_demo`],`File quarter`)}
      <p class="help" id="deleted-help">Deleted ids found in loaded cases: an id can appear in more
        than one deletion list, so the per-file sum can exceed the number of removed cases;
        "—" means none found.</p>
    </section>
    <section aria-labelledby="rx-h"><h2 id="rx-h">RxNorm coverage of drug names</h2>
      <p>Share of primary and secondary suspect (PS/SS) drug lines by match type. Names without a
        match stay as their own ingredient (fallback).</p>
      ${J(`Per first-receipt quarter, and all cases`,{...n.rxnorm_coverage,ALL:i(`rxnorm_coverage`)},[`signal_role_lines`,`pct_lines_exact`,`pct_lines_normalized_layer`,`pct_lines_fallback`,`generic_fallback_lines`],`Quarter`)}
    </section>
    <section aria-labelledby="miss-h"><h2 id="miss-h">Missing values</h2>
      ${J(`Share of cases (or lines) per first-receipt quarter`,{...n.missing_values,ALL:i(`missing_values`)},[`cases`,`pct_cases_reporter_country_missing`,`pct_cases_age_missing`,`pct_cases_sex_unknown`,`pct_cases_event_date_missing`,`pct_drug_lines_without_prod_ai`,`pct_reaction_lines_without_pt`],`Quarter`)}
      <p class="help">Reporter country counts "COUNTRY NOT SPECIFIED" as missing.</p>
    </section>
    <section aria-labelledby="role-h"><h2 id="role-h">Drug roles per file</h2>
      <p>Share of drug lines by role: PS primary suspect, SS secondary suspect, C concomitant,
        I interacting, DN not administered. Only PS and SS count for disproportionality, so a
        change in this mix changes the universe of each quarter.</p>
      ${J(`Share of drug lines per FAERS file quarter`,{...t.role_mix,ALL:i(`role_mix`)},[`pct_PS`,`pct_SS`,`pct_C`,`pct_I`,`pct_DN`],`File quarter`)}
    </section>`,Z(`Data quality loaded`)}var be={label_boxed_warning:`Boxed warning`,label_warning:`Warnings and precautions`,label_monitoring:`Monitoring, not a listed reaction`,label_not_listed:`Not listed in the label`};async function Y(){X(`Validation`),N.innerHTML=`<h1 tabindex="-1">Validation against known pairs</h1><p class="loading">Loading…</p>`;let e=await L(`json/known_signals.json`),t=e.filter(e=>e.expected===`positive`),n=e.filter(e=>e.expected!==`positive`),r=(e,t)=>B(e,`<table class="known"><caption class="sr-only">${P(e)}</caption>
        <thead><tr><th scope="col">Ingredient</th><th scope="col">Reaction (PT)</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th><th scope="col" class="num">ROR lower bound</th><th scope="col" class="num">χ²</th><th scope="col">Evans</th><th scope="col">Result</th><th scope="col">Reference</th></tr></thead>
        <tbody>${t.map(e=>`<tr>
              <th scope="row">${P(e.ingredient_name)}</th><td>${P(e.reaction_pt)}</td>
              ${F(e.a,h(e.a),`a`)}${F(e.prr,g(e.prr),`prr`)}${F(e.ror_lcl,g(e.ror_lcl),`ror_lcl`)}${F(e.chi2,g(e.chi2),`chi2`)}
              <td>${e.is_signal_evans?`Yes`:`No`}</td>
              <td>${e.passed?`<span class="ok">As expected</span>`:`<span class="bad">Not as expected</span>${e.failure_reason?` (${P(e.failure_reason)})`:``}`}</td>
              <td>${P(be[e.reference_status]??e.reference_status??``)}<br><span class="muted">${P(e.reference??``)}</span></td>
            </tr>`).join(``)}</tbody></table>`);N.innerHTML=`
    <h1 tabindex="-1">Validation against known pairs</h1>
    <p class="lede">${e.filter(e=>e.passed).length} of ${e.length} reference pairs behave as expected in all loaded
      cases. A sanity check of the pipeline (drug-name mapping, deduplication, counting), not a
      validation of disproportionality as a method.</p>
    <p>Positive pairs have an established association and are expected to have at least 3
      cases, PRR ≥ 2 and a ROR lower bound above 1. Negative controls were chosen for clinical
      implausibility and are expected not to meet the Evans criterion. With large counts, a small
      excess can still put a control's ROR lower bound above 1.</p>
    <section aria-labelledby="pos-h"><h2 id="pos-h">Positive pairs</h2>${r(`Positive pairs`,t)}</section>
    <section aria-labelledby="neg-h"><h2 id="neg-h">Negative controls</h2>${r(`Negative controls`,n)}</section>
    <section aria-labelledby="ref-h"><h2 id="ref-h">References</h2>
      <p>Each pair cites the FDA label behind its expected result and where the pair stands in it.</p>
      <ul>
        <li>A negative control means the reaction is not listed in the label's adverse reactions,
          not that the drug is proven not to cause it.</li>
        <li>For warfarin, an increased INR is a monitoring result that the label anticipates, not an
          adverse reaction listed in the label.</li>
        <li>The references were read in copies of the FDA labels, consulted on 2026-10-29.</li>
      </ul>
    </section>`,Z(`Validation loaded`)}async function xe(){X(`Method & limitations`),N.innerHTML=`<h1 tabindex="-1">Method &amp; limitations</h1><p class="loading">Loading…</p>`;let{html:e}=await le(async()=>{let{html:e}=await import(`./limitations-BzkYqRro.js`);return{html:e}},[],import.meta.url);N.innerHTML=`<h1 tabindex="-1">Method &amp; limitations</h1><p class="crumbs">Method and limitations of the results, from ${`<a href="${P(t.site.repo_url)}/blob/main/docs/limitations.md" rel="noopener"><code>docs/limitations.md</code></a>`}; the operational limits of the pipeline are in that file in the repository.</p><article class="prose">${e}</article>`,Z(`Method and limitations loaded`)}function Se(e){return e>=1e6?`${(e/1e6).toFixed(1)} MB`:e>=1e3?`${Math.round(e/1e3)} KB`:`${e} B`}function Ce(){X(`Downloads`);let n=t.parquet.map(e=>{let n=e.path.replace(/^parquet\//,``).replace(/\.parquet$/,``),r=t.downloads[n]??{description:``,columns:{}},i=Object.entries(r.columns).map(([e,t])=>`<tr><th scope="row"><code>${P(e)}</code></th><td>${P(t)}</td></tr>`).join(``);return`<section aria-labelledby="dl-${n}">
        <h2 id="dl-${n}"><code>${P(n)}.parquet</code></h2>
        <p>${P(r.description)}</p>
        <p><a href="data/${P(e.path)}" download>Download ${P(n)}.parquet</a> (${Se(e.bytes)}, Parquet with zstd compression)</p>
        <p class="help">sha256 <code class="hash">${P(e.sha256)}</code></p>
        <details><summary>Columns of ${P(n)}</summary>
          ${B(`Columns of ${n}`,`<table class="columns"><thead><tr><th scope="col">Column</th><th scope="col">Description</th></tr></thead><tbody>${i}</tbody></table>`)}
        </details>
      </section>`}).join(``);N.innerHTML=`
    <h1 tabindex="-1">Downloads</h1>
    <p class="lede">The ingredient list and the data-quality metrics of this site, as open
      data. Exported ${P(e.export_date)} (UTC) from the build with data through
      ${P(e.last_quarter)}. Tables with reaction terms are not offered for download:
      the terms are MedDRA terms, owned by ICH.</p>
    <p class="meddra">${P(t.site.meddra_notice)}</p>
    ${n}
    <p class="help">Any Parquet reader opens these files, for example DuckDB:
      <code>select ingredient_name, n_cases_ps_ss from 'ingredients.parquet' order by n_cases_ps_ss desc limit 10</code>.</p>`}function X(e){document.title=`${e} · ${de}`}function Z(e){ue.textContent=e}function we(e){let t={home:`#/`,ingredient:`#/`,pair:`#/`}[e]??`#/${e}`;for(let e of document.querySelectorAll(`nav a`))e.getAttribute(`href`)===t?e.setAttribute(`aria-current`,`page`):e.removeAttribute(`aria-current`)}var Q=!0;async function $(){let e=j(location.hash);we(e.page);try{e.page===`home`?await pe():e.page===`ingredient`?await ge(e.slug):e.page===`pair`?await _e(e.slug,e.reactionKey):e.page===`quality`?await ye():e.page===`validation`?await Y():e.page===`method`?await xe():e.page===`downloads`?Ce():W(`There is no page at this address.`)}catch(e){console.error(e),X(`Error`),N.innerHTML=`<h1 tabindex="-1">Could not load the data</h1><p>${P(e.message)}</p><p><a href="#/">Back to the search</a></p>`}Q||(window.scrollTo(0,0),N.querySelector(`h1`)?.focus({preventScroll:!0})),Q=!1}window.addEventListener(`hashchange`,$),document.querySelector(`.skip`).addEventListener(`click`,e=>{e.preventDefault(),N.focus()}),$();