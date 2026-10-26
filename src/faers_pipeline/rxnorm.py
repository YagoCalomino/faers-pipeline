"""RxNorm enrichment: RxNav REST client, term lookup, Parquet cache and the name map.

Unit of lookup: a *term*, one part of a cleaned FAERS prod_ai split on the combination separator
(config/rxnorm.yaml lookup.combination_separator). Per term, in order:
  1. findRxcuiByString search=0 (exact)       -> match_type exact
  2. findRxcuiByString search=1 (normalized)  -> match_type normalized
  3. getApproximateMatch                      -> match_type approximate (accepted later, by score)
The RxCUI found is resolved to its ingredients (getRelatedByType tty=IN), so salts, precise
ingredients and brands collapse to the reference ingredient.

Cache (term_lookup.parquet): one row per (lookup_term, ingredient_rxcui); not_found and error
terms have one row without ingredient. matched and not_found are never looked up again; error is.
The name map (name_map.parquet) is rebuilt from the cache without API calls: one row per
(drug_text_clean, ingredient_rxcui), with match_type exact, normalized, approx_accepted or
fallback.
"""

from __future__ import annotations

import logging
import os
import random
import threading
import time
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import requests

log = logging.getLogger(__name__)

RESOLVED_STATUSES = frozenset({"matched", "not_found"})  # never looked up again
CACHE_FILE = "term_lookup.parquet"
NAME_MAP_FILE = "name_map.parquet"
PENDING_DIR = "_pending"
FALLBACK_PREFIX = "FB:"
# Weakest layer of a combination decides its name-level match type.
LAYER_RANK = {"exact": 0, "normalized": 1, "approx_accepted": 2, "fallback": 3}

CACHE_SCHEMA = pa.schema(
    [
        ("lookup_term", pa.string()),
        ("status", pa.string()),  # matched | not_found | error
        ("match_type", pa.string()),  # exact | normalized | approximate | null
        ("rxcui", pa.string()),  # concept found for the term
        ("candidate_name", pa.string()),  # approximate candidate name (audit)
        ("ingredient_rxcui", pa.string()),
        ("ingredient_name", pa.string()),
        ("approx_score", pa.float64()),
        ("approx_rank", pa.int32()),
        ("n_rxcuis", pa.int32()),  # concepts returned for the term
        ("note", pa.string()),  # why not_found / error
        ("rxnorm_version", pa.string()),
        ("api_version", pa.string()),
        ("resolved_at", pa.timestamp("us", tz="UTC")),
    ]
)

NAME_MAP_SCHEMA = pa.schema(
    [
        ("drug_text_clean", pa.string()),
        ("ingredient_rxcui", pa.string()),  # RxCUI of the IN, or FB:<term> for fallback
        ("ingredient_name", pa.string()),
        ("match_type", pa.string()),  # exact | normalized | approx_accepted | fallback
        ("lookup_term", pa.string()),  # part of the name that produced this ingredient
        ("rxcui", pa.string()),
        ("approx_score", pa.float64()),
        ("n_parts", pa.int32()),
        ("name_match_type", pa.string()),  # weakest match_type among the parts of the name
        ("rxnorm_version", pa.string()),
        ("resolved_at", pa.timestamp("us", tz="UTC")),
        ("built_at", pa.timestamp("us", tz="UTC")),
    ]
)


class RxNavError(Exception):
    """A request failed for good (retries exhausted or a non-retryable status)."""


# --------------------------------------------------------------------------- throttle


