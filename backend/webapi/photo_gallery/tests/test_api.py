import io
import json
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.apps import apps
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from django.test import Client
from PIL import Image

if not apps.is_installed("photo_gallery"):
    pytest.skip("Use --ds=serverapi.settings_test_photos", allow_module_level=True)

from api.models import Account, Participant, Team, TeamMembership
from api.services.auth_service import generate_session
from photo_gallery.constants import MODEL_VERSION
from photo_gallery.errors import GalleryError
from photo_gallery.models import Album, Photo, Face, SearchResult

pytestmark = pytest.mark.django_db(databases=["default", "photos"])


@pytest.fixture(autouse=True)
def clear_limits():
    cache.clear()


@pytest.fixture
def client(client):
    """Existing gallery behavior tests run as an approved team member."""
    account = Account.objects.create(username="gallery-member", email="member@example.test", role="participant", mssv="PHOTO001", password_hash="unused")
    participant = Participant.objects.create(account=account, mssv=account.mssv, full_name="Gallery Member")
    team = Team.objects.create(code="PHOTO001", name="Approved team", approval_status=Team.APPROVAL_APPROVED)
    TeamMembership.objects.create(team=team, participant=participant)
    client.defaults["HTTP_AUTHORIZATION"] = "Bearer " + generate_session(account)
    return client


@pytest.fixture
def admin_headers():
    account = Account.objects.create(username="photo-admin", email="photos@example.test", role="admin", password_hash="unused")
    return {"HTTP_AUTHORIZATION": "Bearer " + generate_session(account)}


@pytest.fixture
def published():
    return Album.objects.create(title="Ngày hội", status="published", folder_id="folder_123456", drive_folder_url="https://drive.google.com/drive/folders/folder_123456")


def make_photo(album, **kwargs):
    return Photo.objects.create(album=album, drive_file_id=f"file_{Photo.objects.count():010}", filename="ảnh.png", source_revision="1:", status="ready", model_version=MODEL_VERSION, **kwargs)


def add_face(photo, *, ordinal=0, vector=None, version=MODEL_VERSION):
    return Face.objects.create(photo=photo, ordinal=ordinal, bbox=[0, 0, 1, 1], embedding=vector or [1.0] + [0.0] * 127, model_version=version)


def reference():
    stream = io.BytesIO()
    Image.new("RGB", (32, 32)).save(stream, "PNG")
    return SimpleUploadedFile("reference.png", stream.getvalue(), content_type="image/png")


def test_admin_create_and_queue_import_is_idempotent(client, admin_headers):
    response = client.post("/api/admin/photo-albums", data=json.dumps({"title": "Ngày hội", "description": "Album chung", "drive_folder_url": "https://drive.google.com/drive/folders/folder_123456"}), content_type="application/json", **admin_headers)
    assert response.status_code == 201, response.content
    album = Album.objects.get()
    assert album.status == "draft"
    assert album.import_status == "queued"
    scan_id = album.scan_id
    response = client.post(f"/api/admin/photo-albums/{album.id}/import-drive", data="{}", content_type="application/json", **admin_headers)
    assert response.status_code == 202
    album.refresh_from_db()
    assert album.scan_id == scan_id
    assert "counts" in response.json()["album"]


def test_public_routes_exclude_draft_and_hidden_albums(client, published):
    draft = Album.objects.create(title="Private", folder_id="folder_123457", status="draft")
    hidden = Album.objects.create(title="Hidden", folder_id="folder_123458", status="hidden")
    make_photo(draft)
    response = client.get("/api/photo-albums")
    assert [a["id"] for a in response.json()["albums"]] == [published.id]
    for album in [draft, hidden]:
        assert client.get(f"/api/photo-albums/{album.id}/photos").status_code == 404
    assert "drive_folder_url" not in response.json()["albums"][0]


def test_admin_requires_authorized_account(client, published):
    assert Client().get("/api/admin/photo-albums").status_code == 401
    account = Account.objects.create(username="visitor", email="visitor@example.test", role="participant", password_hash="unused")
    response = client.patch(f"/api/admin/photo-albums/{published.id}", data=json.dumps({"status": "hidden"}), content_type="application/json", HTTP_AUTHORIZATION="Bearer " + generate_session(account))
    assert response.status_code == 403


def test_admin_cookie_mutation_requires_csrf(published):
    from django.test import Client
    account = Account.objects.create(username="cookie-admin", email="cookie@example.test", role="admin", password_hash="unused")
    browser = Client(enforce_csrf_checks=True)
    browser.cookies["token"] = generate_session(account)
    response = browser.patch(f"/api/admin/photo-albums/{published.id}", data=json.dumps({"status": "hidden"}), content_type="application/json")
    assert response.status_code == 403


def test_cursor_pagination_has_no_gaps_or_duplicates(client, published):
    expected = [make_photo(published).id for _ in range(5)]
    seen, cursor = [], 0
    while True:
        response = client.get(f"/api/photo-albums/{published.id}/photos", {"cursor": cursor, "limit": 2})
        assert response.status_code == 200
        result = response.json()
        seen += [p["id"] for p in result["photos"]]
        cursor = result["next_cursor"]
        if cursor is None:
            break
    assert seen == expected


def test_signed_urls_never_expose_keys_or_vectors(client, published):
    photo = make_photo(published, thumbnail_key="event-photos/t.webp", preview_key="event-photos/p.webp")
    add_face(photo)
    with patch("photo_gallery.storage.Storage") as storage:
        storage.return_value.url.return_value = "https://r2.example.test/signed-preview"
        response = client.get(f"/api/photo-albums/{published.id}/photos")
    payload = response.json()["photos"][0]
    assert payload["preview_url"].endswith("signed-preview")
    assert "embedding" not in payload and "thumbnail_key" not in payload and "drive_file_id" not in payload


