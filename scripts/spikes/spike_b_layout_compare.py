"""Spike B: layout stability between two quarters (default 2024Q3 vs 2026Q2).

Run inside the container:
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/spikes/spike_b_layout_compare.py

For each quarter: downloads the zip if needed (faers_pipeline.download), reads the header of
every file type, runs the current parse.to_parquet unchanged and checks rows == raw lines.
Then compares column names and order per type. Writes data/spikes/spike_b_<a>_vs_<b>.json.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c
import duckdb

from faers_pipeline import parse

DATE_COLS = {"demo": ["event_dt", "fda_dt", "mfr_dt"], "ther": ["start_dt", "end_dt"]}


def date_lengths(pq: Path, col: str) -> dict:
    con = duckdb.connect()
    try:
        rows = con.execute(
            f"SELECT CASE WHEN {col} IS NULL OR trim({col}) = '' THEN 'null/empty' "
            f"ELSE length(trim({col}))::varchar END k, count(*) "
            f"FROM read_parquet('{pq}') GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
    finally:
        con.close()
    return {k: v for k, v in rows}


def inspect(quarter: str) -> dict:
    zip_path, dl = c.ensure_zip(quarter)
    work = c.SPIKES_OUT / quarter
    members = [m["name"] for m in c.list_members(zip_path)]
    extracted = parse.extract_zip(zip_path, work / "extracted", c.CFG["file_types"])
    types = {}
    for ft in c.CFG["file_types"]:
        member = c.find_member(zip_path, ft)
        scan = c.scan_raw(zip_path, member, c.CFG["parse"]["delimiter"])
        out = work / "parquet" / f"{ft}.parquet"
        res = c.measure_parse(Path(extracted[ft]), out)
        entry = {
            "member": member,
            "header": [h.strip().lower() for h in scan["header"]],
            "data_lines": scan["data_lines"],
            "irregular_lines": scan["irregular_lines"],
            "valid_utf8": scan["valid_utf8"],
            "non_ascii_lines": scan["non_ascii_lines"],
            "crlf_lines": scan["crlf_lines"],
            "parse": {k: v for k, v in res.items() if k not in ("columns", "path")},
        }
        if "rows" in res:
            entry["parse"]["rows_equal_raw_lines"] = res["rows"] == scan["data_lines"]
            entry["parse_columns"] = [x for x in res["columns"] if not x.startswith("_")]
            for col in DATE_COLS.get(ft, []):
                entry[f"{col}_length"] = date_lengths(out, col)
        types[ft] = entry
    return {"quarter": quarter, "download": dl, "members": members, "types": types}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="2024Q3")
    ap.add_argument("--b", default="2026Q2")
    args = ap.parse_args()
    qa, qb = inspect(args.a), inspect(args.b)
    diff = {}
    for ft in c.CFG["file_types"]:
        ha, hb = qa["types"][ft]["header"], qb["types"][ft]["header"]
        diff[ft] = {
            "same_columns_and_order": ha == hb,
            "only_in_" + args.a: [x for x in ha if x not in hb],
            "only_in_" + args.b: [x for x in hb if x not in ha],
            "same_set_different_order": ha != hb and sorted(ha) == sorted(hb),
        }
    member_layout = {
        args.a: sorted(qa["members"]),
        args.b: sorted(qb["members"]),
    }
    report = {"a": qa, "b": qb, "diff": diff, "members": member_layout}
    path = c.SPIKES_OUT / f"spike_b_{args.a}_vs_{args.b}.json"
    c.write_json(report, path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
