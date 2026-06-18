"""
Shared utilities used across all view modules.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta
from typing import Any

from django.http import JsonResponse, HttpRequest
from django.conf import settings

from api.services.auth_service import find_by_token
from api.models import Account

AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "token")

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
except Exception:
    LOCAL_TZ = timezone(timedelta(hours=7))


# --- JSON parsing ---

def _json_body(request: HttpRequest) -> dict | None:
    """Parse JSON body; return dict, or None if invalid."""
    try:
        return json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return None


# --- Auth helpers ---

def _extract_token(request: HttpRequest) -> str | None:
    """Extract token from Authorization header, query param, or cookie."""
    header = request.headers.get("Authorization") or request.META.get("HTTP_AUTHORIZATION")
    token = None
    if header:
        parts = header.strip().split()
        if len(parts) == 2 and parts[0].lower() in {"bearer", "token", "jwt"}:
            token = parts[1].strip()
        elif len(parts) == 1:
            token = parts[0].strip()
    if not token:
        token = request.GET.get("token") or request.COOKIES.get(AUTH_COOKIE_NAME)
    return token or None


def _auth_or_401(request: HttpRequest):
    """Return (account, None) or (None, JsonResponse 401)."""
    token = _extract_token(request)
    if not token:
        return None, JsonResponse({"error": "missing_token"}, status=401)
    acc = find_by_token(token)
    if not acc:
        return None, JsonResponse({"error": "invalid_token"}, status=401)
    return acc, None


def _require_role(request: HttpRequest, *roles: str):
    """Auth + role check. Returns (account, None) or (None, JsonResponse)."""
    acc, err = _auth_or_401(request)
    if err:
        return None, err
    if acc.role not in roles:
        return None, JsonResponse({"error": "forbidden"}, status=403)
    return acc, None


# --- Cookie helpers ---

def _set_auth_cookie(resp: JsonResponse, token: str, request: HttpRequest) -> None:
    """Set HttpOnly auth cookie."""
    try:
        max_age = int(os.getenv("AUTH_COOKIE_MAX_AGE", "1209600"))
    except Exception:
        max_age = 1209600
    samesite = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
    secure_env = os.getenv("AUTH_COOKIE_SECURE", "")
    secure = (
        secure_env.lower() in {"1", "true", "yes"}
        or request.is_secure()
        or not getattr(settings, "DEBUG", True)
    )
    resp.set_cookie(
        AUTH_COOKIE_NAME, token, max_age=max_age,
        httponly=True, secure=secure, samesite=samesite, path="/api",
    )


def _clear_auth_cookie(resp: JsonResponse) -> None:
    resp.delete_cookie(AUTH_COOKIE_NAME, path="/api")


# --- Misc ---

def _dt_to_iso(dt: datetime | None) -> str | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _format_local_time(dt: datetime | None) -> str | None:
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local_dt = dt.astimezone(LOCAL_TZ)
    return local_dt.strftime("%H:%M:%S %d/%m/%Y GMT%z")
