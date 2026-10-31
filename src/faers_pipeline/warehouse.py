"""dbt runs against the DuckDB warehouse, including the atomic full build.

dbt cannot read the project's YAML config by itself, so this module passes it in:
- environment for profiles.yml: DUCKDB_PATH, LAKE_PATH, DUCKDB_TEMP_DIR, DBT_THREADS,
  DBT_MEMORY_LIMIT (config/faers.yaml: paths.*, dbt.*);
- --vars for the models: window_start_quarter / window_end_quarter (faers.yaml schedule),
  signal_drug_roles / signal_min_cases / signals (signals.yaml), rxnorm_generic_terms (rxnorm.yaml)
  and missing_value_placeholders (faers.yaml).
Variables already set in the environment win (the ci target sets LAKE_PATH and DBT_CI_DIR).

Atomic build: dbt writes <warehouse dir>/<atomic_build_dir>/<warehouse name> (DUCKDB_PATH points
there; same file name so DuckDB gives it the same catalog name) and the file replaces the
warehouse with os.replace (same filesystem) only when the whole `dbt build` (models and tests)
exits 0 and the optional check (the lake -> warehouse reconciliation in the DAG and in
`make dbt-rebuild`) finds no divergence in the new file. On failure the previous warehouse is
untouched and the new file is removed. A full
build always starts from an empty file, so the warehouse never carries free blocks of earlier
builds.
"""

from __future__ import annotations

import json
import logging
import os
import resource
import subprocess
import time
from collections.abc import Callable, Sequence
from pathlib import Path

import duckdb

from faers_pipeline.config import load_config

log = logging.getLogger(__name__)

# Subcommands that accept --vars.
WITH_VARS = {"build", "run", "test", "parse", "compile", "ls", "list", "show", "docs", "seed"}


class WarehouseBuildError(RuntimeError):
    """The dbt build or the check before the swap failed; the previous warehouse was kept."""


def dbt_executable() -> Path:
    return Path(os.environ.get("DBT_VENV", "/opt/dbt-venv")) / "bin" / "dbt"


def dbt_vars() -> dict:
    faers = load_config("faers.yaml")
    signals = load_config("signals.yaml")
    rxnorm = load_config("rxnorm.yaml")
    return {
        "window_start_quarter": faers["schedule"]["start_quarter"],
        "window_end_quarter": faers["schedule"]["end_quarter"],
        "signal_drug_roles": signals["signal_drug_roles"],
        "signal_min_cases": signals["signal_min_cases"],
        "signals": {k: signals[k] for k in ("ci_z", "thresholds", "top")},
        "rxnorm_generic_terms": rxnorm["generic_terms"] or [],
        "missing_value_placeholders": faers["missing_value_placeholders"],
    }


def dbt_env(project_dir: Path, ci: bool = False, base: dict | None = None) -> dict:
    """Environment for profiles.yml. Values already in `base` (default os.environ) win."""
    faers = load_config("faers.yaml")
    dbt_cfg = faers["dbt"]
    env = dict(os.environ if base is None else base)
    if ci:
        for name in ("LAKE_PATH", "DBT_CI_DIR"):
            if not env.get(name):
                raise ValueError(f"{name} must be set for the ci target")
        dbt_cfg = {**dbt_cfg, **dbt_cfg["ci"]}
    env.setdefault("LAKE_PATH", faers["paths"]["lake"])
    env.setdefault("DUCKDB_PATH", faers["paths"]["warehouse"])
    env.setdefault("DUCKDB_TEMP_DIR", dbt_cfg["temp_directory"])
    env.setdefault("DBT_THREADS", str(dbt_cfg["threads"]))
    env.setdefault("DBT_MEMORY_LIMIT", str(dbt_cfg["memory_limit"]))
    env.setdefault("DBT_PROFILES_DIR", str(project_dir))
    env["DBT_PROJECT_DIR"] = str(project_dir)
    return env


def dbt_command(args: Sequence[str], ci: bool = False) -> list[str]:
    args = list(args)
    if ci:
        args += ["--target", "ci"]
    if args and args[0] in WITH_VARS:
        args += ["--vars", json.dumps(dbt_vars())]
    return [str(dbt_executable()), *args]


