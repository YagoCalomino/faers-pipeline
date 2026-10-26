-- Drug rows of the winning version, joined on (primaryid, source_quarter): primaryid alone
-- would also pick the copy of a republished primaryid from another quarter.
-- drug_line_seq numbers the lines of one drug position (case, drug_seq): a position can have
-- several lines that differ only in dosage fields. It is computed once here so every model
-- downstream (fct_case_drug, int_faers__drug_resolved) uses the same line identity.
select
    c.caseid,
    dr.primaryid,
    dr.source_quarter,
    dr.drug_seq,
    row_number() over (
        partition by c.caseid, dr.drug_seq
        order by dr.route nulls last, dr.drug_name_raw nulls last
    )                                               as drug_line_seq,
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
