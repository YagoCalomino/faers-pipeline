-- One row per MedDRA preferred term (PT) seen in the winning versions, plus the unknown member.
-- The ASCII files carry no MedDRA version: terms renamed between versions are separate rows.
with terms as (
    select {{ reaction_natural_key('reaction_pt') }} as reaction_pt
    from {{ ref('int_faers__reaction_latest') }}
    union
    select {{ unknown_member() }}
)

select
    {{ dbt_utils.generate_surrogate_key(['reaction_pt']) }} as reaction_key,
    reaction_pt,
    reaction_pt = {{ unknown_member() }}                as is_unknown
from terms
