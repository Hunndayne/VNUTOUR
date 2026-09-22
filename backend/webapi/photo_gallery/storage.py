"""Where photo derivatives live: R2 when configured, MEDIA_ROOT otherwise.

This mirrors submission_storage_service: environments with R2 credentials use
the bucket, and the rest fall back to the local media volume served by
/media/. The gallery only ever writes WebP thumbnails and previews under the
`event-photos/` prefix, and only ever deletes keys recorded in its database.
"""
import os
from pathlib import Path

from botocore.config import Config
import boto3
from django.conf import settings

from api.services.submission_storage_service import normalize_r2_endpoint_url
from .errors import GalleryError

LOCAL_URL_PREFIX = "/media/"


def _r2_bucket():
    # Share the application's bucket by default; keep an optional override
    # for installations that already configured a separate photo bucket.
    bucket = settings.PHOTO_R2_BUCKET.strip() or settings.R2_BUCKET
    if not all([bucket, settings.R2_ENDPOINT_URL, settings.R2_ACCESS_KEY_ID, settings.R2_SECRET_ACCESS_KEY]):
        return ""
    return bucket


class Storage:
    def __init__(self):
        self.bucket = _r2_bucket()
        self.root = Path(settings.MEDIA_ROOT) if not self.bucket else None
        if not self.bucket:
            return
        self.client = boto3.client(
            "s3", endpoint_url=normalize_r2_endpoint_url(settings.R2_ENDPOINT_URL, self.bucket),
            aws_access_key_id=settings.R2_ACCESS_KEY_ID, aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto", config=Config(connect_timeout=10, read_timeout=30, retries={"max_attempts": 2}),
        )

    def _local_path(self, key):
        root = self.root.resolve()
        target = (root / key).resolve()
        # Keys are built by this app, never by a request, but a traversal here
        # would write outside the media volume, so verify anyway.
        if not target.is_relative_to(root):
            raise GalleryError("storage_unavailable")
        return target

    def put(self, key, data):
        if not self.bucket:
            target = self._local_path(key)
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                # Write then rename: a reader never sees a half-written image.
                temporary = target.with_name(target.name + ".part")
                temporary.write_bytes(data)
                os.replace(temporary, target)
            except OSError as exc:
                raise GalleryError("storage_unavailable", retryable=True) from exc
            return
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/webp", CacheControl="private, max-age=240")
        except Exception as exc:
            raise GalleryError("storage_unavailable", retryable=True) from exc

    def url(self, key):
        if not key:
            return None
        if not self.bucket:
            # Served by /media/ with no signature: the random lease segment in
            # the key is what keeps the URL unguessable, the same posture as
            # feed images. Prefer R2 where link expiry matters.
            return LOCAL_URL_PREFIX + key
        try:
            # Keep the existing short-lived URL contract. If the shared bucket
            # has a public domain, that domain follows the bucket's own policy.
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key, "ResponseContentType": "image/webp"},
                ExpiresIn=300,
            )
        except Exception as exc:
            raise GalleryError("storage_unavailable", retryable=True) from exc

    def delete(self, key):
        if not self.bucket:
            try:
                self._local_path(key).unlink(missing_ok=True)
            except OSError as exc:
                raise GalleryError("storage_unavailable", retryable=True) from exc
            return
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise GalleryError("storage_unavailable", retryable=True) from exc
