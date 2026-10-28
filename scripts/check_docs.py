"""Consistency of the versioned Markdown documents with the repository (standard library only).

Checks, in every versioned *.md file outside node_modules:
    make     every `make <target>` mentioned exists in the Makefile
    links    every relative link or image ([text](path)) points to an existing file or folder;
             external links are not fetched
    versions every version cited next to a pinned tool (Airflow, Python, DuckDB, dbt-core,
             dbt-duckdb, ruff, pytest, Vite, marked, Playwright, axe-core, Node.js) equals its pin
             or is a prefix of it (3.3 for 3.3.2); the Airflow version in ci.yml equals the
             Dockerfile's
    numbers  README.md and docs/numbers.md keep the markers that scripts/readme_numbers.py
             writes between

Usage: python scripts/check_docs.py      (exit 1 on any problem)
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CODE_BLOCK = re.compile(r"```.*?```", re.S)
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
# Commands only: inline code (`make x`) and command lines inside code blocks.
MAKE_INLINE = re.compile(r"`make ([a-z][a-z0-9-]+)")
MAKE_BLOCK = re.compile(r"(?:^|&&|;|\|\|)\s*make ([a-z][a-z0-9-]+)", re.M)
# Files that scripts/readme_numbers.py --write fills (same markers as that script).
NUMBERS_FILES = ("README.md", "docs/numbers.md")
NUMBERS_START, NUMBERS_END = "<!-- readme-numbers:start -->", "<!-- readme-numbers:end -->"


def versioned_markdown() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "*.md"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.split()
    files = {REPO / p for p in out}
    # New files not yet committed are checked too.
    extra = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "*.md"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    files |= {REPO / p for p in extra}
    return sorted(p for p in files if "node_modules" not in p.parts and p.is_file())


def make_targets() -> set[str]:
    text = (REPO / "Makefile").read_text(encoding="utf-8")
    return set(re.findall(r"^([a-z][a-z0-9-]+):", text, re.M))


def pins() -> dict[str, str]:
    req = (REPO / "infra/docker/requirements.txt").read_text(encoding="utf-8")
    dev = (REPO / "infra/docker/requirements-dev.txt").read_text(encoding="utf-8")
    dbt = (REPO / "infra/docker/requirements-dbt.txt").read_text(encoding="utf-8")
    docker = (REPO / "infra/docker/Dockerfile").read_text(encoding="utf-8")
    pkg = json.loads((REPO / "site/package.json").read_text(encoding="utf-8"))

    def pin(text: str, name: str) -> str:
        return re.search(rf"^{re.escape(name)}==(\S+)", text, re.M | re.I).group(1)

    dev_deps = pkg["devDependencies"]
    return {
        "airflow": re.search(r"ARG AIRFLOW_VERSION=(\S+)", docker).group(1),
        "python": re.search(r"ARG PYTHON_VERSION=(\S+)", docker).group(1),
        "duckdb": pin(req, "duckdb"),
        "dbt-core": pin(dbt, "dbt-core"),
        "dbt-duckdb": pin(dbt, "dbt-duckdb"),
        "ruff": pin(dev, "ruff"),
        "pytest": pin(dev, "pytest"),
        "vite": dev_deps["vite"],
        "marked": dev_deps["marked"],
        "playwright": dev_deps["playwright"],
        "axe-core": dev_deps["axe-core"],
        "node.js": pkg["engines"]["node"].lstrip(">=^~ "),
    }


TOOL = re.compile(
    r"\b(Airflow|Python|DuckDB|dbt-core|dbt-duckdb|ruff|pytest|Vite|marked|Playwright|axe-core|"
    r"Node\.js)\s+v?(\d+\.\d+(?:\.\d+)?)",
    re.I,
)


def main() -> int:
    problems: list[str] = []
    targets = make_targets()
    pinned = pins()
    files = versioned_markdown()
    n_links = n_make = n_versions = 0
    for path in files:
        rel = path.relative_to(REPO).as_posix()
        raw = path.read_text(encoding="utf-8")
        prose = CODE_BLOCK.sub("", raw)
        blocks = "\n".join(m.group(0) for m in CODE_BLOCK.finditer(raw))
        for target in MAKE_INLINE.findall(prose) + MAKE_BLOCK.findall(blocks):
            n_make += 1
            if target not in targets:
                problems.append(f"{rel}: `make {target}` is not a Makefile target")
        for url in LINK.findall(prose):
            if re.match(r"^(https?:|mailto:|#)", url):
                continue
            n_links += 1
            target = (path.parent / url.split("#")[0]).resolve()
            if not target.exists():
                problems.append(f"{rel}: broken link {url}")
        for tool, version in TOOL.findall(prose):
            n_versions += 1
            want = pinned[tool.lower()]
            if not (want == version or want.startswith(version + ".")):
                problems.append(f"{rel}: {tool} {version} but the pin is {want}")
    for rel in NUMBERS_FILES:
        text = (REPO / rel).read_text(encoding="utf-8")
        if text.count(NUMBERS_START) != 1 or text.count(NUMBERS_END) != 1:
            problems.append(f"{rel}: needs one pair of readme-numbers markers")
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    ci_airflow = re.search(r'AIRFLOW_VERSION:\s*"([^"]+)"', ci).group(1)
    if ci_airflow != pinned["airflow"]:
        problems.append(f"ci.yml Airflow {ci_airflow}, Dockerfile {pinned['airflow']}")
    if f"constraints-{pinned['airflow']}/constraints-{pinned['python']}.txt" not in ci:
        problems.append("ci.yml constraints URL does not match the Airflow and Python pins")
    print(
        f"markdown files: {len(files)}; make commands: {n_make} "
        f"(targets in Makefile: {len(targets)}); relative links: {n_links}; "
        f"versions cited: {n_versions}; pins: {pinned}"
    )
    for p in problems:
        print("PROBLEM", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
