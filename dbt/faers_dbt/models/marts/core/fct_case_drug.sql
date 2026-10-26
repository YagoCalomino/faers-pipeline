-- One row per DRUG line of the winning version. A drug position (case_id, drug_seq) can have
-- several lines that differ only in dosage fields (dose, route, frequency, lot); role and
-- product stay the same within a position (test assert_drug_position_consistent).
-- drug_line_seq (from int_faers__drug_latest) numbers those lines; rows that tie on its
-- ordering columns are identical in every column kept here.
select
    d.caseid                                            as case_id,
    d.drug_seq,
    d.drug_line_seq,
    {{ dbt_utils.generate_surrogate_key([drug_natural_key('d.active_ingredient_raw')]) }}
                                                        as drug_key,
    d.role_code,
    d.route,
    d.drug_name_raw,
    d.active_ingredient_raw,
    d.drug_text_clean,
    d.primaryid,
    d.source_quarter
from {{ ref('int_faers__drug_latest') }} as d
