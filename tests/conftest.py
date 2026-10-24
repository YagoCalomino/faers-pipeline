from __future__ import annotations

import copy
import zipfile
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO_ROOT / "config"
# Real subset of the 2026Q2 zip (see tests/fixtures/faers_sample/SOURCE.md).
SAMPLE_DIR = REPO_ROOT / "tests" / "fixtures" / "faers_sample"
SAMPLE_QUARTER = "2026Q2"


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
    """Zips tests/fixtures/faers_sample with the same member paths as the FDA zip."""
    path = tmp_path_factory.mktemp("zip") / "faers_ascii_2026q2.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(SAMPLE_DIR.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(SAMPLE_DIR).as_posix())
    return path
