"""DAG 2: RxNorm enrichment of FAERS drug names (cache in Parquet, no DuckDB writes).

Triggered by the FAERS raw Asset. Lists the cleaned prod_ai names of the signal roles in the lake,
splits combinations into terms, looks up only the terms not resolved in the cache (mapped chunks
in the rxnorm_api pool, 1 slot, client throttle from config/rxnorm.yaml), merges the chunk results
into the cache and rebuilds the name map, which is published as an Asset.
"""

from __future__ import annotations

from pathlib import Path

import pendulum
from airflow.sdk import Asset, Param, TriggerRule, dag, get_current_context, task

from faers_pipeline import rxnorm
from faers_pipeline.callbacks import on_task_failure
from faers_pipeline.config import load_config

CFG = load_config("faers.yaml")
RX = load_config("rxnorm.yaml")
SIGNALS = load_config("signals.yaml")

RAW_ASSET = Asset("faers_raw_parquet")
RXNORM_ASSET = Asset("rxnorm_name_map")

LAKE = Path(CFG["paths"]["lake"])
CACHE_DIR = Path(RX["cache"]["path"])
NAME_MAP = Path(RX["name_map"]["path"]) / rxnorm.NAME_MAP_FILE
LOOKUP = RX["lookup"]
SEP = LOOKUP["combination_separator"]


@dag(
    dag_id="rxnorm_enrich",
    description="RxNorm: FAERS drug names -> ingredients (Parquet cache)",
    schedule=[RAW_ASSET],
    start_date=pendulum.datetime(2026, 1, 1, tz="UTC"),
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 3,
        "retry_delay": pendulum.duration(minutes=5),
        "retry_exponential_backoff": True,
        "on_failure_callback": on_task_failure,
    },
    params={
        "max_names": Param(
            LOOKUP["max_names"],
            type=["null", "integer"],
            minimum=1,
            description="Names per run (null = all names in scope)",
        ),
        "selection": Param("top", enum=["top", "random"], description="Which names to take"),
    },
    tags=["rxnorm", "enrich"],
)
def rxnorm_enrich():
    @task
    def plan_lookups() -> list[list[str]]:
        """Chunks of terms still to look up (not in the cache as matched or not_found)."""
        params = get_current_context()["params"]
        names = rxnorm.lake_names(LAKE, SIGNALS["signal_drug_roles"])
        chosen = rxnorm.select_names(
            names, params["max_names"], params["selection"], LOOKUP["random_seed"]
        )
        terms = rxnorm.terms_by_frequency(chosen, SEP)
        pending, counters = rxnorm.pending_terms(terms, CACHE_DIR)
        print(
            "plan:",
            {
                "names_in_scope": len(names),
                "names_selected": len(chosen),
                "selection": params["selection"],
                **counters,
            },
        )
        return rxnorm.chunked(pending, int(LOOKUP["chunk_size"]))

    @task(pool="rxnorm_api")
    def resolve_chunk(terms: list[str]) -> dict:
        ctx = get_current_context()
        stats = rxnorm.run_chunk(
            rxnorm.RxNavClient(RX["api"]),
            terms,
            CACHE_DIR,
            ctx["run_id"].replace(":", "_").replace("+", "_"),
            ctx["ti"].map_index,
            RX["approximate_rules"],
            RX["api"]["max_consecutive_term_errors"],
            int(LOOKUP["flush_every_terms"]),
        )
        print("chunk:", stats)
        return stats

    @task(trigger_rule=TriggerRule.NONE_FAILED)
    def merge_cache(chunk_stats: list[dict] | None) -> dict:
        stats = list(chunk_stats or [])
        calls = sum(s["calls"] for s in stats)
        summary = {
            "chunks": len(stats),
            "calls": calls,
            "http_429": sum(s["http_429"] for s in stats),
            "retries": sum(s["retries"] for s in stats),
            "max_calls_in_any_1s": max((s["max_calls_in_any_1s"] for s in stats), default=0),
            **rxnorm.merge_pending(CACHE_DIR),
        }
        print("merge:", summary)
        return summary

    @task(outlets=[RXNORM_ASSET], trigger_rule=TriggerRule.NONE_FAILED)
    def build_name_map(merge: dict) -> dict:
        names = [n for n, _ in rxnorm.lake_names(LAKE, SIGNALS["signal_drug_roles"])]
        cache_rows = rxnorm.read_rows(CACHE_DIR / rxnorm.CACHE_FILE)
        rows, summary = rxnorm.build_name_map(
            names, cache_rows, SEP, RX["approximate_rules"]["min_score"]
        )
        rxnorm.write_parquet_atomic(rows, NAME_MAP, rxnorm.NAME_MAP_SCHEMA)
        print("name_map:", summary)
        return summary

    chunks = plan_lookups()
    stats = resolve_chunk.expand(terms=chunks)
    build_name_map(merge_cache(stats))


rxnorm_enrich()
