# Data dictionary: core marts

Schemas `core` and `signals` of the DuckDB warehouse (`data/warehouse/faers.duckdb`), built by
dbt from the FAERS quarterly ASCII files loaded in the lake (8 quarters, 2024Q3 to 2026Q2) and
the RxNorm lookups of the `rxnorm_enrich` DAG (RxNorm release 05-Oct-2026). Row counts are
those of the build of 2026-10-26.

Lineage:

- `faers_raw` (Parquet, all text) → `staging` (typed views) → `intermediate` (deduplication:
  `int_faers__case_latest`, `int_faers__drug_latest`, `int_faers__reaction_latest`,
  `int_faers__outcome_latest`) → `core`. Facts read only from the `int_faers__*_latest` models.
- `rxnorm_raw` (Parquet: `term_lookup` cache, `name_map`) → `stg_rxnorm__name_map`,
  `stg_rxnorm__term_lookup` → `int_faers__drug_resolved` (`int_faers__drug_latest` ⨝ name map)
  → `dim_ingredient`; `bridge_drug_ingredient` (`dim_drug` ⨝ name map ⨝ `dim_ingredient`);
  `signals.mart_dq_rxnorm_coverage` (`int_faers__drug_resolved`, `fct_case`).
- Signals: `int_signals__drug_cases`, `int_signals__reaction_cases`, `fct_case`,
  `dim_ingredient`, `dim_reaction` → `signals.mart_signals` → `signals.mart_signals_top`;
  `seed_known_signals` ⨝ `mart_signals` → `signals.mart_known_signals_eval`;
  `signals.mart_dq_metrics` (staging, intermediate, core and `mart_dq_rxnorm_coverage`).

General conventions:

- A **case** is a FAERS `caseid`. FAERS publishes one row per case *version* (`primaryid`);
  the warehouse keeps the latest version of each case: highest `caseversion`, then latest
  `fda_dt`, then latest file quarter, then highest `primaryid`. Cases listed in any of the
  loaded "deleted cases" files are removed entirely.
- Child rows (drugs, reactions, outcomes) are joined to the winning version on
  (`primaryid`, `source_quarter`): the same `primaryid` can be republished in a later quarter.
- `quarter_key` of a case is the quarter of `init_fda_dt`, the first receipt by FDA
  (ADR 0001). `source_quarter` is the file quarter of the winning version (lineage only).
- Every dimension has an explicit unknown member (natural key `(unknown)`); fact foreign keys
  are never null.
- Surrogate keys (`drug_key`, `reaction_key`) are `dbt_utils.generate_surrogate_key` (MD5) of
  the natural key.

## Dimensions

### `dim_quarter`

Grain: one row per period. 139 rows: calendar quarters from the earliest `init_quarter` of the
loaded cases (1992Q2) to the window end (2026Q2), the period `ALL` and the unknown member.
Source: `int_faers__case_latest` (earliest quarter) and the dbt vars `window_start_quarter` /
`window_end_quarter` (from `config/faers.yaml`).

| Column | Type | Description |
|---|---|---|
| `quarter_key` | varchar | `YYYYQn`, `ALL` or `(unknown)`. Primary key. |
| `year` | bigint | Calendar year (null for `ALL` and unknown). |
| `quarter_number` | bigint | 1 to 4 (null for `ALL` and unknown). |
| `start_date` | date | First day of the quarter; for `ALL`, first day of the earliest quarter. |
| `end_date` | date | Last day of the quarter; for `ALL`, last day of the window. |
| `period_type` | varchar | `quarter`, `all` or `unknown`. |
| `is_in_window` | boolean | True for the quarters 2024Q3 to 2026Q2; null for `ALL`. |

`ALL` is the period of every loaded case, including cases first received before the window; it
is used by all-period aggregates and is not referenced by `fct_case`.

### `dim_drug`

Grain: one row per product active ingredient text. 10,029 rows (10,028 values and the unknown
member). Source: `int_faers__drug_latest`.

| Column | Type | Description |
|---|---|---|
| `drug_key` | varchar | Surrogate key of `prod_ai_clean`. Primary key. |
| `prod_ai_clean` | varchar | Natural key: FAERS `PROD_AI` in upper case, trimmed, inner spaces collapsed; `(unknown)` when empty. |
| `most_common_drug_name_raw` | varchar | Most frequent `DRUGNAME` reported with this `prod_ai` (ties broken alphabetically). |
| `n_drug_lines` | hugeint | DRUG lines of the winning versions with this `prod_ai`. |
| `is_unknown` | boolean | True for the unknown member. |

