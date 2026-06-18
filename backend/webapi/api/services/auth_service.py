"""
Authentication service — token management, login/signup, Google OAuth.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple

from django.contrib.auth.hashers import make_password, check_password
from django.db import IntegrityError

from api.models import Account


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
    acc.last_login = datetime.now(timezone.utc)
    acc.save(update_fields=["token", "last_login"])
    return token


def revoke_session(acc: Account) -> None:
    """Clear the auth token."""
    acc.token = None
    acc.save(update_fields=["token"])


def find_by_token(token: str) -> Optional[Account]:
    """Look up an active account by session token."""
    if not token:
        return None
    try:
        return Account.objects.filter(token=token, is_active=True).first()
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
