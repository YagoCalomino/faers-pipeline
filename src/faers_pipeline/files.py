from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

STALE_PATTERNS = ("*.tmp", "*.part")


def remove_stale_temp(directory: Path) -> list[str]:
    """Deletes leftover *.tmp / *.part files (top level only) from an interrupted earlier run.

    Call it before writing into a quarter's own folder: the tasks of one quarter never share a
    folder, so nothing in progress is removed.
    """
    if not directory.is_dir():
        return []
    removed = []
    for pattern in STALE_PATTERNS:
        for path in sorted(directory.glob(pattern)):
            if path.is_file():
                path.unlink(missing_ok=True)
                removed.append(path.name)
    if removed:
        log.warning("Removed stale temp files from %s: %s", directory, removed)
    return removed


def manifest_problems(manifest_path: Path, quarter: str, file_types: list[str]) -> list[str]:
    """Why a quarter's manifest cannot vouch for its Parquet files ([] when it can).

    The manifest must exist, name this quarter, and list every file type plus `deleted`, each
    with a Parquet file that exists and has the row count the manifest recorded.
    """
    import json

    import pyarrow.parquet as pq

    if not manifest_path.is_file():
        return [f"manifest missing: {manifest_path}"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [f"manifest unreadable: {exc}"]
    problems = []
    if manifest.get("quarter") != quarter:
        problems.append(f"manifest quarter {manifest.get('quarter')!r} != {quarter!r}")
    entries = dict(manifest.get("file_types") or {})
    for ft in file_types:
        entry = entries.get(ft)
        if not entry:
            problems.append(f"{ft}: not in manifest")
            continue
        path = Path(entry.get("path", ""))
        if not path.is_file():
            problems.append(f"{ft}: Parquet missing ({path})")
            continue
        rows = pq.ParquetFile(path).metadata.num_rows
        if rows != entry.get("rows"):
            problems.append(f"{ft}: Parquet has {rows} rows, manifest {entry.get('rows')}")
    deleted = manifest.get("deleted") or {}
    if not Path(deleted.get("path", "")).is_file():
        problems.append("deleted: Parquet missing")
    return problems


def cleanup_extracted(
    landing: Path,
    quarter: str,
    manifest_path: Path,
    file_types: list[str],
    dry_run: bool = True,
) -> dict:
    """Deletes the .txt files extracted from a quarter's zip once its manifest vouches for the
    Parquet files. Only `*.txt` directly inside <landing>/<quarter>/extracted/ are touched; the
    zip, the lake and the manifest never are. Idempotent: nothing left to delete is a success.
    """
    folder = (landing / quarter / "extracted").resolve()
    if landing.resolve() not in folder.parents:
        raise ValueError(f"{folder} is not inside {landing}")
    files = sorted(p for p in folder.glob("*.txt") if p.is_file()) if folder.is_dir() else []
    result = {
        "quarter": quarter,
        "folder": str(folder),
        "files": [p.name for p in files],
        "bytes": sum(p.stat().st_size for p in files),
        "dry_run": dry_run,
    }
    problems = manifest_problems(manifest_path, quarter, file_types)
    if problems:
        log.warning("kept extracted files of %s: %s", quarter, problems)
        return {**result, "status": "kept", "problems": problems}
    if not files:
        return {**result, "status": "nothing_to_delete"}
    if not dry_run:
        for p in files:
            p.unlink()
        log.info(
            "deleted %d extracted files of %s (%d bytes)", len(files), quarter, result["bytes"]
        )
    return {**result, "status": "would_delete" if dry_run else "deleted"}
