import json
from fastapi.testclient import TestClient
from unittest.mock import patch

from starlette.responses import JSONResponse

from backend.api import app  # adjust import

client = TestClient(app)

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
        return { "models": [ { "name": "test-model" }, { "name": "test-model-2" } ] } 

def test_analyze_code_ollama_streaming_success():
    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            headers={
                "x-local-alignment-model": "test-model",
                "x-local-url": "http://test.com",
                "x-use-snippet-model": "true",
                "x-use-local-provider": "true",
                "x-local-snippet-model": "test-model",
                "x-default-local-provider": "ollama",
                "x-default-cloud-provider": "gemini",
            },
            json={
                "code": "print('hi')",
                "context": "test context",
            },
        )

        assert response.status_code == 200

        chunks = list(response.iter_text())
        assert "".join(chunks) == "hello world" 

def test_analyze_code_ollama_client_init_failure():
    with patch(
        "backend.api.ollama.AsyncClient",
        side_effect=RuntimeError(
            "Failed to connect to Ollama. Please check that Ollama is downloaded, running and accessible."
        ),
    ):
        response = client.post(
            "/analyze",
            headers={
                "x-local-alignment-model": "test-model",
                "x-local-url": "http://test.com",
                "x-use-snippet-model": "true",
                "x-use-local-provider": "true",
                "x-local-snippet-model": "test-model",
                "x-default-local-provider": "ollama",
                "x-default-cloud-provider": "gemini",
            },
            json={
                "code": "print('hi')",
                "context": "test context",
            },
        )

    assert response.status_code == 503
    assert "Ollama client is not initialized. Ensure Ollama is running and accessible." in response.json()["detail"]

def test_analyze_code_ollama_unavailable_model():
    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            headers={
                "x-local-alignment-model": "unavailable-model",
                "x-local-url": "http://test.com",
                "x-use-snippet-model": "true",
                "x-use-local-provider": "true",
                "x-local-snippet-model": "unavailable-model",
                "x-default-local-provider": "ollama",
                "x-default-cloud-provider": "gemini",
            },
            json={
                "code": "print('hi')",
                "context": "test context",
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Unavailable model"

def test_analyze_code_ollama_incomplete_header():
    with patch("backend.api.ollama.AsyncClient", FakeOllamaClient):
        response = client.post(
            "/analyze",
            json={
                "code": "print('hi')",
                "context": "test context",
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Incomplete headers"
