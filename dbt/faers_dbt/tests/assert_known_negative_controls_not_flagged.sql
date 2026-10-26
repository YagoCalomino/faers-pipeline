-- Negative controls (seed_known_signals, expected = negative) flagged by the Evans criterion.
-- Severity warn: a negative control is a sanity check that new data can legitimately move, so
-- the build reports it without blocking the warehouse swap. Never corrected automatically.
-- Disabled on the ci target: the fixture lake is too small to hold these pairs.
{{ config(severity='warn', enabled=(target.name != 'ci')) }}

select expected, ingredient_name, reaction_pt, a, prr, ror_lcl, chi2, is_signal_evans,
       failure_reason
from {{ ref('mart_known_signals_eval') }}
where expected = 'negative' and not passed
