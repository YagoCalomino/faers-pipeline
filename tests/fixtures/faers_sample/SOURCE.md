# FAERS sample fixture

Real subset of the FDA FAERS quarterly ASCII file for 2026Q2, built by
`scripts/make_fixture.py --quarter 2026Q2 --cases 200 --deleted 20`.
Bytes are copied unchanged (line endings included), so this folder is marked `-text` in
`.gitattributes`.

- Source: https://fis.fda.gov/content/Exports/faers_ascii_2026q2.zip
- Source zip sha256: `90213500721ecaf976ee45d8ad04aa2dbb80861d93c87fef67ccaf515919bf2a`
- DEMO: first 200 distinct caseid in file order, all DEMO lines of those cases
  (200 primaryid). Other types: every line with one of those primaryid.
- Deleted: lines up to the 20th non-blank id (keeps the leading blank line).

| File | Lines (with header) | Bytes |
|---|---|---|
| `ASCII/DEMO26Q2.txt` | 201 | 25,854 |
| `ASCII/DRUG26Q2.txt` | 3274 | 313,626 |
| `ASCII/INDI26Q2.txt` | 1742 | 87,357 |
| `ASCII/OUTC26Q2.txt` | 174 | 3,920 |
| `ASCII/REAC26Q2.txt` | 1931 | 73,790 |
| `ASCII/RPSR26Q2.txt` | 1 | 26 |
| `ASCII/THER26Q2.txt` | 334 | 12,196 |
| `Deleted/DELETE26Q2.txt` | 21 | 182 |

Total: 516,951 bytes.
