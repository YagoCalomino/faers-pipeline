# Working rules for this repository

Reference plan: `docs/PLANO_FAERS_PIPELINE.md`. Read it before changing anything.

## Non-negotiable rules

1. **Git:** never add `Co-Authored-By`, `Claude-Session` or any co-authorship / AI-signature
   trailer to commit messages, in any repository of this project. Never commit automatically:
   at the end of each step, propose the commit message (Conventional Commits, in English) and
   wait for the owner to confirm. The owner runs the commit.
2. **Zero billing** on any cloud. No paid service. Anything external must work without a card.
3. **No invented data.** Test fixtures are small subsets of real FAERS / RxNorm data.
4. **No hardcoded external values.** URLs, quarters, file types and paths live in `config/*.yaml`.
5. **Do not invent external information.** Anything uncertain (FDA URLs, library versions, import
   paths, DuckDB options) must be checked against the official source, and the report must say
   what was confirmed and what was not.
6. Do not use the assistant's name in repository files other than this one.

## Code conventions

- Python 3.12, package in `src/faers_pipeline/`, DAGs in `dags/`.
- Ruff for lint and formatting (`pyproject.toml`), line length 100.
- Idempotent writes: write to a temp file, then `os.replace`. Re-running a quarter overwrites
  its whole partition; never append.
- Ingestion tasks only write Parquet. dbt is the only writer of the `.duckdb` file
  (pool `duckdb_writer`, 1 slot).
- The warehouse `.duckdb` (`paths.warehouse`) only holds dbt outputs and is disposable: the
  Parquet lake is the source of truth. Full builds are atomic (`make dbt-rebuild`, DAG
  `faers_transform`): dbt writes `data/warehouse/_build/faers.duckdb`, which replaces the
  warehouse only if every model and test passes. Never run dbt while an ingestion is writing
  the lake.
- Raw layer keeps every column as text; typing happens in dbt staging.
- Code identifiers and commit messages in English; user-facing docs may be in Portuguese.
- Site settings (concentration alert, size limits, column descriptions) live in
  `config/site.yaml`. The alert flags a pair with at least 10 reports and 80% of them in one init
  quarter, or a median of 40 or more reactions per report. After changing the rule, run
  `make site-ci`, `python -I scripts/site_alert_stats.py` (share of flagged rows) and
  `make publish-site`.

## How to run

```bash
make env     # creates .env from .env.example (first time only)
make up      # builds the image and starts Airflow (UI: http://localhost:8080)
make lint    # ruff check + format check, inside the Airflow image
make test    # pytest (DagBag integrity + unit tests), inside the Airflow image
make import-errors  # airflow dags list-import-errors in the scheduler
make dbt-deps       # dbt packages (needs internet: dbt Hub)
make dbt-build      # dbt build on the real lake (settings from config/*.yaml via scripts/dbt_run.py)
make dbt-rebuild    # atomic full build (swapped in only if every model and test passes)
make cleanup-extracted  # dry run; EXECUTE=1 deletes extracted .txt of ingested quarters
make dbt-ci         # builds a test lake from tests/fixtures and runs dbt build --target ci
make export         # site export: warehouse -> data/site_export/ (config/site.yaml)
make export-ci      # site export from the ci database built on the fixture lake
make publish-site   # validated export + site build/checks/tests + local orphan gh-pages commit (no push)
make site-ci        # the site on the fixture subset (no lake, warehouse, dbt or network)
make site-dev       # live preview of the site on data/site_export/
make down
```

Tests must not use the network. Airflow does not run natively on Windows, which is why
lint and tests run inside the container (`airflow-dev` service).
