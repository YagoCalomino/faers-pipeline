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
- Raw layer keeps every column as text; typing happens in dbt staging.
- Code identifiers and commit messages in English; user-facing docs may be in Portuguese.

## How to run

```bash
make env     # creates .env from .env.example (first time only)
make up      # builds the image and starts Airflow (UI: http://localhost:8080)
make lint    # ruff check + format check, inside the Airflow image
make test    # pytest (DagBag integrity + unit tests), inside the Airflow image
make import-errors  # airflow dags list-import-errors in the scheduler
make down
```

Tests must not use the network. Airflow does not run natively on Windows, which is why
lint and tests run inside the container (`airflow-dev` service).
