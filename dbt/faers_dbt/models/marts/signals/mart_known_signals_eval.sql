-- Known pairs (seed_known_signals) against mart_signals in the period ALL. A report, not a fix:
-- a failure is listed with its reason (name not found, too few cases, statistic below the
-- threshold) and nothing is changed or remapped.
--   positive: passes with a >= evans.min_cases, PRR >= evans.min_prr and ror_lcl > ror.min_ror_lcl
--   negative: passes when the pair is not is_signal_evans (a pair below signal_min_cases is not)
-- Names match exactly (case-insensitive) a non-fallback dim_ingredient row and a dim_reaction PT.
-- a_fallback_same_name sums, for the same PT, the cases of fallback ingredients whose text
-- contains the ingredient name (pairs with at least signal_min_cases cases): a hint of cases
-- split from the RxNorm ingredient.
{%- set evans = var('signals')['thresholds']['evans'] %}
{%- set ror_t = var('signals')['thresholds']['ror'] %}

with seed as (
    select * from {{ ref('seed_known_signals') }}
),

matched as (
    select
        s.*,
        i.ingredient_id,
        r.reaction_key
    from seed as s
    left join {{ ref('dim_ingredient') }} as i
        on lower(i.ingredient_name) = lower(s.ingredient_name) and not i.is_fallback
    left join {{ ref('dim_reaction') }} as r
        on lower(r.reaction_pt) = lower(s.reaction_pt)
),

direct_a as (                       -- cases of pairs below signal_min_cases (not in mart_signals)
    select m.ingredient_id, m.reaction_key, count(*) as a
    from matched as m
    inner join {{ ref('int_signals__drug_cases') }} as d using (ingredient_id)
    inner join {{ ref('int_signals__reaction_cases') }} as rc
        on rc.case_id = d.case_id and rc.reaction_key = m.reaction_key
    group by m.ingredient_id, m.reaction_key
),

fallback_split as (
    select m.ingredient_name, m.reaction_pt, sum(ms.a) as a_fallback_same_name
    from matched as m
    inner join {{ ref('mart_signals') }} as ms
        on ms.period_key = 'ALL'
       and ms.is_fallback
       and ms.reaction_key = m.reaction_key
       and contains(lower(ms.ingredient_name), lower(m.ingredient_name))
    group by m.ingredient_name, m.reaction_pt
),

joined as (
    select
        m.expected,
        m.ingredient_name,
        m.reaction_pt,
        m.ingredient_id,
        m.reaction_key,
        m.reference,
        m.reference_status,
        coalesce(ms.a, da.a, 0)                             as a,
        ms.n_drug,
        ms.n_reac,
        ms.prr,
        ms.ror_lcl,
        ms.chi2,
        coalesce(ms.is_signal_evans, false)                 as is_signal_evans,
        coalesce(ms.is_signal_ror, false)                   as is_signal_ror,
        coalesce(fs.a_fallback_same_name, 0)                as a_fallback_same_name
    from matched as m
    left join {{ ref('mart_signals') }} as ms
        on ms.period_key = 'ALL'
       and ms.ingredient_id = m.ingredient_id
       and ms.reaction_key = m.reaction_key
    left join direct_a as da
        on da.ingredient_id = m.ingredient_id and da.reaction_key = m.reaction_key
    left join fallback_split as fs
        on fs.ingredient_name = m.ingredient_name and fs.reaction_pt = m.reaction_pt
),

reasons as (
    select
        *,
        case
            when ingredient_id is null then 'ingredient name not found'
            when reaction_key is null then 'reaction PT not found'
            when expected = 'positive' and a < {{ evans['min_cases'] }}
                then 'a < {{ evans["min_cases"] }}'
            when expected = 'positive' then nullif(concat_ws('; ',
                case when prr is null then 'PRR undefined'
                     when prr < {{ evans['min_prr'] }} then 'PRR < {{ evans["min_prr"] }}' end,
                case when ror_lcl is null then 'ror_lcl undefined'
                     when ror_lcl <= {{ ror_t['min_ror_lcl'] }}
                         then 'ror_lcl <= {{ ror_t["min_ror_lcl"] }}' end
            ), '')
            when is_signal_evans then 'negative control flagged by Evans'
        end                                                 as failure_reason
    from joined
)

select
    *,
    failure_reason is null                                  as passed
from reasons
