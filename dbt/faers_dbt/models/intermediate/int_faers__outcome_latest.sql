-- Outcome rows of the winning version, joined on (primaryid, source_quarter).
select
    c.caseid,
    o.primaryid,
    o.source_quarter,
    o.outcome_code
from {{ ref('int_faers__case_latest') }} as c
inner join {{ ref('stg_faers__outc') }} as o
    on o.primaryid = c.primaryid
   and o.source_quarter = c.source_quarter
