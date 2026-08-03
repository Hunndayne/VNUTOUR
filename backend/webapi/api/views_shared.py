"""
Shared utilities used across all view modules.
"""

from __future__ import annotations

import json
import os
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any

from django.http import JsonResponse, HttpRequest
from django.conf import settings
from django.core.cache import cache
from django.middleware.csrf import CsrfViewMiddleware

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

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


class _CsrfChecker(CsrfViewMiddleware):
    """Runs the stock CSRF check on demand and reports the reason instead of a response.

    Nearly every mutating view here is `@csrf_exempt`, which suits the token in
    the Authorization header — a browser never attaches that header to someone
    else's cross-site request. It does not suit the auth cookie, which browsers
    do attach automatically, so a cookie session needs the check put back.
    """

    def _reject(self, request, reason):
        return reason


def _token_from_request(request: HttpRequest) -> tuple[str | None, bool]:
    """Return (token, came_from_cookie)."""
    header = request.headers.get("Authorization") or request.META.get("HTTP_AUTHORIZATION")
    token = None
    if header:
        parts = header.strip().split()
        if len(parts) == 2 and parts[0].lower() in {"bearer", "token", "jwt"}:
            token = parts[1].strip()
        elif len(parts) == 1:
            token = parts[0].strip()
    if token:
        return token, False
    cookie_token = request.COOKIES.get(AUTH_COOKIE_NAME)
    return (cookie_token or None), bool(cookie_token)


def _extract_token(request: HttpRequest) -> str | None:
    """Extract token from Authorization header or HttpOnly cookie."""
    token, _ = _token_from_request(request)
    return token


def _cookie_session_csrf_error(request: HttpRequest, from_cookie: bool):
    """403 when a cookie-authenticated write arrives without a valid CSRF token.

    SameSite=Lax blocks the obvious cross-site POST, but it is one cookie
    attribute away from not applying, and it never covered a sibling subdomain.
    Returns None when the request is safe, header-authenticated, or checks out.
    """
    if not from_cookie or request.method in SAFE_METHODS:
        return None
    reason = _CsrfChecker(lambda r: None).process_view(request, None, (), {})
    if reason is None:
        return None
    return JsonResponse({"error": "csrf_required"}, status=403)


def _client_ip(request: HttpRequest) -> str:
    if getattr(settings, "TRUST_PROXY_HEADERS", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
    return request.META.get("REMOTE_ADDR") or "unknown"


def _consume_rate_limit(
    request: HttpRequest,
    *,
    scope: str,
    identifier: str = "",
    limit: int,
    window_seconds: int,
):
    """Consume one request from a fixed-window cache rate limit."""
    limit = max(1, int(limit))
    window_seconds = max(1, int(window_seconds))
    raw_key = f"{scope}:{_client_ip(request)}:{identifier.strip().lower()}"
    digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    cache_key = f"vnutour:rate:{digest}"

    if cache.add(cache_key, 1, timeout=window_seconds):
        return None, cache_key
    try:
        count = cache.incr(cache_key)
    except ValueError:
        cache.set(cache_key, 1, timeout=window_seconds)
        count = 1
    if count <= limit:
        return None, cache_key

    response = JsonResponse(
        {"error": "too_many_attempts", "retry_after": window_seconds},
        status=429,
    )
    response["Retry-After"] = str(window_seconds)
    return response, cache_key


def _auth_or_401(request: HttpRequest):
    """Return (account, None) or (None, JsonResponse 401/403)."""
    token, from_cookie = _token_from_request(request)
    if not token:
        return None, JsonResponse({"error": "missing_token"}, status=401)
    acc = find_by_token(token)
    if not acc:
        return None, JsonResponse({"error": "invalid_token"}, status=401)
    csrf_error = _cookie_session_csrf_error(request, from_cookie)
    if csrf_error is not None:
        return None, csrf_error
    return acc, None


def _require_role(request: HttpRequest, *roles: str):
    """Auth + role check. Returns (account, None) or (None, JsonResponse).

    A master admin satisfies any gate that admits an admin — the role is a
    superset, so every existing `_require_role(..., ROLE_ADMIN)` keeps working
    without being rewritten. Gates that must exclude plain admins use
    `_require_master_admin` instead.
    """
    acc, err = _auth_or_401(request)
    if err:
        return None, err
    allowed = set(roles)
    if Account.ROLE_ADMIN in allowed:
        allowed.add(Account.ROLE_MASTER_ADMIN)
    if acc.role not in allowed:
        return None, JsonResponse({"error": "forbidden"}, status=403)
    return acc, None


def is_admin(acc) -> bool:
    """Whether an account has admin authority — master admins included.

    Views that branch on the role inline (to widen a payload, to allow an edit)
    must go through this rather than comparing to ROLE_ADMIN directly, or a
    master admin silently gets treated as less privileged than an admin.
    """
    return bool(acc) and acc.role in (Account.ROLE_ADMIN, Account.ROLE_MASTER_ADMIN)


def _require_master_admin(request: HttpRequest):
    """Auth + master-admin check, for changes to the shape of the programme.

    Guards the current phase, the phase calendar, sub-events and stations, plus
    the two indirect routes to the same outcome: undoing a `phase.change` audit
    entry, and restoring a backup (which rewrites accounts, phases and stations
    wholesale).
    """
    acc, err = _auth_or_401(request)
    if err:
        return None, err
    if acc.role != Account.ROLE_MASTER_ADMIN:
        return None, JsonResponse({"error": "master_admin_required"}, status=403)
    return acc, None


# --- Cookie helpers ---

def _set_auth_cookie(resp: JsonResponse, token: str, request: HttpRequest) -> None:
    """Set HttpOnly auth cookie."""
    try:
        configured_max_age = int(os.getenv("AUTH_COOKIE_MAX_AGE", "1209600"))
    except Exception:
        configured_max_age = 1209600
    max_age = min(
        configured_max_age,
        int(getattr(settings, "AUTH_TOKEN_MAX_AGE_SECONDS", configured_max_age)),
    )
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
