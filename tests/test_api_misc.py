import pytest
import os
from fastapi.testclient import TestClient
from backend.api import app

client = TestClient(app)

def test_get_rsa_public_key():
    # Create a dummy rsa_public.pem
    with open("rsa_public.pem", "w") as f:
        f.write("FAKE KEY")
    
    try:
        response = client.get("/.well-known/rsa-key")
        assert response.status_code == 200
        assert response.text == "FAKE KEY"
    finally:
        # Cleanup
        if os.path.exists("rsa_public.pem"):
            os.remove("rsa_public.pem")

def test_cors_headers():
    # Simple check if CORS middleware is active
    response = client.options(
        "/analyze",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        }
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
