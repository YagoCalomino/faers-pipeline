"""Export of the site's data from the warehouse (Phase 8a).

The site never reads the warehouse: it reads the files written here (config/site.yaml export).

Layout of the export folder:
    meta.json                       data window, provisional quarter, RxNorm version, counts,
                                    attribution text, export date
    manifest.json                   every other file with its size and sha256
    parquet/<table>.parquet         ingredients, signals_top, dq_metrics, known_signals
    json/ingredients.json           the ingredient list
    json/search.json                compact ingredient list for the search box
    json/signals/<slug>.json        one ingredient and its pairs of mart_signals_top, with the
                                    2x2 cells (b, c, d, n_total) of mart_signals in ALL
    json/dq_metrics.json, json/known_signals.json

slug: URL-safe ingredient name (lowercase ASCII letters, digits and '-'), unique; when two
ingredients share a name, the one with an RxNorm match and the most cases keeps the plain slug
and the others get the ingredient id appended.

Writes are atomic for the folder as a whole: the export is built in a sibling folder
(<out>.building) and swapped in only when complete; on failure the half-built folder is removed
and the previous export stays as it was. The content is deterministic (explicit ORDER BY, one
DuckDB thread, fixed float formatting), so two runs on the same warehouse give the same sha256
for every file. meta.json carries the export date (UTC day), so it changes from one day to the
next and nothing else does.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
import time
from collections.abc import Iterable
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import duckdb

from faers_pipeline.config import load_config

log = logging.getLogger(__name__)

SCHEMA_VERSION = 2
FORMATS = ("parquet", "json")
# Columns of the ingredient that the per-ingredient JSON keeps once, not in every pair.
_INGREDIENT_COLUMNS = ("ingredient_key", "ingredient_id", "ingredient_name")
# Columns of json/search.json, one array per ingredient (keys written once, not per row).
SEARCH_COLUMNS = ("ingredient_name", "slug", "n_cases_ps_ss", "n_pairs", "is_fallback")


def _slug_sql(expr: str) -> str:
    return f"trim(regexp_replace(lower({expr}), '[^a-z0-9]+', '-', 'g'), '-')"


def queries(include_generic: bool) -> dict[str, str]:
    """SQL of each exported table, ordered so the output is deterministic."""
    keep = "true" if include_generic else "not i.is_generic_fallback"
    return {
        "ingredients": f"""
            with ing as (
                select i.ingredient_key, i.ingredient_id, i.ingredient_name,
                       i.best_match_type as match_type, i.is_fallback, i.is_generic_fallback,
                       i.n_cases_signal_roles as n_cases_ps_ss, count(*) as n_pairs,
                       coalesce(nullif({_slug_sql("i.ingredient_name")}, ''),
                                {_slug_sql("i.ingredient_id")}) as base_slug
                from signals.mart_signals_top as t
                inner join core.dim_ingredient as i using (ingredient_id)
                where {keep}
                group by all
            )
            select ingredient_key, ingredient_id, ingredient_name,
                   case when row_number() over (
                            partition by base_slug
                            order by is_fallback, n_cases_ps_ss desc, ingredient_id) = 1
                        then base_slug
                        else base_slug || '-' || {_slug_sql("ingredient_id")}
                   end as slug,
                   match_type, is_fallback, is_generic_fallback, n_cases_ps_ss, n_pairs
            from ing
            order by n_cases_ps_ss desc, ingredient_name, ingredient_id""",
        # b, c, d and n_total come from mart_signals (ALL), the same row mart_signals_top was
        # selected from; validate_export checks a + b + c + d = n_total for every pair.
        "signals_top": f"""
            select t.*, s.b, s.c, s.d, s.n_total
            from signals.mart_signals_top as t
            inner join core.dim_ingredient as i using (ingredient_id)
            left join signals.mart_signals as s
                on s.period_key = 'ALL'
               and s.ingredient_id = t.ingredient_id
               and s.reaction_key = t.reaction_key
            where {keep}
            order by t.ingredient_id, t.rank_ror_lcl nulls last, t.rank_a_evans nulls last,
                     t.reaction_key""",
        "dq_metrics": """
            select period_basis, period_key, metric_group, metric, value, unit
            from signals.mart_dq_metrics
            order by period_basis, period_key, metric_group, metric""",
        "known_signals": """
            select expected, ingredient_name, reaction_pt, ingredient_id, a, n_drug, n_reac, prr,
                   ror_lcl, chi2, is_signal_evans, is_signal_ror, a_fallback_same_name, passed,
                   failure_reason, reference, reference_status
            from signals.mart_known_signals_eval
            order by expected desc, ingredient_name, reaction_pt""",
    }


def to_json_value(value, digits: int):
    """Python value from DuckDB -> JSON-safe value; doubles rounded to `digits` significant
    digits (17 keeps every double exactly), NaN and infinities as null."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return float(f"{value:.{digits}g}")
    if isinstance(value, list | tuple):
        return [to_json_value(v, digits) for v in value]
    if isinstance(value, dict):
        return {k: to_json_value(v, digits) for k, v in value.items()}
    if isinstance(value, date | datetime):
        return value.isoformat()
    raise TypeError(f"unsupported value for JSON: {type(value).__name__}")


