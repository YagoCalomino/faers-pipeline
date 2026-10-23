from __future__ import annotations

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO_ROOT / "config"


def _load(name: str) -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@pytest.fixture(scope="session")
def faers_cfg() -> dict:
    return _load("faers.yaml")


@pytest.fixture(scope="session")
def schema_cfg() -> dict:
    return _load("faers_schema.yaml")
