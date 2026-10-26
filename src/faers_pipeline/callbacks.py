"""Task failure callback without external services: a structured log line and a marker file.

on_task_failure runs as on_failure_callback, i.e. when a task fails for good (after its
retries; retries themselves call on_retry_callback). In the Airflow 3.3 Task SDK the callback
context carries "exception" (set before the callbacks run), "ti" and "dag_run".

Marker: <paths.failure_markers>/<dag_id>/<run_id>/<task_id>[.<map_index>].try<N>.json, written
atomically (tmp + os.replace). It holds dag_id, task_id, run_id, map_index, try_number,
logical_date, reason and failed_at. The callback never raises: a broken callback must not hide
the task's own failure.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from faers_pipeline.config import load_config

log = logging.getLogger(__name__)


def _safe(part: object) -> str:
    """File-name-safe text (run ids contain ':' and '+')."""
    return re.sub(r"[^A-Za-z0-9._=-]", "_", str(part))


def failure_record(context: dict) -> dict:
    ti = context.get("ti")
    dag_run = context.get("dag_run")
    exc = context.get("exception")
    logical = getattr(dag_run, "logical_date", None) or context.get("logical_date")
    map_index = getattr(ti, "map_index", None)
    return {
        "event": "task_failure",
        "dag_id": getattr(ti, "dag_id", None) or getattr(dag_run, "dag_id", None),
        "task_id": getattr(ti, "task_id", None),
        "run_id": getattr(ti, "run_id", None) or context.get("run_id"),
        "map_index": map_index if map_index not in (None, -1) else None,
        "try_number": getattr(ti, "try_number", None),
        "logical_date": logical.isoformat() if hasattr(logical, "isoformat") else logical,
        "reason": f"{type(exc).__name__}: {exc}" if exc is not None else "unknown",
        "failed_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


def marker_path(record: dict, root: Path) -> Path:
    name = _safe(record["task_id"])
    if record["map_index"] is not None:
        name += f".{record['map_index']}"
    name += f".try{record['try_number']}.json"
    return root / _safe(record["dag_id"]) / _safe(record["run_id"]) / name


def write_marker(record: dict, root: Path) -> Path:
    path = marker_path(record, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return path


def on_task_failure(context: dict, root: Path | None = None) -> Path | None:
    """on_failure_callback for every task of the project's DAGs."""
    try:
        record = failure_record(context)
        log.error("TASK_FAILURE %s", json.dumps(record, sort_keys=True))
        root = root or Path(load_config("faers.yaml")["paths"]["failure_markers"])
        path = write_marker(record, root)
        log.error("failure marker written: %s", path)
        return path
    except Exception:  # never mask the task's own failure
        log.exception("failure callback could not write its marker")
        return None
