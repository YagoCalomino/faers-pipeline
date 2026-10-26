-- dim_drug (cleaned prod_ai) -> dim_ingredient. Grain: (drug_key, ingredient_key). A
-- combination prod_ai has one row per ingredient; a prod_ai without an accepted match maps to
-- its fallback ingredient FB:<prod_ai>; the unknown drug maps to the unknown ingredient.
-- fct_case_drug keeps its grain: join through this bridge and count distinct cases.
with resolved as (
    select
        d.drug_key,
        case when d.is_unknown then {{ unknown_member() }}
             else coalesce(m.ingredient_rxcui, {{ fallback_ingredient_id('d.prod_ai_clean') }})
        end                                             as ingredient_id,
        coalesce(m.match_type, 'fallback')              as match_type,
        m.lookup_term,
        coalesce(m.n_parts, 1)                          as n_parts
    from {{ ref('dim_drug') }} as d
    left join {{ ref('stg_rxnorm__name_map') }} as m
        on m.drug_text_clean = d.prod_ai_clean
       and not d.is_unknown
)

select
    r.drug_key,
    i.ingredient_key,
    r.ingredient_id,
    r.match_type,
    i.is_generic_fallback,
    r.lookup_term,
    r.n_parts
from resolved as r
left join {{ ref('dim_ingredient') }} as i using (ingredient_id)
