"""Small, explicit response serializers for the gallery API.

The public serializers deliberately know nothing about the embedding schema or
the Drive import internals.  This keeps vectors and storage keys out of every
browser response.
"""
from __future__ import annotations

from collections.abc import Iterable

from django.db.models import Count, Q

from .models import Album, Photo
from .constants import MODEL_VERSION


PHOTO_COUNT_ANNOTATIONS = {
    "count_total": Count("photos"),
    "count_pending": Count("photos", filter=Q(photos__status="pending")),
    "count_processing": Count("photos", filter=Q(photos__status="processing")),
    "count_ready": Count("photos", filter=Q(photos__status="ready")),
    "count_indexed": Count(
        "photos",
        filter=Q(photos__status="ready", photos__face_count__gt=0, photos__model_version=MODEL_VERSION),
    ),
    "count_no_faces": Count(
        "photos",
        filter=Q(photos__status="ready", photos__face_count=0, photos__model_version=MODEL_VERSION),
    ),
    "count_indexing_failed": Count("photos", filter=Q(photos__status="ready") & ~Q(photos__indexing_error="")),
    "count_failed": Count("photos", filter=Q(photos__status="failed")),
    "count_removed": Count("photos", filter=Q(photos__status="removed")),
}


def with_counts(queryset):
    return queryset.annotate(**PHOTO_COUNT_ANNOTATIONS)


def album_payload(album: Album, *, admin: bool = False) -> dict:
    """Serialize a count-annotated album without exposing worker lease state."""
    result = {
        "id": album.id,
        "title": album.title,
        "description": album.description,
        "status": album.status,
        "counts": {
            "total": getattr(album, "count_total", 0),
            "pending": getattr(album, "count_pending", 0),
            "processing": getattr(album, "count_processing", 0),
            "ready": getattr(album, "count_ready", 0),
            "indexed": getattr(album, "count_indexed", 0),
            "no_faces": getattr(album, "count_no_faces", 0),
            "indexing_failed": getattr(album, "count_indexing_failed", 0),
            "failed": getattr(album, "count_failed", 0),
            "removed": getattr(album, "count_removed", 0),
        },
    }
    if admin:
        result.update(
            drive_folder_url=album.drive_folder_url,
            import_status=album.import_status,
            import_error=album.import_error or None,
        )
    return result


def photo_payload(photo: Photo, *, admin: bool = False, storage=None) -> dict:
    """Serialize a gallery photo and make short-lived R2 URLs on demand."""
    thumbnail_url = storage.url(photo.thumbnail_key) if storage and photo.thumbnail_key else None
    preview_url = storage.url(photo.preview_key) if storage and photo.preview_key else None
    result = {
        "id": photo.id,
        "album_id": photo.album_id,
        "filename": photo.filename,
        "width": photo.width,
        "height": photo.height,
        "thumbnail_url": thumbnail_url,
        "preview_url": preview_url,
        "share_url": photo.share_url or None,
        "download_url": photo.download_url or None,
        "status": photo.status,
        "face_count": photo.face_count,
    }
    if admin:
        # Error codes are deliberately stable and safe to translate in the UI.
        result["error"] = photo.error or None
        result["indexing_error"] = photo.indexing_error or None
    return result


def photo_payloads(photos: Iterable[Photo], *, admin: bool = False):
    """Build a page with one storage client, rather than one per photo."""
    photos = list(photos)
    if not any(photo.thumbnail_key or photo.preview_key for photo in photos):
        return [photo_payload(photo, admin=admin) for photo in photos]
    from .storage import Storage

    storage = Storage()
    return [photo_payload(photo, admin=admin, storage=storage) for photo in photos]
