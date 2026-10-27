"""faers_pipeline.site_check on exports of the real fixture subset (tests/fixtures/site_export)."""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest
import yaml
from test_export import CFG, DAY, RXNORM_CFG, _warehouse

from faers_pipeline import export, site_check

REPO = Path(__file__).resolve().parents[2]
SITE_CFG = yaml.safe_load((REPO / "config" / "site.yaml").read_text(encoding="utf-8"))
LIMITS = SITE_CFG["limits"]
DOWNLOADS = SITE_CFG["downloads"]


def _export(tmp_path: Path, wh: Path, name: str = "candidate") -> Path:
    out = tmp_path / name
    export.export_site(
        wh, out, cfg=CFG, rxnorm_cfg=RXNORM_CFG, export_day=DAY, window_end_quarter="2026Q2"
    )
    return out


def _validate(out: Path, wh: Path, **limits):
    return site_check.validate_export(out, wh, {**LIMITS, **limits}, DOWNLOADS)


def _problems(out: Path, wh: Path, **limits) -> list[str]:
    with pytest.raises(site_check.ExportValidationError) as info:
        _validate(out, wh, **limits)
    assert info.value.report["ok"] is False
    return info.value.problems


def test_valid_export_passes(tmp_path):
    wh = _warehouse(tmp_path)
    report = _validate(_export(tmp_path, wh), wh)
    assert report["ok"] and report["problems"] == []
    assert report["warehouse_counts"] == {
        "ingredients": 3,
        "signals_top": 9,
        "dq_metrics": 297,
        "known_signals": 12,
    }
    assert report["exported_counts"]["ingredients"] == {
        "parquet": 3,
        "json": 3,
        "search": 3,
        "files": 3,
    }
    assert report["exported_counts"]["signals_top"] == {"parquet": 9, "json": 9}


def test_tampered_file_fails_the_manifest_check(tmp_path):
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    path = out / "json" / "known_signals.json"
    path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    problems = _problems(out, wh)
    assert any("manifest differs" in p and "known_signals.json" in p for p in problems)


def test_extra_file_fails_the_manifest_check(tmp_path):
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    (out / "json" / "stray.json").write_text("{}", encoding="utf-8")
    assert any("extra ['json/stray.json']" in p for p in _problems(out, wh))


def test_warehouse_changed_after_export_fails_the_counts(tmp_path):
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    con = duckdb.connect(str(wh))
    con.execute("delete from signals.mart_dq_metrics where metric_group = 'role_mix'")
    con.close()
    problems = _problems(out, wh)
    assert any(p.startswith("dq_metrics: warehouse") for p in problems)


def test_size_limit_fails(tmp_path):
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    problems = _problems(out, wh, export_max_file_bytes=1000)
    assert any("limit 1000" in p for p in problems)


def test_bad_cells_fail(tmp_path):
    wh = _warehouse(tmp_path)
    con = duckdb.connect(str(wh))
    con.execute("update signals.mart_signals set d = d + 1 where period_key = 'ALL'")
    con.close()
    out = _export(tmp_path, wh)
    report_problems = _problems(out, wh)
    assert any("a+b+c+d != n_total" in p for p in report_problems)


def test_undocumented_column_fails(tmp_path):
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    downloads = json.loads(json.dumps(DOWNLOADS))
    del downloads["known_signals"]["columns"]["chi2"]
    downloads["dq_metrics"]["columns"]["not_a_column"] = "x"
    with pytest.raises(site_check.ExportValidationError) as info:
        site_check.validate_export(out, wh, LIMITS, downloads)
    joined = " | ".join(info.value.problems)
    assert "parquet/known_signals: columns without description ['chi2']" in joined
    assert "downloads.dq_metrics: described columns not exported ['not_a_column']" in joined


def test_promote_writes_a_marker_that_matches(tmp_path):
    wh = _warehouse(tmp_path)
    candidate = _export(tmp_path, wh)
    report = _validate(candidate, wh)
    out, marker = tmp_path / "site_export", tmp_path / "site_export.ready.json"
    record = site_check.promote(candidate, out, marker, report, run_id="test")
    assert not candidate.exists() and (out / "manifest.json").is_file()
    assert record["manifest_sha256"] == site_check.manifest_sha256(out)
    assert record["run_id"] == "test" and record["last_quarter"] == "2026Q2"
    assert site_check.is_ready(out, marker)
    (out / "manifest.json").write_text("{}", encoding="utf-8")
    assert not site_check.is_ready(out, marker)


def test_failed_validation_keeps_previous_export_and_marker(tmp_path):
    wh = _warehouse(tmp_path)
    out, marker = tmp_path / "site_export", tmp_path / "site_export.ready.json"
    first = _export(tmp_path, wh)
    site_check.promote(first, out, marker, _validate(first, wh))
    before = (out / "manifest.json").read_bytes(), marker.read_bytes()
    second = _export(tmp_path, wh)
    _problems(second, wh, export_max_files=2)  # the DAG stops here: promote never runs
    assert ((out / "manifest.json").read_bytes(), marker.read_bytes()) == before
    assert site_check.is_ready(out, marker)


def test_config_describes_every_exported_column(tmp_path):
    # The real config against the real fixture: no column without a description.
    wh = _warehouse(tmp_path)
    out = _export(tmp_path, wh)
    _, columns = site_check._parquet_info(out)
    for table, cols in columns.items():
        assert set(cols) == set(DOWNLOADS[table]["columns"]), table
