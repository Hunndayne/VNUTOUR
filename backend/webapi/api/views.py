from __future__ import annotations

from django.http import JsonResponse, HttpRequest
from datetime import datetime, timezone, timedelta
from typing import Any, Dict
import os
import json
import secrets
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.contrib.auth.hashers import make_password, check_password
from .models import Account
from django.db import IntegrityError
from django.conf import settings
from bson import ObjectId
import requests
from src.utils.sheets import append_rows_to_sheet, remove_rows_by_first_column
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore


_mongo_singleton = None
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "token")

if ZoneInfo is not None:
    LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
else:
    LOCAL_TZ = timezone(timedelta(hours=7))


def _get_mongo():
    global _mongo_singleton
    if _mongo_singleton is None:
        # Lazy import to avoid Django import-time side effects
        from src.utils.mongo import MongoManager
        _mongo_singleton = MongoManager(
            uri=os.getenv("MongoDB"),
            db_name=os.getenv("MONGODB_DB_NAME", "vnutour"),
        )
    return _mongo_singleton


def _sync_account_to_mongo(acc: 'Account') -> None:
    """Upsert account summary info into MongoDB `accounts` collection.

    Stores: username, email, role, is_active, password_hash (hashed), token, last_login, created_at/updated_at.
    """
    try:
        m = _get_mongo()
        coll = getattr(m, 'accounts', None) or m.db['accounts']
        now = datetime.now(timezone.utc)
        payload = {
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "is_active": acc.is_active,
            "password_hash": acc.password_hash,
            "token": acc.token,
            "last_login": acc.last_login or now,
            "updated_at": now,
        }
        coll.update_one(
            {"username": acc.username},
            {"$set": payload, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
    except Exception:
        # Do not block login/register if Mongo sync fails
        pass


def _set_auth_cookie(resp: JsonResponse, token: str, request: HttpRequest) -> None:
    """Set HttpOnly auth cookie for browsers.

    Defaults:
    - name: AUTH_COOKIE_NAME (env, default 'token')
    - path: /api
    - max_age: from AUTH_COOKIE_MAX_AGE (seconds, default 1209600 = 14 days)
    - secure: True if request is secure or AUTH_COOKIE_SECURE=1 (or not DEBUG)
    - samesite: Lax by default (override via AUTH_COOKIE_SAMESITE)
    """
    try:
        max_age = int(os.getenv("AUTH_COOKIE_MAX_AGE", "1209600"))
    except Exception:
        max_age = 1209600
    samesite = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
    secure_env = os.getenv("AUTH_COOKIE_SECURE", "")
    secure = (secure_env.lower() in {"1", "true", "yes"}) or request.is_secure() or not getattr(settings, "DEBUG", True)
    resp.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite=samesite,  # 'Lax'/'Strict'/'None'
        path="/api",
    )


def _clear_auth_cookie(resp: JsonResponse) -> None:
    resp.delete_cookie(AUTH_COOKIE_NAME, path="/api")


def _extract_token(request: HttpRequest) -> str | None:
    """Extract bearer-like token from request.

    Accepts:
    - Authorization: Bearer <token>
    - Authorization: Token <token>
    - Authorization: JWT <token>
    - Authorization: <token>
    Also falls back to query param `?token=` or cookie `token` for testing.
    """
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


def _auth_account(request: HttpRequest) -> Account | None:
    token = _extract_token(request)
    if not token:
        return None
    try:
        return Account.objects.filter(token=token, is_active=True).first()
    except Exception:
        return None


def _json_body(request: HttpRequest):
    """Parse JSON body; return dict, or None if invalid JSON."""
    try:
        return json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return None


def _settings() -> Dict[str, Any]:
    try:
        return _get_mongo().get_settings()
    except Exception:
        from src.utils.mongo import DEFAULT_SYSTEM_SETTINGS
        return dict(DEFAULT_SYSTEM_SETTINGS)


def _auth_or_401(request: HttpRequest):
    """Return (account, None) on success or (None, JsonResponse 401)."""
    me = _auth_account(request)
    if not me:
        token = _extract_token(request)
        return None, JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)
    return me, None


def _to_public(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    out = dict(doc)
    # Normalize Mongo fields for JSON
    if out.get("_id") is not None:
        out["_id"] = str(out["_id"])  # type: ignore
    if isinstance(out.get("updated_at"), datetime):
        out["updated_at"] = out["updated_at"].astimezone(timezone.utc).isoformat()
    return out


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


def _to_object_id(value):
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return None



def _find_team_by_key(mongo, key: str):
    key = (key or '').strip()
    if not key:
        return None
    queries = []
    oid = _to_object_id(key)
    if oid is not None:
        queries.append({'_id': oid})
    queries.append({'team_id': key})
    queries.append({'team_name': key})
    for q in queries:
        doc = mongo.teams.find_one(q)
        if doc:
            return doc
    return None


def _ensure_datetime(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except Exception:
            pass
    return None


def _notify_team_channel(team_doc: Dict[str, Any], when: datetime) -> None:
    """Send a message to the team's text channel announcing check-in."""
    try:
        channel_id = team_doc.get("text_channel_id")
        if not channel_id:
            return
        token = os.getenv("DISCORD_TOKEN")
        if not token:
            return
        channel_id = int(channel_id)
        iso_time = _dt_to_iso(when) or when.strftime("%H:%M:%S %d/%m/%Y")
        team_label = team_doc.get('team_name') or team_doc.get('team_id') or 'Team'
        display_time = _format_local_time(when) or iso_time
        content = f'✅ Đội {team_label} đã hoàn thành check-in lúc {display_time}.'
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        headers = {
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json"
        }
        payload = {"content": content}
        requests.post(url, headers=headers, json=payload, timeout=10)
    except Exception:
        pass


def health(request: HttpRequest):
    try:
        m = _get_mongo()
        ok = m.is_healthy()
    except Exception as e:
        return JsonResponse({"status": "error", "error": str(e)}, status=500)
    return JsonResponse({
        "status": "ok" if ok else "degraded",
        "time": datetime.now(timezone.utc).isoformat(),
    })


@csrf_exempt
def login(request: HttpRequest):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    if not username or not password:
        return JsonResponse({"error": "missing_credentials"}, status=400)

    try:
        acc = Account.objects.filter(username__iexact=username, is_active=True).first()
        if not acc or not check_password(password, acc.password_hash):
            return JsonResponse({"error": "invalid_credentials"}, status=401)

        # Generate a new token on each login
        token = secrets.token_urlsafe(32)
        acc.token = token
        acc.last_login = datetime.now(timezone.utc)
        acc.save(update_fields=["token", "last_login"])
        _sync_account_to_mongo(acc)

        resp = JsonResponse({
            "token": token,
            "user": {
                "username": acc.username,
                "email": acc.email,
                "role": acc.role,
            }
        })
        _set_auth_cookie(resp, token, request)
        return resp
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)


def me(request: HttpRequest):
    token = _extract_token(request)
    if not token:
        return JsonResponse({"error": "missing_token"}, status=401)
    try:
        acc = Account.objects.filter(token=token, is_active=True).first()
        if not acc:
            return JsonResponse({"error": "invalid_token"}, status=401)
        return JsonResponse({
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "last_login": acc.last_login.isoformat() if acc.last_login else None,
        })
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)


