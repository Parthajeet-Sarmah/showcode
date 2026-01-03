import pytest
from unittest import mock

class MockChoice:
    def __init__(self, content):
        self.delta = mock.Mock()
        self.delta.content = content

class MockChunk:
    def __init__(self, content):
        self.choices = [MockChoice(content)]

class MockStream:
    def __iter__(self):
        yield MockChunk("hello ")
        yield MockChunk("openai ")

@pytest.fixture
def mock_decrypt():
    with mock.patch("backend.api.utils.decrypt_envelope") as decrypt:
        decrypt.return_value = "FAKE_API_KEY"
        yield decrypt

@pytest.fixture
def mock_openai_client():
    with mock.patch("backend.api.OpenAI") as mock_client:
        instance = mock_client.return_value
        # Mock streaming response
        instance.chat.completions.create.return_value = MockStream()
        yield mock_client

def test_analyze_codesnippet_chatgpt_success(client, base_headers, base_payload, mock_openai_client, mock_decrypt):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "false",
        "x-default-cloud-provider": "openai",
        # Ensure keys are present for decryption mock
        "x-cloud-api-key": "enc",
        "x-cloud-encrypted-key": "enc",
        "x-cloud-iv": "iv",
    })

    response = client.post("/analyze", json=base_payload, headers=headers)
    assert response.status_code == 200
    assert "".join(response.iter_text()) == "hello openai "
    
    # Verify OpenAI was called without base_url (or default)
    mock_openai_client.assert_any_call(api_key="FAKE_API_KEY")

def test_analyze_codesnippet_grok_success(client, base_headers, base_payload, mock_openai_client, mock_decrypt):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "false",
        "x-default-cloud-provider": "grok",
    })

    response = client.post("/analyze", json=base_payload, headers=headers)
    assert response.status_code == 200
    assert "".join(response.iter_text()) == "hello openai "

    # Verify OpenAI was called WITH base_url for Grok
    mock_openai_client.assert_any_call(
        api_key="FAKE_API_KEY",
        base_url="https://api.x.ai/v1"
    )

def test_analyze_codesnippet_openai_init_failure(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
         "x-use-local-provider": "false",
         "x-default-cloud-provider": "openai",
    })
    
    with mock.patch("backend.api.OpenAI", side_effect=Exception("boom")):
        response = client.post(
            "/analyze",
            json=base_payload,
            headers=headers
        )
        assert response.status_code == 503
        assert "OpenAI client is not initialized" in response.json()["detail"]

def test_analyze_codesnippet_grok_init_failure(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
         "x-use-local-provider": "false",
         "x-default-cloud-provider": "grok",
    })

    with mock.patch("backend.api.OpenAI", side_effect=Exception("boom")):
        response = client.post(
            "/analyze",
            json=base_payload,
            headers=headers
        )
        assert response.status_code == 503
        assert "Grok client is not initialized" in response.json()["detail"]