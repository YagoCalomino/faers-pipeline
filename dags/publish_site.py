"""DAG 4: export of the site's data, validation and the site_export Asset.

Triggered by the warehouse Asset (faers_transform). The Airflow image has neither Node nor push
credentials, so this DAG stops at a validated export; the site is built and committed to a
local gh-pages branch on the host (make publish-site), and the push is manual.

1. export_candidate: warehouse -> export.candidate_dir (config/site.yaml), replaced as a whole.
2. validate_candidate: manifest, counts against the marts, 2x2 cells, sizes and column
   descriptions (faers_pipeline.site_check). No retries: a failed check is deterministic.
3. promote_export: swaps the candidate into export.out_dir, writes the ready marker and emits
   the site_export Asset. Runs only when the validation passed; a failure at any step keeps the
   previous export and its marker.

No duckdb_writer pool: the export opens the warehouse read-only, and the only writer (dbt in
faers_transform) never writes that file in place: it builds into data/warehouse/_build/ and
swaps the file with os.replace. Taking the 1-slot pool would only make the next build wait
behind the export. If a swap lands while this DAG runs, the validation recounts the marts on
the new file, the counts differ and the run fails without emitting the Asset; the new
warehouse Asset then triggers a fresh run.

Run param limits_override (dict) replaces entries of config/site.yaml limits for one run, for
example {"export_max_file_bytes": 1000} to see a validation failure.
"""

from __future__ import annotations

from pathlib import Path

import pendulum
from airflow.sdk import Asset, Param, dag, get_current_context, task

from faers_pipeline import export, site_check
from faers_pipeline.callbacks import on_task_failure
from faers_pipeline.config import load_config

FAERS_CFG = load_config("faers.yaml")
SITE_CFG = load_config("site.yaml")
WAREHOUSE_ASSET = Asset("faers_warehouse")
SITE_EXPORT_ASSET = Asset("site_export")


@dag(
    dag_id="publish_site",
    description="Exporta os dados do site, valida a exportação e emite o Asset site_export",
    schedule=[WAREHOUSE_ASSET],
    start_date=pendulum.datetime(2026, 1, 1, tz="UTC"),
    catchup=False,
    max_active_runs=1,
    params={"limits_override": Param({}, type="object")},
    default_args={
        "retries": 3,
        "retry_delay": pendulum.duration(minutes=2),
        "retry_exponential_backoff": True,
        "on_failure_callback": on_task_failure,
    },
    tags=["site", "export"],
)
def publish_site():
    @task
    def export_candidate() -> dict:
        summary = export.export_site(
            Path(FAERS_CFG["paths"]["warehouse"]), Path(SITE_CFG["export"]["candidate_dir"])
        )
        print("export:", summary)
        return summary

    @task(retries=0)
    def validate_candidate(summary: dict) -> dict:
        params = get_current_context()["params"]
        limits = {**SITE_CFG["limits"], **(params.get("limits_override") or {})}
        try:
            report = site_check.validate_export(
                Path(summary["out_dir"]),
                Path(FAERS_CFG["paths"]["warehouse"]),
                limits,
                SITE_CFG["downloads"],
                bool(SITE_CFG["export"]["include_generic_fallback"]),
            )
        except site_check.ExportValidationError as exc:
            for problem in exc.problems:
                print("VALIDATION FAILED:", problem)
            raise
        print("validation:", report)
        return report

    @task(outlets=[SITE_EXPORT_ASSET])
    def promote_export(report: dict) -> dict:
        run_id = get_current_context()["run_id"]
        marker = site_check.promote(
            Path(report["out_dir"]),
            Path(SITE_CFG["export"]["out_dir"]),
            Path(SITE_CFG["export"]["ready_marker"]),
            report,
            run_id=run_id,
        )
        print("ready marker:", marker)
        return marker

    promote_export(validate_candidate(export_candidate()))


publish_site()
