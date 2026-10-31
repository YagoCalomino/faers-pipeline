from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest
from airflow.models import DagBag

from faers_pipeline import download

REPO = Path(__file__).resolve().parents[1]
DAGS_DIR = REPO / "dags"
POOLS = REPO / "infra" / "airflow" / "pools.json"

FAERS_TASKS = {
    "resolve_quarter",
    "wait_for_release",
    "download_zip",
    "extract",
    "parse_to_parquet",
    "ingest_deleted",
    "validate",
    "publish_manifest",
    "cleanup_extracted",
}


@pytest.fixture(scope="module")
def bag() -> DagBag:
    # Airflow 3.3 removed `include_examples`; examples are off via AIRFLOW__CORE__LOAD_EXAMPLES.
    return DagBag(dag_folder=str(DAGS_DIR))


@pytest.fixture(scope="module")
def faers_dag(bag):
    # bag.get_dag() queries the metadata DB in Airflow 3.3; bag.dags does not.
    dag = bag.dags.get("faers_ingest")
    assert dag is not None
    return dag


def test_no_import_errors(bag):
    assert bag.import_errors == {}, bag.import_errors


def test_faers_ingest_shape(faers_dag):
    assert faers_dag.catchup is True
    assert set(faers_dag.task_ids) == FAERS_TASKS
    assert faers_dag.default_args["retries"] == 3
    assert faers_dag.default_args["retry_exponential_backoff"] is True
    for task in faers_dag.tasks:
        assert task.retries == 3, task.task_id


def test_sensor_reschedules_instead_of_holding_a_slot(faers_dag):
    assert faers_dag.get_task("wait_for_release").mode == "reschedule"


def test_parse_runs_in_parse_pool_with_two_slots(faers_dag):
    task = faers_dag.get_task("parse_to_parquet")
    assert task.pool == "parse"
    assert task.max_active_tis_per_dag is None
    pools = json.loads(POOLS.read_text(encoding="utf-8"))
    assert pools["parse"]["slots"] == 2


def test_deleted_runs_beside_the_mapped_parse(faers_dag, faers_cfg):
    assert "deleted" not in faers_cfg["file_types"]
    deleted = faers_dag.get_task("ingest_deleted")
    assert deleted.upstream_task_ids == {"resolve_quarter", "download_zip"}
    assert faers_dag.get_task("validate").upstream_task_ids >= {
        "parse_to_parquet",
        "ingest_deleted",
        "download_zip",
    }


def test_sensor_not_done_when_zip_is_missing(faers_dag):
    sensor = faers_dag.get_task("wait_for_release")
    with mock.patch.object(download, "is_available", return_value=False) as avail:
        result = sensor.python_callable("2026Q3")
    assert result.is_done is False
    assert avail.call_args.args[0].endswith("faers_ascii_2026q3.zip")


def test_every_dag_has_tags_and_retries(bag):
    for dag_id, dag in bag.dags.items():
        assert dag.tags, f"{dag_id} has no tags"
        assert dag.default_args.get("retries", 0) >= 1, f"{dag_id} has no retries"


@pytest.fixture(scope="module")
def rxnorm_dag(bag):
    dag = bag.dags.get("rxnorm_enrich")
    assert dag is not None
    return dag


def test_rxnorm_enrich_shape(rxnorm_dag):
    assert set(rxnorm_dag.task_ids) == {
        "plan_lookups",
        "resolve_chunk",
        "merge_cache",
        "build_name_map",
    }
    assert rxnorm_dag.catchup is False
    assert rxnorm_dag.max_active_runs == 1
    for task in rxnorm_dag.tasks:
        assert task.retries == 3, task.task_id


def test_rxnorm_enrich_runs_on_the_faers_raw_asset(rxnorm_dag, faers_dag):
    published = {o.name for o in faers_dag.get_task("publish_manifest").outlets}
    assert published == {"faers_raw_parquet"}
    assert "faers_raw_parquet" in repr(rxnorm_dag.timetable.asset_condition)
    outlets = rxnorm_dag.get_task("build_name_map").outlets
    assert {o.name for o in outlets} == {"rxnorm_name_map"}


def test_rxnorm_lookups_are_mapped_in_a_one_slot_pool(rxnorm_dag):
    task = rxnorm_dag.get_task("resolve_chunk")
    assert task.pool == "rxnorm_api"
    assert type(task).__name__.endswith("MappedOperator")
    pools = json.loads(POOLS.read_text(encoding="utf-8"))
    assert pools["rxnorm_api"]["slots"] == 1


