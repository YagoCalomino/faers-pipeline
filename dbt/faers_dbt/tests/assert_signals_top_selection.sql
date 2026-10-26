-- mart_signals_top against mart_signals (period ALL, generic fallbacks excluded), per ingredient:
--   1. the ror_lcl list has min(by_ror_lcl, computable pairs) rows and the a list
--      min(by_a_evans, Evans pairs) rows;
--   2. no pair left out of a list beats the last pair in it (ror_lcl for the first list, a for
--      the second).
-- Returns the failing ingredients (empty = pass).
{%- set top = var('signals')['top'] %}

with base as (
    select *
    from {{ ref('mart_signals') }}
    where period_key = 'ALL' and not is_generic_fallback
),

top_rows as (
    select * from {{ ref('mart_signals_top') }}
),

expected as (
    select
        ingredient_id,
        least({{ top['by_ror_lcl'] }}, count(*) filter (is_computable))     as n_ror,
        least({{ top['by_a_evans'] }}, count(*) filter (is_signal_evans))   as n_evans
    from base
    group by ingredient_id
),

got as (
    select
        ingredient_id,
        count(*) filter (in_top_ror_lcl)                    as n_ror,
        count(*) filter (in_top_a_evans)                    as n_evans,
        min(ror_lcl) filter (in_top_ror_lcl)                as min_ror_lcl_in,
        min(a) filter (in_top_a_evans)                      as min_a_in
    from top_rows
    group by ingredient_id
),

left_out as (
    select
        b.ingredient_id,
        max(b.ror_lcl) filter (
            b.is_computable and not coalesce(t.in_top_ror_lcl, false)
        )                                                   as max_ror_lcl_out,
        max(b.a) filter (
            b.is_signal_evans and not coalesce(t.in_top_a_evans, false)
        )                                                   as max_a_out
    from base as b
    left join top_rows as t using (ingredient_id, reaction_key)
    group by b.ingredient_id
)

select
    e.ingredient_id,
    e.n_ror                                                 as expected_n_ror,
    coalesce(g.n_ror, 0)                                    as got_n_ror,
    e.n_evans                                               as expected_n_evans,
    coalesce(g.n_evans, 0)                                  as got_n_evans,
    g.min_ror_lcl_in,
    o.max_ror_lcl_out,
    g.min_a_in,
    o.max_a_out
from expected as e
left join got as g using (ingredient_id)
left join left_out as o using (ingredient_id)
where e.n_ror <> coalesce(g.n_ror, 0)
   or e.n_evans <> coalesce(g.n_evans, 0)
   or o.max_ror_lcl_out > g.min_ror_lcl_in
   or o.max_a_out > g.min_a_in
