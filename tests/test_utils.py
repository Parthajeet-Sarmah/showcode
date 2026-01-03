import pytest
import base64
import os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from backend.utils import decrypt_envelope

@pytest.fixture
def rsa_keys():
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')
    
    return private_key, public_key, private_pem

def encrypt_envelope(data: str, public_key) -> tuple[str, str, str]:
    # Generate AES Key (DEK)
    dek = AESGCM.generate_key(bit_length=256)
    aesgcm = AESGCM(dek)
    iv = os.urandom(12)
    
    # Encrypt Data
    ciphertext = aesgcm.encrypt(iv, data.encode('utf-8'), None)
    
    # Encrypt DEK with RSA
    encrypted_dek = public_key.encrypt(
        dek,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )
    
    return (
        base64.b64encode(encrypted_dek).decode('utf-8'),
        base64.b64encode(iv).decode('utf-8'),
        base64.b64encode(ciphertext).decode('utf-8')
    )

def test_decrypt_envelope_success(rsa_keys):
    private_key, public_key, private_pem = rsa_keys
    original_text = "secret_api_key"
    
    encrypted_dek, iv, ciphertext = encrypt_envelope(original_text, public_key)
    
    decrypted = decrypt_envelope(encrypted_dek, iv, ciphertext, private_pem)
    assert decrypted == original_text

def test_decrypt_envelope_invalid_key(rsa_keys):
    # Generate a different key pair
    diff_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    diff_private_pem = diff_private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')
    
    _, public_key, _ = rsa_keys
    original_text = "secret_api_key"
    
    encrypted_dek, iv, ciphertext = encrypt_envelope(original_text, public_key)
    
    # Try to decrypt with wrong private key
    decrypted = decrypt_envelope(encrypted_dek, iv, ciphertext, diff_private_pem)
    assert decrypted == "error"

def test_decrypt_envelope_malformed_input(rsa_keys):
    _, _, private_pem = rsa_keys
    decrypted = decrypt_envelope("not_b64", "not_b64", "not_b64", private_pem)
    assert decrypted == "error"