class Throttle:
    """Spaces calls at least 1/rps seconds apart. Thread-safe; one instance per process."""

    def __init__(
        self,
        rps: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if rps <= 0:
            raise ValueError("rps must be > 0")
        self.min_interval = 1.0 / rps
        self._clock, self._sleep = clock, sleep
        self._next = None
        self._lock = threading.Lock()

    def wait(self) -> float:
        """Blocks until the next call is allowed; returns the time the call may start."""
        with self._lock:
            now = self._clock()
            if self._next is not None and now < self._next:
                self._sleep(self._next - now)
                now = self._next
            self._next = now + self.min_interval
            return now


_THROTTLES: dict[float, Throttle] = {}
_THROTTLES_LOCK = threading.Lock()


def global_throttle(rps: float) -> Throttle:
    """The process-wide throttle for this rate (every client in the process shares it)."""
    with _THROTTLES_LOCK:
        if rps not in _THROTTLES:
            _THROTTLES[rps] = Throttle(rps)
        return _THROTTLES[rps]


# --------------------------------------------------------------------------- client


@dataclass
class CallStats:
    calls: Counter = field(default_factory=Counter)  # per endpoint
    outcomes: Counter = field(default_factory=Counter)  # HTTP status or exception name
    retries: int = 0
    started: list[float] = field(default_factory=list)  # throttle times of every request

    def summary(self) -> dict:
        n = len(self.started)
        span = self.started[-1] - self.started[0] if n > 1 else 0.0
        return {
            "calls": n,
            "calls_by_endpoint": dict(self.calls),
            "outcomes": {str(k): v for k, v in self.outcomes.items()},
            "retries": self.retries,
            "http_429": self.outcomes.get(429, 0),
            "span_s": round(span, 1),
            "mean_rps": round((n - 1) / span, 2) if span > 0 else None,
            "max_calls_in_any_1s": max_in_window(self.started, 1.0),
        }


def max_in_window(times: list[float], window: float) -> int:
    """Largest number of request start times inside any half-open window of this length
    (1 microsecond of tolerance, so 5 starts exactly 0.2 s apart count as 5 per second)."""
    best, lo = 0, 0
    for hi, t in enumerate(times):
        while t - times[lo] >= window - 1e-6:
            lo += 1
        best = max(best, hi - lo + 1)
    return best


class RxNavClient:
    def __init__(
        self,
        api_cfg: dict,
        session: requests.Session | None = None,
        throttle: Throttle | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.base = api_cfg["base_url"].rstrip("/")
        self.endpoints = api_cfg["endpoints"]
        self.timeout = api_cfg["request_timeout_s"]
        retry = api_cfg["retry"]
        self.max_attempts = int(retry["max_attempts"])
        self.backoff_initial = float(retry["backoff_initial_s"])
        self.backoff_multiplier = float(retry["backoff_multiplier"])
        self.retry_on_status = set(retry["retry_on_status"])
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = api_cfg["user_agent"]
        self.throttle = throttle or global_throttle(float(api_cfg["rate_limit_rps"]))
        self._sleep = sleep
        self.stats = CallStats()

    def url(self, endpoint: str, **values: object) -> str:
        quoted = {k: quote(str(v), safe="") for k, v in values.items()}
        return self.base + self.endpoints[endpoint].format(**quoted)

    def get_json(self, endpoint: str, **values: object) -> dict:
        """GET with throttle and retries (429, 5xx, timeouts, connection errors, empty body).

        A 200 whose JSON has no result (e.g. {"idGroup": {}}) is a valid "nothing found";
        a 200 with an empty or non-JSON body is treated as a failure and retried.
        """
        url = self.url(endpoint, **values)
        delay = self.backoff_initial
        for attempt in range(1, self.max_attempts + 1):
            self.stats.started.append(self.throttle.wait())
            self.stats.calls[endpoint] += 1
            retry_after = None
            try:
                r = self.session.get(url, timeout=self.timeout)
            except (requests.Timeout, requests.ConnectionError) as exc:
                reason = type(exc).__name__
                self.stats.outcomes[reason] += 1
            else:
                self.stats.outcomes[r.status_code] += 1
                if r.status_code == 200:
                    if not (r.content or b"").strip():
                        reason = "empty_body"
                    else:
                        try:
                            body = r.json()
                        except ValueError:
                            reason = "invalid_json"
                        else:
                            if isinstance(body, dict):
                                return body
                            reason = "unexpected_json"
                elif r.status_code in self.retry_on_status:
                    reason = f"http_{r.status_code}"
                    retry_after = _retry_after_s(r)
                else:
                    raise RxNavError(f"{endpoint}: HTTP {r.status_code} for {url}")
            if attempt == self.max_attempts:
                raise RxNavError(f"{endpoint}: {reason} after {attempt} attempts ({url})")
            wait = max(delay, retry_after or 0.0)
            log.warning(
                "RxNav %s: %s, retry %d/%d in %.1f s",
                endpoint,
                reason,
                attempt,
                self.max_attempts - 1,
                wait,
            )
            self.stats.retries += 1
            self._sleep(wait)
            delay *= self.backoff_multiplier
        raise AssertionError("unreachable")

    def version(self) -> tuple[str | None, str | None]:
        body = self.get_json("version")
        return body.get("version"), body.get("apiVersion")


def _retry_after_s(r: requests.Response) -> float | None:
    value = r.headers.get("Retry-After") if r.headers else None
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


# --------------------------------------------------------------------------- lookup


def find_rxcuis(client: RxNavClient, endpoint: str, term: str) -> list[str]:
    body = client.get_json(endpoint, term=term)
    return list((body.get("idGroup") or {}).get("rxnormId") or [])


def ingredients_of(client: RxNavClient, rxcui: str, memo: dict) -> list[tuple[str, str]]:
    """(rxcui, name) of the INs related to an RxCUI, sorted. Memoized per run."""
    if rxcui not in memo:
        body = client.get_json("related_ingredients", rxcui=rxcui)
        groups = (body.get("relatedGroup") or {}).get("conceptGroup") or []
        memo[rxcui] = sorted(
            {
                (p["rxcui"], p["name"])
                for g in groups
                if g.get("tty") == "IN"
                for p in g.get("conceptProperties") or []
            }
        )
    return memo[rxcui]


def approximate_candidates(client: RxNavClient, term: str) -> list[dict]:
    body = client.get_json("approximate", term=term)
    out = []
    for c in (body.get("approximateGroup") or {}).get("candidate") or []:
        try:
            score, rank = float(c.get("score")), int(c.get("rank"))
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "rxcui": c.get("rxcui"),
                "score": score,
                "rank": rank,
                "name": c.get("name"),
                "source": c.get("source"),
            }
        )
    return out


