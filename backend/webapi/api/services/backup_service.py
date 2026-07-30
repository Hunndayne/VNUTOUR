from __future__ import annotations

import json
import os
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from django.core import serializers
from django.db import connection, transaction
from django.utils import timezone

from api.models import (
    Account,
    AdvancementRule,
    AuditLog,
    DiscordBroadcast,
    EmailQueueItem,
    EventCheckIn,
    MssvLinkAudit,
    Participant,
    PhaseRoster,
    ProgramPhase,
    ScoreEntry,
    Station,
    StationAssignment,
    StationSession,
    StationSubmission,
    SubEvent,
    SystemSetting,
    Team,
    TeamMembership,
)


BACKUP_VERSION = 1
BACKUP_MODELS = [
    Account,
    Participant,
    Team,
    TeamMembership,
    ProgramPhase,
    SubEvent,
    PhaseRoster,
    Station,
    StationAssignment,
    EventCheckIn,
    StationSession,
    StationSubmission,
    ScoreEntry,
    AdvancementRule,
    DiscordBroadcast,
    SystemSetting,
    MssvLinkAudit,
    EmailQueueItem,
    AuditLog,
]
ALLOWED_MODEL_LABELS = {
    model._meta.label_lower
    for model in BACKUP_MODELS
}


def _backup_root() -> Path:
    root = Path(settings.BACKUP_ROOT).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_backup_path(filename: str) -> Path:
    name = Path(str(filename or "")).name
    if not name.endswith(".zip") or name != str(filename):
        raise ValueError("invalid_backup_name")
    target = (_backup_root() / name).resolve()
    if target.parent != _backup_root():
        raise ValueError("invalid_backup_name")
    return target


def _serialized_data() -> tuple[list[dict], dict[str, int]]:
    instances = []
    counts = {}
    for model in BACKUP_MODELS:
        queryset = model.objects.all().order_by("pk")
        counts[model._meta.label_lower] = queryset.count()
        instances.extend(queryset)
    data = json.loads(serializers.serialize("json", instances))
    for item in data:
        if item["model"] == Account._meta.label_lower:
            item["fields"]["token"] = None
            item["fields"]["token_created_at"] = None
    return data, counts


def create_backup(*, prefix: str = "manual") -> dict:
    data, counts = _serialized_data()
    now = timezone.now()
    safe_prefix = "".join(
        character if character.isalnum() or character in "-_" else "-"
        for character in prefix
    ).strip("-") or "backup"
    filename = (
        f"vnutour-{safe_prefix}-"
        f"{now.astimezone(dt_timezone.utc):%Y%m%dT%H%M%SZ}-"
        f"{uuid.uuid4().hex[:8]}.zip"
    )
    target = _safe_backup_path(filename)
    manifest = {
        "format": "vnutour-backup",
        "version": BACKUP_VERSION,
        "created_at": now.isoformat(),
        "database_vendor": connection.vendor,
        "counts": counts,
        "tokens_redacted": True,
        "local_media_included": True,
        "r2_objects_included": False,
    }

    temp_path = target.with_suffix(".tmp")
    with zipfile.ZipFile(
        temp_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )
        archive.writestr(
            "data.json",
            json.dumps(data, ensure_ascii=False),
        )
        media_root = Path(settings.MEDIA_ROOT)
        if media_root.exists():
            for path in media_root.rglob("*"):
                if not path.is_file() or path.is_symlink():
                    continue
                relative = path.relative_to(media_root)
                archive.write(path, f"media/{relative.as_posix()}")
    os.replace(temp_path, target)
    return {
        "filename": filename,
        "size": target.stat().st_size,
        "created_at": manifest["created_at"],
        "counts": counts,
        "manifest": manifest,
    }


def list_backups() -> list[dict]:
    items = []
    for path in sorted(
        _backup_root().glob("*.zip"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    ):
        try:
            with zipfile.ZipFile(path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
        except Exception:
            manifest = {}
        items.append({
            "filename": path.name,
            "size": path.stat().st_size,
            "created_at": manifest.get("created_at")
            or datetime.fromtimestamp(
                path.stat().st_mtime,
                tz=dt_timezone.utc,
            ).isoformat(),
            "counts": manifest.get("counts") or {},
            "valid": manifest.get("format") == "vnutour-backup",
        })
    return items


def get_backup_path(filename: str) -> Path:
    path = _safe_backup_path(filename)
    if not path.exists():
        raise FileNotFoundError(filename)
    return path


def _read_archive(path: Path) -> tuple[dict, list[dict], list[tuple[str, bytes]]]:
    max_bytes = max(1, int(settings.BACKUP_MAX_UPLOAD_MB)) * 1024 * 1024
    if path.stat().st_size > max_bytes:
        raise ValueError("backup_too_large")
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if not {"manifest.json", "data.json"}.issubset(names):
            raise ValueError("invalid_backup")
        manifest = json.loads(archive.read("manifest.json"))
        if (
            manifest.get("format") != "vnutour-backup"
            or manifest.get("version") != BACKUP_VERSION
        ):
            raise ValueError("unsupported_backup_version")
        data = json.loads(archive.read("data.json"))
        if not isinstance(data, list):
            raise ValueError("invalid_backup")
        for item in data:
            if item.get("model") not in ALLOWED_MODEL_LABELS:
                raise ValueError("unknown_backup_model")

        media_files = []
        for name in names:
            if not name.startswith("media/") or name.endswith("/"):
                continue
            relative = Path(name.removeprefix("media/"))
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("invalid_backup_path")
            media_files.append((relative.as_posix(), archive.read(name)))
    return manifest, data, media_files


def _restore_media(media_files: list[tuple[str, bytes]]) -> None:
    media_root = Path(settings.MEDIA_ROOT).resolve()
    media_root.mkdir(parents=True, exist_ok=True)
    for relative_name, content in media_files:
        target = (media_root / relative_name).resolve()
        if media_root not in target.parents:
            raise ValueError("invalid_backup_path")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def restore_backup(*, archive_path: Path, actor: Account) -> dict:
    manifest, data, media_files = _read_archive(archive_path)
    safety_backup = create_backup(prefix="pre-restore")
    actor_id = actor.id
    actor_username = actor.username

    payload = json.dumps(data, ensure_ascii=False)
    with transaction.atomic():
        with connection.constraint_checks_disabled():
            for model in reversed(BACKUP_MODELS):
                model.objects.all().delete()
            for item in serializers.deserialize("json", payload):
                item.save()
        connection.check_constraints()

    _restore_media(media_files)
    restored_actor = Account.objects.filter(id=actor_id).first()
    if not restored_actor:
        restored_actor = Account.objects.filter(
            username__iexact=actor_username,
            role=Account.ROLE_ADMIN,
        ).first()

    return {
        "restored_at": timezone.now().isoformat(),
        "source_manifest": manifest,
        "safety_backup": safety_backup,
        "restored_actor": restored_actor,
    }


def save_uploaded_backup(uploaded) -> Path:
    suffix = Path(uploaded.name or "").suffix.lower()
    if suffix != ".zip":
        raise ValueError("invalid_backup")
    max_bytes = max(1, int(settings.BACKUP_MAX_UPLOAD_MB)) * 1024 * 1024
    if uploaded.size > max_bytes:
        raise ValueError("backup_too_large")
    handle = tempfile.NamedTemporaryFile(
        prefix="vnutour-restore-",
        suffix=".zip",
        delete=False,
    )
    try:
        for chunk in uploaded.chunks():
            handle.write(chunk)
        return Path(handle.name)
    finally:
        handle.close()