Caveats: salts, combinations and spelling variants are separate members; their RxNorm
ingredients are reached through `bridge_drug_ingredient`. 216,354 drug lines (1.85%) have no
`prod_ai` and point to the unknown member; 21 of them are PS or SS.

### `dim_ingredient`

Grain: one row per ingredient. 95,910 rows: 3,477 RxNorm ingredients, 92,432 fallback
ingredients and the unknown member. Source: `int_faers__drug_resolved`.

| Column | Type | Description |
|---|---|---|
| `ingredient_key` | varchar | Surrogate key of `ingredient_id`. Primary key. |
| `ingredient_id` | varchar | RxCUI of the RxNorm ingredient (term type IN); `FB:<text>` for a fallback ingredient; `(unknown)`. |
| `ingredient_rxcui` | varchar | The RxCUI, null for fallback and unknown. |
| `ingredient_name` | varchar | RxNorm ingredient name (lower case, e.g. `amlodipine`); for a fallback, the cleaned text. |
| `best_match_type` | varchar | Strongest layer that produced this ingredient: `exact`, `normalized`, `approx_accepted` or `fallback`. |
| `is_fallback` | boolean | No accepted RxNorm match (`FB:` id). |
| `is_generic_fallback` | boolean | Fallback whose text is a generic class word listed in `config/rxnorm.yaml` `generic_terms` (HERBALS, VITAMINS, MINERALS, DIETARY SUPPLEMENT, UNSPECIFIED INGREDIENT, DEVICE). |
| `is_unknown` | boolean | Unknown member (drug line without any text). |
| `n_drug_line_rows` | bigint | Rows of `int_faers__drug_resolved` (all roles). |
| `n_signal_role_rows` | bigint | Rows with role in `signal_drug_roles` (PS, SS). |
| `n_cases_signal_roles` | bigint | Distinct cases with this ingredient in a PS/SS line. |

Caveats: most fallback ingredients come from texts that were never looked up (names used only as
concomitant, interacting or not administered, and reported drug names of lines without
`prod_ai`). Row counts overstate cases: tirzepatide has 388,946 PS/SS rows and 114,788 distinct
cases. Count cases with `count(distinct case_id)` or `n_cases_signal_roles`.

### `bridge_drug_ingredient`

Grain: one row per (`drug_key`, `ingredient_key`). 14,556 rows for 10,029 drugs. Source:
`dim_drug`, `stg_rxnorm__name_map`, `dim_ingredient`.

| Column | Type | Description |
|---|---|---|
| `drug_key` | varchar | FK `dim_drug`. |
| `ingredient_key` | varchar | FK `dim_ingredient`. |
| `ingredient_id` | varchar | As in `dim_ingredient`. |
| `match_type` | varchar | Layer of this ingredient for this `prod_ai`: `exact`, `normalized`, `approx_accepted` or `fallback`. |
| `is_generic_fallback` | boolean | As in `dim_ingredient`. |
| `lookup_term` | varchar | Part of the `prod_ai` that produced the ingredient (combinations are split on a backslash). |
| `n_parts` | integer | Number of parts of the `prod_ai`. |

A combination `prod_ai` has one row per ingredient (`SACUBITRIL\VALSARTAN` → sacubitril,
valsartan). When only some parts match, each unmatched part becomes `FB:<part>`
(`GIMERACIL\OTERACIL POTASSIUM\TEGAFUR` → `FB:GIMERACIL`, `FB:OTERACIL POTASSIUM`, tegafur). A
`prod_ai` without any match maps to `FB:<prod_ai>`; the unknown drug to the unknown ingredient.
Joining `fct_case_drug` through the bridge multiplies rows on purpose: count distinct cases.

### `dim_reaction`

Grain: one row per MedDRA preferred term (PT). 18,816 rows (18,815 terms and the unknown member).
Source: `int_faers__reaction_latest`.

| Column | Type | Description |
|---|---|---|
| `reaction_key` | varchar | Surrogate key of `reaction_pt`. Primary key. |
| `reaction_pt` | varchar | PT text as reported (trimmed); `(unknown)` when empty. |
| `is_unknown` | boolean | True for the unknown member. |

