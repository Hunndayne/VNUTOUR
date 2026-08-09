"""
Participant self-service views — §9.2
"""

import json

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from api.models import (
    Account, CaptainVote, Participant, Team, TeamMembership, PhaseRoster,
    ProgramPhase, Station, SubEvent, StationSession, StationSubmission,
)
from api.services.registration_service import (
    get_schema, validate_account_mssv_claim, validate_person_submission,
)
from api.services.program_service import get_current_sub_event
from api.services.checkin_qr_service import team_qr_visible
from api.services.station_service import set_submission_score
from api.services.submission_storage_service import save_submission_files
from api.services.submission_config_service import (
    normalize_config as normalize_submission_config,
    public_config as public_submission_config,
    has_items as has_submission_items,
    attachment_item as submission_attachment_item,
    grade_quiz as grade_submission_quiz,
    checkout_after_submit,
)
from api.services.team_form_variant_service import variant_item_ids
from api.services import team_merge_service
from api.services.team_service import (
    create_team, add_member, update_member, remove_member, submit_team,
    get_team_members, get_team_for_participant, team_is_editable, rotate_qr_token,
    link_account_profile, ensure_default_phase_roster_for_team, registration_is_open,
    profile_is_account_owned_by_other,
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


def _team_size_max() -> int:
    schema = get_schema()
    return int(schema.get("team_size_max") or schema.get("team_size") or 5)


def _placeholder_team_name(mssv: str) -> str:
    """Stand-in name until the team is full and may be named for real.

    Same shape `register_team` already uses, so a team created either way reads
    the same in the admin list.
    """
    return f"Pending team {mssv}"


def _submission_limits(config: dict | None) -> dict:
    limits = normalize_submission_config(config)["limits"]
    return {
        "max_submissions": limits["maxSubmissions"],
        "close_on_correct": limits["closeOnCorrect"],
        "manual_closed": limits["manualClosed"],
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
    # Drawing here (rather than only on submit) is what pins the question set:
    # whichever member opens the form first fixes it for the whole team.
    drawn_items = variant_item_ids(station, team)
    payload = {
        "station_id": station.id,
        "station_code": station.code,
        "station_name": station.name,
        "station_location": station.location,
        "event_id": event.id,
        "event_name": event.name,
        "phase_key": phase.key,
        "phase_label": phase.label,
        "submission_config": public_submission_config(station.submission_config, drawn_items),
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
    return registration_is_open()


def _team_edits_allowed(team: Team | None) -> bool:
    """Editing a team belongs to registration, with one deliberate exception.

    Rejecting a team *is* an admin asking for changes, so that request has to
    stay actionable after registration closes — otherwise the note ("thiếu ảnh
    chuyển khoản") arrives with no way to act on it, and the captain has to find
    an organiser in person. Creating a brand new team stays registration-only.
    """
    if _registration_phase_open():
        return True
    return team is not None and team.approval_status == Team.APPROVAL_REJECTED


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

        # Naming is reserved for full teams. A team starts with its captain
        # alone, so there is never a point at creation where a name is allowed;
        # it carries a placeholder until the fifth member arrives.
        if name:
            return JsonResponse(
                {"error": f"team_name_requires_full_team:{_team_size_max()}"},
                status=409,
            )
        team, err = create_team(_placeholder_team_name(acc.mssv), owner_account=acc)
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
            actor=acc,
        )
        link_account_profile(acc)

        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
        }, status=201)

    if request.method == "PATCH":
        membership = TeamMembership.objects.filter(
            participant__mssv=acc.mssv, is_captain=True,
        ).select_related("team").first()
        if not membership:
            return JsonResponse({"error": "not_team_owner"}, status=403)
        if not _team_edits_allowed(membership.team):
            return _registration_closed_response()

        team = membership.team
        if not team_is_editable(team):
            return JsonResponse({"error": "team_locked"}, status=409)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        new_name = str((data.get("team_name") or data.get("name") or "").strip())
        if not new_name:
            return JsonResponse({"error": "missing_team_name"}, status=400)

        # Only a full team may be named. Resending the placeholder unchanged is
        # allowed, so an under-strength captain can still update payment_proof
        # through this same endpoint.
        max_size = _team_size_max()
        if new_name != team.name and len(get_team_members(team)) < max_size:
            return JsonResponse(
                {"error": f"team_name_requires_full_team:{max_size}"},
                status=409,
            )

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
    if not _team_edits_allowed(membership.team):
        return _registration_closed_response()

    team = membership.team
    schema = get_schema()
    members = get_team_members(team)
    # An under-strength team may submit: this is a freshers' event, so people
    # sign up before they know four others, and the organisers merge teams up to
    # full size afterwards. Only the ceiling is enforced here, matching the range
    # that public registration has always allowed in `register_team`.
    min_size = int(schema.get("team_size_min") or 1)
    max_size = int(schema.get("team_size_max") or schema.get("team_size") or 5)
    if len(members) < min_size or len(members) > max_size:
        return JsonResponse(
            {"error": f"team_size_out_of_range:{min_size}-{max_size}"},
            status=409,
        )

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
    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)
    if not _team_edits_allowed(membership.team):
        return _registration_closed_response()
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
    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv, is_captain=True,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)
    if not _team_edits_allowed(membership.team):
        return _registration_closed_response()

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
        actor=acc,
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
    if not _team_edits_allowed(membership.team):
        return _registration_closed_response()

    team = membership.team
    if not team_is_editable(team):
        return JsonResponse({"error": "team_locked"}, status=409)

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        target_membership = TeamMembership.objects.filter(
            team=team,
            participant__mssv=mssv,
        ).select_related("participant").first()
        if profile_is_account_owned_by_other(
            target_membership.participant if target_membership else None, acc
        ):
            return JsonResponse({"error": "member_profile_owned"}, status=403)

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


