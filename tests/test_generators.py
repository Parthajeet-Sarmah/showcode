import pytest
import json
import asyncio
from unittest import mock
from fastapi import HTTPException
from backend.generators import llama_stream, ollama_stream, anthtropic_stream

# --- Tests for llama_stream ---

class MockHttpxResponse:
    def __init__(self, status_code=200, lines=None, error_content=b""):
        self.status_code = status_code
        self._lines = lines or []
        self._error_content = error_content

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return self._error_content

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

def test_llama_stream_success():
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": "chunk1 "}}]}),
        "data: " + json.dumps({"choices": [{"delta": {"content": "chunk2"}}]}),
        "data: [DONE]"
    ]
    
    async def run_test():
        with mock.patch("backend.generators.httpx.AsyncClient") as mock_client:
            mock_client_instance = mock_client.return_value
            mock_client_instance.__aenter__.return_value = mock_client_instance
            mock_client_instance.stream.return_value = MockHttpxResponse(lines=lines)
            
            chunks = []
            async for chunk in llama_stream("http://test", {}):
                chunks.append(chunk)
                
            assert "".join(chunks) == "chunk1 chunk2"

    asyncio.run(run_test())

def test_llama_stream_error_status():
    async def run_test():
        with mock.patch("backend.generators.httpx.AsyncClient") as mock_client:
            mock_client_instance = mock_client.return_value
            mock_client_instance.__aenter__.return_value = mock_client_instance
            # Simulate 500 error
            mock_client_instance.stream.return_value = MockHttpxResponse(
                status_code=500, 
                error_content=b"Internal Server Error"
            )
            
            chunks = []
            async for chunk in llama_stream("http://test", {}):
                chunks.append(chunk)
            
            assert len(chunks) > 0
            assert "[SERVER_ERROR]" in chunks[0]
            assert "Llama server error" in chunks[0]

    asyncio.run(run_test())

def test_llama_stream_exception():
    async def run_test():
        with mock.patch("backend.generators.httpx.AsyncClient", side_effect=Exception("Network error")):
            chunks = []
            async for chunk in llama_stream("http://test", {}):
                chunks.append(chunk)
            
            assert len(chunks) == 1
            assert "[SERVER_ERROR]" in chunks[0]
            assert "Network error" in chunks[0]

    asyncio.run(run_test())

# --- Tests for ollama_stream ---

class MockOllamaStream:
    def __init__(self, chunks):
        self.chunks = chunks
        
    def __aiter__(self):
        self.iter_chunks = iter(self.chunks)
        return self
        
    async def __anext__(self):
        try:
            return next(self.iter_chunks)
        except StopIteration:
            raise StopAsyncIteration

def test_ollama_stream_success():
    async def run_test():
        mock_client = mock.Mock()
        
        # mock_generate needs to be an async function (returning a coroutine)
        # that returns an async iterable (the stream)
        async def mock_generate(*args, **kwargs):
            return MockOllamaStream([
                {"response": "chunk1 "},
                {"response": "chunk2"}
            ])
        
        mock_client.generate.side_effect = mock_generate
        
        chunks = []
        async for chunk in ollama_stream(mock_client, "prompt", "model", True):
            chunks.append(chunk)
            
        assert "".join(chunks) == "chunk1 chunk2"

    asyncio.run(run_test())

def test_ollama_stream_client_none():
    async def run_test():
        chunks = []
        async for chunk in ollama_stream(None, "prompt", "model", True):
            chunks.append(chunk)
        
        assert len(chunks) > 0
        assert "[SERVER_ERROR]" in chunks[0]
        assert "Ollama service is unavailable" in chunks[0]

    asyncio.run(run_test())

def test_ollama_stream_exception():
    async def run_test():
        mock_client = mock.Mock()
        mock_client.generate.side_effect = Exception("Ollama failed")
        
        chunks = []
        async for chunk in ollama_stream(mock_client, "prompt", "model", True):
            chunks.append(chunk)
            
        assert len(chunks) == 1
        assert "[SERVER_ERROR]" in chunks[0]
        assert "Ollama failed" in chunks[0]

    asyncio.run(run_test())

# --- Tests for anthropic_stream ---

class MockAnthropicStream:
    def __init__(self, text_chunks):
        self.text_stream = text_chunks
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        pass

def test_anthropic_stream_success():
    async def run_test():
        mock_client = mock.Mock()
        mock_client.messages.stream.return_value = MockAnthropicStream(["chunk1 ", "chunk2"])
        
        chunks = []
        async for chunk in anthtropic_stream(mock_client, "system", "user", "model"):
            chunks.append(chunk)
            
        assert "".join(chunks) == "chunk1 chunk2"

    asyncio.run(run_test())

def test_anthropic_stream_exception():
    async def run_test():
        mock_client = mock.Mock()
        mock_client.messages.stream.side_effect = Exception("Anthropic failed")
        
        chunks = []
        async for chunk in anthtropic_stream(mock_client, "system", "user", "model"):
            chunks.append(chunk)
        
        assert len(chunks) == 1
        assert "[SERVER_ERROR]" in chunks[0]
        assert "Anthropic failed" in chunks[0]

    asyncio.run(run_test())
