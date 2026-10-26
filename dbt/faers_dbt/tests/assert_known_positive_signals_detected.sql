-- Positive known pairs (seed_known_signals, expected = positive) that fail: a >= 3, PRR >= 2
-- and ror_lcl > 1 are required (mart_known_signals_eval). Severity error: a failing positive
-- usually means a regression in drug-name mapping or deduplication, so the build fails and the
-- atomic swap keeps the previous warehouse. The failure is reported, never remapped.
-- Disabled on the ci target: the fixture lake is too small to hold these pairs.
{{ config(severity='error', enabled=(target.name != 'ci')) }}

select expected, ingredient_name, reaction_pt, a, prr, ror_lcl, chi2, is_signal_evans,
       a_fallback_same_name, failure_reason
from {{ ref('mart_known_signals_eval') }}
where expected = 'positive' and not passed
