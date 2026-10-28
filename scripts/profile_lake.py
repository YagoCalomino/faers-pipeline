"""Read-only cross-quarter profile of the FAERS raw lake.

Run inside the container, after the quarters are ingested:
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/profile_lake.py

Reads data/lake/raw/faers/<type>/quarter=*/<type>.parquet with DuckDB (in-memory connection,
limits from parse.duckdb in config/faers.yaml) and writes one JSON file to data/spikes/.
The lake is never written.

Sections (keys of the JSON):
  a_demo_totals         rows, distinct caseid, distinct primaryid
  b_primaryid_overlap   primaryid present in more than one quarter; are their DRUG/REAC rows equal?
  c_caseid_versions     caseid in more than one quarter; caseversion spread; is the highest
                        caseversion in the latest quarter of the case?
  d_deleted_in_demo     deleted caseid (all quarters) found in the DEMO of some quarter
  e_time_anchor         source quarter x quarter of init_fda_dt / fda_dt
  f_empty_fields        % empty event_dt, sex, age_cod per quarter
  g_role_cod            role_cod distribution per quarter
  h_drug_names          PS/SS rows and distinct prod_ai per quarter, and for the 8 quarters
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

import duckdb  # noqa: E402

from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.parse import duckdb_session  # noqa: E402

CFG = load_config("faers.yaml")
CONTAINER_DATA = Path("/opt/airflow/data")
TYPES = ["demo", "drug", "reac", "deleted"]
# Same normalization as the RxNorm lookup key (upper, trim, collapse spaces).
NORM = "nullif(regexp_replace(upper(trim({c})), '\\s+', ' ', 'g'), '')"


def host_path(container_path: str) -> Path:
    """Config paths point at /opt/airflow/data; in airflow-dev the data lives in REPO/data."""
    return REPO / "data" / Path(container_path).relative_to(CONTAINER_DATA)


def rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def one(con: duckdb.DuckDBPyConnection, sql: str) -> dict:
    return rows(con, sql)[0]


def quarter_of(col: str) -> str:
    """'YYYYMMDD' or 'YYYYMM' -> 'YYYYQn'; anything else -> NULL."""
    return (
        f"CASE WHEN regexp_full_match(left(trim({col}), 6), '[0-9]{{6}}') "
        f"AND substr(trim({col}), 5, 2) BETWEEN '01' AND '12' "
        f"THEN left(trim({col}), 4) || 'Q' || "
        f"CAST((CAST(substr(trim({col}), 5, 2) AS INTEGER) + 2) // 3 AS VARCHAR) END"
    )


def create_views(con: duckdb.DuckDBPyConnection, lake: Path) -> None:
    for ft in TYPES:
        glob = lake / "raw" / "faers" / ft / "quarter=*" / f"{ft}.parquet"
        con.execute(
            f"CREATE VIEW {ft} AS SELECT * FROM read_parquet('{glob}', hive_partitioning = true)"
        )


def a_demo_totals(con) -> dict:
    total = one(
        con,
        "SELECT count(*) AS rows, count(DISTINCT caseid) AS distinct_caseid, "
        "count(DISTINCT primaryid) AS distinct_primaryid FROM demo",
    )
    total["per_quarter"] = rows(
        con,
        "SELECT quarter, count(*) AS rows, count(DISTINCT caseid) AS distinct_caseid, "
        "count(DISTINCT primaryid) AS distinct_primaryid, "
        "count(*) - count(DISTINCT primaryid) AS duplicate_primaryid_rows "
        "FROM demo GROUP BY quarter ORDER BY quarter",
    )
    return total


def data_row(con: duckdb.DuckDBPyConnection, table: str) -> str:
    """row(...) of the table's data columns: not '_*' metadata, not the hive 'quarter'."""
    cols = [r[0] for r in con.execute(f"DESCRIBE {table}").fetchall()]
    keep = [f'"{c}"' for c in cols if not c.startswith("_") and c != "quarter"]
    return f"row({', '.join(keep)})"


def _child_sets(con: duckdb.DuckDBPyConnection, table: str) -> str:
    """One row per (primaryid, quarter) of a child table: its rows as an order-free set hash."""
    return f"""
        SELECT primaryid, quarter, count(*) AS n, sum(hash({data_row(con, table)})) AS h
        FROM {table} WHERE primaryid IN (SELECT primaryid FROM multi)
        GROUP BY primaryid, quarter
    """


