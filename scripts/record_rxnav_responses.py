"""Records real RxNav responses used as mocks by tests/unit/test_rxnorm.py (no network in tests).

    python -I scripts/record_rxnav_responses.py      (inside the container; makes ~10 calls)

Writes tests/fixtures/rxnorm/responses.json: {url_path_and_query: response_json}, plus the date
of the recording. Endpoints and rate come from config/rxnorm.yaml.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.rxnorm import RxNavClient  # noqa: E402

OUT = REPO / "tests" / "fixtures" / "rxnorm" / "responses.json"
# Real FAERS prod_ai terms: an IN (exact), a salt (PIN, exact), a salt with no exact string
# (normalized), and the approximate-match failure seen in the Phase 0 spike (REACTINE).
CALLS = [
    ("version", {}),
    ("find_exact", {"term": "DUPILUMAB"}),
    ("related_ingredients", {"rxcui": "1876376"}),
    ("find_exact", {"term": "AMLODIPINE BESYLATE"}),
    ("related_ingredients", {"rxcui": "104416"}),
    ("find_exact", {"term": "REACTINE"}),
    ("find_normalized", {"term": "REACTINE"}),
    ("approximate", {"term": "REACTINE"}),
]


def main() -> None:
    client = RxNavClient(load_config("rxnorm.yaml")["api"])
    recorded = {}
    for endpoint, values in CALLS:
        url = client.url(endpoint, **values)
        recorded[url.removeprefix(client.base)] = client.get_json(endpoint, **values)
    # Ingredients of the RXNORM approximate candidates (depends on the answer above).
    approx = recorded[client.url("approximate", term="REACTINE").removeprefix(client.base)]
    for cand in (approx.get("approximateGroup") or {}).get("candidate") or []:
        if cand.get("source") == "RXNORM":
            url = client.url("related_ingredients", rxcui=cand["rxcui"])
            key = url.removeprefix(client.base)
            if key not in recorded:
                recorded[key] = client.get_json("related_ingredients", rxcui=cand["rxcui"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "base_url": client.base,
        "responses": recorded,
    }
    OUT.write_text(json.dumps(doc, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(recorded)} responses, {client.stats.summary()['calls']} calls)")


if __name__ == "__main__":
    main()
