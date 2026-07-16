"""
Participant self-service views — §9.2
"""

import json
from copy import deepcopy

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, transaction
from django.utils import timezone

from api.models import (
    Account, Participant, Team, TeamMembership, PhaseRoster, ProgramPhase,
    Station, SubEvent, StationSession, StationSubmission,
)
from api.services.registration_service import (
    get_schema, validate_account_mssv_claim, validate_person_submission,
)
from api.services.program_service import get_current_sub_event
from api.services.checkin_qr_service import team_qr_visible
from api.services.station_service import set_submission_score
from api.services.submission_storage_service import save_submission_files
from api.services.team_service import (
    create_team, add_member, update_member, remove_member, submit_team,
    get_team_members, get_team_for_participant, team_is_editable, rotate_qr_token,
    link_account_profile, ensure_default_phase_roster_for_team,
)
from .views_shared import _json_body, _auth_or_401, _require_role


def _prepare_member_submission(data: dict, who: str):
    """Merge trusted existing profile data before validating a team member form."""
    payload = dict(data or {})
    mssv = str((payload.get("mssv") or "").strip())
    email = str((payload.get("email") or "").strip())
    if not mssv:
        return {}, {}, "missing:%s:mssv" % who
    if not email:
        return {}, {}, "missing:%s:email" % who

    account = Account.objects.filter(mssv=mssv, is_active=True).first()
    participant = Participant.objects.filter(mssv=mssv).first()
    if account:
        if account.email.strip().lower() != email.lower():
            return {}, {}, "registration_mismatch"
        for key in ("full_name", "email", "phone", "school", "faculty"):
            value = getattr(account, key, None)
            if value and not str((payload.get(key) or "")).strip():
                payload[key] = value
    elif participant:
        registered_email = (participant.email or "").strip().lower()
        if registered_email and registered_email != email.lower():
            return {}, {}, "registration_mismatch"

    if participant:
        for key in ("full_name", "email", "phone", "school", "faculty", "facebook", "cccd", "date_of_birth"):
            value = getattr(participant, key, None)
            if value and not payload.get(key):
                payload[key] = value.isoformat() if key == "date_of_birth" else value
        if participant.extra:
            for key, value in participant.extra.items():
                if value and not payload.get(key):
                    payload[key] = value

    return validate_person_submission(payload, who)


def _member_resolution(data: dict):
    payload = dict(data or {})
    mssv = str((payload.get("mssv") or "").strip())
    email = str((payload.get("email") or "").strip())
    if not mssv:
        return None, "missing:member:mssv"
    if not email:
        return None, "missing:member:email"

    # Block if this MSSV is already in a submitted (pending/approved) team
    submitted_member = TeamMembership.objects.filter(
        participant__mssv=mssv,
        team__approval_status__in=[Team.APPROVAL_PENDING, Team.APPROVAL_APPROVED],
    ).select_related("team").first()
    if submitted_member:
        return None, "mssv_in_submitted_team"

    account = Account.objects.filter(mssv=mssv, is_active=True).first()
    participant = Participant.objects.filter(mssv=mssv).first()
    if account:
        if account.email.strip().lower() != email.lower():
            return None, "registration_mismatch"
        for key in ("full_name", "email", "phone", "school", "faculty"):
            value = getattr(account, key, None)
            if value:
                payload[key] = value
    elif participant:
        registered_email = (participant.email or "").strip().lower()
        if registered_email and registered_email != email.lower():
            return None, "registration_mismatch"

    if participant:
        for key in ("full_name", "email", "phone", "school", "faculty", "facebook", "date_of_birth"):
            value = getattr(participant, key, None)
            if value:
                payload[key] = value.isoformat() if key == "date_of_birth" else value
        if participant.extra:
            for key, value in participant.extra.items():
                if value:
                    payload[key] = value

    fields = []
    for field in get_schema().get("person_fields", []):
        if not field.get("enabled", True):
            continue
        if field.get("key") == "cccd" and participant and participant.cccd:
            continue
        fields.append(field)

    safe_profile = {
        "mssv": payload.get("mssv") or "",
        "full_name": payload.get("full_name") or "",
        "school": payload.get("school") or "",
    }
    return {"profile": safe_profile, "fields": fields, "has_account": account is not None}, None


def _has_submission_config(config: dict | None) -> bool:
    config = config or {}
    return bool(
        config.get("form", {}).get("enabled")
        or config.get("quiz", {}).get("enabled")
        or config.get("attachment", {}).get("enabled")
    )


def _public_submission_config(config: dict) -> dict:
    public_config = deepcopy(config or {})
    quiz = public_config.get("quiz")
    if isinstance(quiz, dict):
        for item in quiz.get("items") or []:
            if isinstance(item, dict):
                for key in (
                    "correctOption", "correct_option",
                    "correctAnswer", "correct_answer", "answer",
                ):
                    item.pop(key, None)
    return public_config


