# Known limitations

## RxNorm normalization of drug names

FAERS drug names (cleaned `PROD_AI`) are mapped to RxNorm ingredients (IN) with the NLM RxNav
API (`rxnorm_enrich` DAG, `config/rxnorm.yaml`). The policy favours precision over coverage: a
wrong ingredient creates false disproportionality signals, while a name left unmapped only
splits counts.

### Approximate matching is off

RxNav's approximate search (`getApproximateMatch`) was calibrated on a manually labelled sample
(`data/spikes/rxnorm_calibration_sample.csv`, 2026-10-26). Of 20 approximate matches from RxNorm
sources that resolve to an ingredient, 6 were correct. The score does not separate right from
wrong matches: wrong matches scored 8.0 to 12.9 and 20.7, right ones 10.1 to 15.3. Typical
errors were a different substance with a similar name (prulifloxacin → orbifloxacin,
empegfilgrastim → lipegfilgrastim, nimotuzumab → inotuzumab ozogamicin) and the counter-ion of
a salt instead of the drug (dexamethasone sodium succinate → sodium succinate, teneligliptin
hydrobromide → hydrobromic acid). `approximate_rules.min_score` is therefore `null`: names
without an exact or normalized match stay as fallback ingredients (`FB:<text>`).

In the calibration sample, exact and normalized matches were correct in 20 of 20 rows.

### Ambiguous exact matches are not resolved

When the exact (or normalized) search returns several RxCUIs whose ingredients differ, the term
is left as `not_found` and falls back to its own text. Examples: KARAYA GUM (karaya gum / karaya
gum extract), METHIONINE (methionine / racemethionine), SPEARMINT (spearmint extract / spearmint
allergenic extract), ARABICA COFFEE BEAN (Coffea arabica seed extract / arabica coffee bean
allergenic extract). A rule that accepts the single candidate whose name equals the term
(ignoring case) was tested and not adopted: it resolves only KARAYA GUM and METHIONINE, and it
moved about 27 PS/SS drug lines from fallback to normalized in the names looked up at the time
of the test.

### Generic terms

Some reports name a class of products instead of an ingredient (HERBALS, VITAMINS, MINERALS,
DIETARY SUPPLEMENT, UNSPECIFIED INGREDIENT, DEVICE). They have no single RxNorm ingredient and stay as
fallback ingredients; `dim_ingredient` flags them with `is_generic_fallback`, from the
editable list `generic_terms` in `config/rxnorm.yaml`.

### Measured coverage

In the build of 2026-10-26, 99.05% of the 7,182,171 PS/SS drug lines map to RxNorm ingredients
(exact 98.98%, normalized 0.07%); 0.95% are fallback (`signals.mart_dq_rxnorm_coverage`).
Keeping approximate matches off leaves some real drugs as fallback, for example PANTOPRAZOLE
MAGNESIUM, AZTREONAM LYSINE and ASPIRIN DL-LYSINE, whose salt forms have no exact or normalized
match in RxNorm.

### Salt and counter-ion stripping is not applied

A rule that removes trailing salt or counter-ion words from a name and repeats the exact search
on the remainder was tested on the 50 fallback names with the most PS/SS lines (2026-10-26, 25
real lookups) and not adopted. The word list came from the data: final words of names that
matched, which RxNorm dropped from the ingredient name (for example BESYLATE in AMLODIPINE
BESYLATE → amlodipine).

- With a strict list (44 words seen in at least 5 matched names), 2 names resolve (PANTOPRAZOLE
  SODIUM ANHYDROUS → pantoprazole, CITALOPRAM HYDROCHLORIDE → citalopram), about 2,100 PS/SS
  lines.
- With a loose list (312 words seen at least once), 7 names resolve, 9,464 PS/SS lines,
  including PANTOPRAZOLE MAGNESIUM, AZTREONAM LYSINE and HYDROXYCHLOROQUINE DIPHOSPHATE, but
  also wrong or over-specific matches: removing "NOS" (not otherwise specified) maps INSULIN NOS
  to regular human insulin and IMMUNE GLOBULIN NOS to immunoglobulin G.

The gain is small next to the 7.18 million PS/SS lines, and the loose list adds errors of the
kind the precision-first policy exists to avoid. Names in the salt forms above stay as fallback
ingredients; a signal can be split between such a fallback and the reference ingredient.