def test_search_deduplicates_faces_and_excludes_private_or_other_model(client, published):
    match = make_photo(published)
    add_face(match)
    add_face(match, ordinal=1)
    other = make_photo(published)
    add_face(other, vector=[0.0, 1.0] + [0.0] * 126)
    old = make_photo(published)
    add_face(old, version="old-model")
    draft = Album.objects.create(title="Draft", folder_id="folder_123459")
    add_face(make_photo(draft))
    with patch("photo_gallery.views.embed_reference", return_value=[1.0] + [0.0] * 127):
        response = client.post("/api/photo-search", {"image": reference(), "album_id": published.id})
    assert response.status_code == 200, response.content
    payload = response.json()
    assert [p["id"] for p in payload["photos"]] == [match.id]
    assert payload["total"] == 1
    saved = SearchResult.objects.get()
    assert saved.photo_ids == [match.id]
    # The retained query result contains IDs only; no image/vector field exists.
    assert {f.name for f in SearchResult._meta.fields} == {"token", "photo_ids", "truncated", "expires_at"}


def test_search_pages_recheck_removed_and_unpublished(client, published):
    photo = make_photo(published)
    result = SearchResult.objects.create(photo_ids=[photo.id], expires_at=timezone.now() + timedelta(minutes=10))
    published.status = "hidden"
    published.save()
    response = client.get(f"/api/photo-search/{result.token}")
    assert response.status_code == 200
    assert response.json()["photos"] == []
    published.status = "published"
    published.save()
    photo.status = "removed"
    photo.save()
    assert client.get(f"/api/photo-search/{result.token}").json()["photos"] == []


def test_expired_search_returns_410(client):
    result = SearchResult.objects.create(expires_at=timezone.now() - timedelta(seconds=1))
    response = client.get(f"/api/photo-search/{result.token}")
    assert response.status_code == 410
    assert response.json()["error"] == "search_expired"


def test_search_cursor_does_not_skip_after_earlier_photo_is_removed(client, published):
    photos = [make_photo(published) for _ in range(4)]
    result = SearchResult.objects.create(photo_ids=[p.id for p in photos], expires_at=timezone.now() + timedelta(minutes=10))
    first = client.get(f"/api/photo-search/{result.token}", {"limit": 2}).json()
    photos[0].status = "removed"
    photos[0].save()
    second = client.get(f"/api/photo-search/{result.token}", {"limit": 2, "cursor": first["next_cursor"]}).json()
    assert [p["id"] for p in second["photos"]] == [p.id for p in photos[2:]]


@pytest.mark.parametrize("status", [[], {}, None, 1])
def test_invalid_status_is_400(client, published, admin_headers, status):
    response = client.patch(f"/api/admin/photo-albums/{published.id}", data=json.dumps({"status": status}), content_type="application/json", **admin_headers)
    assert response.status_code == 400


def test_search_rate_limit_prevents_model_call(client, settings):
    settings.PHOTO_SEARCH_RATE_LIMIT = 1
    with patch("photo_gallery.views.embed_reference", side_effect=GalleryError("no_face")) as embed:
        assert client.post("/api/photo-search", {"image": reference()}).status_code == 400
        assert client.post("/api/photo-search", {"image": reference()}).status_code == 429
    assert embed.call_count == 1


@pytest.mark.parametrize("code", ["no_face", "multiple_faces", "invalid_image"])
def test_reference_errors_are_visible_not_empty_results(client, code):
    with patch("photo_gallery.views.embed_reference", side_effect=GalleryError(code)):
        response = client.post("/api/photo-search", {"image": reference()})
    assert response.status_code == 400
    assert response.json()["error"] == code
    assert not SearchResult.objects.exists()


def test_service_failure_is_503_not_no_match(client):
    with patch("photo_gallery.views.embed_reference", side_effect=GalleryError("search_unavailable", retryable=True)):
        response = client.post("/api/photo-search", {"image": reference()})
    assert response.status_code == 503


def test_delete_is_tombstone_and_clears_faces(client, published, admin_headers):
    photo = make_photo(published)
    add_face(photo)
    response = client.delete(f"/api/admin/photos/{photo.id}", **admin_headers)
    assert response.status_code == 200
    photo.refresh_from_db()
    assert photo.status == "removed"
    assert photo.faces.count() == 0
    assert client.post(f"/api/admin/photos/{photo.id}/retry", data="{}", content_type="application/json", **admin_headers).status_code == 202
    photo.refresh_from_db()
    assert photo.status == "removed"


@pytest.mark.parametrize("url", ["http://169.254.169.254/latest/meta-data", "https://drive.google.com.evil.test/drive/folders/folder_123456", "https://drive.google.com:bad/drive/folders/folder_123456"])
def test_import_rejects_non_drive_targets(client, admin_headers, url):
    response = client.post("/api/admin/photo-albums", data=json.dumps({"title": "x", "drive_folder_url": url}), content_type="application/json", **admin_headers)
    assert response.status_code == 400, response.content
    assert not Album.objects.exists()


def test_admin_album_list_exposes_drive_share_email_to_admins_only(client, admin_headers, published, settings):
    settings.PHOTO_DRIVE_SERVICE_EMAIL = "worker@example.iam.gserviceaccount.com"
    response = client.get("/api/admin/photo-albums", **admin_headers)
    assert response.json()["drive_service_email"] == "worker@example.iam.gserviceaccount.com"
    assert "drive_service_email" not in client.get("/api/photo-albums").json()
    settings.PHOTO_DRIVE_SERVICE_EMAIL = ""
    assert client.get("/api/admin/photo-albums", **admin_headers).json()["drive_service_email"] is None
