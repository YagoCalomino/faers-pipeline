-- (iv) No fan-out: the *_latest models have exactly the staging rows of the winning
-- (primaryid, source_quarter). The expected side uses a semi-join, which cannot multiply rows.
{% set pairs = [('int_faers__drug_latest', 'stg_faers__drug'),
                ('int_faers__reaction_latest', 'stg_faers__reac')] %}
{% for latest, stg in pairs %}
select '{{ latest }}' as model, actual, expected
from (
    select
        (select count(*) from {{ ref(latest) }}) as actual,
        (select count(*) from {{ ref(stg) }} as s
         where exists (select 1 from {{ ref('int_faers__case_latest') }} as c
                       where c.primaryid = s.primaryid and c.source_quarter = s.source_quarter)
        ) as expected
)
where actual <> expected
{% if not loop.last %}union all{% endif %}
{% endfor %}
