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

### Limits of the signals

- **Many signals.** With a ≥ 3, about 61% of the stored pairs in `ALL` meet the Evans criterion
  (414,726 of 674,947 in the build of 2026-10-26). The criteria screen; they do not confirm.
- **Reporting artefacts.** Clusters of reports (litigation, publicity, one reporter submitting
  many cases) produce strong disproportionality without a pharmacological cause.
- **Confounding by indication and co-medication.** A drug is reported with the reactions of
  the disease it treats and of the drugs it is given with.
- **Multiplicity.** Hundreds of thousands of pairs are tested per period; with a 95% interval,
  chance alone produces many lower bounds above 1.
- **Provisional quarter.** The most recent quarter's cohort still grows as later files are
  loaded (`is_provisional_period`).
- **Fallback ingredients.** Names without an RxNorm match are their own ingredient
  (`match_type = 'fallback'`); a signal can be split between a fallback text and the RxNorm
  ingredient. Generic fallbacks (`is_generic_fallback`) are excluded from `mart_signals_top`.
