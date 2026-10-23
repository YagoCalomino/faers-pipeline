from __future__ import annotations

from pathlib import Path

import pytest
from airflow.models import DagBag

DAGS_DIR = Path(__file__).resolve().parents[1] / "dags"


@pytest.fixture(scope="module")
def bag() -> DagBag:
    # Airflow 3.3 removed `include_examples`; examples are off via AIRFLOW__CORE__LOAD_EXAMPLES.
    return DagBag(dag_folder=str(DAGS_DIR))


def test_no_import_errors(bag):
    assert bag.import_errors == {}, bag.import_errors


def test_faers_ingest_shape(bag):
    # bag.get_dag() queries the metadata DB in Airflow 3.3; bag.dags does not.
    dag = bag.dags.get("faers_ingest")
    assert dag is not None
    assert dag.catchup is True
    assert {"resolve_quarter", "wait_for_release", "parse_to_parquet"} <= set(dag.task_ids)
    assert dag.default_args["retries"] >= 1


def test_every_dag_has_tags_and_retries(bag):
    for dag_id, dag in bag.dags.items():
        assert dag.tags, f"{dag_id} sem tags"
        assert dag.default_args.get("retries", 0) >= 1, f"{dag_id} sem retries"
