from __future__ import annotations

import os
import shutil
import zipfile
from pathlib import Path

import duckdb


def _sql_str(value: str | Path) -> str:
    """Quotes a value as a SQL string literal (doubles single quotes)."""
    return "'" + str(value).replace("'", "''") + "'"


def extract_zip(zip_path: Path, out_dir: Path, file_types: list[str]) -> dict[str, str]:
    """Extracts only the .txt files of the requested types (case-insensitive). {type: path}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    found: dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            base = os.path.basename(member).lower()
            if not base.endswith(".txt"):
                continue
            for ft in file_types:
                if base.startswith(ft) and ft not in found:
                    target = out_dir / os.path.basename(member)
                    part = target.with_name(target.name + ".part")
                    with zf.open(member) as src, open(part, "wb") as dst:
                        shutil.copyfileobj(src, dst, length=1 << 20)
                    os.replace(part, target)
                    found[ft] = str(target)
    missing = [ft for ft in file_types if ft not in found]
    if missing:
        raise FileNotFoundError(f"Tipos ausentes no zip: {missing}")
    return found


def _copy_to_parquet(
    con: duckdb.DuckDBPyConnection, txt_path: Path, tmp: Path, parse_cfg: dict, encoding: str
) -> None:
    con.execute(f"""
        COPY (
            SELECT *,
                   {_sql_str(txt_path.name)} AS _source_file,
                   now()                    AS _ingested_at
            FROM read_csv(
                {_sql_str(txt_path)},
                delim={_sql_str(parse_cfg["delimiter"])},
                quote={_sql_str(parse_cfg["quote"])},
                header=true,
                all_varchar=true,
                normalize_names=true,
                null_padding=true,
                encoding={_sql_str(encoding)}
            )
        ) TO {_sql_str(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD)
    """)


def to_parquet(txt_path: Path, out_path: Path, parse_cfg: dict) -> dict:
    """Converts the '$'-delimited .txt to Parquet (all text), with an atomic write.

    Falls back to parse_cfg["fallback_encoding"] only when DuckDB reports invalid unicode.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".parquet.tmp")
    encoding = parse_cfg["encoding"]
    con = duckdb.connect()
    try:
        try:
            _copy_to_parquet(con, txt_path, tmp, parse_cfg, encoding)
        except duckdb.InvalidInputException as exc:
            fallback = parse_cfg.get("fallback_encoding")
            if not fallback or "Invalid unicode" not in str(exc):
                raise
            encoding = fallback
            _copy_to_parquet(con, txt_path, tmp, parse_cfg, encoding)
        rows = con.execute(f"SELECT count(*) FROM read_parquet({_sql_str(tmp)})").fetchone()[0]
        cols = [
            r[0]
            for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet({_sql_str(tmp)})").fetchall()
        ]
        os.replace(tmp, out_path)
    finally:
        con.close()
        tmp.unlink(missing_ok=True)
    return {"path": str(out_path), "rows": rows, "columns": cols, "encoding": encoding}
