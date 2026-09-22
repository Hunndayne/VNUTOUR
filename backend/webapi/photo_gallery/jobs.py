"""Durable DB queue with expiring leases and fencing tokens.

Network/model work never holds a database transaction. A result may commit only
while its token and source revision still own the row.
"""
import logging
import random
import tempfile
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import connections, transaction
from django.db.models import Q
from django.utils import timezone

from .drive import Drive, ID, MIMES, revision, safe_drive_link
from .constants import DB_ALIAS, MODEL_VERSION
from .errors import GalleryError, LeaseLost, WorkerStopping
from .imaging import read_image, preview
from .models import Album, Photo, Face, MediaObject, SearchResult
from .storage import Storage

logger = logging.getLogger(__name__)


def locked(query):
    return query.select_for_update(skip_locked=True) if connections[DB_ALIAS].features.has_select_for_update_skip_locked else query.select_for_update()


def invalidate(photo):
    photo.faces.all().delete()
    photo.media_objects.update(active=False)
    photo.thumbnail_key = ""
    photo.preview_key = ""
    photo.width = 0
    photo.height = 0
    photo.face_count = 0
    photo.model_version = ""
    photo.indexing_error = ""
    photo.lease_token = None
    photo.lease_until = None


@transaction.atomic(using=DB_ALIAS)
def queue_import(album_id):
    album = Album.objects.select_for_update().get(pk=album_id)
    if album.import_status not in {"queued", "scanning"}:
        album.import_status, album.import_error = "queued", ""
        album.scan_id, album.page_token = uuid.uuid4(), ""
        album.attempts, album.next_attempt = 0, None
        album.lease_token, album.lease_until = None, None
        album.save()
    return album


@transaction.atomic(using=DB_ALIAS)
def retry_photos(*, album_id=None, photo_id=None, include_ready=False):
    """Re-queue photos. `include_ready` also picks up photos that succeeded,
    which is how a detection or model change is applied to an existing album."""
    if album_id is None and photo_id is None:
        return 0
    retryable = Q(status="failed") | (Q(status="ready") & ~Q(indexing_error=""))
    query = Photo.objects.filter(Q(status="ready") | Q(status="failed") if include_ready else retryable)
    if album_id is not None:
        query = query.filter(album_id=album_id)
    if photo_id is not None:
        query = query.filter(pk=photo_id)
    count = 0
    for photo in query.select_for_update():
        invalidate(photo)
        photo.status, photo.error, photo.attempts, photo.next_attempt = "pending", "", 0, None
        photo.save()
        count += 1
    return count


@transaction.atomic(using=DB_ALIAS)
def delete_album(album_id):
    """Delete an album and every row it owns, leaving stored objects to the
    worker's cleanup. Files in Drive are never touched."""
    MediaObject.objects.filter(photo__album_id=album_id).update(active=False)
    Album.objects.filter(pk=album_id).delete()


@transaction.atomic(using=DB_ALIAS)
def remove_photo(photo_id):
    photo = Photo.objects.select_for_update().get(pk=photo_id)
    invalidate(photo)
    photo.status, photo.error, photo.next_attempt = "removed", "", None
    photo.save()


@transaction.atomic(using=DB_ALIAS)
def claim_album():
    now = timezone.now()
    query = Album.objects.filter(import_status__in=["queued", "scanning"])
    query = query.filter(Q(lease_until__isnull=True) | Q(lease_until__lt=now)).filter(Q(next_attempt__isnull=True) | Q(next_attempt__lte=now))
    album = locked(query.order_by("id")).first()
    if album is None:
        return None
    if album.attempts >= settings.PHOTO_MAX_ATTEMPTS:
        album.import_status, album.import_error = "failed", "worker_interrupted"
        album.lease_token, album.lease_until = None, None
        album.save()
        return None
    album.import_status = "scanning"
    album.lease_token = uuid.uuid4()
    album.lease_until = now + timedelta(seconds=settings.PHOTO_LEASE_SECONDS)
    album.attempts += 1
    album.save()
    return album


