"""Site export built from the real fixture subset (tests/fixtures/site_export/*.parquet), without
the lake, dbt or the network: loads the fixture tables into a throwaway DuckDB file, then runs
the same export, validation and promotion as the DAG publish_site.

Usage (inside the container, e.g. via make site-ci):
    python -I scripts/build_site_fixture.py --out /opt/airflow/data/tmp/site_ci
Writes <out>/faers_fixture.duckdb, <out>/export (validated), <out>/export.ready.json.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))
FIXTURE = REPO / "tests" / "fixtures" / "site_export"

from faers_pipeline import export, site_check  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402


def build_warehouse(path: Path) -> None:
    path.unlink(missing_ok=True)
    con = duckdb.connect(str(path))
    try:
        for f in sorted(FIXTURE.glob("*.parquet")):
            schema, table = f.stem.split(".")
            con.execute(f"create schema if not exists {schema}")
            source = str(f).replace("'", "''")
            con.execute(f"create table {schema}.{table} as select * from read_parquet('{source}')")
    finally:
        con.close()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    site = load_config("site.yaml")
    args.out.mkdir(parents=True, exist_ok=True)
    wh = args.out / "faers_fixture.duckdb"
    build_warehouse(wh)
    candidate, out = args.out / "export.candidate", args.out / "export"
    shutil.rmtree(candidate, ignore_errors=True)
    summary = export.export_site(wh, candidate)
    report = site_check.validate_export(
        candidate, wh, site["limits"], site["downloads"], site["export"]["include_generic_fallback"]
    )
    marker = site_check.promote(candidate, out, args.out / "export.ready.json", report, "fixture")
    print(json.dumps({"export": summary, "counts": report["warehouse_counts"], "marker": marker}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
