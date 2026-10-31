"""Runs dbt (from the /opt/dbt-venv virtualenv) with settings read from config/*.yaml.

The settings logic lives in faers_pipeline.warehouse (shared with the faers_transform DAG):
environment for profiles.yml from config/faers.yaml, --vars from faers.yaml, signals.yaml and
rxnorm.yaml. Variables already set in the environment win (the ci target sets LAKE_PATH and
DBT_CI_DIR).

Usage (inside the container, e.g. via make):
    python -I scripts/dbt_run.py build
    python -I scripts/dbt_run.py --ci build          # target ci (LAKE_PATH, DBT_CI_DIR required)
    python -I scripts/dbt_run.py --atomic build      # full build into a build folder, swapped in
                                                     # only if every model and test passes and
                                                     # the lake reconciliation finds no divergence

--atomic never leaves a half-built or unreconciled warehouse: on failure the previous file stays
as it was and the new file is removed. The reconciliation is the one of the faers_transform DAG.
Never run a build while an ingestion is writing the lake.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import warehouse  # noqa: E402
from faers_pipeline.config import load_config  # noqa: E402
from faers_pipeline.reconcile import check_against  # noqa: E402

PROJECT_DIR = REPO / "dbt" / "faers_dbt"


def main(argv: list[str]) -> int:
    ci = "--ci" in argv
    atomic = "--atomic" in argv
    args = [a for a in argv if a not in ("--ci", "--atomic")]
    if not args:
        sys.exit(__doc__)
    if atomic:
        if ci or args[0] != "build":
            sys.exit("--atomic only applies to a `build` of the local warehouse")
        try:
            lake = Path(load_config("faers.yaml")["paths"]["lake"])
            summary = warehouse.build_atomic(PROJECT_DIR, args=args, check=check_against(lake))
            print(summary, flush=True)
        except warehouse.WarehouseBuildError as exc:
            print(f"BUILD FAILED: {exc}", file=sys.stderr, flush=True)
            return 1
        return 0
    try:
        env = warehouse.dbt_env(PROJECT_DIR, ci=ci)
    except ValueError as exc:
        sys.exit(str(exc))
    if not ci:
        Path(env["DUCKDB_PATH"]).parent.mkdir(parents=True, exist_ok=True)
        Path(load_config("faers.yaml")["dbt"]["temp_directory"]).mkdir(parents=True, exist_ok=True)
    return warehouse.run_dbt(args, PROJECT_DIR, env, ci=ci)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
