# ADR 0003: Tooling for the static site

- Status: accepted
- Date: 2026-10-26

## Context

The public explorer is a static site on GitHub Pages that reads the files written by
`make export` (`src/faers_pipeline/export.py`): Parquet tables and per-ingredient JSON slices.
It needs ingredient search, a table of pairs sortable by PRR, ROR lower bound and case count
with the concentration alert, a quarterly trend chart, a data-quality page, and a banner with
"Data through <quarter>", the limitations notice and the RxNav attribution.

Three tools were tried on the real export (3,229 ingredients, 61,618 pairs) with the same
pages, served under a sub-path as on a GitHub Pages project site.

### Export measured (8 quarters, 2026-10-26)

| | Files | Size | Largest file | Time |
|---|---|---|---|---|
| Parquet | 4 | 6.0 MB (gzip 6.0 MB) | `signals_top.parquet` 5.9 MB | |
| JSON | 3,232 | 42.8 MB (gzip ~9.3 MB) | `ingredients.json` 708 KB; slices median 14 KB, max 28 KB | |
| Whole export | 3,238 | 49.3 MB | | 33 s (89 s before writing hashes at write time) |

Two runs gave the same sha256 for every file, on the real warehouse and on the fixture.

### GitHub Pages limits (docs.github.com, read 2026-10-26)

Published site at most 1 GB; deployments time out after 10 minutes; soft bandwidth limit of
100 GB per month; soft limit of 10 builds per hour, which does not apply to sites built with a
custom GitHub Actions workflow. Git blocks files over 100 MiB. `actions/upload-pages-artifact`
requires a single gzip tar under 10 GB without links. The documentation states no limit on the
number of files or on a single file's size, and does not say whether Pages compresses responses.
Checked on the published site on 2026-10-28 instead: `curl -sI -H "Accept-Encoding: gzip"` on
`data/json/search.json` returned `Content-Encoding: gzip` and `Vary: Accept-Encoding`, with
49,276 bytes on the wire (48 KiB) against 162,004 bytes uncompressed (158 KiB).

### Spike results

