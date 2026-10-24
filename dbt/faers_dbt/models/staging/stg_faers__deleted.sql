-- Non-numeric values are dropped here and counted by the test assert_deleted_ids_numeric
-- (severity warn). The same caseid can be listed in more than one quarter's file.
select
    cast(trim(caseid) as bigint)                    as caseid,
    quarter                                         as source_quarter
from {{ source('faers_raw', 'deleted') }}
where regexp_full_match(trim(caseid), '[0-9]+')