def best_candidates(candidates: list[dict], source: str) -> list[dict]:
    """Candidates of the required source with the best (lowest) rank, in API order."""
    usable = [c for c in candidates if c.get("source") == source and c.get("rxcui")]
    if not usable:
        return []
    top = min(c["rank"] for c in usable)
    return [c for c in usable if c["rank"] == top]


def is_approx_accepted(score: float | None, min_score: float | None) -> bool:
    """Score part of the approximate-match policy. No calibrated threshold -> never accepted."""
    if min_score is None or score is None:
        return False
    return score >= float(min_score)


def _row(term: str, stamp: dict, **values) -> dict:
    row = dict.fromkeys(CACHE_SCHEMA.names)
    row.update(lookup_term=term, **stamp, **values)
    return row


def _rows_for_ids(
    client, term, ids, match_type, stamp, memo, require_ingredient, **extra
) -> list[dict]:
    """Rows for the RxCUIs found for a term; several RxCUIs must agree on the ingredients."""
    sets = {i: ingredients_of(client, i, memo) for i in dict.fromkeys(ids)}
    distinct = {tuple(s) for s in sets.values()}
    common = dict(match_type=match_type, rxcui=ids[0], n_rxcuis=len(sets), **extra)
    if len(distinct) > 1:
        note = f"ambiguous: {len(sets)} rxcuis with different ingredients"
        return [_row(term, stamp, status="not_found", note=note, **common)]
    ings = next(iter(distinct))
    if not ings and require_ingredient:
        return [_row(term, stamp, status="not_found", note="no_ingredient", **common)]
    return [
        _row(term, stamp, status="matched", ingredient_rxcui=r, ingredient_name=n, **common)
        for r, n in ings
    ]


def lookup_term(client: RxNavClient, term: str, rules: dict, stamp: dict, memo: dict) -> list:
    """Cache rows for one term (see module docstring). Raises RxNavError on API failure."""
    for match_type, endpoint in (("exact", "find_exact"), ("normalized", "find_normalized")):
        ids = find_rxcuis(client, endpoint, term)
        if ids:
            return _rows_for_ids(client, term, ids, match_type, stamp, memo, True)
    candidates = approximate_candidates(client, term)
    best = best_candidates(candidates, rules["source"])
    if not best:
        note = "no_rxnorm_candidate" if candidates else "no_candidate"
        return [_row(term, stamp, status="not_found", note=note)]
    ids = [c["rxcui"] for c in best]
    return _rows_for_ids(
        client,
        term,
        ids,
        "approximate",
        stamp,
        memo,
        bool(rules.get("require_ingredient", True)),
        candidate_name=best[0]["name"],
        approx_score=best[0]["score"],
        approx_rank=best[0]["rank"],
    )


