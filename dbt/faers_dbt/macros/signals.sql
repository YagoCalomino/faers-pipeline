{#- Disproportionality statistics on a 2x2 table of distinct cases (sources and formulas in
    docs/limitations.md, "Signals"):

                    with reaction   without reaction
    with drug             a                b
    without drug          c                d

    Every macro takes column expressions (integers) and returns a DOUBLE, or NULL where the
    measure is undefined: PRR when c = 0; ROR when b, c or d is 0; chi-squared when a margin is 0.
    a >= 1 always holds in mart_signals (pairs exist only with at least one case). -#}

{% macro _f(x) -%} cast({{ x }} as double) {%- endmacro %}

{#- PRR = [a / (a + b)] / [c / (c + d)] (Evans, Waller & Davis 2001). -#}
{% macro prr(a, b, c, d) -%}
    case when {{ c }} > 0
         then ({{ _f(a) }} / ({{ _f(a) }} + {{ _f(b) }})) / ({{ _f(c) }} / ({{ _f(c) }} + {{ _f(d) }}))
    end
{%- endmacro %}

{#- SE of ln(PRR) = sqrt(1/a - 1/(a + b) + 1/c - 1/(c + d)). -#}
{% macro se_ln_prr(a, b, c, d) -%}
    case when {{ c }} > 0
         then sqrt(1.0 / {{ _f(a) }} - 1.0 / ({{ _f(a) }} + {{ _f(b) }})
                   + 1.0 / {{ _f(c) }} - 1.0 / ({{ _f(c) }} + {{ _f(d) }}))
    end
{%- endmacro %}

{#- ROR = (a * d) / (b * c) (van Puijenbroek et al. 2002). -#}
{% macro ror(a, b, c, d) -%}
    case when {{ b }} > 0 and {{ c }} > 0 and {{ d }} > 0
         then ({{ _f(a) }} * {{ _f(d) }}) / ({{ _f(b) }} * {{ _f(c) }})
    end
{%- endmacro %}

{#- SE of ln(ROR) = sqrt(1/a + 1/b + 1/c + 1/d). -#}
{% macro se_ln_ror(a, b, c, d) -%}
    case when {{ b }} > 0 and {{ c }} > 0 and {{ d }} > 0
         then sqrt(1.0 / {{ _f(a) }} + 1.0 / {{ _f(b) }} + 1.0 / {{ _f(c) }} + 1.0 / {{ _f(d) }})
    end
{%- endmacro %}

{#- Pearson chi-squared of the 2x2 table, 1 degree of freedom, no continuity correction:
    N (ad - bc)^2 / [(a + b)(c + d)(a + c)(b + d)]. -#}
{% macro chi2(a, b, c, d) -%}
    case when ({{ a }} + {{ b }}) > 0 and ({{ c }} + {{ d }}) > 0
              and ({{ a }} + {{ c }}) > 0 and ({{ b }} + {{ d }}) > 0
         then ({{ _f(a) }} + {{ _f(b) }} + {{ _f(c) }} + {{ _f(d) }})
              * power({{ _f(a) }} * {{ _f(d) }} - {{ _f(b) }} * {{ _f(c) }}, 2)
              / (({{ _f(a) }} + {{ _f(b) }}) * ({{ _f(c) }} + {{ _f(d) }})
                 * ({{ _f(a) }} + {{ _f(c) }}) * ({{ _f(b) }} + {{ _f(d) }}))
    end
{%- endmacro %}

{#- Bounds of a ratio's confidence interval on the log scale: exp(ln(x) -/+ z * se).
    z comes from config/signals.yaml (ci_z). -#}
{% macro ci_lower(x, se) -%}
    exp(ln({{ x }}) - {{ var('signals')['ci_z'] }} * {{ se }})
{%- endmacro %}

{% macro ci_upper(x, se) -%}
    exp(ln({{ x }}) + {{ var('signals')['ci_z'] }} * {{ se }})
{%- endmacro %}
