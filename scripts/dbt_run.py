"""Runs dbt (from the /opt/dbt-venv virtualenv) with settings read from config/*.yaml.

dbt cannot read the project's YAML config by itself, so this wrapper passes it in:
- environment for profiles.yml: DUCKDB_PATH, LAKE_PATH, DUCKDB_TEMP_DIR, DBT_THREADS,
  DBT_MEMORY_LIMIT (config/faers.yaml: paths.*, dbt.*);
- --vars for the models: window_start_quarter / window_end_quarter (faers.yaml schedule) and
  signal_drug_roles / signal_min_cases (signals.yaml).
Variables already set in the environment win (the ci target sets LAKE_PATH and DBT_CI_DIR).

Usage (inside the container, e.g. via make):
    python -I scripts/dbt_run.py build
    python -I scripts/dbt_run.py --ci build          # target ci (LAKE_PATH, DBT_CI_DIR required)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline.config import load_config  # noqa: E402

PROJECT_DIR = REPO / "dbt" / "faers_dbt"
DBT = Path(os.environ.get("DBT_VENV", "/opt/dbt-venv")) / "bin" / "dbt"
# Subcommands that accept --vars.
WITH_VARS = {"build", "run", "test", "parse", "compile", "ls", "list", "show", "docs", "seed"}


def dbt_vars() -> dict:
    faers = load_config("faers.yaml")
    signals = load_config("signals.yaml")
    return {
        "window_start_quarter": faers["schedule"]["start_quarter"],
        "window_end_quarter": faers["schedule"]["end_quarter"],
        "signal_drug_roles": signals["signal_drug_roles"],
        "signal_min_cases": signals["signal_min_cases"],
    }


def dbt_env(ci: bool) -> dict:
    faers = load_config("faers.yaml")
    dbt_cfg = faers["dbt"]
    env = dict(os.environ)
    if ci:
        for name in ("LAKE_PATH", "DBT_CI_DIR"):
            if not env.get(name):
                sys.exit(f"{name} must be set for the ci target")
        dbt_cfg = {**dbt_cfg, **dbt_cfg["ci"]}
    env.setdefault("LAKE_PATH", faers["paths"]["lake"])
    env.setdefault("DUCKDB_PATH", faers["paths"]["warehouse"])
    env.setdefault("DUCKDB_TEMP_DIR", dbt_cfg["temp_directory"])
    env["DBT_THREADS"] = str(dbt_cfg["threads"])
    env["DBT_MEMORY_LIMIT"] = str(dbt_cfg["memory_limit"])
    env["DBT_PROFILES_DIR"] = str(PROJECT_DIR)
    env["DBT_PROJECT_DIR"] = str(PROJECT_DIR)
    return env


def main(argv: list[str]) -> int:
    ci = "--ci" in argv
    args = [a for a in argv if a != "--ci"]
    if not args:
        sys.exit(__doc__)
    if ci:
        args += ["--target", "ci"]
    if args[0] in WITH_VARS:
        args += ["--vars", json.dumps(dbt_vars())]
    env = dbt_env(ci)
    if not ci:
        Path(env["DUCKDB_PATH"]).parent.mkdir(parents=True, exist_ok=True)
        Path(env["DUCKDB_TEMP_DIR"]).mkdir(parents=True, exist_ok=True)
    os.chdir(PROJECT_DIR)
    os.execve(str(DBT), [str(DBT), *args], env)
    return 0  # not reached


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