def scan_page(album, drive, *, heartbeat=None):
    if heartbeat:
        heartbeat(force=True)
    page = drive.list_page(album.folder_id, album.resource_key, album.page_token)
    if heartbeat:
        heartbeat(force=True)
    with transaction.atomic(using=DB_ALIAS):
        current = Album.objects.select_for_update().get(pk=album.pk)
        if (
            current.lease_token != album.lease_token
            or current.lease_until is None
            or current.lease_until < timezone.now()
        ):
            raise LeaseLost
        for item in page.get("files", []):
            if item.get("mimeType") not in MIMES or not ID.fullmatch(str(item.get("id") or "")):
                continue
            photo, created = Photo.objects.select_for_update().get_or_create(
                album=current, drive_file_id=item["id"],
                defaults={"source_revision": revision(item), "filename": item.get("name", "")[:500]},
            )
            photo.seen_scan_id = current.scan_id
            if photo.status == "removed":
                photo.save(update_fields=["seen_scan_id"])
                continue
            changed = not created and (photo.source_revision != revision(item)
                                       or (photo.status == "ready" and photo.model_version != MODEL_VERSION))
            if changed or photo.error in {"source_unavailable", "source_changed", "drive_permission_denied"}:
                invalidate(photo)
                photo.status, photo.error, photo.attempts, photo.next_attempt = "pending", "", 0, None
            photo.source_revision = revision(item)
            photo.source_checksum = item.get("md5Checksum", "")
            photo.resource_key = item.get("resourceKey", "")
            photo.filename = item.get("name", "")[:500]
            try:
                photo.source_size = max(0, int(item.get("size", 0)))
            except (TypeError, ValueError) as exc:
                raise GalleryError("drive_unavailable", retryable=True) from exc
            photo.share_url = safe_drive_link(item.get("webViewLink"))
            photo.download_url = safe_drive_link(item.get("webContentLink")) if item.get("capabilities", {}).get("canDownload") else ""
            photo.save()
        current.page_token = page.get("nextPageToken", "")
        if not current.page_token:
            # Only a complete successful listing may remove missing sources.
            for photo in Photo.objects.select_for_update().filter(album=current).exclude(seen_scan_id=current.scan_id).exclude(status="removed"):
                invalidate(photo)
                photo.status, photo.error, photo.next_attempt = "failed", "source_unavailable", None
                photo.save()
            current.import_status = "complete"
        current.import_error = ""
        current.attempts = 0
        current.lease_token, current.lease_until, current.next_attempt = None, None, None
        current.save()


@transaction.atomic(using=DB_ALIAS)
def claim_photo():
    now = timezone.now()
    query = Photo.objects.filter(
        Q(status="pending") | Q(status="processing", lease_until__lt=now) |
        Q(status="failed", next_attempt__lte=now)
    ).filter(Q(next_attempt__isnull=True) | Q(next_attempt__lte=now))
    photo = locked(query.order_by("id")).first()
    if photo is None:
        return None
    if photo.attempts >= settings.PHOTO_MAX_ATTEMPTS:
        photo.status, photo.error, photo.next_attempt = "failed", "worker_interrupted", None
        photo.lease_token, photo.lease_until = None, None
        photo.save()
        return None
    photo.status, photo.error = "processing", ""
    photo.lease_token = uuid.uuid4()
    photo.lease_until = now + timedelta(seconds=settings.PHOTO_LEASE_SECONDS)
    photo.attempts += 1
    photo.save()
    return photo


def _lease_heartbeat(job, *, stop_requested=None):
    """Return a throttled heartbeat which cannot revive an expired lease."""
    interval = max(1.0, min(30.0, settings.PHOTO_LEASE_SECONDS / 3))
    last = 0.0

    def heartbeat(*, force=False):
        nonlocal last
        if stop_requested and stop_requested():
            raise WorkerStopping
        monotonic = time.monotonic()
        if not force and monotonic - last < interval:
            return
        now = timezone.now()
        query = type(job).objects.filter(
            pk=job.pk,
            lease_token=job.lease_token,
            lease_until__gte=now,
        )
        if isinstance(job, Album):
            query = query.filter(import_status="scanning")
        else:
            query = query.filter(status="processing", source_revision=job.source_revision)
        expires = now + timedelta(seconds=settings.PHOTO_LEASE_SECONDS)
        if query.update(lease_until=expires) != 1:
            raise LeaseLost
        job.lease_until = expires
        last = monotonic

    return heartbeat


