# Calibration evidence

## `rxnorm_calibration_sample.csv`

The manually labelled sample behind `approximate_rules.min_score` in `config/rxnorm.yaml`
(labelled 2026-10-26). 60 FAERS `prod_ai` terms (PS/SS drug lines) and the RxNav answer for
each: 20 approximate matches, 10 exact, 10 normalized and 20 terms left as `not_found`.
Results and conclusions: [limitations.md](../limitations.md), "Approximate matching is off".

| Column | Meaning |
|---|---|
| `sample_group` | Stratum of the sample: `approximate`, `exact`, `normalized` or `not_found`. |
| `prod_ai_term` | Cleaned FAERS active-ingredient text (upper case, trimmed, inner spaces collapsed). |
| `rxcui` | RxCUI returned by RxNav for the term (the candidate). |
| `candidate_name` | Name of the approximate-match candidate. |
| `ingredient_rxcuis`, `ingredients` | Ingredient(s) (TTY IN) the candidate resolves to; `+` separates several. |
| `match_type` | How RxNav matched: `exact`, `normalized` or `approximate`. |
| `score` | RxNav approximate-match score (approximate candidates only). |
| `note` | Why a term stayed `not_found` (ambiguous candidates, no candidate). |
| `correct_yes_no` | Manual mark: is the outcome right for signal detection (the mapped ingredient, or `not_found`)? |
| `comment` | Reason for the mark; written in Portuguese at labelling time and translated for this file. |