def b_primaryid_overlap(con) -> dict:
    con.execute("""
        CREATE TEMP TABLE multi AS
        SELECT primaryid, count(DISTINCT quarter) AS quarters,
               list(DISTINCT quarter ORDER BY quarter) AS qs
        FROM demo GROUP BY primaryid HAVING count(DISTINCT quarter) > 1
    """)
    out = one(con, "SELECT count(*) AS primaryid_in_more_than_one_quarter FROM multi")
    out["by_number_of_quarters"] = rows(
        con, "SELECT quarters, count(*) AS primaryid FROM multi GROUP BY 1 ORDER BY 1"
    )
    out["quarter_pairs_top"] = rows(
        con,
        "SELECT array_to_string(qs, ',') AS quarters, count(*) AS primaryid FROM multi "
        "GROUP BY 1 ORDER BY 2 DESC LIMIT 15",
    )
    # DEMO row itself (all data columns) equal across the quarters?
    out["demo_rows"] = one(
        con,
        f"""
        WITH s AS (
            SELECT primaryid, count(DISTINCT hash({data_row(con, "demo")})) AS versions
            FROM demo WHERE primaryid IN (SELECT primaryid FROM multi) GROUP BY primaryid
        )
        SELECT count(*) FILTER (versions = 1) AS identical, count(*) FILTER (versions > 1) AS differ
        FROM s
        """,
    )
    for table in ("drug", "reac"):
        out[f"{table}_rows"] = one(
            con,
            f"""
            WITH s AS ({_child_sets(con, table)}),
            p AS (
                SELECT m.primaryid, m.quarters AS demo_quarters,
                       count(s.quarter) AS quarters_with_rows,
                       count(DISTINCT s.h) AS distinct_sets,
                       sum(s.n) AS rows_all_quarters,
                       arg_max(s.n, s.quarter) AS rows_latest_quarter
                FROM multi m LEFT JOIN s USING (primaryid)
                GROUP BY m.primaryid, m.quarters
            )
            SELECT
                count(*) FILTER (quarters_with_rows = demo_quarters AND distinct_sets = 1)
                    AS identical_in_every_quarter,
                count(*) FILTER (distinct_sets > 1) AS differ_between_quarters,
                count(*) FILTER (quarters_with_rows < demo_quarters) AS missing_in_some_quarter,
                coalesce(sum(rows_all_quarters - rows_latest_quarter), 0)
                    AS extra_rows_if_joined_on_primaryid_only
            FROM p
            """,
        )
    out["note"] = (
        "Sets compared per (primaryid, quarter) with sum(hash(row)) over the data columns; "
        "'extra_rows' = child rows outside the latest quarter, i.e. what a join on primaryid "
        "alone (without source_quarter) would add."
    )
    return out


def c_caseid_versions(con) -> dict:
    con.execute("""
        CREATE TEMP TABLE dv AS
        SELECT caseid, primaryid, quarter, v, max(v) OVER (PARTITION BY caseid) AS case_max_v,
               caseversion IS NOT NULL AND v IS NULL AS bad_v
        FROM (SELECT *, try_cast(caseversion AS INTEGER) AS v FROM demo)
    """)
    con.execute("""
        CREATE TEMP TABLE cv AS
        SELECT caseid,
               count(DISTINCT quarter) AS quarters,
               count(*) AS demo_rows,
               count(DISTINCT v) AS distinct_versions,
               max(v) AS max_v,
               max(quarter) AS latest_q,
               max(quarter) FILTER (v = case_max_v) AS latest_q_with_max_v,
               count(DISTINCT quarter) FILTER (v = case_max_v) AS quarters_with_max_v
        FROM dv GROUP BY caseid
    """)
    out = one(
        con,
        "SELECT count(*) AS caseid_total, "
        "count(*) FILTER (quarters > 1) AS caseid_in_more_than_one_quarter, "
        "(SELECT count(*) FROM dv WHERE bad_v) AS non_numeric_caseversion FROM cv",
    )
    out["caseid_by_number_of_quarters"] = rows(
        con, "SELECT quarters, count(*) AS caseid FROM cv GROUP BY 1 ORDER BY 1"
    )
    out["distinct_caseversion_per_caseid"] = rows(
        con, "SELECT distinct_versions, count(*) AS caseid FROM cv GROUP BY 1 ORDER BY 1"
    )
    out["max_caseversion_distribution"] = rows(
        con,
        "SELECT CASE WHEN max_v >= 10 THEN '10+' ELSE CAST(max_v AS VARCHAR) END "
        "AS max_caseversion, "
        "count(*) AS caseid FROM cv GROUP BY 1 ORDER BY min(max_v)",
    )
    out["multi_quarter_cases"] = one(
        con,
        """
        SELECT
            count(*) FILTER (latest_q_with_max_v = latest_q) AS max_version_in_latest_quarter,
            count(*) FILTER (latest_q_with_max_v < latest_q) AS max_version_not_in_latest_quarter,
            count(*) FILTER (latest_q_with_max_v IS NULL) AS no_numeric_version,
            count(*) FILTER (quarters_with_max_v > 1) AS max_version_repeated_in_several_quarters
        FROM cv WHERE quarters > 1
        """,
    )
    out["same_caseid_twice_in_one_quarter"] = one(
        con,
        "SELECT count(*) AS caseid_quarter_pairs FROM "
        "(SELECT caseid, quarter FROM demo GROUP BY 1, 2 HAVING count(*) > 1)",
    )
    out["examples_max_version_not_latest"] = rows(
        con,
        """
        SELECT cv.caseid, cv.latest_q, cv.latest_q_with_max_v, cv.max_v,
               list(dv.quarter || ':v' || coalesce(CAST(dv.v AS VARCHAR), '?')
                    ORDER BY dv.quarter) AS versions
        FROM cv JOIN dv USING (caseid)
        WHERE cv.quarters > 1 AND cv.latest_q_with_max_v < cv.latest_q
        GROUP BY ALL ORDER BY cv.caseid LIMIT 5
        """,
    )
    return out


