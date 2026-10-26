-- Top reactions per ingredient in the period ALL, for the site. Ranking: config/signals.yaml
-- top.order_by (ror_lcl or prr, descending), ties by a (descending) then reaction PT; only
-- computable pairs (a >= signal_min_cases already holds in mart_signals). Generic fallback
-- ingredients (HERBALS, VITAMINS, DEVICE, ...) are left out.
-- trend: one element per window quarter where the pair reached signal_min_cases (a quarter
-- missing from the list had fewer cases).
{%- set top = var('signals')['top'] %}
{%- if top['order_by'] not in ('ror_lcl', 'prr') %}
    {{ exceptions.raise_compiler_error("signals.top.order_by must be ror_lcl or prr, got " ~ top['order_by']) }}
{%- endif %}

with all_period as (
    select *
    from {{ ref('mart_signals') }}
    where period_key = 'ALL'
      and is_computable
      and not is_generic_fallback
),

ranked as (
    select
        *,
        row_number() over (
            partition by ingredient_id
            order by {{ top['order_by'] }} desc, a desc, reaction_pt
        )                                                   as rank_in_ingredient
    from all_period
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
    r.ingredient_key,
    r.ingredient_id,
    r.ingredient_name,
    r.reaction_key,
    r.reaction_pt,
    r.rank_in_ingredient,
    '{{ top["order_by"] }}'                                 as ranked_by,
    r.a,
    r.n_drug,
    r.prr,
    r.prr_lcl,
    r.prr_ucl,
    r.ror,
    r.ror_lcl,
    r.ror_ucl,
    r.chi2,
    r.is_signal_evans,
    r.is_signal_ror,
    r.match_type,
    r.is_fallback,
    t.trend
from ranked as r
left join trend as t using (ingredient_id, reaction_key)
where r.rank_in_ingredient <= {{ top['n_per_ingredient'] }}
