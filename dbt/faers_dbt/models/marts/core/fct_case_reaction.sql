-- One row per REAC line of the winning version. The source repeats some (case, PT) lines,
-- mostly as exact copies; reaction_line_seq numbers them so every row has a unique key.
-- Case-level counts should use distinct (case_id, reaction_key).
select
    r.caseid                                            as case_id,
    {{ dbt_utils.generate_surrogate_key([reaction_natural_key('r.reaction_pt')]) }}
                                                        as reaction_key,
    row_number() over (
        partition by r.caseid, r.reaction_pt
        order by r.drug_rechallenge_action nulls last
    )                                                   as reaction_line_seq,
    r.drug_rechallenge_action,
    r.primaryid,
    r.source_quarter
from {{ ref('int_faers__reaction_latest') }} as r
