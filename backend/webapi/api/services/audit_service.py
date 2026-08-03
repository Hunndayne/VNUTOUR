from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from api.models import (
    Account,
    AuditLog,
    EventCheckIn,
    ProgramPhase,
    ScoreEntry,
    SystemSetting,
)
from api.services.program_service import set_current_phase


def serialize_score_entry(entry: ScoreEntry) -> dict:
    return {
        "id": entry.id,
        "phase_id": entry.phase_id,
        "sub_event_id": entry.sub_event_id,
        "station_session_id": entry.station_session_id,
        "submission_id": entry.submission_id,
        "team_id": entry.team_id,
        "kind": entry.kind,
        "points": entry.points,
        "note": entry.note,
        "created_by_id": entry.created_by_id,
    }


def record_audit(
    *,
    actor: Account | None,
    action: str,
    summary: str,
    target_type: str | None = None,
    target_id: str | int | None = None,
    before_data=None,
    after_data=None,
    metadata=None,
    reversible: bool = False,
) -> AuditLog:
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        summary=summary[:500],
        before_data=before_data,
        after_data=after_data,
        metadata=metadata,
        reversible=reversible,
    )


def serialize_audit(log: AuditLog) -> dict:
    return {
        "id": log.id,
        "action": log.action,
        "summary": log.summary,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "actor": log.actor.username if log.actor else None,
        "before_data": log.before_data,
        "after_data": log.after_data,
        "metadata": log.metadata,
        "reversible": log.reversible,
        "can_undo": bool(log.reversible and not log.undone_at),
        "undone_at": log.undone_at.isoformat() if log.undone_at else None,
        "undone_by": log.undone_by.username if log.undone_by else None,
        "undo_audit_id": log.undo_audit_id,
        "created_at": log.created_at.isoformat(),
    }


def _matches(instance, expected: dict, fields: tuple[str, ...]) -> bool:
    return all(getattr(instance, field) == expected.get(field) for field in fields)


def _undo_score_create(log: AuditLog):
    expected = log.after_data or {}
    entry = ScoreEntry.objects.select_for_update().filter(id=expected.get("id")).first()
    if not entry:
        raise ValueError("undo_target_missing")
    current = serialize_score_entry(entry)
    if current != expected:
        raise ValueError("undo_conflict")
    entry.delete()


def _undo_score_update(log: AuditLog):
    before = log.before_data or {}
    after = log.after_data or {}
    entry = ScoreEntry.objects.select_for_update().filter(id=after.get("id")).first()
    if not entry:
        raise ValueError("undo_target_missing")
    if serialize_score_entry(entry) != after:
        raise ValueError("undo_conflict")
    for field in ("points", "note"):
        setattr(entry, field, before.get(field))
    entry.save(update_fields=["points", "note", "updated_at"])


def _undo_score_delete(log: AuditLog):
    before = log.before_data or {}
    entry_id = before.get("id")
    if ScoreEntry.objects.filter(id=entry_id).exists():
        raise ValueError("undo_conflict")
    try:
        ScoreEntry.objects.create(**before)
    except (IntegrityError, TypeError, ValueError) as exc:
        raise ValueError("undo_conflict") from exc


def _undo_checkin_reset(log: AuditLog):
    before = log.before_data or {}
    after = log.after_data or {}
    checkin = EventCheckIn.objects.select_for_update().filter(id=after.get("id")).first()
    if not checkin:
        raise ValueError("undo_target_missing")
    if checkin.status != after.get("status"):
        raise ValueError("undo_conflict")
    if EventCheckIn.objects.filter(
        sub_event_id=checkin.sub_event_id,
        team_id=checkin.team_id,
        status=EventCheckIn.STATUS_ACTIVE,
    ).exclude(id=checkin.id).exists():
        raise ValueError("undo_conflict")
    checkin.status = before.get("status", EventCheckIn.STATUS_ACTIVE)
    checkin.save(update_fields=["status", "updated_at"])


def _undo_phase_change(log: AuditLog):
    before = log.before_data or {}
    after = log.after_data or {}
    current = ProgramPhase.objects.filter(is_current=True).first()
    if not current or current.key != after.get("current_phase"):
        raise ValueError("undo_conflict")
    previous_key = before.get("current_phase")
    if not previous_key:
        raise ValueError("undo_not_supported")
    set_current_phase(previous_key)


def _undo_settings_update(log: AuditLog):
    before = log.before_data or {}
    after = log.after_data or {}
    for key, expected in after.items():
        current = SystemSetting.objects.filter(key=key).first()
        current_value = current.value if current else None
        if current_value != expected:
            raise ValueError("undo_conflict")
    for key, value in before.items():
        if value is None:
            SystemSetting.objects.filter(key=key).delete()
        else:
            SystemSetting.objects.update_or_create(
                key=key,
                defaults={"value": value},
            )


UNDO_HANDLERS = {
    "score.create": _undo_score_create,
    "score.update": _undo_score_update,
    "score.delete": _undo_score_delete,
    "checkin.reset": _undo_checkin_reset,
    "phase.change": _undo_phase_change,
    "settings.update": _undo_settings_update,
}


def undo_audit(log_id: int, actor: Account) -> AuditLog:
    with transaction.atomic():
        log = AuditLog.objects.select_for_update().get(id=log_id)
        if not log.reversible:
            raise ValueError("undo_not_supported")
        if log.undone_at:
            raise ValueError("already_undone")
        handler = UNDO_HANDLERS.get(log.action)
        if not handler:
            raise ValueError("undo_not_supported")
        handler(log)
        undo_log = record_audit(
            actor=actor,
            action="audit.undo",
            summary=f"Hoàn tác: {log.summary}",
            target_type="AuditLog",
            target_id=log.id,
            before_data=log.after_data,
            after_data=log.before_data,
            metadata={"source_audit_id": log.id},
            reversible=False,
        )
        log.undone_at = timezone.now()
        log.undone_by = actor
        log.undo_audit = undo_log
        log.save(update_fields=["undone_at", "undone_by", "undo_audit"])
        return log
