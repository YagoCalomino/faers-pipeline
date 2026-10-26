-- Proof that ingredient counts must be distinct cases, and that the model uses them:
--   1. the resolved lines have more rows than drug lines (combinations fan out), and some
--      ingredient has more signal-role rows than distinct cases: a count of rows would
--      overstate it;
--   2. dim_ingredient.n_cases_signal_roles equals count(distinct caseid) recomputed here, and
--      never exceeds the rows or the total number of cases.
-- Returns one row per broken expectation.
with resolved as (
    select * from {{ ref('int_faers__drug_resolved') }}
    where role_code in ({{ signal_roles_sql() }})
),

recount as (
    select ingredient_id, count(*) as n_rows, count(distinct caseid) as n_cases
    from resolved group by ingredient_id
),

checks as (
    select
        'combinations fan out: resolved rows > drug lines' as expectation,
        (select count(*) from {{ ref('int_faers__drug_resolved') }})
            > (select count(*) from {{ ref('int_faers__drug_latest') }}) as ok
    union all
    select
        'some ingredient has more rows than distinct cases',
        exists (select 1 from recount where n_rows > n_cases)
    union all
    select
        'dim_ingredient counts distinct cases',
        not exists (
            select 1
            from {{ ref('dim_ingredient') }} as d
            left join recount as r using (ingredient_id)
            where d.n_cases_signal_roles <> coalesce(r.n_cases, 0)
               or d.n_cases_signal_roles > d.n_signal_role_rows
               or d.n_cases_signal_roles > (select count(*) from {{ ref('fct_case') }})
        )
)

select expectation from checks where not ok
