from __future__ import annotations

import json
import os
from pathlib import Path


def check_contract(file_type: str, columns: list[str], schema_cfg: dict) -> dict:
    """Fails if a required column is missing; extra columns are only reported."""
    expected = set(schema_cfg[file_type])
    actual = {c for c in columns if not c.startswith("_")}
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing:
        raise ValueError(f"[{file_type}] colunas obrigatórias ausentes: {missing}")
    return {"file_type": file_type, "extra_columns": extra}


def write_manifest(manifest: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
