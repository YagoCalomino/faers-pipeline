"""DAG 3: dbt build of the DuckDB warehouse (staging -> intermediate -> core -> signals marts).

Triggered by the RxNorm name map Asset, so the chain is faers_ingest -> rxnorm_enrich ->
faers_transform (rxnorm_enrich publishes its Asset even when it made no new calls). No schedule
of its own. Every task that touches the warehouse file runs in the duckdb_writer pool (1 slot).

1. wait_for_writers_idle: reschedules while a faers_ingest or rxnorm_enrich run is active, so the
   build never reads a lake that is being written.
2. build_warehouse: full dbt build into data/warehouse/_build/ (same file name), swapped in with
   os.replace only when every model and test passes; a failure keeps the previous warehouse.
3. reconcile: lake -> warehouse counts recomputed independently; any divergence fails the run.
4. publish_warehouse: emits the warehouse Asset, only when the steps above succeeded.
"""

from __future__ import annotations

from pathlib import Path

import pendulum
from airflow.sdk import Asset, PokeReturnValue, dag, get_current_context, task

from faers_pipeline import warehouse
from faers_pipeline.callbacks import on_task_failure
from faers_pipeline.config import load_config
from faers_pipeline.reconcile import format_table, reconcile

CFG = load_config("faers.yaml")
RXNORM_ASSET = Asset("rxnorm_name_map")
WAREHOUSE_ASSET = Asset("faers_warehouse")
WRITER_DAGS = ("faers_ingest", "rxnorm_enrich")
ACTIVE_STATES = ["queued", "running"]
WAIT = CFG["transform"]["wait_for_ingest"]


@dag(
    dag_id="faers_transform",
    description="dbt build do warehouse DuckDB com troca atômica e reconciliação",
    schedule=[RXNORM_ASSET],
    start_date=pendulum.datetime(2026, 1, 1, tz="UTC"),
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 3,
        "retry_delay": pendulum.duration(minutes=5),
        "retry_exponential_backoff": True,
        "on_failure_callback": on_task_failure,
    },
    tags=["dbt", "transform"],
)
def faers_transform():
    @task.sensor(
        poke_interval=WAIT["poke_interval_s"], timeout=WAIT["timeout_s"], mode="reschedule"
    )
    def wait_for_writers_idle() -> PokeReturnValue:
        ti = get_current_context()["ti"]
        active = {d: ti.get_dr_count(dag_id=d, states=ACTIVE_STATES) for d in WRITER_DAGS}
        print("active runs of lake writers:", active)
        return PokeReturnValue(is_done=not any(active.values()), xcom_value=active)

    # A dbt failure is usually deterministic (a failing test); one retry covers transient errors.
    @task(pool="duckdb_writer", retries=1, retry_delay=pendulum.duration(minutes=2))
    def build_warehouse(_writers: dict) -> dict:
        summary = warehouse.build_atomic(
            Path(CFG["dbt"]["project_dir"]),
            extra_env={
                "DBT_TARGET_PATH": CFG["dbt"]["airflow_target_path"],
                "DBT_LOG_PATH": CFG["dbt"]["airflow_log_path"],
            },
        )
        print("build:", summary)
        return summary

    @task(pool="duckdb_writer")
    def reconcile_warehouse(build: dict) -> dict:
        result = reconcile(Path(CFG["paths"]["lake"]), Path(build["warehouse"]))
        print(format_table(result["rows"]))
        if result["divergent"]:
            raise ValueError(f"lake -> warehouse divergence in: {result['divergent']}")
        return {"divergent": [], "entities": len(result["rows"])}

    @task(outlets=[WAREHOUSE_ASSET])
    def publish_warehouse(build: dict, checked: dict) -> dict:
        return {**build, "reconciled": checked}

    writers = wait_for_writers_idle()
    build = build_warehouse(writers)
    publish_warehouse(build, reconcile_warehouse(build))


faers_transform()
