-- mart_signals counts distinct cases, recomputed here from the facts for the period ALL:
--   n_total = cases in fct_case;
--   n_drug  = distinct cases with the ingredient in a signal-role line (int_faers__drug_resolved);
--   n_reac  = distinct cases with the PT (fct_case_reaction).
-- And for an ingredient that comes from combination products, the distinct-case count is lower
-- than its row count in int_faers__drug_resolved (counting rows would overstate it).
with all_rows as (
    select * from {{ ref('mart_signals') }} where period_key = 'ALL'
),

drug_recount as (
    select ingredient_id, count(distinct caseid) as n_cases, count(*) as n_rows,
           bool_or(n_parts > 1) as from_combination
    from {{ ref('int_faers__drug_resolved') }}
    where role_code in ({{ signal_roles_sql() }})
    group by ingredient_id
),

reac_recount as (
    select reaction_key, count(distinct case_id) as n_cases
    from {{ ref('fct_case_reaction') }}
    group by reaction_key
),

checks as (
    select 'n_total = cases in fct_case' as expectation,
           not exists (select 1 from all_rows
                       where n_total <> (select count(*) from {{ ref('fct_case') }})) as ok
    union all
    select 'n_drug = distinct cases with the ingredient',
           not exists (select 1 from all_rows as s join drug_recount as d using (ingredient_id)
                       where s.n_drug <> d.n_cases)
    union all
    select 'n_reac = distinct cases with the reaction',
           not exists (select 1 from all_rows as s join reac_recount as r using (reaction_key)
                       where s.n_reac <> r.n_cases)
    union all
    select 'a combination ingredient in mart_signals has fewer cases than rows',
           -- vacuous when the build has no combination ingredient with a stored pair
           not exists (select 1 from all_rows as s join drug_recount as d using (ingredient_id)
                       where d.from_combination)
           or exists (select 1 from all_rows as s join drug_recount as d using (ingredient_id)
                      where d.from_combination and s.n_drug < d.n_rows)
)

select expectation from checks where not ok