def resolve_terms(
    client: RxNavClient,
    terms: Iterable[str],
    rules: dict,
    max_consecutive_errors: int,
    progress_every: int = 50,
    flush: Callable[[list[dict]], None] | None = None,
    flush_every: int = 25,
) -> list[dict]:
    """Looks up every term; API failures become status=error rows (looked up again next run).

    With `flush`, the rows of every `flush_every` terms are handed to it as soon as they are
    resolved, and once more (the remainder) on any exit, including an exception or a task kill
    that Python can still handle (SIGTERM). A hard kill loses at most `flush_every` terms.
    Raises RxNavError after max_consecutive_errors failing terms in a row; the rows resolved so
    far are attached to the exception as .rows.
    """
    version, api_version = client.version()
    rows: list[dict] = []
    batch: list[dict] = []
    batch_terms = 0
    memo: dict = {}
    streak = 0
    terms = list(terms)
    try:
        for i, term in enumerate(terms, 1):
            stamp = {
                "rxnorm_version": version,
                "api_version": api_version,
                "resolved_at": datetime.now(UTC),
            }
            try:
                new = lookup_term(client, term, rules, stamp, memo)
                streak = 0
            except RxNavError as exc:
                log.error("RxNav lookup failed for %r: %s", term, exc)
                new = [_row(term, stamp, status="error", note=str(exc)[:500])]
                streak += 1
                if streak >= max_consecutive_errors:
                    rows += new
                    batch += new
                    err = RxNavError(f"{streak} terms in a row failed; last: {exc}")
                    err.rows = rows
                    raise err from exc
            rows += new
            batch += new
            batch_terms += 1
            if flush is not None and batch_terms >= flush_every:
                flush(batch)
                batch, batch_terms = [], 0
            if i % progress_every == 0 or i == len(terms):
                n_calls = len(client.stats.started)
                log.info("RxNav progress: %d/%d terms, %d calls", i, len(terms), n_calls)
    finally:
        if flush is not None and batch:
            flush(batch)
    return rows


def run_chunk(
    client: RxNavClient,
    terms: Iterable[str],
    cache_dir: Path,
    run_key: str,
    chunk: int,
    rules: dict,
    max_consecutive_errors: int,
    flush_every: int,
) -> dict:
    """One mapped chunk: skips terms already known (cache or results written by an earlier,
    interrupted try), looks up the rest and writes them to cache/_pending every flush_every
    terms. Every written file is atomic and has a unique name, so a retry never overwrites."""
    terms = list(terms)
    todo, counters = pending_terms(terms, cache_dir)
    token = f"{datetime.now(UTC):%Y%m%dT%H%M%S%f}"
    parts = []

    def flush(batch: list[dict]) -> None:
        parts.append(
            write_pending(batch, cache_dir, run_key, f"chunk-{chunk:05d}-{token}-{len(parts):04d}")
        )

    rows = (
        resolve_terms(
            client, todo, rules, max_consecutive_errors, flush=flush, flush_every=flush_every
        )
        if todo
        else []
    )
    statuses = Counter(rs[0]["status"] for rs in latest_by_term(rows).values())
    return {
        "chunk": chunk,
        "terms": len(terms),
        "skipped_already_known": counters["cache_hits"],
        "looked_up": len(todo),
        "terms_by_status": dict(statuses),
        "files_written": len(parts),
        **client.stats.summary(),
    }


# --------------------------------------------------------------------------- Parquet I/O


