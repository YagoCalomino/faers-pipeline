# Data dictionary: core marts

Schema `core` of the DuckDB warehouse (`data/warehouse/faers.duckdb`), built by dbt from the
FAERS quarterly ASCII files loaded in the lake (8 quarters, 2024Q3 to 2026Q2). Row counts are
those of the build of 2026-10-24.

Lineage: `faers_raw` (Parquet, all text) → `staging` (typed views) → `intermediate`
(deduplication: `int_faers__case_latest`, `int_faers__drug_latest`, `int_faers__reaction_latest`,
`int_faers__outcome_latest`) → `core`. Facts read only from the `int_faers__*_latest` models.

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

Caveats: not yet mapped to RxNorm ingredients (Phase 5 adds the ingredient without changing
this grain). Salts, combinations and spelling variants are separate members. 216,354 drug lines
(1.85%) have no `prod_ai` and point to the unknown member; 21 of them are PS or SS.

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
| `drug_line_seq` | bigint | Line number within the position (1 for most positions). |
| `drug_key` | varchar | FK `dim_drug` (cleaned `prod_ai`). |
| `role_code` | varchar | PS primary suspect, SS secondary suspect, C concomitant, I interacting, DN drug not administered (FK `seed_role_codes`). |
| `route` | varchar | Route of administration. |
| `drug_name_raw` | varchar | `DRUGNAME` as reported (valid trade name or verbatim). |
| `active_ingredient_raw` | varchar | `PROD_AI` as reported. |
| `drug_text_clean` | varchar | Cleaned `prod_ai`, else cleaned `drugname` (lookup text for Phase 5). |
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

## Reference seeds

| Seed | Content | Source |
|---|---|---|
| `seed_outcome_codes` | 7 OUTC codes and meaning text | FDA `ASC_NTS` (January 2025), in every quarterly zip |
| `seed_role_codes` | 5 ROLE_COD codes and meaning text | FDA `ASC_NTS` (January 2025) |

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
- **Drug names.** `prod_ai` is not normalized to an ingredient vocabulary yet (Phase 5).
