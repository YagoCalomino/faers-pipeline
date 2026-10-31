var e=`<p>A <em>report</em> is one version of a FAERS case as submitted to the FDA; a <em>case</em> is one FAERS case ID,
counted once through its latest report after deduplication, and every count of the ingredient
and pair pages (including a, b, c and d) is a count of cases.</p>
<h2>Signals (PRR, ROR)</h2>
<p><code>signals.mart_signals</code> measures disproportionality: whether a reaction is reported more often
with an ingredient than with all other drugs in FAERS. It does not measure incidence or risk,
and a signal is a hypothesis for review, not evidence that the drug causes the reaction.
In this project a &quot;signal&quot; means a signal of disproportionate reporting (SDR): a statistical
hypothesis for review, not a confirmed safety signal.</p>
<h3>Method</h3>
<p>For each period (each quarter of the window by <code>quarter_key</code>, and <code>ALL</code> with every loaded
case) and each pair (ingredient, MedDRA preferred term), a 2×2 table of distinct cases:</p>
<div class="table-scroll" role="region" aria-label="Method" tabindex="0"><table>
<thead>
<tr>
<th></th>
<th>with the reaction</th>
<th>without the reaction</th>
</tr>
</thead>
<tbody><tr>
<td>with the ingredient (PS or SS)</td>
<td>a</td>
<td>b</td>
</tr>
<tr>
<td>without the ingredient</td>
<td>c</td>
<td>d</td>
</tr>
</tbody></table></div>
<p><code>n_drug</code>, <code>n_reac</code> and <code>n_total</code> are counted over all cases of the period, so
a + b + c + d = <code>n_total</code> in every row (tested). A case with a combination product counts once
for each of its ingredients; counts are always distinct cases, never drug or reaction lines.
Only pairs with at least <code>signal_min_cases</code> cases (3) are stored.</p>
<ul>
<li>PRR = [a/(a+b)] / [c/(c+d)]; 95% CI exp(ln PRR ± 1.96·SE), SE = √(1/a − 1/(a+b) + 1/c − 1/(c+d)).</li>
<li>ROR = ad/(bc); 95% CI exp(ln ROR ± 1.96·SE), SE = √(1/a + 1/b + 1/c + 1/d).</li>
<li>χ² = N(ad − bc)² / [(a+b)(c+d)(a+c)(b+d)], Pearson, 1 degree of freedom, no continuity
correction.</li>
<li>Evans criterion (<code>is_signal_evans</code>): a ≥ 3, PRR ≥ 2, χ² ≥ 4. ROR criterion (<code>is_signal_ror</code>):
a ≥ 3 and lower bound of the ROR 95% CI &gt; 1. Thresholds and z live in <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/config/signals.yaml" rel="noopener"><code>config/signals.yaml</code></a>.</li>
<li>PRR is undefined when c = 0 and ROR when b, c or d is 0; such rows are kept with null values
and <code>is_computable = false</code>.</li>
</ul>
<p>Sources:</p>
<ul>
<li>Evans SJW, Waller PC, Davis S. Use of proportional reporting ratios (PRRs) for signal
generation from spontaneous adverse drug reaction reports. <em>Pharmacoepidemiology and Drug
Safety</em> 2001;10(6):483–486. doi:10.1002/pds.677. Criterion as stated in the abstract: &quot;3 or
more cases, PRR at least 2, chi-squared of at least 4&quot;. The abstract does not say whether the
chi-squared uses a continuity (Yates) correction; the full text was not available, so the
uncorrected statistic used here is not confirmed against it.</li>
<li>van Puijenbroek EP, Bate A, Leufkens HGM, Lindquist M, Orre R, Egberts ACG. A comparison of
measures of disproportionality for signal detection in spontaneous reporting systems for
adverse drug reactions. <em>Pharmacoepidemiology and Drug Safety</em> 2002;11(1):3–10.
doi:10.1002/pds.668. Reporting odds ratio and the use of the lower 1.96·SE bound.</li>
<li>The standard errors on the log scale are the usual large-sample formulas for a risk ratio
and an odds ratio; the PRR form above matches published tables of disproportionality
formulas. They were checked against an independent computation in plain Python (the
literals of the dbt test <code>assert_signal_statistics_known_values</code> are recomputed by
<a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/tests/unit/test_signal_known_values.py" rel="noopener"><code>tests/unit/test_signal_known_values.py</code></a>) and a recalculation of two real pairs.</li>
</ul>
<h3>Continuity correction (Yates)</h3>
<p>Because the Evans paper may have used a continuity-corrected χ², the Evans flag was also
computed with Yates&#39; correction, χ² = N(max(|ad − bc| − N/2, 0))² / [(a+b)(c+d)(a+c)(b+d)],
in a one-off analysis on the build of 2026-10-26 (the mart was not changed):</p>
<div class="table-scroll" role="region" aria-label="Continuity correction (Yates)" tabindex="0"><table>
<thead>
<tr>
<th>Period</th>
<th>a band</th>
<th>Evans pairs (uncorrected)</th>
<th>Evans pairs (Yates)</th>
<th>Lose the flag</th>
<th>Share lost</th>
</tr>
</thead>
<tbody><tr>
<td><code>ALL</code></td>
<td>a &lt; 10</td>
<td>208,813</td>
<td>194,444</td>
<td>14,369</td>
<td>6.9%</td>
</tr>
<tr>
<td><code>ALL</code></td>
<td>a ≥ 10</td>
<td>205,913</td>
<td>205,910</td>
<td>3</td>
<td>0.001%</td>
</tr>
<tr>
<td><code>2025Q4</code></td>
<td>a &lt; 10</td>
<td>72,471</td>
<td>68,765</td>
<td>3,706</td>
<td>5.1%</td>
</tr>
<tr>
<td><code>2025Q4</code></td>
<td>a ≥ 10</td>
<td>38,375</td>
<td>38,375</td>
<td>0</td>
<td>0%</td>
</tr>
</tbody></table></div>
<p>No pair gains the flag with the correction (it can only lower χ²). Overall 3.5% of the Evans
pairs in <code>ALL</code> (14,372 of 414,726) and 3.3% in <code>2025Q4</code> would lose it, all but 3 of them with
a &lt; 10, most with a = 3 to 5. The choice matters only for pairs with few cases, which the other
two criteria (a ≥ 3, PRR ≥ 2) already make fragile; the ROR criterion does not use χ².</p>
<h3>Limits of the signals</h3>
<ul>
<li><strong>Many signals.</strong> With a ≥ 3, about 61% of the stored pairs in <code>ALL</code> meet the Evans criterion
(414,726 of 674,947 in the build of 2026-10-26). The criteria screen; they do not confirm.</li>
<li><strong>Reporting artefacts.</strong> Clusters of reports (litigation, publicity, one reporter submitting
many cases) produce strong disproportionality without a pharmacological cause. See
&quot;Patterns seen in the top pairs&quot; below.</li>
<li><strong>Confounding by indication and co-medication.</strong> A drug is reported with the reactions of
the disease it treats and of the drugs it is given with.</li>
<li><strong>Multiplicity.</strong> Hundreds of thousands of pairs are tested per period; with a 95% interval,
chance alone produces many lower bounds above 1.</li>
<li><strong>Provisional quarter.</strong> The most recent quarter&#39;s cohort still grows as later files are
loaded (<code>is_provisional_period</code>).</li>
<li><strong>Fallback ingredients.</strong> Names without an RxNorm match are their own ingredient
(<code>match_type = &#39;fallback&#39;</code>); a signal can be split between a fallback text and the RxNorm
ingredient. Generic fallbacks (<code>is_generic_fallback</code>) are excluded from <code>mart_signals_top</code>.</li>
<li><strong>No Bayesian shrinkage.</strong> PRR and ROR are used instead of EBGM (MGPS) or BCPNN. Without
shrinkage, pairs with few cases are unstable (a few cases can give a very high ratio with a
wide interval); in exchange, each value follows from the four counts of the 2x2 table by a
closed formula and can be checked independently.</li>
<li><strong>Solicited and study reports are not filtered out.</strong> The pipeline does not filter by report
type or source: <code>rept_cod</code> is kept in the raw lake but not read by the staging models, so
solicited reports (for example from patient-support programs) and study reports count like
spontaneous ones.</li>
<li><strong>Masking.</strong> The comparison background is every other drug in FAERS. When a few heavily
reported drugs account for many reports of a reaction, those reports sit in the comparison
group of every other drug and lower their PRR and ROR for that reaction, which can hide a
disproportionality.</li>
<li><strong>Duplicates across reporters.</strong> Deduplication is by <code>caseid</code> only; the same event reported
separately by different reporters stays as separate cases.</li>
<li><strong>Cases first received before the window.</strong> The <code>ALL</code> period includes cases first received
before 2024Q3 (219,625 of 2,858,073 cases, 7.68%; ADR 0001) only because a later version of
them, a follow-up, is in one of the loaded files. Follow-up cases may differ from first-time
reports.</li>
</ul>
<h3>Patterns seen in the top pairs</h3>
<p>A review of the first 10 pairs of <code>mart_signals_top</code> (by <code>ror_lcl</code>) for atorvastatin,
dupilumab and tirzepatide in the build of 2026-10-26 found three patterns. They are recorded
as observations, not as conclusions about the drugs, and nothing in the marts corrects for them.</p>
<ul>
<li><strong>Long reports repeated across reactions.</strong> Four atorvastatin pairs (Vaginal flatulence,
Neurologic neglect syndrome, Carotid artery thrombosis, Heart sounds; 249 distinct cases
together) come 96–100% from one reporter country (CA), with a median of 30 to 53 reactions
and of 34 suspect ingredients per case; 118 of the 249 cases carry two of these PTs. The
cases are spread over many init quarters (no quarter above 22%). Long reports, each listing
dozens of reactions and drugs, raise many rare PTs at once.</li>
<li><strong>Confounding by indication.</strong> Dupilumab&#39;s top pairs are mostly the condition it treats and
related terms (Dermatitis atopic, Eczema, Rebound atopic dermatitis, Neurodermatitis). The
country and quarter mix of these pairs matches the drug&#39;s own mix, so they are not clusters.</li>
<li><strong>Product errors reported by consumers, concentrated in time.</strong> Tirzepatide&#39;s top pairs are
mostly product use and medication error terms (Intercepted product selection error, Extra
dose administered, Product tampering), reported mainly by consumers. Some are concentrated in
one or two quarters: 88% of &quot;Intercepted product selection error&quot; cases in 2026Q1–2026Q2, 92%
of &quot;Drug titration issue&quot; cases in 2026Q2.</li>
</ul>
<p><code>mart_signals_top</code> carries columns that help spot these patterns, computed over the pair&#39;s
cases: <code>top_country</code> and <code>top_country_share</code> (blank and placeholder countries left out),
<code>top_quarter</code> and <code>top_quarter_share</code> (init quarter), and <code>median_reactions_per_case</code>; and,
over all the ingredient&#39;s cases, <code>ingredient_top_country</code>, <code>ingredient_top_country_share</code> and
<code>ingredient_country_share</code> (the ingredient&#39;s share from the pair&#39;s <code>top_country</code>). A high
share is not a cluster by itself: most FAERS reports come from the US, and 33,542 of the
61,618 rows have one country at 90% or more. The share is informative when it differs from the
ingredient&#39;s own country mix, or together with a high <code>median_reactions_per_case</code>.</p>
<h3>Concentration alert</h3>
<p>The public site marks a pair as concentrated when any of three rules holds
(<a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/config/site.yaml" rel="noopener"><code>config/site.yaml</code></a> <code>concentration_alert</code>):</p>
<ul>
<li><strong>Quarter:</strong> at least 10 cases and 80% or more of them in one init quarter. The minimum of
10 keeps pairs with 3 to 7 cases, where one quarter easily holds all of them, out.</li>
<li><strong>Long reports:</strong> a median of 40 or more reactions in the reports of the pair&#39;s cases.</li>
<li><strong>Country:</strong> at least 10 cases, 90% or more of them from one country, and that country is
not the ingredient&#39;s most frequent country (blank and placeholder countries left out of
both). Comparing with the ingredient keeps the many pairs that are 90% from the US, like
their drug, out of the alert.</li>
</ul>
<p>The badge gives the reason, for example &quot;96% of cases from Canada (CA); ingredient: 8% CA&quot;.</p>
<p>The quarter and long-report rules missed the atorvastatin clusters described above: Vaginal
flatulence, Heart sounds, Neurologic neglect syndrome and Carotid artery thrombosis are 96–100%
from CA and Genital infection viral 100% from DE, while atorvastatin&#39;s most frequent country is
GB (27.5% of its cases; CA 8.3%, DE 2.3%); their quarter shares are 12–77% and only two have a
median of 40 reactions or more. The country rule flags all five.</p>
<p>Measured on the build of 2026-10-27 (61,618 rows):</p>
<div class="table-scroll" role="region" aria-label="Concentration alert" tabindex="0"><table>
<thead>
<tr>
<th>Rule set</th>
<th>Rows flagged</th>
<th>Top 10 ingredients by cases (291 rows)</th>
</tr>
</thead>
<tbody><tr>
<td>Quarter or long reports (before)</td>
<td>19.1%</td>
<td>30.9%</td>
</tr>
<tr>
<td>Country rule alone</td>
<td>6.7% (4,128)</td>
<td>17.5%</td>
</tr>
<tr>
<td>Quarter, long reports or country (current)</td>
<td>23.3%</td>
<td>35.4%</td>
</tr>
</tbody></table></div>
<p>The country rule adds 2,580 rows to the alert (4.2 points). In the top 10 ingredients it adds
13 rows (prednisone 5, acetaminophen 3, lenalidomide 3, semaglutide 1, methotrexate 1) and none
for dupilumab, tirzepatide, adalimumab, rituximab or risankizumab. Most of the top 10 share
comes from the other rules: before the country rule, adalimumab, rituximab and methotrexate
already had 23, 20 and 19 of their 30 pairs flagged.</p>
<p>An alternative was measured: the <strong>lift</strong> of the country, the pair&#39;s share from its top country
divided by the ingredient&#39;s share from the same country (<code>top_country_share / ingredient_country_share</code>), with at least 10 cases. Lift of 3, 5 or 10 flags, together with
the quarter and long-report rules, 29.4%, 25.3% and 22.2% of the rows; the five atorvastatin
pairs have lifts of 11.6 to 43. Lift also flags pairs that are not concentrated in one
country (palbociclib–Death: 36% of cases from MA, lift 8.8) unless a minimum share is added,
which makes two thresholds plus a ratio. The country rule is simpler to state and to show, and
was kept. Its blind spot: a pair concentrated in the ingredient&#39;s own most frequent country is
never flagged by it, however small that country&#39;s share of the ingredient (239 rows have 90% or
more of their cases there, at least three times the ingredient&#39;s share, and no other alert).
Only 3 rows flagged by the country rule have a lift below 2.</p>
<p>A first version of the alert (80% in one quarter without a minimum, median of 20) flagged 42.1%
of the rows. The alert is a prompt to look closer, not a correction: the pair&#39;s PRR and ROR are
shown unchanged.</p>
<h3>Validation against known pairs</h3>
<p><code>seed_known_signals</code> lists 9 positive pairs with an established association and 3 negative
controls. <code>signals.mart_known_signals_eval</code> compares
them with <code>mart_signals</code> in <code>ALL</code>. A positive passes with a ≥ 3, PRR ≥ 2 and <code>ror_lcl</code> &gt; 1; a
negative control passes when it is not an Evans signal. Names must match a non-fallback
ingredient and a PT exactly; nothing is remapped when they do not.</p>
<p>The two kinds of pair are tested with different severities:</p>
<ul>
<li><strong>Positives: error.</strong> <code>assert_known_positive_signals_detected</code> fails the build when a positive
pair fails. A full build then keeps the previous warehouse (the atomic swap does not happen),
because a lost positive usually points to a regression in drug-name mapping, ingredient
splitting or deduplication.</li>
<li><strong>Negative controls: warn.</strong> <code>assert_known_negative_controls_not_flagged</code> reports a negative
control that becomes an Evans signal, and the build still completes. New quarters can move a
pair with a small excess over the threshold, so a flagged control is a finding to review, not
a reason to hold the data back.</li>
</ul>
<p>The negative controls were chosen for clinical implausibility. An earlier grid of frequent
symptomatic PTs was dropped because most of its terms appear in the labels of almost every
drug. With three controls, this is a sanity check, not a validation of specificity.</p>
<p>Build of 2026-10-26: 12 of 12 pass. The 9 positives have PRR from 11.9 (clozapine–
Agranulocytosis) to 397.5 (warfarin–International normalised ratio increased). The negative
controls have PRR 0.997 (atorvastatin–Pneumonia), 1.36 (metformin–Cough) and 1.42
(albuterol–Constipation). Metformin–Cough and albuterol–Constipation still have <code>ror_lcl</code>
above 1 (1.23 and 1.30) and so meet the ROR criterion, though not the Evans one: with large
counts, a small excess is significant without being strong.</p>
<p>Each pair cites the FDA label behind its expected result (<code>reference</code>), and <code>reference_status</code>
says where the pair stands in that label: <code>label_boxed_warning</code> (7 positives), <code>label_warning</code>
(atorvastatin–Rhabdomyolysis), <code>label_monitoring</code> (warfarin–International normalised ratio
increased) or <code>label_not_listed</code> (the 3 negative controls). Three caveats:</p>
<ul>
<li>A negative control means the reaction is not listed in the label&#39;s adverse reactions, not
that the drug is proven not to cause it.</li>
<li>For warfarin, an increased INR is a monitoring result that the label anticipates, not an
adverse reaction listed in the label.</li>
<li>The references were read in copies of the FDA labels, consulted on 2026-10-29.</li>
</ul>
<h3>Layers of validation</h3>
<p>The numbers are checked in five places. Only the second is independent of the
warehouse: it runs in plain Python, without dbt, DuckDB or the warehouse. The third
recomputes counts from the Parquet lake with the same winner rule, outside dbt, then compares
them with the core facts of each new build before it is swapped in. The first, fourth and fifth read the marts that dbt builds: they check those marts
and what is exported from them, not a separate computation of the statistics.</p>
<ol>
<li><strong>dbt tests</strong> on every layer (<code>dbt/faers_dbt/models/**/_*.yml</code> and
<a href="https://github.com/YagoCalomino/faers-pipeline/tree/main/dbt/faers_dbt/tests" rel="noopener"><code>dbt/faers_dbt/tests/</code></a>), including <code>assert_signal_statistics_known_values.sql</code>, which
compares the PRR, ROR and χ² macros with literal values for six 2x2 tables. A full build is
swapped in only if every test passes and the reconciliation (3) finds no divergence.</li>
<li><strong>Independent recomputation of those literals</strong> in plain Python, without dbt or DuckDB
(<a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/tests/unit/test_signal_known_values.py" rel="noopener"><code>tests/unit/test_signal_known_values.py</code></a>).</li>
<li><strong>Reconciliation of the lake with the warehouse</strong> on each new build, before the swap
(<a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/src/faers_pipeline/reconcile.py" rel="noopener"><code>src/faers_pipeline/reconcile.py</code></a>, in <code>build_warehouse</code> of <code>faers_transform</code> and in
<code>make dbt-rebuild</code>): case and drug, reaction and outcome row counts recomputed from the
Parquet lake with the same winner rule, outside dbt; any divergence fails the build and keeps
the previous warehouse.</li>
<li><strong>Known pairs</strong> (<code>seed_known_signals</code>, <code>mart_known_signals_eval</code>), described above.</li>
<li><strong>Site numbers.</strong> <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/src/faers_pipeline/site_check.py" rel="noopener"><code>src/faers_pipeline/site_check.py</code></a> validates every export in the
<code>publish_site</code> DAG; <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/scripts/verify_site_values.py" rel="noopener"><code>scripts/verify_site_values.py</code></a> compares the exported JSON with a direct
DuckDB query and <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/site/tests/verify-values.mjs" rel="noopener"><code>site/tests/verify-values.mjs</code></a> compares the rendered pages with those
values.</li>
</ol>
<h2>RxNorm normalization of drug names</h2>
<p>FAERS drug names (cleaned <code>PROD_AI</code>) are mapped to RxNorm ingredients (IN) with the NLM RxNav
API (<code>rxnorm_enrich</code> DAG, <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/config/rxnorm.yaml" rel="noopener"><code>config/rxnorm.yaml</code></a>). The policy favours precision over coverage: a
wrong ingredient creates false disproportionality signals, while a name left unmapped only
splits counts.</p>
<h3>Approximate matching is off</h3>
<p>RxNav&#39;s approximate search (<code>getApproximateMatch</code>) was calibrated on a manually labelled sample
of 60 terms, versioned with its marks in <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/docs/calibration/rxnorm_calibration_sample.csv" rel="noopener"><code>docs/calibration/rxnorm_calibration_sample.csv</code></a>
(2026-10-26). Of 20 approximate matches from RxNorm sources that resolve to an ingredient, 6
were correct. The score does not separate right from
wrong matches: wrong matches scored 8.0 to 12.9 and 20.7, right ones 10.1 to 15.3. Typical
errors were a different substance with a similar name (prulifloxacin → orbifloxacin,
empegfilgrastim → lipegfilgrastim, nimotuzumab → inotuzumab ozogamicin) and the counter-ion of
a salt instead of the drug (dexamethasone sodium succinate → sodium succinate, teneligliptin
hydrobromide → hydrobromic acid). <code>approximate_rules.min_score</code> is therefore <code>null</code>: names
without an exact or normalized match stay as fallback ingredients (<code>FB:&lt;text&gt;</code>).</p>
<p>In the calibration sample, exact and normalized matches were correct in 20 of 20 rows. Of the
20 terms left as <code>not_found</code>, 17 were marked right and 3 wrong (ARABICA COFFEE BEAN, KARAYA
GUM, SPEARMINT: real substances whose two candidate RxCUIs may be synonyms; the marks record
this as a doubt).</p>
<h3>Ambiguous exact matches are not resolved</h3>
<p>When the exact (or normalized) search returns several RxCUIs whose ingredients differ, the term
is left as <code>not_found</code> and falls back to its own text. Examples: KARAYA GUM (karaya gum / karaya
gum extract), METHIONINE (methionine / racemethionine), SPEARMINT (spearmint extract / spearmint
allergenic extract), ARABICA COFFEE BEAN (Coffea arabica seed extract / arabica coffee bean
allergenic extract). A rule that accepts the single candidate whose name equals the term
(ignoring case) was tested and not adopted: it resolves only KARAYA GUM and METHIONINE, and it
moved about 27 PS/SS drug lines from fallback to normalized in the names looked up at the time
of the test.</p>
<h3>Generic terms</h3>
<p>Some reports name a class of products instead of an ingredient (HERBALS, VITAMINS, MINERALS,
DIETARY SUPPLEMENT, UNSPECIFIED INGREDIENT, DEVICE). They have no single RxNorm ingredient and stay as
fallback ingredients; <code>dim_ingredient</code> flags them with <code>is_generic_fallback</code>, from the
editable list <code>generic_terms</code> in <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/config/rxnorm.yaml" rel="noopener"><code>config/rxnorm.yaml</code></a>.</p>
<h3>Measured coverage</h3>
<p>In the build of 2026-10-26, 99.05% of the 7,182,171 PS/SS drug lines map to RxNorm ingredients
(exact 98.98%, normalized 0.07%); 0.95% are fallback (<code>signals.mart_dq_rxnorm_coverage</code>).
Keeping approximate matches off leaves some real drugs as fallback, for example PANTOPRAZOLE
MAGNESIUM, AZTREONAM LYSINE and ASPIRIN DL-LYSINE, whose salt forms have no exact or normalized
match in RxNorm.</p>
<h3>Salt and counter-ion stripping is not applied</h3>
<p>A rule that removes trailing salt or counter-ion words from a name and repeats the exact search
on the remainder was tested on the 50 fallback names with the most PS/SS lines (2026-10-26, 25
real lookups) and not adopted. The word list came from the data: final words of names that
matched, which RxNorm dropped from the ingredient name (for example BESYLATE in AMLODIPINE
BESYLATE → amlodipine).</p>
<ul>
<li>With a strict list (44 words seen in at least 5 matched names), 2 names resolve (PANTOPRAZOLE
SODIUM ANHYDROUS → pantoprazole, CITALOPRAM HYDROCHLORIDE → citalopram), about 2,100 PS/SS
lines.</li>
<li>With a loose list (312 words seen at least once), 7 names resolve, 9,464 PS/SS lines,
including PANTOPRAZOLE MAGNESIUM, AZTREONAM LYSINE and HYDROXYCHLOROQUINE DIPHOSPHATE, but
also wrong or over-specific matches: removing &quot;NOS&quot; (not otherwise specified) maps INSULIN NOS
to regular human insulin and IMMUNE GLOBULIN NOS to immunoglobulin G.</li>
</ul>
<p>The gain is small next to the 7.18 million PS/SS lines, and the loose list adds errors of the
kind the precision-first policy exists to avoid. Names in the salt forms above stay as fallback
ingredients; a signal can be split between such a fallback and the reference ingredient.</p>
<h3>Other effects of the mapping</h3>
<ul>
<li><strong>Combinations.</strong> A <code>PROD_AI</code> with several ingredients separated by a backslash maps to one
row per ingredient. Counts of cases per ingredient must use distinct cases; counting rows
overstates them (tested in dbt).</li>
<li><strong>Partial combinations.</strong> When only some parts of a combination match, the matched parts
keep their RxNorm ingredient and each unmatched part becomes <code>FB:&lt;part&gt;</code>.</li>
<li><strong>Salts, prodrugs and biosimilars</strong> are grouped in the reference ingredient by RxNorm&#39;s own
relations (for example amlodipine besylate → amlodipine, foscarbidopa → carbidopa). The
original text is kept for audit.</li>
<li><strong>Scope.</strong> Only names that appear with a suspect role (PS, SS; <a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/config/signals.yaml" rel="noopener"><code>config/signals.yaml</code></a>) are
looked up. Names used only as concomitant, interacting or not administered stay as fallback.
Drug lines without <code>PROD_AI</code> use the reported drug name, which is not looked up.</li>
<li><strong>Version.</strong> Every lookup is stamped with the RxNorm release it used. The cache has no
automatic expiry; refreshing it after a new RxNorm release is a manual decision.</li>
</ul>
<h2>MedDRA terms</h2>
<p>Reaction terms are MedDRA® Preferred Terms as reported in FDA FAERS. MedDRA® is a registered
trademark of the International Council for Harmonisation of Technical Requirements for
Pharmaceuticals for Human Use (ICH). This project does not distribute the MedDRA dictionary and
does not offer a downloadable dataset of MedDRA terms. Reaction terms (Preferred Terms) are
shown on the site pages as they appear in FAERS.
The decision and its residual risk are in ADR 0004 (<a href="https://github.com/YagoCalomino/faers-pipeline/blob/main/docs/adr/0004-meddra-terms.md" rel="noopener"><code>docs/adr/0004-meddra-terms.md</code></a>).</p>
`;export{e as html};