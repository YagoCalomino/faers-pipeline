-- Disproportionality (PRR, ROR) per (period, ingredient, reaction PT), in distinct cases.
-- Periods: each quarter of the window (quarter_key = init quarter, ADR 0001) and ALL (every
-- loaded case, including cases first received before the window).
--
-- 2x2 table per pair, all counts are distinct cases of the period:
--   a = cases with the ingredient (signal roles) and the reaction
--   b = n_drug - a,  c = n_reac - a,  d = n_total - n_drug - n_reac + a
-- n_drug, n_reac and n_total are counted over ALL cases of the period (consistent universe),
-- so a + b + c + d = n_total (tested).
--
-- The case-level pairs (case, ingredient, reaction) are built once and counted once per
-- (window quarter, ingredient, reaction), cases before the window in their own group; ALL is the
-- sum of those groups. Equivalent to GROUPING SETS ((quarter, pair), (pair)), with a smaller
-- footprint (measured on the 8 quarters: 3.8 s and 1.3 GB against 6.9 s and 1.5 GB). A case
-- with a combination product counts once for each of its ingredients.
with cases as (
    select
        case_id,
        case when is_in_window then quarter_key end         as window_quarter
    from {{ ref('fct_case') }}
),

-- Dense integer ids for the grouping keys: the aggregation runs on ~29 million case-level
-- pairs, and integer keys keep its hash tables within the DuckDB memory limit.
ingredient_ids as (
    select ingredient_id, row_number() over (order by ingredient_id) as ing_n
    from {{ ref('dim_ingredient') }}
),

reaction_ids as (
    select reaction_key, row_number() over (order by reaction_key) as reac_n
    from {{ ref('dim_reaction') }}
),

drug_cases as (
    select d.case_id, i.ing_n, d.window_quarter
    from {{ ref('int_signals__drug_cases') }} as d
    inner join ingredient_ids as i using (ingredient_id)
),

reac_cases as (
    select r.case_id, x.reac_n
    from {{ ref('int_signals__reaction_cases') }} as r
    inner join reaction_ids as x using (reaction_key)
),

pairs_by_quarter as (               -- one pass over the case-level pairs
    select d.window_quarter, d.ing_n, r.reac_n, count(*) as a
    from drug_cases as d
    inner join reac_cases as r using (case_id)
    group by d.window_quarter, d.ing_n, r.reac_n
),

pair_counts as (
    select window_quarter as period_key, ing_n, reac_n, a
    from pairs_by_quarter
    where window_quarter is not null and a >= {{ var('signal_min_cases') }}
    union all
    select 'ALL', ing_n, reac_n, sum(a)
    from pairs_by_quarter
    group by ing_n, reac_n
    having sum(a) >= {{ var('signal_min_cases') }}
),

drug_by_quarter as (
    select window_quarter, ing_n, count(*) as n
    from drug_cases group by window_quarter, ing_n
),

drug_counts as (
    select window_quarter as period_key, ing_n, n as n_drug
    from drug_by_quarter where window_quarter is not null
    union all
    select 'ALL', ing_n, sum(n) from drug_by_quarter group by ing_n
),

reac_by_quarter as (
    select c.window_quarter, r.reac_n, count(*) as n
    from reac_cases as r inner join cases as c using (case_id)
    group by c.window_quarter, r.reac_n
),

reac_counts as (
    select window_quarter as period_key, reac_n, n as n_reac
    from reac_by_quarter where window_quarter is not null
    union all
    select 'ALL', reac_n, sum(n) from reac_by_quarter group by reac_n
),

totals as (
    select window_quarter as period_key, count(*) as n_total
    from cases where window_quarter is not null group by window_quarter
    union all
    select 'ALL', count(*) from cases
),

cells as (
    select
        p.period_key,
        i.ingredient_id,
        r.reaction_key,
        p.a,
        dc.n_drug - p.a                                     as b,
        rc.n_reac - p.a                                     as c,
        t.n_total - dc.n_drug - rc.n_reac + p.a             as d,
        dc.n_drug,
        rc.n_reac,
        t.n_total
    from pair_counts as p
    inner join drug_counts as dc using (period_key, ing_n)
    inner join reac_counts as rc using (period_key, reac_n)
    inner join totals as t using (period_key)
    inner join ingredient_ids as i using (ing_n)
    inner join reaction_ids as r using (reac_n)
),

stats as (
    select
        *,
        {{ prr('a', 'b', 'c', 'd') }}                       as prr,
        {{ se_ln_prr('a', 'b', 'c', 'd') }}                 as se_ln_prr,
        {{ ror('a', 'b', 'c', 'd') }}                       as ror,
        {{ se_ln_ror('a', 'b', 'c', 'd') }}                 as se_ln_ror,
        {{ chi2('a', 'b', 'c', 'd') }}                      as chi2
    from cells
),

{%- set evans = var('signals')['thresholds']['evans'] %}
{%- set ror_t = var('signals')['thresholds']['ror'] %}

flagged as (
    select
        *,
        {{ ci_lower('prr', 'se_ln_prr') }}                  as prr_lcl,
        {{ ci_upper('prr', 'se_ln_prr') }}                  as prr_ucl,
        {{ ci_lower('ror', 'se_ln_ror') }}                  as ror_lcl,
        {{ ci_upper('ror', 'se_ln_ror') }}                  as ror_ucl,
        prr is not null and ror is not null                 as is_computable
    from stats
)

select
    f.period_key,
    i.ingredient_key,
    f.ingredient_id,
    i.ingredient_name,
    f.reaction_key,
    r.reaction_pt,
    f.a,
    f.b,
    f.c,
    f.d,
    f.n_drug,
    f.n_reac,
    f.n_total,
    f.prr,
    f.prr_lcl,
    f.prr_ucl,
    f.ror,
    f.ror_lcl,
    f.ror_ucl,
    f.chi2,
    f.is_computable,
    coalesce(
        f.a >= {{ evans['min_cases'] }} and f.prr >= {{ evans['min_prr'] }}
        and f.chi2 >= {{ evans['min_chi2'] }},
        false
    )                                                       as is_signal_evans,
    coalesce(
        f.a >= {{ ror_t['min_cases'] }} and f.ror_lcl > {{ ror_t['min_ror_lcl'] }},
        false
    )                                                       as is_signal_ror,
    -- The latest quarter is provisional: its cohort still grows as later files arrive.
    f.period_key = '{{ var("window_end_quarter") }}'        as is_provisional_period,
    i.best_match_type                                       as match_type,
    i.is_fallback,
    i.is_generic_fallback
from flagged as f
inner join {{ ref('dim_ingredient') }} as i using (ingredient_id)
inner join {{ ref('dim_reaction') }} as r using (reaction_key)