def my_team_stations_view(request: HttpRequest):
    """GET every active station of the running sub-event, plus this team's state at each.

    This is the map the qualifying-round app draws: a team has to see a station
    before it can walk up to it, so nothing is filtered on `checkin_policy` or on
    whether a form is configured. `/api/me/experience` deliberately lists only the
    free-play stations that *have* a form, which left `staff_scan` stations — the
    ones needing a collab to scan the team's QR — invisible to participants.
    """
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

    payload = {
        "current_phase": current_phase_key,
        "current_sub_event_id": current_event.id if current_event else None,
        "stations": [],
    }
    # Between events there is simply nothing to show. The app polls this endpoint,
    # so an empty list beats an error the client would have to special-case.
    if not current_event:
        return JsonResponse(payload)

    # Same gate as `my_team_forms_view`: a phase that has a roster admits only the
    # teams on it; a phase without one is open to whoever is in the current phase.
    # Every station here belongs to `current_event`, so the phase is decided once.
    phase_key = current_event.phase.key
    team_phase_keys = set(
        PhaseRoster.objects.filter(team=team).values_list("phase__key", flat=True)
    )
    phases_with_roster = set(
        PhaseRoster.objects.values_list("phase__key", flat=True).distinct()
    )
    if phase_key in phases_with_roster:
        if phase_key not in team_phase_keys:
            return JsonResponse(payload)
    elif current_phase_key and phase_key != current_phase_key:
        return JsonResponse(payload)

    stations = list(
        Station.objects.filter(sub_event=current_event, active=True).order_by("order", "id")
    )
    station_ids = [station.id for station in stations]

    # Three grouped queries rather than three per station.
    occupancy = {
        row["station_id"]: row["total"]
        for row in StationSession.objects.filter(
            station_id__in=station_ids,
            status=StationSession.STATUS_ACTIVE,
        ).values("station_id").annotate(total=Count("id"))
    }
    my_sessions: dict[int, StationSession] = {}
    for session in StationSession.objects.filter(
        team=team, station_id__in=station_ids,
    ).order_by("station_id", "-entered_at"):
        my_sessions.setdefault(session.station_id, session)
    my_submissions: dict[int, StationSubmission] = {}
    for submission in StationSubmission.objects.filter(
        team=team, station_id__in=station_ids,
    ).order_by("station_id", "-created_at"):
        my_submissions.setdefault(submission.station_id, submission)

    for station in stations:
        session = my_sessions.get(station.id)
        submission = my_submissions.get(station.id)
        payload["stations"].append({
            "station_id": station.id,
            "station_code": station.code,
            "station_name": station.name,
            "station_location": station.location,
            # Tells the app whether to show a QR for a collab to scan, or to let
            # the team open the station on its own.
            "checkin_policy": station.checkin_policy,
            "has_form": has_submission_items(station.submission_config),
            # Only meaningful where `has_form` — whether submitting ends the visit.
            "checkout_after_submit": checkout_after_submit(station.submission_config),
            "capacity": {
                # 0/None means unlimited.
                "max_concurrent_teams": station.max_concurrent_teams,
                "current_teams": occupancy.get(station.id, 0),
            },
            "my_session": {
                "status": session.status,
                "entered_at": session.entered_at.isoformat() if session.entered_at else None,
                "exited_at": session.exited_at.isoformat() if session.exited_at else None,
            } if session else None,
            "my_submission": {
                "status": submission.status,
                "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
            } if submission else None,
        })

    return JsonResponse(payload)


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
        if not has_submission_items(station.submission_config):
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
    if not station or not has_submission_items(station.submission_config):
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
        attachment_config = submission_attachment_item(config)
        if attachment_config is None:
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

    # Same draw the team was served; answers to any other question are ignored.
    quiz_result = grade_submission_quiz(config, response_payload, variant_item_ids(station, team))
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

    if quiz_result is not None and normalize_submission_config(config)["quiz"]["autoScore"]:
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
            if has_submission_items(station.submission_config):
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
        "registration_open": registration_is_open(),
        "open_forms": open_forms,
    })


