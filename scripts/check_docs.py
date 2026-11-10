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
    method   the plain layer of the Method page (config/site.yaml method_page.plain) states the
             thresholds of config/signals.yaml, config/rxnorm.yaml and concentration_alert, and
             the case definition of docs/limitations.md (read as text: no YAML library in CI)

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


def yaml_block(text: str, key: str, indent: int) -> str:
    """Lines under `key:` at `indent` spaces, up to the next key at that indent or less."""
    lines = text.splitlines()
    head = re.compile(rf"^ {{{indent}}}{re.escape(key)}:")
    for i, line in enumerate(lines):
        if head.match(line):
            out = []
            for nxt in lines[i + 1 :]:
                stripped = nxt.strip()
                depth = len(nxt) - len(nxt.lstrip())
                if stripped and depth <= indent and not stripped.startswith("#"):
                    break
                if not stripped.startswith("#"):
                    out.append(nxt)
            return "\n".join(out)
    return ""


def yaml_value(text: str, key: str) -> str:
    m = re.search(rf"^\s*{re.escape(key)}:\s*([^#\s]+)", text, re.M)
    if not m:
        raise ValueError(f"{key} not found")
    return m.group(1).strip("\"'")


def method_plain_problems() -> tuple[int, list[str]]:
    """Facts the plain layer of the Method page must state, from the files that define them."""
    site = (REPO / "config/site.yaml").read_text(encoding="utf-8")
    signals = (REPO / "config/signals.yaml").read_text(encoding="utf-8")
    rxnorm = (REPO / "config/rxnorm.yaml").read_text(encoding="utf-8")
    limitations = (REPO / "docs/limitations.md").read_text(encoding="utf-8")
    plain = " ".join(yaml_block(yaml_block(site, "method_page", 0), "plain", 2).split()).lower()
    if not plain:
        return 0, ["config/site.yaml: method_page.plain not found"]
    evans = yaml_block(yaml_block(signals, "thresholds", 0), "evans", 2)
    ror = yaml_block(yaml_block(signals, "thresholds", 0), "ror", 2)
    alert = yaml_block(site, "concentration_alert", 0)

    def pct(v: str) -> str:
        return f"{round(float(v) * 100)}%"

    facts = [
        f"at least {yaml_value(signals, 'signal_min_cases')} cases",
        f"at least {yaml_value(evans, 'min_cases')} cases,"
        f" prr at least {yaml_value(evans, 'min_prr')}"
        f" and chi-square (χ²) at least {yaml_value(evans, 'min_chi2')}",
        f"at least {yaml_value(ror, 'min_cases')} cases and the lower end of the ror's 95% ci above"
        f" {yaml_value(ror, 'min_ror_lcl')}",
        f"at least {yaml_value(alert, 'min_cases_for_quarter_rule')} cases with"
        f" {pct(yaml_value(alert, 'min_top_quarter_share'))} or more of them first received in one"
        " quarter",
        f"a median of {yaml_value(alert, 'min_median_reactions_per_case')} or more reactions per"
        " report",
        f"at least {yaml_value(alert, 'min_cases_for_country_rule')} cases with"
        f" {pct(yaml_value(alert, 'min_top_country_share'))} or more of them from one country",
    ]
    if yaml_value(signals, "ci_z") == "1.96":
        facts.append("95% ci")
    approximate_off = yaml_value(yaml_block(rxnorm, "approximate_rules", 0), "min_score") == "null"
    if approximate_off:
        facts.append("approximate matching is off")
    if "a *case* is one FAERS case ID" in limitations:
        facts += [
            "one faers case id",
            "latest version",
            "different reporters stays as separate cases",
        ]
    where = "config/site.yaml method_page.plain"
    problems = [f"{where} does not state: {f}" for f in facts if f not in plain]
    if not approximate_off and "approximate matching is off" in plain:
        problems.append(f"{where} says approximate matching is off")
    return len(facts), problems


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
    n_facts, method_problems = method_plain_problems()
    problems += method_problems
    print(
        f"markdown files: {len(files)}; make commands: {n_make} "
        f"(targets in Makefile: {len(targets)}); relative links: {n_links}; "
        f"versions cited: {n_versions}; method page facts: {n_facts}; pins: {pinned}"
    )
    for p in problems:
        print("PROBLEM", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
