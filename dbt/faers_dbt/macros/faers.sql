{#- FAERS dates: YYYYMMDD, YYYYMM or YYYY -> first day of the period. Empty or invalid -> NULL. -#}
{% macro parse_faers_date(column) -%}
    case
        when regexp_full_match(trim({{ column }}), '[0-9]{8}')
            then cast(try_strptime(trim({{ column }}), '%Y%m%d') as date)
        when regexp_full_match(trim({{ column }}), '[0-9]{6}')
            then cast(try_strptime(trim({{ column }}) || '01', '%Y%m%d') as date)
        when regexp_full_match(trim({{ column }}), '[0-9]{4}')
            then cast(try_strptime(trim({{ column }}) || '0101', '%Y%m%d') as date)
    end
{%- endmacro %}

{#- Upper case, trimmed, inner whitespace collapsed; empty -> NULL. -#}
{% macro clean_text(column) -%}
    nullif(regexp_replace(upper(trim({{ column }})), '\s+', ' ', 'g'), '')
{%- endmacro %}

{#- Trimmed; empty -> NULL. -#}
{% macro nullif_blank(column) -%}
    nullif(trim({{ column }}), '')
{%- endmacro %}

{#- date -> 'YYYYQn' (same label as the lake partitions). -#}
{% macro quarter_label(date_column) -%}
    cast(year({{ date_column }}) as varchar) || 'Q' || cast(quarter({{ date_column }}) as varchar)
{%- endmacro %}

{#- var('signal_drug_roles') as a SQL list: 'PS', 'SS'. -#}
{% macro signal_roles_sql() -%}
    {%- for role in var('signal_drug_roles') -%}
        '{{ role }}'{{ ", " if not loop.last }}
    {%- endfor -%}
{%- endmacro %}

{#- True when `column` holds a placeholder FAERS writes instead of a missing value (var
    missing_value_placeholders, config/faers.yaml, upper-cased like staging); false for a field
    without placeholders or a NULL column. -#}
{% macro is_placeholder(field, column) -%}
    {%- set values = var('missing_value_placeholders').get(field) or [] -%}
    {%- if values -%}
        coalesce({{ column }} in (
        {%- for v in values -%}
            '{{ v | upper | replace("'", "''") }}'{{ ", " if not loop.last }}
        {%- endfor -%}
        ), false)
    {%- else -%}
        false
    {%- endif -%}
{%- endmacro %}

{#- 'YYYYQn' -> first day of the quarter. -#}
{% macro quarter_start_date(label) -%}
    make_date(cast(left({{ label }}, 4) as integer),
              (cast(right({{ label }}, 1) as integer) - 1) * 3 + 1, 1)
{%- endmacro %}

{#- Natural key of the explicit 'unknown' member of every dimension. Lower case and in
    parentheses so it cannot collide with a cleaned (upper-case) source value. -#}
{% macro unknown_member() -%}
    '(unknown)'
{%- endmacro %}

{#- dim_drug natural key: prod_ai cleaned (upper, trim, inner spaces collapsed), else unknown. -#}
{% macro drug_natural_key(prod_ai_column) -%}
    coalesce({{ clean_text(prod_ai_column) }}, {{ unknown_member() }})
{%- endmacro %}

{#- dim_reaction natural key: MedDRA PT as reported (trimmed), else unknown. -#}
{% macro reaction_natural_key(pt_column) -%}
    coalesce({{ nullif_blank(pt_column) }}, {{ unknown_member() }})
{%- endmacro %}

{#- Fallback ingredient id: the text itself, prefixed (no RxNorm match). Same as the Python
    name-map builder (faers_pipeline.rxnorm.FALLBACK_PREFIX). -#}
{% macro fallback_ingredient_id(text_column) -%}
    'FB:' || {{ text_column }}
{%- endmacro %}

{#- True for a fallback ingredient whose text is a generic class word listed in
    config/rxnorm.yaml generic_terms (var rxnorm_generic_terms, passed by scripts/dbt_run.py). -#}
{% macro is_generic_fallback(ingredient_id_column, ingredient_name_column) -%}
    {%- set terms = var('rxnorm_generic_terms') -%}
    {%- if terms | length > 0 -%}
    (starts_with({{ ingredient_id_column }}, 'FB:') and {{ ingredient_name_column }} in (
        {%- for t in terms -%}
            '{{ t | replace("'", "''") }}'{{ ", " if not loop.last }}
        {%- endfor -%}))
    {%- else -%}
    false
    {%- endif -%}
{%- endmacro %}
