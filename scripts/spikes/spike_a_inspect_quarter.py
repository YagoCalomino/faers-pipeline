"""Spike A: inspects one FAERS quarterly zip (default 2026Q2).

Run inside the container:
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/spikes/spike_a_inspect_quarter.py --quarter 2026Q2

Downloads the zip with faers_pipeline.download (skipped if already in data/landing), then:
zip members, raw scan per type (header vs contract, line counts, irregular lines, encoding),
parse.to_parquet per type with time and peak memory, DEMO/DRUG profiles and referential
integrity. Writes data/spikes/<quarter>/spike_a.json and top_prod_ai.json (input of spike C).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c
import duckdb

from faers_pipeline import parse


def q(con: duckdb.DuckDBPyConnection, sql: str) -> list[tuple]:
    return con.execute(sql).fetchall()


def profile(pq: dict[str, str], top_n: int) -> dict:
    con = duckdb.connect()
    for ft, path in pq.items():
        con.execute(f"CREATE VIEW {ft} AS SELECT * FROM read_parquet('{path}')")
    out: dict = {}

    rows, cases = q(con, "SELECT count(*), count(DISTINCT caseid) FROM demo")[0]
    multi_rows = q(con, "SELECT count(*) FROM demo WHERE try_cast(caseversion AS int) > 1")[0][0]
    multi_cases = q(
        con,
        "SELECT count(DISTINCT caseid) FROM demo WHERE try_cast(caseversion AS int) > 1",
    )[0][0]
    dup_cases = q(
        con, "SELECT count(*) FROM (SELECT caseid FROM demo GROUP BY 1 HAVING count(*) > 1)"
    )[0][0]
    out["demo"] = {
        "rows": rows,
        "distinct_caseid": cases,
        "distinct_primaryid": q(con, "SELECT count(DISTINCT primaryid) FROM demo")[0][0],
        "rows_caseversion_gt1": multi_rows,
        "pct_rows_caseversion_gt1": round(100 * multi_rows / rows, 2),
        "cases_with_caseversion_gt1": multi_cases,
        "pct_cases_caseversion_gt1": round(100 * multi_cases / cases, 2),
        "caseids_repeated_in_quarter": dup_cases,
        "caseversion_non_integer": q(
            con,
            "SELECT count(*) FROM demo WHERE caseversion IS NOT NULL "
            "AND try_cast(caseversion AS int) IS NULL",
        )[0][0],
        "i_f_code": dict(q(con, "SELECT i_f_code, count(*) FROM demo GROUP BY 1 ORDER BY 2 DESC")),
    }
    for col in ("event_dt", "fda_dt", "init_fda_dt", "mfr_dt", "rept_dt"):
        out["demo"][f"{col}_length"] = {
            str(k): v
            for k, v in q(
                con,
                f"SELECT CASE WHEN {col} IS NULL OR trim({col}) = '' THEN 'null/empty' "
                f"WHEN length(trim({col})) IN (4, 6, 8) THEN length(trim({col}))::varchar "
                f"ELSE 'other:' || length(trim({col})) END k, count(*) FROM demo "
                "GROUP BY 1 ORDER BY 2 DESC",
            )
        }
        out["demo"][f"{col}_non_digit"] = q(
            con,
            f"SELECT count(*) FROM demo WHERE trim({col}) <> '' "
            f"AND NOT regexp_full_match(trim({col}), '[0-9]+')",
        )[0][0]
    for col in ("sex", "age_cod", "age_grp", "occp_cod", "rept_cod"):
        out["demo"][col] = {
            str(k): v
            for k, v in q(con, f"SELECT {col}, count(*) FROM demo GROUP BY 1 ORDER BY 2 DESC")
        }

    drows = q(con, "SELECT count(*) FROM drug")[0][0]
    ai = q(con, "SELECT count(*) FROM drug WHERE prod_ai IS NOT NULL AND trim(prod_ai) <> ''")[0][0]
    norm = "regexp_replace(upper(trim(prod_ai)), '\\s+', ' ', 'g')"
    top = q(
        con,
        f"SELECT {norm} AS name, count(*) n FROM drug "
        "WHERE prod_ai IS NOT NULL AND trim(prod_ai) <> '' "
        f"GROUP BY 1 ORDER BY n DESC, name LIMIT {top_n}",
    )
    out["drug"] = {
        "rows": drows,
        "role_cod": {
            str(k): v
            for k, v in q(con, "SELECT role_cod, count(*) FROM drug GROUP BY 1 ORDER BY 2 DESC")
        },
        "rows_prod_ai_filled": ai,
        "pct_prod_ai_filled": round(100 * ai / drows, 2),
        "distinct_prod_ai_normalized": q(
            con, f"SELECT count(DISTINCT {norm}) FROM drug WHERE trim(prod_ai) <> ''"
        )[0][0],
        "distinct_drugname_normalized": q(
            con,
            "SELECT count(DISTINCT regexp_replace(upper(trim(drugname)), '\\s+', ' ', 'g')) "
            "FROM drug",
        )[0][0],
        f"top{top_n}_prod_ai": [{"name": n, "rows": k} for n, k in top],
    }
    ps_ss = q(con, "SELECT count(*) FROM drug WHERE role_cod IN ('PS', 'SS')")[0][0]
    names = [n for n, _ in top]
    ps_ss_top = con.execute(
        f"SELECT count(*) FROM drug WHERE role_cod IN ('PS','SS') AND {norm} = ANY(?)", [names]
    ).fetchone()[0]
    # Share of PS/SS rows covered by the top-N names (what spike C can resolve).
    out["drug"]["pct_ps_ss_rows_in_top"] = round(100 * ps_ss_top / ps_ss, 2)

    integ = {}
    for ft in pq:
        if ft == "demo":
            continue
        orphans, total = q(
            con,
            f"SELECT count(*) FILTER (WHERE d.primaryid IS NULL), count(*) FROM {ft} x "
            "LEFT JOIN (SELECT DISTINCT primaryid FROM demo) d USING (primaryid)",
        )[0]
        caseid_mismatch = q(
            con,
            f"SELECT count(*) FROM {ft} x JOIN demo d USING (primaryid) WHERE x.caseid <> d.caseid",
        )[0][0]
        integ[ft] = {
            "rows": total,
            "orphan_primaryid_rows": orphans,
            "caseid_mismatch": caseid_mismatch,
        }
    demo_no_drug = q(
        con, "SELECT count(*) FROM demo WHERE primaryid NOT IN (SELECT primaryid FROM drug)"
    )[0][0]
    demo_no_reac = q(
        con, "SELECT count(*) FROM demo WHERE primaryid NOT IN (SELECT primaryid FROM reac)"
    )[0][0]
    integ["demo_without_drug"] = demo_no_drug
    integ["demo_without_reac"] = demo_no_reac
    out["referential_integrity"] = integ
    con.close()
    return out


def run(quarter: str, top_n: int, skip_parse: bool = False) -> dict:
    zip_path, dl = c.ensure_zip(quarter)
    report: dict = {"quarter": quarter, "download": dl, "members": c.list_members(zip_path)}
    delim = c.CFG["parse"]["delimiter"]
    work = c.SPIKES_OUT / quarter

    raw = {}
    for ft in c.CFG["file_types"]:
        member = c.find_member(zip_path, ft)
        scan = c.scan_raw(zip_path, member, delim)
        cols = [h.strip().lower() for h in scan["header"]]
        expected = c.SCHEMA[ft]
        scan["missing_vs_contract"] = [x for x in expected if x not in cols]
        scan["extra_vs_contract"] = [x for x in cols if x not in expected]
        raw[ft] = scan
    report["raw"] = raw

    if skip_parse:
        return report

    extracted = parse.extract_zip(zip_path, work / "extracted", c.CFG["file_types"])
    parsed, pq = {}, {}
    for ft in c.CFG["file_types"]:
        out = work / "parquet" / f"{ft}.parquet"
        res = c.measure_parse(Path(extracted[ft]), out)
        if "rows" in res:
            res["rows_equal_raw_lines"] = res["rows"] == raw[ft]["data_lines"]
            res["columns"] = [x for x in res["columns"] if not x.startswith("_")]
            pq[ft] = str(out)
        parsed[ft] = res
    report["parse"] = parsed
    if {"demo", "drug", "reac"} <= pq.keys():
        report["profile"] = profile(pq, top_n)
        c.write_json(
            {"quarter": quarter, "top": report["profile"]["drug"][f"top{top_n}_prod_ai"]},
            work / "top_prod_ai.json",
        )
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="2026Q2")
    ap.add_argument("--top", type=int, default=25)
    args = ap.parse_args()
    report = run(args.quarter, args.top)
    path = c.SPIKES_OUT / args.quarter / "spike_a.json"
    c.write_json(report, path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
