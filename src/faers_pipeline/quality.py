from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from faers_pipeline.files import remove_stale_temp

TYPE_FIELDS = (
    "rows",
    "columns",
    "extra_columns",
    "encoding",
    "malformed_rows",
    "blank_lines",
    "content_fingerprint",
    "parse_seconds",
    "peak_rss_mb",
    "path",
)


def check_contract(file_type: str, columns: list[str], schema_cfg: dict) -> dict:
    """Fails if a required column is missing; extra columns are only reported."""
    expected = set(schema_cfg[file_type])
    actual = {c for c in columns if not c.startswith("_")}
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing:
        raise ValueError(f"[{file_type}] colunas obrigatórias ausentes: {missing}")
    return {"file_type": file_type, "extra_columns": extra}


def summarize_parse(file_type: str, res: dict, schema_cfg: dict) -> dict:
    """Checks the contract of one parse.to_parquet result and keeps what the manifest needs."""
    contract = check_contract(file_type, res["columns"], schema_cfg)
    return {
        "file_type": file_type,
        "rows": res["rows"],
        "expected_rows": res["expected_rows"],
        "columns": [c for c in res["columns"] if not c.startswith("_")],
        "extra_columns": contract["extra_columns"],
        "encoding": res["encoding"],
        "malformed_rows": res["malformed_rows"],
        "blank_lines": res["blank_lines"],
        "content_fingerprint": res["content_fingerprint"],
        "path": res["path"],
    }


def check_rows(results: list[dict]) -> None:
    """Gate: every type has rows, and Parquet rows = non-empty data lines of the .txt."""
    empty = [r["file_type"] for r in results if r["rows"] == 0]
    if empty:
        raise ValueError(f"Arquivos sem linhas: {empty}")
    diff = {
        r["file_type"]: (r["rows"], r["expected_rows"])
        for r in results
        if r["rows"] != r["expected_rows"]
    }
    if diff:
        raise ValueError(f"Linhas no Parquet != linhas do .txt (parquet, txt): {diff}")


def count_deleted_in_demo(demo_path: str | Path, deleted_path: str | Path) -> int:
    """Distinct deleted caseids that also appear in the quarter's DEMO."""
    con = duckdb.connect()
    try:
        return con.execute(
            "SELECT count(DISTINCT d.caseid) "
            "FROM read_parquet($deleted, hive_partitioning = false) d "
            "WHERE d.caseid IN "
            "(SELECT caseid FROM read_parquet($demo, hive_partitioning = false))",
            {"deleted": str(deleted_path), "demo": str(demo_path)},
        ).fetchone()[0]
    finally:
        con.close()


def build_manifest(
    quarter: str,
    dl: dict,
    results: list[dict],
    deleted: dict,
    run_id: str | None,
    deleted_in_demo: int | None,
) -> dict:
    return {
        "quarter": quarter,
        "run_id": run_id,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "duckdb_version": duckdb.__version__,
        "zip": {
            "url": dl["url"],
            "bytes": dl["bytes"],
            "sha256": dl["sha256"],
            "source_changed": dl.get("source_changed", False),
            "previous_sha256": dl.get("previous_sha256"),
        },
        "file_types": {
            r["file_type"]: {k: r.get(k) for k in TYPE_FIELDS}
            for r in sorted(results, key=lambda r: r["file_type"])
        },
        "deleted": {
            "source_file": deleted["source_file"],
            "deleted_ids": deleted["rows"],
            "distinct_deleted_ids": deleted["distinct_ids"],
            "invalid_deleted_ids": deleted["invalid_ids"],
            "invalid_examples": deleted["invalid_examples"],
            "blank_lines": deleted["blank_lines"],
            "deleted_ids_in_demo": deleted_in_demo,
            "content_fingerprint": deleted["content_fingerprint"],
            "parse_seconds": deleted.get("parse_seconds"),
            "path": deleted["path"],
        },
    }


def write_manifest(manifest: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    remove_stale_temp(path.parent)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
