-- One row per (case, reaction PT). Input of mart_signals, materialized so the pair
-- aggregation runs on a table.
select distinct case_id, reaction_key
from {{ ref('fct_case_reaction') }}
