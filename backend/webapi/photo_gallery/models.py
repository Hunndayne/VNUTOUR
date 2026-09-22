import uuid

from django.db import models
from pgvector.django import VectorField

from .constants import DIMENSIONS


class Album(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_HIDDEN = "hidden"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_HIDDEN, "Hidden"),
    ]
    IMPORT_IDLE = "idle"
    IMPORT_QUEUED = "queued"
    IMPORT_SCANNING = "scanning"
    IMPORT_COMPLETE = "complete"
    IMPORT_FAILED = "failed"
    IMPORT_STATUS_CHOICES = [
        (IMPORT_IDLE, "Idle"), (IMPORT_QUEUED, "Queued"),
        (IMPORT_SCANNING, "Scanning"), (IMPORT_COMPLETE, "Complete"),
        (IMPORT_FAILED, "Failed"),
    ]
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    folder_id = models.CharField(max_length=200)
    resource_key = models.CharField(max_length=200, blank=True)
    drive_folder_url = models.URLField(max_length=1000)
    import_status = models.CharField(max_length=16, choices=IMPORT_STATUS_CHOICES, default=IMPORT_QUEUED, db_index=True)
    import_error = models.CharField(max_length=80, blank=True)
    scan_id = models.UUIDField(default=uuid.uuid4)
    page_token = models.TextField(blank=True)
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Photo(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_READY = "ready"
    STATUS_FAILED = "failed"
    STATUS_REMOVED = "removed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"), (STATUS_PROCESSING, "Processing"),
        (STATUS_READY, "Ready"), (STATUS_FAILED, "Failed"), (STATUS_REMOVED, "Removed"),
    ]
    album = models.ForeignKey(Album, on_delete=models.CASCADE, related_name="photos")
    drive_file_id = models.CharField(max_length=200)
    resource_key = models.CharField(max_length=200, blank=True)
    source_revision = models.CharField(max_length=200)
    source_checksum = models.CharField(max_length=128, blank=True)
    filename = models.CharField(max_length=500)
    share_url = models.URLField(max_length=2000, blank=True)
    download_url = models.URLField(max_length=2000, blank=True)
    source_size = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    error = models.CharField(max_length=80, blank=True)
    indexing_error = models.CharField(max_length=80, blank=True)
    seen_scan_id = models.UUIDField(null=True)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    face_count = models.PositiveIntegerField(default=0)
    model_version = models.CharField(max_length=120, blank=True)
    thumbnail_key = models.CharField(max_length=500, blank=True)
    preview_key = models.CharField(max_length=500, blank=True)
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt = models.DateTimeField(null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["album", "drive_file_id"], name="photo_unique_source")]


class Face(models.Model):
    photo = models.ForeignKey(Photo, on_delete=models.CASCADE, related_name="faces")
    ordinal = models.PositiveIntegerField()
    bbox = models.JSONField()
    embedding = VectorField(dimensions=DIMENSIONS)
    model_version = models.CharField(max_length=120, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["photo", "ordinal"], name="photo_unique_face")]


class MediaObject(models.Model):
    """Record an R2 photo object BEFORE writing, so abandoned writes can be reaped."""
    # `objects` would shadow Photo.objects through the reverse relation.
    # SET_NULL, not CASCADE: deleting an album must leave these rows behind so
    # the worker still knows which stored objects to remove.
    photo = models.ForeignKey(Photo, on_delete=models.SET_NULL, null=True, related_name="media_objects")
    key = models.CharField(max_length=500, unique=True)
    active = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)


class SearchResult(models.Model):
    token = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    photo_ids = models.JSONField(default=list)
    truncated = models.BooleanField(default=False)
    expires_at = models.DateTimeField(db_index=True)
