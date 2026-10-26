-- Drug lines of the winning versions with their ingredients. Grain: (caseid, drug_seq,
-- drug_line_seq, ingredient_id): a combination line has one row per ingredient, so counts of
-- cases per ingredient must use count(distinct caseid), never count(*).
-- Lines whose text is not in the name map (outside the lookup scope, or not looked up yet)
-- get a fallback ingredient FB:<drug_text_clean>; lines with no text at all, the unknown member.
select
    l.caseid,
    l.primaryid,
    l.source_quarter,
    l.drug_seq,
    l.drug_line_seq,
    l.role_code,
    l.drug_text_clean,
    l.drug_text_source,
    {{ dbt_utils.generate_surrogate_key([drug_natural_key('l.active_ingredient_raw')]) }}
                                                    as drug_key,
    coalesce(
        m.ingredient_rxcui,
        {{ fallback_ingredient_id('l.drug_text_clean') }},
        {{ unknown_member() }}
    )                                               as ingredient_id,
    coalesce(m.ingredient_name, l.drug_text_clean, {{ unknown_member() }})
                                                    as ingredient_name,
    coalesce(m.match_type, 'fallback')              as match_type,
    coalesce(m.name_match_type, 'fallback')         as name_match_type,
    m.drug_text_clean is not null                   as is_in_name_map,
    m.lookup_term,
    m.n_parts
from {{ ref('int_faers__drug_latest') }} as l
left join {{ ref('stg_rxnorm__name_map') }} as m
    on m.drug_text_clean = l.drug_text_clean
