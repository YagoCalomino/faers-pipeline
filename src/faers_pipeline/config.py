from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from functools import cache
from pathlib import Path

import yaml

CONFIG_DIR = Path(os.environ.get("FAERS_CONFIG_DIR", "/opt/airflow/config"))


@cache
def load_config(name: str = "faers.yaml") -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def quarter_label(dt: datetime) -> str:
    """2024-07-01 -> '2024Q3'."""
    return f"{dt.year}Q{(dt.month - 1) // 3 + 1}"


def parse_quarter(label: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{4})Q([1-4])", label)
    if not m:
        raise ValueError(f"Invalid quarter: {label!r}")
    return int(m.group(1)), int(m.group(2))


def quarter_start(label: str) -> datetime:
    year, q = parse_quarter(label)
    return datetime(year, 3 * (q - 1) + 1, 1, tzinfo=UTC)


def build_url(cfg: dict, label: str) -> str:
    year, q = parse_quarter(label)
    name = cfg["source"]["filename_pattern"].format(year=year, q=q)
    return f"{cfg['source']['base_url'].rstrip('/')}/{name}"
