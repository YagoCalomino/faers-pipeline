-- Known pairs that fail their expectation (mart_known_signals_eval): positives without a >= 3,
-- PRR >= 2 and ror_lcl > 1; negative controls flagged by Evans. Severity warn: a failure is a
-- finding to review (spelling, ingredient split across fallback texts, real absence), reported
-- by the build without blocking the warehouse swap and without any automatic remapping.
-- Disabled on the ci target: the fixture lake is too small to hold these pairs.
{{ config(severity='warn', enabled=(target.name != 'ci')) }}

select expected, ingredient_name, reaction_pt, a, prr, ror_lcl, chi2, is_signal_evans,
       a_fallback_same_name, failure_reason
from {{ ref('mart_known_signals_eval') }}
where not passed
