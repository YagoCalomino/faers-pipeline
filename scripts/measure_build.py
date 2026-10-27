"""Full atomic dbt build of the warehouse with its wall time and the container's memory peak, saved
for the README numbers (scripts/readme_numbers.py).

Runs the same build as `make dbt-rebuild` (faers_pipeline.warehouse.build_atomic) inside the
one-off dev container, then reads the cgroup v2 counter /sys/fs/cgroup/memory.peak: the peak
memory of everything in the container (Python and the dbt process with DuckDB). Writes
data/metrics/build.json (data/ is not versioned).

Usage (inside the container): python -I scripts/measure_build.py
Never run it while an ingestion is writing the lake.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import warehouse  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402

PEAK = Path("/sys/fs/cgroup/memory.peak")


def main() -> int:
    data_dir = Path(load_config("faers.yaml")["paths"]["warehouse"]).parents[1]
    out = data_dir / "metrics" / "build.json"
    t0 = time.perf_counter()
    summary = warehouse.build_atomic(REPO / "dbt" / "faers_dbt", args=["build"])
    seconds = round(time.perf_counter() - t0, 1)
    peak = int(PEAK.read_text().strip()) if PEAK.exists() else None
    results = json.loads(
        (REPO / "dbt" / "faers_dbt" / "target" / "run_results.json").read_text(encoding="utf-8")
    )
    nodes: dict[str, int] = {}
    for r in results["results"]:
        kind = r["unique_id"].split(".")[0]
        nodes[f"{kind}:{r['status']}"] = nodes.get(f"{kind}:{r['status']}", 0) + 1
    record = {
        "measured_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "command": "warehouse.build_atomic (make dbt-rebuild)",
        "seconds": seconds,
        "container_memory_peak_bytes": peak,
        "dbt_memory_limit": load_config("faers.yaml")["dbt"]["memory_limit"],
        "warehouse_bytes": Path(summary["warehouse"]).stat().st_size,
        "dbt_nodes": nodes,
        "build": summary,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text(json.dumps(record, indent=2, default=str) + "\n", encoding="utf-8")
    os.replace(tmp, out)
    print(json.dumps({k: v for k, v in record.items() if k != "build"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
