-- One row per (case, outcome code) of the winning version.
select
    o.caseid                                            as case_id,
    coalesce(o.outcome_code, {{ unknown_member() }})    as outcome_code,
    o.primaryid,
    o.source_quarter
from {{ ref('int_faers__outcome_latest') }} as o
