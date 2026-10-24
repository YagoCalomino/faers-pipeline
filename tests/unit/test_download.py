from __future__ import annotations

import json
import logging
from unittest import mock

import requests

from faers_pipeline import download

URL = "https://example.org/faers_ascii_2024q3.zip"


def _response(status: int, body: bytes) -> mock.MagicMock:
    r = mock.MagicMock()
    r.status_code = status
    r.iter_content.return_value = iter([body])
    r.__enter__.return_value = r
    return r


def test_is_available_true_for_zip_signature():
    with mock.patch.object(download.requests, "get", return_value=_response(206, b"PK\x03\x04")):
        assert download.is_available(URL, 5, "ua") is True


def test_is_available_false_for_missing_file():
    with mock.patch.object(download.requests, "get", return_value=_response(404, b"")):
        assert download.is_available(URL, 5, "ua") is False


def test_is_available_false_for_html_with_200():
    with mock.patch.object(download.requests, "get", return_value=_response(200, b"<htm")):
        assert download.is_available(URL, 5, "ua") is False


def test_is_available_swallows_network_errors():
    with mock.patch.object(download.requests, "get", side_effect=requests.ReadTimeout("slow")):
        assert download.is_available(URL, 5, "ua") is False


def test_requests_ask_for_identity_encoding():
    with mock.patch.object(
        download.requests, "get", return_value=_response(206, b"PK\x03\x04")
    ) as get:
        download.is_available(URL, 5, "ua")
    headers = get.call_args.kwargs["headers"]
    assert headers["Accept-Encoding"] == "identity"
    assert headers["Range"] == "bytes=0-3"


# --- ingest log / source_changed ----------------------------------------------------------


def _info(sha: str, size: int = 10) -> dict:
    return {"url": URL, "sha256": sha, "bytes": size, "path": "/x/faers_ascii_2024q3.zip"}


def test_first_download_is_logged_without_change(tmp_path):
    log_path = tmp_path / "_meta" / "ingest_log.jsonl"
    res = download.record_download(log_path, "2024Q3", _info("aa"), "scheduled__1")
    assert res == {"source_changed": False, "previous_sha256": None}
    (entry,) = [json.loads(x) for x in log_path.read_text(encoding="utf-8").splitlines()]
    assert entry["quarter"] == "2024Q3" and entry["sha256"] == "aa" and entry["bytes"] == 10
    assert entry["run_id"] == "scheduled__1" and entry["timestamp"]


def test_same_zip_again_is_not_a_change(tmp_path):
    log_path = tmp_path / "ingest_log.jsonl"
    download.record_download(log_path, "2024Q3", _info("aa"), "r1")
    res = download.record_download(log_path, "2024Q3", _info("aa"), "r2")
    assert res == {"source_changed": False, "previous_sha256": "aa"}
    assert len(log_path.read_text(encoding="utf-8").splitlines()) == 2  # append-only


def test_changed_zip_is_flagged_and_logged(tmp_path, caplog):
    log_path = tmp_path / "ingest_log.jsonl"
    download.record_download(log_path, "2024Q3", _info("aa"), "r1")
    download.record_download(log_path, "2024Q4", _info("cc"), "r2")  # other quarter
    with caplog.at_level(logging.WARNING, logger=download.__name__):
        res = download.record_download(log_path, "2024Q3", _info("bb", 11), "r3")
    assert res == {"source_changed": True, "previous_sha256": "aa"}
    assert "source_changed" in caplog.text and "2024Q3" in caplog.text
    assert download.last_logged(log_path, "2024Q3")["sha256"] == "bb"
