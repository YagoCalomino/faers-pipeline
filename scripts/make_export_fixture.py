"""Builds tests/fixtures/site_export/: a small real subset of the warehouse marts that the site
export reads, for the unit tests of faers_pipeline.export (no dbt, no lake needed).

Subset: four ingredients (atorvastatin, clozapine, the non-generic fallback FB:FATTY ACIDS and
the generic fallback FB:HERBALS), their first pairs of mart_signals_top (for FB:HERBALS, which
mart_signals_top leaves out, its most frequent real pair of mart_signals in ALL; only its ranks
and list flags are set here, to 1 and true, so the generic filter has a row to act on), the
mart_signals rows of
atorvastatin-Rhabdomyolysis (every period), 40 cases of fct_case, the missing-value metrics of
mart_dq_metrics, all of mart_known_signals_eval and the RxNorm version of the name map.

Usage (inside the container, read-only on the warehouse):
    python -I scripts/make_export_fixture.py [--warehouse PATH]
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "tests" / "fixtures" / "site_export"
INGREDIENTS = ("83367", "2626", "FB:FATTY ACIDS", "FB:HERBALS")
PAIRS_PER_INGREDIENT = 3

TABLES = {
    "core.dim_ingredient": f"""
        select * from core.dim_ingredient where ingredient_id in {INGREDIENTS}
        order by ingredient_id""",
    "signals.mart_signals_top": f"""
        select * from signals.mart_signals_top where ingredient_id in {INGREDIENTS}
        qualify row_number() over (partition by ingredient_id
                                   order by rank_ror_lcl nulls last, reaction_key)
                <= {PAIRS_PER_INGREDIENT}
        union all by name
        select s.ingredient_key, s.ingredient_id, s.ingredient_name, s.reaction_key,
               s.reaction_pt, 1 as rank_ror_lcl, 1 as rank_a_evans, true as in_top_ror_lcl,
               true as in_top_a_evans, s.a, s.n_drug, s.n_reac, s.prr, s.prr_lcl, s.prr_ucl,
               s.ror, s.ror_lcl, s.ror_ucl, s.chi2, s.is_signal_evans, s.is_signal_ror,
               s.match_type, s.is_fallback
        from signals.mart_signals as s
        where s.ingredient_id = 'FB:HERBALS' and s.period_key = 'ALL'
        qualify row_number() over (order by s.a desc, s.reaction_key) = 1
        order by ingredient_id, rank_ror_lcl, reaction_key""",
    "signals.mart_signals": """
        select * from signals.mart_signals
        where ingredient_id = '83367' and reaction_pt = 'Rhabdomyolysis'
        order by period_key""",
    "core.fct_case": """
        select * from core.fct_case
        qualify row_number() over (partition by is_in_window order by case_id desc) <= 20
        order by case_id""",
    "signals.mart_dq_metrics": """
        select * from signals.mart_dq_metrics where metric_group = 'missing_values'
        order by period_basis, period_key, metric""",
    "signals.mart_known_signals_eval": """
        select * from signals.mart_known_signals_eval order by expected, ingredient_name,
        reaction_pt""",
    "staging.stg_rxnorm__name_map": """
        select distinct rxnorm_version from staging.stg_rxnorm__name_map
        where rxnorm_version is not null""",
}


def main(argv: list[str]) -> int:
    sys.path.insert(0, str(REPO / "src"))
    os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))
    from faers_pipeline.config import load_config

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--warehouse", type=Path, default=Path(load_config("faers.yaml")["paths"]["warehouse"])
    )
    args = parser.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(args.warehouse), read_only=True)
    con.execute("set threads = 1")
    for table, sql in TABLES.items():
        target = OUT / f"{table}.parquet"
        con.execute(f"copy ({sql}) to '{target}' (format parquet, compression zstd)")
        n = con.execute(f"select count(*) from read_parquet('{target}')").fetchone()[0]
        print(f"{table}: {n} rows -> {target.relative_to(REPO)} ({target.stat().st_size} bytes)")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
