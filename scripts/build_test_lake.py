"""Builds a test lake from tests/fixtures/faers_sample/<quarter>/ with the real parse code.

    python -I scripts/build_test_lake.py --out /tmp/faers_ci/lake

Every quarter folder of the fixture goes through faers_pipeline.local_ingest (zip, extract,
Parquet, deleted, validate gates). The output folder is replaced; nothing is written to data/.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.local_ingest import ingest_quarter  # noqa: E402

FIXTURE = REPO / "tests" / "fixtures" / "faers_sample"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="lake folder to (re)create")
    ap.add_argument("--fixture", default=str(FIXTURE))
    args = ap.parse_args()

    lake = Path(args.out)
    work = lake.parent / f"{lake.name}_work"
    for folder in (lake, work):
        if folder.exists():
            shutil.rmtree(folder)
    cfg = copy.deepcopy(load_config("faers.yaml"))
    cfg["parse"]["duckdb"]["temp_directory"] = str(work / "duckdb_tmp")
    schema = load_config("faers_schema.yaml")

    quarters = sorted(p.name for p in Path(args.fixture).iterdir() if p.is_dir())
    for quarter in quarters:
        summary = ingest_quarter(Path(args.fixture) / quarter, quarter, lake, work, cfg, schema)
        print(json.dumps(summary))
    shutil.rmtree(work, ignore_errors=True)
    print(f"test lake: {lake} ({len(quarters)} quarters)")


if __name__ == "__main__":
    main()