def d_deleted_in_demo(con) -> dict:
    con.execute("""
        CREATE TEMP TABLE dd AS
        SELECT DISTINCT d.caseid, d.quarter AS deleted_q, m.quarter AS demo_q
        FROM deleted d LEFT JOIN (SELECT DISTINCT caseid, quarter FROM demo) m USING (caseid)
    """)
    out = one(
        con,
        "SELECT count(DISTINCT caseid) AS deleted_caseid_total, "
        "count(DISTINCT caseid) FILTER (demo_q IS NOT NULL) AS found_in_some_demo, "
        "count(DISTINCT caseid) FILTER (demo_q IS NULL) AS not_in_any_loaded_demo FROM dd",
    )
    out["per_deleted_file"] = rows(
        con,
        "SELECT deleted_q, count(DISTINCT caseid) AS ids, "
        "count(DISTINCT caseid) FILTER (demo_q IS NOT NULL) AS in_some_demo, "
        "count(DISTINCT caseid) FILTER (demo_q < deleted_q) AS in_earlier_demo, "
        "count(DISTINCT caseid) FILTER (demo_q = deleted_q) AS in_same_quarter_demo, "
        "count(DISTINCT caseid) FILTER (demo_q > deleted_q) AS in_later_demo "
        "FROM dd GROUP BY 1 ORDER BY 1",
    )
    out["deleted_q_x_demo_q"] = rows(
        con,
        "SELECT deleted_q, demo_q, count(DISTINCT caseid) AS caseid FROM dd "
        "WHERE demo_q IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2",
    )
    out["in_demo_after_deletion"] = one(
        con,
        "SELECT count(DISTINCT caseid) AS caseid FROM dd WHERE demo_q > deleted_q",
    )
    out["deleted_in_several_files"] = one(
        con,
        "SELECT count(*) AS caseid FROM "
        "(SELECT caseid FROM deleted GROUP BY 1 HAVING count(DISTINCT quarter) > 1)",
    )
    return out


