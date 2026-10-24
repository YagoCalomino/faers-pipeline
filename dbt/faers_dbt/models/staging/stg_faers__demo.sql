-- One row per (primaryid, source_quarter): the same primaryid can be republished in a later
-- quarter (131 rows in 2025Q1 and 2025Q2), so primaryid alone is not unique here.
select
    cast(primaryid as bigint)                       as primaryid,
    cast(caseid as bigint)                          as caseid,
    cast(caseversion as integer)                    as case_version,
    {{ nullif_blank('upper(i_f_code)') }}           as init_or_followup,
    {{ parse_faers_date('event_dt') }}              as event_date,
    {{ parse_faers_date('fda_dt') }}                as fda_date,
    {{ parse_faers_date('init_fda_dt') }}           as init_fda_date,
    try_cast(age as double)                         as age_value,
    {{ nullif_blank('upper(age_cod)') }}            as age_unit,
    case upper(trim(age_cod))
        when 'YR'  then try_cast(age as double)
        when 'MON' then try_cast(age as double) / 12
        when 'WK'  then try_cast(age as double) / 52
        when 'DY'  then try_cast(age as double) / 365
        when 'DEC' then try_cast(age as double) * 10
        when 'HR'  then try_cast(age as double) / 8760
    end                                             as age_years,
    {{ nullif_blank('upper(age_grp)') }}            as age_group,
    case when upper(trim(sex)) in ('M', 'F') then upper(trim(sex)) else 'UNK' end as sex,
    {{ nullif_blank('upper(reporter_country)') }}   as reporter_country,
    {{ nullif_blank('upper(occr_country)') }}       as occurrence_country,
    quarter                                         as source_quarter,
    _source_file                                    as source_file
from {{ source('faers_raw', 'demo') }}
