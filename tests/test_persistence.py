import pytest
from unittest import mock
from backend import database

# --- Database Unit Tests ---

@pytest.fixture
def temp_db(tmp_path):
    db_path = tmp_path / "test_alignments.db"
    # Patch the DB_NAME in the database module
    with mock.patch("backend.database.DB_NAME", str(db_path)):
        database.init_db()
        yield str(db_path)

def test_database_operations(temp_db):
    # Test Save
    database.save_alignment("sig1", "content1")
    
    # Test Get All
    alignments = database.get_all_alignments()
    assert len(alignments) == 1
    assert alignments["sig1"] == "content1"
    
    # Test Upsert (Replace)
    database.save_alignment("sig1", "content1_updated")
    alignments = database.get_all_alignments()
    assert len(alignments) == 1
    assert alignments["sig1"] == "content1_updated"
    
    # Test Multiple
    database.save_alignment("sig2", "content2")
    alignments = database.get_all_alignments()
    assert len(alignments) == 2
    assert alignments["sig2"] == "content2"

# --- API Integration Tests ---

@pytest.fixture
def mock_db_funcs():
    with mock.patch("backend.api.save_alignment") as mock_save, \
         mock.patch("backend.api.get_all_alignments") as mock_get:
        yield mock_save, mock_get

@pytest.fixture
def mock_generators():
    # Mock the endpoint logic by injecting a fake handler into REQUEST_MAP
    
    async def fake_generator():
        yield "part1 "
        yield "part2"

    async def fake_endpoint(*args, **kwargs):
        from fastapi.responses import StreamingResponse
        return StreamingResponse(fake_generator(), media_type="text/plain")

    # We patch the REQUEST_MAP in backend.api
    with mock.patch.dict("backend.api.REQUEST_MAP", {"analyze_codesnippet_test": fake_endpoint}):
         yield

def test_get_alignments_endpoint(client, mock_db_funcs):
    mock_save, mock_get = mock_db_funcs
    mock_get.return_value = {"sig1": "text1"}
    
    response = client.get("/alignments")
    assert response.status_code == 200
    assert response.json() == {"sig1": "text1"}
    mock_get.assert_called_once()

def test_analyze_endpoint_saves_alignment(client, base_headers, base_payload, mock_db_funcs, mock_generators):
    mock_save, mock_get = mock_db_funcs
    
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-default-local-provider": "test", # Maps to analyze_codesnippet_test
        "x-snippet-signature": "my_unique_sig" # The new header
    })
    
    response = client.post("/analyze", headers=headers, json=base_payload)
    assert response.status_code == 200
    
    # Consume the stream to trigger saving
    content = "".join(response.iter_text())
    assert content == "part1 part2"
    
    # Verify save_alignment was called with the correct signature and accumulated content
    mock_save.assert_called_once_with("my_unique_sig", "part1 part2")

def test_analyze_endpoint_no_signature_no_save(client, base_headers, base_payload, mock_db_funcs, mock_generators):
    mock_save, mock_get = mock_db_funcs
    
    headers = base_headers.copy()
    headers.update({
        "x-use-local-provider": "true",
        "x-use-snippet-model": "true",
        "x-default-local-provider": "test", 
    })
    
    response = client.post("/analyze", headers=headers, json=base_payload)
    assert response.status_code == 200
    content = "".join(response.iter_text())
    assert content == "part1 part2"
    
    mock_save.assert_not_called()