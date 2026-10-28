-- RxNorm coverage of the drug lines in the signal roles (var signal_drug_roles: PS, SS), per
-- period: each in-window quarter (quarter_key = init quarter, ADR 0001) and ALL (every loaded
-- case). Grain: (period_key, match_type, fallback_reason). A line counts once, with the
-- weakest layer among the parts of its name (a combination with one unresolved part is
-- fallback / partial_combination). Feeds the rxnorm_coverage group of mart_dq_metrics.
with lines as (
    select
        caseid,
        drug_seq,
        drug_line_seq,
        any_value(name_match_type)                      as match_type,
        bool_and(not is_in_name_map)                    as not_in_name_map,
        bool_or(match_type <> 'fallback')               as has_resolved_part,
        bool_or({{ is_generic_fallback('ingredient_id', 'ingredient_name') }})
                                                        as has_generic_fallback
    from {{ ref('int_faers__drug_resolved') }}
    where role_code in ({{ signal_roles_sql() }})
    group by caseid, drug_seq, drug_line_seq
),

periods as (
    select case_id as caseid, quarter_key as period_key
    from {{ ref('fct_case') }}
    where is_in_window
    union all
    select case_id, 'ALL' from {{ ref('fct_case') }}
),

classified as (
    select
        p.period_key,
        l.match_type,
        case
            when l.match_type <> 'fallback' then null
            when l.not_in_name_map then 'not_in_name_map'
            when l.has_resolved_part then 'partial_combination'
            else 'no_match'
        end                                             as fallback_reason,
        l.has_generic_fallback
    from lines as l
    inner join periods as p using (caseid)
)

select
    period_key,
    match_type,
    fallback_reason,
    match_type <> 'fallback'                            as is_normalized,
    count(*)                                            as n_lines,
    count(*) filter (has_generic_fallback)              as n_lines_generic_fallback,
    sum(count(*)) over (partition by period_key)        as n_lines_period,
    round(100.0 * count(*) / sum(count(*)) over (partition by period_key), 3)
                                                        as pct_lines
from classified
group by period_key, match_type, fallback_reason
