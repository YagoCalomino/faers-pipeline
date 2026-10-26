-- One row per ingredient: RxNorm ingredients (IN RxCUI), fallback ingredients (FB:<text>, no
-- accepted RxNorm match) and the unknown member. Counts are over the drug lines of the winning
-- versions; n_cases_signal_roles counts distinct cases, never lines.
with resolved as (
    select * from {{ ref('int_faers__drug_resolved') }}
),

members as (
    select
        ingredient_id,
        min(ingredient_name)                                    as ingredient_name,
        -- Strongest layer seen for this ingredient (exact > normalized > approx > fallback).
        case min(case match_type when 'exact' then 0 when 'normalized' then 1
                                 when 'approx_accepted' then 2 else 3 end)
            when 0 then 'exact' when 1 then 'normalized' when 2 then 'approx_accepted'
            else 'fallback' end                                 as best_match_type,
        count(*)                                                as n_drug_line_rows,
        count(*) filter (role_code in ({{ signal_roles_sql() }}))
                                                                as n_signal_role_rows,
        count(distinct caseid) filter (role_code in ({{ signal_roles_sql() }}))
                                                                as n_cases_signal_roles
    from resolved
    group by ingredient_id

    union all

    -- The unknown member exists even when every line has a drug text.
    select {{ unknown_member() }}, {{ unknown_member() }}, 'fallback', 0, 0, 0
    where not exists (select 1 from resolved where ingredient_id = {{ unknown_member() }})
)

select
    {{ dbt_utils.generate_surrogate_key(['ingredient_id']) }}   as ingredient_key,
    ingredient_id,
    case when not starts_with(ingredient_id, 'FB:') and ingredient_id <> {{ unknown_member() }}
         then ingredient_id end                                 as ingredient_rxcui,
    ingredient_name,
    best_match_type,
    starts_with(ingredient_id, 'FB:')                           as is_fallback,
    {{ is_generic_fallback('ingredient_id', 'ingredient_name') }}
                                                                as is_generic_fallback,
    ingredient_id = {{ unknown_member() }}                      as is_unknown,
    n_drug_line_rows,
    n_signal_role_rows,
    n_cases_signal_roles
from members
