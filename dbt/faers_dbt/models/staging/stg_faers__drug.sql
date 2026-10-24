select
    cast(primaryid as bigint)                       as primaryid,
    cast(caseid as bigint)                          as caseid,
    cast(drug_seq as integer)                       as drug_seq,
    upper(trim(role_cod))                           as role_code,
    drugname                                        as drug_name_raw,
    prod_ai                                         as active_ingredient_raw,
    -- Lookup text for RxNorm (Phase 5): prod_ai, else drugname.
    coalesce({{ clean_text('prod_ai') }}, {{ clean_text('drugname') }}) as drug_text_clean,
    case
        when {{ clean_text('prod_ai') }} is not null then 'prod_ai'
        when {{ clean_text('drugname') }} is not null then 'drugname'
    end                                             as drug_text_source,
    {{ nullif_blank('upper(route)') }}              as route,
    quarter                                         as source_quarter
from {{ source('faers_raw', 'drug') }}
