# Contributing

This is a portfolio project maintained by one person; issues and suggestions are welcome.

Before opening a pull request:

1. Run the same checks as the CI: `make lint`, `make test`, `make dbt-ci` and `make site-ci`.
   Lint, tests and dbt run inside the Airflow image, so the host needs no Python; the site build
   needs Node.js on the host. `make lint` runs ruff and `scripts/check_docs.py`, which checks the
   Markdown files against the Makefile, the links and the pinned versions.
2. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) in
   English.
3. Optional: `pre-commit install` runs ruff and basic file checks on each commit
   (`.pre-commit-config.yaml`).

## Engineering conventions

### Data and external sources

- **No paid services.** Everything runs locally or on free tiers that need no card.
- **No invented data.** Test fixtures are small subsets of real FAERS and RxNorm data
  (`tests/fixtures/`), built by the scripts in `scripts/`. `data/` is not committed.
- **No hardcoded external values.** URLs, quarters, file types, paths, limits and thresholds
  live in `config/*.yaml`, not in code.
- **External facts are checked at the source.** FDA URLs, library versions, import paths and
  DuckDB options are confirmed against the official documentation; what could not be
  confirmed is written down as such.
- Tests do not use the network.

### Code

- Python 3.12; the package is `src/faers_pipeline/`, the DAGs are in `dags/`.
- Ruff for lint and formatting (`pyproject.toml`), line length 100.
- Code identifiers, comments and commit messages are in English.
- Airflow does not run natively on Windows, so lint and tests run inside the container
  (`airflow-dev` service).

### Pipeline

- Idempotent writes: write to a temporary file, then `os.replace`. Re-running a quarter
  overwrites its whole partition; nothing is appended.
- Ingestion tasks only write Parquet. dbt is the only writer of the `.duckdb` file (pool
  `duckdb_writer`, one slot).
- The raw layer keeps every column as text; typing happens in dbt staging.
- The warehouse `.duckdb` (`paths.warehouse`) only holds dbt outputs and is disposable: the
  Parquet lake is the source of truth. Full builds are atomic (`make dbt-rebuild`, DAG
  `faers_transform`): dbt writes `data/warehouse/_build/faers.duckdb`, which replaces the
  warehouse only if every model and test passes. dbt must not run while an ingestion is
  writing the lake.

### Site

- Site settings (concentration alert, size limits, column descriptions) live in
  `config/site.yaml`. The alert flags a pair with at least 10 cases and 80% of them in one
  init quarter, a median of 40 or more reactions per report, or at least 10 cases with 90% of
  them from one country that is not the ingredient's most frequent country. After changing the
  rule, run `make site-ci`, `python -I scripts/site_alert_stats.py` (share of flagged rows) and
  `make publish-site`.