### Other effects of the mapping

- **Combinations.** A `PROD_AI` with several ingredients separated by a backslash maps to one
  row per ingredient. Counts of cases per ingredient must use distinct cases; counting rows
  overstates them (tested in dbt).
- **Partial combinations.** When only some parts of a combination match, the matched parts
  keep their RxNorm ingredient and each unmatched part becomes `FB:<part>`.
- **Salts, prodrugs and biosimilars** are grouped in the reference ingredient by RxNorm's own
  relations (for example amlodipine besylate → amlodipine, foscarbidopa → carbidopa). The
  original text is kept for audit.
- **Scope.** Only names that appear with a suspect role (PS, SS; `config/signals.yaml`) are
  looked up. Names used only as concomitant, interacting or not administered stay as fallback.
  Drug lines without `PROD_AI` use the reported drug name, which is not looked up.
- **Version.** Every lookup is stamped with the RxNorm release it used. The cache has no
  automatic expiry; refreshing it after a new RxNorm release is a manual decision.

## Signals (PRR, ROR)

`signals.mart_signals` measures disproportionality: whether a reaction is reported more often
with an ingredient than with all other drugs in FAERS. It does not measure incidence or risk,
and a signal is a hypothesis for review, not evidence that the drug causes the reaction.

### Method

For each period (each quarter of the window by `quarter_key`, and `ALL` with every loaded
case) and each pair (ingredient, MedDRA preferred term), a 2×2 table of distinct cases:

| | with the reaction | without the reaction |
|---|---|---|
| with the ingredient (PS or SS) | a | b |
| without the ingredient | c | d |

`n_drug`, `n_reac` and `n_total` are counted over all cases of the period, so
a + b + c + d = `n_total` in every row (tested). A case with a combination product counts once
for each of its ingredients; counts are always distinct cases, never drug or reaction lines.
Only pairs with at least `signal_min_cases` cases (3) are stored.

- PRR = [a/(a+b)] / [c/(c+d)]; 95% CI exp(ln PRR ± 1.96·SE), SE = √(1/a − 1/(a+b) + 1/c − 1/(c+d)).
- ROR = ad/(bc); 95% CI exp(ln ROR ± 1.96·SE), SE = √(1/a + 1/b + 1/c + 1/d).
- χ² = N(ad − bc)² / [(a+b)(c+d)(a+c)(b+d)], Pearson, 1 degree of freedom, no continuity
  correction.
- Evans criterion (`is_signal_evans`): a ≥ 3, PRR ≥ 2, χ² ≥ 4. ROR criterion (`is_signal_ror`):
  a ≥ 3 and lower bound of the ROR 95% CI > 1. Thresholds and z live in `config/signals.yaml`.
- PRR is undefined when c = 0 and ROR when b, c or d is 0; such rows are kept with null values
  and `is_computable = false`.

Sources:

- Evans SJW, Waller PC, Davis S. Use of proportional reporting ratios (PRRs) for signal
  generation from spontaneous adverse drug reaction reports. *Pharmacoepidemiology and Drug
  Safety* 2001;10(6):483–486. doi:10.1002/pds.677. Criterion as stated in the abstract: "3 or
  more cases, PRR at least 2, chi-squared of at least 4". The abstract does not say whether the
  chi-squared uses a continuity (Yates) correction; the full text was not available, so the
  uncorrected statistic used here is not confirmed against it.
- van Puijenbroek EP, Bate A, Leufkens HGM, Lindquist M, Orre R, Egberts ACG. A comparison of
  measures of disproportionality for signal detection in spontaneous reporting systems for
  adverse drug reactions. *Pharmacoepidemiology and Drug Safety* 2002;11(1):3–10.
  doi:10.1002/pds.668. Reporting odds ratio and the use of the lower 1.96·SE bound.
- The standard errors on the log scale are the usual large-sample formulas for a risk ratio
  and an odds ratio; the PRR form above matches published tables of disproportionality
  formulas. They were checked against an independent computation in plain Python (dbt test
  `assert_signal_statistics_known_values` and a recalculation of two real pairs).

### Continuity correction (Yates)

