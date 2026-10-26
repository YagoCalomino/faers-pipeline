-- Top reactions per ingredient in the period ALL, for the site: the union of two lists
-- (config/signals.yaml top):
--   - by ror_lcl: the top `by_ror_lcl` computable pairs by ror_lcl descending, ties by a
--     descending then reaction PT;
--   - by a among Evans signals: the top `by_a_evans` pairs with is_signal_evans by a descending,
--     ties by ror_lcl descending then reaction PT.
-- A pair in both lists appears once. Generic fallback ingredients (HERBALS, VITAMINS, DEVICE,
-- ...) are left out. rank_ror_lcl is set for every computable pair, rank_a_evans for every
-- Evans pair, so both ranks are comparable across the two lists.
-- trend: one element per window quarter where the pair reached signal_min_cases (a quarter
-- missing from the list had fewer cases).
{%- set top = var('signals')['top'] %}

with all_period as (
    select *
    from {{ ref('mart_signals') }}
    where period_key = 'ALL'
      and not is_generic_fallback
      and (is_computable or is_signal_evans)
),

ranked as (
    select
        *,
        case when is_computable then row_number() over (
            partition by ingredient_id, is_computable
            order by ror_lcl desc, a desc, reaction_pt
        ) end                                               as rank_ror_lcl,
        case when is_signal_evans then row_number() over (
            partition by ingredient_id, is_signal_evans
            order by a desc, ror_lcl desc nulls last, reaction_pt
        ) end                                               as rank_a_evans
    from all_period
),

selected as (
    select
        *,
        coalesce(rank_ror_lcl <= {{ top['by_ror_lcl'] }}, false)  as in_top_ror_lcl,
        coalesce(rank_a_evans <= {{ top['by_a_evans'] }}, false)  as in_top_a_evans
    from ranked
),

trend as (
    select
        ingredient_id,
        reaction_key,
        list(struct_pack(period_key := period_key, a := a, prr := prr) order by period_key)
                                                            as trend
    from {{ ref('mart_signals') }}
    where period_key <> 'ALL'
    group by ingredient_id, reaction_key
)

select
    s.ingredient_key,
    s.ingredient_id,
    s.ingredient_name,
    s.reaction_key,
    s.reaction_pt,
    s.rank_ror_lcl,
    s.rank_a_evans,
    s.in_top_ror_lcl,
    s.in_top_a_evans,
    s.a,
    s.n_drug,
    s.n_reac,
    s.prr,
    s.prr_lcl,
    s.prr_ucl,
    s.ror,
    s.ror_lcl,
    s.ror_ucl,
    s.chi2,
    s.is_signal_evans,
    s.is_signal_ror,
    s.match_type,
    s.is_fallback,
    t.trend
from selected as s
left join trend as t using (ingredient_id, reaction_key)
where s.in_top_ror_lcl or s.in_top_a_evans
