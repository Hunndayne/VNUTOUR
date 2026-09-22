"""Public gallery and admin HTTP endpoints.

Views contain authorization, input and pagination policy.  Drive, R2 and
worker implementation details stay in their own modules so a browser never
receives credentials, storage keys, embeddings, or arbitrary fetched URLs.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from functools import wraps

from django.conf import settings
from django.db import DatabaseError
from django.db.models import Case, IntegerField, When
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.cache import never_cache

from api.models import Account
from api.views_shared import _consume_rate_limit, _json_body, _require_role

from .drive import parse_folder
from .access import require_gallery_access
from .errors import GalleryError
from .jobs import queue_import, remove_photo, retry_photos
from .models import Album, Photo, SearchResult
from .search import embed_reference, matching_photo_ids
from .serializers import album_payload, photo_payloads, with_counts


logger = logging.getLogger(__name__)


ALBUM_STATUSES = {"draft", "published", "hidden"}
PUBLIC_PHOTO_STATUSES = {"ready"}
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _error(code: str, status: int = 400):
    return JsonResponse({"error": code}, status=status)


def gallery_view(view):
    """Answer 503 when the gallery database is unreachable.

    The gallery keeps its own database, so an outage there must degrade this
    feature only: the rest of the API keeps using the event database.
    """
    @wraps(view)
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except DatabaseError:
            logger.warning("Gallery database unavailable for %s", view.__name__)
            return _error("gallery_unavailable", 503)

    return wrapper


def _gallery_enabled():
    if not settings.PHOTO_GALLERY_ENABLED:
        return _error("gallery_disabled", 404)
    return None


def _gallery_exception(exc: GalleryError):
    status = 503 if exc.retryable or exc.code in {"storage_unavailable", "search_unavailable", "drive_unavailable"} else 400
    return _error(exc.code, status)


def _bounded_int(request, name: str, *, default: int, maximum: int, minimum: int = 1):
    raw = request.GET.get(name)
    if raw in (None, ""):
        return default, None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, _error(f"invalid_{name}")
    if value < minimum or value > maximum:
        return None, _error(f"invalid_{name}")
    return value, None


def _id_page(request, queryset, *, default: int, maximum: int):
    cursor, error = _bounded_int(request, "cursor", default=0, maximum=2_147_483_647, minimum=0)
    if error:
        return None, None, error
    limit, error = _bounded_int(request, "limit", default=default, maximum=maximum)
    if error:
        return None, None, error
    rows = list(queryset.filter(pk__gt=cursor).order_by("pk")[: limit + 1])
    # The cursor identifies the last returned row, never the lookahead row.
    next_cursor = rows[limit - 1].pk if len(rows) > limit else None
    return rows[:limit], next_cursor, None


def _album_or_404(album_id: int, *, public: bool, admin: bool = False):
    query = Album.objects.filter(pk=album_id)
    if public:
        query = query.filter(status="published")
    album = with_counts(query).first()
    return album


def _photo_response(photos, *, admin: bool = False):
    try:
        return photo_payloads(photos, admin=admin), None
    except GalleryError as exc:
        return None, _gallery_exception(exc)


@never_cache
@gallery_view
def public_albums_view(request):
    if request.method != "GET":
        return _error("method_not_allowed", 405)
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    access_error = require_gallery_access(request)
    if access_error:
        return access_error
    albums, next_cursor, error = _id_page(
        request, with_counts(Album.objects.filter(status="published")), default=24, maximum=48,
    )
    if error:
        return error
    return JsonResponse({"albums": [album_payload(album) for album in albums], "next_cursor": next_cursor})


@never_cache
@gallery_view
def public_photos_view(request, album_id: int):
    if request.method != "GET":
        return _error("method_not_allowed", 405)
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    access_error = require_gallery_access(request)
    if access_error:
        return access_error
    album = _album_or_404(album_id, public=True)
    if album is None:
        return _error("not_found", 404)
    photos, next_cursor, error = _id_page(
        request,
        Photo.objects.filter(album_id=album.id, status__in=PUBLIC_PHOTO_STATUSES),
        default=48,
        maximum=96,
    )
    if error:
        return error
    payload, error = _photo_response(photos)
    if error:
        return error
    return JsonResponse({"album": album_payload(album), "photos": payload, "next_cursor": next_cursor})


@csrf_exempt
@never_cache
@gallery_view
def search_create_view(request):
    if request.method != "POST":
        return _error("method_not_allowed", 405)
    disabled = _gallery_enabled()
    if disabled or not settings.PHOTO_SEARCH_ENABLED:
        return disabled or _error("gallery_disabled", 404)
    access_error = require_gallery_access(request)
    if access_error:
        return access_error
    limited, _key = _consume_rate_limit(
        request,
        scope="photo-search",
        limit=settings.PHOTO_SEARCH_RATE_LIMIT,
        window_seconds=settings.PHOTO_SEARCH_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    content_length = request.META.get("CONTENT_LENGTH")
    try:
        if content_length and int(content_length) > settings.PHOTO_REFERENCE_MAX_BYTES + 16 * 1024:
            return _error("reference_too_large")
    except (TypeError, ValueError):
        return _error("invalid_image")
    upload = request.FILES.get("image")
    if upload is None:
        return _error("invalid_image")
    if upload.content_type and upload.content_type.lower() not in IMAGE_CONTENT_TYPES:
        return _error("invalid_image")
    if upload.size > settings.PHOTO_REFERENCE_MAX_BYTES:
        return _error("reference_too_large")
    image_bytes = upload.read(settings.PHOTO_REFERENCE_MAX_BYTES + 1)
    if not image_bytes:
        return _error("invalid_image")
    if len(image_bytes) > settings.PHOTO_REFERENCE_MAX_BYTES:
        return _error("reference_too_large")
    raw_album_id = request.POST.get("album_id")
    album_id = None
    if raw_album_id not in (None, ""):
        try:
            album_id = int(raw_album_id)
        except (TypeError, ValueError):
            return _error("not_found", 404)
        if not 1 <= album_id <= 9_223_372_036_854_775_807:
            return _error("not_found", 404)
        if _album_or_404(album_id, public=True) is None:
            return _error("not_found", 404)
    try:
        embedding = embed_reference(image_bytes)
        photo_ids, truncated = matching_photo_ids(embedding, album_id=album_id)
    except GalleryError as exc:
        return _gallery_exception(exc)
    result = SearchResult.objects.create(
        photo_ids=photo_ids,
        truncated=truncated,
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    photos, _next_cursor, _total = _live_search_page(photo_ids, offset=0, limit=48)
    payload, error = _photo_response(photos)
    if error:
        return error
    return JsonResponse({
        "token": str(result.token), "photos": payload, "total": _total,
        "next_cursor": _next_cursor, "truncated": truncated,
    })


def _live_search_page(photo_ids: list[int], *, offset: int, limit: int):
    """Reapply public visibility before every page; preserve stored rank."""
    if not photo_ids:
        return [], None, 0
    ordering = Case(
        *[When(pk=photo_id, then=position) for position, photo_id in enumerate(photo_ids)],
        output_field=IntegerField(),
    )
    by_id = {
        photo.id: photo
        for photo in Photo.objects.filter(
            pk__in=photo_ids, status="ready", album__status="published",
        ).order_by(ordering)
    }
    live_ids = [photo_id for photo_id in photo_ids if photo_id in by_id]
    # Cursor addresses the immutable stored rank. Filtering before applying an
    # offset skips results when a photo on an earlier page is removed.
    remaining = [(position, photo_id) for position, photo_id in enumerate(photo_ids)
                 if position >= offset and photo_id in by_id]
    page_ids = [photo_id for _, photo_id in remaining[:limit]]
    next_cursor = remaining[limit - 1][0] + 1 if len(remaining) > limit else None
    return [by_id[photo_id] for photo_id in page_ids], next_cursor, len(live_ids)


@never_cache
@gallery_view
def search_page_view(request, token):
    if request.method != "GET":
        return _error("method_not_allowed", 405)
    disabled = _gallery_enabled()
    if disabled or not settings.PHOTO_SEARCH_ENABLED:
        return disabled or _error("gallery_disabled", 404)
    access_error = require_gallery_access(request)
    if access_error:
        return access_error
    limited, _key = _consume_rate_limit(
        request,
        scope="photo-search-page",
        limit=settings.PHOTO_SEARCH_PAGE_RATE_LIMIT,
        window_seconds=settings.PHOTO_SEARCH_PAGE_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    result = SearchResult.objects.filter(pk=token).first()
    if result is None:
        return _error("not_found", 404)
    if result.expires_at <= timezone.now():
        result.delete()
        return _error("search_expired", 410)
    offset, error = _bounded_int(request, "cursor", default=0, maximum=500, minimum=0)
    if error:
        return error
    limit, error = _bounded_int(request, "limit", default=48, maximum=96)
    if error:
        return error
    photos, next_cursor, total = _live_search_page(result.photo_ids, offset=offset, limit=limit)
    payload, error = _photo_response(photos)
    if error:
        return error
    return JsonResponse({
        "token": str(result.token), "photos": payload, "total": total,
        "next_cursor": next_cursor, "truncated": result.truncated,
    })


@csrf_exempt
@gallery_view
def admin_albums_view(request):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method == "GET":
        albums, next_cursor, error = _id_page(request, with_counts(Album.objects.all()), default=24, maximum=48)
        if error:
            return error
        return JsonResponse({
            "albums": [album_payload(album, admin=True) for album in albums],
            "next_cursor": next_cursor,
            "drive_service_email": settings.PHOTO_DRIVE_SERVICE_EMAIL or None,
        })
    if request.method != "POST":
        return _error("method_not_allowed", 405)
    data = _json_body(request)
    if not isinstance(data, dict):
        return _error("invalid_json")
    title = data.get("title")
    description = data.get("description", "")
    folder_url = data.get("drive_folder_url")
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
        return _error("invalid_title")
    if not isinstance(description, str) or len(description) > 10_000:
        return _error("invalid_description")
    try:
        folder_id, resource_key = parse_folder(folder_url)
    except GalleryError as exc:
        return _gallery_exception(exc)
    album = Album.objects.create(
        title=title.strip(), description=description.strip(), folder_id=folder_id,
        resource_key=resource_key, drive_folder_url=folder_url.strip(), status="draft", import_status="queued",
    )
    # The durable queue state is written before returning.  A separate worker
    # claims it later, so closing the admin page cannot lose this import.
    album = queue_import(album.id)
    album = _album_or_404(album.id, public=False)
    return JsonResponse({"album": album_payload(album, admin=True)}, status=201)


@csrf_exempt
@gallery_view
def admin_album_detail_view(request, album_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "PATCH":
        return _error("method_not_allowed", 405)
    data = _json_body(request)
    if not isinstance(data, dict):
        return _error("invalid_json")
    allowed = {"title", "description", "status"}
    if not data or set(data) - allowed:
        return _error("invalid_fields")
    album = Album.objects.filter(pk=album_id).first()
    if album is None:
        return _error("not_found", 404)
    updates = []
    if "title" in data:
        if not isinstance(data["title"], str) or not data["title"].strip() or len(data["title"].strip()) > 200:
            return _error("invalid_title")
        album.title = data["title"].strip()
        updates.append("title")
    if "description" in data:
        if not isinstance(data["description"], str) or len(data["description"]) > 10_000:
            return _error("invalid_description")
        album.description = data["description"].strip()
        updates.append("description")
    if "status" in data:
        if not isinstance(data["status"], str) or data["status"] not in ALBUM_STATUSES:
            return _error("invalid_status")
        album.status = data["status"]
        updates.append("status")
    if updates:
        updates.append("updated_at")
        album.save(update_fields=updates)
    album = _album_or_404(album.id, public=False)
    return JsonResponse({"album": album_payload(album, admin=True)})


@csrf_exempt
@gallery_view
def admin_import_view(request, album_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "POST":
        return _error("method_not_allowed", 405)
    if _json_body(request) is None:
        return _error("invalid_json")
    if not Album.objects.filter(pk=album_id).exists():
        return _error("not_found", 404)
    queue_import(album_id)
    album = _album_or_404(album_id, public=False)
    return JsonResponse({"album": album_payload(album, admin=True)}, status=202)


@gallery_view
def admin_photos_view(request, album_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "GET":
        return _error("method_not_allowed", 405)
    album = _album_or_404(album_id, public=False)
    if album is None:
        return _error("not_found", 404)
    photos, next_cursor, error = _id_page(request, Photo.objects.filter(album_id=album.id), default=48, maximum=96)
    if error:
        return error
    payload, error = _photo_response(photos, admin=True)
    if error:
        return error
    return JsonResponse({"album": album_payload(album, admin=True), "photos": payload, "next_cursor": next_cursor})


@csrf_exempt
@gallery_view
def admin_album_retry_view(request, album_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "POST":
        return _error("method_not_allowed", 405)
    if _json_body(request) is None:
        return _error("invalid_json")
    if not Album.objects.filter(pk=album_id).exists():
        return _error("not_found", 404)
    return JsonResponse({"queued": retry_photos(album_id=album_id)}, status=202)


@csrf_exempt
@gallery_view
def admin_photo_retry_view(request, photo_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "POST":
        return _error("method_not_allowed", 405)
    if _json_body(request) is None:
        return _error("invalid_json")
    if not Photo.objects.filter(pk=photo_id).exists():
        return _error("not_found", 404)
    return JsonResponse({"queued": retry_photos(photo_id=photo_id)}, status=202)


@csrf_exempt
@gallery_view
def admin_photo_remove_view(request, photo_id: int):
    disabled = _gallery_enabled()
    if disabled:
        return disabled
    _account, error = _require_role(request, Account.ROLE_ADMIN)
    if error:
        return error
    if request.method != "DELETE":
        return _error("method_not_allowed", 405)
    if not Photo.objects.filter(pk=photo_id).exists():
        return _error("not_found", 404)
    remove_photo(photo_id)
    return JsonResponse({"removed": True})
