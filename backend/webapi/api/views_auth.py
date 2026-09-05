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
from django.utils.html import escape

from api.services.auth_service import (
    authenticate, generate_session, revoke_session,
    find_by_token, register_account, register_with_google,
    create_password_reset_token, consume_password_reset_token,
)
from api.services.email_service import enqueue_email_messages
from api.services.email_templates import render_branded_email, email_paragraph
from api.services.registration_service import validate_account_mssv_claim
from api.services.team_service import (
    link_account_profile, registration_is_open,
    auto_link_participant_by_verified_email,
)
from api.models import Account, Participant

from .views_shared import (
    _json_body, _extract_token, _auth_or_401,
    _set_auth_cookie, _clear_auth_cookie,
    _consume_rate_limit, _require_antibot, AUTH_COOKIE_NAME,
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
    blocked = _require_antibot(request, data, form_signals=True)
    if blocked:
        return blocked

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
def forgot_password_view(request: HttpRequest):
    """POST /auth/forgot-password — request a reset link by email.

    Always answers 200 with a generic message, whether or not the email is
    registered — the response must not be usable to enumerate accounts.
    """
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    email = str((data.get("email") or "").strip())
    limited, _ = _consume_rate_limit(
        request,
        scope="forgot-password",
        identifier=email,
        limit=settings.AUTH_LOOKUP_RATE_LIMIT,
        window_seconds=settings.AUTH_LOOKUP_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited

    if email:
        acc = Account.objects.filter(email__iexact=email, is_active=True).first()
        # Google accounts have no password to reset — silently skip sending
        # rather than mailing a link that can never be used.
        if acc and not acc.google_sub:
            raw_token = create_password_reset_token(acc)
            base_url = (settings.WEB_BASE_URL or "").rstrip("/")
            if not base_url:
                base_url = f"{request.scheme}://{request.get_host()}"
            reset_link = f"{base_url}/reset-password?token={raw_token}"
            ttl_hours = int(getattr(settings, "PASSWORD_RESET_TOKEN_TTL_HOURS", 2))

            body = (
                email_paragraph(f"Xin chào {escape(acc.full_name or acc.username)},")
                + email_paragraph(
                    "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản VNUTour "
                    f"của bạn. Liên kết bên dưới có hiệu lực trong {ttl_hours} giờ."
                )
                + email_paragraph(
                    "Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này — "
                    "mật khẩu hiện tại của bạn vẫn giữ nguyên."
                )
            )
            html_body = render_branded_email(
                title="ĐẶT LẠI MẬT KHẨU",
                body_html=body,
                cta={"url": reset_link, "label": "Đặt lại mật khẩu"},
            )
            enqueue_email_messages(
                messages=[{
                    "to_emails": [acc.email],
                    "subject": "Đặt lại mật khẩu VNUTour",
                    "html_body": html_body,
                }],
                created_by=None,
            )

    return JsonResponse({"status": "ok"})


@csrf_exempt
def reset_password_view(request: HttpRequest):
    """POST /auth/reset-password — apply a new password using a mailed token."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    token = str((data.get("token") or "").strip())
    new_password = str((data.get("new_password") or "").strip())
    if not token or not new_password:
        return JsonResponse({"error": "missing_fields"}, status=400)

    err = consume_password_reset_token(token, new_password)
    if err:
        return JsonResponse({"error": err}, status=400)

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


# ---------------------------------------------------------------------------
# Discord OAuth linking (§ web "Connect Discord" button)
# ---------------------------------------------------------------------------

# claim_discord_identity statuses that mean the link now points at this account.
_DISCORD_LINK_OK = {"linked", "already_linked"}
# ...and the ones the participant can act on, mapped to an HTTP status.
_DISCORD_LINK_ERRORS = {
    "discord_already_linked": ("discord_already_linked_other", 409),
    "mssv_already_linked": ("discord_already_linked_self", 409),
    "member_not_found": ("participant_not_found", 404),
    "invalid_discord_id": ("invalid_discord_id", 400),
}


def _participant_for(acc):
    """The Participant a logged-in account maps to, resolved by MSSV like me_view."""
    if not acc.mssv:
        return None
    return Participant.objects.filter(mssv=acc.mssv).first()


@csrf_exempt
def discord_link_view(request: HttpRequest):
    """POST /auth/me/discord — link via OAuth code; DELETE — unlink.

    The account is already authenticated (we know its MSSV), so the code only
    proves which Discord account authorized. We never steal a Discord account
    already tied to another participant — reconnecting with a different account
    means unlink (DELETE) then link again.
    """
    from api.services.discord_service import (
        claim_discord_identity, release_discord_identity,
    )
    from api.services.discord_oauth_service import (
        DiscordOAuthError, exchange_code, fetch_discord_user,
    )

    acc, err = _auth_or_401(request)
    if err:
        return err

    participant = _participant_for(acc)
    if participant is None:
        return JsonResponse({"error": "participant_not_found"}, status=404)

    if request.method == "DELETE":
        result = release_discord_identity(participant.mssv)
        if result.get("status") == "member_not_found":
            return JsonResponse({"error": "participant_not_found"}, status=404)
        return JsonResponse({"status": "discord_unlinked"})

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = str((data.get("code") or "").strip())
    redirect_uri = str((data.get("redirect_uri") or "").strip())
    if not code or not redirect_uri:
        return JsonResponse({"error": "missing_fields"}, status=400)

    try:
        access_token = exchange_code(code, redirect_uri)
        discord_user = fetch_discord_user(access_token)
    except DiscordOAuthError as e:
        status = 400 if e.code in {"invalid_code", "redirect_uri_not_allowed"} else 502
        if e.code == "discord_oauth_not_configured":
            status = 500
        return JsonResponse({"error": e.code}, status=status)

    result = claim_discord_identity(
        participant.mssv,
        discord_user["id"],
        discord_username=discord_user.get("display"),
    )
    status = result.get("status")
    if status in _DISCORD_LINK_ERRORS:
        code_out, http_status = _DISCORD_LINK_ERRORS[status]
        return JsonResponse({"error": code_out}, status=http_status)
    if status not in _DISCORD_LINK_OK:
        return JsonResponse({"error": "discord_link_failed"}, status=400)

    return JsonResponse({
        "status": "discord_linked",
        "discord_id": str(discord_user["id"]),
        "discord_username": discord_user.get("display"),
    })


@csrf_exempt
def discord_status_view(request: HttpRequest):
    """GET /auth/me/discord/status — onboarding state for the Connect card.

    Snowflake ids exceed JS's safe integer range, so ``discord_id`` goes out as
    a string. ``in_server`` is null when membership can't be checked.
    """
    from api.services.discord_oauth_service import lookup_guild_member, oauth_config

    acc, err = _auth_or_401(request)
    if err:
        return err

    config = oauth_config()
    body = {
        "oauth": {
            "configured": config["configured"],
            "client_id": config["client_id"],
            "scope": config["scope"],
        },
        "invite_url": config["invite_url"],
        "linked": False,
        "discord_id": None,
        "discord_username": None,
        "in_server": None,
        "provisioned": False,
    }

    participant = _participant_for(acc)
    if participant is None or participant.discord_id is None:
        return JsonResponse(body)

    membership = participant.memberships.select_related("team").first()
    team = membership.team if membership else None
    member = lookup_guild_member(participant.discord_id)

    body.update({
        "linked": True,
        "discord_id": str(participant.discord_id),
        "discord_username": member.get("display") or participant.discord_username,
        "in_server": member.get("in_guild"),
        "provisioned": bool(team and team.provision_state == "done"),
    })
    return JsonResponse(body)


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
    blocked = _require_antibot(request, data)
    if blocked:
        return blocked

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)
    if len(password) < settings.AUTH_MIN_PASSWORD_LENGTH:
        return JsonResponse({"error": "password_too_short"}, status=400)

    # Gate: if any admin exists, require secret. Master admins count — a system
    # holding only master accounts is still bootstrapped, and leaving them out
    # would swing this endpoint back open.
    admin_exists = Account.objects.filter(
        role__in=[Account.ROLE_ADMIN, Account.ROLE_MASTER_ADMIN],
        is_active=True,
    ).exists()
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
    blocked = _require_antibot(request, data, form_signals=True)
    if blocked:
        return blocked

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

    # Google login có thể tạo tài khoản participant khi đăng ký đang mở —
    # trước đây endpoint này hoàn toàn không có rate limit.
    limited, _ = _consume_rate_limit(
        request,
        scope="google-login",
        limit=settings.AUTH_GOOGLE_RATE_LIMIT,
        window_seconds=settings.AUTH_GOOGLE_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    credential = str((data.get("credential") or "").strip())
    if not credential:
        return JsonResponse({"error": "missing_credential"}, status=400)

    blocked = _require_antibot(request, data)
    if blocked:
        return blocked

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
        # A pre-registered member logging in for the first time still gets
        # adopted into their team — linking to an existing team is not a new
        # registration, so it is allowed even while sign-ups are closed.
        if not acc.mssv:
            auto_link_participant_by_verified_email(acc)
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

    # If a captain pre-registered this member, adopt their profile by the
    # Google-verified email so they skip the MSSV supplementary step entirely.
    if not acc.mssv:
        auto_link_participant_by_verified_email(acc)

    token = generate_session(acc)
    resp = JsonResponse({
        "token": token,
        "user": {"username": acc.username, "email": acc.email, "role": acc.role},
        "is_new": is_new,
    }, status=201 if is_new else 200)
    _set_auth_cookie(resp, token, request)
    return resp
