"""Atomic warehouse build (faers_pipeline.warehouse.build_atomic) without running dbt: a runner
stands in for `dbt build`, writing the DuckDB file dbt would write (DUCKDB_PATH) and returning an
exit code. The reconciliation runs on the fixture lake, as the check before the swap and against
the file that ends up in place."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import duckdb
import pytest

from faers_pipeline import warehouse
from faers_pipeline.reconcile import check_against, reconcile

FACTS = ["fct_case", "fct_case_drug", "fct_case_reaction", "fct_case_outcome"]


def write_facts(path: Path, counts: dict[str, int]) -> None:
    con = duckdb.connect(str(path))
    try:
        con.execute("create schema if not exists core")
        for fact in FACTS:
            con.execute(
                f"create or replace table core.{fact} as select range as id "
                f"from range({counts.get(fact, 0)})"
            )
    finally:
        con.close()


def runner_writing(counts: dict[str, int], rc: int = 0):
    def run(env: dict) -> int:
        write_facts(Path(env["DUCKDB_PATH"]), counts)
        return rc

    return run


def fingerprint(path: Path) -> tuple:
    st = path.stat()
    return hashlib.sha256(path.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns


@pytest.fixture
def expected_counts(fixture_lake, tmp_path_factory) -> dict[str, int]:
    """Counts the reconciliation expects for the fixture lake (from an empty warehouse)."""
    empty = tmp_path_factory.mktemp("empty") / "empty.duckdb"
    write_facts(empty, {})
    rows = reconcile(fixture_lake, empty)["rows"]
    return {r[0].split("-> ")[1]: r[5] for r in rows if "->" in r[0]}


def test_success_swaps_in_the_new_file_and_reconcile_reads_it(
    fixture_lake, expected_counts, tmp_path
):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, {})  # previous warehouse: empty facts, diverges from the lake
    assert reconcile(fixture_lake, wh)["divergent"]

    summary = warehouse.build_atomic(tmp_path, wh, runner=runner_writing(expected_counts))
    assert summary["dbt_exit_code"] == 0 and Path(summary["warehouse"]) == wh
    assert not (tmp_path / "_build").exists()
    assert reconcile(fixture_lake, wh)["divergent"] == []


def test_failure_keeps_the_old_warehouse_and_removes_the_new_file(
    fixture_lake, expected_counts, tmp_path
):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, expected_counts)
    before = fingerprint(wh)
    with pytest.raises(warehouse.WarehouseBuildError, match="exited 1"):
        warehouse.build_atomic(tmp_path, wh, runner=runner_writing({"fct_case": 1}, rc=1))
    assert fingerprint(wh) == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["faers.duckdb"]
    assert reconcile(fixture_lake, wh)["divergent"] == []


def test_build_that_writes_nothing_is_a_failure(tmp_path):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, {})
    before = fingerprint(wh)
    with pytest.raises(warehouse.WarehouseBuildError):
        warehouse.build_atomic(tmp_path, wh, runner=lambda env: 0)
    assert fingerprint(wh) == before


def test_leftovers_of_an_interrupted_build_are_removed_first(tmp_path):
    wh = tmp_path / "faers.duckdb"
    (tmp_path / "_build").mkdir()
    (tmp_path / "_build" / "faers.duckdb").write_bytes(b"half-written")
    (tmp_path / "_build" / "faers.duckdb.wal").write_bytes(b"x")
    seen = {}

    def run(env):
        seen["existed"] = Path(env["DUCKDB_PATH"]).exists()
        write_facts(Path(env["DUCKDB_PATH"]), {"fct_case": 2})
        return 0

    warehouse.build_atomic(tmp_path, wh, runner=run)
    assert seen["existed"] is False
    assert sorted(p.name for p in tmp_path.iterdir()) == ["faers.duckdb"]


def test_old_wal_is_not_replayed_onto_the_new_file(tmp_path):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, {})
    (tmp_path / "faers.duckdb.wal").write_bytes(b"stale wal of the old file")
    warehouse.build_atomic(tmp_path, wh, runner=runner_writing({"fct_case": 3}))
    assert not (tmp_path / "faers.duckdb.wal").exists()
    con = duckdb.connect(str(wh), read_only=True)
    assert con.execute("select count(*) from core.fct_case").fetchone()[0] == 3
    con.close()


def test_dbt_points_at_the_new_file_and_gets_the_config(tmp_path):
    seen = {}

    def run(env):
        seen.update(env)
        write_facts(Path(env["DUCKDB_PATH"]), {})
        return 0

    wh = tmp_path / "faers.duckdb"
    warehouse.build_atomic(tmp_path, wh, runner=run)
    assert seen["DUCKDB_PATH"] == str(tmp_path / "_build" / "faers.duckdb")
    assert seen["DBT_PROFILES_DIR"] == str(tmp_path)
    assert seen["DBT_MEMORY_LIMIT"] and seen["LAKE_PATH"]


def test_dbt_vars_pass_missing_value_placeholders():
    placeholders = warehouse.dbt_vars()["missing_value_placeholders"]
    assert placeholders["reporter_country"] == ["COUNTRY NOT SPECIFIED"]


def test_dbt_command_passes_vars_from_config(monkeypatch):
    monkeypatch.setenv("DBT_VENV", "/opt/dbt-venv")
    cmd = warehouse.dbt_command(["build"])
    assert cmd[0] == "/opt/dbt-venv/bin/dbt" and cmd[1] == "build" and cmd[2] == "--vars"
    assert '"rxnorm_generic_terms"' in cmd[3] and '"window_end_quarter"' in cmd[3]
    assert warehouse.dbt_command(["deps"]) == ["/opt/dbt-venv/bin/dbt", "deps"]
    assert os.path.basename(warehouse.dbt_command(["build"], ci=True)[0]) == "dbt"


def test_extra_env_reaches_dbt_but_not_the_database_path(tmp_path):
    seen = {}

    def run(env):
        seen.update(env)
        write_facts(Path(env["DUCKDB_PATH"]), {})
        return 0

    extra = {"DBT_TARGET_PATH": "/x/target", "DUCKDB_PATH": "/must/not/win.duckdb"}
    warehouse.build_atomic(tmp_path, tmp_path / "faers.duckdb", runner=run, extra_env=extra)
    assert seen["DBT_TARGET_PATH"] == "/x/target"
    assert seen["DUCKDB_PATH"] == str(tmp_path / "_build" / "faers.duckdb")


def test_divergent_reconciliation_keeps_the_old_warehouse_and_says_why(
    fixture_lake, expected_counts, tmp_path, capsys
):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, expected_counts)
    before = fingerprint(wh)
    wrong = {**expected_counts, "fct_case": expected_counts["fct_case"] - 1}
    with pytest.raises(warehouse.WarehouseBuildError, match=r"DEMO -> fct_case.*kept"):
        warehouse.build_atomic(
            tmp_path, wh, runner=runner_writing(wrong), check=check_against(fixture_lake)
        )
    assert fingerprint(wh) == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["faers.duckdb"]
    assert "fct_case" in capsys.readouterr().out  # the reconciliation table is printed


def test_passing_reconciliation_swaps_in_the_new_file(fixture_lake, expected_counts, tmp_path):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, {})
    seen = []

    def check(new: Path) -> list[str]:
        seen.append(new)
        return check_against(fixture_lake)(new)

    summary = warehouse.build_atomic(
        tmp_path, wh, runner=runner_writing(expected_counts), check=check
    )
    assert seen == [tmp_path / "_build" / "faers.duckdb"]  # checked before the swap
    assert summary["checked"] is True
    assert reconcile(fixture_lake, wh)["divergent"] == []
    assert not (tmp_path / "_build").exists()


def test_error_in_the_check_keeps_the_old_warehouse(tmp_path):
    wh = tmp_path / "faers.duckdb"
    write_facts(wh, {"fct_case": 5})
    before = fingerprint(wh)

    def broken(new: Path) -> list[str]:
        raise OSError("lake not readable")

    with pytest.raises(warehouse.WarehouseBuildError, match="lake not readable"):
        warehouse.build_atomic(tmp_path, wh, runner=runner_writing({"fct_case": 2}), check=broken)
    assert fingerprint(wh) == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["faers.duckdb"]
