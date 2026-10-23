from __future__ import annotations

from datetime import UTC, datetime

import pytest

from faers_pipeline.config import build_url, parse_quarter, quarter_label, quarter_start


@pytest.mark.parametrize(
    ("dt", "expected"),
    [
        (datetime(2024, 1, 1), "2024Q1"),
        (datetime(2024, 3, 31), "2024Q1"),
        (datetime(2024, 4, 1), "2024Q2"),
        (datetime(2024, 7, 1), "2024Q3"),
        (datetime(2024, 12, 31), "2024Q4"),
    ],
)
def test_quarter_label(dt, expected):
    assert quarter_label(dt) == expected


def test_parse_quarter():
    assert parse_quarter("2026Q2") == (2026, 2)


@pytest.mark.parametrize("bad", ["2024Q5", "2024Q0", "2024q3", "24Q3", "2024-Q3", ""])
def test_parse_quarter_rejects_invalid(bad):
    with pytest.raises(ValueError):
        parse_quarter(bad)


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("2024Q1", datetime(2024, 1, 1, tzinfo=UTC)),
        ("2024Q3", datetime(2024, 7, 1, tzinfo=UTC)),
        ("2025Q4", datetime(2025, 10, 1, tzinfo=UTC)),
    ],
)
def test_quarter_start(label, expected):
    assert quarter_start(label) == expected


def test_quarter_start_roundtrip():
    for label in ("2024Q1", "2024Q2", "2024Q3", "2024Q4"):
        assert quarter_label(quarter_start(label)) == label


def test_build_url_uses_config(faers_cfg):
    url = build_url(faers_cfg, "2024Q3")
    base = faers_cfg["source"]["base_url"].rstrip("/")
    assert url == f"{base}/faers_ascii_2024q3.zip"


def test_build_url_strips_trailing_slash():
    cfg = {"source": {"base_url": "https://example.org/x/", "filename_pattern": "f_{year}q{q}.zip"}}
    assert build_url(cfg, "2025Q1") == "https://example.org/x/f_2025q1.zip"


def test_schedule_quarters_are_valid(faers_cfg):
    start = quarter_start(faers_cfg["schedule"]["start_quarter"])
    end = quarter_start(faers_cfg["schedule"]["end_quarter"])
    assert start <= end
