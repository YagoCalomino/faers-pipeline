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
        assert dag.tags, f"{dag_id} sem tags"
        assert dag.default_args.get("retries", 0) >= 1, f"{dag_id} sem retries"
