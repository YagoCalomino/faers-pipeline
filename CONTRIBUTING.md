# Contributing

This is a portfolio project maintained by one person; issues and suggestions are welcome.

Before opening a pull request:

1. Run the same checks as the CI: `make lint`, `make test`, `make dbt-ci` and `make site-ci`
   (all run inside the Airflow image, except the site build, which needs Node.js on the host).
   `python scripts/check_docs.py` checks the Markdown files against the Makefile, the links and
   the pinned versions.
2. Keep settings that depend on external sources (URLs, quarters, limits, thresholds) in
   `config/*.yaml`, not in code.
3. Do not commit data: `data/` holds only placeholders. Test fixtures are small real subsets of
   FAERS and RxNorm (`tests/fixtures/`), built by the scripts in `scripts/`.
4. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) in
   English.
5. Optional: `pre-commit install` runs ruff and basic file checks on each commit
   (`.pre-commit-config.yaml`).
