"""Shared symmetric encryption for stored secrets.

Used by both agent credentials (agents/credentials.py) and workspace
credentials (workspace_credentials.py). AES-256-GCM with a key derived from
AGENT_CREDENTIALS_KEY — the key lives ONLY in this FastAPI process, never in
Convex or the browser. One key, one rotation story.
"""

import base64
import hashlib
import os

from app.config import settings

MAX_SECRET_LENGTH = 32_768


class CredentialCryptoError(Exception):
    """Encryption key missing or ciphertext cannot be decrypted."""


def _aes_key() -> bytes:
    raw = settings.agent_credentials_key
    if not raw:
        raise CredentialCryptoError(
            "AGENT_CREDENTIALS_KEY is not set — encrypted credentials are "
            "disabled on this deployment."
        )
    # Accept any non-empty string; derive a uniform 32-byte key.
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(plaintext: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    sealed = AESGCM(_aes_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + sealed).decode("ascii")


def decrypt_secret(ciphertext_b64: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        blob = base64.b64decode(ciphertext_b64)
        nonce, sealed = blob[:12], blob[12:]
        return AESGCM(_aes_key()).decrypt(nonce, sealed, None).decode("utf-8")
    except CredentialCryptoError:
        raise
    except Exception as e:
        raise CredentialCryptoError(f"Failed to decrypt credential: {e}") from e
