-- (i) Every DRUG, REAC, OUTC and INDI row has a DEMO row with the same (primaryid, source_quarter).
{% set children = ['stg_faers__drug', 'stg_faers__reac', 'stg_faers__outc', 'stg_faers__indi'] %}
{% for child in children %}
select '{{ child }}' as child_model, c.primaryid, c.source_quarter
from {{ ref(child) }} as c
where not exists (
    select 1 from {{ ref('stg_faers__demo') }} as d
    where d.primaryid = c.primaryid and d.source_quarter = c.source_quarter
)
{% if not loop.last %}union all{% endif %}
{% endfor %}
