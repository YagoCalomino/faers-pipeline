"""Builds tests/fixtures/faers_sample/ (fixture v2) from the real lake and the FDA zips.

Run inside the container after the 8 quarters are ingested:
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/make_fixture.py

Output: one folder per quarter (2024Q3, 2025Q1, 2025Q2, 2026Q2) with the zip's own layout,
<quarter>/ASCII/<TYPE><yy>Q<q>.txt and <quarter>/Deleted/DELETE<yy>Q<q>.txt. Lines are copied
byte for byte from the zip (line endings included), so the real parse runs on them in CI.

Case selection (deterministic; the lake is only used to choose, the bytes come from the zips):
  a) the first CASES_FIRST distinct caseid of the 2026Q2 DEMO file, in file order;
  b) CASES_MULTI caseid present in 2024Q3 and 2026Q2 whose highest caseversion in 2026Q2 is
     greater than in 2024Q3 (smallest caseid first);
  c) REPUBLISHED primaryid among those present in both 2025Q1 and 2025Q2: the smallest one whose
     REAC rows differ between the two quarters, then the smallest others;
  d) DELETED_IN_DEMO caseid listed in the deleted file of a fixture quarter and present in the
     DEMO of a fixture quarter at or before it (same-quarter cases first, then smallest caseid);
  e) RPSR_CASES caseid with an RPSR row: the smallest primaryid of each fixture quarter, then
     the next ones of 2026Q2 until RPSR_CASES (so every quarter has RPSR rows);
  f) DN_CASES caseid with a drug of role DN in 2026Q2 (smallest primaryid first);
  g) EMPTY_FIELD_CASES caseid with empty sex and EMPTY_FIELD_CASES with empty age_cod in 2026Q2;
  h) caseid 26012757 (versions 6 and 7 in 2026Q2);
  i) THER_PARTIAL caseid with a THER start_dt of 6 characters and THER_PARTIAL with 4.
For every selected caseid, each fixture quarter keeps all its DEMO lines and, for the primaryid
of those lines, every line of DRUG, REAC, OUTC, RPSR, THER and INDI of that quarter.
Deleted files keep their leading blank line (when present), the ids of (d) in that file, and
the first DELETED_EXTRA ids of the file.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

import duckdb  # noqa: E402

from faers_pipeline import parse  # noqa: E402
from faers_pipeline.config import build_url, load_config, parse_quarter  # noqa: E402

CFG = load_config("faers.yaml")
QUARTERS = ["2024Q3", "2025Q1", "2025Q2", "2026Q2"]
CASES_FIRST = 100
CASES_MULTI = 25
REPUBLISHED = 5
DELETED_IN_DEMO = 10
RPSR_CASES = 5
DN_CASES = 3
EMPTY_FIELD_CASES = 5
FIXED_CASEIDS = ["26012757"]
THER_PARTIAL = 2
DELETED_EXTRA = 10


def landing_zip(quarter: str) -> Path:
    return Path(CFG["paths"]["landing"]) / quarter / Path(build_url(CFG, quarter)).name


def type_member(names: list[str], file_type: str) -> str:
    """Same rule as parse.extract_zip: basename starts with the type and ends with .txt."""
    for name in names:
        base = os.path.basename(name).lower()
        if base.endswith(".txt") and base.startswith(file_type):
            return name
    raise FileNotFoundError(file_type)


def field(line: bytes, index: int, delim: bytes) -> bytes:
    return line.rstrip(b"\r\n").split(delim)[index]


def column_index(header: bytes, name: str, delim: bytes) -> int:
    return header.rstrip(b"\r\n").split(delim).index(name.encode())


def ids(con: duckdb.DuckDBPyConnection, sql: str) -> list[str]:
    return [str(r[0]) for r in con.execute(sql).fetchall()]


def lake_views(con: duckdb.DuckDBPyConnection) -> None:
    lake = Path(CFG["paths"]["lake"]) / "raw" / "faers"
    quarters = ", ".join(f"'{q}'" for q in QUARTERS)
    for t in ("demo", "drug", "reac", "rpsr", "ther", "deleted"):
        con.execute(
            f"CREATE VIEW {t} AS SELECT * FROM read_parquet("
            f"'{lake}/{t}/quarter=*/{t}.parquet', hive_partitioning = true) "
            f"WHERE quarter IN ({quarters})"
        )


def select_cases(con: duckdb.DuckDBPyConnection, first_2026q2: list[str]) -> dict[str, list]:
    sel: dict[str, list] = {"a_first_2026Q2": first_2026q2}
    sel["b_multi_version"] = ids(
        con,
        f"""
        SELECT caseid FROM demo GROUP BY caseid
        HAVING max(CAST(caseversion AS INT)) FILTER (quarter = '2026Q2')
             > max(CAST(caseversion AS INT)) FILTER (quarter = '2024Q3')
        ORDER BY CAST(caseid AS BIGINT) LIMIT {CASES_MULTI}
        """,
    )
    rep = con.execute(
        f"""
        WITH m AS (SELECT primaryid FROM demo WHERE quarter IN ('2025Q1', '2025Q2')
                   GROUP BY 1 HAVING count(DISTINCT quarter) = 2),
        r AS (SELECT primaryid, quarter, sum(hash(pt, drug_rec_act)) AS h FROM reac
              WHERE primaryid IN (SELECT primaryid FROM m) GROUP BY 1, 2),
        diff AS (SELECT primaryid FROM r GROUP BY 1 HAVING count(DISTINCT h) > 1)
        SELECT m.primaryid, m.primaryid IN (SELECT primaryid FROM diff) AS reac_differs
        FROM m ORDER BY reac_differs DESC, CAST(m.primaryid AS BIGINT) LIMIT {REPUBLISHED}
        """
    ).fetchall()
    sel["c_republished_primaryid"] = [f"{p} (reac differs)" if d else p for p, d in rep]
    pids = ", ".join(f"'{p}'" for p, _ in rep)
    sel["c_caseid"] = ids(con, f"SELECT DISTINCT caseid FROM demo WHERE primaryid IN ({pids})")
    sel["d_deleted_in_demo"] = ids(
        con,
        f"""
        SELECT x.caseid FROM (SELECT DISTINCT caseid, quarter FROM deleted) x
        JOIN (SELECT DISTINCT caseid, quarter FROM demo) d
          ON d.caseid = x.caseid AND d.quarter <= x.quarter
        GROUP BY x.caseid ORDER BY bool_or(d.quarter = x.quarter) DESC,
                 CAST(x.caseid AS BIGINT) LIMIT {DELETED_IN_DEMO}
        """,
    )
    per_quarter = ids(
        con,
        """
        SELECT caseid FROM (
            SELECT d.caseid, d.quarter,
                   row_number() OVER (PARTITION BY d.quarter
                                      ORDER BY CAST(r.primaryid AS BIGINT)) AS n
            FROM rpsr r JOIN demo d ON d.primaryid = r.primaryid AND d.quarter = r.quarter)
        WHERE n = 1 ORDER BY quarter
        """,
    )
    more = ids(
        con,
        """
        SELECT d.caseid FROM rpsr r JOIN demo d ON d.primaryid = r.primaryid
         AND d.quarter = r.quarter WHERE r.quarter = '2026Q2'
        GROUP BY d.caseid ORDER BY min(CAST(r.primaryid AS BIGINT))
        """,
    )
    sel["e_rpsr"] = (per_quarter + [c for c in more if c not in per_quarter])[:RPSR_CASES]
    sel["f_role_dn"] = ids(
        con,
        f"""
        SELECT caseid FROM drug WHERE quarter = '2026Q2' AND trim(role_cod) = 'DN'
        GROUP BY caseid ORDER BY min(CAST(primaryid AS BIGINT)) LIMIT {DN_CASES}
        """,
    )
    for col in ("sex", "age_cod"):
        sel[f"g_empty_{col}"] = ids(
            con,
            f"""
            SELECT caseid FROM demo WHERE quarter = '2026Q2' AND nullif(trim({col}), '') IS NULL
            ORDER BY CAST(primaryid AS BIGINT) LIMIT {EMPTY_FIELD_CASES}
            """,
        )
    sel["h_fixed"] = FIXED_CASEIDS
    for n in (6, 4):
        sel[f"i_ther_start_dt_{n}_chars"] = ids(
            con,
            f"""
            SELECT caseid FROM ther WHERE length(trim(start_dt)) = {n}
            GROUP BY caseid ORDER BY CAST(caseid AS BIGINT) LIMIT {THER_PARTIAL}
            """,
        )
    return sel


def first_caseids(zf: zipfile.ZipFile, delim: bytes, n: int) -> list[str]:
    demo = zf.read(type_member(zf.namelist(), "demo")).splitlines(keepends=True)
    i_case = column_index(demo[0], "caseid", delim)
    seen: list[str] = []
    for line in demo[1:]:
        cid = field(line, i_case, delim).decode()
        if cid not in seen:
            seen.append(cid)
            if len(seen) == n:
                break
    return seen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "tests" / "fixtures" / "faers_sample"))
    args = ap.parse_args()
    delim = CFG["parse"]["delimiter"].encode()
    out = Path(args.out)

    with zipfile.ZipFile(landing_zip("2026Q2")) as zf:
        first = first_caseids(zf, delim, CASES_FIRST)
    con = duckdb.connect()
    lake_views(con)
    sel = select_cases(con, first)
    con.close()
    cases = {
        c.encode()
        for key, values in sel.items()
        if key != "c_republished_primaryid"
        for c in values
    }
    deleted_pick = {c.encode() for c in sel["d_deleted_in_demo"]}

    if out.exists():
        shutil.rmtree(out)
    table, total = [], 0
    for quarter in QUARTERS:
        zip_path = landing_zip(quarter)
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            selected: dict[str, list[bytes]] = {}
            demo_member = type_member(names, "demo")
            demo = zf.read(demo_member).splitlines(keepends=True)
            i_case = column_index(demo[0], "caseid", delim)
            i_pid = column_index(demo[0], "primaryid", delim)
            kept = [ln for ln in demo[1:] if field(ln, i_case, delim) in cases]
            pids = {field(ln, i_pid, delim) for ln in kept}
            selected[demo_member] = [demo[0], *kept]
            for ft in CFG["file_types"]:
                if ft == "demo":
                    continue
                member = type_member(names, ft)
                lines = zf.read(member).splitlines(keepends=True)
                idx = column_index(lines[0], "primaryid", delim)
                selected[member] = [lines[0]] + [
                    ln for ln in lines[1:] if ln.strip() and field(ln, idx, delim) in pids
                ]
        year, q = parse_quarter(quarter)
        name = parse.deleted_member_name(CFG["deleted"]["member_pattern"], year, q)
        del_member, raw = parse.read_member(zip_path, name)
        del_lines, extra = [], 0
        for i, line in enumerate(raw.splitlines(keepends=True)):
            value = line.strip()
            if not value:
                if i == 0:
                    del_lines.append(line)
                continue
            if value in deleted_pick:
                del_lines.append(line)
            elif extra < DELETED_EXTRA:
                del_lines.append(line)
                extra += 1
        selected[del_member] = del_lines

        sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        for member, lines in selected.items():
            target = out / quarter / member
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"".join(lines))
            size = target.stat().st_size
            total += size
            table.append(f"| {quarter} | `{member}` | {len(lines)} | {size:,} |")
        table.append(f"| {quarter} | zip sha256 `{sha}` | | |")

    groups = "\n".join(f"- `{k}` ({len(v)}): {', '.join(map(str, v))}" for k, v in sel.items())
    (out / "SOURCE.md").write_text(
        f"""# FAERS sample fixture (v2)

Real subset of the FDA FAERS quarterly ASCII files {", ".join(QUARTERS)}, built by
`scripts/make_fixture.py` (selection rules in its docstring). Lines are copied unchanged from
the zips (line endings included), so this folder is marked `-text` in `.gitattributes`.
Source zips: {build_url(CFG, "2024Q3").rsplit("/", 1)[0]}/faers_ascii_<yyyy>q<n>.zip

Selected caseid per rule ({len(cases)} distinct caseid):
{groups}

| Quarter | File | Lines (with header) | Bytes |
|---|---|---|---|
{chr(10).join(table)}

Total: {total:,} bytes.
""",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {out}: {len(cases)} caseid, {total:,} bytes")
    for key, values in sel.items():
        print(f"  {key}: {len(values)}")


if __name__ == "__main__":
    main()
