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
-- Concentration, over the pair's cases (the a cases of ALL), to spot reporting artefacts:
-- top_country / top_quarter are the most frequent reporter country (blank and placeholder
-- values such as COUNTRY NOT SPECIFIED left out) and init quarter (quarter_key), ties by the
-- smaller value; their shares are over all a cases. median_reactions_per_case is the median
-- number of distinct PTs of those cases.
-- The same country, over all the ingredient's cases (its n_drug PS/SS cases), for comparison:
-- ingredient_top_country and its share, and ingredient_country_share, the share of the
-- ingredient's cases from the pair's top_country (0 when top_country is null). Shares are over
-- n_drug, blank and placeholder countries included in the denominator as for the pair.
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

-- Concentration. The pair's cases come from one join of (case, ingredient) with (case, reaction)
-- on case_id, ~29 million rows like mart_signals, kept when the combined integer key
-- ingredient x reaction is a top pair. The key needs both sides, so the filter cannot be moved
-- below that join: a plan that first joined the cases of each ingredient with its top pairs
-- spilled over 20 GB to disk and stalled (faers_transform, 2026-10-26).
top_pairs as (
    select ingredient_id, reaction_key
    from selected
    where in_top_ror_lcl or in_top_a_evans
),

ingredient_ids as (
    select ingredient_id, row_number() over (order by ingredient_id) as ing_n
    from (select distinct ingredient_id from top_pairs)
),

reaction_ids as (
    select reaction_key, row_number() over (order by reaction_key) as reac_n
    from (select distinct reaction_key from top_pairs)
),

key_base as (                       -- reac_n < key_base, so ing_n * key_base + reac_n is unique
    select count(*) + 1 as kb from reaction_ids
),

pair_keys as (
    select p.ingredient_id, p.reaction_key, i.ing_n * k.kb + r.reac_n as pair_key
    from top_pairs as p
    inner join ingredient_ids as i using (ingredient_id)
    inner join reaction_ids as r using (reaction_key)
    cross join key_base as k
),

pair_cases as (                     -- one row per (pair, case): the a cases of the pair
    select d.case_id, d.ing_n * (select kb from key_base) + r.reac_n as pair_key
    from (
        select d.case_id, i.ing_n
        from {{ ref('int_signals__drug_cases') }} as d
        inner join ingredient_ids as i using (ingredient_id)
    ) as d
    inner join (
        select r.case_id, x.reac_n
        from {{ ref('int_signals__reaction_cases') }} as r
        inner join reaction_ids as x using (reaction_key)
    ) as r using (case_id)
    where d.ing_n * (select kb from key_base) + r.reac_n in (select pair_key from pair_keys)
),

case_country as (                   -- every case: init quarter and reporter country
    select
        f.case_id,
        f.quarter_key,
        case when nullif(trim(f.reporter_country), '') is not null
              and not {{ is_placeholder('reporter_country', 'f.reporter_country') }}
             then f.reporter_country end                    as country
    from {{ ref('fct_case') }} as f
),

case_attributes as (                -- once per case of a top pair: country, quarter, reactions
    select
        c.case_id,
        f.quarter_key,
        f.country,
        n.n_reactions
    from (select distinct case_id from pair_cases) as c
    inner join case_country as f using (case_id)
    inner join (
        select case_id, count(*) as n_reactions
        from {{ ref('int_signals__reaction_cases') }}
        group by case_id
    ) as n using (case_id)
),

pair_case_attributes as (
    select pc.pair_key, ca.quarter_key, ca.country, ca.n_reactions
    from pair_cases as pc
    inner join case_attributes as ca using (case_id)
),

top_country as (
    select pair_key, country as top_country, n as top_country_cases
    from (
        select pair_key, country, count(*) as n
        from pair_case_attributes where country is not null
        group by pair_key, country
    )
    qualify row_number() over (partition by pair_key order by n desc, country) = 1
),

top_quarter as (
    select pair_key, quarter_key as top_quarter, n as top_quarter_cases
    from (
        select pair_key, quarter_key, count(*) as n
        from pair_case_attributes
        group by pair_key, quarter_key
    )
    qualify row_number() over (partition by pair_key order by n desc, quarter_key) = 1
),

concentration as (
    select
        p.ingredient_id,
        p.reaction_key,
        c.n_pair_cases,
        c.median_reactions_per_case,
        tc.top_country,
        tc.top_country_cases,
        tq.top_quarter,
        tq.top_quarter_cases
    from pair_keys as p
    left join (
        select pair_key, count(*) as n_pair_cases, median(n_reactions) as median_reactions_per_case
        from pair_case_attributes
        group by pair_key
    ) as c using (pair_key)
    left join top_country as tc using (pair_key)
    left join top_quarter as tq using (pair_key)
),

ingredient_countries as (           -- cases of each ingredient per known country
    select d.ingredient_id, cc.country, count(*) as n
    from {{ ref('int_signals__drug_cases') }} as d
    inner join ingredient_ids as i using (ingredient_id)
    inner join case_country as cc using (case_id)
    where cc.country is not null
    group by d.ingredient_id, cc.country
),

ingredient_top_country as (
    select ingredient_id, country as ingredient_top_country, n as ingredient_top_country_cases
    from ingredient_countries
    qualify row_number() over (partition by ingredient_id order by n desc, country) = 1
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
    c.top_country,
    coalesce(c.top_country_cases, 0) / s.a                  as top_country_share,
    c.top_quarter,
    c.top_quarter_cases / s.a                               as top_quarter_share,
    c.median_reactions_per_case,
    c.n_pair_cases,
    itc.ingredient_top_country,
    coalesce(itc.ingredient_top_country_cases, 0) / s.n_drug  as ingredient_top_country_share,
    coalesce(ic.n, 0) / s.n_drug                            as ingredient_country_share,
    t.trend
from selected as s
left join trend as t using (ingredient_id, reaction_key)
left join concentration as c using (ingredient_id, reaction_key)
left join ingredient_top_country as itc using (ingredient_id)
left join ingredient_countries as ic
    on ic.ingredient_id = s.ingredient_id and ic.country = c.top_country
where s.in_top_ror_lcl or s.in_top_a_evans