def _submission_limits(config: dict | None) -> dict:
    limits = (config or {}).get("limits") or {}
    try:
        max_submissions = max(0, int(limits.get("maxSubmissions") or 0))
    except (TypeError, ValueError):
        max_submissions = 0
    return {
        "max_submissions": max_submissions,
        "close_on_correct": bool(limits.get("closeOnCorrect")),
        "manual_closed": bool(limits.get("manualClosed")),
    }


def _quiz_item_points(item: dict) -> int:
    try:
        return max(0, int(item.get("points")))
    except (TypeError, ValueError):
        return 1


def _grade_quiz(config: dict | None, response_payload: dict) -> dict | None:
    """Grade quiz answers against the station config; None when there is no quiz.

    Returns {correct_count, total, points, max_points, all_correct} — points sum
    per-question weights (config item "points", default 1).
    """
    quiz = (config or {}).get("quiz") or {}
    items = (quiz.get("items") or []) if quiz.get("enabled") else []
    if not items:
        return None

    answers = {}
    for answer in (response_payload or {}).get("quiz") or []:
        if isinstance(answer, dict):
            answers[str(answer.get("id"))] = answer.get("selectedOption")

    correct_count = 0
    total = 0
    points = 0
    max_points = 0
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        correct = item.get("correctOption")
        if not isinstance(correct, int):
            continue
        item_points = _quiz_item_points(item)
        total += 1
        max_points += item_points
        selected = answers.get(str(item.get("id") or f"quiz-{index}"))
        if selected == correct:
            correct_count += 1
            points += item_points

    return {
        "correct_count": correct_count,
        "total": total,
        "points": points,
        "max_points": max_points,
        "all_correct": total > 0 and correct_count == total,
    }


def _form_closure_state(station: Station) -> dict:
    """Whether the station form stopped accepting submissions, and why."""
    limits = _submission_limits(station.submission_config)
    submitted = StationSubmission.objects.filter(
        station=station,
        status__in=[StationSubmission.STATUS_SUBMITTED, StationSubmission.STATUS_GRADED],
    )
    submitted_count = submitted.count()

    reason = None
    if limits["manual_closed"]:
        reason = "manual"
    elif limits["max_submissions"] and submitted_count >= limits["max_submissions"]:
        reason = "limit_reached"
    elif limits["close_on_correct"] and submitted.filter(is_correct=True).exists():
        reason = "correct_answer"

    return {
        "closed": reason is not None,
        "reason": reason,
        "submitted_count": submitted_count,
        "max_submissions": limits["max_submissions"] or None,
    }


def _station_form_payload(station: Station, team: Team | None = None) -> dict:
    phase = station.sub_event.phase
    event = station.sub_event
    payload = {
        "station_id": station.id,
        "station_code": station.code,
        "station_name": station.name,
        "station_location": station.location,
        "event_id": event.id,
        "event_name": event.name,
        "phase_key": phase.key,
        "phase_label": phase.label,
        "submission_config": _public_submission_config(station.submission_config or {}),
        "closure": _form_closure_state(station),
    }
    if team is not None:
        mine = StationSubmission.objects.filter(
            team=team, station=station,
        ).order_by("-created_at").first()
        payload["my_submission"] = {
            "status": mine.status,
            "submitted_at": mine.submitted_at.isoformat() if mine.submitted_at else None,
        } if mine else None
    return payload


def _registration_phase_open() -> bool:
    current_phase = ProgramPhase.objects.filter(is_current=True).first()
    return bool(current_phase and current_phase.key == "registration")


def _registration_closed_response():
    return JsonResponse({"error": "registration_closed"}, status=409)


