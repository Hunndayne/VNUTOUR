"""
Admin views — teams & accounts CRUD, approval (§9.3).
"""

import json
from django.conf import settings
from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.db.models import Q, Count

from api.models import Account, ProgramPhase, Team, TeamMembership
from api.services.team_service import (
    create_team, approve_team, reject_team,
    get_team_members, add_member, link_account_profile,
    registration_is_open, set_registration_open,
)
from api.services.audit_service import record_audit
from api.services import team_merge_service
from api.services.registration_service import normalize_gender, get_schema, save_schema
from api.services.submission_storage_service import proof_file_response
from api.services.payment_service import get_payment_config, save_payment_config
from api.services.timo_service import get_timo_config, save_timo_config, clear_timo_config, is_timo_configured
from api.services.antibot_service import antibot_config, set_antibot_enabled
from .views_shared import _json_body, _auth_or_401, _require_role, is_admin


def _lock_registration_phase() -> bool:
    """Serialize registration-only admin actions with phase changes."""
    phases = list(ProgramPhase.objects.select_for_update().order_by("id"))
    return any(phase.key == "registration" and phase.is_current for phase in phases)


# =====================================================================
# Teams
# =====================================================================

@csrf_exempt
def teams_collection_view(request: HttpRequest):
    """GET: list teams. POST: admin creates team."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method == "GET":
        # Search applies to both the tab counts and the listed page; the
        # approval_status tab filter applies only to the listed page.
        base_qs = Team.objects.all()

        q = request.GET.get("q")
        if q:
            base_qs = base_qs.filter(
                Q(name__icontains=q)
                | Q(code__icontains=q)
                | Q(owner_account__username__icontains=q),
            )

        # Per-status totals for the tab badges — counted across the whole
        # (search-filtered) set, not just the loaded page.
        status_counts = {
            Team.APPROVAL_DRAFT: 0,
            Team.APPROVAL_PENDING: 0,
            Team.APPROVAL_APPROVED: 0,
            Team.APPROVAL_REJECTED: 0,
        }
        for row in base_qs.values("approval_status").annotate(n=Count("id")):
            status_counts[row["approval_status"]] = row["n"]
        total_all = sum(status_counts.values())

        qs = base_qs.order_by("code")
        approval_status = request.GET.get("approval_status")
        if approval_status:
            qs = qs.filter(approval_status=approval_status)

        # Pagination
        try:
            page = max(1, int(request.GET.get("page", "1")))
            limit = max(1, min(200, int(request.GET.get("limit", "50"))))
        except Exception:
            page, limit = 1, 50
        offset = (page - 1) * limit
        total = qs.count()
        teams = qs.prefetch_related("memberships__participant")[offset:offset + limit]

        items = []
        for t in teams:
            memberships = list(t.memberships.all())
            item = {
                    "code": t.code,
                    "name": t.name,
                    "approval_status": t.approval_status,
                    "member_count": len(memberships),
                    "is_late_registration": t.is_late_registration,
                    "created_at": t.created_at.isoformat(),
            }
            if is_admin(acc):
                gender_counts = {"male": 0, "female": 0, "other": 0, "unknown": 0}
                member_summaries = []
                for membership in sorted(
                    memberships,
                    key=lambda item: (
                        not item.is_captain,
                        item.participant.full_name.lower(),
                        item.participant.mssv,
                    ),
                ):
                    participant = membership.participant
                    gender = normalize_gender((participant.extra or {}).get("gender"))
                    gender_counts[gender] += 1
                    member_summaries.append({
                        "mssv": participant.mssv,
                        "full_name": participant.full_name,
                        "gender": gender,
                        "is_captain": membership.is_captain,
                    })
                item.update({
                    "owner_username": t.owner_account.username if t.owner_account else None,
                    "gender_counts": gender_counts,
                    "member_summaries": member_summaries,
                    "provision_state": t.provision_state,
                    "provision_last_error": t.provision_last_error,
                    "last_provisioned_at": t.last_provisioned_at.isoformat() if t.last_provisioned_at else None,
                    "discord_role_id": t.discord_role_id,
                    "text_channel_id": t.text_channel_id,
                    "voice_channel_id": t.voice_channel_id,
                })
            items.append(item)

        return JsonResponse({
            "items": items,
            "page": page, "limit": limit, "total": total,
            # Tab badges: full per-status counts + the "all" total, independent
            # of the active tab and the current page.
            "status_counts": status_counts,
            "total_all": total_all,
        })

    if request.method == "POST":
        if not is_admin(acc):
            return JsonResponse({"error": "forbidden"}, status=403)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        name = str((data.get("team_name") or data.get("name") or "").strip())
        owner_username = str((data.get("owner_username") or data.get("owner") or "").strip())
        owner_account = acc
        if owner_username:
            owner_account = Account.objects.filter(
                username__iexact=owner_username,
                is_active=True,
            ).first()
            if not owner_account:
                return JsonResponse({"error": "owner_not_found"}, status=404)
            if owner_account.role != Account.ROLE_PARTICIPANT:
                return JsonResponse({"error": "invalid_owner_role"}, status=400)
            if not owner_account.mssv:
                return JsonResponse({"error": "owner_profile_incomplete"}, status=409)
            if TeamMembership.objects.filter(participant__mssv=owner_account.mssv).exists():
                return JsonResponse({"error": "owner_already_has_team"}, status=409)

        team, err = create_team(name, owner_account=owner_account, auto_approve=True)
        if err:
            return JsonResponse({"error": err}, status=400)

        if owner_account and owner_account.mssv:
            _, member_err = add_member(
                team,
                owner_account.mssv,
                full_name=owner_account.full_name or owner_account.username,
                email=owner_account.email,
                phone=owner_account.phone,
                faculty=owner_account.faculty,
                school=owner_account.school,
                is_captain=True,
                actor=owner_account,
            )
            if member_err:
                team.delete()
                return JsonResponse({"error": member_err}, status=400)
            link_account_profile(owner_account)

        return JsonResponse({
            "code": team.code, "name": team.name,
            "approval_status": team.approval_status,
            "is_late_registration": team.is_late_registration,
        }, status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def team_item_view(request: HttpRequest, team_key: str):
    """GET/PATCH/DELETE a team by code."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    try:
        team = Team.objects.get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if request.method == "GET":
        payload = {
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
            "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
            "is_late_registration": team.is_late_registration,
            "created_at": team.created_at.isoformat(),
            "members": get_team_members(
                team,
                visibility="full" if is_admin(acc) else "basic",
                requester=acc,
            ),
        }
        if is_admin(acc):
            payload.update({
                "id": team.id,
                "owner_username": team.owner_account.username if team.owner_account else None,
                "approval_note": team.approval_note,
                "payment_proof": team.payment_proof,
                # True only for a real uploaded image (drawer renders it inline);
                # `has_payment_proof` also covers the legacy pasted link (fallback to a link).
                "has_payment_proof": bool(team.payment_proof_file) or bool(team.payment_proof),
                "has_payment_proof_file": bool(team.payment_proof_file),
                "reviewed_by": team.reviewed_by.username if team.reviewed_by else None,
                "reviewed_at": team.reviewed_at.isoformat() if team.reviewed_at else None,
                "provision_state": team.provision_state,
                "provision_last_error": team.provision_last_error,
                "discord_role_id": team.discord_role_id,
                "text_channel_id": team.text_channel_id,
                "voice_channel_id": team.voice_channel_id,
            })
        return JsonResponse(payload)

    if request.method == "PATCH":
        if not is_admin(acc):
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
            if new_approval_status not in dict(Team.APPROVAL_CHOICES):
                return JsonResponse({"error": "invalid_approval_status"}, status=400)
            with transaction.atomic():
                if not _lock_registration_phase():
                    return JsonResponse({"error": "registration_phase_closed"}, status=409)
                team = Team.objects.select_for_update().get(pk=team.pk)
                # Payment/registration review starts only after the captain has
                # submitted the team. Drafts are not reviewable.
                if (
                    new_approval_status in {Team.APPROVAL_APPROVED, Team.APPROVAL_REJECTED}
                    and team.approval_status != Team.APPROVAL_PENDING
                ):
                    return JsonResponse({"error": "team_not_submitted"}, status=409)
                # Route approve/reject through the service so reviewer, timestamps and
                # Discord provisioning stay consistent with the dedicated endpoints.
                if new_approval_status == Team.APPROVAL_APPROVED:
                    approve_team(team, acc)
                elif new_approval_status == Team.APPROVAL_REJECTED:
                    reject_team(team, acc, data.get("approval_note") or data.get("note"))
                else:
                    team.approval_status = new_approval_status
                    team.save(update_fields=["approval_status", "updated_at"])

        return JsonResponse({
            "code": team.code, "name": team.name,
            "approval_status": team.approval_status,
            "is_late_registration": team.is_late_registration,
        })

    if request.method == "DELETE":
        if not is_admin(acc):
            return JsonResponse({"error": "forbidden"}, status=403)
        code = team.code
        team.delete()
        return JsonResponse({"status": "deleted", "code": code})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
