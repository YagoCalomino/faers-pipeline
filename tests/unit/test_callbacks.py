"""Task failure callback (faers_pipeline.callbacks): structured log line and marker file."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from types import SimpleNamespace

from faers_pipeline import callbacks


def context(map_index=-1, exc=None):
    exc = exc or ValueError("lake -> warehouse divergence in: ['DEMO']")
    ti = SimpleNamespace(
        dag_id="faers_transform",
        task_id="reconcile_warehouse",
        run_id="asset_triggered__2026-10-26T18:00:00+00:00",
        map_index=map_index,
        try_number=2,
    )
    dag_run = SimpleNamespace(
        dag_id="faers_transform", logical_date=datetime(2026, 10, 26, tzinfo=UTC)
    )
    return {"ti": ti, "dag_run": dag_run, "exception": exc}


def test_marker_holds_dag_task_run_and_reason(tmp_path, caplog):
    with caplog.at_level(logging.ERROR):
        path = callbacks.on_task_failure(context(), root=tmp_path)
    record = json.loads(path.read_text(encoding="utf-8"))
    assert record["dag_id"] == "faers_transform"
    assert record["task_id"] == "reconcile_warehouse"
    assert record["run_id"] == "asset_triggered__2026-10-26T18:00:00+00:00"
    assert record["try_number"] == 2 and record["map_index"] is None
    assert record["reason"].startswith("ValueError: lake -> warehouse divergence")
    assert record["logical_date"] == "2026-10-26T00:00:00+00:00"
    # one structured line, parseable JSON after the prefix
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("TASK_FAILURE"))
    assert json.loads(line.removeprefix("TASK_FAILURE "))["task_id"] == "reconcile_warehouse"


def test_marker_path_is_file_name_safe_and_per_try(tmp_path):
    path = callbacks.on_task_failure(context(map_index=3), root=tmp_path)
    rel = path.relative_to(tmp_path).as_posix()
    assert rel == (
        "faers_transform/asset_triggered__2026-10-26T18_00_00_00_00/reconcile_warehouse.3.try2.json"
    )
    assert not list(tmp_path.rglob("*.tmp"))


def test_missing_exception_is_recorded_as_unknown(tmp_path):
    ctx = context()
    ctx.pop("exception")
    path = callbacks.on_task_failure(ctx, root=tmp_path)
    assert json.loads(path.read_text(encoding="utf-8"))["reason"] == "unknown"


def test_callback_never_raises(tmp_path, caplog):
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("x")
    with caplog.at_level(logging.ERROR):
        assert callbacks.on_task_failure(context(), root=blocker) is None
    assert "could not write its marker" in caplog.text