@csrf_exempt
def me_profile_view(request: HttpRequest):
    """GET/PATCH the logged-in user's participant profile."""
    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.mssv:
        link_account_profile(acc)

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
    if acc.mssv:
        link_account_profile(acc)

    if request.method == "GET":
        membership = TeamMembership.objects.filter(
            participant__mssv=acc.mssv,
        ).select_related("team").first()

        if not membership:
            return JsonResponse({"team": None, "members": []})

        team = membership.team
        ensure_default_phase_roster_for_team(team)
        return JsonResponse({
            "team": {
                "code": team.code,
                "name": team.name,
                "approval_status": team.approval_status,
                "approval_note": team.approval_note,
                "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
                "payment_proof": team.payment_proof,
                "is_late_registration": team.is_late_registration,
            },
            "members": get_team_members(team, visibility="self", requester=acc),
            "editable": team_is_editable(team),
        })

    if request.method == "POST":
        if not _registration_phase_open():
            return _registration_closed_response()
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
        add_member(
            team,
            acc.mssv,
            full_name=acc.full_name,
            email=acc.email,
            phone=acc.phone,
            faculty=acc.faculty,
            school=acc.school,
            is_captain=True,
        )
        link_account_profile(acc)

        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
        }, status=201)

    if request.method == "PATCH":
        if not _registration_phase_open():
            return _registration_closed_response()
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
    if not _registration_phase_open():
        return _registration_closed_response()

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)

    team = membership.team
    schema = get_schema()
    members = get_team_members(team)
    expected_size = int(schema.get("team_size_max") or schema.get("team_size") or 5)
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
def my_team_member_resolve_view(request: HttpRequest):
    """POST: resolve a member by MSSV + email without exposing sensitive CCCD."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err
    if not _registration_phase_open():
        return _registration_closed_response()

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)
    if not team_is_editable(membership.team):
        return JsonResponse({"error": "team_locked"}, status=409)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    payload, error = _member_resolution(data)
    if error:
        return JsonResponse({"error": error}, status=400)
    return JsonResponse(payload)


@csrf_exempt
def my_team_members_view(request: HttpRequest):
    """POST: add member to own team."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err
    if not _registration_phase_open():
        return _registration_closed_response()

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

    columns, extra, schema_error = _prepare_member_submission(data, "member")
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
    if not _registration_phase_open():
        return _registration_closed_response()

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

        columns, extra, schema_error = _prepare_member_submission({**data, "mssv": mssv}, "member")
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
        member_payload = next(
            (
                item for item in get_team_members(
                    team,
                    visibility="self",
                    requester=acc,
                )
                if item["mssv"] == participant.mssv
            ),
            {
                "mssv": participant.mssv,
                "full_name": participant.full_name,
                "school": participant.school,
            },
        )
        return JsonResponse(member_payload)

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
    ensure_default_phase_roster_for_team(team)
    if team.approval_status != Team.APPROVAL_APPROVED:
        return JsonResponse({"error": "team_not_approved"}, status=403)

    if not team_qr_visible(team):
        return JsonResponse({"enabled": False, "team_code": team.code})

    if not team.qr_token:
        team.qr_token = rotate_qr_token(team)

    return JsonResponse({
        "enabled": True,
        "team_code": team.code,
        "qr_payload": f"t:{team.qr_token}",
    })


def my_team_forms_view(request: HttpRequest):
    """GET forms the participant's team is allowed to access by phase roster/current phase."""
    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.role != Account.ROLE_PARTICIPANT:
        return JsonResponse({"error": "forbidden"}, status=403)

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "no_team"}, status=404)

    team = membership.team
    ensure_default_phase_roster_for_team(team)
    current_phase = ProgramPhase.objects.filter(is_current=True).first()
    current_phase_key = current_phase.key if current_phase else None
    current_event = get_current_sub_event()

    team_phase_keys = set(
        PhaseRoster.objects.filter(team=team).values_list("phase__key", flat=True)
    )
    phases_with_roster = set(
        PhaseRoster.objects.values_list("phase__key", flat=True).distinct()
    )

    stations = Station.objects.select_related("sub_event__phase").filter(active=True).order_by(
        "sub_event__phase__order", "sub_event__order", "order", "id"
    )

    accessible_forms = []
    for station in stations:
        if not _has_submission_config(station.submission_config):
            continue

        phase_key = station.sub_event.phase.key
        if phase_key in phases_with_roster:
            if phase_key not in team_phase_keys:
                continue
        elif current_phase_key and phase_key != current_phase_key:
            continue
        if current_event and station.sub_event_id != current_event.id:
            continue

        accessible_forms.append(_station_form_payload(station, team=team))

    return JsonResponse({
        "team_code": team.code,
        "current_phase": current_phase_key,
        "current_sub_event_id": current_event.id if current_event else None,
        "accessible_forms": accessible_forms,
    })


