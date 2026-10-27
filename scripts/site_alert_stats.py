"""Share of the site's pairs that carry the concentration alert (config/site.yaml
concentration_alert), overall and for the ingredients with the most reports, with the share each
rule flags on its own and the threshold needed for a target share (to recalibrate).

Usage (inside the container): python -I scripts/site_alert_stats.py [--export DIR] [--top 10]
Reads only the export (json/signals/*.json), never the warehouse.
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


def flags(pair: dict, rule: dict) -> tuple[bool, bool]:
    q = (
        pair["a"] >= rule["min_cases_for_quarter_rule"]
        and (pair.get("top_quarter_share") or 0) >= rule["min_top_quarter_share"]
    )
    m = (pair.get("median_reactions_per_case") or 0) >= rule["min_median_reactions_per_case"]
    return q, m


def quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def main(argv: list[str]) -> int:
    site = load_config("site.yaml")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--export", type=Path, default=Path(site["export"]["out_dir"]))
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    rule = site["concentration_alert"]
    ingredients = json.loads((args.export / "json" / "ingredients.json").read_text("utf-8"))
    total = quarter = median = either = 0
    shares, medians, per_ing = [], [], []
    for ing in ingredients:
        path = args.export / "json" / "signals" / f"{ing['slug']}.json"
        doc = json.loads(path.read_text("utf-8"))
        n = n_flag = 0
        for p in doc["pairs"]:
            q, m = flags(p, rule)
            total += 1
            n += 1
            quarter += q
            median += m
            either += q or m
            n_flag += q or m
            shares.append(p.get("top_quarter_share") or 0)
            medians.append(p.get("median_reactions_per_case") or 0)
        per_ing.append((ing["n_cases_ps_ss"], ing["ingredient_name"], n, n_flag))
    print(
        f"rule: (a >= {rule['min_cases_for_quarter_rule']} and "
        f"top_quarter_share >= {rule['min_top_quarter_share']}) "
        f"or median_reactions_per_case >= {rule['min_median_reactions_per_case']}"
    )
    print(
        f"pairs: {total}; flagged: {either} ({either / total:.1%}); "
        f"by quarter share: {quarter} ({quarter / total:.1%}); "
        f"by median reactions: {median} ({median / total:.1%})"
    )
    print(f"top {args.top} ingredients by PS/SS reports:")
    top_pairs = top_flag = 0
    for cases, name, n, n_flag in sorted(per_ing, reverse=True)[: args.top]:
        top_pairs += n
        top_flag += n_flag
        share = f"{n_flag:>2}/{n:<2} pairs flagged ({n_flag / n:.0%})"
        print(f"  {name:<28} {cases:>9,} reports  {share}")
    print(f"  together: {top_flag}/{top_pairs} ({top_flag / top_pairs:.1%})")
    print("distribution (for recalibration):")
    for q in (0.5, 0.7, 0.8, 0.9, 0.95):
        print(
            f"  p{int(q * 100)}: top_quarter_share {quantile(shares, q):.3f}, "
            f"median_reactions_per_case {quantile(medians, q):.1f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
