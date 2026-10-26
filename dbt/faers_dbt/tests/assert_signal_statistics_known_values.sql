-- The statistics macros (macros/signals.sql) against values computed independently in plain
-- Python with the same formulas and z = 1.96 (config/signals.yaml ci_z):
--   PRR = (a/(a+b)) / (c/(c+d)); SE ln PRR = sqrt(1/a - 1/(a+b) + 1/c - 1/(c+d))
--   ROR = ad/(bc);               SE ln ROR = sqrt(1/a + 1/b + 1/c + 1/d)
--   chi2 = N (ad - bc)^2 / ((a+b)(c+d)(a+c)(b+d)), no continuity correction
-- Includes the undefined cases: c = 0 (PRR and ROR null), b = 0 and d = 0 (ROR null).
-- A row is returned (test fails) when a value differs by more than 1e-9 (relative to the
-- expected value when it is larger than 1) or when exactly one side is null.
with expected (a, b, c, d, prr, prr_lcl, prr_ucl, ror, ror_lcl, ror_ucl, chi2) as (
    values
    (10, 90, 50, 850, 1.8000000000000003, 0.9427253051950598, 3.4368442028079547,
     1.8888888888888888, 0.9259918124264618, 3.8530591595822004, 3.1520882584712373),
    (3, 1, 7, 989, 106.71428571428572, 42.10052677811451, 270.493973520305,
     423.85714285714283, 39.142502315628576, 4589.764755006196, 222.14108961096912),
    (873, 13643, 4216, 2839341, 40.56286482350431, 37.781524078053195, 43.5489579322091,
     43.09444739265474, 39.988710895185775, 46.441391945491965, 27957.81458209991),
    (5, 0, 20, 975, 49.75, 32.23872005681777, 76.77297658337339,
     null, null, null, 195.97989949748742),
    (4, 6, 0, 990, null, null, null, null, null, null, 397.5903614457831),
    (2, 8, 5, 0, 0.2, 0.05789925536348879, 0.6908551716059539, null, null, null,
     8.571428571428571)
),

actual as (
    select
        *,
        {{ prr('a', 'b', 'c', 'd') }}                               as prr_x,
        {{ se_ln_prr('a', 'b', 'c', 'd') }}                         as se_prr_x,
        {{ ror('a', 'b', 'c', 'd') }}                               as ror_x,
        {{ se_ln_ror('a', 'b', 'c', 'd') }}                         as se_ror_x,
        {{ chi2('a', 'b', 'c', 'd') }}                              as chi2_x
    from expected
),

compared as (
    {%- set pairs = [('prr', 'prr_x'),
                     ('prr_lcl', ci_lower('prr_x', 'se_prr_x')),
                     ('prr_ucl', ci_upper('prr_x', 'se_prr_x')),
                     ('ror', 'ror_x'),
                     ('ror_lcl', ci_lower('ror_x', 'se_ror_x')),
                     ('ror_ucl', ci_upper('ror_x', 'se_ror_x')),
                     ('chi2', 'chi2_x')] %}
    {%- for name, expr in pairs %}
    select a, b, c, d, '{{ name }}' as measure, {{ name }}::double as expected,
           ({{ expr }})::double as actual
    from actual
    {%- if not loop.last %}
    union all
    {%- endif %}
    {%- endfor %}
)

select *
from compared
where (expected is null) <> (actual is null)
   or abs(expected - actual) > 1e-9 * greatest(1.0, abs(expected))