@transaction.atomic
def team_approve_view(request: HttpRequest, team_key: str):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if not _lock_registration_phase():
        return JsonResponse({"error": "registration_phase_closed"}, status=409)

    try:
        team = Team.objects.select_for_update().get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if team.approval_status != Team.APPROVAL_PENDING:
        return JsonResponse({"error": "team_not_submitted"}, status=409)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    if data.get("is_late_registration") is True and not team.is_late_registration:
        team.is_late_registration = True
        team.save(update_fields=["is_late_registration", "updated_at"])

    team = approve_team(team, acc)
    record_audit(
        actor=acc,
        action="team.approve",
        summary=f"Duyệt đội {team.code} - {team.name}",
        target_type="Team",
        target_id=team.id,
        after_data={"approval_status": team.approval_status},
        reversible=False,
    )
    return JsonResponse({
        "code": team.code, "approval_status": team.approval_status,
        "provision_state": team.provision_state,
        "is_late_registration": team.is_late_registration,
    })


@csrf_exempt
@transaction.atomic
def team_reject_view(request: HttpRequest, team_key: str):
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if not _lock_registration_phase():
        return JsonResponse({"error": "registration_phase_closed"}, status=409)

    try:
        team = Team.objects.select_for_update().get(code=team_key)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if team.approval_status != Team.APPROVAL_PENDING:
        return JsonResponse({"error": "team_not_submitted"}, status=409)

    data = _json_body(request) or {}
    note = str((data.get("note") or data.get("reason") or "").strip()) or None
    team = reject_team(team, acc, note)
    record_audit(
        actor=acc,
        action="team.reject",
        summary=f"Từ chối đội {team.code} - {team.name}",
        target_type="Team",
        target_id=team.id,
        after_data={
            "approval_status": team.approval_status,
            "approval_note": team.approval_note,
        },
        reversible=False,
    )
    return JsonResponse({
        "code": team.code, "approval_status": team.approval_status,
        "approval_note": team.approval_note,
    })


