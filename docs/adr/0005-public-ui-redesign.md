# ADR 0005: Public interface redesign

- Status: accepted
- Date: 2026-11-09

## Context

The explorer of [ADR 0003](0003-site-tooling.md) was built for readers who already know
disproportionality: tables of PRR, ROR and χ² first, the caveats around them. Its public is
wider: patients, journalists and students who search a medicine and may read a large ratio as
proof that the medicine causes a reaction. A design mockup (tokens, components and page texts)
was made for a plain-language redesign. The mockup's texts and numbers were illustrations,
not data.

## Decision

Redesign the pages in plain language, with the numbers one click away, without changing the
data or the routes.

- **Tokens and themes.** Colors, type and spacing are CSS custom properties in
  `site/src/style.css`, with a light and a dark theme. The theme follows the system setting
  unless the reader picks one with the switch; the choice is saved in the browser. One
  blue-teal hue carries magnitude; muted magenta with a glyph and words marks a reporting
  pattern; color never means risk, and nothing is red, amber or green.
- **Font.** Source Serif 4 (latin subset, weights 400 and 600, about 41 KB of woff2), self-hosted
  with `font-display: swap` and its SIL OFL licence shipped next to the files. It is not
  preloaded: a preload made the first content on the mobile profile 21% slower.
- **Vocabulary.** The site's own text does not use "side effects", "risk", "dangerous",
  "causes", "rate" or "likelihood" except inside an exact list of negating phrases ("does not
  measure incidence or risk", "not evidence that the medicine causes the reaction", ...). A
  phrase that breaks the rule is rewritten; the list is not widened.
- **Reporting pattern.** The concentration alert of `config/site.yaml` is shown on the site as
  "Reporting pattern". The configuration, the code and docs/limitations.md keep the technical
  name.
- **Same routes, same data.** The hash routes (`#/ingredient/<slug>/<reaction_key>`) are
  unchanged, and the redesign adds no data, no export field and no download. A view that
  would need data the export does not have is left out (the full country mix of a pair).
- **Repository text beats mockup text.** Every number on a page comes from the export or from
  arithmetic on it, and every sentence must agree with docs/limitations.md and the
  configuration. Where the mockup disagreed (invented counts, "pairs counted with at least one
  case", "curated synonyms" in the drug mapping), the repository's wording was used.
- **Method page.** A plain layer (`config/site.yaml` `method_page.plain`: what the numbers can
  and cannot tell, why a larger share is not proof, a glossary) comes before the sections of
  docs/limitations.md, which stays the source of the method and is shown collapsed.

## Consequences

New checks, run by `make site-ci` and `make lint`:

- `site/tests/unit/contrast.test.mjs` reads the tokens from the stylesheet and checks WCAG
  contrast in both themes (4.5:1 for text, 3:1 for marks).
- `site/tests/unit/vocabulary.test.mjs` scans every site-authored string (page shell, scripts,
  `config/site.yaml`, the RxNorm attribution and the docs/limitations.md sections shown on the
  site) and checks that each allowed phrase is still used.
- The browser tests run axe (WCAG 2.2 A and AA) on every page in both themes, on desktop and
  mobile viewports.
- `scripts/check_docs.py` checks that the plain layer of the Method page states the thresholds
  of `config/signals.yaml`, `config/rxnorm.yaml` and the concentration alert.

Tokens the design did not define were derived and are checked by the contrast test:

- the border of inputs, buttons and chips (`--color-border`, `#7a7676` light, `#9a9696` dark);
- dividers as solid colors instead of a transparent ink (`#d2d0cf`, `#4a4747`), and the
  masthead rails drawn in the text color;
- the track of the share bars (`--color-track`) and the link hover (`--color-accent-800`).

The volume bars of the home list are darker than in the mockup: `#8a8686` (3.2:1 on the
background) instead of `#bab6b6`, which was 1.8:1, under the 3:1 needed for a mark.

Known limits:

- Without JavaScript the pages open in the light theme: the theme is set by a script before
  first paint, and the stylesheet has no `prefers-color-scheme` fallback.
- The pair page shows the pair's top country next to the same country in the ingredient, not
  the full country mix, because the export has only the top country.
