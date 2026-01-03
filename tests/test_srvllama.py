import pytest
from unittest.mock import patch

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

def test_analyze_code_srvllama_streaming_success(client, base_headers, base_payload):
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-default-local-provider": "srvllama",
        "x-local-snippet-model": "test-model",
    })

    with patch("backend.generators.httpx.AsyncClient", FakeAsyncClient):
        response = client.post(
            "/analyze",
            headers=headers,
            json=base_payload,
        )

        assert response.status_code == 200
        chunks = list(response.iter_text())
        assert "".join(chunks) == "hello world" 

def test_analyze_code_srvllama_incomplete_header(client, base_headers, base_payload):
    # Base headers for srvllama
    base_srv_headers = base_headers.copy()
    base_srv_headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-default-local-provider": "srvllama",
    })

    headers_to_check = ["x-local-alignment-model", "x-local-url", "x-use-snippet-model", "x-local-snippet-model"]

    def post_missing(header_name):
        h = base_srv_headers.copy()
        if header_name in h:
            del h[header_name]
        return client.post("/analyze", headers=h, json=base_payload)

    with patch("backend.generators.httpx.AsyncClient", FakeAsyncClient):
        for header in headers_to_check:
            res = post_missing(header)
            assert res.status_code == 400
            assert res.json()["detail"] == "Incomplete headers"