"""Exports the site's data into the candidate folder, validates it and promotes it with the ready
marker: the same three steps as the DAG publish_site (faers_pipeline.export, site_check).

Usage (inside the container, e.g. via make publish-site or make site-ci):
    python -I scripts/publish_export.py
    python -I scripts/publish_export.py --warehouse X --out Y --candidate Z --marker M
Read-only on the warehouse. Exit 1 when the validation fails (the previous export is kept).
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

from faers_pipeline import export, site_check  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402


def main(argv: list[str]) -> int:
    site = load_config("site.yaml")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--warehouse", type=Path, default=Path(load_config("faers.yaml")["paths"]["warehouse"])
    )
    parser.add_argument("--out", type=Path, default=Path(site["export"]["out_dir"]))
    parser.add_argument("--candidate", type=Path, default=Path(site["export"]["candidate_dir"]))
    parser.add_argument("--marker", type=Path, default=Path(site["export"]["ready_marker"]))
    args = parser.parse_args(argv)
    if not args.warehouse.exists():
        print(f"warehouse not found: {args.warehouse}", file=sys.stderr)
        return 1
    logging.basicConfig(level=logging.WARNING)
    summary = export.export_site(args.warehouse, args.candidate)
    print("export:", json.dumps(summary))
    try:
        report = site_check.validate_export(
            args.candidate,
            args.warehouse,
            site["limits"],
            site["downloads"],
            bool(site["export"]["include_generic_fallback"]),
        )
    except site_check.ExportValidationError as exc:
        for problem in exc.problems:
            print("VALIDATION FAILED:", problem, file=sys.stderr)
        return 1
    print("validation: ok", json.dumps(report["warehouse_counts"]), json.dumps(report["sizes"]))
    marker = site_check.promote(args.candidate, args.out, args.marker, report, run_id="make")
    print("ready marker:", json.dumps(marker))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