Caveats: the ASCII extract has no MedDRA version field. The FDA Readme states that the
reaction and indication files use the current MedDRA version, up-versioned per CDER guidelines,
and that the version is only available in the XML extract (`<reactionmeddraversionpt>`).
A term renamed between MedDRA versions appears as two members (observed in 2 cases republished
in 2025Q1 and 2025Q2). Terms are not grouped into the MedDRA hierarchy (HLT, SOC).

### `dim_outcome`

Grain: one row per FAERS outcome code. 8 rows. Source: seed `seed_outcome_codes` (meaning text
of the FDA `ASC_NTS` file, revision of January 2025) plus the unknown member.

| Column | Type | Description |
|---|---|---|
| `outcome_code` | varchar | DE, LT, HO, DS, CA, RI, OT or `(unknown)`. Primary key. |
| `outcome_description` | varchar | FDA meaning text (e.g. "Hospitalization - Initial or Prolonged"). |
| `is_death` | boolean | True for DE. |
| `is_unknown` | boolean | True for the unknown member. |

## Facts

### `fct_case`

Grain: one row per deduplicated case. 2,858,073 rows (= `int_faers__case_latest`: 2,870,985
distinct `caseid` minus 12,912 deleted cases). Source: `int_faers__case_latest`,
`int_faers__outcome_latest`.

| Column | Type | Description |
|---|---|---|
| `case_id` | bigint | FAERS `caseid`. Primary key. |
| `primaryid` | bigint | `primaryid` of the winning version. |
| `quarter_key` | varchar | Quarter of `init_fda_date` (FK `dim_quarter`). |
| `source_quarter` | varchar | File quarter of the winning version (lineage). |
| `is_in_window` | boolean | `quarter_key` within 2024Q3 to 2026Q2. False for 219,625 cases (7.68%) first received before the window; these count only in `ALL`. |
| `case_version` | integer | `caseversion` of the winning version. |
| `init_or_followup` | varchar | `I_F_CODE` (I initial, F follow-up). |
| `event_date` | date | `EVENT_DT` (YYYYMMDD, YYYYMM or YYYY → first day of the period; invalid → null). Empty in 55% to 58% of DEMO rows. |
| `fda_date` | date | `FDA_DT`, receipt date of this version. |
| `init_fda_date` | date | `INIT_FDA_DT`, first receipt of the case. |
| `sex` | varchar | M, F or UNK (empty and other values → UNK). |
| `age_value` | double | `AGE` as reported. |
| `age_unit` | varchar | `AGE_COD`: DEC, YR, MON, WK, DY, HR. |
| `age_years` | double | Age in years: YR; MON/12; WK/52; DY/365; DEC×10; HR/8760; null otherwise. |
| `age_group` | varchar | `AGE_GRP`: N neonate, I infant, C child, T adolescent, A adult, E elderly. |
| `reporter_country` | varchar | `REPORTER_COUNTRY` of the latest version. |
| `occurrence_country` | varchar | `OCCR_COUNTRY`, where the event occurred. |
| `reporter_occupation` | varchar | `OCCP_COD`: MD physician, PH pharmacist, OT other health professional, LW lawyer, CN consumer. The data also contains `HP`, which the FDA documentation does not list; `OT` does not occur in the loaded quarters. |
| `is_serious` | boolean | The winning version has at least one OUTC row (every OUTC code is a serious outcome). |
| `is_death` | boolean | The winning version has outcome DE. |

### `fct_case_drug`

Grain: one row per DRUG line of the winning version; key (`case_id`, `drug_seq`,
`drug_line_seq`). 11,681,494 rows (= `int_faers__drug_latest`). Source: `int_faers__drug_latest`.

| Column | Type | Description |
|---|---|---|
| `case_id` | bigint | FK `fct_case`. |
| `drug_seq` | integer | Drug position within the case version (`DRUG_SEQ`). |
| `drug_line_seq` | bigint | Line number within the position (1 for most positions), computed in `int_faers__drug_latest`. |
| `drug_key` | varchar | FK `dim_drug` (cleaned `prod_ai`). |
| `role_code` | varchar | PS primary suspect, SS secondary suspect, C concomitant, I interacting, DN drug not administered (FK `seed_role_codes`). |
| `route` | varchar | Route of administration. |
| `drug_name_raw` | varchar | `DRUGNAME` as reported (valid trade name or verbatim). |
| `active_ingredient_raw` | varchar | `PROD_AI` as reported. |
| `drug_text_clean` | varchar | Cleaned `prod_ai`, else cleaned `drugname`; key of the RxNorm name map. |
| `primaryid` | bigint | Winning version. |
| `source_quarter` | varchar | File quarter of the winning version. |

