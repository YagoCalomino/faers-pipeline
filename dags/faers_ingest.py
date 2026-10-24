"""DAG 1: FAERS/AEMS quarterly zip -> Parquet partitioned by quarter.

One run per data interval [quarter start, next quarter start). The same code serves
scheduled runs and backfills.
"""

from __future__ import annotations

import resource
import time
from pathlib import Path

import pendulum
from airflow.sdk import (
    Asset,
    CronDataIntervalTimetable,
    PokeReturnValue,
    dag,
    get_current_context,
    task,
)

from faers_pipeline import download, files, parse, quality
from faers_pipeline.config import (
    build_url,
    load_config,
    parse_quarter,
    quarter_label,
    quarter_start,
)

CFG = load_config("faers.yaml")
SCHEMA = load_config("faers_schema.yaml")
RAW_ASSET = Asset("faers_raw_parquet")

LAKE = Path(CFG["paths"]["lake"])
LANDING = Path(CFG["paths"]["landing"])
INGEST_LOG = Path(CFG["paths"]["ingest_log"])
START = quarter_start(CFG["schedule"]["start_quarter"])
# A run's logical date is its interval start, so the last run is end_quarter itself.
END = quarter_start(CFG["schedule"]["end_quarter"])


def _raw_path(file_type: str, quarter: str) -> Path:
    return LAKE / "raw" / "faers" / file_type / f"quarter={quarter}" / f"{file_type}.parquet"


def _peak_rss_mb() -> float:
    """Peak resident memory of this task process so far (Linux reports KiB)."""
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


@dag(
    dag_id="faers_ingest",
    description="FAERS/AEMS trimestral: download, parse e Parquet particionado por trimestre",
    schedule=CronDataIntervalTimetable(CFG["schedule"]["cron"], timezone="UTC"),
    start_date=pendulum.instance(START),
    end_date=pendulum.instance(END),
    catchup=True,
    max_active_runs=CFG["schedule"]["max_active_runs"],
    default_args={
        "retries": 3,
        "retry_delay": pendulum.duration(minutes=10),
        "retry_exponential_backoff": True,
    },
    tags=["faers", "ingest"],
)
def faers_ingest():
    @task
    def resolve_quarter() -> str:
        """Data interval [Jan 1, Apr 1) -> 2024Q1."""
        ctx = get_current_context()
        start = ctx["data_interval_start"]
        if start is None:
            raise ValueError("Run sem data interval; dispare com uma data lógica de trimestre.")
        return quarter_label(start)

    @task.sensor(
        poke_interval=CFG["availability_sensor"]["poke_interval_s"],
        timeout=CFG["availability_sensor"]["timeout_s"],
        mode="reschedule",
    )
    def wait_for_release(quarter: str) -> PokeReturnValue:
        url = build_url(CFG, quarter)
        ok = download.is_available(
            url, CFG["source"]["request_timeout_s"], CFG["source"]["user_agent"]
        )
        return PokeReturnValue(is_done=ok, xcom_value=url)

    @task
    def download_zip(quarter: str, url: str) -> dict:
        dest = LANDING / quarter / Path(url).name
        stale = files.remove_stale_temp(dest.parent)
        t0 = time.perf_counter()
        info = download.download_zip(
            url, dest, CFG["source"]["request_timeout_s"], CFG["source"]["user_agent"]
        )
        info["download_seconds"] = round(time.perf_counter() - t0, 1)
        info["stale_removed"] = stale
        run_id = get_current_context()["run_id"]
        info.update(download.record_download(INGEST_LOG, quarter, info, run_id))
        return info

    @task
    def extract(quarter: str, dl: dict) -> dict:
        out_dir = LANDING / quarter / "extracted"
        return parse.extract_zip(Path(dl["path"]), out_dir, CFG["file_types"])

    @task(pool="parse")
    def parse_to_parquet(file_type: str, quarter: str, extracted: dict) -> dict:
        t0 = time.perf_counter()
        out = _raw_path(file_type, quarter)
        res = parse.to_parquet(Path(extracted[file_type]), out, CFG["parse"])
        seconds = round(time.perf_counter() - t0, 2)
        summary = quality.summarize_parse(file_type, res, SCHEMA)
        return {**summary, "parse_seconds": seconds, "peak_rss_mb": _peak_rss_mb()}

    @task
    def ingest_deleted(quarter: str, dl: dict) -> dict:
        year, q = parse_quarter(quarter)
        name = parse.deleted_member_name(CFG["deleted"]["member_pattern"], year, q)
        t0 = time.perf_counter()
        member, raw = parse.read_member(Path(dl["path"]), name)
        out = _raw_path("deleted", quarter)
        res = parse.parse_deleted(raw, Path(member).name, out, CFG["parse"])
        res["parse_seconds"] = round(time.perf_counter() - t0, 2)
        quality.check_contract("deleted", res["columns"], SCHEMA)
        res.pop("columns")
        return res

    @task
    def validate(quarter: str, results: list[dict], deleted: dict, dl: dict) -> dict:
        results = list(results)
        quality.check_rows(results)
        demo = next(r["path"] for r in results if r["file_type"] == "demo")
        in_demo = quality.count_deleted_in_demo(demo, deleted["path"])
        run_id = get_current_context()["run_id"]
        return quality.build_manifest(quarter, dl, results, deleted, run_id, in_demo)

    @task(outlets=[RAW_ASSET])
    def publish_manifest(manifest: dict) -> str:
        path = LAKE / "_meta" / "faers" / f"quarter={manifest['quarter']}" / "manifest.json"
        quality.write_manifest(manifest, path)
        return str(path)

    quarter = resolve_quarter()
    url = wait_for_release(quarter)
    dl = download_zip(quarter, url)
    ex = extract(quarter, dl)
    parsed = parse_to_parquet.partial(quarter=quarter, extracted=ex).expand(
        file_type=CFG["file_types"]
    )
    deleted = ingest_deleted(quarter, dl)
    manifest = validate(quarter, parsed, deleted, dl)
    publish_manifest(manifest)


faers_ingest()