def _rows(con: duckdb.DuckDBPyConnection, sql: str, digits: int) -> list[dict]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [
        {c: to_json_value(v, digits) for c, v in zip(cols, r, strict=True)} for r in cur.fetchall()
    ]


def json_bytes(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _sql_path(path: Path) -> str:
    return str(path).replace("'", "''")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class _Written:
    """Size and sha256 of every file, recorded when it is written: on the Windows bind mount
    each mkdir, stat or re-read costs a few milliseconds, which dominated a 3,000-file export
    (89 s, of which ~80 s in filesystem calls)."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.files: dict[str, dict] = {}

    def write_json(self, path: Path, obj) -> None:
        data = json_bytes(obj)
        path.write_bytes(data)
        self._record(path, len(data), hashlib.sha256(data).hexdigest())

    def add_file(self, path: Path) -> None:
        self._record(path, path.stat().st_size, sha256_file(path))

    def _record(self, path: Path, size: int, digest: str) -> None:
        rel = path.relative_to(self.root).as_posix()
        self.files[rel] = {"path": rel, "bytes": size, "sha256": digest}

    def manifest(self) -> list[dict]:
        return [self.files[k] for k in sorted(self.files)]


def read_manifest_from_disk(root: Path) -> list[dict]:
    """Every file under `root` except manifest.json, read back from disk (to verify an export
    against its manifest.json)."""
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.name != "manifest.json")
    return [
        {
            "path": p.relative_to(root).as_posix(),
            "bytes": p.stat().st_size,
            "sha256": sha256_file(p),
        }
        for p in files
    ]


def metadata(
    con: duckdb.DuckDBPyConnection, rxnorm_cfg: dict, window_end_quarter: str, export_day: date
) -> dict:
    """Data window, provisional quarter, RxNorm version and counts for the site banner.

    last_quarter is the most recent FAERS file quarter loaded; quarters are the init quarters
    of the window that have cases. The provisional quarter is the end of the window
    (config/faers.yaml schedule.end_quarter), the same rule as mart_signals.is_provisional_period:
    its cohort still grows as later files arrive.
    """
    quarters = [
        r[0]
        for r in con.execute("""
            select distinct quarter_key from core.fct_case where is_in_window
            order by quarter_key""").fetchall()
    ]
    last_loaded, n_cases, n_cases_window = con.execute("""
        select max(source_quarter), count(*), count(*) filter (is_in_window)
        from core.fct_case""").fetchone()
    try:
        versions = [
            r[0]
            for r in con.execute("""
                select distinct rxnorm_version from staging.stg_rxnorm__name_map
                where rxnorm_version is not null order by 1""").fetchall()
        ]
    except duckdb.Error as exc:  # the view reads the lake, which may not be mounted here
        log.warning("RxNorm version not readable: %s", exc)
        versions = []
    return {
        "schema_version": SCHEMA_VERSION,
        "export_date": export_day.isoformat(),
        "first_quarter": quarters[0] if quarters else None,
        "last_quarter": last_loaded,
        "provisional_quarter": window_end_quarter,
        "last_quarter_is_provisional": last_loaded == window_end_quarter,
        "quarters": quarters,
        "n_cases_all": n_cases,
        "n_cases_in_window": n_cases_window,
        "rxnorm_versions": versions,
        "rxnav_attribution": " ".join(rxnorm_cfg["attribution_text"].split()),
    }


# Renaming a folder on the Windows bind mount can fail for a moment with EACCES while something on
# the host still holds a handle inside it (seen once on 2026-10-27, right after a validation read
# all 3,239 files; the same rename had worked minutes before).
RENAME_ATTEMPTS = 5
RENAME_WAIT_S = 2.0


def _replace(src: Path, dst: Path) -> None:
    for attempt in range(1, RENAME_ATTEMPTS + 1):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == RENAME_ATTEMPTS:
                raise
            log.warning("rename %s -> %s denied, retry %d", src, dst, attempt)
            time.sleep(RENAME_WAIT_S * attempt)


def swap_in(staging: Path, out_dir: Path) -> None:
    old = out_dir.with_name(out_dir.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if out_dir.exists():
        _replace(out_dir, old)
    _replace(staging, out_dir)
    if old.exists():
        shutil.rmtree(old)


def _write_all(
    warehouse: Path,
    staging: Path,
    sql: dict[str, str],
    formats: list[str],
    cfg: dict,
    rxnorm_cfg: dict,
    window_end_quarter: str,
    export_day: date,
) -> tuple[dict, _Written]:
    digits = int(cfg["json_float_digits"])
    written = _Written(staging)
    con = duckdb.connect(str(warehouse), read_only=True)
    try:
        con.execute("set threads = 1")  # one writer thread: identical bytes on every run
        if "parquet" in formats:
            (staging / "parquet").mkdir()
            for name, query in sql.items():
                target = staging / "parquet" / f"{name}.parquet"
                con.execute(
                    f"copy ({query}) to '{_sql_path(target)}' "
                    f"(format parquet, compression {cfg['parquet_compression']})"
                )
                written.add_file(target)
        if "json" in formats:
            (staging / "json" / "signals").mkdir(parents=True)
            ingredients = _rows(con, sql["ingredients"], digits)
            written.write_json(staging / "json" / "ingredients.json", ingredients)
            written.write_json(
                staging / "json" / "search.json",
                {
                    "columns": list(SEARCH_COLUMNS),
                    "rows": [[ing[c] for c in SEARCH_COLUMNS] for ing in ingredients],
                },
            )
            by_key: dict[str, list[dict]] = {}
            for row in _rows(con, sql["signals_top"], digits):
                pair = {k: v for k, v in row.items() if k not in _INGREDIENT_COLUMNS}
                by_key.setdefault(row["ingredient_key"], []).append(pair)
            for ing in ingredients:
                written.write_json(
                    staging / "json" / "signals" / f"{ing['slug']}.json",
                    {"ingredient": ing, "pairs": by_key.get(ing["ingredient_key"], [])},
                )
            for name in ("dq_metrics", "known_signals"):
                written.write_json(staging / "json" / f"{name}.json", _rows(con, sql[name], digits))
        meta = metadata(con, rxnorm_cfg, window_end_quarter, export_day)
        for key, table in (("n_ingredients", "ingredients"), ("n_pairs", "signals_top")):
            meta[key] = con.execute(f"select count(*) from ({sql[table]})").fetchone()[0]
    finally:
        con.close()
    meta["formats"] = formats
    written.write_json(staging / "meta.json", meta)
    return meta, written


def export_site(
    warehouse: Path,
    out_dir: Path,
    cfg: dict | None = None,
    rxnorm_cfg: dict | None = None,
    export_day: date | None = None,
    formats: Iterable[str] | None = None,
    window_end_quarter: str | None = None,
) -> dict:
    """Writes the export of `warehouse` to `out_dir` (replaced as a whole). Returns a summary."""
    cfg = cfg or load_config("site.yaml")["export"]
    rxnorm_cfg = rxnorm_cfg or load_config("rxnorm.yaml")
    window_end_quarter = window_end_quarter or load_config("faers.yaml")["schedule"]["end_quarter"]
    export_day = export_day or datetime.now(UTC).date()
    formats = list(formats or cfg["formats"])
    unknown = set(formats) - set(FORMATS)
    if unknown or not formats:
        raise ValueError(f"export formats must be among {FORMATS}, got {formats}")
    sql = queries(bool(cfg["include_generic_fallback"]))

    out_dir = Path(out_dir)
    staging = out_dir.with_name(out_dir.name + ".building")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    t0 = time.perf_counter()
    try:
        meta, written = _write_all(
            Path(warehouse), staging, sql, formats, cfg, rxnorm_cfg, window_end_quarter, export_day
        )
        files = written.manifest()
        manifest_bytes = json_bytes({"files": files})
        (staging / "manifest.json").write_bytes(manifest_bytes)
        swap_in(staging, out_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)  # the previous export stays as it was
        raise
    seconds = round(time.perf_counter() - t0, 2)

    largest = max(files, key=lambda f: f["bytes"])
    by_format = {}
    for fmt in formats:
        fs = [f for f in files if f["path"].startswith(f"{fmt}/")]
        by_format[fmt] = {
            "files": len(fs),
            "bytes": sum(f["bytes"] for f in fs),
            "largest": max((f["bytes"] for f in fs), default=0),
        }
    summary = {
        "out_dir": str(out_dir),
        "seconds": seconds,
        "files": len(files) + 1,  # + manifest.json
        "bytes": sum(f["bytes"] for f in files) + len(manifest_bytes),
        "largest_file": largest["path"],
        "largest_bytes": largest["bytes"],
        "by_format": by_format,
        "n_ingredients": meta["n_ingredients"],
        "n_pairs": meta["n_pairs"],
        "last_quarter": meta["last_quarter"],
    }
    log.info("site export written: %s", summary)
    return summary