Caveats: one drug position can have several lines, one per dosage regimen (they differ in
dose, route, frequency or lot; 707,267 extra lines in the 8 quarters, growing from 2024Q3 to
2026Q2). Role and product are the same within a position (tested). Count drugs per case with
distinct (`case_id`, `drug_seq`) or distinct (`case_id`, `drug_key`).

### `fct_case_reaction`

Grain: one row per REAC line of the winning version; key (`case_id`, `reaction_key`,
`reaction_line_seq`). 9,084,912 rows (= `int_faers__reaction_latest`). Source:
`int_faers__reaction_latest`.

| Column | Type | Description |
|---|---|---|
| `case_id` | bigint | FK `fct_case`. |
| `reaction_key` | varchar | FK `dim_reaction`. |
| `reaction_line_seq` | bigint | Line number for repeated (case, PT) lines (1 for most). |
| `drug_rechallenge_action` | varchar | `DRUG_REC_ACT` (upper case): the PT of the event when it reappeared on readministration of the drug; mostly empty. |
| `primaryid` | bigint | Winning version. |
| `source_quarter` | varchar | File quarter of the winning version. |

Caveats: the source repeats some (case, PT) lines, almost always as exact copies (103,936 extra
lines). Case-level counts must use distinct (`case_id`, `reaction_key`).

### `fct_case_outcome`

Grain: one row per (case, outcome code) of the winning version. 2,068,441 rows
(= `int_faers__outcome_latest`; no repeated pairs). Source: `int_faers__outcome_latest`.

| Column | Type | Description |
|---|---|---|
| `case_id` | bigint | FK `fct_case`. |
| `outcome_code` | varchar | FK `dim_outcome`. |
| `primaryid` | bigint | Winning version. |
| `source_quarter` | varchar | File quarter of the winning version. |

## Signals schema

### `mart_dq_rxnorm_coverage`

Grain: one row per (`period_key`, `match_type`, `fallback_reason`). Source:
`int_faers__drug_resolved`, `fct_case`. Feeds the `rxnorm_coverage` group of `mart_dq_metrics`.

| Column | Type | Description |
|---|---|---|
| `period_key` | varchar | In-window `quarter_key` (2024Q3 to 2026Q2) or `ALL` (every loaded case). |
| `match_type` | varchar | Weakest layer among the parts of the line's drug text: `exact`, `normalized`, `approx_accepted` or `fallback`. |
| `fallback_reason` | varchar | For fallback lines: `not_in_name_map` (text never looked up), `no_match` (no part matched) or `partial_combination` (some parts matched). |
| `is_normalized` | boolean | `match_type` is not `fallback`. |
| `n_lines` | bigint | Drug lines with role in `signal_drug_roles` (PS, SS). |
| `n_lines_generic_fallback` | bigint | Lines with at least one generic fallback ingredient. |
| `n_lines_period` | bigint | PS/SS lines of the period. |
| `pct_lines` | decimal | `n_lines` / `n_lines_period` × 100. |

Coverage of the build of 2026-10-26 (`ALL`): 7,182,171 PS/SS lines; exact 98.982%, normalized
0.069%, fallback 0.948% (no match 62,936 lines, partial combination 5,205, not in name map 12).
Normalized share per in-window quarter: 98.84% (2026Q2) to 99.19% (2025Q2).

### `mart_signals`

Grain: one row per (`period_key`, `ingredient_id`, `reaction_key`) with at least
`signal_min_cases` (3) distinct cases. 1,876,964 rows in the build of 2026-10-26 (674,947 in
`ALL`). Source: `int_signals__drug_cases` (distinct case × ingredient in PS/SS lines, from
`int_faers__drug_resolved`), `int_signals__reaction_cases` (distinct case × PT), `fct_case`,
`dim_ingredient`, `dim_reaction`. Method and sources: `docs/limitations.md` ("Signals").

