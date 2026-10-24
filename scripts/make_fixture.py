"""Builds the test fixture tests/fixtures/faers_sample/ from a real FAERS quarterly zip.

Run inside the container (the zip must already be in data/landing, e.g. from a DAG run):
    docker compose --env-file .env -f infra/docker/docker-compose.yml run --rm --no-deps \
        airflow-dev python -I scripts/make_fixture.py --quarter 2026Q2

Deterministic selection, bytes copied as they are (line endings included):
- DEMO: the first N distinct caseid in file order, with every DEMO line of those cases;
- DRUG, REAC, OUTC, RPSR, THER, INDI: every line whose primaryid belongs to those DEMO lines;
- Deleted: the file's lines up to its M-th non-blank id (keeps the leading blank line).
Files keep the zip's folder layout (ASCII/, Deleted/). SOURCE.md records the provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
os.environ.setdefault("FAERS_CONFIG_DIR", str(REPO / "config"))

from faers_pipeline import parse  # noqa: E402
from faers_pipeline.config import build_url, load_config, parse_quarter  # noqa: E402

CFG = load_config("faers.yaml")
CONTAINER_DATA = Path("/opt/airflow/data")


def landing_zip(quarter: str) -> Path:
    url = build_url(CFG, quarter)
    rel = Path(CFG["paths"]["landing"]).relative_to(CONTAINER_DATA)
    return REPO / "data" / rel / quarter / Path(url).name


def type_member(names: list[str], file_type: str) -> str:
    """Same rule as parse.extract_zip: basename starts with the type and ends with .txt."""
    for name in names:
        base = os.path.basename(name).lower()
        if base.endswith(".txt") and base.startswith(file_type):
            return name
    raise FileNotFoundError(file_type)


def split_lines(data: bytes) -> list[bytes]:
    return data.splitlines(keepends=True)


def field(line: bytes, index: int, delim: bytes) -> bytes:
    return line.rstrip(b"\r\n").split(delim)[index]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="2026Q2")
    ap.add_argument("--cases", type=int, default=200)
    ap.add_argument("--deleted", type=int, default=20)
    ap.add_argument("--out", default=str(REPO / "tests" / "fixtures" / "faers_sample"))
    args = ap.parse_args()

    zip_path = landing_zip(args.quarter)
    delim = CFG["parse"]["delimiter"].encode()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    counts: dict[str, int] = {}

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        demo_member = type_member(names, "demo")
        demo = split_lines(zf.read(demo_member))
        header = demo[0].rstrip(b"\r\n").split(delim)
        i_case, i_pid = header.index(b"caseid"), header.index(b"primaryid")
        cases: list[bytes] = []
        for line in demo[1:]:
            cid = field(line, i_case, delim)
            if cid not in cases:
                cases.append(cid)
                if len(cases) == args.cases:
                    break
        wanted = set(cases)
        kept = [demo[0]] + [ln for ln in demo[1:] if field(ln, i_case, delim) in wanted]
        pids = {field(ln, i_pid, delim) for ln in kept[1:]}
        selected = {demo_member: kept}

        for ft in CFG["file_types"]:
            if ft == "demo":
                continue
            member = type_member(names, ft)
            lines = split_lines(zf.read(member))
            idx = lines[0].rstrip(b"\r\n").split(delim).index(b"primaryid")
            selected[member] = [lines[0]] + [
                ln for ln in lines[1:] if ln.strip() and field(ln, idx, delim) in pids
            ]

        year, q = parse_quarter(args.quarter)
        name = parse.deleted_member_name(CFG["deleted"]["member_pattern"], year, q)
        del_member, raw = parse.read_member(zip_path, name)
        del_lines, ids = [], 0
        for line in split_lines(raw):
            del_lines.append(line)
            ids += bool(line.strip())
            if ids == args.deleted:
                break
        selected[del_member] = del_lines

    for member, lines in selected.items():
        target = out / member
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"".join(lines))
        counts[member] = len(lines)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    rows = "\n".join(
        f"| `{m}` | {n} | {(out / m).stat().st_size:,} |" for m, n in sorted(counts.items())
    )
    total = sum((out / m).stat().st_size for m in counts)
    (out / "SOURCE.md").write_text(
        f"""# FAERS sample fixture

Real subset of the FDA FAERS quarterly ASCII file for {args.quarter}, built by
`scripts/make_fixture.py --quarter {args.quarter} --cases {args.cases} --deleted {args.deleted}`.
Bytes are copied unchanged (line endings included), so this folder is marked `-text` in
`.gitattributes`.

- Source: {build_url(CFG, args.quarter)}
- Source zip sha256: `{sha}`
- DEMO: first {args.cases} distinct caseid in file order, all DEMO lines of those cases
  ({len(pids)} primaryid). Other types: every line with one of those primaryid.
- Deleted: lines up to the {args.deleted}th non-blank id (keeps the leading blank line).

| File | Lines (with header) | Bytes |
|---|---|---|
{rows}

Total: {total:,} bytes.
""",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {out} ({total:,} bytes)")
    for m, n in sorted(counts.items()):
        print(f"  {m}: {n} lines")


if __name__ == "__main__":
    main()
