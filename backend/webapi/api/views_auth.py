"""
Auth views — login, signup, Google OAuth, me, logout (§9.1).
"""

import json
import os

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.services.auth_service import (
    authenticate, generate_session, revoke_session,
    find_by_token, register_account, register_with_google,
)
from api.services.team_service import _get_setting
from api.models import Account, Participant

from .views_shared import (
    _json_body, _extract_token, _auth_or_401,
    _set_auth_cookie, _clear_auth_cookie,
    AUTH_COOKIE_NAME,
)

import secrets
from datetime import datetime, timezone


@csrf_exempt
def login_view(request: HttpRequest):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    if not username or not password:
        return JsonResponse({"error": "missing_credentials"}, status=400)

    acc, err = authenticate(username, password)
    if err:
        return JsonResponse({"error": err}, status=401)

    token = generate_session(acc)
    resp = JsonResponse({
        "token": token,
        "user": {
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
        },
    })
    _set_auth_cookie(resp, token, request)
    return resp


def me_view(request: HttpRequest):
    acc, err = _auth_or_401(request)
    if err:
        return err
    participant = Participant.objects.filter(mssv=acc.mssv).first() if acc.mssv else None
    return JsonResponse({
        "username": acc.username,
        "email": acc.email,
        "role": acc.role,
        "mssv": acc.mssv,
        "full_name": acc.full_name,
        "last_login": acc.last_login.isoformat() if acc.last_login else None,
        "profile_complete": bool(acc.mssv and participant and participant.full_name),
    })


@csrf_exempt
def logout_view(request: HttpRequest):
    token = _extract_token(request)
    if token:
        acc = find_by_token(token)
        if acc:
            revoke_session(acc)
    resp = JsonResponse({"status": "logged_out"})
    _clear_auth_cookie(resp)
    return resp


@csrf_exempt
def register_view(request: HttpRequest):
    """Register admin/collab account (gated by ADMIN_REGISTER_SECRET)."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)

    # Gate: if any admin exists, require secret
    admin_exists = Account.objects.filter(role=Account.ROLE_ADMIN, is_active=True).exists()
    if admin_exists:
        server_secret = os.getenv("ADMIN_REGISTER_SECRET")
        provided = str((data.get("secret") or request.headers.get("X-Register-Secret") or "").strip())
        if not server_secret or provided != server_secret:
            return JsonResponse({"error": "forbidden"}, status=403)

    acc, err = register_account(username, email, password, role=Account.ROLE_ADMIN)
    if err:
        status = 409 if "exists" in err else 500
        return JsonResponse({"error": err}, status=status)

    token = generate_session(acc)
    resp = JsonResponse({
        "token": token,
        "user": {"username": acc.username, "email": acc.email, "role": acc.role},
    }, status=201)
    _set_auth_cookie(resp, token, request)
    return resp


@csrf_exempt
def signup_view(request: HttpRequest):
    """Participant self-registration (gated by registration_open)."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    if not _get_setting("registration_open"):
        return JsonResponse({"error": "registration_closed"}, status=403)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    mssv = str((data.get("mssv") or "").strip()) or None
    full_name = str((data.get("full_name") or "").strip()) or None

    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)

    acc, err = register_account(
        username, email, password,
        role=Account.ROLE_PARTICIPANT,
        mssv=mssv, full_name=full_name,
    )
    if err:
        status = 409 if "exists" in err else 500
        return JsonResponse({"error": err}, status=status)

    token = generate_session(acc)
    resp = JsonResponse({
        "token": token,
        "user": {
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "mssv": acc.mssv,
        },
    }, status=201)
    _set_auth_cookie(resp, token, request)
    return resp


@csrf_exempt
def google_login_view(request: HttpRequest):
    """Google Identity Services sign-in."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    credential = str((data.get("credential") or "").strip())
    if not credential:
        return JsonResponse({"error": "missing_credential"}, status=400)

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        return JsonResponse({"error": "google_auth_not_configured"}, status=500)

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
    except ImportError:
        return JsonResponse({"error": "google_auth_not_configured"}, status=500)

    try:
        id_info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), clock_skew_in_seconds=30,
        )
    except ValueError as e:
        return JsonResponse({"error": "invalid_google_token", "detail": str(e)}, status=401)

    if id_info.get("aud") != client_id and client_id not in (id_info.get("azp") or ""):
        return JsonResponse({"error": "token_audience_mismatch"}, status=401)

    email = (id_info.get("email") or "").strip()
    if not email:
        return JsonResponse({"error": "missing_email_in_token"}, status=400)
    if not bool(id_info.get("email_verified")):
        return JsonResponse({"error": "email_not_verified"}, status=401)

    google_name = (id_info.get("name") or "").strip()
    google_sub = id_info.get("sub")

    if not _get_setting("registration_open"):
        # Only allow existing accounts to log in
        acc = Account.objects.filter(email__iexact=email, is_active=True).first()
        if not acc:
            return JsonResponse({"error": "registration_closed"}, status=403)
        token = generate_session(acc)
        resp = JsonResponse({
            "token": token,
            "user": {"username": acc.username, "email": acc.email, "role": acc.role},
            "is_new": False,
        })
        _set_auth_cookie(resp, token, request)
        return resp

    acc, is_new, err = register_with_google(email, google_sub, google_name)
    if err:
        return JsonResponse({"error": err}, status=500)

    token = generate_session(acc)
    resp = JsonResponse({
        "token": token,
        "user": {"username": acc.username, "email": acc.email, "role": acc.role},
        "is_new": is_new,
    }, status=201 if is_new else 200)
    _set_auth_cookie(resp, token, request)
    return resp
