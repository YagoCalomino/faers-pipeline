"""Ingests a folder laid out like an FDA quarterly zip (ASCII/*.txt, Deleted/*.txt) into a lake.

Same code path as the faers_ingest DAG (zip -> extract_zip -> to_parquet -> parse_deleted, plus
the validate gates), without Airflow or network. Used to build the test lake from
tests/fixtures/faers_sample/<quarter>/ for pytest and for the dbt ci target.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

from faers_pipeline import parse, quality
from faers_pipeline.config import parse_quarter


def zip_folder(folder: Path, zip_path: Path) -> Path:
    """Zips a quarter folder keeping the member paths (ASCII/DEMO26Q2.txt, ...)."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(folder).as_posix())
    return zip_path


def raw_path(lake: Path, file_type: str, quarter: str) -> Path:
    return lake / "raw" / "faers" / file_type / f"quarter={quarter}" / f"{file_type}.parquet"


def ingest_quarter(
    folder: Path, quarter: str, lake: Path, work: Path, faers_cfg: dict, schema_cfg: dict
) -> dict:
    """Parses one quarter folder into lake/raw/faers/<type>/quarter=<q>/. Returns a summary."""
    zip_path = zip_folder(folder, work / quarter / f"{quarter}.zip")
    extracted = parse.extract_zip(zip_path, work / quarter / "extracted", faers_cfg["file_types"])
    results = []
    for file_type in faers_cfg["file_types"]:
        res = parse.to_parquet(
            Path(extracted[file_type]), raw_path(lake, file_type, quarter), faers_cfg["parse"]
        )
        results.append(quality.summarize_parse(file_type, res, schema_cfg))
    quality.check_rows(results)

    year, q = parse_quarter(quarter)
    name = parse.deleted_member_name(faers_cfg["deleted"]["member_pattern"], year, q)
    member, raw = parse.read_member(zip_path, name)
    deleted = parse.parse_deleted(
        raw, Path(member).name, raw_path(lake, "deleted", quarter), faers_cfg["parse"]
    )
    quality.check_contract("deleted", deleted["columns"], schema_cfg)
    return {
        "quarter": quarter,
        "rows": {r["file_type"]: r["rows"] for r in results},
        "deleted_ids": deleted["rows"],
        "invalid_deleted_ids": deleted["invalid_ids"],
    }
