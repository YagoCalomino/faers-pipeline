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
