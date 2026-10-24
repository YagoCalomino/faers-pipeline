-- (v) Cases after deduplication = distinct DEMO caseid - distinct DEMO caseid that are deleted.
with counts as (
    select
        (select count(*) from {{ ref('int_faers__case_latest') }}) as cases,
        (select count(distinct caseid) from {{ ref('stg_faers__demo') }}) as demo_caseids,
        (select count(distinct d.caseid) from {{ ref('stg_faers__demo') }} as d
         where d.caseid in (select caseid from {{ ref('stg_faers__deleted') }})) as deleted_present
)

select * from counts where cases <> demo_caseids - deleted_present
