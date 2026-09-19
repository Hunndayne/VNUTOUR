"""Answer snapshots and participant release policy for station attempts."""
from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import Station, StationSession, TeamFormSession
from api.services.submission_config_service import (
    normalize_config, submission_items, _served_items, item_points,
)


def build_review(config, response, item_ids=None, effective_items=None):
    answers = {
        str(a.get("id")): a.get("selectedOption")
        for a in response.get("quiz", []) if isinstance(a, dict)
    }
    answers.update({str(a.get("id")): a.get("value")
                    for a in response.get("form", []) if isinstance(a, dict)})
    result = []
    for item in _served_items(submission_items(config, effective_quiz_items=effective_items), item_ids):
        if item["type"] not in ("quiz", "text"):
            continue
        selected = answers.get(str(item["id"]))
        correct = None
        if item["type"] == "quiz":
            options = item.get("options", [])
            answer_index = item.get("correctOption")
            valid_key = type(answer_index) is int and 0 <= answer_index < len(options)
            expected = options[answer_index] if valid_key else None
            actual = options[selected] if type(selected) is int and 0 <= selected < len(options) else None
            if valid_key:
                correct = type(selected) is int and selected == answer_index
        else:
            expected = [value for value in (item.get("correctText") or []) if str(value).strip()]
            actual = selected
            if expected:
                correct = str(selected or "").strip().casefold() in [str(v).strip().casefold() for v in expected]
        result.append({
            "id": item["id"], "type": item["type"],
            "question": item.get("question") or item.get("label") or "",
            "selected_answer": actual, "correct_answer": expected,
            "is_correct": correct, "points": item_points(item),
            "explanation": item.get("explanation", ""),
        })
    return result


def review_deadline(station, team, session):
    """Legacy attempt edit deadline, independent of answer publication."""
    limits = normalize_config(station.submission_config)["limits"]
    deadlines = []
    fixed = parse_datetime(limits.get("closesAt") or "")
    if fixed:
        deadlines.append(timezone.make_aware(fixed) if timezone.is_naive(fixed) else fixed)
    seconds = limits.get("durationSeconds", 0)
    if seconds:
        started = session.entered_at if session else None
        if not started:
            form = TeamFormSession.objects.filter(station=station, team=team).order_by("-started_at").first()
            started = form.started_at if form else None
        if started:
            deadlines.append(started + timedelta(seconds=seconds))
    return min(deadlines).isoformat() if deadlines else None


def attempt_is_finished(submission):
    """Preserve attempt edit limits even while answers wait for the event end."""
    if participant_review(submission)["available"]:
        return True
    payload = submission.response_payload or {}
    session = submission.station_session
    deadline_raw = payload.get("review_available_at")
    if "review_available_at" not in payload:
        deadline_raw = review_deadline(submission.station, submission.team, session)
    deadline = parse_datetime(deadline_raw) if deadline_raw else None
    # Account for the same 15-second auto-submit grace period as the submit API.
    return timezone.now() >= deadline + timedelta(seconds=15) if deadline else (
        (session is not None and session.status == StationSession.STATUS_CLOSED)
        or submission.station.checkin_policy == Station.POLICY_FREE_PLAY
        or not normalize_config(submission.station.submission_config)["flow"]["checkoutAfterSubmit"]
    )


def participant_review(submission):
    """Release answers only at the event's current configured end time.

    No end time means no release. Old per-attempt review timestamps and event
    selection changes must never reveal answers before this event ends.
    """
    payload = submission.response_payload or {}
    deadline = submission.station.sub_event.end_date
    if deadline and timezone.is_naive(deadline):
        deadline = timezone.make_aware(deadline)
    released = bool(deadline and timezone.now() >= deadline)
    return {
        "available": released,
        "available_at": deadline.isoformat() if deadline else None,
        "items": payload.get("answer_review", []) if released else [],
    }