@csrf_exempt
def register(request: HttpRequest):
    """Register a new admin account.

    Security policy:
    - If there is already at least one admin account, require a secret to register new admins.
      Provide the secret via JSON field `secret` or header `X-Register-Secret`.
      The server-side secret is `ADMIN_REGISTER_SECRET` from environment.
    - If no admin exists yet, allow first registration without secret (bootstrap).
    """
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    try:
        data = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return JsonResponse({"error": "invalid_json"}, status=400)

    username = str((data.get("username") or "").strip())
    password = str((data.get("password") or "").strip())
    email = str((data.get("email") or "").strip())
    if not username or not password or not email:
        return JsonResponse({"error": "missing_fields"}, status=400)

    # Authorization for registration
    secret_required = Account.objects.filter(role=Account.ROLE_ADMIN, is_active=True).exists()
    server_secret = os.getenv("ADMIN_REGISTER_SECRET")
    provided_secret = str((data.get("secret") or request.headers.get("X-Register-Secret") or "").strip())
    if secret_required and (not server_secret or provided_secret != server_secret):
        return JsonResponse({"error": "forbidden", "detail": "secret_required"}, status=403)

    try:
        acc = Account(
            username=username,
            email=email,
            password_hash=make_password(password),
            role=Account.ROLE_ADMIN,
            is_active=True,
        )
        # Generate an initial token (acts like logged-in)
        acc.token = secrets.token_urlsafe(32)
        acc.last_login = datetime.now(timezone.utc)
        acc.save()
        _sync_account_to_mongo(acc)
        resp = JsonResponse({
            "token": acc.token,
            "user": {
                "username": acc.username,
                "email": acc.email,
                "role": acc.role,
            }
        }, status=201)
        _set_auth_cookie(resp, acc.token or "", request)
        return resp
    except IntegrityError as e:
        return JsonResponse({"error": "conflict", "detail": "username_or_email_exists"}, status=409)
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)


@csrf_exempt
def admin_accounts(request: HttpRequest):
    """Admin-only: list accounts or create new account.

    GET /api/admin/accounts?role=&active=1&page=1&limit=50
    POST /api/admin/accounts { username, email, password, role? }
    """
    me_acc = _auth_account(request)
    if not me_acc or me_acc.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)

    if request.method == "GET":
        qs = Account.objects.all().order_by("username")
        role = request.GET.get("role")
        if role in (Account.ROLE_ADMIN, Account.ROLE_COLLAB):
            qs = qs.filter(role=role)
        active = request.GET.get("active")
        if active in ("1", "true", "yes"):
            qs = qs.filter(is_active=True)
        elif active in ("0", "false", "no"):
            qs = qs.filter(is_active=False)

        try:
            page = max(1, int(request.GET.get("page", "1")))
            limit = max(1, min(200, int(request.GET.get("limit", "50"))))
        except Exception:
            page, limit = 1, 50
        offset = (page - 1) * limit
        total = qs.count()
        items = []
        for acc in qs[offset: offset + limit]:
            items.append({
                "username": acc.username,
                "email": acc.email,
                "role": acc.role,
                "is_active": acc.is_active,
                "last_login": acc.last_login.isoformat() if acc.last_login else None,
                "created_at": acc.created_at.isoformat(),
                "updated_at": acc.updated_at.isoformat(),
            })
        return JsonResponse({"items": items, "page": page, "limit": limit, "total": total})

    if request.method == "POST":
        try:
            data = json.loads(request.body.decode("utf-8")) if request.body else {}
        except Exception:
            return JsonResponse({"error": "invalid_json"}, status=400)
        username = str((data.get("username") or "").strip())
        password = str((data.get("password") or "").strip())
        email = str((data.get("email") or "").strip())
        role = str((data.get("role") or Account.ROLE_COLLAB).strip())
        if role not in (Account.ROLE_ADMIN, Account.ROLE_COLLAB):
            role = Account.ROLE_COLLAB
        if not username or not password or not email:
            return JsonResponse({"error": "missing_fields"}, status=400)
        try:
            acc = Account(
                username=username,
                email=email,
                password_hash=make_password(password),
                role=role,
                is_active=True,
            )
            acc.save()
            _sync_account_to_mongo(acc)
            return JsonResponse({
                "username": acc.username,
                "email": acc.email,
                "role": acc.role,
                "is_active": acc.is_active,
            }, status=201)
        except IntegrityError:
            return JsonResponse({"error": "conflict", "detail": "username_or_email_exists"}, status=409)
        except Exception as e:
            return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def logout(request: HttpRequest):
    """Logout current token: clear cookie and invalidate token in DB."""
    try:
        token = _extract_token(request)
        if token:
            acc = Account.objects.filter(token=token).first()
            if acc:
                acc.token = None
                acc.save(update_fields=["token"])
        resp = JsonResponse({"status": "logged_out"})
        _clear_auth_cookie(resp)
        return resp
    except Exception as e:
        resp = JsonResponse({"status": "logged_out", "detail": str(e)})
        _clear_auth_cookie(resp)
        return resp


