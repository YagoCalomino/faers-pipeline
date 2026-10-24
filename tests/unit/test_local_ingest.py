"""All 4 fixture quarters through the real ingest path (zip, extract, Parquet, deleted, gates)."""

from __future__ import annotations

import copy
from pathlib import Path

import duckdb
import pytest

from conftest import SAMPLE_QUARTERS, SAMPLE_ROOT
from faers_pipeline.local_ingest import ingest_quarter, raw_path


def _data_lines(path: Path) -> int:
    return len(path.read_bytes().splitlines()) - 1


@pytest.fixture(scope="module")
def lake(faers_cfg, schema_cfg, tmp_path_factory) -> dict:
    root = tmp_path_factory.mktemp("test_lake")
    cfg = copy.deepcopy(faers_cfg)
    cfg["parse"]["duckdb"]["temp_directory"] = str(root / "duckdb_tmp")
    summaries = {
        q: ingest_quarter(SAMPLE_ROOT / q, q, root / "lake", root / "work", cfg, schema_cfg)
        for q in SAMPLE_QUARTERS
    }
    return {"path": root / "lake", "summaries": summaries}


def _q(lake_path: Path, sql: str) -> list[tuple]:
    con = duckdb.connect()
    try:
        for t in ("demo", "ther", "deleted"):
            glob = lake_path / "raw" / "faers" / t / "quarter=*" / f"{t}.parquet"
            con.execute(
                f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{glob}', hive_partitioning = true)"
            )
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_fixture_has_the_four_quarters():
    assert sorted(p.name for p in SAMPLE_ROOT.iterdir() if p.is_dir()) == SAMPLE_QUARTERS


def test_every_quarter_and_type_parses_with_all_rows(lake, faers_cfg):
    for quarter, summary in lake["summaries"].items():
        ascii_dir = SAMPLE_ROOT / quarter / "ASCII"
        for ft in faers_cfg["file_types"]:
            (txt,) = [p for p in ascii_dir.iterdir() if p.name.lower().startswith(ft)]
            assert summary["rows"][ft] == _data_lines(txt) > 0, (quarter, ft)
            assert raw_path(lake["path"], ft, quarter).exists()
        (deleted_txt,) = (SAMPLE_ROOT / quarter / "Deleted").iterdir()
        ids = [x for x in deleted_txt.read_bytes().split() if x.strip()]
        assert summary["deleted_ids"] == len(ids) and summary["invalid_deleted_ids"] == 0


def test_fixture_keeps_the_cases_the_dbt_tests_rely_on(lake):
    path = lake["path"]
    # Two versions of one case in the same quarter.
    assert _q(path, "SELECT count(*) FROM demo WHERE caseid = '26012757' AND quarter = '2026Q2'")
    assert _q(path, "SELECT count(*) FROM demo WHERE caseid = '26012757'")[0][0] >= 2
    # Republished primaryid (same version in 2025Q1 and 2025Q2).
    republished = _q(
        path,
        "SELECT count(*) FROM (SELECT primaryid FROM demo GROUP BY 1 "
        "HAVING count(DISTINCT quarter) > 1)",
    )[0][0]
    assert republished >= 5
    # Deleted cases that exist in a DEMO of the fixture.
    in_demo = _q(
        path, "SELECT count(DISTINCT caseid) FROM deleted WHERE caseid IN (SELECT caseid FROM demo)"
    )[0][0]
    assert in_demo >= 10
    # Partial dates in THER (6 and 4 characters).
    lengths = {r[0] for r in _q(path, "SELECT DISTINCT length(trim(start_dt)) FROM ther")}
    assert {4, 6} <= lengths
