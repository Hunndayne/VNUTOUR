"""
Participant self-service views — §9.2
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, transaction

from api.models import Account, Participant, Team, TeamMembership
from api.services.registration_service import (
    get_schema, validate_account_mssv_claim, validate_person_submission,
)
from api.services.team_service import (
    create_team, add_member, update_member, remove_member, submit_team,
    get_team_members, get_team_for_participant, team_is_editable, rotate_qr_token,
    link_account_profile,
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
                "cccd": participant.cccd,
                "date_of_birth": participant.date_of_birth.isoformat() if participant.date_of_birth else None,
                "extra": participant.extra or {},
                "discord_id": participant.discord_id,
            } if participant else None,
            "account_mssv": acc.mssv,
            # FE (esp. the post-Google-signup page) uses this to decide whether
            # to force the supplementary-info form before anything else.
            "profile_complete": bool(acc.mssv and participant and participant.full_name),
        })

    if request.method in ("PUT", "PATCH"):
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        mssv = str((data.get("mssv") or acc.mssv or "").strip())
        if not mssv:
            return JsonResponse({"error": "missing_mssv"}, status=400)

        claim_error = validate_account_mssv_claim(acc, mssv)
        if claim_error:
            return JsonResponse({"error": claim_error}, status=409)

        columns, extra, schema_error = validate_person_submission(
            {**data, "mssv": mssv, "email": data.get("email") or acc.email},
            "profile",
        )
        if schema_error:
            return JsonResponse({"error": schema_error}, status=400)

        try:
            with transaction.atomic():
                previous_mssv = acc.mssv
                account_updates = []
                if mssv != (acc.mssv or ""):
                    acc.mssv = mssv
                    account_updates.append("mssv")
                if data.get("full_name"):
                    acc.full_name = data["full_name"]
                    account_updates.append("full_name")
                for fld in ("phone", "school", "faculty"):
                    if fld in columns:
                        setattr(acc, fld, columns[fld])
                        account_updates.append(fld)
                if account_updates:
                    acc.save(update_fields=account_updates)

                if previous_mssv != acc.mssv:
                    Participant.objects.filter(account=acc).exclude(mssv=acc.mssv).update(account=None)

                # Upsert participant profile and link it back to the account so
                # the Account <-> Participant FK is never left dangling.
                participant, _ = Participant.objects.update_or_create(
                    mssv=mssv,
                    defaults={
                        "account": acc,
                        "full_name": columns.get("full_name") or acc.full_name or "",
                        "email": columns.get("email") or acc.email,
                        "phone": columns.get("phone"),
                        "faculty": columns.get("faculty"),
                        "school": columns.get("school"),
                        "facebook": columns.get("facebook"),
                        "cccd": columns.get("cccd"),
                        "date_of_birth": columns.get("date_of_birth"),
                        "extra": extra or None,
                    },
                )
        except IntegrityError:
            return JsonResponse({"error": "mssv_taken"}, status=409)

        return JsonResponse({
            "mssv": participant.mssv,
            "full_name": participant.full_name,
            "email": participant.email,
            "phone": participant.phone,
            "faculty": participant.faculty,
            "school": participant.school,
            "facebook": participant.facebook,
            "cccd": participant.cccd,
            "date_of_birth": participant.date_of_birth.isoformat() if participant.date_of_birth else None,
            "extra": participant.extra or {},
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
                "payment_proof": team.payment_proof,
            },
            "members": get_team_members(team),
            "editable": team_is_editable(team),
        })

    if request.method == "POST":
        # A captain must have completed their own profile first (mssv). For
        # Google signups this is enforced by the supplementary-info page.
        if not acc.mssv:
            return JsonResponse({"error": "profile_incomplete"}, status=409)

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

        # Add creator as member + captain, then link the profile to the account
        add_member(team, acc.mssv, full_name=acc.full_name, email=acc.email, is_captain=True)
        link_account_profile(acc)

        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
            "qr_token": team.qr_token,
        }, status=201)

    if request.method == "PATCH":
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

        new_name = str((data.get("team_name") or data.get("name") or "").strip())
        if not new_name:
            return JsonResponse({"error": "missing_team_name"}, status=400)

        team.name = new_name
        if "payment_proof" in data:
            team.payment_proof = str((data.get("payment_proof") or "").strip()) or None
        team.save(update_fields=["name", "payment_proof", "updated_at"])
        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
            "payment_proof": team.payment_proof,
        })

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

    team = membership.team
    schema = get_schema()
    members = get_team_members(team)
    expected_size = int(schema.get("team_size") or 5)
    if len(members) != expected_size:
        return JsonResponse({"error": f"team_size_mismatch:expected_{expected_size}"}, status=409)

    for field in schema.get("team_fields", []):
        if field.get("enabled", True) and field.get("required") and field.get("key") == "payment_proof":
            if not team.payment_proof:
                return JsonResponse({"error": "missing:team:payment_proof"}, status=400)

    for index, member in enumerate(members, start=1):
        payload = {**member, **(member.get("extra") or {})}
        _, _, schema_error = validate_person_submission(payload, "captain" if member.get("is_captain") else f"member_{index}")
        if schema_error:
            return JsonResponse({"error": schema_error}, status=400)

    success, err = submit_team(team)
    if not success:
        return JsonResponse({"error": err}, status=409)

    return JsonResponse({
        "code": team.code,
        "approval_status": team.approval_status,
        "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
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

    columns, extra, schema_error = validate_person_submission(data, "member")
    if schema_error:
        return JsonResponse({"error": schema_error}, status=400)

    participant, err = add_member(
        team,
        mssv=columns.get("mssv"),
        full_name=columns.get("full_name"),
        email=columns.get("email"),
        phone=columns.get("phone"),
        faculty=columns.get("faculty"),
        school=columns.get("school"),
        facebook=columns.get("facebook"),
        cccd=columns.get("cccd"),
        date_of_birth=columns.get("date_of_birth"),
        extra=extra,
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

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        columns, extra, schema_error = validate_person_submission(
            {**data, "mssv": mssv},
            "member",
        )
        if schema_error:
            return JsonResponse({"error": schema_error}, status=400)

        participant, err = update_member(
            team, mssv,
            full_name=columns.get("full_name"),
            email=columns.get("email"),
            phone=columns.get("phone"),
            faculty=columns.get("faculty"),
            school=columns.get("school"),
            facebook=columns.get("facebook"),
            cccd=columns.get("cccd"),
            date_of_birth=columns.get("date_of_birth"),
            extra=extra,
        )
        if err:
            return JsonResponse({"error": err}, status=404)
        return JsonResponse({
            "mssv": participant.mssv,
            "full_name": participant.full_name,
            "email": participant.email,
            "phone": participant.phone,
            "faculty": participant.faculty,
            "school": participant.school,
            "facebook": participant.facebook,
            "cccd": participant.cccd,
            "date_of_birth": participant.date_of_birth.isoformat() if participant.date_of_birth else None,
            "extra": participant.extra or {},
        })

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
