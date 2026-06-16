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
        if sheet_id and (os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_CREDENTIALS_BASE64")):
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
        if sheet_id and (os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("GOOGLE_CREDENTIALS_BASE64")):
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
