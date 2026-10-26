-- Data-quality metrics for the site, one row per (period_basis, period_key, metric_group,
-- metric). period_basis says which quarter period_key is:
--   file_quarter  quarter of the FAERS file the rows came from (raw rows, role mix, dedup)
--   init_quarter  quarter of the case's first receipt (quarter_key, window only), as in the marts
--   all           every loaded quarter / case (period_key = 'ALL')
-- unit: rows, cases, lines or pct (0-100).
with demo as (
    select caseid, source_quarter from {{ ref('stg_faers__demo') }}
),

deleted as (
    select distinct caseid, source_quarter from {{ ref('stg_faers__deleted') }}
),

raw_rows as (
    {%- set files = [('demo', 'stg_faers__demo'), ('drug', 'stg_faers__drug'),
                     ('reac', 'stg_faers__reac'), ('outc', 'stg_faers__outc'),
                     ('indi', 'stg_faers__indi')] %}
    {%- for name, model in files %}
    select
        'file_quarter' as period_basis, source_quarter as period_key, 'raw_rows' as metric_group,
        '{{ name }}' as metric, count(*)::double as value, 'rows' as unit
    from {{ ref(model) }}
    group by source_quarter
    union all
    select 'all', 'ALL', 'raw_rows', '{{ name }}', count(*)::double, 'rows'
    from {{ ref(model) }}
    {%- if not loop.last %}
    union all
    {%- endif %}
    {%- endfor %}
),

dedup_quarter as (                  -- per file quarter: DEMO rows vs versions kept as winners
    select 'file_quarter' as period_basis, d.source_quarter as period_key,
           'deduplication' as metric_group, 'demo_rows' as metric,
           count(*)::double as value, 'rows' as unit
    from demo as d group by d.source_quarter
    union all
    select 'file_quarter', source_quarter, 'deduplication', 'winning_versions',
           count(*)::double, 'cases'
    from {{ ref('int_faers__case_latest') }} group by source_quarter
    union all
    select 'file_quarter', source_quarter, 'deduplication', 'deleted_ids_listed',
           count(*)::double, 'cases'
    from deleted group by source_quarter
    union all
    select 'file_quarter', x.source_quarter, 'deduplication', 'deleted_ids_found_in_demo',
           count(distinct x.caseid)::double, 'cases'
    from deleted as x where x.caseid in (select caseid from demo) group by x.source_quarter
),

dedup_all as (
    select
        count(*)                                                            as demo_rows,
        count(distinct caseid)                                              as distinct_caseids,
        count(distinct caseid) filter (caseid in (select caseid from deleted))
                                                                            as deleted_cases,
        (select count(*) from {{ ref('int_faers__case_latest') }})          as cases_after
    from demo
),

dedup_all_rows as (
    select 'all' as period_basis, 'ALL' as period_key, 'deduplication' as metric_group,
           m.metric, m.value, m.unit
    from dedup_all,
    lateral (values
        ('demo_rows', demo_rows::double, 'rows'),
        ('distinct_caseids', distinct_caseids::double, 'cases'),
        ('superseded_versions_removed', (demo_rows - distinct_caseids)::double, 'rows'),
        ('deleted_cases_removed', deleted_cases::double, 'cases'),
        ('cases_after_deduplication', cases_after::double, 'cases'),
        ('pct_duplicate_rows_removed',
            (100.0 * (demo_rows - distinct_caseids) / demo_rows)::double, 'pct'),
        ('pct_demo_rows_removed_total',
            (100.0 * (demo_rows - cases_after) / demo_rows)::double, 'pct')
    ) as m(metric, value, unit)
),

