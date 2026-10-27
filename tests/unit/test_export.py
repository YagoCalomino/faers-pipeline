"""faers_pipeline.export on a real subset of the warehouse marts (tests/fixtures/site_export,
built by scripts/make_export_fixture.py)."""

from __future__ import annotations

import json
import math
from datetime import date
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from faers_pipeline import export

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "site_export"
DAY = date(2026, 10, 26)
CFG = {
    "formats": ["parquet", "json"],
    "parquet_compression": "zstd",
    "json_float_digits": 6,
    "include_generic_fallback": False,
}
RXNORM_CFG = {"attribution_text": "This product uses publicly available data\n  from the NLM."}


def _warehouse(tmp_path: Path, with_rxnorm: bool = True) -> Path:
    path = tmp_path / "wh" / "faers.duckdb"
    path.parent.mkdir()
    con = duckdb.connect(str(path))
    for f in sorted(FIXTURE.glob("*.parquet")):
        schema, table = f.stem.split(".")
        if table == "stg_rxnorm__name_map" and not with_rxnorm:
            continue
        con.execute(f"create schema if not exists {schema}")
        con.execute(f"create table {schema}.{table} as select * from read_parquet('{f}')")
    con.close()
    return path


def _run(tmp_path: Path, wh: Path, **kw) -> tuple[Path, dict]:
    out = tmp_path / "site_export"
    cfg = {**CFG, **kw.pop("cfg", {})}
    kw.setdefault("window_end_quarter", "2026Q2")
    summary = export.export_site(wh, out, cfg=cfg, rxnorm_cfg=RXNORM_CFG, export_day=DAY, **kw)
    return out, summary


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_export_layout_and_content(tmp_path):
    out, summary = _run(tmp_path, _warehouse(tmp_path))
    ingredients = _load(out / "json" / "ingredients.json")
    names = [i["ingredient_name"] for i in ingredients]
    assert names == ["clozapine", "atorvastatin", "FATTY ACIDS"]  # by PS/SS cases, desc
    assert "HERBALS" not in names  # generic fallback left out by default
    for table in ("ingredients", "signals_top", "dq_metrics", "known_signals"):
        assert (out / "parquet" / f"{table}.parquet").is_file()
    for ing in ingredients:
        doc = _load(out / "json" / "signals" / f"{ing['ingredient_key']}.json")
        assert doc["ingredient"] == ing
        assert len(doc["pairs"]) == ing["n_pairs"] == 3
        assert "ingredient_id" not in doc["pairs"][0]
    ator = next(i for i in ingredients if i["ingredient_name"] == "atorvastatin")
    pairs = _load(out / "json" / "signals" / f"{ator['ingredient_key']}.json")["pairs"]
    assert [p["rank_ror_lcl"] for p in pairs] == [1, 2, 3]
    assert pairs[0]["reaction_pt"] == "Vaginal flatulence" and pairs[0]["a"] == 103
    assert isinstance(pairs[0]["trend"], list) and pairs[0]["trend"][0]["period_key"] == "2024Q3"
    assert len(_load(out / "json" / "known_signals.json")) == 12
    assert summary["n_ingredients"] == 3 and summary["n_pairs"] == 9
    assert not (tmp_path / "site_export.building").exists()


def test_metadata(tmp_path):
    out, _ = _run(tmp_path, _warehouse(tmp_path))
    meta = _load(out / "meta.json")
    assert meta["export_date"] == "2026-10-26"
    assert meta["last_quarter"] == "2026Q2"  # latest FAERS file quarter loaded
    assert meta["quarters"] == ["2026Q2"] and meta["first_quarter"] == "2026Q2"
    assert meta["provisional_quarter"] == "2026Q2" and meta["last_quarter_is_provisional"]
    assert meta["n_cases_all"] == 40 and meta["n_cases_in_window"] == 20
    assert meta["rxnorm_versions"] == ["05-Oct-2026"]
    assert meta["rxnav_attribution"] == "This product uses publicly available data from the NLM."


def test_last_quarter_not_provisional_when_window_ends_later(tmp_path):
    out, _ = _run(tmp_path, _warehouse(tmp_path), window_end_quarter="2026Q3")
    meta = _load(out / "meta.json")
    assert meta["provisional_quarter"] == "2026Q3"
    assert meta["last_quarter_is_provisional"] is False


def test_rxnorm_version_missing_is_empty_list(tmp_path):
    out, _ = _run(tmp_path, _warehouse(tmp_path, with_rxnorm=False))
    assert _load(out / "meta.json")["rxnorm_versions"] == []


def test_manifest_matches_files_on_disk(tmp_path):
    out, summary = _run(tmp_path, _warehouse(tmp_path))
    listed = _load(out / "manifest.json")["files"]
    assert listed == export.read_manifest_from_disk(out)
    assert summary["files"] == len(listed) + 1
    total = sum(f["bytes"] for f in listed) + (out / "manifest.json").stat().st_size
    assert summary["bytes"] == total


def test_idempotent_same_hashes(tmp_path):
    wh = _warehouse(tmp_path)
    out, _ = _run(tmp_path, wh)
    first = (out / "manifest.json").read_bytes()
    out, _ = _run(tmp_path, wh)
    assert (out / "manifest.json").read_bytes() == first
    assert not (tmp_path / "site_export.old").exists()


def test_include_generic_fallback_flag(tmp_path):
    out, summary = _run(tmp_path, _warehouse(tmp_path), cfg={"include_generic_fallback": True})
    names = [i["ingredient_name"] for i in _load(out / "json" / "ingredients.json")]
    assert "HERBALS" in names and summary["n_ingredients"] == 4


def test_single_format(tmp_path):
    out, summary = _run(tmp_path, _warehouse(tmp_path), formats=["parquet"])
    assert not (out / "json").exists() and (out / "parquet").is_dir()
    assert set(summary["by_format"]) == {"parquet"}


def test_unknown_format_rejected(tmp_path):
    with pytest.raises(ValueError):
        _run(tmp_path, _warehouse(tmp_path), formats=["csv"])


def test_failure_keeps_previous_export(tmp_path):
    wh = _warehouse(tmp_path)
    out, _ = _run(tmp_path, wh)
    before = (out / "manifest.json").read_bytes()
    con = duckdb.connect(str(wh))
    con.execute("drop table signals.mart_known_signals_eval")
    con.close()
    with pytest.raises(duckdb.Error):
        _run(tmp_path, wh)
    assert (out / "manifest.json").read_bytes() == before
    assert not (tmp_path / "site_export.building").exists()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (40.56316781, 40.5632),
        (0.000123456789, 0.000123457),
        (Decimal("2.5"), 2.5),
        (float("nan"), None),
        (math.inf, None),
        (True, True),
        (873, 873),
        ([{"prr": 1.23456789}], [{"prr": 1.23457}]),
        (date(2026, 10, 26), "2026-10-26"),
    ],
)
def test_to_json_value(value, expected):
    assert export.to_json_value(value, 6) == expected


def test_to_json_value_rejects_unknown_type():
    with pytest.raises(TypeError):
        export.to_json_value(object(), 6)
