"""Bounded video uploads and retryable, verified deletion from R2."""

import logging
import math
import uuid
from datetime import timedelta
from pathlib import Path

from botocore.exceptions import ClientError
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from api.models import FeedVideo
from api.services.submission_storage_service import _r2_client, normalize_public_base_url

logger = logging.getLogger(__name__)
MAX_VIDEO_BYTES = 100 * 1024 * 1024
PART_BYTES = 8 * 1024 * 1024
VIDEO_TYPES = {"mp4": "video/mp4", "webm": "video/webm"}


class VideoStorageError(Exception):
    pass


def _client():
    client = _r2_client()
    if client is None:
        raise VideoStorageError("video_storage_unavailable")
    return client


def serialize_video(video):
    base = normalize_public_base_url(settings.R2_PUBLIC_BASE_URL)
    return {
        "id": video.id,
        "url": f"{base}/{video.storage_key}" if video.state == "ready" and base else "",
        "name": video.original_filename,
        "size": video.size,
        "type": video.content_type,
        "state": video.state,
    }


def begin_upload(author, name, size):
    extension = Path(str(name or "")).suffix.lower().lstrip(".")
    if extension not in VIDEO_TYPES:
        raise ValueError("video_type_not_allowed")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValueError("invalid_video_size")
    if size > MAX_VIDEO_BYTES:
        raise ValueError("video_too_large")
    if not normalize_public_base_url(settings.R2_PUBLIC_BASE_URL):
        raise VideoStorageError("video_storage_unavailable")
    client = _client()
    # Persist before contacting R2 so even an interrupted CreateMultipartUpload
    # has a tracked key the sweeper can discover and abort later.
    video = FeedVideo.objects.create(
        uploaded_by=author, storage_key=f"feed-videos/{uuid.uuid4().hex}.{extension}",
        original_filename=Path(name).name[:255], size=size, content_type=VIDEO_TYPES[extension],
    )
    try:
        with transaction.atomic():
            video = FeedVideo.objects.select_for_update().get(pk=video.pk)
            result = client.create_multipart_upload(
                Bucket=settings.R2_BUCKET, Key=video.storage_key,
                ContentType=video.content_type, CacheControl="no-store",
            )
            video.upload_id = result["UploadId"]
            video.save(update_fields=["upload_id", "updated_at"])
    except Exception as exc:
        logger.exception("Failed to start feed video upload %s", video.id)
        raise VideoStorageError("video_upload_failed") from exc
    return video


def _owned_upload(video_id, author):
    video = FeedVideo.objects.select_for_update().filter(pk=video_id, uploaded_by=author).first()
    if video is None:
        raise ValueError("video_not_found")
    if video.post_id is not None:
        raise ValueError("video_in_use")
    return video


@transaction.atomic
def upload_part(video_id, author, number, uploaded):
    video = _owned_upload(video_id, author)
    if video.state != "uploading" or not video.upload_id:
        raise ValueError("video_not_uploading")
    count = math.ceil(video.size / PART_BYTES)
    if number < 1 or number > count:
        raise ValueError("invalid_video_part")
    expected_size = min(PART_BYTES, video.size - (number - 1) * PART_BYTES)
    if uploaded is None or uploaded.size != expected_size:
        raise ValueError("invalid_video_part_size")
    data = uploaded.read(expected_size + 1)
    if len(data) != expected_size:
        raise ValueError("invalid_video_part_size")
    if number == 1:
        valid = (
            len(data) >= 12 and data[4:8] == b"ftyp"
            if video.content_type == "video/mp4" else data.startswith(b"\x1a\x45\xdf\xa3")
        )
        if not valid:
            raise ValueError("invalid_video_file")
    try:
        result = _client().upload_part(
            Bucket=settings.R2_BUCKET, Key=video.storage_key, UploadId=video.upload_id,
            PartNumber=number, Body=data,
        )
    except Exception as exc:
        raise VideoStorageError("video_upload_failed") from exc
    video.parts[str(number)] = result["ETag"]
    video.save(update_fields=["parts", "updated_at"])


