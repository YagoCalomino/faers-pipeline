-- Lines of one drug position (case_id, drug_seq) share role and product: the extra lines only
-- carry other dosage regimens. Returns the positions where that does not hold.
select case_id, drug_seq, count(distinct role_code) as roles, count(distinct drug_key) as drugs
from {{ ref('fct_case_drug') }}
group by case_id, drug_seq
having count(distinct role_code) > 1 or count(distinct drug_key) > 1
