"""Numbers of the README and of docs/numbers.md, read from the warehouse marts and from
measurement files; none is typed by hand.

Sources (read-only):
    warehouse (paths.warehouse)     core.fct_case, signals.mart_dq_metrics, signals.mart_signals,
                                    signals.mart_signals_top, signals.mart_known_signals_eval,
                                    staging.stg_rxnorm__name_map (RxNorm release)
    data/metrics/build.json         wall time and memory peak of a full build
                                    (scripts/measure_build.py, make measure-build)
    data/metrics/runs.json          durations of the successful DAG runs recorded by Airflow
                                    (scripts/collect_run_times.py, make run-times)
    data/landing, data/lake         disk space of the downloaded zips and of the Parquet lake
    data/site_export/manifest.json  size of the site export
    site/dist/                      size of the built site (make publish-site)

Prints the full table. With --write, replaces the text between <!-- readme-numbers:start --> and
<!-- readme-numbers:end --> in docs/numbers.md (the full table) and in README.md (a short
summary).

Usage (inside the container): python -I scripts/readme_numbers.py [--write]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402

START, END = "<!-- readme-numbers:start -->", "<!-- readme-numbers:end -->"
README = REPO / "README.md"
NUMBERS = REPO / "docs" / "numbers.md"


def _one(con, sql: str):
    return con.execute(sql).fetchone()


def metric(con, name: str, basis: str = "all") -> float:
    row = _one(
        con,
        f"""select value from signals.mart_dq_metrics
            where period_basis = '{basis}' and period_key = 'ALL' and metric = '{name}'""",
    )
    if row is None:
        raise KeyError(name)
    return row[0]


def mb(n: int) -> str:
    return f"{n / 1e6:,.1f} MB"


def collect(warehouse: Path, data_dir: Path, dist: Path) -> dict:
    con = duckdb.connect(str(warehouse), read_only=True)
    try:
        q_first, q_last, n_q = _one(
            con,
            """select min(quarter_key), max(quarter_key), count(distinct quarter_key)
               from core.fct_case where is_in_window""",
        )
        f_first, f_last, n_files = _one(
            con,
            "select min(source_quarter), max(source_quarter), count(distinct source_quarter) "
            "from core.fct_case",
        )
        n_pairs_all, n_computable, n_evans, n_ror = _one(
            con,
            """select count(*), count(*) filter (is_computable),
                      count(*) filter (is_signal_evans), count(*) filter (is_signal_ror)
               from signals.mart_signals where period_key = 'ALL'""",
        )
        n_rows_signals, n_periods = _one(
            con, "select count(*), count(distinct period_key) from signals.mart_signals"
        )
        top_pairs, top_ingredients = _one(
            con, "select count(*), count(distinct ingredient_id) from signals.mart_signals_top"
        )
        passed, total_known, n_pos, n_neg = _one(
            con,
            """select count(*) filter (passed), count(*), count(*) filter (expected = 'positive'),
                      count(*) filter (expected <> 'positive')
               from signals.mart_known_signals_eval""",
        )
        rx_versions = [
            r[0]
            for r in con.execute(
                "select distinct rxnorm_version from staging.stg_rxnorm__name_map "
                "where rxnorm_version is not null order by 1"
            ).fetchall()
        ]
        numbers = {
            "quarters": f"{q_first} to {q_last} ({n_q} quarters)",
            "file_quarters": f"{f_first} to {f_last} ({n_files} files)",
            "demo_rows": metric(con, "demo_rows"),
            "cases": metric(con, "cases_after_deduplication"),
            "superseded": metric(con, "superseded_versions_removed"),
            "deleted": metric(con, "deleted_cases_removed"),
            "pct_removed": metric(con, "pct_demo_rows_removed_total"),
            "ps_ss_lines": metric(con, "signal_role_lines"),
            "pct_mapped": metric(con, "pct_lines_normalized"),
            "pct_exact": metric(con, "pct_lines_exact"),
            "rx_versions": rx_versions,
            "n_rows_signals": n_rows_signals,
            "n_periods": n_periods,
            "n_pairs_all": n_pairs_all,
            "n_computable": n_computable,
            "n_evans": n_evans,
            "n_ror": n_ror,
            "top_pairs": top_pairs,
            "top_ingredients": top_ingredients,
            "known": (passed, total_known, n_pos, n_neg),
            "min_cases": load_config("signals.yaml")["signal_min_cases"],
            "rps": load_config("rxnorm.yaml")["api"]["rate_limit_rps"],
        }
    finally:
        con.close()

    build_path = data_dir / "metrics" / "build.json"
    numbers["build"] = (
        json.loads(build_path.read_text(encoding="utf-8")) if build_path.is_file() else None
    )
    runs_path = data_dir / "metrics" / "runs.json"
    numbers["runs"] = (
        json.loads(runs_path.read_text(encoding="utf-8")) if runs_path.is_file() else None
    )
    numbers["disk"] = {
        "zips": sum(p.stat().st_size for p in (data_dir / "landing").rglob("*.zip")),
        "lake": sum(p.stat().st_size for p in (data_dir / "lake").rglob("*") if p.is_file()),
        "warehouse": warehouse.stat().st_size,
    }
    manifest = data_dir / "site_export" / "manifest.json"
    if manifest.is_file():
        files = json.loads(manifest.read_text(encoding="utf-8"))["files"]
        numbers["export"] = (len(files) + 1, sum(f["bytes"] for f in files))
    if dist.is_dir():
        sizes = [p.stat().st_size for p in dist.rglob("*") if p.is_file()]
        numbers["dist"] = (len(sizes), sum(sizes), max(sizes))
    return numbers


def measured_on(n: dict) -> str:
    b, r = n.get("build"), n.get("runs")
    text = f" Build measured {b['measured_at'][:10]}." if b else ""
    if r:
        text += f" Run times collected {r['collected_at'][:10]}."
    return text


def summary(n: dict) -> str:
    """The few numbers shown in the README; the full table is in docs/numbers.md."""
    passed, total, n_pos, n_neg = n["known"]
    lines = [
        f"- **{n['cases']:,.0f} cases** after deduplication of {n['demo_rows']:,.0f} case "
        f"versions in the quarterly files {n['file_quarters']}.",
        f"- **{n['pct_mapped']:.2f}%** of the PS/SS drug lines mapped to an RxNorm ingredient.",
        f"- **{n['top_pairs']:,} ingredient-reaction pairs** on the site, for "
        f"{n['top_ingredients']:,} ingredients.",
        f"- **{passed} of {total}** reference pairs as expected ({n_pos} positive, "
        f"{n_neg} negative controls).",
    ]
    b = n.get("build")
    if b:
        minutes = b["seconds"] / 60
        lines.append(f"- **{minutes:.1f} min** for the full dbt build (models and tests).")
    note = (
        "All numbers: [docs/numbers.md](docs/numbers.md). Generated by "
        f"`scripts/readme_numbers.py`.{measured_on(n)}"
    )
    return "\n".join([START, *lines, "", note, END])


def markdown(n: dict) -> str:
    passed, total, n_pos, n_neg = n["known"]
    lines = [
        "| | |",
        "|---|---|",
        f"| FAERS quarterly files loaded | {n['file_quarters']} |",
        f"| Signal window (FDA first-receipt quarter) | {n['quarters']} |",
        f"| Case versions in the files (DEMO rows) | {n['demo_rows']:,.0f} |",
        f"| Cases after deduplication | {n['cases']:,.0f} |",
        f"| Removed: superseded versions / deleted cases | {n['superseded']:,.0f} / "
        f"{n['deleted']:,.0f} ({n['pct_removed']:.1f}% of the rows) |",
        f"| PS/SS drug lines mapped to an RxNorm ingredient | {n['pct_mapped']:.2f}% of "
        f"{n['ps_ss_lines']:,.0f} (exact match {n['pct_exact']:.2f}%) |",
        f"| RxNorm release of the name cache | {', '.join(n['rx_versions']) or 'not recorded'} |",
        f"| Ingredient-reaction pairs, all quarters (a >= {n['min_cases']}) | {n['n_pairs_all']:,} "
        f"({n['n_computable']:,} computable; {n['n_evans']:,} meet the Evans criterion, "
        f"{n['n_ror']:,} the ROR criterion) |",
        f"| Rows of `mart_signals` ({n['n_periods'] - 1} quarters and all) | "
        f"{n['n_rows_signals']:,} |",
        f"| Pairs on the site | {n['top_pairs']:,} for {n['top_ingredients']:,} ingredients |",
        f"| Reference pairs as expected | {passed} of {total} ({n_pos} positive, "
        f"{n_neg} negative controls) |",
    ]
    b = n.get("build")
    if b:
        peak = b.get("container_memory_peak_bytes")
        lines += [
            f"| Full dbt build (models and tests) | {b['seconds'] / 60:.1f} min, "
            + ", ".join(f"{v} {k.replace(':', ' ')}" for k, v in sorted(b["dbt_nodes"].items()))
            + " |",
            "| Memory peak of the build | "
            + (f"{peak / 2**30:.2f} GiB (container), " if peak else "")
            + f"{b['build']['dbt_peak_rss_mb'] / 1024:.2f} GiB (dbt process); "
            f"DuckDB memory_limit {b['dbt_memory_limit']} |",
            f"| Warehouse file right after the measured build | {mb(b['warehouse_bytes'])} |",
        ]
    if "export" in n:
        lines.append(f"| Site export | {n['export'][0]:,} files, {mb(n['export'][1])} |")
    if "dist" in n:
        files, total_b, largest = n["dist"]
        lines.append(
            f"| Built site | {files:,} files, {mb(total_b)} (largest file {mb(largest)}) |"
        )
    r = n.get("runs")
    if r:
        d = r["dags"]

        def minutes(x: float | None) -> str:
            return "n/a" if x is None else f"{x / 60:.1f} min"

        lines += [
            f"| Airflow: one quarter of `faers_ingest` (median of "
            f"{d['faers_ingest']['successful_runs']} runs) | "
            f"{minutes(d['faers_ingest']['median_seconds'])} |",
            f"| Airflow: first full `rxnorm_enrich` (API lookups at {n['rps']} requests/s) / "
            f"later runs "
            f"(cache) | {minutes(d['rxnorm_enrich']['max_seconds'])} / "
            f"{minutes(d['rxnorm_enrich']['median_seconds'])} |",
            f"| Airflow: `faers_transform` / `publish_site` (median) | "
            f"{minutes(d['faers_transform']['median_seconds'])} / "
            f"{minutes(d['publish_site']['median_seconds'])} |",
        ]
    disk = n["disk"]
    lines.append(
        f"| Disk when this table was generated: zips / Parquet lake / warehouse file | "
        f"{mb(disk['zips'])} / {mb(disk['lake'])} / "
        f"{mb(disk['warehouse'])} |"
    )
    return "\n".join(
        [START, *lines, "", f"Generated by `scripts/readme_numbers.py`.{measured_on(n)}", END]
    )


def replace_block(path: Path, block: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print(f"markers not found in {path}", file=sys.stderr)
        return False
    head, rest = text.split(START, 1)
    tail = rest.split(END, 1)[1]
    path.write_text(head + block + tail, encoding="utf-8", newline="\n")
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument(
        "--warehouse", type=Path, default=Path(load_config("faers.yaml")["paths"]["warehouse"])
    )
    args = parser.parse_args(argv)
    data_dir = args.warehouse.parents[1]
    numbers = collect(args.warehouse, data_dir, REPO / "site" / "dist")
    block = markdown(numbers)
    print(block)
    if args.write:
        ok = replace_block(NUMBERS, block) and replace_block(README, summary(numbers))
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
