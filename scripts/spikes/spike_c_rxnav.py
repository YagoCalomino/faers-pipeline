"""Spike C: resolves the top FAERS prod_ai names to RxNorm ingredients via the RxNav REST API.

Run inside the container (after spike A, which writes top_prod_ai.json):
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/spikes/spike_c_rxnav.py --quarter 2026Q2

Calls are serial and throttled. Documented limit (checked 2026-10-23):
"no more than 20 requests per second per IP address"
https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html  -> default here is 2 req/s.

Endpoints (https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html):
  findRxcuiByString   /rxcui.json?name=..&search=2   (exact, then normalized)
  getApproximateMatch /approximateTerm.json?term=..&maxEntries=..
  getRxConceptProperties /rxcui/{rxcui}/properties.json
  getRelatedByType    /rxcui/{rxcui}/related.json?tty=IN

Per name: name search; approximate search only if the first returns nothing; then the
ingredient (IN) of the chosen RxCUI. Optional --extra-drugnames adds the most frequent
drugname values whose prod_ai is empty (the plan's fallback key), to see harder cases.
Writes data/spikes/<quarter>/spike_c.json.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c
import duckdb
import requests

from faers_pipeline.config import load_config

RX = load_config("rxnorm.yaml")["api"]


class Client:
    def __init__(self, rps: float):
        self.base = RX["base_url"].rstrip("/")
        self.timeout = RX["request_timeout_s"]
        self.min_interval = 1.0 / rps
        self.last = 0.0
        self.session = requests.Session()
        self.session.headers["User-Agent"] = RX["user_agent"]
        self.calls: list[dict] = []

    def get(self, path: str, params: dict | None = None) -> dict | None:
        wait = self.min_interval - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        t0 = time.perf_counter()
        status, body, err = None, None, None
        try:
            r = self.session.get(f"{self.base}{path}", params=params, timeout=self.timeout)
            status = r.status_code
            if r.ok:
                body = r.json()
        except (requests.RequestException, ValueError) as exc:
            err = type(exc).__name__
        ms = (time.perf_counter() - t0) * 1000
        self.calls.append(
            {"path": path.split("?")[0], "status": status, "ms": round(ms, 1), "error": err}
        )
        return body


def resolve(cl: Client, name: str) -> dict:
    out: dict = {"name": name}
    body = cl.get("/rxcui.json", {"name": name, "search": 2}) or {}
    ids = (body.get("idGroup") or {}).get("rxnormId") or []
    out["name_search_rxcuis"] = ids
    rxcui = ids[0] if ids else None
    out["match_type"] = "name" if rxcui else None
    if not rxcui:
        body = cl.get("/approximateTerm.json", {"term": name, "maxEntries": 5}) or {}
        cands = (body.get("approximateGroup") or {}).get("candidate") or []
        out["approx_candidates"] = [
            {k: cand.get(k) for k in ("rxcui", "score", "rank", "name", "source")}
            for cand in cands[:5]
        ]
        rxnorm_cands = [x for x in cands if x.get("source") == "RXNORM"] or cands
        if rxnorm_cands:
            rxcui = rxnorm_cands[0]["rxcui"]
            out["match_type"] = "approximate"
    if not rxcui:
        out["match_type"] = "not_found"
        return out
    out["rxcui"] = rxcui
    props = (cl.get(f"/rxcui/{rxcui}/properties.json") or {}).get("properties") or {}
    out["rxcui_name"], out["rxcui_tty"] = props.get("name"), props.get("tty")
    if props.get("tty") == "IN":
        out["ingredients"] = [{"rxcui": rxcui, "name": props.get("name")}]
    else:
        rel = cl.get(f"/rxcui/{rxcui}/related.json", {"tty": "IN"}) or {}
        groups = (rel.get("relatedGroup") or {}).get("conceptGroup") or []
        out["ingredients"] = [
            {"rxcui": p["rxcui"], "name": p["name"]}
            for g in groups
            for p in g.get("conceptProperties") or []
        ]
    if not out["ingredients"]:
        out["match_type"] += "_no_ingredient"
    return out


def doubtful(r: dict) -> str | None:
    """Heuristic flags for manual review (not a correctness verdict)."""
    if r["match_type"] == "not_found":
        return "no match"
    if r["match_type"].endswith("_no_ingredient"):
        return "rxcui found but no IN related"
    ings = [i["name"].upper() for i in r.get("ingredients", [])]
    if len(ings) > 1:
        return f"multiple IN: {ings}"
    if r["match_type"] == "approximate":
        return "approximate match"
    first = r["name"].split()[0].split("-")[0]
    if ings and first not in ings[0]:
        return f"ingredient {ings[0]!r} does not contain {first!r}"
    return None


def extra_drugnames(quarter: str, n: int) -> list[str]:
    pq = c.SPIKES_OUT / quarter / "parquet" / "drug.parquet"
    con = duckdb.connect()
    try:
        rows = con.execute(
            "SELECT regexp_replace(upper(trim(drugname)), '\\s+', ' ', 'g') k, count(*) n "
            f"FROM read_parquet('{pq}') WHERE prod_ai IS NULL OR trim(prod_ai) = '' "
            f"GROUP BY 1 ORDER BY n DESC, k LIMIT {n}"
        ).fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, max(0, round(p / 100 * len(s)) - 1))]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="2026Q2")
    ap.add_argument("--rps", type=float, default=2.0)
    ap.add_argument("--extra-drugnames", type=int, default=10)
    args = ap.parse_args()

    top = json.loads((c.SPIKES_OUT / args.quarter / "top_prod_ai.json").read_text())["top"]
    cl = Client(args.rps)
    t0 = time.perf_counter()
    results = []
    for item in top:
        r = resolve(cl, item["name"])
        r["source"], r["faers_rows"] = "prod_ai", item["rows"]
        results.append(r)
    for name in extra_drugnames(args.quarter, args.extra_drugnames) if args.extra_drugnames else []:
        r = resolve(cl, name)
        r["source"] = "drugname_without_prod_ai"
        results.append(r)
    for r in results:
        r["flag"] = doubtful(r)

    ms = [x["ms"] for x in cl.calls]
    statuses: dict[str, int] = {}
    for x in cl.calls:
        key = str(x["status"]) if x["status"] else f"error:{x['error']}"
        statuses[key] = statuses.get(key, 0) + 1

    def rate(src: str) -> dict:
        rs = [r for r in results if r["source"] == src]
        ok = [r for r in rs if r.get("ingredients")]
        return {
            "names": len(rs),
            "with_ingredient": len(ok),
            "by_match_type": {
                t: sum(1 for r in rs if r["match_type"] == t) for t in {r["match_type"] for r in rs}
            },
        }

    report = {
        "quarter": args.quarter,
        "base_url": cl.base,
        "rps_cap": args.rps,
        "wall_seconds": round(time.perf_counter() - t0, 1),
        "calls": len(cl.calls),
        "http_status": statuses,
        "latency_ms": {
            "mean": round(statistics.mean(ms), 1),
            "p50": round(statistics.median(ms), 1),
            "p95": round(pct(ms, 95), 1),
            "max": round(max(ms), 1),
        },
        "match": {s: rate(s) for s in ("prod_ai", "drugname_without_prod_ai")},
        "results": results,
        "call_log": cl.calls,
    }
    path = c.SPIKES_OUT / args.quarter / "spike_c.json"
    c.write_json(report, path)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
