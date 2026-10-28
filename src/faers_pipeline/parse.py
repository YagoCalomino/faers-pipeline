from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb
import pyarrow as pa

from faers_pipeline.files import remove_stale_temp

DIGITS = re.compile(r"[0-9]+")


def _sql_str(value: str | Path) -> str:
    """Quotes a value as a SQL string literal (doubles single quotes)."""
    return "'" + str(value).replace("'", "''") + "'"


def _sql_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


@contextmanager
def duckdb_session(duckdb_cfg: dict | None) -> Iterator[duckdb.DuckDBPyConnection]:
    """In-memory DuckDB connection with memory_limit, threads and temp_directory applied.

    Spill files go to a private subfolder of temp_directory (parallel parses never share
    one), removed on exit.
    """
    cfg = duckdb_cfg or {}
    spill_dir = None
    con = duckdb.connect()
    try:
        if cfg.get("memory_limit"):
            con.execute(f"SET memory_limit = {_sql_str(cfg['memory_limit'])}")
        if cfg.get("threads"):
            con.execute(f"SET threads = {int(cfg['threads'])}")
        if cfg.get("temp_directory"):
            root = Path(cfg["temp_directory"])
            root.mkdir(parents=True, exist_ok=True)
            spill_dir = Path(tempfile.mkdtemp(prefix="duckdb-", dir=root))
            con.execute(f"SET temp_directory = {_sql_str(spill_dir)}")
        yield con
    finally:
        con.close()
        if spill_dir is not None:
            shutil.rmtree(spill_dir, ignore_errors=True)


def extract_zip(zip_path: Path, out_dir: Path, file_types: list[str]) -> dict[str, str]:
    """Extracts only the .txt files of the requested types (case-insensitive). {type: path}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    remove_stale_temp(out_dir)
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


def count_fields(txt_path: Path, delimiter: str) -> dict:
    """Streams the raw file and compares each line's delimiter count with the header's.

    malformed_rows = non-empty data lines whose number of fields differs from the header.
    Empty lines are counted apart (DuckDB skips them), so the Parquet must end up with
    data_lines - blank_lines rows.
    """
    delim = delimiter.encode()
    data_lines = blank = malformed = 0
    header_delims = None
    with open(txt_path, "rb") as fh:
        for raw in fh:
            line = raw.rstrip(b"\r\n")
            if header_delims is None:
                header_delims = line.count(delim)
                continue
            data_lines += 1
            if not line:
                blank += 1
            elif line.count(delim) != header_delims:
                malformed += 1
    return {
        "header_fields": (header_delims or 0) + 1,
        "data_lines": data_lines,
        "blank_lines": blank,
        "expected_rows": data_lines - blank,
        "malformed_rows": malformed,
    }


def _read_file(path: Path) -> str:
    """read_parquet of one file. hive_partitioning is off: the lake paths contain
    'quarter=YYYYQn', which DuckDB would otherwise add as an extra 'quarter' column."""
    return f"read_parquet({_sql_str(path)}, hive_partitioning = false)"


def content_fingerprint(con: duckdb.DuckDBPyConnection, parquet_path: Path) -> str:
    """'<rows>:<hex>' from the sum of a hash of every row, over the columns not starting
    with '_' (so _ingested_at does not change it). Order-independent; the hash function is
    DuckDB's, so compare fingerprints made with the same DuckDB version."""
    src = _read_file(parquet_path)
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]
    data_cols = ", ".join(_sql_ident(c) for c in cols if not c.startswith("_"))
    rows, total = con.execute(
        f"SELECT count(*), coalesce(sum(hash(row({data_cols}))), 0) FROM {src}"
    ).fetchone()
    return f"{rows}:{int(total):x}"


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


def _describe(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[int, list[str], str]:
    src = _read_file(path)
    rows = con.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]
    return rows, cols, content_fingerprint(con, path)


def to_parquet(txt_path: Path, out_path: Path, parse_cfg: dict) -> dict:
    """Converts the '$'-delimited .txt to Parquet (all text), with an atomic write.

    Falls back to parse_cfg["fallback_encoding"] only when DuckDB reports invalid unicode.
    DuckDB limits come from parse_cfg["duckdb"].
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    stale = remove_stale_temp(out_path.parent)
    tmp = out_path.with_suffix(".parquet.tmp")
    scan = count_fields(txt_path, parse_cfg["delimiter"])
    encoding = parse_cfg["encoding"]
    try:
        with duckdb_session(parse_cfg.get("duckdb")) as con:
            try:
                _copy_to_parquet(con, txt_path, tmp, parse_cfg, encoding)
            except duckdb.InvalidInputException as exc:
                fallback = parse_cfg.get("fallback_encoding")
                if not fallback or "Invalid unicode" not in str(exc):
                    raise
                encoding = fallback
                _copy_to_parquet(con, txt_path, tmp, parse_cfg, encoding)
            rows, cols, fingerprint = _describe(con, tmp)
        os.replace(tmp, out_path)
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "path": str(out_path),
        "rows": rows,
        "columns": cols,
        "encoding": encoding,
        "content_fingerprint": fingerprint,
        "stale_removed": stale,
        **scan,
    }


def deleted_member_name(pattern: str, year: int, q: int) -> str:
    return pattern.format(yy=f"{year % 100:02d}", q=q)


def read_member(zip_path: Path, member_name: str) -> tuple[str, bytes]:
    """Reads one zip member by its path, ignoring case. Returns (real member name, bytes)."""
    want = member_name.lower()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            if member.lower() == want:
                return member, zf.read(member)
    raise FileNotFoundError(f"Member {member_name!r} not found in {zip_path.name}")


def parse_deleted(raw: bytes, source_file: str, out_path: Path, parse_cfg: dict) -> dict:
    """Deleted-cases file -> Parquet (caseid, _source_file, _ingested_at), atomic write.

    No header; blank lines are skipped; values are trimmed and kept as text. Non-numeric
    values are kept and counted (invalid_ids), never a failure.
    """
    encoding = parse_cfg["encoding"]
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError:
        encoding = parse_cfg["fallback_encoding"]
        text = raw.decode(encoding)
    values = [line.strip() for line in text.splitlines()]
    ids = [v for v in values if v]
    invalid = [v for v in ids if not DIGITS.fullmatch(v)]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    stale = remove_stale_temp(out_path.parent)
    tmp = out_path.with_suffix(".parquet.tmp")
    try:
        with duckdb_session(parse_cfg.get("duckdb")) as con:
            con.register(
                "deleted",
                pa.table(
                    {"line_order": list(range(len(ids))), "caseid": pa.array(ids, pa.string())}
                ),
            )
            con.execute(f"""
                COPY (
                    SELECT caseid, {_sql_str(source_file)} AS _source_file, now() AS _ingested_at
                    FROM deleted ORDER BY line_order
                ) TO {_sql_str(tmp)} (FORMAT PARQUET, COMPRESSION ZSTD)
            """)
            rows, cols, fingerprint = _describe(con, tmp)
        os.replace(tmp, out_path)
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "path": str(out_path),
        "source_file": source_file,
        "rows": rows,
        "columns": cols,
        "encoding": encoding,
        "content_fingerprint": fingerprint,
        "stale_removed": stale,
        "lines": len(values),
        "blank_lines": len(values) - len(ids),
        "distinct_ids": len(set(ids)),
        "invalid_ids": len(invalid),
        "invalid_examples": invalid[:10],
    }
