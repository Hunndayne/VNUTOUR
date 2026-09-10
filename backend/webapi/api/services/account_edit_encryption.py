"""Short-lived, session-bound grants for encrypted admin account updates.

Return ``create_edit_grant`` only inside the encrypted account-details payload.
The grant wraps a random AES key and the viewed revision using the existing
Django secret. No key, grant or plaintext belongs in logs or persistent storage.
The caller must authorize the admin and atomically check the returned revision
before applying changes; encryption does not replace either of those checks.
"""
import base64
import binascii
import hashlib
import json
import re

from cryptography.exceptions import InvalidTag
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.utils.crypto import constant_time_compare, salted_hmac


GRANT_TTL_SECONDS = 300
MAX_EDIT_PLAINTEXT_BYTES = 128 * 1024
_MAX_CIPHERTEXT_CHARS = ((MAX_EDIT_PLAINTEXT_BYTES + 16 + 2) // 3) * 4
_GRANT_PURPOSE = "admin-account-edit-grant-v1"
_REVISION_KEYS = ("account_updated_at", "participant_id", "participant_updated_at")


class EditEncryptionError(Exception):
    def __init__(self, code="invalid_encrypted_request", status=400):
        super().__init__(code)
        self.code = code
        self.status = status


def _grant_cipher():
    derived = salted_hmac(
        _GRANT_PURPOSE, _GRANT_PURPOSE,
        secret=settings.SECRET_KEY, algorithm="sha256",
    ).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def _b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_b64url(value, *, max_length):
    if (
        not isinstance(value, str) or not value or len(value) > max_length
        or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None
    ):
        raise EditEncryptionError()
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as exc:
        raise EditEncryptionError() from exc


def _session_hash(actor):
    if not isinstance(actor.token, str) or not actor.token:
        raise EditEncryptionError("edit_session_invalid", 403)
    return hashlib.sha256(actor.token.encode("utf-8")).hexdigest()


def create_edit_grant(actor, target, payload):
    """Create ``{key, grant}`` metadata for the encrypted details response."""
    key = _b64url(AESGCM.generate_key(bit_length=256))
    participant = payload.get("participant") or {}
    claims = {
        "key": key,
        "actor_id": str(actor.id),
        "target_id": str(target.id),
        "session_hash": _session_hash(actor),
        "account_updated_at": payload["account"]["updated_at"],
        "participant_id": participant.get("id"),
        "participant_updated_at": participant.get("updated_at"),
    }
    grant = _grant_cipher().encrypt(
        json.dumps(claims, separators=(",", ":")).encode("utf-8"),
    ).decode("ascii")
    return {"key": key, "grant": grant}


def decrypt_edit_request(actor, target, data):
    """Return ``(changes, expected_revision)`` after validating the envelope.

    AES-GCM uses a fresh 12-byte IV, a 128-bit tag appended to ciphertext, and
    UTF-8 AAD ``vnutour-account-edit-v1:<target.id>`` (the canonical numeric ID,
    never the username from the URL). Revision checks belong to the caller's
    update transaction so concurrent changes and successful replays are rejected.
    """
    if not isinstance(data, dict) or set(data) != {"grant", "iv", "ciphertext"}:
        raise EditEncryptionError()
    grant = data["grant"]
    if not isinstance(grant, str) or not grant or len(grant) > 8192:
        raise EditEncryptionError()
    nonce = _decode_b64url(data["iv"], max_length=16)
    ciphertext = _decode_b64url(data["ciphertext"], max_length=_MAX_CIPHERTEXT_CHARS)
    if len(nonce) != 12 or not 16 < len(ciphertext) <= MAX_EDIT_PLAINTEXT_BYTES + 16:
        raise EditEncryptionError()
    try:
        claims = json.loads(_grant_cipher().decrypt(grant.encode("ascii"), ttl=GRANT_TTL_SECONDS))
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise EditEncryptionError("edit_session_expired", 410) from exc
    if not isinstance(claims, dict) or not all(field in claims for field in _REVISION_KEYS):
        raise EditEncryptionError("edit_session_expired", 410)
    if (
        claims.get("actor_id") != str(actor.id)
        or claims.get("target_id") != str(target.id)
        or not constant_time_compare(claims.get("session_hash", ""), _session_hash(actor))
    ):
        raise EditEncryptionError("edit_session_invalid", 403)
    key = _decode_b64url(claims.get("key"), max_length=43)
    if len(key) != 32:
        raise EditEncryptionError()
    try:
        plaintext = AESGCM(key).decrypt(
            nonce, ciphertext, f"vnutour-account-edit-v1:{target.id}".encode("utf-8"),
        )
        changes = json.loads(plaintext)
    except (InvalidTag, UnicodeError, ValueError, RecursionError) as exc:
        raise EditEncryptionError() from exc
    if not isinstance(changes, dict):
        raise EditEncryptionError()
    return changes, {field: claims[field] for field in _REVISION_KEYS}
