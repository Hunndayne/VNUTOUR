"""Storage falls back to the media volume when R2 is not configured."""
import pytest

from photo_gallery.errors import GalleryError
from photo_gallery.storage import Storage

KEY = "event-photos/3/12/2a0b8d64-1f3a-4f1e-9a55-0c9f3a4b2e11/preview.webp"


@pytest.fixture
def local_media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    settings.R2_BUCKET = settings.R2_ENDPOINT_URL = ""
    settings.R2_ACCESS_KEY_ID = settings.R2_SECRET_ACCESS_KEY = ""
    settings.PHOTO_R2_BUCKET = ""
    return tmp_path


def test_local_storage_writes_reads_and_deletes(local_media):
    storage = Storage()
    storage.put(KEY, b"webp-bytes")
    assert (local_media / KEY).read_bytes() == b"webp-bytes"
    # No leftover temporary file from the atomic write.
    assert [p.name for p in (local_media / KEY).parent.iterdir()] == ["preview.webp"]
    assert storage.url(KEY) == "/media/" + KEY
    assert storage.url("") is None
    storage.delete(KEY)
    assert not (local_media / KEY).exists()
    storage.delete(KEY)  # deleting twice is not an error


def test_local_storage_refuses_to_escape_the_media_root(local_media):
    storage = Storage()
    with pytest.raises(GalleryError):
        storage.put("event-photos/../../etc/passwd", b"x")


def test_media_route_serves_event_photos_without_a_token(client, local_media):
    Storage().put(KEY, b"webp-bytes")
    response = client.get("/media/" + KEY)
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"webp-bytes"
    # Only the documented gallery shape is served this way.
    assert client.get("/media/event-photos/3/12/nope/preview.webp").status_code in {401, 404}


def test_r2_is_used_when_configured(settings, monkeypatch):
    settings.R2_BUCKET = "bucket"
    settings.R2_ENDPOINT_URL = "https://account.r2.cloudflarestorage.com"
    settings.R2_ACCESS_KEY_ID = "id"
    settings.R2_SECRET_ACCESS_KEY = "secret"
    settings.PHOTO_R2_BUCKET = ""
    storage = Storage()
    assert storage.bucket == "bucket"
    assert storage.url(KEY).startswith("https://")
