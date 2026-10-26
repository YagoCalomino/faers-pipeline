-- One row per deduplicated case (int_faers__case_latest). quarter_key = init_quarter (ADR 0001);
-- source_quarter is lineage only.
with outcomes as (
    select
        caseid,
        true                                            as is_serious,
        bool_or(outcome_code = 'DE')                    as is_death
    from {{ ref('int_faers__outcome_latest') }}
    group by caseid
)

select
    c.caseid                                            as case_id,
    c.primaryid,
    coalesce(c.init_quarter, {{ unknown_member() }})    as quarter_key,
    c.source_quarter,
    coalesce(c.is_init_in_window, false)                as is_in_window,
    c.case_version,
    c.init_or_followup,
    c.event_date,
    c.fda_date,
    c.init_fda_date,
    c.sex,
    c.age_value,
    c.age_unit,
    c.age_years,
    c.age_group,
    c.reporter_country,
    c.occurrence_country,
    c.reporter_occupation,
    coalesce(o.is_serious, false)                       as is_serious,
    coalesce(o.is_death, false)                         as is_death
from {{ ref('int_faers__case_latest') }} as c
left join outcomes as o on o.caseid = c.caseid
