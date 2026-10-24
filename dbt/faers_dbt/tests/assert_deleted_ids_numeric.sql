{{ config(severity='warn') }}
-- Lists deleted-file values that are not numeric (dropped by stg_faers__deleted); the test
-- result count is the number of such values.
select quarter, caseid
from {{ source('faers_raw', 'deleted') }}
where not regexp_full_match(trim(caseid), '[0-9]+')