@csrf_exempt
def google_login(request: HttpRequest):
    """Sign in / sign up with Google Identity Services credential.

    Accepts a Google ID token from the frontend GIS flow, verifies it,
    and either logs in an existing account (matched by email) or creates
    a new member account (gated by ``registration_open``).

    Request JSON: { "credential": "<google_id_token>" }
    Returns: { "token": "...", "user": {...} }
    """
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

    # Verify the Google ID token
    try:
        id_info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            clock_skew_in_seconds=30,
        )
    except ValueError as e:
        return JsonResponse({"error": "invalid_google_token", "detail": str(e)}, status=401)

    # Validate audience matches our client ID
    if id_info.get("aud") != client_id:
        if client_id not in (id_info.get("azp") or ""):
            return JsonResponse({"error": "token_audience_mismatch"}, status=401)

    email = (id_info.get("email") or "").strip()
    if not email:
        return JsonResponse({"error": "missing_email_in_token"}, status=400)

    email_verified = bool(id_info.get("email_verified"))
    if not email_verified:
        return JsonResponse({"error": "email_not_verified"}, status=401)

    google_name = (id_info.get("name") or "").strip()

    try:
        acc = Account.objects.filter(email__iexact=email, is_active=True).first()

        if acc:
            # Existing account — log them in
            token = secrets.token_urlsafe(32)
            acc.token = token
            acc.last_login = datetime.now(timezone.utc)
            acc.save(update_fields=["token", "last_login"])
            _sync_account_to_mongo(acc)

            resp = JsonResponse({
                "token": token,
                "user": {
                    "username": acc.username,
                    "email": acc.email,
                    "role": acc.role,
                },
                "is_new": False,
            })
            _set_auth_cookie(resp, token, request)
            return resp

        # No existing account — create one (gated by registration_open)
        if not _settings().get("registration_open"):
            return JsonResponse({"error": "registration_closed"}, status=403)

        # Generate username from email prefix, ensure uniqueness
        base_username = email.split("@")[0][:45]
        username = base_username
        suffix = 1
        while Account.objects.filter(username__iexact=username).exists():
            username = f"{base_username}{suffix}"
            suffix += 1
            if suffix > 99:
                username = f"{base_username}_{secrets.token_hex(3)}"
                break

        acc = Account(
            username=username,
            email=email,
            password_hash=make_password(secrets.token_urlsafe(32)),
            role=Account.ROLE_MEMBER,
            is_active=True,
            full_name=google_name or None,
        )
        acc.token = secrets.token_urlsafe(32)
        acc.last_login = datetime.now(timezone.utc)
        acc.save()
        _sync_account_to_mongo(acc)

        resp = JsonResponse({
            "token": acc.token,
            "user": {
                "username": acc.username,
                "email": acc.email,
                "role": acc.role,
            },
            "is_new": True,
        }, status=201)
        _set_auth_cookie(resp, acc.token or "", request)
        return resp

    except IntegrityError:
        return JsonResponse({"error": "conflict", "detail": "username_or_email_exists"}, status=409)
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)


