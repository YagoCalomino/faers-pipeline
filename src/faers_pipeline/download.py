from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

ZIP_MAGIC = b"PK\x03\x04"


def _headers(user_agent: str) -> dict[str, str]:
    # The FDA server answers "Accept-Encoding: gzip" (the requests default) with
    # "Content-Encoding: gzip" and then never sends the body. Ask for raw bytes.
    return {"User-Agent": user_agent, "Accept-Encoding": "identity"}


def is_available(url: str, timeout: int, user_agent: str) -> bool:
    """True if the zip exists at the URL. Never raises on network errors (the sensor retries).

    Uses a ranged GET for the first 4 bytes instead of HEAD: the FDA server answers HEAD
    with Content-Length 0 and returns 500 (not 404) for missing files. Checking the zip
    signature also rejects HTML error pages served with status 200.
    """
    headers = {**_headers(user_agent), "Range": f"bytes=0-{len(ZIP_MAGIC) - 1}"}
    try:
        with requests.get(
            url, headers=headers, timeout=timeout, stream=True, allow_redirects=True
        ) as r:
            if r.status_code not in (200, 206):
                return False
            head = next(r.iter_content(chunk_size=len(ZIP_MAGIC)), b"")
            return head[: len(ZIP_MAGIC)] == ZIP_MAGIC
    except requests.RequestException:
        return False


def download_zip(url: str, dest: Path, timeout: int, user_agent: str) -> dict:
    """Streams to a .part file and moves it atomically. Returns path, bytes and sha256."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    sha = hashlib.sha256()
    size = 0
    try:
        with requests.get(url, stream=True, timeout=timeout, headers=_headers(user_agent)) as r:
            r.raise_for_status()
            with open(part, "wb") as fh:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    fh.write(chunk)
                    sha.update(chunk)
                    size += len(chunk)
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)
    return {"path": str(dest), "bytes": size, "sha256": sha.hexdigest(), "url": url}


def last_logged(log_path: Path, quarter: str) -> dict | None:
    """Last ingest-log entry for the quarter, or None."""
    if not log_path.exists():
        return None
    last = None
    with open(log_path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                entry = json.loads(line)
                if entry.get("quarter") == quarter:
                    last = entry
    return last


def append_log(log_path: Path, entry: dict) -> None:
    """Appends one JSON line with a single write (the ingest log is append-only)."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
    fd = os.open(log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


def record_download(log_path: Path, quarter: str, info: dict, run_id: str | None) -> dict:
    """Compares the new zip with the quarter's last logged download, then logs this one.

    A different sha256 is logged as WARNING 'source_changed' and flagged; it never fails:
    the new file is what gets ingested.
    """
    prev = last_logged(log_path, quarter)
    changed = prev is not None and prev["sha256"] != info["sha256"]
    if changed:
        log.warning(
            "source_changed: %s zip differs from the last download (%s, %s bytes -> %s, %s bytes)",
            quarter,
            prev["sha256"],
            prev["bytes"],
            info["sha256"],
            info["bytes"],
        )
    append_log(
        log_path,
        {
            "quarter": quarter,
            "url": info["url"],
            "sha256": info["sha256"],
            "bytes": info["bytes"],
            "run_id": run_id,
            "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        },
    )
    return {"source_changed": changed, "previous_sha256": prev["sha256"] if prev else None}
