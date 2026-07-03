from __future__ import annotations

from datetime import datetime

from django.db import IntegrityError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import Account, Station, StationAssignment


def _coerce_datetime(value):
    if value in ("", None):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        parsed = parse_datetime(value)
        if parsed:
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
            return parsed
    return value


def _is_current_assignment(assignment: StationAssignment, now: datetime) -> bool:
    if not assignment.active:
        return False
    if assignment.shift_start and assignment.shift_start > now:
        return False
    if assignment.shift_end and assignment.shift_end < now:
        return False
    return True


def list_assignments(
    *,
    phase_key: str | None = None,
    event_id: int | None = None,
    collab_id: int | None = None,
    active_only: bool = False,
) -> list[StationAssignment]:
    qs = StationAssignment.objects.select_related(
        "collab",
        "station__sub_event__phase",
    )
    if phase_key:
        qs = qs.filter(station__sub_event__phase__key=phase_key)
    if event_id:
        qs = qs.filter(station__sub_event_id=event_id)
    if collab_id:
        qs = qs.filter(collab_id=collab_id)
    if active_only:
        qs = qs.filter(active=True)
    return list(qs)


def create_assignment(
    *,
    collab_username: str,
    station_id: int,
    shift_start=None,
    shift_end=None,
    note: str | None = None,
    active: bool = True,
) -> StationAssignment:
    collab = Account.objects.filter(
        username__iexact=collab_username,
        role=Account.ROLE_COLLAB,
        is_active=True,
    ).first()
    if not collab:
        raise ValueError("collab_not_found")

    station = Station.objects.filter(id=station_id).first()
    if not station:
        raise ValueError("station_not_found")

    try:
        assignment = StationAssignment.objects.create(
            collab=collab,
            station=station,
            shift_start=_coerce_datetime(shift_start),
            shift_end=_coerce_datetime(shift_end),
            note=(note or "").strip() or None,
            active=bool(active),
        )
    except IntegrityError as exc:
        raise ValueError("duplicate_assignment") from exc
    return assignment


def delete_assignment(assignment_id: int) -> bool:
    deleted, _ = StationAssignment.objects.filter(id=assignment_id).delete()
    return bool(deleted)


def serialize_assignment(assignment: StationAssignment, *, now: datetime | None = None) -> dict:
    current_time = now or timezone.now()
    station = assignment.station
    sub_event = station.sub_event
    phase = sub_event.phase
    return {
        "id": assignment.id,
        "active": assignment.active,
        "is_current": _is_current_assignment(assignment, current_time),
        "note": assignment.note or "",
        "shift_start": assignment.shift_start.isoformat() if assignment.shift_start else None,
        "shift_end": assignment.shift_end.isoformat() if assignment.shift_end else None,
        "collab": {
            "username": assignment.collab.username,
            "full_name": assignment.collab.full_name or "",
            "email": assignment.collab.email,
        },
        "phase": {
            "key": phase.key,
            "label": phase.label,
        },
        "event": {
            "id": sub_event.id,
            "name": sub_event.name,
        },
        "station": {
            "id": station.id,
            "code": station.code,
            "name": station.name,
            "location": station.location or "",
            "active": station.active,
            "checkin_policy": station.checkin_policy,
        },
    }
