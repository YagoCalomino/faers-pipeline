"""Builds a test lake from tests/fixtures/faers_sample/<quarter>/ with the real parse code.

    python -I scripts/build_test_lake.py --out /tmp/faers_ci/lake

Every quarter folder of the fixture goes through faers_pipeline.local_ingest (zip, extract,
Parquet, deleted, validate gates). Then the RxNorm layer: the real cache subset in
tests/fixtures/rxnorm_sample/term_lookup.jsonl is written as the lake's cache, and the name map is
built from it with the same code as the rxnorm_enrich DAG (no network). The output folder is
replaced; nothing is written to data/.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import rxnorm  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.local_ingest import ingest_quarter  # noqa: E402

FIXTURE = REPO / "tests" / "fixtures" / "faers_sample"
RXNORM_FIXTURE = REPO / "tests" / "fixtures" / "rxnorm_sample" / "term_lookup.jsonl"


def build_rxnorm(lake: Path, fixture: Path) -> dict:
    """Cache and name map of the test lake, at the paths dbt reads (LAKE_PATH/raw/rxnorm/...)."""
    rx = load_config("rxnorm.yaml")
    roles = load_config("signals.yaml")["signal_drug_roles"]
    rows = []
    for line in fixture.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        r["resolved_at"] = datetime.fromisoformat(r["resolved_at"])
        rows.append(r)
    base = lake / "raw" / "rxnorm"
    rxnorm.write_parquet_atomic(rows, base / "cache" / rxnorm.CACHE_FILE, rxnorm.CACHE_SCHEMA)
    names = [n for n, _ in rxnorm.lake_names(lake, roles)]
    sep = rx["lookup"]["combination_separator"]
    min_score = rx["approximate_rules"]["min_score"]
    map_rows, summary = rxnorm.build_name_map(names, rows, sep, min_score)
    rxnorm.write_parquet_atomic(
        map_rows, base / "name_map" / rxnorm.NAME_MAP_FILE, rxnorm.NAME_MAP_SCHEMA
    )
    return {"cache_rows": len(rows), **summary}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="lake folder to (re)create")
    ap.add_argument("--fixture", default=str(FIXTURE))
    ap.add_argument("--no-rxnorm", action="store_true", help="FAERS files only")
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
    if not args.no_rxnorm:
        print(json.dumps({"rxnorm": build_rxnorm(lake, RXNORM_FIXTURE)}))
    print(f"test lake: {lake} ({len(quarters)} quarters)")


if __name__ == "__main__":
    main()
