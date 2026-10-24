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
