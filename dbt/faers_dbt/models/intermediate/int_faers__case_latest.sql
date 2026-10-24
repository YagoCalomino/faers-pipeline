-- One row per caseid: the latest version among all loaded quarters. Cases listed in any
-- deleted-cases file are removed entirely (every version, every quarter).
with deleted as (
    select distinct caseid from {{ ref('stg_faers__deleted') }}
),

ranked as (
    select
        d.*,
        row_number() over (
            partition by d.caseid
            order by d.case_version desc,
                     d.fda_date desc nulls last,
                     d.source_quarter desc,
                     d.primaryid desc
        ) as version_rank
    from {{ ref('stg_faers__demo') }} as d
    where not exists (select 1 from deleted as x where x.caseid = d.caseid)
)

select
    caseid,
    primaryid,
    source_quarter,
    case_version,
    {{ quarter_label('init_fda_date') }}            as init_quarter,
    {{ quarter_label('init_fda_date') }}
        between '{{ var("window_start_quarter") }}' and '{{ var("window_end_quarter") }}'
                                                    as is_init_in_window,
    init_or_followup,
    event_date,
    fda_date,
    init_fda_date,
    age_value,
    age_unit,
    age_years,
    age_group,
    sex,
    reporter_country,
    occurrence_country
from ranked
where version_rank = 1