@csrf_exempt
def admin_account_detail(request: HttpRequest, username: str):
    """Admin-only: get/update/deactivate a specific account.

    GET /api/admin/accounts/<username>
    PATCH /api/admin/accounts/<username> { role?, is_active?, password? }
    DELETE /api/admin/accounts/<username>  -> set is_active=false
    """
    me_acc = _auth_account(request)
    if not me_acc or me_acc.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)

    try:
        acc = Account.objects.filter(username__iexact=username).first()
        if not acc:
            return JsonResponse({"error": "not_found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)

    if request.method == "GET":
        return JsonResponse({
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "is_active": acc.is_active,
            "last_login": acc.last_login.isoformat() if acc.last_login else None,
            "created_at": acc.created_at.isoformat(),
            "updated_at": acc.updated_at.isoformat(),
        })

    if request.method == "PATCH":
        try:
            data = json.loads(request.body.decode("utf-8")) if request.body else {}
        except Exception:
            return JsonResponse({"error": "invalid_json"}, status=400)
        changed = False
        role = data.get("role")
        if role in (Account.ROLE_ADMIN, Account.ROLE_COLLAB) and role != acc.role:
            acc.role = role
            changed = True
        if "is_active" in data:
            is_active = bool(data.get("is_active"))
            if is_active != acc.is_active:
                acc.is_active = is_active
                changed = True
        if "password" in data:
            pwd = str((data.get("password") or "").strip())
            if pwd:
                acc.password_hash = make_password(pwd)
                changed = True
        if changed:
            acc.save()
            _sync_account_to_mongo(acc)
        return JsonResponse({
            "username": acc.username,
            "email": acc.email,
            "role": acc.role,
            "is_active": acc.is_active,
        })

    if request.method == "DELETE":
        acc.is_active = False
        acc.save(update_fields=["is_active"])
        _sync_account_to_mongo(acc)
        return JsonResponse({"status": "deactivated"})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


def participants_list(request: HttpRequest):
    # Require authentication (admin or collab)
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    m = _get_mongo()
    qs = {}

    # Filters
    team_id = request.GET.get("team_id")
    if team_id:
        qs["team_id"] = str(team_id).strip()

    has_discord = request.GET.get("has_discord")
    if has_discord in ("1", "true", "yes"):
        qs["discord_id"] = {"$exists": True, "$ne": None}

    # Pagination
    try:
        page = max(1, int(request.GET.get("page", "1")))
        limit = max(1, min(200, int(request.GET.get("limit", "50"))))
    except Exception:
        page, limit = 1, 50
    skip = (page - 1) * limit

    cur = m.participants.find(qs).skip(skip).limit(limit)
    items = [_to_public(d) for d in cur]
    total = m.participants.count_documents(qs)
    return JsonResponse({
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
    })


def participant_detail(request: HttpRequest, mssv: str):
    # Require authentication (admin or collab)
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    m = _get_mongo()
    doc = m.participants.find_one({"mssv": str(mssv).strip()})
    if not doc:
        return JsonResponse({"error": "not_found"}, status=404)
    return JsonResponse(_to_public(doc))


def _norm_bool(v: str | None) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("1", "true", "yes", "y")


def teams_list(request: HttpRequest):
    """List teams from MongoDB.

    Query:
    - q: substring match in team_name (case-insensitive)
    - has_discord=1: only teams having members with discord_id
    - page, limit: pagination (default 1,50; limit<=200)
    """
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    m = _get_mongo()

    # Pagination
    try:
        page = max(1, int(request.GET.get("page", "1")))
        limit = max(1, min(200, int(request.GET.get("limit", "50"))))
    except Exception:
        page, limit = 1, 50
    skip = (page - 1) * limit

    q = request.GET.get("q")
    has_discord = _norm_bool(request.GET.get("has_discord"))

    if has_discord:
        # Get precomputed teams that have at least one member with discord_id
        items_all = m.get_teams_with_members() or []
        if q:
            qlow = q.lower()
            items_all = [
                t for t in items_all
                if (str(t.get("team_name") or "").lower().find(qlow) >= 0)
                or (str(t.get("team_id") or "").lower().find(qlow) >= 0)
            ]
        total = len(items_all)
        items_slice = items_all[skip: skip + limit]
        # Normalize docs
        pub_items: list[Dict[str, Any]] = []
        for t in items_slice:
            td = _to_public(t)
            if isinstance(t.get("members_with_discord"), list):
                td["members_with_discord"] = [_to_public(x) for x in t["members_with_discord"]]
            pub_items.append(td)
        return JsonResponse({"items": pub_items, "page": page, "limit": limit, "total": total})

    # Normal teams listing from collection
    filters: Dict[str, Any] = {}
    if q:
        try:
            # regex search on name
            filters["team_name"] = {"$regex": q, "$options": "i"}
        except Exception:
            pass
    approval_status = request.GET.get("approval_status")
    if approval_status:
        filters["approval_status"] = approval_status
    cur = m.teams.find(filters).skip(skip).limit(limit)
    items = [_to_public(d) for d in cur]
    total = m.teams.count_documents(filters)
    return JsonResponse({
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
    })


def team_detail(request: HttpRequest, team_key: str):
    """Get a team by team_id (default) or by name with `?by=name`.

    Query:
    - by=name|id (default id)
    - include_members=1 to include participants (basic fields) in this team
    """
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    m = _get_mongo()
    by = (request.GET.get("by") or "id").strip().lower()
    doc = None
    if by == "name":
        doc = m.teams.find_one({"team_name": str(team_key)})
    else:
        doc = m.teams.find_one({"team_id": str(team_key)})
        if not doc:
            # Fallback: try by name
            doc = m.teams.find_one({"team_name": str(team_key)})
    if not doc:
        return JsonResponse({"error": "not_found"}, status=404)

    result = _to_public(doc)
    if _norm_bool(request.GET.get("include_members")):
        tid = doc.get("team_id")
        tname = doc.get("team_name")
        q: Dict[str, Any]
        if tid:
            q = {"team_id": tid}
        else:
            q = {"team_name": tname}
        members = list(m.participants.find(q, {"_id": 1, "mssv": 1, "full_name": 1, "discord_id": 1}))
        result["members"] = [_to_public(x) for x in members]
    return JsonResponse(result)


@csrf_exempt
def checkin_team(request: HttpRequest):
    """Check-in by team QR code.

    Auth: requires login (header or cookie).
    Request JSON: { "code": "...", "scanner": "optional" }
    Returns: { team: {...}, members: [...] }
    Also stores a record in Mongo `checkins`.
    """
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    try:
        payload = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = str((payload.get("code") or "").strip())
    if not code:
        return JsonResponse({"error": "missing_code"}, status=400)

    m = _get_mongo()
    team_oid_hex = m.decode_team_code(code)
    if not team_oid_hex:
        return JsonResponse({"error": "invalid_code"}, status=400)
    try:
        team_doc = m.teams.find_one({"_id": ObjectId(team_oid_hex)})
    except Exception:
        team_doc = None
    if not team_doc:
        return JsonResponse({"error": "not_found"}, status=404)

    # Prevent duplicate check-in
    existing_checked_at = _ensure_datetime(team_doc.get("checked_in_at"))
    if existing_checked_at:
        checked_iso = _dt_to_iso(existing_checked_at) or str(existing_checked_at)
        checked_display = _format_local_time(existing_checked_at)
        return JsonResponse({"error": "already_checked_in", "checked_in_at": checked_iso, "checked_in_display": checked_display}, status=409)

    # Fall back to checkins collection if field missing
    team_oid = _to_object_id(team_doc.get("_id"))
    if team_oid is None:
        return JsonResponse({"error": "invalid_team_identifier"}, status=500)
    try:
        existing_record = m.checkins.find_one({"team_oid": team_oid})
    except Exception:
        existing_record = None
    if existing_record:
        checked_at = _ensure_datetime(existing_record.get("created_at"))
        checked_iso = _dt_to_iso(checked_at) or (str(checked_at) if checked_at else None)
        checked_display = _format_local_time(checked_at)
        # Sync field for future quick checks
        try:
            m.teams.update_one({"_id": team_oid}, {"$set": {"checked_in_at": checked_at}}, upsert=False)
        except Exception:
            pass
        return JsonResponse({"error": "already_checked_in", "checked_in_at": checked_iso, "checked_in_display": checked_display}, status=409)

    # Prepare response
    team_pub = _to_public(team_doc)

    # Load members: prefer members_mssv array if present
    members_pub = []
    try:
        fields = {"_id": 1, "mssv": 1, "full_name": 1, "faculty": 1, "school": 1}
        mssv_list = team_doc.get("members_mssv")
        if isinstance(mssv_list, list) and mssv_list:
            cur = m.participants.find({"mssv": {"$in": list(mssv_list)}}, fields)
            members_pub = [_to_public(x) for x in cur]
        else:
            tid = team_doc.get("team_id")
            tname = team_doc.get("team_name")
            q: Dict[str, Any]
            if tid:
                q = {"team_id": tid}
            else:
                q = {"team_name": tname}
            cur = m.participants.find(q, fields)
            members_pub = [_to_public(x) for x in cur]
    except Exception:
        members_pub = []

    # Insert check-in record
    checkin_payload = None
    checkin_time = None
    try:
        ip = request.META.get("REMOTE_ADDR") or request.META.get("HTTP_X_FORWARDED_FOR")
        ua = request.META.get("HTTP_USER_AGENT")
        meta = {"scanner": payload.get("scanner"), "ip": ip, "ua": ua, "by": me_acc.username}
        checkin_payload = m.insert_checkin(team_doc, meta=meta)
        if isinstance(checkin_payload.get("created_at"), datetime):
            checkin_time = checkin_payload["created_at"]
    except Exception:
        pass

    if checkin_time is None:
        checkin_time = datetime.now(timezone.utc)

    try:
        m.teams.update_one({"_id": team_oid}, {"$set": {"checked_in_at": checkin_time}}, upsert=False)
    except Exception:
        pass

    try:
        _notify_team_channel(team_doc, checkin_time if isinstance(checkin_time, datetime) else datetime.now(timezone.utc))
    except Exception:
        pass

    checked_iso = _dt_to_iso(checkin_time)
    checked_display = _format_local_time(checkin_time)

    if checked_iso:
        team_pub["checked_in_at"] = checked_iso
    if checked_display:
        team_pub["checked_in_display"] = checked_display

    try:
        sheet_id = os.getenv("GoogleSheetCheckinID")
        sheet_tab = os.getenv("GOOGLE_SHEET_Checkin_TAB")
        if sheet_id and _settings().get("sheet_checkin_export_enabled") and (os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_CREDENTIALS_BASE64")):
            member_ids = []
            for member in members_pub:
                mssv = member.get("mssv")
                if mssv:
                    member_ids.append(str(mssv).strip())
            max_mssv = 5
            padded_ids = member_ids[:max_mssv] + ["" for _ in range(max(0, max_mssv - len(member_ids)))]
            team_id_val = team_doc.get("team_id")
            team_name_val = team_doc.get("team_name")
            identifier = team_id_val or team_name_val or ""
            display_name = team_name_val or team_id_val or ""
            row = [
                str(identifier),
                str(display_name),
            ]
            row.extend(padded_ids[:max_mssv])
            row.append(checked_display or (checked_iso or ""))
            append_rows_to_sheet(sheet_id, sheet_tab, [row])
    except Exception as sheet_exc:
        print(f"[SHEET] Failed to append check-in: {sheet_exc}")

    return JsonResponse({
        "team": team_pub,
        "members": members_pub,
        "checked_in_at": checked_iso,
        "checked_in_display": checked_display,
    })




@csrf_exempt
def list_checkedin_teams(request: HttpRequest):
    """List teams that have completed check-in."""
    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    if request.method not in ("GET",):
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    m = _get_mongo()

    try:
        page = max(1, int(request.GET.get("page", "1")))
        limit = max(1, min(200, int(request.GET.get("limit", "50"))))
    except Exception:
        page, limit = 1, 50
    skip = (page - 1) * limit

    filters = {"checked_in_at": {"$exists": True}}
    query_text = request.GET.get("q")
    if query_text:
        regex = {"$regex": query_text, "$options": "i"}
        filters["$or"] = [{"team_name": regex}, {"team_id": regex}]

    try:
        total = m.teams.count_documents(filters)
        cursor = m.teams.find(filters).sort("checked_in_at", -1).skip(skip).limit(limit)
    except Exception as exc:
        return JsonResponse({"error": "server_error", "detail": str(exc)}, status=500)

    items = []
    for doc in cursor:
        checked_at = _ensure_datetime(doc.get("checked_in_at"))
        team_pub = _to_public(doc)
        team_pub["checked_in_at"] = _dt_to_iso(checked_at)
        team_pub["checked_in_display"] = _format_local_time(checked_at)

        members_pub = []
        try:
            fields = {"_id": 1, "mssv": 1, "full_name": 1, "faculty": 1, "school": 1, "discord_id": 1}
            mssv_list = doc.get("members_mssv")
            if isinstance(mssv_list, list) and mssv_list:
                cur_mem = m.participants.find({"mssv": {"$in": list(mssv_list)}}, fields)
                members_pub = [_to_public(x) for x in cur_mem]
            else:
                tid = doc.get("team_id")
                tname = doc.get("team_name")
                query = {"team_name": tname} if not tid else {"team_id": tid}
                cur_mem = m.participants.find(query, fields)
                members_pub = [_to_public(x) for x in cur_mem]
        except Exception:
            members_pub = []
        team_pub["members"] = members_pub

        items.append(team_pub)

    return JsonResponse({
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
    })



@csrf_exempt
def checkin_stats(request: HttpRequest):
    """Return statistics about check-ins (teams & participants)."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)

    m = _get_mongo()

    try:
        total_teams = m.teams.count_documents({})
    except Exception as exc:
        return JsonResponse({"error": "server_error", "detail": str(exc)}, status=500)

    checked_filter = {"checked_in_at": {"$exists": True}}
    checked_team_docs = list(m.teams.find(checked_filter, {"team_id": 1, "team_name": 1, "members_mssv": 1, "checked_in_at": 1}))
    checked_team_count = len(checked_team_docs)

    try:
        total_participants = m.participants.count_documents({})
    except Exception:
        total_participants = None

    checked_members = set()
    for doc in checked_team_docs:
        members = doc.get("members_mssv")
        if isinstance(members, list) and members:
            for mssv in members:
                if mssv is None:
                    continue
                checked_members.add(str(mssv).strip())
            continue

        query = {}
        team_id = doc.get("team_id")
        team_name = doc.get("team_name")
        if team_id not in (None, ""):
            query["team_id"] = team_id
        elif team_name not in (None, ""):
            query["team_name"] = team_name
        if not query:
            continue
        try:
            for participant in m.participants.find(query, {"mssv": 1}):
                mssv = participant.get("mssv")
                if mssv is None:
                    continue
                checked_members.add(str(mssv).strip())
        except Exception:
            continue

    latest_checkin = None
    for doc in checked_team_docs:
        checked_at = _ensure_datetime(doc.get("checked_in_at"))
        if checked_at is None:
            continue
        if latest_checkin is None or checked_at > latest_checkin:
            latest_checkin = checked_at

    return JsonResponse({
        "total_teams": total_teams,
        "checked_in_teams": checked_team_count,
        "total_participants": total_participants,
        "checked_in_participants": len(checked_members),
        "latest_checkin_at": _dt_to_iso(latest_checkin),
        "latest_checkin_display": _format_local_time(latest_checkin),
    })

@csrf_exempt
def delete_checkin(request: HttpRequest, team_key: str):
    """Reset check-in status for a team by key (admin-only)."""
    if request.method not in ("DELETE", "POST"):
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    me_acc = _auth_account(request)
    if not me_acc:
        token = _extract_token(request)
        return JsonResponse({"error": "missing_token" if not token else "invalid_token"}, status=401)
    if me_acc.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)

    m = _get_mongo()
    team_doc = _find_team_by_key(m, team_key)
    if not team_doc:
        return JsonResponse({"error": "not_found"}, status=404)

    team_oid = _to_object_id(team_doc.get("_id"))
    if team_oid is None:
        return JsonResponse({"error": "invalid_team_identifier"}, status=500)

    unset_result = m.teams.update_one({"_id": team_oid}, {"$unset": {"checked_in_at": ""}})
    del_result = m.checkins.delete_many({"team_oid": team_oid})

    team_pub = _to_public(team_doc)
    team_pub["checked_in_at"] = None
    team_pub["checked_in_display"] = None

    try:
        sheet_id = os.getenv("GoogleSheetCheckinID")
        sheet_tab = os.getenv("GOOGLE_SHEET_Checkin_TAB")
        if sheet_id and _settings().get("sheet_checkin_export_enabled") and (os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_CREDENTIALS_BASE64")):
            identifier = team_doc.get("team_id") or team_doc.get("team_name")
            if identifier:
                remove_rows_by_first_column(sheet_id, sheet_tab, identifier)
    except Exception as sheet_exc:
        print(f"[SHEET] Failed to remove check-in: {sheet_exc}")

    return JsonResponse({
        "status": "reset",
        "team": team_pub,
        "affected_checkins": int(del_result.deleted_count),
        "unchecked": bool(unset_result.modified_count),
    })


# =====================================================================
# Self-service registration, member profile & team management
# =====================================================================

_PARTICIPANT_FIELDS = ("full_name", "email", "phone", "faculty", "school", "facebook", "is_captain", "team_number")
_OWNER_EDITABLE_STATES = (None, "draft", "pending_approval", "rejected")


def _account_for_participant(mssv, email):
    """Return an active Account matching a participant by mssv or email (or None)."""
    from django.db.models import Q
    conds = []
    if mssv:
        conds.append(Q(mssv=str(mssv).strip()))
    if email:
        conds.append(Q(email__iexact=str(email).strip()))
    if not conds:
        return None
    q = conds[0]
    for c in conds[1:]:
        q |= c
    try:
        return Account.objects.filter(q, is_active=True).first()
    except Exception:
        return None


def _member_public(p: Dict[str, Any]) -> Dict[str, Any]:
    pub = _to_public(p)
    pub["has_account"] = bool(_account_for_participant(p.get("mssv"), p.get("email")))
    return pub


def _team_members(m, team_doc, with_account=True) -> list:
    fields = {"_id": 1, "mssv": 1, "full_name": 1, "faculty": 1, "school": 1,
              "email": 1, "phone": 1, "facebook": 1, "is_captain": 1, "discord_id": 1}
    mssv_list = team_doc.get("members_mssv")
    if isinstance(mssv_list, list) and mssv_list:
        cur = m.participants.find({"mssv": {"$in": list(mssv_list)}}, fields)
    else:
        tid = team_doc.get("team_id")
        q = {"team_id": tid} if tid else {"team_name": team_doc.get("team_name")}
        cur = m.participants.find(q, fields)
    if with_account:
        return [_member_public(x) for x in cur]
    return [_to_public(x) for x in cur]


def _build_participant_payload(data: Dict[str, Any], team_doc: Dict[str, Any]) -> Dict[str, Any]:
    payload = {"mssv": str((data.get("mssv") or "").strip())}
    for f in _PARTICIPANT_FIELDS:
        if f in data:
            payload[f] = data.get(f)
    payload["team_id"] = team_doc.get("team_id")
    payload["team_name"] = team_doc.get("team_name")
    return payload


def _autofill_member(m, data: Dict[str, Any]) -> Dict[str, Any]:
    """Fill known info for a member identified by mssv/email so the captain does
    not have to retype data that already exists (account or participant profile)."""
    merged = dict(data)
    mssv = str((merged.get("mssv") or "").strip())
    email = str((merged.get("email") or "").strip())

    src = None
    if mssv:
        src = m.participants.find_one({"mssv": mssv})
    if not src and email:
        src = m.participants.find_one({"email": email})

    acc = _account_for_participant(mssv, email)

    for f in ("full_name", "email", "phone", "faculty", "school", "facebook"):
        if not merged.get(f) and src and src.get(f):
            merged[f] = src.get(f)
    if acc:
        if not merged.get("full_name") and acc.full_name:
            merged["full_name"] = acc.full_name
        if not merged.get("email") and acc.email:
            merged["email"] = acc.email
        if not merged.get("mssv") and acc.mssv:
            merged["mssv"] = acc.mssv
    return merged


@csrf_exempt
def signup(request: HttpRequest):
    """Open self-registration for participants (members & prospective captains).

    Gated by `registration_open`. Optionally captures the member's own profile
    (mssv, full_name, ...) stored as a participant document so a captain can
    auto-fill it later and the member can be matched by email/MSSV.
    """
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _settings().get("registration_open"):
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

    try:
        acc = Account(
            username=username,
            email=email,
            password_hash=make_password(password),
            role=Account.ROLE_MEMBER,
            is_active=True,
            mssv=mssv,
            full_name=full_name,
        )
        acc.token = secrets.token_urlsafe(32)
        acc.last_login = datetime.now(timezone.utc)
        acc.save()
        _sync_account_to_mongo(acc)
    except IntegrityError:
        return JsonResponse({"error": "conflict", "detail": "username_email_or_mssv_exists"}, status=409)
    except Exception as e:
        return JsonResponse({"error": "server_error", "detail": str(e)}, status=500)

    # Claim/create participant profile so captains can auto-fill it later
    if mssv:
        try:
            m = _get_mongo()
            profile = {"mssv": mssv, "full_name": full_name or "", "email": email}
            for f in ("phone", "faculty", "school", "facebook"):
                if data.get(f) is not None:
                    profile[f] = data.get(f)
            m.upsert_participant(profile)
        except Exception:
            pass

    resp = JsonResponse({
        "token": acc.token,
        "user": {"username": acc.username, "email": acc.email, "role": acc.role, "mssv": acc.mssv},
    }, status=201)
    _set_auth_cookie(resp, acc.token or "", request)
    return resp


@csrf_exempt
def me_profile(request: HttpRequest):
    """GET/PUT the logged-in member's own participant profile (matched by mssv)."""
    me, err = _auth_or_401(request)
    if err:
        return err
    m = _get_mongo()

    if request.method == "GET":
        doc = m.participants.find_one({"mssv": me.mssv}) if me.mssv else None
        return JsonResponse({"profile": _to_public(doc) if doc else None, "mssv": me.mssv})

    if request.method in ("PUT", "PATCH"):
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        mssv = str((data.get("mssv") or me.mssv or "").strip())
        if not mssv:
            return JsonResponse({"error": "missing_mssv"}, status=400)
        if mssv != (me.mssv or ""):
            try:
                me.mssv = mssv
                me.save(update_fields=["mssv"])
            except IntegrityError:
                return JsonResponse({"error": "mssv_taken"}, status=409)
        payload = {"mssv": mssv}
        for f in ("full_name", "email", "phone", "faculty", "school", "facebook"):
            if f in data:
                payload[f] = data.get(f)
        if payload.get("full_name"):
            try:
                me.full_name = payload["full_name"]
                me.save(update_fields=["full_name"])
            except Exception:
                pass
        doc = m.upsert_participant(payload)
        return JsonResponse(_to_public(doc))

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def teams_collection(request: HttpRequest):
    """GET: list teams. POST: create a team (member -> draft, admin -> approved)."""
    if request.method != "POST":
        return teams_list(request)

    me, err = _auth_or_401(request)
    if err:
        return err

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    name = str((data.get("team_name") or data.get("name") or "").strip())
    if not name:
        return JsonResponse({"error": "missing_team_name"}, status=400)

    m = _get_mongo()

    if me.role == Account.ROLE_MEMBER:
        if not _settings().get("registration_open"):
            return JsonResponse({"error": "registration_closed"}, status=403)
        if me.team_oid:
            return JsonResponse({"error": "already_has_team", "team_oid": me.team_oid}, status=409)
        team = m.create_team(name, owner_username=me.username)
        me.team_oid = str(team["_id"])
        me.save(update_fields=["team_oid"])
        return JsonResponse(_to_public(team), status=201)

    if me.role == Account.ROLE_ADMIN:
        owner = str((data.get("owner_username") or "").strip()) or None
        team = m.create_team(name, owner_username=owner)
        # Admin-created teams are approved immediately and queued for provisioning
        m.teams.update_one(
            {"_id": team["_id"]},
            {"$set": {"approval_status": "approved", "reviewed_by": me.username,
                      "reviewed_at": datetime.now(timezone.utc), "provision_state": "pending"}},
        )
        return JsonResponse(_to_public(m.teams.find_one({"_id": team["_id"]})), status=201)

    return JsonResponse({"error": "forbidden"}, status=403)


def _resolve_my_team(request: HttpRequest):
    """Return (me, team_doc, mongo, None) for the requester's own team, else error response."""
    me, err = _auth_or_401(request)
    if err:
        return None, None, None, err
    if me.role != Account.ROLE_MEMBER or not me.team_oid:
        return None, None, None, JsonResponse({"error": "no_team"}, status=404)
    m = _get_mongo()
    oid = _to_object_id(me.team_oid)
    team = m.teams.find_one({"_id": oid}) if oid else None
    if not team:
        return None, None, None, JsonResponse({"error": "no_team"}, status=404)
    if team.get("owner_username") and team.get("owner_username") != me.username:
        return None, None, None, JsonResponse({"error": "forbidden"}, status=403)
    return me, team, m, None


def my_team(request: HttpRequest):
    """GET the requester's own team, members (with account status) and approval state."""
    me, err = _auth_or_401(request)
    if err:
        return err
    if me.role != Account.ROLE_MEMBER or not me.team_oid:
        return JsonResponse({"team": None, "members": []})
    m = _get_mongo()
    oid = _to_object_id(me.team_oid)
    team = m.teams.find_one({"_id": oid}) if oid else None
    if not team:
        return JsonResponse({"team": None, "members": []})
    return JsonResponse({
        "team": _to_public(team),
        "members": _team_members(m, team),
        "approval_status": team.get("approval_status"),
        "approval_note": team.get("approval_note"),
        "editable": team.get("approval_status") in _OWNER_EDITABLE_STATES,
    })


def _touch_after_member_edit(m, team) -> None:
    """Bump updated_at; if the team was rejected, send it back to draft for resubmission."""
    sets = {"updated_at": datetime.now(timezone.utc)}
    if team.get("approval_status") == "rejected":
        sets["approval_status"] = "draft"
        sets["approval_note"] = None
    m.teams.update_one({"_id": team["_id"]}, {"$set": sets})


@csrf_exempt
def my_team_members(request: HttpRequest):
    """POST: add a member to the captain's own team (with auto-fill)."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    me, team, m, err = _resolve_my_team(request)
    if err:
        return err
    if team.get("approval_status") not in _OWNER_EDITABLE_STATES:
        return JsonResponse({"error": "team_locked", "detail": "Đội đã được duyệt; liên hệ admin để chỉnh sửa."}, status=409)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    data = _autofill_member(m, data)
    mssv = str((data.get("mssv") or "").strip())
    if not mssv:
        return JsonResponse({"error": "missing_mssv"}, status=400)

    members = team.get("members_mssv") or []
    max_members = int(_settings().get("team_max_members") or 0)
    if max_members and mssv not in members and len(members) >= max_members:
        return JsonResponse({"error": "team_full", "max": max_members}, status=409)

    existing = m.participants.find_one({"mssv": mssv}, {"team_id": 1})
    if existing and existing.get("team_id") and existing.get("team_id") != team.get("team_id"):
        return JsonResponse({"error": "mssv_in_other_team"}, status=409)

    try:
        doc = m.upsert_participant(_build_participant_payload(data, team))
    except ValueError as e:
        return JsonResponse({"error": "invalid_input", "detail": str(e)}, status=400)
    m.teams.update_one({"_id": team["_id"]}, {"$addToSet": {"members_mssv": mssv}})
    _touch_after_member_edit(m, team)
    return JsonResponse(_member_public(doc), status=201)


@csrf_exempt
def my_team_member_detail(request: HttpRequest, mssv: str):
    """PATCH/DELETE a member of the captain's own team."""
    me, team, m, err = _resolve_my_team(request)
    if err:
        return err
    if team.get("approval_status") not in _OWNER_EDITABLE_STATES:
        return JsonResponse({"error": "team_locked"}, status=409)
    mssv = str(mssv).strip()
    members = team.get("members_mssv") or []
    if mssv not in members and not m.participants.find_one({"mssv": mssv, "team_id": team.get("team_id")}):
        return JsonResponse({"error": "not_found"}, status=404)

    if request.method in ("PATCH", "PUT"):
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        data["mssv"] = mssv
        doc = m.upsert_participant(_build_participant_payload(data, team))
        _touch_after_member_edit(m, team)
        return JsonResponse(_member_public(doc))

    if request.method == "DELETE":
        m.teams.update_one({"_id": team["_id"]}, {"$pull": {"members_mssv": mssv}})
        m.participants.delete_one({"mssv": mssv, "team_id": team.get("team_id")})
        _touch_after_member_edit(m, team)
        return JsonResponse({"status": "removed", "mssv": mssv})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def my_team_submit(request: HttpRequest):
    """Captain submits the team for admin approval."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    me, team, m, err = _resolve_my_team(request)
    if err:
        return err
    if team.get("approval_status") == "approved":
        return JsonResponse({"error": "already_approved"}, status=409)
    if not (team.get("members_mssv") or []):
        return JsonResponse({"error": "no_members"}, status=400)
    now = datetime.now(timezone.utc)
    m.teams.update_one(
        {"_id": team["_id"]},
        {"$set": {"approval_status": "pending_approval", "submitted_at": now,
                  "approval_note": None, "updated_at": now}},
    )
    return JsonResponse(_to_public(m.teams.find_one({"_id": team["_id"]})))


# =====================================================================
# Admin CRUD: participants, teams, approval
# =====================================================================

@csrf_exempt
def participants_collection(request: HttpRequest):
    """GET: list (existing). POST: create a participant (admin only)."""
    if request.method != "POST":
        return participants_list(request)

    me, err = _auth_or_401(request)
    if err:
        return err
    if me.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    if not str((data.get("mssv") or "").strip()):
        return JsonResponse({"error": "missing_mssv"}, status=400)

    m = _get_mongo()
    try:
        doc = m.upsert_participant(data)
    except ValueError as e:
        return JsonResponse({"error": "invalid_input", "detail": str(e)}, status=400)
    team_id = (data.get("team_id") or "").strip() if isinstance(data.get("team_id"), str) else data.get("team_id")
    if team_id:
        m.teams.update_one({"team_id": str(team_id)}, {"$addToSet": {"members_mssv": doc.get("mssv")}})
    return JsonResponse(_to_public(doc), status=201)


@csrf_exempt
def participant_item(request: HttpRequest, mssv: str):
    """GET (existing). PATCH/PUT/DELETE (admin only)."""
    if request.method == "GET":
        return participant_detail(request, mssv)

    me, err = _auth_or_401(request)
    if err:
        return err
    if me.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)

    m = _get_mongo()
    mssv = str(mssv).strip()
    existing = m.participants.find_one({"mssv": mssv})
    if not existing:
        return JsonResponse({"error": "not_found"}, status=404)

    if request.method in ("PATCH", "PUT"):
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        data["mssv"] = mssv
        doc = m.upsert_participant(data)
        return JsonResponse(_to_public(doc))

    if request.method == "DELETE":
        m.participants.delete_one({"mssv": mssv})
        m.teams.update_many({"members_mssv": mssv}, {"$pull": {"members_mssv": mssv}})
        return JsonResponse({"status": "deleted", "mssv": mssv})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def team_item(request: HttpRequest, team_key: str):
    """GET (existing). PATCH (admin/owner while editable) / DELETE (admin)."""
    if request.method == "GET":
        return team_detail(request, team_key)

    me, err = _auth_or_401(request)
    if err:
        return err

    m = _get_mongo()
    team = _find_team_by_key(m, team_key)
    if not team:
        return JsonResponse({"error": "not_found"}, status=404)

    is_admin = me.role == Account.ROLE_ADMIN
    is_owner = me.role == Account.ROLE_MEMBER and team.get("owner_username") == me.username
    if not (is_admin or is_owner):
        return JsonResponse({"error": "forbidden"}, status=403)

    if request.method in ("PATCH", "PUT"):
        if is_owner and not is_admin and team.get("approval_status") not in _OWNER_EDITABLE_STATES:
            return JsonResponse({"error": "team_locked"}, status=409)
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        updates: Dict[str, Any] = {}
        new_name = data.get("team_name")
        if new_name is not None:
            new_name = str(new_name).strip()
            if new_name:
                updates["team_name"] = new_name
        if not updates:
            return JsonResponse({"error": "nothing_to_update"}, status=400)
        updates["updated_at"] = datetime.now(timezone.utc)
        # If already approved, an admin rename should re-sync Discord resources
        if team.get("approval_status") == "approved" and "team_name" in updates:
            updates["provision_state"] = "pending"
        m.teams.update_one({"_id": team["_id"]}, {"$set": updates})
        if "team_name" in updates and team.get("team_id"):
            m.participants.update_many({"team_id": team["team_id"]}, {"$set": {"team_name": updates["team_name"]}})
        return JsonResponse(_to_public(m.teams.find_one({"_id": team["_id"]})))

    if request.method == "DELETE":
        if not is_admin:
            return JsonResponse({"error": "forbidden"}, status=403)
        tid = team.get("team_id")
        if tid:
            m.participants.update_many({"team_id": tid}, {"$unset": {"team_id": "", "team_name": ""}})
        m.teams.delete_one({"_id": team["_id"]})
        m.checkins.delete_many({"team_oid": team["_id"]})
        try:
            Account.objects.filter(team_oid=str(team["_id"])).update(team_oid=None)
        except Exception:
            pass
        return JsonResponse({"status": "deleted", "team_id": tid})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def team_approve(request: HttpRequest, team_key: str):
    """Admin approves a team -> queue Discord provisioning."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    me, err = _auth_or_401(request)
    if err:
        return err
    if me.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)
    m = _get_mongo()
    team = _find_team_by_key(m, team_key)
    if not team:
        return JsonResponse({"error": "not_found"}, status=404)
    now = datetime.now(timezone.utc)
    m.teams.update_one(
        {"_id": team["_id"]},
        {"$set": {"approval_status": "approved", "approval_note": None,
                  "reviewed_by": me.username, "reviewed_at": now,
                  "provision_state": "pending", "updated_at": now}},
    )
    return JsonResponse(_to_public(m.teams.find_one({"_id": team["_id"]})))


@csrf_exempt
def team_reject(request: HttpRequest, team_key: str):
    """Admin rejects a team with an optional note."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    me, err = _auth_or_401(request)
    if err:
        return err
    if me.role != Account.ROLE_ADMIN:
        return JsonResponse({"error": "forbidden"}, status=403)
    data = _json_body(request) or {}
    note = str((data.get("note") or data.get("reason") or "").strip()) or None
    m = _get_mongo()
    team = _find_team_by_key(m, team_key)
    if not team:
        return JsonResponse({"error": "not_found"}, status=404)
    now = datetime.now(timezone.utc)
    m.teams.update_one(
        {"_id": team["_id"]},
        {"$set": {"approval_status": "rejected", "approval_note": note,
                  "reviewed_by": me.username, "reviewed_at": now,
                  "provision_state": None, "updated_at": now}},
    )
    return JsonResponse(_to_public(m.teams.find_one({"_id": team["_id"]})))


@csrf_exempt
def settings_view(request: HttpRequest):
    """GET: read settings (admin/collab). PUT: update settings (admin)."""
    me, err = _auth_or_401(request)
    if err:
        return err
    m = _get_mongo()

    if request.method == "GET":
        return JsonResponse(m.get_settings())

    if request.method in ("PUT", "PATCH", "POST"):
        if me.role != Account.ROLE_ADMIN:
            return JsonResponse({"error": "forbidden"}, status=403)
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        return JsonResponse(m.set_settings(data))

    return JsonResponse({"error": "method_not_allowed"}, status=405)
