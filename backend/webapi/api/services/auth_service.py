"""
Authentication service — token management, login/signup, Google OAuth.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from django.db import IntegrityError
from django.utils import timezone as django_timezone

from api.models import Account, PasswordResetToken


def authenticate(username: str, password: str) -> Tuple[Optional[Account], Optional[str]]:
    """Validate credentials. Returns (account, None) or (None, error_code)."""
    acc = Account.objects.filter(username__iexact=username, is_active=True).first()
    if not acc or not check_password(password, acc.password_hash):
        return None, "invalid_credentials"
    return acc, None


def generate_session(acc: Account) -> str:
    """Create a new auth token and persist it. Returns the token."""
    token = secrets.token_urlsafe(32)
    acc.token = token
    now = datetime.now(timezone.utc)
    acc.token_created_at = now
    acc.last_login = now
    acc.save(update_fields=["token", "token_created_at", "last_login"])
    return token


def revoke_session(acc: Account) -> None:
    """Clear the auth token."""
    acc.token = None
    acc.token_created_at = None
    acc.save(update_fields=["token", "token_created_at"])


def find_by_token(token: str) -> Optional[Account]:
    """Look up an active account by session token."""
    if not token:
        return None
    try:
        acc = Account.objects.filter(token=token, is_active=True).first()
        if not acc or not acc.token_created_at:
            return None
        max_age = max(60, int(getattr(settings, "AUTH_TOKEN_MAX_AGE_SECONDS", 86400)))
        if acc.token_created_at + timedelta(seconds=max_age) <= django_timezone.now():
            revoke_session(acc)
            return None
        return acc
    except Exception:
        return None


def register_account(
    username: str,
    email: str,
    password: str,
    role: str = Account.ROLE_PARTICIPANT,
    mssv: str | None = None,
    full_name: str | None = None,
    google_sub: str | None = None,
) -> Tuple[Optional[Account], Optional[str]]:
    """Create a new account. Returns (account, None) or (None, error_code)."""
    if len(password or "") < int(getattr(settings, "AUTH_MIN_PASSWORD_LENGTH", 8)):
        return None, "password_too_short"
    try:
        acc = Account(
            username=username,
            email=email,
            password_hash=make_password(password),
            role=role,
            is_active=True,
            mssv=mssv,
            full_name=full_name,
            google_sub=google_sub,
        )
        acc.save()
        return acc, None
    except IntegrityError:
        return None, "username_email_or_mssv_exists"
    except Exception:
        return None, "server_error"


def register_with_google(
    email: str,
    google_sub: str,
    google_name: str | None = None,
) -> Tuple[Optional[Account], bool, Optional[str]]:
    """
    Login or register via Google OAuth.
    Returns (account, is_new, error_code).
    """
    acc = Account.objects.filter(email__iexact=email, is_active=True).first()

    if acc:
        # Existing account — link google_sub if not set
        if not acc.google_sub:
            acc.google_sub = google_sub
            acc.save(update_fields=["google_sub"])
        return acc, False, None

    # New account
    base_username = email.split("@")[0][:45]
    username = base_username
    suffix = 1
    while Account.objects.filter(username__iexact=username).exists():
        username = f"{base_username}{suffix}"
        suffix += 1
        if suffix > 99:
            username = f"{base_username}_{secrets.token_hex(3)}"
            break

    acc, err = register_account(
        username=username,
        email=email,
        password=secrets.token_urlsafe(32),
        role=Account.ROLE_PARTICIPANT,
        full_name=google_name,
        google_sub=google_sub,
    )
    return acc, True, err


# ---------------------------------------------------------------------------
# Forgot / reset password
# ---------------------------------------------------------------------------

def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_password_reset_token(acc: Account) -> str:
    """Issue a fresh one-time reset token for `acc`.

    Any of the account's prior unused tokens are invalidated first, so an
    inbox holding several reset emails can only ever act on the latest one.
    Only the token's hash is persisted — the raw value returned here is meant
    to be emailed and never stored.
    """
    now = django_timezone.now()
    PasswordResetToken.objects.filter(account=acc, used_at__isnull=True).update(used_at=now)

    raw_token = secrets.token_urlsafe(32)
    ttl_hours = max(1, int(getattr(settings, "PASSWORD_RESET_TOKEN_TTL_HOURS", 2)))
    PasswordResetToken.objects.create(
        account=acc,
        token_hash=_hash_reset_token(raw_token),
        expires_at=now + timedelta(hours=ttl_hours),
    )
    return raw_token


def consume_password_reset_token(raw_token: str, new_password: str) -> Optional[str]:
    """Validate a reset token and apply `new_password`. Returns an error code, or None on success."""
    if len(new_password or "") < int(getattr(settings, "AUTH_MIN_PASSWORD_LENGTH", 8)):
        return "password_too_short"

    record = (
        PasswordResetToken.objects
        .select_related("account")
        .filter(token_hash=_hash_reset_token(raw_token or ""))
        .first()
    )
    now = django_timezone.now()
    if not record or record.used_at or record.expires_at <= now:
        return "invalid_or_expired_token"

    acc = record.account
    # A Google-only account can never have received this token (see
    # forgot_password_view), but re-check here in case it linked Google
    # in between requesting and using the link.
    if not acc or not acc.is_active or acc.google_sub:
        return "invalid_or_expired_token"

    acc.password_hash = make_password(new_password)
    acc.save(update_fields=["password_hash"])

    record.used_at = now
    record.save(update_fields=["used_at"])
    # Belt and suspenders: any other still-unused token for this account is
    # now stale too (the password it would have reset has already changed).
    PasswordResetToken.objects.filter(account=acc, used_at__isnull=True).exclude(id=record.id).update(used_at=now)
    return None
