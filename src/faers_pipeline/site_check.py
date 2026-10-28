"""Validation and promotion of the site export (DAG publish_site, make publish-site).

publish_site exports into a candidate folder (config/site.yaml export.candidate_dir), validates
it here and only then swaps it into export.out_dir and writes the ready marker. A failed check
leaves the previous export and its marker as they were.

validate_export checks, on the candidate folder and the warehouse it came from:
    manifest   manifest.json lists exactly the files on disk, with the same size and sha256
    counts     ingredients, pairs, data-quality rows and known pairs in the warehouse marts equal
               the rows in every exported form (Parquet tables, JSON lists, per-ingredient files)
    cells      every exported pair has b, c, d and n_total with a + b + c + d = n_total
    meta       meta.json has the fields the site shows and its counts match the marts
    sizes      total bytes, largest file and number of files within config/site.yaml limits
    columns    every Parquet column has a description in config/site.yaml downloads, and every
               described column exists

Ready marker (export.ready_marker): JSON with the sha256 of manifest.json, the export date and
the validation summary. make publish-site builds the site only when the marker's sha256 equals
the current manifest.json's.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from faers_pipeline.export import queries, read_manifest_from_disk, swap_in

META_FIELDS = (
    "export_date",
    "first_quarter",
    "last_quarter",
    "provisional_quarter",
    "last_quarter_is_provisional",
    "quarters",
    "rxnorm_versions",
    "rxnav_attribution",
    "n_ingredients",
    "n_pairs",
)
PARQUET_TABLES = ("ingredients", "signals_top", "dq_metrics", "known_signals")


class ExportValidationError(Exception):
    """The export failed at least one check; `problems` lists them."""

    def __init__(self, problems: list[str], report: dict) -> None:
        super().__init__(f"{len(problems)} problem(s): " + "; ".join(problems[:10]))
        self.problems = problems
        self.report = report


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _sql_path(path: Path) -> str:
    return str(path).replace("'", "''")


def mart_counts(warehouse: Path, include_generic: bool) -> dict[str, int]:
    """Rows of each exported table, counted on the warehouse with the export's own queries."""
    sql = queries(include_generic)
    con = duckdb.connect(str(warehouse), read_only=True)
    try:
        return {
            name: con.execute(f"select count(*) from ({query})").fetchone()[0]
            for name, query in sql.items()
        }
    finally:
        con.close()


def _check_manifest(out: Path, problems: list[str]) -> list[dict]:
    path = out / "manifest.json"
    if not path.is_file():
        problems.append("manifest.json missing")
        return []
    listed = _load(path)["files"]
    on_disk = read_manifest_from_disk(out)
    if listed != on_disk:
        listed_by = {f["path"]: f for f in listed}
        disk_by = {f["path"]: f for f in on_disk}
        missing = sorted(set(listed_by) - set(disk_by))
        extra = sorted(set(disk_by) - set(listed_by))
        changed = sorted(p for p in set(listed_by) & set(disk_by) if listed_by[p] != disk_by[p])
        problems.append(
            f"manifest differs from disk: missing {missing[:5]}, extra {extra[:5]}, "
            f"changed {changed[:5]}"
        )
    return on_disk


def _check_sizes(out: Path, files: list[dict], limits: dict, problems: list[str]) -> dict:
    total = sum(f["bytes"] for f in files) + (out / "manifest.json").stat().st_size
    largest = max(files, key=lambda f: f["bytes"]) if files else {"path": None, "bytes": 0}
    n_files = len(files) + 1
    sizes = {
        "total_bytes": total,
        "largest_file": largest["path"],
        "largest_bytes": largest["bytes"],
        "files": n_files,
    }
    if total > limits["export_max_total_bytes"]:
        problems.append(f"export is {total} bytes, limit {limits['export_max_total_bytes']}")
    if largest["bytes"] > limits["export_max_file_bytes"]:
        problems.append(
            f"{largest['path']} is {largest['bytes']} bytes, "
            f"limit {limits['export_max_file_bytes']}"
        )
    if n_files > limits["export_max_files"]:
        problems.append(f"export has {n_files} files, limit {limits['export_max_files']}")
    return sizes


def _parquet_info(out: Path) -> tuple[dict[str, int], dict[str, list[str]]]:
    rows, columns = {}, {}
    con = duckdb.connect()
    try:
        for name in PARQUET_TABLES:
            path = _sql_path(out / "parquet" / f"{name}.parquet")
            source = f"read_parquet('{path}')"
            rows[name] = con.execute(f"select count(*) from {source}").fetchone()[0]
            described = con.execute(f"describe select * from {source}").fetchall()
            columns[name] = [r[0] for r in described]
    finally:
        con.close()
    return rows, columns


def _check_cells(pairs: list[dict], where: str, problems: list[str]) -> int:
    bad = 0
    for p in pairs:
        cells = [p.get(k) for k in ("a", "b", "c", "d", "n_total")]
        if any(v is None for v in cells) or cells[0] + cells[1] + cells[2] + cells[3] != cells[4]:
            bad += 1
            if bad <= 3:
                problems.append(f"{where}: {p.get('reaction_pt')} has a+b+c+d != n_total {cells}")
    return bad


