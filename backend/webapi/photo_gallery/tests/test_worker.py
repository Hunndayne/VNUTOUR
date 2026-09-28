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


def folder(file_id, resource_key=""):
    return {"id": file_id, "name": file_id, "mimeType": "application/vnd.google-apps.folder", "resourceKey": resource_key}


def tree_drive(tree):
    """tree: {folder_id: [page, ...]}; pages chain through nextPageToken."""
    drive = fake_drive()

    def list_page(folder_id, resource_key="", page_token=""):
        pages = tree[folder_id]
        index = int(page_token or 0)
        page = {"files": pages[index]}
        if index + 1 < len(pages):
            page["nextPageToken"] = str(index + 1)
        return page

    drive.list_page.side_effect = list_page
    return drive


def scan_until_complete(album, drive, limit=20):
    for _ in range(limit):
        complete_scan(drive)
        album.refresh_from_db()
        if album.import_status == "complete":
            return
    raise AssertionError("scan did not complete")


def test_scan_walks_nested_subfolders(album):
    drive = tree_drive({
        "folder_123456": [[metadata("photo_root_1"), folder("sub_folder_1", "key_sub_0001")], [folder("sub_folder_2")]],
        "sub_folder_1": [[metadata("photo_sub_01"), folder("nested_fold")]],
        # A link back to an already queued folder must not be walked twice.
        "nested_fold": [[metadata("photo_nest_1"), folder("folder_123456")]],
        "sub_folder_2": [[]],
    })
    scan_until_complete(album, drive)
    listed = [(c.args[0], c.args[1]) for c in drive.list_page.call_args_list]
    assert listed == [("folder_123456", ""), ("folder_123456", ""), ("sub_folder_1", "key_sub_0001"),
                      ("sub_folder_2", ""), ("nested_fold", "")]
    assert dict(Photo.objects.values_list("drive_file_id", "folder_id")) == {
        "photo_root_1": "folder_123456", "photo_sub_01": "sub_folder_1", "photo_nest_1": "nested_fold",
    }
    assert set(Photo.objects.values_list("status", flat=True)) == {"pending"}
    assert album.scan_folders == [] and album.scan_folder_index == 0 and album.page_token == ""


def test_photo_missing_from_subfolder_fails_only_after_whole_tree(album):
    tree = {"folder_123456": [[folder("sub_folder_1")]], "sub_folder_1": [[metadata("photo_sub_01")]]}
    drive = tree_drive(tree)
    scan_until_complete(album, drive)
    Photo.objects.update(status="ready")
    tree["sub_folder_1"] = [[]]
    jobs.queue_import(album.pk)
    complete_scan(drive)  # root only; the subfolder is still queued
    album.refresh_from_db()
    assert album.import_status == "scanning" and album.scan_folder_index == 1
    assert Photo.objects.get().status == "ready"
    complete_scan(drive)
    assert Photo.objects.get().error == "source_unavailable"
