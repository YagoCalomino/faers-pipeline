-- Concentration columns of mart_signals_top (pair and ingredient) recomputed for one pair from
-- the line-level models (int_faers__drug_resolved in the signal roles, fct_case_reaction,
-- fct_case), without the int_signals__* tables and with separate counting code. Not via
-- bridge_drug_ingredient: drug lines without prod_ai resolve through the drug name there are not
-- in it.
-- The pair: the one with the most cases among those whose top country holds less than the whole
-- pair (so the country tie-break and the share are exercised), ties by ids. Deterministic on any
-- lake. Returns one row per mismatching column (empty = pass).
with pair as (
    select ingredient_id, reaction_key, a, top_country, top_country_share, top_quarter,
           top_quarter_share, median_reactions_per_case, ingredient_top_country,
           ingredient_top_country_share, ingredient_country_share
    from {{ ref('mart_signals_top') }}
    order by (top_country_share < 1) desc, a desc, ingredient_id, reaction_key
    limit 1
),

drug_cases as (
    select distinct caseid as case_id
    from {{ ref('int_faers__drug_resolved') }}
    where role_code in ({{ signal_roles_sql() }})
      and ingredient_id = (select ingredient_id from pair)
),

-- Every case of the ingredient with its country (the ingredient columns, over n_drug cases).
ingredient_cases as (
    select f.case_id,
           case when nullif(trim(f.reporter_country), '') is not null
                 and not {{ is_placeholder('reporter_country', 'f.reporter_country') }}
                then f.reporter_country end             as country
    from {{ ref('fct_case') }} as f
    where f.case_id in (select case_id from drug_cases)
),

ingredient_countries as (
    select country, count(*) as n from ingredient_cases where country is not null group by country
),

n_ingredient_cases as (select count(*) as n from ingredient_cases),

reac_cases as (
    select distinct case_id
    from {{ ref('fct_case_reaction') }}
    where reaction_key = (select reaction_key from pair)
),

cases as (
    select f.case_id, f.quarter_key,
           case when nullif(trim(f.reporter_country), '') is not null
                 and not {{ is_placeholder('reporter_country', 'f.reporter_country') }}
                then f.reporter_country end             as country
    from {{ ref('fct_case') }} as f
    where f.case_id in (select case_id from drug_cases)
      and f.case_id in (select case_id from reac_cases)
),

n_cases as (select count(*) as n from cases),

countries as (
    select country, count(*) as n from cases where country is not null group by country
),

quarters as (
    select quarter_key, count(*) as n from cases group by quarter_key
),

reactions as (
    select r.case_id, count(distinct r.reaction_key) as n
    from {{ ref('fct_case_reaction') }} as r
    where r.case_id in (select case_id from cases)
    group by r.case_id
),

expected as (
    select
        (select n from n_cases)                                             as a,
        (select country from countries order by n desc, country limit 1)    as top_country,
        coalesce((select max(n) from countries), 0)::double
            / (select n from n_cases)                                       as top_country_share,
        (select quarter_key from quarters order by n desc, quarter_key limit 1)
                                                                            as top_quarter,
        (select max(n) from quarters)::double / (select n from n_cases)     as top_quarter_share,
        (select median(n) from reactions)                                   as median_reactions_per_case,
        (select country from ingredient_countries order by n desc, country limit 1)
                                                                            as ingredient_top_country,
        coalesce((select max(n) from ingredient_countries), 0)::double
            / (select n from n_ingredient_cases)                            as ingredient_top_country_share,
        coalesce((select n from ingredient_countries
                  where country = (select country from countries order by n desc, country limit 1)), 0)::double
            / (select n from n_ingredient_cases)                            as ingredient_country_share
)

select 'a' as col, p.a::varchar as mart, e.a::varchar as recomputed
from pair as p, expected as e where p.a <> e.a
union all
select 'top_country', p.top_country, e.top_country
from pair as p, expected as e where p.top_country is distinct from e.top_country
union all
select 'top_country_share', p.top_country_share::varchar, e.top_country_share::varchar
from pair as p, expected as e where abs(p.top_country_share - e.top_country_share) > 1e-9
union all
select 'top_quarter', p.top_quarter, e.top_quarter
from pair as p, expected as e where p.top_quarter is distinct from e.top_quarter
union all
select 'top_quarter_share', p.top_quarter_share::varchar, e.top_quarter_share::varchar
from pair as p, expected as e where abs(p.top_quarter_share - e.top_quarter_share) > 1e-9
union all
select 'median_reactions_per_case', p.median_reactions_per_case::varchar,
       e.median_reactions_per_case::varchar
from pair as p, expected as e
where p.median_reactions_per_case is distinct from e.median_reactions_per_case
union all
select 'ingredient_top_country', p.ingredient_top_country, e.ingredient_top_country
from pair as p, expected as e where p.ingredient_top_country is distinct from e.ingredient_top_country
union all
select 'ingredient_top_country_share', p.ingredient_top_country_share::varchar,
       e.ingredient_top_country_share::varchar
from pair as p, expected as e
where abs(p.ingredient_top_country_share - e.ingredient_top_country_share) > 1e-9
union all
select 'ingredient_country_share', p.ingredient_country_share::varchar,
       e.ingredient_country_share::varchar
from pair as p, expected as e
where abs(p.ingredient_country_share - e.ingredient_country_share) > 1e-9
union all
select 'no pair selected', null, null where not exists (select 1 from pair)