def test_rxnorm_merge_runs_when_nothing_was_looked_up(rxnorm_dag):
    # An empty mapping skips resolve_chunk; the cache merge and the map rebuild still run.
    for task_id in ("merge_cache", "build_name_map"):
        assert rxnorm_dag.get_task(task_id).trigger_rule == "none_failed"


def test_rxnorm_trial_limit_is_a_run_param(rxnorm_dag, rx_limit):
    assert rxnorm_dag.params["max_names"] == rx_limit
    assert rxnorm_dag.params["selection"] == "top"


@pytest.fixture(scope="module")
def rx_limit():
    import yaml

    cfg = yaml.safe_load((REPO / "config" / "rxnorm.yaml").read_text(encoding="utf-8"))
    return cfg["lookup"]["max_names"]


def test_cleanup_runs_after_the_manifest(faers_dag):
    task = faers_dag.get_task("cleanup_extracted")
    assert task.upstream_task_ids == {"resolve_quarter", "publish_manifest"}


@pytest.fixture(scope="module")
def transform_dag(bag):
    dag = bag.dags.get("faers_transform")
    assert dag is not None
    return dag


def test_faers_transform_shape(transform_dag):
    assert set(transform_dag.task_ids) == {
        "wait_for_writers_idle",
        "build_warehouse",
        "publish_warehouse",
    }
    assert transform_dag.catchup is False and transform_dag.max_active_runs == 1
    assert transform_dag.get_task("wait_for_writers_idle").mode == "reschedule"
    assert transform_dag.get_task("publish_warehouse").upstream_task_ids == {"build_warehouse"}


def test_faers_transform_runs_on_the_rxnorm_asset_only(transform_dag, rxnorm_dag):
    condition = repr(transform_dag.timetable.asset_condition)
    assert "rxnorm_name_map" in condition and "faers_raw_parquet" not in condition
    published = {o.name for o in rxnorm_dag.get_task("build_name_map").outlets}
    assert published == {"rxnorm_name_map"}


def test_warehouse_writers_use_the_one_slot_pool(transform_dag):
    assert transform_dag.get_task("build_warehouse").pool == "duckdb_writer"
    pools = json.loads(POOLS.read_text(encoding="utf-8"))
    assert pools["duckdb_writer"]["slots"] == 1


def test_warehouse_asset_only_after_build_and_reconcile(transform_dag):
    task = transform_dag.get_task("publish_warehouse")
    assert {o.name for o in task.outlets} == {"faers_warehouse"}
    assert task.trigger_rule == "all_success"
    assert not transform_dag.get_task("build_warehouse").outlets


def test_every_task_has_the_failure_callback(bag):
    from faers_pipeline.callbacks import on_task_failure

    for dag_id, dag in bag.dags.items():
        for task in dag.tasks:
            cbs = task.on_failure_callback
            cbs = cbs if isinstance(cbs, list) else [cbs]
            assert on_task_failure in cbs, f"{dag_id}.{task.task_id}"


@pytest.fixture(scope="module")
def publish_dag(bag):
    dag = bag.dags.get("publish_site")
    assert dag is not None
    return dag


def test_publish_site_shape(publish_dag):
    assert set(publish_dag.task_ids) == {"export_candidate", "validate_candidate", "promote_export"}
    assert publish_dag.catchup is False and publish_dag.max_active_runs == 1
    assert publish_dag.get_task("validate_candidate").upstream_task_ids == {"export_candidate"}
    assert publish_dag.get_task("promote_export").upstream_task_ids == {"validate_candidate"}
    assert publish_dag.get_task("validate_candidate").retries == 0
    assert publish_dag.params["limits_override"] == {}


def test_publish_site_runs_on_the_warehouse_asset(publish_dag, transform_dag):
    assert "faers_warehouse" in repr(publish_dag.timetable.asset_condition)
    published = {o.name for o in transform_dag.get_task("publish_warehouse").outlets}
    assert published == {"faers_warehouse"}


def test_site_export_asset_only_after_validation(publish_dag):
    task = publish_dag.get_task("promote_export")
    assert {o.name for o in task.outlets} == {"site_export"}
    assert task.trigger_rule == "all_success"
    for task_id in ("export_candidate", "validate_candidate"):
        assert not publish_dag.get_task(task_id).outlets


def test_publish_site_reads_without_the_writer_pool(publish_dag):
    # Read-only on the warehouse (see the DAG docstring); the pool would only delay dbt.
    for task in publish_dag.tasks:
        assert task.pool != "duckdb_writer", task.task_id
