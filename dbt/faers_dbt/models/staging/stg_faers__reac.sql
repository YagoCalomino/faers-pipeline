select
    cast(primaryid as bigint)                       as primaryid,
    cast(caseid as bigint)                          as caseid,
    {{ nullif_blank('pt') }}                        as reaction_pt,
    {{ nullif_blank('upper(drug_rec_act)') }}       as drug_rechallenge_action,
    quarter                                         as source_quarter
from {{ source('faers_raw', 'reac') }}
