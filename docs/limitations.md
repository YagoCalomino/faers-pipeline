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
