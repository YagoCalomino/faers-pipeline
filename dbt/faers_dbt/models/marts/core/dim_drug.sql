-- One row per cleaned prod_ai of the winning versions, plus the unknown member (drug lines
-- without prod_ai). The RxNorm ingredient is resolved on top of it without changing this grain.
with lines as (
    select
        {{ drug_natural_key('active_ingredient_raw') }} as prod_ai_clean,
        drug_name_raw
    from {{ ref('int_faers__drug_latest') }}
),

name_counts as (
    select prod_ai_clean, drug_name_raw, count(*) as n
    from lines
    group by prod_ai_clean, drug_name_raw
),

members as (
    select
        prod_ai_clean,
        sum(n)                                          as n_drug_lines,
        -- Most frequent raw name; ties broken alphabetically so the build is deterministic.
        first(drug_name_raw order by n desc, drug_name_raw asc nulls last)
                                                        as most_common_drug_name_raw
    from name_counts
    group by prod_ai_clean

    union all

    -- The unknown member exists even when every line has a prod_ai.
    select {{ unknown_member() }}, 0, null
    where not exists (select 1 from lines where prod_ai_clean = {{ unknown_member() }})
)

select
    {{ dbt_utils.generate_surrogate_key(['prod_ai_clean']) }} as drug_key,
    prod_ai_clean,
    most_common_drug_name_raw,
    n_drug_lines,
    prod_ai_clean = {{ unknown_member() }}              as is_unknown
from members