def write_parquet_atomic(rows: list[dict], path: Path, schema: pa.Schema) -> Path:
    """Writes to <path>.tmp, then os.replace: readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), tmp, compression="zstd")
    os.replace(tmp, path)
    return path


def read_rows(path: Path) -> list[dict]:
    return pq.read_table(path).to_pylist() if path.exists() else []


def pending_files(cache_dir: Path) -> list[Path]:
    return sorted((cache_dir / PENDING_DIR).glob("*/*.parquet"))


def latest_by_term(rows: Iterable[dict]) -> dict[str, list[dict]]:
    """Rows grouped by term, keeping only the latest lookup (resolved_at) of each term."""
    latest: dict[str, list[dict]] = {}
    for r in rows:
        cur = latest.get(r["lookup_term"])
        if cur is None or r["resolved_at"] > cur[0]["resolved_at"]:
            latest[r["lookup_term"]] = [r]
        elif r["resolved_at"] == cur[0]["resolved_at"]:
            cur.append(r)
    return latest


def known_terms(cache_dir: Path) -> dict[str, str]:
    """term -> status, from the cache file and any chunk results not merged yet."""
    rows = read_rows(cache_dir / CACHE_FILE)
    for f in pending_files(cache_dir):
        rows += read_rows(f)
    return {t: rs[0]["status"] for t, rs in latest_by_term(rows).items()}


def pending_terms(terms: Iterable[str], cache_dir: Path) -> tuple[list[str], dict]:
    """Terms still to look up (never looked up, or last lookup in error), and counters."""
    terms = list(terms)
    known = known_terms(cache_dir)
    pending = [t for t in terms if known.get(t) not in RESOLVED_STATUSES]
    counters = {
        "terms_selected": len(terms),
        "cache_hits": len(terms) - len(pending),
        "terms_to_lookup": len(pending),
        "terms_in_error_before": sum(1 for t in terms if known.get(t) == "error"),
    }
    return pending, counters


def write_pending(rows: list[dict], cache_dir: Path, run_key: str, name: str) -> Path:
    """Atomic results file under cache/_pending/<run_key>/; counted as cached before the merge."""
    path = cache_dir / PENDING_DIR / run_key / f"{name}.parquet"
    return write_parquet_atomic(rows, path, CACHE_SCHEMA)


def merge_pending(cache_dir: Path) -> dict:
    """Folds every pending chunk file into term_lookup.parquet (latest lookup per term wins)."""
    files = pending_files(cache_dir)
    cache_path = cache_dir / CACHE_FILE
    before = read_rows(cache_path)
    rows = list(before)
    for f in files:
        rows += read_rows(f)
    merged = [r for rs in latest_by_term(rows).values() for r in rs]
    merged.sort(key=lambda r: (r["lookup_term"], r["ingredient_rxcui"] or ""))
    if files or not cache_path.exists():
        write_parquet_atomic(merged, cache_path, CACHE_SCHEMA)
    for f in files:
        f.unlink()
    for d in sorted((cache_dir / PENDING_DIR).glob("*")):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    terms = latest_by_term(merged)
    return {
        "pending_files": len(files),
        "rows_before": len(before),
        "rows_after": len(merged),
        "terms": len(terms),
        "terms_by_status": dict(Counter(rs[0]["status"] for rs in terms.values())),
    }


# --------------------------------------------------------------------------- names and scope

# Same expression as the dbt macro clean_text (upper, trim, inner whitespace collapsed).
CLEAN_SQL = "nullif(regexp_replace(upper(trim({col})), '\\s+', ' ', 'g'), '')"


def lake_names(lake: Path, roles: list[str]) -> list[tuple[str, int]]:
    """(cleaned prod_ai, DRUG lines) for the given roles over every quarter of the lake, most
    frequent first. Reads raw Parquet: superseded case versions are included."""
    glob = (lake / "raw" / "faers" / "drug" / "quarter=*" / "drug.parquet").as_posix()
    role_list = ", ".join("'" + r.replace("'", "''") + "'" for r in roles)
    name = CLEAN_SQL.format(col="prod_ai")
    con = duckdb.connect()
    try:
        return con.execute(
            f"""
            select {name} as name, count(*) as n
            from read_parquet('{glob.replace("'", "''")}', hive_partitioning = true)
            where upper(trim(role_cod)) in ({role_list}) and {name} is not null
            group by 1 order by n desc, name
            """
        ).fetchall()
    finally:
        con.close()


def split_name(name: str, separator: str) -> list[str]:
    """Combination parts of a cleaned name, trimmed, empty parts dropped, order kept."""
    return list(dict.fromkeys(p.strip() for p in name.split(separator) if p.strip()))


def select_names(
    names: list[tuple[str, int]], max_names: int | None, selection: str, seed: int
) -> list[tuple[str, int]]:
    """'top': the most frequent max_names; 'random': a seeded sample of max_names."""
    if max_names is None or max_names >= len(names):
        return list(names)
    if selection == "top":
        return list(names[:max_names])
    if selection == "random":
        picked = random.Random(seed).sample(range(len(names)), max_names)
        return [names[i] for i in sorted(picked)]
    raise ValueError(f"selection must be 'top' or 'random', got {selection!r}")


def terms_by_frequency(names: list[tuple[str, int]], separator: str) -> list[str]:
    """Distinct parts of the names, ordered by the lines of the names that contain them."""
    lines: Counter = Counter()
    for name, n in names:
        for part in split_name(name, separator):
            lines[part] += n
    return [t for t, _ in sorted(lines.items(), key=lambda kv: (-kv[1], kv[0]))]


def chunked(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


# --------------------------------------------------------------------------- name map


def build_name_map(
    names: Iterable[str], cache_rows: list[dict], separator: str, min_score: float | None
) -> tuple[list[dict], dict]:
    """Name map rows (grain: drug_text_clean, ingredient_rxcui) and a summary.

    A name enters the map only when every part has a resolved lookup (matched or not_found);
    names with a part not looked up yet, or in error, are left out and fall back in dbt.
    Unresolved parts become a fallback ingredient FB:<part>.
    """
    by_term = latest_by_term(cache_rows)
    built_at = datetime.now(UTC)
    out: list[dict] = []
    skipped = 0
    for name in names:
        parts = split_name(name, separator)
        if any(p not in by_term or by_term[p][0]["status"] not in RESOLVED_STATUSES for p in parts):
            skipped += 1
            continue
        rows: dict[str, dict] = {}
        layers = []
        for part in parts:
            term_rows = by_term[part]
            first = term_rows[0]
            layer = "fallback"
            if first["status"] == "matched" and first["match_type"] in ("exact", "normalized"):
                layer = first["match_type"]
            elif (
                first["status"] == "matched"
                and first["match_type"] == "approximate"
                and is_approx_accepted(first["approx_score"], min_score)
            ):
                layer = "approx_accepted"
            layers.append(layer)
            if layer == "fallback":
                candidates = [
                    {
                        "ingredient_rxcui": FALLBACK_PREFIX + part,
                        "ingredient_name": part,
                        "rxcui": None,
                        **_lineage(first),
                    }
                ]
            else:
                candidates = [
                    {
                        "ingredient_rxcui": r["ingredient_rxcui"],
                        "ingredient_name": r["ingredient_name"],
                        "rxcui": r["rxcui"],
                        **_lineage(r),
                    }
                    for r in term_rows
                ]
            for c in candidates:
                c.update(match_type=layer, lookup_term=part)
                prev = rows.get(c["ingredient_rxcui"])
                # Two parts with the same ingredient (e.g. a salt and its base): keep the
                # strongest layer, then the first part.
                if prev is None or LAYER_RANK[layer] < LAYER_RANK[prev["match_type"]]:
                    rows[c["ingredient_rxcui"]] = c
        name_layer = max(layers, key=LAYER_RANK.__getitem__)
        for c in rows.values():
            out.append(
                {
                    "drug_text_clean": name,
                    "n_parts": len(parts),
                    "name_match_type": name_layer,
                    "built_at": built_at,
                    **c,
                }
            )
    summary = {
        "names_in_map": len({r["drug_text_clean"] for r in out}),
        "names_skipped_incomplete": skipped,
        "rows": len(out),
        "names_by_match_type": dict(
            Counter(r["name_match_type"] for r in {r["drug_text_clean"]: r for r in out}.values())
        ),
    }
    return out, summary


def _lineage(r: dict) -> dict:
    return {
        "approx_score": r["approx_score"],
        "rxnorm_version": r["rxnorm_version"],
        "resolved_at": r["resolved_at"],
    }
