select
    cast(primaryid as bigint)                       as primaryid,
    cast(caseid as bigint)                          as caseid,
    {{ nullif_blank('upper(outc_cod)') }}           as outcome_code,
    quarter                                         as source_quarter
from {{ source('faers_raw', 'outc') }}
