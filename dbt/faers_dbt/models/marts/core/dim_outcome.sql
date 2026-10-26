-- FAERS outcome codes (seed, FDA ASC_NTS meaning text) plus the unknown member.
select
    outcome_code,
    outcome_description,
    outcome_code = 'DE'                                 as is_death,
    false                                               as is_unknown
from {{ ref('seed_outcome_codes') }}

union all

select {{ unknown_member() }}, 'Unknown or empty outcome code', false, true
