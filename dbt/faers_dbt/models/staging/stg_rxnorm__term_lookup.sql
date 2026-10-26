-- RxNorm lookup cache (rxnorm_enrich DAG), 1:1 with the Parquet file. Grain: (lookup_term,
-- ingredient_rxcui); not_found and error terms have one row without ingredient.
select
    lookup_term,
    status,
    match_type,
    rxcui,
    candidate_name,
    ingredient_rxcui,
    ingredient_name,
    cast(approx_score as double)        as approx_score,
    cast(approx_rank as integer)        as approx_rank,
    cast(n_rxcuis as integer)           as n_rxcuis,
    note,
    rxnorm_version,
    api_version,
    resolved_at
from {{ source('rxnorm_raw', 'term_lookup') }}
