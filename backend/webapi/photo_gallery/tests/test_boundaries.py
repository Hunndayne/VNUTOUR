import io
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from django.apps import apps
from django.test import RequestFactory

if not apps.is_installed("photo_gallery"):
    pytest.skip("Use --ds=serverapi.settings_test_photos", allow_module_level=True)

from photo_gallery.ai_views import embed
from photo_gallery.constants import MODEL_VERSION
from photo_gallery.drive import Drive, revision
from photo_gallery.errors import GalleryError
from photo_gallery.search import embed_reference
from photo_gallery.storage import Storage


@pytest.mark.parametrize("override, expected_bucket", [("", "shared-bucket"), ("photo-bucket", "photo-bucket")])
def test_photo_storage_uses_shared_bucket_unless_overridden(settings, override, expected_bucket):
    settings.PHOTO_R2_BUCKET = override
    settings.R2_BUCKET = "shared-bucket"
    settings.R2_ENDPOINT_URL = "https://account.r2.cloudflarestorage.com"
    settings.R2_ACCESS_KEY_ID = "test-key"
    settings.R2_SECRET_ACCESS_KEY = "test-secret"
    key = "event-photos/1/2/lease/preview.webp"
    with patch("photo_gallery.storage.boto3.client") as client:
        storage = Storage()
        storage.put(key, b"preview")
        storage.url(key)
        storage.delete(key)
    assert client.return_value.put_object.call_args.kwargs["Bucket"] == expected_bucket
    assert client.return_value.put_object.call_args.kwargs["Key"] == key
    assert client.return_value.generate_presigned_url.call_args.kwargs["Params"]["Bucket"] == expected_bucket
    client.return_value.delete_object.assert_called_once_with(Bucket=expected_bucket, Key=key)


def test_internal_endpoint_rejects_missing_token_before_loading_model(settings):
    settings.PHOTO_AI_TOKEN = "test-only"
    with patch("photo_gallery.ai_views.get_engine") as engine:
        response = embed(RequestFactory().post("/v1/embed", b"bad", content_type="application/octet-stream"))
    assert response.status_code == 403
    engine.assert_not_called()


def test_internal_endpoint_bounds_body_before_loading_model(settings):
    settings.PHOTO_AI_TOKEN = "test-only"
    settings.PHOTO_REFERENCE_MAX_BYTES = 2
    with patch("photo_gallery.ai_views.get_engine") as engine:
        response = embed(RequestFactory().post("/v1/embed", b"bad", content_type="application/octet-stream", HTTP_AUTHORIZATION="Bearer test-only"))
    assert response.status_code == 400
    engine.assert_not_called()


@pytest.mark.parametrize("payload", [[], {"model_version": "wrong", "embedding": [1.] + [0.] * 127}, {"model_version": MODEL_VERSION, "embedding": [float("nan")] * 128}, {"model_version": MODEL_VERSION, "embedding": [1.] * 128}])
def test_search_rejects_incompatible_or_invalid_vectors(settings, payload):
    settings.PHOTO_AI_TOKEN = "test-only"
    response = Mock(status_code=200)
    response.json.return_value = payload
    with patch("photo_gallery.search.requests.post", return_value=response):
        with pytest.raises(GalleryError, match="search_unavailable"):
            embed_reference(b"reference")


def source():
    meta = {"id": "photo_123456", "parents": ["folder_123456"], "mimeType": "image/png", "size": 3, "version": "1", "capabilities": {"canDownload": True}}
    photo = SimpleNamespace(drive_file_id=meta["id"], resource_key="", album=SimpleNamespace(folder_id="folder_123456"), source_revision=revision(meta))
    drive = object.__new__(Drive)
    drive.get = Mock(return_value=meta)
    response = Mock()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.iter_content.return_value = [b"abc"]
    drive._get = Mock(return_value=response)
    return drive, photo, meta, response


def test_download_rejects_stream_over_limit(settings):
    settings.PHOTO_MAX_IMAGE_BYTES = 4
    drive, photo, _, response = source()
    response.iter_content.return_value = [b"abc", b"de"]
    with pytest.raises(GalleryError, match="reference_too_large"):
        drive.download(photo, io.BytesIO())


def test_download_detects_source_change_during_transfer():
    drive, photo, meta, _ = source()
    drive.get.side_effect = [meta, {**meta, "version": "2"}]
    with pytest.raises(GalleryError, match="source_changed"):
        drive.download(photo, io.BytesIO())


def test_download_accepts_verified_unchanged_source():
    drive, photo, _, _ = source()
    output = io.BytesIO()
    drive.download(photo, output)
    assert output.read() == b"abc"


def test_camera_jpegs_detected_as_mpo_are_accepted():
    """Most camera/phone JPEGs carry a second frame and identify as MPO."""
    from PIL import Image
    from photo_gallery.imaging import read_image

    stream = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 10, 10)).save(
        stream, "MPO", append_images=[Image.new("RGB", (64, 48), (10, 10, 200))],
    )
    stream.seek(0)
    image = read_image(stream)
    assert image.size == (64, 48) and image.mode == "RGB"


def test_unsupported_formats_are_still_rejected():
    from PIL import Image
    from photo_gallery.errors import GalleryError
    from photo_gallery.imaging import read_image

    stream = io.BytesIO()
    Image.new("RGB", (8, 8)).save(stream, "BMP")
    stream.seek(0)
    with pytest.raises(GalleryError) as error:
        read_image(stream)
    assert error.value.code == "invalid_image"
