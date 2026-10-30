# ADR 0004: MedDRA terms in the site and the open-data downloads

- Status: accepted
- Date: 2026-10-27 (proposed); accepted 2026-10-30

## Context

Every reaction in the FDA FAERS files is a MedDRA® Preferred Term (PT), stored as text in the
reaction file (`PT` column). The pipeline keeps these terms as they are reported
(`dim_reaction.reaction_pt`, 18,815 terms). When this ADR was proposed, they were published in
three places:

- the site pages (ingredient and pair pages, the validation page);
- the per-ingredient JSON files the site reads (`data/json/`);
- the open-data Parquet downloads (`signals_top.parquet` and `known_signals.parquet` had a
  `reaction_pt` column).

MedDRA is a terminology owned by ICH, and its use is governed by a licence from the MedDRA
MSSO. Publishing a list of its terms as a downloadable table may fall under those terms. The
project does not ship the MedDRA dictionary files, the hierarchy (HLT, HLGT, SOC), codes or
versions; only the PT text that FDA publishes in FAERS.

### What was confirmed

- The PT text comes only from the FDA FAERS quarterly files; the pipeline adds no MedDRA data
  (no codes, no hierarchy, no dictionary file). Checked in the code (`stg_faers__reac`,
  `dim_reaction`) and in `docs/data_dictionary.md`.
- The FDA Readme of the ASCII extract says the reaction terms use MedDRA and that the MedDRA
  version is only in the XML extract (recorded in `docs/data_dictionary.md`).
- The Parquet downloads that carried `reaction_pt` were `signals_top` (terms from FAERS) and
  `known_signals` (terms of the reference seed, written to match `dim_reaction`). The other two,
  `ingredients` and `dq_metrics`, have no MedDRA terms.

### What was not confirmed

- The full MedDRA licence agreement (MSSO / ICH) was not reviewed. Whether republishing PT text
  taken from FAERS, on web pages or as a downloadable table, needs a MedDRA licence is unknown.
- Whether FDA's statement that its website content is in the public domain extends to the
  MedDRA terms inside the FAERS files was not checked.

## Decision

Accepted on 2026-10-30, on a conservative reading of the MedDRA redistribution terms, without a
review of the full licence agreement:

- No downloadable dataset of MedDRA terms is offered. `signals_top` and `known_signals` are no
  longer written as Parquet; `export.parquet_tables` in `config/site.yaml` lists the tables that
  are (`ingredients`, `dq_metrics`), and `validate_export` (`src/faers_pipeline/site_check.py`)
  fails when a Parquet file has a `reaction_pt` column.
- The site pages keep showing reaction terms as they appear in FAERS, with this notice, kept in
  `config/site.yaml` (`site.meddra_notice`) and shown in the site footer, on the Downloads page
  and in the README: "Reaction terms are MedDRA® Preferred Terms as reported in FDA FAERS.
  MedDRA® is a registered trademark of the International Council for Harmonisation of Technical
  Requirements for Pharmaceuticals for Human Use (ICH). This project does not distribute the
  MedDRA dictionary and does not offer a downloadable dataset of MedDRA terms. Reaction terms
  (Preferred Terms) are shown on the site pages as they appear in FAERS."

## Consequences

- Residual risk: the pages still show reaction terms, and the per-ingredient JSON files and
  `json/known_signals.json` that feed the site are public files, readable by anyone who opens
  the site.
- The repository also holds MedDRA terms in test fixtures, which are part of the same residual
  risk: the FAERS samples `tests/fixtures/faers_sample/*/ASCII/REAC*.txt` (reaction terms) and
  `INDI*.txt` (indication terms), taken from FDA's public quarterly files, and the export
  fixture Parquet files `tests/fixtures/site_export/signals.mart_signals.parquet`,
  `signals.mart_signals_top.parquet` and `signals.mart_known_signals_eval.parquet`, which have a
  `reaction_pt` column.
- The pipeline and the marts do not change; only the export, its validation and the Downloads
  page.
- The Parquet files published earlier on `gh-pages` are removed by the next publish, which
  replaces the branch with an orphan commit.
- Reassess if the MSSO confirms that this use is permitted (the tables would come back by adding
  them to `export.parquet_tables` and describing their columns under `downloads`), or if a
  MedDRA subscription turns out to be necessary.
