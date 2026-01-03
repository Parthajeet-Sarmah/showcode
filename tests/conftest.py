import pytest
from fastapi.testclient import TestClient
from backend.api import app, limiter

# Disable rate limiting for all tests
limiter.enabled = False

@pytest.fixture(scope="module")
def client():
    return TestClient(app)

@pytest.fixture
def base_payload():
    return {
        "code": "print('hello')",
        "context": "test context"
    }

@pytest.fixture
def base_headers():
    return {
        "x-local-alignment-model": "test-model",
        "x-local-snippet-model": "test-model",
        "x-local-url": "http://test.com",
        "x-use-snippet-model": "false",
        "x-use-local-provider": "false",
        "x-default-local-provider": "ollama",
        "x-default-cloud-provider": "gemini",
        "x-cloud-api-key": "encrypted",
        "x-cloud-encrypted-key": "encrypted",
        "x-cloud-iv": "iv",
    }