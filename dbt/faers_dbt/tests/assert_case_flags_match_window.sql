-- fct_case.is_in_window agrees with dim_quarter (which applies the window vars).
select c.case_id, c.quarter_key, c.is_in_window, q.is_in_window as quarter_in_window
from {{ ref('fct_case') }} as c
inner join {{ ref('dim_quarter') }} as q on q.quarter_key = c.quarter_key
where c.is_in_window <> coalesce(q.is_in_window, false)
