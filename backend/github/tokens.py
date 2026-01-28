"""
Token encryption and management using Fernet (AES-128).
"""

import logging
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken


class TokenManager:
    """Handles encryption and decryption of GitHub tokens at rest."""

    def __init__(self, encryption_key: str):
        """
        Initialize the token manager with a Fernet encryption key.

        Args:
            encryption_key: Base64-encoded Fernet key (32 bytes encoded).
                           Generate with: Fernet.generate_key()
        """
        if not encryption_key:
            logging.warning("No encryption key provided - tokens will not be encrypted")
            self._fernet = None
        else:
            try:
                self._fernet = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
            except Exception as e:
                logging.error(f"Invalid encryption key: {e}")
                self._fernet = None

    def encrypt(self, plaintext: str) -> Optional[str]:
        """
        Encrypt a plaintext token.

        Args:
            plaintext: The token to encrypt.

        Returns:
            Base64-encoded encrypted token, or None if encryption fails.
        """
        if not self._fernet:
            logging.warning("Encryption not available - returning plaintext")
            return plaintext

        try:
            encrypted = self._fernet.encrypt(plaintext.encode())
            return encrypted.decode()
        except Exception as e:
            logging.error(f"Token encryption failed: {e}")
            return None

    def decrypt(self, ciphertext: str) -> Optional[str]:
        """
        Decrypt an encrypted token.

        Args:
            ciphertext: Base64-encoded encrypted token.

        Returns:
            Decrypted plaintext token, or None if decryption fails.
        """
        if not self._fernet:
            logging.warning("Decryption not available - returning ciphertext")
            return ciphertext

        try:
            decrypted = self._fernet.decrypt(ciphertext.encode())
            return decrypted.decode()
        except InvalidToken:
            logging.error("Invalid token - decryption failed (token may be corrupted or key mismatch)")
            return None
        except Exception as e:
            logging.error(f"Token decryption failed: {e}")
            return None

    @staticmethod
    def generate_key() -> str:
        """
        Generate a new Fernet encryption key.

        Returns:
            Base64-encoded encryption key suitable for TOKEN_ENCRYPTION_KEY env var.
        """
        return Fernet.generate_key().decode()

    def is_available(self) -> bool:
        """Check if encryption is available."""
        return self._fernet is not None