Because the Evans paper may have used a continuity-corrected χ², the Evans flag was also
computed with Yates' correction, χ² = N(max(|ad − bc| − N/2, 0))² / [(a+b)(c+d)(a+c)(b+d)],
in a one-off analysis on the build of 2026-10-26 (the mart was not changed):

| Period | a band | Evans pairs (uncorrected) | Evans pairs (Yates) | Lose the flag | Share lost |
|---|---|---|---|---|---|
| `ALL` | a < 10 | 208,813 | 194,444 | 14,369 | 6.9% |
| `ALL` | a ≥ 10 | 205,913 | 205,910 | 3 | 0.001% |
| `2025Q4` | a < 10 | 72,471 | 68,765 | 3,706 | 5.1% |
| `2025Q4` | a ≥ 10 | 38,375 | 38,375 | 0 | 0% |

No pair gains the flag with the correction (it can only lower χ²). Overall 3.5% of the Evans
pairs in `ALL` (14,372 of 414,726) and 3.3% in `2025Q4` would lose it, all but 3 of them with
a < 10, most with a = 3 to 5. The choice matters only for pairs with few cases, which the other
two criteria (a ≥ 3, PRR ≥ 2) already make fragile; the ROR criterion does not use χ².

### Limits of the signals

- **Many signals.** With a ≥ 3, about 61% of the stored pairs in `ALL` meet the Evans criterion
  (414,726 of 674,947 in the build of 2026-10-26). The criteria screen; they do not confirm.
- **Reporting artefacts.** Clusters of reports (litigation, publicity, one reporter submitting
  many cases) produce strong disproportionality without a pharmacological cause. See
  "Patterns seen in the top pairs" below.
- **Confounding by indication and co-medication.** A drug is reported with the reactions of
  the disease it treats and of the drugs it is given with.
- **Multiplicity.** Hundreds of thousands of pairs are tested per period; with a 95% interval,
  chance alone produces many lower bounds above 1.
- **Provisional quarter.** The most recent quarter's cohort still grows as later files are
  loaded (`is_provisional_period`).
- **Fallback ingredients.** Names without an RxNorm match are their own ingredient
  (`match_type = 'fallback'`); a signal can be split between a fallback text and the RxNorm
  ingredient. Generic fallbacks (`is_generic_fallback`) are excluded from `mart_signals_top`.

### Patterns seen in the top pairs

A review of the first 10 pairs of `mart_signals_top` (by `ror_lcl`) for atorvastatin,
dupilumab and tirzepatide in the build of 2026-10-26 found three patterns. They are recorded
as observations, not as conclusions about the drugs, and nothing in the marts corrects for them.

- **Long reports repeated across reactions.** Four atorvastatin pairs (Vaginal flatulence,
  Neurologic neglect syndrome, Carotid artery thrombosis, Heart sounds; 249 distinct cases
  together) come 96–100% from one reporter country (CA), with a median of 30 to 53 reactions
  and of 34 suspect ingredients per case; 118 of the 249 cases carry two of these PTs. The
  cases are spread over many init quarters (no quarter above 22%). Long reports, each listing
  dozens of reactions and drugs, raise many rare PTs at once.
- **Confounding by indication.** Dupilumab's top pairs are mostly the condition it treats and
  related terms (Dermatitis atopic, Eczema, Rebound atopic dermatitis, Neurodermatitis). The
  country and quarter mix of these pairs matches the drug's own mix, so they are not clusters.
- **Product errors reported by consumers, concentrated in time.** Tirzepatide's top pairs are
  mostly product use and medication error terms (Intercepted product selection error, Extra
  dose administered, Product tampering), reported mainly by consumers. Some are concentrated in
  one or two quarters: 88% of "Intercepted product selection error" cases in 2026Q1–2026Q2, 92%
  of "Drug titration issue" cases in 2026Q2.

`mart_signals_top` carries columns that help spot these patterns, computed over the pair's
cases: `top_country` and `top_country_share` (blank and placeholder countries left out),
`top_quarter` and `top_quarter_share` (init quarter), and `median_reactions_per_case`. A high
share is not a cluster by itself: most FAERS reports come from the US, and 33,542 of the
61,618 rows have one country at 90% or more. The share is informative when it differs from the
ingredient's own country mix, or together with a high `median_reactions_per_case`.

