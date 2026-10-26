-- No count of distinct cases per ingredient exceeds the number of cases of its period
-- (in-window quarters by quarter_key, and ALL), for the signal roles. Joining drug lines to a
-- combination's ingredients multiplies rows; a count of rows could exceed the period total,
-- a count of distinct cases cannot.
with periods as (
    select case_id as caseid, quarter_key as period_key from {{ ref('fct_case') }}
    where is_in_window
    union all
    select case_id, 'ALL' from {{ ref('fct_case') }}
),

period_cases as (
    select period_key, count(*) as n_cases from periods group by period_key
),

per_ingredient as (
    select p.period_key, r.ingredient_id, count(distinct r.caseid) as n_cases
    from {{ ref('int_faers__drug_resolved') }} as r
    inner join periods as p using (caseid)
    where r.role_code in ({{ signal_roles_sql() }})
    group by p.period_key, r.ingredient_id
)

select i.period_key, i.ingredient_id, i.n_cases, t.n_cases as period_cases
from per_ingredient as i
inner join period_cases as t using (period_key)
where i.n_cases > t.n_cases
