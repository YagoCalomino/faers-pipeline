-- mart_signals: the 2x2 table is consistent in every row of every period.
--   a + b + c + d = n_total; a <= n_drug; a <= n_reac; n_drug <= n_total; no negative cell;
--   a >= signal_min_cases; PRR is never null when c > 0; is_computable = PRR and ROR defined;
--   PRR/ROR are null only where undefined (c = 0; for ROR also b = 0 or d = 0).
select period_key, ingredient_id, reaction_pt, a, b, c, d, n_total, prr, ror,
       case
           when a + b + c + d <> n_total then 'a+b+c+d <> n_total'
           when a > n_drug or a > n_reac then 'a > n_drug or n_reac'
           when n_drug > n_total then 'n_drug > n_total'
           when least(a, b, c, d) < 0 then 'negative cell'
           when a < {{ var('signal_min_cases') }} then 'a below signal_min_cases'
           when c > 0 and prr is null then 'prr null with c > 0'
           when is_computable <> (prr is not null and ror is not null) then 'is_computable wrong'
           when (prr is null) <> (c = 0) then 'prr null without c = 0'
           when (ror is null) <> (b = 0 or c = 0 or d = 0) then 'ror null without b, c or d = 0'
       end as problem
from {{ ref('mart_signals') }}
where a + b + c + d <> n_total
   or a > n_drug or a > n_reac
   or n_drug > n_total
   or least(a, b, c, d) < 0
   or a < {{ var('signal_min_cases') }}
   or (c > 0 and prr is null)
   or is_computable <> (prr is not null and ror is not null)
   or (prr is null) <> (c = 0)
   or (ror is null) <> (b = 0 or c = 0 or d = 0)