def process_photo(photo, drive, storage, engine=None, *, heartbeat=None):
    if heartbeat:
        heartbeat(force=True)
    with tempfile.TemporaryFile() as source:
        drive.download(photo, source, heartbeat=heartbeat)
        image = read_image(source)
    width, height = image.size
    indexing_error = ""
    try:
        if engine is None:
            from .engine import get_engine
            engine = get_engine()
        faces = engine.extract(image, heartbeat=heartbeat)
        model_version = engine.model_version
    except GalleryError as exc:
        # Media publication is independent of model availability. A failed
        # index is explicit and retryable by the admin; it is not "no faces".
        faces, model_version, indexing_error = [], "", exc.code
    keys = {}
    for variant, edge in [("thumbnail", 400), ("preview", 2048)]:
        if heartbeat:
            heartbeat(force=True)
        key = f"event-photos/{photo.album_id}/{photo.id}/{photo.lease_token}/{variant}.webp"
        MediaObject.objects.create(photo=photo, key=key)
        storage.put(key, preview(image, edge))
        keys[variant] = key
        if heartbeat:
            heartbeat(force=True)
    with transaction.atomic(using=DB_ALIAS):
        current = Photo.objects.select_for_update().get(pk=photo.pk)
        if (
            current.status != "processing"
            or current.lease_token != photo.lease_token
            or current.source_revision != photo.source_revision
            or current.lease_until is None
            or current.lease_until < timezone.now()
        ):
            raise LeaseLost  # Inactive objects are reaped after the lease window.
        invalidate(current)
        Face.objects.bulk_create([
            Face(photo=current, ordinal=i, bbox=face["bbox"], embedding=face["embedding"], model_version=model_version)
            for i, face in enumerate(faces)
        ])
        if MediaObject.objects.filter(photo=current, key__in=keys.values(), active=False).update(active=True) != len(keys):
            raise LeaseLost
        current.thumbnail_key, current.preview_key = keys["thumbnail"], keys["preview"]
        current.width, current.height, current.face_count = width, height, len(faces)
        current.status, current.error, current.model_version = "ready", "", model_version
        current.indexing_error = indexing_error
        current.next_attempt = None
        current.save()


def fail_job(job, error):
    with transaction.atomic(using=DB_ALIAS):
        try:
            current = type(job).objects.select_for_update().get(pk=job.pk)
        except type(job).DoesNotExist:
            return
        if current.lease_token != job.lease_token:
            return
        retry = error.retryable and current.attempts < settings.PHOTO_MAX_ATTEMPTS
        delay = 30 * 2 ** max(0, current.attempts - 1) + random.randint(0, 10)
        current.next_attempt = timezone.now() + timedelta(seconds=delay) if retry else None
        current.lease_token, current.lease_until = None, None
        if isinstance(current, Album):
            current.import_status, current.import_error = "queued" if retry else "failed", error.code
        else:
            current.status, current.error = "failed", error.code
        current.save()


@transaction.atomic(using=DB_ALIAS)
def release_job(job):
    """Release an in-flight claim without consuming an attempt on shutdown."""
    try:
        current = type(job).objects.select_for_update().get(pk=job.pk)
    except type(job).DoesNotExist:
        return
    if current.lease_token != job.lease_token:
        return
    current.attempts = max(0, current.attempts - 1)
    current.lease_token, current.lease_until = None, None
    current.next_attempt = None
    if isinstance(current, Album):
        current.import_status = "queued"
    else:
        current.status, current.error = "pending", ""
    current.save()


def cleanup(storage):
    now = timezone.now()
    SearchResult.objects.filter(expires_at__lt=now).delete()
    cutoff = now - timedelta(seconds=settings.PHOTO_LEASE_SECONDS * 2)
    abandoned = MediaObject.objects.filter(active=False, created_at__lt=cutoff).exclude(
        photo__status="processing", photo__lease_until__gte=now,
    )
    for asset in abandoned.order_by("id")[:50]:
        storage.delete(asset.key)
        # Each key belongs to one lease. Expired leases cannot commit, and a
        # new claim uses new keys; still recheck before removing bookkeeping.
        MediaObject.objects.filter(pk=asset.pk, active=False).exclude(
            photo__status="processing", photo__lease_until__gte=timezone.now(),
        ).delete()


def run_once(drive=None, storage=None, engine=None, *, stop_requested=None):
    work = False
    for claim, operation in [(claim_album, "scan"), (claim_photo, "photo")]:
        if stop_requested and stop_requested():
            break
        job = claim()
        if job is None:
            continue
        work = True
        heartbeat = _lease_heartbeat(job, stop_requested=stop_requested)
        try:
            drive = drive or Drive()
            if operation == "scan":
                scan_page(job, drive, heartbeat=heartbeat)
            else:
                storage = storage or Storage()
                process_photo(job, drive, storage, engine, heartbeat=heartbeat)
        except WorkerStopping:
            release_job(job)
            break
        except LeaseLost:
            # Another worker, source update, or removal owns the row now. The
            # fencing token deliberately prevents this result from committing.
            continue
        except GalleryError as exc:
            fail_job(job, exc)
        except Exception:
            # Log only IDs; no credentials, source URLs, images or vectors.
            logger.error("Photo worker failed: kind=%s id=%s", operation, job.pk)
            fail_job(job, GalleryError("processing_failed", retryable=True))
    return work
