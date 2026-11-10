var e={schema_version:2,export_date:`2026-11-10`,first_quarter:`2024Q3`,last_quarter:`2026Q2`,provisional_quarter:`2026Q2`,last_quarter_is_provisional:!0,quarters:[`2024Q3`,`2024Q4`,`2025Q1`,`2025Q2`,`2025Q3`,`2025Q4`,`2026Q1`,`2026Q2`],n_cases_all:2858073,n_cases_in_window:2638448,rxnorm_versions:[`05-Oct-2026`],rxnav_attribution:`This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.`,n_ingredients:3229,n_pairs:61618,formats:[`parquet`,`json`]},t={site:{title:`FAERS disproportionality explorer`,repo_url:`https://github.com/YagoCalomino/faers-pipeline`,fda_source_name:`FDA Adverse Event Reporting System (FAERS), now the FDA Adverse Event Monitoring System (AEMS)`,meddra_notice:`Reaction terms are MedDRA® Preferred Terms as reported in FDA FAERS. MedDRA® is a registered trademark of the International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use (ICH). This project does not distribute the MedDRA dictionary and does not offer a downloadable dataset of MedDRA terms. Reaction terms (Preferred Terms) are shown on the site pages as they appear in FAERS.`,pairs_page_size:30,author:{name:`Yago Calomino`,url:`https://github.com/YagoCalomino`},home_examples:[`atorvastatin`,`semaglutide`,`adalimumab`]},alert:{min_top_quarter_share:.8,min_cases_for_quarter_rule:10,min_median_reactions_per_case:40,min_top_country_share:.9,min_cases_for_country_rule:10},downloads:{ingredients:{description:`One row per ingredient shown on the site (generic fallbacks left out).`,columns:{ingredient_key:`Surrogate key of the ingredient (dim_ingredient).`,ingredient_id:`RxNorm ingredient RxCUI, or FB:<text> for a name without an RxNorm match.`,ingredient_name:`Ingredient name (RxNorm), or the cleaned FAERS text for a fallback.`,slug:`URL-safe name used in the site's links (#/ingredient/<slug>).`,match_type:`Best RxNorm match observed for the ingredient: exact, normalized or fallback.`,is_fallback:`True when the ingredient has no RxNorm match.`,is_generic_fallback:`True for a class of products (HERBALS, VITAMINS, ...).`,n_cases_ps_ss:`Distinct cases with the ingredient as primary or secondary suspect.`,n_pairs:`Number of pairs of the ingredient shown on the site.`}},dq_metrics:{description:`Data-quality metrics of the pipeline (raw rows, deduplication, missing values, RxNorm coverage, drug role mix).`,columns:{period_basis:`all, file_quarter (quarter of the FAERS file) or init_quarter (first receipt by FDA).`,period_key:`Quarter (YYYYQn) or ALL.`,metric_group:`raw_rows, deduplication, missing_values, rxnorm_coverage or role_mix.`,metric:`Metric name.`,value:`Metric value.`,unit:`rows, cases, lines or pct.`}}},fdaUrl:`https://www.fda.gov/drugs/fda-adverse-event-monitoring-system-aems/fda-adverse-event-monitoring-system-aems-latest-quarterly-data-files`,parquet:[{path:`parquet/dq_metrics.parquet`,bytes:3929,sha256:`cd42244fa14dc75b4b700f6b1e90e6fe307c69460eacf3f2322be3853ede09a0`},{path:`parquet/ingredients.parquet`,bytes:133748,sha256:`eaa3e6a03ea6affd75cd6c6969867eedc996b4014e2658cc3437d41651f23f7f`}]},n=new Intl.NumberFormat(`en-US`,{maximumFractionDigits:0}),r=new Intl.NumberFormat(`en-US`,{maximumSignificantDigits:3}),i=new Intl.NumberFormat(`en-US`,{maximumFractionDigits:0}),a=new Intl.NumberFormat(`en-US`,{style:`percent`,maximumFractionDigits:0}),o=new Intl.NumberFormat(`en-US`,{minimumSignificantDigits:2,maximumSignificantDigits:2}),s=new Intl.NumberFormat(`en-US`,{minimumFractionDigits:1,maximumFractionDigits:1}),c=e=>e==null||Number.isNaN(e);function l(e){return c(e)?`—`:n.format(e)}function u(e){return c(e)?`—`:Math.abs(e)>=1e3?i.format(e):r.format(e)}function d(e,t){return c(e)||c(t)?`—`:`${u(e)} to ${u(t)}`}function f(e){return c(e)?`—`:a.format(e)}var p=new Intl.NumberFormat(`en-US`,{style:`percent`,minimumSignificantDigits:2,maximumSignificantDigits:2});function m(e){return c(e)?`—`:e===0?`0%`:p.format(e)}var h=new Intl.NumberFormat(`en-US`,{maximumSignificantDigits:2});function g(e){return c(e)||!Number.isFinite(e)?`—`:h.format(e)}function _(e){return!c(e)&&e>0&&e<.005?`<1%`:f(e)}var v;function y(e){if(c(e)||e===``)return`—`;try{v??=new Intl.DisplayNames([`en`],{type:`region`,fallback:`none`});let t=v.of(String(e).toUpperCase());return t?`${t} (${e})`:String(e)}catch{return String(e)}}function b(e){return c(e)?`—`:`${Math.abs(e)>=10?s.format(e):o.format(e)}%`}function x(e,t){return t===`pct`?b(e):l(e)}function S(e){return c(e)?``:String(e)}function C(e,t){let n=[];return e.top_quarter_share!=null&&e.a>=t.min_cases_for_quarter_rule&&e.top_quarter_share>=t.min_top_quarter_share&&n.push({kind:`quarter`,quarter:e.top_quarter,share:e.top_quarter_share}),e.median_reactions_per_case!=null&&e.median_reactions_per_case>=t.min_median_reactions_per_case&&n.push({kind:`long_reports`,median:e.median_reactions_per_case}),e.top_country!=null&&e.ingredient_top_country!=null&&e.a>=t.min_cases_for_country_rule&&e.top_country_share>=t.min_top_country_share&&e.top_country!==e.ingredient_top_country&&n.push({kind:`country`,country:e.top_country,share:e.top_country_share,ingredientShare:e.ingredient_country_share,ingredientTopCountry:e.ingredient_top_country,ingredientTopShare:e.ingredient_top_country_share}),n}var w={ror_lcl:{label:`Most clearly larger share (ROR lower bound)`,short:`ROR lower bound`,field:`ror_lcl`,dir:`desc`},prr:{label:`Largest share ratio (PRR)`,short:`PRR`,field:`prr`,dir:`desc`},a:{label:`Most cases`,short:`cases`,field:`a`,dir:`desc`},name:{label:`Name, A to Z`,short:`name`,field:`reaction_pt`,dir:`asc`}},T=(e,t)=>e.reaction_pt.localeCompare(t.reaction_pt,`en`)||e.reaction_key.localeCompare(t.reaction_key);function E(e,t,n=w[t]?.dir??`desc`){if(t===`name`)return[...e].sort((e,t)=>n===`asc`?T(e,t):T(t,e));let r=w[t]?.field??t,i=n===`asc`?1:-1,a=e=>e!=null&&Number.isFinite(e);return[...e].sort((e,t)=>{let n=e[r],o=t[r];return!a(n)&&a(o)?1:!a(o)&&a(n)?-1:a(n)&&a(o)&&n!==o?i*(n-o):T(e,t)})}function D(e,{text:t=``,pattern:n=`all`},r){let i=t.trim().toLowerCase();return e.filter(e=>(!i||e.reaction_pt.toLowerCase().includes(i))&&(n===`all`||n===`with`===r(e)))}var O=3e4,ee=[1,10,100,1e3,1e4];function k(e){if(e==null||!Number.isFinite(e)||e<=0)return null;let t=Math.log10(e)/Math.log10(O)*100;return{pos:Math.min(100,Math.max(0,t)),below:t<0,above:t>100}}function te(e){let t=k(e.prr);if(!t)return null;let n=k(e.prr_lcl),r=k(e.prr_ucl);return{dot:t.pos,lo:n?n.pos:t.pos,hi:r?r.pos:t.pos,above:t.above||!!r?.above,below:t.below||!!n?.below}}function ne(e,t,n=10){let r=t.trim().toLowerCase();if(!r)return[];let i=[],a=[];for(let t of e){let e=t.name.toLowerCase();if(e.startsWith(r)?i.push(t):e.includes(r)&&a.push(t),i.length>=n)break}return[...i,...a].slice(0,n)}function re(e){let t=Object.fromEntries(e.columns.map((e,t)=>[e,t]));return e.rows.map(e=>({name:e[t.ingredient_name],slug:e[t.slug],cases:e[t.n_cases_ps_ss],pairs:e[t.n_pairs],fallback:e[t.is_fallback]}))}var ie=/^[a-z0-9-]+$/,ae=/^[a-f0-9]{32}$/;function oe(e){let t=(e||``).replace(/^#\/?/,``).split(`/`).filter(Boolean).map(decodeURIComponent);if(t.length===0)return{page:`home`};let[n,r,i]=t;if(n===`ingredient`&&r&&ie.test(r)){if(i===void 0)return{page:`ingredient`,slug:r};if(ae.test(i)&&t.length===3)return{page:`pair`,slug:r,reactionKey:i}}return[`quality`,`validation`,`method`,`downloads`].includes(n)&&t.length===1?{page:n}:{page:`not_found`}}var A=e=>`#/ingredient/${e}`,j=(e,t)=>`#/ingredient/${e}/${t}`;function se(e,t){let n=new Map((e||[]).map(e=>[e.period_key,e]));return t.map(e=>{let t=n.get(e);return{quarter:e,a:t?t.a:null,prr:t?t.prr:null}})}function ce(e){let t=e.n_total!=null&&e.n_drug!=null?e.n_total-e.n_drug:null;return{drug:e.n_drug?e.a/e.n_drug:null,other:t?e.c/t:null,nOther:t}}function le(e,t){return e==null||!Number.isFinite(e)?null:t===`1`?`same`:e>1?`larger`:`smaller`}function ue(e,t){let n=Math.max(0,...e.map(e=>e.a??0));return e.map(e=>({quarter:e.quarter,a:e.a,prr:e.prr,height:e.a==null||n===0?0:100*e.a/n,provisional:t!=null&&e.quarter===t}))}function de(e,t){return`${t}. ${e.map(e=>`${e.quarter}${e.provisional?` (provisional)`:``}: ${e.a==null?`fewer than 3`:e.a}`).join(`; `)}.`}function fe(e,t,n){return(e||[]).find(e=>e.ingredient_name===t&&e.reaction_pt===n)??null}var pe=e=>/^[A-Z][a-z]/.test(e)?e[0].toLowerCase()+e.slice(1):e;function me(e){let t={};for(let n of e){let e=(t[n.period_basis]??={})[n.metric_group]??={};(e[n.period_key]??={})[n.metric]=n}return t}var he=(function(){let e=typeof document<`u`&&document.createElement(`link`).relList;return e&&e.supports&&e.supports(`modulepreload`)?`modulepreload`:`preload`})(),ge=function(e,t){return new URL(e,t).href},_e={},ve=function(e){return e.pathname.endsWith(`.css`)},ye=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},be=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=ge(t,n);let r=s(t),i=ve(r);return ye(_e,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:he,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},M=document.getElementById(`main`),xe=document.getElementById(`status`),Se=t.site.title,N=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]),P=(e,t,n)=>`<td class="num" data-field="${n}" data-value="${S(e)}">${t}</td>`,F=new Map;function I(e){return F.has(e)||(F.set(e,fetch(`data/${e}`).then(t=>{if(!t.ok)throw Object.assign(Error(`${e}: HTTP ${t.status}`),{status:t.status});return t.json()})),F.get(e).catch(()=>F.delete(e))),F.get(e)}var L;async function Ce(){return L??=I(`json/search.json`).then(re),L}function R(e,t){return`<div class="table-scroll" role="region" aria-label="${N(e)}" tabindex="0">${t}</div>`}function we(e){return e.kind===`quarter`?`Mostly one quarter: ${f(e.share)} of cases in ${N(e.quarter)}`:e.kind===`country`?`Mostly one country: ${f(e.share)} of cases from ${N(y(e.country))}; ingredient: ${_(e.ingredientShare)} ${N(e.country)}`:`Many reactions per report: median ${l(e.median)}`}function z(e){return e.kind===`quarter`?`${f(e.share)} of these cases were first received in ${N(e.quarter)}.`:e.kind===`country`?`${f(e.share)} of these cases come from ${N(y(e.country))}, against ${_(e.ingredientShare)} of all cases of the ingredient (its most frequent country is ${N(y(e.ingredientTopCountry))}, ${f(e.ingredientTopShare)}).`:`The reports of these cases list a median of ${l(e.median)} reactions each.`}var Te=`<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.6"></circle></svg>`,B=()=>`<span class="tag tag-pattern">${Te}Reporting pattern</span>`;function V(e){return e.length?`<span class="pattern">${B()} <span class="pattern-why">${e.map(we).join(`; `)}</span></span>`:``}var Ee=`<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"></path></svg>`;async function De(){Z(`Search`),M.innerHTML=`
    <section class="hero" aria-labelledby="home-h">
      <p class="kicker">FDA adverse-event reports · ${N(e.first_quarter)} to ${N(e.last_quarter)}</p>
      <h1 id="home-h" tabindex="-1">Which reactions are reported unusually often with a medicine?</h1>
      <p class="lede">Look up a medicine to see which reactions take up a larger share of its
        reports to the FDA than of other medicines' reports. It shows patterns in reporting, not
        proof that a medicine causes anything.</p>
      <div class="search">
        <label for="q">Search a medicine by its active ingredient (generic name)</label>
        <div class="combo">
          ${Ee}
          <input id="q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
            aria-controls="q-list" aria-describedby="q-help" autocomplete="off" spellcheck="false"
            placeholder="for example, atorvastatin" />
          <ul id="q-list" role="listbox" aria-label="Matching ingredients" hidden></ul>
        </div>
        <p id="q-help" class="help">Names are RxNorm ingredients; brand names are not in the
          list. Use ↑ ↓ and Enter to pick a suggestion.</p>
      </div>
      <div class="chips" id="chips" hidden><span>Try</span></div>
      <p class="stats">${l(e.n_cases_all)} deduplicated cases ·
        ${l(e.n_ingredients)} ingredients · ${l(e.n_pairs)} ingredient–reaction
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
    </section>`;let n=await Ce(),r=n[0]?.cases||1;document.getElementById(`top-list`).innerHTML=n.slice(0,12).map((e,t)=>`<li><span class="rank">${t+1}</span><span class="name"><a href="${A(e.slug)}">${N(e.name)}</a><span class="vol" aria-hidden="true" style="width:${(e.cases/r*100).toFixed(1)}%"></span></span><span class="cases">${l(e.cases)} cases</span></li>`).join(``);let i=new Set(n.map(e=>e.slug)),a=(t.site.home_examples??[]).filter(e=>i.has(e));if(a.length){let e=document.getElementById(`chips`),t=new Map(n.map(e=>[e.slug,e.name]));e.insertAdjacentHTML(`beforeend`,a.map(e=>`<a class="chip" href="${A(e)}">${N(t.get(e))}</a>`).join(``)),e.hidden=!1}ke(n),Q(`Ingredient list loaded`)}function Oe(e,t){let n=t.trim().toLowerCase(),r=n?e.toLowerCase().indexOf(n):-1;return r<0?N(e):`${N(e.slice(0,r))}<strong>${N(e.slice(r,r+n.length))}</strong>${N(e.slice(r+n.length))}`}function ke(e){let t=document.getElementById(`q`),n=document.getElementById(`q-list`),r=[],i=-1,a=()=>{n.hidden=!0,t.setAttribute(`aria-expanded`,`false`),t.removeAttribute(`aria-activedescendant`),i=-1},o=e=>{i=e,[...n.children].forEach((t,n)=>t.setAttribute(`aria-selected`,String(n===e))),e>=0?t.setAttribute(`aria-activedescendant`,`q-opt-${e}`):t.removeAttribute(`aria-activedescendant`)},s=e=>{r[e]&&(location.hash=A(r[e].slug))};t.addEventListener(`input`,()=>{if(r=ne(e,t.value,10),!r.length){let e=`No ingredient matches “${N(t.value.trim())}”. Try the generic name, for example “atorvastatin” rather than “Lipitor”.`;n.innerHTML=t.value.trim()?`<li class="empty" role="option" aria-disabled="true">${e}</li>`:``,n.hidden=!t.value.trim(),t.setAttribute(`aria-expanded`,String(!n.hidden)),Q(t.value.trim()?`No ingredient found`:``)}else n.innerHTML=r.map((e,n)=>`<li id="q-opt-${n}" role="option" aria-selected="false" data-i="${n}"><span>${Oe(e.name,t.value)}</span> <span class="muted">${l(e.cases)} cases${e.fallback?`, name without RxNorm match`:``}</span></li>`).join(``),n.hidden=!1,t.setAttribute(`aria-expanded`,`true`),o(-1),Q(`${r.length} suggestions`)}),t.addEventListener(`keydown`,e=>{e.key===`ArrowDown`&&r.length?(e.preventDefault(),o(Math.min(i+1,r.length-1))):e.key===`ArrowUp`&&r.length?(e.preventDefault(),o(Math.max(i-1,0))):e.key===`Enter`?(e.preventDefault(),s(i>=0?i:0)):e.key===`Escape`&&a()}),n.addEventListener(`mousedown`,e=>e.preventDefault()),n.addEventListener(`click`,e=>{let t=e.target.closest(`[data-i]`);t&&s(+t.dataset.i)}),t.addEventListener(`blur`,a)}async function H(e){try{return await I(`json/signals/${e}.json`)}catch(e){if(e.status===404)return null;throw e}}function U(e){Z(`Not found`),M.innerHTML=`<h1 tabindex="-1">Not found</h1><p>${N(e)}</p><p><a href="#/">Back to the search</a></p>`}function Ae(e){return e.is_fallback?`This name has no match in RxNorm, so it is shown as reported. Cases of the same drug under its RxNorm name are counted separately.`:`RxNorm ingredient ${N(e.ingredient_id)} (${N(e.match_type)} match).`}var W={key:`ror_lcl`,all:!1,expert:!1,text:``,pattern:`all`,open:new Set,slug:null},je=`<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"></path></svg>`,G=`<svg class="chev" width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"></path></svg>`,Me=e=>[e.is_signal_evans?`Evans`:``,e.is_signal_ror?`ROR`:``].filter(Boolean).join(`, `)||`—`;function Ne(e){if(e==null||!Number.isFinite(e))return`Share ratio not available`;let t=u(e);return t===`1`?`Same share as in other medicines’ reports`:e>1?`${t}× larger share`:`${t}× the share (smaller)`}function Pe(e){let t=te(e);return t?`<span class="${[`mag`,t.above?`mag-above`:``,t.below?`mag-below`:``].filter(Boolean).join(` `)}" aria-hidden="true" style="--dot:${t.dot.toFixed(2)}%;--lo:${t.lo.toFixed(2)}%;--hi:${t.hi.toFixed(2)}%"><span class="mag-ci"></span><span class="mag-dot"></span></span>`:`<span class="mag mag-none" aria-hidden="true"></span>`}function Fe(){return`<span class="mag-scale" aria-hidden="true">${ee.map(e=>`<span style="left:${k(e).pos.toFixed(2)}%">${l(e)}×</span>`).join(``)}</span>`}var Ie=e=>C(e,t.alert).length>0;async function Le(e){let t=await H(e);if(!t)return U(`No ingredient "${e}" in this export.`);let n=t.ingredient;W.slug!==e&&Object.assign(W,{text:``,pattern:`all`,open:new Set,all:!1,slug:e}),Z(n.ingredient_name);let r=t.pairs.filter(Ie).length,i=t.pairs.length,a=(e,t)=>`<label class="seg-opt"><input type="radio" name="pat" value="${e}"${W.pattern===e?` checked`:``}><span>${t}</span></label>`;M.innerHTML=`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Search</a> <span aria-hidden="true">/</span> ${N(n.ingredient_name)}</nav>
    <section class="page-head" aria-labelledby="ing-h">
      <p class="kicker">${n.is_fallback?`Ingredient · name without RxNorm match`:`Ingredient · RxNorm ${N(n.ingredient_id)}`}</p>
      <h1 id="ing-h" tabindex="-1">${N(n.ingredient_name)}</h1>
      <p class="lede"><strong>${l(n.n_cases_ps_ss)} cases</strong> name ${N(n.ingredient_name)} as a
        suspect medicine (primary or secondary suspect). Below, each reaction's share of these
        reports is compared with its share of reports for other medicines.</p>
      <p class="caution">A larger share is a reason to look closer, not evidence that the medicine
        causes the reaction. ${Ae(n)} Open a reaction for its 2×2 table and quarterly
        trend.</p>
    </section>
    <div class="controls">
      <div class="control-row">
        <div class="field"><label for="flt">Filter reactions</label>
          <input id="flt" type="search" autocomplete="off" spellcheck="false" placeholder="for example, myositis" value="${N(W.text)}" /></div>
        <div class="field"><label for="srt">Sort by</label>
          <select id="srt">${Object.entries(w).map(([e,t])=>`<option value="${e}"${e===W.key?` selected`:``}>${N(t.label)}</option>`).join(``)}</select></div>
        <fieldset class="seg"><legend>Reporting pattern</legend>
          ${a(`all`,`All (${i})`)}${a(`with`,`With pattern (${r})`)}${a(`without`,`Without (${i-r})`)}
        </fieldset>
        <label class="check"><input type="checkbox" id="expert"${W.expert?` checked`:``}> Show all numbers</label>
      </div>
      <p class="table-summary" id="pairs-summary" aria-live="polite"></p>
      <p class="legend" id="alert-legend">${B()} <span>Most of the pair's cases come from one
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
    </div>`;let o=()=>Re(t);document.getElementById(`flt`).addEventListener(`input`,e=>{W.text=e.target.value,o()}),document.getElementById(`srt`).addEventListener(`change`,e=>{W.key=e.target.value,o()});for(let e of document.querySelectorAll(`input[name="pat"]`))e.addEventListener(`change`,()=>{W.pattern=e.value,o()});document.getElementById(`expert`).addEventListener(`change`,e=>{W.expert=e.target.checked,o()}),o(),Q(`${i} reactions for ${n.ingredient_name}`)}function Re(e){let n=e.ingredient.slug,{key:r,expert:i}=W,a=E(D(e.pairs,W,Ie),r),o=t.site.pairs_page_size,s=W.all?a:a.slice(0,o),c={ror_lcl:`most clearly larger share first (ROR lower bound)`,prr:`largest PRR first`,a:`most cases first`,name:`name, A to Z`}[r];document.getElementById(`pairs-summary`).textContent=`Showing ${s.length} of ${e.pairs.length} reactions, sorted by ${c}.`;let f=i?9:5,p=s.map((e,r)=>{let a=C(e,t.alert),o=`det-${r}`,s=W.open.has(e.reaction_key);return`<tr data-reaction-key="${e.reaction_key}" class="${s?`is-open`:``}">
        <th scope="row"><a href="${j(n,e.reaction_key)}"><span data-pt>${N(e.reaction_pt)}</span></a>${V(a)}</th>
        ${P(e.a,l(e.a),`a`)}
        <td class="mag-cell">${Pe(e)}</td>
        ${P(e.prr,u(e.prr),`prr`)}
        ${i?`<td class="num ci" data-field="prr_ci" data-lcl="${S(e.prr_lcl)}" data-ucl="${S(e.prr_ucl)}">${d(e.prr_lcl,e.prr_ucl)}</td>
        ${P(e.ror,u(e.ror),`ror`)}
        <td class="num ci" data-field="ror_ci" data-lcl="${S(e.ror_lcl)}" data-ucl="${S(e.ror_ucl)}">${d(e.ror_lcl,e.ror_ucl)}</td>
        <td class="nowrap">${Me(e)}</td>`:``}
        <td class="det-cell"><button type="button" class="btn-ghost det" aria-expanded="${s}" aria-controls="${o}" data-key="${e.reaction_key}">Details<span class="sr-only"> for ${N(e.reaction_pt)}</span>${G}</button></td>
      </tr>
      <tr class="det-row" id="${o}"${s?``:` hidden`}><td colspan="${f}">${ze(n,e,a,`Open the 2×2 table, quarterly trend and countries`)}</td></tr>`}).join(``),m=s.map((e,r)=>{let i=C(e,t.alert),a=`cdet-${r}`,o=W.open.has(e.reaction_key);return`<li data-reaction-key="${e.reaction_key}">
        <div class="card-head"><a href="${j(n,e.reaction_key)}"><span data-pt>${N(e.reaction_pt)}</span></a>
          <span class="card-cases"><span data-field="a" data-value="${S(e.a)}">${l(e.a)}</span> cases</span></div>
        <div class="card-mag">${Pe(e)}<span class="times">${e.prr!=null&&Number.isFinite(e.prr)?`${u(e.prr)}×`:`—`}</span></div>
        <p class="card-line">${Ne(e.prr)} (PRR <span data-field="prr" data-value="${S(e.prr)}">${u(e.prr)}</span>, range ${d(e.prr_lcl,e.prr_ucl)})</p>
        ${V(i)}
        <button type="button" class="btn-ghost det" aria-expanded="${o}" aria-controls="${a}" data-key="${e.reaction_key}">Details<span class="sr-only"> for ${N(e.reaction_pt)}</span>${G}</button>
        <div class="card-det" id="${a}"${o?``:` hidden`}>${ze(n,e,i,`Open the 2×2 table and trend`)}</div>
      </li>`}).join(``),h=s.length?``:`<p class="empty">No reaction matches these filters.</p>`;document.getElementById(`pairs`).innerHTML=`
    ${h}
    <div class="pairs-desktop">${R(`Reactions`,`<table class="pairs${i?` expert`:``}">
        <caption class="sr-only">Reactions reported with ${N(e.ingredient.ingredient_name)}, with how much larger their share of reports is</caption>
        <thead><tr>
          <th scope="col" class="col-pt">Reaction (MedDRA PT)</th>
          <th scope="col" class="num">Cases</th>
          <th scope="col" class="col-mag"><span class="tip-wrap">How much larger the share is (PRR)
            <button type="button" class="tip" aria-label="What is this?" aria-expanded="false" aria-controls="mag-tip">${je}</button>
            <span class="tip-body" id="mag-tip" role="status" hidden>The PRR (proportional reporting ratio) divides the reaction's share of this medicine's reports by its share of all other reports. Dot: best estimate. Line: plausible range (95% CI). Each step on the scale is 10 times larger; values beyond the ends are drawn at the edge with an arrow.</span></span>
            ${Fe()}</th>
          <th scope="col" class="num">PRR</th>
          ${i?`<th scope="col" class="num">PRR 95% CI</th><th scope="col" class="num">ROR</th><th scope="col" class="num">ROR 95% CI</th><th scope="col">Criteria met</th>`:``}
          <th scope="col" class="det-cell"><span class="sr-only">Details</span></th>
        </tr></thead>
        <tbody>${p}</tbody>
      </table>`)}</div>
    <div class="pairs-mobile">
      <p class="mag-note" aria-hidden="true">Scale: 1× to ${l(O)}× larger share (PRR), log scale</p>
      <ul class="pair-cards" aria-label="Reactions reported with ${N(e.ingredient.ingredient_name)}">${m}</ul>
    </div>`;let g=document.getElementById(`show-all-wrap`);g.innerHTML=a.length>o?`<button type="button" class="btn" id="show-all">${W.all?`Show the first ${o}`:`Show all ${a.length} reactions`}</button>`:``,document.getElementById(`show-all`)?.addEventListener(`click`,()=>{W.all=!W.all,Re(e),document.getElementById(`show-all`)?.focus()});for(let e of document.querySelectorAll(`#pairs button.det`))e.addEventListener(`click`,()=>{let t=e.getAttribute(`aria-expanded`)!==`true`;for(let n of document.querySelectorAll(`#pairs button.det[data-key="${e.dataset.key}"]`))n.setAttribute(`aria-expanded`,String(t)),document.getElementById(n.getAttribute(`aria-controls`)).hidden=!t,n.closest(`tr`)?.classList.toggle(`is-open`,t);t?W.open.add(e.dataset.key):W.open.delete(e.dataset.key)});Be(document.querySelector(`#pairs .tip`))}function ze(e,t,n,r){return`<dl class="det-list">
      <div><dt>How much larger the share is (PRR)</dt><dd><strong>${u(t.prr)}</strong> · plausible range (95% CI) ${d(t.prr_lcl,t.prr_ucl)}</dd></div>
      <div><dt>Same comparison as odds (ROR)</dt><dd><strong>${u(t.ror)}</strong> · plausible range (95% CI) ${d(t.ror_lcl,t.ror_ucl)}</dd></div>
      <div><dt>Screening rules met</dt><dd>${Me(t)}</dd></div>
    </dl>
    ${n.length?`<p class="det-pattern"><strong>Reporting pattern:</strong> ${n.map(z).join(` `)}</p>`:``}
    <a href="${j(e,t.reaction_key)}">${r} <span aria-hidden="true">→</span></a>`}function K(e,t){e.setAttribute(`aria-expanded`,String(t)),document.getElementById(e.getAttribute(`aria-controls`)).hidden=!t}function Be(e){e?.addEventListener(`click`,t=>{t.stopPropagation(),K(e,e.getAttribute(`aria-expanded`)!==`true`)})}var Ve=`button.tip[aria-expanded="true"]`;document.addEventListener(`keydown`,e=>{if(e.key===`Escape`)for(let e of document.querySelectorAll(Ve))K(e,!1),e.focus()}),document.addEventListener(`click`,e=>{for(let t of document.querySelectorAll(Ve))document.getElementById(t.getAttribute(`aria-controls`)).contains(e.target)||K(t,!1)});async function He(){try{return await I(`json/known_signals.json`)}catch{return[]}}function Ue(e,t){let n=le(e.prr,u(e.prr)),r=N(e.reaction_pt),i=N(t);return n===`larger`?`${r} appears in a larger share of ${i} reports`:n===`smaller`?`${r} appears in a smaller share of ${i} reports`:n===`same`?`${r} appears in about the same share of ${i} reports as of other medicines' reports`:`${r} in ${i} reports`}function We(e,t,n){let r=N(t),i=`It is named in <strong>${m(n.drug)}</strong> of ${r} cases (${l(e.a)} of ${l(e.n_drug)})`;if(!n.other)return`${i}, and in none of the cases for all other medicines, so the two shares cannot be divided.`;let a=`compared with <strong>${m(n.other)}</strong> of cases for all other medicines (${l(e.c)} of ${l(n.nOther)})`,o=le(e.prr,u(e.prr));return`${i}, ${a}: ${o===`larger`?`a share about <strong>${g(e.prr)} times larger</strong>`:o===`smaller`?`a share about <strong>${g(1/e.prr)} times smaller</strong>`:`about the same share`}.`}function Ge(e,t,n){let r=Math.max(n.drug??0,n.other??0),i=e=>r>0&&e!=null?(100*e/r).toFixed(2):`0`,a=N(pe(e.reaction_pt)),o=(e,t,n,r,o)=>`
      <div class="share-row ${o}">
        <p class="share-head"><span>${e}</span> <span class="share-n">${l(t)} cases</span></p>
        <span class="share-track" aria-hidden="true"><span class="share-fill" style="--w:${i(r)}%"></span></span>
        <p class="share-val"><strong>${l(n)}</strong> name ${a} (<strong>${m(r)}</strong>)</p>
      </div>`;return`<div class="shares">
      ${o(`${N(t)} cases`,e.n_drug,e.a,n.drug,`share-drug`)}
      ${o(`All other medicines' cases`,n.nOther,e.c,n.other,`share-other`)}
    </div>`}function Ke(t,n){let r=e.last_quarter_is_provisional?e.provisional_quarter:null,i=ue(t,r),a=i.map(e=>{let[t,n]=[e.quarter.slice(0,4),e.quarter.slice(4)];return`<span class="${[`qcol`,e.provisional?`provisional`:``,e.a==null?`none`:``].filter(Boolean).join(` `)}" style="--h:${e.height.toFixed(2)}%"><span class="qval">${e.a==null?`&lt;3`:l(e.a)}</span><span class="qbar"></span><span class="qlab">${N(n)}${e.provisional?`*`:``}<br>${N(t)}</span></span>`}).join(``),o=`<table class="trend-table">
          <caption class="sr-only">${N(n)}</caption>
          <thead><tr><th scope="col">Quarter</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th></tr></thead>
          <tbody>${i.map(e=>`<tr><th scope="row">${N(e.quarter)}${e.provisional?`*`:``}</th>${e.a==null?`<td class="num">&lt;3</td><td class="num">—</td>`:`${P(e.a,l(e.a),`trend_a`)}${P(e.prr,u(e.prr),`trend_prr`)}`}</tr>`).join(``)}</tbody>
        </table>`;return`<figure class="qchart">
        <div class="qbars" role="img" aria-label="${N(de(i,n))}">${a}</div>
        <figcaption class="help">${r?`<span class="qkey" aria-hidden="true"></span> Hatched, with *: ${N(r)} is provisional. `:``}Quarters with fewer than 3 cases show "&lt;3".</figcaption>
      </figure>
      <details class="trend-details">
        <summary>Show as a table</summary>
        ${R(`Cases per quarter`,o)}
      </details>`}function qe(e){return`None of the three checks flags this pair: ${f(e.min_top_quarter_share)} or more of its cases first
    received in one quarter (checked from ${l(e.min_cases_for_quarter_rule)} cases),
    ${f(e.min_top_country_share)} or more from one country other than the ingredient's most frequent
    (checked from ${l(e.min_cases_for_country_rule)} cases), or a median of
    ${l(e.min_median_reactions_per_case)} or more reactions per report.`}function Je(e,t){if(!e)return``;let n=`${et(e,!0)} (${e.expected===`positive`?`positive pair`:`negative control`})`,r=X(e);return`<section class="ref-pair" aria-labelledby="ref-h">
      <p class="kicker">Validation · reference pair</p>
      <h2 id="ref-h">One of the ${l(t)} pairs used to check the pipeline</h2>
      <dl class="facts">
        <div><dt>Label</dt><dd>${N($e[e.reference_status]??e.reference_status??`—`)}</dd></div>
        <div><dt>Reference</dt><dd>${N(e.reference??`—`)}</dd></div>
        <div><dt>Expected</dt><dd>${n}</dd></div>
        <div><dt>Result</dt><dd data-field="passed">${r}</dd></div>
      </dl>
      <p><a href="#/validation">See all ${l(t)} reference pairs <span aria-hidden="true">→</span></a></p>
    </section>`}async function Ye(n,r){let[i,a]=await Promise.all([H(n),He()]),o=i?.pairs.find(e=>e.reaction_key===r);if(!i||!o)return U(`This ingredient and reaction pair is not in this export.`);let s=i.ingredient;Z(`${o.reaction_pt} with ${s.ingredient_name}`);let c=C(o,t.alert),p=se(o.trend,e.quarters),h=ce(o),g=fe(a,s.ingredient_name,o.reaction_pt),v=(e,t)=>`<td class="num" data-field="${t}" data-value="${S(e)}">${l(e)}</td>`,b=e=>e?`Yes`:`No`,x=N(s.ingredient_name),w=N(o.reaction_pt),T=`Cases of ${o.reaction_pt} with ${s.ingredient_name} per quarter`,E=c.length?`<div class="pattern-detail">${B()}
        <p>${c.map(z).join(` `)}
        Clusters of reports (litigation, publicity, one reporter sending many long reports) can
        produce strong disproportionality without a pharmacological cause.</p></div>`:`<div class="pattern-detail pattern-none"><span class="tag tag-none">No reporting pattern</span>
        <p>${qe(t.alert)}</p></div>`,D=e=>`<span class="share-track cbar" aria-hidden="true"><span class="share-fill" style="--w:${e==null?0:(100*e).toFixed(2)}%"></span></span>`;M.innerHTML=`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Search</a> <span aria-hidden="true">/</span>
      <a href="${A(n)}">${x}</a> <span aria-hidden="true">/</span> ${w}</nav>
    <section class="page-head" aria-labelledby="pair-h">
      <p class="kicker">Reaction reported with ${x} · MedDRA PT</p>
      <h1 id="pair-h" tabindex="-1">${Ue(o,s.ingredient_name)}</h1>
      <p class="lede" id="pair-lede">${We(o,s.ingredient_name,h)}</p>
      <p class="caution">This describes reports, not how often ${N(pe(o.reaction_pt))} happens to people
        taking ${x}. A larger share is a reason to look closer, not evidence that the medicine
        causes the reaction.</p>
      ${V(c)}
    </section>
    <section aria-labelledby="shares-h">
      <h2 id="shares-h">Two shares, side by side</h2>
      <p class="help">The 2×2 table counts distinct cases by medicine (${x} as primary or
        secondary suspect, or not) and by whether they name the reaction.</p>
      ${Ge(o,s.ingredient_name,h)}
      <p class="division" id="division">${o.prr!=null&&Number.isFinite(o.prr)?`${m(h.drug)} ÷ ${m(h.other)}: dividing the first share by the second gives the PRR, <strong>${u(o.prr)}</strong> (from the unrounded shares).`:`The PRR cannot be computed for this pair.`}</p>
      <details class="t22">
        <summary>Show the 2×2 table and the formulas</summary>
        ${R(`2 by 2 table`,`<table class="two-by-two">
            <caption>Distinct cases with and without ${x} (as primary or secondary suspect) and ${w}.</caption>
            <thead><tr><td></td><th scope="col" class="num">Name ${w}</th><th scope="col" class="num">Other reactions only</th><th scope="col" class="num">Total</th></tr></thead>
            <tbody>
              <tr><th scope="row">${x} cases</th>${v(o.a,`a`)}${v(o.b,`b`)}${v(o.n_drug,`n_drug`)}</tr>
              <tr><th scope="row">All other medicines' cases</th>${v(o.c,`c`)}${v(o.d,`d`)}${v(o.n_total-o.n_drug,`n_without_drug`)}</tr>
              <tr><th scope="row">Total</th>${v(o.n_reac,`n_reac`)}${v(o.n_total-o.n_reac,`n_without_reac`)}${v(o.n_total,`n_total`)}</tr>
            </tbody>
          </table>`)}
        <p class="help">Cells: a = ${l(o.a)}, b = ${l(o.b)}, c = ${l(o.c)}, d = ${l(o.d)}.</p>
        <ul class="formulas">
          <li>PRR = [a/(a+b)] / [c/(c+d)] = (${l(o.a)} / ${l(o.n_drug)}) / (${l(o.c)} / ${l(h.nOther)}) = ${u(o.prr)}; 95% CI = exp(ln PRR ± 1.96·SE), SE = √(1/a − 1/(a+b) + 1/c − 1/(c+d)) = ${d(o.prr_lcl,o.prr_ucl)}.</li>
          <li>ROR = (a·d) / (b·c) = (${l(o.a)} × ${l(o.d)}) / (${l(o.b)} × ${l(o.c)}) = ${u(o.ror)}; 95% CI = exp(ln ROR ± 1.96·SE), SE = √(1/a + 1/b + 1/c + 1/d) = ${d(o.ror_lcl,o.ror_ucl)}.</li>
          <li>χ² = N(ad − bc)² / [(a+b)(c+d)(a+c)(b+d)], Pearson, 1 degree of freedom, no continuity correction = ${u(o.chi2)}.</li>
        </ul>
      </details>
    </section>
    <section aria-labelledby="dp-h">
      <h2 id="dp-h">Measures</h2>
      ${R(`Disproportionality measures`,`<table class="measures">
          <caption class="sr-only">Disproportionality measures of ${w} with ${x}</caption>
          <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Value</th><th scope="col" class="num">95% CI lower</th><th scope="col" class="num">95% CI upper</th></tr></thead>
          <tbody>
            <tr><th scope="row">How much larger the share is <span class="tech">(PRR)</span></th>${P(o.prr,u(o.prr),`prr`)}${P(o.prr_lcl,u(o.prr_lcl),`prr_lcl`)}${P(o.prr_ucl,u(o.prr_ucl),`prr_ucl`)}</tr>
            <tr><th scope="row">Same comparison as odds <span class="tech">(ROR)</span></th>${P(o.ror,u(o.ror),`ror`)}${P(o.ror_lcl,u(o.ror_lcl),`ror_lcl`)}${P(o.ror_ucl,u(o.ror_ucl),`ror_ucl`)}</tr>
            <tr><th scope="row">Distance from equal shares <span class="tech">(chi-square, χ²)</span></th>${P(o.chi2,u(o.chi2),`chi2`)}<td></td><td></td></tr>
          </tbody>
        </table>`)}
      <p class="help">The 95% CI is the plausible range of each ratio.</p>
      <dl class="flags">
        <div><dt>Screening rule met: Evans <span class="tech">(a ≥ 3, PRR ≥ 2, χ² ≥ 4)</span></dt><dd data-field="is_signal_evans">${b(o.is_signal_evans)}</dd></div>
        <div><dt>Screening rule met: ROR <span class="tech">(a ≥ 3, ROR lower bound &gt; 1)</span></dt><dd data-field="is_signal_ror">${b(o.is_signal_ror)}</dd></div>
      </dl>
      <p class="help">Meeting a rule flags a pair for review; it does not confirm an effect of the drug.</p>
    </section>
    <section aria-labelledby="trend-h">
      <h2 id="trend-h">Cases per quarter</h2>
      <p class="help">Quarter in which the FDA first received each case.${e.last_quarter_is_provisional?` ${N(e.provisional_quarter)}* is provisional: its count grows as later files arrive.`:``} Quarters with fewer than 3 cases show "&lt;3". Cases first received before ${N(e.first_quarter)} count in the totals above but not here. The PS/SS share changes by quarter (see the <a href="#/quality">Quality</a> page).</p>
      ${Ke(p,T)}
    </section>
    <section aria-labelledby="conc-h">
      <h2 id="conc-h">Where the cases come from</h2>
      <p class="help">The export keeps the most frequent reporter country of the pair and of the
        ingredient, not the full country mix.</p>
      ${o.top_country?`<div class="country-compare">
        <p class="cc-head">${N(y(o.top_country))}: the most frequent reporter country for this pair</p>
        <div class="cc-row"><span class="cc-label">This pair (${l(o.a)} cases)</span>${D(o.top_country_share)}<span class="cc-val">${f(o.top_country_share)}</span></div>
        <div class="cc-row"><span class="cc-label">All ${x} cases</span>${D(o.ingredient_country_share)}<span class="cc-val">${_(o.ingredient_country_share)}</span></div>
      </div>`:``}
      <dl class="facts">
        <div><dt>Most frequent reporter country, this pair</dt><dd data-field="top_country">${o.top_country?`${N(y(o.top_country))}, ${f(o.top_country_share)} of cases`:`—`}</dd></div>
        <div><dt>Same country, all cases of the ingredient</dt><dd>${o.top_country?`${_(o.ingredient_country_share)} ${N(o.top_country)}`:`—`}</dd></div>
        <div><dt>Ingredient's most frequent country</dt><dd>${o.ingredient_top_country?`${N(y(o.ingredient_top_country))}, ${f(o.ingredient_top_country_share)} of its cases`:`—`}</dd></div>
        <div><dt>Most frequent first-receipt quarter</dt><dd>${o.top_quarter?`${N(o.top_quarter)}, ${f(o.top_quarter_share)} of cases`:`—`}</dd></div>
        <div><dt>Median reactions per report</dt><dd>${o.median_reactions_per_case==null?`—`:l(o.median_reactions_per_case)}</dd></div>
      </dl>
      <p class="help">Most FAERS reports come from the United States, so a high country share is
        not unusual by itself. The rule behind the reporting-pattern badge is on the
        <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>
    <section aria-labelledby="pat-h">
      <h2 id="pat-h">Reporting pattern</h2>
      ${E}
    </section>
    ${Je(g,a.length)}`,Q(`${o.reaction_pt} with ${s.ingredient_name}`)}var q={demo:`DEMO (case versions)`,drug:`DRUG`,reac:`REAC`,outc:`OUTC`,indi:`INDI`,demo_rows:`Case versions (DEMO rows)`,winning_versions:`Latest versions from this file`,deleted_ids_listed:`Case ids in the deletion list`,deleted_ids_found_in_demo:`Deleted ids found in loaded cases`,distinct_caseids:`Distinct case ids`,superseded_versions_removed:`Superseded versions removed`,deleted_cases_removed:`Deleted cases removed`,cases_after_deduplication:`Cases after deduplication`,pct_duplicate_rows_removed:`Superseded versions, share of rows`,pct_demo_rows_removed_total:`All removed, share of rows`,pct_lines_exact:`Exact match`,pct_lines_normalized_layer:`Normalized match`,pct_lines_fallback:`No match (fallback)`,pct_lines_normalized:`Mapped (exact + normalized)`,generic_fallback_lines:`Generic fallback lines`,signal_role_lines:`PS/SS drug lines`,cases:`Cases`,pct_cases_reporter_country_missing:`Reporter country missing`,pct_cases_age_missing:`Age missing`,pct_cases_sex_unknown:`Sex unknown`,pct_cases_event_date_missing:`Event date missing`,pct_drug_lines_without_prod_ai:`Drug lines without active ingredient text`,pct_reaction_lines_without_pt:`Reaction lines without PT`,pct_PS:`PS`,pct_SS:`SS`,pct_C:`C`,pct_I:`I`,pct_DN:`DN`};function J(e,t,n,r){let i=Object.keys(t).sort(),a=n.map(e=>`<th scope="col" class="num">${N(q[e]??e)}</th>`).join(``),o=i.map(e=>{let r=n.map(n=>{let r=t[e][n];return r?P(r.value,x(r.value,r.unit),n):`<td class="num">—</td>`}).join(``);return`<tr><th scope="row">${N(e)}</th>${r}</tr>`}).join(``);return R(e,`<table class="metrics"><caption>${N(e)}</caption><thead><tr><th scope="col">${N(r)}</th>${a}</tr></thead><tbody>${o}</tbody></table>`)}function Xe(e,t,n){let r=n.filter(e=>t[e]).map(e=>`<tr><th scope="row">${N(q[e]??e)}</th>${P(t[e].value,x(t[e].value,t[e].unit),e)}</tr>`).join(``);return R(e,`<table class="metrics kv"><caption>${N(e)}</caption><tbody>${r}</tbody></table>`)}var Ze={demo:`Case versions: one row per version of a case.`,drug:`Drug lines: one row per drug named in a case version.`,reac:`Reaction lines: one row per reaction term in a case version.`,outc:`Outcome lines: one row per outcome recorded for a case version.`,indi:`Indication lines: one row per reason a drug was given.`,demo_rows:`Every case version loaded, before deduplication.`,distinct_caseids:`Different case IDs among those versions.`,superseded_versions_removed:`Older versions of a case, dropped because a later version exists.`,deleted_cases_removed:`Cases on the FDA deletion lists, dropped.`,cases_after_deduplication:`Cases counted on this site: one per case ID, its latest version.`,pct_duplicate_rows_removed:`Superseded versions, as a share of all loaded versions.`,pct_demo_rows_removed_total:`Superseded versions and deleted cases, as a share of all loaded versions.`,winning_versions:`Versions from this file that are the latest of their case.`,deleted_ids_listed:`Case IDs in this file's deletion list.`,deleted_ids_found_in_demo:`Of those, the IDs that match a loaded case.`,signal_role_lines:`Drug lines with a primary or secondary suspect role (PS/SS): the ones looked up in RxNorm.`,pct_lines_exact:`Share matched to an RxNorm ingredient by its exact name.`,pct_lines_normalized_layer:`Share matched only after RxNorm normalized the name (approximate matching is off).`,pct_lines_fallback:`Share with no match: the name stays as its own ingredient.`,generic_fallback_lines:`Lines that name a class of products (HERBALS, VITAMINS, …) instead of an ingredient; left out of the site.`,cases:`Cases first received in the quarter.`,pct_cases_reporter_country_missing:`Cases without a reporter country.`,pct_cases_age_missing:`Cases without the patient's age.`,pct_cases_sex_unknown:`Cases with sex unknown or not recorded.`,pct_cases_event_date_missing:`Cases without the date of the event.`,pct_drug_lines_without_prod_ai:`Drug lines without active-ingredient text; the reported drug name is used and not looked up.`,pct_reaction_lines_without_pt:`Reaction lines without a MedDRA PT.`,pct_PS:`Primary suspect: the drug suspected first.`,pct_SS:`Secondary suspect: another suspected drug.`,pct_C:`Concomitant: taken at the same time, not suspected.`,pct_I:`Interacting: suspected through an interaction.`,pct_DN:`Not administered: named in the report, not given.`};function Y(e){return`<dl class="metric-help">${e.map(e=>`<div><dt>${N(q[e]??e)}</dt><dd>${N(Ze[e]??``)}</dd></div>`).join(``)}</dl>`}async function Qe(){Z(`Data quality`),M.innerHTML=`<h1 tabindex="-1">From FDA files to counted cases</h1><p class="loading">Loading…</p>`;let t=me(await I(`json/dq_metrics.json`)),n=t.file_quarter??{},r=t.init_quarter??{},i=t.all??{},a=e=>i[e]?.ALL??{},o=a(`deduplication`),s=a(`rxnorm_coverage`),c=e=>e?x(e.value,e.unit):`—`,l=[[`Case versions loaded`,`All versions in the FAERS files ${e.first_quarter} to ${e.last_quarter}.`,c(o.demo_rows)],[`Superseded versions removed`,`A case keeps only its latest version.`,c(o.superseded_versions_removed)],[`Deleted cases removed`,`Cases on the FDA deletion lists.`,c(o.deleted_cases_removed)],[`Cases counted`,`One per case ID: every count on this site.`,c(o.cases_after_deduplication)],[`PS/SS drug lines mapped to RxNorm`,`Exact ${c(s.pct_lines_exact)}, normalized ${c(s.pct_lines_normalized_layer)}; no match ${c(s.pct_lines_fallback)}.`,c(s.signal_role_lines)]],u=[`demo`,`drug`,`reac`,`outc`,`indi`],d=[`demo_rows`,`distinct_caseids`,`superseded_versions_removed`,`deleted_cases_removed`,`cases_after_deduplication`,`pct_duplicate_rows_removed`,`pct_demo_rows_removed_total`],f=[`demo_rows`,`winning_versions`,`deleted_ids_listed`,`deleted_ids_found_in_demo`],p=[`signal_role_lines`,`pct_lines_exact`,`pct_lines_normalized_layer`,`pct_lines_fallback`,`generic_fallback_lines`],m=[`cases`,`pct_cases_reporter_country_missing`,`pct_cases_age_missing`,`pct_cases_sex_unknown`,`pct_cases_event_date_missing`,`pct_drug_lines_without_prod_ai`,`pct_reaction_lines_without_pt`],h=[`pct_PS`,`pct_SS`,`pct_C`,`pct_I`,`pct_DN`];M.innerHTML=`
    <section class="page-head">
      <p class="kicker">Data quality</p>
      <h1 tabindex="-1">From FDA files to counted cases</h1>
      <p class="lede">Measured by the pipeline on every build (dbt model <code>mart_dq_metrics</code>).
        File quarter is the FAERS file a row came from; first-receipt quarter is when the FDA first
        received the case.</p>
    </section>
    <section aria-labelledby="steps-h">
      <h2 id="steps-h">The steps, in all loaded files</h2>
      <ol class="dq-steps">${l.map(([e,t,n],r)=>`<li><span class="n" aria-hidden="true">${r+1}</span><div class="dq-step"><h3>${N(e)}</h3><p>${N(t)}</p></div><p class="dq-val">${n}</p></li>`).join(``)}</ol>
      <p class="help" id="checks-help">Checks behind these numbers: each new build is reconciled with
        the lake before it replaces the previous one (case, drug, reaction and outcome row counts
        recomputed outside dbt; any difference keeps the previous warehouse). Approximate RxNorm
        matching is off, after a calibration on a manually labelled sample. Only PS and SS drug
        lines count, and a pair is kept only with at least 3 cases (a ≥ 3). Details on the
        <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>
    <section aria-labelledby="raw-h"><h2 id="raw-h">Raw rows per file</h2>
      ${J(`Rows loaded per FAERS file quarter`,n.raw_rows??{},u,`File quarter`)}
      ${Y(u)}
    </section>
    <section aria-labelledby="dedup-h"><h2 id="dedup-h">Deduplication</h2>
      <p>A case keeps only its latest version; cases in the FDA deletion lists are removed.</p>
      ${Xe(`All loaded files`,o,d)}
      ${J(`Per FAERS file quarter`,n.deduplication??{},f,`File quarter`)}
      <p class="help" id="deleted-help">Deleted ids found in loaded cases: an id can appear in more
        than one deletion list, so the per-file sum can exceed the number of removed cases;
        "—" means none found.</p>
      ${Y([...d,...f.slice(1)])}
    </section>
    <section aria-labelledby="rx-h"><h2 id="rx-h">RxNorm coverage of drug names</h2>
      <p>Share of primary and secondary suspect (PS/SS) drug lines by match type. Names without a
        match stay as their own ingredient (fallback).</p>
      ${J(`Per first-receipt quarter, and all cases`,{...r.rxnorm_coverage,ALL:s},p,`Quarter`)}
      ${Y(p)}
    </section>
    <section aria-labelledby="miss-h"><h2 id="miss-h">Missing values</h2>
      ${J(`Share of cases (or lines) per first-receipt quarter`,{...r.missing_values,ALL:a(`missing_values`)},m,`Quarter`)}
      <p class="help">Reporter country counts "COUNTRY NOT SPECIFIED" as missing.</p>
      ${Y(m)}
    </section>
    <section aria-labelledby="role-h"><h2 id="role-h">Drug roles per file</h2>
      <p>Share of drug lines by role: PS primary suspect, SS secondary suspect, C concomitant,
        I interacting, DN not administered. Only PS and SS count for disproportionality, so a
        change in this mix changes the universe of each quarter.</p>
      ${J(`Share of drug lines per FAERS file quarter`,{...n.role_mix,ALL:a(`role_mix`)},h,`File quarter`)}
      ${Y(h)}
    </section>`,Q(`Data quality loaded`)}var $e={label_boxed_warning:`Boxed warning`,label_warning:`Warnings and precautions`,label_monitoring:`Monitoring, not a listed reaction`,label_not_listed:`Not listed in the label`};function et(e,t=!1){return e.expected===`positive`?t?`Stands out: at least 3 cases, PRR ≥ 2 and a ROR lower bound above 1`:`Stands out`:`Does not meet the Evans rule`}function X(e){return e.passed?`<span class="ok">As expected</span>`:`<span class="bad">Not as expected</span>${e.failure_reason?` (${N(e.failure_reason)})`:``}`}async function tt(){Z(`Validation`),M.innerHTML=`<h1 tabindex="-1">Validation against known pairs</h1><p class="loading">Loading…</p>`;let e=await I(`json/known_signals.json`),t=e.filter(e=>e.expected===`positive`),n=e.filter(e=>e.expected!==`positive`),r=(e,t)=>R(e,`<table class="known"><caption class="sr-only">${N(e)}</caption>
        <thead><tr><th scope="col">Ingredient</th><th scope="col">Reaction (PT)</th><th scope="col" class="num">Cases</th><th scope="col" class="num">PRR</th><th scope="col" class="num">ROR lower bound</th><th scope="col" class="num">χ²</th><th scope="col">Evans</th><th scope="col">Expected</th><th scope="col">Result</th><th scope="col">Reference</th></tr></thead>
        <tbody>${t.map(e=>`<tr>
              <th scope="row">${N(e.ingredient_name)}</th><td>${N(e.reaction_pt)}</td>
              ${P(e.a,l(e.a),`a`)}${P(e.prr,u(e.prr),`prr`)}${P(e.ror_lcl,u(e.ror_lcl),`ror_lcl`)}${P(e.chi2,u(e.chi2),`chi2`)}
              <td>${e.is_signal_evans?`Yes`:`No`}</td>
              <td class="expected">${et(e)}</td>
              <td data-field="passed">${X(e)}</td>
              <td>${N($e[e.reference_status]??e.reference_status??``)}<br><span class="muted">${N(e.reference??``)}</span></td>
            </tr>`).join(``)}</tbody></table>`),i=e.filter(e=>e.passed).length;M.innerHTML=`
    <section class="page-head">
      <p class="kicker">Validation</p>
      <h1 tabindex="-1">Validation against known pairs</h1>
      <p class="lede"><strong>${l(i)} of ${l(e.length)}</strong> reference pairs behave as
        expected in all loaded cases.</p>
      <p class="caution">A sanity check of the pipeline (drug-name mapping, deduplication, counting),
        not a validation of disproportionality as a method: it does not show that the method is right.</p>
    </section>
    <div class="plain-cols">
      <section class="plain-box" aria-labelledby="kinds-pos-h">
        <h2 id="kinds-pos-h">${l(t.length)} positive pairs</h2>
        <p>Pairs with an established association, each backed by its FDA label. Expected: at least 3
          cases, PRR ≥ 2 and a ROR lower bound above 1. A positive pair that stops standing out
          usually points to a regression in drug-name mapping, ingredient splitting or
          deduplication.</p>
      </section>
      <section class="plain-box" aria-labelledby="kinds-neg-h">
        <h2 id="kinds-neg-h">${l(n.length)} negative controls</h2>
        <p>Pairs the label does not list, chosen for clinical implausibility. Expected: not to meet
          the Evans rule. With large counts, a small excess can still put a control's ROR lower bound
          above 1.</p>
      </section>
    </div>
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
      <p class="help">How the checks fail or warn a build, and the other layers of validation, are on
        the <a href="#/method">Method &amp; limitations</a> page.</p>
    </section>`,Q(`Validation loaded`)}var nt=`What the numbers on this site mean`;async function rt(){Z(`Method & limitations`),M.innerHTML=`<h1 tabindex="-1">${nt}</h1><p class="loading">Loading…</p>`;let{lead:e,sections:n,plain:r}=await be(async()=>{let{lead:e,sections:t,plain:n}=await import(`./limitations-BcvRJ3CE.js`);return{lead:e,sections:t,plain:n}},[],import.meta.url),i=e=>e.map(e=>`<li>${N(e)}</li>`).join(``),a=`<a href="${N(t.site.repo_url)}/blob/main/docs/limitations.md" rel="noopener"><code>docs/limitations.md</code></a>`;M.innerHTML=`
    <section class="page-head">
      <p class="kicker">Method &amp; limitations</p>
      <h1 tabindex="-1">${nt}</h1>
      <p class="lede">${N(r.intro)}</p>
    </section>
    <div class="plain-cols">
      <section aria-labelledby="can-h" class="plain-box">
        <h2 id="can-h">What this can tell you</h2>
        <ul class="plain-list">${i(r.can)}</ul>
      </section>
      <section aria-labelledby="cannot-h" class="plain-box">
        <h2 id="cannot-h">What this cannot tell you</h2>
        <ul class="plain-list">${i(r.cannot)}</ul>
      </section>
    </div>
    <section aria-labelledby="proof-h" class="plain-sec">
      <h2 id="proof-h">Why a larger share is not proof</h2>
      <p>${N(r.not_proof.intro)}</p>
      <ul class="plain-list">${i(r.not_proof.reasons)}</ul>
    </section>
    <section aria-labelledby="read-h" class="plain-sec">
      <h2 id="read-h">How to read a pair in 30 seconds</h2>
      <ol class="read-steps">${i(r.read_pair)}</ol>
    </section>
    <section aria-labelledby="gloss-h" class="plain-sec">
      <h2 id="gloss-h">Glossary</h2>
      <dl class="glossary">${r.glossary.map(e=>`<div><dt>${N(e.term)}</dt><dd>${N(e.definition)}</dd></div>`).join(``)}</dl>
    </section>
    <section aria-labelledby="method-limitations" class="doc">
      <h2 id="method-limitations">Method &amp; limitations</h2>
      <p class="help">The detailed method and its limits, from ${a}. The operational limits of the
        pipeline are in that file in the repository.</p>
      <article class="prose">${e}${n}</article>
    </section>`,Q(`Method and limitations loaded`)}function it(e){return e>=1e6?`${(e/1e6).toFixed(1)} MB`:e>=1e3?`${Math.round(e/1e3)} KB`:`${e} B`}function at(){Z(`Downloads`);let n=t.parquet.map(e=>{let n=e.path.replace(/^parquet\//,``).replace(/\.parquet$/,``),r=t.downloads[n]??{description:``,columns:{}},i=Object.entries(r.columns).map(([e,t])=>`<tr><th scope="row"><code>${N(e)}</code></th><td>${N(t)}</td></tr>`).join(``);return`<section class="dl-file" aria-labelledby="dl-${n}">
        <h2 id="dl-${n}"><code>${N(n)}.parquet</code></h2>
        <p>${N(r.description)}</p>
        <p class="dl-action"><a class="btn" href="data/${N(e.path)}" download>Download ${N(n)}.parquet</a>
          <span class="dl-meta">${it(e.bytes)}, Parquet with zstd compression</span></p>
        <p class="help">sha256 <code class="hash">${N(e.sha256)}</code></p>
        <details><summary>Columns of ${N(n)}</summary>
          ${R(`Columns of ${n}`,`<table class="columns"><thead><tr><th scope="col">Column</th><th scope="col">Description</th></tr></thead><tbody>${i}</tbody></table>`)}
        </details>
      </section>`}).join(``);M.innerHTML=`
    <section class="page-head">
      <p class="kicker">Open data</p>
      <h1 tabindex="-1">Downloads</h1>
      <p class="lede">The ingredient list and the data-quality metrics of this site, as open
        data. Exported ${N(e.export_date)} (UTC) from the build with data through
        ${N(e.last_quarter)}. Tables with reaction terms are not offered for download:
        the terms are MedDRA terms, owned by ICH.</p>
    </section>
    <p class="meddra callout">${N(t.site.meddra_notice)}</p>
    <div class="dl-files">${n}</div>
    <p class="help">Any Parquet reader opens these files, for example DuckDB:
      <code>select ingredient_name, n_cases_ps_ss from 'ingredients.parquet' order by n_cases_ps_ss desc limit 10</code>.</p>`}function Z(e){document.title=`${e} · ${Se}`}function Q(e){xe.textContent=e}function ot(e){let t={home:`#/`,ingredient:`#/`,pair:`#/`}[e]??`#/${e}`;for(let e of document.querySelectorAll(`nav a`))e.getAttribute(`href`)===t?e.setAttribute(`aria-current`,`page`):e.removeAttribute(`aria-current`)}var st=!0;async function $(){let e=oe(location.hash);ot(e.page);try{e.page===`home`?await De():e.page===`ingredient`?await Le(e.slug):e.page===`pair`?await Ye(e.slug,e.reactionKey):e.page===`quality`?await Qe():e.page===`validation`?await tt():e.page===`method`?await rt():e.page===`downloads`?at():U(`There is no page at this address.`)}catch(e){console.error(e),Z(`Error`),M.innerHTML=`<h1 tabindex="-1">Could not load the data</h1><p>${N(e.message)}</p><p><a href="#/">Back to the search</a></p>`}st||(window.scrollTo(0,0),M.querySelector(`h1`)?.focus({preventScroll:!0})),st=!1}function ct(){let e=document.documentElement,t=document.getElementById(`theme-toggle`),n=t.querySelector(`.theme-label`),r=()=>{let r=e.dataset.theme===`dark`?`light`:`dark`;n.textContent=r===`dark`?`Dark`:`Light`,t.setAttribute(`aria-label`,`Switch to ${r} theme`)},i=null;try{i=localStorage.getItem(`theme`)}catch{i=null}matchMedia(`(prefers-color-scheme: dark)`).addEventListener?.(`change`,t=>{i!==`light`&&i!==`dark`&&(e.dataset.theme=t.matches?`dark`:`light`,r())}),t.addEventListener(`click`,()=>{e.dataset.theme=e.dataset.theme===`dark`?`light`:`dark`,i=e.dataset.theme;try{localStorage.setItem(`theme`,i)}catch{}r(),Q(`${i===`dark`?`Dark`:`Light`} theme`)}),r(),t.hidden=!1}function lt(){let e=document.getElementById(`menu-toggle`),t=document.getElementById(`site-nav`),n=n=>{t.classList.toggle(`open`,n),e.setAttribute(`aria-expanded`,String(n))};e.addEventListener(`click`,()=>n(e.getAttribute(`aria-expanded`)!==`true`)),t.addEventListener(`click`,e=>e.target.closest(`a`)&&n(!1)),e.hidden=!1}ct(),lt(),window.addEventListener(`hashchange`,$),document.querySelector(`.skip`).addEventListener(`click`,e=>{e.preventDefault(),M.focus()}),$();