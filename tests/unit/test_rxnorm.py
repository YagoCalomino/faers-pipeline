"""faers_pipeline.rxnorm without network: a fake session serves real RxNav responses recorded in
tests/fixtures/rxnorm/responses.json (scripts/record_rxnav_responses.py), or scripted failures."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pyarrow.parquet as pq
import pytest
import requests

from faers_pipeline import rxnorm

REPO = Path(__file__).resolve().parents[2]
RECORDED = json.loads(
    (REPO / "tests" / "fixtures" / "rxnorm" / "responses.json").read_text(encoding="utf-8")
)
RULES = {"source": "RXNORM", "require_ingredient": True, "min_score": None}


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.sleeps.append(round(s, 6))
        self.now += s


class FakeResponse:
    def __init__(self, status=200, body=None, content=None, headers=None):
        self.status_code = status
        self.headers = headers or {}
        if content is None:
            content = b"" if body is None else json.dumps(body).encode()
        self.content = content

    def json(self):
        return json.loads(self.content)


class Killed(BaseException):
    """Stands for the task process being stopped (Docker down, task killed) mid-chunk."""


class FakeSession:
    """Serves recorded responses by path; `script` overrides with queued responses/exceptions;
    `kill_at` raises Killed on that call number (1-based)."""

    def __init__(self, script=None, kill_at=None):
        self.headers: dict = {}
        self.urls: list[str] = []
        self.script = list(script or [])
        self.kill_at = kill_at

    def get(self, url, timeout):
        self.urls.append(url)
        if self.kill_at is not None and len(self.urls) == self.kill_at:
            raise Killed()
        if self.script:
            item = self.script.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        path = url.removeprefix(RECORDED["base_url"])
        if path not in RECORDED["responses"]:
            raise AssertionError(f"no recorded response for {path}")
        return FakeResponse(body=RECORDED["responses"][path])


@pytest.fixture
def api_cfg(rx_cfg):
    return rx_cfg["api"]


@pytest.fixture(scope="session")
def rx_cfg():
    import yaml

    return yaml.safe_load((REPO / "config" / "rxnorm.yaml").read_text(encoding="utf-8"))


def make_client(api_cfg, script=None, rps=None, kill_at=None):
    clock = FakeClock()
    throttle = rxnorm.Throttle(rps or api_cfg["rate_limit_rps"], clock=clock, sleep=clock.sleep)
    session = FakeSession(script, kill_at)
    client = rxnorm.RxNavClient(api_cfg, session=session, throttle=throttle, sleep=clock.sleep)
    return client, session, clock


# --------------------------------------------------------------------------- throttle


def test_throttle_spaces_calls_by_one_over_rps():
    clock = FakeClock()
    t = rxnorm.Throttle(5, clock=clock, sleep=clock.sleep)
    starts = [t.wait() for _ in range(6)]
    assert starts == pytest.approx([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
    assert rxnorm.max_in_window(starts, 1.0) == 5


def test_client_never_exceeds_configured_rate(api_cfg):
    client, session, _ = make_client(api_cfg)
    for _ in range(20):
        client.get_json("version")
    s = client.stats.summary()
    assert s["calls"] == 20 and len(session.urls) == 20
    assert s["max_calls_in_any_1s"] <= api_cfg["rate_limit_rps"] == 5
    assert s["mean_rps"] == pytest.approx(5.0)


def test_global_throttle_is_shared_per_rate():
    assert rxnorm.global_throttle(5.0) is rxnorm.global_throttle(5.0)


def test_user_agent_is_set(api_cfg):
    _, session, _ = make_client(api_cfg)
    assert session.headers["User-Agent"] == api_cfg["user_agent"]


# --------------------------------------------------------------------------- retry


def test_retries_429_and_5xx_with_exponential_backoff(api_cfg):
    script = [FakeResponse(429), FakeResponse(503), FakeResponse(body={"version": "v"})]
    client, session, clock = make_client(api_cfg, script)
    assert client.get_json("version") == {"version": "v"}
    assert len(session.urls) == 3
    backoff = [s for s in clock.sleeps if s >= 1]  # throttle sleeps are 0.2 s
    assert backoff == [2.0, 4.0]
    assert client.stats.retries == 2 and client.stats.summary()["http_429"] == 1


def test_retry_after_header_is_honoured(api_cfg):
    script = [FakeResponse(429, headers={"Retry-After": "7"}), FakeResponse(body={"a": 1})]
    client, _, clock = make_client(api_cfg, script)
    client.get_json("version")
    assert 7.0 in clock.sleeps


def test_retries_timeouts_and_connection_errors(api_cfg):
    script = [requests.Timeout(), requests.ConnectionError(), FakeResponse(body={"a": 1})]
    client, _, _ = make_client(api_cfg, script)
    assert client.get_json("version") == {"a": 1}
    assert client.stats.outcomes["Timeout"] == 1
    assert client.stats.outcomes["ConnectionError"] == 1


def test_gives_up_after_max_attempts(api_cfg):
    n = api_cfg["retry"]["max_attempts"]
    client, session, clock = make_client(api_cfg, [FakeResponse(500)] * n)
    with pytest.raises(rxnorm.RxNavError, match=f"after {n} attempts"):
        client.get_json("version")
    assert len(session.urls) == n
    assert [s for s in clock.sleeps if s >= 1] == [2.0, 4.0, 8.0][: n - 1]


def test_other_4xx_is_not_retried(api_cfg):
    client, session, _ = make_client(api_cfg, [FakeResponse(404)])
    with pytest.raises(rxnorm.RxNavError, match="HTTP 404"):
        client.get_json("version")
    assert len(session.urls) == 1


def test_empty_body_is_retried_but_empty_result_is_not_found(api_cfg):
    script = [FakeResponse(200, content=b""), FakeResponse(200, content=b"  ")]
    client, session, _ = make_client(api_cfg, script)
    # Third call falls through to the recorded response: {"idGroup": {}} (nothing found).
    assert rxnorm.find_rxcuis(client, "find_exact", "REACTINE") == []
    assert client.stats.retries == 2 and len(session.urls) == 3


def test_terms_are_url_encoded(api_cfg):
    client, _, _ = make_client(api_cfg)
    url = client.url("find_exact", term="HYALURONIDASE (HUMAN RECOMBINANT)\\X&Y")
    assert url.endswith("name=HYALURONIDASE%20%28HUMAN%20RECOMBINANT%29%5CX%26Y&search=0")


# --------------------------------------------------------------------------- lookup


def lookup(api_cfg, term, rules=RULES):
    client, session, _ = make_client(api_cfg)
    stamp = {"rxnorm_version": "05-Oct-2026", "api_version": "3.1.356", "resolved_at": None}
    return rxnorm.lookup_term(client, term, rules, stamp, {}), session


def test_exact_match_of_an_ingredient(api_cfg):
    rows, session = lookup(api_cfg, "DUPILUMAB")
    assert [(r["status"], r["match_type"], r["ingredient_rxcui"]) for r in rows] == [
        ("matched", "exact", "1876376")
    ]
    assert len(session.urls) == 2  # exact search + related IN


def test_salt_resolves_to_reference_ingredient(api_cfg):
    rows, _ = lookup(api_cfg, "AMLODIPINE BESYLATE")
    assert [(r["rxcui"], r["ingredient_rxcui"], r["ingredient_name"]) for r in rows] == [
        ("104416", "17767", "amlodipine")
    ]


def test_approximate_keeps_only_rxnorm_source_and_records_score(api_cfg):
    rows, session = lookup(api_cfg, "REACTINE")
    assert {r["match_type"] for r in rows} == {"approximate"}
    assert {r["candidate_name"] for r in rows} == {"Bactine"}
    assert [r["approx_score"] for r in rows] == pytest.approx([7.68247127532959] * len(rows))
    assert all(r["status"] == "matched" and r["ingredient_rxcui"] for r in rows)
    # exact, normalized, approximate, related IN of the single rank-1 RXNORM candidate
    assert len(session.urls) == 4


def test_best_candidates_ignores_other_sources_and_worse_ranks():
    cands = [
        {"rxcui": "1", "rank": 1, "source": "MMSL", "score": 9.0},
        {"rxcui": "2", "rank": 2, "source": "RXNORM", "score": 8.0},
        {"rxcui": "3", "rank": 2, "source": "RXNORM", "score": 8.0},
        {"rxcui": "4", "rank": 3, "source": "RXNORM", "score": 7.0},
    ]
    assert [c["rxcui"] for c in rxnorm.best_candidates(cands, "RXNORM")] == ["2", "3"]
    assert rxnorm.best_candidates(cands[:1], "RXNORM") == []


def test_approximate_without_ingredient_is_not_found(api_cfg):
    script = [
        FakeResponse(body={"idGroup": {}}),
        FakeResponse(body={"idGroup": {}}),
        FakeResponse(
            body={
                "approximateGroup": {
                    "candidate": [{"rxcui": "9", "score": "8", "rank": "1", "source": "RXNORM"}]
                }
            }
        ),
        FakeResponse(body={"relatedGroup": {"conceptGroup": [{"tty": "IN"}]}}),
    ]
    client, _, _ = make_client(api_cfg, script)
    rows = rxnorm.lookup_term(client, "X", RULES, {}, {})
    assert [(r["status"], r["note"]) for r in rows] == [("not_found", "no_ingredient")]


def test_ambiguous_rxcuis_are_not_found(api_cfg):
    def related(rxcui, name):
        group = {"tty": "IN", "conceptProperties": [{"rxcui": rxcui, "name": name}]}
        return FakeResponse(body={"relatedGroup": {"conceptGroup": [group]}})

    script = [
        FakeResponse(body={"idGroup": {"rxnormId": ["1", "2"]}}),
        related("10", "a"),
        related("20", "b"),
    ]
    client, _, _ = make_client(api_cfg, script)
    rows = rxnorm.lookup_term(client, "X", RULES, {}, {})
    assert rows[0]["status"] == "not_found" and rows[0]["note"].startswith("ambiguous")


@pytest.mark.parametrize(
    ("score", "min_score", "accepted"),
    [(9.0, None, False), (None, 5.0, False), (4.99, 5.0, False), (5.0, 5.0, True), (9, 5, True)],
)
def test_score_policy_of_approximate_matches(score, min_score, accepted):
    assert rxnorm.is_approx_accepted(score, min_score) is accepted


def test_api_failures_become_error_rows_and_stop_after_a_streak(api_cfg):
    n = api_cfg["retry"]["max_attempts"]
    script = [FakeResponse(body={"version": "v", "apiVersion": "a"})] + [FakeResponse(503)] * n * 2
    client, _, _ = make_client(api_cfg, script)
    with pytest.raises(rxnorm.RxNavError, match="2 terms in a row") as exc:
        rxnorm.resolve_terms(client, ["A", "B", "C"], RULES, max_consecutive_errors=2)
    assert [(r["lookup_term"], r["status"]) for r in exc.value.rows] == [
        ("A", "error"),
        ("B", "error"),
    ]


# --------------------------------------------------------------------------- cache


def resolve_into_cache(api_cfg, terms, cache_dir):
    client, session, _ = make_client(api_cfg)
    pending, counters = rxnorm.pending_terms(terms, cache_dir)
    if pending:
        rows = rxnorm.resolve_terms(client, pending, RULES, max_consecutive_errors=5)
        rxnorm.write_pending(rows, cache_dir, "run", "chunk-0")
        rxnorm.merge_pending(cache_dir)
    return counters, len(session.urls)


def test_second_run_makes_no_calls_for_resolved_terms(api_cfg, tmp_path):
    terms = ["DUPILUMAB", "AMLODIPINE BESYLATE", "REACTINE"]
    first, calls1 = resolve_into_cache(api_cfg, terms, tmp_path)
    assert first["terms_to_lookup"] == 3 and calls1 > 0
    second, calls2 = resolve_into_cache(api_cfg, terms, tmp_path)
    assert second == {
        "terms_selected": 3,
        "cache_hits": 3,
        "terms_to_lookup": 0,
        "terms_in_error_before": 0,
    }
    assert calls2 == 0
    rows = rxnorm.read_rows(tmp_path / rxnorm.CACHE_FILE)
    assert {r["rxnorm_version"] for r in rows} == {"05-Oct-2026"}


def test_error_terms_are_looked_up_again_and_replaced(tmp_path):
    t0 = datetime(2026, 10, 1, tzinfo=UTC)
    err = dict.fromkeys(rxnorm.CACHE_SCHEMA.names)
    err.update(lookup_term="X", status="error", resolved_at=t0)
    rxnorm.write_parquet_atomic([err], tmp_path / rxnorm.CACHE_FILE, rxnorm.CACHE_SCHEMA)
    pending, counters = rxnorm.pending_terms(["X"], tmp_path)
    assert pending == ["X"] and counters["terms_in_error_before"] == 1

    ok = dict(err, status="not_found", resolved_at=t0 + timedelta(days=1))
    rxnorm.write_pending([ok], tmp_path, "run2", "chunk-0")
    assert rxnorm.pending_terms(["X"], tmp_path)[0] == []  # pending chunk counts before merge
    summary = rxnorm.merge_pending(tmp_path)
    assert summary["terms_by_status"] == {"not_found": 1}
    assert not list((tmp_path / rxnorm.PENDING_DIR).glob("*"))


def test_atomic_write_leaves_old_file_when_writing_fails(tmp_path, monkeypatch):
    path = tmp_path / "x.parquet"
    row = dict.fromkeys(rxnorm.CACHE_SCHEMA.names)
    row.update(lookup_term="OLD", status="matched")
    rxnorm.write_parquet_atomic([row], path, rxnorm.CACHE_SCHEMA)

    def broken(table, where, **kw):
        Path(where).write_bytes(b"partial")
        raise OSError("disk full")

    monkeypatch.setattr(pq, "write_table", broken)
    with pytest.raises(OSError):
        rxnorm.write_parquet_atomic([dict(row, lookup_term="NEW")], path, rxnorm.CACHE_SCHEMA)
    monkeypatch.undo()
    assert [r["lookup_term"] for r in rxnorm.read_rows(path)] == ["OLD"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["x.parquet", "x.parquet.tmp"]
    rxnorm.write_parquet_atomic([row], path, rxnorm.CACHE_SCHEMA)  # next write cleans up
    assert sorted(p.name for p in tmp_path.iterdir()) == ["x.parquet"]


# --------------------------------------------------------------------------- names and map


def test_split_name_uses_only_the_configured_separator(rx_cfg):
    sep = rx_cfg["lookup"]["combination_separator"]
    assert sep == "\\"
    assert rxnorm.split_name("CARBIDOPA\\LEVODOPA", sep) == ["CARBIDOPA", "LEVODOPA"]
    assert rxnorm.split_name("ESTROGENS, CONJUGATED", sep) == ["ESTROGENS, CONJUGATED"]
    assert rxnorm.split_name("A\\ A \\\\B", sep) == ["A", "B"]


def test_terms_ordered_by_lines_of_the_names_that_contain_them():
    names = [("B\\A", 10), ("A", 5), ("C", 12)]
    assert rxnorm.terms_by_frequency(names, "\\") == ["A", "C", "B"]


def test_select_names_top_and_seeded_random():
    names = [(str(i), 100 - i) for i in range(50)]
    assert rxnorm.select_names(names, 3, "top", 1) == names[:3]
    assert rxnorm.select_names(names, 5, "random", 7) == rxnorm.select_names(names, 5, "random", 7)
    assert rxnorm.select_names(names, None, "top", 1) == names


def cache_row(term, status, match_type=None, ing=None, score=None):
    r = dict.fromkeys(rxnorm.CACHE_SCHEMA.names)
    r.update(
        lookup_term=term,
        status=status,
        match_type=match_type,
        rxcui=ing[0] if ing else None,
        ingredient_rxcui=ing[0] if ing else None,
        ingredient_name=ing[1] if ing else None,
        approx_score=score,
        resolved_at=datetime(2026, 10, 26, tzinfo=UTC),
    )
    return r


def test_name_map_grain_fallback_and_approximate_threshold():
    # Synthetic ids (rx-*): this test checks the map logic, not RxNorm content.
    cache = [
        cache_row("LEUCOVORIN", "matched", "exact", ("rx-leu", "leucovorin")),
        cache_row("LEUCOVORIN CALCIUM", "matched", "normalized", ("rx-leu", "leucovorin")),
        cache_row("NIRMATRELVIR", "matched", "exact", ("rx-nir", "nirmatrelvir")),
        cache_row("RITONAVIR", "matched", "exact", ("rx-rit", "ritonavir")),
        cache_row("REACTINE", "matched", "approximate", ("rx-approx", "x"), score=7.68),
        cache_row("NOPE", "not_found"),
        cache_row("BROKEN", "error"),
    ]
    names = [
        "LEUCOVORIN\\LEUCOVORIN CALCIUM",
        "NIRMATRELVIR\\RITONAVIR",
        "NIRMATRELVIR\\NOPE",
        "REACTINE",
        "RITONAVIR\\BROKEN",
        "NEVER LOOKED UP",
    ]
    rows, summary = rxnorm.build_name_map(names, cache, "\\", min_score=None)
    got = {(r["drug_text_clean"], r["ingredient_rxcui"], r["match_type"]) for r in rows}
    assert got == {
        ("LEUCOVORIN\\LEUCOVORIN CALCIUM", "rx-leu", "exact"),
        ("NIRMATRELVIR\\RITONAVIR", "rx-nir", "exact"),
        ("NIRMATRELVIR\\RITONAVIR", "rx-rit", "exact"),
        ("NIRMATRELVIR\\NOPE", "rx-nir", "exact"),
        ("NIRMATRELVIR\\NOPE", "FB:NOPE", "fallback"),
        ("REACTINE", "FB:REACTINE", "fallback"),
    }
    assert len(got) == len(rows)  # unique on (drug_text_clean, ingredient_rxcui)
    by_name = {r["drug_text_clean"]: r["name_match_type"] for r in rows}
    assert by_name["NIRMATRELVIR\\NOPE"] == "fallback"
    assert summary["names_skipped_incomplete"] == 2

    rows, _ = rxnorm.build_name_map(["REACTINE"], cache, "\\", min_score=7.0)
    got = [(r["ingredient_rxcui"], r["match_type"]) for r in rows]
    assert got == [("rx-approx", "approx_accepted")]


def test_lake_names_use_the_dbt_cleaning_and_roles(tmp_path):
    import duckdb

    out = tmp_path / "raw" / "faers" / "drug" / "quarter=2026Q2"
    out.mkdir(parents=True)
    duckdb.sql(
        """select * from (values
             (' carbidopa\\levodopa ', 'PS'), ('CARBIDOPA\\LEVODOPA', 'ss'),
             ('Aspirin  81', 'PS'), ('ASPIRIN 81', 'C'), ('', 'PS'), (null, 'PS'))
           t(prod_ai, role_cod)"""
    ).write_parquet(str(out / "drug.parquet"))
    assert rxnorm.lake_names(tmp_path, ["PS", "SS"]) == [
        ("CARBIDOPA\\LEVODOPA", 2),
        ("ASPIRIN 81", 1),
    ]


# --------------------------------------------------------------------------- interruption

TERMS = ["DUPILUMAB", "AMLODIPINE BESYLATE", "REACTINE"]
# Recorded calls per term: version 1; DUPILUMAB 2; AMLODIPINE BESYLATE 2; REACTINE 4.


def chunk(api_cfg, cache_dir, flush_every, kill_at=None):
    client, session, _ = make_client(api_cfg, kill_at=kill_at)
    stats = rxnorm.run_chunk(client, TERMS, cache_dir, "run", 0, RULES, 5, flush_every)
    return stats, session


def test_interrupted_chunk_keeps_flushed_terms_and_retry_skips_them(api_cfg, tmp_path):
    # Killed on call 6: version + DUPILUMAB + AMLODIPINE done, REACTINE's first call dies.
    with pytest.raises(Killed):
        chunk(api_cfg, tmp_path, flush_every=1, kill_at=6)
    assert rxnorm.pending_terms(TERMS, tmp_path)[0] == ["REACTINE"]  # nothing merged yet
    assert not list(tmp_path.rglob("*.tmp"))

    stats, session = chunk(api_cfg, tmp_path, flush_every=1)  # Airflow retry of the chunk
    assert stats["skipped_already_known"] == 2 and stats["looked_up"] == 1
    assert len(session.urls) == 5  # version + REACTINE's 4 calls; no repeat of the other two
    assert rxnorm.merge_pending(tmp_path)["terms"] == 3
    rows = rxnorm.read_rows(tmp_path / rxnorm.CACHE_FILE)
    assert sorted({r["lookup_term"] for r in rows}) == sorted(TERMS)
    assert len(rows) == len({(r["lookup_term"], r["ingredient_rxcui"]) for r in rows})


def test_exception_mid_batch_still_writes_the_unflushed_terms(api_cfg, tmp_path):
    # flush_every larger than the chunk: only the finally-flush can save the two done terms.
    with pytest.raises(Killed):
        chunk(api_cfg, tmp_path, flush_every=100, kill_at=6)
    assert rxnorm.pending_terms(TERMS, tmp_path)[0] == ["REACTINE"]


def test_every_flush_is_a_separate_file_and_retries_never_overwrite(api_cfg, tmp_path):
    with pytest.raises(Killed):
        chunk(api_cfg, tmp_path, flush_every=1, kill_at=6)
    chunk(api_cfg, tmp_path, flush_every=1)
    names = [f.name for f in rxnorm.pending_files(tmp_path)]
    assert len(names) == 3 and len(set(names)) == 3
