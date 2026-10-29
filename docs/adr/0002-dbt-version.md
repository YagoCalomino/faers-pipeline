# ADR 0002: dbt version for the 8-quarter scope

- Status: accepted
- Date: 2026-10-24

## Context

The transformation layer (staging, deduplication, later the dimensional model and signal marts)
runs on dbt over a local DuckDB file. The pinned environment is a virtualenv separate from
Airflow (`/opt/dbt-venv`, `infra/docker/requirements-dbt.txt`):

| Package | Version |
|---|---|
| dbt-core | 1.12.6 |
| dbt-duckdb | 1.11.0 |
| duckdb | 1.5.6 (same as the ingestion environment) |
| dbt_utils (`packages.yml`) | 1.4.1, `require-dbt-version` `>=1.3.0, <3.0.0` (dbt Hub) |

dbt-core 1.12.6 prints that dbt v2 is available and is the default for new installations, and
it ships the option `dbt parse --use-v2-parser` ("Delegate parsing to the v2 parser instead of
running dbt-core's own parser"). The check below measures how far the project is from v2.

## Check: `make dbt-parse-v2`

Command: `dbt parse --use-v2-parser` through `scripts/dbt_run.py` (target `duckdb_local`). The v2
parser reported itself as `dbt-oss 2.0.8` (`dbt-core-experimental-parser`).

1. First run: failed with 6 errors, all `UnusedConfigKey (dbt1060): Ignored unexpected key
   "meta"` at `models/staging/_sources.yml`, one per source table. The source declared
   `meta.external_location` (the dbt-duckdb way to read Parquet) at the source level.
2. Change: `meta` moved under `config:` (`config.meta.external_location`). dbt-duckdb 1.11 reads
   the source meta for `external_location`, so v1 behaviour is unchanged.
3. Second run: `Finished 'parse' successfully`, 1.95 s, no errors or warnings.

After the change, `dbt build` passes on both targets with dbt-core 1.12.6: 36 nodes (6 views,
3 tables, 26 data tests, 1 unit test) on the 8-quarter lake and on the fixture lake (target ci).

## Decision

Use dbt Core 1.12 with dbt-duckdb 1.11 for the 8-quarter scope. Keep the project parse-clean under the v2
parser: run `make dbt-parse-v2` after each change to the dbt project and fix any new finding there, so a
later move to v2 is a version change rather than a rewrite.

## Consequences

- Source and model properties follow the layout the v2 parser accepts (`meta` under `config`).
- The v2 parser was only used to parse; building with v2 and the v2 DuckDB support were not
  evaluated and are out of scope here.
- Unit tests whose input is an `external_location` source use `format: sql` fixtures: dbt-core
  1.12 cannot look up the columns of such a source, which the `dict` format requires.
