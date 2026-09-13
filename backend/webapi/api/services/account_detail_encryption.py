"""JWE compact responses: RSA-OAEP-256 key wrapping and A256GCM content.

Only a per-request browser public key reaches the server. HTTPS is still
required to authenticate the server and protect the request/session token.
"""
import base64
import binascii
import json
import os

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def load_browser_public_key(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise ValueError("invalid_public_key")
    try:
        key = serialization.load_der_public_key(base64.b64decode(value, validate=True))
    except (ValueError, TypeError, binascii.Error, UnsupportedAlgorithm) as exc:
        raise ValueError("invalid_public_key") from exc
    if (
        not isinstance(key, rsa.RSAPublicKey)
        or key.key_size not in (2048, 3072, 4096)
        or key.public_numbers().e != 65537
    ):
        raise ValueError("invalid_public_key")
    return key


def encrypt_account_details(payload, public_key, *, username):
    protected = _b64url(json.dumps({
        "alg": "RSA-OAEP-256", "enc": "A256GCM",
        "typ": "vnutour-account-details+jwe", "account": username,
    }, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext_and_tag = AESGCM(key).encrypt(
        nonce,
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        protected.encode("ascii"),
    )
    wrapped_key = public_key.encrypt(
        key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return {"encrypted": True, "jwe": ".".join([
        protected, _b64url(wrapped_key), _b64url(nonce),
        _b64url(ciphertext_and_tag[:-16]), _b64url(ciphertext_and_tag[-16:]),
    ])}