| Column | Type | Description |
|---|---|---|
| `period_key` | varchar | Window quarter (`quarter_key`) or `ALL` (every loaded case). |
| `ingredient_key`, `ingredient_id`, `ingredient_name` | varchar | Ingredient (FK `dim_ingredient`). |
| `reaction_key`, `reaction_pt` | varchar | MedDRA PT (FK `dim_reaction`). |
| `a`, `b`, `c`, `d` | bigint | 2×2 cells in distinct cases; a + b + c + d = `n_total`. |
| `n_drug`, `n_reac`, `n_total` | bigint | Cases of the period with the ingredient, with the PT, and all cases. |
| `prr`, `prr_lcl`, `prr_ucl` | double | PRR and its 95% CI (null when c = 0). |
| `ror`, `ror_lcl`, `ror_ucl` | double | ROR and its 95% CI (null when b, c or d = 0). |
| `chi2` | double | Pearson chi-squared, 1 df, no continuity correction. |
| `is_computable` | boolean | PRR and ROR both defined. |
| `is_signal_evans` | boolean | a ≥ 3, PRR ≥ 2, chi-squared ≥ 4 (`config/signals.yaml`). |
| `is_signal_ror` | boolean | a ≥ 3 and `ror_lcl` > 1. |
| `is_provisional_period` | boolean | The period is the last quarter of the window (cohort still growing). |
| `match_type`, `is_fallback`, `is_generic_fallback` | varchar / boolean | From `dim_ingredient`. |

### `mart_signals_top`

Grain: one row per (`ingredient_id`, `reaction_key`) in `ALL`, generic fallback ingredients
excluded. Per ingredient, the union of two lists (`config/signals.yaml`, `top`):

- the top `by_ror_lcl` (20) computable pairs by `ror_lcl` descending, ties by `a` descending;
- the top `by_a_evans` (10) pairs with `is_signal_evans` by `a` descending, ties by `ror_lcl`.

The first list favours strength with a minimum of precision; the second keeps the frequent
Evans pairs that a wide `ror_lcl` ranking pushes down (atorvastatin–Rhabdomyolysis: rank 48 by
`ror_lcl`, rank 3 by `a`). 61,618 rows for 3,229 ingredients in the build of 2026-10-26
(48,333 from the `ror_lcl` list, 26,797 from the `a` list, 13,512 in both). `trend` lists
`period_key`, `a` and `prr` for each window quarter where the pair reached 3 cases (a missing
quarter had fewer).

| Column | Type | Description |
|---|---|---|
| `rank_ror_lcl` | bigint | Rank of the pair by `ror_lcl` among the ingredient's computable pairs (null if not computable). |
| `rank_a_evans` | bigint | Rank by `a` among the ingredient's Evans pairs (null if not an Evans signal). |
| `in_top_ror_lcl`, `in_top_a_evans` | boolean | The pair is in the first or the second list (at least one is true). |
| `top_country`, `top_country_share` | varchar / double | Most frequent reporter country of the pair's cases (blank and placeholder values left out; ties by code) and its share of the `a` cases (0 when no case has a country). |
| `top_quarter`, `top_quarter_share` | varchar / double | Most frequent init quarter (`quarter_key`) of the pair's cases and its share of the `a` cases. |
| `median_reactions_per_case` | double | Median number of distinct PTs in the pair's cases. |
| `n_pair_cases` | bigint | Cases the concentration columns were computed from; equals `a` (tested). |
| `ingredient_top_country`, `ingredient_top_country_share` | varchar / double | Most frequent reporter country over all the ingredient's cases (`n_drug`, blank and placeholder values left out; ties by code) and its share of `n_drug`. |
| `ingredient_country_share` | double | Share of the ingredient's cases (`n_drug`) from the pair's `top_country`; 0 when `top_country` is null. Used by the site's country rule. |
| `trend` | list of struct | (`period_key`, `a`, `prr`) per window quarter. |

Other columns (`a`, `n_drug`, `n_reac`, PRR, ROR, χ², flags, `match_type`, `is_fallback`) as in
`mart_signals`.

### `mart_known_signals_eval`

Grain: one row per pair of `seed_known_signals` (12). Values from `mart_signals` in `ALL`.

