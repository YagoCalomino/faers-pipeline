-- int_faers__drug_resolved has every drug line of int_faers__drug_latest (at least one
-- ingredient row each, none invented), every drug_key of dim_drug has a bridge row, and
-- fct_case_drug keeps its row count.
select 'resolved distinct lines' as check_name, actual, expected
from (
    select
        (select count(*) from (select distinct caseid, drug_seq, drug_line_seq
                               from {{ ref('int_faers__drug_resolved') }})) as actual,
        (select count(*) from {{ ref('int_faers__drug_latest') }}) as expected
)
where actual <> expected

union all

select 'dim_drug keys without a bridge row', count(*), 0
from {{ ref('dim_drug') }} as d
where not exists (select 1 from {{ ref('bridge_drug_ingredient') }} as b
                  where b.drug_key = d.drug_key)
having count(*) > 0

union all

select 'fct_case_drug rows', actual, expected
from (
    select
        (select count(*) from {{ ref('fct_case_drug') }}) as actual,
        (select count(*) from {{ ref('int_faers__drug_latest') }}) as expected
)
where actual <> expected
