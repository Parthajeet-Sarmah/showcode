from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.api import app  # adjust import

client = TestClient(app)


class FakeStreamResponse:
    status_code = 200

    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"hello "}}]}'
        yield 'data: {"choices":[{"delta":{"content":"world"}}]}'
        yield "data: [DONE]"

    async def aread(self):
        return b""

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        pass


class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        pass

    def stream(self, method, url, json):
        return FakeStreamResponse()

def test_analyze_code_srvllama_streaming_success():
    with patch("backend.generators.httpx.AsyncClient", FakeAsyncClient):
        response = client.post(
            "/analyze",
            headers={
                "x-local-alignment-model": "test-model",
                "x-local-url": "http://test.com",
                "x-use-snippet-model": "true",
                "x-use-local-provider": "true",
                "x-local-snippet-model": "test-model",
                "x-default-local-provider": "srvllama",
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

def post_with_no_x_header(header_name: str, json: dict[str, str]):
    headers={
        "x-local-alignment-model": "test-model",
        "x-local-url": "http://test.com",
        "x-use-snippet-model": "true",
        "x-use-local-provider": "true",
        "x-local-snippet-model": "test-model",
        "x-default-local-provider": "srvllama",
        "x-default-cloud-provider": "gemini",
    }
    
    if header_name in headers.keys():
        del headers[header_name]

    return client.post("/analyze", headers=headers, json=json)

def test_analyze_code_srvllama_incomplete_header():
    json = {
      "code": "print('hi')",
      "context": "test context",
    }

    with patch("backend.generators.httpx.AsyncClient", FakeAsyncClient):
        responses = [
            post_with_no_x_header("x-local-alignment-model", json),
            post_with_no_x_header("x-local-url", json),
            post_with_no_x_header("x-use-snippet-model", json),
            post_with_no_x_header("x-local-snippet-model", json),
        ]

        for res in responses:
            assert res.status_code == 400
            assert res.json()["detail"] == "Incomplete headers"