| Column | Type | Description |
|---|---|---|
| `expected` | varchar | `positive` or `negative` (seed). |
| `ingredient_name`, `reaction_pt` | varchar | As in the seed. |
| `ingredient_id`, `reaction_key` | varchar | Exact match (case-insensitive) in `dim_ingredient` (non-fallback) and `dim_reaction`; null when not found. |
| `reference`, `reference_status` | varchar | From the seed: the FDA label and sections behind the expected result, and where the pair stands in the label (`label_boxed_warning`, `label_warning`, `label_monitoring`, `label_not_listed`). |
| `a`, `n_drug`, `n_reac` | bigint | Cell a (also for pairs below 3 cases, counted directly); cases with the ingredient and with the PT (null below 3 cases). |
| `prr`, `ror_lcl`, `chi2` | double | From `mart_signals` (null when the pair has fewer than 3 cases). |
| `is_signal_evans`, `is_signal_ror` | boolean | From `mart_signals` (false when the pair is not stored). |
| `a_fallback_same_name` | bigint | Cases of the same PT under fallback ingredients whose text contains the ingredient name (pairs with at least 3 cases): a hint of a split ingredient. |
| `passed`, `failure_reason` | boolean / varchar | Whether the pair meets its expectation, and why not. |

### `mart_dq_metrics`

Grain: one row per (`period_basis`, `period_key`, `metric_group`, `metric`); `value` (double)
and `unit` (`rows`, `cases`, `lines`, `pct`). 297 rows.

| `metric_group` | `period_basis` | Content |
|---|---|---|
| `raw_rows` | `file_quarter`, `all` | Rows of DEMO, DRUG, REAC, OUTC and INDI per file. |
| `deduplication` | `file_quarter`, `all` | DEMO rows, winning versions, deleted ids listed and found; in `ALL` also distinct caseids, superseded versions, cases after deduplication and percentages removed. |
| `rxnorm_coverage` | `init_quarter`, `all` | From `mart_dq_rxnorm_coverage`: PS/SS lines, normalized lines and percentages by match type. |
| `missing_values` | `init_quarter`, `all` | % of cases without event date, sex, age or reporter country (blank, or a placeholder of `config/faers.yaml` `missing_value_placeholders` such as `COUNTRY NOT SPECIFIED`, counts as missing); % of drug lines without `prod_ai`; % of reaction lines without PT. |
| `role_mix` | `file_quarter`, `all` | DRUG lines (every version) and percentage per ROLE_COD (PS, SS, C, I, DN). |

`file_quarter` is the quarter of the FAERS file; `init_quarter` the case's `quarter_key`.

## Reference seeds

| Seed | Content | Source |
|---|---|---|
| `seed_outcome_codes` | 7 OUTC codes and meaning text | FDA `ASC_NTS` (January 2025), in every quarterly zip |
| `seed_role_codes` | 5 ROLE_COD codes and meaning text | FDA `ASC_NTS` (January 2025) |
| `seed_known_signals` | 12 known pairs (9 positive, 3 negative controls) for `mart_known_signals_eval` | Positives with an established association and negative controls chosen for clinical implausibility; `reference` cites the FDA label and sections (consulted on 2026-10-29), `reference_status` is `label_boxed_warning`, `label_warning`, `label_monitoring` or `label_not_listed` |

## Limitations

- **Spontaneous reporting.** FAERS holds voluntary and manufacturer reports. There is no
  exposure denominator: counts are not incidence, and a report does not establish that a drug
  caused the event. Reporting is incomplete and influenced by publicity, regulatory actions and
  time on the market.
- **Duplicates across reporters.** Deduplication is by `caseid` only; the same event reported
  separately by different reporters stays as separate cases.
- **Drug role mix changes over time.** Between 2025Q1 and 2026Q2 the share of SS lines falls
  (845,000 to 453,000 lines per quarter) while PS lines rise (432,000 to 530,000); DN appears
  from 2024Q4. Analyses restricted to PS and SS see a different drug universe in each quarter.
- **MedDRA versions.** PTs are stored as text without a version; renamed terms split counts.
- **Recent cohorts.** Under the `init_fda_dt` anchor, the cohorts of the last quarters can still
  grow when later quarters are loaded.
- **Drug names.** RxNorm normalization favours precision: approximate matches are off and
  ambiguous exact matches are not resolved (see `docs/limitations.md`).