# =====================================================================
# Team payment (VietQR)
# =====================================================================

@csrf_exempt
def admin_team_payment_proof_view(request: HttpRequest, team_id: int):
    """GET: stream a team's uploaded payment proof file to an admin."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    try:
        team = Team.objects.get(pk=team_id)
    except Team.DoesNotExist:
        return JsonResponse({"error": "not_found"}, status=404)

    if team.payment_proof_file:
        resp = proof_file_response(team.payment_proof_file)
        if resp is not None:
            return resp

    return JsonResponse({"error": "not_found"}, status=404)


@csrf_exempt
def admin_payment_config_view(request: HttpRequest):
    """GET/PUT the shared VietQR payment configuration (bank + fee + prefix)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse({"payment_config": get_payment_config()})

    if request.method == "PUT":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        try:
            saved = save_payment_config(data)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        return JsonResponse({"payment_config": saved})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_timo_pot_config_view(request: HttpRequest):
    """GET/PUT/DELETE the BTC's shared Timo money-pot config for auto payment
    reconciliation. Only ever reports `configured: bool` — the share code and
    mật mã are hashed on save and never stored or returned in plaintext."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse({"configured": is_timo_configured()})

    if request.method == "PUT":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        share_code = str(data.get("share_code") or data.get("share_url") or "").strip()
        password = data.get("password")
        if not share_code:
            return JsonResponse({"error": "missing_share_code"}, status=400)
        try:
            result = save_timo_config(share_code, password)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        return JsonResponse(result)

    if request.method == "DELETE":
        clear_timo_config()
        return JsonResponse({"configured": False})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_site_config_view(request: HttpRequest):
    """GET/PUT site switches: registration + anti-bot (Turnstile)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse({
            "registration_open": registration_is_open(),
            "antibot": antibot_config(),
        })

    if request.method == "PUT":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        response = {}
        if "registration_open" in data:
            raw = data.get("registration_open")
            # Parse tolerantly the same way registration_is_open() reads strings.
            if isinstance(raw, str):
                value = raw.strip().lower() in {"1", "true", "yes", "on"}
            else:
                value = bool(raw)
            response["registration_open"] = set_registration_open(value)
        if "antibot_enabled" in data:
            raw = data.get("antibot_enabled")
            if isinstance(raw, str):
                value = raw.strip().lower() in {"1", "true", "yes", "on"}
            else:
                value = bool(raw)
            response["antibot"] = set_antibot_enabled(value)
        if not response:
            return JsonResponse({"error": "missing_fields"}, status=400)
        response.setdefault("registration_open", registration_is_open())
        response.setdefault("antibot", antibot_config())
        return JsonResponse(response)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def admin_registration_schema_view(request: HttpRequest):
    """GET/PUT the schema-driven registration form definition."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse(get_schema())

    if request.method == "PUT":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        schema = data.get("schema")
        if not isinstance(schema, dict) or not isinstance(schema.get("person_fields"), list):
            return JsonResponse({"error": "invalid_schema"}, status=400)
        return JsonResponse(save_schema(schema))

    return JsonResponse({"error": "method_not_allowed"}, status=405)


# =====================================================================
# Accounts (admin)
# =====================================================================

def _master_admin_forbidden():
    return JsonResponse({"error": "master_admin_required"}, status=403)


def _may_touch_master(acc: Account) -> bool:
    """Only a master admin may grant the master role or edit a master account.

    Without this an admin could simply promote themselves and take back the
    program-structure powers the role split withholds — or reset a master's
    password and use their account. Both make the separation cosmetic.
    """
    return acc.role == Account.ROLE_MASTER_ADMIN


@csrf_exempt
def admin_accounts_view(request: HttpRequest):
    """GET: list accounts. POST: create account."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        qs = Account.objects.all()
        q = str((request.GET.get("q") or "").strip())
        if q:
            qs = qs.filter(
                Q(username__icontains=q)
                | Q(email__icontains=q)
                | Q(mssv__icontains=q)
                | Q(full_name__icontains=q),
            )

        counts = {
            "all": qs.count(),
            "admin": qs.filter(role=Account.ROLE_ADMIN).count(),
            "master_admin": qs.filter(role=Account.ROLE_MASTER_ADMIN).count(),
            "collab": qs.filter(role=Account.ROLE_COLLAB).count(),
            "participant": qs.filter(role=Account.ROLE_PARTICIPANT).count(),
            "inactive": qs.filter(is_active=False).count(),
        }

        role = request.GET.get("role")
        if role:
            qs = qs.filter(role=role)
        active = request.GET.get("active")
        if active == "1":
            qs = qs.filter(is_active=True)
        elif active == "0":
            qs = qs.filter(is_active=False)
        qs = qs.order_by("username")

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
                    "team_name": TeamMembership.objects.filter(
                        participant__mssv=a.mssv,
                    ).select_related("team").values_list("team__name", flat=True).first(),
                    "team_code": TeamMembership.objects.filter(
                        participant__mssv=a.mssv,
                    ).select_related("team").values_list("team__code", flat=True).first(),
                }
                for a in qs[offset:offset + limit]
            ],
            "counts": counts,
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
        if role == Account.ROLE_MASTER_ADMIN and not _may_touch_master(acc):
            return _master_admin_forbidden()

        if not username or not password or not email:
            return JsonResponse({"error": "missing_fields"}, status=400)
        if len(password) < settings.AUTH_MIN_PASSWORD_LENGTH:
            return JsonResponse({"error": "password_too_short"}, status=400)

        try:
            new_acc = Account(
                username=username, email=email,
                password_hash=make_password(password),
                role=role,
                is_active=True,
                mssv=str((data.get("mssv") or "").strip()) or None,
                full_name=str((data.get("full_name") or data.get("fullName") or "").strip()) or None,
            )
            new_acc.save()
            return JsonResponse({
                "username": new_acc.username, "email": new_acc.email,
                "role": new_acc.role, "is_active": new_acc.is_active,
                "mssv": new_acc.mssv, "full_name": new_acc.full_name,
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

    # A master account is off-limits to plain admins for anything but reading:
    # its password, its active flag and its role are all routes to taking it over.
    if (
        request.method in ("PATCH", "DELETE")
        and target.role == Account.ROLE_MASTER_ADMIN
        and not _may_touch_master(acc)
    ):
        return _master_admin_forbidden()

    if request.method == "GET":
        membership = TeamMembership.objects.filter(
            participant__mssv=target.mssv,
        ).select_related("team").first()
        return JsonResponse({
            "username": target.username, "email": target.email, "role": target.role,
            "is_active": target.is_active, "mssv": target.mssv, "full_name": target.full_name,
            "last_login": target.last_login.isoformat() if target.last_login else None,
            "created_at": target.created_at.isoformat(),
            "team_name": membership.team.name if membership else None,
            "team_code": membership.team.code if membership else None,
        })

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        if "email" in data and data["email"]:
            target.email = str(data["email"]).strip()
        if "mssv" in data:
            target.mssv = str(data["mssv"]).strip() or None
        if "full_name" in data or "fullName" in data:
            target.full_name = str(data.get("full_name") or data.get("fullName") or "").strip() or None
        if "role" in data and data["role"] in dict(Account.ROLE_CHOICES):
            if data["role"] == Account.ROLE_MASTER_ADMIN and not _may_touch_master(acc):
                return _master_admin_forbidden()
            target.role = data["role"]
        if "is_active" in data:
            target.is_active = bool(data["is_active"])
        if "password" in data and data["password"]:
            if len(str(data["password"])) < settings.AUTH_MIN_PASSWORD_LENGTH:
                return JsonResponse({"error": "password_too_short"}, status=400)
            target.password_hash = make_password(data["password"])
        try:
            target.save()
        except IntegrityError:
            return JsonResponse({"error": "conflict"}, status=409)
        return JsonResponse({
            "username": target.username,
            "email": target.email,
            "mssv": target.mssv,
            "full_name": target.full_name,
            "role": target.role,
            "is_active": target.is_active,
        })

    if request.method == "DELETE":
        target.is_active = False
        target.save(update_fields=["is_active"])
        return JsonResponse({"status": "deactivated"})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


# =====================================================================
# Team merge
# =====================================================================

@csrf_exempt
def team_merge_view(request: HttpRequest):
    """POST {team_codes: [...]}: combine teams without exceeding max roster size.

    The combined team keeps the smallest internal code, loses all previous
    captains and is renamed to that code, then opens a secret captain ballot.
    """
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    raw_codes = data.get("team_codes")
    if not isinstance(raw_codes, list):
        # Keep the old request shape readable during a rolling frontend deploy.
        raw_codes = [data.get("source_code"), data.get("target_code")]
    team_codes = [str(code or "").strip() for code in raw_codes]
    if len(team_codes) < 2 or any(not code for code in team_codes):
        return JsonResponse({"error": "missing_team_codes"}, status=400)

    merged, merge_error, merged_from = team_merge_service.merge_team_group(team_codes)
    if merge_error:
        status = 404 if merge_error == "not_found" else 409
        return JsonResponse({"error": merge_error}, status=status)

    record_audit(
        actor=acc,
        action="team.merge",
        summary=f"Ghép {len(team_codes)} đội thành {merged.code}",
        target_type="Team",
        target_id=merged.code,
        before_data={"teams": merged.merge_before},
        after_data={"code": merged.code, "name": merged.name,
                    "members": TeamMembership.objects.filter(team=merged).count()},
        reversible=False,
    )

    return JsonResponse({
        "code": merged.code,
        "name": merged.name,
        "merged_from": merged_from,
        "merged_teams": team_codes,
        "member_count": TeamMembership.objects.filter(team=merged).count(),
        "captain_vote_open": True,
    })
