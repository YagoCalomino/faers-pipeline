# Documentation

| Document | What it answers |
|---|---|
| [runbook.md](runbook.md) | How to operate the pipeline: start, unpause, backfill, re-run a quarter, rebuild the RxNorm cache or the warehouse, export and publish the site, what to do when a task fails. |
| [data_dictionary.md](data_dictionary.md) | Tables and columns of the marts: dimensions, facts and the signals schema, plus the reference seeds. Staging and intermediate models are described in their dbt `.yml` files. |
| [limitations.md](limitations.md) | What the numbers can and cannot say: drug-name mapping, the disproportionality method and its limits, reporting patterns, validation against known pairs, operational limits. The site's "Method & limitations" page is built from this file. |
| [adr/](adr/) | Architecture decision records (below). |
| [img/](img/) | Screenshots of the site: the README images, and every page on desktop and mobile in `img/site/`. |

## Architecture decision records

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-time-anchor.md) | A case belongs to the quarter of its first receipt by FDA (`init_fda_dt`). | accepted |
| [0002](adr/0002-dbt-version.md) | dbt Core with dbt-duckdb and the classic parser; the new parser is checked for compatibility only. | accepted |
| [0003](adr/0003-site-tooling.md) | A static site of the project's own (Vite, plain JavaScript) reading per-ingredient JSON, published from an orphan `gh-pages` branch. | accepted |

Each ADR has a status, a date, the context with the measurements behind it, the decision and
its consequences.

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
