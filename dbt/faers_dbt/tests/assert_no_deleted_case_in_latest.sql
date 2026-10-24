-- (ii) No caseid of any deleted-cases file survives the deduplication.
select c.caseid
from {{ ref('int_faers__case_latest') }} as c
where c.caseid in (select caseid from {{ ref('stg_faers__deleted') }})
