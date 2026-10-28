"""Independent check of the expected values in the dbt test
dbt/faers_dbt/tests/assert_signal_statistics_known_values.sql.

The statistics are recomputed here in plain Python (math module only, no dbt, no DuckDB) from
the published formulas, with z from config/signals.yaml (ci_z), and compared with the literal
values of that test. dbt then checks its macros against the same literals, so the macros and
this module agree through them.

Run alone: python -I tests/unit/test_signal_known_values.py   (prints the recomputed rows)
"""

from __future__ import annotations

import math
import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
SQL = REPO / "dbt" / "faers_dbt" / "tests" / "assert_signal_statistics_known_values.sql"
COLUMNS = ("prr", "prr_lcl", "prr_ucl", "ror", "ror_lcl", "ror_ucl", "chi2")


def ci_z() -> float:
    cfg = yaml.safe_load((REPO / "config" / "signals.yaml").read_text(encoding="utf-8"))
    return float(cfg["ci_z"])


def statistics(a: int, b: int, c: int, d: int, z: float) -> dict[str, float | None]:
    """PRR and ROR with log-normal 95% intervals, and Pearson chi-square without continuity
    correction. A value is None where its formula divides by zero or takes the log of zero."""
    out: dict[str, float | None] = dict.fromkeys(COLUMNS)
    if a > 0 and c > 0:
        prr = (a / (a + b)) / (c / (c + d))
        se = math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
        out.update(
            prr=prr,
            prr_lcl=math.exp(math.log(prr) - z * se),
            prr_ucl=math.exp(math.log(prr) + z * se),
        )
    if min(a, b, c, d) > 0:
        ror = (a * d) / (b * c)
        se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
        out.update(
            ror=ror,
            ror_lcl=math.exp(math.log(ror) - z * se),
            ror_ucl=math.exp(math.log(ror) + z * se),
        )
    n = a + b + c + d
    denominator = (a + b) * (c + d) * (a + c) * (b + d)
    if denominator:
        out["chi2"] = n * (a * d - b * c) ** 2 / denominator
    return out


def literal_rows() -> list[tuple[tuple[int, int, int, int], dict[str, float | None]]]:
    """The (a, b, c, d) cells and expected values written in the dbt test's values block."""
    text = SQL.read_text(encoding="utf-8")
    block = re.search(r"with expected \([^)]*\) as \(\s*values(.*?)\n\),", text, re.S).group(1)
    rows = []
    for match in re.finditer(r"\(([^()]*)\)", block):
        fields = [f.strip() for f in match.group(1).split(",")]
        cells = tuple(int(f) for f in fields[:4])
        values = [None if f == "null" else float(f) for f in fields[4:]]
        rows.append((cells, dict(zip(COLUMNS, values, strict=True))))
    return rows


def test_known_values_match_an_independent_computation():
    rows = literal_rows()
    assert len(rows) == 6
    z = ci_z()
    for cells, expected in rows:
        got = statistics(*cells, z)
        for name in COLUMNS:
            want, have = expected[name], got[name]
            assert (want is None) == (have is None), (cells, name, want, have)
            if want is not None:
                assert math.isclose(have, want, rel_tol=1e-12, abs_tol=1e-12), (
                    cells,
                    name,
                    want,
                    have,
                )


if __name__ == "__main__":
    for cells, _ in literal_rows():
        print(cells, statistics(*cells, ci_z()))
