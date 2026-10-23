"""Shared helpers for the Phase 0 spikes. Read-only towards external sources.

Spikes run inside the airflow-dev container (`make` mounts the repo at /opt/project).
Outputs go to data/spikes/ (git-ignored). Nothing here is production code.
"""

from __future__ import annotations

import codecs
import json
import os
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import download  # noqa: E402
from faers_pipeline.config import build_url, load_config  # noqa: E402

CFG = load_config("faers.yaml")
SCHEMA = load_config("faers_schema.yaml")
CONTAINER_DATA = "/opt/airflow/data"  # prefix of config paths inside the Airflow services
DATA = REPO / "data"
SPIKES_OUT = DATA / "spikes"


def local_path(cfg_path: str) -> Path:
    """Maps a config path (/opt/airflow/data/...) to the repo's data/ folder."""
    rel = Path(cfg_path).relative_to(CONTAINER_DATA)
    return DATA / rel


def ensure_zip(quarter: str) -> tuple[Path, dict]:
    """Downloads the quarter's zip with the project's download code, unless already present."""
    url = build_url(CFG, quarter)
    dest = local_path(CFG["paths"]["landing"]) / quarter / Path(url).name
    if dest.exists():
        return dest, {"path": str(dest), "bytes": dest.stat().st_size, "url": url, "cached": True}
    t0 = time.perf_counter()
    info = download.download_zip(
        url, dest, CFG["source"]["request_timeout_s"], CFG["source"]["user_agent"]
    )
    info["seconds"] = round(time.perf_counter() - t0, 1)
    info["cached"] = False
    return dest, info


def list_members(zip_path: Path) -> list[dict]:
    with zipfile.ZipFile(zip_path) as zf:
        return [
            {"name": i.filename, "size": i.file_size, "compressed": i.compress_size}
            for i in zf.infolist()
        ]


def find_member(zip_path: Path, file_type: str) -> str:
    """Same matching rule as parse.extract_zip: basename starts with the type, ends with .txt."""
    with zipfile.ZipFile(zip_path) as zf:
        for m in zf.namelist():
            base = os.path.basename(m).lower()
            if base.endswith(".txt") and base.startswith(file_type):
                return m
    raise FileNotFoundError(file_type)


def scan_raw(zip_path: Path, member: str, delimiter: str) -> dict:
    """Streams one .txt member as bytes: header, line count, field-count histogram,
    line endings, non-ASCII bytes and whether the whole file is valid UTF-8."""
    delim = delimiter.encode()
    hist: Counter[int] = Counter()
    bad_examples: list[dict] = []
    lines = crlf = non_ascii_lines = 0
    utf8_ok = True
    utf8_first_error: dict | None = None
    decoder = codecs.getincrementaldecoder("utf-8")()
    header: list[str] = []
    n_header = 0
    non_ascii_examples: list[str] = []
    with zipfile.ZipFile(zip_path) as zf, zf.open(member) as fh:
        for i, raw in enumerate(fh):
            if raw.endswith(b"\r\n"):
                crlf += 1
            line = raw.rstrip(b"\r\n")
            if utf8_ok:
                try:
                    decoder.decode(raw)
                except UnicodeDecodeError as exc:
                    utf8_ok = False
                    utf8_first_error = {"line_no": i + 1, "error": str(exc)[:200]}
            if any(b > 0x7F for b in line):
                non_ascii_lines += 1
                if len(non_ascii_examples) < 5:
                    non_ascii_examples.append(line.decode("latin-1")[:200])
            n = line.count(delim) + 1
            if i == 0:
                header = line.decode("latin-1").split(delimiter)
                n_header = n
                continue
            lines += 1
            hist[n] += 1
            if n != n_header and len(bad_examples) < 5:
                bad_examples.append(
                    {"line_no": i + 1, "fields": n, "text": line[:200].decode("latin-1")}
                )
    irregular = sum(c for k, c in hist.items() if k != n_header)
    return {
        "member": member,
        "header": header,
        "header_fields": n_header,
        "data_lines": lines,
        "field_count_hist": dict(sorted(hist.items())),
        "irregular_lines": irregular,
        "irregular_examples": bad_examples,
        "crlf_lines": crlf,
        "non_ascii_lines": non_ascii_lines,
        "non_ascii_examples": non_ascii_examples,
        "valid_utf8": utf8_ok,
        "utf8_first_error": utf8_first_error,
    }


def write_json(obj: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    os.replace(tmp, path)


def measure_parse(txt_path: Path, out_path: Path) -> dict:
    """Runs parse.to_parquet in a child process; returns its result, wall time and peak RSS."""
    import subprocess

    t0 = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-I", str(Path(__file__)), "parse", str(txt_path), str(out_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _, status, rusage = os.wait4(proc.pid, 0)
    seconds = time.perf_counter() - t0
    out = proc.stdout.read().decode()
    err = proc.stderr.read().decode()
    rc = os.waitstatus_to_exitcode(status)
    res: dict = {"seconds": round(seconds, 2), "peak_rss_mb": round(rusage.ru_maxrss / 1024, 1)}
    if rc != 0:
        res["error"] = err.strip().splitlines()[-1] if err.strip() else f"exit {rc}"
        return res
    res.update(json.loads(out))
    return res


def _parse_child(txt: str, out: str) -> None:
    from faers_pipeline import parse

    res = parse.to_parquet(Path(txt), Path(out), CFG["parse"])
    print(json.dumps(res))


if __name__ == "__main__" and len(sys.argv) == 4 and sys.argv[1] == "parse":
    _parse_child(sys.argv[2], sys.argv[3])
