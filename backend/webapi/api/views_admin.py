"""
Admin views — teams & accounts CRUD, approval (§9.3).
"""

import json
from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError

from api.models import Account, Team, TeamMembership, Participant
from api.services.team_service import (
    create_team, approve_team, reject_team,
    get_team_members, team_is_editable,
)
from .views_shared import _json_body, _auth_or_401, _require_role


# =====================================================================
# Teams
# =====================================================================

@csrf_exempt
def teams_collection_view(request: HttpRequest):
    """GET: list teams. POST: admin creates team."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    if request.method == "GET":
        qs = Team.objects.all().order_by("code")

        # Filters
        approval_status = request.GET.get("approval_status")
        if approval_status:
            qs = qs.filter(approval_status=approval_status)

        q = request.GET.get("q")
        if q:
            qs = qs.filter(name__icontains=q)

        # Pagination
        try:
            page = max(1, int(request.GET.get("page", "1")))
            limit = max(1, min(200, int(request.GET.get("limit", "50"))))
        except Exception:
            page, limit = 1, 50
        offset = (page - 1) * limit
        total = qs.count()
        teams = qs[offset:offset + limit]

        return JsonResponse({
            "items": [
                {
                    "code": t.code,
                    "name": t.name,
                    "owner_username": t.owner_account.username if t.owner_account else None,
                    "approval_status": t.approval_status,
                    "provision_state": t.provision_state,
                    "member_count": TeamMembership.objects.filter(team=t).count(),
                    "created_at": t.created_at.isoformat(),
                }
                for t in teams
            ],
            "page": page, "limit": limit, "total": total,
        })

    if request.method == "POST":
        if acc.role != Account.ROLE_ADMIN:
            return JsonResponse({"error": "forbidden"}, status=403)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        name = str((data.get("team_name") or data.get("name") or "").strip())
        team, err = create_team(name, owner_account=acc, auto_approve=True)
        if err:
            return JsonResponse({"error": err}, status=400)

        return JsonResponse({
            "code": team.code, "name": team.name,
            "approval_status": team.approval_status,
        }, status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def team_item_view(request: HttpRequest, team_key: str):
    """GET/PATCH/DELETE a team by code."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    try:
        team = Team.objects.get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if request.method == "GET":
        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "owner_username": team.owner_account.username if team.owner_account else None,
            "approval_status": team.approval_status,
            "approval_note": team.approval_note,
            "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
            "reviewed_by": team.reviewed_by.username if team.reviewed_by else None,
            "reviewed_at": team.reviewed_at.isoformat() if team.reviewed_at else None,
            "provision_state": team.provision_state,
            "provision_last_error": team.provision_last_error,
            "discord_role_id": team.discord_role_id,
            "text_channel_id": team.text_channel_id,
            "voice_channel_id": team.voice_channel_id,
            "created_at": team.created_at.isoformat(),
            "members": get_team_members(team),
        })

    if request.method == "PATCH":
        if acc.role != Account.ROLE_ADMIN:
            return JsonResponse({"error": "forbidden"}, status=403)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        new_name = data.get("name") or data.get("team_name")
        if new_name:
            team.name = str(new_name).strip()
            team.save(update_fields=["name", "updated_at"])

        new_approval_status = data.get("approval_status")
        if new_approval_status:
            team.approval_status = new_approval_status
            team.save(update_fields=["approval_status", "updated_at"])

        return JsonResponse({
            "code": team.code, "name": team.name,
            "approval_status": team.approval_status,
        })

    if request.method == "DELETE":
        if acc.role != Account.ROLE_ADMIN:
            return JsonResponse({"error": "forbidden"}, status=403)
        code = team.code
        team.delete()
        return JsonResponse({"status": "deleted", "code": code})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def team_approve_view(request: HttpRequest, team_key: str):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        team = Team.objects.get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    team = approve_team(team, acc)
    return JsonResponse({
        "code": team.code, "approval_status": team.approval_status,
        "provision_state": team.provision_state,
    })


@csrf_exempt
def team_reject_view(request: HttpRequest, team_key: str):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        team = Team.objects.get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    data = _json_body(request) or {}
    note = str((data.get("note") or data.get("reason") or "").strip()) or None
    team = reject_team(team, acc, note)
    return JsonResponse({
        "code": team.code, "approval_status": team.approval_status,
        "approval_note": team.approval_note,
    })


# =====================================================================
# Accounts (admin)
# =====================================================================

@csrf_exempt
def admin_accounts_view(request: HttpRequest):
    """GET: list accounts. POST: create account."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        qs = Account.objects.all().order_by("username")
        role = request.GET.get("role")
        if role:
            qs = qs.filter(role=role)
        active = request.GET.get("active")
        if active == "1":
            qs = qs.filter(is_active=True)
        elif active == "0":
            qs = qs.filter(is_active=False)

        try:
            page = max(1, int(request.GET.get("page", "1")))
            limit = max(1, min(200, int(request.GET.get("limit", "50"))))
        except Exception:
            page, limit = 1, 50
        offset = (page - 1) * limit
        total = qs.count()

        return JsonResponse({
            "items": [
                {
                    "username": a.username, "email": a.email, "role": a.role,
                    "is_active": a.is_active, "mssv": a.mssv, "full_name": a.full_name,
                    "last_login": a.last_login.isoformat() if a.last_login else None,
                    "created_at": a.created_at.isoformat(),
                }
                for a in qs[offset:offset + limit]
            ],
            "page": page, "limit": limit, "total": total,
        })

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        username = str((data.get("username") or "").strip())
        password = str((data.get("password") or "").strip())
        email = str((data.get("email") or "").strip())
        role = str((data.get("role") or Account.ROLE_COLLAB).strip())
        if role not in dict(Account.ROLE_CHOICES):
            role = Account.ROLE_COLLAB

        if not username or not password or not email:
            return JsonResponse({"error": "missing_fields"}, status=400)

        try:
            new_acc = Account(
                username=username, email=email,
                password_hash=make_password(password), role=role, is_active=True,
            )
            new_acc.save()
            return JsonResponse({
                "username": new_acc.username, "email": new_acc.email,
                "role": new_acc.role, "is_active": new_acc.is_active,
            }, status=201)
        except IntegrityError:
            return JsonResponse({"error": "conflict"}, status=409)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_account_detail_view(request: HttpRequest, username: str):
    """GET/PATCH/DELETE an account."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        target = Account.objects.get(username__iexact=username)
    except Account.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if request.method == "GET":
        return JsonResponse({
            "username": target.username, "email": target.email, "role": target.role,
            "is_active": target.is_active, "mssv": target.mssv, "full_name": target.full_name,
            "last_login": target.last_login.isoformat() if target.last_login else None,
            "created_at": target.created_at.isoformat(),
        })

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        if "role" in data and data["role"] in dict(Account.ROLE_CHOICES):
            target.role = data["role"]
        if "is_active" in data:
            target.is_active = bool(data["is_active"])
        if "password" in data and data["password"]:
            target.password_hash = make_password(data["password"])
        target.save()
        return JsonResponse({
            "username": target.username, "role": target.role, "is_active": target.is_active,
        })

    if request.method == "DELETE":
        target.is_active = False
        target.save(update_fields=["is_active"])
        return JsonResponse({"status": "deactivated"})

    return JsonResponse({"error": "method_not_allowed"}, status=405)
