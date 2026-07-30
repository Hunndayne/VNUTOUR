"""
Auth views — login, signup, Google OAuth, me, logout (§9.1).
"""

import json
import os

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, transaction
from django.conf import settings
from django.core.cache import cache

from api.services.auth_service import (
    authenticate, generate_session, revoke_session,
    find_by_token, register_account, register_with_google,
)
from api.services.registration_service import validate_account_mssv_claim
from api.services.team_service import link_account_profile, registration_is_open
from api.models import Account, Participant

from .views_shared import (
    _json_body, _extract_token, _auth_or_401,
    _set_auth_cookie, _clear_auth_cookie,
    _consume_rate_limit, AUTH_COOKIE_NAME,
)

import secrets
from datetime import datetime, timezone


class MssvClaimError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


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

    limited, rate_key = _consume_rate_limit(
        request,
        scope="login",
        identifier=username,
        limit=settings.AUTH_LOGIN_RATE_LIMIT,
        window_seconds=settings.AUTH_LOGIN_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited

    acc, err = authenticate(username, password)
    if err:
        return JsonResponse({"error": err}, status=401)

    cache.delete(rate_key)
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


@csrf_exempt
def me_view(request: HttpRequest):
    acc, err = _auth_or_401(request)
    if err:
        return err

    # PATCH — update own profile
    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        allowed = {"full_name", "phone", "school", "faculty", "avatar", "mssv"}
        updates = {}
        for key in allowed:
            if key in data:
                value = data[key]
                if isinstance(value, str):
                    value = value.strip()
                    if key == "mssv" and not value:
                        value = None
                updates[key] = value

        claim_error = validate_account_mssv_claim(acc, updates.get("mssv"))
        if claim_error:
            return JsonResponse({"error": claim_error}, status=409)

        try:
            with transaction.atomic():
                previous_mssv = acc.mssv
                for key, value in updates.items():
                    setattr(acc, key, value)
                if updates:
                    acc.save(update_fields=list(updates.keys()))

                if "mssv" in updates and acc.mssv:
                    if previous_mssv != acc.mssv:
                        Participant.objects.filter(account=acc).exclude(mssv=acc.mssv).update(account=None)
                    _, link_status = link_account_profile(acc)
                    if link_status == "mssv_claimed_by_other":
                        raise MssvClaimError("mssv_taken")
                elif "mssv" in updates:
                    Participant.objects.filter(account=acc).update(account=None)

                sync_keys = {"full_name", "phone", "school", "faculty"} & set(updates)
                if sync_keys and acc.mssv:
                    participant = Participant.objects.filter(mssv=acc.mssv).first()
                    if participant:
                        p_fields = list(sync_keys)
                        for key in p_fields:
                            setattr(participant, key, updates[key])
                        participant.save(update_fields=p_fields + ["updated_at"])
        except MssvClaimError as e:
            return JsonResponse({"error": e.code}, status=409)
        except IntegrityError:
            return JsonResponse({"error": "duplicate_field"}, status=409)
        except Exception:
            return JsonResponse({"error": "server_error"}, status=500)

        return JsonResponse({
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "mssv": acc.mssv,
            "full_name": acc.full_name or "",
            "phone": acc.phone or "",
            "school": acc.school or "",
            "faculty": acc.faculty or "",
            "avatar": acc.avatar or "",
            "google_linked": bool(acc.google_sub),
        })

    # GET — return profile
    participant = Participant.objects.filter(mssv=acc.mssv).first() if acc.mssv else None
    return JsonResponse({
        "username": acc.username,
        "email": acc.email,
        "role": acc.role,
        "mssv": acc.mssv,
        "full_name": acc.full_name or "",
        "phone": acc.phone or "",
        "school": acc.school or "",
        "faculty": acc.faculty or "",
        "avatar": acc.avatar or "",
        "google_linked": bool(acc.google_sub),
        "last_login": acc.last_login.isoformat() if acc.last_login else None,
        "profile_complete": bool(acc.mssv and participant and participant.full_name),
        "session": {
            "created_at": acc.last_login.isoformat() if acc.last_login else None,
            "user_agent": request.headers.get("User-Agent", "")[:256],
        },
    })


@csrf_exempt
def change_password_view(request: HttpRequest):
    """PUT /auth/me/password — change own password (non-Google accounts only)."""
    if request.method != "PUT":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err

    if acc.google_sub:
        return JsonResponse({"error": "google_account_no_password"}, status=400)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    current = str((data.get("current_password") or "").strip())
    new_password = str((data.get("new_password") or "").strip())

    if not current or not new_password:
        return JsonResponse({"error": "missing_fields"}, status=400)
    if len(new_password) < settings.AUTH_MIN_PASSWORD_LENGTH:
        return JsonResponse({"error": "password_too_short"}, status=400)

    from django.contrib.auth.hashers import check_password, make_password
    if not check_password(current, acc.password_hash):
        return JsonResponse({"error": "invalid_current_password"}, status=400)

    acc.password_hash = make_password(new_password)
    acc.save(update_fields=["password_hash"])
    return JsonResponse({"status": "password_changed"})


@csrf_exempt
def google_link_view(request: HttpRequest):
    """POST /auth/me/google — link Google; DELETE — unlink Google."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    if request.method == "DELETE":
        if not acc.google_sub:
            return JsonResponse({"error": "not_linked"}, status=400)
        acc.google_sub = None
        acc.save(update_fields=["google_sub"])
        return JsonResponse({"status": "google_unlinked"})

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    if acc.google_sub:
        return JsonResponse({"error": "already_linked"}, status=409)

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

    google_email = (id_info.get("email") or "").strip()
    if google_email.lower() != acc.email.lower():
        return JsonResponse({"error": "email_mismatch"}, status=400)

    google_sub = id_info.get("sub")
    if not google_sub:
        return JsonResponse({"error": "missing_sub"}, status=400)

    if Account.objects.filter(google_sub=google_sub).exclude(id=acc.id).exists():
        return JsonResponse({"error": "google_already_linked_other"}, status=409)

    acc.google_sub = google_sub
    acc.save(update_fields=["google_sub"])
    return JsonResponse({"status": "google_linked"})


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
    limited, _ = _consume_rate_limit(
        request,
        scope="admin-register",
        limit=settings.AUTH_REGISTER_RATE_LIMIT,
        window_seconds=settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)
    if len(password) < settings.AUTH_MIN_PASSWORD_LENGTH:
        return JsonResponse({"error": "password_too_short"}, status=400)

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

    if not registration_is_open():
        return JsonResponse({"error": "registration_closed"}, status=403)
    limited, _ = _consume_rate_limit(
        request,
        scope="participant-signup",
        limit=settings.AUTH_REGISTER_RATE_LIMIT,
        window_seconds=settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    mssv = str((data.get("mssv") or "").strip()) or None
    full_name = str((data.get("full_name") or "").strip()) or None
    school = str((data.get("school") or "").strip()) or None
    faculty = str((data.get("faculty") or "").strip()) or None

    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)
    if len(password) < settings.AUTH_MIN_PASSWORD_LENGTH:
        return JsonResponse({"error": "password_too_short"}, status=400)

    # Two-layer safety gate against MSSV hijacking: if the MSSV is already
    # registered under a DIFFERENT email, block. A clean match trusts the
    # registered record; a not-found MSSV lets the user supply their own basic
    # info (manual branch). Sensitive fields are never exposed here.
    from api.services.registration_service import lookup_participant
    match = lookup_participant(mssv or "", email)
    if match["status"] == "email_mismatch":
        return JsonResponse({"error": "registration_mismatch"}, status=409)
    if mssv and Participant.objects.filter(mssv=mssv, account__isnull=False).exists():
        return JsonResponse({"error": "mssv_taken"}, status=409)
    if match["status"] == "match":
        full_name = full_name or match.get("full_name") or None
        school = school or match.get("school") or None
        faculty = faculty or match.get("faculty") or None

    acc, err = register_account(
        username, email, password,
        role=Account.ROLE_PARTICIPANT,
        mssv=mssv, full_name=full_name,
    )
    if err:
        status = 409 if "exists" in err else 500
        return JsonResponse({"error": err}, status=status)

    # Persist the basic recognition fields the signup page collected.
    extra_fields = {}
    if school:
        extra_fields["school"] = school
    if faculty:
        extra_fields["faculty"] = faculty
    if extra_fields:
        for k, v in extra_fields.items():
            setattr(acc, k, v)
        acc.save(update_fields=list(extra_fields.keys()))

    link_account_profile(acc)

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

    if not registration_is_open():
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