def run_dbt(args: Sequence[str], project_dir: Path, env: dict, ci: bool = False) -> int:
    """Runs dbt in the project folder; output goes to this process's stdout. Returns the exit
    code."""
    cmd = dbt_command(args, ci)
    log.info("dbt: %s (DUCKDB_PATH=%s)", " ".join(cmd[:2]), env.get("DUCKDB_PATH"))
    return subprocess.run(cmd, cwd=project_dir, env=env, check=False).returncode


def _remove(*paths: Path) -> list[str]:
    removed = []
    for p in paths:
        if p.exists():
            p.unlink()
            removed.append(p.name)
    return removed


def _rmdir_if_empty(folder: Path) -> None:
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()


def _wal(path: Path) -> Path:
    return path.with_name(path.name + ".wal")


def build_atomic(
    project_dir: Path,
    warehouse: Path | None = None,
    args: Sequence[str] = ("build",),
    runner: Callable[[dict], int] | None = None,
    extra_env: dict | None = None,
    check: Callable[[Path], list[str]] | None = None,
) -> dict:
    """Full dbt build into the build folder, swapped in only if dbt exits 0 and `check`
    passes.

    `runner(env) -> exit code` replaces the real dbt call in tests. `check(new file) -> problems`
    runs on the new file before the swap (reconcile.check_against); any problem, or an error in
    the check, fails the build. Raises WarehouseBuildError (after removing the new file) when the
    build or the check fails; the old warehouse is never touched then.
    """
    faers = load_config("faers.yaml")
    warehouse = Path(warehouse or faers["paths"]["warehouse"])
    build_dir = warehouse.parent / faers["dbt"]["atomic_build_dir"]
    new = build_dir / warehouse.name
    build_dir.mkdir(parents=True, exist_ok=True)
    if runner is None:
        Path(faers["dbt"]["temp_directory"]).mkdir(parents=True, exist_ok=True)
    stale = _remove(new, _wal(new))  # leftovers of an interrupted build
    if stale:
        log.warning("removed leftovers of an earlier build: %s", stale)

    env = dbt_env(project_dir, base={**os.environ, **(extra_env or {}), "DUCKDB_PATH": str(new)})
    t0 = time.perf_counter()
    rc = runner(env) if runner else run_dbt(args, project_dir, env)
    seconds = round(time.perf_counter() - t0, 1)
    peak_mb = round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024)
    if rc != 0 or not new.exists():
        removed = _remove(new, _wal(new))
        _rmdir_if_empty(build_dir)
        raise WarehouseBuildError(
            f"dbt {' '.join(args)} exited {rc} after {seconds} s; kept {warehouse} as it was "
            f"(removed {removed or 'nothing'})"
        )
    # Fold any WAL into the new file before it becomes the warehouse.
    con = duckdb.connect(str(new))
    try:
        con.execute("CHECKPOINT")
    finally:
        con.close()
    if _wal(new).exists():
        raise WarehouseBuildError(f"{_wal(new)} still exists after CHECKPOINT; not swapping")
    if check is not None:
        try:
            problems = check(new)
        except Exception as exc:
            _remove(new, _wal(new))
            _rmdir_if_empty(build_dir)
            raise WarehouseBuildError(f"check of {new} failed ({exc}); kept {warehouse}") from exc
        if problems:
            _remove(new, _wal(new))
            _rmdir_if_empty(build_dir)
            raise WarehouseBuildError(
                f"check of the new warehouse failed: {problems}; kept {warehouse} as it was"
            )
    # A WAL left by the old file must not be replayed onto the new one.
    _remove(_wal(warehouse))
    os.replace(new, warehouse)
    _rmdir_if_empty(build_dir)
    summary = {
        "warehouse": str(warehouse),
        "dbt_exit_code": rc,
        "dbt_seconds": seconds,
        "dbt_peak_rss_mb": peak_mb,
        "bytes": warehouse.stat().st_size,
        "checked": check is not None,
    }
    log.info("warehouse swapped: %s", summary)
    return summary
