-- (iii) The winner of each caseid has its highest case_version and, on a tie, the latest
-- source_quarter among the rows with that version.
with candidates as (
    select d.*
    from {{ ref('stg_faers__demo') }} as d
    where d.caseid not in (select caseid from {{ ref('stg_faers__deleted') }})
),

best as (
    select caseid, max(case_version) as max_version
    from candidates
    group by caseid
),

best_quarter as (
    select c.caseid, b.max_version, max(c.source_quarter) as max_quarter
    from candidates as c
    inner join best as b on b.caseid = c.caseid and c.case_version = b.max_version
    group by c.caseid, b.max_version
)

select w.caseid, w.case_version, w.source_quarter, q.max_version, q.max_quarter
from {{ ref('int_faers__case_latest') }} as w
inner join best_quarter as q on q.caseid = w.caseid
where w.case_version <> q.max_version or w.source_quarter <> q.max_quarter
