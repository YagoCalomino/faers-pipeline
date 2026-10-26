"""Builds tests/fixtures/rxnorm_sample/term_lookup.jsonl: the rows of the real RxNorm cache for the
lookup terms of the FAERS fixture (tests/fixtures/faers_sample), so the dbt ci target has a real
name map without network calls.

    python -I scripts/make_rxnorm_fixture.py        (inside the container, after rxnorm_enrich)

Scope is the same as the DAG: cleaned prod_ai of the signal roles, split into terms. The script
fails if a term of the fixture is missing from the cache or is in error. Nothing is written to
data/; the test lake is built in a temporary folder.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import rxnorm  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402

OUT = REPO / "tests" / "fixtures" / "rxnorm_sample" / "term_lookup.jsonl"


def main() -> None:
    rx = load_config("rxnorm.yaml")
    roles = load_config("signals.yaml")["signal_drug_roles"]
    sep = rx["lookup"]["combination_separator"]
    with tempfile.TemporaryDirectory() as tmp:
        lake = Path(tmp) / "lake"
        subprocess.run(
            [
                sys.executable,
                "-I",
                str(REPO / "scripts" / "build_test_lake.py"),
                "--out",
                str(lake),
                "--no-rxnorm",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        names = rxnorm.lake_names(lake, roles)
    terms = set(rxnorm.terms_by_frequency(names, sep))
    cache = rxnorm.latest_by_term(rxnorm.read_rows(Path(rx["cache"]["path"]) / rxnorm.CACHE_FILE))
    missing = sorted(t for t in terms if t not in cache)
    errors = sorted(t for t in terms if t in cache and cache[t][0]["status"] == "error")
    if missing or errors:
        sys.exit(f"fixture terms not resolved in the cache: missing={missing} error={errors}")
    rows = [r for t in sorted(terms) for r in cache[t]]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        for r in rows:
            r = dict(r, resolved_at=r["resolved_at"].isoformat())
            fh.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"wrote {OUT}: {len(names)} names, {len(terms)} terms, {len(rows)} rows")


if __name__ == "__main__":
    main()
