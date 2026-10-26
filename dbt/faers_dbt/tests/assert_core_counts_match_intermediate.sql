-- fct_case has exactly the cases of int_faers__case_latest, and every fact keeps exactly the
-- rows of its intermediate model (no fan-out, nothing dropped).
{% set pairs = [('fct_case', 'int_faers__case_latest'),
                ('fct_case_drug', 'int_faers__drug_latest'),
                ('fct_case_reaction', 'int_faers__reaction_latest'),
                ('fct_case_outcome', 'int_faers__outcome_latest')] %}
{% for fact, source_model in pairs %}
select '{{ fact }}' as fact, actual, expected
from (
    select
        (select count(*) from {{ ref(fact) }}) as actual,
        (select count(*) from {{ ref(source_model) }}) as expected
)
where actual <> expected
{% if not loop.last %}union all{% endif %}
{% endfor %}
