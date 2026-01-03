import pytest
from unittest import mock
from fastapi.testclient import TestClient
from backend.api import settings  # Import the specific instance used by the app

@pytest.fixture
def demo_mode_settings():
    # Manually override the global settings object attributes
    # This ensures the running app sees the changes immediately
    original_demo_mode = settings.DEMO_MODE
    original_server_key = settings.SERVER_SIDE_API_KEY
    
    settings.DEMO_MODE = True
    settings.SERVER_SIDE_API_KEY = "server_secret"
    
    yield settings
    
    # Restore original values
    settings.DEMO_MODE = original_demo_mode
    settings.SERVER_SIDE_API_KEY = original_server_key

def test_analyze_demo_mode_success(client, base_payload, demo_mode_settings):
    # Simulate a request with NO client keys
    headers = {
        "x-use-local-provider": "false",
        "x-default-cloud-provider": "gemini",
        # Missing keys and other headers, relying on Demo Mode to bypass strict check
    }
    
    with mock.patch("backend.api.genai.Client") as mock_genai:
        instance = mock_genai.return_value
        # Mock the stream
        class MockStream:
            def __iter__(self):
                yield mock.Mock(text="demo content")
                
        instance.models.generate_content_stream.return_value = MockStream()

        response = client.post("/analyze", json=base_payload, headers=headers)
        
        assert response.status_code == 200
        assert "".join(response.iter_text()) == "demo content"
        
        # Verify it initialized Client with the SERVER key
        mock_genai.assert_called_with(api_key="server_secret")