def e_time_anchor(con) -> dict:
    out = {}
    for col in ("init_fda_dt", "fda_dt"):
        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE ta AS
            SELECT quarter AS source_q, {quarter_of(col)} AS date_q FROM demo
        """)
        summary = rows(
            con,
            """
            SELECT source_q, count(*) AS rows,
                   round(100.0 * count(*) FILTER (date_q = source_q) / count(*), 2) AS pct_same,
                   round(100.0 * count(*) FILTER (date_q < source_q) / count(*), 2) AS pct_before,
                   round(100.0 * count(*) FILTER (date_q > source_q) / count(*), 2) AS pct_after,
                   round(100.0 * count(*) FILTER (date_q IS NULL) / count(*), 2) AS pct_invalid
            FROM ta GROUP BY 1 ORDER BY 1
            """,
        )
        overall = one(
            con,
            """
            SELECT round(100.0 * count(*) FILTER (date_q = source_q) / count(*), 2) AS pct_same,
                   round(100.0 * count(*) FILTER (date_q < source_q) / count(*), 2) AS pct_before,
                   round(100.0 * count(*) FILTER (date_q > source_q) / count(*), 2) AS pct_after,
                   round(100.0 * count(*) FILTER (date_q IS NULL) / count(*), 2) AS pct_invalid
            FROM ta
            """,
        )
        # Crosstab: older date quarters are grouped so the table stays readable.
        crosstab = rows(
            con,
            """
            SELECT source_q,
                   CASE WHEN date_q IS NULL THEN 'invalid'
                        WHEN date_q < '2024Q1' THEN '<2024Q1'
                        ELSE date_q END AS date_q,
                   count(*) AS rows
            FROM ta GROUP BY 1, 2 ORDER BY 1, 2
            """,
        )
        out[col] = {"overall": overall, "per_source_quarter": summary, "crosstab": crosstab}
    return out


def f_empty_fields(con) -> list[dict]:
    def pct(c: str) -> str:
        return f"round(100.0 * count(*) FILTER (nullif(trim({c}), '') IS NULL) / count(*), 2)"

    return rows(
        con,
        f"SELECT quarter, count(*) AS rows, {pct('event_dt')} AS pct_event_dt_empty, "
        f"{pct('sex')} AS pct_sex_empty, {pct('age_cod')} AS pct_age_cod_empty "
        "FROM demo GROUP BY 1 ORDER BY 1",
    )


def g_role_cod(con) -> dict:
    dist = rows(
        con,
        "SELECT quarter, coalesce(nullif(trim(role_cod), ''), '<empty>') AS role_cod, "
        "count(*) AS rows FROM drug GROUP BY 1, 2 ORDER BY 1, 2",
    )
    first_dn = one(
        con, "SELECT min(quarter) AS first_quarter_with_dn FROM drug WHERE trim(role_cod) = 'DN'"
    )
    return {"distribution": dist, **first_dn}


def h_drug_names(con) -> dict:
    prod_ai = NORM.format(c="prod_ai")
    key = f"coalesce({prod_ai}, {NORM.format(c='drugname')})"
    pss = "trim(role_cod) IN ('PS', 'SS')"
    per_q = rows(
        con,
        f"""
        SELECT quarter, count(*) AS drug_rows,
               count(*) FILTER ({pss}) AS ps_ss_rows,
               count(DISTINCT {prod_ai}) AS distinct_prod_ai_all_roles,
               count(DISTINCT {prod_ai}) FILTER ({pss}) AS distinct_prod_ai_ps_ss,
               round(100.0 * count(*) FILTER ({pss} AND {prod_ai} IS NULL)
                     / nullif(count(*) FILTER ({pss}), 0), 2) AS pct_ps_ss_without_prod_ai,
               count(DISTINCT {key}) FILTER ({pss}) AS distinct_lookup_key_ps_ss
        FROM drug GROUP BY 1 ORDER BY 1
        """,
    )
    union = one(
        con,
        f"""
        SELECT count(DISTINCT {prod_ai}) AS distinct_prod_ai_all_roles,
               count(DISTINCT {prod_ai}) FILTER ({pss}) AS distinct_prod_ai_ps_ss,
               count(DISTINCT {key}) AS distinct_lookup_key_all_roles,
               count(DISTINCT {key}) FILTER ({pss}) AS distinct_lookup_key_ps_ss
        FROM drug
        """,
    )
    union["note"] = (
        "Names normalized with upper/trim/collapse spaces; lookup_key = prod_ai, else drugname "
        "(the RxNorm lookup key)."
    )
    return {"per_quarter": per_q, "union_8_quarters": union}


SECTIONS = [
    ("a_demo_totals", a_demo_totals),
    ("b_primaryid_overlap", b_primaryid_overlap),
    ("c_caseid_versions", c_caseid_versions),
    ("d_deleted_in_demo", d_deleted_in_demo),
    ("e_time_anchor", e_time_anchor),
    ("f_empty_fields", f_empty_fields),
    ("g_role_cod", g_role_cod),
    ("h_drug_names", h_drug_names),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "data" / "spikes" / "profile_lake.json"))
    args = ap.parse_args()

    lake = host_path(CFG["paths"]["lake"])
    duck_cfg = dict(CFG["parse"]["duckdb"])
    duck_cfg["temp_directory"] = str(host_path(duck_cfg["temp_directory"]))
    result: dict = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "duckdb_version": duckdb.__version__,
        "duckdb_settings": duck_cfg,
        "seconds": {},
    }
    with duckdb_session(duck_cfg) as con:
        create_views(con, lake)
        result["quarters"] = [
            r["quarter"] for r in rows(con, "SELECT DISTINCT quarter FROM demo ORDER BY 1")
        ]
        for name, fn in SECTIONS:
            t0 = time.perf_counter()
            result[name] = fn(con)
            result["seconds"][name] = round(time.perf_counter() - t0, 1)
            print(f"{name}: {result['seconds'][name]} s", flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
