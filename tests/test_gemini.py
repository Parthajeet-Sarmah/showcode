import pytest
from unittest import mock
from backend.api import CodeAnalysisRequest

class MockChunk:
    def __init__(self, text):
        self.text = text

class MockStream:
    def __iter__(self):
        yield MockChunk("hello ")
        yield MockChunk("world ")

@pytest.fixture
def mock_gemini_client():
    with mock.patch("backend.api.genai.Client") as mock_client:
        instance = mock_client.return_value
        instance.models.generate_content_stream.return_value = MockStream()
        yield mock_client

@pytest.fixture
def mock_decrypt():
    with mock.patch("backend.api.utils.decrypt_envelope") as decrypt:
        decrypt.return_value = "FAKE_API_KEY"
        yield decrypt

def test_analyze_codesnippet_streaming_success(client, base_headers, base_payload, mock_gemini_client, mock_decrypt):
    response = client.post(
        "/analyze",
        json=base_payload,
        headers=base_headers,
    )

    assert response.status_code == 200
    streamed_text = "".join(response.iter_text())
    assert streamed_text == "hello world "

def test_analyze_codesnippet_incomplete_headers(client, base_headers, base_payload, mock_gemini_client, mock_decrypt):
    # Helper to test missing headers
    def post_missing(header_to_remove):
        headers = base_headers.copy()
        if header_to_remove in headers:
            del headers[header_to_remove]
        return client.post("/analyze", headers=headers, json=base_payload)

    headers_to_test = ["x-cloud-api-key", "x-cloud-encrypted-key", "x-cloud-iv"]

    for header in headers_to_test:
        res = post_missing(header)
        assert res.status_code == 400
        assert res.json()["detail"] == "Incomplete headers"

def test_gemini_client_init_failure(client, base_headers, base_payload):
    # Force client init to fail
    with mock.patch("backend.api.genai.Client", side_effect=Exception("boom")):
        response = client.post(
            "/analyze",
            json=base_payload,
            headers=base_headers
        )

        assert response.status_code == 503
        assert "Gemini client is not initialized" in response.json()["detail"]