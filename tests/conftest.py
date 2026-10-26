from __future__ import annotations

import copy
from pathlib import Path

import pytest
import yaml

from faers_pipeline.local_ingest import zip_folder

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO_ROOT / "config"
# Real subset of 4 FDA quarterly zips, one folder per quarter with the zip layout
# (see tests/fixtures/faers_sample/SOURCE.md). Single-quarter tests use 2026Q2.
SAMPLE_ROOT = REPO_ROOT / "tests" / "fixtures" / "faers_sample"
SAMPLE_QUARTERS = ["2024Q3", "2025Q1", "2025Q2", "2026Q2"]
SAMPLE_QUARTER = "2026Q2"
SAMPLE_DIR = SAMPLE_ROOT / SAMPLE_QUARTER


def _load(name: str) -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@pytest.fixture(scope="session")
def faers_cfg() -> dict:
    return _load("faers.yaml")


@pytest.fixture(scope="session")
def schema_cfg() -> dict:
    return _load("faers_schema.yaml")


def make_parse_cfg(faers_cfg: dict, tmp: Path) -> dict:
    """The real parse config, with DuckDB spill files under a test folder."""
    cfg = copy.deepcopy(faers_cfg["parse"])
    cfg["duckdb"]["temp_directory"] = str(tmp / "duckdb_tmp")
    return cfg


@pytest.fixture
def parse_cfg(faers_cfg, tmp_path) -> dict:
    return make_parse_cfg(faers_cfg, tmp_path)


@pytest.fixture(scope="session")
def sample_zip(tmp_path_factory) -> Path:
    """Zips the 2026Q2 sample folder with the same member paths as the FDA zip."""
    return zip_folder(SAMPLE_DIR, tmp_path_factory.mktemp("zip") / "faers_ascii_2026q2.zip")


@pytest.fixture(scope="session")
def fixture_lake(tmp_path_factory, faers_cfg, schema_cfg) -> Path:
    """The 4 real fixture quarters parsed into a lake (same code as scripts/build_test_lake.py),
    with one manifest per quarter built from the Parquet files written."""
    import json

    import pyarrow.parquet as pq

    from faers_pipeline.local_ingest import ingest_quarter, raw_path

    root = tmp_path_factory.mktemp("lake_root")
    lake, work = root / "lake", root / "work"
    cfg = make_parse_cfg(faers_cfg, root)
    full = {**faers_cfg, "parse": cfg}
    for q in SAMPLE_QUARTERS:
        ingest_quarter(SAMPLE_ROOT / q, q, lake, work, full, schema_cfg)
        manifest = {
            "quarter": q,
            "file_types": {
                ft: {
                    "path": str(raw_path(lake, ft, q)),
                    "rows": pq.ParquetFile(raw_path(lake, ft, q)).metadata.num_rows,
                }
                for ft in faers_cfg["file_types"]
            },
            "deleted": {"path": str(raw_path(lake, "deleted", q))},
        }
        path = lake / "_meta" / "faers" / f"quarter={q}" / "manifest.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest), encoding="utf-8")
    return lake
