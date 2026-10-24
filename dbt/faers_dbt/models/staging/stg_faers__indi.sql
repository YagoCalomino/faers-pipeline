select
    cast(primaryid as bigint)                       as primaryid,
    cast(caseid as bigint)                          as caseid,
    cast(indi_drug_seq as integer)                  as indi_drug_seq,
    {{ nullif_blank('indi_pt') }}                   as indication_pt,
    quarter                                         as source_quarter
from {{ source('faers_raw', 'indi') }}
