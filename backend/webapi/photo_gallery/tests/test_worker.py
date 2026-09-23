"""Failure-oriented integration tests; no live Drive/R2/model required."""
import io
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.apps import apps
from django.conf import settings
from django.utils import timezone
from PIL import Image

if not apps.is_installed("photo_gallery"):
    pytest.skip("Use --ds=serverapi.settings_test_photos", allow_module_level=True)

from photo_gallery.constants import MODEL_VERSION
from photo_gallery.errors import GalleryError, LeaseLost
from photo_gallery import jobs
from photo_gallery.models import Album, Photo, Face, MediaObject

pytestmark = pytest.mark.django_db(databases=["default", "photos"])


def picture():
    data = io.BytesIO()
    Image.new("RGB", (48, 32), (20, 100, 30)).save(data, "PNG")
    return data.getvalue()


@pytest.fixture
def album():
    return Album.objects.create(title="Ngày hội", folder_id="folder_123456", drive_folder_url="https://drive.google.com/drive/folders/folder_123456")


def metadata(file_id="photo_123456", version="1"):
    return {"id": file_id, "name": "Đội xanh.png", "mimeType": "image/png", "version": version,
            "size": 100, "webViewLink": f"https://drive.google.com/file/d/{file_id}/view",
            "webContentLink": f"https://drive.google.com/uc?id={file_id}&export=download",
            "capabilities": {"canDownload": True}}


def complete_scan(drive):
    claim = jobs.claim_album()
    assert claim is not None
    jobs.scan_page(claim, drive)


def fake_drive():
    drive = Mock()
    drive.list_page.return_value = {"files": [metadata()]}
    drive.download.side_effect = lambda photo, output, **kwargs: (output.write(picture()), output.seek(0))
    return drive


def fake_engine():
    engine = Mock()
    engine.model_version = MODEL_VERSION
    engine.extract.return_value = [{"embedding": [1.0] + [0.0] * 127, "bbox": [0.1, 0.1, 0.4, 0.4]}]
    return engine


def test_resync_does_not_duplicate_or_reprocess_unchanged_photo(album):
    drive = fake_drive()
    complete_scan(drive)
    claim = jobs.claim_photo()
    jobs.process_photo(claim, drive, Mock(), fake_engine())
    jobs.queue_import(album.pk)
    complete_scan(drive)
    photo = Photo.objects.get()
    assert photo.status == "ready"
    assert photo.faces.count() == 1
    assert Photo.objects.count() == 1
    assert jobs.claim_photo() is None


def test_deleted_photo_cannot_be_resurrected_by_running_worker_or_resync(album):
    drive = fake_drive()
    complete_scan(drive)
    claim = jobs.claim_photo()
    engine = fake_engine()
    engine.extract.side_effect = lambda image, **kwargs: (jobs.remove_photo(claim.pk), [])[1]
    with pytest.raises(LeaseLost):
        jobs.process_photo(claim, drive, Mock(), engine)
    assert Photo.objects.get().status == "removed"
    assert Face.objects.count() == 0
    assert not MediaObject.objects.filter(active=True).exists()
    jobs.queue_import(album.pk)
    complete_scan(drive)
    assert Photo.objects.get().status == "removed"


def test_source_revision_change_fences_old_inference(album):
    drive = fake_drive()
    complete_scan(drive)
    claim = jobs.claim_photo()
    engine = fake_engine()

    def change_during_inference(image, **kwargs):
        drive.list_page.return_value = {"files": [metadata(version="2")]}
        jobs.queue_import(album.pk)
        complete_scan(drive)
        return [{"embedding": [1.0] + [0.0] * 127, "bbox": [0, 0, 1, 1]}]

    engine.extract.side_effect = change_during_inference
    with pytest.raises(LeaseLost):
        jobs.process_photo(claim, drive, Mock(), engine)
    photo = Photo.objects.get()
    assert photo.source_revision.startswith("2:")
    assert photo.status == "pending"
    assert Face.objects.count() == 0
    assert not MediaObject.objects.filter(active=True).exists()


def test_expired_lease_reclaimed_and_old_token_cannot_fail_new_job(album):
    complete_scan(fake_drive())
    old = jobs.claim_photo()
    Photo.objects.filter(pk=old.pk).update(lease_until=timezone.now() - timedelta(seconds=1))
    new = jobs.claim_photo()
    assert old.lease_token != new.lease_token
    jobs.fail_job(old, GalleryError("invalid_image"))
    current = Photo.objects.get()
    assert current.lease_token == new.lease_token
    assert current.status == "processing"