@csrf_exempt
def my_team_form_submit_view(request: HttpRequest, station_id: int):
    """POST a participant station form submission for the current team."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.role != Account.ROLE_PARTICIPANT:
        return JsonResponse({"error": "forbidden"}, status=403)

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "no_team"}, status=404)

    team = membership.team
    if team.approval_status != Team.APPROVAL_APPROVED:
        return JsonResponse({"error": "team_not_approved"}, status=403)

    station = Station.objects.select_related("sub_event__phase").filter(
        id=station_id,
        active=True,
    ).first()
    if not station or not _has_submission_config(station.submission_config):
        return JsonResponse({"error": "form_not_found"}, status=404)

    current_phase = ProgramPhase.objects.filter(is_current=True).first()
    current_phase_key = current_phase.key if current_phase else None
    current_event = get_current_sub_event()
    phase_key = station.sub_event.phase.key

    team_phase_keys = set(
        PhaseRoster.objects.filter(team=team).values_list("phase__key", flat=True)
    )
    phases_with_roster = set(
        PhaseRoster.objects.values_list("phase__key", flat=True).distinct()
    )
    if phase_key in phases_with_roster:
        if phase_key not in team_phase_keys:
            return JsonResponse({"error": "team_not_in_phase"}, status=403)
    elif current_phase_key and phase_key != current_phase_key:
        return JsonResponse({"error": "team_not_in_phase"}, status=403)
    if current_event and station.sub_event_id != current_event.id:
        return JsonResponse({"error": "event_not_found"}, status=404)

    closure = _form_closure_state(station)
    if closure["closed"]:
        return JsonResponse({
            "error": "form_closed",
            "reason": closure["reason"],
        }, status=409)

    uploaded_files = []
    if (request.content_type or "").startswith("multipart/"):
        try:
            response_payload = json.loads(request.POST.get("response_payload") or "{}")
        except (TypeError, ValueError):
            return JsonResponse({"error": "invalid_json"}, status=400)
        if not isinstance(response_payload, dict):
            return JsonResponse({"error": "invalid_json"}, status=400)
        uploaded_files = request.FILES.getlist("files")
        attachment_payload = {}
    else:
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        response_payload = data.get("response_payload") or data.get("answers") or {}
        attachment_payload = data.get("attachment_payload") or data.get("attachments") or {}

    config = station.submission_config or {}
    if uploaded_files:
        attachment_config = config.get("attachment") or {}
        if not attachment_config.get("enabled"):
            return JsonResponse({"error": "attachment_not_allowed"}, status=400)
        try:
            stored_files = save_submission_files(
                station, team, uploaded_files, attachment_config,
            )
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        attachment_payload = {"files": stored_files}

    session = StationSession.objects.filter(
        team=team,
        station=station,
    ).order_by("-entered_at").first()

    submission = StationSubmission.objects.filter(
        team=team,
        station=station,
    ).order_by("-created_at").first()
    if not submission:
        submission = StationSubmission(team=team, station=station)

    quiz_result = _grade_quiz(config, response_payload)
    if isinstance(response_payload, dict):
        # quiz_result is server-computed only; never trust a client-sent one
        response_payload.pop("quiz_result", None)
        if quiz_result is not None:
            response_payload["quiz_result"] = quiz_result

    submission.station_session = session
    submission.status = StationSubmission.STATUS_SUBMITTED
    submission.response_payload = response_payload
    submission.attachment_payload = attachment_payload
    submission.is_correct = quiz_result["all_correct"] if quiz_result else None
    submission.submitted_at = timezone.now()
    submission.save()

    if quiz_result is not None and (config.get("quiz") or {}).get("autoScore"):
        # Optional per-form setting: push the quiz points straight to the
        # team's phase score. Ignore lock errors — the submission itself stands.
        set_submission_score(
            submission, acc, quiz_result["points"],
            note=f"Quiz tram {station.code}",
        )

    return JsonResponse({
        "id": submission.id,
        "status": submission.status,
        "submitted_at": submission.submitted_at.isoformat(),
    }, status=201)


def my_experience_view(request: HttpRequest):
    """GET participant-facing current phase/event context."""
    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.role != Account.ROLE_PARTICIPANT:
        return JsonResponse({"error": "forbidden"}, status=403)

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team").first()
    team = membership.team if membership else None
    if team:
        ensure_default_phase_roster_for_team(team)

    current_phase = ProgramPhase.objects.filter(is_current=True).first()
    current_event = get_current_sub_event()
    current_phase_key = current_phase.key if current_phase else None

    in_current_phase = False
    if team and current_phase:
        if PhaseRoster.objects.filter(phase=current_phase).exists():
            in_current_phase = PhaseRoster.objects.filter(phase=current_phase, team=team).exists()
        else:
            in_current_phase = current_phase.key == "registration"

    open_forms = []
    if team and current_event and current_phase and current_event.phase_id == current_phase.id and in_current_phase:
        stations = Station.objects.select_related("sub_event__phase").filter(
            sub_event=current_event,
            active=True,
            checkin_policy=Station.POLICY_FREE_PLAY,
        ).order_by("order", "id")
        for station in stations:
            if _has_submission_config(station.submission_config):
                open_forms.append(_station_form_payload(station, team=team))

    return JsonResponse({
        "current_phase": current_phase_key,
        "current_phase_label": current_phase.label if current_phase else None,
        "current_sub_event": {
            "id": current_event.id,
            "name": current_event.name,
            "type": current_event.type,
            "note": current_event.note,
            "uses_stations": current_event.uses_stations,
            "phase_key": current_event.phase.key,
        } if current_event else None,
        "team_in_current_phase": in_current_phase,
        "registration_open": current_phase_key == "registration",
        "open_forms": open_forms,
    })
