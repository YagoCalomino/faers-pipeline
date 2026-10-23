"""DAG 1: FAERS/AEMS quarterly zip -> Parquet partitioned by quarter.

One run per data interval [quarter start, next quarter start). The same code serves
scheduled runs and backfills.
"""

from __future__ import annotations

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

from faers_pipeline import download, parse, quality
from faers_pipeline.config import build_url, load_config, quarter_label, quarter_start

CFG = load_config("faers.yaml")
SCHEMA = load_config("faers_schema.yaml")
RAW_ASSET = Asset("faers_raw_parquet")

LAKE = Path(CFG["paths"]["lake"])
LANDING = Path(CFG["paths"]["landing"])
START = quarter_start(CFG["schedule"]["start_quarter"])
# A run's logical date is its interval start, so the last run is end_quarter itself.
END = quarter_start(CFG["schedule"]["end_quarter"])


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
        info = download.download_zip(
            url, dest, CFG["source"]["request_timeout_s"], CFG["source"]["user_agent"]
        )
        # TODO(Phase 2): compare sha256 with the previous ingest log and log 'source_changed'
        return info

    @task
    def extract(quarter: str, dl: dict) -> dict:
        out_dir = LANDING / quarter / "extracted"
        return parse.extract_zip(Path(dl["path"]), out_dir, CFG["file_types"])

    @task(max_active_tis_per_dag=4)
    def parse_to_parquet(file_type: str, quarter: str, extracted: dict) -> dict:
        out = LAKE / "raw" / "faers" / file_type / f"quarter={quarter}" / f"{file_type}.parquet"
        res = parse.to_parquet(Path(extracted[file_type]), out, CFG["parse"])
        contract = quality.check_contract(file_type, res["columns"], SCHEMA)
        return {
            "file_type": file_type,
            "rows": res["rows"],
            "path": res["path"],
            "encoding": res["encoding"],
            "extra_columns": contract["extra_columns"],
        }

    @task
    def validate(quarter: str, results: list[dict], dl: dict) -> dict:
        results = list(results)
        empty = [r["file_type"] for r in results if r["rows"] == 0]
        if empty:
            raise ValueError(f"Arquivos sem linhas em {quarter}: {empty}")
        return {
            "quarter": quarter,
            "zip_sha256": dl["sha256"],
            "zip_bytes": dl["bytes"],
            "rows": {r["file_type"]: r["rows"] for r in results},
            "encodings": {r["file_type"]: r["encoding"] for r in results},
            "extra_columns": {r["file_type"]: r["extra_columns"] for r in results},
        }

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
    manifest = validate(quarter, parsed, dl)
    publish_manifest(manifest)


faers_ingest()
