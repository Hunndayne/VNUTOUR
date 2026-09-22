"""The gallery must live only in its own database."""
import pytest
from django.db import DatabaseError, connections

from api.models import Account
from api.services.auth_service import generate_session
from photo_gallery.models import Album, Face, Photo, SearchResult
from photo_gallery.routers import PhotoGalleryRouter

pytestmark = pytest.mark.django_db(databases=["default", "photos"])


def test_gallery_tables_exist_only_in_photos_database():
    default_tables = set(connections["default"].introspection.table_names())
    photo_tables = set(connections["photos"].introspection.table_names())
    for model in [Album, Photo, Face, SearchResult]:
        assert model._meta.db_table in photo_tables
        assert model._meta.db_table not in default_tables
    # Nothing from the event schema is created in the gallery database.
    assert Account._meta.db_table not in photo_tables
    assert "auth_permission" not in photo_tables


def test_orm_traffic_is_routed_to_photos():
    album = Album.objects.create(title="A", folder_id="folder_123456", drive_folder_url="https://drive.google.com/drive/folders/folder_123456")
    assert album._state.db == "photos"
    assert Album.objects.all().db == "photos"
    assert Account.objects.all().db == "default"


def test_router_rules():
    router = PhotoGalleryRouter()
    assert router.allow_migrate("photos", "photo_gallery") is True
    assert router.allow_migrate("default", "photo_gallery") is False
    assert router.allow_migrate("photos", "api") is False
    assert router.allow_migrate("photos", "auth") is False
    assert router.allow_migrate("default", "api") is None
    assert router.allow_relation(Album(), Account()) is False
    assert router.allow_relation(Album(), Photo()) is True


def test_gallery_endpoints_answer_503_when_its_database_is_down(client, monkeypatch):
    admin = Account.objects.create(username="routing-admin", email="routing@example.test", role="admin", password_hash="unused")
    admin_headers = {"HTTP_AUTHORIZATION": "Bearer " + generate_session(admin)}

    def explode(*args, **kwargs):
        raise DatabaseError("photos-db is unreachable")

    monkeypatch.setattr("photo_gallery.views.with_counts", explode)
    response = client.get("/api/photo-albums", **admin_headers)
    assert response.status_code == 503
    assert response.json() == {"error": "gallery_unavailable"}
    # Reads that do not touch the gallery database still work.
    assert Account.objects.filter(pk=admin.pk).exists()
