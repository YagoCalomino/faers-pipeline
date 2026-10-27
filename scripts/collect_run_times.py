"""Durations of the successful DAG runs recorded by Airflow, saved for the README numbers
(scripts/readme_numbers.py): per DAG, the number of successful runs, the median and the longest
run. The longest rxnorm_enrich run is the first full lookup (later runs use the cache).

Runs inside an Airflow container with access to the metadata database (scripts/ is not mounted
there, so the file is piped to stdin): `make run-times`. Writes <data>/metrics/runs.json next to
the warehouse folder.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path

from airflow.models.dagrun import DagRun
from airflow.utils.session import create_session

DAGS = ("faers_ingest", "rxnorm_enrich", "faers_transform", "publish_site")
CONFIG_DIR = Path(os.environ.get("FAERS_CONFIG_DIR", "/opt/airflow/config"))


def main() -> int:
    sys.path.insert(0, os.environ.get("PYTHONPATH", "/opt/airflow/src"))
    from faers_pipeline.config import load_config

    out = Path(load_config("faers.yaml")["paths"]["warehouse"]).parents[1] / "metrics" / "runs.json"
    record = {"collected_at": datetime.now(UTC).isoformat(timespec="seconds"), "dags": {}}
    with create_session() as session:
        for dag_id in DAGS:
            runs = (
                session.query(DagRun)
                .filter(DagRun.dag_id == dag_id, DagRun.state == "success")
                .all()
            )
            secs = [
                (r.end_date - r.start_date).total_seconds()
                for r in runs
                if r.start_date and r.end_date
            ]
            record["dags"][dag_id] = {
                "successful_runs": len(secs),
                "median_seconds": round(statistics.median(secs), 1) if secs else None,
                "max_seconds": round(max(secs), 1) if secs else None,
            }
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out)
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
