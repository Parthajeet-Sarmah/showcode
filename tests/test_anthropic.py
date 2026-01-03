import pytest
from unittest import mock

class MockStream:
    def __init__(self):
        self.text_stream = ["hello ", "claude "]
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

@pytest.fixture
def mock_decrypt():
    with mock.patch("backend.api.utils.decrypt_envelope") as decrypt:
        decrypt.return_value = "FAKE_API_KEY"
        yield decrypt

@pytest.fixture
def mock_anthropic_client():
    with mock.patch("backend.api.Anthropic") as mock_client:
        instance = mock_client.return_value
        instance.messages.stream.return_value = MockStream()
        yield mock_client

def test_analyze_codesnippet_claude_success(client, base_headers, base_payload, mock_anthropic_client, mock_decrypt):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "false",
        "x-default-cloud-provider": "claude",
    })

    response = client.post("/analyze", json=base_payload, headers=headers)
    assert response.status_code == 200
    assert "".join(response.iter_text()) == "hello claude "

def test_analyze_codesnippet_claude_init_failure(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "false",
        "x-default-cloud-provider": "claude",
    })

    with mock.patch("backend.api.Anthropic", side_effect=Exception("boom")):
        response = client.post(
            "/analyze",
            json=base_payload,
            headers=headers
        )
        assert response.status_code == 503
        assert "Claude client is not initialized" in response.json()["detail"]