def validate_export(
    out: Path, warehouse: Path, limits: dict, downloads: dict, include_generic: bool = False
) -> dict:
    """Runs every check on the export folder `out`. Returns the report; raises
    ExportValidationError (with the report) when any check fails."""
    out = Path(out)
    problems: list[str] = []
    files = _check_manifest(out, problems)
    sizes = _check_sizes(out, files, limits, problems) if files else {}
    expected = mart_counts(warehouse, include_generic)

    meta = _load(out / "meta.json")
    absent = [f for f in META_FIELDS if f not in meta or meta[f] in (None, "")]
    if absent:
        problems.append(f"meta.json lacks {absent}")
    exported: dict[str, dict[str, int]] = {name: {} for name in expected}
    formats = meta.get("formats", [])

    if "parquet" in formats:
        rows, columns = _parquet_info(out)
        for name, n in rows.items():
            exported[name]["parquet"] = n
        for name, cols in columns.items():
            described = set((downloads.get(name) or {}).get("columns") or {})
            undocumented = [c for c in cols if c not in described]
            stale = sorted(described - set(cols))
            if undocumented:
                problems.append(f"parquet/{name}: columns without description {undocumented}")
            if stale:
                problems.append(f"downloads.{name}: described columns not exported {stale}")

    bad_cells = 0
    if "json" in formats:
        ingredients = _load(out / "json" / "ingredients.json")
        search = _load(out / "json" / "search.json")
        exported["ingredients"]["json"] = len(ingredients)
        exported["ingredients"]["search"] = len(search["rows"])
        slugs = [i["slug"] for i in ingredients]
        if len(set(slugs)) != len(slugs):
            problems.append("ingredient slugs are not unique")
        signal_files = sorted((out / "json" / "signals").glob("*.json"))
        exported["ingredients"]["files"] = len(signal_files)
        n_pairs = 0
        for ing in ingredients:
            path = out / "json" / "signals" / f"{ing['slug']}.json"
            if not path.is_file():
                problems.append(f"json/signals/{ing['slug']}.json missing")
                continue
            doc = _load(path)
            n_pairs += len(doc["pairs"])
            if len(doc["pairs"]) != ing["n_pairs"]:
                problems.append(
                    f"{ing['slug']}: {len(doc['pairs'])} pairs in its file, "
                    f"n_pairs {ing['n_pairs']}"
                )
            bad_cells += _check_cells(doc["pairs"], ing["slug"], problems)
        exported["signals_top"]["json"] = n_pairs
        exported["dq_metrics"]["json"] = len(_load(out / "json" / "dq_metrics.json"))
        exported["known_signals"]["json"] = len(_load(out / "json" / "known_signals.json"))

    for name, n in expected.items():
        for form, m in exported[name].items():
            if m != n:
                problems.append(f"{name}: warehouse {n} rows, exported {form} {m}")
    for key, table in (("n_ingredients", "ingredients"), ("n_pairs", "signals_top")):
        if meta.get(key) != expected[table]:
            problems.append(f"meta.{key} = {meta.get(key)}, warehouse {expected[table]}")

    report = {
        "out_dir": str(out),
        "ok": not problems,
        "warehouse_counts": expected,
        "exported_counts": exported,
        "pairs_with_bad_cells": bad_cells,
        "sizes": sizes,
        "limits": limits,
        "problems": problems,
    }
    if problems:
        raise ExportValidationError(problems, report)
    return report


def manifest_sha256(out: Path) -> str:
    return hashlib.sha256((Path(out) / "manifest.json").read_bytes()).hexdigest()


def write_ready_marker(out: Path, marker: Path, report: dict, run_id: str | None = None) -> dict:
    """Atomic write of the ready marker for the export in `out` (tmp file + os.replace)."""
    meta = _load(Path(out) / "meta.json")
    record = {
        "manifest_sha256": manifest_sha256(out),
        "export_dir": str(out),
        "export_date": meta["export_date"],
        "last_quarter": meta["last_quarter"],
        "validated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "run_id": run_id,
        "warehouse_counts": report["warehouse_counts"],
        "sizes": report["sizes"],
    }
    marker = Path(marker)
    marker.parent.mkdir(parents=True, exist_ok=True)
    tmp = marker.with_name(marker.name + ".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, marker)
    return record


def is_ready(out: Path, marker: Path) -> bool:
    """True when `marker` exists and matches the export currently in `out`."""
    marker, out = Path(marker), Path(out)
    if not marker.is_file() or not (out / "manifest.json").is_file():
        return False
    return _load(marker).get("manifest_sha256") == manifest_sha256(out)


def promote(candidate: Path, out_dir: Path, marker: Path, report: dict, run_id=None) -> dict:
    """Swaps the validated candidate into out_dir, then writes the ready marker. The old marker
    is removed first, so a crash between the two steps leaves no marker that matches."""
    marker = Path(marker)
    marker.unlink(missing_ok=True)
    swap_in(Path(candidate), Path(out_dir))
    return write_ready_marker(out_dir, marker, {**report, "out_dir": str(out_dir)}, run_id)
