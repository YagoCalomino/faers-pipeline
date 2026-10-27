"""Exports the site's data from the warehouse (faers_pipeline.export; settings in
config/site.yaml).

Usage (inside the container, e.g. via make):
    python -I scripts/export_site.py                          # paths.warehouse -> export.out_dir
    python -I scripts/export_site.py --warehouse X --out Y    # e.g. the ci database
Read-only on the warehouse; the export folder is replaced as a whole.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import export  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--warehouse", type=Path, default=Path(load_config("faers.yaml")["paths"]["warehouse"])
    )
    parser.add_argument(
        "--out", type=Path, default=Path(load_config("site.yaml")["export"]["out_dir"])
    )
    args = parser.parse_args(argv)
    if not args.warehouse.exists():
        print(f"warehouse not found: {args.warehouse}", file=sys.stderr)
        return 1
    logging.basicConfig(level=logging.WARNING)
    print(json.dumps(export.export_site(args.warehouse, args.out), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
