"""Business logic for the public "ghép khung ảnh" (photo-frame overlay) feature.

Frames are admin-uploaded transparent PNGs (or other image types) stored the
same way payment proofs are (see submission_storage_service): R2 with a local
fallback, described by a small metadata dict rather than a Django FileField.
"""

from __future__ import annotations

from datetime import datetime, timezone as _timezone

from django.db.models import F
from django.http import HttpRequest

from api.models import FrameDownloadLog, PhotoFrame
from api.services.submission_storage_service import delete_stored_object, save_frame_image


def _iso(dt: datetime | None) -> str | None:
    """UTC ISO-8601 string for a datetime, or None. Kept local so this service
    layer doesn't reach up into the views layer for a formatting helper."""
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_timezone.utc)
    return dt.astimezone(_timezone.utc).isoformat()


def _image_dimensions(uploaded) -> tuple[int, int]:
    """Best-effort natural pixel size of an uploaded image; (0, 0) if unreadable."""
    try:
        from PIL import Image
    except ImportError:
        return 0, 0

    try:
        uploaded.seek(0)
        with Image.open(uploaded) as img:
            width, height = img.size
        return int(width), int(height)
    except Exception:
        return 0, 0
    finally:
        try:
            uploaded.seek(0)
        except Exception:
            pass


def serialize_frame(frame: PhotoFrame, request: HttpRequest | None = None, *, admin: bool = False) -> dict:
    # Prefer the direct R2 public URL (fast, CDN-cached) stored in the image
    # metadata; fall back to the Django proxy endpoint for local storage.
    direct_url = (frame.image or {}).get("url", "")
    if direct_url:
        image_url = direct_url
    else:
        path = f"/api/public/frames/{frame.id}/image"
        image_url = request.build_absolute_uri(path) if request is not None else path

    data = {
        "id": frame.id,
        "title": frame.title,
        "description": frame.description,
        "width": frame.width,
        "height": frame.height,
        "image_url": image_url,
        "download_count": frame.download_count,
    }
    if admin:
        data["is_active"] = frame.is_active
        data["sort_order"] = frame.sort_order
        data["created_at"] = _iso(frame.created_at)
    return data


def list_public_frames():
    return PhotoFrame.objects.filter(is_active=True).order_by("sort_order", "-created_at")


def list_admin_frames():
    return PhotoFrame.objects.order_by("sort_order", "-created_at")


def create_frame(uploaded, title: str, description: str, is_active: bool, account) -> PhotoFrame:
    entry = save_frame_image(uploaded)
    width, height = _image_dimensions(uploaded)
    frame = PhotoFrame.objects.create(
        title=title,
        description=description or "",
        image=entry,
        width=width,
        height=height,
        is_active=bool(is_active),
        created_by=account,
    )
    return frame


def update_frame(
    frame: PhotoFrame,
    *,
    title: str | None = None,
    description: str | None = None,
    is_active: bool | None = None,
    sort_order: int | None = None,
    uploaded=None,
) -> PhotoFrame:
    update_fields = ["updated_at"]
    old_image = None

    if title is not None:
        frame.title = title
        update_fields.append("title")
    if description is not None:
        frame.description = description
        update_fields.append("description")
    if is_active is not None:
        frame.is_active = bool(is_active)
        update_fields.append("is_active")
    if sort_order is not None:
        frame.sort_order = int(sort_order)
        update_fields.append("sort_order")

    if uploaded is not None:
        if isinstance(frame.image, dict):
            old_image = frame.image
        entry = save_frame_image(uploaded)
        width, height = _image_dimensions(uploaded)
        frame.image = entry
        frame.width = width
        frame.height = height
        update_fields.extend(["image", "width", "height"])

    frame.save(update_fields=update_fields)

    # The old file is unreferenced once the new one is saved — drop it so a
    # replaced frame doesn't leave its previous PNG behind in R2/local storage.
    if old_image:
        delete_stored_object(old_image.get("storage"), old_image.get("key"))

    return frame


def delete_frame(frame: PhotoFrame) -> None:
    image = frame.image if isinstance(frame.image, dict) else None
    frame.delete()
    if image:
        delete_stored_object(image.get("storage"), image.get("key"))


def record_download(frame: PhotoFrame, *, ip: str = "", account=None) -> int:
    """Bump the frame's download counter and log the event. `ip` and the
    optional `account` are resolved by the view and passed in, keeping this
    service free of request/views-layer knowledge."""
    PhotoFrame.objects.filter(pk=frame.pk).update(download_count=F("download_count") + 1)

    FrameDownloadLog.objects.create(
        frame=frame,
        frame_title=frame.title,
        account=account,
        ip=ip or "",
    )

    return PhotoFrame.objects.filter(pk=frame.pk).values_list("download_count", flat=True).first() or 0


def frame_stats(limit: int) -> dict:
    limit = max(1, int(limit or 50))

    frames = PhotoFrame.objects.order_by("sort_order", "-created_at")
    total = sum(f.download_count for f in frames)
    frame_rows = [
        {"id": f.id, "title": f.title, "download_count": f.download_count}
        for f in frames
    ]

    recent_logs = FrameDownloadLog.objects.order_by("-created_at")[:limit]
    recent = [
        {
            "id": log.id,
            "frame_id": log.frame_id,
            "frame_title": log.frame_title,
            "created_at": _iso(log.created_at),
        }
        for log in recent_logs
    ]

    return {"total": total, "frames": frame_rows, "recent": recent}
