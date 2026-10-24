"""Extract + parse + contract + manifest on the real 2026Q2 sample (no network)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import pytest

from conftest import SAMPLE_DIR, SAMPLE_QUARTER, make_parse_cfg
from faers_pipeline import parse, quality

DELETED_TXT = SAMPLE_DIR / "Deleted" / "DELETE26Q2.txt"
OUTC_TXT = SAMPLE_DIR / "ASCII" / "OUTC26Q2.txt"
DEMO_TXT = SAMPLE_DIR / "ASCII" / "DEMO26Q2.txt"
RPSR_TXT = SAMPLE_DIR / "ASCII" / "RPSR26Q2.txt"


def _data_lines(path: Path) -> int:
    return len(path.read_bytes().splitlines()) - 1


def _deleted_ids(path: Path) -> list[str]:
    return [x.decode() for x in path.read_bytes().split() if x.strip()]


def _q(sql: str, *params) -> list[tuple]:
    con = duckdb.connect()
    try:
        return con.execute(sql, list(params)).fetchall()
    finally:
        con.close()


@pytest.fixture(scope="module")
def parsed(sample_zip, faers_cfg, schema_cfg, tmp_path_factory) -> dict:
    work = tmp_path_factory.mktemp("parsed")
    cfg = make_parse_cfg(faers_cfg, work)
    extracted = parse.extract_zip(sample_zip, work / "extracted", faers_cfg["file_types"])
    out = {"extracted": extracted, "work": work, "cfg": cfg, "res": {}, "summary": {}}
    for ft in faers_cfg["file_types"]:
        target = work / "lake" / ft / f"quarter={SAMPLE_QUARTER}" / f"{ft}.parquet"
        res = parse.to_parquet(Path(extracted[ft]), target, cfg)
        out["res"][ft] = res
        out["summary"][ft] = quality.summarize_parse(ft, res, schema_cfg)
    return out


def test_extract_finds_every_type(parsed, faers_cfg):
    assert set(parsed["extracted"]) == set(faers_cfg["file_types"])
    assert Path(parsed["extracted"]["demo"]).name == "DEMO26Q2.txt"
    assert not list((parsed["work"] / "extracted").glob("*.part"))


def test_rows_equal_txt_lines(parsed, faers_cfg):
    for ft in faers_cfg["file_types"]:
        res = parsed["res"][ft]
        lines = _data_lines(Path(parsed["extracted"][ft]))
        assert res["rows"] == lines == res["expected_rows"], ft
        assert res["malformed_rows"] == 0, ft
        assert res["encoding"] == "utf-8", ft
    assert parsed["res"]["demo"]["rows"] == _data_lines(DEMO_TXT) > 100
    assert parsed["res"]["rpsr"]["rows"] > 0  # fixture v2 selects cases with RPSR rows


def test_header_only_file_parses_to_zero_rows_and_fails_the_gate(
    parsed, tmp_path, parse_cfg, schema_cfg
):
    header_only = tmp_path / "RPSR26Q2.txt"
    header_only.write_bytes(RPSR_TXT.read_bytes().splitlines(keepends=True)[0])
    res = parse.to_parquet(header_only, tmp_path / "rpsr" / "rpsr.parquet", parse_cfg)
    assert res["rows"] == 0
    summaries = {**parsed["summary"], "rpsr": quality.summarize_parse("rpsr", res, schema_cfg)}
    with pytest.raises(ValueError, match="rpsr"):
        quality.check_rows(list(summaries.values()))


def test_contract_and_raw_columns(parsed, schema_cfg):
    assert parsed["summary"]["reac"]["extra_columns"] == ["drug_rec_act"]
    assert "mfr_dt" in parsed["summary"]["demo"]["extra_columns"]
    path = parsed["res"]["drug"]["path"]
    sql = f"DESCRIBE SELECT * FROM read_parquet('{path}', hive_partitioning = false)"
    types = {r[0]: r[1] for r in _q(sql)}
    assert list(types)[-2:] == ["_source_file", "_ingested_at"]
    assert {t for c, t in types.items() if not c.startswith("_")} == {"VARCHAR"}
    assert set(schema_cfg["drug"]) <= set(types)


def test_crlf_does_not_leak_into_last_column(parsed):
    # DRUG26Q2.txt uses CRLF; dose_freq is its last column.
    assert b"\r\n" in Path(parsed["extracted"]["drug"]).read_bytes()
    path = parsed["res"]["drug"]["path"]
    assert _q("SELECT count(*) FROM read_parquet(?) WHERE dose_freq LIKE '%\r%'", path) == [(0,)]


def test_manifest_from_sample(parsed, sample_zip, tmp_path):
    deleted = parse.parse_deleted(
        DELETED_TXT.read_bytes(),
        DELETED_TXT.name,
        tmp_path / "deleted" / "deleted.parquet",
        parsed["cfg"],
    )
    dl = {
        "url": "https://example.org/faers_ascii_2026q2.zip",
        "bytes": sample_zip.stat().st_size,
        "sha256": hashlib.sha256(sample_zip.read_bytes()).hexdigest(),
        "source_changed": False,
        "previous_sha256": None,
    }
    in_demo = quality.count_deleted_in_demo(parsed["res"]["demo"]["path"], deleted["path"])
    results = [{**s, "parse_seconds": 0.1, "peak_rss_mb": 1.0} for s in parsed["summary"].values()]
    manifest = quality.build_manifest(SAMPLE_QUARTER, dl, results, deleted, "manual__x", in_demo)
    path = tmp_path / "_meta" / f"quarter={SAMPLE_QUARTER}" / "manifest.json"
    quality.write_manifest(manifest, path)

    got = json.loads(path.read_text(encoding="utf-8"))
    assert got["run_id"] == "manual__x"
    assert got["zip"]["sha256"] == dl["sha256"] and got["zip"]["bytes"] == dl["bytes"]
    for ft, entry in got["file_types"].items():
        for key in quality.TYPE_FIELDS:
            assert key in entry, (ft, key)
        assert entry["content_fingerprint"].startswith(f"{entry['rows']}:")
    assert got["file_types"]["demo"]["rows"] == _data_lines(DEMO_TXT)
    assert got["deleted"]["deleted_ids"] == len(_deleted_ids(DELETED_TXT))
    assert got["deleted"]["invalid_deleted_ids"] == 0
    assert got["deleted"]["deleted_ids_in_demo"] == in_demo
    assert not list(path.parent.glob("*.tmp"))


# --- atomic write -------------------------------------------------------------------------


def test_crash_after_tmp_is_written_leaves_no_final_file(tmp_path, parse_cfg, monkeypatch):
    out = tmp_path / "outc" / "quarter=2026Q2" / "outc.parquet"
    seen = {}

    def crash(con, path):
        seen["tmp"] = (path.name, path.exists())
        raise RuntimeError("simulated crash after the tmp file was written")

    monkeypatch.setattr(parse, "_describe", crash)
    with pytest.raises(RuntimeError, match="simulated crash"):
        parse.to_parquet(OUTC_TXT, out, parse_cfg)
    assert seen["tmp"] == ("outc.parquet.tmp", True)
    assert not out.exists()
    assert list(out.parent.iterdir()) == []


def test_next_run_removes_temp_files_left_by_a_killed_run(tmp_path, parse_cfg):
    out = tmp_path / "outc" / "quarter=2026Q2" / "outc.parquet"
    out.parent.mkdir(parents=True)
    # A killed process never reaches its cleanup: simulate what it would leave behind.
    (out.parent / "outc.parquet.tmp").write_bytes(b"partial")
    (out.parent / "outc.parquet.part").write_bytes(b"partial")
    res = parse.to_parquet(OUTC_TXT, out, parse_cfg)
    assert sorted(res["stale_removed"]) == ["outc.parquet.part", "outc.parquet.tmp"]
    assert [p.name for p in out.parent.iterdir()] == ["outc.parquet"]
    assert res["rows"] == _data_lines(OUTC_TXT)


# --- content fingerprint ------------------------------------------------------------------


def test_fingerprint_is_identical_across_runs(tmp_path, parse_cfg):
    a = parse.to_parquet(OUTC_TXT, tmp_path / "a" / "outc.parquet", parse_cfg)
    b = parse.to_parquet(OUTC_TXT, tmp_path / "b" / "outc.parquet", parse_cfg)
    ingested = [
        _q("SELECT max(_ingested_at) FROM read_parquet(?)", r["path"])[0][0] for r in (a, b)
    ]
    assert ingested[0] != ingested[1]
    assert a["content_fingerprint"] == b["content_fingerprint"]


def test_fingerprint_changes_with_content(tmp_path, parse_cfg):
    lines = OUTC_TXT.read_bytes().splitlines(keepends=True)
    changed = tmp_path / "OUTC26Q2.txt"
    changed.write_bytes(b"".join([*lines[:-1], lines[-1].replace(b"$", b"$9", 1)]))
    a = parse.to_parquet(OUTC_TXT, tmp_path / "a" / "outc.parquet", parse_cfg)
    b = parse.to_parquet(changed, tmp_path / "b" / "outc.parquet", parse_cfg)
    assert a["rows"] == b["rows"]
    assert a["content_fingerprint"] != b["content_fingerprint"]


# --- irregular lines ----------------------------------------------------------------------


def test_count_fields_flags_irregular_and_blank_lines(tmp_path, parse_cfg):
    header, first, second, third = OUTC_TXT.read_bytes().splitlines(keepends=True)[:4]
    txt = tmp_path / "OUTC26Q2.txt"
    short = first.rstrip(b"\n").rsplit(b"$", 1)[0] + b"\n"  # one field missing
    txt.write_bytes(header + short + second + b"\n" + third)
    scan = parse.count_fields(txt, "$")
    assert scan == {
        "header_fields": 3,
        "data_lines": 4,
        "blank_lines": 1,
        "expected_rows": 3,
        "malformed_rows": 1,
    }
    res = parse.to_parquet(txt, tmp_path / "out" / "outc.parquet", parse_cfg)
    assert res["rows"] == res["expected_rows"] == 3


# --- deleted cases ------------------------------------------------------------------------


def test_parse_deleted_sample(tmp_path, parse_cfg):
    raw = DELETED_TXT.read_bytes()
    assert raw.splitlines()[0].strip() == b""  # the real file starts with a blank line
    res = parse.parse_deleted(raw, DELETED_TXT.name, tmp_path / "deleted.parquet", parse_cfg)
    expected = len(_deleted_ids(DELETED_TXT))
    assert (res["rows"], res["blank_lines"], res["invalid_ids"]) == (expected, 1, 0)
    assert res["columns"] == ["caseid", "_source_file", "_ingested_at"]
    ids = [r[0] for r in _q("SELECT caseid FROM read_parquet(?)", res["path"])]
    assert ids == [x.decode() for x in raw.split() if x.strip()]


def test_parse_deleted_counts_invalid_values_without_failing(tmp_path, parse_cfg):
    raw = DELETED_TXT.read_bytes() + b"12A45\r\n\n"
    res = parse.parse_deleted(raw, "DELETE26Q2.txt", tmp_path / "deleted.parquet", parse_cfg)
    assert (res["rows"], res["blank_lines"], res["invalid_ids"]) == (
        len(_deleted_ids(DELETED_TXT)) + 1,
        2,
        1,
    )
    assert res["invalid_examples"] == ["12A45"]


def test_deleted_member_is_found_ignoring_case(sample_zip, faers_cfg):
    name = parse.deleted_member_name(faers_cfg["deleted"]["member_pattern"].lower(), 2026, 2)
    member, raw = parse.read_member(sample_zip, name)
    assert member == "Deleted/DELETE26Q2.txt"
    assert raw == DELETED_TXT.read_bytes()


def test_deleted_member_name_uses_two_digit_year(faers_cfg):
    pattern = faers_cfg["deleted"]["member_pattern"]
    assert parse.deleted_member_name(pattern, 2024, 3) == "Deleted/DELETE24Q3.txt"


def test_read_member_missing_raises(sample_zip):
    with pytest.raises(FileNotFoundError):
        parse.read_member(sample_zip, "Deleted/DELETE99Q1.txt")


# --- DuckDB limits ------------------------------------------------------------------------


def test_duckdb_session_applies_config(tmp_path, faers_cfg):
    cfg = {**faers_cfg["parse"]["duckdb"], "temp_directory": str(tmp_path / "spill")}
    with parse.duckdb_session(cfg) as con:
        threads, temp = con.execute(
            "SELECT current_setting('threads'), current_setting('temp_directory')"
        ).fetchone()
        limit = con.execute("SELECT current_setting('memory_limit')").fetchone()[0]
        ref = duckdb.connect()
        ref.execute(f"SET memory_limit = '{cfg['memory_limit']}'")
        expected_limit = ref.execute("SELECT current_setting('memory_limit')").fetchone()[0]
        ref.close()
    assert threads == cfg["threads"]
    assert limit == expected_limit
    assert Path(temp).parent == tmp_path / "spill"
    assert not Path(temp).exists()  # private spill folder removed on exit
