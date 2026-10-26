-- Fallback is always marked: match_type = 'fallback' exactly when the ingredient is not an
-- RxNorm RxCUI (FB:<text> or the unknown member), in the name map, the resolved lines, the
-- bridge and the ingredient dimension.
select 'stg_rxnorm__name_map' as model, drug_text_clean as key, ingredient_rxcui as id, match_type
from {{ ref('stg_rxnorm__name_map') }}
where (match_type = 'fallback') <> starts_with(ingredient_rxcui, 'FB:')

union all

select 'int_faers__drug_resolved', drug_text_clean, ingredient_id, match_type
from {{ ref('int_faers__drug_resolved') }}
where (match_type = 'fallback')
   <> (starts_with(ingredient_id, 'FB:') or ingredient_id = {{ unknown_member() }})

union all

select 'bridge_drug_ingredient', drug_key, ingredient_id, match_type
from {{ ref('bridge_drug_ingredient') }}
where (match_type = 'fallback')
   <> (starts_with(ingredient_id, 'FB:') or ingredient_id = {{ unknown_member() }})

union all

select 'dim_ingredient', ingredient_id, ingredient_id, best_match_type
from {{ ref('dim_ingredient') }}
where (best_match_type = 'fallback') <> (is_fallback or is_unknown)
   or (is_generic_fallback and not is_fallback)
