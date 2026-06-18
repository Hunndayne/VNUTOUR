"""
Participant self-service views — §9.2
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError

from api.models import Account, Participant, Team, TeamMembership
from api.services.team_service import (
    create_team, add_member, remove_member, submit_team,
    get_team_members, get_team_for_participant, team_is_editable, rotate_qr_token,
)
from .views_shared import _json_body, _auth_or_401, _require_role


@csrf_exempt
def me_profile_view(request: HttpRequest):
    """GET/PATCH the logged-in user's participant profile."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    if request.method == "GET":
        participant = Participant.objects.filter(mssv=acc.mssv).first() if acc.mssv else None
        return JsonResponse({
            "profile": {
                "mssv": participant.mssv,
                "full_name": participant.full_name,
                "email": participant.email,
                "phone": participant.phone,
                "faculty": participant.faculty,
                "school": participant.school,
                "facebook": participant.facebook,
                "discord_id": participant.discord_id,
            } if participant else None,
            "account_mssv": acc.mssv,
        })

    if request.method in ("PUT", "PATCH"):
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        mssv = str((data.get("mssv") or acc.mssv or "").strip())
        if not mssv:
            return JsonResponse({"error": "missing_mssv"}, status=400)

        # Update account mssv if changed
        if mssv != (acc.mssv or ""):
            try:
                acc.mssv = mssv
                acc.save(update_fields=["mssv"])
            except IntegrityError:
                return JsonResponse({"error": "mssv_taken"}, status=409)

        # Update/full_name on account
        if data.get("full_name"):
            acc.full_name = data["full_name"]
            acc.save(update_fields=["full_name"])

        # Upsert participant profile
        participant, _ = Participant.objects.update_or_create(
            mssv=mssv,
            defaults={
                "full_name": data.get("full_name") or acc.full_name or "",
                "email": data.get("email") or acc.email,
                "phone": data.get("phone"),
                "faculty": data.get("faculty"),
                "school": data.get("school"),
                "facebook": data.get("facebook"),
            },
        )
        return JsonResponse({
            "mssv": participant.mssv,
            "full_name": participant.full_name,
            "email": participant.email,
            "phone": participant.phone,
            "faculty": participant.faculty,
            "school": participant.school,
            "facebook": participant.facebook,
            "discord_id": participant.discord_id,
        })

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def my_team_view(request: HttpRequest):
    """GET: view own team. POST: create team."""
    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.role != Account.ROLE_PARTICIPANT:
        return JsonResponse({"error": "forbidden"}, status=403)

    if request.method == "GET":
        membership = TeamMembership.objects.filter(
            participant__mssv=acc.mssv,
        ).select_related("team").first()

        if not membership:
            return JsonResponse({"team": None, "members": []})

        team = membership.team
        return JsonResponse({
            "team": {
                "code": team.code,
                "name": team.name,
                "approval_status": team.approval_status,
                "approval_note": team.approval_note,
                "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
                "qr_token": team.qr_token,
            },
            "members": get_team_members(team),
            "editable": team_is_editable(team),
        })

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        name = str((data.get("team_name") or data.get("name") or "").strip())
        # Check participant doesn't already own a team via membership
        existing = TeamMembership.objects.filter(
            participant__mssv=acc.mssv,
        ).first()
        if existing:
            return JsonResponse({"error": "already_has_team", "team_code": existing.team.code}, status=409)

        team, err = create_team(name, owner_account=acc)
        if err:
            return JsonResponse({"error": err}, status=400)

        # Add creator as member + captain
        add_member(team, acc.mssv or "", full_name=acc.full_name, email=acc.email, is_captain=True)

        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
            "qr_token": team.qr_token,
        }, status=201)

    return JsonResponse({"error": "method_not_allowed"}, status=405)


@csrf_exempt
def my_team_submit_view(request: HttpRequest):
    """POST: submit team for approval."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)

    success, err = submit_team(membership.team)
    if not success:
        return JsonResponse({"error": err}, status=409)

    return JsonResponse({
        "code": membership.team.code,
        "approval_status": membership.team.approval_status,
        "submitted_at": membership.team.submitted_at.isoformat() if membership.team.submitted_at else None,
    })


@csrf_exempt
def my_team_members_view(request: HttpRequest):
    """POST: add member to own team."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)

    team = membership.team
    if not team_is_editable(team):
        return JsonResponse({"error": "team_locked"}, status=409)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    participant, err = add_member(
        team,
        mssv=str((data.get("mssv") or "").strip()),
        full_name=data.get("full_name"),
        email=data.get("email"),
        phone=data.get("phone"),
        faculty=data.get("faculty"),
        school=data.get("school"),
        facebook=data.get("facebook"),
    )
    if err:
        return JsonResponse({"error": err}, status=400)

    return JsonResponse({
        "mssv": participant.mssv,
        "full_name": participant.full_name,
    }, status=201)


@csrf_exempt
def my_team_member_detail_view(request: HttpRequest, mssv: str):
    """PATCH/DELETE a member of own team."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)

    team = membership.team
    if not team_is_editable(team):
        return JsonResponse({"error": "team_locked"}, status=409)

    if request.method == "DELETE":
        success, err = remove_member(team, mssv)
        if not success:
            return JsonResponse({"error": err}, status=404)
        return JsonResponse({"status": "removed", "mssv": mssv})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


def my_team_qr_view(request: HttpRequest):
    """GET: view own team's QR token."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "no_team"}, status=404)

    team = membership.team
    if team.approval_status != Team.APPROVAL_APPROVED:
        return JsonResponse({"error": "team_not_approved"}, status=403)

    if not team.qr_token:
        team.qr_token = rotate_qr_token(team)

    return JsonResponse({
        "team_code": team.code,
        "qr_payload": f"t:{team.qr_token}",
    })
