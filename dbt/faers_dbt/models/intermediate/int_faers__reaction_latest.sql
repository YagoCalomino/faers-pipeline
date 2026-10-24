-- Reaction rows of the winning version, joined on (primaryid, source_quarter).
select
    c.caseid,
    r.primaryid,
    r.source_quarter,
    r.reaction_pt,
    r.drug_rechallenge_action
from {{ ref('int_faers__case_latest') }} as c
inner join {{ ref('stg_faers__reac') }} as r
    on r.primaryid = c.primaryid
   and r.source_quarter = c.source_quarter
