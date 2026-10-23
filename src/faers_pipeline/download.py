from __future__ import annotations

import hashlib
import os
from pathlib import Path

import requests

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
