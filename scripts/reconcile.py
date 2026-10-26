"""Reconciles the raw lake (Parquet) with the warehouse core facts. Read-only on both.

    python -I scripts/reconcile.py            (inside the container; or `make reconcile`)

Logic in faers_pipeline.reconcile (shared with the faers_transform DAG). Paths from
config/faers.yaml (paths.lake, paths.warehouse). Exit code 1 if any expected value differs from
the warehouse. Do not run while dbt is writing the warehouse.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.reconcile import format_table, reconcile  # noqa: E402


def main() -> int:
    paths = load_config("faers.yaml")["paths"]
    result = reconcile(Path(paths["lake"]), Path(paths["warehouse"]))
    print("Reconciliation: raw lake (Parquet) -> warehouse core")
    print(format_table(result["rows"]))
    if result["divergent"]:
        print(f"\nDIVERGENCE in: {', '.join(result['divergent'])}")
        return 1
    print("\nOK: every warehouse count equals the value recomputed from the lake.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
