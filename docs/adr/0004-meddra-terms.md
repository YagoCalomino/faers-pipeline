# ADR 0004: MedDRA terms in the site and the open-data downloads

- Status: proposed
- Date: 2026-10-27

## Context

Every reaction in the FDA FAERS files is a MedDRA® Preferred Term (PT), stored as text in the
reaction file (`PT` column). The pipeline keeps these terms as they are reported
(`dim_reaction.reaction_pt`, 18,815 terms) and publishes them in three places:

- the site pages (ingredient and pair pages, the validation page);
- the per-ingredient JSON files the site reads (`data/json/`);
- the open-data Parquet downloads (`signals_top.parquet` and `known_signals.parquet` have a
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
- The Parquet downloads that carry `reaction_pt` are `signals_top` (terms from FAERS) and
  `known_signals` (terms of the reference seed, written to match `dim_reaction`)
  (`config/site.yaml` downloads).

### What was not confirmed

- The terms of the MedDRA licence (MSSO / ICH) were not reviewed. Whether republishing PT text
  taken from FAERS, on web pages or as a downloadable table, needs a MedDRA licence is unknown.
- Whether FDA's statement that its website content is in the public domain extends to the
  MedDRA terms inside the FAERS files was not checked.
- No statement about the licence is made in the repository or on the site until this is
  confirmed.

## Decision (proposed)

Current mitigation, in place now:

- The site footer, the Downloads page and the README carry this notice, kept in
  `config/site.yaml` (`site.meddra_notice`): "Reaction terms are MedDRA® Preferred Terms as
  reported in FDA FAERS. MedDRA® is a registered trademark of ICH. This project does not
  distribute MedDRA."
- Nothing is said about the licence.

Plan:

1. Confirm with the MedDRA licence terms (MSSO / ICH) whether this use needs a licence.
2. If the terms allow it, mark this ADR accepted and keep the site and the downloads as they are.
3. If a licence is required for the list of terms, remove the Parquet downloads (the Downloads
   page, the `parquet` export format and its files on `gh-pages`) and keep the site pages,
   which show the terms in the context of each ingredient. Record the outcome here.

## Consequences

- Until this check is done, the downloads that contain `reaction_pt` stay published with the
  notice; the risk is accepted for now and tracked in `docs/limitations.md`.
- Removing the downloads would not change the pipeline or the marts: only the export formats in
  `config/site.yaml` and the Downloads page.
