import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

class FakeStreamResponse:
    def __init__(self):
        self._chunks = [
            {"response": "hello ", "done": False},
            {"response": "world", "done": False},
            {"done": True},
        ]
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._chunks):
            raise StopAsyncIteration

        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    async def aread(self):
        return b""

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        pass

class FakeOllamaClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def generate(self, prompt, model, system, stream):
        return FakeStreamResponse()

    async def list(self):
        return { "models": [ { "name": "test-model", "model": "test-model" }, { "name": "test-model-2", "model": "test-model-2" } ] } 

def test_analyze_code_ollama_streaming_success(client, base_headers, base_payload):
    # Enable local provider for this test
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-local-snippet-model": "test-model",
        "x-default-local-provider": "ollama",
    })

    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            headers=headers,
            json=base_payload,
        )

        assert response.status_code == 200
        chunks = list(response.iter_text())
        assert "".join(chunks) == "hello world" 

def test_analyze_code_ollama_client_init_failure(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-default-local-provider": "ollama",
    })

    with patch(
        "backend.api.ollama.AsyncClient",
        side_effect=RuntimeError("Connection failed"),
    ):
        response = client.post(
            "/analyze",
            headers=headers,
            json=base_payload,
        )

    assert response.status_code == 503
    assert "Ollama client is not initialized" in response.json()["detail"]

def test_analyze_code_ollama_unavailable_model(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-local-snippet-model": "unavailable-model", # Invalid model
        "x-default-local-provider": "ollama",
    })

    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            headers=headers,
            json=base_payload,
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Unavailable model"

def test_analyze_code_ollama_incomplete_header(client, base_payload):
    # Only sending payload, no headers
    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            json=base_payload,
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Incomplete headers"