@transaction.atomic
def complete_upload(video_id, author):
    video = _owned_upload(video_id, author)
    if video.state == "ready":
        return video
    count = math.ceil(video.size / PART_BYTES)
    if set(video.parts) != {str(n) for n in range(1, count + 1)}:
        raise ValueError("video_upload_incomplete")
    client = _client()
    try:
        try:
            client.complete_multipart_upload(
                Bucket=settings.R2_BUCKET, Key=video.storage_key, UploadId=video.upload_id,
                MultipartUpload={"Parts": [
                    {"PartNumber": n, "ETag": video.parts[str(n)]} for n in range(1, count + 1)
                ]},
            )
        except ClientError as exc:
            # A completion response can be lost after R2 committed the object.
            # Retry is safe only when HEAD verifies the already completed file.
            if exc.response.get("Error", {}).get("Code") != "NoSuchUpload":
                raise
        info = client.head_object(Bucket=settings.R2_BUCKET, Key=video.storage_key)
        if info["ContentLength"] != video.size or info.get("ContentType") != video.content_type:
            raise VideoStorageError("invalid_video_object")
    except Exception as exc:
        raise VideoStorageError("video_upload_failed") from exc
    video.state = "ready"
    video.upload_id = ""
    video.parts = {}
    video.save(update_fields=["state", "upload_id", "parts", "updated_at"])
    return video


def _delete_remote(video):
    """Never discard tracking metadata on an R2 error; callers can retry."""
    client = _client()
    try:
        upload_ids = {video.upload_id} if video.upload_id else set()
        # Also find a multipart creation whose response/DB save was interrupted.
        for page in client.get_paginator("list_multipart_uploads").paginate(
            Bucket=settings.R2_BUCKET, Prefix=video.storage_key,
        ):
            upload_ids.update(item["UploadId"] for item in page.get("Uploads", []) if item["Key"] == video.storage_key)
        for upload_id in upload_ids:
            try:
                client.abort_multipart_upload(Bucket=settings.R2_BUCKET, Key=video.storage_key, UploadId=upload_id)
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") != "NoSuchUpload":
                    raise
        client.delete_object(Bucket=settings.R2_BUCKET, Key=video.storage_key)
        try:
            client.head_object(Bucket=settings.R2_BUCKET, Key=video.storage_key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchKey", "NotFound"}:
                raise
        else:
            raise VideoStorageError("video_still_exists")
    except Exception as exc:
        logger.exception("Failed to delete feed video %s; retaining record for retry", video.id)
        raise VideoStorageError("video_delete_failed") from exc


@transaction.atomic
def discard_upload(video_id, author):
    video = _owned_upload(video_id, author)
    _delete_remote(video)
    video.delete()


def sync_post_videos(post, ids, author):
    """Called while the post is locked by its create/update transaction."""
    if not isinstance(ids, list) or any(type(i) is not int for i in ids) or len(ids) != len(set(ids)):
        raise ValueError("invalid_video_ids")
    selected = list(FeedVideo.objects.select_for_update().filter(id__in=ids).order_by("id"))
    if len(selected) != len(ids):
        raise ValueError("video_not_found")
    for video in selected:
        if video.state != "ready" or video.post_id not in (None, post.id):
            raise ValueError("video_not_available")
        if video.post_id is None and (author is None or video.uploaded_by_id != author.id):
            raise ValueError("video_not_available")
    for video in post.videos.select_for_update().exclude(id__in=ids).order_by("id"):
        _delete_remote(video)
        video.delete()
    FeedVideo.objects.filter(id__in=ids).update(post=post)


def delete_post_videos(post):
    for video in post.videos.select_for_update().order_by("id"):
        _delete_remote(video)
        video.delete()


def cleanup_abandoned_uploads():
    """Expired unsaved videos, including incomplete multipart uploads, are retried hourly."""
    cutoff = timezone.now() - timedelta(hours=24)
    ids = FeedVideo.objects.filter(post__isnull=True, updated_at__lt=cutoff).values_list("id", flat=True)[:100]
    removed = failed = 0
    for video_id in list(ids):
        try:
            with transaction.atomic():
                video = FeedVideo.objects.select_for_update(skip_locked=True).filter(
                    pk=video_id, post__isnull=True, updated_at__lt=cutoff,
                ).first()
                if video is None:
                    continue
                _delete_remote(video)
                video.delete()
                removed += 1
        except VideoStorageError:
            failed += 1
    return removed, failed