The public site marks a pair as concentrated when it has at least 10 reports and 80% or more of
them share one init quarter, or when its reports list a median of 40 or more reactions each
(`config/site.yaml` `concentration_alert`). The minimum of 10 reports keeps pairs with 3 to 7
reports, where one quarter easily holds all of them, out of the quarter rule. On the export of
2026-10-27 the rule flags 19.1% of the 61,618 rows; a first version (80% without a minimum,
median of 20) flagged 42.1%. The country share is shown but is not part of the
alert, for the reason above. The alert is a prompt to look closer, not a correction: the pair's
PRR and ROR are shown unchanged.

### Validation against known pairs

`seed_known_signals` lists pairs chosen by the project owner: 9 positive pairs with an
established association and 3 negative controls. `signals.mart_known_signals_eval` compares
them with `mart_signals` in `ALL`. A positive passes with a ≥ 3, PRR ≥ 2 and `ror_lcl` > 1; a
negative control passes when it is not an Evans signal. Names must match a non-fallback
ingredient and a PT exactly; nothing is remapped when they do not.

The two kinds of pair are tested with different severities:

- **Positives: error.** `assert_known_positive_signals_detected` fails the build when a positive
  pair fails. A full build then keeps the previous warehouse (the atomic swap does not happen),
  because a lost positive usually points to a regression in drug-name mapping, ingredient
  splitting or deduplication.
- **Negative controls: warn.** `assert_known_negative_controls_not_flagged` reports a negative
  control that becomes an Evans signal, and the build still completes. New quarters can move a
  pair with a small excess over the threshold, so a flagged control is a finding to review, not
  a reason to hold the data back.

The negative controls were chosen for clinical implausibility. An earlier grid of frequent
symptomatic PTs was dropped because most of its terms appear in the labels of almost every
drug. With three controls, this is a sanity check, not a validation of specificity.

Build of 2026-10-26: 12 of 12 pass. The 9 positives have PRR from 11.9 (clozapine–
Agranulocytosis) to 397.5 (warfarin–International normalised ratio increased). The negative
controls have PRR 0.997 (atorvastatin–Pneumonia), 1.36 (metformin–Cough) and 1.42
(albuterol–Constipation). Metformin–Cough and albuterol–Constipation still have `ror_lcl`
above 1 (1.23 and 1.30) and so meet the ROR criterion, though not the Evans one: with large
counts, a small excess is significant without being strong. The references of the pairs
(`reference`) are still to be filled in by the owner (`reference_status =
pending_user_confirmation`).

## Operational limits

- **Failure callback on a hard kill.** Every task has a failure callback that writes a marker
  file (`logs/failures/`). It was tested with tasks that raise an error, not with a process killed
  by the operating system (out of memory, SIGKILL); whether Airflow runs the callback then was
  not verified.
- **Atomic file swaps on a Windows bind mount.** The warehouse build and the site export are
  swapped in with `os.replace`. It worked in every run, but the atomicity of a rename on a
  Windows folder mounted into Docker is not guaranteed by the documentation of either. Folder
  renames there failed once with "Permission denied" (a host process probably still held a
  file); the export now retries the rename a few times, and a failed swap keeps the previous
  export.
- **An ingestion started during a build is not blocked.** `faers_transform` waits while
  `faers_ingest` or `rxnorm_enrich` runs, but not the other way round. This is accepted: the
  reconciliation step after each build compares the lake with the warehouse and fails on any
  divergence. Do not start a backfill while a build runs (runbook).
- **Provisional latest quarter.** The cohort of the most recent quarter keeps growing as later
  files arrive (see "Limits of the signals").
- **Combination products and fallback names.** A case with a combination product counts once
  for each ingredient, and names without an RxNorm match form their own ingredient (see "Other
  effects of the mapping" and "Measured coverage").

## MedDRA terms

Reaction terms are MedDRA® Preferred Terms as reported in FDA FAERS. MedDRA® is a registered
trademark of ICH. This project does not distribute MedDRA: it adds no MedDRA codes, versions or
hierarchy, only the term text found in the FDA files. Whether publishing these terms, on the
pages and in the Parquet downloads, needs a MedDRA licence has not been confirmed; the decision
and the plan (remove the Parquet downloads if a licence is required for the list of terms) are
in ADR 0004 (`docs/adr/0004-meddra-terms.md`).