@csrf_exempt
def my_team_captain_vote_view(request: HttpRequest):
    """GET the open captain ballot, POST {candidate_mssv} to cast or change a vote.

    The ballot is secret: the payload carries tallies and whether *you* have
    voted, never who anyone voted for.
    """
    acc, err = _auth_or_401(request)
    if err:
        return err
    if acc.role != Account.ROLE_PARTICIPANT:
        return JsonResponse({"error": "forbidden"}, status=403)

    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team", "participant").first()
    if not membership:
        return JsonResponse({"error": "no_team"}, status=404)

    team = membership.team
    me = membership.participant

    if request.method == "POST":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)
        candidate_mssv = str((data.get("candidate_mssv") or "").strip())
        candidate = Participant.objects.filter(mssv=candidate_mssv).first()
        if not candidate:
            return JsonResponse({"error": "candidate_not_found"}, status=404)

        vote_error = team_merge_service.cast_vote(team, me, candidate)
        if vote_error:
            status = 409 if vote_error == "captain_already_elected" else 400
            return JsonResponse({"error": vote_error}, status=status)
        team_merge_service.resolve_election(team)
    elif request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    result = team_merge_service.tally(team)
    members = TeamMembership.objects.filter(team=team).select_related("participant")
    captain = members.filter(is_captain=True).first()

    return JsonResponse({
        "open": captain is None and result["member_count"] > 1,
        "captain_mssv": captain.participant.mssv if captain else None,
        "i_have_voted": CaptainVote.objects.filter(team=team, voter=me).exists(),
        "votes_cast": result["votes_cast"],
        "member_count": result["member_count"],
        "candidates": [
            {
                "mssv": m.participant.mssv,
                "full_name": m.participant.full_name,
                "votes": result["counts"].get(m.participant_id, 0),
            }
            for m in members
        ],
        "can_rename_team": team_merge_service.may_rename(team, me),
    })


def my_team_station_state_view(request: HttpRequest):
    """GET the one thing the QR screen polls for: has anything changed yet?

    Deliberately narrow. The station list is the expensive call and the screen
    only needs it once; while a QR is on display the question is just whether a
    coop has scanned it, so this answers that and nothing else.

    The current QR payload rides along because a successful scan rotates it —
    fetching state and QR separately would leave a window where the screen shows
    a code the server has already retired.
    """
    if request.method != "GET":
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

    raw_station_id = request.GET.get("station_id")
    station_id = None
    if raw_station_id:
        try:
            station_id = int(raw_station_id)
        except (TypeError, ValueError):
            return JsonResponse({"error": "invalid_station_id"}, status=400)

    sessions = StationSession.objects.filter(team=team)
    submissions = StationSubmission.objects.filter(team=team)
    if station_id is not None:
        sessions = sessions.filter(station_id=station_id)
        submissions = submissions.filter(station_id=station_id)
    else:
        # No station named: report wherever they currently are, so the list
        # screen can send them straight back to the station they are inside.
        sessions = sessions.filter(status=StationSession.STATUS_ACTIVE)

    session = sessions.order_by("-entered_at").values(
        "station_id", "status", "entered_at", "exited_at",
    ).first()
    submission = submissions.order_by("-created_at").values(
        "station_id", "status", "submitted_at",
    ).first()

    def stamp(value):
        return value.isoformat() if value else None

    qr = {"enabled": False}
    if team.approval_status == Team.APPROVAL_APPROVED and team_qr_visible(team):
        if not team.qr_token:
            rotate_qr_token(team)
            team.refresh_from_db(fields=["qr_token"])
        qr = {"enabled": True, "payload": f"t:{team.qr_token}"}

    return JsonResponse({
        "team_code": team.code,
        "station_id": station_id,
        "session": {
            "station_id": session["station_id"],
            "status": session["status"],
            "entered_at": stamp(session["entered_at"]),
            "exited_at": stamp(session["exited_at"]),
        } if session else None,
        "submission": {
            "station_id": submission["station_id"],
            "status": submission["status"],
            "submitted_at": stamp(submission["submitted_at"]),
        } if submission else None,
        "qr": qr,
    })
