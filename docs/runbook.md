# Runbook

Operations of the FAERS pipeline on the local Airflow (Docker, LocalExecutor). Commands run from
the repository root; `AF` stands for
`docker compose --env-file .env -f infra/docker/docker-compose.yml exec airflow-scheduler airflow`.

## Pipeline at a glance

| DAG | Trigger | Writes | Publishes |
|---|---|---|---|
| `faers_ingest` | quarterly cron (`config/faers.yaml` `schedule`), `catchup=True` | `data/landing/faers/<quarter>/`, lake Parquet, manifest | Asset `faers_raw_parquet` |
| `rxnorm_enrich` | Asset `faers_raw_parquet` | `data/lake/raw/rxnorm/` (cache, name map) | Asset `rxnorm_name_map`, also when no new lookup was needed |
| `faers_transform` | Asset `rxnorm_name_map` | `data/warehouse/faers.duckdb` | Asset `faers_warehouse`, only when build and reconciliation pass |

Pools: `parse` (2 slots, FAERS file parsing), `rxnorm_api` (1 slot, RxNav lookups),
`duckdb_writer` (1 slot, every task that writes or reads the warehouse file during a build).
Pools are imported from `infra/airflow/pools.json` at `make up`.

`faers_transform` first waits (sensor in reschedule mode) until no `faers_ingest` or
`rxnorm_enrich` run is queued or running, so a build never reads a lake that is being written.
The reverse is not enforced: do not start an ingestion or a backfill while `faers_transform`
is building.

## Pause and unpause

New DAGs start paused. Unpause the three DAGs for the asset chain to run on its own:

```bash
$AF dags unpause faers_ingest
$AF dags unpause rxnorm_enrich
$AF dags unpause faers_transform
```

Unpausing `faers_ingest` does not create runs for quarters that already have one; with
`catchup=True` it creates runs only for data intervals between `start_quarter` and
`end_quarter` that have none. `rxnorm_enrich` and `faers_transform` only run on new Asset
events.

## Re-run a quarter

Clearing a run of `faers_ingest` re-runs it from the availability check: the zip is downloaded
again (the ingest log records `source_changed` when its sha256 differs), parsed, and the
quarter's Parquet partition and manifest are replaced atomically. The asset chain then runs
`rxnorm_enrich` (new names only) and `faers_transform`.

```bash
$AF tasks clear faers_ingest -s 2026-04-01T00:00:00+00:00 -e 2026-04-01T00:00:00+00:00 -y
```

The logical date of a quarter's run is the first day of the quarter (2026Q2 → 2026-04-01).
A re-run of unchanged source data produces the same `content_fingerprint` per file type in the
manifest.

## Backfill

`airflow backfill create` creates runs for a date range. It does not respect the DAG's
`start_date`, so always check the dry run first:

```bash
$AF backfill create --dag-id faers_ingest --from-date 2025-01-01 --to-date 2025-06-30 --dry-run
$AF backfill create --dag-id faers_ingest --from-date 2025-01-01 --to-date 2025-06-30
```

Runs that already exist are skipped unless `--reprocess-behavior completed` (or `failed`) is
given. Each backfilled quarter publishes the raw Asset, so the asset chain follows.

## Add a new quarter

1. Check that the zip is published (the `wait_for_release` sensor does this as well).
2. Raise `schedule.end_quarter` in `config/faers.yaml` (for example to `2026Q3`). The window of
   the marts (`window_start_quarter`, `window_end_quarter`) follows this setting.
3. With `faers_ingest` unpaused, the scheduler creates the run for the new interval; otherwise
   use a backfill for that quarter.
4. The asset chain updates the RxNorm cache (new names only) and rebuilds the warehouse.

The window is fixed on purpose (reproducibility): nothing is ingested beyond `end_quarter`.

## RxNorm cache

- New names are looked up on every `rxnorm_enrich` run; names already `matched` or `not_found`
  are never looked up again; names in `error` are.
- After a change of `generic_terms` in `config/rxnorm.yaml`, only the warehouse needs a rebuild
  (`make dbt-rebuild` or a `faers_transform` run). After a change of `approximate_rules` or
  `combination_separator`, trigger `rxnorm_enrich`: the name map is rebuilt from the cache
  without API calls.
- Full refresh (for example after a new RxNorm release): pause `rxnorm_enrich`, move
  `data/lake/raw/rxnorm/cache/term_lookup.parquet` to a backup folder outside the lake, unpause
  and trigger the DAG. A full lookup of about 6,500 terms took 51 minutes at 5 requests per
  second (about 14,500 calls). Every cache row records the RxNorm release it used.

```bash
$AF dags trigger rxnorm_enrich
```

An interrupted lookup keeps the terms already written (results are written every
`lookup.flush_every_terms` terms to `cache/_pending/`); the retry skips them, and the next merge
folds pending files into the cache.

