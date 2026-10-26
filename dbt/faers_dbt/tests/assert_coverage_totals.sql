-- mart_dq_rxnorm_coverage: each period's lines add up to its total and to 100%, and ALL has
-- exactly the signal-role drug lines of the winning versions.
select period_key, 'rows do not add up' as problem
from {{ ref('mart_dq_rxnorm_coverage') }}
group by period_key
having sum(n_lines) <> max(n_lines_period) or abs(sum(pct_lines) - 100) > 0.01

union all

select 'ALL', 'ALL lines differ from signal-role lines'
where (select max(n_lines_period) from {{ ref('mart_dq_rxnorm_coverage') }}
       where period_key = 'ALL')
   <> (select count(*) from {{ ref('int_faers__drug_latest') }}
       where role_code in ({{ signal_roles_sql() }}))
