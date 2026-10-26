-- One row per calendar quarter from the earliest init_quarter of the loaded cases up to the
-- window end, flagged with is_in_window from the window vars. Two extra periods: 'ALL' (every
-- loaded case, in or before the window) and the unknown member.
{% set window_start = "'" ~ var('window_start_quarter') ~ "'" %}
{% set window_end = "'" ~ var('window_end_quarter') ~ "'" %}

with bounds as (
    select
        least(
            min({{ quarter_start_date('init_quarter') }}),
            {{ quarter_start_date(window_start) }}
        )                                               as first_start,
        {{ quarter_start_date(window_end) }}            as last_start
    from {{ ref('int_faers__case_latest') }}
),

quarters as (
    select cast(unnest(generate_series(first_start, last_start, interval 3 month)) as date)
        as start_date
    from bounds
)

select
    {{ quarter_label('start_date') }}                   as quarter_key,
    year(start_date)                                    as year,
    quarter(start_date)                                 as quarter_number,
    start_date,
    cast(start_date + interval 3 month - interval 1 day as date) as end_date,
    'quarter'                                           as period_type,
    {{ quarter_label('start_date') }} between {{ window_start }} and {{ window_end }}
                                                        as is_in_window
from quarters

union all

select
    'ALL', null, null,
    (select cast(first_start as date) from bounds),
    cast({{ quarter_start_date(window_end) }} + interval 3 month - interval 1 day as date),
    'all', null

union all

select {{ unknown_member() }}, null, null, null, null, 'unknown', false
