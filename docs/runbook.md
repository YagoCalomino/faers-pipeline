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

New DAGs start paused. Unpause the four DAGs for the asset chain to run on its own:

```bash
$AF dags unpause faers_ingest
$AF dags unpause rxnorm_enrich
$AF dags unpause faers_transform
$AF dags unpause publish_site
```

Unpausing `faers_ingest` does not create runs for quarters that already have one; with
`catchup=True` it creates runs only for data intervals between `start_quarter` and
`end_quarter` that have none. `rxnorm_enrich`, `faers_transform` and `publish_site` only run
on new Asset events.

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

## Site export

The site reads files exported from the warehouse, never the warehouse itself
(`src/faers_pipeline/export.py`, settings in `config/site.yaml`).

```bash
make export      # warehouse -> data/site_export/ (read-only on the warehouse)
make export-ci   # same export from the ci database built on the fixture lake (throwaway folder)
```

- Contents: `meta.json` (data window, provisional quarter, RxNorm version, counts, RxNav
  attribution, export date), `manifest.json` (size and sha256 of every other file),
  `parquet/` (ingredients, signals_top, dq_metrics, known_signals) and `json/` (ingredient list,
  one file per ingredient with its pairs, data-quality metrics, known pairs).
- The folder is replaced as a whole: the export is built in `data/site_export.building/` and
  swapped in only when complete; a failed export removes that folder and keeps the previous one.
- Two runs on the same warehouse give identical files (same sha256 in `manifest.json`), except
  `meta.json`, whose export date is the UTC day.
- Generic fallback ingredients stay out unless `export.include_generic_fallback` is true.
- Run it after a successful build, not while dbt is writing the warehouse.
- The JSON keeps every double exactly (`export.json_float_digits: 17`), so the pages show the
  warehouse's numbers; with fewer digits even counts stored as doubles were rounded.

## Publish the site

Chain: `faers_transform` emits `faers_warehouse` -> DAG `publish_site` exports into
`data/site_export.candidate/`, validates it (`src/faers_pipeline/site_check.py`: manifest =
files on disk, warehouse counts = exported counts in every form, a + b + c + d = n_total for
every pair, size limits and column descriptions from `config/site.yaml`), then swaps it into
`data/site_export/`, writes `data/site_export.ready.json` and emits the `site_export` Asset. A
failed validation keeps the previous export and its marker, and emits nothing. The DAG reads
the warehouse read-only and does not take the `duckdb_writer` pool (see its docstring).

To see a validation failure without touching data (no Asset is emitted):

```bash
$AF dags trigger publish_site --conf '{"limits_override": {"export_max_file_bytes": 1000}}'
```

The site is built on the host (Node 22; the Airflow image has no Node):

```bash
make publish-site   # validated export, npm ci, vite build, dist checks, unit + browser tests,
                    # then one orphan commit on the local branch gh-pages; prints the push commands
make site-ci        # the same on the fixture subset: no lake, warehouse, dbt or network
make site-dev       # live preview on data/site_export/
```

- Dependencies are pinned in `site/package.json` and `site/package-lock.json`; the npm cache
  and Playwright's headless Chromium stay in `site/.npm-cache` and `site/.pw-browsers`
  (gitignored). The first `npm ci` needs the network; later builds use the cache.
- `site/scripts/check-dist.mjs` refuses a build with an external resource, a root-absolute or
  broken relative link, a link outside `site.allowed_link_prefixes`, data that differs from the
  export manifest, or sizes above `limits.dist_*`.
- `site/scripts/gh-pages.mjs` commits with a temporary index (`write-tree`, `commit-tree`
  without a parent, `update-ref`): the working tree, the index and the current branch are not
  touched, and the previous `gh-pages` commit is replaced. It refuses a `dist/` whose
  `data/manifest.json` is not the one recorded in the ready marker.
- Publishing is manual: `git push --force origin gh-pages` (force, because the branch always has
  a single commit), then, once, Settings > Pages > Deploy from a branch > `gh-pages`, `/ (root)`.
- Checks of the published numbers: `scripts/verify_site_values.py` (export JSON = DuckDB) and
  `site/tests/verify-values.mjs` (rendered page = DuckDB); timings and screenshots:
  `site/scripts/measure.mjs`; alert share: `scripts/site_alert_stats.py`.

## Failures

Every task of the four DAGs has a failure callback that, when the task fails for good (after
its retries):

- logs one line `TASK_FAILURE {...}` (JSON) in the task log;
- writes a marker `logs/failures/<dag_id>/<run_id>/<task_id>[.<map_index>].try<N>.json` with
  `dag_id`, `task_id`, `run_id`, `map_index`, `try_number`, `logical_date`, `reason` and
  `failed_at`.

```bash
ls -lt logs/failures/*/*/                # markers per DAG and run, newest first
cat logs/failures/<dag_id>/<run_id>/<task_id>.try<N>.json
```

To inspect a build that failed its tests, run dbt into a scratch file (the setting from the
environment wins over `paths.warehouse`); the warehouse is not touched:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps   -e DUCKDB_PATH=/opt/airflow/data/tmp/debug/faers.duckdb airflow-dev   python -I scripts/dbt_run.py build
```

Delete `data/tmp/debug/` afterwards.

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
| `faers_transform.build_warehouse`, test `assert_known_positive_signals_detected` | A positive pair of `seed_known_signals` no longer has a ≥ 3, PRR ≥ 2 and `ror_lcl` > 1; the previous warehouse is kept | The failed build file is removed, so rebuild into a scratch file (see above) and query `signals.mart_known_signals_eval` there (`failure_reason`, `a_fallback_same_name`): check names, RxNorm mapping and ingredient splitting. Do not edit the seed to make it pass. |
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
