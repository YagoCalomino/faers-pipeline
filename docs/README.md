# Documentation

| Document | What it answers |
|---|---|
| [runbook.md](runbook.md) | How to operate the pipeline: start, unpause, backfill, re-run a quarter, rebuild the RxNorm cache or the warehouse, export and publish the site, what to do when a task fails. |
| [data_dictionary.md](data_dictionary.md) | Tables and columns of the marts: dimensions, facts and the signals schema, plus the reference seeds. Staging and intermediate models are described in their dbt `.yml` files. |
| [limitations.md](limitations.md) | What the numbers can and cannot say: drug-name mapping, the disproportionality method and its limits, reporting patterns, validation against known pairs, operational limits, MedDRA terms. The site's "Method & limitations" page shows the sections listed in `config/site.yaml` (`method_page`); operational limits stay here. |
| [calibration/](calibration/) | Evidence behind calibrated settings: the labelled RxNorm sample with its marks. |
| [numbers.md](numbers.md) | Counts, coverage, build and run times, disk and site sizes, generated from the warehouse and recorded measurements (`make readme-numbers`). |
| [adr/](adr/) | Architecture decision records (below). |
| [img/](img/) | Screenshots of the site used in the README. |

## Architecture decision records

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-time-anchor.md) | A case belongs to the quarter of its first receipt by FDA (`init_fda_dt`). | accepted |
| [0002](adr/0002-dbt-version.md) | dbt Core with dbt-duckdb and the classic parser; the new parser is checked for compatibility only. | accepted |
| [0003](adr/0003-site-tooling.md) | A static site of the project's own (Vite, plain JavaScript) reading per-ingredient JSON, published from an orphan `gh-pages` branch. | accepted |
| [0004](adr/0004-meddra-terms.md) | Keep MedDRA preferred terms from FAERS on the site and in the downloads with a trademark notice, pending a check of the MedDRA licence; if a licence is needed for the term list, remove the Parquet downloads. | proposed |

Each ADR has a status, a date, the context with the measurements behind it, the decision and
its consequences.

## Repository layout

```
config/   pipeline settings (sources, schema contract, RxNorm, signals, site)
dags/     Airflow DAGs: faers_ingest, rxnorm_enrich, faers_transform, publish_site
src/      Python package faers_pipeline (download, parse, quality, RxNorm, build, export)
dbt/      dbt project faers_dbt (staging, intermediate, core, signals; seeds; tests)
site/     static explorer (Vite) with its build checks and browser tests
scripts/  command-line tools: make entry points, fixture builders, checks and measurements
infra/    Dockerfile, docker-compose and Airflow pools
tests/    pytest suite and real fixtures
docs/     runbook, data dictionary, limitations, numbers, ADRs, README screenshots
```

## How to read the repository

1. Start with the [README](../README.md): the problem, the architecture diagram, the numbers.
2. Follow one quarter through the code: `dags/faers_ingest.py` (download, parse to Parquet,
   validate) -> `dags/rxnorm_enrich.py` -> `dags/faers_transform.py` (dbt build, atomic swap,
   reconciliation) -> `dags/publish_site.py` (export and validation).
3. The SQL lives in `dbt/faers_dbt/models/`: `staging/` (typing), `intermediate/`
   (deduplication and the drugs and reactions of each case's latest version), `marts/core/`
   (dimensions and facts) and `marts/signals/` (PRR, ROR, data quality, known pairs).
4. Settings that depend on external sources (URLs, quarters, rate limits, thresholds) are in
   `config/*.yaml`, never in code.
5. Tests: `tests/` (pytest, DAG integrity), dbt tests next to the models and in
   `dbt/faers_dbt/tests/`, site tests in `site/tests/`.
