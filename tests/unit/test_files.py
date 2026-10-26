from __future__ import annotations

from faers_pipeline.files import remove_stale_temp


def test_removes_only_tmp_and_part_at_top_level(tmp_path):
    for name in ("a.parquet.tmp", "b.zip.part", "keep.parquet", "manifest.json"):
        (tmp_path / name).write_bytes(b"x")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "c.tmp").write_bytes(b"x")
    assert remove_stale_temp(tmp_path) == ["a.parquet.tmp", "b.zip.part"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["keep.parquet", "manifest.json", "sub"]
    assert (tmp_path / "sub" / "c.tmp").exists()


def test_missing_folder_is_fine(tmp_path):
    assert remove_stale_temp(tmp_path / "nope") == []


# --------------------------------------------------------------------------- cleanup_extracted

import json  # noqa: E402
import shutil  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402

from faers_pipeline.files import cleanup_extracted  # noqa: E402

QUARTER = "2026Q2"


@pytest.fixture
def landing(tmp_path, fixture_lake):
    """Landing folder of 2026Q2 with the real fixture .txt files and a zip next to them."""
    sample = Path(__file__).resolve().parents[1] / "fixtures" / "faers_sample" / QUARTER
    folder = tmp_path / "landing" / QUARTER / "extracted"
    folder.mkdir(parents=True)
    for txt in (sample / "ASCII").glob("*.txt"):
        shutil.copy(txt, folder / txt.name)
    (folder / "README.pdf").write_bytes(b"not a txt")
    (tmp_path / "landing" / QUARTER / "faers_ascii_2026q2.zip").write_bytes(b"PK zip stays")
    return tmp_path / "landing"


def manifest_of(lake: Path) -> Path:
    return lake / "_meta" / "faers" / f"quarter={QUARTER}" / "manifest.json"


def test_cleanup_deletes_only_extracted_txt_when_manifest_is_consistent(
    landing, fixture_lake, faers_cfg
):
    folder = landing / QUARTER / "extracted"
    txt = sorted(p.name for p in folder.glob("*.txt"))
    assert txt
    dry = cleanup_extracted(landing, QUARTER, manifest_of(fixture_lake), faers_cfg["file_types"])
    assert dry["status"] == "would_delete" and dry["files"] == txt
    assert sorted(p.name for p in folder.glob("*.txt")) == txt  # dry run deletes nothing

    res = cleanup_extracted(
        landing, QUARTER, manifest_of(fixture_lake), faers_cfg["file_types"], dry_run=False
    )
    assert res["status"] == "deleted" and res["files"] == txt and res["bytes"] > 0
    assert sorted(p.name for p in folder.iterdir()) == ["README.pdf"]
    assert (landing / QUARTER / "faers_ascii_2026q2.zip").exists()
    assert manifest_of(fixture_lake).exists()

    again = cleanup_extracted(
        landing, QUARTER, manifest_of(fixture_lake), faers_cfg["file_types"], dry_run=False
    )
    assert again["status"] == "nothing_to_delete"  # idempotent


def test_cleanup_keeps_files_without_a_manifest(landing, tmp_path, faers_cfg):
    res = cleanup_extracted(
        landing, QUARTER, tmp_path / "missing.json", faers_cfg["file_types"], dry_run=False
    )
    assert res["status"] == "kept" and "manifest missing" in res["problems"][0]
    assert list((landing / QUARTER / "extracted").glob("*.txt"))


@pytest.mark.parametrize(
    "break_it",
    [
        lambda m: m.update(quarter="2026Q1"),
        lambda m: m["file_types"]["drug"].update(rows=m["file_types"]["drug"]["rows"] + 1),
        lambda m: m["file_types"].pop("reac"),
        lambda m: m["file_types"]["demo"].update(path="/nowhere/demo.parquet"),
        lambda m: m["deleted"].update(path="/nowhere/deleted.parquet"),
    ],
    ids=["other_quarter", "row_count", "missing_type", "missing_parquet", "missing_deleted"],
)
def test_cleanup_keeps_files_when_manifest_is_inconsistent(
    break_it, landing, fixture_lake, tmp_path, faers_cfg
):
    manifest = json.loads(manifest_of(fixture_lake).read_text(encoding="utf-8"))
    break_it(manifest)
    broken = tmp_path / "manifest.json"
    broken.write_text(json.dumps(manifest), encoding="utf-8")
    res = cleanup_extracted(landing, QUARTER, broken, faers_cfg["file_types"], dry_run=False)
    assert res["status"] == "kept" and res["problems"]
    assert list((landing / QUARTER / "extracted").glob("*.txt"))


def test_cleanup_refuses_a_folder_outside_landing(tmp_path, faers_cfg):
    with pytest.raises(ValueError, match="not inside"):
        cleanup_extracted(
            tmp_path / "landing", "../..", tmp_path / "m.json", faers_cfg["file_types"]
        )
