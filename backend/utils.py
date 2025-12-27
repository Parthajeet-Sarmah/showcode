import logging
import config
import base64

from functools import lru_cache
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

@lru_cache
def get_settings():
    return config.Settings()

def decrypt_envelope(encrypted_dek_b64: str, iv_b64: str, ciphertext_b64: str, private_key_pem: str) -> str:
    """
    Unwraps the AES key using RSA Private Key, then decrypts the data.
    """
    try:
        # 1. Load Private Key (KEK)
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode(),
            password=None
        )

        if not isinstance(private_key, rsa.RSAPrivateKey):
            raise ValueError("Loaded key is not an RSA Private Key")

        # 2. Decode Base64 inputs
        encrypted_dek = base64.b64decode(encrypted_dek_b64)
        iv = base64.b64decode(iv_b64)
        ciphertext = base64.b64decode(ciphertext_b64)

        # 3. Unwrap DEK (Decrypt AES Key using RSA)
        dek = private_key.decrypt(
            encrypted_dek,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        # 4. Decrypt Data using DEK (AES-GCM)
        aesgcm = AESGCM(dek)
        plaintext_bytes = aesgcm.decrypt(iv, ciphertext, None)
        
        return plaintext_bytes.decode('utf-8')

    except Exception as e:
        logging.error(f"Envelope Decryption Failed: {e}")
        return "error"
