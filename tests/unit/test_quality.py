from __future__ import annotations

import json

import pytest

from faers_pipeline.quality import check_contract, write_manifest


def test_contract_passes_with_exact_columns(schema_cfg):
    cols = list(schema_cfg["demo"])
    assert check_contract("demo", cols, schema_cfg) == {"file_type": "demo", "extra_columns": []}


def test_contract_ignores_internal_columns(schema_cfg):
    cols = [*schema_cfg["reac"], "_source_file", "_ingested_at"]
    assert check_contract("reac", cols, schema_cfg)["extra_columns"] == []


def test_contract_reports_extra_columns(schema_cfg):
    # drug_rec_act is a real REAC column (plan section 5.1) not required by the contract.
    cols = [*schema_cfg["reac"], "drug_rec_act"]
    assert check_contract("reac", cols, schema_cfg)["extra_columns"] == ["drug_rec_act"]


def test_contract_fails_on_missing_column(schema_cfg):
    cols = [c for c in schema_cfg["drug"] if c != "prod_ai"]
    with pytest.raises(ValueError, match="prod_ai"):
        check_contract("drug", cols, schema_cfg)


def test_contract_covers_all_configured_file_types(faers_cfg, schema_cfg):
    assert set(faers_cfg["file_types"]) <= set(schema_cfg)


def test_write_manifest_is_atomic(tmp_path):
    path = tmp_path / "quarter=2024Q3" / "manifest.json"
    write_manifest({"quarter": "2024Q3", "rows": {"demo": 1}}, path)
    assert json.loads(path.read_text(encoding="utf-8"))["quarter"] == "2024Q3"
    assert not list(path.parent.glob("*.tmp"))