def test_partial_scan_does_not_hide_photos_before_final_page(album):
    drive = fake_drive()
    complete_scan(drive)
    Photo.objects.update(status="ready")
    jobs.queue_import(album.pk)
    drive.list_page.return_value = {"files": [], "nextPageToken": "page2"}
    complete_scan(drive)
    assert Photo.objects.get().status == "ready"
    drive.list_page.return_value = {"files": []}
    complete_scan(drive)
    assert Photo.objects.get().status == "failed"
    assert Photo.objects.get().error == "source_unavailable"


def test_no_faces_still_yields_gallery_photo(album):
    drive = fake_drive()
    complete_scan(drive)
    engine = fake_engine()
    engine.extract.return_value = []
    jobs.process_photo(jobs.claim_photo(), drive, Mock(), engine)
    photo = Photo.objects.get()
    assert photo.status == "ready"
    assert photo.face_count == 0
    assert photo.model_version == MODEL_VERSION
    assert photo.thumbnail_key and photo.preview_key


def test_cleanup_keeps_active_and_recent_uploads_and_retries_storage_failure(album):
    photo = Photo.objects.create(album=album, drive_file_id="photo_123456", filename="x.png", source_revision="1:")
    old = MediaObject.objects.create(photo=photo, key="event-photos/old")
    active = MediaObject.objects.create(photo=photo, key="event-photos/active", active=True)
    recent = MediaObject.objects.create(photo=photo, key="event-photos/recent")
    MediaObject.objects.filter(pk__in=[old.pk, active.pk]).update(created_at=timezone.now() - timedelta(hours=2))
    storage = Mock()
    storage.delete.side_effect = GalleryError("storage_unavailable", retryable=True)
    with pytest.raises(GalleryError):
        jobs.cleanup(storage)
    assert MediaObject.objects.filter(pk=old.pk).exists()
    storage.delete.side_effect = None
    jobs.cleanup(storage)
    assert not MediaObject.objects.filter(pk=old.pk).exists()
    assert MediaObject.objects.filter(pk__in=[active.pk, recent.pk]).count() == 2


def test_retryable_failure_is_delayed_and_bounded(album):
    complete_scan(fake_drive())
    claim = jobs.claim_photo()
    jobs.fail_job(claim, GalleryError("drive_unavailable", retryable=True))
    assert jobs.claim_photo() is None
    Photo.objects.update(next_attempt=timezone.now() - timedelta(seconds=1), attempts=settings.PHOTO_MAX_ATTEMPTS - 1)
    claim = jobs.claim_photo()
    jobs.fail_job(claim, GalleryError("drive_unavailable", retryable=True))
    assert Photo.objects.get().next_attempt is None
    assert jobs.claim_photo() is None


def test_model_failure_keeps_preview_available_and_can_retry(album):
    from photo_gallery.serializers import with_counts, album_payload
    drive = fake_drive()
    complete_scan(drive)
    engine = fake_engine()
    engine.extract.side_effect = GalleryError("model_unavailable")
    jobs.process_photo(jobs.claim_photo(), drive, Mock(), engine)
    photo = Photo.objects.get()
    assert photo.status == "ready" and photo.preview_key
    assert photo.indexing_error == "model_unavailable"
    assert photo.model_version == ""
    counts = album_payload(with_counts(Album.objects.all()).get())["counts"]
    assert counts["indexing_failed"] == 1 and counts["no_faces"] == 0
    assert jobs.retry_photos(photo_id=photo.pk) == 1
    assert jobs.claim_photo() is not None


def test_shutdown_releases_claim_without_spending_retry(album):
    from photo_gallery.errors import WorkerStopping
    drive = fake_drive()
    drive.list_page.side_effect = WorkerStopping
    jobs.run_once(drive=drive)
    album.refresh_from_db()
    assert album.import_status == "queued"
    assert album.lease_token is None and album.attempts == 0


def test_heartbeat_cannot_revive_expired_lease(album):
    complete_scan(fake_drive())
    claim = jobs.claim_photo()
    Photo.objects.filter(pk=claim.pk).update(lease_until=timezone.now() - timedelta(seconds=1))
    with pytest.raises(LeaseLost):
        jobs._lease_heartbeat(claim)(force=True)
