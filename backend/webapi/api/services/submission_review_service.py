"""Answer snapshots and participant release policy for station attempts."""
from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import Station, StationSession, SubEvent, TeamFormSession
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


def survey_review_items(items):
    """Keep question/answer snapshots for surveys without grading metadata."""
    return [{
        "id": item["id"], "type": item["type"],
        "question": item.get("question", ""),
        "selected_answer": item.get("selected_answer"),
        "correct_answer": None, "is_correct": None, "points": 0, "explanation": "",
    } for item in items]


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


def submission_answer_review(submission):
    """The per-question review of an attempt: the snapshot taken at submit time.

    Attempts submitted before snapshots existed are rebuilt from the station's
    current form, limited to the questions the team answered, so graders still
    see question text and the chosen option instead of "đáp án 2".
    """
    payload = submission.response_payload or {}
    stored = payload.get("answer_review")
    is_survey = submission.station.sub_event.type == SubEvent.TYPE_SURVEY
    # The initial individual-survey release stored [] instead of a snapshot.
    # Rebuild those responses on read, while retaining real saved snapshots.
    if stored is not None and (stored or not is_survey):
        return survey_review_items(stored) if is_survey else stored
    answered = [
        str(answer.get("id"))
        for answer in (payload.get("quiz") or []) + (payload.get("form") or [])
        if isinstance(answer, dict) and answer.get("id") is not None
    ]
    if not answered:
        return []
    from api.services.question_bank_service import effective_quiz_items
    station = submission.station
    review = build_review(station.submission_config, payload, answered, effective_quiz_items(station))
    return survey_review_items(review) if is_survey else review


def clean_item_marks(submission, marks):
    """Validate the coop's per-question verdicts against a submission.

    `marks` maps an answer_review item id to True/False, or None to drop the
    coop's verdict. Returns (stored_marks, error). Only verdicts that grade a
    manual question or overrule the machine are kept, so "matches the auto
    grade" and "never touched" read the same.
    """
    if not isinstance(marks, dict):
        return None, "invalid_marks"
    review = {str(item.get("id")): item for item in submission_answer_review(submission)}
    stored = {}
    for key, value in marks.items():
        key = str(key)
        if key not in review:
            return None, "unknown_mark_item"
        if value is not None and not isinstance(value, bool):
            return None, "invalid_marks"
        if value is not None and value != review[key].get("is_correct"):
            stored[key] = value
    return stored or None, None


def marked_review(payload, marks):
    """answer_review with the coop's verdicts applied on top of the auto-grading."""
    marks = marks or {}
    items = []
    for item in (payload or {}).get("answer_review") or []:
        entry = dict(item)
        key = str(item.get("id"))
        if key in marks:
            entry["auto_is_correct"] = item.get("is_correct")
            entry["is_correct"] = marks[key]
            entry["marked_by_coop"] = True
        items.append(entry)
    return items


def marked_quiz_result(payload, marks):
    """quiz_result recounted after the coop's verdicts; unchanged when there are none."""
    quiz = (payload or {}).get("quiz_result")
    if not marks or not quiz:
        return quiz
    items = marked_review(payload, marks)
    graded = [item for item in items if item.get("is_correct") is not None]
    correct = [item for item in graded if item["is_correct"]]
    return {
        **quiz,
        "correct_count": len(correct),
        "total": len(graded),
        "points": sum(int(item.get("points", 1) or 0) for item in correct),
        "max_points": sum(int(item.get("points", 1) or 0) for item in graded),
        "manual_count": len(items) - len(graded),
        "all_correct": bool(graded) and len(correct) == len(graded),
    }


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
        "items": marked_review(payload, submission.item_marks) if released else [],
    }
