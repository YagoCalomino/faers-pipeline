from __future__ import annotations

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
