from django.conf import settings
from botocore.config import Config
import boto3

from api.services.submission_storage_service import normalize_r2_endpoint_url
from .errors import GalleryError


class Storage:
    def __init__(self):
        # Share the application's bucket by default; keep an optional override
        # for installations that already configured a separate photo bucket.
        self.bucket = settings.PHOTO_R2_BUCKET.strip() or settings.R2_BUCKET
        if not all([self.bucket, settings.R2_ENDPOINT_URL, settings.R2_ACCESS_KEY_ID, settings.R2_SECRET_ACCESS_KEY]):
            raise GalleryError("storage_unavailable", retryable=True)
        self.client = boto3.client(
            "s3", endpoint_url=normalize_r2_endpoint_url(settings.R2_ENDPOINT_URL, self.bucket),
            aws_access_key_id=settings.R2_ACCESS_KEY_ID, aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto", config=Config(connect_timeout=10, read_timeout=30, retries={"max_attempts": 2}),
        )

    def put(self, key, data):
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/webp", CacheControl="private, max-age=240")
        except Exception as exc:
            raise GalleryError("storage_unavailable", retryable=True) from exc

    def url(self, key):
        if not key:
            return None
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
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise GalleryError("storage_unavailable", retryable=True) from exc
