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
