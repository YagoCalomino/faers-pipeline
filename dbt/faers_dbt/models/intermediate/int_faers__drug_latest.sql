-- Drug rows of the winning version, joined on (primaryid, source_quarter): primaryid alone
-- would also pick the copy of a republished primaryid from another quarter.
select
    c.caseid,
    dr.primaryid,
    dr.source_quarter,
    dr.drug_seq,
    dr.role_code,
    dr.drug_name_raw,
    dr.active_ingredient_raw,
    dr.drug_text_clean,
    dr.drug_text_source,
    dr.route
from {{ ref('int_faers__case_latest') }} as c
inner join {{ ref('stg_faers__drug') }} as dr
    on dr.primaryid = c.primaryid
   and dr.source_quarter = c.source_quarter
