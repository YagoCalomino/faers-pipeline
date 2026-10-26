-- RxNorm name map (rxnorm_enrich DAG), 1:1 with the Parquet file. Grain: (drug_text_clean,
-- ingredient_rxcui). A combination has one row per ingredient; an unresolved part becomes a
-- fallback ingredient FB:<part>.
select
    drug_text_clean,
    ingredient_rxcui,
    ingredient_name,
    match_type,
    lookup_term,
    rxcui,
    cast(approx_score as double)        as approx_score,
    cast(n_parts as integer)            as n_parts,
    name_match_type,
    rxnorm_version,
    resolved_at,
    built_at
from {{ source('rxnorm_raw', 'name_map') }}
