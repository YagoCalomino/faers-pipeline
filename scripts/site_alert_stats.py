"""Share of the site's pairs that carry the concentration alert (config/site.yaml
concentration_alert), overall and for the ingredients with the most reports, with the share each
rule flags on its own and the threshold needed for a target share (to recalibrate).

With --show INGREDIENT (repeatable) it also lists, for each named ingredient, up to --rows pairs
flagged by the country rule, and --unflagged lists pairs of the top ingredients with no alert
(largest country share first), to review false positives and negatives.

Usage (inside the container): python -I scripts/site_alert_stats.py [--export DIR] [--top 10]
    [--show dupilumab --show adalimumab ...] [--unflagged] [--rows 10]
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

RULES = ("quarter", "long_reports", "country")


def flags(pair: dict, rule: dict) -> dict[str, bool]:
    """The rules that hold for a pair (same rule as site/src/lib/logic.js)."""
    country = pair.get("top_country")
    return {
        "quarter": pair["a"] >= rule["min_cases_for_quarter_rule"]
        and (pair.get("top_quarter_share") or 0) >= rule["min_top_quarter_share"],
        "long_reports": (pair.get("median_reactions_per_case") or 0)
        >= rule["min_median_reactions_per_case"],
        "country": country is not None
        and pair.get("ingredient_top_country") is not None
        and pair["a"] >= rule["min_cases_for_country_rule"]
        and (pair.get("top_country_share") or 0) >= rule["min_top_country_share"]
        and country != pair["ingredient_top_country"],
    }


def quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def describe(name: str, p: dict, f: dict[str, bool]) -> str:
    reasons = ",".join(k for k in RULES if f[k]) or "-"
    return (
        f"  {name:<14} {p['reaction_pt'][:34]:<34} a={p['a']:<5} "
        f"country {p.get('top_country') or '-'} {p.get('top_country_share') or 0:.0%} "
        f"(ingredient {p.get('ingredient_country_share') or 0:.1%}; top "
        f"{p.get('ingredient_top_country') or '-'} "
        f"{p.get('ingredient_top_country_share') or 0:.0%}) "
        f"quarter {p.get('top_quarter') or '-'} {p.get('top_quarter_share') or 0:.0%} "
        f"median {p.get('median_reactions_per_case') or 0:g}  [{reasons}]"
    )


def main(argv: list[str]) -> int:
    site = load_config("site.yaml")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--export", type=Path, default=Path(site["export"]["out_dir"]))
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--show", action="append", default=[])
    parser.add_argument("--unflagged", action="store_true")
    parser.add_argument("--rows", type=int, default=10)
    args = parser.parse_args(argv)
    rule = site["concentration_alert"]
    ingredients = json.loads((args.export / "json" / "ingredients.json").read_text("utf-8"))
    total = either = 0
    by_rule = dict.fromkeys(RULES, 0)
    only_country = 0
    shares, medians, per_ing, docs = [], [], [], {}
    for ing in ingredients:
        path = args.export / "json" / "signals" / f"{ing['slug']}.json"
        doc = json.loads(path.read_text("utf-8"))
        docs[ing["ingredient_name"]] = doc
        n = n_flag = 0
        for p in doc["pairs"]:
            f = flags(p, rule)
            total += 1
            n += 1
            for k in RULES:
                by_rule[k] += f[k]
            either += any(f.values())
            only_country += f["country"] and not (f["quarter"] or f["long_reports"])
            n_flag += any(f.values())
            shares.append(p.get("top_quarter_share") or 0)
            medians.append(p.get("median_reactions_per_case") or 0)
        per_ing.append((ing["n_cases_ps_ss"], ing["ingredient_name"], n, n_flag))
    print(
        f"rule: (a >= {rule['min_cases_for_quarter_rule']} and "
        f"top_quarter_share >= {rule['min_top_quarter_share']}) "
        f"or median_reactions_per_case >= {rule['min_median_reactions_per_case']} "
        f"or (a >= {rule['min_cases_for_country_rule']} and "
        f"top_country_share >= {rule['min_top_country_share']} "
        f"and top_country <> ingredient_top_country)"
    )
    print(
        f"pairs: {total}; flagged: {either} ({either / total:.1%}); "
        + "; ".join(f"by {k}: {by_rule[k]} ({by_rule[k] / total:.1%})" for k in RULES)
        + f"; by country only: {only_country} ({only_country / total:.1%})"
    )
    print(f"top {args.top} ingredients by PS/SS reports:")
    top_pairs = top_flag = 0
    top_names = []
    for cases, name, n, n_flag in sorted(per_ing, reverse=True)[: args.top]:
        top_names.append(name)
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
    for name in args.show:
        doc = docs.get(name)
        rows = [p for p in (doc or {"pairs": []})["pairs"] if flags(p, rule)["country"]]
        rows.sort(key=lambda p: (-p["a"], p["reaction_pt"]))
        print(f"{name}: {len(rows)} pairs flagged by the country rule")
        for p in rows[: args.rows]:
            print(describe(name, p, flags(p, rule)))
    if args.unflagged:
        rows = [
            (name, p)
            for name in top_names
            for p in docs[name]["pairs"]
            if not any(flags(p, rule).values())
        ]
        rows.sort(key=lambda x: (-(x[1].get("top_country_share") or 0), -x[1]["a"]))
        print(f"top {args.top} ingredients: {len(rows)} pairs without alert (by country share):")
        for name, p in rows[: args.rows]:
            print(describe(name, p, flags(p, rule)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
