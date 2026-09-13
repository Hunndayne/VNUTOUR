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
from django.http import FileResponse, HttpResponse


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


def delete_stored_object(storage: str | None, key: str | None) -> bool:
    """Best-effort deletion of one stored file (R2 or local).

    Returns True when a delete was attempted without error. Never raises —
    orphaned-file cleanup must not roll back or block the surrounding DB
    operation, so callers can fire-and-forget after the row is gone.
    """
    if not key:
        return False

    if storage == STORAGE_R2:
        client = _r2_client()
        if client is None:
            return False
        try:
            client.delete_object(Bucket=settings.R2_BUCKET, Key=key)
            return True
        except Exception:
            logger.exception("failed to delete R2 object %s", key)
            return False

    if storage == STORAGE_LOCAL:
        try:
            path = Path(settings.MEDIA_ROOT) / key
            if path.exists():
                path.unlink()
            return True
        except Exception:
            logger.exception("failed to delete local file %s", key)
            return False

    return False


def presigned_url(key: str, expires: int = 3600) -> str | None:
    """Generate a temporary signed GET URL for a private R2 object, or None on failure."""
    client = _r2_client()
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET, "Key": key},
            ExpiresIn=expires,
        )
    except Exception:
        logger.exception("Failed to generate presigned URL for %s", key)
        return None


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


def save_payment_proof(team, uploaded) -> dict:
    """Persist one uploaded payment proof image and return its metadata entry."""
    client = _r2_client()
    safe_name = _safe_name(uploaded.name)
    key = f"payment-proofs/{team.code}/{uuid.uuid4().hex}_{safe_name}"
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
            return entry
        except Exception:
            logger.exception("R2 upload failed for %s; falling back to local storage", key)
            uploaded.seek(0)

    entry["storage"] = STORAGE_LOCAL
    entry["url"] = _store_local(key, uploaded)
    return entry


FRAME_IMAGE_ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
FRAME_IMAGE_MAX_BYTES = 15 * 1024 * 1024


def save_frame_image(uploaded) -> dict:
    """Persist one uploaded photo-frame image and return its metadata entry."""
    extension = Path(uploaded.name).suffix.lower().lstrip(".")
    if extension not in FRAME_IMAGE_ALLOWED_EXTENSIONS:
        raise ValueError("file_type_not_allowed")
    if uploaded.size > FRAME_IMAGE_MAX_BYTES:
        raise ValueError("file_too_large")

    client = _r2_client()
    safe_name = _safe_name(uploaded.name)
    key = f"frames/{uuid.uuid4().hex}_{safe_name}"
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
            return entry
        except Exception:
            logger.exception("R2 upload failed for %s; falling back to local storage", key)
            uploaded.seek(0)

    entry["storage"] = STORAGE_LOCAL
    entry["url"] = _store_local(key, uploaded)
    return entry


def frame_file_response(entry: dict):
    """Return a Django response serving a stored photo-frame image, or None if unavailable."""
    if not entry:
        return None

    storage = entry.get("storage")
    key = entry.get("key")
    if not key:
        return None

    # Frame images are static assets (only replaced via admin re-upload which
    # changes the DB row's `updated_at`), so aggressive caching is safe.
    _FRAME_CACHE = "public, max-age=86400, immutable"

    if storage == STORAGE_R2:
        # Proxy the bytes through our own origin instead of redirecting to a
        # presigned R2 URL — see proof_file_response for why (CORS).
        client = _r2_client()
        if client is None:
            return None
        try:
            obj = client.get_object(Bucket=settings.R2_BUCKET, Key=key)
            data = obj["Body"].read()
        except Exception:
            logger.exception("failed to read frame image from R2: %s", key)
            return None
        content_type = entry.get("type") or obj.get("ContentType") or "image/png"
        response = HttpResponse(data, content_type=content_type)
        response["Content-Length"] = str(len(data))
        response["Cache-Control"] = _FRAME_CACHE
        return response

    if storage == STORAGE_LOCAL:
        path = Path(settings.MEDIA_ROOT) / key
        if not path.exists():
            return None
        resp = FileResponse(open(path, "rb"), content_type=entry.get("type") or "image/png")
        resp["Cache-Control"] = _FRAME_CACHE
        return resp

    return None


def proof_file_response(entry: dict):
    """Return a Django response serving a stored payment proof, or None if unavailable."""
    if not entry:
        return None

    storage = entry.get("storage")
    key = entry.get("key")
    if not key:
        return None

    if storage == STORAGE_R2:
        # Proxy the bytes through our own origin instead of redirecting to a
        # presigned R2 URL. A browser fetch()/XHR that follows the redirect is
        # blocked by CORS — R2 sends no Access-Control-Allow-Origin — so the
        # admin/participant proof image could never load (direct navigation to
        # the link worked, an <img>/fetch did not). Proofs are small images, so
        # reading them into memory here is fine.
        client = _r2_client()
        if client is None:
            return None
        try:
            obj = client.get_object(Bucket=settings.R2_BUCKET, Key=key)
            data = obj["Body"].read()
        except Exception:
            logger.exception("failed to read payment proof from R2: %s", key)
            return None
        content_type = entry.get("type") or obj.get("ContentType") or "application/octet-stream"
        response = HttpResponse(data, content_type=content_type)
        response["Content-Length"] = str(len(data))
        return response

    if storage == STORAGE_LOCAL:
        path = Path(settings.MEDIA_ROOT) / key
        if not path.exists():
            return None
        return FileResponse(open(path, "rb"), content_type=entry.get("type") or None)

    return None