Builds on Windows 11 (Node 22.20). Times to the first useful information (the search list,
the ingredient's pairs table, the quality table) measured with Playwright's headless Chromium
1248, fresh cache: desktop 1366×900 without throttling (median of 3), mobile Pixel 7 emulation
with 150 ms latency, 1.6 Mbps download and 4× CPU slowdown (1 run). Served by a local static
server without and with gzip (GitHub Pages serves gzip; see above).

| | Own page, DuckDB-WASM 1.32.0 + Vite 8.3.5 | Same page, JSON slices only | Observable Framework 1.13.4 | Evidence 40.1.8 (npm) |
|---|---|---|---|---|
| License | MIT | MIT | ISC | MIT |
| Build time (real export) | 6 s | 6 s | 27 to 51 s; downloads its `npm:` imports from jsDelivr into an 87 MB cache, so a CI build needs network or a cached folder | 10 s sources + 18 to 21 min (3,231 pre-rendered pages) |
| Build output | 125 MB, 3,245 files (both data formats, two WASM bundles of 34 and 39 MB) | ~43 MB estimated without WASM and Parquet (not built separately) | 97 MB, 67 files | 187 MB, 17,117 files |
| First info, desktop (search / ingredient / quality) | 1.5 / 1.9 / 1.4 s | 0.14 / 0.14 / 0.10 s | 1.9 / 1.9 / 1.4 s | 0.6 / 0.12 / 0.4 s |
| First info, mobile, gzip | 45 / 73 / 44 s | 2.1 / 1.3 / 1.2 s | 75 / 74 / 42 s | 22 / 1.1 / 17 s |
| First info, mobile, no gzip | 175 / 204 / 175 s | 5.3 / 2.2 / 2.1 s | 227 / 228 / 194 s | 49 / 2.6 / 42 s |
| Transferred, ingredient page, gzip | 14.1 MB | 55 KB | 14.1 MB | 15.7 MB (WASM loads after the pre-rendered content) |
| Mobile width | no page overflow; table scrolls | same | no page overflow; table columns truncated to "…" | no page overflow; table shows 2 columns, PRR/ROR hidden |
| Fixture (CI) build | 12 s, works | same | 61 s, works | fails on an empty source query (unreadable empty Parquet); works with a placeholder row, 1 min 37 s |
| Fit with the export | reads `parquet/` directly | reads `json/` directly | reads `parquet/` via `FileAttachment` (literal names only; per-ingredient JSON would need parameterized routes) | copies `parquet/` into its own sources, re-extracted on every build |
| Code written for the spike (not versioned) | 216 lines (UI by hand, both modes) | same | 148 lines (Inputs, Plot) | 138 lines (components) |

Observations:

- DuckDB-WASM costs 34 MB (8 MB gzip) before the first query on every cold visit, in all three
  WASM-based variants. On a throttled mobile connection this dominates the time to the first
  useful information.
- Observable Framework ships its own DuckDB-WASM (1.29.0). Its repository's last commit was on
  2026-05-15 (181 open issues on 2026-10-26).
- Evidence: the official template replaced `npm run build` with a message pointing to a new CLI
  on 2026-08-20; the current documentation installs that CLI with a script that writes to the
  user profile and PATH, expects an Evidence Studio project and `evidence login`, and documents
  self-hosting with a Docker image. The static GitHub Pages build is described only in the
  legacy documentation. `@evidence-dev/evidence` 40.1.8 (2026-02-06) needs `typescript` pinned
  to 5.4.2 (a peer dependency); its install is ~140 MB downloaded and 624 MB on disk. Other
  issues seen: a query on an empty `TextInput` never runs, a date column was shifted by the
  browser's time zone, the trend axis was not in quarter order.
- npm's `latest` tag of `@duckdb/duckdb-wasm` points to a development build (1.33.1-dev57.0); the
  newest release without a pre-release suffix is 1.32.0 (2025-12-16).

## Decision

Accepted on 2026-10-26, after the measurements above.

- **Tool.** A hand-written static site: Vite as the build tool and plain JavaScript, no UI
  framework. Hash routing (`#/ingredient/<slug>`), so links can be shared and no server-side
  rewrite is needed on GitHub Pages.
- **Data.** The pages read the per-ingredient JSON slices and the small lookup files from the
  export. The Parquet tables are published as open-data downloads, not read by the pages.
  DuckDB-WASM stays out of the default path; it may come back as an optional page for ad hoc
  queries, loaded on demand.
- **Publishing.** The Airflow DAG `publish_site` only exports, validates the export and emits
  the `site_export` Asset: the Airflow image has neither Node nor push credentials. The site is
  built and committed on the host (`make publish-site`) into a local orphan `gh-pages` branch
  with one commit and no history. Pushing that branch and turning on GitHub Pages are manual
  steps.
- **Language and paths.** The site is in English. Base path and `repo_url` live in
  `config/site.yaml`; every link inside the site is relative.
- **Concentration alert.** The rule (share of a pair's cases in one init quarter, median
  reactions per case) and its thresholds live in `config/site.yaml`.
  The rule was later extended with a country anomaly check; see docs/limitations.md.

## Alternatives discarded

- **DuckDB-WASM as the data layer (own page).** 34 MB (8 MB gzip) before the first query on
  every cold visit; 45 to 73 s to the first useful information on the simulated phone.
- **Observable Framework 1.13.4.** Same WASM cost (it ships DuckDB-WASM 1.29.0), 74 s for the
  ingredient page on the simulated phone, a build that downloads its `npm:` imports from
  jsDelivr, and a repository with no commit since 2026-05-15.
- **Evidence 40.1.8.** Pre-rendered pages open fast, but the static build is documented only on
  the legacy path (the current CLI expects an Evidence Studio login), the build takes about
  20 minutes and writes 17,117 files, and it fails on an empty source query, which the CI
  fixture produces.

## Consequences

- The fastest first information on mobile in the measurements (1.2 to 2.1 s with gzip) and the
  smallest transfer per page (55 KB); a build of a few seconds that needs no network once
  `npm ci` has run; the CI builds the site on the fixture export without workarounds.
- The UI (search, table sorting, chart, accessibility) is code of the project, with no
  component library to lean on; the chart is hand-drawn SVG. Accessibility and keyboard
  navigation are checked by the project's own tests.
- Each new view needs data the export already shapes, so new views may mean changes to
  `export.py`.
- GitHub Pages serves the JSON gzip-compressed (confirmed on 2026-10-28), so the gzip rows of
  the table are the ones that apply. Risk: mobile times come from one run per page.
