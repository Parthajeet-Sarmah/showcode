import pytest
from unittest import mock
from fastapi.testclient import TestClient

from backend.api import app
from backend.api import CodeAnalysisRequest

client = TestClient(app)

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

def test_analyze_codesnippet_streaming_success(mock_gemini_client, mock_decrypt):
    payload = {
        "code": "print('hello')",
        "context": "simple test"
    }

    headers = {
        "x-local-alignment-model": "test-model",
        "x-local-snippet-model": "test-model",
        "x-local-url": "http://test.com",
        "x-use-snippet-model": "false",
        "x-use-local-provider": "false",
        "x-local-snippet-model": "test-model",
        "x-default-local-provider": "ollama",
        "x-default-cloud-provider": "gemini",
        "x-cloud-api-key": "encrypted",
        "x-cloud-encrypted-key": "encrypted",
        "x-cloud-iv": "iv",
    }

    response = client.post(
        "/analyze",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 200

    streamed_text = "".join(response.iter_text())
    assert streamed_text == "hello world "


#util
def post_with_no_x_header(header_name: str, json: dict[str, str]):
    headers = {
        "x-local-alignment-model": "test-model",
        "x-local-snippet-model": "test-model",
        "x-local-url": "http://test.com",
        "x-local-url": "http://test.com",
        "x-use-snippet-model": "false",
        "x-use-local-provider": "false",
        "x-local-snippet-model": "test-model",
        "x-default-local-provider": "ollama",
        "x-default-cloud-provider": "gemini",
        "x-cloud-api-key": "encrypted",
        "x-cloud-encrypted-key": "encrypted",
        "x-cloud-iv": "iv",
    }
    
    if header_name in headers.keys():
        del headers[header_name]

    return client.post("/analyze", headers=headers, json=json)

def test_analyze_codesnippet_incomplete_headers(mock_gemini_client, mock_decrypt):
    payload = {
        "code": "print('hello')",
        "context": "simple test"
    }

    responses = [
        post_with_no_x_header("x-cloud-api-key", payload),
        post_with_no_x_header("x-cloud-encrypted-key", payload),
        post_with_no_x_header("x-cloud-iv", payload),
    ]

    for res in responses:
        assert res.status_code == 400
        assert res.json()["detail"] == "Incomplete headers"

def test_gemini_client_init_failure():
    with mock.patch("backend.api.genai.Client", side_effect=Exception("boom")):
        payload = {"code": "print('x')"}

        response = client.post(
            "/analyze",
            json=payload,
            headers = {
                "x-local-alignment-model": "test-model",
                "x-local-snippet-model": "test-model",
                "x-local-url": "http://test.com",
                "x-local-url": "http://test.com",
                "x-use-snippet-model": "false",
                "x-use-local-provider": "false",
                "x-local-snippet-model": "test-model",
                "x-default-local-provider": "ollama",
                "x-default-cloud-provider": "gemini",
                "x-cloud-api-key": "encrypted",
                "x-cloud-encrypted-key": "encrypted",
                "x-cloud-iv": "iv",
            }
        )

        assert response.status_code == 503
        assert "Gemini client is not initialized" in response.json()["detail"]
