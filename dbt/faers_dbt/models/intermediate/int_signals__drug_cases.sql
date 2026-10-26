-- One row per (case, ingredient) with a drug line in the signal roles (var signal_drug_roles),
-- plus the case's window quarter (quarter_key when the case is in the window, else null).
-- Input of mart_signals, materialized so the pair aggregation runs on a table.
select distinct
    d.caseid                                                as case_id,
    d.ingredient_id,
    case when c.is_in_window then c.quarter_key end         as window_quarter
from {{ ref('int_faers__drug_resolved') }} as d
inner join {{ ref('fct_case') }} as c on c.case_id = d.caseid
where d.role_code in ({{ signal_roles_sql() }})