## Rebuild the warehouse

The warehouse only holds dbt outputs; the lake is the source of truth. Both ways below are
atomic: dbt writes `data/warehouse/_build/faers.duckdb`, which replaces the warehouse only when
every model and test passes. A failed build keeps the previous warehouse and removes the new
file.

```bash
make dbt-rebuild                  # from the host, outside Airflow
$AF dags trigger faers_transform  # through Airflow (duckdb_writer pool)
make reconcile                    # lake -> warehouse counts, exit 1 on divergence
```

Do not run a build while an ingestion is writing the lake.

**Host memory.** A full build is the heaviest step of the pipeline. Measured on 2026-10-26 (8
quarters, `faers_transform` in Airflow): the dbt process peaked at about 3.1 GB and the
scheduler container's cgroup `memory.peak` at 4,012 MiB (about 4 GiB), with DuckDB's
`memory_limit` at 2.5GB (`config/faers.yaml`, `dbt.memory_limit`). Docker's VM on the development host
has about 8 GB, shared with the host's own programs: close heavy programs (browsers with many tabs, IDEs, other containers) before
triggering `faers_transform` or `make dbt-rebuild`. Lowering `memory_limit` is not the fix: the
signal marts already ran out of memory at that limit before they were reworked.

A later run the same day (185 nodes, with `mart_known_signals_eval`) peaked at 3,687 MiB in the
container and about 3.1 GB in the dbt process. Before that, one attempt stalled in
`mart_signals_top` with the host down to 0.7 GB free: DuckDB spilled about 20 GB to
`dbt.temp_directory` in 15 minutes. The model was rewritten so its plan cannot take that path,
and the attempt was stopped by hand. If a build stays on one model far longer than in the last
successful run, pause `faers_transform`, stop the `dbt build` process (the atomic build keeps
the previous warehouse), and delete the leftover `duckdb_temp_storage_*.tmp` files in
`dbt.temp_directory` once no dbt or DuckDB process is running.

## Failures

Every task of the three DAGs has a failure callback that, when the task fails for good (after
its retries):

- logs one line `TASK_FAILURE {...}` (JSON) in the task log;
- writes a marker `logs/failures/<dag_id>/<run_id>/<task_id>[.<map_index>].try<N>.json` with
  `dag_id`, `task_id`, `run_id`, `map_index`, `try_number`, `logical_date`, `reason` and
  `failed_at`.

```bash
ls -lt logs/failures/*/*/                # markers per DAG and run, newest first
cat logs/failures/<dag_id>/<run_id>/<task_id>.try<N>.json
```

A failed task blocks the Assets downstream of it, so the next DAG of the chain does not run.

| DAG / task | Likely cause | Action |
|---|---|---|
| `faers_ingest.wait_for_release` (timeout) | Quarter not published within `availability_sensor.timeout_s` | Check the FDA page; clear the run later. |
| `faers_ingest.download_zip` | Network or FDA server error | Retries run automatically; clear the run if they are exhausted. |
| `faers_ingest.parse_to_parquet` / `validate` | Layout change (missing column, empty file) or memory | Read the reason in the marker; compare the zip's README with `config/faers_schema.yaml`. Nothing partial is published. |
| `faers_ingest.cleanup_extracted` | Manifest missing or inconsistent (the task then keeps the files and succeeds) | Inspect the manifest; `make cleanup-extracted` lists what would be deleted. |
| `rxnorm_enrich.resolve_chunk` | RxNav unavailable (five terms in a row in error) | Retries run automatically; terms already resolved are kept. Re-trigger later. |
| `faers_transform.wait_for_writers_idle` (timeout) | An ingestion or lookup run stayed active | Check the other DAGs' runs. |
| `faers_transform.build_warehouse` | dbt model or test failure; the previous warehouse is kept | Run `make dbt-rebuild` to see the failing node; fix, then trigger `faers_transform`. |
| `faers_transform.reconcile_warehouse` | Lake and warehouse counts differ | `make reconcile` prints the table; the warehouse Asset is not published. |

## Disk

- Extracted `.txt` files (about 370 MB per quarter) are deleted by `faers_ingest.cleanup_extracted`
  once the quarter's manifest matches its Parquet files (`cleanup_extracted` in
  `config/faers.yaml`). The zips stay; extraction can be repeated from them.
- Legacy or manual cleanup, dry run first:

  ```bash
  make cleanup-extracted            # lists what would be deleted
  make cleanup-extracted EXECUTE=1  # deletes
  ```

  It only touches `*.txt` inside `data/landing/faers/<quarter>/extracted/` of quarters with a
  consistent manifest; zips, lake, manifests and the RxNorm cache are never touched.
- Airflow task logs grow under `logs/`; failure markers under `logs/failures/`.
- `data/warehouse/_build/` only exists during a build; leftovers of an interrupted build are
  removed by the next build.
