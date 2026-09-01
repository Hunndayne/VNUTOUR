"""
Participant self-service views — §9.2
"""

import json
from pathlib import Path

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from api.models import (
    Account, CaptainVote, Participant, Team, TeamFormDraft, TeamFormSession, TeamMembership,
    PhaseRoster, ProgramPhase, Station, SubEvent, StationSession, StationSubmission,
    MssvLinkAudit,
)
from api.services.registration_service import (
    get_schema, validate_account_mssv_claim, validate_person_submission,
)
from api.services.program_service import get_current_sub_event, get_current_phase
from api.services.checkin_qr_service import team_qr_visible

from api.services.station_service import set_submission_score, replay_lock_reason
from api.services.submission_storage_service import (
    save_submission_files, save_payment_proof, proof_file_response,
)
from api.services.payment_service import build_payment_info
from api.services.timo_service import confirm_team_payment_via_timo, is_timo_configured
from api.services.submission_config_service import (
    normalize_config as normalize_submission_config,
    public_config as public_submission_config,
    has_items as has_submission_items,
    has_form as submission_has_form,
    references_bank as submission_references_bank,
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


def _registration_mismatch_response(account: Account, mssv: str) -> JsonResponse:
    """A (Google-verified) account tried to claim an MSSV whose team-form email
    differs from the account email.

    We deliberately do not let it take over the captain-entered row — that would
    reopen MSSV impersonation. Instead we tell the member which team holds the
    MSSV and how to get it corrected, and record a MssvLinkAudit BLOCKED row so
    the organisers have a worklist. Once the captain/BTC fixes the team-form
    email to match, the next Google sign-in auto-links with no manual step.
    """
    participant = Participant.objects.filter(mssv=mssv).first()
    team = get_team_for_participant(mssv)
    already = MssvLinkAudit.objects.filter(
        mssv=mssv, account=account, action=MssvLinkAudit.ACTION_BLOCKED,
    ).exists()
    if not already:
        MssvLinkAudit.objects.create(
            mssv=mssv,
            participant=participant,
            account=account,
            action=MssvLinkAudit.ACTION_BLOCKED,
            old_email=participant.email if participant else None,
            new_email=account.email,
        )
    return JsonResponse(
        {
            "error": "registration_mismatch",
            "detail": {
                "mssv": mssv,
                "team_code": team.code if team else None,
            },
        },
        status=409,
    )


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


def _placeholder_team_name(mssv: str) -> str:
    """Stand-in name until the captain names the team on the dashboard.

    Same shape `register_team` already uses, so a team created either way reads
    the same in the admin list.
    """
    return f"Pending team {mssv}"


def _team_name_is_placeholder(team) -> bool:
    """Whether the team still carries a stand-in name.

    A team starts as `Pending team <mssv>`, and a merged team is reset to its
    own code until the post-merge ballot picks a captain. The dashboard gates
    the payment step on the team being named for real, so it needs to tell the
    stand-ins apart from a captain-chosen name.
    """
    name = (team.name or "").strip()
    return not name or name == team.code or name.startswith("Pending team ")


def _roster_locked_response():
    """The captain confirmed this roster for payment — it no longer changes.

    The transfer amount is fee x member count, so any roster or name change
    after the confirm dialog would leave the paid sum and the expected sum
    disagreeing. Rejection (or a merge) is what unlocks it again.
    """
    return JsonResponse({"error": "roster_locked"}, status=409)


def _submission_limits(config: dict | None) -> dict:
    limits = normalize_submission_config(config)["limits"]
    return {
        "max_submissions": limits["maxSubmissions"],
        "close_on_correct": limits["closeOnCorrect"],
        "manual_closed": limits["manualClosed"],
        "opens_at": limits.get("opensAt", ""),
        "closes_at": limits.get("closesAt", ""),
        "duration_minutes": limits.get("durationMinutes", 0),
    }


def _form_closure_state(station: Station, team: Team | None = None) -> dict:
    """Whether the station form stopped accepting submissions, and why."""
    limits = _submission_limits(station.submission_config)
    submitted = StationSubmission.objects.filter(
        station=station,
        status__in=[StationSubmission.STATUS_SUBMITTED, StationSubmission.STATUS_GRADED],
    )
    submitted_count = submitted.count()

    reason = None
    dynamic_closes_at = None
    session_started_at = None

    if limits["manual_closed"]:
        reason = "manual"
    elif limits["max_submissions"] and submitted_count >= limits["max_submissions"]:
        reason = "limit_reached"
    elif limits["close_on_correct"] and submitted.filter(is_correct=True).exists():
        reason = "correct_answer"
    else:
        from django.utils.dateparse import parse_datetime
        import datetime
        now = timezone.now()
        
        if limits.get("opens_at"):
            opens_at = parse_datetime(limits["opens_at"])
            if opens_at:
                if timezone.is_naive(opens_at):
                    opens_at = timezone.make_aware(opens_at)
                if now < opens_at:
                    reason = "not_opened"

        if limits.get("closes_at") and not reason:
            closes_at = parse_datetime(limits["closes_at"])
            if closes_at:
                if timezone.is_naive(closes_at):
                    closes_at = timezone.make_aware(closes_at)
                dynamic_closes_at = closes_at
                # 15s grace period for auto-submission
                if now >= closes_at + datetime.timedelta(seconds=15):
                    reason = "time_closed"

        if limits.get("duration_minutes") and team and not reason:
            session = TeamFormSession.objects.filter(
                team=team, station=station
            ).order_by("-started_at").first()
            if session:
                session_started_at = session.started_at
                session_closes_at = session.started_at + datetime.timedelta(minutes=limits["duration_minutes"])
                if dynamic_closes_at is None or session_closes_at < dynamic_closes_at:
                    dynamic_closes_at = session_closes_at
                # 15s grace period for auto-submission due to network latency
                if now >= session_closes_at + datetime.timedelta(seconds=15):
                    reason = "time_closed"
            else:
                reason = "not_started"

    return {
        "closed": reason is not None,
        "reason": reason,
        "submitted_count": submitted_count,
        "max_submissions": limits["max_submissions"] or None,
        "closes_at": dynamic_closes_at.isoformat() if dynamic_closes_at else None,
        "started_at": session_started_at.isoformat() if session_started_at else None,
        "duration_minutes": limits.get("duration_minutes", 0),
    }


def _is_survey_station(station: Station) -> bool:
    """A survey is answered per person, never synced — everything else is per team."""
    return station.sub_event.type == SubEvent.TYPE_SURVEY


def _station_has_form(station: Station, bank_counts: dict | None = None) -> bool:
    """Whether a station has a form worth showing, shared-bank questions included.

    `has_submission_items` only counts inline items, so a station that draws its
    whole quiz from the shared bank (via `useAll`/`itemIds`) would look empty and
    the participant would see "already completed" instead of the quiz. Pass a
    shared `bank_counts` dict when looping over many stations so the per-sub-event
    bank count is queried at most once.
    """
    config = station.submission_config
    if has_submission_items(config):
        return True
    if not submission_references_bank(config):
        return False
    if bank_counts is None:
        bank_counts = {}
    sub_event_id = station.sub_event_id
    if sub_event_id not in bank_counts:
        from api.models import QuestionBankItem
        bank_counts[sub_event_id] = QuestionBankItem.objects.filter(
            sub_event_id=sub_event_id, active=True,
        ).count()
    return submission_has_form(config, bank_counts[sub_event_id])


def _station_form_payload(station: Station, team: Team | None = None) -> dict:
    from api.services.question_bank_service import effective_quiz_items
    phase = station.sub_event.phase
    event = station.sub_event
    # Drawing here (rather than only on submit) is what pins the question set:
    # whichever member opens the form first fixes it for the whole team.
    drawn_items = variant_item_ids(station, team)
    effective_items = effective_quiz_items(station)
    payload = {
        "station_id": station.id,
        "station_code": station.code,
        "station_name": station.name,
        "station_location": station.location,
        "event_id": event.id,
        "event_name": event.name,
        "phase_key": phase.key,
        "phase_label": phase.label,
        "submission_config": public_submission_config(station.submission_config, drawn_items, effective_quiz_items=effective_items),
        "closure": _form_closure_state(station, team),
        "is_survey": _is_survey_station(station),
    }
    if team is not None:
        session = StationSession.objects.filter(
            team=team, station=station,
        ).order_by("-entered_at").first()
        qs = StationSubmission.objects.filter(team=team, station=station)
        if session:
            qs = qs.filter(station_session=session)
        mine = qs.order_by("-created_at").first()
        payload["my_submission"] = {
            "status": mine.status,
            "submitted_at": mine.submitted_at.isoformat() if mine.submitted_at else None,
        } if mine else None
    return payload


def _team_form_station_or_none(team: Team, station_id: int) -> Station | None:
    """A station is a valid draft target only where `/my-team/forms` would list it.

    Reuses the same has-a-form / phase-roster / current-event gate as that
    endpoint, collapsed to a single station and a single bool so the draft
    routes can 404 uniformly instead of re-deriving the access rules.
    """
    station = Station.objects.select_related("sub_event__phase").filter(
        id=station_id, active=True,
    ).first()
    if not station or not _station_has_form(station):
        return None

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
            return None
    elif current_phase_key and phase_key != current_phase_key:
        return None
    if current_event and station.sub_event_id != current_event.id:
        return None

    return station


def _draft_editor_name(account: Account | None) -> str | None:
    if not account:
        return None
    return account.full_name or account.username


def _registration_phase_open() -> bool:
    return registration_is_open()


def _team_edits_allowed(team: Team | None) -> bool:
    """Editing a team belongs to registration, with two deliberate exceptions.

    Rejecting a team *is* an admin asking for changes, so that request has to
    stay actionable after registration closes — otherwise the note ("thiếu ảnh
    chuyển khoản") arrives with no way to act on it, and the captain has to find
    an organiser in person. Creating a brand new team stays registration-only.

    Approved teams that haven't locked their roster yet (merged teams after
    captain election) must also be editable so the captain can name the team
    and lock the roster.
    """
    if _registration_phase_open():
        return True
    if team is None:
        return False
    if team.approval_status == Team.APPROVAL_REJECTED:
        return True
    # Merged teams: approved but roster not yet locked → allow naming + lock.
    if team.approval_status == Team.APPROVAL_APPROVED and not team.roster_locked_at and _team_name_is_placeholder(team):
        return True
    return False


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
        if claim_error == "registration_mismatch":
            return _registration_mismatch_response(acc, mssv)
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
        _mc = len(get_team_members(team))
        _max = int(get_schema().get("team_size_max") or get_schema().get("team_size") or 5)
        return JsonResponse({
            "team": {
                "code": team.code,
                "name": team.name,
                # The dashboard's team step needs to distinguish a captain's
                # name from the creation/merge stand-ins.
                "name_is_placeholder": _team_name_is_placeholder(team),
                "roster_locked": bool(team.roster_locked_at),
                "approval_status": team.approval_status,
                "approval_note": team.approval_note,
                "submitted_at": team.submitted_at.isoformat() if team.submitted_at else None,
                "payment_proof": team.payment_proof,
                # File-only: the legacy pasted link no longer unlocks the
                # submit step, so the flag the FE gates on must agree with the
                # submit gate in `my_team_submit_view`.
                "has_payment_proof": bool(team.payment_proof_file),
                "is_late_registration": team.is_late_registration,
                "member_count": _mc,
                "max_members": _max,
                "roster_size_final": _mc == 1 or _mc == _max,
                "can_name": _mc == _max,
            },
            "members": get_team_members(team, visibility="self", requester=acc),
            "editable": team_is_editable(team),
            "naming_allowed": (
                team.approval_status == Team.APPROVAL_APPROVED
                and not team.roster_locked_at
                and _team_name_is_placeholder(team)
            ),
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

        # Creation stays unnamed: the dashboard flow enters members first and
        # names the team on its team step, via the PATCH below.
        if name:
            return JsonResponse(
                {"error": "team_created_unnamed"},
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
            # Approved teams that haven't locked their roster yet may still
            # rename and lock (merged teams need this after captain election).
            if team.approval_status != Team.APPROVAL_APPROVED or team.roster_locked_at:
                return JsonResponse({"error": "team_locked"}, status=409)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        new_name = str((data.get("team_name") or data.get("name") or "").strip())
        lock_roster = data.get("roster_locked") is True

        if not new_name and not lock_roster and "payment_proof" not in data:
            return JsonResponse({"error": "missing_team_name"}, status=400)

        # Naming is captain-only and happens on the dashboard's team step,
        # regardless of roster size — the team step sits between members and
        # payment. A merge still resets the name to the surviving team's code,
        # so an early name never survives into a merged team by accident.
        # The confirm dialog sends the final name together with the lock; once
        # locked, a *changing* name is refused while resending the unchanged
        # name stays fine.
        schema = get_schema()
        members = get_team_members(team)
        max_size = int(schema.get("team_size_max") or schema.get("team_size") or 5)

        if new_name and team.roster_locked_at and new_name != team.name:
            return _roster_locked_response()
        # Manual naming is reserved for a full team; an individual (1) keeps the
        # server placeholder, and a partial team (2..max-1) cannot name at all.
        if new_name and new_name != team.name and len(members) != max_size:
            return JsonResponse(
                {"error": f"team_name_requires_full_team:{max_size}"},
                status=409,
            )
        if new_name:
            team.name = new_name

        if lock_roster and not team.roster_locked_at:
            # A locked roster must be submittable as-is, or the captain is
            # stuck with a team they can neither edit nor send — so the lock
            # only lands after the same checks the submit gate runs.
            if not (len(members) == 1 or len(members) == max_size):
                return JsonResponse(
                    {"error": f"team_size_not_final:{max_size}"},
                    status=409,
                )
            for index, member in enumerate(members, start=1):
                payload = {**member, **(member.get("extra") or {})}
                _, _, schema_error = validate_person_submission(
                    payload, "captain" if member.get("is_captain") else f"member_{index}",
                )
                if schema_error:
                    return JsonResponse({"error": schema_error}, status=400)
            team.roster_locked_at = timezone.now()

        if "payment_proof" in data:
            team.payment_proof = str((data.get("payment_proof") or "").strip()) or None
        team.save(update_fields=["name", "payment_proof", "roster_locked_at", "updated_at"])
        return JsonResponse({
            "code": team.code,
            "name": team.name,
            "approval_status": team.approval_status,
            "payment_proof": team.payment_proof,
            "roster_locked": bool(team.roster_locked_at),
        })

    return JsonResponse({"error": "method_not_allowed"}, status=405)


def my_team_payment_view(request: HttpRequest):
    """GET: VietQR payment info (bank details + QR) for the caller's team."""
    if request.method != "GET":
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
    payload = build_payment_info(team)
    payload["roster_locked"] = bool(team.roster_locked_at)
    payload["payment_confirmed"] = bool(team.payment_confirmed_at)
    payload["timo_configured"] = is_timo_configured()
    return JsonResponse(payload)


@csrf_exempt
def my_team_payment_confirm_auto_view(request: HttpRequest):
    """POST: captain clicks "Đã chuyển tiền" — poll BTC's Timo pot ONCE and
    try to match this team's payment_code + amount. No cron/background
    polling: every call here is one explicit poll triggered by the button."""
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
    if not team.roster_locked_at:
        return JsonResponse({"error": "roster_not_locked"}, status=409)

    result = confirm_team_payment_via_timo(team)
    return JsonResponse({
        "status": result.status,
        "message": result.message,
        "payment_confirmed": bool(team.payment_confirmed_at),
    })


@csrf_exempt
def my_team_payment_cancel_view(request: HttpRequest):
    """POST: captain cancels payment — unlocks the roster so members can be
    added/removed again. Refused once payment is confirmed (final)."""
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
    if team.payment_confirmed_at:
        return JsonResponse({"error": "payment_already_confirmed"}, status=409)
    if not team.roster_locked_at:
        return JsonResponse({"status": "ok", "roster_locked": False})

    team.roster_locked_at = None
    team.save(update_fields=["roster_locked_at", "updated_at"])
    return JsonResponse({"status": "ok", "roster_locked": False})


PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024
PAYMENT_PROOF_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


@csrf_exempt
def my_team_payment_proof_view(request: HttpRequest):
    """POST: upload the team's payment proof image. GET: fetch it back."""
    if request.method not in ("POST", "GET"):
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

    if request.method == "GET":
        if not team.payment_proof_file:
            return JsonResponse({"error": "not_found"}, status=404)
        resp = proof_file_response(team.payment_proof_file)
        return resp if resp else JsonResponse({"error": "not_found"}, status=404)

    # POST — re-upload is allowed right up until the team is approved, same as
    # every other team-editing endpoint in this file.
    if not team_is_editable(team):
        return JsonResponse({"error": "team_locked"}, status=409)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "missing_file"}, status=400)

    content_type = (getattr(uploaded, "content_type", "") or "").lower()
    extension = Path(uploaded.name).suffix.lower().lstrip(".")
    if not (content_type.startswith("image/") or extension in PAYMENT_PROOF_ALLOWED_EXTENSIONS):
        return JsonResponse({"error": "file_type_not_allowed"}, status=400)
    if uploaded.size > PAYMENT_PROOF_MAX_BYTES:
        return JsonResponse({"error": "file_too_large"}, status=400)

    entry = save_payment_proof(team, uploaded)
    team.payment_proof_file = entry
    team.save(update_fields=["payment_proof_file", "updated_at"])
    return JsonResponse({
        "has_proof": True,
        "name": entry.get("name"),
        "size": entry.get("size"),
    })


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
    max_size = int(schema.get("team_size_max") or schema.get("team_size") or 5)
    # Registration is final only for a solo entry (1) or a full team (max);
    # a partial team (2..max-1) must recruit to full or stay individual.
    if not (len(members) == 1 or len(members) == max_size):
        return JsonResponse(
            {"error": f"team_size_not_final:{max_size}"},
            status=409,
        )

    # The uploaded transfer receipt is mandatory for every submission: the
    # captain must upload the proof image at the payment step first. The legacy
    # pasted-link `payment_proof` no longer satisfies the gate, and the schema's
    # enabled/required flags no longer opt out of it.
    if not team.payment_proof_file:
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
    if team.roster_locked_at:
        return _roster_locked_response()

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
    """PATCH/DELETE a member of own team.

    PATCH: the caller may edit their own row (mssv matches their account),
    or, if captain, any row in the team. DELETE stays captain-only — removing
    a teammate is a roster-management action, not a self-edit.
    """
    acc, err = _auth_or_401(request)
    if err:
        return err
    membership = TeamMembership.objects.filter(
        participant__mssv=acc.mssv,
    ).select_related("team").first()
    if not membership:
        return JsonResponse({"error": "not_team_owner"}, status=403)
    if not _team_edits_allowed(membership.team):
        return _registration_closed_response()

    team = membership.team
    is_captain = membership.is_captain
    target_mssv = (mssv or "").strip()

    if request.method == "DELETE" and not is_captain:
        return JsonResponse({"error": "not_team_owner"}, status=403)
    if request.method == "PATCH" and not is_captain and target_mssv != acc.mssv:
        return JsonResponse({"error": "not_team_owner"}, status=403)

    if not team_is_editable(team):
        return JsonResponse({"error": "team_locked"}, status=409)
    # Roster lock (payment step) blocks add/remove but not editing member
    # details — the roster shape must stay put, but typos should still be
    # fixable while waiting for payment confirmation.
    if team.roster_locked_at and request.method == "DELETE":
        return _roster_locked_response()

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

        # mssv + email are locked reference fields: they can never change on an
        # edit, so we take them from the existing record and ignore whatever the
        # client sent. This also lets a PATCH omit them entirely (the form keeps
        # them read-only), which validation would otherwise reject as missing.
        locked_email = (
            target_membership.participant.email if target_membership else None
        ) or data.get("email")
        columns, extra, schema_error = _prepare_member_submission(
            {**data, "mssv": mssv, "email": locked_email}, "member"
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
        "team_code": team.code,
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

    # Four grouped queries rather than one (or more) per station.
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
    # The journey needs every non-cancelled play of every station, not just the
    # latest one (`my_sessions` above) — visit counts and the best-of-N score
    # both have to look across every attempt. Cancelled plays are dropped, same
    # as `visit_count`'s definition: a coop who voids a session didn't "count"
    # a visit.
    journey_sessions: dict[int, list[dict]] = {}
    for row in StationSession.objects.filter(
        team=team, station_id__in=station_ids,
    ).exclude(status=StationSession.STATUS_CANCELLED).values("station_id", "status", "score", "outcome"):
        journey_sessions.setdefault(row["station_id"], []).append(row)

    replay_enabled = bool(current_event.replay_after_all)
    total_stations = len(stations)
    visited_count = 0
    passed_count = 0
    all_visited = all(journey_sessions.get(station.id) or my_submissions.get(station.id) for station in stations)

    station_payloads = []
    bank_counts: dict = {}
    for station in stations:
        session = my_sessions.get(station.id)
        submission = my_submissions.get(station.id)
        rows = journey_sessions.get(station.id, [])

        visit_count = len(rows)
        has_active = any(r["status"] == StationSession.STATUS_ACTIVE for r in rows)
        has_closed = any(r["status"] == StationSession.STATUS_CLOSED for r in rows)
        has_passed = any(r["outcome"] == StationSession.OUTCOME_PASSED for r in rows)

        if submission and not rows:
            visit_count = 1
            has_closed = True
            
            sub_score = submission.score if submission.score is not None else 0
            if station.scoring_mode == Station.SCORING_THRESHOLD:
                has_passed = sub_score >= station.pass_threshold
            elif station.scoring_mode == Station.SCORING_SCORE_ONLY:
                has_passed = submission.status == StationSubmission.STATUS_GRADED or sub_score > 0
            elif station.scoring_mode == Station.SCORING_PASS_FAIL:
                has_passed = sub_score == station.pass_points and sub_score > 0
            
            if station.scoring_mode == Station.SCORING_PASS_FAIL:
                best_score = station.pass_points if has_passed else 0
            elif station.scoring_mode == Station.SCORING_THRESHOLD:
                best_score = sub_score if has_passed else 0
            else:
                best_score = sub_score
        else:
            if station.scoring_mode == Station.SCORING_PASS_FAIL:
                best_score = station.pass_points if has_passed else 0
            elif station.scoring_mode == Station.SCORING_THRESHOLD:
                passed_scores = [r["score"] for r in rows if r["outcome"] == StationSession.OUTCOME_PASSED]
                best_score = max(passed_scores) if passed_scores else 0
            else:  # score_only
                scores = [r["score"] for r in rows]
                best_score = max(scores) if scores else 0

        if visit_count:
            visited_count += 1
        if has_passed:
            passed_count += 1

        if has_active:
            journey_status = "active"
        elif has_passed:
            journey_status = "passed"
        elif has_closed:
            journey_status = "failed"
        else:
            journey_status = "not_visited"

        station_payload = {
            "station_id": station.id,
            "station_code": station.code,
            "station_name": station.name,
            "station_location": station.location,
            # Tells the app whether to show a QR for a collab to scan, or to let
            # the team open the station on its own.
            "checkin_policy": station.checkin_policy,
            "has_form": _station_has_form(station, bank_counts),
            "submission_brief": station.submission_config.get("brief", "") if isinstance(station.submission_config, dict) else "",
            "limits": station.submission_config.get("limits", {}) if isinstance(station.submission_config, dict) else {},
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
            "visit_count": visit_count,
            "best_score": best_score,
            "status": journey_status,
            "scoring_mode": station.scoring_mode,
        }
        if replay_enabled:
            reason = replay_lock_reason(
                has_prior_closed=has_closed, all_visited=all_visited, has_passed=has_passed,
            )
            station_payload["replay_locked"] = reason is not None
            station_payload["replay_reason"] = reason
        station_payloads.append(station_payload)

    payload["stations"] = station_payloads
    payload["visited_count"] = visited_count
    payload["total_stations"] = total_stations
    payload["passed_count"] = passed_count
    payload["all_visited"] = all_visited
    payload["replay_enabled"] = replay_enabled
    payload["server_now"] = timezone.now().isoformat()

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
    bank_counts: dict = {}
    for station in stations:
        if not _station_has_form(station, bank_counts):
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
        "server_now": timezone.now().isoformat(),
    })


@csrf_exempt
def my_team_form_start_view(request: HttpRequest, station_id: int):
    """POST to explicitly start the form session, locking in the start time."""
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

    station = _team_form_station_or_none(team, station_id)
    if not station:
        return JsonResponse({"error": "form_not_found"}, status=404)

    closure = _form_closure_state(station, team)
    if closure["closed"] and closure.get("reason") != "not_started":
        return JsonResponse({"error": "form_closed"}, status=403)

    session, created = TeamFormSession.objects.get_or_create(
        team=team, station=station,
        defaults={"started_by": acc},
    )

    return JsonResponse({
        "status": "started",
        "started_at": session.started_at.isoformat(),
        "server_now": timezone.now().isoformat(),
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
    if not station or not _station_has_form(station):
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

    closure = _form_closure_state(station, team)
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

    qs = StationSubmission.objects.filter(team=team, station=station)
    if session:
        qs = qs.filter(station_session=session)
    submission = qs.order_by("-created_at").first()
    if not submission:
        submission = StationSubmission(team=team, station=station)

    # Same draw the team was served; answers to any other question are ignored.
    from api.services.question_bank_service import effective_quiz_items
    effective_items = effective_quiz_items(station)
    quiz_result = grade_submission_quiz(
        config, 
        response_payload, 
        variant_item_ids(station, team),
        effective_quiz_items=effective_items
    )
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


@csrf_exempt
def my_team_form_draft_view(request: HttpRequest, station_id: int):
    """GET/PUT the team's shared in-progress draft for one station form.

    Only non-survey forms share a draft — a survey (`SubEvent.TYPE_SURVEY`) is
    answered per person, so there is nothing team-wide to read or write, and PUT
    refuses rather than silently syncing something that must stay private to
    whoever is filling it in. No audit trail is kept here on purpose: a draft
    is expected to change on every keystroke, unlike an actual submission.
    """
    if request.method not in ("GET", "PUT"):
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

    station = _team_form_station_or_none(team, station_id)
    if not station:
        return JsonResponse({"error": "form_not_found"}, status=404)

    is_survey = _is_survey_station(station)

    if request.method == "GET":
        if is_survey:
            return JsonResponse({"is_survey": True})

        draft = TeamFormDraft.objects.select_related("updated_by").filter(
            team=team, station=station,
        ).first()
        return JsonResponse({
            "is_survey": False,
            "response": draft.response_payload if draft else None,
            "updated_at": draft.updated_at.isoformat() if draft else None,
            "updated_by": _draft_editor_name(draft.updated_by) if draft else None,
        })

    # PUT
    if is_survey:
        return JsonResponse({"error": "survey_not_synced"}, status=409)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    response = data.get("response")
    if not isinstance(response, dict):
        return JsonResponse({"error": "invalid_json"}, status=400)

    draft, _ = TeamFormDraft.objects.update_or_create(
        team=team, station=station,
        defaults={"response_payload": response, "updated_by": acc},
    )
    return JsonResponse({
        "updated_at": draft.updated_at.isoformat(),
        "updated_by": _draft_editor_name(acc),
    })


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
        bank_counts: dict = {}
        for station in stations:
            if _station_has_form(station, bank_counts):
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
        "threshold": result.get("threshold", 0),
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


def _team_qr_enabled_for_event(team, station_id) -> bool:
    """Is this team's station QR live right now?

    True when a sub-event is running and the team is eligible for it — the same
    phase/roster gate `my_team_stations_view` uses to decide which stations the
    team may even see. A named station must additionally be active and belong to
    the running event. There is no separate BTC toggle: a running sub-event is
    the open signal.
    """
    current_event = get_current_sub_event()  # phase is select_related, no extra query
    if not current_event:
        return False

    # A named station must be a live station of the running event.
    if station_id is not None and not Station.objects.filter(
        id=station_id, sub_event=current_event, active=True,
    ).exists():
        return False

    # Eligibility: a phase that has a roster admits only the teams on it; a phase
    # without one is open to whoever is in the current phase (mirrors stations view).
    # The common qualifying case — team on this phase's roster — settles in one query.
    if PhaseRoster.objects.filter(phase=current_event.phase, team=team).exists():
        return True
    if PhaseRoster.objects.filter(phase=current_event.phase).exists():
        return False  # phase is roster-gated and this team is not on it
    current_phase = get_current_phase()
    return bool(current_phase and current_event.phase_id == current_phase.id)


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
        "station_id", "status", "entered_at", "exited_at", "id",
    ).first()
    if session:
        submissions = submissions.filter(station_session_id=session["id"])
    submission = submissions.order_by("-created_at").values(
        "station_id", "status", "submitted_at",
    ).first()

    def stamp(value):
        return value.isoformat() if value else None

    # The QR a team shows at a station now carries that station and which way
    # it is meant to be scanned, so the coop scanning it does not choose either.
    # Which way is decided here from the team's own state: standing outside the
    # station it is a check-in code, already inside it is a check-out code — so
    # the check-in and check-out QR for a station are genuinely different codes,
    # not one string the coop reinterprets.
    #
    # No global "BTC opens check-in" switch gates this any more: in the
    # per-station model the QR is live automatically as soon as a sub-event is
    # running and the team is eligible for it. Making a sub-event current *is*
    # the act of opening the round. Eligibility (approved + on the phase roster,
    # or in the current phase when that phase has no roster) still applies, and a
    # named station must be active and belong to the running event.
    qr = {"enabled": False}
    if team.approval_status == Team.APPROVAL_APPROVED:
        enabled = _team_qr_enabled_for_event(team, station_id)
        if enabled:
            if not team.qr_token:
                rotate_qr_token(team)
                team.refresh_from_db(fields=["qr_token"])
            payload = f"t:{team.qr_token}"
            direction = None
            if station_id is not None:
                inside = bool(session and session["status"] == StationSession.STATUS_ACTIVE)
                direction = "out" if inside else "in"
                payload = f"{payload}|s:{station_id}|d:{direction}"
            qr = {"enabled": True, "payload": payload, "direction": direction}

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
        "server_now": timezone.now().isoformat(),
    })


