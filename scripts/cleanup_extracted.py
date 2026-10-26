"""Deletes the .txt files extracted from the FAERS zips of already ingested quarters.

    python -I scripts/cleanup_extracted.py              (dry run: lists what would be deleted)
    python -I scripts/cleanup_extracted.py --execute    (deletes)

Same rule as the faers_ingest cleanup task (faers_pipeline.files.cleanup_extracted): only
`*.txt` directly inside <paths.landing>/<quarter>/extracted/, and only for quarters whose
manifest exists and matches the Parquet files. Zips, the lake, manifests and the RxNorm cache
are never touched. The extraction can be repeated from the zip at any time.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.files import cleanup_extracted  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="delete (default: dry run)")
    args = ap.parse_args()
    cfg = load_config("faers.yaml")
    landing = Path(cfg["paths"]["landing"])
    lake = Path(cfg["paths"]["lake"])
    quarters = sorted(p.name for p in landing.iterdir() if (p / "extracted").is_dir())
    total = 0
    for q in quarters:
        manifest = lake / "_meta" / "faers" / f"quarter={q}" / "manifest.json"
        res = cleanup_extracted(landing, q, manifest, cfg["file_types"], dry_run=not args.execute)
        total += res["bytes"] if res["status"] in ("would_delete", "deleted") else 0
        print(json.dumps(res))
    verb = "would delete" if not args.execute else "deleted"
    print(
        f"{'DRY RUN: ' if not args.execute else ''}{verb} {total:,} bytes "
        f"({total / 2**30:.2f} GiB) in {len(quarters)} quarter folders"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
