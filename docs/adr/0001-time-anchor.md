# ADR 0001: Time anchor of a case (`quarter_key`)

- Status: accepted
- Date: 2026-10-24
- Scope: `int_faers__case_latest` and, from Phase 4, `fct_case.quarter_key` and the signal periods

## Context

FAERS quarterly files are not cumulative: each file holds the case versions FDA received in
that quarter. After deduplication (one row per `caseid`, highest `caseversion`), every case
needs one quarter for per-quarter cohorts and signal periods. Candidates:

| Candidate | Meaning | Measured on the 8 loaded quarters (2024Q3 to 2026Q2) |
|---|---|---|
| `event_dt` | date of the adverse event | empty in 55% to 58% of DEMO rows per quarter |
| `fda_dt` | FDA receipt date of this version | in the file's own quarter for 99.99% of rows; equivalent to `source_quarter` |
| `source_quarter` | quarter of the file that holds the winning version | follows the latest version |
| `init_fda_dt` | first FDA receipt of the case | 100% filled; 79% in the file's quarter, 21% before, 0% after |

`event_dt` is ruled out by missing data, and `fda_dt` behaves like `source_quarter`. The choice
is between `source_quarter` and `init_quarter` (quarter of `init_fda_dt`).

## Measurement

Population: the 2,858,073 cases of `int_faers__case_latest` (3,253,489 DEMO rows, 2,870,985
distinct `caseid`, 12,912 deleted cases removed). Window: 2024Q3 to 2026Q2.

| Quarter | Distinct cases in the file | Cohort by `source_quarter` | Cohort by `init_quarter` (in window) |
|---|---:|---:|---:|
| 2024Q3 | 405,513 | 342,975 (84.6% of the file) | 330,142 |
| 2024Q4 | 410,849 | 333,636 (81.2%) | 332,751 |
| 2025Q1 | 400,514 | 325,021 (81.2%) | 323,550 |
| 2025Q2 | 393,130 | 326,905 (83.2%) | 322,574 |
| 2025Q3 | 438,512 | 391,622 (89.3%) | 338,211 |
| 2025Q4 | 385,288 | 345,568 (89.7%) | 317,954 |
| 2026Q1 | 397,224 | 369,888 (93.1%) | 320,317 |
| 2026Q2 | 422,458 | 422,458 (100%) | 352,949 |
| Range (max / min) | | 325,021 to 422,458 (1.30) | 317,954 to 352,949 (1.11) |

Other figures over the 2,858,073 cases:

- `init_quarter` before the window (before 2024Q3): 219,625 cases (7.68%), mostly 2024Q1-Q2
  and 2023 (81,909 in 2024, 56,696 in 2023, older years decreasing).
- `init_quarter` NULL: 0 cases (0%). After the window: 0 cases.
- `init_quarter = source_quarter`: 2,298,948 cases (80.4%).
- 314,616 cases appear in more than one quarter; the highest `caseversion` is always in the
  latest quarter where the case appears.

## Decision

Use `init_quarter` (quarter of `init_fda_dt`) as the case's `quarter_key`. `source_quarter` stays
as lineage and as part of the join key of the child tables (`primaryid`, `source_quarter`).
Cases whose `init_quarter` falls before the window are kept, flagged with
`is_init_in_window = false`, and count only in the all-period aggregates.

## Rationale

- With `source_quarter`, every follow-up moves a case to the latest quarter. The last loaded
  quarter keeps 100% of its cases while the 2024Q3 to 2025Q2 cohorts keep 81% to 85%; the range is
  1.30x, an artefact of loading order rather than of reporting volume. Each new quarter
  loaded would also change the size of every earlier cohort.
- With `init_quarter`, a case stays in the quarter of its first receipt whatever version wins;
  cohorts are flatter (range 1.11x) and stable when later quarters are added.
- `init_fda_dt` is always filled and never later than the file's quarter, so no case is lost
  or placed in the future.

## Consequences

- 7.68% of the cases (first received before 2024Q3) do not belong to any in-window quarter;
  they are present only in all-period figures. This share is published with the results.
- The most recent quarters can still receive cases with `init_fda_dt` inside them through
  later files; per-quarter cohorts near the end of the window are provisional until the next
  quarters are loaded.
- `int_faers__case_latest` carries `init_quarter`, `is_init_in_window` and `source_quarter`;
  the window bounds come from `config/faers.yaml` (`schedule.start_quarter`, `end_quarter`)
  through dbt vars.
