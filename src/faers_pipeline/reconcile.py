"""Reconciles the raw lake (Parquet) with the warehouse core facts. Read-only on both.

The expected numbers are recomputed from the lake with DuckDB, independently of the dbt models:
  cases:    DEMO rows - superseded versions - deleted cases           = fct_case
  children: rows of the winning (primaryid, quarter) of each case     = fct_case_drug / _reaction
            (DRUG, REAC, OUTC rows minus rows of superseded versions,  / _outcome
             minus rows of deleted cases, minus rows without a DEMO row)
Winner rule (same as int_faers__case_latest): highest caseversion, then latest fda_dt, then
latest quarter, then highest primaryid.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import duckdb

CHILDREN = [("drug", "fct_case_drug"), ("reac", "fct_case_reaction"), ("outc", "fct_case_outcome")]
HEADER = [
    "entity",
    "lake_rows",
    "superseded",
    "deleted",
    "no_demo_row",
    "expected",
    "warehouse",
    "diff",
]


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _lake_view(con: duckdb.DuckDBPyConnection, lake: Path, file_type: str) -> None:
    glob = (lake / "raw" / "faers" / file_type / "quarter=*" / f"{file_type}.parquet").as_posix()
    con.execute(
        f"CREATE VIEW lake_{file_type} AS SELECT * FROM read_parquet("
        f"{_sql_str(glob)}, hive_partitioning = true)"
    )


def reconcile(lake: Path, warehouse: Path) -> dict:
    """Rows of the reconciliation table (HEADER columns) and the entities that diverge."""
    con = duckdb.connect()
    try:
        con.execute(f"ATTACH {_sql_str(str(warehouse))} AS wh (READ_ONLY)")
        for ft in ("demo", "deleted", *(c for c, _ in CHILDREN)):
            _lake_view(con, lake, ft)
        con.execute("""
            CREATE TEMP TABLE deleted_ids AS
            SELECT DISTINCT CAST(trim(caseid) AS BIGINT) AS caseid FROM lake_deleted
            WHERE regexp_full_match(trim(caseid), '[0-9]+');

            CREATE TEMP TABLE demo AS
            SELECT CAST(primaryid AS BIGINT) AS primaryid, CAST(caseid AS BIGINT) AS caseid,
                   CAST(caseversion AS INTEGER) AS v, quarter,
                   try_strptime(trim(fda_dt), '%Y%m%d') AS fda
            FROM lake_demo;

            CREATE TEMP TABLE winners AS
            SELECT primaryid, quarter, caseid FROM (
                SELECT *, row_number() OVER (PARTITION BY caseid
                    ORDER BY v DESC, fda DESC NULLS LAST, quarter DESC, primaryid DESC) AS rn
                FROM demo WHERE caseid NOT IN (SELECT caseid FROM deleted_ids))
            WHERE rn = 1;
        """)
        demo_rows, caseids, deleted_present = con.execute("""
            SELECT count(*), count(DISTINCT caseid),
                   count(DISTINCT caseid) FILTER (caseid IN (SELECT caseid FROM deleted_ids))
            FROM demo
        """).fetchone()
        superseded = demo_rows - caseids
        expected_cases = caseids - deleted_present
        wh_cases = con.execute("SELECT count(*) FROM wh.core.fct_case").fetchone()[0]
        winners = con.execute("SELECT count(*) FROM winners").fetchone()[0]
        rows = [
            [
                "DEMO -> fct_case",
                demo_rows,
                superseded,
                deleted_present,
                0,
                expected_cases,
                wh_cases,
                wh_cases - expected_cases,
            ]
        ]
        if winners != expected_cases:
            rows.append(
                [
                    "(winner rule check)",
                    demo_rows,
                    "",
                    "",
                    "",
                    expected_cases,
                    winners,
                    winners - expected_cases,
                ]
            )
        for ft, fact in CHILDREN:
            total, of_deleted, no_demo, of_winner = con.execute(f"""
                WITH c AS (
                    SELECT CAST(l.primaryid AS BIGINT) AS primaryid, l.quarter,
                           d.caseid AS demo_caseid, w.primaryid IS NOT NULL AS is_winner
                    FROM lake_{ft} l
                    LEFT JOIN demo d
                      ON d.primaryid = CAST(l.primaryid AS BIGINT) AND d.quarter = l.quarter
                    LEFT JOIN winners w
                      ON w.primaryid = CAST(l.primaryid AS BIGINT) AND w.quarter = l.quarter
                )
                SELECT count(*),
                       count(*) FILTER (demo_caseid IN (SELECT caseid FROM deleted_ids)),
                       count(*) FILTER (demo_caseid IS NULL),
                       count(*) FILTER (is_winner)
                FROM c
            """).fetchone()
            superseded_rows = total - of_deleted - no_demo - of_winner
            wh_rows = con.execute(f"SELECT count(*) FROM wh.core.{fact}").fetchone()[0]
            rows.append(
                [
                    f"{ft.upper()} -> {fact}",
                    total,
                    superseded_rows,
                    of_deleted,
                    no_demo,
                    of_winner,
                    wh_rows,
                    wh_rows - of_winner,
                ]
            )
    finally:
        con.close()
    return {"rows": rows, "divergent": [r[0] for r in rows if r[-1] != 0]}


def check_against(lake: Path) -> Callable[[Path], list[str]]:
    """Check for warehouse.build_atomic: reconciles a new warehouse file with `lake`, prints the
    table and returns the divergent entities (empty when every count matches)."""

    def check(new_warehouse: Path) -> list[str]:
        result = reconcile(lake, new_warehouse)
        print(format_table(result["rows"]), flush=True)
        return result["divergent"]

    return check


def format_table(rows: list[list], header: list[str] = HEADER) -> str:
    cells = [[f"{v:,}" if isinstance(v, int) else str(v) for v in r] for r in rows]
    widths = [max(len(h), *(len(c[i]) for c in cells)) for i, h in enumerate(header)]
    out = [" | ".join(h.rjust(w) for h, w in zip(header, widths, strict=True))]
    out.append("-+-".join("-" * w for w in widths))
    out += [" | ".join(c.rjust(w) for c, w in zip(r, widths, strict=True)) for r in cells]
    return "\n".join(out)
