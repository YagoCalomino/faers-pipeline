"""Stage 3 check of the site's numbers, part 1: exported JSON = direct DuckDB query.

For each ingredient slug given, every pair of json/signals/<slug>.json is compared with the
warehouse row of signals.mart_signals (period ALL), queried directly: a, b, c, d, n_total,
n_drug, n_reac, PRR, ROR, their 95% CI bounds and chi2. Any difference above --tol fails.

Writes <out>/expected.json with, per pair, the warehouse values and the text the page must show,
formatted here independently of the site's JavaScript (exact decimal value of the double,
rounded half away from zero, as ECMA-402 Intl.NumberFormat does). Part 2
(site/tests/verify-values.mjs) checks the rendered pages against that file.

Usage (inside the container):
    python -I scripts/verify_site_values.py --slugs dupilumab atorvastatin levodopa \
        --out /opt/airflow/data/tmp/site_verify
Exit 1 on any divergence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402

INT_FIELDS = ("a", "b", "c", "d", "n_total", "n_drug", "n_reac")
FLOAT_FIELDS = ("prr", "prr_lcl", "prr_ucl", "ror", "ror_lcl", "ror_ucl", "chi2")
DASH = "—"


def _strip(s: str) -> str:
    return s.rstrip("0").rstrip(".") if "." in s else s


def fmt_count(v) -> str:
    return DASH if v is None else f"{int(v):,}"


def fmt_ratio(v) -> str:
    """Same rule as site/src/lib/format.js fmtRatio, written independently."""
    if v is None:
        return DASH
    d = Decimal(v)  # exact value of the double
    if abs(d) >= 1000:
        return f"{d.quantize(Decimal(1), rounding=ROUND_HALF_UP):,f}"
    if d == 0:
        return "0"
    r = d.quantize(Decimal(1).scaleb(d.adjusted() - 2), rounding=ROUND_HALF_UP)
    return _strip(f"{r:,f}")


def fmt_interval(lo, hi) -> str:
    return DASH if lo is None or hi is None else f"{fmt_ratio(lo)} to {fmt_ratio(hi)}"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--slugs", nargs="+", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--tol", type=float, default=1e-9)
    parser.add_argument(
        "--export", type=Path, default=Path(load_config("site.yaml")["export"]["out_dir"])
    )
    parser.add_argument(
        "--warehouse", type=Path, default=Path(load_config("faers.yaml")["paths"]["warehouse"])
    )
    args = parser.parse_args(argv)
    con = duckdb.connect(str(args.warehouse), read_only=True)
    cols = ", ".join(INT_FIELDS + FLOAT_FIELDS)
    failures, expected, compared = [], {}, 0
    for slug in args.slugs:
        doc = json.loads((args.export / "json" / "signals" / f"{slug}.json").read_text("utf-8"))
        ing = doc["ingredient"]
        rows = {
            r[0]: dict(zip(("reaction_key", *INT_FIELDS, *FLOAT_FIELDS), r, strict=True))
            for r in con.execute(
                f"""select reaction_key, {cols} from signals.mart_signals
                    where period_key = 'ALL' and ingredient_id = ?""",
                [ing["ingredient_id"]],
            ).fetchall()
        }
        pairs = []
        max_diff = 0.0
        for p in doc["pairs"]:
            db = rows.get(p["reaction_key"])
            if db is None:
                failures.append(f"{slug}/{p['reaction_pt']}: not in mart_signals ALL")
                continue
            for f in INT_FIELDS + FLOAT_FIELDS:
                jv, dv = p[f], db[f]
                compared += 1
                if (jv is None) != (dv is None):
                    failures.append(f"{slug}/{p['reaction_pt']}.{f}: json {jv} db {dv}")
                elif jv is not None:
                    diff = abs(jv - dv)
                    max_diff = max(max_diff, diff)
                    if diff > args.tol:
                        failures.append(f"{slug}/{p['reaction_pt']}.{f}: json {jv} db {dv}")
            pairs.append(
                {
                    "reaction_key": p["reaction_key"],
                    "reaction_pt": p["reaction_pt"],
                    "values": {f: db[f] for f in INT_FIELDS + FLOAT_FIELDS},
                    "text": {
                        **{f: fmt_count(db[f]) for f in INT_FIELDS},
                        **{f: fmt_ratio(db[f]) for f in FLOAT_FIELDS},
                        "prr_ci": fmt_interval(db["prr_lcl"], db["prr_ucl"]),
                        "ror_ci": fmt_interval(db["ror_lcl"], db["ror_ucl"]),
                    },
                }
            )
        expected[slug] = {
            "ingredient_name": ing["ingredient_name"],
            "ingredient_id": ing["ingredient_id"],
            "n_cases_ps_ss": ing["n_cases_ps_ss"],
            "pairs": pairs,
        }
        print(
            f"{slug}: {ing['ingredient_name']} ({ing['ingredient_id']}), "
            f"{ing['n_cases_ps_ss']:,} PS/SS cases, {len(pairs)} pairs, "
            f"max |json - duckdb| = {max_diff}"
        )
    con.close()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "expected.json").write_text(json.dumps(expected, indent=1), encoding="utf-8")
    print(f"values compared: {compared}; divergences: {len(failures)}")
    for f in failures[:20]:
        print("DIVERGENCE", f)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
