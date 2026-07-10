"""Store submission attachment files in Cloudflare R2 or local media storage.

R2 is used when its credentials are fully configured (and boto3 is importable);
otherwise files fall back to MEDIA_ROOT on the local server. A failed R2 upload
also falls back to local so a submission never loses its files.
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from django.conf import settings


logger = logging.getLogger(__name__)

DEFAULT_MAX_FILE_MB = 20

STORAGE_R2 = "r2"
STORAGE_LOCAL = "local"


def _r2_client():
    """Return a configured boto3 S3 client for R2, or None when unavailable."""
    if not (
        settings.R2_ENDPOINT_URL
        and settings.R2_ACCESS_KEY_ID
        and settings.R2_SECRET_ACCESS_KEY
        and settings.R2_BUCKET
    ):
        return None
    try:
        import boto3
    except ImportError:
        logger.warning("R2 configured but boto3 is not installed; using local storage")
        return None
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT_URL,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _allowed_extensions(attachment_config: dict) -> set[str]:
    """Parse 'JPG, PNG, PDF' style config into a lowercase extension set."""
    raw = str(attachment_config.get("allowedTypes") or "")
    return {
        token.strip().lower().lstrip(".")
        for token in raw.split(",")
        if token.strip()
    }


def validate_files(uploaded_files, attachment_config: dict) -> None:
    """Raise ValueError with an API error code when files violate the config."""
    max_files = max(1, int(attachment_config.get("maxFiles") or 1))
    if len(uploaded_files) > max_files:
        raise ValueError("too_many_files")

    allowed = _allowed_extensions(attachment_config)
    max_bytes = max(1, int(attachment_config.get("maxSizeMb") or DEFAULT_MAX_FILE_MB)) * 1024 * 1024
    for uploaded in uploaded_files:
        extension = Path(uploaded.name).suffix.lower().lstrip(".")
        if allowed and extension not in allowed:
            raise ValueError("file_type_not_allowed")
        if uploaded.size > max_bytes:
            raise ValueError("file_too_large")


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", name)[:120] or "file"


def _store_local(key: str, uploaded) -> str:
    target = Path(settings.MEDIA_ROOT) / key
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as handle:
        for chunk in uploaded.chunks():
            handle.write(chunk)
    return f"{settings.MEDIA_URL.rstrip('/')}/{key}"


def save_submission_files(station, team, uploaded_files, attachment_config: dict) -> list[dict]:
    """Persist uploaded files and return their attachment metadata entries."""
    validate_files(uploaded_files, attachment_config)

    client = _r2_client()
    stored = []
    for uploaded in uploaded_files:
        safe_name = _safe_name(uploaded.name)
        key = f"submissions/st{station.id}/{team.code}/{uuid.uuid4().hex}_{safe_name}"
        entry = {
            "name": uploaded.name,
            "size": uploaded.size,
            "type": getattr(uploaded, "content_type", "") or "",
            "key": key,
        }

        if client is not None:
            try:
                uploaded.seek(0)
                client.upload_fileobj(
                    uploaded,
                    settings.R2_BUCKET,
                    key,
                    ExtraArgs={"ContentType": entry["type"] or "application/octet-stream"},
                )
                entry["storage"] = STORAGE_R2
                if settings.R2_PUBLIC_BASE_URL:
                    entry["url"] = f"{settings.R2_PUBLIC_BASE_URL}/{key}"
                stored.append(entry)
                continue
            except Exception:
                logger.exception("R2 upload failed for %s; falling back to local storage", key)
                uploaded.seek(0)

        entry["storage"] = STORAGE_LOCAL
        entry["url"] = _store_local(key, uploaded)
        stored.append(entry)

    return stored
