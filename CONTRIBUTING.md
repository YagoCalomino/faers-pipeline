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

### Checks

- `make lint`, `make test`, `make dbt-ci` and `make site-ci` are the same checks as the CI. Tests
  do not use the network; fixtures are small real subsets of FAERS and RxNorm in
  `tests/fixtures/`, rebuilt by the scripts listed in the [runbook](docs/runbook.md), "Test
  fixtures and profiling". `data/` is not committed.
- Python 3.12, package in `src/faers_pipeline/`, DAGs in `dags/`; ruff for lint and formatting
  (`pyproject.toml`, line length 100). Airflow does not run natively on Windows, so lint and tests
  run inside the container (`airflow-dev` service).

### Pipeline invariants

- Settings that depend on external sources (URLs, quarters, file types, paths, limits,
  thresholds) are read from `config/*.yaml`.
- Idempotent writes: write to a temporary file, then `os.replace`. Re-running a quarter
  overwrites its whole partition; nothing is appended.
- Ingestion tasks only write Parquet. dbt is the only writer of the `.duckdb` file (pool
  `duckdb_writer`, one slot).
- The raw layer keeps every column as text; typing happens in dbt staging.
- The warehouse `.duckdb` (`paths.warehouse`) only holds dbt outputs and is disposable: the
  Parquet lake is the source of truth. Full builds are atomic (`make dbt-rebuild`, DAG
  `faers_transform`): dbt writes `data/warehouse/_build/faers.duckdb`, which replaces the
  warehouse only if every model and test passes. dbt does not run while an ingestion is
  writing the lake.

### Site

- Site settings (concentration alert, size limits, column descriptions) live in
  `config/site.yaml`. The concentration alert flags reporting clusters by quarter, country or
  report length; the full rule is in [docs/limitations.md](docs/limitations.md), "Concentration
  alert". After a change to the rule: `make site-ci`, `python -I scripts/site_alert_stats.py`
  (share of flagged rows) and `make publish-site`.