rxnorm as (                         -- from mart_dq_rxnorm_coverage (signal-role drug lines)
    select
        case when q.period_key = 'ALL' then 'all' else 'init_quarter' end   as period_basis,
        q.period_key,
        'rxnorm_coverage'                                                   as metric_group,
        m.metric,
        m.value,
        m.unit
    from (
        select
            period_key,
            sum(n_lines) filter (is_normalized)                             as normalized_lines,
            max(n_lines_period)                                             as lines,
            sum(pct_lines) filter (is_normalized)                           as pct_normalized,
            sum(pct_lines) filter (match_type = 'exact')                    as pct_exact,
            sum(pct_lines) filter (match_type = 'normalized')               as pct_normalized_layer,
            sum(pct_lines) filter (match_type = 'fallback')                 as pct_fallback,
            sum(n_lines_generic_fallback)                                   as generic_lines
        from {{ ref('mart_dq_rxnorm_coverage') }}
        group by period_key
    ) as q,
    lateral (values
        ('signal_role_lines', q.lines::double, 'lines'),
        ('normalized_lines', q.normalized_lines::double, 'lines'),
        ('pct_lines_normalized', coalesce(q.pct_normalized, 0)::double, 'pct'),
        ('pct_lines_exact', coalesce(q.pct_exact, 0)::double, 'pct'),
        ('pct_lines_normalized_layer', coalesce(q.pct_normalized_layer, 0)::double, 'pct'),
        ('pct_lines_fallback', coalesce(q.pct_fallback, 0)::double, 'pct'),
        ('generic_fallback_lines', q.generic_lines::double, 'lines')
    ) as m(metric, value, unit)
),

cohort as (                         -- cases by init quarter (window) and ALL
    select case_id, quarter_key as period_key, 'init_quarter' as period_basis
    from {{ ref('fct_case') }} where is_in_window
    union all
    select case_id, 'ALL', 'all' from {{ ref('fct_case') }}
),

case_nulls as (
    select
        c.period_basis, c.period_key, 'missing_values' as metric_group, m.metric, m.value,
        'pct' as unit
    from (
        select
            c.period_basis, c.period_key,
            100.0 * count(*) filter (f.event_date is null) / count(*)       as event_date_missing,
            100.0 * count(*) filter (f.sex = 'UNK') / count(*)              as sex_unknown,
            100.0 * count(*) filter (f.age_years is null) / count(*)        as age_missing,
            100.0 * count(*) filter (nullif(trim(f.reporter_country), '') is null) / count(*)
                                                                            as reporter_country_missing,
            count(*)                                                        as cases
        from cohort as c inner join {{ ref('fct_case') }} as f using (case_id)
        group by c.period_basis, c.period_key
    ) as c,
    lateral (values
        ('pct_cases_event_date_missing', c.event_date_missing::double),
        ('pct_cases_sex_unknown', c.sex_unknown::double),
        ('pct_cases_age_missing', c.age_missing::double),
        ('pct_cases_reporter_country_missing', c.reporter_country_missing::double)
    ) as m(metric, value)
    union all
    select c.period_basis, c.period_key, 'missing_values', 'cases', count(*)::double, 'cases'
    from cohort as c group by c.period_basis, c.period_key
),

line_nulls as (
    select
        c.period_basis, c.period_key, 'missing_values' as metric_group,
        'pct_drug_lines_without_prod_ai' as metric,
        (100.0 * count(*) filter (d.is_unknown) / count(*))::double as value, 'pct' as unit
    from cohort as c
    inner join {{ ref('fct_case_drug') }} as f using (case_id)
    inner join {{ ref('dim_drug') }} as d using (drug_key)
    group by c.period_basis, c.period_key
    union all
    select
        c.period_basis, c.period_key, 'missing_values', 'pct_reaction_lines_without_pt',
        (100.0 * count(*) filter (r.is_unknown) / count(*))::double, 'pct'
    from cohort as c
    inner join {{ ref('fct_case_reaction') }} as f using (case_id)
    inner join {{ ref('dim_reaction') }} as r using (reaction_key)
    group by c.period_basis, c.period_key
),

roles as (                          -- role_cod mix of all DRUG lines (every version) per file
    select
        case when grouping(source_quarter) = 1 then 'all' else 'file_quarter' end as period_basis,
        case when grouping(source_quarter) = 1 then 'ALL' else source_quarter end as period_key,
        coalesce(role_code, '(missing)')                                         as role,
        count(*)                                                                 as n
    from {{ ref('stg_faers__drug') }}
    group by grouping sets ((source_quarter, role_code), (role_code))
),

role_rows as (
    select period_basis, period_key, 'role_mix' as metric_group, 'lines_' || role as metric,
           n::double as value, 'lines' as unit
    from roles
    union all
    select period_basis, period_key, 'role_mix', 'pct_' || role,
           (100.0 * n / sum(n) over (partition by period_basis, period_key))::double, 'pct'
    from roles
)

select period_basis, period_key, metric_group, metric, value, unit from raw_rows
union all select * from dedup_quarter
union all select * from dedup_all_rows
union all select * from rxnorm
union all select * from case_nulls
union all select * from line_nulls
union all select * from role_rows
